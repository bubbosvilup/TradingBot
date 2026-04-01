"use strict";

const http = require("http");
const path = require("path");
const assert = require("node:assert/strict");

const { createServerApi } = require("../legacy/server");

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

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const request = http.request({
      hostname: parsedUrl.hostname,
      method: "POST",
      path: parsedUrl.pathname,
      port: parsedUrl.port
    }, (response) => {
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
    });

    request.on("error", reject);
    request.write(JSON.stringify(payload));
    request.end();
  });
}

async function runServerTests() {
  const state = {
    aggressiveModeEnabled: false,
    bestCandidateSymbol: "RNDR/USDT",
    botActive: true,
    botStartedAt: "2026-03-30T10:00:00.000Z",
    btcRegime: "neutral",
    candleData: {
      "RNDR/USDT": {
        candles_1h: [
          [Date.UTC(2026, 2, 30, 8, 0, 0), 6.9, 7.1, 6.8, 7.0, 1000],
          [Date.UTC(2026, 2, 30, 9, 0, 0), 7.0, 7.2, 6.95, 7.1, 1100]
        ],
        candles_1m: [
          [Date.UTC(2026, 2, 30, 10, 3, 0), 7.01, 7.05, 7.0, 7.03, 20],
          [Date.UTC(2026, 2, 30, 10, 4, 0), 7.03, 7.06, 7.01, 7.04, 21]
        ],
        candles_5m: [
          [Date.UTC(2026, 2, 30, 9, 55, 0), 6.98, 7.04, 6.96, 7.01, 80],
          [Date.UTC(2026, 2, 30, 10, 0, 0), 7.01, 7.06, 6.99, 7.03, 82]
        ]
      }
    },
    exchange: "binance",
    lastUpdate: "2026-03-30T10:05:00.000Z",
    markets: {
      "RNDR/USDT": {
        action: "WAIT",
        aggressiveModeEnabled: false,
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
        focusScore: 11.2,
        highWaterMark: null,
        holdCandles: 0,
        lastPrice: 7.03,
        macdHistogram: 0.1,
        macdLine: 0.2,
        marketRegime: "trend",
        missingIndicators: [],
        opportunityScore: 8.5,
        plannedStopLoss: 6.85,
        plannedTakeProfit: 7.45,
        reason: "Setup valido ma ingresso bloccato.",
        reasonList: ["Decision state: wait_volume"],
        rsi: 53.3,
        rsi_5m: 53.3,
        score: 7,
        setupQualityScore: 8.1,
        shortExplanation: "Spiegazione breve.",
        signal: "BUY candidate",
        signalLine: 0.1,
        stopLoss: null,
        strategyProfile: "normal",
        symbol: "RNDR/USDT",
        takeProfit: null,
        trailingStop: null,
        trend: "rialzista",
        trendBull_1h: true,
        trendLateral: false,
        trendSlope_1h: 0.002,
        triggerFired: true,
        volumeRatio_5m: 0.8,
        volumeSMA20: 100,
        warmingUp: false
      }
    },
    paperTrading: true,
    positions: [],
    research: {
      backtestJob: {
        active: false,
        error: null,
        finishedAt: null,
        logs: [],
        progressPct: 0,
        request: null,
        resultSummary: null,
        stage: "idle",
        startedAt: null,
        symbol: null
      },
      backtestReport: null
    },
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
  let aggressiveModeEnabled = false;
  const context = {
    config: {
      DEFAULT_SYMBOL: "BTC/USDT",
      EXIT_FEE_BPS: 10,
      INITIAL_USDT_BALANCE: 100,
      MAX_CONCURRENT_POSITIONS: 3,
      MAX_POSITION_EXPOSURE_PCT: 0.85,
      PUBLIC_DIR: path.join(process.cwd(), "public"),
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: 0,
      WEAK_SYMBOL_RSI_MAX: 45
    },
    getAggressiveModeEnabled: () => aggressiveModeEnabled,
    getBtcFilterEnabled: () => btcFilterEnabled,
    getSymbols: () => ["RNDR/USDT"],
    logScoped: () => {},
    persistence: { resetSession: () => {} },
    researchApi: {
      getBacktestJobStatus: () => ({
        active: false,
        progressPct: 0,
        stage: "idle"
      }),
      startBacktest: async () => ({
        accepted: true,
        job: {
          active: true,
          progressPct: 0,
          stage: "queued"
        },
        ok: true
      })
    },
    runtime: {
      getEntryBlockStatus: () => null
    },
    setBtcFilterEnabled: (value) => {
      btcFilterEnabled = value;
    },
    setAggressiveModeEnabled: (value) => {
      aggressiveModeEnabled = value;
      state.aggressiveModeEnabled = value;
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
    assert.equal(response.body.chart.symbol, "RNDR/USDT");
    assert.equal(response.body.chart.timeframes["5m"].length, 2);
    assert.equal(response.body.decision.decisionState, "wait_volume");
    assert.equal(response.body.decision.entryEngine, "trend_continuation");
    assert.equal(response.body.decision.marketRegime, "trend");
    assert.equal(response.body.decision.strategyProfile, "normal");
    assert.equal(response.body.overview.aggressiveModeEnabled, false);
    assert.equal(response.body.overview.btcFilterEnabled, true);
    assert.equal(response.body.watchlist.active.length, 1);
    assert.equal(response.body.runtime.scanCycle, 12);
    assert.equal(response.body.stats.totalClosedRounds, 0);
    assert.equal(response.body.research.backtestJob.stage, "idle");

    const backtestResponse = await postJson(`http://127.0.0.1:${address.port}/api/backtest/run`, { days: 2 });
    assert.equal(backtestResponse.statusCode, 202);
    assert.equal(backtestResponse.body.ok, true);
    assert.equal(backtestResponse.body.job.stage, "queued");

    const aggressiveResponse = await postJson(`http://127.0.0.1:${address.port}/api/aggressive-mode`, { enabled: true });
    assert.equal(aggressiveResponse.statusCode, 200);
    assert.equal(aggressiveResponse.body.ok, true);
    assert.equal(aggressiveResponse.body.aggressiveModeEnabled, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

module.exports = {
  runServerTests
};
