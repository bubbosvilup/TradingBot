"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConfigLoader } = require("../src/core/configLoader.ts");

function createTempConfigRoot(botsConfig) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradingbot-configloader-"));
  const dataDir = path.join(rootDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "bots.config.json"), JSON.stringify(botsConfig, null, 2));
  fs.writeFileSync(path.join(dataDir, "strategies.config.json"), JSON.stringify({
    strategies: [
      { id: "emaCross", family: "trend_following", module: "./strategies/emaCross/strategy.ts", config: "./strategies/emaCross/config.json" },
      { id: "rsiReversion", family: "mean_reversion", module: "./strategies/rsiReversion/strategy.ts", config: "./strategies/rsiReversion/config.json" },
      { id: "breakout", family: "trend_following", module: "./strategies/breakout/strategy.ts", config: "./strategies/breakout/config.json" }
    ]
  }, null, 2));
  return rootDir;
}

function expectConfigError(config, expectedMessagePart) {
  const rootDir = createTempConfigRoot(config);
  try {
    new ConfigLoader(rootDir).loadBotsConfig();
    throw new Error(`expected config load to fail with ${expectedMessagePart}`);
  } catch (error) {
    if (!String(error && error.message).includes(expectedMessagePart)) {
      throw new Error(`unexpected config validation error: ${error && error.stack ? error.stack : error}`);
    }
  } finally {
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
}

function runConfigLoaderTests() {
  const validRootDir = createTempConfigRoot({
    bots: [
      {
        allowedStrategies: ["emaCross", "rsiReversion"],
        enabled: true,
        id: "bot_a",
        riskOverrides: {
          meaningfulWinUsdt: 0.1,
          volatilitySizingEnabled: true,
          volatilitySizingMinPenalty: 0.5,
          volatilitySizingMultiplier: 1,
          winReentryCooldownMs: 5_000
        },
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ],
    executionMode: "paper",
    marketMode: "live",
    market: {
      klineIntervals: ["1m", "5m"],
      liveEmitIntervalMs: 1000,
      provider: "binance",
      streamType: "trade",
      wsBaseUrl: "wss://stream.binance.com:9443"
    },
    historicalPreload: {
      enabled: true,
      required: false,
      horizonMs: 3_600_000,
      maxHorizonMs: 14_400_000,
      timeoutMs: 15_000,
      priceTimeframe: "1m",
      timeframes: ["1m", "5m"],
      limit: 600
    },
    mtf: {
      enabled: true,
      instabilityThreshold: 0.5,
      frames: [
        { id: "1m", horizonFrame: "short", windowMs: 60_000 },
        { id: "15m", horizonFrame: "medium", windowMs: 900_000 },
        { id: "1h", horizonFrame: "long", windowMs: 3_600_000 }
      ]
    }
  });

  try {
    const loaded = new ConfigLoader(validRootDir).loadBotsConfig();
    if (!Array.isArray(loaded.bots) || loaded.bots.length !== 1 || loaded.bots[0].strategy !== "emaCross") {
      throw new Error(`valid config should still load normally: ${JSON.stringify(loaded)}`);
    }
    if (loaded.bots[0].riskOverrides?.volatilitySizingEnabled !== true || loaded.bots[0].riskOverrides?.volatilitySizingMinPenalty !== 0.5 || loaded.bots[0].riskOverrides?.winReentryCooldownMs !== 5_000) {
      throw new Error(`valid risk override extensions should load normally: ${JSON.stringify(loaded.bots[0].riskOverrides)}`);
    }
    if (loaded.mtf?.enabled !== true || loaded.mtf?.frames?.[2]?.horizonFrame !== "long") {
      throw new Error(`valid MTF config should load normally: ${JSON.stringify(loaded.mtf)}`);
    }
    if (loaded.historicalPreload?.enabled !== true || loaded.historicalPreload?.priceTimeframe !== "1m") {
      throw new Error(`valid historical preload config should load normally: ${JSON.stringify(loaded.historicalPreload)}`);
    }
  } finally {
    fs.rmSync(validRootDir, { force: true, recursive: true });
  }

  expectConfigError({
    executionMode: "live",
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_execution",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "unsupported executionMode \"live\"");

  expectConfigError({
    marketMode: "mock",
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_market_mode",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "unsupported marketMode");

  expectConfigError({
    market: "binance",
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_market_shape",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid market; expected an object");

  expectConfigError({
    market: {
      provider: "kraken"
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_market_provider",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid market.provider");

  expectConfigError({
    historicalPreload: {
      enabled: "yes"
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_preload_enabled",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid historicalPreload.enabled");

  expectConfigError({
    historicalPreload: {
      enabled: true,
      timeframes: ["2m"]
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_preload_timeframe",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid historicalPreload.timeframes entry");

  expectConfigError({
    mtf: {
      enabled: "true"
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_mtf_enabled",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid mtf.enabled");

  expectConfigError({
    mtf: {
      enabled: true,
      frames: [
        { id: "1m", horizonFrame: "intraday", windowMs: 60_000 }
      ]
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_mtf_frame",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid horizonFrame");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_strategy",
        riskProfile: "medium",
        strategy: "does_not_exist",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid strategy");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_risk",
        riskProfile: "extreme",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid riskProfile");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_risk_override",
        riskOverrides: {
          positionPct: 0
        },
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid riskOverrides.positionPct");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_volatility_sizing",
        riskOverrides: {
          volatilitySizingEnabled: "yes"
        },
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid riskOverrides.volatilitySizingEnabled");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_volatility_sizing_floor",
        riskOverrides: {
          volatilitySizingMinPenalty: 1.2
        },
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid riskOverrides.volatilitySizingMinPenalty");

  {
    const invalidVolatilityMultiplierRootDir = createTempConfigRoot({
      bots: [
        {
          allowedStrategies: ["emaCross"],
          enabled: true,
          id: "bot_invalid_volatility_sizing_multiplier",
          riskOverrides: {
            volatilitySizingMultiplier: 2
          },
          riskProfile: "medium",
          strategy: "emaCross",
          symbol: "BTC/USDT"
        }
      ]
    });
    try {
      new ConfigLoader(invalidVolatilityMultiplierRootDir).loadBotsConfig();
      throw new Error("expected config load to fail with invalid riskOverrides.volatilitySizingMultiplier");
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (message === "expected config load to fail with invalid riskOverrides.volatilitySizingMultiplier") {
        throw error;
      }
      if (!message.includes("invalid riskOverrides.volatilitySizingMultiplier")) {
        throw new Error(`unexpected config validation error: ${error && error.stack ? error.stack : error}`);
      }
    } finally {
      fs.rmSync(invalidVolatilityMultiplierRootDir, { force: true, recursive: true });
    }
  }

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_win_cooldown",
        riskOverrides: {
          winReentryCooldownMs: 0
        },
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid riskOverrides.winReentryCooldownMs");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_meaningful_win",
        riskOverrides: {
          meaningfulWinUsdt: -0.01
        },
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid riskOverrides.meaningfulWinUsdt");

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross", "unknown_strategy"],
        enabled: true,
        id: "bot_invalid_allowed",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid allowedStrategies entry");

  const uniqueSymbolsRootDir = createTempConfigRoot({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_unique_a",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      },
      {
        allowedStrategies: ["rsiReversion"],
        enabled: true,
        id: "bot_unique_b",
        riskProfile: "medium",
        strategy: "rsiReversion",
        symbol: "ETH/USDT"
      }
    ]
  });

  try {
    const loadedUniqueSymbols = new ConfigLoader(uniqueSymbolsRootDir).loadBotsConfig();
    if (!Array.isArray(loadedUniqueSymbols.bots) || loadedUniqueSymbols.bots.length !== 2) {
      throw new Error(`unique enabled bot symbols should still load normally: ${JSON.stringify(loadedUniqueSymbols)}`);
    }
  } finally {
    fs.rmSync(uniqueSymbolsRootDir, { force: true, recursive: true });
  }

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_dup_a",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      },
      {
        allowedStrategies: ["rsiReversion"],
        enabled: true,
        id: "bot_dup_b",
        riskProfile: "medium",
        strategy: "rsiReversion",
        symbol: "BTC/USDT"
      }
    ]
  }, "duplicate enabled bot symbols");

  const disabledDuplicateRootDir = createTempConfigRoot({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_enabled",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      },
      {
        allowedStrategies: ["rsiReversion"],
        enabled: false,
        id: "bot_disabled_duplicate",
        riskProfile: "medium",
        strategy: "rsiReversion",
        symbol: "BTC/USDT"
      }
    ]
  });

  try {
    const loadedDisabledDuplicate = new ConfigLoader(disabledDuplicateRootDir).loadBotsConfig();
    if (!Array.isArray(loadedDisabledDuplicate.bots) || loadedDisabledDuplicate.bots.length !== 2) {
      throw new Error(`disabled bots should not count toward duplicate symbol conflicts: ${JSON.stringify(loadedDisabledDuplicate)}`);
    }
  } finally {
    fs.rmSync(disabledDuplicateRootDir, { force: true, recursive: true });
  }
}

module.exports = {
  runConfigLoaderTests
};
