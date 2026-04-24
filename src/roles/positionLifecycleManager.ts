import type { PositionRecord } from "../types/trade.ts";
import type { ExitPolicy } from "../types/exitPolicy.ts";
import type { PositionLifecycleEvent, PositionLifecycleState } from "../types/positionLifecycle.ts";

const DEFAULT_MANAGED_RECOVERY_EXIT_FLOOR_NET_PNL_USDT = 0.05;
const DEFAULT_MANAGED_RECOVERY_MAX_CONSECUTIVE_ENTRIES = 2;
const DEFAULT_MANAGED_RECOVERY_TIMEOUT_MS = 120_000;
const { normalizeRecoveryTargetOffsetPct } = require("./recoveryTargetResolver.ts");
const POSITION_LIFECYCLE_STATES = {
  ACTIVE: "ACTIVE" as const,
  CLOSED: "CLOSED" as const,
  EXITING: "EXITING" as const,
  MANAGED_RECOVERY: "MANAGED_RECOVERY" as const
};
const POSITION_LIFECYCLE_EVENTS = {
  FAILED_RSI_EXIT: "FAILED_RSI_EXIT" as const,
  PRICE_TARGET_HIT: "PRICE_TARGET_HIT" as const,
  PROTECTIVE_STOP_HIT: "PROTECTIVE_STOP_HIT" as const,
  RECOVERY_TIMEOUT: "RECOVERY_TIMEOUT" as const,
  REGIME_INVALIDATION: "REGIME_INVALIDATION" as const,
  MANAGED_RECOVERY_BREAKER_HIT: "MANAGED_RECOVERY_BREAKER_HIT" as const,
  RSI_EXIT_HIT: "RSI_EXIT_HIT" as const
};

function getPositionLifecycleState(position: PositionRecord | null | undefined): PositionLifecycleState | null {
  if (!position) return null;
  if (position.lifecycleState === POSITION_LIFECYCLE_STATES.ACTIVE
    || position.lifecycleState === POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY
    || position.lifecycleState === POSITION_LIFECYCLE_STATES.EXITING
    || position.lifecycleState === POSITION_LIFECYCLE_STATES.CLOSED) {
    return position.lifecycleState;
  }
  return position.lifecycleMode === "managed_recovery"
    ? POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY
    : POSITION_LIFECYCLE_STATES.ACTIVE;
}

function isManagedRecoveryPosition(position: PositionRecord | null | undefined) {
  return getPositionLifecycleState(position) === POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY;
}

function normalizeLifecycleMode(state: PositionLifecycleState) {
  return state === POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY ? "managed_recovery" : "normal";
}

function isLifecycleTransitionAllowed(currentState: PositionLifecycleState | null, nextState: PositionLifecycleState) {
  if (currentState === null) return nextState === POSITION_LIFECYCLE_STATES.CLOSED;
  const allowedTransitions: Record<PositionLifecycleState, PositionLifecycleState[]> = {
    ACTIVE: [POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY, POSITION_LIFECYCLE_STATES.EXITING],
    CLOSED: [],
    EXITING: [POSITION_LIFECYCLE_STATES.CLOSED],
    MANAGED_RECOVERY: [POSITION_LIFECYCLE_STATES.EXITING]
  };
  return allowedTransitions[currentState].includes(nextState);
}

function transitionPositionLifecycle(position: PositionRecord, params: {
  event: PositionLifecycleEvent;
  nextState: PositionLifecycleState;
  patch?: Partial<PositionRecord>;
  timestamp: number;
}) {
  const currentState = getPositionLifecycleState(position);
  if (!isLifecycleTransitionAllowed(currentState, params.nextState)) {
    return {
      allowed: false,
      currentState,
      error: `invalid_position_lifecycle_transition:${String(currentState)}->${params.nextState}`,
      nextState: params.nextState
    };
  }

  return {
    allowed: true,
    currentState,
    nextState: params.nextState,
    position: {
      ...position,
      ...(params.patch || {}),
      lastLifecycleEvent: params.event,
      lifecycleMode: normalizeLifecycleMode(params.nextState),
      lifecycleState: params.nextState,
      lifecycleUpdatedAt: params.timestamp
    }
  };
}

