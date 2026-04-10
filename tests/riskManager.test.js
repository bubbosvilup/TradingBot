"use strict";

const { RiskManager } = require("../src/roles/riskManager.ts");

function runRiskManagerTests() {
  const riskManager = new RiskManager();
  const baseState = {
    availableBalanceUsdt: 1000,
    cooldownReason: null,
    cooldownUntil: null,
    entrySignalStreak: 0,
    exitSignalStreak: 0,
    lastDecision: "hold",
    lastDecisionConfidence: 0,
    lastDecisionReasons: [],
    lastEvaluationAt: null,
    lastExecutionAt: null,
    lastTickAt: null,
    lastTradeAt: null,
    lossStreak: 2,
    pausedReason: null,
    realizedPnl: 0,
    status: "running"
  };

  const lossResult = riskManager.onTradeClosed({
    netPnl: -0.25,
    now: 1_000_000,
    riskProfile: "medium",
    state: baseState
  });
  if (lossResult.lossStreak !== 3) {
    throw new Error(`negative netPnl should increment loss streak: ${lossResult.lossStreak}`);
  }
  if (lossResult.cooldownReason !== "loss_cooldown") {
    throw new Error(`negative netPnl should trigger loss_cooldown: ${lossResult.cooldownReason}`);
  }

  const smallWinResult = riskManager.onTradeClosed({
    netPnl: 0.05,
    now: 1_000_000,
    riskProfile: "medium",
    state: baseState
  });
  if (smallWinResult.lossStreak !== 2) {
    throw new Error(`small positive netPnl should preserve loss streak until the win is meaningful: ${smallWinResult.lossStreak}`);
  }
  if (smallWinResult.cooldownReason !== "post_exit_reentry_guard") {
    throw new Error(`small positive netPnl should still use post_exit_reentry_guard: ${smallWinResult.cooldownReason}`);
  }

  const meaningfulWinResult = riskManager.onTradeClosed({
    netPnl: 0.1,
    now: 1_000_000,
    riskProfile: "medium",
    state: baseState
  });
  if (meaningfulWinResult.lossStreak !== 0) {
    throw new Error(`meaningful positive netPnl should reset loss streak: ${meaningfulWinResult.lossStreak}`);
  }
  if (meaningfulWinResult.cooldownReason !== "post_exit_reentry_guard") {
    throw new Error(`meaningful win should keep non-loss cooldown semantics: ${meaningfulWinResult.cooldownReason}`);
  }

  const presetProfile = riskManager.getProfile("medium");
  if (presetProfile.positionPct !== 0.16 || presetProfile.cooldownMs !== 75_000 || presetProfile.emergencyStopPct !== 0.01 || presetProfile.reentryCooldownMs !== 15_000 || presetProfile.exitConfirmationTicks !== 2 || presetProfile.minHoldMs !== 15_000) {
    throw new Error(`preset-only behavior should remain unchanged: ${JSON.stringify(presetProfile)}`);
  }

  const overriddenProfile = riskManager.getProfile("medium", {
    cooldownMs: 90_000,
    emergencyStopPct: 0.013,
    exitConfirmationTicks: 4,
    minHoldMs: 22_000,
    positionPct: 0.2,
    postExitReentryGuardMs: 12_000
  });
  if (overriddenProfile.positionPct !== 0.2
    || overriddenProfile.cooldownMs !== 90_000
    || overriddenProfile.emergencyStopPct !== 0.013
    || overriddenProfile.reentryCooldownMs !== 12_000
    || overriddenProfile.exitConfirmationTicks !== 4
    || overriddenProfile.minHoldMs !== 22_000) {
    throw new Error(`partial overrides should change only targeted fields: ${JSON.stringify(overriddenProfile)}`);
  }
  if (overriddenProfile.entryDebounceTicks !== presetProfile.entryDebounceTicks || overriddenProfile.maxDrawdownPct !== presetProfile.maxDrawdownPct || overriddenProfile.maxLossStreak !== presetProfile.maxLossStreak) {
    throw new Error(`partial overrides should preserve untargeted preset fields: ${JSON.stringify(overriddenProfile)}`);
  }

  const overriddenLossResult = riskManager.onTradeClosed({
    netPnl: -0.25,
    now: 1_000_000,
    riskProfile: "medium",
    riskOverrides: {
      cooldownMs: 90_000,
      postExitReentryGuardMs: 12_000
    },
    state: baseState
  });
  if (overriddenLossResult.cooldownUntil !== 1_090_000) {
    throw new Error(`loss cooldown should use overridden cooldownMs when provided: ${overriddenLossResult.cooldownUntil}`);
  }

  const portfolioBlocked = riskManager.canOpenTrade({
    now: 1_000_000,
    performance: {
      drawdown: 0
    },
    portfolioKillSwitch: {
      availableBalanceUsdt: 940,
      blockingEntries: true,
      currentEquityUsdt: 940,
      drawdownPct: 6,
      enabled: true,
      initialEquityUsdt: 1000,
      maxDrawdownPct: 5,
      mode: "block_entries_only",
      openPositionCount: 0,
      openPositionMarkNotionalUsdt: 0,
      peakEquityUsdt: 1000,
      reason: "portfolio_max_drawdown_reached",
      realizedPnl: -60,
      triggered: true,
      triggeredAt: 999_000,
      unrealizedPnl: 0,
      updatedAt: 1_000_000
    },
    positionOpen: false,
    riskProfile: "medium",
    state: baseState
  });
  if (portfolioBlocked.allowed || portfolioBlocked.reason !== "portfolio_kill_switch_active") {
    throw new Error(`portfolio kill switch should override per-bot entry readiness: ${JSON.stringify(portfolioBlocked)}`);
  }

  const drawdownBlocked = riskManager.canOpenTrade({
    now: 1_000_000,
    performance: {
      drawdown: 6
    },
    positionOpen: false,
    riskProfile: "medium",
    state: baseState
  });
  if (drawdownBlocked.allowed || drawdownBlocked.reason !== "max_drawdown_reached") {
    throw new Error(`per-bot drawdown gating should stay distinguishable from the shared portfolio kill switch: ${JSON.stringify(drawdownBlocked)}`);
  }
}

module.exports = {
  runRiskManagerTests
};
