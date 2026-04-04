"use strict";

const { TradingBot } = require("../src/bots/tradingBot.ts");
const { ExecutionEngine } = require("../src/engines/executionEngine.ts");
const { PerformanceMonitor } = require("../src/roles/performanceMonitor.ts");
const { RiskManager } = require("../src/roles/riskManager.ts");
const { StrategySwitcher } = require("../src/roles/strategySwitcher.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { UserStream } = require("../src/streams/userStream.ts");
const { createStrategy: createBreakoutStrategy } = require("../src/strategies/breakout/strategy.ts");
const { createStrategy: createEmaCrossStrategy } = require("../src/strategies/emaCross/strategy.ts");
const { createStrategy: createRsiReversionStrategy } = require("../src/strategies/rsiReversion/strategy.ts");

function resolveTestStrategyFamily(strategyId) {
  if (strategyId === "testStrategy") return "trend_following";
  if (strategyId === "emaCross") return "trend_following";
  if (strategyId === "rsiReversion") return "mean_reversion";
  if (strategyId === "breakout") return "trend_following";
  return "other";
}

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

function createStrategyWithEconomics(strategyId, strategyEvaluate, options = {}) {
  const strategyConfig = options.strategyConfigById?.[strategyId];
  const strategyFactory = strategyId === "emaCross"
    ? createEmaCrossStrategy
    : strategyId === "rsiReversion"
      ? createRsiReversionStrategy
      : strategyId === "breakout"
        ? createBreakoutStrategy
        : null;
  const baseStrategy = strategyFactory ? strategyFactory(strategyConfig) : null;
  return {
    ...(baseStrategy || {}),
    config: strategyConfig === undefined
      ? baseStrategy?.config
      : {
        ...(baseStrategy?.config || {}),
        ...strategyConfig
      },
    evaluate: strategyEvaluate,
    id: strategyId
  };
}

function createHarness(strategyEvaluate, options = {}) {
  const store = options.store || new StateStore();
  const config = {
    allowedStrategies: options.allowedStrategies || ["testStrategy"],
    enabled: true,
    id: "bot_test",
    initialBalanceUsdt: options.initialBalanceUsdt ?? 1000,
    maxArchitectStateAgeMs: options.maxArchitectStateAgeMs,
    postLossArchitectLatchPublishesRequired: options.postLossArchitectLatchPublishesRequired,
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
        return createStrategyWithEconomics(strategyId, strategyEvaluate, options);
      }
    },
    strategySwitcher: options.strategySwitcher || {
      evaluate() {
        return null;
      },
      getStrategyFamily(strategyId) {
        return resolveTestStrategyFamily(strategyId);
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
      contextRsi: 62,
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
    effectiveSampleSize: 120,
    effectiveWarmupComplete: true,
    effectiveWindowSpanMs: 240_000,
    effectiveWindowStartedAt: Date.now() - 240_000,
    lastPublishedRegimeSwitchAt: null,
    lastPublishedRegimeSwitchFrom: null,
    lastPublishedRegimeSwitchTo: null,
    postSwitchCoveragePct: null,
    rollingMaturity: 0.82,
    rollingSampleSize: 120,
    sampleSize: 120,
    structureState: "trending",
    summary: "Context ready.",
    symbol: config.symbol,
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete: true,
    windowMode: "rolling_full",
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

function assertClose(actual, expected, message, tolerance = 1e-9) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function createPosition(overrides = {}) {
  return {
    botId: "bot_test",
    confidence: 0.8,
    entryPrice: 100,
    id: "pos-test",
    lifecycleMode: "normal",
    managedRecoveryDeferredReason: null,
    managedRecoveryExitFloorNetPnlUsdt: null,
    managedRecoveryStartedAt: null,
    notes: ["test_position"],
    openedAt: 0,
    quantity: 0.5,
    strategyId: "emaCross",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function runTradingBotTests() {
  const originalNow = Date.now;
  const originalLogType = process.env.LOG_TYPE;
  let clock = 1_000_000;
  Date.now = () => clock;

  try {
    const normalExitHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.5,
      reason: ["neutral_signal"]
    }), {
      strategy: "emaCross"
    });
    const normalProfile = normalExitHarness.bot.deps.riskManager.getProfile(normalExitHarness.config.riskProfile);
    const protectivePlan = normalExitHarness.bot.shouldExitPosition({
      decision: {
        action: "sell",
        confidence: 0.92,
        reason: ["exit_signal"]
      },
      position: createPosition({
        openedAt: clock - 1_000,
        quantity: 1,
        strategyId: "emaCross"
      }),
      signalState: {
        exitSignalStreak: 0
      },
      tick: {
        price: 100 * (1 - normalProfile.emergencyStopPct - 0.01),
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (!protectivePlan.exitNow || protectivePlan.lifecycleEvent !== "PROTECTIVE_STOP_HIT" || !protectivePlan.reason.includes("protective_stop_exit") || protectivePlan.reason.some((reason) => String(reason).startsWith("minimum_hold_"))) {
      throw new Error(`protective exit should preempt minimum hold gating: ${JSON.stringify(protectivePlan)}`);
    }

    const minimumHoldPlan = normalExitHarness.bot.shouldExitPosition({
      decision: {
        action: "sell",
        confidence: 0.9,
        reason: ["exit_signal"]
      },
      position: createPosition({
        openedAt: clock - 1_000,
        quantity: 1,
        strategyId: "emaCross"
      }),
      signalState: {
        exitSignalStreak: normalProfile.exitConfirmationTicks
      },
      tick: {
        price: 100,
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (minimumHoldPlan.exitNow || !minimumHoldPlan.reason.includes(`minimum_hold_${normalProfile.minHoldMs}ms`) || minimumHoldPlan.reason.includes(`exit_confirmed_${normalProfile.exitConfirmationTicks}ticks`)) {
      throw new Error(`minimum hold should block non-protective exits even when confirmation is satisfied: ${JSON.stringify(minimumHoldPlan)}`);
    }

    const unconfirmedSellPlan = normalExitHarness.bot.shouldExitPosition({
      decision: {
        action: "sell",
        confidence: 0.9,
        reason: ["exit_signal"]
      },
      position: createPosition({
        openedAt: clock - normalProfile.minHoldMs - 1_000,
        quantity: 1,
        strategyId: "emaCross"
      }),
      signalState: {
        exitSignalStreak: Math.max(normalProfile.exitConfirmationTicks - 1, 0)
      },
      tick: {
        price: 100.2,
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (unconfirmedSellPlan.exitNow || unconfirmedSellPlan.reason.includes(`exit_confirmed_${normalProfile.exitConfirmationTicks}ticks`)) {
      throw new Error(`standard exits should stay blocked until required confirmation ticks are reached: ${JSON.stringify(unconfirmedSellPlan)}`);
    }

    const confirmedSellPlan = normalExitHarness.bot.shouldExitPosition({
      decision: {
        action: "sell",
        confidence: 0.9,
        reason: ["exit_signal"]
      },
      position: createPosition({
        openedAt: clock - normalProfile.minHoldMs - 1_000,
        quantity: 1,
        strategyId: "emaCross"
      }),
      signalState: {
        exitSignalStreak: normalProfile.exitConfirmationTicks
      },
      tick: {
        price: 100.2,
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (!confirmedSellPlan.exitNow || confirmedSellPlan.lifecycleEvent !== null || confirmedSellPlan.transition !== undefined || !confirmedSellPlan.reason.includes(`exit_confirmed_${normalProfile.exitConfirmationTicks}ticks`)) {
      throw new Error(`standard confirmed sell exits should close only after required confirmation ticks: ${JSON.stringify(confirmedSellPlan)}`);
    }

    const directRsiHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.5,
      reason: ["neutral_signal"]
    }), {
      allowedStrategies: ["rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          exitPolicyId: "RSI_REVERSION_PRO"
        }
      }
    });
    const rsiProfile = directRsiHarness.bot.deps.riskManager.getProfile(directRsiHarness.config.riskProfile);
    const deferredRsiPlan = directRsiHarness.bot.shouldExitPosition({
      decision: {
        action: "sell",
        confidence: 0.88,
        reason: ["rsi_exit_threshold_hit"]
      },
      position: createPosition({
        openedAt: clock - rsiProfile.minHoldMs - 1_000,
        quantity: 0.5,
        strategyId: "rsiReversion"
      }),
      signalState: {
        exitSignalStreak: rsiProfile.exitConfirmationTicks
      },
      tick: {
        price: 100.2,
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (deferredRsiPlan.exitNow || deferredRsiPlan.transition !== "managed_recovery" || deferredRsiPlan.lifecycleEvent !== "RSI_EXIT_HIT" || deferredRsiPlan.exitMechanism !== "qualification" || !deferredRsiPlan.reason.includes("rsi_exit_deferred") || !deferredRsiPlan.nextPosition || deferredRsiPlan.nextPosition.lifecycleState !== "MANAGED_RECOVERY") {
      throw new Error(`rsiReversion should defer into managed recovery when net pnl is below the RSI exit floor: ${JSON.stringify(deferredRsiPlan)}`);
    }

    const confirmedRsiPlan = directRsiHarness.bot.shouldExitPosition({
      decision: {
        action: "sell",
        confidence: 0.88,
        reason: ["rsi_exit_threshold_hit"]
      },
      position: createPosition({
        openedAt: clock - rsiProfile.minHoldMs - 1_000,
        quantity: 0.5,
        strategyId: "rsiReversion"
      }),
      signalState: {
        exitSignalStreak: rsiProfile.exitConfirmationTicks
      },
      tick: {
        price: 100.4,
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (!confirmedRsiPlan.exitNow || confirmedRsiPlan.transition !== undefined || confirmedRsiPlan.nextPosition !== undefined || confirmedRsiPlan.lifecycleEvent !== "RSI_EXIT_HIT" || confirmedRsiPlan.exitMechanism !== "qualification" || !confirmedRsiPlan.reason.includes("rsi_exit_confirmed") || !confirmedRsiPlan.reason.includes(`exit_confirmed_${rsiProfile.exitConfirmationTicks}ticks`)) {
      throw new Error(`rsiReversion should close normally when the RSI exit floor is met: ${JSON.stringify(confirmedRsiPlan)}`);
    }

    const holdHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.9,
      reason: [context.hasOpenPosition ? "exit_signal" : "entry_signal"]
    }));
    if (holdHarness.bot.maxArchitectStateAgeMs !== 90_000) {
      throw new Error(`default maxArchitectStateAgeMs should remain 90000: ${holdHarness.bot.maxArchitectStateAgeMs}`);
    }

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
    if (debounceEvaluation.metadata.strategyRsi !== 55 || debounceEvaluation.metadata.architectContextRsi !== 62 || debounceEvaluation.metadata.architectRsiIntensity !== 0.24) {
      throw new Error("debounce evaluation log should distinguish strategy RSI from architect context RSI diagnostics");
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
    const profitAccountingHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.9,
      reason: [context.hasOpenPosition ? "take_profit_signal" : "entry_signal"]
    }), {
      strategy: "emaCross"
    });
    const profitInitialState = profitAccountingHarness.store.getBotState("bot_test");
    const profitInitialBalance = profitInitialState.availableBalanceUsdt;
    profitAccountingHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    profitAccountingHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const profitPosition = profitAccountingHarness.store.getPosition("bot_test");
    if (!profitPosition) {
      throw new Error("profit characterization scenario did not open a position");
    }
    const profitEntryNotional = profitPosition.entryPrice * profitPosition.quantity;
    const profitOpenState = profitAccountingHarness.store.getBotState("bot_test");
    assertClose(
      profitOpenState.availableBalanceUsdt,
      profitInitialBalance - profitEntryNotional,
      "open trade should reserve entry notional from available balance"
    );
    clock += 1_000;
    profitAccountingHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!profitAccountingHarness.store.getPosition("bot_test")) {
      throw new Error("profit characterization scenario should still hold before minimum hold time");
    }
    clock += 16_000;
    profitAccountingHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const profitTrade = profitAccountingHarness.store.getClosedTrades("bot_test")[0];
    const profitClosedState = profitAccountingHarness.store.getBotState("bot_test");
    if (!profitTrade || !(profitTrade.netPnl > 0)) {
      throw new Error(`profit characterization scenario should close with positive netPnl: ${JSON.stringify(profitTrade)}`);
    }
    const expectedProfitFees = ((profitTrade.entryPrice * profitTrade.quantity) + (profitTrade.exitPrice * profitTrade.quantity)) * 0.001;
    const expectedProfitGrossPnl = (profitTrade.exitPrice - profitTrade.entryPrice) * profitTrade.quantity;
    const expectedProfitNetPnl = expectedProfitGrossPnl - expectedProfitFees;
    assertClose(profitTrade.fees, expectedProfitFees, "profit close should charge round-trip fees");
    assertClose(profitTrade.pnl, expectedProfitGrossPnl, "profit close should store gross pnl");
    assertClose(profitTrade.netPnl, expectedProfitNetPnl, "profit close should store net pnl after fees");
    assertClose(
      profitClosedState.availableBalanceUsdt,
      profitInitialBalance + profitTrade.netPnl,
      "profit close should restore capital plus net pnl to available balance"
    );
    assertClose(
      profitClosedState.realizedPnl,
      profitTrade.netPnl,
      "profit close should realize the same net pnl recorded on the trade"
    );
    if (profitClosedState.lossStreak !== 0) {
      throw new Error(`profit close should not increment loss streak: ${profitClosedState.lossStreak}`);
    }
    if (profitClosedState.cooldownReason !== "post_exit_reentry_guard" || profitClosedState.cooldownUntil !== clock + 15_000) {
      throw new Error(`profit close should apply reentry cooldown guard only: ${JSON.stringify(profitClosedState)}`);
    }

    clock += 10_000;
    const lossAccountingHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.9,
      reason: [context.hasOpenPosition ? "stop_signal" : "entry_signal"]
    }), {
      strategy: "emaCross"
    });
    const lossInitialState = lossAccountingHarness.store.getBotState("bot_test");
    const lossInitialBalance = lossInitialState.availableBalanceUsdt;
    lossAccountingHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    lossAccountingHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const lossPosition = lossAccountingHarness.store.getPosition("bot_test");
    if (!lossPosition) {
      throw new Error("loss characterization scenario did not open a position");
    }
    const lossEntryNotional = lossPosition.entryPrice * lossPosition.quantity;
    const lossOpenState = lossAccountingHarness.store.getBotState("bot_test");
    assertClose(
      lossOpenState.availableBalanceUsdt,
      lossInitialBalance - lossEntryNotional,
      "loss scenario open should reserve entry notional from available balance"
    );
    clock += 1_000;
    lossAccountingHarness.bot.onMarketTick({ price: 99.95, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!lossAccountingHarness.store.getPosition("bot_test")) {
      throw new Error("loss characterization scenario should still hold before minimum hold time");
    }
    clock += 16_000;
    lossAccountingHarness.bot.onMarketTick({ price: 99.8, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const lossTrade = lossAccountingHarness.store.getClosedTrades("bot_test")[0];
    const lossClosedState = lossAccountingHarness.store.getBotState("bot_test");
    if (!lossTrade || !(lossTrade.netPnl < 0)) {
      throw new Error(`loss characterization scenario should close with negative netPnl: ${JSON.stringify(lossTrade)}`);
    }
    const expectedLossFees = ((lossTrade.entryPrice * lossTrade.quantity) + (lossTrade.exitPrice * lossTrade.quantity)) * 0.001;
    const expectedLossGrossPnl = (lossTrade.exitPrice - lossTrade.entryPrice) * lossTrade.quantity;
    const expectedLossNetPnl = expectedLossGrossPnl - expectedLossFees;
    assertClose(lossTrade.fees, expectedLossFees, "loss close should charge round-trip fees");
    assertClose(lossTrade.pnl, expectedLossGrossPnl, "loss close should store gross pnl");
    assertClose(lossTrade.netPnl, expectedLossNetPnl, "loss close should store net pnl after fees");
    assertClose(
      lossClosedState.availableBalanceUsdt,
      lossInitialBalance + lossTrade.netPnl,
      "loss close should restore capital plus negative net pnl to available balance"
    );
    assertClose(
      lossClosedState.realizedPnl,
      lossTrade.netPnl,
      "loss close should realize the same negative net pnl recorded on the trade"
    );
    if (lossClosedState.lossStreak !== 1) {
      throw new Error(`loss close should increment loss streak exactly once: ${lossClosedState.lossStreak}`);
    }
    if (lossClosedState.cooldownReason !== "loss_cooldown" || lossClosedState.cooldownUntil !== clock + 75_000) {
      throw new Error(`loss close should apply the medium-profile loss cooldown in a single state update: ${JSON.stringify(lossClosedState)}`);
    }
    if (lossClosedState.lastTradeAt !== clock || lossClosedState.lastExecutionAt !== clock || lossClosedState.entrySignalStreak !== 0 || lossClosedState.exitSignalStreak !== 0) {
      throw new Error(`loss close should update accounting and runtime state coherently on the closing tick: ${JSON.stringify(lossClosedState)}`);
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

    process.env.LOG_TYPE = "strategy_debug";
    clock += 10_000;
    const strategyDebugHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }));
    strategyDebugHarness.store.updateBotState("bot_test", {
      cooldownReason: "loss_cooldown",
      cooldownUntil: clock + 60_000,
      entrySignalStreak: 1
    });
    strategyDebugHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    strategyDebugHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const strategyDebugSetups = strategyDebugHarness.botLogs.filter((entry) => entry.message === "SETUP");
    const strategyDebugBlockChanges = strategyDebugHarness.botLogs.filter((entry) => entry.message === "BLOCK_CHANGE");
    if (strategyDebugSetups.length !== 1) {
      throw new Error(`strategy_debug should dedupe identical SETUP logs, found ${strategyDebugSetups.length}`);
    }
    if (strategyDebugBlockChanges.length !== 1) {
      throw new Error(`strategy_debug should dedupe identical BLOCK_CHANGE logs, found ${strategyDebugBlockChanges.length}`);
    }
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }

    process.env.LOG_TYPE = "strategy_debug";
    clock += 10_000;
    const strategyDebugSellHarness = createHarness(() => ({
      action: "sell",
      confidence: 0.88,
      reason: ["rsi_exit_threshold_hit"]
    }), {
      allowedStrategies: ["rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          exitPolicyId: "RSI_REVERSION_PRO"
        }
      }
    });
    strategyDebugSellHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.8,
      entryPrice: 100,
      id: "pos-debug-sell",
      lifecycleMode: "normal",
      managedRecoveryDeferredReason: null,
      managedRecoveryExitFloorNetPnlUsdt: null,
      managedRecoveryStartedAt: null,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 20_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    strategyDebugSellHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    strategyDebugSellHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const strategyDebugSellLog = strategyDebugSellHarness.botLogs.find((entry) => entry.message === "SELL");
    if (!strategyDebugSellLog || !String(strategyDebugSellLog.metadata.closeReason || "").includes("rsi_exit_confirmed")) {
      throw new Error(`strategy_debug SELL log should preserve the explicit exit reason: ${JSON.stringify(strategyDebugSellLog)}`);
    }
    if (!strategyDebugSellLog || strategyDebugSellLog.metadata.entryPrice !== 100 || strategyDebugSellLog.metadata.exitPrice !== 100.4 || strategyDebugSellLog.metadata.grossPnl !== 0.2 || strategyDebugSellLog.metadata.fees !== 0.1002 || strategyDebugSellLog.metadata.netPnl !== 0.0998) {
      throw new Error(`strategy_debug SELL log should expose structured PnL fields: ${JSON.stringify(strategyDebugSellLog)}`);
    }
    if (strategyDebugSellLog.metadata.policyId !== "RSI_REVERSION_PRO" || strategyDebugSellLog.metadata.positionStatus !== "EXITING" || strategyDebugSellLog.metadata.exitEvent !== "rsi_exit_confirmed" || strategyDebugSellLog.metadata.exitMechanism !== "qualification" || strategyDebugSellLog.metadata.lifecycleEvent !== "RSI_EXIT_HIT" || strategyDebugSellLog.metadata.signalTimestamp !== clock || strategyDebugSellLog.metadata.executionTimestamp !== clock || strategyDebugSellLog.metadata.signalToExecutionMs !== 0) {
      throw new Error(`strategy_debug SELL log should expose exit policy and timing diagnostics: ${JSON.stringify(strategyDebugSellLog)}`);
    }
    if (strategyDebugSellHarness.bot.getExitPolicy()?.id !== "RSI_REVERSION_PRO") {
      throw new Error(`rsiReversion exit policy should resolve from strategy config metadata: ${JSON.stringify(strategyDebugSellHarness.bot.getExitPolicy())}`);
    }
    if (!strategyDebugSellHarness.store.getClosedTrades("bot_test")[0] || strategyDebugSellHarness.store.getClosedTrades("bot_test")[0].lifecycleState !== "CLOSED") {
      throw new Error("closed trade should carry explicit CLOSED lifecycle state");
    }
    if (strategyDebugSellLog.metadata.closeClassification !== "confirmed_exit") {
      throw new Error(`profitable RSI exit should remain a normal confirmed exit: ${JSON.stringify(strategyDebugSellLog)}`);
    }
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }

    process.env.LOG_TYPE = "strategy_debug";
    clock += 10_000;
    const failedRsiExitHarness = createHarness(() => ({
      action: "sell",
      confidence: 0.88,
      reason: ["rsi_exit_confirmed"]
    }), {
      allowedStrategies: ["rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    failedRsiExitHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.8,
      entryPrice: 100,
      id: "pos-failed-rsi-sell",
      lifecycleMode: "normal",
      managedRecoveryDeferredReason: null,
      managedRecoveryExitFloorNetPnlUsdt: null,
      managedRecoveryStartedAt: null,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 20_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    failedRsiExitHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    failedRsiExitHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (failedRsiExitHarness.bot.getExitPolicy()?.id !== "RSI_REVERSION_PRO") {
      throw new Error(`rsiReversion default exit policy should still resolve without TradingBot strategy-name branching: ${JSON.stringify(failedRsiExitHarness.bot.getExitPolicy())}`);
    }
    const failedRsiTrade = failedRsiExitHarness.store.getClosedTrades("bot_test")[0];
    const failedRsiState = failedRsiExitHarness.store.getBotState("bot_test");
    if (!failedRsiTrade || !(failedRsiTrade.netPnl < 0) || !failedRsiTrade.exitReason.includes("rsi_exit_confirmed")) {
      throw new Error(`negative RSI-based exit should close with rsi_exit_confirmed and negative netPnl: ${JSON.stringify(failedRsiTrade)}`);
    }
    if (failedRsiTrade.lifecycleEvent !== "FAILED_RSI_EXIT" || failedRsiTrade.lifecycleState !== "CLOSED") {
      throw new Error(`negative RSI exit should mark explicit failed lifecycle outcome: ${JSON.stringify(failedRsiTrade)}`);
    }
    const failedRsiExitLog = failedRsiExitHarness.botLogs.find((entry) => entry.message === "failed_rsi_exit");
    if (!failedRsiExitLog || failedRsiExitLog.metadata.closeClassification !== "failed_rsi_exit") {
      throw new Error(`negative RSI exit should emit failed_rsi_exit log: ${JSON.stringify(failedRsiExitLog)}`);
    }
    const failedRsiSellLog = failedRsiExitHarness.botLogs.find((entry) => entry.message === "SELL" && entry.metadata.closeClassification === "failed_rsi_exit");
    if (!failedRsiSellLog || !String(failedRsiSellLog.metadata.closeReason || "").includes("rsi_exit_confirmed")) {
      throw new Error(`negative RSI exit SELL log should carry failed_rsi_exit classification and rsi_exit_confirmed reason: ${JSON.stringify(failedRsiSellLog)}`);
    }
    if (!failedRsiState.postLossArchitectLatchActive || failedRsiState.postLossArchitectLatchStrategyId !== "rsiReversion") {
      throw new Error(`negative RSI exit should activate the post-loss architect latch: ${JSON.stringify(failedRsiState)}`);
    }
    if (!failedRsiExitHarness.botLogs.find((entry) => entry.message === "post_loss_architect_latch_activated")) {
      throw new Error("negative RSI exit should activate the same post-loss defensive latch flow");
    }
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }

    process.env.LOG_TYPE = "strategy_debug";
    clock += 10_000;
    const managedRecoveryHarness = createHarness(() => ({
      action: "sell",
      confidence: 0.88,
      reason: ["rsi_exit_threshold_hit"]
    }), {
      allowedStrategies: ["rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          exitPolicyId: "RSI_REVERSION_PRO"
        }
      }
    });
    managedRecoveryHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.84,
      entryPrice: 100,
      id: "pos-managed-recovery",
      lifecycleMode: "normal",
      managedRecoveryDeferredReason: null,
      managedRecoveryExitFloorNetPnlUsdt: null,
      managedRecoveryStartedAt: null,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 20_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    managedRecoveryHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    managedRecoveryHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const managedRecoveryPosition = managedRecoveryHarness.store.getPosition("bot_test");
    if (!managedRecoveryPosition || managedRecoveryPosition.lifecycleMode !== "managed_recovery" || managedRecoveryPosition.lifecycleState !== "MANAGED_RECOVERY" || managedRecoveryPosition.lastLifecycleEvent !== "RSI_EXIT_HIT") {
      throw new Error(`weak RSI exit should defer into managed recovery: ${JSON.stringify(managedRecoveryPosition)}`);
    }
    if (managedRecoveryHarness.store.getClosedTrades("bot_test").length !== 0) {
      throw new Error("deferred RSI exit should not close the trade immediately");
    }
    if (managedRecoveryHarness.store.getBotState("bot_test").exitSignalStreak !== 0) {
      throw new Error("entering managed recovery should reset exit confirmation streak");
    }
    if (!managedRecoveryHarness.botLogs.find((entry) => entry.message === "rsi_exit_deferred")) {
      throw new Error("missing rsi_exit_deferred log when RSI exit is below the recovery floor");
    }
    const deferredRiskLog = managedRecoveryHarness.botLogs.find((entry) => entry.message === "RISK_CHANGE" && entry.metadata.status === "rsi_exit_deferred");
    if (!deferredRiskLog) {
      throw new Error("strategy_debug/minimal path should expose managed recovery entry via RISK_CHANGE");
    }
    const deferredLog = managedRecoveryHarness.botLogs.find((entry) => entry.message === "rsi_exit_deferred");
    if (!deferredLog || deferredLog.metadata.policyId !== "RSI_REVERSION_PRO" || deferredLog.metadata.positionStatus !== "MANAGED_RECOVERY" || deferredLog.metadata.exitEvent !== "rsi_exit_deferred" || deferredLog.metadata.exitMechanism !== "qualification" || deferredLog.metadata.lifecycleEvent !== "RSI_EXIT_HIT" || deferredLog.metadata.targetPrice === null || deferredLog.metadata.timeoutRemainingMs === null) {
      throw new Error(`managed recovery defer log should expose policy, target, and timeout context: ${JSON.stringify(deferredLog)}`);
    }
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }

    clock += 1_000;
    managedRecoveryHarness.bot.onMarketTick({ price: 100.21, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const ignoredRecoveryPosition = managedRecoveryHarness.store.getPosition("bot_test");
    if (!ignoredRecoveryPosition || ignoredRecoveryPosition.lifecycleMode !== "managed_recovery" || managedRecoveryHarness.store.getClosedTrades("bot_test").length !== 0) {
      throw new Error("managed recovery should ignore repeated RSI-only sell signals");
    }
    if (managedRecoveryHarness.store.getBotState("bot_test").exitSignalStreak !== 0) {
      throw new Error("ignored RSI signals during managed recovery must not accumulate fake exit confirmation");
    }

    const managedRecoveryTargetHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["mean_reversion_not_ready"]
    }), {
      allowedStrategies: ["rsiReversion"],
      indicatorSnapshot: {
        emaBaseline: 99,
        emaFast: 101,
        emaSlow: 100,
        momentum: 1.4,
        rsi: 55,
        volatility: 1.2
      },
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          exitPolicyId: "RSI_REVERSION_PRO"
        }
      }
    });
    managedRecoveryTargetHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.84,
      entryPrice: 100,
      id: "pos-managed-target",
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: clock - 10_000,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 30_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    managedRecoveryTargetHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 0
    });
    managedRecoveryTargetHarness.bot.onMarketTick({ price: 101.6, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!managedRecoveryTargetHarness.store.getPosition("bot_test")) {
      throw new Error("managed recovery price target should still require normal confirmation ticks");
    }
    if (managedRecoveryTargetHarness.store.getBotState("bot_test").exitSignalStreak !== 1) {
      throw new Error("managed recovery target resolver should start exit confirmation when the target is reached");
    }
    clock += 1_000;
    managedRecoveryTargetHarness.bot.onMarketTick({ price: 101.6, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const managedRecoveryTargetTrade = managedRecoveryTargetHarness.store.getClosedTrades("bot_test")[0];
    if (!managedRecoveryTargetTrade || !managedRecoveryTargetTrade.exitReason.includes("reversion_price_target_hit")) {
      throw new Error(`managed recovery should exit on confirmed price target hit: ${JSON.stringify(managedRecoveryTargetTrade)}`);
    }
    const managedRecoveryExitedLog = managedRecoveryTargetHarness.botLogs.find((entry) => entry.message === "managed_recovery_exited");
    if (!managedRecoveryExitedLog || managedRecoveryExitedLog.metadata.positionStatus !== "EXITING" || managedRecoveryExitedLog.metadata.exitEvent !== "reversion_price_target_hit" || managedRecoveryExitedLog.metadata.exitMechanism !== "recovery" || managedRecoveryExitedLog.metadata.lifecycleEvent !== "PRICE_TARGET_HIT") {
      throw new Error(`managed recovery exit log should expose recovery exit telemetry: ${JSON.stringify(managedRecoveryExitedLog)}`);
    }

    clock += 10_000;
    const managedRecoveryInvalidationHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["mean_reversion_not_ready"]
    }), {
      allowedStrategies: ["rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          exitPolicyId: "RSI_REVERSION_PRO"
        }
      }
    });
    managedRecoveryInvalidationHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.84,
      entryPrice: 100,
      id: "pos-managed-invalidation",
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: clock - 10_000,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 30_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    managedRecoveryInvalidationHarness.store.setArchitectPublishedAssessment("BTC/USDT", createTrendArchitect({
      updatedAt: clock
    }));
    managedRecoveryInvalidationHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...managedRecoveryInvalidationHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: clock,
      ready: true
    });
    managedRecoveryInvalidationHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const invalidationTrade = managedRecoveryInvalidationHarness.store.getClosedTrades("bot_test")[0];
    if (!invalidationTrade || !invalidationTrade.exitReason.includes("regime_invalidation_exit")) {
      throw new Error(`managed recovery should exit on architect invalidation: ${JSON.stringify(invalidationTrade)}`);
    }
    const invalidationLog = managedRecoveryInvalidationHarness.botLogs.find((entry) => entry.message === "managed_recovery_exited");
    if (!invalidationLog || invalidationLog.metadata.exitMechanism !== "invalidation" || invalidationLog.metadata.invalidationMode !== "family_mismatch" || invalidationLog.metadata.invalidationLevel !== "family_mismatch" || invalidationLog.metadata.lifecycleEvent !== "REGIME_INVALIDATION") {
      throw new Error(`managed recovery invalidation should log explicit invalidation telemetry: ${JSON.stringify(invalidationLog)}`);
    }

    clock += 10_000;
    const managedRecoveryTimeoutHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["mean_reversion_not_ready"]
    }), {
      allowedStrategies: ["rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          exitPolicyId: "RSI_REVERSION_FAST_TIMEOUT"
        }
      }
    });
    managedRecoveryTimeoutHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.84,
      entryPrice: 100,
      id: "pos-managed-timeout",
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: clock - 31_000,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 45_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    managedRecoveryTimeoutHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const timeoutTrade = managedRecoveryTimeoutHarness.store.getClosedTrades("bot_test")[0];
    if (!timeoutTrade || !timeoutTrade.exitReason.includes("time_exhaustion_exit")) {
      throw new Error(`managed recovery should exit on timeout exhaustion: ${JSON.stringify(timeoutTrade)}`);
    }
    const timeoutLog = managedRecoveryTimeoutHarness.botLogs.find((entry) => entry.message === "managed_recovery_exited");
    if (!timeoutLog || timeoutLog.metadata.exitMechanism !== "recovery" || timeoutLog.metadata.exitEvent !== "time_exhaustion_exit" || timeoutLog.metadata.lifecycleEvent !== "RECOVERY_TIMEOUT") {
      throw new Error(`managed recovery timeout should remain a recovery-driven exit: ${JSON.stringify(timeoutLog)}`);
    }

    clock += 10_000;
    const mediumLossStreakLimit = new RiskManager().getProfile("medium").maxLossStreak;
    const lossLatchHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }));
    lossLatchHarness.store.updateBotState("bot_test", {
      cooldownReason: "loss_cooldown",
      cooldownUntil: clock + 60_000,
      entrySignalStreak: 1,
      lossStreak: mediumLossStreakLimit
    });
    lossLatchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    let lossLatchState = lossLatchHarness.store.getBotState("bot_test");
    if (lossLatchState.lossStreak !== mediumLossStreakLimit || lossLatchHarness.store.getPosition("bot_test")) {
      throw new Error("maxed loss streak should remain blocked during active loss cooldown");
    }
    clock += 61_000;
    lossLatchHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    lossLatchState = lossLatchHarness.store.getBotState("bot_test");
    if (lossLatchState.lossStreak !== (mediumLossStreakLimit - 1)) {
      throw new Error(`loss cooldown expiry should reduce the latched streak by exactly one: ${lossLatchState.lossStreak}`);
    }
    if (!lossLatchHarness.store.getPosition("bot_test")) {
      throw new Error("post-expiry loss streak decrement should allow a valid recovery entry");
    }
    clock += 1_000;
    lossLatchHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (lossLatchHarness.store.getBotState("bot_test").lossStreak !== (mediumLossStreakLimit - 1)) {
      throw new Error("loss cooldown expiry should not decrement the streak multiple times");
    }

    clock += 10_000;
    const nonLossCooldownHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }));
    nonLossCooldownHarness.store.updateBotState("bot_test", {
      cooldownReason: "post_exit_reentry_guard",
      cooldownUntil: clock + 60_000,
      entrySignalStreak: 1,
      lossStreak: mediumLossStreakLimit
    });
    nonLossCooldownHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 61_000;
    nonLossCooldownHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const nonLossCooldownState = nonLossCooldownHarness.store.getBotState("bot_test");
    if (nonLossCooldownState.lossStreak !== mediumLossStreakLimit) {
      throw new Error(`non-loss cooldown expiry should not change loss streak: ${nonLossCooldownState.lossStreak}`);
    }
    if (nonLossCooldownHarness.store.getPosition("bot_test")) {
      throw new Error("non-loss cooldown expiry should keep loss_streak_limit behavior unchanged");
    }

    clock += 10_000;
    process.env.LOG_TYPE = "strategy_debug";
    const postLossStrategyEvaluate = (context) => ({
      action: context.hasOpenPosition ? "hold" : "buy",
      confidence: 0.95,
      reason: [context.hasOpenPosition ? "mean_reversion_not_ready" : "buy_signal"]
    });
    const postLossLatchHarness = createHarness(postLossStrategyEvaluate, {
      allowedStrategies: ["rsiReversion"],
      postLossArchitectLatchPublishesRequired: 2,
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    postLossLatchHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.9,
      entryPrice: 100,
      id: "pos-loss-latch",
      lifecycleMode: "normal",
      managedRecoveryDeferredReason: null,
      managedRecoveryExitFloorNetPnlUsdt: null,
      managedRecoveryStartedAt: null,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 20_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    postLossLatchHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    postLossLatchHarness.bot.onMarketTick({ price: 99, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const postLossClosedTrade = postLossLatchHarness.store.getClosedTrades("bot_test")[0];
    const postLossState = postLossLatchHarness.store.getBotState("bot_test");
    if (!postLossClosedTrade || !(postLossClosedTrade.netPnl < 0)) {
      throw new Error("post-loss architect latch test should close a real losing trade");
    }
    if (!postLossClosedTrade.exitReason.includes("protective_stop_exit")) {
      throw new Error(`post-loss architect latch test should be triggered by the defensive stop path: ${JSON.stringify(postLossClosedTrade)}`);
    }
    const protectiveStopSellLog = postLossLatchHarness.botLogs.find((entry) => entry.message === "SELL" && String(entry.metadata.closeReason || "").includes("protective_stop_exit"));
    if (!protectiveStopSellLog || protectiveStopSellLog.metadata.exitMechanism !== "protection" || protectiveStopSellLog.metadata.protectionMode !== "fixed_pct" || protectiveStopSellLog.metadata.lifecycleEvent !== "PROTECTIVE_STOP_HIT") {
      throw new Error(`protective stop exits should log explicit protection telemetry: ${JSON.stringify(protectiveStopSellLog)}`);
    }
    if (!postLossState.postLossArchitectLatchActive || postLossState.postLossArchitectLatchFreshPublishCount !== 0 || postLossState.postLossArchitectLatchStrategyId !== "rsiReversion") {
      throw new Error(`loss close should activate the architect latch: ${JSON.stringify(postLossState)}`);
    }
    if (!postLossLatchHarness.botLogs.find((entry) => entry.message === "post_loss_architect_latch_activated")) {
      throw new Error("missing post_loss_architect_latch_activated log on losing close");
    }
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }

    clock += 80_000;
    postLossLatchHarness.store.updateBotState("bot_test", {
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 1
    });
    postLossLatchHarness.bot.onMarketTick({ price: 99.6, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    let postLossBlockedState = postLossLatchHarness.store.getBotState("bot_test");
    if (postLossLatchHarness.store.getPosition("bot_test")) {
      throw new Error("post-loss architect latch should block re-entry before fresh publishes arrive");
    }
    if (!postLossLatchHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "post_loss_architect_latch")) {
      throw new Error("missing entry_gate_blocked log for post_loss_architect_latch");
    }
    const postLossBlockedLog = postLossLatchHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "post_loss_architect_latch");
    if (!postLossBlockedLog || postLossBlockedLog.metadata.postLossArchitectLatchFreshPublishCount !== 0 || postLossBlockedLog.metadata.postLossArchitectLatchRequiredPublishes !== 2) {
      throw new Error(`post-loss architect latch blocked log should expose latch progress: ${JSON.stringify(postLossBlockedLog)}`);
    }
    if (postLossBlockedState.postLossArchitectLatchFreshPublishCount !== 0) {
      throw new Error("stale architect state should not increment the post-loss architect latch");
    }

    postLossLatchHarness.store.setArchitectPublishedAssessment("BTC/USDT", createPublishedArchitect({
      updatedAt: postLossClosedTrade.closedAt + 5_000
    }));
    clock += 1_000;
    postLossLatchHarness.bot.onMarketTick({ price: 99.7, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    postLossBlockedState = postLossLatchHarness.store.getBotState("bot_test");
    if (postLossBlockedState.postLossArchitectLatchFreshPublishCount !== 0 || !postLossBlockedState.postLossArchitectLatchActive) {
      throw new Error("updating only the published payload without a fresh publisher timestamp should not release the latch");
    }

    const firstFreshPublishAt = postLossClosedTrade.closedAt + 10_000;
    postLossLatchHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...postLossLatchHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: firstFreshPublishAt,
      ready: true
    });
    clock += 1_000;
    postLossLatchHarness.bot.onMarketTick({ price: 99.8, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    let firstFreshPublishState = postLossLatchHarness.store.getBotState("bot_test");
    if (firstFreshPublishState.postLossArchitectLatchFreshPublishCount !== 1 || !firstFreshPublishState.postLossArchitectLatchActive) {
      throw new Error(`first fresh architect publish should count but not release the latch: ${JSON.stringify(firstFreshPublishState)}`);
    }
    if (!postLossLatchHarness.botLogs.find((entry) => entry.message === "post_loss_architect_latch_publish_counted" && entry.metadata.freshPublishCount === 1)) {
      throw new Error("missing publish_counted log for the first fresh architect publish");
    }

    clock += 1_000;
    postLossLatchHarness.bot.onMarketTick({ price: 99.9, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    firstFreshPublishState = postLossLatchHarness.store.getBotState("bot_test");
    if (firstFreshPublishState.postLossArchitectLatchFreshPublishCount !== 1 || !firstFreshPublishState.postLossArchitectLatchActive) {
      throw new Error("reused architect publisher state should not increment or release the latch");
    }

    const secondFreshPublishAt = postLossClosedTrade.closedAt + 20_000;
    postLossLatchHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...postLossLatchHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: secondFreshPublishAt,
      ready: true
    });
    postLossLatchHarness.store.updateBotState("bot_test", {
      entrySignalStreak: 1
    });
    clock += 1_000;
    postLossLatchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const releasedLatchState = postLossLatchHarness.store.getBotState("bot_test");
    if (releasedLatchState.postLossArchitectLatchActive || releasedLatchState.postLossArchitectLatchFreshPublishCount !== 2) {
      throw new Error(`second fresh architect publish should release the latch: ${JSON.stringify(releasedLatchState)}`);
    }
    if (!postLossLatchHarness.store.getPosition("bot_test")) {
      throw new Error("re-entry should become eligible once the second fresh architect publish releases the latch");
    }
    if (!postLossLatchHarness.botLogs.find((entry) => entry.message === "post_loss_architect_latch_released")) {
      throw new Error("missing post_loss_architect_latch_released log");
    }

    const reloadedStore = new StateStore();
    reloadedStore.botStates.set("bot_test", {
      ...releasedLatchState,
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 1,
      postLossArchitectLatchActive: true,
      postLossArchitectLatchActivatedAt: postLossClosedTrade.closedAt,
      postLossArchitectLatchFreshPublishCount: 1,
      postLossArchitectLatchLastCountedPublishedAt: firstFreshPublishAt,
      postLossArchitectLatchStrategyId: "rsiReversion"
    });
    const restartedLatchHarness = createHarness(postLossStrategyEvaluate, {
      allowedStrategies: ["rsiReversion"],
      postLossArchitectLatchPublishesRequired: 2,
      publishedArchitect: createPublishedArchitect({
        updatedAt: firstFreshPublishAt
      }),
      publisherState: {
        challengerCount: 0,
        challengerRegime: null,
        challengerRequired: 2,
        hysteresisActive: false,
        lastObservedAt: firstFreshPublishAt,
        lastPublishedAt: firstFreshPublishAt,
        lastPublishedRegime: "range",
        nextPublishAt: firstFreshPublishAt + 30_000,
        publishIntervalMs: 30_000,
        ready: true,
        symbol: "BTC/USDT",
        warmupStartedAt: firstFreshPublishAt - 60_000
      },
      store: reloadedStore,
      strategy: "rsiReversion"
    });
    const restartedState = restartedLatchHarness.store.getBotState("bot_test");
    if (!restartedState.postLossArchitectLatchActive || restartedState.postLossArchitectLatchFreshPublishCount !== 1) {
      throw new Error(`post-loss architect latch state should survive bot re-registration on restored state: ${JSON.stringify(restartedState)}`);
    }
    clock += 1_000;
    restartedLatchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (restartedLatchHarness.store.getPosition("bot_test")) {
      throw new Error("restored post-loss architect latch state should still block re-entry until another fresh publish arrives");
    }

    clock += 10_000;
    const frozenCooldownHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }));
    frozenCooldownHarness.store.updateBotState("bot_test", {
      cooldownReason: "loss_cooldown",
      cooldownUntil: clock + 60_000,
      entrySignalStreak: 1
    });

    frozenCooldownHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    let frozenState = frozenCooldownHarness.store.getBotState("bot_test");
    if (frozenState.entrySignalStreak !== 1) {
      throw new Error(`entrySignalStreak should be preserved during cooldown, received ${frozenState.entrySignalStreak}`);
    }
    clock += 1_000;
    frozenCooldownHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    frozenState = frozenCooldownHarness.store.getBotState("bot_test");
    if (frozenState.entrySignalStreak !== 1) {
      throw new Error(`entrySignalStreak should not increment during cooldown, received ${frozenState.entrySignalStreak}`);
    }
    if (frozenCooldownHarness.store.getPosition("bot_test")) {
      throw new Error("cooldown freeze test should not open during cooldown");
    }

    clock += 61_000;
    frozenCooldownHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!frozenCooldownHarness.store.getPosition("bot_test")) {
      throw new Error("preserved entrySignalStreak should allow debounce to complete immediately after cooldown ends");
    }

    clock += 10_000;
    let dynamicAction = "buy";
    const resetHarness = createHarness(() => ({
      action: dynamicAction,
      confidence: 0.8,
      reason: [dynamicAction === "buy" ? "buy_signal" : "no_trade"]
    }));
    resetHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (resetHarness.store.getBotState("bot_test").entrySignalStreak !== 1) {
      throw new Error("entrySignalStreak should start accumulating outside cooldown");
    }
    dynamicAction = "hold";
    clock += 1_000;
    resetHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (resetHarness.store.getBotState("bot_test").entrySignalStreak !== 0) {
      throw new Error("entrySignalStreak should still reset when the signal disappears outside cooldown");
    }
    dynamicAction = "buy";
    clock += 1_000;
    resetHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (resetHarness.store.getPosition("bot_test")) {
      throw new Error("signal reset outside cooldown should require debounce to restart");
    }
    clock += 1_000;
    resetHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!resetHarness.store.getPosition("bot_test")) {
      throw new Error("debounce should still complete normally after a genuine reset outside cooldown");
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
        resolveStrategyFamily: resolveTestStrategyFamily
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
    const nonRoutableHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["no_trade"]
    }), {
      allowedStrategies: ["unknownStrategy", "emaCross"],
      strategy: "emaCross",
      strategySwitcher: new StrategySwitcher({
        resolveStrategyFamily: resolveTestStrategyFamily
      })
    });
    const nonRoutableLog = nonRoutableHarness.botLogs.find((entry) => entry.message === "non_routable_allowed_strategies");
    if (!nonRoutableLog) {
      throw new Error("missing non_routable_allowed_strategies warning when an unknown strategy is configured for architect switching");
    }
    if (nonRoutableLog.metadata.nonRoutableStrategies !== "unknownStrategy") {
      throw new Error(`unexpected non-routable strategy warning payload: ${JSON.stringify(nonRoutableLog.metadata)}`);
    }

    clock += 10_000;
    let raceStore = null;
    const raceSwitcher = new StrategySwitcher({
      resolveStrategyFamily: resolveTestStrategyFamily
    });
    raceSwitcher.evaluate = function evaluateWithInjectedPosition() {
      raceStore.setPosition("bot_test", {
        botId: "bot_test",
        confidence: 0.75,
        entryPrice: 100,
        id: "pos-race",
        notes: ["injected_race_position"],
        openedAt: clock - 1_000,
        quantity: 0.25,
        strategyId: "emaCross",
        symbol: "BTC/USDT"
      });
      return {
        nextStrategyId: "rsiReversion",
        reason: "architect_family_mean_reversion",
        targetFamily: "mean_reversion"
      };
    };
    const raceHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["position_managed"]
    }), {
      allowedStrategies: ["emaCross", "rsiReversion"],
      publishedArchitect: createPublishedArchitect(),
      strategy: "emaCross",
      strategySwitcher: raceSwitcher
    });
    raceStore = raceHarness.store;
    raceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const raceState = raceHarness.store.getBotState("bot_test");
    if (raceState.activeStrategyId !== "emaCross") {
      throw new Error(`bot should not switch strategy if a position appears before apply: ${raceState.activeStrategyId}`);
    }
    if (!raceHarness.botLogs.find((entry) => entry.message === "strategy_alignment_skipped" && entry.metadata.reason === "position_opened_before_apply")) {
      throw new Error("missing strategy_alignment_skipped log when switch apply loses flat state");
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
      strategySwitcher: new StrategySwitcher({
        resolveStrategyFamily: resolveTestStrategyFamily
      })
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
    const dedupHarness = createHarness(() => ({
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
    dedupHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    dedupHarness.bot.onMarketTick({ price: 100.1, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    dedupHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    let dedupEvaluations = dedupHarness.botLogs.filter((entry) =>
      entry.message === "entry_evaluated"
      && entry.metadata.blockReason === "architect_no_trade"
    );
    if (dedupEvaluations.length !== 1) {
      throw new Error(`repeated identical entry blocks should be deduplicated, found ${dedupEvaluations.length} logs`);
    }
    clock += 31_000;
    dedupHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    dedupEvaluations = dedupHarness.botLogs.filter((entry) =>
      entry.message === "entry_evaluated"
      && entry.metadata.blockReason === "architect_no_trade"
    );
    if (dedupEvaluations.length !== 2) {
      throw new Error(`identical blocked state should be sampled again after 30s, found ${dedupEvaluations.length} logs`);
    }
    const dedupState = dedupHarness.store.getBotState("bot_test");
    if (dedupState.entryEvaluationsCount !== 4 || dedupState.entryEvaluationLogsCount !== 2 || dedupState.entryBlockedCount !== 4) {
      throw new Error(`entry evaluation counters did not track deduped states correctly: ${JSON.stringify(dedupState)}`);
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
    const rollingPartialMaturityHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      contextSnapshot: {
        dataMode: "live",
        effectiveSampleSize: 42,
        effectiveWarmupComplete: true,
        effectiveWindowSpanMs: 105_000,
        effectiveWindowStartedAt: clock - 105_000,
        features: {
          breakoutDirection: "up",
          breakoutInstability: 0.07,
          breakoutQuality: 0.43,
          chopiness: 0.31,
          contextRsi: 58,
          dataQuality: 0.93,
          directionalEfficiency: 0.63,
          emaBias: 0.18,
          emaSeparation: 0.41,
          featureConflict: 0.12,
          maturity: 0.35,
          netMoveRatio: 0.008,
          reversionStretch: 0.16,
          rsiIntensity: 0.16,
          slopeConsistency: 0.56,
          volatilityRisk: 0.2
        },
        lastPublishedRegimeSwitchAt: null,
        lastPublishedRegimeSwitchFrom: null,
        lastPublishedRegimeSwitchTo: null,
        observedAt: clock,
        postSwitchCoveragePct: null,
        rollingMaturity: 0.35,
        rollingSampleSize: 42,
        sampleSize: 42,
        structureState: "trending",
        summary: "Rolling window partially mature.",
        symbol: "BTC/USDT",
        trendBias: "bullish",
        volatilityState: "normal",
        warmupComplete: true,
        windowMode: "rolling_full",
        windowSpanMs: 105_000,
        windowStartedAt: clock - 105_000
      },
      publishedArchitect: createTrendArchitect({
        contextMaturity: 0.35,
        updatedAt: clock
      })
    });
    rollingPartialMaturityHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (rollingPartialMaturityHarness.store.getPosition("bot_test")) {
      throw new Error("rolling_full context should still block entries below the 0.5 maturity threshold");
    }
    const rollingPartialBlock = rollingPartialMaturityHarness.botLogs.find((entry) =>
      entry.message === "entry_evaluated"
      && entry.metadata.blockReason === "architect_low_maturity"
    );
    if (!rollingPartialBlock || rollingPartialBlock.metadata.entryMaturityThreshold !== 0.5) {
      throw new Error("rolling_full maturity gate should remain unchanged at 0.5");
    }

    clock += 10_000;
    const postSwitchImmatureHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      contextSnapshot: {
        dataMode: "live",
        effectiveSampleSize: 18,
        effectiveWarmupComplete: false,
        effectiveWindowSpanMs: 18_000,
        effectiveWindowStartedAt: clock - 18_000,
        features: {
          breakoutDirection: "down",
          breakoutInstability: 0.11,
          breakoutQuality: 0.29,
          chopiness: 0.44,
          contextRsi: 34,
          dataQuality: 0.9,
          directionalEfficiency: 0.42,
          emaBias: -0.08,
          emaSeparation: 0.21,
          featureConflict: 0.16,
          maturity: 0.2,
          netMoveRatio: -0.004,
          reversionStretch: 0.52,
          rsiIntensity: 0.32,
          slopeConsistency: 0.34,
          volatilityRisk: 0.22
        },
        lastPublishedRegimeSwitchAt: clock - 18_000,
        lastPublishedRegimeSwitchFrom: "trend",
        lastPublishedRegimeSwitchTo: "range",
        observedAt: clock,
        postSwitchCoveragePct: 0.08,
        rollingMaturity: 0.83,
        rollingSampleSize: 120,
        sampleSize: 18,
        structureState: "choppy",
        summary: "Post-switch segment still warming up.",
        symbol: "BTC/USDT",
        trendBias: "neutral",
        volatilityState: "normal",
        warmupComplete: true,
        windowMode: "post_switch_segment",
        windowSpanMs: 240_000,
        windowStartedAt: clock - 240_000
      },
      publishedArchitect: createTrendArchitect({
        contextMaturity: 0.2,
        updatedAt: clock
      }),
      publisherState: {
        lastRegimeSwitchAt: clock - 18_000,
        lastRegimeSwitchFrom: "trend",
        lastRegimeSwitchTo: "range",
        ready: true
      }
    });
    postSwitchImmatureHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (postSwitchImmatureHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position during post-switch low-maturity warmup");
    }
    const postSwitchBlock = postSwitchImmatureHarness.botLogs.find((entry) =>
      entry.message === "entry_evaluated"
      && entry.metadata.blockReason === "architect_post_switch_low_maturity"
    );
    if (!postSwitchBlock) {
      throw new Error("missing architect_post_switch_low_maturity diagnostics");
    }
    if (postSwitchBlock.metadata.postSwitchCoveragePct !== 0.08 || postSwitchBlock.metadata.rollingMaturity !== 0.83 || postSwitchBlock.metadata.postSwitchWarmupReason !== "post_switch_context_immature") {
      throw new Error("post-switch low-maturity diagnostics missing warmup quality metadata");
    }
    if (postSwitchBlock.metadata.effectiveWindowStartedAt !== clock - 18_000 || postSwitchBlock.metadata.contextWindowMode !== "post_switch_segment") {
      throw new Error("post-switch low-maturity diagnostics missing effective window metadata");
    }
    if (postSwitchBlock.metadata.entryMaturityThreshold !== 0.3) {
      throw new Error("post-switch low-maturity diagnostics should reflect the reduced 0.3 entry threshold");
    }

    clock += 10_000;
    const postSwitchReadyHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      contextSnapshot: {
        dataMode: "live",
        effectiveSampleSize: 60,
        effectiveWarmupComplete: true,
        effectiveWindowSpanMs: 105_000,
        effectiveWindowStartedAt: clock - 105_000,
        features: {
          breakoutDirection: "up",
          breakoutInstability: 0.08,
          breakoutQuality: 0.48,
          chopiness: 0.28,
          contextRsi: 57,
          dataQuality: 0.94,
          directionalEfficiency: 0.66,
          emaBias: 0.24,
          emaSeparation: 0.46,
          featureConflict: 0.09,
          maturity: 0.35,
          netMoveRatio: 0.011,
          reversionStretch: 0.14,
          rsiIntensity: 0.14,
          slopeConsistency: 0.61,
          volatilityRisk: 0.18
        },
        lastPublishedRegimeSwitchAt: clock - 105_000,
        lastPublishedRegimeSwitchFrom: "range",
        lastPublishedRegimeSwitchTo: "trend",
        observedAt: clock,
        postSwitchCoveragePct: 0.35,
        rollingMaturity: 0.82,
        rollingSampleSize: 120,
        sampleSize: 60,
        structureState: "trending",
        summary: "Post-switch segment mature enough for entry.",
        symbol: "BTC/USDT",
        trendBias: "bullish",
        volatilityState: "normal",
        warmupComplete: true,
        windowMode: "post_switch_segment",
        windowSpanMs: 300_000,
        windowStartedAt: clock - 300_000
      },
      publishedArchitect: createTrendArchitect({
        contextMaturity: 0.35,
        updatedAt: clock
      }),
      publisherState: {
        lastRegimeSwitchAt: clock - 105_000,
        lastRegimeSwitchFrom: "range",
        lastRegimeSwitchTo: "trend",
        ready: true
      }
    });
    postSwitchReadyHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    postSwitchReadyHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!postSwitchReadyHarness.store.getPosition("bot_test")) {
      throw new Error("post_switch_segment context should allow entries once maturity reaches the reduced 0.3 threshold");
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
    const staleBlockLog = staleHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.architectBlockReason === "architect_stale");
    if (!staleBlockLog || staleBlockLog.metadata.architectStaleThresholdMs !== 90_000) {
      throw new Error("stale architect block log should expose the configured stale threshold");
    }
    if (staleHarness.store.getBotState("bot_test").lastDecision === "buy") {
      throw new Error("flat bot should not keep a buy decision when architect state is stale");
    }

    clock += 10_000;
    const customFreshnessHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      maxArchitectStateAgeMs: 180_000,
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock - 120_000
      }),
      strategy: "rsiReversion"
    });
    if (customFreshnessHarness.bot.maxArchitectStateAgeMs !== 180_000) {
      throw new Error(`custom maxArchitectStateAgeMs should be honored from bot config: ${customFreshnessHarness.bot.maxArchitectStateAgeMs}`);
    }
    const customArchitectState = customFreshnessHarness.bot.evaluateArchitectUsability({
      currentFamily: "mean_reversion",
      timestamp: clock
    });
    if (!customArchitectState.usable || customArchitectState.architectStale || customArchitectState.staleThresholdMs !== 180_000) {
      throw new Error(`custom architect freshness threshold should be honored: ${JSON.stringify(customArchitectState)}`);
    }
    customFreshnessHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    customFreshnessHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!customFreshnessHarness.store.getPosition("bot_test")) {
      throw new Error("non-stale architect state under a custom threshold should remain eligible for entry");
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
    const conservativeTrendEconomics = edgeHarness.bot.estimateEntryEconomics({
      context: {
        indicators: edgeHarness.bot.buildContext({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock }).indicators,
        strategyId: "emaCross"
      },
      price: 100,
      quantity: 1
    });
    if (conservativeTrendEconomics.expectedGrossEdgePct >= 0.0002) {
      throw new Error(`trend edge estimate should be more conservative than max-proxy behavior: ${conservativeTrendEconomics.expectedGrossEdgePct}`);
    }
    if (conservativeTrendEconomics.minExpectedNetEdgePct !== 0.0005) {
      throw new Error(`strategies without an override should keep the default minExpectedNetEdgePct: ${conservativeTrendEconomics.minExpectedNetEdgePct}`);
    }
    if (conservativeTrendEconomics.requiredEdgePct !== 0.003) {
      throw new Error(`economic gate should use the reduced paper/mock hurdle buffers: ${conservativeTrendEconomics.requiredEdgePct}`);
    }
    edgeHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    edgeHarness.bot.onMarketTick({ price: 100.01, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (edgeHarness.store.getPosition("bot_test")) {
      throw new Error("bot opened a position with insufficient edge after costs");
    }
    if (!edgeHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "insufficient_edge_after_costs")) {
      throw new Error("missing insufficient_edge_after_costs block log");
    }

    const flatRangeReversionEconomics = edgeHarness.bot.estimateEntryEconomics({
      context: {
        indicators: {
          emaBaseline: 100,
          emaFast: 100.02,
          emaSlow: 100,
          momentum: 0.02,
          rsi: 24,
          volatility: 0.01
        },
        strategyId: "rsiReversion"
      },
      price: 100,
      quantity: 1
    });
    if (flatRangeReversionEconomics.minExpectedNetEdgePct !== 0.0005) {
      throw new Error(`rsiReversion should fall back to the default threshold when no strategy override is attached: ${flatRangeReversionEconomics.minExpectedNetEdgePct}`);
    }

    const reversionThresholdHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          minExpectedNetEdgePct: 0.0003
        }
      }
    });
    const configuredReversionEconomics = reversionThresholdHarness.bot.estimateEntryEconomics({
      context: {
        indicators: {
          emaBaseline: 100,
          emaFast: 100.02,
          emaSlow: 100,
          momentum: 0.02,
          rsi: 24,
          volatility: 0.01
        },
        strategyId: "rsiReversion"
      },
      price: 100,
      quantity: 1
    });
    if (configuredReversionEconomics.minExpectedNetEdgePct !== 0.0003) {
      throw new Error(`rsiReversion should use its configured lower minExpectedNetEdgePct override: ${configuredReversionEconomics.minExpectedNetEdgePct}`);
    }
    const flatRangeExitTarget = 100 * 1.015;
    const flatRangeCaptureGapPct = Math.max(0, flatRangeExitTarget - 100) / 100;
    if (flatRangeReversionEconomics.expectedGrossEdgePct <= 0.01) {
      throw new Error(`reversion edge estimate should be meaningfully positive when price is below the strategy exit target: ${flatRangeReversionEconomics.expectedGrossEdgePct}`);
    }
    if (flatRangeReversionEconomics.expectedGrossEdgePct >= flatRangeCaptureGapPct) {
      throw new Error(`reversion edge estimate should stay below full raw capture to remain conservative: ${flatRangeReversionEconomics.expectedGrossEdgePct}`);
    }
    if (flatRangeReversionEconomics.expectedNetEdgePct <= flatRangeReversionEconomics.minExpectedNetEdgePct) {
      throw new Error(`reversion edge estimate should no longer be trivially crushed after costs in flat/range conditions: ${flatRangeReversionEconomics.expectedNetEdgePct}`);
    }

    const strictThresholdHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          minExpectedNetEdgePct: 0.008
        }
      }
    });
    const strictThresholdGate = strictThresholdHarness.bot.evaluateFinalEntryGate({
      context: {
        indicators: {
          emaBaseline: 100,
          emaFast: 100.02,
          emaSlow: 100,
          momentum: 0.02,
          rsi: 24,
          volatility: 0.01
        },
        strategyId: "rsiReversion"
      },
      decision: {
        action: "buy",
        confidence: 0.95,
        reason: ["buy_signal"]
      },
      quantity: 1,
      tick: {
        price: 101.2,
        source: "mock",
        symbol: "BTC/USDT",
        timestamp: clock
      }
    });
    if (strictThresholdGate.allowed || strictThresholdGate.diagnostics.minExpectedNetEdgePct !== 0.008 || strictThresholdGate.diagnostics.blockReason !== "insufficient_edge_after_costs") {
      throw new Error(`entry gate should enforce the configured strategy-specific net edge threshold: ${JSON.stringify(strictThresholdGate.diagnostics)}`);
    }

    const boundedReversionEconomics = edgeHarness.bot.estimateEntryEconomics({
      context: {
        indicators: {
          emaBaseline: 100,
          emaFast: 100.02,
          emaSlow: 100,
          momentum: 0.02,
          rsi: 20,
          volatility: 0.01
        },
        strategyId: "rsiReversion"
      },
      price: 95,
      quantity: 1
    });
    if (boundedReversionEconomics.expectedGrossEdgePct > 0.02) {
      throw new Error(`reversion edge estimate should remain bounded during deep dislocations: ${boundedReversionEconomics.expectedGrossEdgePct}`);
    }

    const breakoutEconomics = createHarness(() => ({
      action: "buy",
      confidence: 0.88,
      reason: ["buy_signal"]
    }), {
      strategy: "breakout"
    }).bot.estimateEntryEconomics({
      context: {
        indicators: {
          emaBaseline: 100,
          emaFast: 100.2,
          emaSlow: 100,
          momentum: 0.6,
          rsi: 61,
          volatility: 0.02
        },
        strategyId: "breakout"
      },
      price: 100,
      quantity: 1
    });
    if (Math.abs(breakoutEconomics.expectedGrossEdgePct - 0.0022) > 1e-12) {
      throw new Error(`breakout edge estimate regressed from the generic/default formula: ${breakoutEconomics.expectedGrossEdgePct}`);
    }
    if (breakoutEconomics.minExpectedNetEdgePct !== 0.0005) {
      throw new Error(`breakout should keep the default minExpectedNetEdgePct: ${breakoutEconomics.minExpectedNetEdgePct}`);
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
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }
  }
}

module.exports = {
  runTradingBotTests
};
