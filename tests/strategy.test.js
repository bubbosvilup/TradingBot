"use strict";

// Legacy-anchor note: this file protects legacy/strategy.js only. Active
// strategy modules under src/strategies are covered separately.

const assert = require("node:assert/strict");

const { createStrategy } = require("../legacy/strategy");

function makeCandle(timestamp, open, high, low, close, volume) {
  return [timestamp, open, high, low, close, volume];
}

function buildContext() {
  const config = {
    ATR_PERIOD: 14,
    ATR_STOP_MULT: 1.5,
    ATR_TP_MULT: 3.0,
    EMA20_1H_PERIOD: 20,
    EMA21_5M_PERIOD: 21,
    EMA50_1H_PERIOD: 50,
    EMA9_1M_PERIOD: 9,
    EMA9_5M_PERIOD: 9,
    ENTRY_FEE_BPS: 10,
    ENTRY_VOLUME_MULT: 0.8,
    EXIT_FEE_BPS: 10,
    FOCUS_MIN_SCORE: 4,
    MIN_POSITION_NOTIONAL_USDT: 10,
    MACD_FAST: 12,
    MACD_SIGNAL: 9,
    MACD_SLOW: 26,
    MIN_EXPECTED_NET_EDGE_BPS: 10,
    MIN_RISK_REWARD_RATIO: 1.5,
    MIN_TAKE_PROFIT_BPS: 30,
    MIN_SCORE_ENTRY: 6,
    NEUTRAL_TOP_N: 5,
    RANGE_BB_PERIOD: 20,
    RANGE_BB_STDDEV: 2,
    RANGE_EMA_GAP_MAX: 0.006,
    RANGE_ENTRY_MIN_SCORE: 6,
    RANGE_RSI_MAX: 40,
    RANGE_SLOPE_MAX: 0.0009,
    RSI_MAX: 100,
    RSI_MIN: 0,
    RSI_PERIOD: 14,
    SFP_ENTRY_MIN_SCORE: 6,
    STRATEGY_MODE: "adaptive",
    TARGET_NET_EDGE_BPS_FOR_MAX_SIZE: 120,
    TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE: 3,
    TREND_SLOPE_MIN: 0.001,
    TREND_ENTRY_MIN_SCORE: 6,
    VOLUME_MULT: 1.15,
    VOLUME_SMA_PERIOD: 20
  };

  return {
    config,
    state: { positions: [] }
  };
}

function buildSnapshot(secondLastVolume) {
  const baseTime = Date.UTC(2026, 2, 30, 0, 0, 0);
  const candles_1h = [];
  const candles_5m = [];
  const candles_1m = [];

  for (let index = 0; index < 70; index += 1) {
    const close = 100 + index * 0.25;
    candles_1h.push(makeCandle(baseTime + index * 3600000, close - 0.2, close + 0.4, close - 0.4, close, 1000));
  }

  for (let index = 0; index < 50; index += 1) {
    const close = 100 + index * 0.08;
    const volume = index === 48 ? secondLastVolume : index === 49 ? 120 : 100;
    candles_5m.push(makeCandle(baseTime + index * 300000, close - 0.3, close + 0.6, close - 0.6, close, volume));
  }

  for (let index = 0; index < 20; index += 1) {
    const close = 103 + index * 0.03;
    candles_1m.push(makeCandle(baseTime + index * 60000, close - 0.02, close + 0.05, close - 0.05, close, 25));
  }

  return { candles_1h, candles_5m, candles_1m };
}

