import type { InvalidationMode } from "../types/exitPolicy.ts";
import type { PositionExitMechanism, PositionLifecycleEvent } from "../types/positionLifecycle.ts";

type ManagedRecoveryExitDescriptor = {
  exitMechanism?: PositionExitMechanism | null;
  invalidationLevel?: string | null;
  invalidationMode?: InvalidationMode | null;
  lifecycleEvent?: PositionLifecycleEvent | null;
  protectionMode?: string | null;
  reason: string[];
};

type ManagedRecoveryExitPlan = ManagedRecoveryExitDescriptor & {
  exitNow: boolean;
};

function resolveManagedRecoveryExit(params: {
  buildExitReason: (decisionReasons: string[], primaryReason: string, confirmationTicks?: number | null) => string[];
  decisionReasons: string[];
  exitConfirmationTicks: number;
  exitSignalStreak: number;
  invalidationExit?: ManagedRecoveryExitDescriptor | null;
  managedRecoveryStartedAt: number;
  priceTargetHit: boolean;
  protectiveExit?: ManagedRecoveryExitDescriptor | null;
  rsiExitThresholdHit: boolean;
  tickTimestamp: number;
  timeoutMs: number;
}): ManagedRecoveryExitPlan {
  if (params.protectiveExit) {
    return {
      exitNow: true,
      ...params.protectiveExit
    };
  }

  if ((params.tickTimestamp - params.managedRecoveryStartedAt) >= params.timeoutMs) {
    return {
      exitMechanism: "recovery",
      exitNow: true,
      lifecycleEvent: "RECOVERY_TIMEOUT",
      reason: params.buildExitReason(params.decisionReasons, "time_exhaustion_exit")
    };
  }

  if (params.priceTargetHit && params.exitSignalStreak >= params.exitConfirmationTicks) {
    return {
      exitMechanism: "recovery",
      exitNow: true,
      lifecycleEvent: "PRICE_TARGET_HIT",
      reason: params.buildExitReason(
        params.decisionReasons,
        "reversion_price_target_hit",
        params.exitConfirmationTicks
      )
    };
  }

  if (params.invalidationExit) {
    return {
      exitNow: true,
      ...params.invalidationExit
    };
  }

  return {
    exitNow: false,
    reason: params.rsiExitThresholdHit
      ? ["managed_recovery_rsi_ignored"]
      : params.decisionReasons
  };
}

module.exports = {
  resolveManagedRecoveryExit
};
