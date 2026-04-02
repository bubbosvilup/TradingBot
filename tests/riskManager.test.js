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
}

module.exports = {
  runRiskManagerTests
};
