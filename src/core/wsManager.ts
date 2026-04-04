// Module responsibility: manage websocket connections, reconnects and normalized exchange events.

import type { MarketKline, MarketTick } from "../types/market.ts";

const { EventEmitter } = require("node:events");
const { now } = require("../utils/time.ts");

const KNOWN_QUOTES = [
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "TUSD",
  "BTC",
  "ETH",
  "BNB",
  "EUR",
  "TRY"
];

function toBinanceSymbol(symbol: string) {
  return String(symbol || "").replace("/", "").toLowerCase();
}

function fromBinanceSymbol(exchangeSymbol: string) {
  const normalized = String(exchangeSymbol || "").toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return `${normalized.slice(0, -quote.length)}/${quote}`;
    }
  }
  return normalized;
}

function attachSocketHandler(socket: any, eventName: string, handler: (...args: any[]) => void) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(eventName, handler);
    return;
  }

  const propertyName = `on${eventName}`;
  socket[propertyName] = handler;
}

class WSManager {
  emitter: typeof EventEmitter.prototype;
  logger: any;
  websocketFactory: (url: string) => any;
  connections: Map<string, any>;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  maxReconnectAttempts: number;
  reconnectJitterPct: number;
  heartbeatMs: number;
  idleTimeoutMs: number;
  randomFn: () => number;

  constructor(deps: {
    logger?: any;
    websocketFactory?: ((url: string) => any) | null;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
    maxReconnectAttempts?: number;
    reconnectJitterPct?: number;
    heartbeatMs?: number;
    idleTimeoutMs?: number;
    randomFn?: (() => number) | null;
  } = {}) {
    this.emitter = new EventEmitter();
    this.logger = deps.logger || { info() {}, warn() {}, error() {} };
    this.websocketFactory = deps.websocketFactory || ((url: string) => new WebSocket(url));
    this.connections = new Map();
    this.reconnectBaseMs = Math.max(deps.reconnectBaseMs || 1000, 250);
    this.reconnectMaxMs = Math.max(deps.reconnectMaxMs || 15_000, this.reconnectBaseMs);
    this.maxReconnectAttempts = Math.max(Number.isFinite(Number(deps.maxReconnectAttempts)) ? Number(deps.maxReconnectAttempts) : 12, 0);
    this.reconnectJitterPct = Math.min(Math.max(Number.isFinite(Number(deps.reconnectJitterPct)) ? Number(deps.reconnectJitterPct) : 0.2, 0), 0.5);
    this.heartbeatMs = Math.max(deps.heartbeatMs || 10_000, 2000);
    this.idleTimeoutMs = Math.max(deps.idleTimeoutMs || 20_000, this.heartbeatMs * 2);
    this.randomFn = deps.randomFn || Math.random;
  }

  subscribe(channel: string, handler: (...args: any[]) => void) {
    this.emitter.on(channel, handler);
    return () => {
      this.emitter.off(channel, handler);
    };
  }

  publish(channel: string, payload: unknown) {
    this.emitter.emit(channel, payload);
  }

  connectBinanceMarketStream(params: {
    connectionId?: string;
    symbols: string[];
    streamType?: "trade" | "aggTrade";
    klineIntervals?: string[];
    urlBase?: string;
    onTick?: ((tick: MarketTick) => void) | null;
    onKline?: ((kline: MarketKline) => void) | null;
  }) {
    const connectionId = params.connectionId || "binance-market";
    const symbols = [...new Set((params.symbols || []).filter(Boolean))];
    if (symbols.length <= 0) {
      this.logger.warn("ws_skipped", {
        connectionId,
        reason: "no_symbols"
      });
      return () => {};
    }

    const state = this.createState({
      buildUrl: () => {
        const streamNames = this.buildMarketStreamNames(symbols, params.streamType || "trade", params.klineIntervals || []);
        return this.buildCombinedUrl(params.urlBase || "wss://stream.binance.com:9443", streamNames);
      },
      connectionId,
      describe: () => ({
        streamCount: this.buildMarketStreamNames(symbols, params.streamType || "trade", params.klineIntervals || []).length,
        streams: this.buildMarketStreamNames(symbols, params.streamType || "trade", params.klineIntervals || []).join(","),
        symbols: symbols.join(",")
      }),
      handleMessage: (data: any, receivedAt: number) => {
        const normalizedTick = this.normalizeTick(data, receivedAt);
        if (normalizedTick && typeof params.onTick === "function") {
          params.onTick(normalizedTick);
          return;
        }
        const normalizedKline = this.normalizeKline(data, receivedAt);
        if (normalizedKline && typeof params.onKline === "function") {
          params.onKline(normalizedKline);
        }
      },
      kind: "market",
      mode: "live"
    });

    return this.connectState(state);
  }

