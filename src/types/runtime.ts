import type { ArchitectAssessment, ArchitectPublisherState, RecommendedFamily } from "./architect.ts";
import type { BotConfig, BotRuntimeState, RiskOverrides, RiskProfile } from "./bot.ts";
import type { ContextSnapshot } from "./context.ts";
import type { MarketTick } from "./market.ts";
import type { PerformanceSnapshot } from "./performance.ts";
import type { IndicatorSnapshot, Strategy, StrategyDecision } from "./strategy.ts";
import type { ClosedTradeRecord, PositionRecord, TradeDirection } from "./trade.ts";
import type { Clock } from "../core/clock.ts";

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
  meaningfulWinUsdt: number;
  minHoldMs: number;
  positionPct: number;
  reentryCooldownMs: number;
  winReentryCooldownMs: number | null;
  volatilitySizing: {
    enabled: boolean;
    minPenalty: number;
    multiplier: number;
  };
}

export type PortfolioKillSwitchMode = "block_entries_only";

export interface PortfolioKillSwitchConfig {
  enabled: boolean;
  maxDrawdownPct: number;
  mode: PortfolioKillSwitchMode;
}

export interface PortfolioKillSwitchState extends PortfolioKillSwitchConfig {
  availableBalanceUsdt: number;
  blockingEntries: boolean;
  currentEquityUsdt: number;
  drawdownPct: number;
  initialEquityUsdt: number;
  openPositionCount: number;
  openPositionMarkNotionalUsdt: number;
  peakEquityUsdt: number;
  reason: string | null;
  realizedPnl: number;
  triggered: boolean;
  triggeredAt: number | null;
  unrealizedPnl: number;
  updatedAt: number | null;
}

export type MarketDataFreshnessStatus = "fresh" | "degraded" | "stale";

export interface MarketDataFreshnessState {
  lastTickTimestamp?: number;
  receivedAt?: number;
  reason?: string;
  status: MarketDataFreshnessStatus;
  updatedAt: number;
}

export interface SymbolStateRetentionSnapshot {
  lastCleanupAt: number | null;
  lastEvictedAt: number | null;
  lastEvictedSymbols: string[];
  protectedSymbols: string[];
  staleAfterMs: number;
  staleCandidateSymbols: string[];
  totalEvictedSymbols: number;
  trackedSymbols: string[];
}

export interface RuntimeTuningConfig {
  architectPublishIntervalMs?: number;
  architectWarmupMs?: number;
  postLossLatchMaxMs?: number;
  postLossLatchMinFreshPublications?: number;
  symbolStateRetentionMs?: number;
}

export interface TradeConstraints {
  minNotionalUsdt: number;
  minQuantity: number;
}

export interface ExecutionOpenParams {
  botId: string;
  confidence: number;
  edgeDiagnostics?: {
    expectedGrossEdgePctAtEntry?: number | null;
    expectedNetEdgePctAtEntry?: number | null;
    requiredEdgePctAtEntry?: number | null;
    expectedEntryPrice?: number | null;
    expectedExitPrice?: number | null;
    entryArchitectRegime?: string | null;
  };
  price: number;
  quantity: number;
  reason: string[];
  strategyId: string;
  symbol: string;
}

export interface ExecutionOpenPositionParams extends ExecutionOpenParams {
  side?: TradeDirection;
}

export interface ExecutionCloseParams {
  botId: string;
  expectedExitPrice?: number | null;
  lifecycleEvent?: unknown;
  lifecycleState?: unknown;
  price: number;
  reason: string[];
  timestamp?: number;
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
  getPortfolioKillSwitchState?(options?: {
    feeRate?: number;
    now?: number;
  }): PortfolioKillSwitchState;
  commitPortfolioKillSwitchState?(options?: {
    feeRate?: number;
    now?: number;
  }): PortfolioKillSwitchState;
  getMarketDataFreshness?(symbol: string, options?: {
    now?: number;
    staleAfterMs?: number;
  }): MarketDataFreshnessState;
  recordBotEvaluation(botId: string, symbol: string, evaluatedAt: number): void;
  recordBotTickStart?(botId: string, symbol: string, startedAt: number): void;
  recordExecution(
    botId: string,
    symbol: string,
    executedAt: number,
    options?: { skipBotStateWrite?: boolean }
  ): void;
  recordTickLatencySample?(symbol: string, sample: Record<string, number | null | undefined>, recordedAt?: number): void;
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
    side: TradeDirection;
  };
  calculateUnrealizedEconomics?(position: PositionRecord, markPriceInput: number): {
    entryNotionalUsdt: number;
    entryPrice: number;
    fees: number;
    grossPnl: number;
    markNotionalUsdt: number;
    markPrice: number;
    netPnl: number;
    quantity: number;
    side: TradeDirection;
  };
  getTradeConstraints?(): TradeConstraints;
  openLong(params: ExecutionOpenParams): PositionRecord | null;
  openShort?(params: ExecutionOpenParams): PositionRecord | null;
  openPosition?(params: ExecutionOpenPositionParams): PositionRecord | null;
  closePosition(params: ExecutionCloseParams): ClosedTradeRecord | null;
}

export interface RiskManagerLike {
  profiles: Record<RiskProfile, RiskProfileSettings>;
  getProfile(riskProfile: RiskProfile, riskOverrides?: RiskOverrides | null): RiskProfileSettings;
  getTradeConstraints(): TradeConstraints;
  canOpenTrade(params: {
    now: number;
    performance: PerformanceSnapshot;
    portfolioKillSwitch?: PortfolioKillSwitchState | null;
    positionOpen: boolean;
    riskProfile: RiskProfile;
    riskOverrides?: RiskOverrides | null;
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
    riskOverrides?: RiskOverrides | null;
    state: BotRuntimeState;
    volatilityRisk?: unknown;
  }): {
    notionalUsdt: number;
    quantity: number;
  };
  onTradeClosed(params: {
    now: number;
    netPnl: number;
    riskProfile: RiskProfile;
    riskOverrides?: RiskOverrides | null;
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
    now: number;
    positionOpen?: boolean;
    state: BotRuntimeState;
  }): StrategySwitchPlan | null;
  getStrategyFamily(strategyId: string | null | undefined): RecommendedFamily | "other";
  getNonRoutableStrategies(strategyIds: string[]): string[];
}

export interface BotDeps {
  clock?: Clock;
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
