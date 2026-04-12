"use strict";

const { PerformanceMonitor } = require("../src/roles/performanceMonitor.ts");

function createSnapshot(overrides = {}) {
  return {
    avgTradePnlUsdt: 0,
    botId: "bot_perf",
    currentEquity: 100,
    drawdown: 0,
    grossLoss: 0,
    grossProfit: 0,
    losses: 0,
    peakEquity: 100,
    pnl: 0,
    profitFactor: 0,
    recentNetPnl: [],
    tradesCount: 0,
    winRate: 0,
    wins: 0,
    ...overrides
  };
}

function createTrade(netPnl) {
  return {
    botId: "bot_perf",
    closedAt: 2_000,
    entryPrice: 100,
    entryReason: ["test_entry"],
    exitPrice: 99,
    exitReason: ["test_exit"],
    fees: 0,
    id: "trade_perf",
    netPnl,
    openedAt: 1_000,
    pnl: netPnl,
    quantity: 1,
    reason: ["test_exit"],
    side: "long",
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  };
}

function runPerformanceMonitorTests() {
  const monitor = new PerformanceMonitor();

  const validSnapshot = monitor.update(createSnapshot(), createTrade(-10));
  if (validSnapshot.peakEquity !== 100 || validSnapshot.currentEquity !== 90 || validSnapshot.drawdown !== 10) {
    throw new Error(`valid peak/drawdown behavior should remain unchanged: ${JSON.stringify(validSnapshot)}`);
  }

  const zeroPeakSnapshot = monitor.update(createSnapshot({
    currentEquity: 100,
    peakEquity: 0
  }), createTrade(-10));
  if (zeroPeakSnapshot.peakEquity !== 100 || zeroPeakSnapshot.drawdown !== 10) {
    throw new Error(`zero peak should recover from current equity before calculating drawdown: ${JSON.stringify(zeroPeakSnapshot)}`);
  }
}

module.exports = {
  runPerformanceMonitorTests
};
