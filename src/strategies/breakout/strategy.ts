// Module responsibility: breakout strategy for expansion and momentum phases.

import type { MarketContext, Strategy, StrategyDecision } from "../../types/strategy.ts";

function createStrategy(config: { lookback?: number; breakoutPct?: number; minConfidence?: number } = {}): Strategy {
  return {
    evaluate(context: MarketContext): StrategyDecision {
      const lookback = Math.max(config.lookback || 15, 5);
      const prices = context.prices.slice(-lookback);
      const breakoutPct = config.breakoutPct || 0.004;
      const reasons = [`regime=${context.marketRegime}`, `lookback=${lookback}`];

      if (prices.length < lookback) {
        return { action: "hold", confidence: 0.12, reason: [...reasons, "insufficient_history"] };
      }

      const rangeHigh = Math.max(...prices.slice(0, -1));
      const rangeLow = Math.min(...prices.slice(0, -1));

      if (!context.hasOpenPosition && context.latestPrice >= rangeHigh * (1 + breakoutPct)) {
        return {
          action: "buy",
          confidence: Math.min(0.96, 0.62 + ((context.latestPrice - rangeHigh) / Math.max(rangeHigh, 1)) * 40),
          reason: [...reasons, `range_high=${rangeHigh.toFixed(4)}`, "upside_breakout_detected"]
        };
      }

      if (context.hasOpenPosition && context.latestPrice <= rangeLow) {
        return {
          action: "sell",
          confidence: 0.76,
          reason: [...reasons, `range_low=${rangeLow.toFixed(4)}`, "failed_breakout_or_range_loss"]
        };
      }

      return { action: "hold", confidence: config.minConfidence || 0.6, reason: [...reasons, "breakout_not_triggered"] };
    },
    id: "breakout"
  };
}

module.exports = {
  createStrategy
};

