// Module responsibility: user/order/account event bus isolated from trading logic and prepared for live Binance updates.

function normalizePositionLifecycle(payload) {
  const timestamp = payload.order?.timestamp || payload.trade?.closedAt || Date.now();
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

  constructor(deps: { wsManager: any; store: any; logger?: any; apiKey?: string | null; restBaseUrl?: string; wsBaseUrl?: string }) {
    this.wsManager = deps.wsManager;
    this.store = deps.store;
    this.logger = deps.logger || { info() {}, warn() {}, error() {} };
    this.apiKey = deps.apiKey || null;
    this.restBaseUrl = deps.restBaseUrl || "https://api.binance.com";
    this.wsBaseUrl = deps.wsBaseUrl || "wss://stream.binance.com:9443";
    this.keepAliveTimer = null;
    this.disconnectRemote = null;
    this.unsubscribeWsStatus = null;
    this.listenKey = null;
  }

  async start(options: { enabled?: boolean } = {}) {
    if (options.enabled === false) {
      this.store.updateWsConnection("user-stream", {
        mode: "mock",
        status: "disabled"
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
    this.unsubscribeWsStatus = this.wsManager.subscribe("ws:status:user-stream", (status: any) => {
      this.store.updateWsConnection("user-stream", {
        connectionId: "user-stream",
        fallbackActive: false,
        lastConnectedAt: status.status === "connected" ? status.timestamp : undefined,
        lastDisconnectedAt: status.status === "disconnected" ? status.timestamp : undefined,
        lastMessageAt: status.lastMessageAt || undefined,
        lastReason: status.reason || null,
        mode: "live",
        reconnectAttempt: status.reconnectAttempt || 0,
        status: status.status || "unknown"
      });
    });
    this.disconnectRemote = this.wsManager.connectBinanceUserStream({
      connectionId: "user-stream",
      listenKey,
      onUserEvent: (event: any) => {
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

  publishOrderUpdate(payload: any) {
    const order = payload?.order || null;
    const timestamp = order?.timestamp || Date.now();

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

    const positionEvent = normalizePositionLifecycle(payload);
    if (positionEvent) {
      this.emitNormalized(positionEvent);
    }
  }

  publishFillUpdate(payload: unknown) {
    this.emitNormalized({
      data: payload,
      symbol: payload && typeof payload === "object" ? payload.symbol || null : null,
      timestamp: payload && typeof payload === "object" ? payload.timestamp || Date.now() : Date.now(),
      type: "fill_update"
    });
  }

  publishBalanceUpdate(payload: unknown) {
    this.emitNormalized({
      data: payload,
      symbol: null,
      timestamp: payload && typeof payload === "object" ? payload.timestamp || Date.now() : Date.now(),
      type: "balance_update"
    });
  }

  emitNormalized(event: any) {
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

  subscribe(handler: (...args: any[]) => void) {
    return this.wsManager.subscribe("user:events", handler);
  }

  subscribeOrders(handler: (...args: any[]) => void) {
    return this.wsManager.subscribe("user:orders", handler);
  }

  subscribePositions(handler: (...args: any[]) => void) {
    return this.wsManager.subscribe("user:positions", handler);
  }

  subscribeFills(handler: (...args: any[]) => void) {
    return this.wsManager.subscribe("user:fills", handler);
  }

  subscribeBalances(handler: (...args: any[]) => void) {
    return this.wsManager.subscribe("user:balances", handler);
  }

  handleRemoteUserEvent(event: any) {
    if (!event) return;
    this.emitNormalized(event);
    this.logger.info("user_stream_event_processed", {
      symbol: event.symbol || "n/a",
      type: event.type
    });
  }

  async createListenKey() {
    try {
      const response = await fetch(`${this.restBaseUrl}/api/v3/userDataStream`, {
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

      const payload = await response.json();
      const listenKey = payload?.listenKey || null;
      this.store.updateWsConnection("user-stream", {
        mode: "live",
        status: "connecting"
      });
      return listenKey;
    } catch (error: any) {
      this.store.updateWsConnection("user-stream", {
        lastReason: error?.message || "listen_key_error",
        mode: "live",
        status: "error"
      });
      this.logger.warn("user_stream_listen_key_failed", {
        error: error?.message || String(error)
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
      this.keepAliveListenKey(this.listenKey);
    }, 25 * 60 * 1000);
    if (typeof this.keepAliveTimer.unref === "function") {
      this.keepAliveTimer.unref();
    }
  }

  async keepAliveListenKey(listenKey: string) {
    try {
      await fetch(`${this.restBaseUrl}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`, {
        headers: {
          "X-MBX-APIKEY": this.apiKey
        },
        method: "PUT"
      });
    } catch (error: any) {
      this.logger.warn("user_stream_keepalive_failed", {
        error: error?.message || String(error)
      });
    }
  }

  async deleteListenKey(listenKey: string) {
    if (!this.apiKey) return;
    try {
      await fetch(`${this.restBaseUrl}/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`, {
        headers: {
          "X-MBX-APIKEY": this.apiKey
        },
        method: "DELETE"
      });
    } catch {
      // best effort cleanup
    }
  }
}

module.exports = {
  UserStream
};
