"use strict";

const { WSManager } = require("../src/core/wsManager.ts");
const { FakeWebSocket } = require("./fakeWebSocket");

function runWsManagerTests() {
  const sockets = [];
  const ticks = [];
  const klines = [];
  const publishedStatuses = [];
  const logs = [];
  const originalGlobalWebSocket = globalThis.WebSocket;
  let wsNow = 5_000;

  class NativeLikeWebSocket extends FakeWebSocket {}
  const nativeSockets = [];
  globalThis.WebSocket = class extends NativeLikeWebSocket {
    constructor(url) {
      super(url);
      nativeSockets.push(this);
    }
  };
  const nativeFactoryManager = new WSManager({
    logger: {
      info() {},
      warn() {},
      error() {}
    },
    maxReconnectAttempts: 0
  });
  const disconnectNative = nativeFactoryManager.connectBinanceMarketStream({
    connectionId: "native-factory-test",
    onTick() {},
    streamType: "trade",
    symbols: ["BTC/USDT"],
    urlBase: "wss://example.test"
  });
  if (nativeSockets.length !== 1 || !nativeSockets[0].url.includes("btcusdt@trade")) {
    throw new Error(`default ws factory should use globalThis.WebSocket: ${JSON.stringify(nativeSockets.map((socket) => socket.url))}`);
  }
  disconnectNative();
  nativeFactoryManager.closeAll();

  const missingWebSocketLogs = [];
  globalThis.WebSocket = undefined;
  const missingWebSocketManager = new WSManager({
    logger: {
      info(event, metadata) {
        missingWebSocketLogs.push({ event, metadata });
      },
      warn(event, metadata) {
        missingWebSocketLogs.push({ event, metadata });
      },
      error(event, metadata) {
        missingWebSocketLogs.push({ event, metadata });
      }
    },
    maxReconnectAttempts: 0
  });
  missingWebSocketManager.connectBinanceMarketStream({
    connectionId: "missing-native-websocket",
    onTick() {},
    streamType: "trade",
    symbols: ["ETH/USDT"],
    urlBase: "wss://example.test"
  });
  const missingWebSocketLog = missingWebSocketLogs.find((entry) => entry.event === "ws_constructor_failed");
  if (!missingWebSocketLog || !String(missingWebSocketLog.metadata?.error || "").includes("TradingBot requires Node.js >= 22.4.0 with native WebSocket enabled, or an injected websocketFactory.")) {
    throw new Error(`missing native WebSocket should fail with an actionable message: ${JSON.stringify(missingWebSocketLogs)}`);
  }
  missingWebSocketManager.closeAll();
  globalThis.WebSocket = originalGlobalWebSocket;

  const manager = new WSManager({
    clock: {
      now: () => wsNow
    },
    logger: {
      info(event, metadata) {
        logs.push({ event, metadata });
      },
      warn(event, metadata) {
        logs.push({ event, metadata });
      },
      error(event, metadata) {
        logs.push({ event, metadata });
      }
    },
    maxReconnectAttempts: 0,
    randomFn() {
      return 1;
    },
    websocketFactory(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    }
  });

  manager.subscribe("ws:status:test-market", (status) => {
    publishedStatuses.push(status);
  });
  const safePublishDeliveries = [];
  manager.subscribe("test:safe-publish", () => {
    throw new Error("listener boom");
  });
  manager.subscribe("test:safe-publish", (payload) => {
    safePublishDeliveries.push(payload);
  });
  let publishError = null;
  try {
    manager.publish("test:safe-publish", { id: "payload-1" });
  } catch (error) {
    publishError = error;
  }
  if (publishError) {
    throw new Error(`ws publish should not throw when a listener fails: ${publishError.message || publishError}`);
  }
  if (safePublishDeliveries.length !== 1 || safePublishDeliveries[0].id !== "payload-1") {
    throw new Error(`ws publish should continue delivering to later listeners after one fails: ${JSON.stringify(safePublishDeliveries)}`);
  }
  const listenerFailureLog = logs.find((entry) => entry.event === "ws_publish_listener_failed");
  if (!listenerFailureLog || listenerFailureLog.metadata.channel !== "test:safe-publish" || !String(listenerFailureLog.metadata.error || "").includes("listener boom")) {
    throw new Error(`ws publish should log listener failures with channel and error metadata: ${JSON.stringify(logs)}`);
  }

  const disconnect = manager.connectBinanceMarketStream({
    connectionId: "test-market",
    klineIntervals: ["1m"],
    onKline: (kline) => klines.push(kline),
    onTick: (tick) => ticks.push(tick),
    streamType: "trade",
    symbols: ["BTC/USDT"],
    urlBase: "wss://example.test"
  });

  if (sockets.length !== 1) {
    throw new Error("websocket factory was not called");
  }
  if (!sockets[0].url.includes("btcusdt@trade") || !sockets[0].url.includes("btcusdt@kline_1m")) {
    throw new Error(`unexpected combined stream url: ${sockets[0].url}`);
  }

  wsNow = 6_000;
  sockets[0].emit("open");
  wsNow = 7_000;
  sockets[0].emit("message", {
    data: JSON.stringify({
      data: {
        E: 1711960000000,
        T: 1711960000001,
        e: "trade",
        p: "68250.12",
        s: "BTCUSDT"
      },
      stream: "btcusdt@trade"
    })
  });
  sockets[0].emit("message", {
    data: JSON.stringify({
      data: {
        E: 1711960005000,
        e: "kline",
        k: {
          T: 1711960059999,
          c: "68255.50",
          h: "68280.00",
          i: "1m",
          l: "68240.10",
          o: "68245.00",
          s: "BTCUSDT",
          t: 1711960000000,
          v: "12.5",
          x: false
        },
        s: "BTCUSDT"
      },
      stream: "btcusdt@kline_1m"
    })
  });

  if (ticks.length !== 1 || ticks[0].symbol !== "BTC/USDT" || ticks[0].price !== 68250.12) {
    throw new Error(`tick normalization failed: ${JSON.stringify(ticks)}`);
  }
  if (publishedStatuses[0]?.timestamp !== 5_000
    || !publishedStatuses.find((status) => status.status === "connected" && status.timestamp === 6_000)
    || ticks[0].receivedAt !== 7_000) {
    throw new Error(`ws manager should use injected clock for infrastructure timestamps and receivedAt: ${JSON.stringify({ publishedStatuses, ticks })}`);
  }
  if (klines.length !== 1 || klines[0].interval !== "1m" || klines[0].symbol !== "BTC/USDT") {
    throw new Error(`kline normalization failed: ${JSON.stringify(klines)}`);
  }

  sockets[0].emit("close", {
    code: 1006,
    reason: "network_blip"
  });
  const degradedStatus = publishedStatuses.find((status) => status.status === "degraded");
  if (!degradedStatus || degradedStatus.reason !== "network_blip") {
    throw new Error(`ws manager should publish degraded status after retry ceiling is exceeded: ${JSON.stringify(publishedStatuses)}`);
  }
  const manualAttentionLog = logs.find((entry) => entry.event === "ws_manual_attention_needed");
  if (!manualAttentionLog || manualAttentionLog.metadata.maxReconnectAttempts !== 0) {
    throw new Error(`ws manager should log explicit manual attention when retries are exhausted: ${JSON.stringify(logs)}`);
  }

  disconnect();
  manager.closeAll();
}

module.exports = {
  runWsManagerTests
};
