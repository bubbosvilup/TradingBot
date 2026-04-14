"use strict";

// Legacy-anchor note: this file protects legacy/runtime.js only. It does not
// describe the active TypeScript orchestrator runtime.

const assert = require("node:assert/strict");

const { createRuntime } = require("../legacy/runtime");

function runRuntimeTests() {
  const state = {
    bestCandidateSymbol: null,
    positions: [
      { symbol: "OPEN/USDT" }
    ],
    watchlist: {
      recentSwaps: []
    }
  };

  const context = {
    config: {
      BATCH_DELAY_MS: 0,
      BATCH_SIZE: 4,
      ENTRY_FEE_BPS: 10,
      ENTRY_VOLUME_MULT: 0.8,
      EXCLUDED_BASE_ASSETS: new Set(),
      FETCH_LIMIT_1H: 100,
      FETCH_LIMIT_1M: 100,
      FETCH_LIMIT_5M: 100,
      FETCH_TIMEOUT_MS: 15000,
      HARD_STOP_PCT: 0.05,
      HOT_SYMBOLS_POOL_COUNT: 30,
      LEVERAGED_TOKEN_REGEX: /\d+[LS]$/i,
      MAX_CONCURRENT_POSITIONS: 3,
      POLL_INTERVAL_MS: 7000,
      SLIPPAGE_BPS_BASE: 5,
      SPREAD_MAX_PCT: 0.001,
      TOP_SYMBOLS_COUNT: 10,
      USE_CCXT_PRO_WS: false,
      VOLUME_MULT: 1.15,
      WS_BACKOFF_BASE_MS: 1000,
      WS_BACKOFF_MAX_MS: 15000,
      WS_FAILURE_THRESHOLD: 6,
      WS_FAILURE_WINDOW_MS: 20000,
      WS_GLOBAL_COOLDOWN_MS: 120000,
      WS_REALTIME_TIMEFRAMES: new Set(["5m", "1m"]),
      WS_WATCH_TIMEOUT_MS: 45000
    },
    logScoped: () => {},
    state,
    withTimeout: async (value) => value
  };

  const runtime = createRuntime(context);
  const currentSymbols = [
    "OPEN/USDT",
    "FOCUS/USDT",
    "BTC/USDT",
    "WEAK1/USDT",
    "WEAK2/USDT",
    "KEEP1/USDT",
    "KEEP2/USDT",
    "KEEP3/USDT",
    "KEEP4/USDT",
    "KEEP5/USDT"
  ];
  const currentMarkets = {
    "BTC/USDT": { positionOpen: false, rsi_5m: 52 },
    "FOCUS/USDT": { positionOpen: false, rsi_5m: 33 },
    "KEEP1/USDT": { positionOpen: false, rsi_5m: 55 },
    "KEEP2/USDT": { positionOpen: false, rsi_5m: 58 },
    "KEEP3/USDT": { positionOpen: false, rsi_5m: 61 },
    "KEEP4/USDT": { positionOpen: false, rsi_5m: 63 },
    "KEEP5/USDT": { positionOpen: false, rsi_5m: 66 },
    "OPEN/USDT": { positionOpen: true, rsi_5m: 18 },
    "WEAK1/USDT": { positionOpen: false, rsi_5m: 22 },
    "WEAK2/USDT": { positionOpen: false, rsi_5m: 41 }
  };
  const allCandidates = [
    "BTC/USDT",
    "FOCUS/USDT",
    "OPEN/USDT",
    "NEW1/USDT",
    "NEW2/USDT",
    "NEW3/USDT",
    "NEW4/USDT"
  ];

  const rotatedSymbols = runtime.rotateWeakSymbols(currentMarkets, allCandidates, currentSymbols, "FOCUS/USDT", {
    includeBtc: true,
    weakRsiMax: 45
  });

  assert.equal(rotatedSymbols.length, 10);
  assert.ok(rotatedSymbols.includes("OPEN/USDT"));
  assert.ok(rotatedSymbols.includes("FOCUS/USDT"));
  assert.ok(rotatedSymbols.includes("BTC/USDT"));
  assert.ok(rotatedSymbols.includes("NEW1/USDT"));
  assert.ok(rotatedSymbols.includes("NEW2/USDT"));
  assert.ok(!rotatedSymbols.includes("WEAK1/USDT"));
  assert.ok(!rotatedSymbols.includes("WEAK2/USDT"));
}

module.exports = {
  runRuntimeTests
};
