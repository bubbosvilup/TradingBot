// Module responsibility: pure exit decision and exit-reason planning for TradingBot.

import type { ExitPolicy, InvalidationMode, ProtectionStopMode } from "../types/exitPolicy.ts";
import type { MarketTick } from "../types/market.ts";
import type { PositionRecord } from "../types/trade.ts";
import type { PositionExitMechanism } from "../types/positionLifecycle.ts";

const {
  getManagedRecoveryPolicy,
  isManagedRecoveryPosition,
  POSITION_LIFECYCLE_EVENTS
} = require("./positionLifecycleManager.ts");
const { resolveManagedRecoveryExit } = require("./managedRecoveryExitResolver.ts");

export type ExitPlan = {
  estimatedExitEconomics?: any;
  exitMechanism?: PositionExitMechanism | null;
  exitNow: boolean;
  invalidationLevel?: string | null;
  invalidationMode?: InvalidationMode | null;
  lifecycleEvent?: any;
  nextPosition?: PositionRecord | null;
  protectionMode?: string | null;
  reason: string[];
  transition?: "managed_recovery";
};

export interface ExitDecisionCoordinatorInstance {
  resolve(params: {
    architectState?: any;
    decision: any;
    emergencyStopPct: number;
    estimateExitEconomics: (position: PositionRecord, price: number) => any;
    exitConfirmationTicks: number;
    exitPolicy: ExitPolicy | null;
    managedRecoveryTarget?: any;
    minHoldMs: number;
    position: PositionRecord;
    resolveInvalidationLevel: (architectState: any, mode: InvalidationMode) => string | null;
    signalState: any;
    tick: MarketTick;
  }): ExitPlan;
}

function buildExitReason(decisionReasons: string[], primaryReason: string, confirmationTicks?: number | null) {
  const nextReasons = decisionReasons.filter((reason) =>
    reason !== "rsi_exit_threshold_hit"
    && reason !== "emergency_stop"
    && reason !== "managed_recovery_rsi_ignored"
  );
  if (!nextReasons.includes(primaryReason)) {
    nextReasons.push(primaryReason);
  }
  if (Number.isFinite(Number(confirmationTicks)) && Number(confirmationTicks) > 0) {
    nextReasons.push(`exit_confirmed_${Number(confirmationTicks)}ticks`);
  }
  return nextReasons;
}

function getDecisionReasons(decision: any) {
  return Array.isArray(decision?.reason) ? decision.reason : [];
}

function getProtectionStopMode(exitPolicy: ExitPolicy | null | undefined): ProtectionStopMode {
  const stopMode = String(exitPolicy?.protection?.stopMode || "fixed_pct");
  return stopMode === "structural_min" || stopMode === "atr_trailing" || stopMode === "fixed_pct"
    ? stopMode
    : "fixed_pct";
}

function getRsiExitFloorNetPnlUsdt(exitPolicy: ExitPolicy | null | undefined) {
  const estimatedCostMultiplier = Number(exitPolicy?.qualification?.estimatedCostMultiplier);
  const costMultiplier = Number.isFinite(estimatedCostMultiplier)
    ? estimatedCostMultiplier
    : 1;
  const minTickProfit = Number(exitPolicy?.qualification?.minTickProfit);
  const baseFloor = Number.isFinite(minTickProfit)
    ? minTickProfit
    : 0;
  const qualificationMode = String(exitPolicy?.qualification?.pnlExitFloorMode || "strict_net_positive");

  if (qualificationMode === "allow_small_loss_on_regime_risk") {
    return baseFloor * -1;
  }

  if (qualificationMode === "cost_buffered_positive") {
    return Math.max(baseFloor * costMultiplier, 0);
  }

  return Math.max(baseFloor, 0);
}

function matchesInvalidationMode(architectState: any, mode: InvalidationMode) {
  const blockReason = architectState?.blockReason || null;
  if (mode === "family_mismatch") {
    return architectState?.familyMatch === false;
  }
  if (mode === "low_maturity") {
    return blockReason === "architect_low_maturity" || blockReason === "architect_post_switch_low_maturity";
  }
  if (mode === "unclear") {
    return blockReason === "architect_unclear";
  }
  if (mode === "no_trade") {
    return blockReason === "architect_no_trade";
  }
  if (mode === "not_ready") {
    return blockReason === "architect_not_ready" || blockReason === "missing_published_architect";
  }
  if (mode === "stale") {
    return blockReason === "architect_stale";
  }
  if (mode === "symbol_mismatch") {
    return blockReason === "architect_symbol_mismatch";
  }
  if (mode === "regime_change") {
    return architectState?.usable && architectState?.familyMatch === false;
  }
  if (mode === "extreme_volatility") {
    return false;
  }
  return false;
}

