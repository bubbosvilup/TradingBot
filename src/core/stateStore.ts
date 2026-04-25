import type { BotConfig, BotRuntimeState } from "../types/bot.ts";
import type { ArchitectAssessment, ArchitectPublisherState } from "../types/architect.ts";
import type { Clock } from "./clock.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { SystemEvent } from "../types/event.ts";
import type { MarketKline, MarketTick, PriceSnapshot } from "../types/market.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "../types/trade.ts";
import type {
  MarketDataFreshnessState,
  PortfolioKillSwitchMode,
  PortfolioKillSwitchConfig,
  PortfolioKillSwitchState,
  SymbolStateRetentionSnapshot
} from "../types/runtime.ts";

const { calculateDirectionalGrossPnl, normalizeTradeSide } = require("../utils/tradeSide.ts");
const { VALID_PORTFOLIO_KILL_SWITCH_MODES } = require("../types/portfolioKillSwitch.ts");
const { resolveClock } = require("./clock.ts");

interface PerformanceHistoryPoint {
  time: number;
  pnl: number;
  drawdown: number;
  winRate: number;
  profitFactor: number;
  tradesCount: number;
}

interface PipelineSnapshot {
  symbol: string;
  lastExchangeTimestamp: number | null;
  lastWsReceivedAt: number | null;
  lastStateUpdatedAt: number | null;
  lastBotStartedAt: number | null;
  lastBotEvaluatedAt: number | null;
  lastExecutionAt: number | null;
  source: "mock" | "ws" | "rest" | null;
  exchangeToReceiveMs: number | null;
  restRoundtripMs: number | null;
  receiveToStateMs: number | null;
  stateToBotMs: number | null;
  botDecisionMs: number | null;
  botToExecutionMs: number | null;
  executionMs: number | null;
  totalPipelineMs: number | null;
  tickLatency: TickLatencySummary | null;
}

interface EdgeDiagnosticsAggregate {
  blockedOpportunityCount: number;
  blockedOpportunityEdgeSampleCount: number;
  closedTradeCount: number;
  edgeErrorPctSum: number;
  expectedNetEdgePctSum: number;
  overestimatedCount: number;
  realizedNetPnlPctSum: number;
  slippageImpactPctSum: number;
  slippageImpactSampleCount: number;
  underestimatedCount: number;
  blockedOpportunityExpectedNetEdgePctSum: number;
}

interface BlockedEdgeOpportunity {
  botId: string;
  symbol: string;
  strategyId: string;
  regime: string | null;
  reason: string;
  expectedGrossEdgePct: number | null;
  expectedNetEdgePct: number | null;
  requiredEdgePct: number | null;
  timestamp: number;
}

interface EdgeDiagnosticsGroupSummary {
  avgExpectedEdge: number | null;
  avgRealizedEdge: number | null;
  avgError: number | null;
  overestimationRate: number | null;
  underestimationRate: number | null;
  blockedOpportunityCount: number;
  blockedOpportunityAvgEdge: number | null;
  avgSlippageImpactPct: number | null;
  closedTradeCount: number;
}

interface EdgeDiagnosticsSummary extends EdgeDiagnosticsGroupSummary {
  byStrategy: Record<string, EdgeDiagnosticsGroupSummary>;
  byRegime: Record<string, EdgeDiagnosticsGroupSummary>;
}

type TickLatencyStageKey =
  | "flushDelayMs"
  | "stateUpdateMs"
  | "publishFanoutMs"
  | "totalTickPipelineMs"
  | "contextObserveMs"
  | "contextBuildMs"
  | "architectObserveMs"
  | "architectAssessMs"
  | "architectPublishMs"
  | "botTickMs"
  | "botPrepareMs"
  | "botArchitectPhaseMs"
  | "botDecisionMs"
  | "botActionMs";

interface TickLatencyStageAggregate {
  count: number;
  lastMs: number | null;
  maxMs: number | null;
  totalMs: number;
}

interface TickLatencyAccumulator {
  lastRecordedAt: number | null;
  recentTotalSamples: number[];
  stages: Record<TickLatencyStageKey, TickLatencyStageAggregate>;
}

interface TickLatencySummary {
  lastRecordedAt: number | null;
  recentWorstTotalMs: number | null;
  sampleCount: number;
  average: Record<TickLatencyStageKey, number | null>;
  last: Record<TickLatencyStageKey, number | null>;
  max: Record<TickLatencyStageKey, number | null>;
}

const TICK_LATENCY_STAGES: TickLatencyStageKey[] = [
  "flushDelayMs",
  "stateUpdateMs",
  "publishFanoutMs",
  "totalTickPipelineMs",
  "contextObserveMs",
  "contextBuildMs",
  "architectObserveMs",
  "architectAssessMs",
  "architectPublishMs",
  "botTickMs",
  "botPrepareMs",
  "botArchitectPhaseMs",
  "botDecisionMs",
  "botActionMs"
];

const RECENT_TICK_LATENCY_SAMPLE_SIZE = 20;

interface WsConnectionSnapshot {
  connectionId: string;
  status: string;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastMessageAt: number | null;
  reconnectAttempt: number;
  lastReason: string | null;
  fallbackActive: boolean;
  mode: "live";
}

interface SymbolStateCleanupState {
  lastCleanupAt: number | null;
  lastEvictedAt: number | null;
  lastEvictedSymbols: string[];
  totalEvictedSymbols: number;
}

const DEFAULT_SYMBOL_STATE_RETENTION_MS = 30 * 60 * 1000;

function isPortfolioKillSwitchMode(value: unknown): value is PortfolioKillSwitchMode {
  return VALID_PORTFOLIO_KILL_SWITCH_MODES.has(value as PortfolioKillSwitchMode);
}

function normalizePortfolioKillSwitchMode(value: unknown): PortfolioKillSwitchMode {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "block_entries_only";
  }
  if (isPortfolioKillSwitchMode(value)) {
    return value;
  }
  throw new Error(`Unsupported portfolio kill switch mode "${String(value)}"`);
}

class StateStore {
  botConfigs: Map<string, BotConfig>;
  botStates: Map<string, BotRuntimeState>;
  prices: Map<string, PriceSnapshot>;
  priceHistoryRevisionBySymbol: Map<string, number>;
  klines: Map<string, Map<string, MarketKline[]>>;
  orders: Map<string, OrderRecord[]>;
  closedTrades: Map<string, ClosedTradeRecord[]>;
  positions: Map<string, PositionRecord | null>;
  performance: Map<string, PerformanceSnapshot>;
  performanceHistory: Map<string, PerformanceHistoryPoint[]>;
  wsConnections: Map<string, WsConnectionSnapshot>;
  pipelineBySymbol: Map<string, PipelineSnapshot>;
  tickLatencyBySymbol: Map<string, TickLatencyAccumulator>;
  marketDataFreshnessBySymbol: Map<string, MarketDataFreshnessState>;
  edgeDiagnostics: {
    overall: EdgeDiagnosticsAggregate;
    byStrategy: Map<string, EdgeDiagnosticsAggregate>;
    byRegime: Map<string, EdgeDiagnosticsAggregate>;
  };
  blockedEdgeOpportunities: BlockedEdgeOpportunity[];
  contextBySymbol: Map<string, ContextSnapshot>;
  architectObservedBySymbol: Map<string, ArchitectAssessment>;
  architectPublishedBySymbol: Map<string, ArchitectAssessment>;
  architectPublisherBySymbol: Map<string, ArchitectPublisherState>;
  symbolLastTouchedAtBySymbol: Map<string, number>;
  symbolStateCleanupState: SymbolStateCleanupState;
  symbolStateRetentionMs: number;
  events: SystemEvent[];
  portfolioKillSwitchConfig: PortfolioKillSwitchConfig;
  portfolioKillSwitchState: PortfolioKillSwitchState;
  maxEvents: number;
  maxPriceHistory: number;
  maxKlineHistory: number;
  maxPerformanceHistory: number;
  maxOrdersHistory: number;
  maxClosedTradesHistory: number;
  maxBlockedEdgeOpportunities: number;
  clock: Clock;

