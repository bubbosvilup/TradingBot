"use strict";

const { createStrategy: createEmaCross } = require("../src/strategies/emaCross/strategy.ts");
const { createStrategy: createRsiReversion } = require("../src/strategies/rsiReversion/strategy.ts");

function buildContext(overrides = {}) {
  return {
    botId: "bot_strategy_test",
    hasOpenPosition: false,
    indicators: {
      emaBaseline: 100,
      emaFast: 100.5,
      emaSlow: 100.2,
      momentum: 0.2,
      rsi: 52,
      volatility: 1.0
    },
    latestPrice: 100.4,
    localRegimeHint: "range",
    performance: {
      avgTradePnlUsdt: 0,
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      tradesCount: 0,
      winRate: 0
    },
    prices: [100.0, 100.1, 100.2, 100.3, 100.4],
    strategyId: "strategy_test",
    symbol: "ETH/USDT",
    timestamp: Date.now(),
    unrealizedPnl: 0,
    ...overrides,
    indicators: {
      emaBaseline: 100,
      emaFast: 100.5,
      emaSlow: 100.2,
      momentum: 0.2,
      rsi: 52,
      volatility: 1.0,
      ...(overrides.indicators || {})
    },
    performance: {
      avgTradePnlUsdt: 0,
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      tradesCount: 0,
      winRate: 0,
      ...(overrides.performance || {})
    }
  };
}

