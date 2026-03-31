"use strict";

const http = require("http");
const path = require("path");
const assert = require("node:assert/strict");

const { createServerApi } = require("../src/server");

function readJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve({ body: JSON.parse(body), statusCode: response.statusCode });
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function runServerTests() {
  const state = {
    bestCandidateSymbol: "RNDR/USDT",
    botActive: true,
    botStartedAt: "2026-03-30T10:00:00.000Z",
    btcRegime: "neutral",
    candleData: {},
    exchange: "binance",
    lastUpdate: "2026-03-30T10:05:00.000Z",
    markets: {
      "RNDR/USDT": {
        action: "WAIT",
        atr14_5m: 0.12,
        compositeScore: 7,
        currentVolume_5m: 80,
        decisionState: "wait_volume",
        detailedExplanation: "Dettaglio test.",
        displayAction: "WAIT",
        ema20_1h: 7.0,
        ema21_5m: 7.02,
        ema50_1h: 6.9,
        ema9_5m: 7.04,
        entryBlockers: ["Volume 5m insufficiente"],
        entryCount: 0,
        entryEngine: "trend_continuation",
        entryPrice: null,
        exitReasonCode: null,
        highWaterMark: null,
        holdCandles: 0,
        lastPrice: 7.03,
        macdHistogram: 0.1,
        macdLine: 0.2,
        missingIndicators: [],
        reason: "Setup valido ma ingresso bloccato.",
        reasonList: ["Decision state: wait_volume"],
        rsi: 53.3,
        rsi_5m: 53.3,
        score: 7,
        shortExplanation: "Spiegazione breve.",
        signal: "BUY candidate",
        signalLine: 0.1,
        stopLoss: null,
        symbol: "RNDR/USDT",
        takeProfit: null,
        trailingStop: null,
        trend: "rialzista",
        trendBull_1h: true,
        trendLateral: false,
        trendSlope_1h: 0.002,
        triggerFired: true,
        volumeSMA20: 100,
        warmingUp: false
      }
    },
    paperTrading: true,
    positions: [],
    runtime: {
      lastCompletedCycleAt: "2026-03-30T10:05:05.000Z",
      lastCycleDurationMs: 250,
      realtimeSymbols: ["RNDR/USDT"],
      restSymbolCount: 0,
      scanCycle: 12
    },
    strategyName: "mtf-trend-following-1h-5m-1m",
    trades: [],
    usdtBalance: 100,
    watchlist: {
      activeSymbols: ["RNDR/USDT"],
      hotPool: ["RNDR/USDT", "BTC/USDT"],
      lastPoolRefreshAt: "2026-03-30T10:04:00.000Z",
      lastRotationAt: "2026-03-30T10:04:30.000Z",
      lastRotationSummary: null,
      recentSwaps: [],
      source: "dynamic",
      weakThresholdRsi: 45
    }
  };

  let btcFilterEnabled = true;
  const context = {
    config: {
      DEFAULT_SYMBOL: "BTC/USDT",
      EXIT_FEE_BPS: 10,
      INITIAL_USDT_BALANCE: 100,
      MAX_CONCURRENT_POSITIONS: 3,
      MAX_POSITION_EXPOSURE_PCT: 0.85,
      PUBLIC_DIR: path.join(process.cwd(), "public"),
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: 0
    },
    getBtcFilterEnabled: () => btcFilterEnabled,
    getSymbols: () => ["RNDR/USDT"],
    logScoped: () => {},
    persistence: { resetSession: () => {} },
    setBtcFilterEnabled: (value) => {
      btcFilterEnabled = value;
    },
    state
  };

  const serverApi = createServerApi(context);
  const server = serverApi.startServer();
  await new Promise((resolve) => {
    if (server.listening) resolve();
    else server.once("listening", resolve);
  });

  const address = server.address();
  try {
    const response = await readJson(`http://127.0.0.1:${address.port}/api/status`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.bot.active, true);
    assert.equal(response.body.decision.decisionState, "wait_volume");
    assert.equal(response.body.decision.entryEngine, "trend_continuation");
    assert.equal(response.body.overview.btcFilterEnabled, true);
    assert.equal(response.body.watchlist.active.length, 1);
    assert.equal(response.body.runtime.scanCycle, 12);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

module.exports = {
  runServerTests
};