  constructor(options: {
    clock?: Clock;
    maxEvents?: number;
    maxPriceHistory?: number;
    maxKlineHistory?: number;
    maxPerformanceHistory?: number;
    maxOrdersHistory?: number;
    maxClosedTradesHistory?: number;
    symbolStateRetentionMs?: number;
  } = {}) {
    this.clock = resolveClock(options.clock);
    this.botConfigs = new Map();
    this.botStates = new Map();
    this.prices = new Map();
    this.priceHistoryRevisionBySymbol = new Map();
    this.klines = new Map();
    this.orders = new Map();
    this.closedTrades = new Map();
    this.positions = new Map();
    this.performance = new Map();
    this.performanceHistory = new Map();
    this.wsConnections = new Map();
    this.pipelineBySymbol = new Map();
    this.tickLatencyBySymbol = new Map();
    this.marketDataFreshnessBySymbol = new Map();
    this.edgeDiagnostics = {
      overall: this.createEdgeDiagnosticsAggregate(),
      byStrategy: new Map(),
      byRegime: new Map()
    };
    this.blockedEdgeOpportunities = [];
    this.contextBySymbol = new Map();
    this.architectObservedBySymbol = new Map();
    this.architectPublishedBySymbol = new Map();
    this.architectPublisherBySymbol = new Map();
    this.symbolLastTouchedAtBySymbol = new Map();
    this.symbolStateCleanupState = {
      lastCleanupAt: null,
      lastEvictedAt: null,
      lastEvictedSymbols: [],
      totalEvictedSymbols: 0
    };
    this.symbolStateRetentionMs = this.normalizeSymbolStateRetentionMs(options.symbolStateRetentionMs);
    this.events = [];
    this.portfolioKillSwitchConfig = {
      enabled: false,
      maxDrawdownPct: 0,
      mode: "block_entries_only"
    };
    this.portfolioKillSwitchState = {
      availableBalanceUsdt: 0,
      blockingEntries: false,
      currentEquityUsdt: 0,
      drawdownPct: 0,
      enabled: false,
      initialEquityUsdt: 0,
      maxDrawdownPct: 0,
      mode: "block_entries_only",
      openPositionCount: 0,
      openPositionMarkNotionalUsdt: 0,
      peakEquityUsdt: 0,
      reason: null,
      realizedPnl: 0,
      triggered: false,
      triggeredAt: null,
      unrealizedPnl: 0,
      updatedAt: null
    };
    this.maxEvents = Math.max(options.maxEvents || 250, 50);
    this.maxPriceHistory = Math.max(options.maxPriceHistory || 300, 50);
    this.maxKlineHistory = Math.max(options.maxKlineHistory || 300, 50);
    this.maxPerformanceHistory = Math.max(options.maxPerformanceHistory || 200, 20);
    this.maxOrdersHistory = Math.max(options.maxOrdersHistory || 500, 50);
    this.maxClosedTradesHistory = Math.max(options.maxClosedTradesHistory || 500, 50);
    this.maxBlockedEdgeOpportunities = this.maxClosedTradesHistory;
  }

  now() {
    return this.clock.now();
  }

  normalizePausedReason(value: unknown) {
    const normalized = String(value ?? "").trim();
    return normalized ? normalized : null;
  }

  enforceBotLifecycleStateInvariants(
    current: BotRuntimeState | null | undefined,
    candidate: BotRuntimeState,
    options: { invalidPausedFallbackStatus?: BotRuntimeState["status"] } = {}
  ): BotRuntimeState {
    const normalizedPausedReason = this.normalizePausedReason(candidate?.pausedReason);
    if (candidate.status === "paused") {
      if (normalizedPausedReason) {
        return {
          ...candidate,
          pausedReason: normalizedPausedReason
        };
      }
      const fallbackStatus = options.invalidPausedFallbackStatus
        || (current?.status && current.status !== "paused" ? current.status : "idle");
      return {
        ...candidate,
        pausedReason: null,
        status: fallbackStatus
      };
    }
    return {
      ...candidate,
      pausedReason: null
    };
  }

  createDefaultBotRuntimeState(config: BotConfig, initialBalance: number): BotRuntimeState {
    return {
      activeStrategyId: config.strategy,
      availableBalanceUsdt: initialBalance,
      botId: config.id,
      cooldownReason: null,
      cooldownUntil: null,
      entryBlockedCount: 0,
      entryEvaluationsCount: 0,
      entryEvaluationLogsCount: 0,
      entryOpenedCount: 0,
      entrySignalStreak: 0,
      entrySkippedCount: 0,
      exitSignalStreak: 0,
      lastDecision: "hold",
      lastDecisionConfidence: 0,
      lastDecisionReasons: [],
      architectSyncStatus: "pending",
      lastEvaluationAt: null,
      lastExecutionAt: null,
      lastStrategySwitchAt: null,
      lastTickAt: null,
      lastTradeAt: null,
      lossStreak: 0,
      managedRecoveryConsecutiveCount: 0,
      pausedReason: null,
      postLossArchitectLatchActive: false,
      postLossArchitectLatchActivatedAt: null,
      postLossArchitectLatchFreshPublishCount: 0,
      postLossArchitectLatchLastCountedPublishedAt: null,
      postLossArchitectLatchStartedAt: null,
      postLossArchitectLatchStrategyId: null,
      postLossArchitectLatchTimedOutAt: null,
      realizedPnl: 0,
      status: config.enabled ? "idle" : "stopped",
      symbol: config.symbol
    };
  }

