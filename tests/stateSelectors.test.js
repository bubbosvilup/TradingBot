"use strict";

const {
  assertValidBotLifecycleView,
  assertValidPositionState,
  deriveBotLifecycleView,
  deriveEntryGuardState,
  derivePositionState
} = require("../src/domain/stateSelectors.ts");

function createBotState(overrides = {}) {
  return {
    cooldownReason: null,
    cooldownUntil: null,
    lastDecisionReasons: [],
    pausedReason: null,
    postLossArchitectLatchActive: false,
    status: "running",
    ...overrides
  };
}

function createPosition(overrides = {}) {
  return {
    botId: "bot_state_selector",
    confidence: 0.8,
    entryPrice: 100,
    id: "position_state_selector",
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

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function runStateSelectorsTests() {
  expectEqual(derivePositionState(null), "flat", "null position should derive flat state");
  expectEqual(derivePositionState(createPosition()), "open_active", "active normal position should derive open_active");
  expectEqual(derivePositionState(createPosition({
    lifecycleMode: "managed_recovery",
    managedRecoveryStartedAt: 2_000
  })), "open_managed_recovery", "managed recovery position should derive open_managed_recovery");
  expectEqual(derivePositionState(createPosition({
    lifecycleState: "EXITING"
  })), "exiting", "exiting lifecycle state should derive exiting");

  assertValidPositionState(null);
  assertValidPositionState(createPosition());
  let managedRecoveryInvariantError = null;
  try {
    assertValidPositionState(createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryStartedAt: null
    }));
  } catch (error) {
    managedRecoveryInvariantError = error;
  }
  if (!managedRecoveryInvariantError || managedRecoveryInvariantError.kind !== "invariant" || managedRecoveryInvariantError.code !== "managed_recovery_started_at_missing") {
    throw new Error(`managed recovery without managedRecoveryStartedAt should be invalid: ${JSON.stringify(managedRecoveryInvariantError)}`);
  }

  expectEqual(deriveBotLifecycleView(createBotState({ status: "idle" })), "idle", "idle bot status should derive idle lifecycle view");
  expectEqual(deriveBotLifecycleView(createBotState({ status: "running" })), "running", "running bot status should derive running lifecycle view");
  expectEqual(deriveBotLifecycleView(createBotState({ pausedReason: "manual_pause", status: "paused" })), "paused", "paused bot status should derive paused lifecycle view");
  expectEqual(deriveBotLifecycleView(createBotState({ status: "stopped" })), "stopped", "stopped bot status should derive stopped lifecycle view");

  assertValidBotLifecycleView(createBotState({ pausedReason: "manual_pause", status: "paused" }));
  let pausedInvariantError = null;
  try {
    assertValidBotLifecycleView(createBotState({ pausedReason: null, status: "paused" }));
  } catch (error) {
    pausedInvariantError = error;
  }
  if (!pausedInvariantError || pausedInvariantError.kind !== "invariant" || pausedInvariantError.code !== "paused_reason_missing") {
    throw new Error(`paused bot without pausedReason should be invalid: ${JSON.stringify(pausedInvariantError)}`);
  }
  let stalePauseReasonError = null;
  try {
    assertValidBotLifecycleView(createBotState({ pausedReason: "manual_pause", status: "running" }));
  } catch (error) {
    stalePauseReasonError = error;
  }
  if (!stalePauseReasonError || stalePauseReasonError.kind !== "invariant" || stalePauseReasonError.code !== "paused_reason_without_paused_status") {
    throw new Error(`running bot with pausedReason should be invalid: ${JSON.stringify(stalePauseReasonError)}`);
  }

  expectEqual(deriveEntryGuardState({ botState: createBotState(), now: 1_000 }), "open_allowed", "default running bot should allow entry");
  expectEqual(deriveEntryGuardState({ botState: createBotState({ cooldownUntil: 2_000 }), now: 1_000 }), "cooldown_block", "active cooldown should block entry");
  expectEqual(deriveEntryGuardState({ botState: createBotState({ postLossArchitectLatchActive: true }), now: 1_000 }), "post_loss_latch_block", "post-loss latch should block entry");
  expectEqual(deriveEntryGuardState({ botState: createBotState({ pausedReason: "manual_pause", status: "paused" }), now: 1_000 }), "manual_pause_block", "manual pause should block entry");
  expectEqual(deriveEntryGuardState({
    botState: createBotState(),
    now: 1_000,
    portfolioKillSwitch: { blockingEntries: true }
  }), "kill_switch_block", "portfolio kill switch should block entry");
  expectEqual(deriveEntryGuardState({
    botState: createBotState(),
    marketDataFreshness: { status: "stale" },
    now: 1_000
  }), "market_data_block", "stale market data should block entry");
  expectEqual(deriveEntryGuardState({
    botState: createBotState({ pausedReason: "max_drawdown_reached", status: "paused" }),
    now: 1_000
  }), "drawdown_block", "max drawdown pause should block entry");
  expectEqual(deriveEntryGuardState({
    botState: createBotState({ lastDecisionReasons: ["strategy_error"] }),
    now: 1_000
  }), "strategy_error_block", "strategy error decision should derive strategy_error_block");
}

module.exports = {
  runStateSelectorsTests
};
