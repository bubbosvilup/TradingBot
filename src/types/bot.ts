// Module responsibility: bot configuration and runtime lifecycle contracts.

export type BotStatus = "idle" | "running" | "paused" | "stopped";
export type RiskProfile = "low" | "medium" | "high";

export interface BotConfig {
  id: string;
  symbol: string;
  strategy: string;
  enabled: boolean;
  riskProfile: RiskProfile;
  allowedStrategies?: string[];
  initialBalanceUsdt?: number;
}

export interface BotRuntimeState {
  botId: string;
  symbol: string;
  activeStrategyId: string;
  status: BotStatus;
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
  cooldownUntil: number | null;
  entrySignalStreak: number;
  exitSignalStreak: number;
  lossStreak: number;
  realizedPnl: number;
  availableBalanceUsdt: number;
}
