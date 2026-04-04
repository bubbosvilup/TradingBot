"use strict";

const { StateStore } = require("../src/core/stateStore.ts");

function createBotConfig(overrides = {}) {
  return {
    enabled: true,
    id: "bot_state_store",
    initialBalanceUsdt: 1000,
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function createOrder(index, overrides = {}) {
  return {
    botId: "bot_state_store",
    id: `order_${index}`,
    price: 100 + index,
    quantity: 1,
    reason: ["characterization"],
    side: index % 2 === 0 ? "buy" : "sell",
    strategyId: "emaCross",
    symbol: "BTC/USDT",
    timestamp: 1_000 + index,
    ...overrides
  };
}

function createClosedTrade(index, overrides = {}) {
  return {
    botId: "bot_state_store",
    closedAt: 2_000 + index,
    entryPrice: 100,
    entryReason: ["entry"],
    exitPrice: 101 + index,
    exitReason: ["exit"],
    fees: 0.2,
    id: `trade_${index}`,
    netPnl: index - 30,
    openedAt: 1_000 + index,
    pnl: index - 29.8,
    quantity: 1,
    reason: ["round_trip"],
    side: "long",
    strategyId: "emaCross",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function runStateStoreTests() {
  const store = new StateStore({
    maxClosedTradesHistory: 50,
    maxOrdersHistory: 50
  });
  store.registerBot(createBotConfig());

  for (let index = 0; index < 60; index += 1) {
    store.appendOrder("bot_state_store", createOrder(index));
  }

  const orders = store.getOrders("bot_state_store");
  if (orders.length !== 50) {
    throw new Error(`orders should be capped to 50 entries: ${orders.length}`);
  }
  if (orders[0].id !== "order_10" || orders[49].id !== "order_59") {
    throw new Error(`orders cap should retain newest entries only: ${JSON.stringify(orders.map((entry) => entry.id))}`);
  }
  if (store.getBotState("bot_state_store")?.availableBalanceUsdt !== 1000) {
    throw new Error("orders retention should not change existing bot state behavior");
  }

  for (let index = 0; index < 60; index += 1) {
    store.appendClosedTrade("bot_state_store", createClosedTrade(index));
  }

  const closedTrades = store.getClosedTrades("bot_state_store");
  if (closedTrades.length !== 50) {
    throw new Error(`closedTrades should be capped to 50 entries: ${closedTrades.length}`);
  }
  if (closedTrades[0].id !== "trade_10" || closedTrades[49].id !== "trade_59") {
    throw new Error(`closedTrades cap should retain newest entries only: ${JSON.stringify(closedTrades.map((entry) => entry.id))}`);
  }
  if (closedTrades[49].netPnl !== 29) {
    throw new Error(`closedTrades should preserve newest trade payloads: ${JSON.stringify(closedTrades[49])}`);
  }

  const cleanupStore = new StateStore();
  cleanupStore.unregisterBot("missing_bot");
  cleanupStore.registerBot(createBotConfig({ id: "bot_cleanup", symbol: "BTC/USDT" }));
  cleanupStore.updateBotState("bot_cleanup", { lastDecision: "buy" });
  cleanupStore.setPosition("bot_cleanup", {
    botId: "bot_cleanup",
    confidence: 0.8,
    entryPrice: 100,
    id: "position_cleanup",
    notes: ["open"],
    openedAt: 1_000,
    quantity: 1,
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  cleanupStore.appendOrder("bot_cleanup", createOrder(1, { botId: "bot_cleanup", symbol: "BTC/USDT" }));
  cleanupStore.appendClosedTrade("bot_cleanup", createClosedTrade(1, { botId: "bot_cleanup", symbol: "BTC/USDT" }));
  cleanupStore.updatePrice({ price: 101, source: "mock", symbol: "BTC/USDT", timestamp: 5_000 });
  cleanupStore.updateKline({
    close: 101,
    high: 102,
    interval: "1m",
    low: 99,
    open: 100,
    symbol: "BTC/USDT",
    timestamp: 5_000,
    volume: 10
  });
  cleanupStore.setContextSnapshot("BTC/USDT", { symbol: "BTC/USDT" });
  cleanupStore.setArchitectObservedAssessment("BTC/USDT", { symbol: "BTC/USDT" });
  cleanupStore.setArchitectPublishedAssessment("BTC/USDT", { symbol: "BTC/USDT" });
  cleanupStore.setArchitectPublisherState("BTC/USDT", { symbol: "BTC/USDT" });
  cleanupStore.unregisterBot("bot_cleanup");

  if (cleanupStore.botConfigs.has("bot_cleanup")
    || cleanupStore.botStates.has("bot_cleanup")
    || cleanupStore.orders.has("bot_cleanup")
    || cleanupStore.positions.has("bot_cleanup")
    || cleanupStore.performance.has("bot_cleanup")
    || cleanupStore.performanceHistory.has("bot_cleanup")
    || cleanupStore.closedTrades.has("bot_cleanup")) {
    throw new Error("unregisterBot should remove all per-bot state for the target bot");
  }
  if (cleanupStore.prices.has("BTC/USDT")
    || cleanupStore.klines.has("BTC/USDT")
    || cleanupStore.pipelineBySymbol.has("BTC/USDT")
    || cleanupStore.contextBySymbol.has("BTC/USDT")
    || cleanupStore.architectObservedBySymbol.has("BTC/USDT")
    || cleanupStore.architectPublishedBySymbol.has("BTC/USDT")
    || cleanupStore.architectPublisherBySymbol.has("BTC/USDT")) {
    throw new Error("unregisterBot should remove symbol-scoped state when the last bot for that symbol is removed");
  }

  const sharedSymbolStore = new StateStore();
  sharedSymbolStore.registerBot(createBotConfig({ id: "bot_a", symbol: "ETH/USDT" }));
  sharedSymbolStore.registerBot(createBotConfig({ id: "bot_b", strategy: "rsiReversion", symbol: "ETH/USDT" }));
  sharedSymbolStore.appendOrder("bot_a", createOrder(1, { botId: "bot_a", symbol: "ETH/USDT" }));
  sharedSymbolStore.appendClosedTrade("bot_a", createClosedTrade(1, { botId: "bot_a", symbol: "ETH/USDT" }));
  sharedSymbolStore.updatePrice({ price: 205, source: "mock", symbol: "ETH/USDT", timestamp: 6_000 });
  sharedSymbolStore.updateKline({
    close: 205,
    high: 206,
    interval: "1m",
    low: 204,
    open: 200,
    symbol: "ETH/USDT",
    timestamp: 6_000,
    volume: 12
  });
  sharedSymbolStore.setContextSnapshot("ETH/USDT", { symbol: "ETH/USDT" });
  sharedSymbolStore.setArchitectObservedAssessment("ETH/USDT", { symbol: "ETH/USDT" });
  sharedSymbolStore.setArchitectPublishedAssessment("ETH/USDT", { symbol: "ETH/USDT" });
  sharedSymbolStore.setArchitectPublisherState("ETH/USDT", { symbol: "ETH/USDT" });
  sharedSymbolStore.unregisterBot("bot_a");

  if (sharedSymbolStore.botConfigs.has("bot_a")
    || sharedSymbolStore.botStates.has("bot_a")
    || sharedSymbolStore.orders.has("bot_a")
    || sharedSymbolStore.positions.has("bot_a")
    || sharedSymbolStore.performance.has("bot_a")
    || sharedSymbolStore.performanceHistory.has("bot_a")
    || sharedSymbolStore.closedTrades.has("bot_a")) {
    throw new Error("unregisterBot should still remove the targeted bot when symbols are shared");
  }
  if (!sharedSymbolStore.botConfigs.has("bot_b") || !sharedSymbolStore.botStates.has("bot_b")) {
    throw new Error("unregisterBot should preserve remaining bots on the same symbol");
  }
  if (!sharedSymbolStore.prices.has("ETH/USDT")
    || !sharedSymbolStore.klines.has("ETH/USDT")
    || !sharedSymbolStore.pipelineBySymbol.has("ETH/USDT")
    || !sharedSymbolStore.contextBySymbol.has("ETH/USDT")
    || !sharedSymbolStore.architectObservedBySymbol.has("ETH/USDT")
    || !sharedSymbolStore.architectPublishedBySymbol.has("ETH/USDT")
    || !sharedSymbolStore.architectPublisherBySymbol.has("ETH/USDT")) {
    throw new Error("unregisterBot should preserve symbol-scoped state while another registered bot still uses that symbol");
  }
  if (sharedSymbolStore.getOrders("bot_b").length !== 0 || sharedSymbolStore.getClosedTrades("bot_b").length !== 0) {
    throw new Error("unregisterBot should not disturb untouched per-bot state for remaining bots");
  }

  const latencyStore = new StateStore();
  latencyStore.registerBot(createBotConfig({ id: "bot_latency", symbol: "SOL/USDT" }));
  latencyStore.recordTickLatencySample("SOL/USDT", {
    botTickMs: 4,
    contextObserveMs: 3,
    stateUpdateMs: 2,
    totalTickPipelineMs: 9
  }, 1_000);
  latencyStore.recordTickLatencySample("SOL/USDT", {
    architectObserveMs: 4,
    stateUpdateMs: 6,
    totalTickPipelineMs: 12
  }, 2_000);
  const latencySnapshot = latencyStore.getPipelineSnapshot("SOL/USDT");
  if (!latencySnapshot?.tickLatency) {
    throw new Error("tick latency summary should be attached to the pipeline snapshot");
  }
  if (latencySnapshot.tickLatency.sampleCount !== 2) {
    throw new Error(`tick latency sample count should follow total pipeline recordings: ${JSON.stringify(latencySnapshot.tickLatency)}`);
  }
  if (latencySnapshot.tickLatency.last.totalTickPipelineMs !== 12 || latencySnapshot.tickLatency.max.totalTickPipelineMs !== 12) {
    throw new Error(`tick latency should retain the latest and max total pipeline duration: ${JSON.stringify(latencySnapshot.tickLatency)}`);
  }
  if (latencySnapshot.tickLatency.average.stateUpdateMs !== 4 || latencySnapshot.tickLatency.last.stateUpdateMs !== 6) {
    throw new Error(`tick latency should aggregate per-stage averages and latest values: ${JSON.stringify(latencySnapshot.tickLatency)}`);
  }
  if (latencySnapshot.tickLatency.recentWorstTotalMs !== 12) {
    throw new Error(`tick latency should retain the recent worst-case total duration: ${JSON.stringify(latencySnapshot.tickLatency)}`);
  }
}

module.exports = {
  runStateStoreTests
};
