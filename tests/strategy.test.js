"use strict";

const assert = require("node:assert/strict");

const { createStrategy } = require("../src/strategy");

function makeCandle(timestamp, open, high, low, close, volume) {
  return [timestamp, open, high, low, close, volume];
}

function buildContext() {
  const config = {
    ATR_PERIOD: 14,
    EMA20_1H_PERIOD: 20,
    EMA21_5M_PERIOD: 21,
    EMA50_1H_PERIOD: 50,
    EMA9_1M_PERIOD: 9,
    EMA9_5M_PERIOD: 9,
    ENTRY_VOLUME_MULT: 0.8,
    MACD_FAST: 12,
    MACD_SIGNAL: 9,
    MACD_SLOW: 26,
    MIN_SCORE_ENTRY: 6,
    NEUTRAL_TOP_N: 5,
    RSI_MAX: 100,
    RSI_MIN: 0,
    RSI_PERIOD: 14,
    TREND_SLOPE_MIN: 0.001,
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
    const close = 100 + index * 0.08 + Math.sin(index / 4) * 0.05;
    const volume = index === 48 ? secondLastVolume : index === 49 ? 120 : 100;
    candles_5m.push(makeCandle(baseTime + index * 300000, close - 0.05, close + 0.3, close - 0.3, close, volume));
  }

  for (let index = 0; index < 20; index += 1) {
    const close = 103 + index * 0.03;
    candles_1m.push(makeCandle(baseTime + index * 60000, close - 0.02, close + 0.05, close - 0.05, close, 25));
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

  const buySnapshot = strategy.buildMarketSnapshot("RNDR/USDT", buildSnapshot(110));
  assert.equal(buySnapshot.displayAction, "BUY");
  assert.equal(buySnapshot.action, "BUY");
  assert.equal(buySnapshot.decisionState, strategy.DECISION_STATES.BUY_READY);
  assert.equal(buySnapshot.entryEngine, strategy.ENTRY_ENGINES.TREND_CONTINUATION);
}

module.exports = {
  runStrategyTests
};
