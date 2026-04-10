// Module responsibility: drawdown, cooldown, position sizing and overtrading constraints.

import type { RiskOverrides, RiskProfile, BotRuntimeState } from "../types/bot.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { PortfolioKillSwitchState, RiskProfileSettings } from "../types/runtime.ts";

const { clamp } = require("../utils/math.ts");

class RiskManager {
  profiles: Record<RiskProfile, RiskProfileSettings>;
  minTradeNotionalUsdt: number;
  minTradeQuantity: number;
  lossStreakResetWinUsdt: number;

  constructor() {
    this.profiles = {
      high: { cooldownMs: 45_000, emergencyStopPct: 0.012, entryDebounceTicks: 2, exitConfirmationTicks: 2, maxDrawdownPct: 8, maxLossStreak: 5, minHoldMs: 10_000, positionPct: 0.22, reentryCooldownMs: 10_000 },
      low: { cooldownMs: 120_000, emergencyStopPct: 0.008, entryDebounceTicks: 3, exitConfirmationTicks: 3, maxDrawdownPct: 4, maxLossStreak: 3, minHoldMs: 20_000, positionPct: 0.1, reentryCooldownMs: 20_000 },
      medium: { cooldownMs: 75_000, emergencyStopPct: 0.01, entryDebounceTicks: 2, exitConfirmationTicks: 2, maxDrawdownPct: 6, maxLossStreak: 4, minHoldMs: 15_000, positionPct: 0.16, reentryCooldownMs: 15_000 }
    };
    this.minTradeNotionalUsdt = 25;
    this.minTradeQuantity = 1e-6;
    // Require a small but real net win before clearing consecutive-loss memory.
    // This avoids dust wins or near-flat closes resetting the streak too easily.
    this.lossStreakResetWinUsdt = 0.1;
  }

  getProfile(riskProfile: RiskProfile, riskOverrides: RiskOverrides | null = null) {
    const profile = this.profiles[riskProfile];
    if (!riskOverrides) {
      return profile;
    }
    return {
      ...profile,
      cooldownMs: Number.isFinite(Number(riskOverrides.cooldownMs))
        ? Number(riskOverrides.cooldownMs)
        : profile.cooldownMs,
      emergencyStopPct: Number.isFinite(Number(riskOverrides.emergencyStopPct))
        ? Number(riskOverrides.emergencyStopPct)
        : profile.emergencyStopPct,
      exitConfirmationTicks: Number.isFinite(Number(riskOverrides.exitConfirmationTicks))
        ? Number(riskOverrides.exitConfirmationTicks)
        : profile.exitConfirmationTicks,
      minHoldMs: Number.isFinite(Number(riskOverrides.minHoldMs))
        ? Number(riskOverrides.minHoldMs)
        : profile.minHoldMs,
      positionPct: Number.isFinite(Number(riskOverrides.positionPct))
        ? Number(riskOverrides.positionPct)
        : profile.positionPct,
      reentryCooldownMs: Number.isFinite(Number(riskOverrides.postExitReentryGuardMs))
        ? Number(riskOverrides.postExitReentryGuardMs)
        : profile.reentryCooldownMs
    };
  }

  getTradeConstraints() {
    return {
      minNotionalUsdt: this.minTradeNotionalUsdt,
      minQuantity: this.minTradeQuantity
    };
  }

  canOpenTrade(params: {
    now: number;
    performance: PerformanceSnapshot;
    portfolioKillSwitch?: PortfolioKillSwitchState | null;
    positionOpen: boolean;
    riskProfile: RiskProfile;
    riskOverrides?: RiskOverrides | null;
    state: BotRuntimeState;
  }) {
    const profile = this.getProfile(params.riskProfile, params.riskOverrides || null);
    if (params.positionOpen) {
      return { allowed: false, reason: "position_already_open" };
    }
    if (params.state.cooldownUntil && params.state.cooldownUntil > params.now) {
      return { allowed: false, reason: params.state.cooldownReason || "cooldown_active" };
    }
    if (params.portfolioKillSwitch?.blockingEntries) {
      return { allowed: false, reason: "portfolio_kill_switch_active" };
    }
    if (params.performance.drawdown >= profile.maxDrawdownPct) {
      return { allowed: false, reason: "max_drawdown_reached" };
    }
    if (params.state.lossStreak >= profile.maxLossStreak) {
      return { allowed: false, reason: "loss_streak_limit" };
    }
    return { allowed: true, reason: "ok" };
  }

  calculatePositionSize(params: {
    balanceUsdt: number;
    confidence: number;
    latestPrice: number;
    performance: PerformanceSnapshot;
    riskProfile: RiskProfile;
    riskOverrides?: RiskOverrides | null;
    state: BotRuntimeState;
  }) {
    const profile = this.getProfile(params.riskProfile, params.riskOverrides || null);
    const confidenceBoost = clamp(params.confidence, 0.15, 1);
    const drawdownPenalty = clamp(1 - (params.performance.drawdown / Math.max(profile.maxDrawdownPct, 0.1)), 0.35, 1);
    const lossPenalty = clamp(1 - (params.state.lossStreak * 0.12), 0.4, 1);
    const notionalUsdt = params.balanceUsdt * profile.positionPct * confidenceBoost * drawdownPenalty * lossPenalty;
    const quantity = params.latestPrice > 0 ? notionalUsdt / params.latestPrice : 0;
    return {
      notionalUsdt,
      quantity
    };
  }

  onTradeClosed(params: { now: number; netPnl: number; riskProfile: RiskProfile; riskOverrides?: RiskOverrides | null; state: BotRuntimeState }) {
    const profile = this.getProfile(params.riskProfile, params.riskOverrides || null);
    const loss = params.netPnl <= 0;
    const meaningfulWin = params.netPnl >= this.lossStreakResetWinUsdt;
    const reentryCooldownUntil = params.now + profile.reentryCooldownMs;
    const lossCooldownUntil = params.now + profile.cooldownMs;
    return {
      cooldownReason: loss ? "loss_cooldown" : "post_exit_reentry_guard",
      cooldownUntil: loss ? Math.max(lossCooldownUntil, reentryCooldownUntil) : reentryCooldownUntil,
      lossStreak: loss
        ? params.state.lossStreak + 1
        : meaningfulWin
          ? 0
          : params.state.lossStreak
    };
  }
}

module.exports = {
  RiskManager
};
