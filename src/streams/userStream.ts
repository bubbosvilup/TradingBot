import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "../types/trade.ts";
import type { Clock } from "../core/clock.ts";

const { resolveClock } = require("../core/clock.ts");

const DEFAULT_USER_STREAM_REQUEST_TIMEOUT_MS = 10_000;

interface OrderUpdatePayload {
  order?: OrderRecord | null;
  position?: PositionRecord | null;
  trade?: ClosedTradeRecord | null;
  type?: string;
}

interface StreamEventPayload {
  symbol?: string | null;
  timestamp?: number | null;
}

interface NormalizedUserEvent {
  data: unknown;
  symbol: string | null;
  timestamp: number;
  type: string;
}

function normalizeRequestTimeoutMs(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0
    ? Math.floor(normalized)
    : DEFAULT_USER_STREAM_REQUEST_TIMEOUT_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown) {
  return isRecord(error) && error.name === "TimeoutError";
}

function normalizePositionLifecycle(payload: OrderUpdatePayload, fallbackTimestamp: number): NormalizedUserEvent | null {
  const timestamp = payload.order?.timestamp || payload.trade?.closedAt || fallbackTimestamp;
  if (payload.type === "opened" && payload.position) {
    return {
      data: {
        position: payload.position,
        status: "open"
      },
      symbol: payload.position.symbol,
      timestamp,
      type: "position_update"
    };
  }

  if (payload.type === "closed" && payload.trade) {
    return {
      data: {
        position: null,
        status: "closed",
        trade: payload.trade
      },
      symbol: payload.trade.symbol,
      timestamp,
      type: "position_update"
    };
  }

  return null;
}

class UserStream {
  wsManager: any;
  store: any;
  logger: any;
  apiKey: string | null;
  restBaseUrl: string;
  wsBaseUrl: string;
  keepAliveTimer: NodeJS.Timeout | null;
  disconnectRemote: (() => void) | null;
  unsubscribeWsStatus: (() => void) | null;
  listenKey: string | null;
  requestTimeoutMs: number;
  clock: Clock;

  constructor(deps: {
    apiKey?: string | null;
    clock?: Clock;
    logger?: any;
    requestTimeoutMs?: number;
    store: any;
    userStreamRequestTimeoutMs?: number;
    restBaseUrl?: string;
    wsBaseUrl?: string;
    wsManager: any;
  }) {
    this.clock = resolveClock(deps.clock);
    this.wsManager = deps.wsManager;
    this.store = deps.store;
    this.logger = deps.logger || { info() {}, warn() {}, error() {} };
    this.apiKey = deps.apiKey || null;
    this.requestTimeoutMs = normalizeRequestTimeoutMs(deps.requestTimeoutMs ?? deps.userStreamRequestTimeoutMs);
    this.restBaseUrl = deps.restBaseUrl || "https://api.binance.com";
    this.wsBaseUrl = deps.wsBaseUrl || "wss://stream.binance.com:9443";
    this.keepAliveTimer = null;
    this.disconnectRemote = null;
    this.unsubscribeWsStatus = null;
    this.listenKey = null;
  }

  now() {
    return this.clock.now();
  }

