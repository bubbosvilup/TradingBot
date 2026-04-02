"use strict";

const { createStrategy: createRsiReversion } = require("../src/strategies/rsiReversion/strategy.ts");

function runActiveStrategiesTests() {
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
    marketRegime: "trend",
    performance: {
      drawdown: 0,
      expectancy: 0,
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
    marketRegime: "range",
    performance: {
      drawdown: 0,
      expectancy: 0,
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
}

module.exports = {
  runActiveStrategiesTests
};
