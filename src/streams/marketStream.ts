// Module responsibility: normalize market data into stateStore updates without embedding business logic.

import type { MarketKline, MarketMode, MarketTick } from "../types/market.ts";

const ccxt = require("ccxt");
const { elapsedMs, startTimer } = require("../utils/timing.ts");
const { now } = require("../utils/time.ts");

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
  highLatencyWarnMs: number;
  latencyLogIntervalMs: number;
  lastLatencyLogAtBySymbol: Map<string, number>;

  constructor(deps: {
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
    this.wsManager = deps.wsManager;
    this.store = deps.store;
    this.logger = deps.logger;
    this.flushTimer = null;
    this.symbols = [];
    if (deps.mode && deps.mode !== "live") {
      throw new Error(`market stream mode ${deps.mode} is not supported; active runtime market data is live-only`);
    }
    this.mode = "live";
    this.liveEmitIntervalMs = Math.max(deps.liveEmitIntervalMs ?? 250, 250);
    this.streamType = deps.streamType || "trade";
    this.wsBaseUrl = deps.wsBaseUrl || "wss://stream.binance.com:9443";
    this.klineIntervals = [...new Set(deps.klineIntervals || [])];
    this.disconnectLiveFeed = null;
    this.unsubscribeWsStatus = null;
    this.pendingTicks = new Map();
    this.fallbackTimer = null;
    this.fallbackExchange = null;
    this.fallbackRestUrl = deps.restExchangeId || "binance";
    this.highLatencyWarnMs = 1000;
    this.latencyLogIntervalMs = 30_000;
    this.lastLatencyLogAtBySymbol = new Map();
  }

  start(symbols: string[]) {
    this.stop();
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
    this.unsubscribeWsStatus = this.wsManager.subscribe("ws:status:market-stream", (status: any) => {
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

  handleWsStatus(status: any) {
    this.store.updateWsConnection("market-stream", {
      connectionId: "market-stream",
      fallbackActive: Boolean(this.fallbackTimer),
      lastConnectedAt: status.status === "connected" ? status.timestamp : undefined,
      lastDisconnectedAt: status.status === "disconnected" ? status.timestamp : undefined,
      lastMessageAt: status.lastMessageAt || undefined,
      lastReason: status.reason || null,
      mode: this.mode,
      reconnectAttempt: status.reconnectAttempt || 0,
      status: status.status || "unknown"
    });

    if (status.status === "connected") {
      this.stopRestFallback();
    } else if (status.status === "disconnected" || status.status === "reconnecting" || status.status === "error") {
      this.startRestFallback();
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
      ? Math.max(0, Date.now() - tick.receivedAt)
      : 0;
    const stateTimer = startTimer();
    this.store.updatePrice(tick);
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
      }, tick.receivedAt || Date.now());
    }
    this.maybeLogTickLatency(tick, totalTickPipelineMs);
  }

  maybeLogTickLatency(tick: MarketTick, totalTickPipelineMs: number) {
    const pipeline = typeof this.store.getPipelineSnapshot === "function"
      ? this.store.getPipelineSnapshot(tick.symbol)
      : null;
    const tickLatency = pipeline?.tickLatency || null;
    if (!tickLatency) {
      return;
    }

    const loggedAt = Date.now();
    const lastLoggedAt = this.lastLatencyLogAtBySymbol.get(tick.symbol) || 0;
    const shouldWarn = totalTickPipelineMs >= this.highLatencyWarnMs;
    const shouldSample = (loggedAt - lastLoggedAt) >= this.latencyLogIntervalMs;
    if (!shouldWarn && !shouldSample) {
      return;
    }

    this.lastLatencyLogAtBySymbol.set(tick.symbol, loggedAt);
    const transport = {
      botToExecutionMs: pipeline?.botToExecutionMs ?? null,
      exchangeToReceiveMs: pipeline?.exchangeToReceiveMs ?? null,
      receiveToStateMs: pipeline?.receiveToStateMs ?? null,
      stateToBotMs: pipeline?.stateToBotMs ?? null
    };
    const wsToStoreMs = pipeline?.receiveToStateMs ?? null;
    const payload = {
      exchangeToWsMs: pipeline?.exchangeToReceiveMs ?? null,
      flushDelayMs: tickLatency.last.flushDelayMs,
      publishFanoutMs: tickLatency.last.publishFanoutMs,
      recentWorstTotalMs: tickLatency.recentWorstTotalMs,
      sampleCount: tickLatency.sampleCount,
      source: tick.source,
      stageAverage: JSON.stringify(tickLatency.average),
      stageLast: JSON.stringify(tickLatency.last),
      stageMax: JSON.stringify(tickLatency.max),
      stateUpdateMs: tickLatency.last.stateUpdateMs,
      symbol: tick.symbol,
      tickTimestamp: tick.timestamp,
      totalPipelineMs: tickLatency.last.totalTickPipelineMs,
      transportBreakdown: JSON.stringify(transport),
      wsToStoreMs
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

  async fetchRestSnapshot() {
    try {
      const exchange = this.getFallbackExchange();
      const tickers = await Promise.all(this.symbols.map(async (symbol) => {
        const ticker = await exchange.fetchTicker(symbol);
        return {
          price: Number(ticker.last || ticker.close || 0),
          receivedAt: now(),
          source: "rest" as const,
          symbol,
          timestamp: Number(ticker.timestamp || now())
        };
      }));

      for (const tick of tickers) {
        if (tick.price > 0) {
          this.handleTick(tick);
        }
      }

      this.logger.info("market_rest_snapshot", {
        symbols: this.symbols.join(","),
        tickers: tickers.length
      });
    } catch (error: any) {
      this.logger.warn("market_rest_snapshot_failed", {
        error: error?.message || String(error)
      });
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

  startRestFallback() {
    if (this.fallbackTimer || this.mode !== "live") return;
    this.store.updateWsConnection("market-stream", {
      connectionId: "market-stream",
      fallbackActive: true
    });
    this.fetchRestSnapshot();
    this.fallbackTimer = setInterval(() => {
      this.fetchRestSnapshot();
    }, 5000);
    if (typeof this.fallbackTimer.unref === "function") {
      this.fallbackTimer.unref();
    }
    this.logger.warn("market_rest_fallback_started", {
      symbols: this.symbols.join(",")
    });
  }

  stopRestFallback() {
    if (!this.fallbackTimer) {
      this.store.updateWsConnection("market-stream", {
        connectionId: "market-stream",
        fallbackActive: false
      });
      return;
    }
    clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
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
