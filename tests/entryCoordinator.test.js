"use strict";

const { StateStore } = require("../src/core/stateStore.ts");
const { EntryCoordinator } = require("../src/roles/entryCoordinator.ts");

function createCoordinator() {
  const store = new StateStore();
  const config = {
    enabled: true,
    id: "bot_test",
    initialBalanceUsdt: 1000,
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "BTC/USDT"
  };
  store.registerBot(config);
  return {
    coordinator: new EntryCoordinator({
      botId: config.id,
      store
    }),
    store
  };
}

function createArchitectState(overrides = {}) {
  return {
    actionableFamily: "trend_following",
    architect: {
      recommendedFamily: "trend_following"
    },
    architectAgeMs: 1000,
    architectStale: false,
    blockReason: null,
    currentFamily: "trend_following",
    entryMaturityThreshold: 0.5,
    familyMatch: true,
    publisher: {
      lastObservedAt: 1000,
      lastPublishedAt: 1000
    },
    ready: true,
    staleThresholdMs: 90000,
    usable: true,
    ...overrides
  };
}

async function runEntryCoordinatorTests() {
  const cooldownHarness = createCoordinator();
  cooldownHarness.store.updateBotState("bot_test", {
    cooldownReason: "loss_cooldown",
    cooldownUntil: 2_000,
    entrySignalStreak: 1,
    exitSignalStreak: 0
  });
  const cooldownState = cooldownHarness.coordinator.updateSignalState({
    decisionAction: "buy",
    hasPosition: false,
    state: cooldownHarness.store.getBotState("bot_test"),
    timestamp: 1_500
  });
  if (cooldownState.entrySignalStreak !== 1) {
    throw new Error(`entrySignalStreak should remain frozen during cooldown: ${cooldownState.entrySignalStreak}`);
  }

  const progressionHarness = createCoordinator();
  let progressionState = progressionHarness.store.getBotState("bot_test");
  progressionState = progressionHarness.coordinator.updateSignalState({
    decisionAction: "buy",
    hasPosition: false,
    state: progressionState,
    timestamp: 1_000
  });
  if (progressionState.entrySignalStreak !== 1) {
    throw new Error(`entrySignalStreak should increment on a flat buy signal: ${progressionState.entrySignalStreak}`);
  }
  progressionState = progressionHarness.coordinator.updateSignalState({
    decisionAction: "hold",
    hasPosition: false,
    state: progressionState,
    timestamp: 2_000
  });
  if (progressionState.entrySignalStreak !== 0) {
    throw new Error(`entrySignalStreak should reset when the buy signal disappears: ${progressionState.entrySignalStreak}`);
  }
  progressionState = progressionHarness.coordinator.updateSignalState({
    decisionAction: "sell",
    hasPosition: false,
    state: progressionState,
    timestamp: 3_000
  });
  if (progressionState.entrySignalStreak !== 1) {
    throw new Error(`entrySignalStreak should increment on a flat short-entry sell signal: ${progressionState.entrySignalStreak}`);
  }

  const eligibleAttempt = progressionHarness.coordinator.resolveEntryAttempt({
    decisionAction: "buy",
    entryDebounceTicks: 2,
    entrySignalStreak: 2,
    riskAllowed: true,
    riskReason: null
  });
  if (eligibleAttempt.kind !== "eligible") {
    throw new Error(`debounced buy signal should become eligible: ${JSON.stringify(eligibleAttempt)}`);
  }
  const eligibleShortAttempt = progressionHarness.coordinator.resolveEntryAttempt({
    decisionAction: "sell",
    entryDebounceTicks: 2,
    entrySignalStreak: 2,
    riskAllowed: true,
    riskReason: null
  });
  if (eligibleShortAttempt.kind !== "eligible") {
    throw new Error(`debounced short-entry sell signal should become eligible: ${JSON.stringify(eligibleShortAttempt)}`);
  }

  const blockedAttempt = progressionHarness.coordinator.resolveEntryAttempt({
    decisionAction: "buy",
    entryDebounceTicks: 2,
    entrySignalStreak: 2,
    riskAllowed: false,
    riskReason: "loss_cooldown"
  });
  if (blockedAttempt.kind !== "blocked" || blockedAttempt.blockReason !== "loss_cooldown") {
    throw new Error(`risk disallow should produce a blocked entry outcome: ${JSON.stringify(blockedAttempt)}`);
  }

  const skippedAttempt = progressionHarness.coordinator.resolveEntryAttempt({
    decisionAction: "hold",
    entryDebounceTicks: 2,
    entrySignalStreak: 0,
    riskAllowed: true,
    riskReason: null
  });
  if (skippedAttempt.kind !== "skipped" || skippedAttempt.skipReason !== "no_entry_signal") {
    throw new Error(`non-buy decisions should stay skipped with no_entry_signal: ${JSON.stringify(skippedAttempt)}`);
  }

  const latchGate = progressionHarness.coordinator.evaluateFinalGate({
    architectState: createArchitectState(),
    diagnostics: {
      expectedGrossEdgePct: 0.01,
      expectedNetEdgePct: 0.008
    },
    economics: {
      estimatedEntryFeePct: 0.001,
      estimatedExitFeePct: 0.001,
      estimatedRoundTripFeesUsdt: 0.2,
      estimatedSlippagePct: 0.0005,
      expectedGrossEdgePct: 0.01,
      expectedGrossEdgeUsdt: 1,
      expectedNetEdgePct: 0.008,
      minExpectedNetEdgePct: 0.0005,
      notionalUsdt: 100,
      profitSafetyBufferPct: 0.0005,
      requiredEdgePct: 0.0025
    },
    postLossArchitectLatchBlocking: true,
    quantity: 1,
    tradeConstraints: {
      minNotionalUsdt: 10,
      minQuantity: 0.001
    }
  });
  if (latchGate.allowed || latchGate.diagnostics.blockReason !== "post_loss_architect_latch") {
    throw new Error(`post-loss latch should block the final local entry gate: ${JSON.stringify(latchGate)}`);
  }

  const targetDistanceGate = progressionHarness.coordinator.evaluateFinalGate({
    architectState: createArchitectState(),
    diagnostics: {
      expectedGrossEdgePct: 0.02,
      expectedNetEdgePct: 0.017
    },
    economics: {
      estimatedEntryFeePct: 0.001,
      estimatedExitFeePct: 0.001,
      estimatedRoundTripFeesUsdt: 0.2,
      estimatedSlippagePct: 0.0005,
      expectedGrossEdgePct: 0.02,
      expectedGrossEdgeUsdt: 2,
      expectedNetEdgePct: 0.017,
      maxTargetDistancePctForShortHorizon: 0.01,
      minExpectedNetEdgePct: 0.0005,
      notionalUsdt: 100,
      profitSafetyBufferPct: 0.0005,
      requiredEdgePct: 0.0025,
      targetDistancePct: 0.015
    },
    postLossArchitectLatchBlocking: false,
    quantity: 1,
    tradeConstraints: {
      minNotionalUsdt: 10,
      minQuantity: 0.001
    }
  });
  if (targetDistanceGate.allowed || targetDistanceGate.diagnostics.blockReason !== "target_distance_exceeds_short_horizon") {
    throw new Error(`short-horizon target distance should block the final local entry gate: ${JSON.stringify(targetDistanceGate)}`);
  }

  const allowedGate = progressionHarness.coordinator.evaluateFinalGate({
    architectState: createArchitectState(),
    diagnostics: {
      expectedGrossEdgePct: 0.01,
      expectedNetEdgePct: 0.008
    },
    economics: {
      estimatedEntryFeePct: 0.001,
      estimatedExitFeePct: 0.001,
      estimatedRoundTripFeesUsdt: 0.2,
      estimatedSlippagePct: 0.0005,
      expectedGrossEdgePct: 0.01,
      expectedGrossEdgeUsdt: 1,
      expectedNetEdgePct: 0.008,
      minExpectedNetEdgePct: 0.0005,
      notionalUsdt: 100,
      profitSafetyBufferPct: 0.0005,
      requiredEdgePct: 0.0025
    },
    postLossArchitectLatchBlocking: false,
    quantity: 1,
    tradeConstraints: {
      minNotionalUsdt: 10,
      minQuantity: 0.001
    }
  });
  if (!allowedGate.allowed || allowedGate.diagnostics.blockReason !== "allowed") {
    throw new Error(`eligible entries should keep the existing allowed final-gate result: ${JSON.stringify(allowedGate)}`);
  }
}

module.exports = {
  runEntryCoordinatorTests
};
