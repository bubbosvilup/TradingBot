"use strict";

const { ExitOutcomeCoordinator } = require("../src/roles/exitOutcomeCoordinator.ts");
const { RiskManager } = require("../src/roles/riskManager.ts");

function createCoordinator() {
  return new ExitOutcomeCoordinator({
    riskManager: new RiskManager()
  });
}

async function runExitOutcomeCoordinatorTests() {
  const coordinator = createCoordinator();

  const deferred = coordinator.buildDeferredManagedRecoveryOutcome({
    estimatedNetPnl: -0.01234,
    exitFloorNetPnlUsdt: 0.05,
    managedRecoveryStartedAt: 2000,
    metadata: {
      policyId: "RSI_REVERSION_PRO",
      positionStatus: "MANAGED_RECOVERY"
    },
    nextPosition: {
      strategyId: "rsiReversion"
    }
  });
  if (deferred.estimatedNetPnl !== -0.0123 || deferred.exitFloorNetPnlUsdt !== 0.05 || deferred.managedRecoveryStartedAt !== 2000 || deferred.strategy !== "rsiReversion") {
    throw new Error(`managed recovery defer outcome should preserve rounded metadata and strategy handoff: ${JSON.stringify(deferred)}`);
  }

  const pending = coordinator.buildPendingManagedRecoveryUpdate({
    metadata: {
      status: "managed_recovery_target_ready",
      exitSignalStreak: 1
    }
  });
  if (pending.status !== "managed_recovery_target_ready" || pending.exitSignalStreak !== 1) {
    throw new Error(`managed recovery pending updates should preserve existing metadata verbatim: ${JSON.stringify(pending)}`);
  }

  const closedOutcome = coordinator.buildClosedTradeOutcome({
    classification: {
      closeClassification: "failed_rsi_exit",
      failedRsiExit: true,
      rsiExit: true
    },
    closedTrade: {
      closedAt: 5000,
      entryPrice: 100,
      exitPrice: 99.8,
      exitReason: ["rsi_exit_confirmed"],
      fees: 0.0999,
      netPnl: -0.1999,
      pnl: -0.1,
      quantity: 0.5
    },
    exitTelemetry: {
      exitEvent: "rsi_exit_confirmed",
      lifecycleEvent: "FAILED_RSI_EXIT",
      policyId: "RSI_REVERSION_PRO"
    },
    feeRate: 0.001,
    lifecycleStatus: "running",
    nextPerformance: {
      avgTradePnlUsdt: 0,
      drawdown: 6.1,
      pnl: -0.2,
      profitFactor: 0.8,
      tradesCount: 1,
      winRate: 0
    },
    positionWasManagedRecovery: true,
    riskProfile: "medium",
    signalState: {
      availableBalanceUsdt: 900,
      realizedPnl: 0,
      status: "running"
    },
    strategyId: "rsiReversion",
    tickPrice: 99.8
  });
  if (closedOutcome.statePatch.lastExecutionAt !== 5000 || closedOutcome.recordExecutionAt !== 5000) {
    throw new Error(`closed trade outcome should preserve execution timestamps: ${JSON.stringify(closedOutcome)}`);
  }
  if (!closedOutcome.failedRsiExitLogMetadata || closedOutcome.failedRsiExitLogMetadata.closeClassification !== "failed_rsi_exit") {
    throw new Error(`failed RSI exits should still shape failed_rsi_exit log metadata: ${JSON.stringify(closedOutcome.failedRsiExitLogMetadata)}`);
  }
  if (!closedOutcome.managedRecoveryExitedLogMetadata || closedOutcome.managedRecoveryExitedLogMetadata.strategy !== "rsiReversion") {
    throw new Error(`managed recovery closes should still shape managed_recovery_exited metadata: ${JSON.stringify(closedOutcome.managedRecoveryExitedLogMetadata)}`);
  }
  if (closedOutcome.compactSellMetadata.outcome !== "loss" || closedOutcome.compactRiskMetadata.status !== "trade_closed") {
    throw new Error(`closed trade outcome should preserve compact SELL/RISK_CHANGE semantics: ${JSON.stringify(closedOutcome)}`);
  }
  if (closedOutcome.statePatch.status !== "paused" || closedOutcome.statePatch.pausedReason !== "max_drawdown_reached") {
    throw new Error(`max drawdown should still hard-pause the bot state: ${JSON.stringify(closedOutcome.statePatch)}`);
  }
  if (closedOutcome.compactRiskMetadata.botStatus !== "paused" || closedOutcome.compactRiskMetadata.pausedReason !== "max_drawdown_reached" || closedOutcome.compactRiskMetadata.manualResumeRequired !== true) {
    throw new Error(`max drawdown pause should be explicit in compact risk metadata: ${JSON.stringify(closedOutcome.compactRiskMetadata)}`);
  }
}

module.exports = {
  runExitOutcomeCoordinatorTests
};
