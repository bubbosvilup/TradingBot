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

async function runMarketStreamLiveEmitIntervalTests() {
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

  (function testCanonicalLatencyLogShape() {
    const logs = [];
    const { stream, sockets, wsManager } = build({
      logger: {
        info(event, metadata) {
          logs.push({ event, metadata });
        },
        warn(event, metadata) {
          logs.push({ event, metadata });
        },
        error() {}
      },
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

    const latencyLog = logs.find((entry) => entry.event === "tick_pipeline_latency" || entry.event === "tick_pipeline_latency_high");
    const latency = latencyLog ? JSON.parse(latencyLog.metadata.latency) : null;
    if (!latencyLog || latency?.source !== "ws" || !Number.isFinite(Number(latency?.totalMs))) {
      throw new Error(`tick pipeline latency log should expose canonical latency payload: ${JSON.stringify(logs)}`);
    }
    if ("totalPipelineMs" in latencyLog.metadata || "flushDelayMs" in latencyLog.metadata || "transportBreakdown" in latencyLog.metadata) {
      throw new Error(`tick pipeline latency log should not expose duplicated legacy top-level fields: ${JSON.stringify(latencyLog)}`);
    }

    stream.stop();
    wsManager.closeAll();
  })();

  {
    const { stream, wsManager } = build({});
    const calls = [];
    stream.fallbackExchange = {
      async fetchOHLCV(symbol, interval, since, limit) {
        calls.push({ interval, limit, since, symbol });
        return [
          [2_000, "101", "103", "100", "102", "12"],
          [1_000, "100", "102", "99", "101", "10"]
        ];
      }
    };
    const result = await stream.fetchHistoricalKlines({
      interval: "1m",
      limit: 2,
      observedAt: 200_000,
      since: 1_000,
      symbols: ["BTC/USDT"]
    });
    if (calls.length !== 1 || calls[0].symbol !== "BTC/USDT" || calls[0].interval !== "1m") {
      throw new Error(`historical fetch should use the stream's configured REST exchange: ${JSON.stringify(calls)}`);
    }
    const klines = result.klinesBySymbol["BTC/USDT"];
    if (!Array.isArray(klines) || klines.length !== 2 || klines[0].openedAt !== 1_000 || klines[0].source !== "rest") {
      throw new Error(`historical klines should be normalized and sorted: ${JSON.stringify(result)}`);
    }
    stream.stop();
    wsManager.closeAll();
  }

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

async function runMarketStreamRestFallbackTests() {
  const originalDateNow = Date.now;
  try {
    Date.now = () => 1_000;
    const store = new StateStore();
    const logs = [];
    const stream = new MarketStream({
      logger: {
        info(event, metadata) {
          logs.push({ event, metadata });
        },
        warn(event, metadata) {
          logs.push({ event, metadata });
        },
        error() {}
      },
      mode: "live",
      store,
      wsManager: new WSManager({
        logger: { info() {}, warn() {}, error() {} },
        websocketFactory(url) {
          return new FakeWebSocket(url);
        }
      })
    });
    stream.symbols = ["BTC/USDT", "ETH/USDT"];

    store.updatePrice({
      price: 50000,
      receivedAt: 1_000,
      source: "ws",
      symbol: "BTC/USDT",
      timestamp: 1_000
    });
    store.updatePrice({
      price: 3000,
      receivedAt: 1_000,
      source: "ws",
      symbol: "ETH/USDT",
      timestamp: 1_000
    });

    let fetchTickerCalls = 0;
    let fetchTickersCalls = 0;
    stream.fallbackExchange = {
      async fetchTicker(symbol) {
        fetchTickerCalls += 1;
        return {
          last: symbol === "BTC/USDT" ? 50100 : 3010,
          timestamp: 7_000
        };
      },
      async fetchTickers(symbols) {
        fetchTickersCalls += 1;
        return symbols.reduce((result, symbol) => {
          result[symbol] = {
            last: symbol === "BTC/USDT" ? 50100 : 3010,
            timestamp: 7_000
          };
          return result;
        }, {});
      }
    };

    const skippedFresh = await stream.fetchRestSnapshot({ observedAt: 4_000 });
    if (skippedFresh.method !== "skipped_fresh_symbols" || fetchTickerCalls !== 0 || fetchTickersCalls !== 0) {
      throw new Error(`rest fallback should skip fresh symbols without touching the exchange: ${JSON.stringify({ skippedFresh, fetchTickerCalls, fetchTickersCalls })}`);
    }

    Date.now = () => 7_000;
    const staleBatch = await stream.fetchRestSnapshot({ observedAt: 7_000 });
    if (staleBatch.method !== "fetchTickers" || fetchTickersCalls !== 1 || fetchTickerCalls !== 0) {
      throw new Error(`rest fallback should use a single batch fetch when multiple stale symbols need refresh: ${JSON.stringify({ staleBatch, fetchTickerCalls, fetchTickersCalls })}`);
    }
    if (store.getLatestPrice("BTC/USDT") !== 50100 || store.getLatestPrice("ETH/USDT") !== 3010) {
      throw new Error("rest fallback batch refresh should update latest prices for all stale symbols");
    }
    const restPipeline = store.getPipelineSnapshot("BTC/USDT");
    if (restPipeline?.source !== "rest" || restPipeline.restRoundtripMs !== 0 || restPipeline.exchangeToReceiveMs !== 0) {
      throw new Error(`rest fallback should mark latency source and roundtrip explicitly: ${JSON.stringify(restPipeline)}`);
    }

    Date.now = () => 9_000;
    store.updatePrice({
      price: 3015,
      receivedAt: 9_000,
      source: "ws",
      symbol: "ETH/USDT",
      timestamp: 9_000
    });
    const narrowed = await stream.fetchRestSnapshot({ observedAt: 12_000 });
    if (narrowed.method !== "fetchTicker" || fetchTickerCalls !== 1) {
      throw new Error(`rest fallback should narrow to only stale symbols when others are still fresh: ${JSON.stringify({ narrowed, fetchTickerCalls, fetchTickersCalls })}`);
    }
    if (!Array.isArray(narrowed.requestedSymbols) || narrowed.requestedSymbols.length !== 1 || narrowed.requestedSymbols[0] !== "BTC/USDT") {
      throw new Error(`rest fallback should request only the stale symbol: ${JSON.stringify(narrowed)}`);
    }

    const snapshotLog = logs.find((entry) => entry.event === "market_rest_snapshot" && entry.metadata.method === "fetchTickers");
    if (!snapshotLog || snapshotLog.metadata.skippedFreshSymbols !== 0 || snapshotLog.metadata.totalSymbols !== 2 || snapshotLog.metadata.restRoundtripMs !== 0) {
      throw new Error(`rest fallback diagnostics should report request scope and method clearly: ${JSON.stringify(logs)}`);
    }
  } finally {
    Date.now = originalDateNow;
  }
}

module.exports = {
  runMarketStreamTests,
  runMarketStreamLiveEmitIntervalTests,
  runMarketStreamRestFallbackTests
};