  registerBot(config: BotConfig) {
    const existingState = this.botStates.get(config.id) || null;
    const initialBalance = existingState?.availableBalanceUsdt ?? config.initialBalanceUsdt ?? 1000;
    this.botConfigs.set(config.id, config);
    const defaultNewBotState = this.createDefaultBotRuntimeState(config, initialBalance);
    const preservedRuntimeState = existingState ? { ...existingState } : {};
    const configOwnedState: Partial<BotRuntimeState> = {
      activeStrategyId: config.strategy,
      availableBalanceUsdt: initialBalance,
      botId: config.id,
      status: !config.enabled
        ? "stopped"
        : existingState?.status === "paused" && existingState?.pausedReason
          ? "paused"
          : "idle",
      symbol: config.symbol
    };
    const nextState = this.enforceBotLifecycleStateInvariants(existingState, {
      ...defaultNewBotState,
      ...preservedRuntimeState,
      ...configOwnedState
    }, {
      invalidPausedFallbackStatus: config.enabled ? "idle" : "stopped"
    });
    this.botStates.set(config.id, nextState);
    if (!this.orders.has(config.id)) {
      this.orders.set(config.id, []);
    }
    if (!this.closedTrades.has(config.id)) {
      this.closedTrades.set(config.id, []);
    }
    if (!this.positions.has(config.id)) {
      this.positions.set(config.id, null);
    }
    if (!this.performance.has(config.id)) {
      this.performance.set(config.id, {
        avgTradePnlUsdt: 0,
        botId: config.id,
        currentEquity: initialBalance,
        drawdown: 0,
        grossLoss: 0,
        grossProfit: 0,
        peakEquity: initialBalance,
        pnl: 0,
        profitFactor: 0,
        recentNetPnl: [],
        tradesCount: 0,
        winRate: 0,
        wins: 0,
        losses: 0
      });
    }
    if (!this.performanceHistory.has(config.id)) {
      this.performanceHistory.set(config.id, [{
        drawdown: 0,
        pnl: 0,
        profitFactor: 0,
        time: this.now(),
        tradesCount: 0,
        winRate: 0
      }]);
    }
    if (!this.pipelineBySymbol.has(config.symbol)) {
      this.pipelineBySymbol.set(config.symbol, {
        botToExecutionMs: null,
        exchangeToReceiveMs: null,
        executionMs: null,
        lastBotEvaluatedAt: null,
        lastBotStartedAt: null,
        lastExchangeTimestamp: null,
        lastExecutionAt: null,
        lastStateUpdatedAt: null,
        lastWsReceivedAt: null,
        botDecisionMs: null,
        receiveToStateMs: null,
        restRoundtripMs: null,
        source: null,
        stateToBotMs: null,
        symbol: config.symbol,
        tickLatency: null,
        totalPipelineMs: null
      });
    }
    if (!this.marketDataFreshnessBySymbol.has(config.symbol)) {
      this.marketDataFreshnessBySymbol.set(config.symbol, {
        reason: "awaiting_first_tick",
        status: "stale",
        updatedAt: this.now()
      });
    }
    this.touchSymbol(config.symbol);
  }

  unregisterBot(botId: string) {
    const config = this.botConfigs.get(botId);
    if (!config) {
      return;
    }

    const symbol = config.symbol;
    this.botConfigs.delete(botId);
    this.botStates.delete(botId);
    this.orders.delete(botId);
    this.positions.delete(botId);
    this.performance.delete(botId);
    this.performanceHistory.delete(botId);
    this.closedTrades.delete(botId);

    if (this.hasRegisteredBotForSymbol(symbol)) {
      return;
    }

    this.deleteSymbolState(symbol);
  }

  updatePrice(tick: MarketTick) {
    const stateUpdatedAt = this.now();
    const normalizedTick: MarketTick = {
      ...tick,
      receivedAt: tick.receivedAt || stateUpdatedAt,
      stateUpdatedAt
    };
    const existing = this.prices.get(tick.symbol);
    const history = existing ? [...existing.history, normalizedTick] : [normalizedTick];
    const trimmedHistory = history.slice(-this.maxPriceHistory);
    this.prices.set(tick.symbol, {
      history: trimmedHistory,
      latestPrice: normalizedTick.price,
      symbol: normalizedTick.symbol,
      updatedAt: normalizedTick.timestamp
    });
    this.touchSymbol(tick.symbol, stateUpdatedAt);
    this.priceHistoryRevisionBySymbol.set(
      tick.symbol,
      (this.priceHistoryRevisionBySymbol.get(tick.symbol) || 0) + 1
    );
    this.recordPipelineFromTick(normalizedTick);
  }

  updateKline(kline: MarketKline) {
    const symbolMap = this.klines.get(kline.symbol) || new Map();
    const existing = symbolMap.get(kline.interval) || [];
    const normalizedKline = {
      ...kline,
      receivedAt: kline.receivedAt || this.now()
    };
    const nextHistory = [...existing, normalizedKline];
    symbolMap.set(kline.interval, nextHistory.slice(-this.maxKlineHistory));
    this.klines.set(kline.symbol, symbolMap);
    this.touchSymbol(kline.symbol, normalizedKline.receivedAt || this.now());
  }

  getLatestPrice(symbol: string): number | null {
    return this.prices.get(symbol)?.latestPrice ?? null;
  }

  getPriceSnapshot(symbol: string): PriceSnapshot | null {
    return this.prices.get(symbol) || null;
  }

  normalizeMarketDataFreshnessState(
    symbol: string,
    candidate: Partial<MarketDataFreshnessState> & Pick<MarketDataFreshnessState, "status">,
    current?: MarketDataFreshnessState | null
  ): MarketDataFreshnessState {
    const normalizedSymbol = String(symbol || "").trim();
    const previous = current || this.marketDataFreshnessBySymbol.get(normalizedSymbol) || null;
    const updatedAt = Number.isFinite(Number(candidate?.updatedAt))
      ? Number(candidate.updatedAt)
      : this.now();
    const lastTickTimestamp = Number.isFinite(Number(candidate?.lastTickTimestamp))
      ? Number(candidate.lastTickTimestamp)
      : Number.isFinite(Number(previous?.lastTickTimestamp))
        ? Number(previous?.lastTickTimestamp)
        : undefined;
    const receivedAt = Number.isFinite(Number(candidate?.receivedAt))
      ? Number(candidate.receivedAt)
      : Number.isFinite(Number(candidate?.updatedAt))
        ? updatedAt
        : Number.isFinite(Number(previous?.receivedAt))
        ? Number(previous?.receivedAt)
        : updatedAt;
    const normalizedReason = candidate?.reason === undefined
      ? (candidate.status === "fresh" ? undefined : previous?.reason)
      : String(candidate.reason || "").trim() || undefined;
    return {
      lastTickTimestamp,
      receivedAt,
      reason: normalizedReason,
      status: candidate.status,
      updatedAt
    };
  }

  setMarketDataFreshness(
    symbol: string,
    candidate: Partial<MarketDataFreshnessState> & Pick<MarketDataFreshnessState, "status">
  ) {
    const normalizedSymbol = String(symbol || "").trim();
    if (!normalizedSymbol) {
      return null;
    }
    const nextState = this.normalizeMarketDataFreshnessState(normalizedSymbol, candidate);
    this.marketDataFreshnessBySymbol.set(normalizedSymbol, nextState);
    this.touchSymbol(normalizedSymbol, nextState.updatedAt);
    return nextState;
  }

