"use strict";

const { createStrategy: createBreakout } = require("../../src/strategies/breakout/strategy.ts");
const { createStrategy: createEmaCross } = require("../../src/strategies/emaCross/strategy.ts");
const { createStrategy: createRsiReversion } = require("../../src/strategies/rsiReversion/strategy.ts");

const SUPPORTED_ACTIONS = new Set(["buy", "hold", "sell"]);

function buildContext(overrides = {}) {
  return {
    botId: "bot_strategy_contract",
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
    prices: [100.0, 100.1, 100.2, 100.3, 100.4, 100.5, 100.6],
    strategyId: "strategy_contract",
    symbol: "ETH/USDT",
    timestamp: 10_000,
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

function assertValidDecision(strategyName, decision) {
  if (!decision || typeof decision !== "object") {
    throw new Error(`${strategyName} should return a decision object: ${JSON.stringify(decision)}`);
  }
  if (!SUPPORTED_ACTIONS.has(decision.action)) {
    throw new Error(`${strategyName} returned unsupported action: ${JSON.stringify(decision)}`);
  }
  if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
    throw new Error(`${strategyName} returned invalid confidence: ${JSON.stringify(decision)}`);
  }
  if (!Array.isArray(decision.reason)) {
    throw new Error(`${strategyName} should return a reason array: ${JSON.stringify(decision)}`);
  }
}

function runStrategyContractTests() {
  const strategies = [
    ["breakout", createBreakout()],
    ["emaCross", createEmaCross()],
    ["rsiReversion", createRsiReversion()]
  ];

  for (const [strategyName, strategy] of strategies) {
    const context = buildContext({ strategyId: strategyName });
    const before = JSON.stringify(context);
    const decision = strategy.evaluate(context);
    const after = JSON.stringify(context);

    assertValidDecision(strategyName, decision);
    if (after !== before) {
      throw new Error(`${strategyName} evaluate should not mutate input context`);
    }
  }
}

module.exports = {
  runStrategyContractTests
};