  connectBinanceUserStream(params: {
    connectionId?: string;
    listenKey: string;
    onUserEvent?: ((event: any) => void) | null;
    urlBase?: string;
  }) {
    if (!params.listenKey) {
      this.logger.warn("ws_skipped", {
        connectionId: params.connectionId || "binance-user",
        reason: "missing_listen_key"
      });
      return () => {};
    }

    const connectionId = params.connectionId || "binance-user";
    const state = this.createState({
      buildUrl: () => this.buildUserUrl(params.urlBase || "wss://stream.binance.com:9443", params.listenKey),
      connectionId,
      describe: () => ({
        listenKey: params.listenKey,
        streamCount: 1
      }),
      handleMessage: (data: any, receivedAt: number) => {
        const normalized = this.normalizeUserEvent(data, receivedAt);
        if (normalized && typeof params.onUserEvent === "function") {
          params.onUserEvent(normalized);
        }
      },
      kind: "user",
      mode: "live"
    });

    return this.connectState(state);
  }

  createState(definition: {
    connectionId: string;
    kind: "market" | "user";
    mode: "live";
    buildUrl: () => string;
    describe: () => Record<string, unknown>;
    handleMessage: (data: any, receivedAt: number) => void;
  }) {
    return {
      ...definition,
      closedManually: false,
      connectedAt: null,
      healthTimer: null,
      lastMessageAt: null,
      lastStatsAt: 0,
      messageCount: 0,
      reconnectAttempt: 0,
      reconnectTimer: null,
      socket: null,
      statsTimer: null,
      degradedAt: null,
      totalLatencyMs: 0,
      totalTicks: 0
    };
  }

  connectState(state: any) {
    this.disconnect(state.connectionId);
    this.connections.set(state.connectionId, state);
    this.openConnection(state);
    return () => {
      this.disconnect(state.connectionId);
    };
  }

  openConnection(state: any) {
    if (state.closedManually) return;
    const url = state.buildUrl();
    const description = state.describe();
    state.lastStatsAt = now();
    state.messageCount = 0;
    state.totalLatencyMs = 0;
    state.totalTicks = 0;
    state.lastMessageAt = null;

    this.publish(`ws:status:${state.connectionId}`, {
      connectionId: state.connectionId,
      mode: state.mode,
      reconnectAttempt: state.reconnectAttempt,
      status: "connecting",
      timestamp: now()
    });
    this.logger.info("ws_connecting", {
      connectionId: state.connectionId,
      url,
      ...description
    });

    let socket;
    try {
      socket = this.websocketFactory(url);
    } catch (error: any) {
      this.logger.error("ws_constructor_failed", {
        connectionId: state.connectionId,
        error: error?.message || String(error)
      });
      this.scheduleReconnect(state, "constructor_failed");
      return;
    }

    state.socket = socket;

    attachSocketHandler(socket, "open", () => {
      state.reconnectAttempt = 0;
      state.degradedAt = null;
      state.connectedAt = now();
      state.lastMessageAt = state.connectedAt;
      this.publish(`ws:status:${state.connectionId}`, {
        connectionId: state.connectionId,
        mode: state.mode,
        reconnectAttempt: 0,
        status: "connected",
        timestamp: state.connectedAt
      });
      this.logger.info("ws_connected", {
        connectionId: state.connectionId,
        ...description
      });
      this.startStatsTimer(state);
      this.startHealthTimer(state);
    });

    attachSocketHandler(socket, "message", (event: any) => {
      this.onSocketMessage(state, event?.data ?? event);
    });

    attachSocketHandler(socket, "error", (event: any) => {
      this.publish(`ws:status:${state.connectionId}`, {
        connectionId: state.connectionId,
        mode: state.mode,
        reconnectAttempt: state.reconnectAttempt,
        status: "error",
        timestamp: now()
      });
      this.logger.warn("ws_error", {
        connectionId: state.connectionId,
        message: event?.message || "socket_error"
      });
    });

    attachSocketHandler(socket, "close", (event: any) => {
      this.stopStatsTimer(state);
      this.stopHealthTimer(state);
      state.socket = null;
      const disconnectedAt = now();
      this.publish(`ws:status:${state.connectionId}`, {
        code: event?.code || 0,
        connectionId: state.connectionId,
        mode: state.mode,
        reason: event?.reason || "",
        reconnectAttempt: state.reconnectAttempt,
        status: "disconnected",
        timestamp: disconnectedAt
      });

      if (state.closedManually) {
        return;
      }

      this.logger.warn("ws_closed", {
        code: event?.code || 0,
        connectionId: state.connectionId,
        reason: event?.reason || "closed"
      });
      this.scheduleReconnect(state, event?.reason || `code_${event?.code || 0}`);
    });
  }

