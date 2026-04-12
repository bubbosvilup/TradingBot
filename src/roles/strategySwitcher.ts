// Module responsibility: resolve published architect family into an executable strategy with only light execution-side guards.

import type { ArchitectAssessment, RecommendedFamily } from "../types/architect.ts";
import type { BotRuntimeState } from "../types/bot.ts";

class StrategySwitcher {
  maxDecisionAgeMs: number;
  resolveStrategyFamily: (strategyId: string | null | undefined) => RecommendedFamily | "other";

  constructor(options: { maxDecisionAgeMs?: number; resolveStrategyFamily?: (strategyId: string | null | undefined) => RecommendedFamily | "other" } = {}) {
    this.maxDecisionAgeMs = Math.max(options.maxDecisionAgeMs || 0, 0);
    this.resolveStrategyFamily = typeof options.resolveStrategyFamily === "function"
      ? options.resolveStrategyFamily
      : () => "other";
  }

  evaluate(params: {
    availableStrategies: string[];
    architect: ArchitectAssessment | null;
    now: number;
    positionOpen?: boolean;
    state: BotRuntimeState;
  }) {
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
    return this.resolveStrategyFamily(strategyId);
  }

  getRoutableStrategies(strategyIds: string[]) {
    return (strategyIds || []).filter((strategyId) => this.getStrategyFamily(strategyId) !== "other");
  }

  getNonRoutableStrategies(strategyIds: string[]) {
    return (strategyIds || []).filter((strategyId) => this.getStrategyFamily(strategyId) === "other");
  }

  pickStrategyForFamily(family: RecommendedFamily, allowedStrategies: string[]) {
    if (family === "no_trade") return null;
    return allowedStrategies.find((strategyId) => this.getStrategyFamily(strategyId) === family) || null;
  }
}

module.exports = {
  StrategySwitcher
};
