"use strict";

const { WSManager } = require("../src/core/wsManager.ts");
const { FakeWebSocket } = require("./fakeWebSocket");

function runWsManagerTests() {
  const sockets = [];
  const ticks = [];
  const klines = [];

  const manager = new WSManager({
    logger: { info() {}, warn() {}, error() {} },
    websocketFactory(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    }
  });

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

  sockets[0].emit("open");
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
  if (klines.length !== 1 || klines[0].interval !== "1m" || klines[0].symbol !== "BTC/USDT") {
    throw new Error(`kline normalization failed: ${JSON.stringify(klines)}`);
  }

  disconnect();
  manager.closeAll();
}

module.exports = {
  runWsManagerTests
};
