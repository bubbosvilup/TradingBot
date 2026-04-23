"use strict";

const { StateStore } = require("../src/core/stateStore.ts");
const { ArchitectService } = require("../src/core/architectService.ts");

function createAssessment(symbol, marketRegime, recommendedFamily, regimeScores, updatedAt) {
  const sortedScores = Object.entries(regimeScores).sort((left, right) => Number(right[1]) - Number(left[1]));
  const top = Number(sortedScores[0]?.[1] || 0);
  const second = Number(sortedScores[1]?.[1] || 0);
  return {
    absoluteConviction: top,
    confidence: top,
    contextMaturity: 0.8,
    dataMode: "live",
    decisionStrength: Math.max(0, top - second),
    familyScores: {
      mean_reversion: regimeScores.range || 0,
      no_trade: Math.max(regimeScores.volatile || 0, regimeScores.unclear || 0),
      trend_following: regimeScores.trend || 0
    },
    featureConflict: 0.12,
    marketRegime,
    reasonCodes: [`${marketRegime}_structure`],
    recommendedFamily,
    regimeScores: {
      range: regimeScores.range || 0,
      trend: regimeScores.trend || 0,
      unclear: regimeScores.unclear || 0,
      volatile: regimeScores.volatile || 0
    },
    sampleSize: 120,
    signalAgreement: 0.74,
    structureState: marketRegime === "trend" ? "trending" : "choppy",
    sufficientData: true,
    summary: `Assessment ${marketRegime}.`,
    symbol,
    trendBias: marketRegime === "trend" ? "bullish" : "neutral",
    updatedAt,
    volatilityState: marketRegime === "volatile" ? "expanding" : "normal"
  };
}

function createAssessmentWithMaturity(symbol, marketRegime, recommendedFamily, regimeScores, updatedAt, contextMaturity) {
  return {
    ...createAssessment(symbol, marketRegime, recommendedFamily, regimeScores, updatedAt),
    contextMaturity,
    sufficientData: true
  };
}

function createContext(symbol, observedAt, warmupComplete, label) {
  const windowSpanMs = warmupComplete ? 60_000 : 10_000;
  return {
    dataMode: "live",
    effectiveSampleSize: warmupComplete ? 120 : 10,
    effectiveWarmupComplete: warmupComplete,
    effectiveWindowSpanMs: windowSpanMs,
    effectiveWindowStartedAt: observedAt - windowSpanMs,
    features: {
      breakoutDirection: "none",
      breakoutInstability: 0.1,
      breakoutQuality: 0.2,
      chopiness: 0.3,
      dataQuality: 0.92,
      directionalEfficiency: 0.62,
      emaBias: 0.2,
      emaSeparation: 0.55,
      featureConflict: 0.12,
      maturity: warmupComplete ? 0.8 : 0.06,
      netMoveRatio: 0.01,
      reversionStretch: 0.2,
      rsiIntensity: 0.18,
      slopeConsistency: 0.59,
      volatilityRisk: 0.22
    },
    lastPublishedRegimeSwitchAt: null,
    lastPublishedRegimeSwitchFrom: null,
    lastPublishedRegimeSwitchTo: null,
    observedAt,
    postSwitchCoveragePct: null,
    rollingMaturity: warmupComplete ? 0.8 : 0.06,
    rollingSampleSize: warmupComplete ? 120 : 10,
    sampleSize: warmupComplete ? 120 : 10,
    stage: label,
    structureState: "trending",
    summary: `Context ${label}`,
    symbol,
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete,
    windowMode: "rolling_full",
    windowSpanMs,
    windowStartedAt: observedAt - windowSpanMs
  };
}