function beginPositionExit(position: PositionRecord, params: {
  event: PositionLifecycleEvent;
  timestamp: number;
}) {
  return transitionPositionLifecycle(position, {
    event: params.event,
    nextState: POSITION_LIFECYCLE_STATES.EXITING,
    timestamp: params.timestamp
  });
}

function closePositionLifecycle(position: PositionRecord, params: {
  event: PositionLifecycleEvent;
  timestamp: number;
}) {
  return transitionPositionLifecycle(position, {
    event: params.event,
    nextState: POSITION_LIFECYCLE_STATES.CLOSED,
    timestamp: params.timestamp
  });
}

function resolveLifecycleEventFromReasons(reasons: string[], closeClassification?: string | null): PositionLifecycleEvent | null {
  if (closeClassification === "failed_rsi_exit") {
    return POSITION_LIFECYCLE_EVENTS.FAILED_RSI_EXIT;
  }
  if (reasons.includes("rsi_exit_confirmed") || reasons.includes("rsi_exit_threshold_hit") || reasons.includes("rsi_exit_deferred")) {
    return POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT;
  }
  if (reasons.includes("reversion_price_target_hit")) {
    return POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT;
  }
  if (reasons.includes("regime_invalidation_exit")) {
    return POSITION_LIFECYCLE_EVENTS.REGIME_INVALIDATION;
  }
  if (reasons.includes("protective_stop_exit")) {
    return POSITION_LIFECYCLE_EVENTS.PROTECTIVE_STOP_HIT;
  }
  if (reasons.includes("managed_recovery_breaker_exit")) {
    return POSITION_LIFECYCLE_EVENTS.MANAGED_RECOVERY_BREAKER_HIT;
  }
  if (reasons.includes("time_exhaustion_exit")) {
    return POSITION_LIFECYCLE_EVENTS.RECOVERY_TIMEOUT;
  }
  return null;
}

function getManagedRecoveryPolicy(exitPolicy: ExitPolicy | null | undefined) {
  const exitFloorNetPnlUsdt = Number(exitPolicy?.qualification?.minTickProfit);
  const timeoutMs = Number(exitPolicy?.recovery?.timeoutMs);
  return {
    exitFloorNetPnlUsdt: Math.max(
      Number.isFinite(exitFloorNetPnlUsdt)
        ? exitFloorNetPnlUsdt
        : DEFAULT_MANAGED_RECOVERY_EXIT_FLOOR_NET_PNL_USDT,
      0
    ),
    maxConsecutiveEntries: Math.max(
      Number.isFinite(Number(exitPolicy?.recovery?.maxConsecutiveEntries))
        ? Number(exitPolicy?.recovery?.maxConsecutiveEntries)
        : DEFAULT_MANAGED_RECOVERY_MAX_CONSECUTIVE_ENTRIES,
      1
    ),
    timeoutMs: Math.max(
      Number.isFinite(timeoutMs)
        ? timeoutMs
        : DEFAULT_MANAGED_RECOVERY_TIMEOUT_MS,
      1_000
    ),
    targetOffsetPct: normalizeRecoveryTargetOffsetPct(exitPolicy?.recovery?.targetOffsetPct),
    targetSource: String(exitPolicy?.recovery?.targetSource || "emaSlow")
  };
}

function enterManagedRecovery(position: PositionRecord, params: {
  exitFloorNetPnlUsdt: number;
  reason: string;
  startedAt: number;
}) {
  return transitionPositionLifecycle(position, {
    event: POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT,
    nextState: POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY,
    patch: {
      managedRecoveryDeferredReason: params.reason,
      managedRecoveryExitFloorNetPnlUsdt: params.exitFloorNetPnlUsdt,
      managedRecoveryStartedAt: params.startedAt
    },
    timestamp: params.startedAt
  });
}

module.exports = {
  DEFAULT_MANAGED_RECOVERY_EXIT_FLOOR_NET_PNL_USDT,
  DEFAULT_MANAGED_RECOVERY_MAX_CONSECUTIVE_ENTRIES,
  DEFAULT_MANAGED_RECOVERY_TIMEOUT_MS,
  POSITION_LIFECYCLE_EVENTS,
  POSITION_LIFECYCLE_STATES,
  beginPositionExit,
  closePositionLifecycle,
  enterManagedRecovery,
  getManagedRecoveryPolicy,
  getPositionLifecycleState,
  isManagedRecoveryPosition,
  isLifecycleTransitionAllowed,
  resolveLifecycleEventFromReasons
};