function resolveMinRegimeInvalidationHoldMs(architectState: any) {
  const publishIntervalMs = Number(architectState?.publisher?.publishIntervalMs);
  return Math.max(
    Number.isFinite(publishIntervalMs) ? publishIntervalMs * 2 : 60_000,
    Number.isFinite(publishIntervalMs) ? publishIntervalMs : 30_000
  );
}

function invalidationRequiresGrace(mode: InvalidationMode) {
  return mode === "family_mismatch"
    || mode === "low_maturity"
    || mode === "stale"
    || mode === "not_ready";
}

function hasFamilyMismatchConfirmation(params: {
  architectState: any;
  position: PositionRecord;
  tickTimestamp: number;
}) {
  const publisher = params.architectState?.publisher || {};
  const challengerCount = Number(publisher.challengerCount);
  const challengerRequired = Number(publisher.challengerRequired);
  const hasChallengerConfirmation = Number.isFinite(challengerCount)
    && Number.isFinite(challengerRequired)
    && challengerRequired > 0
    && challengerCount >= challengerRequired;
  if (hasChallengerConfirmation) {
    return true;
  }

  const holdMs = params.tickTimestamp - params.position.openedAt;
  return holdMs >= resolveMinRegimeInvalidationHoldMs(params.architectState);
}

function resolveManagedRecoveryInvalidation(params: {
  architectState: any;
  decisionReasons: string[];
  exitPolicy: ExitPolicy | null;
  position: PositionRecord;
  resolveInvalidationLevel: (architectState: any, mode: InvalidationMode) => string | null;
  tickTimestamp: number;
}) {
  const modes = Array.isArray(params.exitPolicy?.invalidation?.modes)
    ? params.exitPolicy.invalidation.modes
    : [];
  const invalidationMode = modes.find((mode) => matchesInvalidationMode(params.architectState, mode)) || null;
  if (!invalidationMode) {
    return null;
  }
  const holdMs = params.tickTimestamp - params.position.openedAt;
  const minRegimeInvalidationHoldMs = resolveMinRegimeInvalidationHoldMs(params.architectState);
  if (invalidationRequiresGrace(invalidationMode) && holdMs < minRegimeInvalidationHoldMs) {
    return null;
  }
  if (invalidationMode === "family_mismatch" && !hasFamilyMismatchConfirmation({
    architectState: params.architectState,
    position: params.position,
    tickTimestamp: params.tickTimestamp
  })) {
    return null;
  }
  return {
    exitMechanism: "invalidation" as const,
    invalidationLevel: params.resolveInvalidationLevel(params.architectState, invalidationMode),
    invalidationMode,
    lifecycleEvent: POSITION_LIFECYCLE_EVENTS.REGIME_INVALIDATION,
    reason: buildExitReason(params.decisionReasons, "regime_invalidation_exit")
  };
}

function resolveProtectiveExit(params: {
  decisionReasons: string[];
  emergencyStopPct: number;
  exitPolicy: ExitPolicy | null;
  position: PositionRecord;
  price: number;
}) {
  if (getProtectionStopMode(params.exitPolicy) !== "fixed_pct") {
    return null;
  }
  const drawdownPct = params.position.entryPrice > 0 ? ((params.position.entryPrice - params.price) / params.position.entryPrice) : 0;
  if (!(drawdownPct >= params.emergencyStopPct)) {
    return null;
  }
  return {
    exitMechanism: "protection" as const,
    lifecycleEvent: POSITION_LIFECYCLE_EVENTS.PROTECTIVE_STOP_HIT,
    protectionMode: getProtectionStopMode(params.exitPolicy),
    reason: buildExitReason(params.decisionReasons, "protective_stop_exit")
  };
}

function resolveManagedRecoveryBreaker(decisionReasons: string[], confirmationTicks: number) {
  return {
    exitMechanism: "breaker" as const,
    exitNow: true,
    lifecycleEvent: POSITION_LIFECYCLE_EVENTS.MANAGED_RECOVERY_BREAKER_HIT,
    reason: buildExitReason(decisionReasons, "managed_recovery_breaker_exit", confirmationTicks)
  };
}