function runActiveStrategiesTests() {
  const emaCross = createEmaCross();
  const belowFloorDecision = emaCross.evaluate(buildContext({
    localRegimeHint: "trend",
    strategyId: "emaCross",
    indicators: {
      emaBaseline: 99.8,
      emaFast: 100.6,
      emaSlow: 100.2,
      momentum: 0.25,
      rsi: 50
    }
  }));
  if (belowFloorDecision.action !== "hold") {
    throw new Error(`emaCross should respect the higher default RSI floor, received ${belowFloorDecision.action}`);
  }

  const weakTrendBuy = emaCross.evaluate(buildContext({
    localRegimeHint: "trend",
    strategyId: "emaCross",
    indicators: {
      emaBaseline: 99.8,
      emaFast: 100.5,
      emaSlow: 100.2,
      momentum: 0.2,
      rsi: 52
    }
  }));
  const strongTrendBuy = emaCross.evaluate(buildContext({
    latestPrice: 104,
    localRegimeHint: "trend",
    prices: [100, 100.8, 101.7, 102.8, 104],
    strategyId: "emaCross",
    indicators: {
      emaBaseline: 101,
      emaFast: 103.5,
      emaSlow: 102.4,
      momentum: 2.0,
      rsi: 66
    }
  }));
  if (weakTrendBuy.action !== "buy" || strongTrendBuy.action !== "buy") {
    throw new Error("emaCross buy trigger regressed while validating confidence ordering");
  }
  if (!(strongTrendBuy.confidence > weakTrendBuy.confidence)) {
    throw new Error(`emaCross stronger buy signal should have higher confidence (${weakTrendBuy.confidence} vs ${strongTrendBuy.confidence})`);
  }
  if (weakTrendBuy.confidence >= 0.8) {
    throw new Error(`emaCross weak buy confidence is still saturating too quickly: ${weakTrendBuy.confidence}`);
  }

  const mildTrendSell = emaCross.evaluate(buildContext({
    hasOpenPosition: true,
    latestPrice: 100.1,
    localRegimeHint: "trend",
    strategyId: "emaCross",
    indicators: {
      emaBaseline: 100,
      emaFast: 100.1,
      emaSlow: 100.2,
      momentum: -0.12,
      rsi: 49
    }
  }));
  const strongTrendSell = emaCross.evaluate(buildContext({
    hasOpenPosition: true,
    latestPrice: 98.6,
    localRegimeHint: "trend",
    prices: [101.5, 101.0, 100.2, 99.4, 98.6],
    strategyId: "emaCross",
    indicators: {
      emaBaseline: 100.8,
      emaFast: 98.9,
      emaSlow: 100.4,
      momentum: -1.6,
      rsi: 42
    }
  }));
  if (mildTrendSell.action !== "sell" || strongTrendSell.action !== "sell") {
    throw new Error("emaCross sell trigger regressed while validating dynamic exit confidence");
  }
  if (!(strongTrendSell.confidence > mildTrendSell.confidence)) {
    throw new Error(`emaCross stronger exit should have higher sell confidence (${mildTrendSell.confidence} vs ${strongTrendSell.confidence})`);
  }

  const strategy = createRsiReversion({
    buyRsi: 33,
    minConfidence: 0.55,
    sellRsi: 58
  });

  const buyDecision = strategy.evaluate({
    botId: "bot_eth_reversion",
    hasOpenPosition: false,
    indicators: {
      emaBaseline: 101,
      emaFast: 99,
      emaSlow: 100,
      momentum: -0.5,
      rsi: 29,
      volatility: 1.1
    },
    latestPrice: 99.5,
    localRegimeHint: "trend",
    performance: {
      avgTradePnlUsdt: 0,
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      tradesCount: 0,
      winRate: 0
    },
    prices: [103, 102, 101, 100, 99.5],
    strategyId: "rsiReversion",
    symbol: "ETH/USDT",
    timestamp: Date.now(),
    unrealizedPnl: 0
  });

  if (buyDecision.action !== "buy") {
    throw new Error(`rsiReversion should buy on local mean-reversion trigger even without range gate, received ${buyDecision.action}`);
  }
  if (!buyDecision.reason.includes("oversold_mean_reversion")) {
    throw new Error("rsiReversion buy decision missing updated mean-reversion reason");
  }

  const strongerBuyDecision = strategy.evaluate(buildContext({
    botId: "bot_eth_reversion",
    indicators: {
      emaBaseline: 101,
      emaFast: 98,
      emaSlow: 100,
      momentum: -1.2,
      rsi: 21,
      volatility: 1.3
    },
    latestPrice: 98.6,
    localRegimeHint: "trend",
    prices: [102, 101, 100, 99.2, 98.6],
    strategyId: "rsiReversion",
    symbol: "ETH/USDT"
  }));
  if (strongerBuyDecision.action !== "buy") {
    throw new Error(`rsiReversion stronger oversold setup should still buy, received ${strongerBuyDecision.action}`);
  }
  if (!(strongerBuyDecision.confidence > buyDecision.confidence)) {
    throw new Error(`rsiReversion stronger oversold setup should have higher buy confidence (${buyDecision.confidence} vs ${strongerBuyDecision.confidence})`);
  }
  if (buyDecision.confidence >= 0.85) {
    throw new Error(`rsiReversion moderate buy confidence is still saturating too quickly: ${buyDecision.confidence}`);
  }

  const holdDecision = strategy.evaluate({
    botId: "bot_eth_reversion",
    hasOpenPosition: false,
    indicators: {
      emaBaseline: 101,
      emaFast: 100.2,
      emaSlow: 100,
      momentum: 0.2,
      rsi: 45,
      volatility: 0.8
    },
    latestPrice: 100.4,
    localRegimeHint: "range",
    performance: {
      avgTradePnlUsdt: 0,
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      tradesCount: 0,
      winRate: 0
    },
    prices: [100.1, 100.0, 100.2, 100.3, 100.4],
    strategyId: "rsiReversion",
    symbol: "ETH/USDT",
    timestamp: Date.now(),
    unrealizedPnl: 0
  });

  if (holdDecision.action !== "hold") {
    throw new Error(`rsiReversion should still hold when local technical trigger is absent, received ${holdDecision.action}`);
  }

  const rsiOnlySellDecision = strategy.evaluate(buildContext({
    botId: "bot_eth_reversion",
    hasOpenPosition: true,
    indicators: {
      emaBaseline: 101,
      emaFast: 100.3,
      emaSlow: 100,
      momentum: 0.5,
      rsi: 59,
      volatility: 1
    },
    latestPrice: 101.2,
    localRegimeHint: "range",
    prices: [99.8, 100.2, 100.8, 101.0, 101.2],
    strategyId: "rsiReversion",
    symbol: "ETH/USDT"
  }));
  const priceTargetSellDecision = strategy.evaluate(buildContext({
    botId: "bot_eth_reversion",
    hasOpenPosition: true,
    indicators: {
      emaBaseline: 101,
      emaFast: 101.8,
      emaSlow: 100,
      momentum: 1.1,
      rsi: 54,
      volatility: 1.2
    },
    latestPrice: 101.7,
    localRegimeHint: "range",
    prices: [100.4, 100.8, 101.1, 101.4, 101.7],
    strategyId: "rsiReversion",
    symbol: "ETH/USDT"
  }));
  const bothExitSignalsDecision = strategy.evaluate(buildContext({
    botId: "bot_eth_reversion",
    hasOpenPosition: true,
    indicators: {
      emaBaseline: 101,
      emaFast: 102.4,
      emaSlow: 100,
      momentum: 1.6,
      rsi: 72,
      volatility: 1.2
    },
    latestPrice: 103.4,
    localRegimeHint: "range",
    prices: [100.4, 101.0, 101.8, 102.7, 103.4],
    strategyId: "rsiReversion",
    symbol: "ETH/USDT"
  }));
  if (rsiOnlySellDecision.action !== "sell" || priceTargetSellDecision.action !== "sell" || bothExitSignalsDecision.action !== "sell") {
    throw new Error("rsiReversion sell trigger regressed while validating dynamic exit confidence");
  }
  if (!rsiOnlySellDecision.reason.includes("rsi_exit_threshold_hit")) {
    throw new Error(`rsiReversion RSI-only exit should use rsi_exit_threshold_hit: ${rsiOnlySellDecision.reason.join(",")}`);
  }
  if (rsiOnlySellDecision.reason.includes("reversion_price_target_hit")) {
    throw new Error("rsiReversion RSI-only exit should not be labeled as a price-target hit");
  }
  if (!priceTargetSellDecision.reason.includes("reversion_price_target_hit")) {
    throw new Error(`rsiReversion price-target exit should use reversion_price_target_hit: ${priceTargetSellDecision.reason.join(",")}`);
  }
  if (priceTargetSellDecision.reason.includes("rsi_exit_threshold_hit")) {
    throw new Error("rsiReversion price-target-only exit should not be labeled as an RSI exit");
  }
  if (!bothExitSignalsDecision.reason.includes("reversion_price_target_hit")) {
    throw new Error(`rsiReversion should prefer the price-target reason when both exit conditions are true: ${bothExitSignalsDecision.reason.join(",")}`);
  }
  if (bothExitSignalsDecision.reason.includes("rsi_exit_threshold_hit")) {
    throw new Error("rsiReversion should not downgrade a price-target exit to RSI reason when both conditions are true");
  }
  if (!(bothExitSignalsDecision.confidence > rsiOnlySellDecision.confidence)) {
    throw new Error(`rsiReversion stronger exit should have higher sell confidence (${rsiOnlySellDecision.confidence} vs ${bothExitSignalsDecision.confidence})`);
  }
}

module.exports = {
  runActiveStrategiesTests
};
