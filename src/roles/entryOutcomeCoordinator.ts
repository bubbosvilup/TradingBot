// Module responsibility: shape final entry outcomes for TradingBot without owning tick orchestration or logger emission.

import type { ArchitectAssessment } from "../types/architect.ts";
import type { BotRuntimeState } from "../types/bot.ts";
import type { MarketTick } from "../types/market.ts";
import type { RiskProfileSettings } from "../types/runtime.ts";
import type { EntryEconomicsEstimate, MarketContext, StrategyDecision } from "../types/strategy.ts";
import type { ArchitectUsabilityState } from "./architectCoordinator.ts";

export interface EntryOutcomeCoordinatorParams {
  symbol: string;
}

export interface EntryOutcomeRiskGate {
  allowed: boolean;
  reason: string;
}

export interface EntryEvaluationPlan {
  allowReason?: string | null;
  architectState: ArchitectUsabilityState;
  blockReason?: string | null;
  context?: MarketContext | null;
  contextSnapshot: unknown;
  decision?: StrategyDecision | null;
  diagnostics?: Record<string, unknown>;
  economics: EntryEconomicsEstimate;
  outcome: "blocked" | "opened" | "skipped";
  profile?: RiskProfileSettings | null;
  quantity: number | null;
  riskGate?: EntryOutcomeRiskGate | null;
  signalEvaluated?: boolean;
  signalState?: Partial<BotRuntimeState> | null;
  skipReason?: string | null;
  state?: Partial<BotRuntimeState> | null;
  strategyId: string;
  tick: MarketTick;
}

export interface EntryOutcomePlan {
  compactBuyMetadata?: Record<string, unknown>;
  entryBlockedReason?: string | null;
  entryEvaluated: EntryEvaluationPlan;
  entryOpenedMetadata?: Record<string, unknown>;
  gateLog?: {
    message: "entry_gate_allowed" | "entry_gate_blocked";
    metadata: Record<string, unknown>;
  };
  lastNonCooldownBlockReason?: string | null;
  recordExecutionAt?: number;
  statePatch?: Partial<BotRuntimeState>;
}

