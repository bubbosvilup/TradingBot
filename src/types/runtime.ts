// Module responsibility: minimal shared runtime dependency contracts for CommonJS-driven TS files.

import type { ArchitectAssessment, ArchitectPublisherState, RecommendedFamily } from "./architect.ts";
import type { BotConfig, BotRuntimeState, RiskProfile } from "./bot.ts";
import type { ContextSnapshot } from "./context.ts";
import type { MarketTick } from "./market.ts";
import type { PerformanceSnapshot } from "./performance.ts";
import type { IndicatorSnapshot, Strategy, StrategyDecision } from "./strategy.ts";
import type { ClosedTradeRecord, PositionRecord } from "./trade.ts";

export interface LoggerLike {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  bot?(config: BotConfig, message: string, metadata?: Record<string, unknown>): void;
  child?(name?: string): LoggerLike;
}

export interface RiskProfileSettings {
  cooldownMs: number;
  emergencyStopPct: number;
  entryDebounceTicks: number;
  exitConfirmationTicks: number;
  maxDrawdownPct: number;
  maxLossStreak: number;
  minHoldMs: number;
  positionPct: number;
  reentryCooldownMs: number;
}

export interface TradeConstraints {
  minNotionalUsdt: number;
  minQuantity: number;
}

export interface ExecutionOpenParams {
  botId: string;
  confidence: number;
  price: number;
  quantity: number;
  reason: string[];
  strategyId: string;
  symbol: string;
}

export interface ExecutionCloseParams {
  botId: string;
  lifecycleEvent?: unknown;
  lifecycleState?: unknown;
  price: number;
  reason: string[];
}

export interface StrategySwitchPlan {
  nextStrategyId: string;
  reason: string;
  targetFamily: RecommendedFamily;
}

export interface BotStateStoreLike {
  registerBot(config: BotConfig): void;
  getBotState(botId: string): BotRuntimeState | null;
  updateBotState(botId: string, patch: Partial<BotRuntimeState>): void;
  getPosition(botId: string): PositionRecord | null;
  setPosition(botId: string, position: PositionRecord | null): void;
  getPerformance(botId: string): PerformanceSnapshot | null;
  setPerformance(botId: string, performance: PerformanceSnapshot): void;
  getRecentPrices(symbol: string, limit?: number): number[];
  getContextSnapshot(symbol: string): ContextSnapshot | null;
  getArchitectPublishedAssessment(symbol: string): ArchitectAssessment | null;
  getArchitectPublisherState(symbol: string): ArchitectPublisherState | null;
  recordBotEvaluation(botId: string, symbol: string, evaluatedAt: number): void;
  recordExecution(botId: string, symbol: string, executedAt: number): void;
}

export interface MarketStreamLike {
  subscribe(symbol: string, handler: (tick: MarketTick) => void): () => void;
}

export interface IndicatorEngineLike {
  createSnapshot(prices: number[]): IndicatorSnapshot;
}

export interface ExecutionEngineLike {
  feeRate: number;
  calculateCloseEconomics(position: PositionRecord, exitPriceInput: number): {
    entryNotionalUsdt: number;
    entryPrice: number;
    exitNotionalUsdt: number;
    exitPrice: number;
    fees: number;
    grossPnl: number;
    netPnl: number;
    quantity: number;
  };
  getTradeConstraints?(): TradeConstraints;
  openLong(params: ExecutionOpenParams): PositionRecord | null;
  closePosition(params: ExecutionCloseParams): ClosedTradeRecord | null;
}

export interface RiskManagerLike {
  profiles: Record<RiskProfile, RiskProfileSettings>;
  getProfile(riskProfile: RiskProfile): RiskProfileSettings;
  getTradeConstraints(): TradeConstraints;
  canOpenTrade(params: {
    now: number;
    performance: PerformanceSnapshot;
    positionOpen: boolean;
    riskProfile: RiskProfile;
    state: BotRuntimeState;
  }): {
    allowed: boolean;
    reason: string;
  };
  calculatePositionSize(params: {
    balanceUsdt: number;
    confidence: number;
    latestPrice: number;
    performance: PerformanceSnapshot;
    riskProfile: RiskProfile;
    state: BotRuntimeState;
  }): {
    notionalUsdt: number;
    quantity: number;
  };
  onTradeClosed(params: {
    now: number;
    netPnl: number;
    riskProfile: RiskProfile;
    state: BotRuntimeState;
  }): {
    cooldownReason: string | null;
    cooldownUntil: number | null;
    lossStreak: number;
  };
}

export interface PerformanceMonitorLike {
  update(performance: PerformanceSnapshot, trade: ClosedTradeRecord): PerformanceSnapshot;
}

export interface RegimeDetectorLike {
  detect(prices: number[]): string;
}

export interface StrategyRegistryLike {
  createStrategy(strategyId: string): Strategy;
}

export interface StrategySwitcherLike {
  evaluate(params: {
    architect: ArchitectAssessment | null;
    availableStrategies: string[];
    botConfig: BotConfig;
    now: number;
    positionOpen?: boolean;
    state: BotRuntimeState;
  }): StrategySwitchPlan | null;
  getStrategyFamily(strategyId: string | null | undefined): RecommendedFamily | "other";
  getNonRoutableStrategies(strategyIds: string[]): string[];
}

export interface BotDeps {
  executionEngine: ExecutionEngineLike;
  indicatorEngine: IndicatorEngineLike;
  logger: LoggerLike;
  marketStream: MarketStreamLike;
  performanceMonitor: PerformanceMonitorLike;
  regimeDetector: RegimeDetectorLike;
  riskManager: RiskManagerLike;
  store: BotStateStoreLike;
  strategyRegistry: StrategyRegistryLike;
  strategySwitcher: StrategySwitcherLike;
}

export interface BotController {
  pause(reason: string): void;
  resume(): void;
  start(): void;
  stop(): void;
}

export type TradingDecisionLike = StrategyDecision;