function buildRangeSnapshot() {
  const baseTime = Date.UTC(2026, 2, 30, 0, 0, 0);
  const candles_1h = [];
  const candles_5m = [];
  const candles_1m = [];

  for (let index = 0; index < 70; index += 1) {
    const close = 100 + (Math.sin(index / 5) * 0.18);
    candles_1h.push(makeCandle(baseTime + index * 3600000, close - 0.15, close + 0.2, close - 0.2, close, 900));
  }

  const baseCloses = [
    100.0, 100.2, 100.1, 99.9, 99.8, 99.7, 99.9, 100.0, 100.1, 100.0,
    99.8, 99.9, 100.0, 99.7, 99.6, 99.5, 99.8, 100.0, 100.1, 99.9,
    99.8, 99.7, 99.6, 99.5, 99.7, 99.9, 100.0, 99.8, 99.6, 99.5,
    99.4, 99.6, 99.8, 99.9, 99.7, 99.5, 99.4, 99.3, 99.2, 99.4,
    99.5, 99.6, 99.4, 99.2, 99.0, 98.8, 98.6, 98.4, 98.2, 98.35
  ];

  for (let index = 0; index < baseCloses.length; index += 1) {
    const close = baseCloses[index];
    const previousClose = index > 0 ? baseCloses[index - 1] : close;
    const volume = index === baseCloses.length - 2 ? 90 : index === baseCloses.length - 1 ? 115 : 100;
    candles_5m.push(makeCandle(
      baseTime + index * 300000,
      previousClose,
      Math.max(previousClose, close) + 0.15,
      Math.min(previousClose, close) - 0.18,
      close,
      volume
    ));
  }

  const oneMinuteCloses = [98.12, 98.15, 98.18, 98.22, 98.27, 98.31, 98.36, 98.4, 98.45, 98.5, 98.56, 98.62, 98.68, 98.74, 98.8, 98.86, 98.92, 98.98, 99.04, 99.1];
  for (let index = 0; index < oneMinuteCloses.length; index += 1) {
    const close = oneMinuteCloses[index];
    const previousClose = index > 0 ? oneMinuteCloses[index - 1] : close;
    candles_1m.push(makeCandle(
      baseTime + index * 60000,
      previousClose,
      Math.max(previousClose, close) + 0.03,
      Math.min(previousClose, close) - 0.03,
      close,
      28
    ));
  }

  return { candles_1h, candles_5m, candles_1m };
}

function runStrategyTests() {
  const strategy = createStrategy(buildContext());
  assert.equal(strategy.calculateSma([1, 2, 3, 4], 2), 3.5);
  assert.ok(strategy.calculateEma([1, 2, 3, 4, 5], 3) > 0);
  assert.ok(strategy.wilderRsi([1, 2, 3, 2, 4, 5, 4, 6, 7, 6, 8, 9, 8, 10, 11], 14) !== null);

  const waitSnapshot = strategy.buildMarketSnapshot("RNDR/USDT", buildSnapshot(60));
  assert.equal(waitSnapshot.displayAction, "WAIT");
  assert.equal(waitSnapshot.decisionState, strategy.DECISION_STATES.WAIT_VOLUME);
  assert.equal(waitSnapshot.entryEngine, strategy.ENTRY_ENGINES.TREND_CONTINUATION);
  assert.equal(waitSnapshot.action, "HOLD");
  assert.ok(waitSnapshot.focusScore >= waitSnapshot.opportunityScore);

  const buySnapshot = strategy.buildMarketSnapshot("RNDR/USDT", buildSnapshot(110));
  assert.equal(buySnapshot.displayAction, "BUY");
  assert.equal(buySnapshot.action, "BUY");
  assert.equal(buySnapshot.decisionState, strategy.DECISION_STATES.BUY_READY);
  assert.equal(buySnapshot.entryEngine, strategy.ENTRY_ENGINES.TREND_CONTINUATION);
  assert.equal(buySnapshot.marketRegime, "trend");
  assert.ok(buySnapshot.opportunityScore > waitSnapshot.opportunityScore);

  const rangeSnapshot = strategy.buildMarketSnapshot("BAND/USDT", buildRangeSnapshot());
  assert.equal(rangeSnapshot.marketRegime, "range");
  assert.equal(rangeSnapshot.entryEngine, strategy.ENTRY_ENGINES.RANGE_GRID);
  assert.equal(rangeSnapshot.displayAction, "BUY");
  assert.ok(rangeSnapshot.projectedRiskRewardRatio >= 1.5);
}

module.exports = {
  runStrategyTests
};
