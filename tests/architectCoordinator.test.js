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

  const challengerClock = Date.now();
  const challengerHarness = createCoordinatorHarness({
    strategy: "rsiReversion",
    publishedArchitect: createPublishedArchitect({
      recommendedFamily: "mean_reversion",
      updatedAt: challengerClock
    }),
    publisherState: {
      challengerCount: 1,
      challengerRegime: "trend",
      hysteresisActive: true,
      lastPublishedAt: challengerClock
    }
  });
  const challengerUsability = challengerHarness.coordinator.evaluateUsability({
    activeStrategyId: "rsiReversion",
    timestamp: challengerClock
  });
  if (challengerUsability.usable || challengerUsability.blockReason !== "architect_challenger_pending") {
    throw new Error(`pending challenger should block entry during architect hysteresis: ${JSON.stringify(challengerUsability)}`);
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

  // ══════════════════════════════════════════════════════════
  //  MTF usability integration tests
  // ══════════════════════════════════════════════════════════

  // ── MTF disabled: usability unchanged ──

  {
    const mtfOffClock = Date.now();
    const mtfOffHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({ updatedAt: mtfOffClock }),
      publisherState: { lastPublishedAt: mtfOffClock }
    });
    const mtfOffUsability = mtfOffHarness.coordinator.evaluateUsability({
      activeStrategyId: "rsiReversion",
      timestamp: mtfOffClock
      // No MTF params → disabled
    });
    if (!mtfOffUsability.usable) {
      throw new Error(`MTF-disabled: usability should be unchanged, blockReason: ${mtfOffUsability.blockReason}`);
    }
  }

  // ── MTF enabled: low instability does NOT block ──

  {
    const mtfLowClock = Date.now();
    const mtfLowHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({ updatedAt: mtfLowClock }),
      publisherState: { lastPublishedAt: mtfLowClock }
    });
    const mtfLowUsability = mtfLowHarness.coordinator.evaluateUsability({
      activeStrategyId: "rsiReversion",
      timestamp: mtfLowClock,
      mtfEnabled: true,
      mtfSufficientFrames: true,
      mtfInstability: 0.2,
      mtfAgreement: 0.8,
      mtfDominantTimeframe: "5m"
    });
    if (!mtfLowUsability.usable || mtfLowUsability.blockReason !== null) {
      throw new Error(`MTF low instability: should still be usable, blockReason: ${mtfLowUsability.blockReason}`);
    }
  }

  // ── MTF enabled: high instability blocks usability ──

  {
    const mtfHighClock = Date.now();
    const mtfHighHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({ updatedAt: mtfHighClock }),
      publisherState: { lastPublishedAt: mtfHighClock }
    });
    const mtfHighUsability = mtfHighHarness.coordinator.evaluateUsability({
      activeStrategyId: "rsiReversion",
      timestamp: mtfHighClock,
      mtfEnabled: true,
      mtfSufficientFrames: true,
      mtfInstability: 0.7,
      mtfAgreement: 0.3,
      mtfDominantTimeframe: null
    });
    if (mtfHighUsability.usable || mtfHighUsability.blockReason !== "mtf_instability_high") {
      throw new Error(`MTF high instability: should block with mtf_instability_high, got: ${mtfHighUsability.blockReason}`);
    }
  }

  // ── MTF enabled but insufficient frames: does NOT block ──

  {
    const mtfFewClock = Date.now();
    const mtfFewHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({ updatedAt: mtfFewClock }),
      publisherState: { lastPublishedAt: mtfFewClock }
    });
    const mtfFewUsability = mtfFewHarness.coordinator.evaluateUsability({
      activeStrategyId: "rsiReversion",
      timestamp: mtfFewClock,
      mtfEnabled: true,
      mtfSufficientFrames: false,
      mtfInstability: 0.9
    });
    if (!mtfFewUsability.usable || mtfFewUsability.blockReason !== null) {
      throw new Error(`MTF insufficient frames: should not block even with high instability, got: ${mtfFewUsability.blockReason}`);
    }
  }

  // ── MTF enabled=false: high instability does NOT block ──

  {
    const mtfDisClock = Date.now();
    const mtfDisHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({ updatedAt: mtfDisClock }),
      publisherState: { lastPublishedAt: mtfDisClock }
    });
    const mtfDisUsability = mtfDisHarness.coordinator.evaluateUsability({
      activeStrategyId: "rsiReversion",
      timestamp: mtfDisClock,
      mtfEnabled: false,
      mtfSufficientFrames: true,
      mtfInstability: 0.9
    });
    if (!mtfDisUsability.usable || mtfDisUsability.blockReason !== null) {
      throw new Error(`MTF disabled flag: should not block, got: ${mtfDisUsability.blockReason}`);
    }
  }

  // ── Precedence: architect_challenger_pending wins over mtf_instability_high ──

  {
    const precClock = Date.now();
    const precHarness = createCoordinatorHarness({
      strategy: "rsiReversion",
      publishedArchitect: createPublishedArchitect({
        recommendedFamily: "mean_reversion",
        updatedAt: precClock
      }),
      publisherState: {
        challengerCount: 1,
        challengerRegime: "trend",
        hysteresisActive: true,
        lastPublishedAt: precClock
      }
    });
    const precUsability = precHarness.coordinator.evaluateUsability({
      activeStrategyId: "rsiReversion",
      timestamp: precClock,
      mtfEnabled: true,
      mtfSufficientFrames: true,
      mtfInstability: 0.9
    });
    if (precUsability.blockReason !== "architect_challenger_pending") {
      throw new Error(`Precedence: architect_challenger_pending should win over MTF, got: ${precUsability.blockReason}`);
    }
  }

  // ── Precedence: architect_stale wins over mtf_instability_high ──

  {
    const staleMtfClock = Date.now();
    const staleMtfHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({
        updatedAt: staleMtfClock - 180_000
      }),
      publisherState: {
        lastPublishedAt: staleMtfClock - 180_000,
        publishIntervalMs: 30_000
      }
    });
    const staleMtfUsability = staleMtfHarness.coordinator.evaluateUsability({
      activeStrategyId: "emaCross",
      timestamp: staleMtfClock,
      mtfEnabled: true,
      mtfSufficientFrames: true,
      mtfInstability: 0.9
    });
    if (staleMtfUsability.blockReason !== "architect_stale") {
      throw new Error(`Precedence: architect_stale should win over MTF, got: ${staleMtfUsability.blockReason}`);
    }
  }

  // ── Precedence: architect_unclear wins over mtf_instability_high ──

  {
    const unclearMtfClock = Date.now();
    const unclearMtfHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({
        marketRegime: "unclear",
        recommendedFamily: "no_trade",
        updatedAt: unclearMtfClock
      }),
      publisherState: { lastPublishedAt: unclearMtfClock }
    });
    const unclearMtfUsability = unclearMtfHarness.coordinator.evaluateUsability({
      activeStrategyId: "emaCross",
      timestamp: unclearMtfClock,
      mtfEnabled: true,
      mtfSufficientFrames: true,
      mtfInstability: 0.9
    });
    if (unclearMtfUsability.blockReason !== "architect_unclear") {
      throw new Error(`Precedence: architect_unclear should win over MTF, got: ${unclearMtfUsability.blockReason}`);
    }
  }

  // ── Precedence: architect_low_maturity wins over mtf_instability_high ──

  {
    const matMtfClock = Date.now();
    const matMtfHarness = createCoordinatorHarness({
      publishedArchitect: createPublishedArchitect({
        contextMaturity: 0.1,
        updatedAt: matMtfClock
      }),
      publisherState: { lastPublishedAt: matMtfClock }
    });
    const matMtfUsability = matMtfHarness.coordinator.evaluateUsability({
      activeStrategyId: "emaCross",
      timestamp: matMtfClock,
      mtfEnabled: true,
      mtfSufficientFrames: true,
      mtfInstability: 0.9
    });
    if (matMtfUsability.blockReason !== "architect_low_maturity") {
      throw new Error(`Precedence: architect_low_maturity should win over MTF, got: ${matMtfUsability.blockReason}`);
    }
  }
}

module.exports = {
  runArchitectCoordinatorTests
};
