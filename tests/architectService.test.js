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

function createContext(symbol, observedAt, warmupComplete, label) {
  return {
    dataMode: "live",
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
    observedAt,
    sampleSize: warmupComplete ? 120 : 10,
    stage: label,
    structureState: "trending",
    summary: `Context ${label}`,
    symbol,
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete,
    windowSpanMs: warmupComplete ? 60_000 : 10_000,
    windowStartedAt: observedAt - (warmupComplete ? 60_000 : 10_000)
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
  if (initialPublish.metadata.trendScore !== 0.67 || initialPublish.metadata.rangeScore !== 0.24 || initialPublish.metadata.volatileScore !== 0.15) {
    throw new Error("architect publish log missing regime score diagnostics");
  }
  if (initialPublish.metadata.dataQuality !== 0.92 || initialPublish.metadata.directionalEfficiency !== 0.62 || initialPublish.metadata.slopeConsistency !== 0.59) {
    throw new Error("architect publish log missing context feature diagnostics");
  }
  if (initialPublish.metadata.trendBias !== "bullish" || initialPublish.metadata.volatilityState !== "normal" || initialPublish.metadata.structureState !== "trending") {
    throw new Error("architect publish log missing state labels");
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
  if (published.updatedAt !== 60_000) {
    throw new Error(`hold cycle did not refresh published updatedAt: ${published.updatedAt}`);
  }
  if (!publisherState || publisherState.hysteresisActive !== true || publisherState.challengerRegime !== "range" || publisherState.challengerCount !== 1) {
    throw new Error("challenger state not tracked correctly after hysteresis block");
  }
  if (publisherState.lastPublishedAt !== 60_000 || publisherState.lastPublishedRegime !== "trend") {
    throw new Error("publisher freshness metadata did not advance on held incumbent cycle");
  }
  const blockedAudit = logs.find((entry) => entry.event === "architect_switch_blocked");
  if (!blockedAudit || blockedAudit.metadata.currentRegime !== "trend" || blockedAudit.metadata.candidateRegime !== "range") {
    throw new Error("missing architect_switch_blocked audit log for hysteresis hold");
  }
  if (blockedAudit.metadata.reason !== "below_switch_delta") {
    throw new Error(`unexpected blocked-switch reason: ${blockedAudit.metadata.reason}`);
  }
  const heldAudit = logs.find((entry) => entry.event === "architect_publish_held");
  if (!heldAudit || heldAudit.metadata.marketRegime !== "trend" || heldAudit.metadata.candidateRegime !== "range") {
    throw new Error("missing architect held-cycle diagnostics");
  }
  if (heldAudit.metadata.publishOutcome !== "held" || heldAudit.metadata.reversionStretch !== 0.2 || heldAudit.metadata.breakoutInstability !== 0.1) {
    throw new Error("held-cycle diagnostic fields are incomplete");
  }

  store.setContextSnapshot(symbol, createContext(symbol, 90_000, true, "range-small"));
  service.observe(symbol, 90_000);
  published = store.getArchitectPublishedAssessment(symbol);
  if (!published || published.marketRegime !== "range" || published.recommendedFamily !== "mean_reversion") {
    throw new Error("persistent challenger did not eventually become the published regime");
  }
}

module.exports = {
  runArchitectServiceTests
};