export interface EntryOutcomeCoordinatorInstance {
  buildExecutionRejectedOutcome(params: {
    architectState: ArchitectUsabilityState;
    blockReason: string;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    quantity: number;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan;
  buildFinalGateBlockedOutcome(params: {
    architectState: ArchitectUsabilityState;
    blockReason: string;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    quantity: number;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan;
  buildOpenedOutcome(params: {
    architectState: ArchitectUsabilityState;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    openedAt: number;
    openedQuantity: number;
    profile: RiskProfileSettings;
    publishedArchitect?: ArchitectAssessment | null;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    statePatch: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan;
  buildRiskBlockedOutcome(params: {
    architectState: ArchitectUsabilityState;
    blockReason: string;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan;
  buildSkippedOutcome(params: {
    architectState: ArchitectUsabilityState;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    quantity: number | null;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    skipReason: "debounce_not_satisfied" | "no_entry_signal" | "quantity_non_positive";
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan;
}

class EntryOutcomeCoordinator implements EntryOutcomeCoordinatorInstance {
  symbol: string;

  constructor(params: EntryOutcomeCoordinatorParams) {
    this.symbol = params.symbol;
  }

  toFixedNumber(value: unknown, digits: number) {
    return Number(Number(value || 0).toFixed(digits));
  }

  buildSkippedOutcome(params: {
    architectState: ArchitectUsabilityState;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    quantity: number | null;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    skipReason: "debounce_not_satisfied" | "no_entry_signal" | "quantity_non_positive";
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan {
    return {
      entryEvaluated: {
        architectState: params.architectState,
        context: params.context,
        contextSnapshot: params.contextSnapshot,
        decision: params.decision,
        economics: params.economics,
        outcome: "skipped",
        profile: params.profile,
        quantity: params.quantity,
        riskGate: params.riskGate,
        signalEvaluated: true,
        signalState: params.signalState,
        skipReason: params.skipReason,
        state: params.state,
        strategyId: params.strategyId,
        tick: params.tick
      },
      lastNonCooldownBlockReason: null
    };
  }

  buildFinalGateBlockedOutcome(params: {
    architectState: ArchitectUsabilityState;
    blockReason: string;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    quantity: number;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan {
    return {
      entryBlockedReason: params.blockReason === "post_loss_architect_latch"
        ? "post_loss_architect_latch"
        : null,
      entryEvaluated: {
        architectState: params.architectState,
        blockReason: params.blockReason,
        context: params.context,
        contextSnapshot: params.contextSnapshot,
        decision: params.decision,
        diagnostics: params.diagnostics,
        economics: params.economics,
        outcome: "blocked",
        profile: params.profile,
        quantity: params.quantity,
        riskGate: params.riskGate,
        signalEvaluated: true,
        signalState: params.signalState,
        state: params.state,
        strategyId: params.strategyId,
        tick: params.tick
      },
      gateLog: {
        message: "entry_gate_blocked",
        metadata: params.diagnostics
      },
      lastNonCooldownBlockReason: params.blockReason
    };
  }

  buildExecutionRejectedOutcome(params: {
    architectState: ArchitectUsabilityState;
    blockReason: string;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    quantity: number;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan {
    return {
      entryBlockedReason: params.blockReason,
      entryEvaluated: {
        architectState: params.architectState,
        blockReason: params.blockReason,
        context: params.context,
        contextSnapshot: params.contextSnapshot,
        decision: params.decision,
        diagnostics: params.diagnostics,
        economics: params.economics,
        outcome: "blocked",
        profile: params.profile,
        quantity: params.quantity,
        riskGate: params.riskGate,
        signalEvaluated: true,
        signalState: params.signalState,
        state: params.state,
        strategyId: params.strategyId,
        tick: params.tick
      }
    };
  }

  buildRiskBlockedOutcome(params: {
    architectState: ArchitectUsabilityState;
    blockReason: string;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    profile: RiskProfileSettings;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan {
    return {
      entryBlockedReason: params.blockReason,
      entryEvaluated: {
        architectState: params.architectState,
        blockReason: params.blockReason,
        context: params.context,
        contextSnapshot: params.contextSnapshot,
        decision: params.decision,
        diagnostics: params.diagnostics,
        economics: params.economics,
        outcome: "blocked",
        profile: params.profile,
        quantity: null,
        riskGate: params.riskGate,
        signalEvaluated: true,
        signalState: params.signalState,
        state: params.state,
        strategyId: params.strategyId,
        tick: params.tick
      },
      gateLog: {
        message: "entry_gate_blocked",
        metadata: params.diagnostics
      }
    };
  }

  buildOpenedOutcome(params: {
    architectState: ArchitectUsabilityState;
    context: MarketContext;
    contextSnapshot: unknown;
    decision: StrategyDecision;
    diagnostics: Record<string, unknown>;
    economics: EntryEconomicsEstimate;
    openedAt: number;
    openedQuantity: number;
    profile: RiskProfileSettings;
    publishedArchitect?: ArchitectAssessment | null;
    riskGate: EntryOutcomeRiskGate;
    signalState: Partial<BotRuntimeState>;
    state: Partial<BotRuntimeState>;
    statePatch: Partial<BotRuntimeState>;
    strategyId: string;
    tick: MarketTick;
  }): EntryOutcomePlan {
    return {
      compactBuyMetadata: {
        decisionConfidence: this.toFixedNumber(params.decision.confidence || 0, 4),
        expectedGrossEdgePct: this.toFixedNumber(params.diagnostics.expectedGrossEdgePct || 0, 4),
        expectedNetEdgePct: this.toFixedNumber(params.diagnostics.expectedNetEdgePct || 0, 4),
        latestPrice: this.toFixedNumber(params.tick.price || 0, 4),
        quantity: this.toFixedNumber(params.openedQuantity || 0, 8),
        strategy: params.strategyId
      },
      entryEvaluated: {
        allowReason: "entry_opened",
        architectState: params.architectState,
        context: params.context,
        contextSnapshot: params.contextSnapshot,
        decision: params.decision,
        diagnostics: params.diagnostics,
        economics: params.economics,
        outcome: "opened",
        profile: params.profile,
        quantity: params.openedQuantity,
        riskGate: params.riskGate,
        signalEvaluated: true,
        signalState: params.signalState,
        state: params.state,
        strategyId: params.strategyId,
        tick: params.tick
      },
      entryOpenedMetadata: {
        decisionStrength: params.publishedArchitect ? this.toFixedNumber(params.publishedArchitect.decisionStrength, 4) : null,
        publishedFamily: params.publishedArchitect?.recommendedFamily || null,
        publishedRegime: params.publishedArchitect?.marketRegime || null,
        signalAgreement: params.publishedArchitect ? this.toFixedNumber(params.publishedArchitect.signalAgreement, 4) : null,
        strategy: params.strategyId,
        symbol: this.symbol
      },
      gateLog: {
        message: "entry_gate_allowed",
        metadata: params.diagnostics
      },
      lastNonCooldownBlockReason: null,
      recordExecutionAt: params.openedAt,
      statePatch: params.statePatch
    };
  }
}

module.exports = {
  EntryOutcomeCoordinator
};