function runArchitectServiceTests() {
  const store = new StateStore();
  const logs = [];
  const assessmentsByStage = {
    "range-small": createAssessment("BTC/USDT", "range", "mean_reversion", {
      range: 0.56,
      trend: 0.49,
      unclear: 0.12,
      volatile: 0.18
    }, 60_000),
    trend: createAssessment("BTC/USDT", "trend", "trend_following", {
      range: 0.24,
      trend: 0.67,
      unclear: 0.11,
      volatile: 0.15
    }, 30_000)
  };

  const service = new ArchitectService({
    botArchitect: {
      assess(context) {
        return assessmentsByStage[context.stage];
      }
    },
    logger: {
      info(event, metadata) {
        logs.push({ event, metadata });
      }
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    publishIntervalMs: 30_000,
    requiredConfirmations: 2,
    store,
    switchDelta: 0.12
  });

  const symbol = "BTC/USDT";

  store.setContextSnapshot(symbol, createContext(symbol, 10_000, false, "trend"));
  service.observe(symbol, 10_000);
  if (store.getArchitectPublishedAssessment(symbol)) {
    throw new Error("architect published before warm-up completed");
  }

  const immatureStore = new StateStore();
  const immatureLogs = [];
  const immatureService = new ArchitectService({
    botArchitect: {
      minMaturity: 0.25,
      assess(context) {
        return context.stage === "immature"
          ? createAssessmentWithMaturity(symbol, "trend", "trend_following", {
              range: 0.24,
              trend: 0.67,
              unclear: 0.11,
              volatile: 0.15
            }, context.observedAt, 0.2)
          : createAssessmentWithMaturity(symbol, "trend", "trend_following", {
              range: 0.24,
              trend: 0.67,
              unclear: 0.11,
              volatile: 0.15
            }, context.observedAt, 0.3);
      }
    },
    logger: {
      info(event, metadata) {
        immatureLogs.push({ event, metadata });
      }
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    publishIntervalMs: 30_000,
    requiredConfirmations: 2,
    store: immatureStore,
    switchDelta: 0.12
  });
  immatureStore.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "immature"));
  immatureService.observe(symbol, 30_000);
  if (immatureStore.getArchitectPublishedAssessment(symbol)) {
    throw new Error("architect should not publish when context maturity is below the new 0.25 threshold");
  }
  const immaturePublisherState = immatureStore.getArchitectPublisherState(symbol);
  if (!immaturePublisherState || immaturePublisherState.ready !== false || immaturePublisherState.lastPublishedAt !== null) {
    throw new Error("publisher state should stay unready until maturity reaches the publish threshold");
  }
  if (immatureLogs.find((entry) => entry.event === "architect_published")) {
    throw new Error("immature startup window should not emit architect_published");
  }

  immatureStore.setContextSnapshot(symbol, createContext(symbol, 60_000, true, "mature"));
  immatureService.observe(symbol, 60_000);
  const maturePublished = immatureStore.getArchitectPublishedAssessment(symbol);
  if (!maturePublished || maturePublished.marketRegime !== "trend") {
    throw new Error("architect should publish once maturity reaches the threshold");
  }
  if (!immatureLogs.find((entry) => entry.event === "architect_published")) {
    throw new Error("mature publish should still emit architect_published");
  }

  const gatedStore = new StateStore();
  let assessCalls = 0;
  const gatedLogs = [];
  const customPublishIntervalMs = 15_000;
  const customWarmupMs = 20_000;
  const gatedService = new ArchitectService({
    botArchitect: {
      assess(context) {
        assessCalls += 1;
        return createAssessment(context.symbol, "trend", "trend_following", {
          range: 0.24,
          trend: 0.67,
          unclear: 0.11,
          volatile: 0.15
        }, context.observedAt);
      }
    },
    logger: {
      info(event, metadata) {
        gatedLogs.push({ event, metadata });
      }
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    publishIntervalMs: customPublishIntervalMs,
    requiredConfirmations: 2,
    store: gatedStore,
    switchDelta: 0.12,
    warmupMs: customWarmupMs
  });
  gatedStore.setContextSnapshot(symbol, {
    ...createContext(symbol, 14_000, true, "trend"),
    effectiveWindowStartedAt: 0,
    windowStartedAt: 0
  });
  gatedService.observe(symbol, 14_000);
  if (assessCalls !== 0 || gatedStore.getArchitectPublishedAssessment(symbol)) {
    throw new Error("architect should skip heavy assessment and publish before the configured interval");
  }
  const gatedPublisherBefore = gatedStore.getArchitectPublisherState(symbol);
  if (!gatedPublisherBefore || gatedPublisherBefore.lastObservedAt !== 14_000 || gatedPublisherBefore.nextPublishAt !== 15_000) {
    throw new Error("architect should still keep publisher timing metadata fresh before the publish interval");
  }

  gatedStore.setContextSnapshot(symbol, {
    ...createContext(symbol, 15_000, true, "trend"),
    effectiveWindowStartedAt: 0,
    windowStartedAt: 0
  });
  gatedService.observe(symbol, 15_000);
  if (assessCalls !== 1 || !gatedStore.getArchitectPublishedAssessment(symbol)) {
    throw new Error("architect should assess and publish once the interval is reached");
  }
  if (!gatedLogs.find((entry) => entry.event === "architect_published")) {
    throw new Error("eligible architect publish should still emit architect_published");
  }
  const customInitialPublish = gatedLogs.find((entry) => entry.event === "architect_published");
  if (!customInitialPublish || customInitialPublish.metadata.publisherPublishIntervalMs !== customPublishIntervalMs || customInitialPublish.metadata.warmupMs !== customWarmupMs) {
    throw new Error(`architect publish diagnostics should expose the configured cadence settings: ${JSON.stringify(customInitialPublish)}`);
  }
  const prunedArchitectStateKeys = [
    "contextDataQuality",
    "contextDirectionalEfficiency",
    "contextSlopeConsistency",
    "contextWindowMode",
    "publisherLastObservedAt",
    "publisherLastPublishedAt",
    "publisherNextPublishAt",
    "publisherReady",
    "trendBias",
    "volatilityState",
    "structureState"
  ];
  for (const key of prunedArchitectStateKeys) {
    if (Object.prototype.hasOwnProperty.call(customInitialPublish.metadata, key)) {
      throw new Error(`architect publish diagnostics should stop echoing rolling state field ${key}: ${JSON.stringify(customInitialPublish)}`);
    }
  }

  gatedStore.setContextSnapshot(symbol, {
    ...createContext(symbol, 16_000, true, "trend"),
    effectiveWindowStartedAt: 0,
    windowStartedAt: 0
  });
  gatedService.observe(symbol, 16_000);
  gatedStore.setContextSnapshot(symbol, {
    ...createContext(symbol, 29_000, true, "trend"),
    effectiveWindowStartedAt: 0,
    windowStartedAt: 0
  });
  gatedService.observe(symbol, 29_000);
  if (assessCalls !== 1) {
    throw new Error(`repeated ineligible ticks should not trigger heavy assessment work: ${assessCalls}`);
  }

  gatedStore.setContextSnapshot(symbol, {
    ...createContext(symbol, 30_000, true, "trend"),
    effectiveWindowStartedAt: 0,
    windowStartedAt: 0
  });
  gatedService.observe(symbol, 30_000);
  if (assessCalls !== 2) {
    throw new Error(`architect should assess again once the next publish window is eligible: ${assessCalls}`);
  }
  if (!gatedLogs.find((entry) => entry.event === "architect_publish_refreshed")) {
    throw new Error("eligible refresh cycle should still emit architect_publish_refreshed");
  }

  store.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "trend"));
  service.observe(symbol, 30_000);
  let published = store.getArchitectPublishedAssessment(symbol);
  if (!published || published.marketRegime !== "trend") {
    throw new Error("architect did not publish initial trend regime after warm-up");
  }
  const initialPublish = logs.find((entry) => entry.event === "architect_published");
  if (!initialPublish) {
    throw new Error("missing architect_published audit log");
  }
  if (initialPublish.metadata.candidateMarketRegime !== "trend" || initialPublish.metadata.publishedMarketRegime !== "trend" || initialPublish.metadata.candidateRecommendedFamily !== "trend_following" || initialPublish.metadata.publishedRecommendedFamily !== "trend_following") {
    throw new Error("architect publish log missing canonical regime/family diagnostics");
  }
  if (initialPublish.metadata.publishOutcome !== "published" || initialPublish.metadata.publisherLastRegimeSwitchAt !== null) {
    throw new Error("initial architect publish diagnostics should keep publish outcome and switch semantics");
  }

  store.setContextSnapshot(symbol, createContext(symbol, 45_000, true, "range-small"));
  service.observe(symbol, 45_000);
  published = store.getArchitectPublishedAssessment(symbol);
  if (!published || published.marketRegime !== "trend" || published.updatedAt !== 30_000) {
    throw new Error("architect publish cadence did not hold state between publish windows");
  }

  store.setContextSnapshot(symbol, createContext(symbol, 60_000, true, "range-small"));
  service.observe(symbol, 60_000);
  published = store.getArchitectPublishedAssessment(symbol);
  const publisherState = store.getArchitectPublisherState(symbol);
  if (!published || published.marketRegime !== "trend") {
    throw new Error("tiny regime flip should have been blocked by hysteresis");
  }
  if (published.updatedAt !== 30_000) {
    throw new Error(`held incumbent payload should retain its original updatedAt: ${published.updatedAt}`);
  }
  if (!publisherState || publisherState.hysteresisActive !== true || publisherState.challengerRegime !== "range" || publisherState.challengerCount !== 1) {
    throw new Error("challenger state not tracked correctly after hysteresis block");
  }
  if (publisherState.lastPublishedAt !== 60_000 || publisherState.lastPublishedRegime !== "trend") {
    throw new Error("publisher freshness metadata did not advance on held incumbent cycle");
  }
  if (publisherState.lastRegimeSwitchAt !== null || publisherState.lastRegimeSwitchFrom !== null || publisherState.lastRegimeSwitchTo !== null) {
    throw new Error("publisher should not record a regime switch until the challenger actually becomes published");
  }
  const blockedAudit = logs.find((entry) => entry.event === "architect_switch_blocked");
  if (!blockedAudit || blockedAudit.metadata.currentRegime !== "trend" || blockedAudit.metadata.candidateRegime !== "range") {
    throw new Error("missing architect_switch_blocked audit log for hysteresis hold");
  }
  if (blockedAudit.metadata.reason !== "below_switch_delta") {
    throw new Error(`unexpected blocked-switch reason: ${blockedAudit.metadata.reason}`);
  }
  const heldAudit = logs.find((entry) => entry.event === "architect_publish_held");
  if (!heldAudit || heldAudit.metadata.publishedMarketRegime !== "trend" || heldAudit.metadata.candidateMarketRegime !== "range") {
    throw new Error("missing architect held-cycle diagnostics");
  }
  if (heldAudit.metadata.publishOutcome !== "held" || heldAudit.metadata.incumbentScore !== 0.67 || heldAudit.metadata.publisherChallengerCount !== 1) {
    throw new Error("held-cycle diagnostic fields are incomplete");
  }
  if (heldAudit.metadata.publishedPayloadChanged !== false || heldAudit.metadata.publisherMetadataOnly !== true) {
    throw new Error("held-cycle log did not distinguish payload stability from publisher metadata refresh");
  }
  if (heldAudit.metadata.publishedPayloadUpdatedAt !== 30_000 || heldAudit.metadata.candidateObservedAt !== 60_000) {
    throw new Error("held-cycle log timestamp semantics are incorrect");
  }
  if (Object.prototype.hasOwnProperty.call(heldAudit.metadata, "contextReversionStretch") || Object.prototype.hasOwnProperty.call(heldAudit.metadata, "contextBreakoutInstability")) {
    throw new Error(`held-cycle diagnostics should stop echoing context snapshot fields: ${JSON.stringify(heldAudit)}`);
  }

  const incumbentBasisStore = new StateStore();
  const incumbentBasisLogs = [];
  const incumbentBasisService = new ArchitectService({
    botArchitect: {
      assess() {
        return null;
      }
    },
    logger: {
      info(event, metadata) {
        incumbentBasisLogs.push({ event, metadata });
      }
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    publishIntervalMs: 30_000,
    requiredConfirmations: 2,
    store: incumbentBasisStore,
    switchDelta: 0.12
  });
  const publishedIncumbent = createAssessment(symbol, "trend", "trend_following", {
    range: 0.22,
    trend: 0.7,
    unclear: 0.11,
    volatile: 0.14
  }, 30_000);
  incumbentBasisStore.setArchitectPublishedAssessment(symbol, publishedIncumbent);
  incumbentBasisStore.setArchitectPublisherState(symbol, {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: 30_000,
    lastPublishedAt: 30_000,
    lastPublishedRegime: "trend",
    lastRegimeSwitchAt: null,
    lastRegimeSwitchFrom: null,
    lastRegimeSwitchTo: null,
    nextPublishAt: 60_000,
    publishIntervalMs: 30_000,
    ready: true,
    symbol,
    warmupStartedAt: 0
  });
  incumbentBasisService.publish(symbol, createAssessment(symbol, "range", "mean_reversion", {
    range: 0.62,
    trend: 0.45,
    unclear: 0.12,
    volatile: 0.16
  }, 60_000), 60_000, createContext(symbol, 60_000, true, "range-small"), null);
  const incumbentBasisPublished = incumbentBasisStore.getArchitectPublishedAssessment(symbol);
  if (!incumbentBasisPublished || incumbentBasisPublished.marketRegime !== "trend" || incumbentBasisPublished.updatedAt !== 30_000) {
    throw new Error(`switchDelta should compare against the published incumbent score, not the candidate's incumbent-regime score: ${JSON.stringify(incumbentBasisPublished)}`);
  }
  const incumbentBasisBlocked = incumbentBasisLogs.find((entry) => entry.event === "architect_switch_blocked");
  if (!incumbentBasisBlocked || incumbentBasisBlocked.metadata.incumbentScore !== 0.7 || incumbentBasisBlocked.metadata.candidateScore !== 0.62) {
    throw new Error(`blocked switch diagnostics should expose the true published incumbent score: ${JSON.stringify(incumbentBasisBlocked)}`);
  }
  if (incumbentBasisLogs.find((entry) => entry.event === "architect_changed")) {
    throw new Error("switchDelta should not publish a weaker challenger by comparing against the candidate's lower trend score");
  }

  store.setContextSnapshot(symbol, createContext(symbol, 90_000, true, "range-small"));
  service.observe(symbol, 90_000);
  published = store.getArchitectPublishedAssessment(symbol);
  if (!published || published.marketRegime !== "range" || published.recommendedFamily !== "mean_reversion") {
    throw new Error("persistent challenger did not eventually become the published regime");
  }
  const switchedPublisherState = store.getArchitectPublisherState(symbol);
  if (!switchedPublisherState || switchedPublisherState.lastRegimeSwitchAt !== 90_000 || switchedPublisherState.lastRegimeSwitchFrom !== "trend" || switchedPublisherState.lastRegimeSwitchTo !== "range") {
    throw new Error("published regime switch metadata was not recorded when the incumbent actually changed");
  }
  const switchedAudit = logs.find((entry) => entry.event === "architect_changed");
  if (!switchedAudit || switchedAudit.metadata.publisherLastRegimeSwitchAt !== 90_000 || switchedAudit.metadata.publisherLastRegimeSwitchFrom !== "trend" || switchedAudit.metadata.publisherLastRegimeSwitchTo !== "range") {
    throw new Error("architect_changed diagnostics are missing published regime switch metadata");
  }

  // ══════════════════════════════════════════════════════════
  //  MTF integration tests
  // ══════════════════════════════════════════════════════════

  // ── MTF disabled: baseline behavior unchanged ──

  {
    const mtfOffStore = new StateStore();
    const mtfOffLogs = [];
    const mtfOffService = new ArchitectService({
      botArchitect: {
        assess(context) {
          return createAssessment(context.symbol, "trend", "trend_following", {
            range: 0.24, trend: 0.67, unclear: 0.11, volatile: 0.15
          }, context.observedAt);
        }
      },
      logger: { info(event, metadata) { mtfOffLogs.push({ event, metadata }); } },
      marketStream: { subscribe() { return () => {}; } },
      publishIntervalMs: 30_000,
      requiredConfirmations: 2,
      store: mtfOffStore,
      switchDelta: 0.12,
      // No mtfConfig or mtfContextService → MTF disabled
    });
    mtfOffStore.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "trend"));
    mtfOffService.observe(symbol, 30_000);
    const mtfOffPublished = mtfOffStore.getArchitectPublishedAssessment(symbol);
    if (!mtfOffPublished || mtfOffPublished.marketRegime !== "trend") {
      throw new Error("MTF-disabled: baseline publish should be unchanged (trend)");
    }
    if (mtfOffPublished.recommendedFamily !== "trend_following") {
      throw new Error("MTF-disabled: baseline family should be unchanged (trend_following)");
    }
  }

  // ── MTF enabled with stable aligned frames: consolidated publish keeps regime ──

  {
    const mtfAlignedStore = new StateStore();
    const mtfAlignedLogs = [];
    const mtfAlignedService = new ArchitectService({
      botArchitect: {
        assess(context) {
          return createAssessment(context.symbol, "trend", "trend_following", {
            range: 0.24, trend: 0.67, unclear: 0.11, volatile: 0.15
          }, context.observedAt);
        }
      },
      logger: { info(event, metadata) { mtfAlignedLogs.push({ event, metadata }); } },
      marketStream: { subscribe() { return () => {}; } },
      publishIntervalMs: 30_000,
      requiredConfirmations: 2,
      store: mtfAlignedStore,
      switchDelta: 0.12,
      mtfContextService: {
        buildMtfSnapshots() {
          return [
            { timeframe: "1m", horizonFrame: "short", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.7, ready: true, observedAt: 30_000 },
            { timeframe: "5m", horizonFrame: "short", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.8, ready: true, observedAt: 30_000 },
            { timeframe: "15m", horizonFrame: "medium", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.75, ready: true, observedAt: 30_000 },
          ];
        }
      },
      mtfConfig: { enabled: true },
    });
    mtfAlignedStore.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "trend"));
    mtfAlignedService.observe(symbol, 30_000);
    const mtfAlignedPublished = mtfAlignedStore.getArchitectPublishedAssessment(symbol);
    if (!mtfAlignedPublished || mtfAlignedPublished.marketRegime !== "trend") {
      throw new Error("MTF aligned: stable agreement should keep trend regime");
    }
    if (mtfAlignedPublished.recommendedFamily !== "trend_following") {
      throw new Error("MTF aligned: stable agreement should keep trend_following family");
    }
    if (mtfAlignedPublished.mtf?.mtfDominantFrame !== "short" || mtfAlignedLogs[0]?.metadata?.publishedMtfDominantFrame !== "short") {
      throw new Error(`MTF aligned: publish should expose dominant internal frame: ${JSON.stringify(mtfAlignedPublished.mtf)}`);
    }
  }

  // ── MTF enabled with conflicting frames: instability forces unclear ──

  {
    const mtfConflictStore = new StateStore();
    const mtfConflictLogs = [];
    const mtfConflictService = new ArchitectService({
      botArchitect: {
        assess(context) {
          return createAssessment(context.symbol, "trend", "trend_following", {
            range: 0.24, trend: 0.67, unclear: 0.11, volatile: 0.15
          }, context.observedAt);
        }
      },
      logger: { info(event, metadata) { mtfConflictLogs.push({ event, metadata }); } },
      marketStream: { subscribe() { return () => {}; } },
      publishIntervalMs: 30_000,
      requiredConfirmations: 2,
      store: mtfConflictStore,
      switchDelta: 0.12,
      mtfContextService: {
        buildMtfSnapshots() {
          // 1 trend, 1 range, 1 volatile → tied, instability = 1
          return [
            { timeframe: "1m", horizonFrame: "short", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.6, ready: true, observedAt: 30_000 },
            { timeframe: "5m", horizonFrame: "short", regime: "range", trendBias: "neutral", volatilityState: "normal", structureState: "choppy", confidence: 0.5, ready: true, observedAt: 30_000 },
            { timeframe: "15m", horizonFrame: "medium", regime: "volatile", trendBias: "bearish", volatilityState: "expanding", structureState: "choppy", confidence: 0.4, ready: true, observedAt: 30_000 },
          ];
        }
      },
      mtfConfig: { enabled: true, instabilityThreshold: 0.5 },
    });
    mtfConflictStore.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "trend"));
    mtfConflictService.observe(symbol, 30_000);
    const mtfConflictPublished = mtfConflictStore.getArchitectPublishedAssessment(symbol);
    if (!mtfConflictPublished || mtfConflictPublished.marketRegime !== "unclear") {
      throw new Error(`MTF conflict: high instability should force unclear, got ${mtfConflictPublished?.marketRegime}`);
    }
    if (mtfConflictPublished.recommendedFamily !== "no_trade") {
      throw new Error(`MTF conflict: high instability should force no_trade, got ${mtfConflictPublished?.recommendedFamily}`);
    }
  }

  // ── MTF enabled with disagreement (not high instability): regime override ──

  {
    const mtfOverrideStore = new StateStore();
    const mtfOverrideLogs = [];
    const mtfOverrideService = new ArchitectService({
      botArchitect: {
        assess(context) {
          return createAssessment(context.symbol, "trend", "trend_following", {
            range: 0.24, trend: 0.67, unclear: 0.11, volatile: 0.15
          }, context.observedAt);
        }
      },
      logger: { info(event, metadata) { mtfOverrideLogs.push({ event, metadata }); } },
      marketStream: { subscribe() { return () => {}; } },
      publishIntervalMs: 30_000,
      requiredConfirmations: 2,
      store: mtfOverrideStore,
      switchDelta: 0.12,
      mtfContextService: {
        buildMtfSnapshots() {
          // 2 range, 1 trend → majority is range, instability = 1/3 (~0.33, below 0.5)
          return [
            { timeframe: "1m", horizonFrame: "short", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.6, ready: true, observedAt: 30_000 },
            { timeframe: "5m", horizonFrame: "short", regime: "range", trendBias: "neutral", volatilityState: "normal", structureState: "choppy", confidence: 0.7, ready: true, observedAt: 30_000 },
            { timeframe: "15m", horizonFrame: "medium", regime: "range", trendBias: "neutral", volatilityState: "normal", structureState: "choppy", confidence: 0.75, ready: true, observedAt: 30_000 },
          ];
        }
      },
      mtfConfig: { enabled: true, instabilityThreshold: 0.5 },
    });
    mtfOverrideStore.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "trend"));
    mtfOverrideService.observe(symbol, 30_000);
    const mtfOverridePublished = mtfOverrideStore.getArchitectPublishedAssessment(symbol);
    if (!mtfOverridePublished || mtfOverridePublished.marketRegime !== "range") {
      throw new Error(`MTF override: MTF majority range should override single-frame trend, got ${mtfOverridePublished?.marketRegime}`);
    }
    if (mtfOverridePublished.recommendedFamily !== "mean_reversion") {
      throw new Error(`MTF override: should recommend mean_reversion, got ${mtfOverridePublished?.recommendedFamily}`);
    }
    if (mtfOverridePublished.mtf?.mtfDominantFrame !== "medium") {
      throw new Error(`MTF override: should publish medium dominant frame, got ${JSON.stringify(mtfOverridePublished.mtf)}`);
    }
  }

  // ── MTF enabled with insufficient ready frames: baseline preserved ──

  {
    const mtfInsufficientStore = new StateStore();
    const mtfInsufficientService = new ArchitectService({
      botArchitect: {
        assess(context) {
          return createAssessment(context.symbol, "trend", "trend_following", {
            range: 0.24, trend: 0.67, unclear: 0.11, volatile: 0.15
          }, context.observedAt);
        }
      },
      logger: { info() {} },
      marketStream: { subscribe() { return () => {}; } },
      publishIntervalMs: 30_000,
      requiredConfirmations: 2,
      store: mtfInsufficientStore,
      switchDelta: 0.12,
      mtfContextService: {
        buildMtfSnapshots() {
          return [
            { timeframe: "1m", horizonFrame: "short", regime: "range", trendBias: "neutral", volatilityState: "normal", structureState: "choppy", confidence: 0.5, ready: true, observedAt: 30_000 },
            { timeframe: "5m", horizonFrame: "short", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.0, ready: false, observedAt: 30_000 },
            { timeframe: "15m", horizonFrame: "medium", regime: "trend", trendBias: "bullish", volatilityState: "normal", structureState: "trending", confidence: 0.0, ready: false, observedAt: 30_000 },
          ];
        }
      },
      mtfConfig: { enabled: true },
    });
    mtfInsufficientStore.setContextSnapshot(symbol, createContext(symbol, 30_000, true, "trend"));
    mtfInsufficientService.observe(symbol, 30_000);
    const mtfInsufficientPublished = mtfInsufficientStore.getArchitectPublishedAssessment(symbol);
    if (!mtfInsufficientPublished || mtfInsufficientPublished.marketRegime !== "trend") {
      throw new Error("MTF insufficient: with < 2 ready frames, baseline trend should be preserved");
    }
  }

  // ── MTF cannot bypass publish cadence ──

  {
    const mtfCadenceStore = new StateStore();
    let mtfCadenceAssessCalls = 0;
    const mtfCadenceService = new ArchitectService({
      botArchitect: {
        assess(context) {
          mtfCadenceAssessCalls += 1;
          return createAssessment(context.symbol, "trend", "trend_following", {
            range: 0.24, trend: 0.67, unclear: 0.11, volatile: 0.15
          }, context.observedAt);
        }
      },
      logger: { info() {} },
      marketStream: { subscribe() { return () => {}; } },
      publishIntervalMs: 15_000,
      requiredConfirmations: 2,
      store: mtfCadenceStore,
      switchDelta: 0.12,
      mtfContextService: {
        buildMtfSnapshots() {
          return [
            { timeframe: "1m", horizonFrame: "short", regime: "range", trendBias: "neutral", volatilityState: "normal", structureState: "choppy", confidence: 0.7, ready: true, observedAt: 30_000 },
            { timeframe: "5m", horizonFrame: "short", regime: "range", trendBias: "neutral", volatilityState: "normal", structureState: "choppy", confidence: 0.8, ready: true, observedAt: 30_000 },
          ];
        }
      },
      mtfConfig: { enabled: true },
    });
    mtfCadenceStore.setContextSnapshot(symbol, {
      ...createContext(symbol, 15_000, true, "trend"),
      windowStartedAt: 0, effectiveWindowStartedAt: 0
    });
    mtfCadenceService.observe(symbol, 15_000);
    if (mtfCadenceAssessCalls !== 1) throw new Error("MTF cadence: first eligible tick should assess");
    mtfCadenceStore.setContextSnapshot(symbol, {
      ...createContext(symbol, 20_000, true, "trend"),
      windowStartedAt: 0, effectiveWindowStartedAt: 0
    });
    mtfCadenceService.observe(symbol, 20_000);
    if (mtfCadenceAssessCalls !== 1) {
      throw new Error("MTF cadence: MTF presence must not bypass publish interval gating");
    }
  }
}

module.exports = {
  runArchitectServiceTests
};