class ExitDecisionCoordinator implements ExitDecisionCoordinatorInstance {
  resolve(params: {
    architectState?: any;
    decision: any;
    emergencyStopPct: number;
    estimateExitEconomics: (position: PositionRecord, price: number) => any;
    exitConfirmationTicks: number;
    exitPolicy: ExitPolicy | null;
    managedRecoveryTarget?: any;
    minHoldMs: number;
    position: PositionRecord;
    resolveInvalidationLevel: (architectState: any, mode: InvalidationMode) => string | null;
    signalState: any;
    tick: MarketTick;
  }): ExitPlan {
    const holdMs = params.tick.timestamp - params.position.openedAt;
    const decisionReasons = getDecisionReasons(params.decision);
    const protectiveExit = resolveProtectiveExit({
      decisionReasons,
      emergencyStopPct: params.emergencyStopPct,
      exitPolicy: params.exitPolicy,
      position: params.position,
      price: params.tick.price
    });
    const inManagedRecovery = isManagedRecoveryPosition(params.position);
    const managedRecoveryPolicy = getManagedRecoveryPolicy(params.exitPolicy);
    const meanReversionPosition = params.position.strategyId === "rsiReversion";
    const priceTargetHit = inManagedRecovery
      ? Boolean(params.managedRecoveryTarget?.hit)
      : decisionReasons.includes("reversion_price_target_hit");
    const rsiExitThresholdHit = decisionReasons.includes("rsi_exit_threshold_hit");

    if (inManagedRecovery) {
      const managedRecoveryStartedAt = Number(params.position.managedRecoveryStartedAt || params.position.openedAt || 0);
      const invalidationExit = params.architectState
        ? resolveManagedRecoveryInvalidation({
          architectState: params.architectState,
          decisionReasons,
          exitPolicy: params.exitPolicy,
          position: params.position,
          resolveInvalidationLevel: params.resolveInvalidationLevel,
          tickTimestamp: params.tick.timestamp
        })
        : null;
      return resolveManagedRecoveryExit({
        buildExitReason,
        decisionReasons,
        exitConfirmationTicks: params.exitConfirmationTicks,
        exitSignalStreak: params.signalState.exitSignalStreak,
        invalidationExit,
        managedRecoveryStartedAt,
        priceTargetHit,
        protectiveExit,
        rsiExitThresholdHit,
        tickTimestamp: params.tick.timestamp,
        timeoutMs: managedRecoveryPolicy.timeoutMs
      });
    }

    if (protectiveExit) {
      return {
        exitNow: true,
        ...protectiveExit
      };
    }

    if (holdMs < params.minHoldMs) {
      return {
        exitNow: false,
        reason: [...decisionReasons, `minimum_hold_${params.minHoldMs}ms`]
      };
    }

    if (params.decision.action === "sell" && params.signalState.exitSignalStreak >= params.exitConfirmationTicks) {
      if (meanReversionPosition && rsiExitThresholdHit) {
        const estimatedExitEconomics = params.estimateExitEconomics(params.position, params.tick.price);
        const exitFloorNetPnlUsdt = getRsiExitFloorNetPnlUsdt(params.exitPolicy);
        if (estimatedExitEconomics.netPnl < exitFloorNetPnlUsdt) {
          if (Number(params.signalState?.managedRecoveryConsecutiveCount || 0) >= managedRecoveryPolicy.maxConsecutiveEntries) {
            return {
              estimatedExitEconomics,
              ...resolveManagedRecoveryBreaker(decisionReasons, params.exitConfirmationTicks)
            };
          }
          return {
            estimatedExitEconomics,
            exitMechanism: "qualification" as const,
            exitNow: true,
            lifecycleEvent: POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT,
            reason: buildExitReason(decisionReasons, "rsi_exit_floor_failed", params.exitConfirmationTicks)
          };
        }

        return {
          exitMechanism: "qualification" as const,
          exitNow: true,
          lifecycleEvent: POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT,
          reason: buildExitReason(decisionReasons, "rsi_exit_confirmed", params.exitConfirmationTicks)
        };
      }

      return {
        exitMechanism: meanReversionPosition && priceTargetHit
          ? "recovery"
          : null,
        exitNow: true,
        lifecycleEvent: meanReversionPosition && priceTargetHit
          ? POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT
          : null,
        reason: meanReversionPosition && priceTargetHit
          ? buildExitReason(decisionReasons, "reversion_price_target_hit", params.exitConfirmationTicks)
          : [...decisionReasons, `exit_confirmed_${params.exitConfirmationTicks}ticks`]
      };
    }

    return {
      exitNow: false,
      reason: decisionReasons
    };
  }
}

module.exports = {
  ExitDecisionCoordinator,
  buildExitReason
};
