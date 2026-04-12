// Module responsibility: load JSON configuration files without mixing them into runtime logic.

import type { BotConfig } from "../types/bot.ts";
import type { MarketStreamConfig, MarketMode } from "../types/market.ts";
import type { MtfFrameConfig, MtfRuntimeConfig } from "../types/mtf.ts";
import type { PortfolioKillSwitchConfig, RuntimeTuningConfig } from "../types/runtime.ts";

const fs = require("node:fs");
const path = require("node:path");

const VALID_RISK_PROFILES = new Set(["low", "medium", "high"]);
const VALID_MARKET_PROVIDERS = new Set(["binance"]);
const VALID_MARKET_STREAM_TYPES = new Set(["trade", "aggTrade"]);
const VALID_MTF_HORIZON_FRAMES = new Set(["short", "medium", "long"]);
const VALID_MTF_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const VALID_RISK_OVERRIDE_FIELDS = new Set(["positionPct", "cooldownMs", "emergencyStopPct", "postExitReentryGuardMs", "exitConfirmationTicks", "minHoldMs"]);
const VALID_PORTFOLIO_KILL_SWITCH_MODES = new Set(["block_entries_only"]);

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
    architectPublishIntervalMs?: number;
    architectWarmupMs?: number;
    executionMode?: "paper" | "live";
    marketMode?: MarketMode;
    market?: MarketStreamConfig;
    mtf?: MtfRuntimeConfig;
    portfolioKillSwitch?: PortfolioKillSwitchConfig;
    postLossLatchMinFreshPublications?: number;
    symbolStateRetentionMs?: number;
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
    architectPublishIntervalMs?: number;
    architectWarmupMs?: number;
    executionMode?: string;
    marketMode?: string;
    market?: MarketStreamConfig | unknown;
    portfolioKillSwitch?: PortfolioKillSwitchConfig | unknown;
    mtf?: MtfRuntimeConfig | unknown;
    postLossLatchMinFreshPublications?: number;
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

    if (config.portfolioKillSwitch !== undefined) {
      if (!config.portfolioKillSwitch || typeof config.portfolioKillSwitch !== "object" || Array.isArray(config.portfolioKillSwitch)) {
        throw new Error("bots.config.json has invalid portfolioKillSwitch; expected an object");
      }

      const portfolioKillSwitch = config.portfolioKillSwitch as Record<string, unknown>;
      if (portfolioKillSwitch.enabled !== undefined && typeof portfolioKillSwitch.enabled !== "boolean") {
        throw new Error(`bots.config.json has invalid portfolioKillSwitch.enabled "${String(portfolioKillSwitch.enabled)}"`);
      }
      if (portfolioKillSwitch.maxDrawdownPct !== undefined) {
        const maxDrawdownPct = Number(portfolioKillSwitch.maxDrawdownPct);
        if (!Number.isFinite(maxDrawdownPct) || maxDrawdownPct <= 0) {
          throw new Error(`bots.config.json has invalid portfolioKillSwitch.maxDrawdownPct "${String(portfolioKillSwitch.maxDrawdownPct)}"`);
        }
      }
      if (portfolioKillSwitch.mode !== undefined && !VALID_PORTFOLIO_KILL_SWITCH_MODES.has(String(portfolioKillSwitch.mode || "").trim())) {
        throw new Error(`bots.config.json has invalid portfolioKillSwitch.mode "${String(portfolioKillSwitch.mode || "")}"`);
      }
    }

    this.validateMtfConfig(config.mtf);

    this.validateRuntimeTuningConfig(config);
  }

  validateMtfConfig(mtfConfig?: MtfRuntimeConfig | unknown) {
    if (mtfConfig === undefined) return;
    if (!mtfConfig || typeof mtfConfig !== "object" || Array.isArray(mtfConfig)) {
      throw new Error("bots.config.json has invalid mtf; expected an object");
    }

    const mtf = mtfConfig as MtfRuntimeConfig;
    if (mtf.enabled !== undefined && typeof mtf.enabled !== "boolean") {
      throw new Error(`bots.config.json has invalid mtf.enabled "${String(mtf.enabled)}"`);
    }

    if (mtf.instabilityThreshold !== undefined) {
      const threshold = Number(mtf.instabilityThreshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`bots.config.json has invalid mtf.instabilityThreshold "${String(mtf.instabilityThreshold)}"`);
      }
    }

    if (mtf.frames !== undefined) {
      if (!Array.isArray(mtf.frames) || mtf.frames.length <= 0) {
        throw new Error("bots.config.json has invalid mtf.frames; expected a non-empty array");
      }

      for (let index = 0; index < mtf.frames.length; index += 1) {
        const frame = mtf.frames[index] as MtfFrameConfig;
        const label = `bots.config.json mtf.frames[${index}]`;
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
          throw new Error(`${label} is invalid; expected an object`);
        }
        if (!VALID_MTF_TIMEFRAMES.has(String(frame.id || "").trim())) {
          throw new Error(`${label} has invalid id "${String(frame.id || "")}"`);
        }
        if (!VALID_MTF_HORIZON_FRAMES.has(String(frame.horizonFrame || "").trim())) {
          throw new Error(`${label} has invalid horizonFrame "${String(frame.horizonFrame || "")}"`);
        }
        const windowMs = Number(frame.windowMs);
        if (!Number.isFinite(windowMs) || windowMs < 5_000) {
          throw new Error(`${label} has invalid windowMs "${String(frame.windowMs)}"`);
        }
      }
    }
  }

  validateRuntimeTuningConfig(config: RuntimeTuningConfig) {
    if (config.architectWarmupMs !== undefined) {
      const architectWarmupMs = Number(config.architectWarmupMs);
      if (!Number.isFinite(architectWarmupMs) || architectWarmupMs < 5_000) {
        throw new Error(`bots.config.json has invalid architectWarmupMs "${String(config.architectWarmupMs)}"`);
      }
    }

    if (config.architectPublishIntervalMs !== undefined) {
      const architectPublishIntervalMs = Number(config.architectPublishIntervalMs);
      if (!Number.isFinite(architectPublishIntervalMs) || architectPublishIntervalMs < 5_000) {
        throw new Error(`bots.config.json has invalid architectPublishIntervalMs "${String(config.architectPublishIntervalMs)}"`);
      }
    }

    if (config.postLossLatchMinFreshPublications !== undefined) {
      const postLossLatchMinFreshPublications = Number(config.postLossLatchMinFreshPublications);
      if (!Number.isFinite(postLossLatchMinFreshPublications) || postLossLatchMinFreshPublications < 1) {
        throw new Error(`bots.config.json has invalid postLossLatchMinFreshPublications "${String(config.postLossLatchMinFreshPublications)}"`);
      }
    }

    if (config.symbolStateRetentionMs !== undefined) {
      const symbolStateRetentionMs = Number(config.symbolStateRetentionMs);
      if (!Number.isFinite(symbolStateRetentionMs) || symbolStateRetentionMs < 60_000) {
        throw new Error(`bots.config.json has invalid symbolStateRetentionMs "${String(config.symbolStateRetentionMs)}"`);
      }
    }
  }
}

module.exports = {
  ConfigLoader
};
