// Module responsibility: load JSON configuration files without mixing them into runtime logic.

import type { BotConfig } from "../types/bot.ts";
import type { MarketStreamConfig, MarketMode } from "../types/market.ts";

const fs = require("node:fs");
const path = require("node:path");

const VALID_RISK_PROFILES = new Set(["low", "medium", "high"]);
const VALID_MARKET_PROVIDERS = new Set(["binance"]);
const VALID_MARKET_STREAM_TYPES = new Set(["trade", "aggTrade"]);
const VALID_RISK_OVERRIDE_FIELDS = new Set(["positionPct", "cooldownMs", "emergencyStopPct", "postExitReentryGuardMs", "exitConfirmationTicks", "minHoldMs"]);

class ConfigLoader {
  rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir || path.resolve(__dirname, "..");
  }

  loadJson(relativePath: string) {
    const absolutePath = path.resolve(this.rootDir, relativePath);
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  }

  loadBotsConfig(): {
    bots: BotConfig[];
    executionMode?: "paper" | "live";
    marketMode?: MarketMode;
    market?: MarketStreamConfig;
  } {
    const config = this.loadJson("./data/bots.config.json");
    this.validateRuntimeConfig(config);
    this.validateBotsConfig(config);
    return config;
  }

  loadStrategiesConfig() {
    return this.loadJson("./data/strategies.config.json");
  }

  resolve(relativePath: string) {
    return path.resolve(this.rootDir, relativePath);
  }

  validateBotsConfig(config: {
    bots?: BotConfig[];
  }) {
    const strategiesConfig = this.loadStrategiesConfig();
    const knownStrategies = new Set((strategiesConfig?.strategies || []).map((entry: any) => String(entry?.id || "").trim()).filter(Boolean));
    const bots = Array.isArray(config?.bots) ? config.bots : [];
    const enabledBotIdsBySymbol = new Map<string, string[]>();

    for (let index = 0; index < bots.length; index += 1) {
      const bot = bots[index] || {} as BotConfig;
      const label = `bots.config.json bot[${index}]${bot?.id ? ` (${bot.id})` : ""}`;
      const strategy = String(bot?.strategy || "").trim();
      const riskProfile = String(bot?.riskProfile || "").trim();
      const symbol = String(bot?.symbol || "").trim();

      if (!strategy || !knownStrategies.has(strategy)) {
        throw new Error(`${label} has invalid strategy "${String(bot?.strategy || "")}"`);
      }

      if (!VALID_RISK_PROFILES.has(riskProfile)) {
        throw new Error(`${label} has invalid riskProfile "${String(bot?.riskProfile || "")}"`);
      }

      if (bot.riskOverrides !== undefined) {
        if (!bot.riskOverrides || typeof bot.riskOverrides !== "object" || Array.isArray(bot.riskOverrides)) {
          throw new Error(`${label} has invalid riskOverrides; expected an object`);
        }
        for (const [key, value] of Object.entries(bot.riskOverrides)) {
          if (!VALID_RISK_OVERRIDE_FIELDS.has(key)) {
            throw new Error(`${label} has invalid riskOverrides field "${key}"`);
          }
          const numericValue = Number(value);
          if (!Number.isFinite(numericValue)) {
            throw new Error(`${label} has invalid riskOverrides.${key} "${String(value)}"`);
          }
          if ((key === "positionPct" || key === "emergencyStopPct") && !(numericValue > 0)) {
            throw new Error(`${label} has invalid riskOverrides.${key} "${String(value)}"`);
          }
          if ((key === "cooldownMs" || key === "postExitReentryGuardMs" || key === "exitConfirmationTicks" || key === "minHoldMs") && !(numericValue >= 1)) {
            throw new Error(`${label} has invalid riskOverrides.${key} "${String(value)}"`);
          }
        }
      }

      if (bot.allowedStrategies !== undefined) {
        if (!Array.isArray(bot.allowedStrategies) || bot.allowedStrategies.length <= 0) {
          throw new Error(`${label} has invalid allowedStrategies; expected a non-empty array of known strategy ids`);
        }

        for (const allowedStrategy of bot.allowedStrategies) {
          const normalized = String(allowedStrategy || "").trim();
          if (!normalized || !knownStrategies.has(normalized)) {
            throw new Error(`${label} has invalid allowedStrategies entry "${String(allowedStrategy || "")}"`);
          }
        }
      }

      if (bot.enabled) {
        const enabledIds = enabledBotIdsBySymbol.get(symbol) || [];
        enabledIds.push(String(bot?.id || `bot[${index}]`));
        enabledBotIdsBySymbol.set(symbol, enabledIds);
      }
    }

    for (const [symbol, enabledIds] of enabledBotIdsBySymbol.entries()) {
      if (enabledIds.length > 1) {
        throw new Error(`bots.config.json has duplicate enabled bot symbols for "${symbol}": ${enabledIds.join(", ")}`);
      }
    }
  }

  validateRuntimeConfig(config: {
    executionMode?: string;
    marketMode?: string;
    market?: MarketStreamConfig | unknown;
  }) {
    if (config.executionMode !== undefined) {
      const executionMode = String(config.executionMode || "").trim().toLowerCase();
      if (executionMode === "live") {
        throw new Error("bots.config.json has unsupported executionMode \"live\"; active runtime is paper-only");
      }
      if (executionMode !== "paper") {
        throw new Error(`bots.config.json has invalid executionMode "${String(config.executionMode || "")}"`);
      }
    }

    if (config.marketMode !== undefined) {
      const marketMode = String(config.marketMode || "").trim().toLowerCase();
      if (marketMode !== "live") {
        throw new Error(`bots.config.json has unsupported marketMode "${String(config.marketMode || "")}"; active runtime requires live market data`);
      }
    }

    if (config.market !== undefined) {
      if (!config.market || typeof config.market !== "object" || Array.isArray(config.market)) {
        throw new Error("bots.config.json has invalid market; expected an object");
      }

      const market = config.market as MarketStreamConfig;
      if (market.mode !== undefined && String(market.mode || "").trim().toLowerCase() !== "live") {
        throw new Error(`bots.config.json has unsupported market.mode "${String(market.mode || "")}"; active runtime requires live market data`);
      }
      if (market.provider !== undefined && !VALID_MARKET_PROVIDERS.has(String(market.provider || "").trim())) {
        throw new Error(`bots.config.json has invalid market.provider "${String(market.provider || "")}"`);
      }
      if (market.streamType !== undefined && !VALID_MARKET_STREAM_TYPES.has(String(market.streamType || "").trim())) {
        throw new Error(`bots.config.json has invalid market.streamType "${String(market.streamType || "")}"`);
      }
      if (market.wsBaseUrl !== undefined && String(market.wsBaseUrl || "").trim() === "") {
        throw new Error("bots.config.json has invalid market.wsBaseUrl; expected a non-empty string");
      }
      if (market.klineIntervals !== undefined) {
        if (!Array.isArray(market.klineIntervals) || market.klineIntervals.some((interval) => String(interval || "").trim() === "")) {
          throw new Error("bots.config.json has invalid market.klineIntervals; expected an array of non-empty strings");
        }
      }
      if (market.liveEmitIntervalMs !== undefined) {
        const intervalMs = Number(market.liveEmitIntervalMs);
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
          throw new Error(`bots.config.json has invalid market.liveEmitIntervalMs "${String(market.liveEmitIntervalMs)}"`);
        }
      }
    }
  }
}

module.exports = {
  ConfigLoader
};
