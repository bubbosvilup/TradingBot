// Module responsibility: classify prepared context into a stable strategy family recommendation.

import type { ArchitectAssessment, FamilyScores, MarketRegime, RegimeScores, RecommendedFamily } from "../types/architect.ts";
import type { ContextSnapshot } from "../types/context.ts";

const { clamp } = require("../utils/math.ts");

class BotArchitect {
  minMaturity: number;
  minDataQuality: number;
  minStrength: number;

  constructor(options: { minMaturity?: number; minDataQuality?: number; minStrength?: number } = {}) {
    this.minMaturity = options.minMaturity ?? 0.1;
    this.minDataQuality = options.minDataQuality ?? 0.45;
    this.minStrength = options.minStrength ?? 0.38;
  }

  assess(context: ContextSnapshot): ArchitectAssessment {
    const features = context.features;
    const trendScore = clamp(
      (0.30 * features.directionalEfficiency) +
      (0.20 * features.emaSeparation) +
      (0.20 * features.slopeConsistency) +
      (0.20 * features.breakoutQuality) +
      (0.10 * features.maturity) -
      (0.20 * features.chopiness) -
      (0.10 * features.volatilityRisk),
      0,
      1
    );

    const rangeScore = clamp(
      (0.30 * features.reversionStretch) +
      (0.25 * features.rsiIntensity) +
      (0.20 * (1 - features.directionalEfficiency)) +
      (0.15 * features.chopiness) +
      (0.10 * features.maturity) -
      (0.20 * features.breakoutQuality),
      0,
      1
    );

    const volatileScore = clamp(
      (0.45 * features.volatilityRisk) +
      (0.25 * features.featureConflict) +
      (0.20 * features.breakoutInstability) +
      (0.10 * (1 - features.directionalEfficiency)),
      0,
      1
    );

    const regimeScores: RegimeScores = {
      range: Number(rangeScore.toFixed(4)),
      trend: Number(trendScore.toFixed(4)),
      unclear: 0,
      volatile: Number(volatileScore.toFixed(4))
    };

    const ranked = Object.entries(regimeScores)
      .filter(([key]) => key !== "unclear")
      .sort((left, right) => Number(right[1]) - Number(left[1]));
    const topRegime = ranked[0]?.[0] as MarketRegime | undefined;
    const topScore = Number(ranked[0]?.[1] || 0);
    const secondScore = Number(ranked[1]?.[1] || 0);
    const decisionStrength = clamp(topScore - secondScore, 0, 1);
    const gatesFailed = !context.warmupComplete
      || features.maturity < this.minMaturity
      || features.dataQuality < this.minDataQuality
      || topScore < this.minStrength;

    const marketRegime: MarketRegime = !topRegime || gatesFailed
      ? "unclear"
      : topRegime;
    regimeScores.unclear = Number(clamp(
      gatesFailed
        ? Math.max(
            1 - features.maturity,
            1 - features.dataQuality,
            1 - topScore
          )
        : Math.max(0, 1 - topScore - (decisionStrength * 0.5)),
      0,
      1
    ).toFixed(4));

    const recommendedFamily: RecommendedFamily = marketRegime === "trend"
      ? "trend_following"
      : marketRegime === "range"
        ? "mean_reversion"
        : "no_trade";

    const signalAgreement = this.calculateSignalAgreement(marketRegime, features);
    const familyScores: FamilyScores = {
      mean_reversion: Number(rangeScore.toFixed(4)),
      no_trade: Number(Math.max(volatileScore, regimeScores.unclear).toFixed(4)),
      trend_following: Number(trendScore.toFixed(4))
    };
    const reasonCodes = this.buildReasonCodes(context, marketRegime);
    const absoluteConviction = marketRegime === "unclear" ? regimeScores.unclear : topScore;
    const confidence = clamp((0.7 * absoluteConviction) + (0.3 * decisionStrength), 0, 1);

    return {
      absoluteConviction: Number(absoluteConviction.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      contextMaturity: Number(features.maturity.toFixed(4)),
      dataMode: context.dataMode,
      decisionStrength: Number(decisionStrength.toFixed(4)),
      familyScores,
      featureConflict: Number(features.featureConflict.toFixed(4)),
      marketRegime,
      reasonCodes,
      recommendedFamily,
      regimeScores,
      sampleSize: context.sampleSize,
      signalAgreement: Number(signalAgreement.toFixed(4)),
      structureState: context.structureState,
      sufficientData: context.warmupComplete && features.dataQuality >= this.minDataQuality,
      summary: this.buildSummary(context, marketRegime, recommendedFamily, decisionStrength),
      symbol: context.symbol,
      trendBias: context.trendBias,
      updatedAt: context.observedAt,
      volatilityState: context.volatilityState
    };
  }

  calculateSignalAgreement(marketRegime: MarketRegime, features: ContextSnapshot["features"]) {
    const weightedMean = (pairs: Array<[number, number]>) => {
      const totalWeight = pairs.reduce((sum, [, weight]) => sum + weight, 0);
      if (totalWeight <= 0) return 0;
      return pairs.reduce((sum, [value, weight]) => sum + (value * weight), 0) / totalWeight;
    };

    if (marketRegime === "trend") {
      return clamp(weightedMean([
        [features.directionalEfficiency, 0.22],
        [features.emaSeparation, 0.16],
        [features.slopeConsistency, 0.18],
        [features.breakoutQuality, 0.16],
        [features.maturity, 0.10],
        [1 - features.chopiness, 0.10],
        [1 - features.volatilityRisk, 0.08]
      ]), 0, 1);
    }

    if (marketRegime === "range") {
      return clamp(weightedMean([
        [features.reversionStretch, 0.24],
        [features.rsiIntensity, 0.20],
        [1 - features.directionalEfficiency, 0.18],
        [features.chopiness, 0.16],
        [features.maturity, 0.10],
        [1 - features.breakoutQuality, 0.12]
      ]), 0, 1);
    }

    if (marketRegime === "volatile") {
      return clamp(weightedMean([
        [features.volatilityRisk, 0.34],
        [features.featureConflict, 0.24],
        [features.breakoutInstability, 0.22],
        [1 - features.directionalEfficiency, 0.10],
        [features.chopiness, 0.10]
      ]), 0, 1);
    }

    return clamp(weightedMean([
      [1 - features.maturity, 0.28],
      [1 - features.dataQuality, 0.28],
      [features.featureConflict, 0.18],
      [features.chopiness, 0.16],
      [features.volatilityRisk, 0.10]
    ]), 0, 1);
  }

  buildReasonCodes(context: ContextSnapshot, marketRegime: MarketRegime) {
    const features = context.features;
    const reasonCodes = [];
    if (!context.warmupComplete) reasonCodes.push("architect_warmup");
    if (features.maturity < this.minMaturity) reasonCodes.push("maturity_gate");
    if (features.dataQuality < this.minDataQuality) reasonCodes.push("data_quality_gate");
    if (features.breakoutDirection !== "none" && features.breakoutQuality > 0.25) {
      reasonCodes.push(`breakout_${features.breakoutDirection}`);
    }
    if (features.featureConflict >= 0.45) reasonCodes.push("feature_conflict");
    if (features.volatilityRisk >= 0.6) reasonCodes.push("volatility_risk");
    if (features.chopiness >= 0.6) reasonCodes.push("choppy_structure");
    if (marketRegime === "trend") reasonCodes.push("trend_structure");
    if (marketRegime === "range") reasonCodes.push("reversion_structure");
    if (marketRegime === "volatile") reasonCodes.push("volatile_structure");
    if (marketRegime === "unclear") reasonCodes.push("unclear_context");
    if (context.dataMode === "mock") reasonCodes.push("mock_data_source");
    return [...new Set(reasonCodes)];
  }

  buildSummary(context: ContextSnapshot, marketRegime: MarketRegime, family: RecommendedFamily, decisionStrength: number) {
    const prefix = context.dataMode === "mock" ? "Mock context" : "Market context";
    const strength = `${Math.round(decisionStrength * 100)}%`;
    if (marketRegime === "unclear") {
      return `${prefix} is not mature or coherent enough yet; keep no-trade bias. Strength ${strength}.`;
    }
    return `${prefix} favors ${marketRegime} with ${context.trendBias} bias; recommend ${family}. Strength ${strength}.`;
  }
}

module.exports = {
  BotArchitect
};
