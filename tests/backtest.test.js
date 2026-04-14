"use strict";

// Legacy-adapter note: this file covers the BacktestEngine boundary. The engine
// still reports a legacy adapter internally, but this test should not import
// legacy modules directly.

const assert = require("node:assert/strict");

const { BacktestEngine } = require("../src/engines/backtestEngine.ts");

function makeCandle(timestamp, open, high, low, close, volume) {
  return [timestamp, open, high, low, close, volume];
}

function buildReplayEligibleHistories(symbol, startPrice, hourlyDrift) {
  const hourBaseTime = Date.UTC(2026, 2, 24, 0, 0, 0);
  const tradeBaseTime = Date.UTC(2026, 2, 28, 0, 0, 0);
  const candles_1h = [];
  const candles_5m = [];
  const candles_1m = [];

  for (let index = 0; index < 120; index += 1) {
    const close = startPrice + (index * hourlyDrift);
    candles_1h.push(makeCandle(
      hourBaseTime + (index * 3600000),
      close - 0.15,
      close + 0.25,
      close - 0.25,
      close,
      1500
    ));
  }

  for (let index = 0; index < 50; index += 1) {
    const close = startPrice + (index * 0.08);
    const volume = index === 48 ? 110 : index === 49 ? 120 : 100;
    candles_5m.push(makeCandle(
      tradeBaseTime + (index * 300000),
      close - 0.3,
      close + 0.6,
      close - 0.6,
      close,
      volume
    ));
  }

  for (let index = 50; index < 80; index += 1) {
    const previousClose = Number(candles_5m[candles_5m.length - 1][4]);
    const close = previousClose + 0.18;
    candles_5m.push(makeCandle(
      tradeBaseTime + (index * 300000),
      previousClose - 0.04,
      close + 0.12,
      previousClose - 0.08,
      close,
      140
    ));
  }

  for (let index = 0; index < 20; index += 1) {
    const close = startPrice + 3 + (index * 0.03);
    candles_1m.push(makeCandle(
      tradeBaseTime + (index * 60000),
      close - 0.02,
      close + 0.05,
      close - 0.05,
      close,
      25
    ));
  }

  let currentOneMinutePrice = Number(candles_1m[candles_1m.length - 1][4]);
  for (let index = 20; index < 480; index += 1) {
    currentOneMinutePrice += 0.018;
    const close = currentOneMinutePrice;
    candles_1m.push(makeCandle(
      tradeBaseTime + (index * 60000),
      close - 0.01,
      close + 0.03,
      close - 0.03,
      close,
      28
    ));
  }

  return {
    [symbol]: { candles_1h, candles_1m, candles_5m }
  };
}

