import type { MarketKline, MarketMode, MarketTick } from "../types/market.ts";
import type { Clock } from "../core/clock.ts";

const ccxt = require("ccxt");
const { elapsedMs, startTimer } = require("../utils/timing.ts");
const { resolveClock } = require("../core/clock.ts");

const MIN_LIVE_EMIT_INTERVAL_MS = 250;
const DEFAULT_REST_FALLBACK_INTERVAL_MS = 5_000;
const HIGH_LATENCY_WARN_MS = 1_000;
const LATENCY_LOG_INTERVAL_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

class MarketStream {
  wsManager: any;
  store: any;
  logger: any;
  flushTimer: NodeJS.Timeout | null;
  symbols: string[];
  mode: MarketMode;
  liveEmitIntervalMs: number;
  streamType: "trade" | "aggTrade";
  wsBaseUrl: string;
  klineIntervals: string[];
  disconnectLiveFeed: (() => void) | null;
  unsubscribeWsStatus: (() => void) | null;
  pendingTicks: Map<string, MarketTick>;
  fallbackTimer: NodeJS.Timeout | null;
  fallbackExchange: any;
  fallbackRestUrl: string;
  fallbackIntervalMs: number;
  fallbackStaleAfterMs: number;
  stopping: boolean;
  restSnapshotGeneration: number;
  highLatencyWarnMs: number;
  latencyLogIntervalMs: number;
  lastLatencyLogAtBySymbol: Map<string, number>;
  clock: Clock;

  constructor(deps: {
    clock?: Clock;
    wsManager: any;
    store: any;
    logger: any;
    mode?: MarketMode;
    liveEmitIntervalMs?: number;
    streamType?: "trade" | "aggTrade";
    wsBaseUrl?: string;
    klineIntervals?: string[];
    restExchangeId?: string;
  }) {
    this.clock = resolveClock(deps.clock);
    this.wsManager = deps.wsManager;
    this.store = deps.store;
    this.logger = deps.logger;
    this.flushTimer = null;
    this.symbols = [];
    if (deps.mode && deps.mode !== "live") {
      throw new Error(`market stream mode ${deps.mode} is not supported; active runtime market data is live-only`);
    }
    this.mode = "live";
    this.liveEmitIntervalMs = Math.max(deps.liveEmitIntervalMs ?? MIN_LIVE_EMIT_INTERVAL_MS, MIN_LIVE_EMIT_INTERVAL_MS);
    this.streamType = deps.streamType || "trade";
    this.wsBaseUrl = deps.wsBaseUrl || "wss://stream.binance.com:9443";
    this.klineIntervals = [...new Set(deps.klineIntervals || [])];
    this.disconnectLiveFeed = null;
    this.unsubscribeWsStatus = null;
    this.pendingTicks = new Map();
    this.fallbackTimer = null;
    this.fallbackExchange = null;
    this.fallbackRestUrl = deps.restExchangeId || "binance";
    this.fallbackIntervalMs = DEFAULT_REST_FALLBACK_INTERVAL_MS;
    this.fallbackStaleAfterMs = Math.max(this.fallbackIntervalMs, this.liveEmitIntervalMs * 4);
    this.stopping = false;
    this.restSnapshotGeneration = 0;
    this.highLatencyWarnMs = HIGH_LATENCY_WARN_MS;
    this.latencyLogIntervalMs = LATENCY_LOG_INTERVAL_MS;
    this.lastLatencyLogAtBySymbol = new Map();
  }

  now() {
    return this.clock.now();
  }

  start(symbols: string[]) {
    this.stop();
    this.stopping = false;
    this.symbols = [...new Set(symbols)];
    if (this.symbols.length <= 0) {
      this.logger.warn("market_stream_skipped", {
        mode: this.mode,
        reason: "no_symbols"
      });
      return;
    }
    this.startLive();

    this.logger.info("market_stream_started", {
      intervalMs: this.liveEmitIntervalMs,
      mode: this.mode,
      symbols: this.symbols.join(",")
    });
  }

