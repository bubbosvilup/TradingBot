// Module responsibility: shape final exit/close outcomes for TradingBot without owning execution or store/log side effects.

import type { BotRuntimeState, RiskProfile } from "../types/bot.ts";
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

export interface PendingManagedRecoveryParams {
  metadata: Record<string, unknown>;
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
  buildPendingManagedRecoveryUpdate(params: PendingManagedRecoveryParams): Record<string, unknown>;
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

  buildPendingManagedRecoveryUpdate(params: PendingManagedRecoveryParams) {
    return {
      ...params.metadata
    };
  }

  buildClosedTradeOutcome(params: ClosedTradeOutcomeParams): ClosedTradeOutcome {
    const balancePatch = this.riskManager.onTradeClosed({
      netPnl: params.closedTrade.netPnl,
      now: params.closedTrade.closedAt,
      riskProfile: params.riskProfile,
      state: params.signalState
    });
    const maxDrawdownPct = this.riskManager.profiles[params.riskProfile].maxDrawdownPct;
    const updatedBalance = params.signalState.availableBalanceUsdt + (params.closedTrade.quantity * params.closedTrade.exitPrice) - params.closedTrade.fees;
    const pausedForDrawdown = params.nextPerformance.drawdown >= maxDrawdownPct;
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
      realizedPnl: params.signalState.realizedPnl + params.closedTrade.netPnl,
      status: pausedForDrawdown ? "paused" : params.lifecycleStatus,
      pausedReason: pausedForDrawdown ? "max_drawdown_reached" : null
    };

    return {
      compactRiskMetadata: {
        ...params.exitTelemetry,
        cooldownReason: balancePatch.cooldownReason,
        cooldownUntil: balancePatch.cooldownUntil,
        closeClassification: params.classification.closeClassification,
        lossStreak: balancePatch.lossStreak,
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
