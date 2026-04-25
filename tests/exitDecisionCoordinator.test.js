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
    side: "long",
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
      pnlExitFloorMode: "strict_net_positive",
      rsiThresholdExit: true
    },
    recovery: {
      maxConsecutiveEntries: 2,
      priceTargetExit: true,
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

  const shortProtectivePlan = coordinator.resolve({
    decision: {
      action: "hold",
      confidence: 0.5,
      reason: ["hold_short"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (position.entryPrice - price) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 19_500,
      side: "short"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 0
    }),
    tick: createTick({
      price: 101.2
    })
  });
  if (!shortProtectivePlan.exitNow || shortProtectivePlan.exitMechanism !== "protection" || !shortProtectivePlan.reason.includes("protective_stop_exit")) {
    throw new Error(`short protective exit should trigger when price rises against the short: ${JSON.stringify(shortProtectivePlan)}`);
  }

  const exchangeSkewHoldPlan = coordinator.resolve({
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
      openedAt: 1_000_000,
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
      timestamp: 1_100_000
    }),
    runtimeTimestamp: 1_005_000
  });
  if (exchangeSkewHoldPlan.exitNow || !exchangeSkewHoldPlan.reason.includes("minimum_hold_15000ms")) {
    throw new Error(`future exchange timestamp must not bypass runtime min-hold timing: ${JSON.stringify(exchangeSkewHoldPlan)}`);
  }

  const invalidationPlan = coordinator.resolve({
    architectState: {
      blockReason: null,
      familyMatch: false,
      publisher: {
        challengerCount: 0,
        challengerRequired: 2,
        publishIntervalMs: 30_000
      },
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
      hit: false
    },
    minHoldMs: 15_000,
    position: createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: 10_000,
      openedAt: -50_000,
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

  const gracePlan = coordinator.resolve({
    architectState: {
      blockReason: null,
      familyMatch: false,
      publisher: {
        challengerCount: 0,
        challengerRequired: 2,
        publishIntervalMs: 30_000
      },
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
      hit: false
    },
    minHoldMs: 15_000,
    position: createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryExitFloorNetPnlUsdt: 0.05,
      managedRecoveryStartedAt: 10_000,
      openedAt: 5_000,
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return "family_mismatch";
    },
    signalState: createSignalState({
      exitSignalStreak: 0
    }),
    tick: createTick({
      timestamp: 20_000
    })
  });
  if (gracePlan.exitNow || gracePlan.reason.includes("regime_invalidation_exit")) {
    throw new Error(`post-entry grace should suppress early managed recovery invalidation: ${JSON.stringify(gracePlan)}`);
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

  const exchangeSkewRecoveryPlan = coordinator.resolve({
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
      managedRecoveryStartedAt: 1_000_000,
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 0
    }),
    tick: createTick({
      timestamp: 1_100_000
    }),
    runtimeTimestamp: 1_030_000
  });
  if (exchangeSkewRecoveryPlan.exitNow || exchangeSkewRecoveryPlan.reason.includes("time_exhaustion_exit")) {
    throw new Error(`future exchange timestamp must not trigger managed recovery timeout early: ${JSON.stringify(exchangeSkewRecoveryPlan)}`);
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

  const confirmedShortCoverPlan = coordinator.resolve({
    decision: {
      action: "buy",
      confidence: 0.9,
      reason: ["cover_signal"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (position.entryPrice - price) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy,
    managedRecoveryTarget: null,
    minHoldMs: 15_000,
    position: createPosition({
      openedAt: 1_000,
      quantity: 1,
      side: "short",
      strategyId: "emaCross"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      price: 99.2,
      timestamp: 20_000
    })
  });
  if (!confirmedShortCoverPlan.exitNow || !confirmedShortCoverPlan.reason.includes("exit_confirmed_2ticks")) {
    throw new Error(`short cover signal should use buy as the exit action: ${JSON.stringify(confirmedShortCoverPlan)}`);
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
  if (!deferredRsiPlan.exitNow || deferredRsiPlan.transition !== undefined || deferredRsiPlan.nextPosition || deferredRsiPlan.lifecycleEvent !== "RSI_EXIT_HIT" || !deferredRsiPlan.reason.includes("rsi_exit_floor_failed")) {
    throw new Error(`rsi floor-failed exit should skip managed recovery: ${JSON.stringify(deferredRsiPlan)}`);
  }

  const breakerPlan = coordinator.resolve({
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
      exitSignalStreak: 2,
      managedRecoveryConsecutiveCount: 2
    }),
    tick: createTick({
      price: 100.2,
      timestamp: 20_000
    })
  });
  if (!breakerPlan.exitNow || breakerPlan.exitMechanism !== "breaker" || breakerPlan.lifecycleEvent !== "MANAGED_RECOVERY_BREAKER_HIT" || breakerPlan.transition !== undefined || !breakerPlan.reason.includes("managed_recovery_breaker_exit")) {
    throw new Error(`managed recovery breaker planning regressed: ${JSON.stringify(breakerPlan)}`);
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

  const nonCapabilityPolicyPlan = coordinator.resolve({
    decision: {
      action: "sell",
      confidence: 0.9,
      reason: ["rsi_exit_threshold_hit", "reversion_price_target_hit"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics() {
      return { netPnl: 0.01 };
    },
    exitConfirmationTicks: 2,
    exitPolicy: {
      ...exitPolicy,
      qualification: {
        ...exitPolicy.qualification,
        rsiThresholdExit: false
      },
      recovery: {
        ...exitPolicy.recovery,
        priceTargetExit: false
      }
    },
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
  if (nonCapabilityPolicyPlan.exitNow
    || nonCapabilityPolicyPlan.exitMechanism !== undefined
    || nonCapabilityPolicyPlan.lifecycleEvent !== undefined
    || nonCapabilityPolicyPlan.reason.includes("rsi_exit_threshold_hit")
    || nonCapabilityPolicyPlan.reason.includes("reversion_price_target_hit")
    || nonCapabilityPolicyPlan.reason.includes("exit_confirmed_2ticks")) {
    throw new Error(`disabled RSI/price-target capabilities should hard-block those exits: ${JSON.stringify(nonCapabilityPolicyPlan)}`);
  }

  const shortManagedRecoveryTargetPlan = coordinator.resolve({
    architectState: {
      blockReason: null,
      familyMatch: false,
      publisher: {
        challengerCount: 0,
        challengerRequired: 2,
        publishIntervalMs: 30_000
      },
      usable: true
    },
    decision: {
      action: "hold",
      confidence: 0.5,
      reason: ["reversion_price_target_hit"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (position.entryPrice - price) * position.quantity };
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
      managedRecoveryStartedAt: 10_000,
      openedAt: -50_000,
      side: "short",
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return "family_mismatch";
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      price: 98,
      timestamp: 20_000
    })
  });
  if (!shortManagedRecoveryTargetPlan.exitNow || shortManagedRecoveryTargetPlan.exitMechanism !== "recovery" || shortManagedRecoveryTargetPlan.lifecycleEvent !== "PRICE_TARGET_HIT") {
    throw new Error(`short managed recovery target should beat invalidation after confirmation: ${JSON.stringify(shortManagedRecoveryTargetPlan)}`);
  }

  const managedRecoveryTargetDisabledPlan = coordinator.resolve({
    architectState: null,
    decision: {
      action: "hold",
      confidence: 0.5,
      reason: ["reversion_price_target_hit"]
    },
    emergencyStopPct: 0.01,
    estimateExitEconomics(position, price) {
      return { netPnl: (position.entryPrice - price) * position.quantity };
    },
    exitConfirmationTicks: 2,
    exitPolicy: {
      ...exitPolicy,
      recovery: {
        ...exitPolicy.recovery,
        priceTargetExit: false
      }
    },
    managedRecoveryTarget: {
      hit: true
    },
    minHoldMs: 15_000,
    position: createPosition({
      lifecycleMode: "managed_recovery",
      managedRecoveryDeferredReason: "rsi_exit_deferred",
      managedRecoveryStartedAt: 10_000,
      openedAt: -50_000,
      side: "short",
      strategyId: "rsiReversion"
    }),
    resolveInvalidationLevel() {
      return null;
    },
    signalState: createSignalState({
      exitSignalStreak: 2
    }),
    tick: createTick({
      price: 98,
      timestamp: 20_000
    })
  });
  if (managedRecoveryTargetDisabledPlan.exitNow || managedRecoveryTargetDisabledPlan.reason.includes("reversion_price_target_hit")) {
    throw new Error(`managed recovery target should be ignored when priceTargetExit is disabled: ${JSON.stringify(managedRecoveryTargetDisabledPlan)}`);
  }

  const shapedReasons = buildExitReason(["rsi_exit_threshold_hit", "emergency_stop", "managed_recovery_rsi_ignored", "reversion_price_target_hit"], "rsi_exit_confirmed", 2);
  if (shapedReasons.includes("rsi_exit_threshold_hit") || shapedReasons.includes("emergency_stop") || shapedReasons.includes("managed_recovery_rsi_ignored") || !shapedReasons.includes("rsi_exit_confirmed") || !shapedReasons.includes("exit_confirmed_2ticks") || !shapedReasons.includes("reversion_price_target_hit")) {
    throw new Error(`exit reason shaping parity regressed: ${JSON.stringify(shapedReasons)}`);
  }
}

module.exports = {
  runExitDecisionCoordinatorTests
};