  stop() {
    this.stopping = true;
    this.restSnapshotGeneration += 1;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.disconnectLiveFeed) {
      this.disconnectLiveFeed();
      this.disconnectLiveFeed = null;
    }
    if (this.unsubscribeWsStatus) {
      this.unsubscribeWsStatus();
      this.unsubscribeWsStatus = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.fallbackExchange && typeof this.fallbackExchange.close === "function") {
      Promise.resolve(this.fallbackExchange.close()).catch(() => {});
      this.fallbackExchange = null;
    }
    this.pendingTicks.clear();
  }

  subscribe(symbol: string, handler: (tick: MarketTick) => void) {
    return this.wsManager.subscribe(`market:${symbol}`, handler);
  }

  subscribeKline(symbol: string, interval: string, handler: (kline: MarketKline) => void) {
    return this.wsManager.subscribe(`market:kline:${symbol}:${interval}`, handler);
  }

  startLive() {
    this.unsubscribeWsStatus = this.wsManager.subscribe("ws:status:market-stream", (status: unknown) => {
      this.handleWsStatus(status);
    });
    this.disconnectLiveFeed = this.wsManager.connectBinanceMarketStream({
      connectionId: "market-stream",
      klineIntervals: this.klineIntervals,
      onKline: (kline: MarketKline) => {
        this.handleKline(kline);
      },
      onTick: (tick: MarketTick) => {
        this.pendingTicks.set(tick.symbol, tick);
      },
      streamType: this.streamType,
      symbols: this.symbols,
      urlBase: this.wsBaseUrl
    });

    this.flushTimer = setInterval(() => this.flushPendingTicks(), this.liveEmitIntervalMs);
    if (typeof this.flushTimer.unref === "function") {
      this.flushTimer.unref();
    }
  }

  handleWsStatus(status: unknown) {
    const statusPayload = isRecord(status) ? status : {};
    const observedAt = Number.isFinite(Number(statusPayload.timestamp)) ? Number(statusPayload.timestamp) : this.now();
    this.store.updateWsConnection("market-stream", {
      connectionId: "market-stream",
      fallbackActive: Boolean(this.fallbackTimer),
      lastConnectedAt: statusPayload.status === "connected" ? observedAt : undefined,
      lastDisconnectedAt: statusPayload.status === "disconnected" ? observedAt : undefined,
      lastMessageAt: statusPayload.lastMessageAt || undefined,
      lastReason: statusPayload.reason || null,
      mode: this.mode,
      reconnectAttempt: statusPayload.reconnectAttempt || 0,
      status: statusPayload.status || "unknown"
    });

    if (this.stopping) {
      this.stopRestFallback();
      return;
    }

    if (statusPayload.status === "connected") {
      this.markMarketDataStaleIfExpired(observedAt);
      this.stopRestFallback();
    } else if (statusPayload.status === "disconnected" || statusPayload.status === "reconnecting" || statusPayload.status === "error") {
      this.markSymbolsDegraded(`ws_${statusPayload.status}`, observedAt);
      this.startRestFallback(observedAt);
    }
  }

  flushPendingTicks() {
    if (this.pendingTicks.size <= 0) return;
    const ticks = Array.from(this.pendingTicks.values());
    this.pendingTicks.clear();
    for (const tick of ticks) {
      this.handleTick(tick);
    }
  }

  handleTick(tick: MarketTick) {
    const tickTimer = startTimer();
    const flushDelayMs = tick.receivedAt !== undefined
      ? Math.max(0, this.now() - tick.receivedAt)
      : 0;
    const stateTimer = startTimer();
    this.store.updatePrice(tick);
    this.updateFreshnessFromTick(tick);
    const stateUpdateMs = elapsedMs(stateTimer);
    const publishTimer = startTimer();
    this.wsManager.publish(`market:${tick.symbol}`, tick);
    const publishFanoutMs = elapsedMs(publishTimer);
    const totalTickPipelineMs = elapsedMs(tickTimer);
    if (typeof this.store.recordTickLatencySample === "function") {
      this.store.recordTickLatencySample(tick.symbol, {
        flushDelayMs,
        publishFanoutMs,
        stateUpdateMs,
        totalTickPipelineMs
      }, tick.receivedAt || this.now());
    }
    this.maybeLogTickLatency(tick, totalTickPipelineMs);
  }

  updateFreshnessFromTick(tick: MarketTick) {
    if (typeof this.store.setMarketDataFreshness !== "function") {
      return;
    }
    const isWsTick = tick.source === "ws";
    this.store.setMarketDataFreshness(tick.symbol, {
      lastTickTimestamp: Number.isFinite(Number(tick.timestamp)) ? Number(tick.timestamp) : undefined,
      receivedAt: Number.isFinite(Number(tick.receivedAt)) ? Number(tick.receivedAt) : this.now(),
      reason: isWsTick ? "" : "rest_fallback_active",
      status: isWsTick ? "fresh" : "degraded",
      updatedAt: Number.isFinite(Number(tick.receivedAt)) ? Number(tick.receivedAt) : this.now()
    });
  }

  markSymbolsDegraded(reason: string, observedAt: number = this.now()) {
    if (typeof this.store.setMarketDataFreshness !== "function") {
      return;
    }
    for (const symbol of this.symbols) {
      this.store.setMarketDataFreshness(symbol, {
        reason,
        status: "degraded",
        updatedAt: observedAt
      });
    }
  }

  markMarketDataStaleIfExpired(observedAt: number = this.now()) {
    if (typeof this.store.markMarketDataStaleIfExpired !== "function") {
      return;
    }
    this.store.markMarketDataStaleIfExpired(this.symbols, {
      now: observedAt,
      staleAfterMs: this.fallbackStaleAfterMs
    });
  }

  maybeLogTickLatency(tick: MarketTick, totalTickPipelineMs: number) {
    const pipeline = typeof this.store.getPipelineSnapshot === "function"
      ? this.store.getPipelineSnapshot(tick.symbol)
      : null;
    const tickLatency = pipeline?.tickLatency || null;
    if (!tickLatency) {
      return;
    }

    const loggedAt = this.now();
    const lastLoggedAt = this.lastLatencyLogAtBySymbol.get(tick.symbol) || 0;
    const latency = {
      botDecisionMs: pipeline?.botDecisionMs ?? null,
      executionMs: pipeline?.executionMs ?? pipeline?.botToExecutionMs ?? null,
      exchangeToWsMs: pipeline?.exchangeToReceiveMs ?? null,
      restRoundtripMs: pipeline?.restRoundtripMs ?? null,
      source: pipeline?.source || tick.source,
      storeToBotMs: pipeline?.stateToBotMs ?? null,
      totalMs: pipeline?.totalPipelineMs ?? null,
      wsToStoreMs: pipeline?.receiveToStateMs ?? null
    };
    const shouldWarn = Math.max(
      Number(totalTickPipelineMs) || 0,
      Number(latency.totalMs) || 0
    ) >= this.highLatencyWarnMs;
    const shouldSample = (loggedAt - lastLoggedAt) >= this.latencyLogIntervalMs;
    if (!shouldWarn && !shouldSample) {
      return;
    }

    this.lastLatencyLogAtBySymbol.set(tick.symbol, loggedAt);
    const totalSegments = [
      latency.exchangeToWsMs,
      latency.wsToStoreMs,
      latency.storeToBotMs,
      latency.botDecisionMs,
      latency.executionMs
    ].filter((value) => Number.isFinite(Number(value))) as number[];
    const expectedTotalMs = totalSegments.length > 0
      ? totalSegments.reduce((sum, value) => sum + Number(value), 0)
      : null;
    if (process.env.DEBUG_LATENCY_PIPELINE && expectedTotalMs !== null && latency.totalMs !== null) {
      const mismatchMs = Math.abs(Number(latency.totalMs) - expectedTotalMs);
      if (mismatchMs > 1) {
        this.logger.warn("tick_pipeline_latency_invariant_mismatch", {
          expectedTotalMs: Number(expectedTotalMs.toFixed(3)),
          latency: JSON.stringify(latency),
          mismatchMs: Number(mismatchMs.toFixed(3)),
          symbol: tick.symbol
        });
      }
    }
    const payload = {
      latency: JSON.stringify(latency),
      recentWorstTotalMs: tickLatency.recentWorstTotalMs,
      sampleCount: tickLatency.sampleCount,
      stageAverage: JSON.stringify(tickLatency.average),
      stageLast: JSON.stringify(tickLatency.last),
      stageMax: JSON.stringify(tickLatency.max),
      symbol: tick.symbol,
      tickTimestamp: tick.timestamp
    };
    if (shouldWarn) {
      this.logger.warn("tick_pipeline_latency_high", payload);
      return;
    }
    this.logger.info("tick_pipeline_latency", payload);
  }

  handleKline(kline: MarketKline) {
    this.store.updateKline(kline);
    this.wsManager.publish(`market:kline:${kline.symbol}:${kline.interval}`, kline);
  }

  getFallbackTargetSymbols(observedAt: number) {
    return this.symbols.filter((symbol) => {
      const pipeline = typeof this.store.getPipelineSnapshot === "function"
        ? this.store.getPipelineSnapshot(symbol)
        : null;
      const priceSnapshot = typeof this.store.getPriceSnapshot === "function"
        ? this.store.getPriceSnapshot(symbol)
        : null;
      const lastUpdatedAt = Number(
        pipeline?.lastStateUpdatedAt
        || priceSnapshot?.updatedAt
        || 0
      );
      if (!Number.isFinite(lastUpdatedAt) || lastUpdatedAt <= 0) {
        return true;
      }
      return Math.max(0, observedAt - lastUpdatedAt) >= this.fallbackStaleAfterMs;
    });
  }

  normalizeFallbackTick(symbol: string, ticker: unknown, receivedAt: number, restRoundtripMs?: number | null) {
    const tickerPayload = isRecord(ticker) ? ticker : {};
    const price = Number(tickerPayload.last || tickerPayload.close || 0);
    if (!(price > 0)) {
      return null;
    }
    return {
      price,
      receivedAt,
      restRoundtripMs: Number.isFinite(Number(restRoundtripMs)) ? Math.max(0, Number(restRoundtripMs)) : undefined,
      source: "rest" as const,
      symbol,
      timestamp: Number(tickerPayload.timestamp || receivedAt)
    };
  }

  async fetchFallbackTicks(exchange: any, targetSymbols: string[], observedAt: number) {
    if (targetSymbols.length > 1 && typeof exchange.fetchTickers === "function") {
      const batchTickers = await exchange.fetchTickers(targetSymbols);
      const receivedAt = this.now();
      const restRoundtripMs = Math.max(0, receivedAt - observedAt);
      return {
        method: "fetchTickers",
        restRoundtripMs,
        ticks: targetSymbols
          .map((symbol) => this.normalizeFallbackTick(symbol, batchTickers?.[symbol], receivedAt, restRoundtripMs))
          .filter(Boolean)
      };
    }

    const ticks = [];
    let maxRestRoundtripMs = 0;
    for (const symbol of targetSymbols) {
      const requestStartedAt = this.now();
      const ticker = await exchange.fetchTicker(symbol);
      const receivedAt = this.now();
      const restRoundtripMs = Math.max(0, receivedAt - requestStartedAt);
      maxRestRoundtripMs = Math.max(maxRestRoundtripMs, restRoundtripMs);
      const tick = this.normalizeFallbackTick(symbol, ticker, receivedAt, restRoundtripMs);
      if (tick) {
        ticks.push(tick);
      }
    }
    return {
      method: "fetchTicker",
      restRoundtripMs: maxRestRoundtripMs,
      ticks
    };
  }

  async fetchRestSnapshot(options: { observedAt?: number } = {}) {
    const generation = this.restSnapshotGeneration;
    const observedAt = Number.isFinite(Number(options.observedAt)) ? Number(options.observedAt) : this.now();
    this.markMarketDataStaleIfExpired(observedAt);
    const targetSymbols = this.getFallbackTargetSymbols(observedAt);
    if (targetSymbols.length <= 0) {
      return {
        method: "skipped_fresh_symbols",
        requestedSymbols: [],
        skippedFreshSymbols: this.symbols.length,
        tickCount: 0
      };
    }

    try {
      const exchange = this.getFallbackExchange();
      const { method, restRoundtripMs, ticks } = await this.fetchFallbackTicks(exchange, targetSymbols, observedAt);
      if (this.stopping || generation !== this.restSnapshotGeneration) {
        return {
          method: "stopped",
          requestedSymbols: targetSymbols,
          skippedFreshSymbols: Math.max(this.symbols.length - targetSymbols.length, 0),
          tickCount: 0
        };
      }

      for (const tick of ticks) {
        this.handleTick(tick);
      }

      this.logger.info("market_rest_snapshot", {
        method,
        requestedSymbols: targetSymbols.join(","),
        restRoundtripMs,
        skippedFreshSymbols: Math.max(this.symbols.length - targetSymbols.length, 0),
        staleAfterMs: this.fallbackStaleAfterMs,
        tickers: ticks.length,
        totalSymbols: this.symbols.length
      });
      return {
        method,
        requestedSymbols: targetSymbols,
        skippedFreshSymbols: Math.max(this.symbols.length - targetSymbols.length, 0),
        tickCount: ticks.length
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.warn("market_rest_snapshot_failed", {
        error: message,
        requestedSymbols: targetSymbols.join(","),
        totalSymbols: this.symbols.length
      });
      return {
        error: message,
        method: "failed",
        requestedSymbols: targetSymbols,
        skippedFreshSymbols: Math.max(this.symbols.length - targetSymbols.length, 0),
        tickCount: 0
      };
    }
  }

  getFallbackExchange() {
    if (!this.fallbackExchange) {
      const ExchangeClass = ccxt[this.fallbackRestUrl];
      this.fallbackExchange = new ExchangeClass({
        enableRateLimit: true,
        options: {
          defaultType: "spot"
        }
      });
    }
    return this.fallbackExchange;
  }

  normalizeHistoricalKline(symbol: string, interval: string, row: unknown, receivedAt: number): MarketKline | null {
    if (!Array.isArray(row) || row.length < 6) {
      return null;
    }
    const openedAt = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (
      !Number.isFinite(openedAt)
      || !Number.isFinite(open)
      || !Number.isFinite(high)
      || !Number.isFinite(low)
      || !Number.isFinite(close)
      || !(close > 0)
    ) {
      return null;
    }
    const closedAt = openedAt + this.timeframeToMs(interval) - 1;
    return {
      close,
      closedAt,
      high,
      interval,
      isClosed: closedAt <= receivedAt,
      low,
      open,
      openedAt,
      receivedAt,
      source: "rest" as const,
      symbol,
      timestamp: closedAt,
      volume: Number.isFinite(volume) ? volume : 0
    };
  }

  timeframeToMs(interval: string) {
    const normalized = String(interval || "").trim();
    const match = normalized.match(/^(\d+)([mhd])$/);
    if (!match) {
      return 60_000;
    }
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
      return 60_000;
    }
    if (match[2] === "m") return value * 60_000;
    if (match[2] === "h") return value * 60 * 60_000;
    return value * 24 * 60 * 60_000;
  }

  async fetchHistoricalKlines(params: {
    symbols: string[];
    interval: string;
    since: number;
    limit: number;
    observedAt?: number;
  }) {
    const observedAt = Number.isFinite(Number(params.observedAt)) ? Number(params.observedAt) : this.now();
    const interval = String(params.interval || "").trim();
    const symbols = [...new Set(params.symbols || [])].map((symbol) => String(symbol || "").trim()).filter(Boolean);
    const since = Math.max(0, Number(params.since) || 0);
    const limit = Math.max(1, Math.floor(Number(params.limit) || 1));
    const exchange = this.getFallbackExchange();
    if (typeof exchange.fetchOHLCV !== "function") {
      throw new Error(`market provider ${this.fallbackRestUrl} does not support fetchOHLCV`);
    }

    const symbolResults = [];
    const klinesBySymbol: Record<string, MarketKline[]> = {};

    for (const symbol of symbols) {
      try {
        const rows = await exchange.fetchOHLCV(symbol, interval, since, limit);
        const klines = (Array.isArray(rows) ? rows : [])
          .map((row: unknown) => this.normalizeHistoricalKline(symbol, interval, row, observedAt))
          .filter(Boolean)
          .sort((a: MarketKline, b: MarketKline) => Number(a.openedAt) - Number(b.openedAt)) as MarketKline[];
        klinesBySymbol[symbol] = klines;
        symbolResults.push({
          error: null,
          klineCount: klines.length,
          symbol
        });
      } catch (error: unknown) {
        klinesBySymbol[symbol] = [];
        symbolResults.push({
          error: getErrorMessage(error),
          klineCount: 0,
          symbol
        });
      }
    }

    return {
      interval,
      klinesBySymbol,
      limit,
      requestedSymbols: symbols,
      since,
      symbolResults
    };
  }

  startRestFallback(observedAt: number = this.now()) {
    if (this.stopping || this.fallbackTimer || this.mode !== "live") return;
    this.store.updateWsConnection("market-stream", {
      connectionId: "market-stream",
      fallbackActive: true
    });
    this.markSymbolsDegraded("rest_fallback_active", observedAt);
    this.markMarketDataStaleIfExpired(observedAt);
    this.fetchRestSnapshot({ observedAt });
    this.fallbackTimer = setInterval(() => {
      const tickObservedAt = this.now();
      this.markSymbolsDegraded("rest_fallback_active", tickObservedAt);
      this.markMarketDataStaleIfExpired(tickObservedAt);
      this.fetchRestSnapshot({ observedAt: tickObservedAt });
    }, this.fallbackIntervalMs);
    if (typeof this.fallbackTimer.unref === "function") {
      this.fallbackTimer.unref();
    }
    this.logger.warn("market_rest_fallback_started", {
      staleAfterMs: this.fallbackStaleAfterMs,
      symbols: this.symbols.join(",")
    });
  }

  stopRestFallback() {
    if (!this.fallbackTimer) {
      this.markMarketDataStaleIfExpired(this.now());
      this.store.updateWsConnection("market-stream", {
        connectionId: "market-stream",
        fallbackActive: false
      });
      return;
    }
    clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    this.markMarketDataStaleIfExpired(this.now());
    this.store.updateWsConnection("market-stream", {
      connectionId: "market-stream",
      fallbackActive: false
    });
    this.logger.info("market_rest_fallback_stopped");
  }
}

module.exports = {
  MarketStream
};
