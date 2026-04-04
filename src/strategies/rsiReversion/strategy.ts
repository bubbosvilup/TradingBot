// Module responsibility: mean reversion strategy for range-like conditions.

import type { MarketContext, Strategy, StrategyDecision, StrategyEntryEdgeInputs } from "../../types/strategy.ts";
const { resolveExitPolicy } = require("../../roles/exitPolicyRegistry.ts");
const { resolveRecoveryTarget, resolveRecoveryTargetPolicy } = require("../../roles/recoveryTargetResolver.ts");

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function boundedShare(value: number, scale: number) {
  const normalizedValue = Math.max(0, value);
  const normalizedScale = Math.max(scale, 1e-6);
  return normalizedValue / (normalizedValue + normalizedScale);
}

function resolvePriceScale(...values: Array<number | null | undefined>) {
  const finiteValues = values
    .map((value) => Math.abs(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (finiteValues.length <= 0) return 0.01;
  return Math.max(...finiteValues, 0.01);
}

function estimateExpectedGrossEdgePct(inputs: StrategyEntryEdgeInputs) {
  return Math.min(0.02, Math.max(0,
    (0.7 * inputs.captureGapPct) +
    (0.2 * inputs.downsideMeanReversionGapPct) +
    (0.07 * inputs.emaGapPct) +
    (0.03 * inputs.momentumEdgePct)
  ));
}

function createStrategy(config: {
  buyRsi?: number;
  sellRsi?: number;
  minConfidence?: number;
  exitPolicyId?: string;
  exitPolicy?: Record<string, unknown>;
} = {}): Strategy {
  const exitPolicy = resolveExitPolicy(config, "RSI_REVERSION_PRO");
  return {
    evaluate(context: MarketContext): StrategyDecision {
      const rsi = context.indicators.rsi;
      const emaSlow = context.indicators.emaSlow;
      const buyRsi = config.buyRsi ?? 33;
      const sellRsi = config.sellRsi ?? 58;
      const reasons = [`localRegimeHint=${context.localRegimeHint}`, `rsi=${rsi?.toFixed(2) ?? "n/a"}`];

      if (rsi === null || emaSlow === null) {
        return { action: "hold", confidence: 0.1, reason: [...reasons, "insufficient_history"] };
      }

      const priceScale = resolvePriceScale(context.latestPrice, emaSlow);
      const oversoldDistance = Math.max(0, buyRsi - rsi);
      const priceDiscountPct = Math.max(0, emaSlow - context.latestPrice) / priceScale;
      const buyConfidence = clamp(
        0.52
        + (0.24 * boundedShare(oversoldDistance, 8))
        + (0.12 * boundedShare(priceDiscountPct, 0.01)),
        0.4,
        0.9
      );
      const reversionTargetPolicy = resolveRecoveryTargetPolicy(exitPolicy);
      const resolvedRecoveryTarget = resolveRecoveryTarget({
        context,
        targetOffsetPct: reversionTargetPolicy.targetOffsetPct,
        targetSource: reversionTargetPolicy.targetSource
      });
      const exitPriceThreshold = resolvedRecoveryTarget.targetPrice ?? (emaSlow * 1.015);
      const rsiExitDistance = Math.max(0, rsi - sellRsi);
      const priceExtensionPct = Math.max(0, context.latestPrice - exitPriceThreshold) / priceScale;
      const sellConfidence = clamp(
        0.58
        + (0.22 * boundedShare(rsiExitDistance, 8))
        + (0.14 * boundedShare(priceExtensionPct, 0.008)),
        0.4,
        0.92
      );

      // Architect family routing decides when mean reversion is allowed system-wide.
      // The strategy keeps only its local technical trigger checks.
      if (!context.hasOpenPosition && rsi <= buyRsi && context.latestPrice <= emaSlow) {
        return { action: "buy", confidence: buyConfidence, reason: [...reasons, "oversold_mean_reversion"] };
      }

      const priceTargetHit = context.latestPrice > exitPriceThreshold;
      const rsiExitThresholdHit = rsi >= sellRsi;

      if (context.hasOpenPosition && priceTargetHit) {
        return { action: "sell", confidence: sellConfidence, reason: [...reasons, "reversion_price_target_hit"] };
      }

      if (context.hasOpenPosition && rsiExitThresholdHit) {
        return { action: "sell", confidence: sellConfidence, reason: [...reasons, "rsi_exit_threshold_hit"] };
      }

      return { action: "hold", confidence: config.minConfidence ?? 0.55, reason: [...reasons, "mean_reversion_not_ready"] };
    },
    estimateExpectedGrossEdgePct,
    id: "rsiReversion"
  };
}

module.exports = {
  createStrategy
};