  async start(options: { enabled?: boolean; mode?: "live"; reason?: string } = {}) {
    if (options.enabled === false) {
      this.store.updateWsConnection("user-stream", {
        lastReason: options.reason || "disabled",
        mode: options.mode || "live",
        status: "disabled"
      });
      this.logger.info("user_stream_disabled", {
        mode: options.mode || "live",
        reason: options.reason || "disabled"
      });
      return;
    }

    if (!this.apiKey) {
      this.store.updateWsConnection("user-stream", {
        mode: "live",
        status: "disabled",
        lastReason: "missing_api_key"
      });
      this.logger.info("user_stream_disabled", {
        reason: "missing_api_key"
      });
      return;
    }

    const listenKey = await this.createListenKey();
    if (!listenKey) {
      return;
    }

    this.listenKey = listenKey;
    this.unsubscribeWsStatus = this.wsManager.subscribe("ws:status:user-stream", (status: unknown) => {
      const statusPayload = isRecord(status) ? status : {};
      this.store.updateWsConnection("user-stream", {
        connectionId: "user-stream",
        fallbackActive: false,
        lastConnectedAt: statusPayload.status === "connected" ? (statusPayload.timestamp || this.now()) : undefined,
        lastDisconnectedAt: statusPayload.status === "disconnected" ? (statusPayload.timestamp || this.now()) : undefined,
        lastMessageAt: statusPayload.lastMessageAt || undefined,
        lastReason: statusPayload.reason || null,
        mode: "live",
        reconnectAttempt: statusPayload.reconnectAttempt || 0,
        status: statusPayload.status || "unknown"
      });
    });
    this.disconnectRemote = this.wsManager.connectBinanceUserStream({
      connectionId: "user-stream",
      listenKey,
      onUserEvent: (event: unknown) => {
        this.handleRemoteUserEvent(event);
      },
      urlBase: this.wsBaseUrl
    });

    this.startKeepAlive();
  }

