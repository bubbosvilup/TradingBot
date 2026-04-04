"use strict";

const { ExitDecisionCoordinator, buildExitReason } = require("../src/roles/exitDecisionCoordinator.ts");

function createPosition(overrides = {}) {
  return {
    botId: "bot_test",
    confidence: 0.8,
    entryPrice: 100,
    id: "pos-test",
    lifecycleMode: "normal",
    managedRecoveryDeferredReason: null,
    managedRecoveryExitFloorNetPnlUsdt: null,
    managedRecoveryStartedAt: null,
    notes: ["test_position"],
    openedAt: 1_000,
    quantity: 0.5,
    strategyId: "emaCross",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function createTick(overrides = {}) {
  return {
    price: 100,
    source: "mock",
    symbol: "BTC/USDT",
    timestamp: 20_000,
    ...overrides
  };
}

function createSignalState(overrides = {}) {
  return {
    exitSignalStreak: 0,
    ...overrides
  };
}

function runExitDecisionCoordinatorTests() {
  const coordinator = new ExitDecisionCoordinator();
  const exitPolicy = {
    id: "RSI_REVERSION_PRO",
    invalidation: {
      modes: ["family_mismatch", "unclear"]
    },
    protection: {
      allowBreakEven: false,
      stopMode: "fixed_pct"
    },
    qualification: {
      estimatedCostMultiplier: 1,
      minTickProfit: 0.05,
      pnlExitFloorMode: "strict_net_positive"
    },
    recovery: {
      targetOffsetPct: 0.015,
      targetSource: "emaSlow",
      timeoutMs: 60_000
    }
  };

  const protectivePlan = coordinator.resolve({
    decision: {
      action: "sell",
      confidence: 0.9,
      reason: ["exit_signal"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (price - position.entryPrice) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 19_500
    }),
    resolveInvalidationLevel() {
      return "family_mismatch";
    },
    signalState: createSignalState({
      exitSignalStreak: 0
    }),
    tick: createTick({
      price: 98.9
    })
  });
  if (!protectivePlan.exitNow || protectivePlan.exitMechanism !== "protection" || protectivePlan.lifecycleEvent !== "PROTECTIVE_STOP_HIT" || !protectivePlan.reason.includes("protective_stop_exit")) {
    throw new Error(`protective exit planning regressed: ${JSON.stringify(protectivePlan)}`);
  }

  const invalidationPlan = coordinator.resolve({
    architectState: {
      blockReason: null,
      familyMatch: false,
      usable: true
    },
    decision: {
      action: "hold",
      confidence: 0.5,
      reason: ["hold_recovery"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (price - position.entryPrice) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: {
      hit: true
    },
    minHoldMs: 15_000,
    position: createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: 10_000,
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return "family_mismatch";
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      timestamp: 20_000
    })
  });
  if (!invalidationPlan.exitNow || invalidationPlan.exitMechanism !== "invalidation" || invalidationPlan.invalidationMode !== "family_mismatch" || invalidationPlan.lifecycleEvent !== "REGIME_INVALIDATION") {
    throw new Error(`managed recovery invalidation planning regressed: ${JSON.stringify(invalidationPlan)}`);
  }

  const timeoutPlan = coordinator.resolve({
    architectState: null,
    decision: {
      action: "hold",
      confidence: 0.5,
      reason: ["hold_recovery"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (price - position.entryPrice) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: {
      hit: false
    },
    minHoldMs: 15_000,
    position: createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: 1_000,
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 0
    }),
    tick: createTick({
      timestamp: 61_000
    })
  });
  if (!timeoutPlan.exitNow || timeoutPlan.exitMechanism !== "recovery" || timeoutPlan.lifecycleEvent !== "RECOVERY_TIMEOUT" || !timeoutPlan.reason.includes("time_exhaustion_exit")) {
    throw new Error(`managed recovery timeout planning regressed: ${JSON.stringify(timeoutPlan)}`);
  }

  const unconfirmedPlan = coordinator.resolve({
    decision: {
      action: "sell",
      confidence: 0.9,
      reason: ["exit_signal"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (price - position.entryPrice) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 1_000,
      quantity: 1,
      strategyId: "emaCross"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 1
    }),
    tick: createTick({
      price: 100.2,
      timestamp: 20_000
    })
  });
  if (unconfirmedPlan.exitNow || unconfirmedPlan.reason.includes("exit_confirmed_2ticks")) {
    throw new Error(`confirmation-tick-sensitive path regressed before threshold: ${JSON.stringify(unconfirmedPlan)}`);
  }

  const confirmedPlan = coordinator.resolve({
    decision: {
      action: "sell",
      confidence: 0.9,
      reason: ["exit_signal"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (price - position.entryPrice) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 1_000,
      quantity: 1,
      strategyId: "emaCross"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      price: 100.2,
      timestamp: 20_000
    })
  });
  if (!confirmedPlan.exitNow || !confirmedPlan.reason.includes("exit_confirmed_2ticks")) {
    throw new Error(`confirmation-tick-sensitive path regressed at threshold: ${JSON.stringify(confirmedPlan)}`);
  }

  const deferredRsiPlan = coordinator.resolve({
    decision: {
      action: "sell",
      confidence: 0.9,
      reason: ["rsi_exit_threshold_hit"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics() {
      return { netPnl: 0.01 };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 1_000,
      quantity: 1,
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      price: 100.2,
      timestamp: 20_000
    })
  });
  if (deferredRsiPlan.exitNow || deferredRsiPlan.transition !== "managed_recovery" || !deferredRsiPlan.nextPosition || deferredRsiPlan.lifecycleEvent !== "RSI_EXIT_HIT" || !deferredRsiPlan.reason.includes("rsi_exit_deferred")) {
    throw new Error(`rsi deferred exit planning regressed: ${JSON.stringify(deferredRsiPlan)}`);
  }

  const confirmedRsiPlan = coordinator.resolve({
    decision: {
      action: "sell",
      confidence: 0.9,
      reason: ["rsi_exit_threshold_hit"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics() {
      return { netPnl: 0.05 };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 1_000,
      quantity: 1,
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      price: 100.2,
      timestamp: 20_000
    })
  });
  if (!confirmedRsiPlan.exitNow || confirmedRsiPlan.transition !== undefined || confirmedRsiPlan.lifecycleEvent !== "RSI_EXIT_HIT" || confirmedRsiPlan.exitMechanism !== "qualification" || !confirmedRsiPlan.reason.includes("rsi_exit_confirmed") || !confirmedRsiPlan.reason.includes("exit_confirmed_2ticks")) {
    throw new Error(`rsi confirmed exit planning regressed: ${JSON.stringify(confirmedRsiPlan)}`);
  }

  const shapedReasons = buildExitReason(["rsi_exit_threshold_hit", "emergency_stop", "managed_recovery_rsi_ignored", "reversion_price_target_hit"], "rsi_exit_confirmed", 2);
  if (shapedReasons.includes("rsi_exit_threshold_hit") || shapedReasons.includes("emergency_stop") || shapedReasons.includes("managed_recovery_rsi_ignored") || !shapedReasons.includes("rsi_exit_confirmed") || !shapedReasons.includes("exit_confirmed_2ticks") || !shapedReasons.includes("reversion_price_target_hit")) {
    throw new Error(`exit reason shaping parity regressed: ${JSON.stringify(shapedReasons)}`);
  }
}

module.exports = {
  runExitDecisionCoordinatorTests
};
