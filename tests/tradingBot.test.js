"use strict";

const { TradingBot } = require("../src/bots/tradingBot.ts");
const { ExecutionEngine } = require("../src/engines/executionEngine.ts");
const { PerformanceMonitor } = require("../src/roles/performanceMonitor.ts");
const { RiskManager } = require("../src/roles/riskManager.ts");
const { StrategySwitcher } = require("../src/roles/strategySwitcher.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { UserStream } = require("../src/streams/userStream.ts");

function createPublishedArchitect(overrides = {}) {
  return {
    absoluteConviction: 0.74,
    confidence: 0.71,
    contextMaturity: 0.82,
    dataMode: "live",
    decisionStrength: 0.16,
    familyScores: {
      mean_reversion: 0.68,
      no_trade: 0.22,
      trend_following: 0.31
    },
    featureConflict: 0.14,
    marketRegime: "range",
    reasonCodes: ["reversion_structure"],
    recommendedFamily: "mean_reversion",
    regimeScores: {
      range: 0.68,
      trend: 0.31,
      unclear: 0.12,
      volatile: 0.19
    },
    sampleSize: 180,
    signalAgreement: 0.72,
    structureState: "choppy",
    sufficientData: true,
    summary: "Market context favors range; recommend mean_reversion.",
    symbol: "BTC/USDT",
    trendBias: "neutral",
    updatedAt: Date.now(),
    volatilityState: "normal",
    ...overrides
  };
}

function createHarness(strategyEvaluate, options = {}) {
  const store = new StateStore();
  const config = {
    allowedStrategies: options.allowedStrategies || ["testStrategy"],
    enabled: true,
    id: "bot_test",
    riskProfile: options.riskProfile || "medium",
    strategy: options.strategy || "testStrategy",
    symbol: options.symbol || "BTC/USDT"
  };
  const botLogs = [];

  store.registerBot(config);

  const logger = {
    bot(botConfig, message, metadata) {
      botLogs.push({
        botId: botConfig.id,
        message,
        metadata: metadata || {}
      });
    },
    child() {
      return {
        info() {},
        warn() {},
        error() {}
      };
    }
  };

  const executionEngine = new ExecutionEngine({
    feeRate: 0.001,
    logger: logger.child("execution"),
    store,
    userStream: new UserStream({
      logger: logger.child("user"),
      store,
      wsManager: {
        publish() {},
        subscribe() {
          return () => {};
        }
      }
    })
  });

  const bot = new TradingBot(config, {
    executionEngine,
    indicatorEngine: {
      createSnapshot() {
        return {
          emaBaseline: null,
          emaFast: null,
          emaSlow: null,
          momentum: null,
          rsi: null,
          volatility: null
        };
      }
    },
    logger,
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    performanceMonitor: new PerformanceMonitor(),
    botArchitect: {
      assess() {
        return null;
      }
    },
    regimeDetector: {
      detect() {
        return "trend";
      }
    },
    riskManager: new RiskManager(),
    store,
    strategyRegistry: {
      createStrategy(strategyId) {
        return {
          evaluate: strategyEvaluate,
          id: strategyId
        };
      }
    },
    strategySwitcher: options.strategySwitcher || {
      evaluate() {
        return null;
      },
      getStrategyFamily() {
        return "trend_following";
      }
    }
  });

  if (options.publishedArchitect) {
    store.setArchitectPublishedAssessment(config.symbol, options.publishedArchitect);
  }

  bot.start();

  return {
    bot,
    botLogs,
    config,
    store
  };
}

function runTradingBotTests() {
  const originalNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;

  try {
    const holdHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.9,
      reason: [context.hasOpenPosition ? "exit_signal" : "entry_signal"]
    }));

    holdHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (holdHarness.store.getPosition("bot_test")) {
      throw new Error("position opened before entry debounce was satisfied");
    }

    clock += 1_000;
    holdHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!holdHarness.store.getPosition("bot_test")) {
      throw new Error("position did not open after confirmed entry signal");
    }

    clock += 1_000;
    holdHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!holdHarness.store.getPosition("bot_test")) {
      throw new Error("position closed before minimum hold time elapsed");
    }

    clock += 16_000;
    holdHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (holdHarness.store.getPosition("bot_test")) {
      throw new Error("position did not close after minimum hold and confirmed exit signal");
    }
    if (holdHarness.store.getClosedTrades("bot_test").length !== 1) {
      throw new Error("closed trade was not recorded after guarded exit");
    }

    clock += 10_000;
    const cooldownHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }));
    cooldownHarness.store.updateBotState("bot_test", {
      cooldownReason: "loss_cooldown",
      cooldownUntil: clock + 60_000
    });

    cooldownHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    cooldownHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    cooldownHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 61_000;
    cooldownHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock });

    const cooldownMessages = cooldownHarness.botLogs.map((entry) => entry.message);
    const startedCount = cooldownMessages.filter((message) => message === "cooldown_started").length;
    const endedCount = cooldownMessages.filter((message) => message === "cooldown_ended").length;
    const blockedCount = cooldownHarness.botLogs.filter((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "cooldown_active").length;

    if (startedCount !== 1) {
      throw new Error(`expected one cooldown_started log, found ${startedCount}`);
    }
    if (blockedCount !== 1) {
      throw new Error(`expected one cooldown entry_blocked log, found ${blockedCount}`);
    }
    if (endedCount !== 1) {
      throw new Error(`expected one cooldown_ended log, found ${endedCount}`);
    }

    clock += 10_000;
    const realignHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["no_trade"]
    }), {
      allowedStrategies: ["emaCross", "rsiReversion"],
      publishedArchitect: createPublishedArchitect(),
      strategy: "emaCross",
      strategySwitcher: new StrategySwitcher({
        minAgreement: 0.52,
        minConviction: 0.42,
        minDecisionStrength: 0.08
      })
    });

    realignHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const switchedState = realignHarness.store.getBotState("bot_test");
    if (switchedState.activeStrategyId !== "rsiReversion") {
      throw new Error(`flat bot did not realign to published architect family: ${switchedState.activeStrategyId}`);
    }
    if (switchedState.architectSyncStatus !== "synced") {
      throw new Error(`flat bot sync status invalid after realignment: ${switchedState.architectSyncStatus}`);
    }

    clock += 10_000;
    const waitingHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["position_managed"]
    }), {
      allowedStrategies: ["emaCross", "rsiReversion"],
      publishedArchitect: createPublishedArchitect(),
      strategy: "emaCross",
      strategySwitcher: new StrategySwitcher()
    });
    waitingHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.8,
      entryPrice: 101,
      id: "pos-1",
      notes: ["entry"],
      openedAt: clock - 5_000,
      quantity: 0.5,
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    });

    waitingHarness.bot.onMarketTick({ price: 102, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const waitingState = waitingHarness.store.getBotState("bot_test");
    if (waitingState.activeStrategyId !== "emaCross") {
      throw new Error("in-position bot switched strategy immediately instead of waiting flat");
    }
    if (waitingState.architectSyncStatus !== "waiting_flat") {
      throw new Error(`expected waiting_flat sync status, received ${waitingState.architectSyncStatus}`);
    }
  } finally {
    Date.now = originalNow;
  }
}

module.exports = {
  runTradingBotTests
};
