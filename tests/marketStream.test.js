"use strict";

const { WSManager } = require("../src/core/wsManager.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { MarketStream } = require("../src/streams/marketStream.ts");
const { FakeWebSocket } = require("./fakeWebSocket");

function runMarketStreamTests() {
  const store = new StateStore();
  const sockets = [];
  const received = [];

  const wsManager = new WSManager({
    logger: { info() {}, warn() {}, error() {} },
    websocketFactory(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    }
  });

  const stream = new MarketStream({
    klineIntervals: ["1m"],
    liveEmitIntervalMs: 1000,
    logger: { info() {}, warn() {}, error() {} },
    mode: "live",
    store,
    streamType: "trade",
    wsBaseUrl: "wss://example.test",
    wsManager
  });

  stream.subscribe("BTC/USDT", (tick) => {
    received.push(tick);
  });

  stream.start(["BTC/USDT"]);
  if (sockets.length !== 1) {
    throw new Error("live market stream did not open websocket");
  }

  sockets[0].emit("open");
  sockets[0].emit("message", {
    data: JSON.stringify({
      data: {
        E: 1711960000000,
        T: 1711960000001,
        e: "trade",
        p: "68123.45",
        s: "BTCUSDT"
      },
      stream: "btcusdt@trade"
    })
  });

  stream.flushPendingTicks();

  if (received.length !== 1 || received[0].symbol !== "BTC/USDT") {
    throw new Error(`live tick was not published to subscribers: ${JSON.stringify(received)}`);
  }
  if (store.getLatestPrice("BTC/USDT") !== 68123.45) {
    throw new Error(`state store did not receive live price: ${store.getLatestPrice("BTC/USDT")}`);
  }

  stream.stop();
  wsManager.closeAll();
}

function runMarketStreamLiveEmitIntervalTests() {
  function build(deps) {
    const sockets = [];
    const store = new StateStore();
    const wsManager = new WSManager({
      logger: { info() {}, warn() {}, error() {} },
      websocketFactory(url) {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      }
    });
    const stream = new MarketStream({
      logger: { info() {}, warn() {}, error() {} },
      mode: "live",
      store,
      wsManager,
      ...deps
    });
    return { stream, sockets, wsManager, store };
  }

  // Default is 250ms
  (function testDefaultInterval() {
    const { stream, wsManager } = build({});
    if (stream.liveEmitIntervalMs !== 250) {
      throw new Error(`expected default liveEmitIntervalMs 250, got ${stream.liveEmitIntervalMs}`);
    }
    stream.stop();
    wsManager.closeAll();
  })();

  // Explicit higher value is respected
  (function testExplicitHigher() {
    const { stream, wsManager } = build({
      liveEmitIntervalMs: 2000
    });
    if (stream.liveEmitIntervalMs !== 2000) {
      throw new Error(`expected explicit 2000, got ${stream.liveEmitIntervalMs}`);
    }
    stream.stop();
    wsManager.closeAll();
  })();

  // Explicit value below floor is clamped to 250
  (function testExplicitBelowFloor() {
    const { stream, wsManager } = build({
      liveEmitIntervalMs: 100
    });
    if (stream.liveEmitIntervalMs !== 250) {
      throw new Error(`expected floor 250, got ${stream.liveEmitIntervalMs}`);
    }
    stream.stop();
    wsManager.closeAll();
  })();

  // Explicit zero is clamped to floor (250)
  (function testExplicitZero() {
    const { stream, wsManager } = build({
      liveEmitIntervalMs: 0
    });
    if (stream.liveEmitIntervalMs !== 250) {
      throw new Error(`expected floor 250 for zero input, got ${stream.liveEmitIntervalMs}`);
    }
    stream.stop();
    wsManager.closeAll();
  })();

  // flushDelayMs is recorded in tick latency sample
  (function testFlushDelayMsRecorded() {
    const { stream, sockets, wsManager, store } = build({
      liveEmitIntervalMs: 100
    });
    stream.start(["BTC/USDT"]);
    sockets[0].emit("open");

    sockets[0].emit("message", {
      data: JSON.stringify({
        data: {
          E: 1711960000000,
          T: 1711960000001,
          e: "trade",
          p: "50000.00",
          s: "BTCUSDT"
        },
        stream: "btcusdt@trade"
      })
    });

    stream.flushPendingTicks();

    const pipeline = store.getPipelineSnapshot("BTC/USDT");
    if (!pipeline || !pipeline.tickLatency) {
      throw new Error("tick latency sample was not recorded");
    }
    if (typeof pipeline.tickLatency.average.flushDelayMs !== "number") {
      throw new Error(`flushDelayMs not recorded in latency sample, got: ${JSON.stringify(pipeline.tickLatency.average)}`);
    }
    if (pipeline.tickLatency.average.flushDelayMs < 0) {
      throw new Error(`flushDelayMs should be non-negative, got: ${pipeline.tickLatency.average.flushDelayMs}`);
    }

    stream.stop();
    wsManager.closeAll();
  })();

  // Buffering model is unchanged: ticks queued and flushed by interval
  (function testBufferingBehavior() {
    const { stream, sockets, wsManager, store } = build({
      liveEmitIntervalMs: 100
    });
    const received = [];
    stream.subscribe("ETH/USDT", (tick) => {
      received.push(tick);
    });
    stream.start(["ETH/USDT"]);
    sockets[0].emit("open");

    // Send two ticks — should be buffered, not immediately delivered
    sockets[0].emit("message", {
      data: JSON.stringify({
        data: {
          E: 1711960000000,
          T: 1711960000001,
          e: "trade",
          p: "3000.00",
          s: "ETHUSDT"
        },
        stream: "ethusdt@trade"
      })
    });
    sockets[0].emit("message", {
      data: JSON.stringify({
        data: {
          E: 1711960000010,
          T: 1711960000011,
          e: "trade",
          p: "3001.00",
          s: "ETHUSDT"
        },
        stream: "ethusdt@trade"
      })
    });

    // Before flush: buffered, not yet published to subscribers
    if (received.length !== 0) {
      throw new Error(`ticks were not buffered: expected 0, got ${received.length}`);
    }
    // Store should not have the price yet
    if (store.getLatestPrice("ETH/USDT") !== null) {
      throw new Error(`store should not have price before flush, got ${store.getLatestPrice("ETH/USDT")}`);
    }

    // Manual flush
    stream.flushPendingTicks();

    if (received.length !== 1) {
      throw new Error(`expected 1 tick after flush, got ${received.length} (last price: ${store.getLatestPrice("ETH/USDT")})`);
    }
    if (received[received.length - 1].price !== 3001) {
      throw new Error(`expected deduplicated price 3001, got ${received[received.length - 1].price}`);
    }
    if (store.getLatestPrice("ETH/USDT") !== 3001) {
      throw new Error(`store should have latest price 3001 after flush, got ${store.getLatestPrice("ETH/USDT")}`);
    }

    stream.stop();
    wsManager.closeAll();
  })();
}

module.exports = {
  runMarketStreamTests,
  runMarketStreamLiveEmitIntervalTests
};
