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
  if (!closedOutcome.detailedExitLogMetadata || closedOutcome.detailedExitLogMetadata.netPnl !== -0.1999 || closedOutcome.detailedExitLogMetadata.policyId !== "RSI_REVERSION_PRO") {
    throw new Error(`closed trade outcome should expose one canonical detailed exit payload: ${JSON.stringify(closedOutcome.detailedExitLogMetadata)}`);
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
  for (const key of ["entryPrice", "exitPrice", "fees", "grossPnl", "netPnl", "policyId", "signalTimestamp", "executionTimestamp"]) {
    if (Object.prototype.hasOwnProperty.call(closedOutcome.compactSellMetadata, key)) {
      throw new Error(`compact SELL payload should stay compact and omit ${key}: ${JSON.stringify(closedOutcome.compactSellMetadata)}`);
    }
  }
  for (const key of ["exitEvent", "exitMechanism", "closeReason", "policyId", "netPnl"]) {
    if (Object.prototype.hasOwnProperty.call(closedOutcome.compactRiskMetadata, key)) {
      throw new Error(`compact RISK_CHANGE payload should stay state-oriented and omit ${key}: ${JSON.stringify(closedOutcome.compactRiskMetadata)}`);
    }
  }
  if (closedOutcome.statePatch.status !== "paused" || closedOutcome.statePatch.pausedReason !== "max_drawdown_reached") {
    throw new Error(`max drawdown should still hard-pause the bot state: ${JSON.stringify(closedOutcome.statePatch)}`);
  }
  if (closedOutcome.compactRiskMetadata.botStatus !== "paused" || closedOutcome.compactRiskMetadata.pausedReason !== "max_drawdown_reached" || closedOutcome.compactRiskMetadata.manualResumeRequired !== true) {
    throw new Error(`max drawdown pause should be explicit in compact risk metadata: ${JSON.stringify(closedOutcome.compactRiskMetadata)}`);
  }

  const manuallyPausedOutcome = coordinator.buildClosedTradeOutcome({
    classification: {
      closeClassification: "confirmed_exit",
      failedRsiExit: false,
      rsiExit: false
    },
    closedTrade: {
      closedAt: 6000,
      entryPrice: 100,
      exitPrice: 100.2,
      exitReason: ["exit_signal"],
      fees: 0.1,
      netPnl: 0.1,
      pnl: 0.2,
      quantity: 0.5
    },
    exitTelemetry: {
      exitEvent: "exit_signal",
      lifecycleEvent: null,
      policyId: "GENERIC"
    },
    feeRate: 0.001,
    lifecycleStatus: "paused",
    nextPerformance: {
      avgTradePnlUsdt: 0,
      drawdown: 1.2,
      pnl: 0.1,
      profitFactor: 1.1,
      tradesCount: 2,
      winRate: 50
    },
    positionWasManagedRecovery: false,
    riskProfile: "medium",
    signalState: {
      availableBalanceUsdt: 900,
      pausedReason: "manual_pause",
      realizedPnl: 0,
      status: "paused"
    },
    strategyId: "emaCross",
    tickPrice: 100.2
  });
  if (manuallyPausedOutcome.statePatch.status !== "paused" || manuallyPausedOutcome.statePatch.pausedReason !== "manual_pause") {
    throw new Error(`non-drawdown paused closes should preserve a coherent paused state: ${JSON.stringify(manuallyPausedOutcome.statePatch)}`);
  }
  if (manuallyPausedOutcome.compactRiskMetadata.botStatus !== "paused" || manuallyPausedOutcome.compactRiskMetadata.pausedReason !== "manual_pause") {
    throw new Error(`compact risk metadata should preserve non-drawdown paused semantics after close: ${JSON.stringify(manuallyPausedOutcome.compactRiskMetadata)}`);
  }

  const normalizedPausedOutcome = coordinator.buildClosedTradeOutcome({
    classification: {
      closeClassification: "confirmed_exit",
      failedRsiExit: false,
      rsiExit: false
    },
    closedTrade: {
      closedAt: 7000,
      entryPrice: 100,
      exitPrice: 100.1,
      exitReason: ["exit_signal"],
      fees: 0.1,
      netPnl: 0.05,
      pnl: 0.15,
      quantity: 0.5
    },
    exitTelemetry: {
      exitEvent: "exit_signal",
      lifecycleEvent: null,
      policyId: "GENERIC"
    },
    feeRate: 0.001,
    lifecycleStatus: "paused",
    nextPerformance: {
      avgTradePnlUsdt: 0,
      drawdown: 1,
      pnl: 0.15,
      profitFactor: 1.2,
      tradesCount: 3,
      winRate: 66.7
    },
    positionWasManagedRecovery: false,
    riskProfile: "medium",
    signalState: {
      availableBalanceUsdt: 900,
      pausedReason: null,
      realizedPnl: 0,
      status: "paused"
    },
    strategyId: "emaCross",
    tickPrice: 100.1
  });
  if (normalizedPausedOutcome.statePatch.status === "paused" || normalizedPausedOutcome.statePatch.pausedReason !== null) {
    throw new Error(`close outcomes must never persist paused+null states: ${JSON.stringify(normalizedPausedOutcome.statePatch)}`);
  }
}

module.exports = {
  runExitOutcomeCoordinatorTests
};
