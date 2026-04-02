// Module responsibility: central in-memory state store for prices, bots, positions, orders and performance.

import type { BotConfig, BotRuntimeState } from "../types/bot.ts";
import type { ArchitectAssessment, ArchitectPublisherState } from "../types/architect.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { SystemEvent } from "../types/event.ts";
import type { MarketKline, MarketTick, PriceSnapshot } from "../types/market.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "../types/trade.ts";

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
  lastBotEvaluatedAt: number | null;
  lastExecutionAt: number | null;
  exchangeToReceiveMs: number | null;
  receiveToStateMs: number | null;
  stateToBotMs: number | null;
  botToExecutionMs: number | null;
  totalPipelineMs: number | null;
}

interface WsConnectionSnapshot {
  connectionId: string;
  status: string;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastMessageAt: number | null;
  reconnectAttempt: number;
  lastReason: string | null;
  fallbackActive: boolean;
  mode: "mock" | "live";
}

class StateStore {
  botConfigs: Map<string, BotConfig>;
  botStates: Map<string, BotRuntimeState>;
  prices: Map<string, PriceSnapshot>;
  klines: Map<string, Map<string, MarketKline[]>>;
  orders: Map<string, OrderRecord[]>;
  closedTrades: Map<string, ClosedTradeRecord[]>;
  positions: Map<string, PositionRecord | null>;
  performance: Map<string, PerformanceSnapshot>;
  performanceHistory: Map<string, PerformanceHistoryPoint[]>;
  wsConnections: Map<string, WsConnectionSnapshot>;
  pipelineBySymbol: Map<string, PipelineSnapshot>;
  contextBySymbol: Map<string, ContextSnapshot>;
  architectObservedBySymbol: Map<string, ArchitectAssessment>;
  architectPublishedBySymbol: Map<string, ArchitectAssessment>;
  architectPublisherBySymbol: Map<string, ArchitectPublisherState>;
  events: SystemEvent[];
  maxEvents: number;
  maxPriceHistory: number;
  maxKlineHistory: number;
  maxPerformanceHistory: number;

  constructor(options: { maxEvents?: number; maxPriceHistory?: number; maxKlineHistory?: number; maxPerformanceHistory?: number } = {}) {
    this.botConfigs = new Map();
    this.botStates = new Map();
    this.prices = new Map();
    this.klines = new Map();
    this.orders = new Map();
    this.closedTrades = new Map();
    this.positions = new Map();
    this.performance = new Map();
    this.performanceHistory = new Map();
    this.wsConnections = new Map();
    this.pipelineBySymbol = new Map();
    this.contextBySymbol = new Map();
    this.architectObservedBySymbol = new Map();
    this.architectPublishedBySymbol = new Map();
    this.architectPublisherBySymbol = new Map();
    this.events = [];
    this.maxEvents = Math.max(options.maxEvents || 250, 50);
    this.maxPriceHistory = Math.max(options.maxPriceHistory || 300, 50);
    this.maxKlineHistory = Math.max(options.maxKlineHistory || 300, 50);
    this.maxPerformanceHistory = Math.max(options.maxPerformanceHistory || 200, 20);
  }

  registerBot(config: BotConfig) {
    const initialBalance = config.initialBalanceUsdt ?? 1000;
    this.botConfigs.set(config.id, config);
    this.botStates.set(config.id, {
      activeStrategyId: config.strategy,
      availableBalanceUsdt: initialBalance,
      botId: config.id,
      cooldownReason: null,
      cooldownUntil: null,
      entrySignalStreak: 0,
      exitSignalStreak: 0,
      lastDecision: "hold",
      lastDecisionConfidence: 0,
      lastDecisionReasons: [],
      lastArchitectAssessmentAt: null,
      architectRecommendedFamily: null,
      architectRecommendationStreak: 0,
      architectSyncStatus: "pending",
      lastEvaluationAt: null,
      lastExecutionAt: null,
      lastStrategySwitchAt: null,
      lastTickAt: null,
      lastTradeAt: null,
      lossStreak: 0,
      pausedReason: null,
      realizedPnl: 0,
      status: config.enabled ? "idle" : "stopped",
      symbol: config.symbol
    });
    this.orders.set(config.id, []);
    this.closedTrades.set(config.id, []);
    this.positions.set(config.id, null);
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
    this.performanceHistory.set(config.id, [{
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      time: Date.now(),
      tradesCount: 0,
      winRate: 0
    }]);
    this.pipelineBySymbol.set(config.symbol, {
      botToExecutionMs: null,
      exchangeToReceiveMs: null,
      lastBotEvaluatedAt: null,
      lastExchangeTimestamp: null,
      lastExecutionAt: null,
      lastStateUpdatedAt: null,
      lastWsReceivedAt: null,
      receiveToStateMs: null,
      stateToBotMs: null,
      symbol: config.symbol,
      totalPipelineMs: null
    });
  }

  updatePrice(tick: MarketTick) {
    const stateUpdatedAt = Date.now();
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
    this.recordPipelineFromTick(normalizedTick);
  }

  updateKline(kline: MarketKline) {
    const symbolMap = this.klines.get(kline.symbol) || new Map();
    const existing = symbolMap.get(kline.interval) || [];
    const normalizedKline = {
      ...kline,
      receivedAt: kline.receivedAt || Date.now()
    };
    const nextHistory = [...existing, normalizedKline];
    symbolMap.set(kline.interval, nextHistory.slice(-this.maxKlineHistory));
    this.klines.set(kline.symbol, symbolMap);
  }

  getLatestPrice(symbol: string): number | null {
    return this.prices.get(symbol)?.latestPrice ?? null;
  }

