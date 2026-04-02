// Module responsibility: resolve published architect family into an executable strategy with only light execution-side guards.

import type { ArchitectAssessment, RecommendedFamily } from "../types/architect.ts";
import type { BotConfig, BotRuntimeState } from "../types/bot.ts";

class StrategySwitcher {
  maxDecisionAgeMs: number;

  constructor(options: { maxDecisionAgeMs?: number } = {}) {
    this.maxDecisionAgeMs = Math.max(options.maxDecisionAgeMs || 0, 0);
  }

  evaluate(params: {
    availableStrategies: string[];
    architect: ArchitectAssessment | null;
    botConfig: BotConfig;
    now: number;
    positionOpen?: boolean;
    state: BotRuntimeState;
  }) {
    void params.botConfig;

    const allowedStrategies = this.getRoutableStrategies(params.availableStrategies);
    if (allowedStrategies.length <= 1) return null;
    if (params.positionOpen) return null;
    if (!params.architect || !params.architect.sufficientData) return null;
    if (params.architect.recommendedFamily === "no_trade") return null;
    if (this.maxDecisionAgeMs > 0 && params.architect.updatedAt && (params.now - params.architect.updatedAt) > this.maxDecisionAgeMs) {
      return null;
    }

    const currentFamily = this.getStrategyFamily(params.state.activeStrategyId);
    if (currentFamily === params.architect.recommendedFamily) {
      return null;
    }

    const nextStrategyId = this.pickStrategyForFamily(params.architect.recommendedFamily, allowedStrategies);
    if (!nextStrategyId || nextStrategyId === params.state.activeStrategyId) return null;

    return {
      nextStrategyId,
      reason: `architect_family_${params.architect.recommendedFamily}`,
      targetFamily: params.architect.recommendedFamily
    };
  }

  getStrategyFamily(strategyId: string | null | undefined): RecommendedFamily | "other" {
    if (strategyId === "emaCross") return "trend_following";
    if (strategyId === "rsiReversion") return "mean_reversion";
    return "other";
  }

  getRoutableStrategies(strategyIds: string[]) {
    return (strategyIds || []).filter((strategyId) => this.getStrategyFamily(strategyId) !== "other");
  }

  getNonRoutableStrategies(strategyIds: string[]) {
    return (strategyIds || []).filter((strategyId) => this.getStrategyFamily(strategyId) === "other");
  }

  pickStrategyForFamily(family: RecommendedFamily, allowedStrategies: string[]) {
    const target = family === "trend_following"
      ? "emaCross"
      : family === "mean_reversion"
        ? "rsiReversion"
        : null;
    if (!target) return null;
    return allowedStrategies.find((strategyId) => strategyId === target) || null;
  }
}

module.exports = {
  StrategySwitcher
};