  getMarketDataFreshness(symbol: string, options: { now?: number; staleAfterMs?: number } = {}) {
    const normalizedSymbol = String(symbol || "").trim();
    const observedAt = Number.isFinite(Number(options.now)) ? Number(options.now) : this.now();
    const current = this.marketDataFreshnessBySymbol.get(normalizedSymbol) || null;
    const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) && Number(options.staleAfterMs) > 0
      ? Number(options.staleAfterMs)
      : null;
    if (!current) {
      return {
        reason: "awaiting_first_tick",
        status: "stale" as const,
        updatedAt: observedAt
      };
    }
    if (
      staleAfterMs !== null
      && Number.isFinite(Number(current.receivedAt ?? current.updatedAt))
      && Math.max(0, observedAt - Number(current.receivedAt ?? current.updatedAt)) >= staleAfterMs
    ) {
      return {
        ...current,
        reason: "market_data_stale",
        status: "stale",
        updatedAt: observedAt
      };
    }
    return current;
  }

  markMarketDataStaleIfExpired(
    symbols: string[],
    options: { now?: number; staleAfterMs?: number } = {}
  ) {
    const observedAt = Number.isFinite(Number(options.now)) ? Number(options.now) : this.now();
    const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) && Number(options.staleAfterMs) > 0
      ? Number(options.staleAfterMs)
      : null;
    const refreshedSymbols = [...new Set(symbols || [])]
      .map((symbol) => String(symbol || "").trim())
      .filter(Boolean);
    for (const symbol of refreshedSymbols) {
      const current = this.marketDataFreshnessBySymbol.get(symbol) || null;
      const lastObservedAt = Number.isFinite(Number(current?.receivedAt ?? current?.updatedAt))
        ? Number(current?.receivedAt ?? current?.updatedAt)
        : null;
      if (lastObservedAt === null) {
        this.setMarketDataFreshness(symbol, {
          reason: "awaiting_first_tick",
          status: "stale",
          updatedAt: observedAt
        });
        continue;
      }
      if (staleAfterMs !== null && Math.max(0, observedAt - lastObservedAt) >= staleAfterMs) {
        this.setMarketDataFreshness(symbol, {
          reason: "market_data_stale",
          status: "stale",
          updatedAt: observedAt
        });
      }
    }
  }

  getKlines(symbol: string, interval: string, limit: number = 120): MarketKline[] {
    return (this.klines.get(symbol)?.get(interval) || []).slice(-limit);
  }

  getRecentPrices(symbol: string, limit: number = 120): number[] {
    const history = this.prices.get(symbol)?.history || [];
    return history.slice(-limit).map((tick) => tick.price);
  }

  getPriceHistory(symbol: string, limit?: number): MarketTick[] {
    const history = this.prices.get(symbol)?.history || [];
    if (!Number.isFinite(limit as number) || !limit || limit <= 0) {
      return [...history];
    }
    return history.slice(-limit);
  }

  getPriceHistoryRevision(symbol: string): number {
    return this.priceHistoryRevisionBySymbol.get(symbol) || 0;
  }

  getPriceHistorySince(symbol: string, sinceTimestamp: number): MarketTick[] {
    const history = this.prices.get(symbol)?.history || [];
    return history.filter((tick) => Number(tick.timestamp) >= sinceTimestamp);
  }

  getBotState(botId: string): BotRuntimeState | null {
    return this.botStates.get(botId) || null;
  }

  updateBotState(botId: string, patch: Partial<BotRuntimeState>) {
    const current = this.botStates.get(botId);
    if (!current) return;
    this.botStates.set(botId, this.enforceBotLifecycleStateInvariants(current, {
      ...current,
      ...patch
    }));
  }

  getPosition(botId: string): PositionRecord | null {
    return this.positions.get(botId) || null;
  }

  setPosition(botId: string, position: PositionRecord | null) {
    this.positions.set(botId, position);
    if (position?.symbol) {
      this.touchSymbol(position.symbol, position.openedAt || this.now());
    }
  }

  appendOrder(botId: string, order: OrderRecord) {
    const orders = this.orders.get(botId) || [];
    this.orders.set(botId, [...orders, order].slice(-this.maxOrdersHistory));
  }

  createEdgeDiagnosticsAggregate(): EdgeDiagnosticsAggregate {
    return {
      blockedOpportunityCount: 0,
      blockedOpportunityEdgeSampleCount: 0,
      blockedOpportunityExpectedNetEdgePctSum: 0,
      closedTradeCount: 0,
      edgeErrorPctSum: 0,
      expectedNetEdgePctSum: 0,
      overestimatedCount: 0,
      realizedNetPnlPctSum: 0,
      slippageImpactPctSum: 0,
      slippageImpactSampleCount: 0,
      underestimatedCount: 0
    };
  }

  normalizeEdgeDiagnosticsNumber(value: unknown): number | null {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  getEdgeDiagnosticsAggregate(map: Map<string, EdgeDiagnosticsAggregate>, key: string) {
    const existing = map.get(key);
    if (existing) {
      return existing;
    }
    const created = this.createEdgeDiagnosticsAggregate();
    map.set(key, created);
    return created;
  }

  updateClosedTradeEdgeDiagnosticsAggregate(aggregate: EdgeDiagnosticsAggregate, trade: ClosedTradeRecord) {
    const expectedNetEdgePct = this.normalizeEdgeDiagnosticsNumber(trade.expectedNetEdgePctAtEntry);
    const realizedNetPnlPct = this.normalizeEdgeDiagnosticsNumber(trade.realizedNetPnlPct);
    const edgeErrorPct = this.normalizeEdgeDiagnosticsNumber(trade.edgeErrorPct);
    const slippageImpactPct = this.normalizeEdgeDiagnosticsNumber(trade.slippageImpactPct);
    if (expectedNetEdgePct === null || realizedNetPnlPct === null || edgeErrorPct === null) {
      return;
    }

    aggregate.closedTradeCount += 1;
    aggregate.expectedNetEdgePctSum += expectedNetEdgePct;
    aggregate.realizedNetPnlPctSum += realizedNetPnlPct;
    aggregate.edgeErrorPctSum += edgeErrorPct;
    if (expectedNetEdgePct > realizedNetPnlPct) {
      aggregate.overestimatedCount += 1;
    } else if (expectedNetEdgePct < realizedNetPnlPct) {
      aggregate.underestimatedCount += 1;
    }
    if (slippageImpactPct !== null) {
      aggregate.slippageImpactPctSum += slippageImpactPct;
      aggregate.slippageImpactSampleCount += 1;
    }
  }

  updateBlockedEdgeDiagnosticsAggregate(aggregate: EdgeDiagnosticsAggregate, opportunity: BlockedEdgeOpportunity) {
    aggregate.blockedOpportunityCount += 1;
    if (opportunity.expectedNetEdgePct !== null) {
      aggregate.blockedOpportunityExpectedNetEdgePctSum += opportunity.expectedNetEdgePct;
      aggregate.blockedOpportunityEdgeSampleCount += 1;
    }
  }

  recordClosedTradeEdgeDiagnostics(trade: ClosedTradeRecord) {
    if (this.normalizeEdgeDiagnosticsNumber(trade.expectedNetEdgePctAtEntry) === null
      || this.normalizeEdgeDiagnosticsNumber(trade.realizedNetPnlPct) === null
      || this.normalizeEdgeDiagnosticsNumber(trade.edgeErrorPct) === null) {
      return;
    }
    const strategyId = trade.strategyId || "unknown";
    const regime = trade.entryArchitectRegime || "unknown";
    this.updateClosedTradeEdgeDiagnosticsAggregate(this.edgeDiagnostics.overall, trade);
    this.updateClosedTradeEdgeDiagnosticsAggregate(this.getEdgeDiagnosticsAggregate(this.edgeDiagnostics.byStrategy, strategyId), trade);
    this.updateClosedTradeEdgeDiagnosticsAggregate(this.getEdgeDiagnosticsAggregate(this.edgeDiagnostics.byRegime, regime), trade);
  }

  recordBlockedOpportunityEdgeDiagnostics(params: {
    botId: string;
    symbol: string;
    strategyId: string;
    regime?: string | null;
    reason: string;
    expectedGrossEdgePct?: number | null;
    expectedNetEdgePct?: number | null;
    requiredEdgePct?: number | null;
    timestamp?: number | null;
  }) {
    const opportunity: BlockedEdgeOpportunity = {
      botId: params.botId,
      expectedGrossEdgePct: this.normalizeEdgeDiagnosticsNumber(params.expectedGrossEdgePct),
      expectedNetEdgePct: this.normalizeEdgeDiagnosticsNumber(params.expectedNetEdgePct),
      reason: params.reason,
      regime: params.regime || null,
      requiredEdgePct: this.normalizeEdgeDiagnosticsNumber(params.requiredEdgePct),
      strategyId: params.strategyId || "unknown",
      symbol: params.symbol,
      timestamp: Number.isFinite(Number(params.timestamp)) ? Number(params.timestamp) : this.now()
    };

    this.blockedEdgeOpportunities = [...this.blockedEdgeOpportunities, opportunity].slice(-this.maxBlockedEdgeOpportunities);
    this.updateBlockedEdgeDiagnosticsAggregate(this.edgeDiagnostics.overall, opportunity);
    this.updateBlockedEdgeDiagnosticsAggregate(this.getEdgeDiagnosticsAggregate(this.edgeDiagnostics.byStrategy, opportunity.strategyId), opportunity);
    this.updateBlockedEdgeDiagnosticsAggregate(this.getEdgeDiagnosticsAggregate(this.edgeDiagnostics.byRegime, opportunity.regime || "unknown"), opportunity);
  }

  summarizeEdgeDiagnosticsAggregate(aggregate: EdgeDiagnosticsAggregate): EdgeDiagnosticsGroupSummary {
    return {
      avgError: aggregate.closedTradeCount > 0 ? aggregate.edgeErrorPctSum / aggregate.closedTradeCount : null,
      avgExpectedEdge: aggregate.closedTradeCount > 0 ? aggregate.expectedNetEdgePctSum / aggregate.closedTradeCount : null,
      avgRealizedEdge: aggregate.closedTradeCount > 0 ? aggregate.realizedNetPnlPctSum / aggregate.closedTradeCount : null,
      avgSlippageImpactPct: aggregate.slippageImpactSampleCount > 0
        ? aggregate.slippageImpactPctSum / aggregate.slippageImpactSampleCount
        : null,
      blockedOpportunityAvgEdge: aggregate.blockedOpportunityEdgeSampleCount > 0
        ? aggregate.blockedOpportunityExpectedNetEdgePctSum / aggregate.blockedOpportunityEdgeSampleCount
        : null,
      blockedOpportunityCount: aggregate.blockedOpportunityCount,
      closedTradeCount: aggregate.closedTradeCount,
      overestimationRate: aggregate.closedTradeCount > 0 ? aggregate.overestimatedCount / aggregate.closedTradeCount : null,
      underestimationRate: aggregate.closedTradeCount > 0 ? aggregate.underestimatedCount / aggregate.closedTradeCount : null
    };
  }

  getEdgeDiagnosticsSummary(): EdgeDiagnosticsSummary {
    const summarizeMap = (map: Map<string, EdgeDiagnosticsAggregate>) => Object.fromEntries(
      Array.from(map.entries()).map(([key, aggregate]) => [key, this.summarizeEdgeDiagnosticsAggregate(aggregate)])
    );
    return {
      ...this.summarizeEdgeDiagnosticsAggregate(this.edgeDiagnostics.overall),
      byRegime: summarizeMap(this.edgeDiagnostics.byRegime),
      byStrategy: summarizeMap(this.edgeDiagnostics.byStrategy)
    };
  }

  getBlockedEdgeOpportunities(limit: number = 50): BlockedEdgeOpportunity[] {
    const normalizedLimit = Math.max(0, Math.floor(Number(limit) || 0));
    if (normalizedLimit <= 0) {
      return [...this.blockedEdgeOpportunities];
    }
    return this.blockedEdgeOpportunities.slice(-normalizedLimit);
  }

  appendClosedTrade(botId: string, trade: ClosedTradeRecord) {
    const trades = this.closedTrades.get(botId) || [];
    this.closedTrades.set(botId, [...trades, trade].slice(-this.maxClosedTradesHistory));
    this.recordClosedTradeEdgeDiagnostics(trade);
  }

  getClosedTrades(botId: string): ClosedTradeRecord[] {
    return this.closedTrades.get(botId) || [];
  }

  getOrders(botId: string): OrderRecord[] {
    return this.orders.get(botId) || [];
  }

  setPerformance(botId: string, performance: PerformanceSnapshot) {
    this.performance.set(botId, performance);
    const history = this.performanceHistory.get(botId) || [];
    this.performanceHistory.set(botId, [
      ...history,
      {
        drawdown: performance.drawdown,
        pnl: performance.pnl,
        profitFactor: performance.profitFactor,
        time: this.now(),
        tradesCount: performance.tradesCount,
        winRate: performance.winRate
      }
    ].slice(-this.maxPerformanceHistory));
  }

  getPerformance(botId: string): PerformanceSnapshot | null {
    return this.performance.get(botId) || null;
  }

  getPerformanceHistory(botId: string, limit: number = 120): PerformanceHistoryPoint[] {
    return (this.performanceHistory.get(botId) || []).slice(-limit);
  }

  updateWsConnection(connectionId: string, patch: Partial<WsConnectionSnapshot>) {
    const current = this.wsConnections.get(connectionId) || {
      connectionId,
      fallbackActive: false,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastMessageAt: null,
      lastReason: null,
      mode: "live",
      reconnectAttempt: 0,
      status: "idle"
    };
    const sanitizedPatch = Object.fromEntries(
      Object.entries(patch || {}).filter(([, value]) => value !== undefined)
    );
    this.wsConnections.set(connectionId, {
      ...current,
      ...sanitizedPatch,
      connectionId
    });
  }

  getWsConnections() {
    return Array.from(this.wsConnections.values());
  }

  recordBotEvaluation(botId: string, symbol: string, evaluatedAt: number) {
    this.updateBotState(botId, {
      lastEvaluationAt: evaluatedAt
    });
    const current = this.pipelineBySymbol.get(symbol) || this.createPipelineSnapshot(symbol);
    const next = {
      ...current,
      lastBotEvaluatedAt: evaluatedAt,
      botDecisionMs: current.lastBotStartedAt ? Math.max(0, evaluatedAt - current.lastBotStartedAt) : null,
      stateToBotMs: current.lastStateUpdatedAt
        ? Math.max(0, (current.lastBotStartedAt || evaluatedAt) - current.lastStateUpdatedAt)
        : null
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(symbol, next);
    this.touchSymbol(symbol, evaluatedAt);
  }

  recordBotTickStart(botId: string, symbol: string, startedAt: number) {
    const current = this.pipelineBySymbol.get(symbol) || this.createPipelineSnapshot(symbol);
    const next = {
      ...current,
      lastBotStartedAt: startedAt,
      stateToBotMs: current.lastStateUpdatedAt ? Math.max(0, startedAt - current.lastStateUpdatedAt) : null
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(symbol, next);
    this.touchSymbol(symbol, startedAt);
  }

  recordExecution(
    botId: string,
    symbol: string,
    executedAt: number,
    options?: { skipBotStateWrite?: boolean }
  ) {
    if (!options?.skipBotStateWrite) {
      this.updateBotState(botId, {
        lastExecutionAt: executedAt
      });
    }
    const current = this.pipelineBySymbol.get(symbol) || this.createPipelineSnapshot(symbol);
    const next = {
      ...current,
      botToExecutionMs: current.lastBotEvaluatedAt ? Math.max(0, executedAt - current.lastBotEvaluatedAt) : null,
      executionMs: current.lastBotEvaluatedAt ? Math.max(0, executedAt - current.lastBotEvaluatedAt) : null,
      lastExecutionAt: executedAt
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(symbol, next);
    this.touchSymbol(symbol, executedAt);
  }

  getPipelineSnapshot(symbol: string): PipelineSnapshot | null {
    return this.pipelineBySymbol.get(symbol) || null;
  }

  getAllPipelineSnapshots() {
    return Array.from(this.pipelineBySymbol.values());
  }

  recordTickLatencySample(
    symbol: string,
    sample: Partial<Record<TickLatencyStageKey, number | null | undefined>>,
    recordedAt: number = this.now()
  ) {
    const accumulator = this.tickLatencyBySymbol.get(symbol) || this.createTickLatencyAccumulator();
    let updated = false;

    for (const stage of TICK_LATENCY_STAGES) {
      const rawValue = sample?.[stage];
      if (rawValue === null || rawValue === undefined) {
        continue;
      }
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        continue;
      }

      updated = true;
      const roundedValue = this.roundLatencyMs(numericValue);
      const stageAccumulator = accumulator.stages[stage];
      stageAccumulator.count += 1;
      stageAccumulator.lastMs = roundedValue;
      stageAccumulator.maxMs = stageAccumulator.maxMs === null
        ? roundedValue
        : Math.max(stageAccumulator.maxMs, roundedValue);
      stageAccumulator.totalMs += roundedValue;

      if (stage === "totalTickPipelineMs") {
        accumulator.recentTotalSamples.push(roundedValue);
        accumulator.recentTotalSamples = accumulator.recentTotalSamples.slice(-RECENT_TICK_LATENCY_SAMPLE_SIZE);
      }
    }

    if (!updated) {
      return;
    }

    accumulator.lastRecordedAt = recordedAt;
    this.tickLatencyBySymbol.set(symbol, accumulator);
    const current = this.pipelineBySymbol.get(symbol) || this.createPipelineSnapshot(symbol);
    this.pipelineBySymbol.set(symbol, {
      ...current,
      tickLatency: this.buildTickLatencySummary(accumulator)
    });
    this.touchSymbol(symbol, recordedAt);
  }

  setContextSnapshot(symbol: string, snapshot: ContextSnapshot) {
    this.contextBySymbol.set(symbol, snapshot);
    this.touchSymbol(symbol, snapshot?.observedAt || this.now());
  }

  getContextSnapshot(symbol: string): ContextSnapshot | null {
    return this.contextBySymbol.get(symbol) || null;
  }

  setArchitectObservedAssessment(symbol: string, assessment: ArchitectAssessment) {
    this.architectObservedBySymbol.set(symbol, assessment);
    this.touchSymbol(symbol, assessment?.updatedAt || this.now());
  }

  getArchitectObservedAssessment(symbol: string): ArchitectAssessment | null {
    return this.architectObservedBySymbol.get(symbol) || null;
  }

  setArchitectPublishedAssessment(symbol: string, assessment: ArchitectAssessment) {
    this.architectPublishedBySymbol.set(symbol, assessment);
    this.touchSymbol(symbol, assessment?.updatedAt || this.now());
  }

  getArchitectPublishedAssessment(symbol: string): ArchitectAssessment | null {
    return this.architectPublishedBySymbol.get(symbol) || null;
  }

  setArchitectPublisherState(symbol: string, state: ArchitectPublisherState) {
    this.architectPublisherBySymbol.set(symbol, state);
    this.touchSymbol(symbol, this.resolvePublisherTouchedAt(state) || this.now());
  }

  getArchitectPublisherState(symbol: string): ArchitectPublisherState | null {
    return this.architectPublisherBySymbol.get(symbol) || null;
  }

  getClosedTradesForSymbol(symbol: string): ClosedTradeRecord[] {
    return Array.from(this.closedTrades.values()).flat().filter((trade) => trade.symbol === symbol);
  }

  getAllClosedTrades(): ClosedTradeRecord[] {
    return Array.from(this.closedTrades.values()).flat();
  }

  appendEvent(event: SystemEvent) {
    this.events = [...this.events, event].slice(-this.maxEvents);
  }

  getRecentEvents(limit: number = 50): SystemEvent[] {
    return this.events.slice(-limit);
  }

  getSystemSnapshot() {
    return {
      botStates: Array.from(this.botStates.values()),
      events: this.getRecentEvents(50),
      latestPrices: Array.from(this.prices.values()).map((snapshot) => ({
        price: snapshot.latestPrice,
        symbol: snapshot.symbol,
        updatedAt: snapshot.updatedAt
      })),
      openPositions: Array.from(this.positions.values()).filter(Boolean),
      performance: Array.from(this.performance.values()),
      pipelines: this.getAllPipelineSnapshots(),
      context: Array.from(this.contextBySymbol.values()),
      architect: Array.from(this.architectPublishedBySymbol.values()),
      architectPublisher: Array.from(this.architectPublisherBySymbol.values()),
      wsConnections: this.getWsConnections()
    };
  }

  setSymbolStateRetentionMs(symbolStateRetentionMs: number | null | undefined) {
    this.symbolStateRetentionMs = this.normalizeSymbolStateRetentionMs(symbolStateRetentionMs);
  }

  getSymbolStateSnapshot(options: { now?: number } = {}): SymbolStateRetentionSnapshot {
    const observedAt = Number.isFinite(Number(options.now)) ? Number(options.now) : this.now();
    const trackedSymbols = Array.from(this.collectTrackedSymbols()).sort();
    const protectedSymbols = Array.from(this.getProtectedSymbols()).sort();
    const protectedSet = new Set(protectedSymbols);
    const staleCandidateSymbols = trackedSymbols.filter((symbol) => {
      if (protectedSet.has(symbol)) {
        return false;
      }
      const lastTouchedAt = this.resolveSymbolLastTouchedAt(symbol);
      if (lastTouchedAt === null) {
        return true;
      }
      return Math.max(0, observedAt - lastTouchedAt) >= this.symbolStateRetentionMs;
    });

    return {
      lastCleanupAt: this.symbolStateCleanupState.lastCleanupAt,
      lastEvictedAt: this.symbolStateCleanupState.lastEvictedAt,
      lastEvictedSymbols: [...this.symbolStateCleanupState.lastEvictedSymbols],
      protectedSymbols,
      staleAfterMs: this.symbolStateRetentionMs,
      staleCandidateSymbols,
      totalEvictedSymbols: this.symbolStateCleanupState.totalEvictedSymbols,
      trackedSymbols
    };
  }

  evictStaleSymbolState(options: { now?: number } = {}) {
    const observedAt = Number.isFinite(Number(options.now)) ? Number(options.now) : this.now();
    const snapshot = this.getSymbolStateSnapshot({ now: observedAt });
    const evictedSymbols: string[] = [];

    for (const symbol of snapshot.staleCandidateSymbols) {
      this.deleteSymbolState(symbol);
      evictedSymbols.push(symbol);
    }

    this.symbolStateCleanupState = {
      lastCleanupAt: observedAt,
      lastEvictedAt: evictedSymbols.length > 0 ? observedAt : this.symbolStateCleanupState.lastEvictedAt,
      lastEvictedSymbols: evictedSymbols.length > 0 ? evictedSymbols : this.symbolStateCleanupState.lastEvictedSymbols,
      totalEvictedSymbols: this.symbolStateCleanupState.totalEvictedSymbols + evictedSymbols.length
    };

    return {
      ...this.getSymbolStateSnapshot({ now: observedAt }),
      evictedSymbols
    };
  }

  setPortfolioKillSwitchConfig(config: Partial<PortfolioKillSwitchConfig> | null | undefined) {
    const nextConfig: PortfolioKillSwitchConfig = {
      enabled: Boolean(config?.enabled),
      maxDrawdownPct: Number.isFinite(Number(config?.maxDrawdownPct))
        ? Math.max(Number(config?.maxDrawdownPct), 0)
        : 0,
      mode: normalizePortfolioKillSwitchMode(config?.mode)
    };
    const initialEquityUsdt = this.getPortfolioInitialEquityUsdt();
    this.portfolioKillSwitchConfig = nextConfig;
    this.portfolioKillSwitchState = {
      ...this.portfolioKillSwitchState,
      blockingEntries: false,
      enabled: nextConfig.enabled,
      initialEquityUsdt,
      maxDrawdownPct: nextConfig.maxDrawdownPct,
      mode: nextConfig.mode,
      peakEquityUsdt: Math.max(initialEquityUsdt, this.portfolioKillSwitchState.peakEquityUsdt || 0),
      reason: null,
      triggered: false,
      triggeredAt: null,
      updatedAt: null
    };
  }

  computePortfolioKillSwitchState(options: { feeRate?: number; now?: number } = {}) {
    const feeRate = Math.max(Number(options.feeRate) || 0, 0);
    const updatedAt = Number.isFinite(Number(options.now)) ? Number(options.now) : this.now();
    const initialEquityUsdt = this.getPortfolioInitialEquityUsdt();
    let availableBalanceUsdt = 0;
    let openPositionCount = 0;
    let openPositionMarkNotionalUsdt = 0;
    let realizedPnl = 0;
    let unrealizedPnl = 0;

    for (const config of this.botConfigs.values()) {
      const state = this.botStates.get(config.id) || null;
      availableBalanceUsdt += Number(state?.availableBalanceUsdt ?? config.initialBalanceUsdt ?? 1000) || 0;
      realizedPnl += Number(state?.realizedPnl || 0) || 0;

      const position = this.positions.get(config.id) || null;
      if (!position) {
        continue;
      }

      openPositionCount += 1;
      const latestPrice = this.getLatestPrice(position.symbol);
      const markPrice = Number.isFinite(Number(latestPrice))
        ? Number(latestPrice)
        : Number(position.entryPrice || 0);
      const quantity = Math.max(Number(position.quantity) || 0, 0);
      const entryPrice = Math.max(Number(position.entryPrice) || 0, 0);
      const entryNotionalUsdt = entryPrice * quantity;
      const markNotionalUsdt = markPrice * quantity;
      const grossPnl = calculateDirectionalGrossPnl({
        entryPrice,
        exitPrice: markPrice,
        quantity,
        side: normalizeTradeSide(position.side)
      }).grossPnl;
      const fees = (entryNotionalUsdt + markNotionalUsdt) * feeRate;

      openPositionMarkNotionalUsdt += markNotionalUsdt;
      unrealizedPnl += grossPnl - fees;
    }

    const currentEquityUsdt = initialEquityUsdt + realizedPnl + unrealizedPnl;
    const previousPeakEquityUsdt = Number(this.portfolioKillSwitchState.peakEquityUsdt) || initialEquityUsdt;
    const peakEquityUsdt = this.portfolioKillSwitchState.triggered
      ? previousPeakEquityUsdt
      : Math.max(previousPeakEquityUsdt, currentEquityUsdt);
    const drawdownPct = peakEquityUsdt > 0
      ? Number((((peakEquityUsdt - currentEquityUsdt) / peakEquityUsdt) * 100).toFixed(4))
      : 0;
    const enabled = Boolean(this.portfolioKillSwitchConfig.enabled);
    let triggered = enabled ? Boolean(this.portfolioKillSwitchState.triggered) : false;
    let triggeredAt = enabled ? this.portfolioKillSwitchState.triggeredAt : null;
    let reason = enabled && triggered ? this.portfolioKillSwitchState.reason : null;

    if (
      enabled
      && !triggered
      && this.portfolioKillSwitchConfig.maxDrawdownPct > 0
      && drawdownPct >= this.portfolioKillSwitchConfig.maxDrawdownPct
    ) {
      triggered = true;
      triggeredAt = updatedAt;
      reason = "portfolio_max_drawdown_reached";
    }

    const nextState: PortfolioKillSwitchState = {
      availableBalanceUsdt: Number(availableBalanceUsdt.toFixed(4)),
      blockingEntries: enabled && triggered && this.portfolioKillSwitchConfig.mode === "block_entries_only",
      currentEquityUsdt: Number(currentEquityUsdt.toFixed(4)),
      drawdownPct,
      enabled,
      initialEquityUsdt: Number(initialEquityUsdt.toFixed(4)),
      maxDrawdownPct: this.portfolioKillSwitchConfig.maxDrawdownPct,
      mode: this.portfolioKillSwitchConfig.mode,
      openPositionCount,
      openPositionMarkNotionalUsdt: Number(openPositionMarkNotionalUsdt.toFixed(4)),
      peakEquityUsdt: Number(peakEquityUsdt.toFixed(4)),
      reason,
      realizedPnl: Number(realizedPnl.toFixed(4)),
      triggered,
      triggeredAt,
      unrealizedPnl: Number(unrealizedPnl.toFixed(4)),
      updatedAt
    };
    return nextState;
  }

  commitPortfolioKillSwitchState(options: { feeRate?: number; now?: number } = {}) {
    const nextState = this.computePortfolioKillSwitchState(options);
    this.portfolioKillSwitchState = nextState;
    return nextState;
  }

  getPortfolioKillSwitchState(options: { feeRate?: number; now?: number } = {}) {
    return this.computePortfolioKillSwitchState(options);
  }

  resetPortfolioKillSwitchState(options: { feeRate?: number; now?: number } = {}) {
    const currentState = this.computePortfolioKillSwitchState(options);
    const nextState = {
      ...currentState,
      blockingEntries: false,
      peakEquityUsdt: currentState.currentEquityUsdt,
      reason: null,
      triggered: false,
      triggeredAt: null
    };
    this.portfolioKillSwitchState = nextState;
    return nextState;
  }

  createPipelineSnapshot(symbol: string): PipelineSnapshot {
    return {
      botDecisionMs: null,
      botToExecutionMs: null,
      exchangeToReceiveMs: null,
      executionMs: null,
      lastBotEvaluatedAt: null,
      lastBotStartedAt: null,
      lastExchangeTimestamp: null,
      lastExecutionAt: null,
      lastStateUpdatedAt: null,
      lastWsReceivedAt: null,
      receiveToStateMs: null,
      restRoundtripMs: null,
      source: null,
      stateToBotMs: null,
      symbol,
      tickLatency: null,
      totalPipelineMs: null
    };
  }

  createTickLatencyAccumulator(): TickLatencyAccumulator {
    return {
      lastRecordedAt: null,
      recentTotalSamples: [],
      stages: TICK_LATENCY_STAGES.reduce((result, stage) => {
        result[stage] = {
          count: 0,
          lastMs: null,
          maxMs: null,
          totalMs: 0
        };
        return result;
      }, {} as Record<TickLatencyStageKey, TickLatencyStageAggregate>)
    };
  }

  buildTickLatencySummary(accumulator: TickLatencyAccumulator): TickLatencySummary {
    const average = {} as Record<TickLatencyStageKey, number | null>;
    const last = {} as Record<TickLatencyStageKey, number | null>;
    const max = {} as Record<TickLatencyStageKey, number | null>;

    for (const stage of TICK_LATENCY_STAGES) {
      const stageAccumulator = accumulator.stages[stage];
      average[stage] = stageAccumulator.count > 0
        ? this.roundLatencyMs(stageAccumulator.totalMs / stageAccumulator.count)
        : null;
      last[stage] = stageAccumulator.lastMs;
      max[stage] = stageAccumulator.maxMs;
    }

    return {
      average,
      last,
      lastRecordedAt: accumulator.lastRecordedAt,
      max,
      recentWorstTotalMs: accumulator.recentTotalSamples.length > 0
        ? this.roundLatencyMs(Math.max(...accumulator.recentTotalSamples))
        : null,
      sampleCount: accumulator.stages.totalTickPipelineMs.count
    };
  }

  roundLatencyMs(value: number) {
    return Number(value.toFixed(3));
  }

  computeExchangeToReceiveMs(tick: MarketTick) {
    const exchangeTimestamp = Number(tick.timestamp);
    const receivedAt = Number(tick.receivedAt);
    if (!Number.isFinite(exchangeTimestamp) || !Number.isFinite(receivedAt) || receivedAt <= 0 || exchangeTimestamp <= 0) {
      return null;
    }
    if (exchangeTimestamp > receivedAt) {
      return null;
    }
    return Math.max(0, receivedAt - exchangeTimestamp);
  }

  recordPipelineFromTick(tick: MarketTick) {
    const current = this.pipelineBySymbol.get(tick.symbol) || this.createPipelineSnapshot(tick.symbol);
    const next = {
      ...current,
      botDecisionMs: null,
      botToExecutionMs: null,
      exchangeToReceiveMs: this.computeExchangeToReceiveMs(tick),
      executionMs: null,
      lastExchangeTimestamp: tick.timestamp,
      lastBotStartedAt: null,
      lastBotEvaluatedAt: null,
      lastExecutionAt: null,
      lastStateUpdatedAt: tick.stateUpdatedAt || this.now(),
      lastWsReceivedAt: tick.receivedAt || null,
      receiveToStateMs: tick.receivedAt && tick.stateUpdatedAt ? Math.max(0, tick.stateUpdatedAt - tick.receivedAt) : null,
      restRoundtripMs: Number.isFinite(Number(tick.restRoundtripMs)) && Number(tick.restRoundtripMs) >= 0
        ? Number(tick.restRoundtripMs)
        : null,
      source: tick.source,
      stateToBotMs: null
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(tick.symbol, next);
  }

  computeTotalPipelineMs(snapshot: PipelineSnapshot) {
    const segments = [
      snapshot.exchangeToReceiveMs,
      snapshot.receiveToStateMs,
      snapshot.stateToBotMs,
      snapshot.botDecisionMs,
      snapshot.executionMs
    ].filter((value) => Number.isFinite(value)) as number[];
    if (segments.length <= 0) return null;
    return segments.reduce((sum, value) => sum + value, 0);
  }

  hasRegisteredBotForSymbol(symbol: string) {
    return Array.from(this.botConfigs.values()).some((config) => config.symbol === symbol);
  }

  getPortfolioInitialEquityUsdt() {
    return Array.from(this.botConfigs.values()).reduce((sum, config) => {
      return sum + (Number(config.initialBalanceUsdt) || 1000);
    }, 0);
  }

  normalizeSymbolStateRetentionMs(symbolStateRetentionMs: number | null | undefined) {
    const normalized = Number(symbolStateRetentionMs);
    if (!Number.isFinite(normalized) || normalized < 60_000) {
      return DEFAULT_SYMBOL_STATE_RETENTION_MS;
    }
    return Math.floor(normalized);
  }

  touchSymbol(symbol: string, touchedAt: number = this.now()) {
    const normalizedSymbol = String(symbol || "").trim();
    if (!normalizedSymbol) {
      return;
    }
    const normalizedTouchedAt = Number.isFinite(Number(touchedAt))
      ? Number(touchedAt)
      : this.now();
    const previousTouchedAt = this.symbolLastTouchedAtBySymbol.get(normalizedSymbol) || 0;
    this.symbolLastTouchedAtBySymbol.set(
      normalizedSymbol,
      Math.max(previousTouchedAt, normalizedTouchedAt)
    );
  }

  resolvePublisherTouchedAt(state: ArchitectPublisherState | null | undefined) {
    const candidates = [
      state?.lastObservedAt,
      state?.lastPublishedAt,
      state?.warmupStartedAt
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return candidates.length > 0 ? Math.max(...candidates) : null;
  }

  collectTrackedSymbols() {
    const trackedSymbols = new Set<string>();
    const symbolMaps = [
      this.prices,
      this.priceHistoryRevisionBySymbol,
      this.klines,
      this.pipelineBySymbol,
      this.tickLatencyBySymbol,
      this.marketDataFreshnessBySymbol,
      this.contextBySymbol,
      this.architectObservedBySymbol,
      this.architectPublishedBySymbol,
      this.architectPublisherBySymbol,
      this.symbolLastTouchedAtBySymbol
    ];

    for (const map of symbolMaps) {
      for (const symbol of map.keys()) {
        trackedSymbols.add(symbol);
      }
    }

    for (const config of this.botConfigs.values()) {
      if (config?.symbol) {
        trackedSymbols.add(config.symbol);
      }
    }

    for (const position of this.positions.values()) {
      if (position?.symbol) {
        trackedSymbols.add(position.symbol);
      }
    }

    return trackedSymbols;
  }

  getProtectedSymbols() {
    const protectedSymbols = new Set<string>();
    for (const config of this.botConfigs.values()) {
      if (config?.symbol) {
        protectedSymbols.add(config.symbol);
      }
    }
    for (const position of this.positions.values()) {
      if (position?.symbol) {
        protectedSymbols.add(position.symbol);
      }
    }
    return protectedSymbols;
  }

  resolveSymbolLastTouchedAt(symbol: string) {
    const pipeline = this.pipelineBySymbol.get(symbol) || null;
    const publisher = this.architectPublisherBySymbol.get(symbol) || null;
    const candidates = [
      this.symbolLastTouchedAtBySymbol.get(symbol),
      this.prices.get(symbol)?.updatedAt,
      this.contextBySymbol.get(symbol)?.observedAt,
      this.architectObservedBySymbol.get(symbol)?.updatedAt,
      this.architectPublishedBySymbol.get(symbol)?.updatedAt,
      pipeline?.lastExchangeTimestamp,
      pipeline?.lastWsReceivedAt,
      pipeline?.lastStateUpdatedAt,
      pipeline?.lastBotEvaluatedAt,
      pipeline?.lastExecutionAt,
      this.resolvePublisherTouchedAt(publisher)
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    return candidates.length > 0 ? Math.max(...candidates) : null;
  }

  deleteSymbolState(symbol: string) {
    this.prices.delete(symbol);
    this.priceHistoryRevisionBySymbol.delete(symbol);
    this.klines.delete(symbol);
    this.pipelineBySymbol.delete(symbol);
    this.tickLatencyBySymbol.delete(symbol);
    this.marketDataFreshnessBySymbol.delete(symbol);
    this.contextBySymbol.delete(symbol);
    this.architectObservedBySymbol.delete(symbol);
    this.architectPublishedBySymbol.delete(symbol);
    this.architectPublisherBySymbol.delete(symbol);
    this.symbolLastTouchedAtBySymbol.delete(symbol);
  }
}

module.exports = {
  StateStore
};
