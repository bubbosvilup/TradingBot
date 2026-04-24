// Module responsibility: load JSON configuration files without mixing them into runtime logic.

import type { BotConfig } from "../types/bot.ts";
import type { HistoricalPreloadConfig, MarketStreamConfig, MarketMode } from "../types/market.ts";
import type { MtfFrameConfig, MtfRuntimeConfig } from "../types/mtf.ts";
import type { PortfolioKillSwitchConfig, RuntimeTuningConfig } from "../types/runtime.ts";

const fs = require("node:fs");
const path = require("node:path");

const VALID_RISK_PROFILES = new Set(["low", "medium", "high"]);
const VALID_MARKET_PROVIDERS = new Set(["binance"]);
const VALID_MARKET_STREAM_TYPES = new Set(["trade", "aggTrade"]);
const VALID_MTF_HORIZON_FRAMES = new Set(["short", "medium", "long"]);
const VALID_MTF_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const VALID_PORTFOLIO_KILL_SWITCH_MODES = new Set(["block_entries_only"]);

type NumericValidationRule = {
  max?: number;
  min?: number;
  minExclusive?: number;
};
type RiskOverrideRule =
  | { type: "boolean" }
  | ({ type: "number" } & NumericValidationRule);

const RISK_OVERRIDE_RULES: Record<string, RiskOverrideRule> = {
  cooldownMs: { type: "number", min: 1 },
  emergencyStopPct: { type: "number", minExclusive: 0 },
  exitConfirmationTicks: { type: "number", min: 1 },
  meaningfulWinUsdt: { type: "number", min: 0 },
  minHoldMs: { type: "number", min: 1 },
  positionPct: { type: "number", minExclusive: 0 },
  postExitReentryGuardMs: { type: "number", min: 1 },
  volatilitySizingEnabled: { type: "boolean" },
  volatilitySizingMinPenalty: { type: "number", max: 1, minExclusive: 0 },
  volatilitySizingMultiplier: { type: "number", max: 1, min: 0 },
  winReentryCooldownMs: { type: "number", min: 1 }
};

function normalizeConfigString(value: unknown) {
  return String(value || "").trim();
}

function requirePlainObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function hasOwnConfigRule(rules: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(rules, key);
}

function numberMatchesRule(value: number, rule: NumericValidationRule) {
  if (rule.min !== undefined && value < rule.min) return false;
  if (rule.minExclusive !== undefined && value <= rule.minExclusive) return false;
  if (rule.max !== undefined && value > rule.max) return false;
  return true;
}

