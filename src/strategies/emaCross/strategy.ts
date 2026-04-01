// Module responsibility: trend-following EMA cross strategy.

import type { MarketContext, Strategy, StrategyDecision } from "../../types/strategy.ts";

function createStrategy(config: { emaFast?: number; emaSlow?: number; emaBaseline?: number; minConfidence?: number; rsiFloor?: number } = {}): Strategy {
  return {
    evaluate(context: MarketContext): StrategyDecision {
      const { emaFast, emaSlow, emaBaseline, rsi, momentum } = context.indicators;
      const confidence = Math.max(Math.min(((context.indicators.momentum || 0) / Math.max(context.latestPrice, 1)) * 45 + 0.62, 0.95), 0.1);
      const reasons = [
        `emaFast=${emaFast?.toFixed(4) ?? "n/a"}`,
        `emaSlow=${emaSlow?.toFixed(4) ?? "n/a"}`,
        `regime=${context.marketRegime}`
      ];

      if (!emaFast || !emaSlow || !emaBaseline || !rsi || !momentum) {
        return { action: "hold", confidence: 0.15, reason: [...reasons, "insufficient_history"] };
      }

      if (emaFast > emaSlow && context.latestPrice > emaBaseline && rsi >= (config.rsiFloor || 48) && momentum > 0) {
        return { action: "buy", confidence, reason: [...reasons, "bullish_cross_confirmed"] };
      }

      if (context.hasOpenPosition && (emaFast < emaSlow || momentum < 0)) {
        return { action: "sell", confidence: 0.72, reason: [...reasons, "cross_lost_or_momentum_down"] };
      }

      return { action: "hold", confidence: config.minConfidence || 0.58, reason: [...reasons, "trend_not_ready"] };
    },
    id: "emaCross"
  };
}

module.exports = {
  createStrategy
};

