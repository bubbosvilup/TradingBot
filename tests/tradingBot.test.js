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

function createTrendArchitect(overrides = {}) {
  return createPublishedArchitect({
    familyScores: {
      mean_reversion: 0.24,
      no_trade: 0.16,
      trend_following: 0.71
    },
    marketRegime: "trend",
    reasonCodes: ["trend_structure"],
    recommendedFamily: "trend_following",
    regimeScores: {
      range: 0.24,
      trend: 0.71,
      unclear: 0.12,
      volatile: 0.16
    },
    structureState: "trending",
    summary: "Market context favors trend; recommend trend_following.",
    trendBias: "bullish",
    ...overrides
  });
}

function createHarness(strategyEvaluate, options = {}) {
  const store = new StateStore();
  const config = {
    allowedStrategies: options.allowedStrategies || ["testStrategy"],
    enabled: true,
    id: "bot_test",
    initialBalanceUsdt: options.initialBalanceUsdt ?? 1000,
    riskProfile: options.riskProfile || "medium",
    strategy: options.strategy || "testStrategy",
    symbol: options.symbol || "BTC/USDT"
  };
  const botLogs = [];
  const indicatorSnapshot = options.indicatorSnapshot || {
    emaBaseline: 99,
    emaFast: 101,
    emaSlow: 100,
    momentum: 1.4,
    rsi: 55,
    volatility: 1.2
  };

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
        return indicatorSnapshot;
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
      getStrategyFamily(strategyId) {
        if (strategyId === "testStrategy") return "trend_following";
        if (strategyId === "emaCross") return "trend_following";
        if (strategyId === "rsiReversion") return "mean_reversion";
        return "other";
      }
    }
  });

  store.setArchitectPublishedAssessment(config.symbol, options.publishedArchitect || createTrendArchitect({
    symbol: config.symbol,
    updatedAt: Date.now()
  }));
  store.setArchitectPublisherState(config.symbol, {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: Date.now(),
    lastPublishedAt: Date.now(),
    lastPublishedRegime: (options.publishedArchitect || createTrendArchitect()).marketRegime,
    nextPublishAt: Date.now() + 30_000,
    publishIntervalMs: 30_000,
    ready: true,
    symbol: config.symbol,
    warmupStartedAt: Date.now() - 60_000,
    ...(options.publisherState || {})
  });
  store.setContextSnapshot(config.symbol, options.contextSnapshot || {
    dataMode: "live",
    features: {
      breakoutDirection: "up",
      breakoutInstability: 0.08,
      breakoutQuality: 0.64,
      chopiness: 0.22,
      dataQuality: 0.92,
      directionalEfficiency: 0.74,
      emaBias: 0.4,
      emaSeparation: 0.66,
      featureConflict: 0.1,
      maturity: 0.82,
      netMoveRatio: 0.018,
      reversionStretch: 0.2,
      rsiIntensity: 0.24,
      slopeConsistency: 0.7,
      volatilityRisk: 0.18
    },
    observedAt: Date.now(),
    sampleSize: 120,
    structureState: "trending",
    summary: "Context ready.",
    symbol: config.symbol,
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete: true,
    windowSpanMs: 240_000,
    windowStartedAt: Date.now() - 240_000
  });

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
    const debounceEvaluation = holdHarness.botLogs.find((entry) => entry.message === "entry_evaluated" && entry.metadata.skipReason === "debounce_not_satisfied");
    if (!debounceEvaluation) {
      throw new Error("missing structured entry evaluation log for debounce_not_satisfied");
    }
    if (debounceEvaluation.metadata.architectSourceUsed !== "published" || debounceEvaluation.metadata.architectUpdatedAt !== 1_000_000) {
      throw new Error("debounce evaluation log missing published architect snapshot details");
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
    if (!realignHarness.botLogs.find((entry) => entry.message === "entry_evaluated" && entry.metadata.skipReason === "no_entry_signal")) {
      throw new Error("missing structured entry evaluation log for no_entry_signal");
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

    clock += 10_000;
    const noTradeHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        marketRegime: "volatile",
        recommendedFamily: "no_trade",
        updatedAt: clock
      })
    });
    noTradeHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    noTradeHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (noTradeHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position under architect no_trade");
    }
    if (!noTradeHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "architect_not_usable_for_entry" && entry.metadata.architectBlockReason === "architect_no_trade")) {
      throw new Error("missing architect_not_usable_for_entry log for architect_no_trade");
    }
    if (noTradeHarness.store.getBotState("bot_test").lastDecision === "buy") {
      throw new Error("flat bot should not keep a buy decision when architect state is no_trade");
    }
    if (noTradeHarness.store.getBotState("bot_test").architectSyncStatus !== "pending") {
      throw new Error("no_trade architect state should keep bot sync status pending");
    }

    clock += 10_000;
    const unclearHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        marketRegime: "unclear",
        recommendedFamily: "no_trade",
        updatedAt: clock
      })
    });
    unclearHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    unclearHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (unclearHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position under architect unclear");
    }
    if (!unclearHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "architect_not_usable_for_entry" && entry.metadata.architectBlockReason === "architect_unclear")) {
      throw new Error("missing architect_not_usable_for_entry log for architect_unclear");
    }
    if (unclearHarness.store.getBotState("bot_test").lastDecision === "buy") {
      throw new Error("flat bot should not keep a buy decision when architect state is unclear");
    }
    if (unclearHarness.store.getBotState("bot_test").architectSyncStatus !== "pending") {
      throw new Error("unclear architect state should keep bot sync status pending");
    }

    clock += 10_000;
    const immatureHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        contextMaturity: 0.2,
        updatedAt: clock
      })
    });
    immatureHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    immatureHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (immatureHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position with architect maturity below threshold");
    }
    if (!immatureHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "architect_not_usable_for_entry" && entry.metadata.architectBlockReason === "architect_low_maturity")) {
      throw new Error("missing architect_not_usable_for_entry log for architect_low_maturity");
    }
    if (immatureHarness.store.getBotState("bot_test").lastDecision === "buy") {
      throw new Error("flat bot should not keep a buy decision when architect state is low maturity");
    }
    if (immatureHarness.store.getBotState("bot_test").architectSyncStatus !== "pending") {
      throw new Error("low-maturity architect state should keep bot sync status pending");
    }

    clock += 10_000;
    const staleHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      allowedStrategies: ["emaCross", "rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock - 180_000
      }),
      strategy: "emaCross"
    });
    staleHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (staleHarness.store.getBotState("bot_test").activeStrategyId !== "emaCross") {
      throw new Error("stale architect state should not trigger flat strategy realignment");
    }
    if (staleHarness.store.getBotState("bot_test").architectSyncStatus !== "pending") {
      throw new Error("stale architect state should keep sync status pending");
    }
    clock += 1_000;
    staleHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (staleHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position with stale architect state");
    }
    if (!staleHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "architect_not_usable_for_entry" && entry.metadata.architectBlockReason === "architect_stale")) {
      throw new Error("missing architect_not_usable_for_entry log for architect_stale");
    }
    if (staleHarness.store.getBotState("bot_test").lastDecision === "buy") {
      throw new Error("flat bot should not keep a buy decision when architect state is stale");
    }

    clock += 10_000;
    const mismatchHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        symbol: "ETH/USDT",
        updatedAt: clock
      })
    });
    mismatchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (mismatchHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position with architect symbol mismatch");
    }
    if (!mismatchHarness.botLogs.find((entry) => entry.message === "entry_evaluated" && entry.metadata.blockReason === "architect_symbol_mismatch" && entry.metadata.architectSymbolMatch === false)) {
      throw new Error("missing structured entry evaluation log for architect_symbol_mismatch");
    }

    clock += 10_000;
    const edgeHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      indicatorSnapshot: {
        emaBaseline: 100,
        emaFast: 100.02,
        emaSlow: 100,
        momentum: 0.02,
        rsi: 55,
        volatility: 0.01
      },
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      })
    });
    edgeHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    edgeHarness.bot.onMarketTick({ price: 100.01, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (edgeHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position with insufficient edge after costs");
    }
    if (!edgeHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "insufficient_edge_after_costs")) {
      throw new Error("missing insufficient_edge_after_costs block log");
    }

    clock += 10_000;
    const lowNotionalHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      initialBalanceUsdt: 20,
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    lowNotionalHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    lowNotionalHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (lowNotionalHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position below minimum notional");
    }
    if (!lowNotionalHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "notional_below_minimum")) {
      throw new Error("missing notional_below_minimum block log");
    }

    clock += 10_000;
    const lowQuantityHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    lowQuantityHarness.bot.onMarketTick({ price: 500000000, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    lowQuantityHarness.bot.onMarketTick({ price: 500000001, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (lowQuantityHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position below minimum quantity");
    }
    if (!lowQuantityHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "quantity_below_minimum")) {
      throw new Error("missing quantity_below_minimum block log");
    }

    clock += 10_000;
    const allowedHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      })
    });
    allowedHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    allowedHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!allowedHarness.store.getPosition("bot_test")) {
      throw new Error("bot did not open when architect and economics gates passed");
    }
    if (!allowedHarness.botLogs.find((entry) => entry.message === "entry_gate_allowed")) {
      throw new Error("missing entry_gate_allowed log on valid entry");
    }
    const openedEvaluation = allowedHarness.botLogs.find((entry) => entry.message === "entry_evaluated" && entry.metadata.outcome === "opened" && entry.metadata.allowReason === "entry_opened");
    if (!openedEvaluation) {
      throw new Error("missing structured entry evaluation log for opened entry");
    }
    if (openedEvaluation.metadata.publisherLastPublishedAt !== clock - 1_000 || openedEvaluation.metadata.tickTimestamp !== clock) {
      throw new Error("opened entry evaluation log missing publisher/tick timing");
    }
  } finally {
    Date.now = originalNow;
  }
}

module.exports = {
  runTradingBotTests
};
