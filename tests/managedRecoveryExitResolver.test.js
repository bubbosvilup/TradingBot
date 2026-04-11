"use strict";

const { resolveManagedRecoveryExit } = require("../src/roles/managedRecoveryExitResolver.ts");

function buildExitReason(decisionReasons, primaryReason, confirmationTicks) {
  const nextReasons = decisionReasons.filter((reason) =>
    reason !== "rsi_exit_threshold_hit"
    && reason !== "emergency_stop"
    && reason !== "managed_recovery_rsi_ignored"
  );
  if (!nextReasons.includes(primaryReason)) {
    nextReasons.push(primaryReason);
  }
  if (Number.isFinite(Number(confirmationTicks)) && Number(confirmationTicks) > 0) {
    nextReasons.push(`exit_confirmed_${Number(confirmationTicks)}ticks`);
  }
  return nextReasons;
}

function runManagedRecoveryExitResolverTests() {
  const protectiveExit = {
    exitMechanism: "protection",
    lifecycleEvent: "PROTECTIVE_STOP_HIT",
    protectionMode: "fixed_pct",
    reason: ["protective_stop_exit"]
  };

  const protectivePlan = resolveManagedRecoveryExit({
    buildExitReason,
    decisionReasons: ["rsi_exit_threshold_hit", "reversion_price_target_hit"],
    exitConfirmationTicks: 2,
    exitSignalStreak: 3,
    invalidationExit: {
      exitMechanism: "invalidation",
      invalidationLevel: "family",
      invalidationMode: "family_mismatch",
      lifecycleEvent: "REGIME_INVALIDATION",
      reason: ["regime_invalidation_exit"]
    },
    managedRecoveryStartedAt: 1_000,
    priceTargetHit: true,
    protectiveExit,
    rsiExitThresholdHit: true,
    tickTimestamp: 200_000,
    timeoutMs: 60_000
  });
  if (!protectivePlan.exitNow || protectivePlan.exitMechanism !== "protection" || protectivePlan.lifecycleEvent !== "PROTECTIVE_STOP_HIT") {
    throw new Error(`protective exit should win inside managed recovery: ${JSON.stringify(protectivePlan)}`);
  }

  const timeoutPlan = resolveManagedRecoveryExit({
    buildExitReason,
    decisionReasons: ["hold_recovery"],
    exitConfirmationTicks: 2,
    exitSignalStreak: 0,
    invalidationExit: null,
    managedRecoveryStartedAt: 1_000,
    priceTargetHit: false,
    protectiveExit: null,
    rsiExitThresholdHit: false,
    tickTimestamp: 61_000,
    timeoutMs: 60_000
  });
  if (!timeoutPlan.exitNow || timeoutPlan.exitMechanism !== "recovery" || timeoutPlan.lifecycleEvent !== "RECOVERY_TIMEOUT" || !timeoutPlan.reason.includes("time_exhaustion_exit")) {
    throw new Error(`managed recovery timeout should force exit: ${JSON.stringify(timeoutPlan)}`);
  }

  const targetOverInvalidationPlan = resolveManagedRecoveryExit({
    buildExitReason,
    decisionReasons: ["reversion_price_target_hit"],
    exitConfirmationTicks: 2,
    exitSignalStreak: 2,
    invalidationExit: {
      exitMechanism: "invalidation",
      invalidationLevel: "family",
      invalidationMode: "family_mismatch",
      lifecycleEvent: "REGIME_INVALIDATION",
      reason: ["regime_invalidation_exit"]
    },
    managedRecoveryStartedAt: 1_000,
    priceTargetHit: true,
    protectiveExit: null,
    rsiExitThresholdHit: false,
    tickTimestamp: 30_000,
    timeoutMs: 60_000
  });
  if (!targetOverInvalidationPlan.exitNow || targetOverInvalidationPlan.exitMechanism !== "recovery" || targetOverInvalidationPlan.lifecycleEvent !== "PRICE_TARGET_HIT") {
    throw new Error(`confirmed managed recovery target should preempt invalidation: ${JSON.stringify(targetOverInvalidationPlan)}`);
  }

  const invalidationPlan = resolveManagedRecoveryExit({
    buildExitReason,
    decisionReasons: ["hold_recovery"],
    exitConfirmationTicks: 2,
    exitSignalStreak: 1,
    invalidationExit: {
      exitMechanism: "invalidation",
      invalidationLevel: "family",
      invalidationMode: "family_mismatch",
      lifecycleEvent: "REGIME_INVALIDATION",
      reason: ["regime_invalidation_exit"]
    },
    managedRecoveryStartedAt: 1_000,
    priceTargetHit: false,
    protectiveExit: null,
    rsiExitThresholdHit: false,
    tickTimestamp: 30_000,
    timeoutMs: 60_000
  });
  if (!invalidationPlan.exitNow || invalidationPlan.exitMechanism !== "invalidation" || invalidationPlan.lifecycleEvent !== "REGIME_INVALIDATION") {
    throw new Error(`managed recovery invalidation should still exit when target is not confirmed: ${JSON.stringify(invalidationPlan)}`);
  }

  const targetHitPlan = resolveManagedRecoveryExit({
    buildExitReason,
    decisionReasons: ["reversion_price_target_hit"],
    exitConfirmationTicks: 2,
    exitSignalStreak: 2,
    invalidationExit: null,
    managedRecoveryStartedAt: 1_000,
    priceTargetHit: true,
    protectiveExit: null,
    rsiExitThresholdHit: false,
    tickTimestamp: 30_000,
    timeoutMs: 60_000
  });
  if (!targetHitPlan.exitNow || targetHitPlan.exitMechanism !== "recovery" || targetHitPlan.lifecycleEvent !== "PRICE_TARGET_HIT" || !targetHitPlan.reason.includes("exit_confirmed_2ticks")) {
    throw new Error(`managed recovery target-hit exit should require confirmation and preserve reason shaping: ${JSON.stringify(targetHitPlan)}`);
  }

  const ignoredRsiPlan = resolveManagedRecoveryExit({
    buildExitReason,
    decisionReasons: ["rsi_exit_threshold_hit"],
    exitConfirmationTicks: 2,
    exitSignalStreak: 1,
    invalidationExit: null,
    managedRecoveryStartedAt: 1_000,
    priceTargetHit: false,
    protectiveExit: null,
    rsiExitThresholdHit: true,
    tickTimestamp: 30_000,
    timeoutMs: 60_000
  });
  if (ignoredRsiPlan.exitNow || ignoredRsiPlan.reason.length !== 1 || ignoredRsiPlan.reason[0] !== "managed_recovery_rsi_ignored") {
    throw new Error(`managed recovery should ignore RSI threshold hits when no higher-priority exit is ready: ${JSON.stringify(ignoredRsiPlan)}`);
  }
}

module.exports = {
  runManagedRecoveryExitResolverTests
};
