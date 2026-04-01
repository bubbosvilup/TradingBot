// Module responsibility: controlled strategy switching with cooldowns and loss-aware rules.

import type { BotConfig, BotRuntimeState } from "../types/bot.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";

class StrategySwitcher {
  switchCooldownMs: number;
  minTradesForEvaluation: number;
  negativeExpectancyTrades: number;
  drawdownThresholdPct: number;

  constructor(options: { switchCooldownMs?: number; minTradesForEvaluation?: number; negativeExpectancyTrades?: number; drawdownThresholdPct?: number } = {}) {
    this.switchCooldownMs = options.switchCooldownMs || 10 * 60 * 1000;
    this.minTradesForEvaluation = options.minTradesForEvaluation || 4;
    this.negativeExpectancyTrades = options.negativeExpectancyTrades || 5;
    this.drawdownThresholdPct = options.drawdownThresholdPct || 4;
  }

  evaluate(params: {
    availableStrategies: string[];
    botConfig: BotConfig;
    marketRegime: string;
    now: number;
    performance: PerformanceSnapshot;
    state: BotRuntimeState;
  }) {
    const allowedStrategies = params.availableStrategies.filter(Boolean);
    if (allowedStrategies.length <= 1) return null;
    if (params.state.lastStrategySwitchAt && (params.now - params.state.lastStrategySwitchAt) < this.switchCooldownMs) {
      return null;
    }
    if (params.performance.tradesCount < this.minTradesForEvaluation) {
      return null;
    }

    const recent = params.performance.recentNetPnl.slice(-this.negativeExpectancyTrades);
    const negativeExpectancy = recent.length >= this.negativeExpectancyTrades
      && recent.reduce((total, value) => total + value, 0) < 0;
    const drawdownTriggered = params.performance.drawdown >= this.drawdownThresholdPct;

    if (!negativeExpectancy && !drawdownTriggered) {
      return null;
    }

    const regimePreference = this.pickStrategyForRegime(params.marketRegime, allowedStrategies);
    const fallback = allowedStrategies.find((strategyId) => strategyId !== params.state.activeStrategyId) || null;
    const nextStrategyId = regimePreference !== params.state.activeStrategyId ? regimePreference : fallback;
    if (!nextStrategyId || nextStrategyId === params.state.activeStrategyId) return null;

    return {
      nextStrategyId,
      reason: drawdownTriggered ? "drawdown_threshold_exceeded" : "negative_expectancy_recent_trades"
    };
  }

  pickStrategyForRegime(regime: string, allowedStrategies: string[]) {
    const preference = regime === "trend"
      ? "emaCross"
      : regime === "range"
        ? "rsiReversion"
        : "breakout";
    return allowedStrategies.find((strategyId) => strategyId === preference) || allowedStrategies[0];
  }
}

module.exports = {
  StrategySwitcher
};
