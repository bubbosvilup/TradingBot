"use strict";

const {
  buildExitLifecycleReport,
  renderExitLifecycleReport
} = require("../src/utils/exitLifecycleReport.ts");

function createClosedTrade(overrides = {}) {
  return {
    botId: "bot_a",
    closedAt: 1_000,
    entryPrice: 100,
    entryReason: ["entry_signal"],
    exitPrice: 101,
    exitReason: ["rsi_exit_confirmed"],
    fees: 0.1,
    id: "trade_a",
    lifecycleEvent: "RSI_EXIT_HIT",
    lifecycleState: "CLOSED",
    netPnl: 0.3,
    openedAt: 100,
    pnl: 0.4,
    quantity: 1,
    reason: ["rsi_exit_confirmed"],
    side: "long",
    strategyId: "rsiReversion",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function createEvent(message, time, metadata = {}) {
  return {
    level: "BOT",
    message,
    metadata,
    scope: "orchestrator:bots",
    time
  };
}

function runExitLifecycleReportTests() {
  const closedTrades = [
    createClosedTrade({
      botId: "bot_1",
      closedAt: 1_000,
      exitReason: ["rsi_exit_confirmed"],
      id: "trade_1",
      lifecycleEvent: "RSI_EXIT_HIT",
      netPnl: 0.25
    }),
    createClosedTrade({
      botId: "bot_2",
      closedAt: 2_000,
      exitReason: ["rsi_exit_confirmed"],
      id: "trade_2",
      lifecycleEvent: "FAILED_RSI_EXIT",
      netPnl: -0.2
    }),
    createClosedTrade({
      botId: "bot_3",
      closedAt: 3_000,
      exitReason: ["reversion_price_target_hit"],
      id: "trade_3",
      lifecycleEvent: "PRICE_TARGET_HIT",
      netPnl: 0.45
    }),
    createClosedTrade({
      botId: "bot_4",
      closedAt: 4_000,
      exitReason: ["time_exhaustion_exit"],
      id: "trade_4",
      lifecycleEvent: "RECOVERY_TIMEOUT",
      netPnl: -0.15
    }),
    createClosedTrade({
      botId: "bot_5",
      closedAt: 5_000,
      exitReason: ["protective_stop_exit"],
      id: "trade_5",
      lifecycleEvent: "PROTECTIVE_STOP_HIT",
      netPnl: -0.35
    }),
    createClosedTrade({
      botId: "bot_6",
      closedAt: 6_000,
      exitReason: ["regime_invalidation_exit"],
      id: "trade_6",
      lifecycleEvent: "REGIME_INVALIDATION",
      netPnl: 0.05
    })
  ];

  const events = [
    createEvent("SELL", 1_000, {
      botId: "bot_1",
      closeClassification: "confirmed_exit",
      executionTimestamp: 1_000,
      exitEvent: "rsi_exit_confirmed",
      exitMechanism: "qualification",
      lifecycleEvent: "RSI_EXIT_HIT",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 120
    }),
    createEvent("SELL", 2_000, {
      botId: "bot_2",
      closeClassification: "failed_rsi_exit",
      executionTimestamp: 2_000,
      exitEvent: "rsi_exit_confirmed",
      exitMechanism: "qualification",
      lifecycleEvent: "FAILED_RSI_EXIT",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 420
    }),
    createEvent("rsi_exit_deferred", 2_500, {
      botId: "bot_3",
      policyId: "RSI_REVERSION_PRO",
      strategy: "rsiReversion"
    }),
    createEvent("managed_recovery_exited", 3_000, {
      botId: "bot_3",
      closeReason: "reversion_price_target_hit",
      executionTimestamp: 3_000,
      exitEvent: "reversion_price_target_hit",
      exitMechanism: "recovery",
      lifecycleEvent: "PRICE_TARGET_HIT",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 180
    }),
    createEvent("SELL", 3_000, {
      botId: "bot_3",
      closeClassification: "confirmed_exit",
      executionTimestamp: 3_000,
      exitEvent: "reversion_price_target_hit",
      exitMechanism: "recovery",
      lifecycleEvent: "PRICE_TARGET_HIT",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 180
    }),
    createEvent("rsi_exit_deferred", 3_500, {
      botId: "bot_4",
      policyId: "RSI_REVERSION_FAST_TIMEOUT",
      strategy: "rsiReversion"
    }),
    createEvent("managed_recovery_exited", 4_000, {
      botId: "bot_4",
      closeReason: "time_exhaustion_exit",
      executionTimestamp: 4_000,
      exitEvent: "time_exhaustion_exit",
      exitMechanism: "recovery",
      lifecycleEvent: "RECOVERY_TIMEOUT",
      policyId: "RSI_REVERSION_FAST_TIMEOUT",
      signalToExecutionMs: 510
    }),
    createEvent("SELL", 4_000, {
      botId: "bot_4",
      closeClassification: "confirmed_exit",
      executionTimestamp: 4_000,
      exitEvent: "time_exhaustion_exit",
      exitMechanism: "recovery",
      lifecycleEvent: "RECOVERY_TIMEOUT",
      policyId: "RSI_REVERSION_FAST_TIMEOUT",
      signalToExecutionMs: 510
    }),
    createEvent("rsi_exit_deferred", 4_500, {
      botId: "bot_5",
      policyId: "RSI_REVERSION_PRO",
      strategy: "rsiReversion"
    }),
    createEvent("managed_recovery_exited", 5_000, {
      botId: "bot_5",
      closeReason: "protective_stop_exit",
      executionTimestamp: 5_000,
      exitEvent: "protective_stop_exit",
      exitMechanism: "protection",
      lifecycleEvent: "PROTECTIVE_STOP_HIT",
      policyId: "RSI_REVERSION_PRO",
      protectionMode: "fixed_pct",
      signalToExecutionMs: 250
    }),
    createEvent("SELL", 5_000, {
      botId: "bot_5",
      closeClassification: "confirmed_exit",
      executionTimestamp: 5_000,
      exitEvent: "protective_stop_exit",
      exitMechanism: "protection",
      lifecycleEvent: "PROTECTIVE_STOP_HIT",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 250
    }),
    createEvent("rsi_exit_deferred", 5_500, {
      botId: "bot_6",
      policyId: "RSI_REVERSION_PRO",
      strategy: "rsiReversion"
    }),
    createEvent("managed_recovery_exited", 6_000, {
      botId: "bot_6",
      closeReason: "regime_invalidation_exit",
      executionTimestamp: 6_000,
      exitEvent: "regime_invalidation_exit",
      exitMechanism: "invalidation",
      invalidationMode: "family_mismatch",
      lifecycleEvent: "REGIME_INVALIDATION",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 300
    }),
    createEvent("SELL", 6_000, {
      botId: "bot_6",
      closeClassification: "confirmed_exit",
      executionTimestamp: 6_000,
      exitEvent: "regime_invalidation_exit",
      exitMechanism: "invalidation",
      lifecycleEvent: "REGIME_INVALIDATION",
      policyId: "RSI_REVERSION_PRO",
      signalToExecutionMs: 300
    }),
    createEvent("post_loss_architect_latch_activated", 7_000, {
      activatedAt: 7_000,
      botId: "bot_2",
      freshPublishCount: 0
    }),
    createEvent("entry_blocked", 7_200, {
      botId: "bot_2",
      reason: "post_loss_architect_latch"
    }),
    createEvent("post_loss_architect_latch_released", 8_000, {
      botId: "bot_2",
      freshPublishCount: 2,
      lastPublishedAt: 8_000
    }),
    createEvent("BUY", 8_500, {
      botId: "bot_2",
      decisionConfidence: 0.91,
      expectedNetEdgePct: 0.0062
    })
  ];

  const report = buildExitLifecycleReport({
    closedTrades,
    events
  });

  if (report.summary.byExitMechanism.qualification.count !== 2 || report.summary.byExitMechanism.recovery.count !== 2 || report.summary.byExitMechanism.protection.count !== 1 || report.summary.byExitMechanism.invalidation.count !== 1) {
    throw new Error(`exitMechanism aggregation should split qualification/recovery/protection/invalidation correctly: ${JSON.stringify(report.summary.byExitMechanism)}`);
  }

  if (report.summary.byCloseClassification.confirmed_exit.count !== 5 || report.summary.byCloseClassification.failed_rsi_exit.count !== 1) {
    throw new Error(`closeClassification aggregation should separate failed RSI exits: ${JSON.stringify(report.summary.byCloseClassification)}`);
  }

  if (report.managedRecovery.enteredCount !== 4 || report.managedRecovery.exitedBy.target !== 1 || report.managedRecovery.exitedBy.timeout !== 1 || report.managedRecovery.exitedBy.protection !== 1 || report.managedRecovery.exitedBy.invalidation !== 1) {
    throw new Error(`managed recovery outcome counting should distinguish target/timeout/protection/invalidation exits: ${JSON.stringify(report.managedRecovery)}`);
  }

  if (report.managedRecovery.avgNetPnlByExitType.target !== 0.45 || report.managedRecovery.avgNetPnlByExitType.timeout !== -0.15 || report.managedRecovery.avgNetPnlByExitType.protection !== -0.35 || report.managedRecovery.avgNetPnlByExitType.invalidation !== 0.05) {
    throw new Error(`managed recovery averages should be grouped by exit type: ${JSON.stringify(report.managedRecovery.avgNetPnlByExitType)}`);
  }

  if (report.rsi.confirmedProfitableCount !== 1 || report.rsi.failedCount !== 1 || report.rsi.deferredRecoveredProfitableCount !== 2 || report.rsi.deferredEndedNegativeCount !== 2) {
    throw new Error(`RSI exit analysis should compare immediate confirmed vs failed vs deferred outcomes: ${JSON.stringify(report.rsi)}`);
  }

  if (report.latch.activations !== 1 || report.latch.blockedEntries !== 1 || report.latch.avgFreshPublishesBeforeRelease !== 2 || report.latch.releasedWithLaterEntryCount !== 1 || report.latch.laterEntryAvgExpectedNetEdgePct !== 0.0062) {
    throw new Error(`post-loss latch metrics should count activations/blocks/releases and later entries: ${JSON.stringify(report.latch)}`);
  }

  if (report.timing.avgSignalToExecutionMsByCloseReason.rsi_exit_confirmed !== 270 || report.timing.failedRsiAvgSignalToExecutionMs !== 420 || report.timing.recoveredDeferredAvgSignalToExecutionMs !== 240) {
    throw new Error(`timing diagnostics should group latency by reason and outcome cohorts: ${JSON.stringify(report.timing)}`);
  }

  const rendered = renderExitLifecycleReport(report);
  if (!rendered.includes("Exit Lifecycle Report") || !rendered.includes("Managed recovery") || !rendered.includes("Post-loss latch")) {
    throw new Error(`rendered report should stay human-readable and compact: ${rendered}`);
  }
}

module.exports = {
  runExitLifecycleReportTests
};
