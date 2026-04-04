// Module responsibility: trend-following EMA cross strategy.

import type { MarketContext, Strategy, StrategyDecision, StrategyEntryEdgeInputs } from "../../types/strategy.ts";

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
  return Math.max(
    0,
    (0.5 * inputs.emaGapPct) +
    (0.35 * inputs.momentumEdgePct) +
    (0.15 * inputs.meanReversionGapPct)
  );
}

function createStrategy(config: { emaFast?: number; emaSlow?: number; emaBaseline?: number; minConfidence?: number; rsiFloor?: number } = {}): Strategy {
  return {
    evaluate(context: MarketContext): StrategyDecision {
      const { emaFast, emaSlow, emaBaseline, rsi, momentum } = context.indicators;
      const priceScale = resolvePriceScale(context.latestPrice, emaBaseline, emaSlow, emaFast);
      const rsiFloor = config.rsiFloor ?? 51;
      const positiveMomentumPct = Math.max(0, Number(momentum || 0)) / priceScale;
      const negativeMomentumPct = Math.max(0, Number(-(momentum || 0))) / priceScale;
      const bullishEmaGapPct = Math.max(0, Number(emaFast || 0) - Number(emaSlow || 0)) / priceScale;
      const bearishEmaGapPct = Math.max(0, Number(emaSlow || 0) - Number(emaFast || 0)) / priceScale;
      const rsiLiftScore = clamp((Number(rsi || 0) - rsiFloor) / 12, 0, 1);
      const buyConfidence = clamp(
        0.56
        + (0.22 * boundedShare(positiveMomentumPct, 0.01))
        + (0.12 * boundedShare(bullishEmaGapPct, 0.006))
        + (0.05 * rsiLiftScore),
        0.12,
        0.94
      );
      const sellConfidence = clamp(
        0.6
        + (0.18 * boundedShare(negativeMomentumPct, 0.01))
        + (0.16 * boundedShare(bearishEmaGapPct, 0.006)),
        0.12,
        0.93
      );
      const reasons = [
        `emaFast=${emaFast?.toFixed(4) ?? "n/a"}`,
        `emaSlow=${emaSlow?.toFixed(4) ?? "n/a"}`,
        `localRegimeHint=${context.localRegimeHint}`
      ];

      if (!emaFast || !emaSlow || !emaBaseline || !rsi || !momentum) {
        return { action: "hold", confidence: 0.15, reason: [...reasons, "insufficient_history"] };
      }

      if (emaFast > emaSlow && context.latestPrice > emaBaseline && rsi >= rsiFloor && momentum > 0) {
        return { action: "buy", confidence: buyConfidence, reason: [...reasons, "bullish_cross_confirmed"] };
      }

      if (context.hasOpenPosition && (emaFast < emaSlow || momentum < 0)) {
        return { action: "sell", confidence: sellConfidence, reason: [...reasons, "cross_lost_or_momentum_down"] };
      }

      return { action: "hold", confidence: config.minConfidence ?? 0.58, reason: [...reasons, "trend_not_ready"] };
    },
    estimateExpectedGrossEdgePct,
    id: "emaCross"
  };
}

module.exports = {
  createStrategy
};
