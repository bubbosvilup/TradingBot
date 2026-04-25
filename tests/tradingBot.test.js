"use strict";

const { TradingBot } = require("../src/bots/tradingBot.ts");
const { ExecutionEngine } = require("../src/engines/executionEngine.ts");
const { PerformanceMonitor } = require("../src/roles/performanceMonitor.ts");
const { RiskManager } = require("../src/roles/riskManager.ts");
const { StrategySwitcher } = require("../src/roles/strategySwitcher.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { SystemServer } = require("../src/core/systemServer.ts");
const { UserStream } = require("../src/streams/userStream.ts");
const { WSManager } = require("../src/core/wsManager.ts");
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
  const clock = options.clock || { now: () => Date.now() };
  const store = options.store || new StateStore({ clock });
  const config = {
    allowedStrategies: options.allowedStrategies || ["testStrategy"],
    enabled: true,
    id: "bot_test",
    initialBalanceUsdt: options.initialBalanceUsdt ?? 1000,
    maxArchitectStateAgeMs: options.maxArchitectStateAgeMs,
    mtf: options.mtfConfig,
    postLossArchitectLatchPublishesRequired: options.postLossArchitectLatchPublishesRequired,
    postLossLatchMaxMs: options.postLossLatchMaxMs,
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
  store.setMarketDataFreshness(config.symbol, {
    lastTickTimestamp: Date.now(),
    status: "fresh",
    updatedAt: Date.now()
  });

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
    clock,
    feeRate: 0.001,
    logger: logger.child("execution"),
    store,
    userStream: new UserStream({
      logger: logger.child("user"),
      store,
      wsManager: options.userStreamWsManager || {
        publish() {},
        subscribe() {
          return () => {};
        }
      }
    })
  });

  const bot = new TradingBot(config, {
    clock,
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
    executionEngine,
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
  const testDefaultLogType = "verbose";
  process.env.LOG_TYPE = testDefaultLogType;
  let clock = 1_000_000;
  Date.now = () => clock;

  try {
    let fakeNow = 2_000_000;
    const fakeClock = { now: () => fakeNow };
    const clockedHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.5,
      reason: ["neutral_signal"]
    }), {
      clock: fakeClock,
      strategy: "emaCross"
    });
    clockedHarness.bot.onMarketTick({
      price: 100,
      source: "mock",
      symbol: "BTC/USDT",
      timestamp: 1_000_000
    });
    const clockedPipeline = clockedHarness.store.getPipelineSnapshot("BTC/USDT");
    const clockedState = clockedHarness.store.getBotState("bot_test");
    if (clockedPipeline?.lastBotStartedAt !== 2_000_000 || clockedState?.lastEvaluationAt !== 2_000_000) {
      throw new Error(`bot runtime lifecycle timestamps should use injected clock, not tick timestamp: ${JSON.stringify({ clockedPipeline, clockedState })}`);
    }

    let throwingStrategyCalls = 0;
    const throwingStrategyHarness = createHarness(() => {
      throwingStrategyCalls += 1;
      if (throwingStrategyCalls === 1) {
        throw new Error("fixture_strategy_failure");
      }
      return {
        action: "buy",
        confidence: 0.93,
        reason: ["buy_signal"]
      };
    }, {
      strategy: "emaCross"
    });
    throwingStrategyHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (throwingStrategyHarness.store.getPosition("bot_test")) {
      throw new Error("throwing strategy should not open a position on the failed tick");
    }
    const strategyErrorState = throwingStrategyHarness.store.getBotState("bot_test");
    if (strategyErrorState?.lastDecision !== "hold" || !strategyErrorState?.lastDecisionReasons?.includes("strategy_error")) {
      throw new Error(`throwing strategy should record a safe strategy_error hold decision: ${JSON.stringify(strategyErrorState)}`);
    }
    const strategyErrorLog = throwingStrategyHarness.botLogs.find((entry) =>
      entry.message === "strategy_evaluate_failed"
      && entry.metadata.reason === "strategy_error"
      && entry.metadata.errorKind === "strategy"
      && entry.metadata.errorCode === "strategy_evaluate_failed"
      && entry.metadata.recoverable === true
      && String(entry.metadata.errorMessage || "").includes("fixture_strategy_failure")
    );
    if (!strategyErrorLog) {
      throw new Error(`throwing strategy should be logged with structured strategy_evaluate_failed metadata: ${JSON.stringify(throwingStrategyHarness.botLogs)}`);
    }
    throwingStrategyHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock + 1_000 });
    throwingStrategyHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock + 2_000 });
    if (!throwingStrategyHarness.store.getPosition("bot_test")) {
      throw new Error("bot should continue processing later ticks after a strategy.evaluate failure");
    }

    const normalExitHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.5,
      reason: ["neutral_signal"]
    }), {
      strategy: "emaCross"
    });
    const structuredClassificationHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.5,
      reason: ["neutral_signal"]
    }), {
      strategy: "rsiReversion"
    });
    const structuredFailedRsiClassification = structuredClassificationHarness.bot.classifyClosedTrade(
      { netPnl: -0.25, exitReason: ["unrelated_reason"] },
      { exitMechanism: "qualification", lifecycleEvent: "FAILED_RSI_EXIT" }
    );
    if (structuredFailedRsiClassification.closeClassification !== "failed_rsi_exit"
      || structuredFailedRsiClassification.failedRsiExit !== true
      || structuredFailedRsiClassification.rsiExit !== true) {
      throw new Error(`FAILED_RSI_EXIT should classify from structured exit metadata even without matching reason strings: ${JSON.stringify(structuredFailedRsiClassification)}`);
    }
    const structuredConfirmedRsiClassification = structuredClassificationHarness.bot.classifyClosedTrade(
      { netPnl: 0.15, exitReason: ["rsi_exit_confirmed"] },
      { exitMechanism: "qualification", lifecycleEvent: "RSI_EXIT_HIT" }
    );
    if (structuredConfirmedRsiClassification.closeClassification !== "confirmed_exit"
      || structuredConfirmedRsiClassification.failedRsiExit !== false
      || structuredConfirmedRsiClassification.rsiExit !== true) {
      throw new Error(`RSI_EXIT_HIT should remain a confirmed RSI exit from structured metadata with minimal reason fallback for the ambiguous qualification subcase: ${JSON.stringify(structuredConfirmedRsiClassification)}`);
    }
    const structuredProtectiveClassification = structuredClassificationHarness.bot.classifyClosedTrade(
      { netPnl: -0.4, exitReason: ["unrelated_reason"] },
      { exitMechanism: "protection", lifecycleEvent: "PROTECTIVE_STOP_HIT" }
    );
    if (structuredProtectiveClassification.closeClassification !== "confirmed_exit"
      || structuredProtectiveClassification.failedRsiExit !== false
      || structuredProtectiveClassification.rsiExit !== false) {
      throw new Error(`PROTECTIVE_STOP_HIT should not be inferred as an RSI exit from unrelated reason strings: ${JSON.stringify(structuredProtectiveClassification)}`);
    }
    const structuredInvalidationClassification = structuredClassificationHarness.bot.classifyClosedTrade(
      { netPnl: -0.1, exitReason: ["unrelated_reason"] },
      { exitMechanism: "invalidation", lifecycleEvent: "REGIME_INVALIDATION" }
    );
    if (structuredInvalidationClassification.closeClassification !== "confirmed_exit"
      || structuredInvalidationClassification.failedRsiExit !== false
      || structuredInvalidationClassification.rsiExit !== false) {
      throw new Error(`REGIME_INVALIDATION should remain a confirmed non-RSI exit from structured metadata: ${JSON.stringify(structuredInvalidationClassification)}`);
    }
    const structuredTimeoutClassification = structuredClassificationHarness.bot.classifyClosedTrade(
      { netPnl: 0.05, exitReason: ["unrelated_reason"] },
      { exitMechanism: "recovery", lifecycleEvent: "RECOVERY_TIMEOUT" }
    );
    if (structuredTimeoutClassification.closeClassification !== "confirmed_exit"
      || structuredTimeoutClassification.failedRsiExit !== false
      || structuredTimeoutClassification.rsiExit !== false) {
      throw new Error(`RECOVERY_TIMEOUT should remain a confirmed recovery exit from structured metadata: ${JSON.stringify(structuredTimeoutClassification)}`);
    }
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

    const closeRejectHarness = createHarness(() => ({
      action: "sell",
      confidence: 0.9,
      reason: ["exit_signal"]
    }), {
      strategy: "emaCross"
    });
    const closeRejectProfile = closeRejectHarness.bot.deps.riskManager.getProfile(closeRejectHarness.config.riskProfile);
    closeRejectHarness.store.setPosition("bot_test", createPosition({
      openedAt: clock - closeRejectProfile.minHoldMs - 1_000,
      quantity: 1,
      strategyId: "emaCross"
    }));
    closeRejectHarness.store.updateBotState("bot_test", {
      exitSignalStreak: Math.max(closeRejectProfile.exitConfirmationTicks - 1, 0)
    });
    closeRejectHarness.executionEngine.closePosition = () => ({
      ok: false,
      error: {
        kind: "execution",
        code: "position_not_found",
        message: "fixture close rejected",
        recoverable: true
      }
    });
    closeRejectHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!closeRejectHarness.store.getPosition("bot_test") || closeRejectHarness.store.getClosedTrades("bot_test").length !== 0) {
      throw new Error("failed closePosition should leave the open position unchanged and avoid recording a closed trade");
    }
    const closeRejectedLog = closeRejectHarness.botLogs.find((entry) =>
      entry.message === "RISK_CHANGE"
      && entry.metadata.status === "position_close_rejected"
    );
    if (!closeRejectedLog || closeRejectedLog.metadata.reason !== "position_not_found" || closeRejectedLog.metadata.errorKind !== "execution" || closeRejectedLog.metadata.positionId !== "pos-test" || closeRejectedLog.metadata.tickPrice !== 100.2) {
      throw new Error(`closePosition error result should emit explicit operator-visible failure telemetry: ${JSON.stringify(closeRejectedLog)}`);
    }

    process.env.LOG_TYPE = "strategy_debug";
    const closeSnapshotHarness = createHarness(() => ({
      action: "sell",
      confidence: 0.9,
      reason: ["exit_signal"]
    }), {
      strategy: "emaCross"
    });
    const closeSnapshotProfile = closeSnapshotHarness.bot.deps.riskManager.getProfile(closeSnapshotHarness.config.riskProfile);
    closeSnapshotHarness.store.setPosition("bot_test", createPosition({
      openedAt: clock - closeSnapshotProfile.minHoldMs - 1_000,
      quantity: 1,
      strategyId: "emaCross"
    }));
    closeSnapshotHarness.store.updateBotState("bot_test", {
      exitSignalStreak: Math.max(closeSnapshotProfile.exitConfirmationTicks - 1, 0)
    });
    const originalClosePosition = closeSnapshotHarness.executionEngine.closePosition.bind(closeSnapshotHarness.executionEngine);
    closeSnapshotHarness.executionEngine.closePosition = (params) => {
      const livePosition = closeSnapshotHarness.store.getPosition("bot_test");
      livePosition.lifecycleMode = "managed_recovery";
      livePosition.lifecycleState = "MANAGED_RECOVERY";
      livePosition.managedRecoveryStartedAt = clock - 10_000;
      livePosition.notes.push("mutated_during_close");
      return originalClosePosition(params);
    };
    closeSnapshotHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const closeSnapshotTrade = closeSnapshotHarness.store.getClosedTrades("bot_test")[0];
    if (!closeSnapshotTrade || closeSnapshotHarness.store.getPosition("bot_test")) {
      throw new Error(`defensive position snapshot should not change successful close execution: ${JSON.stringify(closeSnapshotTrade)}`);
    }
    const closeSnapshotTradeClosedLog = closeSnapshotHarness.botLogs.find((entry) => entry.message === "trade_closed");
    if (!closeSnapshotTradeClosedLog || closeSnapshotTradeClosedLog.metadata.positionStatus !== "ACTIVE" || closeSnapshotTradeClosedLog.metadata.timeoutRemainingMs !== null) {
      throw new Error(`exit telemetry should use the pre-close defensive position snapshot, not later store mutations: ${JSON.stringify(closeSnapshotTradeClosedLog)}`);
    }
    process.env.LOG_TYPE = testDefaultLogType;

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
    if (!deferredRsiPlan.exitNow || deferredRsiPlan.transition !== undefined || deferredRsiPlan.lifecycleEvent !== "RSI_EXIT_HIT" || deferredRsiPlan.exitMechanism !== "qualification" || !deferredRsiPlan.reason.includes("rsi_exit_floor_failed") || deferredRsiPlan.nextPosition) {
      throw new Error(`rsiReversion should skip managed recovery when net pnl is below the RSI exit floor: ${JSON.stringify(deferredRsiPlan)}`);
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

    const disabledRsiHarness = createHarness(() => ({
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
          exitPolicy: {
            qualification: {
              rsiThresholdExit: false
            }
          }
        }
      }
    });
    disabledRsiHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.8,
      entryPrice: 100,
      id: "pos-disabled-rsi",
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
    disabledRsiHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    disabledRsiHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (disabledRsiHarness.store.getClosedTrades("bot_test").length !== 0 || !disabledRsiHarness.store.getPosition("bot_test")) {
      throw new Error("disabled rsiThresholdExit should prevent RSI-threshold closes entirely");
    }

    const pausedEntryHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"]
    }));
    pausedEntryHarness.bot.pause("manual_pause");
    pausedEntryHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    pausedEntryHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock + 1_000 });
    if (pausedEntryHarness.store.getPosition("bot_test")) {
      throw new Error("paused bot should not open new trades while paused");
    }

    const pausedExitHarness = createHarness(() => ({
      action: "sell",
      confidence: 0.9,
      reason: ["exit_signal"]
    }), {
      strategy: "emaCross"
    });
    const pausedExitProfile = pausedExitHarness.bot.deps.riskManager.getProfile(pausedExitHarness.config.riskProfile);
    pausedExitHarness.store.setPosition("bot_test", createPosition({
      openedAt: clock - pausedExitProfile.minHoldMs - 1_000,
      quantity: 1,
      strategyId: "emaCross"
    }));
    pausedExitHarness.store.updateBotState("bot_test", {
      exitSignalStreak: pausedExitProfile.exitConfirmationTicks,
      pausedReason: "manual_pause",
      status: "paused"
    });
    pausedExitHarness.bot.onMarketTick({ price: 100.2, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const pausedExitTrade = pausedExitHarness.store.getClosedTrades("bot_test")[0];
    if (!pausedExitTrade || pausedExitHarness.store.getPosition("bot_test")) {
      throw new Error(`paused bot should still be able to close an existing position: ${JSON.stringify(pausedExitTrade)}`);
    }
    const pausedExitState = pausedExitHarness.store.getBotState("bot_test");
    if (pausedExitState.status !== "paused" || pausedExitState.pausedReason !== "manual_pause") {
      throw new Error(`paused close should preserve a coherent paused state instead of paused+null: ${JSON.stringify(pausedExitState)}`);
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
    const debounceState = holdHarness.store.getBotState("bot_test");
    if (debounceState.entryEvaluationsCount !== 1 || debounceState.entrySkippedCount !== 1) {
      throw new Error(`entry evaluation counters should track debounce_not_satisfied skips: ${JSON.stringify(debounceState)}`);
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
    if (profitTrade.closedAt !== clock) {
      throw new Error(`profit close should use the triggering tick timestamp as closedAt: ${JSON.stringify(profitTrade)}`);
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

    const safePublishLogs = [];
    const throwingUserStreamWsManager = new WSManager({
      logger: {
        info(event, metadata) {
          safePublishLogs.push({ event, metadata });
        },
        warn(event, metadata) {
          safePublishLogs.push({ event, metadata });
        },
        error(event, metadata) {
          safePublishLogs.push({ event, metadata });
        }
      }
    });
    throwingUserStreamWsManager.subscribe("user:events", () => {
      throw new Error("user listener exploded");
    });
    const safeOpenHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "hold" : "buy",
      confidence: 0.9,
      reason: ["entry_signal"]
    }), {
      strategy: "emaCross",
      userStreamWsManager: throwingUserStreamWsManager
    });
    const safeOpenInitialBalance = safeOpenHarness.store.getBotState("bot_test").availableBalanceUsdt;
    safeOpenHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    safeOpenHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const safeOpenPosition = safeOpenHarness.store.getPosition("bot_test");
    const safeOpenState = safeOpenHarness.store.getBotState("bot_test");
    if (!safeOpenPosition) {
      throw new Error("throwing user-stream listener should not prevent position open from completing");
    }
    assertClose(
      safeOpenState.availableBalanceUsdt,
      safeOpenInitialBalance - (safeOpenPosition.entryPrice * safeOpenPosition.quantity),
      "throwing user-stream listener should not prevent entry accounting from reserving balance"
    );
    if (safeOpenState.lastExecutionAt !== safeOpenPosition.openedAt || safeOpenState.lastTradeAt !== clock) {
      throw new Error(`throwing user-stream listener should not prevent entry runtime state patch: ${JSON.stringify(safeOpenState)}`);
    }
    if (!safePublishLogs.find((entry) => entry.event === "ws_publish_listener_failed" && entry.metadata.channel === "user:events")) {
      throw new Error(`throwing user-stream listener should be logged during open: ${JSON.stringify(safePublishLogs)}`);
    }

    clock += 10_000;
    const shortAccountingHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "buy" : "sell",
      confidence: 0.9,
      reason: [context.hasOpenPosition ? "cover_signal" : "bearish_cross_confirmed"],
      side: "short"
    }), {
      indicatorSnapshot: {
        emaBaseline: 101,
        emaFast: 98.5,
        emaSlow: 100,
        momentum: -1.5,
        rsi: 42,
        volatility: 1.2
      },
      strategy: "emaCross"
    });
    const shortInitialState = shortAccountingHarness.store.getBotState("bot_test");
    const shortInitialBalance = shortInitialState.availableBalanceUsdt;
    shortAccountingHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    shortAccountingHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const shortPosition = shortAccountingHarness.store.getPosition("bot_test");
    if (!shortPosition || shortPosition.side !== "short") {
      throw new Error(`short scenario should open a short position: ${JSON.stringify(shortPosition)}`);
    }
    const shortEntryNotional = shortPosition.entryPrice * shortPosition.quantity;
    const shortOpenState = shortAccountingHarness.store.getBotState("bot_test");
    assertClose(
      shortOpenState.availableBalanceUsdt,
      shortInitialBalance - shortEntryNotional,
      "short open should reserve entry notional from available balance"
    );
    clock += 1_000;
    shortAccountingHarness.bot.onMarketTick({ price: 99, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!shortAccountingHarness.store.getPosition("bot_test")) {
      throw new Error("short scenario should still hold before minimum hold time");
    }
    clock += 16_000;
    shortAccountingHarness.bot.onMarketTick({ price: 98, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const shortTrade = shortAccountingHarness.store.getClosedTrades("bot_test")[0];
    const shortClosedState = shortAccountingHarness.store.getBotState("bot_test");
    if (!shortTrade || shortTrade.side !== "short" || !(shortTrade.netPnl > 0)) {
      throw new Error(`short scenario should close a profitable short trade: ${JSON.stringify(shortTrade)}`);
    }
    const expectedShortFees = ((shortTrade.entryPrice * shortTrade.quantity) + (shortTrade.exitPrice * shortTrade.quantity)) * 0.001;
    const expectedShortGrossPnl = (shortTrade.entryPrice - shortTrade.exitPrice) * shortTrade.quantity;
    const expectedShortNetPnl = expectedShortGrossPnl - expectedShortFees;
    assertClose(shortTrade.fees, expectedShortFees, "short close should charge round-trip fees");
    assertClose(shortTrade.pnl, expectedShortGrossPnl, "short close should store directional gross pnl");
    assertClose(shortTrade.netPnl, expectedShortNetPnl, "short close should store directional net pnl after fees");
    assertClose(
      shortClosedState.availableBalanceUsdt,
      shortInitialBalance + shortTrade.netPnl,
      "short close should restore reserved capital plus directional net pnl"
    );

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
    const lossLastExecutionWrites = [];
    const originalLossUpdateBotState = lossAccountingHarness.store.updateBotState.bind(lossAccountingHarness.store);
    lossAccountingHarness.store.updateBotState = (botId, patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "lastExecutionAt")) {
        lossLastExecutionWrites.push({
          botId,
          patch: { ...patch }
        });
      }
      return originalLossUpdateBotState(botId, patch);
    };
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
    if (lossLastExecutionWrites.length !== 1 || lossLastExecutionWrites[0].patch.lastExecutionAt !== clock) {
      throw new Error(`closed trade path should write lastExecutionAt once via outcome statePatch: ${JSON.stringify(lossLastExecutionWrites)}`);
    }
    if (lossClosedState.cooldownReason !== "loss_cooldown" || lossClosedState.cooldownUntil !== clock + 75_000) {
      throw new Error(`loss close should apply the medium-profile loss cooldown in a single state update: ${JSON.stringify(lossClosedState)}`);
    }
    if (lossClosedState.lastTradeAt !== clock || lossClosedState.lastExecutionAt !== clock || lossClosedState.entrySignalStreak !== 0 || lossClosedState.exitSignalStreak !== 0) {
      throw new Error(`loss close should update accounting and runtime state coherently on the closing tick: ${JSON.stringify(lossClosedState)}`);
    }
    const lossPipeline = lossAccountingHarness.store.getPipelineSnapshot("BTC/USDT");
    if (!lossPipeline || lossPipeline.lastExecutionAt !== clock || lossPipeline.botToExecutionMs !== 0) {
      throw new Error(`closed trade path should preserve pipeline execution metadata: ${JSON.stringify(lossPipeline)}`);
    }

    const safeCloseLogs = [];
    const throwingCloseUserStreamWsManager = new WSManager({
      logger: {
        info(event, metadata) {
          safeCloseLogs.push({ event, metadata });
        },
        warn(event, metadata) {
          safeCloseLogs.push({ event, metadata });
        },
        error(event, metadata) {
          safeCloseLogs.push({ event, metadata });
        }
      }
    });
    throwingCloseUserStreamWsManager.subscribe("user:events", () => {
      throw new Error("close listener exploded");
    });
    const safeCloseHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.9,
      reason: [context.hasOpenPosition ? "stop_signal" : "entry_signal"]
    }), {
      strategy: "emaCross",
      userStreamWsManager: throwingCloseUserStreamWsManager
    });
    const safeCloseInitialBalance = safeCloseHarness.store.getBotState("bot_test").availableBalanceUsdt;
    safeCloseHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    safeCloseHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const safeClosePosition = safeCloseHarness.store.getPosition("bot_test");
    if (!safeClosePosition) {
      throw new Error("safe close regression scenario did not open a position");
    }
    clock += 1_000;
    safeCloseHarness.bot.onMarketTick({ price: 99.95, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 20_000;
    safeCloseHarness.bot.onMarketTick({ price: 99.8, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const safeCloseTrade = safeCloseHarness.store.getClosedTrades("bot_test")[0];
    const safeCloseState = safeCloseHarness.store.getBotState("bot_test");
    if (safeCloseHarness.store.getPosition("bot_test")) {
      throw new Error("throwing user-stream listener should not prevent close from clearing position");
    }
    if (!safeCloseTrade || !(safeCloseTrade.netPnl < 0)) {
      throw new Error(`throwing user-stream listener close scenario should record a loss trade: ${JSON.stringify(safeCloseTrade)}`);
    }
    assertClose(
      safeCloseState.realizedPnl,
      safeCloseTrade.netPnl,
      "throwing user-stream listener should not prevent realizedPnl update"
    );
    assertClose(
      safeCloseState.availableBalanceUsdt,
      safeCloseInitialBalance + safeCloseTrade.netPnl,
      "throwing user-stream listener should not prevent close accounting from restoring balance"
    );
    if (safeCloseState.lossStreak !== 1 || safeCloseState.cooldownReason !== "loss_cooldown" || safeCloseState.postLossArchitectLatchActive !== true) {
      throw new Error(`throwing user-stream listener should not prevent loss recovery state patch: ${JSON.stringify(safeCloseState)}`);
    }
    if (!safeCloseLogs.find((entry) => entry.event === "ws_publish_listener_failed" && entry.metadata.channel === "user:events")) {
      throw new Error(`throwing user-stream listener should be logged during close: ${JSON.stringify(safeCloseLogs)}`);
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
    if (strategyDebugSetups.length !== 0) {
      throw new Error(`strategy_debug should not emit compact entry SETUP chatter, found ${strategyDebugSetups.length}`);
    }
    if (strategyDebugBlockChanges.length !== 0) {
      throw new Error(`strategy_debug should not emit compact entry BLOCK_CHANGE chatter, found ${strategyDebugBlockChanges.length}`);
    }
    process.env.LOG_TYPE = testDefaultLogType;

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
    const strategyDebugTradeClosedLog = strategyDebugSellHarness.botLogs.find((entry) => entry.message === "trade_closed");
    const strategyDebugSellLog = strategyDebugSellHarness.botLogs.find((entry) => entry.message === "SELL");
    if (!strategyDebugTradeClosedLog || !String(strategyDebugTradeClosedLog.metadata.closeReason || "").includes("rsi_exit_confirmed")) {
      throw new Error(`strategy_debug trade_closed log should preserve the explicit exit reason: ${JSON.stringify(strategyDebugTradeClosedLog)}`);
    }
    if (!strategyDebugTradeClosedLog || strategyDebugTradeClosedLog.metadata.entryPrice !== 100 || strategyDebugTradeClosedLog.metadata.exitPrice !== 100.4 || strategyDebugTradeClosedLog.metadata.grossPnl !== 0.2 || strategyDebugTradeClosedLog.metadata.fees !== 0.1002 || strategyDebugTradeClosedLog.metadata.netPnl !== 0.0998) {
      throw new Error(`strategy_debug trade_closed log should expose structured PnL fields: ${JSON.stringify(strategyDebugTradeClosedLog)}`);
    }
    if (strategyDebugTradeClosedLog.metadata.policyId !== "RSI_REVERSION_PRO" || strategyDebugTradeClosedLog.metadata.positionStatus !== "EXITING" || strategyDebugTradeClosedLog.metadata.exitEvent !== "rsi_exit_confirmed" || strategyDebugTradeClosedLog.metadata.exitMechanism !== "qualification" || strategyDebugTradeClosedLog.metadata.lifecycleEvent !== "RSI_EXIT_HIT" || strategyDebugTradeClosedLog.metadata.signalTimestamp !== clock || strategyDebugTradeClosedLog.metadata.executionTimestamp !== clock || strategyDebugTradeClosedLog.metadata.signalToExecutionMs !== 0) {
      throw new Error(`strategy_debug trade_closed log should expose exit policy and timing diagnostics: ${JSON.stringify(strategyDebugTradeClosedLog)}`);
    }
    if (!strategyDebugSellLog || strategyDebugSellLog.metadata.entryPrice !== undefined || strategyDebugSellLog.metadata.policyId !== undefined || strategyDebugSellLog.metadata.netPnl !== undefined) {
      throw new Error(`strategy_debug SELL log should stay compact after canonical trade_closed emission: ${JSON.stringify(strategyDebugSellLog)}`);
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
    process.env.LOG_TYPE = testDefaultLogType;

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
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          maxTargetDistancePctForShortHorizon: 0.02
        }
      }
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
    const failedRsiTradeClosedLog = failedRsiExitHarness.botLogs.find((entry) => entry.message === "trade_closed" && entry.metadata.closeClassification === "failed_rsi_exit");
    if (!failedRsiTradeClosedLog || !String(failedRsiTradeClosedLog.metadata.closeReason || "").includes("rsi_exit_confirmed")) {
      throw new Error(`negative RSI exit should emit canonical trade_closed causality: ${JSON.stringify(failedRsiTradeClosedLog)}`);
    }
    const failedRsiSellLog = failedRsiExitHarness.botLogs.find((entry) => entry.message === "SELL" && entry.metadata.closeClassification === "failed_rsi_exit");
    if (!failedRsiSellLog || failedRsiSellLog.metadata.netPnl !== undefined || !String(failedRsiSellLog.metadata.closeReason || "").includes("rsi_exit_confirmed")) {
      throw new Error(`negative RSI exit SELL log should carry failed_rsi_exit classification and rsi_exit_confirmed reason: ${JSON.stringify(failedRsiSellLog)}`);
    }
    if (!failedRsiState.postLossArchitectLatchActive || failedRsiState.postLossArchitectLatchStrategyId !== "rsiReversion") {
      throw new Error(`negative RSI exit should activate the post-loss architect latch: ${JSON.stringify(failedRsiState)}`);
    }
    if (!failedRsiExitHarness.botLogs.find((entry) => entry.message === "post_loss_architect_latch_activated")) {
      throw new Error("negative RSI exit should activate the same post-loss defensive latch flow");
    }
    process.env.LOG_TYPE = testDefaultLogType;

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
    const skippedRecoveryTrade = managedRecoveryHarness.store.getClosedTrades("bot_test")[0];
    if (!skippedRecoveryTrade || !skippedRecoveryTrade.exitReason.includes("rsi_exit_floor_failed")) {
      throw new Error(`weak RSI exit should skip managed recovery and close immediately: ${JSON.stringify(skippedRecoveryTrade)}`);
    }
    if (managedRecoveryHarness.store.getPosition("bot_test")) {
      throw new Error("weak RSI floor-failed exit should not leave a managed recovery position open");
    }
    if (managedRecoveryHarness.botLogs.find((entry) => entry.message === "rsi_exit_deferred")) {
      throw new Error("below-floor RSI exit should no longer emit managed recovery defer logs");
    }
    process.env.LOG_TYPE = testDefaultLogType;

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
    if (!managedRecoveryExitedLog || managedRecoveryExitedLog.metadata.positionStatus !== undefined || managedRecoveryExitedLog.metadata.exitEvent !== "reversion_price_target_hit" || managedRecoveryExitedLog.metadata.exitMechanism !== "recovery" || managedRecoveryExitedLog.metadata.lifecycleEvent !== "PRICE_TARGET_HIT") {
      throw new Error(`managed recovery exit log should expose recovery exit telemetry: ${JSON.stringify(managedRecoveryExitedLog)}`);
    }
    const managedRecoveryTradeClosedLog = managedRecoveryTargetHarness.botLogs.find((entry) => entry.message === "trade_closed" && entry.metadata.exitMechanism === "recovery");
    if (!managedRecoveryTradeClosedLog || managedRecoveryTradeClosedLog.metadata.positionStatus !== "EXITING") {
      throw new Error(`managed recovery should keep canonical detailed exit telemetry on trade_closed: ${JSON.stringify(managedRecoveryTradeClosedLog)}`);
    }

    clock += 10_000;
    const managedRecoveryTargetDisabledHarness = createHarness(() => ({
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
          exitPolicy: {
            recovery: {
              priceTargetExit: false
            }
          }
        }
      }
    });
    managedRecoveryTargetDisabledHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.84,
      entryPrice: 100,
      id: "pos-managed-target-disabled",
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
    managedRecoveryTargetDisabledHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 0
    });
    managedRecoveryTargetDisabledHarness.bot.onMarketTick({ price: 101.6, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    managedRecoveryTargetDisabledHarness.bot.onMarketTick({ price: 101.6, source: "mock", symbol: "BTC/USDT", timestamp: clock + 1_000 });
    if (!managedRecoveryTargetDisabledHarness.store.getPosition("bot_test") || managedRecoveryTargetDisabledHarness.store.getClosedTrades("bot_test").length !== 0) {
      throw new Error("disabled priceTargetExit should prevent managed recovery target closes");
    }
    if (managedRecoveryTargetDisabledHarness.botLogs.find((entry) =>
      (entry.message === "managed_recovery_exited" || entry.message === "SELL")
      && (entry.metadata.lifecycleEvent === "PRICE_TARGET_HIT" || entry.metadata.exitMechanism === "recovery" || String(entry.metadata.closeReason || "").includes("reversion_price_target_hit"))
    )) {
      throw new Error("disabled priceTargetExit should not surface recovery classification downstream");
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
      publishIntervalMs: 30_000,
      ready: true
    });
    managedRecoveryInvalidationHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const earlyInvalidationTrade = managedRecoveryInvalidationHarness.store.getClosedTrades("bot_test")[0];
    if (earlyInvalidationTrade || !managedRecoveryInvalidationHarness.store.getPosition("bot_test")) {
      throw new Error(`single early mismatch should not invalidate managed recovery during grace: ${JSON.stringify(earlyInvalidationTrade)}`);
    }

    const confirmedInvalidationHarness = createHarness(() => ({
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
    confirmedInvalidationHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.84,
      entryPrice: 100,
      id: "pos-managed-confirmed-invalidation",
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: clock - 10_000,
      notes: ["oversold_mean_reversion"],
      openedAt: clock - 70_000,
      quantity: 0.5,
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    confirmedInvalidationHarness.store.setArchitectPublishedAssessment("BTC/USDT", createTrendArchitect({
      updatedAt: clock
    }));
    confirmedInvalidationHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...confirmedInvalidationHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: clock,
      publishIntervalMs: 30_000,
      ready: true
    });
    confirmedInvalidationHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const invalidationTrade = confirmedInvalidationHarness.store.getClosedTrades("bot_test")[0];
    if (!invalidationTrade || !invalidationTrade.exitReason.includes("regime_invalidation_exit")) {
      throw new Error(`aged managed recovery should exit on confirmed architect invalidation: ${JSON.stringify(invalidationTrade)}`);
    }
    const invalidationLog = confirmedInvalidationHarness.botLogs.find((entry) => entry.message === "managed_recovery_exited");
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
      strategy: "rsiReversion",
      strategyConfigById: {
        rsiReversion: {
          maxTargetDistancePctForShortHorizon: 0.02
        }
      }
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
    if (!protectiveStopSellLog || protectiveStopSellLog.metadata.exitMechanism !== "protection" || protectiveStopSellLog.metadata.protectionMode !== "fixed_pct" || protectiveStopSellLog.metadata.lifecycleEvent !== "PROTECTIVE_STOP_HIT" || protectiveStopSellLog.metadata.netPnl !== undefined) {
      throw new Error(`protective stop exits should log explicit protection telemetry: ${JSON.stringify(protectiveStopSellLog)}`);
    }
    if (!postLossState.postLossArchitectLatchActive || postLossState.postLossArchitectLatchFreshPublishCount !== 0 || postLossState.postLossArchitectLatchStrategyId !== "rsiReversion") {
      throw new Error(`loss close should activate the architect latch: ${JSON.stringify(postLossState)}`);
    }
    if (!postLossLatchHarness.botLogs.find((entry) => entry.message === "post_loss_architect_latch_activated")) {
      throw new Error("missing post_loss_architect_latch_activated log on losing close");
    }
    process.env.LOG_TYPE = testDefaultLogType;

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
    if (!postLossBlockedLog || Object.keys(postLossBlockedLog.metadata).some((key) => key !== "reason" && key !== "botId" && key !== "symbol")) {
      throw new Error(`post-loss architect latch blocked log should stay compact and transition-only: ${JSON.stringify(postLossBlockedLog)}`);
    }
    if (postLossBlockedState.postLossArchitectLatchFreshPublishCount !== 0) {
      throw new Error("stale architect state should not increment the post-loss architect latch");
    }

    const latchSwitchHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.95,
      reason: [context.hasOpenPosition ? "stop_signal" : "post_switch_entry_signal"]
    }), {
      allowedStrategies: ["rsiReversion", "emaCross"],
      postLossArchitectLatchPublishesRequired: 1,
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion",
      strategySwitcher: new StrategySwitcher({
        resolveStrategyFamily: resolveTestStrategyFamily
      })
    });
    latchSwitchHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.9,
      entryPrice: 100,
      id: "pos-loss-latch-switch",
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
    latchSwitchHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    latchSwitchHarness.bot.onMarketTick({ price: 99, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const latchSwitchClosedTrade = latchSwitchHarness.store.getClosedTrades("bot_test")[0];
    if (!latchSwitchClosedTrade || !(latchSwitchClosedTrade.netPnl < 0)) {
      throw new Error("strategy-switch latch scenario should start from a real losing close");
    }
    latchSwitchHarness.store.setArchitectPublishedAssessment("BTC/USDT", createTrendArchitect({
      updatedAt: clock + 1_000
    }));
    latchSwitchHarness.store.updateBotState("bot_test", {
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 1
    });
    clock += 1_000;
    latchSwitchHarness.bot.onMarketTick({ price: 100.4, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const latchSwitchBlockedState = latchSwitchHarness.store.getBotState("bot_test");
    if (latchSwitchBlockedState.activeStrategyId !== "emaCross") {
      throw new Error(`flat bot should still be allowed to switch strategy while post-loss latch is active: ${JSON.stringify(latchSwitchBlockedState)}`);
    }
    if (latchSwitchHarness.store.getPosition("bot_test")) {
      throw new Error("post-loss latch should block entry even after switching to a different strategy");
    }
    if (!latchSwitchHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "post_loss_architect_latch")) {
      throw new Error(`strategy-switched latch should still report post_loss_architect_latch block: ${JSON.stringify(latchSwitchHarness.botLogs)}`);
    }
    latchSwitchHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...latchSwitchHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: latchSwitchClosedTrade.closedAt + 5_000,
      ready: true
    });
    latchSwitchHarness.store.updateBotState("bot_test", {
      entrySignalStreak: 1
    });
    clock += 1_000;
    latchSwitchHarness.bot.onMarketTick({ price: 100.6, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const latchSwitchReleasedState = latchSwitchHarness.store.getBotState("bot_test");
    if (latchSwitchReleasedState.postLossArchitectLatchActive || !latchSwitchHarness.store.getPosition("bot_test")) {
      throw new Error(`fresh publication should release switched-strategy latch and allow entry when other gates are clear: ${JSON.stringify(latchSwitchReleasedState)}`);
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

    clock += 10_000;
    const singleFreshPublishLatchHarness = createHarness(postLossStrategyEvaluate, {
      allowedStrategies: ["rsiReversion"],
      postLossArchitectLatchPublishesRequired: 1,
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    singleFreshPublishLatchHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.9,
      entryPrice: 100,
      id: "pos-loss-latch-single",
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
    singleFreshPublishLatchHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    singleFreshPublishLatchHarness.bot.onMarketTick({ price: 99, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const singlePublishClosedTrade = singleFreshPublishLatchHarness.store.getClosedTrades("bot_test")[0];
    if (!singlePublishClosedTrade || !(singlePublishClosedTrade.netPnl < 0)) {
      throw new Error("single fresh-publish latch scenario should still produce a real losing trade");
    }
    clock += 80_000;
    singleFreshPublishLatchHarness.store.updateBotState("bot_test", {
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 1
    });
    const singleFreshPublishAt = singlePublishClosedTrade.closedAt + 10_000;
    singleFreshPublishLatchHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...singleFreshPublishLatchHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: singleFreshPublishAt,
      ready: true
    });
    singleFreshPublishLatchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const singleFreshPublishState = singleFreshPublishLatchHarness.store.getBotState("bot_test");
    if (singleFreshPublishState.postLossArchitectLatchActive || singleFreshPublishState.postLossArchitectLatchFreshPublishCount !== 1) {
      throw new Error(`configured single fresh publish should release the latch immediately: ${JSON.stringify(singleFreshPublishState)}`);
    }
    if (singleFreshPublishLatchHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "post_loss_architect_latch")) {
      throw new Error("configured single fresh publish should not keep blocking on the post-loss architect latch");
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
    let latchWallClock = 9_000_000;
    const latchFakeClock = { now: () => latchWallClock };
    const timeoutLatchHarness = createHarness(postLossStrategyEvaluate, {
      allowedStrategies: ["rsiReversion"],
      clock: latchFakeClock,
      postLossArchitectLatchPublishesRequired: 2,
      postLossLatchMaxMs: 5_000,
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    timeoutLatchHarness.store.setPosition("bot_test", {
      botId: "bot_test",
      confidence: 0.9,
      entryPrice: 100,
      id: "pos-loss-latch-timeout",
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
    timeoutLatchHarness.store.updateBotState("bot_test", {
      activeStrategyId: "rsiReversion",
      exitSignalStreak: 1
    });
    timeoutLatchHarness.bot.onMarketTick({ price: 99, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const timeoutActivatedState = timeoutLatchHarness.store.getBotState("bot_test");
    if (timeoutActivatedState.postLossArchitectLatchStartedAt !== 9_000_000) {
      throw new Error(`post-loss latch start time should use injected runtime clock: ${JSON.stringify(timeoutActivatedState)}`);
    }
    latchWallClock += 5_000;
    clock += 80_000;
    timeoutLatchHarness.store.updateBotState("bot_test", {
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 1
    });
    timeoutLatchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const timeoutBlockedState = timeoutLatchHarness.store.getBotState("bot_test");
    if (timeoutLatchHarness.store.getPosition("bot_test")) {
      throw new Error("post-loss latch timeout should not allow automatic re-entry");
    }
    if (timeoutBlockedState.postLossArchitectLatchTimedOutAt !== 9_005_000
      || !timeoutBlockedState.postLossArchitectLatchActive
      || !timeoutBlockedState.lastDecisionReasons.includes("post_loss_latch_timeout_requires_operator")) {
      throw new Error(`timed-out latch should enter an operator-required terminal block state: ${JSON.stringify(timeoutBlockedState)}`);
    }
    if (!timeoutLatchHarness.botLogs.find((entry) =>
      entry.message === "entry_gate_blocked"
      && entry.metadata.blockReason === "post_loss_latch_timeout_requires_operator"
    )) {
      throw new Error(`timed-out latch should report the operator-required block reason in gate telemetry: ${JSON.stringify(timeoutLatchHarness.botLogs)}`);
    }
    timeoutLatchHarness.store.setArchitectPublisherState("BTC/USDT", {
      ...timeoutLatchHarness.store.getArchitectPublisherState("BTC/USDT"),
      lastPublishedAt: clock + 10_000,
      ready: true
    });
    latchWallClock += 1_000;
    clock += 1_000;
    timeoutLatchHarness.store.updateBotState("bot_test", {
      entrySignalStreak: 1
    });
    timeoutLatchHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const timeoutAfterFreshPublishState = timeoutLatchHarness.store.getBotState("bot_test");
    if (timeoutLatchHarness.store.getPosition("bot_test") || !timeoutAfterFreshPublishState.postLossArchitectLatchActive || timeoutAfterFreshPublishState.postLossArchitectLatchFreshPublishCount !== 0) {
      throw new Error(`timed-out latch should not auto-release on a later fresh architect publish: ${JSON.stringify(timeoutAfterFreshPublishState)}`);
    }

    const manualLatchResetLogs = [];
    const manualLatchResetServer = new SystemServer({
      executionMode: "paper",
      feedMode: "live",
      logger: {
        info(message, metadata) {
          manualLatchResetLogs.push({ message, metadata });
        }
      },
      port: 3111,
      startedAt: clock,
      store: timeoutLatchHarness.store
    });
    const manualLatchResetResponse = {
      body: null,
      headers: null,
      statusCode: null,
      end(payload) {
        this.body = payload;
      },
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      }
    };
    manualLatchResetServer.handleRequest({
      headers: { host: "127.0.0.1:3111" },
      method: "POST",
      url: "/api/bots/bot_test/reset-post-loss-latch"
    }, manualLatchResetResponse);
    const manualLatchResetPayload = JSON.parse(String(manualLatchResetResponse.body || "{}"));
    const manualLatchResetState = timeoutLatchHarness.store.getBotState("bot_test");
    if (manualLatchResetResponse.statusCode !== 200 || manualLatchResetPayload.action !== "manual_post_loss_latch_reset") {
      throw new Error(`manual post-loss latch reset endpoint should succeed explicitly: ${JSON.stringify({ manualLatchResetResponse, manualLatchResetPayload })}`);
    }
    if (manualLatchResetState.postLossArchitectLatchActive
      || manualLatchResetState.postLossArchitectLatchStartedAt !== null
      || manualLatchResetState.postLossArchitectLatchTimedOutAt !== null
      || manualLatchResetState.postLossArchitectLatchFreshPublishCount !== 0
      || manualLatchResetState.postLossArchitectLatchLastCountedPublishedAt !== null
      || manualLatchResetState.postLossArchitectLatchStrategyId !== null
      || manualLatchResetState.lastDecisionReasons.includes("post_loss_latch_timeout_requires_operator")) {
      throw new Error(`manual post-loss latch reset should clear latch state and timeout reason: ${JSON.stringify(manualLatchResetState)}`);
    }
    if (!manualLatchResetLogs.find((entry) => entry.message === "manual_post_loss_latch_reset" && entry.metadata?.botId === "bot_test")) {
      throw new Error(`manual post-loss latch reset should emit an operator-action log: ${JSON.stringify(manualLatchResetLogs)}`);
    }
    latchWallClock += 1_000;
    clock += 1_000;
    timeoutLatchHarness.store.updateBotState("bot_test", {
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 1,
      status: "running"
    });
    timeoutLatchHarness.bot.onMarketTick({ price: 100.5, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (!timeoutLatchHarness.store.getPosition("bot_test")) {
      throw new Error("manual post-loss latch reset should remove only the latch gate so entry can proceed when other gates are clear");
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
    if (switchedState.entryEvaluationsCount !== 1 || switchedState.entrySkippedCount !== 1) {
      throw new Error(`entry evaluation counters should track no_entry_signal skips: ${JSON.stringify(switchedState)}`);
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
    let dedupEvaluations = dedupHarness.botLogs.filter((entry) => entry.message === "entry_evaluated");
    if (dedupEvaluations.length !== 0) {
      throw new Error(`entry_evaluated logs should remain disabled, found ${dedupEvaluations.length} logs`);
    }
    clock += 31_000;
    dedupHarness.bot.onMarketTick({ price: 100.3, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    dedupEvaluations = dedupHarness.botLogs.filter((entry) => entry.message === "entry_evaluated");
    if (dedupEvaluations.length !== 0) {
      throw new Error(`entry_evaluated logs should stay disabled after sampling window, found ${dedupEvaluations.length} logs`);
    }
    const dedupState = dedupHarness.store.getBotState("bot_test");
    if (dedupState.entryEvaluationsCount !== 4 || dedupState.entryEvaluationLogsCount !== 0 || dedupState.entryBlockedCount !== 4) {
      throw new Error(`entry evaluation counters did not track deduped states correctly: ${JSON.stringify(dedupState)}`);
    }

    clock += 10_000;
    const architectReuseHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["no_trade"]
    }), {
      allowedStrategies: ["emaCross", "rsiReversion"],
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross",
      strategySwitcher: new StrategySwitcher({
        resolveStrategyFamily: resolveTestStrategyFamily
      })
    });
    let architectReuseCalls = 0;
    let firstArchitectState = null;
    const originalEvaluateArchitectStateForTick = architectReuseHarness.bot.evaluateArchitectStateForTick.bind(architectReuseHarness.bot);
    architectReuseHarness.bot.evaluateArchitectStateForTick = (...args) => {
      architectReuseCalls += 1;
      const result = originalEvaluateArchitectStateForTick(...args);
      if (!firstArchitectState) {
        firstArchitectState = result;
      }
      return result;
    };
    const architectReusePhase = architectReuseHarness.bot.applyArchitectTickPhase(
      architectReuseHarness.bot.createTickSnapshot({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock })
    );
    if (architectReuseCalls !== 1) {
      throw new Error(`flat-bot architect phase should compute architect usability once per tick: ${architectReuseCalls}`);
    }
    if (architectReusePhase.architectState !== firstArchitectState) {
      throw new Error("architect phase should reuse the original architect state object when family does not change");
    }
    if (architectReusePhase.architectState?.currentFamily !== "trend_following" || architectReusePhase.architectState?.familyMatch !== true) {
      throw new Error(`reused architect state should preserve family alignment when no switch occurs: ${JSON.stringify(architectReusePhase.architectState)}`);
    }

    clock += 10_000;
    const architectSwitchHarness = createHarness(() => ({
      action: "hold",
      confidence: 0.55,
      reason: ["no_trade"]
    }), {
      allowedStrategies: ["emaCross", "rsiReversion"],
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross",
      strategySwitcher: new StrategySwitcher({
        resolveStrategyFamily: resolveTestStrategyFamily
      })
    });
    let architectSwitchCalls = 0;
    const originalSwitchEvaluate = architectSwitchHarness.bot.evaluateArchitectStateForTick.bind(architectSwitchHarness.bot);
    architectSwitchHarness.bot.evaluateArchitectStateForTick = (...args) => {
      architectSwitchCalls += 1;
      return originalSwitchEvaluate(...args);
    };
    const architectSwitchPhase = architectSwitchHarness.bot.applyArchitectTickPhase(
      architectSwitchHarness.bot.createTickSnapshot({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock })
    );
    if (architectSwitchCalls !== 1) {
      throw new Error(`family-switch architect phase should still compute architect usability once: ${architectSwitchCalls}`);
    }
    if (architectSwitchHarness.store.getBotState("bot_test").activeStrategyId !== "rsiReversion") {
      throw new Error("architect phase should still apply the published family switch on the flat-bot path");
    }
    if (architectSwitchPhase.architectState?.currentFamily !== "mean_reversion" || architectSwitchPhase.architectState?.familyMatch !== true) {
      throw new Error(`returned architect state should patch currentFamily/familyMatch after a mid-tick switch: ${JSON.stringify(architectSwitchPhase.architectState)}`);
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
    const defaultMtfInstabilityHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        mtf: {
          mtfAgreement: 0.4,
          mtfDominantFrame: "medium",
          mtfDominantTimeframe: "15m",
          mtfEnabled: true,
          mtfInstability: 0.9,
          mtfMetaRegime: "trend",
          mtfReadyFrameCount: 3,
          mtfSufficientFrames: true
        },
        updatedAt: clock
      })
    });
    const defaultMtfInstabilityState = defaultMtfInstabilityHarness.bot.evaluateArchitectStateForTick(
      defaultMtfInstabilityHarness.bot.createTickSnapshot({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock }),
      clock
    );
    if (defaultMtfInstabilityState.blockReason !== "mtf_instability_high" || defaultMtfInstabilityState.usable) {
      throw new Error(`default architect MTF instability threshold should still block at 0.5: ${JSON.stringify(defaultMtfInstabilityState)}`);
    }

    clock += 10_000;
    const overriddenMtfInstabilityHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.91,
      reason: ["buy_signal"]
    }), {
      mtfConfig: {
        enabled: true,
        instabilityThreshold: 0.95
      },
      publishedArchitect: createTrendArchitect({
        mtf: {
          mtfAgreement: 0.4,
          mtfDominantFrame: "medium",
          mtfDominantTimeframe: "15m",
          mtfEnabled: true,
          mtfInstability: 0.9,
          mtfMetaRegime: "trend",
          mtfReadyFrameCount: 3,
          mtfSufficientFrames: true
        },
        updatedAt: clock
      })
    });
    const overriddenMtfInstabilityState = overriddenMtfInstabilityHarness.bot.evaluateArchitectStateForTick(
      overriddenMtfInstabilityHarness.bot.createTickSnapshot({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock }),
      clock
    );
    if (overriddenMtfInstabilityState.blockReason === "mtf_instability_high" || !overriddenMtfInstabilityState.usable) {
      throw new Error(`configured architect MTF instability threshold should override the default 0.5 gating: ${JSON.stringify(overriddenMtfInstabilityState)}`);
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
    const rollingPartialState = rollingPartialMaturityHarness.store.getBotState("bot_test");
    if (rollingPartialState.entryBlockedCount !== 1) {
      throw new Error(`rolling_full maturity gate should still block the entry: ${JSON.stringify(rollingPartialState)}`);
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
    const postSwitchBlockState = postSwitchImmatureHarness.store.getBotState("bot_test");
    if (postSwitchBlockState.entryBlockedCount !== 1) {
      throw new Error(`post-switch low-maturity gate should still block the entry: ${JSON.stringify(postSwitchBlockState)}`);
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
    const mismatchState = mismatchHarness.store.getBotState("bot_test");
    if (mismatchState.entryBlockedCount !== 1) {
      throw new Error(`architect symbol mismatch should still count as a blocked entry: ${JSON.stringify(mismatchState)}`);
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
    if (flatRangeReversionEconomics.minExpectedNetEdgePct !== 0.0015) {
      throw new Error(`rsiReversion should enforce its hardened default minExpectedNetEdgePct: ${flatRangeReversionEconomics.minExpectedNetEdgePct}`);
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
    if (configuredReversionEconomics.minExpectedNetEdgePct !== 0.0015) {
      throw new Error(`rsiReversion should floor configured lower minExpectedNetEdgePct overrides: ${configuredReversionEconomics.minExpectedNetEdgePct}`);
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

    clock += 10_000;
    const targetDistanceIndicatorSnapshot = {
      emaBaseline: 100,
      emaFast: 99.9,
      emaSlow: 99.7,
      momentum: 0.02,
      rsi: 24,
      volatility: 0.01
    };
    const baselineTargetDistanceHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"],
      side: "long"
    }), {
      indicatorSnapshot: targetDistanceIndicatorSnapshot,
      publishedArchitect: createPublishedArchitect({
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    baselineTargetDistanceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    baselineTargetDistanceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const baselineTargetDistanceLog = baselineTargetDistanceHarness.botLogs.find((entry) =>
      entry.message === "entry_gate_blocked"
      && entry.metadata.blockReason === "target_distance_exceeds_short_horizon"
    );
    if (baselineTargetDistanceHarness.store.getPosition("bot_test") || !baselineTargetDistanceLog || baselineTargetDistanceLog.metadata.maxTargetDistancePctForShortHorizon !== 0.01) {
      throw new Error(`non-MTF RSI path should keep baseline target-distance blocking: ${JSON.stringify(baselineTargetDistanceLog)}`);
    }

    clock += 10_000;
    const mtfMediumTargetDistanceHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"],
      side: "long"
    }), {
      indicatorSnapshot: targetDistanceIndicatorSnapshot,
      publishedArchitect: createPublishedArchitect({
        mtf: {
          mtfAgreement: 0.8,
          mtfDominantFrame: "medium",
          mtfDominantTimeframe: "15m",
          mtfEnabled: true,
          mtfInstability: 0.2,
          mtfMetaRegime: "range",
          mtfReadyFrameCount: 3,
          mtfSufficientFrames: true
        },
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    mtfMediumTargetDistanceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    mtfMediumTargetDistanceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const mtfMediumAllowedLog = mtfMediumTargetDistanceHarness.botLogs.find((entry) => entry.message === "entry_gate_allowed");
    if (!mtfMediumTargetDistanceHarness.store.getPosition("bot_test") || !mtfMediumAllowedLog || mtfMediumAllowedLog.metadata.maxTargetDistancePctForShortHorizon !== 0.015 || mtfMediumAllowedLog.metadata.resolvedMtfAdjustmentApplied !== true) {
      throw new Error(`coherent medium MTF should widen the cap enough for the same entry: ${JSON.stringify(mtfMediumAllowedLog)}`);
    }

    clock += 10_000;
    const mtfUnstableTargetDistanceHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.95,
      reason: ["buy_signal"],
      side: "long"
    }), {
      indicatorSnapshot: targetDistanceIndicatorSnapshot,
      publishedArchitect: createPublishedArchitect({
        mtf: {
          mtfAgreement: 0.9,
          mtfDominantFrame: "medium",
          mtfDominantTimeframe: "15m",
          mtfEnabled: true,
          mtfInstability: 0.26,
          mtfMetaRegime: "range",
          mtfReadyFrameCount: 3,
          mtfSufficientFrames: true
        },
        updatedAt: clock
      }),
      strategy: "rsiReversion"
    });
    mtfUnstableTargetDistanceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    mtfUnstableTargetDistanceHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const mtfUnstableBlockedLog = mtfUnstableTargetDistanceHarness.botLogs.find((entry) =>
      entry.message === "entry_gate_blocked"
      && entry.metadata.blockReason === "target_distance_exceeds_short_horizon"
    );
    if (mtfUnstableTargetDistanceHarness.store.getPosition("bot_test") || !mtfUnstableBlockedLog || mtfUnstableBlockedLog.metadata.maxTargetDistancePctForShortHorizon !== 0.01 || mtfUnstableBlockedLog.metadata.resolvedMtfFallbackReason !== "mtf_instability_above_threshold") {
      throw new Error(`below-coherence MTF should keep baseline target-distance blocking: ${JSON.stringify(mtfUnstableBlockedLog)}`);
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
    const singleDiagnosticsHarness = createHarness(() => ({
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
    let singleDiagnosticsCalls = 0;
    const originalSingleDiagnostics = singleDiagnosticsHarness.bot.buildEntryDiagnostics.bind(singleDiagnosticsHarness.bot);
    singleDiagnosticsHarness.bot.buildEntryDiagnostics = (params) => {
      singleDiagnosticsCalls += 1;
      return originalSingleDiagnostics(params);
    };
    singleDiagnosticsHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    singleDiagnosticsCalls = 0;
    clock += 1_000;
    singleDiagnosticsHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (singleDiagnosticsCalls !== 1) {
      throw new Error(`entry diagnostics should be built only once on the same final-gate-blocked path: ${singleDiagnosticsCalls}`);
    }
    const singleDiagnosticsLog = singleDiagnosticsHarness.botLogs.find((entry) => entry.message === "entry_gate_blocked" && entry.metadata.blockReason === "notional_below_minimum");
    if (!singleDiagnosticsLog || singleDiagnosticsLog.metadata.tickTimestamp !== clock || singleDiagnosticsLog.metadata.expectedNetEdgePct === undefined) {
      throw new Error(`single-build diagnostics path should preserve entry gate metadata content: ${JSON.stringify(singleDiagnosticsLog)}`);
    }

    clock += 10_000;
    const gateBlockedEconomicsHarness = createHarness(() => ({
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
    let gateBlockedEconomicsCalls = 0;
    const originalGateBlockedEconomics = gateBlockedEconomicsHarness.bot.estimateEntryEconomics.bind(gateBlockedEconomicsHarness.bot);
    gateBlockedEconomicsHarness.bot.estimateEntryEconomics = (params) => {
      gateBlockedEconomicsCalls += 1;
      return originalGateBlockedEconomics(params);
    };
    gateBlockedEconomicsHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    gateBlockedEconomicsCalls = 0;
    clock += 1_000;
    gateBlockedEconomicsHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (gateBlockedEconomicsCalls !== 2) {
      throw new Error(`gate-passing blocked entry path should reuse sized economics instead of recomputing it: ${gateBlockedEconomicsCalls}`);
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
    const openedEvaluation = allowedHarness.botLogs.find((entry) => entry.message === "entry_gate_allowed");
    if (!openedEvaluation) {
      throw new Error("missing structured entry gate log for opened entry");
    }
    if (openedEvaluation.metadata.publisherLastPublishedAt !== clock - 1_000 || openedEvaluation.metadata.tickTimestamp !== clock) {
      throw new Error("opened entry evaluation log missing publisher/tick timing");
    }

    clock += 10_000;
    const executionRejectedEconomicsHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    executionRejectedEconomicsHarness.executionEngine.openLong = () => ({
      ok: false,
      error: {
        kind: "execution",
        code: "execution_open_rejected",
        message: "fixture open rejected",
        recoverable: true
      }
    });
    executionRejectedEconomicsHarness.executionEngine.openPosition = () => ({
      ok: false,
      error: {
        kind: "execution",
        code: "execution_open_rejected",
        message: "fixture open rejected",
        recoverable: true
      }
    });
    let executionRejectedEconomicsCalls = 0;
    const originalExecutionRejectedEconomics = executionRejectedEconomicsHarness.bot.estimateEntryEconomics.bind(executionRejectedEconomicsHarness.bot);
    executionRejectedEconomicsHarness.bot.estimateEntryEconomics = (params) => {
      executionRejectedEconomicsCalls += 1;
      return originalExecutionRejectedEconomics(params);
    };
    executionRejectedEconomicsHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    executionRejectedEconomicsCalls = 0;
    clock += 1_000;
    executionRejectedEconomicsHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (executionRejectedEconomicsCalls !== 2) {
      throw new Error(`execution-rejected entry path should reuse sized economics instead of recomputing it: ${executionRejectedEconomicsCalls}`);
    }
    if (!executionRejectedEconomicsHarness.botLogs.find((entry) => entry.message === "entry_blocked" && entry.metadata.reason === "execution_open_rejected")) {
      throw new Error("execution-rejected path should preserve existing blocked outcome semantics");
    }

    clock += 10_000;
    const openedEconomicsHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      })
    });
    let openedEconomicsCalls = 0;
    const originalOpenedEconomics = openedEconomicsHarness.bot.estimateEntryEconomics.bind(openedEconomicsHarness.bot);
    openedEconomicsHarness.bot.estimateEntryEconomics = (params) => {
      openedEconomicsCalls += 1;
      return originalOpenedEconomics(params);
    };
    openedEconomicsHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    openedEconomicsCalls = 0;
    clock += 1_000;
    const openedLastExecutionWrites = [];
    const originalOpenedUpdateBotState = openedEconomicsHarness.store.updateBotState.bind(openedEconomicsHarness.store);
    openedEconomicsHarness.store.updateBotState = (botId, patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "lastExecutionAt")) {
        openedLastExecutionWrites.push({
          botId,
          patch: { ...patch }
        });
      }
      return originalOpenedUpdateBotState(botId, patch);
    };
    openedEconomicsHarness.bot.onMarketTick({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (openedEconomicsCalls !== 2) {
      throw new Error(`opened entry path should reuse sized economics instead of recomputing it: ${openedEconomicsCalls}`);
    }
    if (!openedEconomicsHarness.store.getPosition("bot_test")) {
      throw new Error("opened entry path should preserve normal open behavior after economics reuse");
    }
    if (openedLastExecutionWrites.length !== 1 || openedLastExecutionWrites[0].patch.lastExecutionAt !== clock) {
      throw new Error(`opened entry path should write lastExecutionAt once via outcome statePatch: ${JSON.stringify(openedLastExecutionWrites)}`);
    }
    const openedState = openedEconomicsHarness.store.getBotState("bot_test");
    if (openedState.lastExecutionAt !== clock || openedState.lastTradeAt !== clock) {
      throw new Error(`opened entry path should preserve runtime execution timestamps: ${JSON.stringify(openedState)}`);
    }
    const openedPipeline = openedEconomicsHarness.store.getPipelineSnapshot("BTC/USDT");
    if (!openedPipeline || openedPipeline.lastExecutionAt !== clock || openedPipeline.botToExecutionMs !== 0) {
      throw new Error(`opened entry path should preserve pipeline execution metadata: ${JSON.stringify(openedPipeline)}`);
    }

    clock += 10_000;
    const portfolioKillSwitchHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    portfolioKillSwitchHarness.store.setPortfolioKillSwitchConfig({
      enabled: true,
      maxDrawdownPct: 5,
      mode: "block_entries_only"
    });
    portfolioKillSwitchHarness.store.updateBotState("bot_test", {
      realizedPnl: -60
    });
    const portfolioKillSwitchRuntimeNow = 88_000_000;
    let portfolioKillSwitchPreviewNow = null;
    const originalGetPortfolioKillSwitchState = portfolioKillSwitchHarness.store.getPortfolioKillSwitchState.bind(portfolioKillSwitchHarness.store);
    portfolioKillSwitchHarness.store.getPortfolioKillSwitchState = (options = {}) => {
      if (portfolioKillSwitchPreviewNow === null) {
        portfolioKillSwitchPreviewNow = options.now;
      }
      return originalGetPortfolioKillSwitchState(options);
    };
    portfolioKillSwitchHarness.bot.clock = { now: () => portfolioKillSwitchRuntimeNow };
    portfolioKillSwitchHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (portfolioKillSwitchHarness.store.getPosition("bot_test")) {
      throw new Error("portfolio kill switch should block new entries before an open position is created");
    }
    const portfolioKillSwitchState = portfolioKillSwitchHarness.store.getPortfolioKillSwitchState({
      feeRate: portfolioKillSwitchHarness.executionEngine.feeRate,
      now: clock
    });
    if (!portfolioKillSwitchState.triggered || !portfolioKillSwitchState.blockingEntries) {
      throw new Error(`portfolio kill switch should be latched in shared runtime state once the aggregate drawdown threshold is breached: ${JSON.stringify(portfolioKillSwitchState)}`);
    }
    if (portfolioKillSwitchPreviewNow !== portfolioKillSwitchRuntimeNow) {
      throw new Error(`portfolio kill switch preview from TradingBot should use runtime wall-clock, not exchange tick timestamp: ${JSON.stringify({ portfolioKillSwitchPreviewNow, portfolioKillSwitchRuntimeNow, tickTimestamp: clock })}`);
    }
    const portfolioBlockedLog = portfolioKillSwitchHarness.botLogs.find((entry) =>
      entry.message === "entry_blocked"
      && entry.metadata.reason === "portfolio_kill_switch_active"
    );
    if (!portfolioBlockedLog) {
      throw new Error("portfolio kill switch should emit an explicit entry_blocked reason");
    }
    const portfolioGateLog = portfolioKillSwitchHarness.botLogs.find((entry) =>
      entry.message === "entry_gate_blocked"
      && entry.metadata.riskReason === "portfolio_kill_switch_active"
    );
    if (!portfolioGateLog) {
      throw new Error("portfolio kill switch should flow through entry diagnostics as the blocking risk reason");
    }

    clock += 10_000;
    const degradedFreshnessHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    degradedFreshnessHarness.store.setMarketDataFreshness("BTC/USDT", {
      lastTickTimestamp: clock - 1_000,
      reason: "rest_fallback_active",
      status: "degraded",
      updatedAt: clock
    });
    degradedFreshnessHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (degradedFreshnessHarness.store.getPosition("bot_test")) {
      throw new Error("degraded market data should block new entries while flat");
    }
    if (!degradedFreshnessHarness.botLogs.find((entry) =>
      entry.message === "entry_blocked" && entry.metadata.reason === "market_data_not_fresh"
    )) {
      throw new Error("degraded market data should emit an explicit entry_blocked reason");
    }
    if (!degradedFreshnessHarness.botLogs.find((entry) =>
      entry.message === "entry_gate_blocked" && entry.metadata.riskReason === "market_data_not_fresh"
    )) {
      throw new Error("degraded market data should flow through entry diagnostics as the blocking risk reason");
    }

    clock += 10_000;
    let degradedStrategyEvaluations = 0;
    const degradedNoEvalHarness = createHarness(() => {
      degradedStrategyEvaluations += 1;
      return {
        action: "buy",
        confidence: 0.93,
        reason: ["buy_signal"]
      };
    }, {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    degradedNoEvalHarness.store.setMarketDataFreshness("BTC/USDT", {
      lastTickTimestamp: clock - 1_000,
      reason: "rest_fallback_active",
      status: "degraded",
      updatedAt: clock
    });
    degradedNoEvalHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (degradedStrategyEvaluations !== 0) {
      throw new Error(`flat bot should skip strategy.evaluate() entirely when market data is degraded: ${degradedStrategyEvaluations}`);
    }

    clock += 10_000;
    const staleFreshnessHarness = createHarness(() => ({
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    staleFreshnessHarness.store.setMarketDataFreshness("BTC/USDT", {
      lastTickTimestamp: clock - 10_000,
      reason: "market_data_stale",
      status: "stale",
      updatedAt: clock
    });
    staleFreshnessHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (staleFreshnessHarness.store.getPosition("bot_test")) {
      throw new Error("stale market data should block new entries while flat");
    }
    if (!staleFreshnessHarness.botLogs.find((entry) =>
      entry.message === "entry_blocked" && entry.metadata.reason === "market_data_not_fresh"
    )) {
      throw new Error("stale market data should emit an explicit entry_blocked reason");
    }

    clock += 10_000;
    let staleStrategyEvaluations = 0;
    const staleNoEvalHarness = createHarness(() => {
      staleStrategyEvaluations += 1;
      return {
        action: "buy",
        confidence: 0.93,
        reason: ["buy_signal"]
      };
    }, {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    staleNoEvalHarness.store.setMarketDataFreshness("BTC/USDT", {
      lastTickTimestamp: clock - 10_000,
      reason: "market_data_stale",
      status: "stale",
      updatedAt: clock
    });
    staleNoEvalHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (staleStrategyEvaluations !== 0) {
      throw new Error(`flat bot should skip strategy.evaluate() entirely when market data is stale: ${staleStrategyEvaluations}`);
    }

    clock += 10_000;
    const degradedExitHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.93,
      reason: [context.hasOpenPosition ? "exit_signal" : "buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    degradedExitHarness.store.setPosition("bot_test", createPosition({
      openedAt: clock - 2_000,
      quantity: 1,
      strategyId: "emaCross"
    }));
    degradedExitHarness.store.setMarketDataFreshness("BTC/USDT", {
      lastTickTimestamp: clock - 1_000,
      reason: "rest_fallback_active",
      status: "degraded",
      updatedAt: clock
    });
    degradedExitHarness.bot.onMarketTick({ price: 95, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (degradedExitHarness.store.getPosition("bot_test")) {
      throw new Error("degraded market data should not block protective/normal exit handling for open positions");
    }
    if (!degradedExitHarness.botLogs.find((entry) =>
      entry.message === "degraded_data_exit_warning"
      && entry.metadata.marketDataFreshnessStatus === "degraded"
      && entry.metadata.marketDataFreshnessReason === "rest_fallback_active"
    )) {
      throw new Error(`degraded market data exits should emit warning telemetry: ${JSON.stringify(degradedExitHarness.botLogs)}`);
    }

    clock += 10_000;
    const staleExitHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.93,
      reason: [context.hasOpenPosition ? "exit_signal" : "buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    staleExitHarness.store.setPosition("bot_test", createPosition({
      openedAt: clock - 2_000,
      quantity: 1,
      strategyId: "emaCross"
    }));
    staleExitHarness.store.setMarketDataFreshness("BTC/USDT", {
      lastTickTimestamp: clock - 10_000,
      reason: "market_data_stale",
      status: "stale",
      updatedAt: clock
    });
    staleExitHarness.bot.onMarketTick({ price: 95, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    if (staleExitHarness.store.getPosition("bot_test")) {
      throw new Error("stale market data should not block protective/normal exit handling for open positions");
    }
    if (!staleExitHarness.botLogs.find((entry) =>
      entry.message === "degraded_data_exit_warning"
      && entry.metadata.marketDataFreshnessStatus === "stale"
      && entry.metadata.marketDataFreshnessReason === "market_data_stale"
    )) {
      throw new Error(`stale market data exits should emit warning telemetry: ${JSON.stringify(staleExitHarness.botLogs)}`);
    }

    clock += 10_000;
    const maxDrawdownPauseHarness = createHarness((context) => ({
      action: context.hasOpenPosition ? "sell" : "buy",
      confidence: 0.93,
      reason: [context.hasOpenPosition ? "stop_signal" : "buy_signal"]
    }), {
      publishedArchitect: createTrendArchitect({
        updatedAt: clock
      }),
      strategy: "emaCross"
    });
    maxDrawdownPauseHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 1_000;
    maxDrawdownPauseHarness.bot.onMarketTick({ price: 100, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    clock += 16_000;
    maxDrawdownPauseHarness.bot.onMarketTick({ price: 50, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const pausedState = maxDrawdownPauseHarness.store.getBotState("bot_test");
    if (pausedState.status !== "paused" || pausedState.pausedReason !== "max_drawdown_reached") {
      throw new Error(`max drawdown close should leave the bot explicitly paused: ${JSON.stringify(pausedState)}`);
    }
    const drawdownPauseRiskLog = maxDrawdownPauseHarness.botLogs.find((entry) =>
      entry.message === "RISK_CHANGE"
      && entry.metadata.status === "trade_closed"
      && entry.metadata.pausedReason === "max_drawdown_reached"
    );
    if (!drawdownPauseRiskLog || drawdownPauseRiskLog.metadata.manualResumeRequired !== true || drawdownPauseRiskLog.metadata.botStatus !== "paused") {
      throw new Error(`max drawdown pause should emit explicit manual-resume-required risk metadata: ${JSON.stringify(drawdownPauseRiskLog)}`);
    }
    const pausedLogCountBefore = maxDrawdownPauseHarness.botLogs.length;
    clock += 1_000;
    maxDrawdownPauseHarness.bot.onMarketTick({ price: 120, source: "mock", symbol: "BTC/USDT", timestamp: clock });
    const pausedStateAfterNextTick = maxDrawdownPauseHarness.store.getBotState("bot_test");
    if (pausedStateAfterNextTick.status !== "paused" || pausedStateAfterNextTick.pausedReason !== "max_drawdown_reached") {
      throw new Error(`max drawdown pause should remain in effect until manual resume: ${JSON.stringify(pausedStateAfterNextTick)}`);
    }
    if (maxDrawdownPauseHarness.botLogs.length !== pausedLogCountBefore) {
      throw new Error("paused bot should ignore subsequent ticks without auto-resume side effects");
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
