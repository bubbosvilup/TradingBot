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

function approxEqual(actual, expected, epsilon = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

function runStateStoreTests() {
  let fakeNow = 50_000;
  const fakeClock = { now: () => fakeNow };
  const clockedStore = new StateStore({ clock: fakeClock });
  clockedStore.registerBot(createBotConfig({ id: "bot_clocked", symbol: "CLOCK/USDT" }));
  const clockedInitialFreshness = clockedStore.getMarketDataFreshness("CLOCK/USDT");
  if (clockedInitialFreshness.updatedAt !== 50_000) {
    throw new Error(`market freshness initialization should use injected clock: ${JSON.stringify(clockedInitialFreshness)}`);
  }
  fakeNow = 51_000;
  const normalizedClockedFreshness = clockedStore.setMarketDataFreshness("CLOCK/USDT", {
    status: "degraded"
  });
  if (normalizedClockedFreshness?.updatedAt !== 51_000) {
    throw new Error(`market freshness normalization should use injected clock fallback: ${JSON.stringify(normalizedClockedFreshness)}`);
  }
  fakeNow = 52_000;
  clockedStore.setPortfolioKillSwitchConfig({
    enabled: true,
    maxDrawdownPct: 1,
    mode: "block_entries_only"
  });
  const clockedPortfolioState = clockedStore.commitPortfolioKillSwitchState({ feeRate: 0 });
  if (clockedPortfolioState.updatedAt !== 52_000) {
    throw new Error(`portfolio kill switch timing should use injected clock: ${JSON.stringify(clockedPortfolioState)}`);
  }

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

  const edgeStore = new StateStore();
  edgeStore.registerBot(createBotConfig({ id: "bot_edge_a", strategy: "rsiReversion", symbol: "BTC/USDT" }));
  edgeStore.registerBot(createBotConfig({ id: "bot_edge_b", strategy: "emaCross", symbol: "ETH/USDT" }));
  edgeStore.appendClosedTrade("bot_edge_a", createClosedTrade(1, {
    botId: "bot_edge_a",
    edgeErrorPct: -0.002,
    entryArchitectRegime: "range",
    expectedNetEdgePctAtEntry: 0.01,
    realizedNetPnlPct: 0.008,
    realizedNetPnlUsdt: 0.8,
    slippageImpactPct: 0.001,
    strategyId: "rsiReversion",
    symbol: "BTC/USDT"
  }));
  edgeStore.appendClosedTrade("bot_edge_b", createClosedTrade(2, {
    botId: "bot_edge_b",
    edgeErrorPct: 0.004,
    entryArchitectRegime: "trend",
    expectedNetEdgePctAtEntry: 0.006,
    realizedNetPnlPct: 0.01,
    realizedNetPnlUsdt: 1,
    slippageImpactPct: 0.002,
    strategyId: "emaCross",
    symbol: "ETH/USDT"
  }));
  edgeStore.recordBlockedOpportunityEdgeDiagnostics({
    botId: "bot_edge_a",
    expectedGrossEdgePct: 0.012,
    expectedNetEdgePct: 0.009,
    reason: "insufficient_edge_after_costs",
    regime: "range",
    requiredEdgePct: 0.01,
    strategyId: "rsiReversion",
    symbol: "BTC/USDT",
    timestamp: 10_000
  });
  const edgeSummary = edgeStore.getEdgeDiagnosticsSummary();
  if (edgeSummary.closedTradeCount !== 2
    || !approxEqual(edgeSummary.avgExpectedEdge, 0.008)
    || !approxEqual(edgeSummary.avgRealizedEdge, 0.009)
    || !approxEqual(edgeSummary.avgError, 0.001)
    || edgeSummary.overestimationRate !== 0.5
    || edgeSummary.underestimationRate !== 0.5
    || edgeSummary.blockedOpportunityCount !== 1
    || edgeSummary.blockedOpportunityAvgEdge !== 0.009
    || !approxEqual(edgeSummary.avgSlippageImpactPct, 0.0015)) {
    throw new Error(`edge diagnostics summary should compare expected and realized edge: ${JSON.stringify(edgeSummary)}`);
  }
  if (edgeSummary.byStrategy.rsiReversion.closedTradeCount !== 1
    || edgeSummary.byStrategy.rsiReversion.blockedOpportunityCount !== 1
    || edgeSummary.byRegime.range.closedTradeCount !== 1
    || edgeStore.getBlockedEdgeOpportunities(1)[0].reason !== "insufficient_edge_after_costs") {
    throw new Error(`edge diagnostics should retain strategy/regime bias and blocked opportunity detail: ${JSON.stringify(edgeSummary)}`);
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

  const pipelineStore = new StateStore();
  pipelineStore.registerBot(createBotConfig({ id: "bot_pipeline", symbol: "ADA/USDT" }));
  pipelineStore.recordPipelineFromTick({
    price: 1,
    receivedAt: 1_100,
    source: "ws",
    stateUpdatedAt: 1_125,
    symbol: "ADA/USDT",
    timestamp: 1_000
  });
  pipelineStore.recordBotTickStart("bot_pipeline", "ADA/USDT", 1_140);
  pipelineStore.recordBotEvaluation("bot_pipeline", "ADA/USDT", 1_170);
  pipelineStore.recordExecution("bot_pipeline", "ADA/USDT", 1_210);
  const wsPipeline = pipelineStore.getPipelineSnapshot("ADA/USDT");
  if (wsPipeline.exchangeToReceiveMs !== 100
    || wsPipeline.receiveToStateMs !== 25
    || wsPipeline.stateToBotMs !== 15
    || wsPipeline.botDecisionMs !== 30
    || wsPipeline.executionMs !== 40
    || wsPipeline.totalPipelineMs !== 210
    || wsPipeline.source !== "ws") {
    throw new Error(`canonical WS latency pipeline should sum actual stages: ${JSON.stringify(wsPipeline)}`);
  }

  pipelineStore.recordPipelineFromTick({
    price: 1.01,
    receivedAt: 2_090,
    restRoundtripMs: 90,
    source: "rest",
    stateUpdatedAt: 2_100,
    symbol: "ADA/USDT",
    timestamp: 2_000
  });
  pipelineStore.recordBotTickStart("bot_pipeline", "ADA/USDT", 2_120);
  pipelineStore.recordBotEvaluation("bot_pipeline", "ADA/USDT", 2_150);
  const restPipeline = pipelineStore.getPipelineSnapshot("ADA/USDT");
  if (restPipeline.source !== "rest"
    || restPipeline.restRoundtripMs !== 90
    || restPipeline.exchangeToReceiveMs !== 90
    || restPipeline.receiveToStateMs !== 10
    || restPipeline.stateToBotMs !== 20
    || restPipeline.botDecisionMs !== 30
    || restPipeline.executionMs !== null
    || restPipeline.totalPipelineMs !== 150) {
    throw new Error(`REST latency pipeline should expose source and roundtrip without stale execution leakage: ${JSON.stringify(restPipeline)}`);
  }

  pipelineStore.recordPipelineFromTick({
    price: 1.02,
    receivedAt: 3_000,
    source: "ws",
    stateUpdatedAt: 3_010,
    symbol: "ADA/USDT",
    timestamp: 3_100
  });
  const mixedTimestampPipeline = pipelineStore.getPipelineSnapshot("ADA/USDT");
  if (mixedTimestampPipeline.exchangeToReceiveMs !== null || mixedTimestampPipeline.totalPipelineMs !== 10) {
    throw new Error(`future exchange timestamps should not create negative latency: ${JSON.stringify(mixedTimestampPipeline)}`);
  }

  const portfolioStore = new StateStore();
  portfolioStore.registerBot(createBotConfig({ id: "bot_portfolio", symbol: "BTC/USDT" }));
  portfolioStore.setPortfolioKillSwitchConfig({
    enabled: true,
    maxDrawdownPct: 5,
    mode: "block_entries_only"
  });
  const initialPortfolioState = portfolioStore.getPortfolioKillSwitchState({ feeRate: 0.001, now: 10_000 });
  if (!initialPortfolioState.enabled || initialPortfolioState.currentEquityUsdt !== 1000 || initialPortfolioState.triggered) {
    throw new Error(`portfolio kill switch should initialize from registered capital without triggering: ${JSON.stringify(initialPortfolioState)}`);
  }
  if (portfolioStore.portfolioKillSwitchState.triggered || portfolioStore.portfolioKillSwitchState.updatedAt !== null) {
    throw new Error(`getPortfolioKillSwitchState should not mutate the stored portfolio kill switch state: ${JSON.stringify(portfolioStore.portfolioKillSwitchState)}`);
  }

  portfolioStore.updateBotState("bot_portfolio", {
    availableBalanceUsdt: 0
  });
  portfolioStore.setPosition("bot_portfolio", {
    botId: "bot_portfolio",
    confidence: 0.9,
    entryPrice: 100,
    id: "position_portfolio",
    notes: ["characterization"],
    openedAt: 11_000,
    quantity: 10,
    side: "long",
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  portfolioStore.updatePrice({
    price: 94,
    source: "mock",
    symbol: "BTC/USDT",
    timestamp: 12_000
  });
  const computedTriggeredPortfolioState = portfolioStore.getPortfolioKillSwitchState({ feeRate: 0.001, now: 12_000 });
  if (!computedTriggeredPortfolioState.triggered || portfolioStore.portfolioKillSwitchState.triggered) {
    throw new Error(`read-only portfolio kill switch state should compute a breach without latching it: ${JSON.stringify({
      computed: computedTriggeredPortfolioState,
      stored: portfolioStore.portfolioKillSwitchState
    })}`);
  }
  const triggeredPortfolioState = portfolioStore.commitPortfolioKillSwitchState({ feeRate: 0.001, now: 12_000 });
  if (!triggeredPortfolioState.triggered || !triggeredPortfolioState.blockingEntries || triggeredPortfolioState.reason !== "portfolio_max_drawdown_reached") {
    throw new Error(`portfolio kill switch should trigger and block entries after aggregate drawdown breaches the threshold: ${JSON.stringify(triggeredPortfolioState)}`);
  }
  if (triggeredPortfolioState.drawdownPct < 5) {
    throw new Error(`portfolio kill switch drawdown should reflect the breached threshold: ${JSON.stringify(triggeredPortfolioState)}`);
  }

  portfolioStore.updatePrice({
    price: 99,
    source: "mock",
    symbol: "BTC/USDT",
    timestamp: 13_000
  });
  const latchedPortfolioState = portfolioStore.commitPortfolioKillSwitchState({ feeRate: 0.001, now: 13_000 });
  if (!latchedPortfolioState.triggered || latchedPortfolioState.triggeredAt !== 12_000) {
    throw new Error(`portfolio kill switch should stay latched after it has triggered once: ${JSON.stringify(latchedPortfolioState)}`);
  }

  let invalidModeRejected = false;
  try {
    portfolioStore.setPortfolioKillSwitchConfig({
      enabled: true,
      maxDrawdownPct: 5,
      mode: "panic_liquidate"
    });
  } catch (error) {
    invalidModeRejected = String(error?.message || "").includes("Unsupported portfolio kill switch mode");
  }
  if (!invalidModeRejected) {
    throw new Error("portfolio kill switch should reject unsupported modes instead of silently normalizing them");
  }

  const restoredStatusStore = new StateStore();
  restoredStatusStore.registerBot(createBotConfig({ id: "bot_restore", symbol: "SOL/USDT" }));
  restoredStatusStore.updateBotState("bot_restore", {
    status: "stopped"
  });
  restoredStatusStore.registerBot(createBotConfig({ id: "bot_restore", symbol: "SOL/USDT" }));
  const restoredStatus = restoredStatusStore.getBotState("bot_restore");
  if (restoredStatus?.status !== "idle") {
    throw new Error(`registerBot should sanitize stale stopped state for enabled bots: ${JSON.stringify(restoredStatus)}`);
  }

  restoredStatusStore.updateBotState("bot_restore", {
    pausedReason: "manual_pause",
    status: "paused"
  });
  restoredStatusStore.registerBot(createBotConfig({ id: "bot_restore", symbol: "SOL/USDT" }));
  const preservedPauseStatus = restoredStatusStore.getBotState("bot_restore");
  if (preservedPauseStatus?.status !== "paused" || preservedPauseStatus?.pausedReason !== "manual_pause") {
    throw new Error(`registerBot should preserve paused states with an existing reason across re-registration: ${JSON.stringify(preservedPauseStatus)}`);
  }

  restoredStatusStore.updateBotState("bot_restore", {
    pausedReason: null,
    status: "paused"
  });
  const sanitizedImpossiblePauseState = restoredStatusStore.getBotState("bot_restore");
  if (sanitizedImpossiblePauseState?.status === "paused" || sanitizedImpossiblePauseState?.pausedReason !== null) {
    throw new Error(`updateBotState should never persist paused state without a pausedReason: ${JSON.stringify(sanitizedImpossiblePauseState)}`);
  }

  restoredStatusStore.updateBotState("bot_restore", {
    pausedReason: "manual_pause",
    status: "idle"
  });
  const idleStateWithClearedPauseReason = restoredStatusStore.getBotState("bot_restore");
  if (idleStateWithClearedPauseReason?.status !== "idle" || idleStateWithClearedPauseReason?.pausedReason !== null) {
    throw new Error(`updateBotState should clear pausedReason whenever status is not paused: ${JSON.stringify(idleStateWithClearedPauseReason)}`);
  }

  restoredStatusStore.updateBotState("bot_restore", {
    pausedReason: "manual_pause",
    status: "paused"
  });
  const validManualPauseState = restoredStatusStore.getBotState("bot_restore");
  if (validManualPauseState?.status !== "paused" || validManualPauseState?.pausedReason !== "manual_pause") {
    throw new Error(`updateBotState should preserve valid paused states with an explicit reason: ${JSON.stringify(validManualPauseState)}`);
  }

  const originalDateNow = Date.now;
  try {
    Date.now = () => 1_000;
    const retentionStore = new StateStore({ symbolStateRetentionMs: 60_000 });
    retentionStore.updatePrice({
      price: 0.25,
      source: "mock",
      symbol: "ADA/USDT",
      timestamp: 1_000
    });
    retentionStore.updateKline({
      close: 0.25,
      closedAt: 1_000,
      high: 0.26,
      interval: "1m",
      isClosed: true,
      low: 0.24,
      open: 0.245,
      openedAt: 0,
      source: "rest",
      symbol: "ADA/USDT",
      timestamp: 1_000,
      volume: 100
    });
    retentionStore.recordTickLatencySample("ADA/USDT", {
      totalTickPipelineMs: 5
    }, 1_000);
    retentionStore.setContextSnapshot("ADA/USDT", {
      observedAt: 1_000,
      symbol: "ADA/USDT"
    });
    retentionStore.setArchitectObservedAssessment("ADA/USDT", {
      symbol: "ADA/USDT",
      updatedAt: 1_000
    });
    retentionStore.setArchitectPublishedAssessment("ADA/USDT", {
      symbol: "ADA/USDT",
      updatedAt: 1_000
    });
    retentionStore.setArchitectPublisherState("ADA/USDT", {
      lastObservedAt: 1_000,
      symbol: "ADA/USDT"
    });
    const preEvictionSymbolState = retentionStore.getSymbolStateSnapshot({ now: 30_000 });
    if (!preEvictionSymbolState.trackedSymbols.includes("ADA/USDT") || preEvictionSymbolState.staleCandidateSymbols.length !== 0) {
      throw new Error(`symbol state retention should preserve recently touched symbols: ${JSON.stringify(preEvictionSymbolState)}`);
    }
    const evictedSymbolState = retentionStore.evictStaleSymbolState({ now: 61_000 });
    if (evictedSymbolState.evictedSymbols.length !== 1 || evictedSymbolState.evictedSymbols[0] !== "ADA/USDT") {
      throw new Error(`symbol state retention should evict stale, unprotected symbols: ${JSON.stringify(evictedSymbolState)}`);
    }
    if (retentionStore.prices.has("ADA/USDT")
      || retentionStore.klines.has("ADA/USDT")
      || retentionStore.pipelineBySymbol.has("ADA/USDT")
      || retentionStore.tickLatencyBySymbol.has("ADA/USDT")
      || retentionStore.contextBySymbol.has("ADA/USDT")
      || retentionStore.architectObservedBySymbol.has("ADA/USDT")
      || retentionStore.architectPublishedBySymbol.has("ADA/USDT")
      || retentionStore.architectPublisherBySymbol.has("ADA/USDT")) {
      throw new Error("symbol state retention should remove stale symbol-scoped state across all symbol maps");
    }

    const protectedSymbolStore = new StateStore({ symbolStateRetentionMs: 60_000 });
    protectedSymbolStore.registerBot(createBotConfig({ id: "bot_protected", symbol: "XRP/USDT" }));
    protectedSymbolStore.updatePrice({
      price: 0.5,
      source: "mock",
      symbol: "XRP/USDT",
      timestamp: 1_000
    });
    const protectedSymbolState = protectedSymbolStore.evictStaleSymbolState({ now: 61_000 });
    if (protectedSymbolState.evictedSymbols.length !== 0 || !protectedSymbolState.protectedSymbols.includes("XRP/USDT")) {
      throw new Error(`symbol state retention should preserve registered watchlist symbols even when they look stale: ${JSON.stringify(protectedSymbolState)}`);
    }
    if (!protectedSymbolStore.prices.has("XRP/USDT")) {
      throw new Error("symbol state retention should not evict a protected symbol's price snapshot");
    }
  } finally {
    Date.now = originalDateNow;
  }
}

module.exports = {
  runStateStoreTests
};