function assertOptionalBooleanField(config: Record<string, unknown>, field: string, label: string) {
  const value = config[field];
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${label} "${String(value)}"`);
  }
}

function assertOptionalNumberField(config: Record<string, unknown>, field: string, label: string, rule: NumericValidationRule) {
  const value = config[field];
  if (value === undefined) return;
  assertNumberValue(value, label, rule);
}

function assertNumberValue(value: unknown, label: string, rule: NumericValidationRule) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || !numberMatchesRule(numericValue, rule)) {
    throw new Error(`${label} "${String(value)}"`);
  }
}

function assertAllowedString(value: unknown, allowed: Set<string>, message: string) {
  if (!allowed.has(normalizeConfigString(value))) {
    throw new Error(message);
  }
}

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
    historicalPreload?: HistoricalPreloadConfig;
    mtf?: MtfRuntimeConfig;
    portfolioKillSwitch?: PortfolioKillSwitchConfig;
    postLossLatchMaxMs?: number;
    postLossLatchMinFreshPublications?: number;
    symbolStateRetentionMs?: number;
    userStreamRequestTimeoutMs?: number;
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
        const riskOverrides = requirePlainObject(bot.riskOverrides, `${label} has invalid riskOverrides; expected an object`);
        for (const [key, value] of Object.entries(riskOverrides)) {
          if (!hasOwnConfigRule(RISK_OVERRIDE_RULES, key)) {
            throw new Error(`${label} has invalid riskOverrides field "${key}"`);
          }
          const rule = RISK_OVERRIDE_RULES[key];
          if (rule.type === "boolean") {
            if (typeof value !== "boolean") {
              throw new Error(`${label} has invalid riskOverrides.${key} "${String(value)}"`);
            }
            continue;
          }
          const numericValue = Number(value);
          if (rule.type !== "number" || !Number.isFinite(numericValue) || !numberMatchesRule(numericValue, rule)) {
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

      if (bot.postLossLatchMaxMs !== undefined) {
        assertNumberValue(bot.postLossLatchMaxMs, `${label} has invalid postLossLatchMaxMs`, { min: 1 });
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
    historicalPreload?: HistoricalPreloadConfig | unknown;
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
      const market = requirePlainObject(config.market, "bots.config.json has invalid market; expected an object") as MarketStreamConfig;
      if (market.mode !== undefined && String(market.mode || "").trim().toLowerCase() !== "live") {
        throw new Error(`bots.config.json has unsupported market.mode "${String(market.mode || "")}"; active runtime requires live market data`);
      }
      if (market.provider !== undefined) {
        assertAllowedString(market.provider, VALID_MARKET_PROVIDERS, `bots.config.json has invalid market.provider "${String(market.provider || "")}"`);
      }
      if (market.streamType !== undefined) {
        assertAllowedString(market.streamType, VALID_MARKET_STREAM_TYPES, `bots.config.json has invalid market.streamType "${String(market.streamType || "")}"`);
      }
      if (market.wsBaseUrl !== undefined && String(market.wsBaseUrl || "").trim() === "") {
        throw new Error("bots.config.json has invalid market.wsBaseUrl; expected a non-empty string");
      }
      if (market.klineIntervals !== undefined) {
        if (!Array.isArray(market.klineIntervals) || market.klineIntervals.some((interval) => String(interval || "").trim() === "")) {
          throw new Error("bots.config.json has invalid market.klineIntervals; expected an array of non-empty strings");
        }
      }
      assertOptionalNumberField(market as Record<string, unknown>, "liveEmitIntervalMs", "bots.config.json has invalid market.liveEmitIntervalMs", { minExclusive: 0 });
    }

    this.validateHistoricalPreloadConfig(config.historicalPreload);

    if (config.portfolioKillSwitch !== undefined) {
      const portfolioKillSwitch = requirePlainObject(config.portfolioKillSwitch, "bots.config.json has invalid portfolioKillSwitch; expected an object");
      assertOptionalBooleanField(portfolioKillSwitch, "enabled", "bots.config.json has invalid portfolioKillSwitch.enabled");
      assertOptionalNumberField(portfolioKillSwitch, "maxDrawdownPct", "bots.config.json has invalid portfolioKillSwitch.maxDrawdownPct", { minExclusive: 0 });
      if (portfolioKillSwitch.mode !== undefined && !VALID_PORTFOLIO_KILL_SWITCH_MODES.has(String(portfolioKillSwitch.mode || "").trim())) {
        throw new Error(`bots.config.json has invalid portfolioKillSwitch.mode "${String(portfolioKillSwitch.mode || "")}"`);
      }
    }

    this.validateMtfConfig(config.mtf);

    this.validateRuntimeTuningConfig(config);
  }

  validateHistoricalPreloadConfig(preloadConfig?: HistoricalPreloadConfig | unknown) {
    if (preloadConfig === undefined) return;
    const preload = requirePlainObject(preloadConfig, "bots.config.json has invalid historicalPreload; expected an object") as HistoricalPreloadConfig;
    assertOptionalBooleanField(preload as Record<string, unknown>, "enabled", "bots.config.json has invalid historicalPreload.enabled");
    assertOptionalBooleanField(preload as Record<string, unknown>, "required", "bots.config.json has invalid historicalPreload.required");

    const numericFields = ["horizonMs", "maxHorizonMs", "timeoutMs", "limit"];
    for (const field of numericFields) {
      assertOptionalNumberField(preload as Record<string, unknown>, field, `bots.config.json has invalid historicalPreload.${field}`, { minExclusive: 0 });
    }

    if (preload.priceTimeframe !== undefined) {
      assertAllowedString(preload.priceTimeframe, VALID_MTF_TIMEFRAMES, `bots.config.json has invalid historicalPreload.priceTimeframe "${String(preload.priceTimeframe || "")}"`);
    }

    if (preload.timeframes !== undefined) {
      if (!Array.isArray(preload.timeframes) || preload.timeframes.length <= 0) {
        throw new Error("bots.config.json has invalid historicalPreload.timeframes; expected a non-empty array");
      }
      for (const timeframe of preload.timeframes) {
        assertAllowedString(timeframe, VALID_MTF_TIMEFRAMES, `bots.config.json has invalid historicalPreload.timeframes entry "${String(timeframe || "")}"`);
      }
    }
  }

  validateMtfConfig(mtfConfig?: MtfRuntimeConfig | unknown) {
    if (mtfConfig === undefined) return;
    const mtf = requirePlainObject(mtfConfig, "bots.config.json has invalid mtf; expected an object") as MtfRuntimeConfig;
    assertOptionalBooleanField(mtf as Record<string, unknown>, "enabled", "bots.config.json has invalid mtf.enabled");

    assertOptionalNumberField(mtf as Record<string, unknown>, "instabilityThreshold", "bots.config.json has invalid mtf.instabilityThreshold", { max: 1, min: 0 });

    if (mtf.frames !== undefined) {
      if (!Array.isArray(mtf.frames) || mtf.frames.length <= 0) {
        throw new Error("bots.config.json has invalid mtf.frames; expected a non-empty array");
      }

      const frameIds = new Set<string>();
      for (let index = 0; index < mtf.frames.length; index += 1) {
        const frame = mtf.frames[index] as MtfFrameConfig;
        const label = `bots.config.json mtf.frames[${index}]`;
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
          throw new Error(`${label} is invalid; expected an object`);
        }
        assertAllowedString(frame.id, VALID_MTF_TIMEFRAMES, `${label} has invalid id "${String(frame.id || "")}"`);
        const frameId = normalizeConfigString(frame.id);
        if (frameIds.has(frameId)) {
          throw new Error(`bots.config.json has duplicate mtf.frames id "${frameId}"`);
        }
        frameIds.add(frameId);
        assertAllowedString(frame.horizonFrame, VALID_MTF_HORIZON_FRAMES, `${label} has invalid horizonFrame "${String(frame.horizonFrame || "")}"`);
        assertNumberValue(frame.windowMs, `${label} has invalid windowMs`, { min: 5_000 });
      }
    }
  }

  validateRuntimeTuningConfig(config: RuntimeTuningConfig) {
    const runtimeConfig = config as Record<string, unknown>;
    assertOptionalNumberField(runtimeConfig, "architectWarmupMs", "bots.config.json has invalid architectWarmupMs", { min: 5_000 });
    assertOptionalNumberField(runtimeConfig, "architectPublishIntervalMs", "bots.config.json has invalid architectPublishIntervalMs", { min: 5_000 });
    assertOptionalNumberField(runtimeConfig, "postLossLatchMaxMs", "bots.config.json has invalid postLossLatchMaxMs", { min: 1 });
    assertOptionalNumberField(runtimeConfig, "postLossLatchMinFreshPublications", "bots.config.json has invalid postLossLatchMinFreshPublications", { min: 1 });
    assertOptionalNumberField(runtimeConfig, "symbolStateRetentionMs", "bots.config.json has invalid symbolStateRetentionMs", { min: 60_000 });
    assertOptionalNumberField(runtimeConfig, "userStreamRequestTimeoutMs", "bots.config.json has invalid userStreamRequestTimeoutMs", { min: 1 });
  }
}

module.exports = {
  ConfigLoader,
  VALID_PORTFOLIO_KILL_SWITCH_MODES
};
