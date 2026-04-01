// Module responsibility: mean reversion strategy for range-like conditions.

import type { MarketContext, Strategy, StrategyDecision } from "../../types/strategy.ts";

function createStrategy(config: { buyRsi?: number; sellRsi?: number; minConfidence?: number } = {}): Strategy {
  return {
    evaluate(context: MarketContext): StrategyDecision {
      const rsi = context.indicators.rsi;
      const emaSlow = context.indicators.emaSlow;
      const reasons = [`regime=${context.marketRegime}`, `rsi=${rsi?.toFixed(2) ?? "n/a"}`];

      if (rsi === null || emaSlow === null) {
        return { action: "hold", confidence: 0.1, reason: [...reasons, "insufficient_history"] };
      }

      if (!context.hasOpenPosition && context.marketRegime === "range" && rsi <= (config.buyRsi || 33) && context.latestPrice <= emaSlow) {
        const confidence = Math.max(0.4, Math.min(0.92, ((config.buyRsi || 33) - rsi) / 20 + 0.55));
        return { action: "buy", confidence, reason: [...reasons, "oversold_range_reversion"] };
      }

      if (context.hasOpenPosition && (rsi >= (config.sellRsi || 58) || context.latestPrice > emaSlow * 1.015)) {
        return { action: "sell", confidence: 0.7, reason: [...reasons, "reversion_target_hit"] };
      }

      return { action: "hold", confidence: config.minConfidence || 0.55, reason: [...reasons, "range_mean_not_ready"] };
    },
    id: "rsiReversion"
  };
}

module.exports = {
  createStrategy
};

