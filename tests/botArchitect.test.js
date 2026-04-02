"use strict";

const { BotArchitect } = require("../src/roles/botArchitect.ts");

function createContextSnapshot(overrides = {}) {
  const features = {
    breakoutDirection: "none",
    breakoutInstability: 0.08,
    breakoutQuality: 0.2,
    chopiness: 0.35,
    dataQuality: 0.9,
    directionalEfficiency: 0.65,
    emaBias: 0.3,
    emaSeparation: 0.58,
    featureConflict: 0.1,
    maturity: 0.85,
    netMoveRatio: 0.02,
    reversionStretch: 0.25,
    rsiIntensity: 0.18,
    slopeConsistency: 0.62,
    volatilityRisk: 0.22,
    ...(overrides.features || {})
  };

  return {
    dataMode: "live",
    observedAt: 1_000_000,
    sampleSize: 180,
    structureState: "trending",
    summary: "Test context snapshot.",
    symbol: "BTC/USDT",
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete: true,
    windowSpanMs: 240_000,
    windowStartedAt: 760_000,
    ...overrides,
    features
  };
}

function runBotArchitectTests() {
  const architect = new BotArchitect();

  const trendAssessment = architect.assess(createContextSnapshot());
  if (trendAssessment.marketRegime !== "trend") {
    throw new Error(`expected trend regime, received ${trendAssessment.marketRegime}`);
  }
  if (trendAssessment.recommendedFamily !== "trend_following") {
    throw new Error(`expected trend_following family, received ${trendAssessment.recommendedFamily}`);
  }

  const rangeAssessment = architect.assess(createContextSnapshot({
    features: {
      breakoutInstability: 0.05,
      breakoutQuality: 0.06,
      chopiness: 0.76,
      directionalEfficiency: 0.16,
      emaSeparation: 0.12,
      featureConflict: 0.12,
      maturity: 0.9,
      reversionStretch: 0.92,
      rsiIntensity: 0.86,
      slopeConsistency: 0.08,
      volatilityRisk: 0.18
    },
    structureState: "choppy",
    symbol: "ETH/USDT",
    trendBias: "neutral"
  }));
  if (rangeAssessment.marketRegime !== "range") {
    throw new Error(`expected range regime, received ${rangeAssessment.marketRegime}`);
  }
  if (rangeAssessment.recommendedFamily !== "mean_reversion") {
    throw new Error(`expected mean_reversion family, received ${rangeAssessment.recommendedFamily}`);
  }

  const volatileAssessment = architect.assess(createContextSnapshot({
    features: {
      breakoutInstability: 0.84,
      breakoutQuality: 0.42,
      chopiness: 0.72,
      directionalEfficiency: 0.18,
      emaSeparation: 0.52,
      featureConflict: 0.88,
      maturity: 0.88,
      reversionStretch: 0.58,
      rsiIntensity: 0.51,
      slopeConsistency: 0.14,
      volatilityRisk: 0.93
    },
    structureState: "reversal-risk",
    symbol: "SOL/USDT",
    volatilityState: "expanding"
  }));
  if (volatileAssessment.marketRegime !== "volatile") {
    throw new Error(`expected volatile regime, received ${volatileAssessment.marketRegime}`);
  }
  if (volatileAssessment.recommendedFamily !== "no_trade") {
    throw new Error(`expected no_trade family for volatile regime, received ${volatileAssessment.recommendedFamily}`);
  }
  if (volatileAssessment.regimeScores.volatile <= volatileAssessment.regimeScores.trend) {
    throw new Error("volatile regime did not explicitly win its weighted score race");
  }

  const lowMaturityAssessment = architect.assess(createContextSnapshot({
    features: {
      maturity: 0.24
    }
  }));
  if (lowMaturityAssessment.marketRegime !== "unclear" || lowMaturityAssessment.recommendedFamily !== "no_trade") {
    throw new Error("default architect maturity gate should block sub-0.25 contexts from classifying");
  }
  if (!lowMaturityAssessment.reasonCodes.includes("maturity_gate")) {
    throw new Error("low-maturity architect output should include maturity_gate diagnostics");
  }

  const warmupAssessment = architect.assess(createContextSnapshot({
    dataMode: "mock",
    features: {
      dataQuality: 0.72,
      maturity: 0.05
    },
    sampleSize: 20,
    warmupComplete: false,
    windowSpanMs: 12_000
  }));
  if (warmupAssessment.marketRegime !== "unclear" || warmupAssessment.recommendedFamily !== "no_trade") {
    throw new Error("warm-up gate did not force unclear / no_trade");
  }
  if (!warmupAssessment.reasonCodes.includes("architect_warmup") || !warmupAssessment.reasonCodes.includes("mock_data_source")) {
    throw new Error("warm-up or mock diagnostics missing from architect output");
  }
}

module.exports = {
  runBotArchitectTests
};
