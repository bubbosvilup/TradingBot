"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ConfigLoader } = require("../src/core/configLoader.ts");
const {
  DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG,
  DEFAULT_RUNTIME_TIMING_CONFIG,
  DEFAULT_RUNTIME_MODES,
  parsePortfolioKillSwitchConfig,
  parseRuntimeTimingConfig,
  parseRuntimeModeConfig
} = require("../src/types/configSchema.ts");

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
    if (String(error && error.message).startsWith("expected config load to fail with ")) {
      throw error;
    }
    if (!String(error && error.message).includes(expectedMessagePart)) {
      throw new Error(`unexpected config validation error: ${error && error.stack ? error.stack : error}`);
    }
  } finally {
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
}

function expectStructuredConfigError(config, expectedMessagePart, expectedCode) {
  const rootDir = createTempConfigRoot(config);
  try {
    new ConfigLoader(rootDir).loadBotsConfig();
    throw new Error(`expected config load to fail with ${expectedMessagePart}`);
  } catch (error) {
    if (String(error && error.message).startsWith("expected config load to fail with ")) {
      throw error;
    }
    if (!String(error && error.message).includes(expectedMessagePart)) {
      throw new Error(`unexpected config validation error: ${error && error.stack ? error.stack : error}`);
    }
    if (error.kind !== "config" || error.code !== expectedCode || error.recoverable !== false) {
      throw new Error(`config validation should throw structured ConfigError: ${JSON.stringify({
        code: error.code,
        kind: error.kind,
        recoverable: error.recoverable
      })}`);
    }
    if (!error.context || error.context.configPath !== "bots.config.json") {
      throw new Error(`ConfigError should include config path context: ${JSON.stringify(error.context)}`);
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

  expectStructuredConfigError({
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
  }, "unsupported executionMode \"live\"", "unsupported_execution_mode");

  expectStructuredConfigError({
    executionMode: "simulated",
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_execution_mode",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid executionMode \"simulated\"", "invalid_execution_mode");

  expectStructuredConfigError({
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
  }, "unsupported marketMode", "unsupported_market_mode");

  {
    const parsedDefaults = parseRuntimeModeConfig({});
    if (DEFAULT_RUNTIME_MODES.executionMode !== "paper" || DEFAULT_RUNTIME_MODES.marketMode !== "live") {
      throw new Error(`runtime mode schema defaults should stay explicit and compatible: ${JSON.stringify(DEFAULT_RUNTIME_MODES)}`);
    }
    if (parsedDefaults.executionMode !== "paper" || parsedDefaults.marketMode !== "live") {
      throw new Error(`runtime mode schema should parse omitted modes to previous runtime defaults: ${JSON.stringify(parsedDefaults)}`);
    }

    const parsedConfiguredModes = parseRuntimeModeConfig({
      executionMode: " PAPER ",
      marketMode: " LIVE "
    });
    if (parsedConfiguredModes.executionMode !== "paper" || parsedConfiguredModes.marketMode !== "live") {
      throw new Error(`runtime mode schema should normalize configured modes without changing semantics: ${JSON.stringify(parsedConfiguredModes)}`);
    }
  }

  {
    const noKillSwitchRootDir = createTempConfigRoot({
      bots: [
        {
          allowedStrategies: ["emaCross"],
          enabled: true,
          id: "bot_no_kill_switch",
          riskProfile: "medium",
          strategy: "emaCross",
          symbol: "BTC/USDT"
        }
      ]
    });
    try {
      const loaded = new ConfigLoader(noKillSwitchRootDir).loadBotsConfig();
      if (loaded.portfolioKillSwitch !== undefined) {
        throw new Error(`missing portfolioKillSwitch should preserve config shape: ${JSON.stringify(loaded.portfolioKillSwitch)}`);
      }
    } finally {
      fs.rmSync(noKillSwitchRootDir, { force: true, recursive: true });
    }

    const parsedMissingKillSwitch = parsePortfolioKillSwitchConfig(undefined);
    if (DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG.enabled !== false
      || DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG.maxDrawdownPct !== 0
      || DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG.mode !== "block_entries_only") {
      throw new Error(`portfolio kill-switch schema defaults should stay explicit and compatible: ${JSON.stringify(DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG)}`);
    }
    if (parsedMissingKillSwitch.enabled !== false
      || parsedMissingKillSwitch.maxDrawdownPct !== 0
      || parsedMissingKillSwitch.mode !== "block_entries_only") {
      throw new Error(`portfolio kill-switch schema should parse omitted config to current defaults: ${JSON.stringify(parsedMissingKillSwitch)}`);
    }

    const parsedValidKillSwitch = parsePortfolioKillSwitchConfig({
      enabled: true,
      maxDrawdownPct: 8,
      mode: "block_entries_only"
    });
    if (parsedValidKillSwitch.enabled !== true
      || parsedValidKillSwitch.maxDrawdownPct !== 8
      || parsedValidKillSwitch.mode !== "block_entries_only") {
      throw new Error(`portfolio kill-switch schema should preserve valid configured values: ${JSON.stringify(parsedValidKillSwitch)}`);
    }
  }

  expectStructuredConfigError({
    portfolioKillSwitch: {
      enabled: "yes",
      maxDrawdownPct: 8,
      mode: "block_entries_only"
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_kill_switch_enabled",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid portfolioKillSwitch.enabled", "invalid_portfolio_kill_switch_enabled");

  expectStructuredConfigError({
    portfolioKillSwitch: {
      enabled: true,
      maxDrawdownPct: 0,
      mode: "block_entries_only"
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_kill_switch_drawdown",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid portfolioKillSwitch.maxDrawdownPct", "invalid_portfolio_kill_switch_max_drawdown");

  expectStructuredConfigError({
    portfolioKillSwitch: {
      enabled: true,
      maxDrawdownPct: 8,
      mode: "panic_liquidate"
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_kill_switch_mode",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid portfolioKillSwitch.mode", "invalid_portfolio_kill_switch_mode");

  {
    const noRuntimeTimingRootDir = createTempConfigRoot({
      bots: [
        {
          allowedStrategies: ["emaCross"],
          enabled: true,
          id: "bot_no_runtime_timing",
          riskProfile: "medium",
          strategy: "emaCross",
          symbol: "BTC/USDT"
        }
      ]
    });
    try {
      const loaded = new ConfigLoader(noRuntimeTimingRootDir).loadBotsConfig();
      if (loaded.architectWarmupMs !== undefined
        || loaded.architectPublishIntervalMs !== undefined
        || loaded.postLossLatchMaxMs !== undefined
        || loaded.postLossLatchMinFreshPublications !== undefined
        || loaded.symbolStateRetentionMs !== undefined
        || loaded.userStreamRequestTimeoutMs !== undefined) {
        throw new Error(`missing runtime timing values should preserve config shape: ${JSON.stringify(loaded)}`);
      }
    } finally {
      fs.rmSync(noRuntimeTimingRootDir, { force: true, recursive: true });
    }

    const parsedMissingTiming = parseRuntimeTimingConfig({});
    if (DEFAULT_RUNTIME_TIMING_CONFIG.architectWarmupMs !== 30_000
      || DEFAULT_RUNTIME_TIMING_CONFIG.architectPublishIntervalMs !== 30_000
      || DEFAULT_RUNTIME_TIMING_CONFIG.postLossLatchMaxMs !== null
      || DEFAULT_RUNTIME_TIMING_CONFIG.postLossLatchMinFreshPublications !== 2
      || DEFAULT_RUNTIME_TIMING_CONFIG.symbolStateRetentionMs !== 30 * 60 * 1000
      || DEFAULT_RUNTIME_TIMING_CONFIG.userStreamRequestTimeoutMs !== 10_000) {
      throw new Error(`runtime timing schema defaults should stay explicit and compatible: ${JSON.stringify(DEFAULT_RUNTIME_TIMING_CONFIG)}`);
    }
    if (parsedMissingTiming.architectWarmupMs !== 30_000
      || parsedMissingTiming.architectPublishIntervalMs !== 30_000
      || parsedMissingTiming.postLossLatchMaxMs !== null
      || parsedMissingTiming.postLossLatchMinFreshPublications !== 2
      || parsedMissingTiming.symbolStateRetentionMs !== 30 * 60 * 1000
      || parsedMissingTiming.userStreamRequestTimeoutMs !== 10_000) {
      throw new Error(`runtime timing schema should parse omitted config to current runtime defaults: ${JSON.stringify(parsedMissingTiming)}`);
    }

    const parsedValidTiming = parseRuntimeTimingConfig({
      architectPublishIntervalMs: 15_000,
      architectWarmupMs: 20_000,
      postLossLatchMaxMs: 120_000,
      postLossLatchMinFreshPublications: 1,
      symbolStateRetentionMs: 1_800_000,
      userStreamRequestTimeoutMs: 5_000
    });
    if (parsedValidTiming.architectPublishIntervalMs !== 15_000
      || parsedValidTiming.architectWarmupMs !== 20_000
      || parsedValidTiming.postLossLatchMaxMs !== 120_000
      || parsedValidTiming.postLossLatchMinFreshPublications !== 1
      || parsedValidTiming.symbolStateRetentionMs !== 1_800_000
      || parsedValidTiming.userStreamRequestTimeoutMs !== 5_000) {
      throw new Error(`runtime timing schema should preserve valid configured values: ${JSON.stringify(parsedValidTiming)}`);
    }
  }

  for (const testCase of [
    {
      code: "invalid_architect_warmup_ms",
      config: { architectWarmupMs: 4_999 },
      message: "invalid architectWarmupMs"
    },
    {
      code: "invalid_architect_publish_interval_ms",
      config: { architectPublishIntervalMs: 0 },
      message: "invalid architectPublishIntervalMs"
    },
    {
      code: "invalid_post_loss_latch_max_ms",
      config: { postLossLatchMaxMs: -1 },
      message: "invalid postLossLatchMaxMs"
    },
    {
      code: "invalid_post_loss_latch_min_fresh_publications",
      config: { postLossLatchMinFreshPublications: 0 },
      message: "invalid postLossLatchMinFreshPublications"
    },
    {
      code: "invalid_symbol_state_retention_ms",
      config: { symbolStateRetentionMs: 59_999 },
      message: "invalid symbolStateRetentionMs"
    },
    {
      code: "invalid_user_stream_request_timeout_ms",
      config: { userStreamRequestTimeoutMs: Number.NaN },
      message: "invalid userStreamRequestTimeoutMs"
    }
  ]) {
    expectStructuredConfigError({
      ...testCase.config,
      bots: [
        {
          allowedStrategies: ["emaCross"],
          enabled: true,
          id: `bot_${testCase.code}`,
          riskProfile: "medium",
          strategy: "emaCross",
          symbol: "BTC/USDT"
        }
      ]
    }, testCase.message, testCase.code);
  }

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
    mtf: {
      enabled: true,
      frames: [
        { id: "1m", horizonFrame: "short", windowMs: 60_000 },
        { id: "1m", horizonFrame: "medium", windowMs: 900_000 }
      ]
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_duplicate_mtf_frame",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "duplicate mtf.frames id");

  expectConfigError({
    mtf: {
      enabled: true,
      frames: [
        { id: "1m", horizonFrame: "short", windowMs: 0 }
      ]
    },
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_invalid_mtf_window",
        riskProfile: "medium",
        strategy: "emaCross",
        symbol: "BTC/USDT"
      }
    ]
  }, "invalid windowMs");

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

  expectConfigError({
    bots: [
      {
        allowedStrategies: ["emaCross"],
        enabled: true,
        id: "bot_missing_base_strategy",
        riskProfile: "medium",
        strategy: "rsiReversion",
        symbol: "BTC/USDT"
      }
    ]
  }, "bot \"bot_missing_base_strategy\" base strategy \"rsiReversion\" must be included in allowedStrategies");

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
