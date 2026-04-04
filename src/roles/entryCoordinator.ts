// Module responsibility: coordinate entry-side signal progression and local gate outcomes without owning execution.

import type { ArchitectAssessment } from "../types/architect.ts";
import type { BotRuntimeState } from "../types/bot.ts";
import type { BotStateStoreLike, TradeConstraints } from "../types/runtime.ts";
import type { EntryEconomicsEstimate } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";
import type { ArchitectUsabilityState } from "./architectCoordinator.ts";

const { isManagedRecoveryPosition } = require("./positionLifecycleManager.ts");

export interface EntryCoordinatorParams {
  botId: string;
  store: BotStateStoreLike;
}

export interface EntrySignalStateUpdateParams {
  decisionAction: "buy" | "sell" | "hold";
  hasPosition: boolean;
  managedRecoveryPriceTargetHit?: boolean;
  position?: PositionRecord | null;
  state: BotRuntimeState;
  timestamp: number;
}

export interface EntryAttemptResolution {
  blockReason: string | null;
  kind: "eligible" | "blocked" | "skipped";
  skipReason: "debounce_not_satisfied" | "no_entry_signal" | null;
}

export interface EntryGateResult {
  allowed: boolean;
  architect?: ArchitectAssessment | null;
  diagnostics: Record<string, unknown> & {
    blockReason: string | null;
    expectedGrossEdgePct?: number;
    expectedNetEdgePct?: number;
  };
}

export interface FinalEntryGateParams {
  architectState: ArchitectUsabilityState;
  diagnostics: Record<string, unknown>;
  economics: EntryEconomicsEstimate;
  postLossArchitectLatchBlocking: boolean;
  quantity: number;
  tradeConstraints: TradeConstraints;
}

export interface EntryCoordinatorInstance {
  buildArchitectEntryShortCircuitStatePatch(blockReason?: string | null): Partial<BotRuntimeState>;
  evaluateFinalGate(params: FinalEntryGateParams): EntryGateResult;
  resolveEntryAttempt(params: {
    decisionAction: "buy" | "sell" | "hold";
    entryDebounceTicks: number;
    entrySignalStreak: number;
    riskAllowed: boolean;
    riskReason?: string | null;
  }): EntryAttemptResolution;
  updateSignalState(params: EntrySignalStateUpdateParams): BotRuntimeState | null;
}

class EntryCoordinator implements EntryCoordinatorInstance {
  botId: string;
  store: BotStateStoreLike;

  constructor(params: EntryCoordinatorParams) {
    this.botId = params.botId;
    this.store = params.store;
  }

  buildArchitectEntryShortCircuitStatePatch(blockReason?: string | null): Partial<BotRuntimeState> {
    return {
      entrySignalStreak: 0,
      exitSignalStreak: 0,
      lastDecision: "hold",
      lastDecisionConfidence: 0,
      lastDecisionReasons: [
        "architect_not_usable_for_entry",
        blockReason
      ].filter(Boolean) as string[]
    };
  }

  updateSignalState(params: EntrySignalStateUpdateParams): BotRuntimeState | null {
    const cooldownActive = Boolean(params.state.cooldownUntil && params.state.cooldownUntil > params.timestamp);
    const inManagedRecovery = isManagedRecoveryPosition(params.position || null);
    const managedRecoveryPriceTargetSignal = inManagedRecovery && Boolean(params.managedRecoveryPriceTargetHit);
    const nextEntrySignalStreak = cooldownActive
      ? params.state.entrySignalStreak
      : !params.hasPosition && params.decisionAction === "buy"
        ? params.state.entrySignalStreak + 1
        : 0;
    const nextExitSignalStreak = params.hasPosition && (
      (!inManagedRecovery && params.decisionAction === "sell")
      || managedRecoveryPriceTargetSignal
    )
      ? params.state.exitSignalStreak + 1
      : 0;

    this.store.updateBotState(this.botId, {
      entrySignalStreak: nextEntrySignalStreak,
      exitSignalStreak: nextExitSignalStreak
    });

    return this.store.getBotState(this.botId);
  }

  resolveEntryAttempt(params: {
    decisionAction: "buy" | "sell" | "hold";
    entryDebounceTicks: number;
    entrySignalStreak: number;
    riskAllowed: boolean;
    riskReason?: string | null;
  }): EntryAttemptResolution {
    if (params.decisionAction !== "buy") {
      return {
        blockReason: null,
        kind: "skipped",
        skipReason: "no_entry_signal"
      };
    }
    if (!params.riskAllowed) {
      return {
        blockReason: params.riskReason || null,
        kind: "blocked",
        skipReason: null
      };
    }
    if (params.entrySignalStreak < params.entryDebounceTicks) {
      return {
        blockReason: null,
        kind: "skipped",
        skipReason: "debounce_not_satisfied"
      };
    }
    return {
      blockReason: null,
      kind: "eligible",
      skipReason: null
    };
  }

  evaluateFinalGate(params: FinalEntryGateParams): EntryGateResult {
    if (!params.architectState.usable) {
      return { allowed: false, diagnostics: { ...params.diagnostics, blockReason: params.architectState.blockReason } };
    }
    if (params.architectState.familyMatch === false) {
      return { allowed: false, diagnostics: { ...params.diagnostics, blockReason: "strategy_family_mismatch" } };
    }
    if (params.postLossArchitectLatchBlocking) {
      return { allowed: false, diagnostics: { ...params.diagnostics, blockReason: "post_loss_architect_latch" } };
    }
    if (params.economics.notionalUsdt < params.tradeConstraints.minNotionalUsdt) {
      return { allowed: false, diagnostics: { ...params.diagnostics, blockReason: "notional_below_minimum" } };
    }
    if (params.quantity < params.tradeConstraints.minQuantity) {
      return { allowed: false, diagnostics: { ...params.diagnostics, blockReason: "quantity_below_minimum" } };
    }
    if (params.economics.expectedNetEdgePct < params.economics.minExpectedNetEdgePct) {
      return { allowed: false, diagnostics: { ...params.diagnostics, blockReason: "insufficient_edge_after_costs" } };
    }

    return {
      allowed: true,
      architect: params.architectState.architect,
      diagnostics: { ...params.diagnostics, blockReason: "allowed" }
    };
  }
}

module.exports = {
  EntryCoordinator
};
