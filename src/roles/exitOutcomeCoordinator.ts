// Module responsibility: shape final exit/close outcomes for TradingBot without owning execution or store/log side effects.

import type { BotRuntimeState, RiskOverrides, RiskProfile } from "../types/bot.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { PositionExitMechanism } from "../types/positionLifecycle.ts";
import type { RiskManagerLike } from "../types/runtime.ts";
import type { ClosedTradeRecord, PositionRecord } from "../types/trade.ts";

export interface ExitClassification {
  closeClassification: "confirmed_exit" | "failed_rsi_exit";
  failedRsiExit: boolean;
  rsiExit: boolean;
}

export interface ExitOutcomeCoordinatorParams {
  riskManager: RiskManagerLike;
}

export interface DeferredManagedRecoveryParams {
  estimatedNetPnl: number;
  exitFloorNetPnlUsdt: number;
  managedRecoveryStartedAt: number;
  metadata: Record<string, unknown>;
  nextPosition: PositionRecord;
}

export interface ClosedTradeOutcomeParams {
  classification: ExitClassification;
  closedTrade: ClosedTradeRecord;
  exitTelemetry: Record<string, unknown>;
  feeRate: number;
  lifecycleStatus: BotRuntimeState["status"];
  nextPerformance: PerformanceSnapshot;
  positionWasManagedRecovery: boolean;
  riskProfile: RiskProfile;
  riskOverrides?: RiskOverrides | null;
  signalState: BotRuntimeState;
  strategyId: string;
  tickPrice: number;
}

export interface ClosedTradeOutcome {
  compactRiskMetadata: Record<string, unknown>;
  compactSellMetadata: Record<string, unknown>;
  failedRsiExitLogMetadata?: Record<string, unknown>;
  latchActivation: {
    closedAt: number;
    netPnl: number;
    strategyId: string;
  };
  managedRecoveryExitedLogMetadata?: Record<string, unknown>;
  recordExecutionAt: number;
  statePatch: Partial<BotRuntimeState>;
}

export interface ExitOutcomeCoordinatorInstance {
  buildClosedTradeOutcome(params: ClosedTradeOutcomeParams): ClosedTradeOutcome;
  buildDeferredManagedRecoveryOutcome(params: DeferredManagedRecoveryParams): Record<string, unknown>;
}

class ExitOutcomeCoordinator implements ExitOutcomeCoordinatorInstance {
  riskManager: RiskManagerLike;

  constructor(params: ExitOutcomeCoordinatorParams) {
    this.riskManager = params.riskManager;
  }

  toFixed(value: unknown, digits: number) {
    return Number(Number(value || 0).toFixed(digits));
  }

  buildDeferredManagedRecoveryOutcome(params: DeferredManagedRecoveryParams) {
    return {
      ...params.metadata,
      estimatedNetPnl: this.toFixed(params.estimatedNetPnl, 4),
      exitFloorNetPnlUsdt: this.toFixed(params.exitFloorNetPnlUsdt, 4),
      managedRecoveryStartedAt: params.managedRecoveryStartedAt,
      strategy: params.nextPosition.strategyId
    };
  }