async function runBacktestTests() {
  const config = {
    AGGRESSIVE_EDGE_MULT: 0.72,
    AGGRESSIVE_ENTRY_MIN_SCORE_DELTA: 1,
    AGGRESSIVE_ENTRY_VOLUME_DELTA: 0.15,
    AGGRESSIVE_MODE_ENABLED: false,
    AGGRESSIVE_RANGE_RSI_BONUS: 6,
    AGGRESSIVE_RISK_REWARD_MULT: 0.85,
    AGGRESSIVE_TREND_SLOPE_MULT: 0.65,
    ATR_PERIOD: 14,
    ATR_STOP_MULT: 1.5,
    ATR_TP_MULT: 3.0,
    ATR_TRAIL_MULT: 2.0,
    BACKTEST_BTC_FILTER_ENABLED: true,
    EMA20_1H_PERIOD: 20,
    EMA21_5M_PERIOD: 21,
    EMA50_1H_PERIOD: 50,
    EMA9_1M_PERIOD: 9,
    EMA9_5M_PERIOD: 9,
    ENTRY_FEE_BPS: 10,
    ENTRY_VOLUME_MULT: 0.8,
    EXCHANGE_ID: "binance",
    EXIT_FEE_BPS: 10,
    FETCH_LIMIT_1H: 120,
    FETCH_LIMIT_1M: 220,
    FETCH_LIMIT_5M: 120,
    FOCUS_MIN_SCORE: 4,
    INITIAL_USDT_BALANCE: 100,
    LOSS_COOLDOWN_CYCLES: 8,
    MACD_FAST: 12,
    MACD_SIGNAL: 9,
    MACD_SLOW: 26,
    MAX_CONCURRENT_POSITIONS: 2,
    MAX_POSITION_EXPOSURE_PCT: 0.85,
    MIN_EXPECTED_NET_EDGE_BPS: 10,
    MIN_HOLD_CANDLES: 5,
    MIN_HOLD_SECONDS: 0,
    MIN_POSITION_NOTIONAL_USDT: 10,
    MIN_RISK_REWARD_RATIO: 1.4,
    MIN_SCORE_ENTRY: 6,
    MIN_TAKE_PROFIT_BPS: 25,
    NEUTRAL_TOP_N: 5,
    PARTIAL_TP_R: 1.5,
    POLL_INTERVAL_MS: 0,
    POSITION_SIZE_MAX: 0.4,
    POSITION_SIZE_MIN: 0.2,
    RANGE_BB_PERIOD: 20,
    RANGE_BB_STDDEV: 2,
    RANGE_EMA_GAP_MAX: 0.006,
    RANGE_ENTRY_MIN_SCORE: 6,
    RANGE_RSI_MAX: 40,
    RANGE_SLOPE_MAX: 0.0009,
    RISK_PCT_PER_TRADE: 0.01,
    RSI_MAX: 100,
    RSI_MIN: 0,
    RSI_PERIOD: 14,
    SFP_ENTRY_MIN_SCORE: 6,
    SLIPPAGE_BPS_BASE: 5,
    STRATEGY_MODE: "adaptive",
    TARGET_NET_EDGE_BPS_FOR_MAX_SIZE: 120,
    TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE: 3,
    TIME_STOP_CANDLES: 12,
    TRAILING_PCT: 0.007,
    TREND_ENTRY_MIN_SCORE: 6,
    TREND_SLOPE_MIN: 0.0008,
    VOLUME_MULT: 1.15,
    VOLUME_SMA_PERIOD: 20,
    WEAK_SYMBOL_RSI_MAX: 45
  };

  const histories = {
    ...buildReplayEligibleHistories("BTC/USDT", 63000, 25),
    ...buildReplayEligibleHistories("TREND/USDT", 100, 0.25)
  };

  const engine = new BacktestEngine();
  const report = engine.compareStrategyModes({
    baseConfig: config,
    symbolHistories: histories
  });

  assert.equal(report.symbolCount, 2);
  assert.equal(report.strategyProfile, "normal");
  assert.equal(report.modes.length, 3);
  assert.ok(["adaptive", "trend", "range_grid"].includes(report.recommendedMode));
  assert.ok(report.modes.some((mode) => mode.stats.totalClosedRounds > 0));
  assert.ok(report.modes.some((mode) => mode.summary.buyReadyCount > 0));
  assert.ok(report.modes.some((mode) => Array.isArray(mode.rounds) && mode.rounds.length > 0));
  assert.ok(report.modes[0].timeline.points > 0);

  const aggressiveReport = engine.compareStrategyModes({
    baseConfig: { ...config, AGGRESSIVE_MODE_ENABLED: true },
    symbolHistories: histories
  });
  assert.equal(aggressiveReport.strategyProfile, "aggressive");

  const readiness = await engine.run();
  assert.equal(readiness.ok, true);
  assert.equal(readiness.capabilities.source, "legacy_adapter");
  assert.equal(readiness.capabilities.runBacktestJob, true);

  const delegatedCalls = [];
  const delegatedEngine = new BacktestEngine({
    compareStrategyModes(params) {
      delegatedCalls.push({ type: "compare", params });
      return { ok: true, type: "compare" };
    },
    async runBacktestJob(params) {
      delegatedCalls.push({ type: "job", params });
      return { ok: true, type: "job" };
    },
    printBacktestReport(report) {
      delegatedCalls.push({ type: "print", report });
    }
  });
  const delegatedCompare = await delegatedEngine.run({
    baseConfig: config,
    symbolHistories: histories
  });
  assert.equal(delegatedCompare.type, "compare");
  const delegatedJob = await delegatedEngine.runJob({
    activeSymbols: ["BTC/USDT"],
    baseConfig: config,
    request: { days: 2 }
  });
  assert.equal(delegatedJob.type, "job");
  delegatedEngine.printReport({ ok: true, type: "report" });
  assert.equal(delegatedCalls.length, 3);
  assert.equal(delegatedCalls[0].type, "compare");
  assert.equal(delegatedCalls[1].type, "job");
  assert.equal(delegatedCalls[2].type, "print");
}

module.exports = {
  runBacktestTests
};