  onSocketMessage(state: any, rawPayload: any) {
    let payload;
    try {
      payload = JSON.parse(String(rawPayload));
    } catch (error: any) {
      this.logger.warn("ws_message_parse_failed", {
        connectionId: state.connectionId,
        error: error?.message || String(error)
      });
      return;
    }

    const receivedAt = now();
    const data = payload?.data || payload;
    state.messageCount += 1;
    state.lastMessageAt = receivedAt;
    this.publish(`ws:status:${state.connectionId}`, {
      connectionId: state.connectionId,
      lastMessageAt: receivedAt,
      mode: state.mode,
      reconnectAttempt: state.reconnectAttempt,
      status: "connected",
      timestamp: receivedAt
    });

    const eventTime = this.extractEventTime(data);
    if (eventTime) {
      state.totalTicks += 1;
      state.totalLatencyMs += Math.max(0, receivedAt - eventTime);
    }
    state.handleMessage(data, receivedAt);
  }

  buildMarketStreamNames(symbols: string[], streamType: string, klineIntervals: string[]) {
    const tradeStreams = symbols.map((symbol) => `${toBinanceSymbol(symbol)}@${streamType}`);
    const klineStreams = [];
    for (const interval of klineIntervals) {
      for (const symbol of symbols) {
        klineStreams.push(`${toBinanceSymbol(symbol)}@kline_${interval}`);
      }
    }
    return [...tradeStreams, ...klineStreams];
  }

  buildCombinedUrl(urlBase: string, streamNames: string[]) {
    const normalizedBase = String(urlBase || "wss://stream.binance.com:9443").replace(/\/+$/, "");
    return `${normalizedBase}/stream?streams=${streamNames.join("/")}`;
  }

  buildUserUrl(urlBase: string, listenKey: string) {
    const normalizedBase = String(urlBase || "wss://stream.binance.com:9443").replace(/\/+$/, "");
    return `${normalizedBase}/ws/${listenKey}`;
  }

  normalizeTick(data: any, receivedAt: number): MarketTick | null {
    if (!data || !data.s || !data.p) return null;
    if (data.e !== "trade" && data.e !== "aggTrade") return null;
    return {
      price: Number(data.p),
      receivedAt,
      source: "ws",
      symbol: fromBinanceSymbol(data.s),
      timestamp: Number(data.T || data.E || now())
    };
  }

  normalizeKline(data: any, receivedAt: number): MarketKline | null {
    if (!data || data.e !== "kline" || !data.k) return null;
    return {
      close: Number(data.k.c),
      closedAt: Number(data.k.T),
      high: Number(data.k.h),
      interval: String(data.k.i),
      isClosed: Boolean(data.k.x),
      low: Number(data.k.l),
      open: Number(data.k.o),
      openedAt: Number(data.k.t),
      receivedAt,
      source: "ws",
      symbol: fromBinanceSymbol(data.k.s || data.s),
      timestamp: Number(data.E || data.k.T || now()),
      volume: Number(data.k.v)
    };
  }

  normalizeUserEvent(data: any, receivedAt: number) {
    if (!data || !data.e) return null;

    if (data.e === "executionReport") {
      return {
        data: {
          cumulativeFilledQty: Number(data.z || 0),
          executionType: data.x || "UNKNOWN",
          lastFillPrice: Number(data.L || 0),
          lastFillQty: Number(data.l || 0),
          orderId: data.i || null,
          orderStatus: data.X || "UNKNOWN",
          orderType: data.o || "UNKNOWN",
          side: String(data.S || "").toLowerCase(),
          symbol: fromBinanceSymbol(data.s),
          timeInForce: data.f || null
        },
        receivedAt,
        symbol: fromBinanceSymbol(data.s),
        timestamp: Number(data.E || data.T || now()),
        type: "order_update"
      };
    }

    if (data.e === "outboundAccountPosition" || data.e === "balanceUpdate") {
      return {
        data: data.e === "outboundAccountPosition"
          ? {
            balances: Array.isArray(data.B)
              ? data.B.map((balance: any) => ({
                asset: balance.a,
                free: Number(balance.f || 0),
                locked: Number(balance.l || 0)
              }))
              : []
          }
          : {
            asset: data.a,
            balanceDelta: Number(data.d || 0),
            clearTime: Number(data.T || 0)
          },
        receivedAt,
        symbol: null,
        timestamp: Number(data.E || data.T || now()),
        type: "balance_update"
      };
    }

    return null;
  }

