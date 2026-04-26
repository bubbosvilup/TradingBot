import type { BotRuntimeState } from "../types/bot.ts";
import type { MarketDataFreshnessState, PortfolioKillSwitchState } from "../types/runtime.ts";
import type { PositionRecord } from "../types/trade.ts";

const { createInvariantError } = require("../types/errors.ts");

export type PositionState = "flat" | "open_active" | "open_managed_recovery" | "exiting";
export type BotLifecycleView = "idle" | "running" | "paused" | "stopped";
export type EntryGuardState =
  | "open_allowed"
  | "cooldown_block"
  | "post_loss_latch_block"
  | "manual_pause_block"
  | "kill_switch_block"
  | "market_data_block"
  | "drawdown_block"
  | "strategy_error_block";

function derivePositionState(position: PositionRecord | null | undefined): PositionState {
  if (!position) return "flat";
  if (position.lifecycleState === "EXITING") return "exiting";
  if (position.lifecycleMode === "managed_recovery") return "open_managed_recovery";
  return "open_active";
}

function deriveBotLifecycleView(botState: Pick<BotRuntimeState, "status"> | null | undefined): BotLifecycleView {
  const status = botState?.status;
  if (status === "paused" || status === "stopped" || status === "idle") return status;
  return "running";
}

function assertValidPositionState(position: PositionRecord | null | undefined): PositionState {
  const state = derivePositionState(position);
  const managedRecoveryStartedAt = position?.managedRecoveryStartedAt;
  if (
    state === "open_managed_recovery"
    && (managedRecoveryStartedAt === null || managedRecoveryStartedAt === undefined || !Number.isFinite(Number(managedRecoveryStartedAt)))
  ) {
    throw createInvariantError(
      "managed_recovery_started_at_missing",
      "Managed recovery position requires managedRecoveryStartedAt",
      {
        botId: position?.botId,
        positionId: position?.id,
        symbol: position?.symbol
      }
    );
  }
  return state;
}

function assertValidBotLifecycleView(botState: Pick<BotRuntimeState, "botId" | "pausedReason" | "status">): BotLifecycleView {
  const view = deriveBotLifecycleView(botState);
  if (view === "paused" && !botState.pausedReason) {
    throw createInvariantError(
      "paused_reason_missing",
      "Paused bot requires pausedReason",
      {
        botId: botState.botId,
        status: botState.status
      }
    );
  }
  if (view !== "paused" && botState.pausedReason) {
    throw createInvariantError(
      "paused_reason_without_paused_status",
      "Non-paused bot must not preserve pausedReason",
      {
        botId: botState.botId,
        pausedReason: botState.pausedReason,
        status: botState.status
      }
    );
  }
  return view;
}

function deriveEntryGuardState(params: {
  botState: Pick<BotRuntimeState, "cooldownUntil" | "lastDecisionReasons" | "pausedReason" | "postLossArchitectLatchActive" | "status">;
  marketDataFreshness?: Pick<MarketDataFreshnessState, "status"> | null;
  now: number;
  portfolioKillSwitch?: Pick<PortfolioKillSwitchState, "blockingEntries"> | null;
}): EntryGuardState {
  const lifecycle = deriveBotLifecycleView(params.botState);
  const pausedReason = params.botState.pausedReason || null;
  if (lifecycle === "paused" && pausedReason === "max_drawdown_reached") return "drawdown_block";
  if (lifecycle === "paused") return "manual_pause_block";
  if (params.portfolioKillSwitch?.blockingEntries) return "kill_switch_block";
  if (params.marketDataFreshness && params.marketDataFreshness.status !== "fresh") return "market_data_block";
  if (params.botState.postLossArchitectLatchActive) return "post_loss_latch_block";
  if (Number(params.botState.cooldownUntil || 0) > Number(params.now)) return "cooldown_block";
  if (Array.isArray(params.botState.lastDecisionReasons) && params.botState.lastDecisionReasons.includes("strategy_error")) {
    return "strategy_error_block";
  }
  return "open_allowed";
}

module.exports = {
  assertValidBotLifecycleView,
  assertValidPositionState,
  deriveBotLifecycleView,
  deriveEntryGuardState,
  derivePositionState
};