  async stop() {
    if (this.disconnectRemote) {
      this.disconnectRemote();
      this.disconnectRemote = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    if (this.unsubscribeWsStatus) {
      this.unsubscribeWsStatus();
      this.unsubscribeWsStatus = null;
    }
    if (this.listenKey) {
      await this.deleteListenKey(this.listenKey);
      this.listenKey = null;
    }
  }

  publishOrderUpdate(payload: OrderUpdatePayload) {
    const order = payload?.order || null;
    const timestamp = order?.timestamp || this.now();

    if (order) {
      this.store.appendOrder(order.botId, order);
    }
    if (payload?.position !== undefined) {
      this.store.setPosition(order?.botId || payload.position?.botId, payload.position || null);
    }
    if (payload?.trade) {
      this.store.appendClosedTrade(payload.trade.botId, payload.trade);
    }

    this.emitNormalized({
      data: payload,
      symbol: order?.symbol || payload?.trade?.symbol || null,
      timestamp,
      type: "order_update"
    });

    const positionEvent = normalizePositionLifecycle(payload, timestamp);
    if (positionEvent) {
      this.emitNormalized(positionEvent);
    }
  }

  publishFillUpdate(payload: unknown) {
    const data = payload && typeof payload === "object" ? payload as StreamEventPayload : null;
    this.emitNormalized({
      data: payload,
      symbol: data?.symbol || null,
      timestamp: data?.timestamp || this.now(),
      type: "fill_update"
    });
  }

  publishBalanceUpdate(payload: unknown) {
    const data = payload && typeof payload === "object" ? payload as StreamEventPayload : null;
    this.emitNormalized({
      data: payload,
      symbol: null,
      timestamp: data?.timestamp || this.now(),
      type: "balance_update"
    });
  }

  emitNormalized(event: NormalizedUserEvent) {
    this.wsManager.publish("user:events", event);
    if (event.type === "order_update") {
      this.wsManager.publish("user:orders", event);
    }
    if (event.type === "position_update") {
      this.wsManager.publish("user:positions", event);
    }
    if (event.type === "balance_update") {
      this.wsManager.publish("user:balances", event);
    }
    if (event.type === "fill_update") {
      this.wsManager.publish("user:fills", event);
    }
  }

  subscribe(handler: (...args: unknown[]) => void) {
    return this.wsManager.subscribe("user:events", handler);
  }

  handleRemoteUserEvent(event: unknown) {
    if (!event) return;
    const eventPayload = isRecord(event) ? event : {};
    this.emitNormalized(event as NormalizedUserEvent);
    this.logger.info("user_stream_event_processed", {
      symbol: eventPayload.symbol || "n/a",
      type: eventPayload.type
    });
  }

  async createListenKey() {
    try {
      const response = await this.fetchWithTimeout("create_listen_key", `${this.restBaseUrl}/api/v3/userDataStream`, {
        headers: {
          "X-MBX-APIKEY": this.apiKey
        },
        method: "POST"
      });

      if (!response.ok) {
        this.store.updateWsConnection("user-stream", {
          lastReason: `listen_key_${response.status}`,
          mode: "live",
          status: "error"
        });
        this.logger.warn("user_stream_listen_key_failed", {
          status: response.status
        });
        return null;
      }

      const payload: unknown = await response.json();
      const listenKey = isRecord(payload) ? readString(payload.listenKey) : null;
      this.store.updateWsConnection("user-stream", {
        mode: "live",
        status: "connecting"
      });
      return listenKey;
    } catch (error: unknown) {
      const timedOut = isTimeoutError(error);
      const message = getErrorMessage(error);
      this.store.updateWsConnection("user-stream", {
        lastReason: timedOut ? "listen_key_timeout" : (message || "listen_key_error"),
        mode: "live",
        status: "disconnected"
      });
      this.logger.warn("user_stream_listen_key_failed", {
        error: timedOut ? undefined : message,
        operation: "create_listen_key",
        reason: timedOut ? "timeout" : "fetch_error",
        timeoutMs: timedOut ? this.requestTimeoutMs : undefined
      });
      return null;
    }
  }

  startKeepAlive() {
    if (!this.listenKey) return;
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
    this.keepAliveTimer = setInterval(() => {
      this.keepAliveListenKey(this.listenKey).catch((error: unknown) => {
        this.logger.warn("user_stream_keepalive_failed", {
          action: "manual_attention_needed",
          error: getErrorMessage(error),
          operation: "keepalive_listen_key",
          reason: "unexpected_error"
        });
      });
    }, 25 * 60 * 1000);
    if (typeof this.keepAliveTimer.unref === "function") {
      this.keepAliveTimer.unref();
    }
  }

  async keepAliveListenKey(listenKey: string) {
    try {
      const response = await this.fetchWithTimeout("keepalive_listen_key", `${this.restBaseUrl}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`, {
        headers: {
          "X-MBX-APIKEY": this.apiKey
        },
        method: "PUT"
      });
      if (!response.ok) {
        this.handleKeepAliveFailure(`keepalive_${response.status}`);
        this.logger.warn("user_stream_keepalive_failed", {
          action: "manual_attention_needed",
          status: response.status
        });
      }
    } catch (error: unknown) {
      const timedOut = isTimeoutError(error);
      const message = getErrorMessage(error);
      this.handleKeepAliveFailure(timedOut ? "keepalive_timeout" : (message || "keepalive_error"));
      this.logger.warn("user_stream_keepalive_failed", {
        action: "manual_attention_needed",
        error: timedOut ? undefined : message,
        operation: "keepalive_listen_key",
        reason: timedOut ? "timeout" : "fetch_error",
        timeoutMs: timedOut ? this.requestTimeoutMs : undefined
      });
    }
  }

  async deleteListenKey(listenKey: string) {
    if (!this.apiKey) return;
    try {
      await this.fetchWithTimeout("delete_listen_key", `${this.restBaseUrl}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`, {
        headers: {
          "X-MBX-APIKEY": this.apiKey
        },
        method: "DELETE"
      });
    } catch (error: unknown) {
      this.logger.warn("user_stream_delete_listen_key_failed", {
        error: isTimeoutError(error) ? undefined : getErrorMessage(error),
        operation: "delete_listen_key",
        reason: isTimeoutError(error) ? "timeout" : "fetch_error",
        timeoutMs: isTimeoutError(error) ? this.requestTimeoutMs : undefined
      });
      // best effort cleanup
    }
  }

  async fetchWithTimeout(operation: string, url: string, init: RequestInit) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error: unknown) {
      if (timedOut || (isRecord(error) && error.name === "AbortError")) {
        const timeoutError = new Error(`${operation}_timeout`);
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  handleKeepAliveFailure(reason: string) {
    this.store.updateWsConnection("user-stream", {
      lastReason: reason,
      mode: "live",
      status: "degraded"
    });
  }
}

module.exports = {
  UserStream
};
