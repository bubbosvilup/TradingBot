"use strict";

const {
  DEFAULT_MANAGED_RECOVERY_MAX_CONSECUTIVE_ENTRIES,
  POSITION_LIFECYCLE_EVENTS,
  POSITION_LIFECYCLE_STATES,
  beginPositionExit,
  closePositionLifecycle,
  enterManagedRecovery,
  getManagedRecoveryPolicy,
  getPositionLifecycleState,
  resolveLifecycleEventFromReasons
} = require("../src/roles/positionLifecycleManager.ts");

function createPosition(overrides = {}) {
  return {
    botId: "bot_lifecycle",
    confidence: 0.8,
    entryPrice: 100,
    id: "pos_lifecycle",
    lastLifecycleEvent: null,
    lifecycleMode: "normal",
    lifecycleState: POSITION_LIFECYCLE_STATES.ACTIVE,
    lifecycleUpdatedAt: 1000,
    managedRecoveryDeferredReason: null,
    managedRecoveryExitFloorNetPnlUsdt: null,
    managedRecoveryStartedAt: null,
    notes: ["entry"],
    openedAt: 1000,
    quantity: 1,
    strategyId: "rsiReversion",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function runPositionLifecycleManagerTests() {
  const activePosition = createPosition();
  if (getPositionLifecycleState(activePosition) !== POSITION_LIFECYCLE_STATES.ACTIVE) {
    throw new Error("ACTIVE lifecycle state should be resolved from the persisted position");
  }

  const managedRecoveryTransition = enterManagedRecovery(activePosition, {
    exitFloorNetPnlUsdt: 0.05,
    reason: "rsi_exit_deferred",
    startedAt: 2000
  });
  if (!managedRecoveryTransition.allowed || managedRecoveryTransition.position.lifecycleState !== POSITION_LIFECYCLE_STATES.MANAGED_RECOVERY || managedRecoveryTransition.position.lastLifecycleEvent !== POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT) {
    throw new Error(`ACTIVE -> MANAGED_RECOVERY transition should be explicit and valid: ${JSON.stringify(managedRecoveryTransition)}`);
  }

  const exitingTransition = beginPositionExit(managedRecoveryTransition.position, {
    event: POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT,
    timestamp: 3000
  });
  if (!exitingTransition.allowed || exitingTransition.position.lifecycleState !== POSITION_LIFECYCLE_STATES.EXITING || exitingTransition.position.lastLifecycleEvent !== POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT) {
    throw new Error(`MANAGED_RECOVERY -> EXITING transition should be explicit and valid: ${JSON.stringify(exitingTransition)}`);
  }

  const closedTransition = closePositionLifecycle(exitingTransition.position, {
    event: POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT,
    timestamp: 4000
  });
  if (!closedTransition.allowed || closedTransition.nextState !== POSITION_LIFECYCLE_STATES.CLOSED || closedTransition.position.lifecycleState !== POSITION_LIFECYCLE_STATES.CLOSED) {
    throw new Error(`EXITING -> CLOSED transition should be explicit and valid: ${JSON.stringify(closedTransition)}`);
  }

  const invalidDirectClose = closePositionLifecycle(activePosition, {
    event: POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT,
    timestamp: 5000
  });
  if (invalidDirectClose.allowed !== false || !String(invalidDirectClose.error || "").includes("invalid_position_lifecycle_transition")) {
    throw new Error(`invalid direct ACTIVE -> CLOSED transition should be prevented explicitly: ${JSON.stringify(invalidDirectClose)}`);
  }

  const defaultPolicy = getManagedRecoveryPolicy(null);
  if (defaultPolicy.maxConsecutiveEntries !== DEFAULT_MANAGED_RECOVERY_MAX_CONSECUTIVE_ENTRIES) {
    throw new Error(`managed recovery policy should expose the default breaker threshold: ${JSON.stringify(defaultPolicy)}`);
  }
  if (resolveLifecycleEventFromReasons(["managed_recovery_breaker_exit"]) !== POSITION_LIFECYCLE_EVENTS.MANAGED_RECOVERY_BREAKER_HIT) {
    throw new Error("managed recovery breaker reason should map to an explicit lifecycle event");
  }
}

module.exports = {
  runPositionLifecycleManagerTests
};