  extractEventTime(data: any) {
    if (!data) return null;
    if (data.e === "kline" && data.k) {
      return Number(data.E || data.k.T || 0) || null;
    }
    return Number(data.T || data.E || 0) || null;
  }

  startStatsTimer(state: any) {
    this.stopStatsTimer(state);
    state.statsTimer = setInterval(() => {
      const windowMs = Math.max(now() - state.lastStatsAt, 1);
      if (state.messageCount <= 0) return;
      const avgLatencyMs = state.totalTicks > 0 ? state.totalLatencyMs / state.totalTicks : 0;
      this.logger.info("ws_data_flow", {
        avgLatencyMs: avgLatencyMs.toFixed(1),
        connectionId: state.connectionId,
        messages: state.messageCount,
        ticks: state.totalTicks,
        windowMs
      });
      state.lastStatsAt = now();
      state.messageCount = 0;
      state.totalLatencyMs = 0;
      state.totalTicks = 0;
    }, 10_000);
    if (typeof state.statsTimer.unref === "function") {
      state.statsTimer.unref();
    }
  }

  stopStatsTimer(state: any) {
    if (!state?.statsTimer) return;
    clearInterval(state.statsTimer);
    state.statsTimer = null;
  }

  startHealthTimer(state: any) {
    this.stopHealthTimer(state);
    state.healthTimer = setInterval(() => {
      if (!state.socket || !state.lastMessageAt) return;
      const idleMs = now() - state.lastMessageAt;
      if (idleMs < this.idleTimeoutMs) return;
      this.logger.warn("ws_idle_timeout", {
        connectionId: state.connectionId,
        idleMs
      });
      try {
        state.socket.close(4000, "idle_timeout");
      } catch {
        // ignore close errors; reconnect logic will still kick in on close
      }
    }, this.heartbeatMs);
    if (typeof state.healthTimer.unref === "function") {
      state.healthTimer.unref();
    }
  }

  stopHealthTimer(state: any) {
    if (!state?.healthTimer) return;
    clearInterval(state.healthTimer);
    state.healthTimer = null;
  }

  scheduleReconnect(state: any, reason: string) {
    if (state.closedManually) return;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }
    const nextAttempt = state.reconnectAttempt + 1;
    if (nextAttempt > this.maxReconnectAttempts) {
      state.reconnectAttempt = nextAttempt;
      state.degradedAt = now();
      this.publish(`ws:status:${state.connectionId}`, {
        connectionId: state.connectionId,
        mode: state.mode,
        reason,
        reconnectAttempt: state.reconnectAttempt,
        status: "degraded",
        timestamp: state.degradedAt
      });
      this.logger.error("ws_manual_attention_needed", {
        attempt: state.reconnectAttempt,
        connectionId: state.connectionId,
        maxReconnectAttempts: this.maxReconnectAttempts,
        reason
      });
      return;
    }
    state.reconnectAttempt = nextAttempt;
    const baseDelayMs = Math.min(this.reconnectBaseMs * (2 ** (state.reconnectAttempt - 1)), this.reconnectMaxMs);
    const jitterMultiplier = 1 + (((this.randomFn() * 2) - 1) * this.reconnectJitterPct);
    const delayMs = Math.max(Math.round(baseDelayMs * jitterMultiplier), this.reconnectBaseMs);
    this.publish(`ws:status:${state.connectionId}`, {
      connectionId: state.connectionId,
      mode: state.mode,
      reason,
      reconnectAttempt: state.reconnectAttempt,
      status: "reconnecting",
      timestamp: now()
    });
    this.logger.warn("ws_reconnecting", {
      attempt: state.reconnectAttempt,
      baseDelayMs,
      connectionId: state.connectionId,
      delayMs,
      jitterPct: this.reconnectJitterPct,
      reason
    });
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      this.openConnection(state);
    }, delayMs);
    if (typeof state.reconnectTimer.unref === "function") {
      state.reconnectTimer.unref();
    }
  }

  disconnect(connectionId: string) {
    const state = this.connections.get(connectionId);
    if (!state) return;

    state.closedManually = true;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    this.stopStatsTimer(state);
    this.stopHealthTimer(state);

    if (state.socket && typeof state.socket.close === "function") {
      try {
        state.socket.close();
      } catch {
        // ignore close errors during shutdown
      }
    }

    this.connections.delete(connectionId);
  }

  closeAll() {
    for (const connectionId of Array.from(this.connections.keys())) {
      this.disconnect(connectionId);
    }
    this.emitter.removeAllListeners();
  }
}

module.exports = {
  WSManager
};
