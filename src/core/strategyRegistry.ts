import type { RecommendedFamily } from "../types/architect.ts";
import type { Strategy } from "../types/strategy.ts";

function normalizeStrategyFamily(strategyId: string, family: unknown): RecommendedFamily | "other" {
  if (family === "trend_following" || family === "mean_reversion") {
    return family;
  }
  throw new Error(`Strategy ${strategyId} has invalid or missing family metadata: ${String(family)}`);
}

class StrategyRegistry {
  configLoader: any;
  indicatorEngine: any;
  strategies: Map<string, { modulePath: string; configPath: string; family: RecommendedFamily | "other" }>;

  constructor(deps: { configLoader: any; indicatorEngine: any }) {
    this.configLoader = deps.configLoader;
    this.indicatorEngine = deps.indicatorEngine;
    this.strategies = new Map();
  }

  load() {
    const config = this.configLoader.loadStrategiesConfig();
    for (const entry of config.strategies || []) {
      this.strategies.set(entry.id, {
        configPath: entry.config,
        family: normalizeStrategyFamily(entry.id, entry.family),
        modulePath: entry.module
      });
    }
  }

  listStrategyIds(): string[] {
    return Array.from(this.strategies.keys());
  }

  getStrategyFamily(strategyId: string | null | undefined): RecommendedFamily | "other" {
    if (!strategyId) return "other";
    return this.strategies.get(strategyId)?.family || "other";
  }

  createStrategy(strategyId: string): Strategy {
    const entry = this.strategies.get(strategyId);
    if (!entry) {
      throw new Error(`Unknown strategy: ${strategyId}`);
    }

    const strategyConfig = this.configLoader.loadJson(entry.configPath);
    const strategyModule = require(this.configLoader.resolve(entry.modulePath));
    if (typeof strategyModule.createStrategy !== "function") {
      throw new Error(`Strategy module ${strategyId} does not export createStrategy()`);
    }

    const strategy = strategyModule.createStrategy({
      ...strategyConfig,
      indicatorEngine: this.indicatorEngine
    });
    return {
      ...strategy,
      config: strategyConfig
    };
  }
}

module.exports = {
  StrategyRegistry
};
