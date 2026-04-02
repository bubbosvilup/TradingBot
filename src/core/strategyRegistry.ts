// Module responsibility: register and instantiate strategies without hardcoding them into bot logic.

import type { Strategy } from "../types/strategy.ts";

class StrategyRegistry {
  configLoader: any;
  indicatorEngine: any;
  strategies: Map<string, { modulePath: string; configPath: string }>;

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
        modulePath: entry.module
      });
    }
  }

  listStrategyIds(): string[] {
    return Array.from(this.strategies.keys());
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
