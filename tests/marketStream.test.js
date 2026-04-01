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

module.exports = {
  runMarketStreamTests
};
