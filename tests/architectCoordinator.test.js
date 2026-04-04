"use strict";

const { ArchitectCoordinator } = require("../src/roles/architectCoordinator.ts");
const { StrategySwitcher } = require("../src/roles/strategySwitcher.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { createStrategy: createEmaCrossStrategy } = require("../src/strategies/emaCross/strategy.ts");
const { createStrategy: createRsiReversionStrategy } = require("../src/strategies/rsiReversion/strategy.ts");

function resolveTestStrategyFamily(strategyId) {
  if (strategyId === "emaCross") return "trend_following";
  if (strategyId === "rsiReversion") return "mean_reversion";
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

function createCoordinatorHarness(options = {}) {
  const store = new StateStore();
  const config = {
    allowedStrategies: ["emaCross", "rsiReversion"],
    enabled: true,
    id: "bot_test",
    initialBalanceUsdt: 1000,
    riskProfile: "medium",
    strategy: options.strategy || "emaCross",
    symbol: "BTC/USDT"
  };

  store.registerBot(config);
  store.setContextSnapshot(config.symbol, options.contextSnapshot || {
    dataMode: "live",
    effectiveSampleSize: 120,
    effectiveWarmupComplete: true,
    effectiveWindowSpanMs: 240_000,
    effectiveWindowStartedAt: Date.now() - 240_000,
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
    lastPublishedRegimeSwitchAt: null,
    lastPublishedRegimeSwitchFrom: null,
    lastPublishedRegimeSwitchTo: null,
    observedAt: Date.now(),
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
  store.setArchitectPublishedAssessment(config.symbol, options.publishedArchitect || createPublishedArchitect());
  store.setArchitectPublisherState(config.symbol, {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: Date.now(),
    lastPublishedAt: Date.now(),
    lastPublishedRegime: "range",
    nextPublishAt: Date.now() + 30_000,
    publishIntervalMs: 30_000,
    ready: true,
    symbol: config.symbol,
    warmupStartedAt: Date.now() - 60_000,
    ...(options.publisherState || {})
  });

  const strategySwitcher = options.strategySwitcher || new StrategySwitcher({
    resolveStrategyFamily: resolveTestStrategyFamily
  });
  const strategyRegistry = {
    createStrategy(strategyId) {
      if (strategyId === "emaCross") return createEmaCrossStrategy();
      if (strategyId === "rsiReversion") return createRsiReversionStrategy();
      throw new Error(`Unknown strategy ${strategyId}`);
    }
  };

  return {
    config,
    coordinator: new ArchitectCoordinator({
      allowedStrategies: config.allowedStrategies,
      botConfig: config,
      maxArchitectStateAgeMs: 90_000,
      minEntryContextMaturity: 0.5,
      minPostSwitchEntryContextMaturity: 0.3,
      store,
      strategyRegistry,
      strategySwitcher
    }),
    store,
    strategySwitcher
  };
}

async function runArchitectCoordinatorTests() {
  const staleClock = Date.now();
  const staleHarness = createCoordinatorHarness({
    publishedArchitect: createPublishedArchitect({
      updatedAt: staleClock - 180_000
    }),
    publisherState: {
      lastPublishedAt: staleClock - 180_000,
      publishIntervalMs: 30_000
    }
  });
  const staleUsability = staleHarness.coordinator.evaluateUsability({
    activeStrategyId: "emaCross",
    timestamp: staleClock
  });
  if (staleUsability.usable || staleUsability.blockReason !== "architect_stale" || staleUsability.staleThresholdMs !== 90_000) {
    throw new Error(`stale published architect should be rejected with the existing threshold: ${JSON.stringify(staleUsability)}`);
  }

  const syncClock = Date.now();
  const syncHarness = createCoordinatorHarness({
    publishedArchitect: createPublishedArchitect({
      updatedAt: syncClock
    }),
    publisherState: {
      lastPublishedAt: syncClock
    }
  });
  const syncResult = syncHarness.coordinator.updateSyncState(null, {
    activeStrategyId: "emaCross",
    currentDivergenceActive: false,
    timestamp: syncClock
  });
  if (!syncResult || syncResult.state.architectSyncStatus !== "pending") {
    throw new Error(`flat family mismatch should keep sync pending before apply: ${JSON.stringify(syncResult)}`);
  }
  if (!syncResult.divergenceLogMetadata || syncResult.divergenceLogMetadata.recommendedFamily !== "mean_reversion") {
    throw new Error(`family mismatch should still surface divergence metadata: ${JSON.stringify(syncResult)}`);
  }

  const applyClock = Date.now();
  const applyHarness = createCoordinatorHarness({
    publishedArchitect: createPublishedArchitect({
      updatedAt: applyClock
    }),
    publisherState: {
      lastPublishedAt: applyClock
    }
  });
  const applyResult = applyHarness.coordinator.applyPublishedState(null, {
    activeStrategyId: "emaCross",
    currentDivergenceActive: true,
    timestamp: applyClock
  });
  const appliedState = applyHarness.store.getBotState("bot_test");
  if (!applyResult || applyResult.nextStrategy?.id !== "rsiReversion") {
    throw new Error(`flat bot should still realign to the Architect family: ${JSON.stringify(applyResult)}`);
  }
  if (appliedState.activeStrategyId !== "rsiReversion" || appliedState.architectSyncStatus !== "synced") {
    throw new Error(`successful apply should preserve the synced post-switch state update: ${JSON.stringify(appliedState)}`);
  }
  if (!applyResult.logEvent || applyResult.logEvent.message !== "strategy_aligned") {
    throw new Error(`successful apply should preserve strategy_aligned metadata: ${JSON.stringify(applyResult)}`);
  }

  const raceClock = Date.now();
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
      openedAt: raceClock - 1_000,
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
  const raceHarness = createCoordinatorHarness({
    publishedArchitect: createPublishedArchitect({
      updatedAt: raceClock
    }),
    publisherState: {
      lastPublishedAt: raceClock
    },
    strategySwitcher: raceSwitcher
  });
  raceStore = raceHarness.store;
  const raceResult = raceHarness.coordinator.applyPublishedState(null, {
    activeStrategyId: "emaCross",
    currentDivergenceActive: true,
    timestamp: raceClock
  });
  const raceState = raceHarness.store.getBotState("bot_test");
  if (!raceResult || raceResult.logEvent?.message !== "strategy_alignment_skipped") {
    throw new Error(`position-open race should preserve strategy_alignment_skipped behavior: ${JSON.stringify(raceResult)}`);
  }
  if (raceState.activeStrategyId !== "emaCross" || raceResult.syncUpdate?.state?.architectSyncStatus !== "waiting_flat") {
    throw new Error(`position-open race should preserve waiting_flat sync state: ${JSON.stringify({ raceResult, raceState })}`);
  }
}

module.exports = {
  runArchitectCoordinatorTests
};
