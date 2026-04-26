"use strict";

const {
  assertOrderTransition,
  assertPositionTransition,
  canTransitionOrder,
  canTransitionPosition
} = require("../../src/domain/stateTransitions.ts");

function createPosition(overrides = {}) {
  return {
    botId: "bot_transition_contract",
    confidence: 0.8,
    entryPrice: 100,
    id: "position_transition_contract",
    lifecycleMode: "normal",
    lifecycleState: "ACTIVE",
    notes: ["entry"],
    openedAt: 1_000,
    quantity: 1,
    side: "long",
    strategyId: "emaCross",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function expectInvariantError(fn, expectedCode, message) {
  let caught = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  if (!caught || caught.kind !== "invariant" || caught.code !== expectedCode) {
    throw new Error(`${message}: ${JSON.stringify(caught)}`);
  }
}

function runStateTransitionsContractTests() {
  const activePosition = createPosition();
  const managedRecoveryPosition = createPosition({
    lifecycleMode: "managed_recovery",
    managedRecoveryStartedAt: 2_000
  });
  const exitingPosition = createPosition({
    lifecycleState: "EXITING"
  });

  if (!canTransitionPosition("flat", activePosition)) {
    throw new Error("flat should be allowed to transition to open_active");
  }
  assertPositionTransition("flat", activePosition);
  assertPositionTransition(activePosition, managedRecoveryPosition);
  assertPositionTransition(activePosition, exitingPosition);
  assertPositionTransition(managedRecoveryPosition, exitingPosition);
  assertPositionTransition(exitingPosition, null);
  assertPositionTransition(activePosition, null);
  assertPositionTransition(managedRecoveryPosition, null);

  if (canTransitionPosition("flat", null) !== true) {
    throw new Error("same position state should be idempotent");
  }

  expectInvariantError(
    () => assertPositionTransition("flat", exitingPosition),
    "invalid_position_transition",
    "closing from flat should be invalid"
  );
  expectInvariantError(
    () => assertPositionTransition(activePosition, createPosition({ id: "another_open" })),
    "invalid_position_transition",
    "opening from non-flat should be invalid"
  );
  expectInvariantError(
    () => assertPositionTransition(activePosition, createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryStartedAt: null
    })),
    "managed_recovery_started_at_missing",
    "managed recovery transition should require managedRecoveryStartedAt"
  );

  if (!canTransitionOrder("created", "opened")
    || !canTransitionOrder("created", "closed")
    || !canTransitionOrder("created", "rejected")
    || !canTransitionOrder("opened", "closed")) {
    throw new Error("expected order lifecycle transitions should be allowed");
  }
  assertOrderTransition("created", "opened");
  assertOrderTransition("created", "closed");
  assertOrderTransition("created", "rejected");
  assertOrderTransition("opened", "closed");

  expectInvariantError(
    () => assertOrderTransition("closed", "opened"),
    "invalid_order_transition",
    "closed order should not reopen"
  );
  expectInvariantError(
    () => assertOrderTransition("rejected", "opened"),
    "invalid_order_transition",
    "rejected order should not open"
  );
}

module.exports = {
  runStateTransitionsContractTests
};
