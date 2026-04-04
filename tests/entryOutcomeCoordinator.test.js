"use strict";

const { EntryOutcomeCoordinator } = require("../src/roles/entryOutcomeCoordinator.ts");

function createArchitectState(overrides = {}) {
  return {
    actionableFamily: "trend_following",
    architect: {
      decisionStrength: 0.16,
      marketRegime: "trend",
      recommendedFamily: "trend_following",
      signalAgreement: 0.72
    },
    architectAgeMs: 1000,
    architectStale: false,
    blockReason: null,
    currentFamily: "trend_following",
    entryMaturityThreshold: 0.5,
    familyMatch: true,
    publisher: {},
    ready: true,
    staleThresholdMs: 90000,
    usable: true,
    ...overrides
  };
}

function createCoordinator() {
  return new EntryOutcomeCoordinator({
    symbol: "BTC/USDT"
  });
}

async function runEntryOutcomeCoordinatorTests() {
  const coordinator = createCoordinator();
  const architectState = createArchitectState();
  const common = {
    architectState,
    context: {
      strategyId: "emaCross"
    },
    contextSnapshot: {
      symbol: "BTC/USDT"
    },
    decision: {
      action: "buy",
      confidence: 0.93,
      reason: ["buy_signal"]
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
    profile: {
      entryDebounceTicks: 2
    },
    riskGate: {
      allowed: true,
      reason: "allowed"
    },
    signalState: {
      availableBalanceUsdt: 1000
    },
    state: {
      availableBalanceUsdt: 1000
    },
    strategyId: "emaCross",
    tick: {
      price: 101,
      source: "mock",
      symbol: "BTC/USDT",
      timestamp: 2_000
    }
  };

  const skipped = coordinator.buildSkippedOutcome({
    ...common,
    quantity: 0,
    skipReason: "quantity_non_positive"
  });
  if (skipped.entryEvaluated.outcome !== "skipped" || skipped.entryEvaluated.skipReason !== "quantity_non_positive" || skipped.lastNonCooldownBlockReason !== null) {
    throw new Error(`skipped entry outcomes should preserve quantity_non_positive semantics and clear block state: ${JSON.stringify(skipped)}`);
  }

  const blocked = coordinator.buildFinalGateBlockedOutcome({
    ...common,
    blockReason: "post_loss_architect_latch",
    diagnostics: {
      blockReason: "post_loss_architect_latch",
      expectedGrossEdgePct: 0.01,
      expectedNetEdgePct: 0.008
    },
    quantity: 1
  });
  if (blocked.entryBlockedReason !== "post_loss_architect_latch" || blocked.gateLog?.message !== "entry_gate_blocked" || blocked.lastNonCooldownBlockReason !== "post_loss_architect_latch") {
    throw new Error(`final gate latch blocks should preserve blocked outcome coordination: ${JSON.stringify(blocked)}`);
  }

  const opened = coordinator.buildOpenedOutcome({
    ...common,
    diagnostics: {
      blockReason: "allowed",
      expectedGrossEdgePct: 0.01,
      expectedNetEdgePct: 0.008
    },
    openedAt: 2_500,
    openedQuantity: 0.5,
    publishedArchitect: architectState.architect,
    statePatch: {
      availableBalanceUsdt: 949.5,
      entrySignalStreak: 0,
      exitSignalStreak: 0,
      lastExecutionAt: 2_500,
      lastTradeAt: 2_600
    }
  });
  if (opened.gateLog?.message !== "entry_gate_allowed" || opened.entryEvaluated.outcome !== "opened" || opened.entryOpenedMetadata?.publishedRegime !== "trend" || opened.compactBuyMetadata?.quantity !== 0.5 || opened.recordExecutionAt !== 2500 || opened.lastNonCooldownBlockReason !== null) {
    throw new Error(`opened entry outcomes should preserve allowed/opened logger handoff semantics: ${JSON.stringify(opened)}`);
  }
}

module.exports = {
  runEntryOutcomeCoordinatorTests
};