  buildClosedTradeOutcome(params: ClosedTradeOutcomeParams): ClosedTradeOutcome {
    const balancePatch = this.riskManager.onTradeClosed({
      netPnl: params.closedTrade.netPnl,
      now: params.closedTrade.closedAt,
      riskProfile: params.riskProfile,
      riskOverrides: params.riskOverrides || null,
      state: params.signalState
    });
    const maxDrawdownPct = this.riskManager.getProfile(params.riskProfile, params.riskOverrides || null).maxDrawdownPct;
    const releasedEntryNotionalUsdt = params.closedTrade.quantity * params.closedTrade.entryPrice;
    // Paper runtime short accounting releases full entry notional on close just like longs.
    // Balance/equity metrics here are not realistic leveraged margin accounting.
    const updatedBalance = params.signalState.availableBalanceUsdt + releasedEntryNotionalUsdt + params.closedTrade.netPnl;
    // Max drawdown is a hard runtime pause that must be cleared by an explicit external resume.
    // This coordinator only records the paused state; it does not auto-resume or soften the policy.
    const pausedForDrawdown = params.nextPerformance.drawdown >= maxDrawdownPct;
    const preservedPausedReason = !pausedForDrawdown
      && params.lifecycleStatus === "paused"
      && typeof params.signalState?.pausedReason === "string"
      && params.signalState.pausedReason.trim() !== ""
      ? params.signalState.pausedReason
      : null;
    const nextStatus = pausedForDrawdown
      ? "paused"
      : params.lifecycleStatus === "paused" && !preservedPausedReason
        ? "running"
        : params.lifecycleStatus;
    const nextPausedReason = pausedForDrawdown
      ? "max_drawdown_reached"
      : preservedPausedReason;
    const closeReason = Array.isArray(params.closedTrade.exitReason)
      ? params.closedTrade.exitReason.join(",")
      : null;

    const statePatch: Partial<BotRuntimeState> = {
      availableBalanceUsdt: updatedBalance,
      cooldownReason: balancePatch.cooldownReason,
      cooldownUntil: balancePatch.cooldownUntil,
      entrySignalStreak: 0,
      exitSignalStreak: 0,
      lastExecutionAt: params.closedTrade.closedAt,
      lastTradeAt: params.closedTrade.closedAt,
      lossStreak: balancePatch.lossStreak,
      managedRecoveryConsecutiveCount: params.positionWasManagedRecovery
        ? Number(params.signalState.managedRecoveryConsecutiveCount || 0)
        : 0,
      realizedPnl: params.signalState.realizedPnl + params.closedTrade.netPnl,
      status: nextStatus,
      pausedReason: nextPausedReason
    };

    return {
      compactRiskMetadata: {
        ...params.exitTelemetry,
        botStatus: nextStatus,
        cooldownReason: balancePatch.cooldownReason,
        cooldownUntil: balancePatch.cooldownUntil,
        closeClassification: params.classification.closeClassification,
        lossStreak: balancePatch.lossStreak,
        manualResumeRequired: pausedForDrawdown ? true : undefined,
        pausedReason: nextPausedReason,
        status: "trade_closed"
      },
      compactSellMetadata: {
        ...params.exitTelemetry,
        closeClassification: params.classification.closeClassification,
        closeReason,
        entryPrice: this.toFixed(params.closedTrade.entryPrice, 4),
        exitPrice: this.toFixed(params.closedTrade.exitPrice, 4),
        feeRate: this.toFixed(params.feeRate, 6),
        fees: this.toFixed(params.closedTrade.fees, 4),
        grossPnl: this.toFixed(params.closedTrade.pnl, 4),
        latestPrice: this.toFixed(params.tickPrice, 4),
        netPnl: this.toFixed(params.closedTrade.netPnl, 4),
        outcome: params.closedTrade.netPnl > 0 ? "profit" : params.closedTrade.netPnl < 0 ? "loss" : "flat",
        quantity: this.toFixed(params.closedTrade.quantity, 8),
        side: params.closedTrade.side,
        strategy: params.strategyId
      },
      failedRsiExitLogMetadata: params.classification.failedRsiExit
        ? {
            ...params.exitTelemetry,
            closeClassification: params.classification.closeClassification,
            closeReason,
            cooldownReason: balancePatch.cooldownReason,
            entryPrice: this.toFixed(params.closedTrade.entryPrice, 4),
            exitPrice: this.toFixed(params.closedTrade.exitPrice, 4),
            fees: this.toFixed(params.closedTrade.fees, 4),
            grossPnl: this.toFixed(params.closedTrade.pnl, 4),
            netPnl: this.toFixed(params.closedTrade.netPnl, 4),
            side: params.closedTrade.side,
            strategy: params.strategyId
          }
        : undefined,
      latchActivation: {
        closedAt: params.closedTrade.closedAt,
        netPnl: params.closedTrade.netPnl,
        strategyId: params.strategyId
      },
      managedRecoveryExitedLogMetadata: params.positionWasManagedRecovery
        ? {
            ...params.exitTelemetry,
            closeClassification: params.classification.closeClassification,
            closeReason,
            strategy: params.strategyId
          }
        : undefined,
      recordExecutionAt: params.closedTrade.closedAt,
      statePatch
    };
  }
}

module.exports = {
  ExitOutcomeCoordinator
};
