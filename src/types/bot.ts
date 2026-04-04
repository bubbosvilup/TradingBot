// Module responsibility: bot configuration and runtime lifecycle contracts.

import type { RecommendedFamily } from "./architect.ts";

export type ArchitectSyncStatus = "pending" | "synced" | "waiting_flat";

export type BotStatus = "idle" | "running" | "paused" | "stopped";
export type RiskProfile = "low" | "medium" | "high";
export interface RiskOverrides {
  positionPct?: number;
  cooldownMs?: number;
  emergencyStopPct?: number;
  postExitReentryGuardMs?: number;
  exitConfirmationTicks?: number;
  minHoldMs?: number;
}

export interface BotConfig {
  id: string;
  symbol: string;
  strategy: string;
  enabled: boolean;
  riskProfile: RiskProfile;
  riskOverrides?: RiskOverrides;
  allowedStrategies?: string[];
  initialBalanceUsdt?: number;
  maxArchitectStateAgeMs?: number;
  postLossArchitectLatchPublishesRequired?: number;
}

export interface BotRuntimeState {
  botId: string;
  symbol: string;
  activeStrategyId: string;
  status: BotStatus;
  // When set to "max_drawdown_reached", the bot remains manually paused until an explicit resume.
  pausedReason: string | null;
  cooldownReason: string | null;
  lastDecision: "buy" | "sell" | "hold";
  lastDecisionConfidence: number;
  lastDecisionReasons: string[];
  lastTickAt: number | null;
  lastEvaluationAt: number | null;
  lastExecutionAt: number | null;
  lastTradeAt: number | null;
  lastStrategySwitchAt: number | null;
  architectSyncStatus: ArchitectSyncStatus;
  cooldownUntil: number | null;
  entrySignalStreak: number;
  exitSignalStreak: number;
  entryEvaluationsCount: number;
  entryEvaluationLogsCount: number;
  entryBlockedCount: number;
  entrySkippedCount: number;
  entryOpenedCount: number;
  lossStreak: number;
  postLossArchitectLatchActive: boolean;
  postLossArchitectLatchActivatedAt: number | null;
  postLossArchitectLatchFreshPublishCount: number;
  postLossArchitectLatchLastCountedPublishedAt: number | null;
  postLossArchitectLatchStrategyId: string | null;
  realizedPnl: number;
  availableBalanceUsdt: number;
}