  getPriceSnapshot(symbol: string): PriceSnapshot | null {
    return this.prices.get(symbol) || null;
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
    this.botStates.set(botId, { ...current, ...patch });
  }

  getPosition(botId: string): PositionRecord | null {
    return this.positions.get(botId) || null;
  }

  setPosition(botId: string, position: PositionRecord | null) {
    this.positions.set(botId, position);
  }

  appendOrder(botId: string, order: OrderRecord) {
    const orders = this.orders.get(botId) || [];
    this.orders.set(botId, [...orders, order]);
  }

  appendClosedTrade(botId: string, trade: ClosedTradeRecord) {
    const trades = this.closedTrades.get(botId) || [];
    this.closedTrades.set(botId, [...trades, trade]);
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
        time: Date.now(),
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
      mode: "mock",
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
      stateToBotMs: current.lastStateUpdatedAt ? Math.max(0, evaluatedAt - current.lastStateUpdatedAt) : null
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(symbol, next);
  }

  recordExecution(botId: string, symbol: string, executedAt: number) {
    this.updateBotState(botId, {
      lastExecutionAt: executedAt
    });
    const current = this.pipelineBySymbol.get(symbol) || this.createPipelineSnapshot(symbol);
    const next = {
      ...current,
      botToExecutionMs: current.lastBotEvaluatedAt ? Math.max(0, executedAt - current.lastBotEvaluatedAt) : null,
      lastExecutionAt: executedAt
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(symbol, next);
  }

  getPipelineSnapshot(symbol: string): PipelineSnapshot | null {
    return this.pipelineBySymbol.get(symbol) || null;
  }

  getAllPipelineSnapshots() {
    return Array.from(this.pipelineBySymbol.values());
  }

  setContextSnapshot(symbol: string, snapshot: ContextSnapshot) {
    this.contextBySymbol.set(symbol, snapshot);
  }

  getContextSnapshot(symbol: string): ContextSnapshot | null {
    return this.contextBySymbol.get(symbol) || null;
  }

  getAllContextSnapshots() {
    return Array.from(this.contextBySymbol.values());
  }

  setArchitectObservedAssessment(symbol: string, assessment: ArchitectAssessment) {
    this.architectObservedBySymbol.set(symbol, assessment);
  }

  getArchitectObservedAssessment(symbol: string): ArchitectAssessment | null {
    return this.architectObservedBySymbol.get(symbol) || null;
  }

  setArchitectPublishedAssessment(symbol: string, assessment: ArchitectAssessment) {
    this.architectPublishedBySymbol.set(symbol, assessment);
  }

  setArchitectAssessment(symbol: string, assessment: ArchitectAssessment) {
    this.setArchitectPublishedAssessment(symbol, assessment);
  }

  getArchitectPublishedAssessment(symbol: string): ArchitectAssessment | null {
    return this.architectPublishedBySymbol.get(symbol) || null;
  }

  getArchitectAssessment(symbol: string): ArchitectAssessment | null {
    return this.getArchitectPublishedAssessment(symbol);
  }

  getAllArchitectAssessments() {
    return Array.from(this.architectPublishedBySymbol.values());
  }

  setArchitectPublisherState(symbol: string, state: ArchitectPublisherState) {
    this.architectPublisherBySymbol.set(symbol, state);
  }

  getArchitectPublisherState(symbol: string): ArchitectPublisherState | null {
    return this.architectPublisherBySymbol.get(symbol) || null;
  }

  getAllArchitectPublisherStates() {
    return Array.from(this.architectPublisherBySymbol.values());
  }

  getOrdersForSymbol(symbol: string): OrderRecord[] {
    return Array.from(this.orders.values()).flat().filter((order) => order.symbol === symbol);
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
      context: this.getAllContextSnapshots(),
      architect: this.getAllArchitectAssessments(),
      architectPublisher: this.getAllArchitectPublisherStates(),
      wsConnections: this.getWsConnections()
    };
  }

  createPipelineSnapshot(symbol: string): PipelineSnapshot {
    return {
      botToExecutionMs: null,
      exchangeToReceiveMs: null,
      lastBotEvaluatedAt: null,
      lastExchangeTimestamp: null,
      lastExecutionAt: null,
      lastStateUpdatedAt: null,
      lastWsReceivedAt: null,
      receiveToStateMs: null,
      stateToBotMs: null,
      symbol,
      totalPipelineMs: null
    };
  }

  recordPipelineFromTick(tick: MarketTick) {
    const current = this.pipelineBySymbol.get(tick.symbol) || this.createPipelineSnapshot(tick.symbol);
    const next = {
      ...current,
      exchangeToReceiveMs: tick.receivedAt ? Math.max(0, tick.receivedAt - tick.timestamp) : null,
      lastExchangeTimestamp: tick.timestamp,
      lastStateUpdatedAt: tick.stateUpdatedAt || Date.now(),
      lastWsReceivedAt: tick.receivedAt || null,
      receiveToStateMs: tick.receivedAt && tick.stateUpdatedAt ? Math.max(0, tick.stateUpdatedAt - tick.receivedAt) : null
    };
    next.totalPipelineMs = this.computeTotalPipelineMs(next);
    this.pipelineBySymbol.set(tick.symbol, next);
  }

  computeTotalPipelineMs(snapshot: PipelineSnapshot) {
    const segments = [
      snapshot.exchangeToReceiveMs,
      snapshot.receiveToStateMs,
      snapshot.stateToBotMs,
      snapshot.botToExecutionMs
    ].filter((value) => Number.isFinite(value)) as number[];
    if (segments.length <= 0) return null;
    return segments.reduce((sum, value) => sum + value, 0);
  }
}

module.exports = {
  StateStore
};
