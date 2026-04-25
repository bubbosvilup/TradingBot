"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { StateStore } = require("../src/core/stateStore.ts");
const { SystemServer } = require("../src/core/systemServer.ts");

function createPublishedArchitect(now, overrides = {}) {
  return {
    absoluteConviction: 0.73,
    confidence: 0.7,
    contextMaturity: 0.81,
    dataMode: "live",
    decisionStrength: 0.18,
    familyScores: {
      mean_reversion: 0.24,
      no_trade: 0.16,
      trend_following: 0.71
    },
    featureConflict: 0.11,
    marketRegime: "trend",
    reasonCodes: ["trend_structure", "breakout_up"],
    recommendedFamily: "trend_following",
    regimeScores: {
      range: 0.24,
      trend: 0.71,
      unclear: 0.12,
      volatile: 0.16
    },
    sampleSize: 140,
    signalAgreement: 0.76,
    structureState: "trending",
    sufficientData: true,
    summary: "Market context favors trend_following.",
    symbol: "BTC/USDT",
    trendBias: "bullish",
    updatedAt: now,
    volatilityState: "normal",
    ...overrides
  };
}

function createResponseRecorder() {
  return {
    body: null,
    headers: null,
    statusCode: null,
    end(payload) {
      this.body = payload;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    }
  };
}

async function runSystemServerTests() {
  const now = Date.now();
  const store = new StateStore();
  store.registerBot({
    allowedStrategies: ["emaCross", "rsiReversion"],
    id: "bot_a",
    symbol: "BTC/USDT",
    strategy: "emaCross",
    enabled: true,
    riskProfile: "medium"
  });
  store.updatePrice({
    price: 67000,
    receivedAt: now,
    source: "mock",
    symbol: "BTC/USDT",
    timestamp: now
  });
  store.updateKline({
    close: 67020,
    closedAt: now,
    high: 67050,
    interval: "1m",
    isClosed: true,
    low: 66980,
    open: 67000,
    openedAt: now - 60000,
    receivedAt: now,
    source: "ws",
    symbol: "BTC/USDT",
    timestamp: now,
    volume: 12.4
  });
  store.appendEvent({
    id: "evt-1",
    level: "INFO",
    message: "system_ready",
    metadata: { bots: 1 },
    scope: "orchestrator",
    time: now
  });
  store.setContextSnapshot("BTC/USDT", {
    dataMode: "live",
    features: {
      breakoutDirection: "up",
      breakoutInstability: 0.08,
      breakoutQuality: 0.63,
      chopiness: 0.24,
      contextRsi: 64,
      dataQuality: 0.91,
      directionalEfficiency: 0.74,
      emaBias: 0.42,
      emaSeparation: 0.66,
      featureConflict: 0.11,
      maturity: 0.82,
      netMoveRatio: 0.018,
      reversionStretch: 0.21,
      rsiIntensity: 0.28,
      slopeConsistency: 0.71,
      volatilityRisk: 0.2
    },
    observedAt: now,
    effectiveSampleSize: 60,
    effectiveWarmupComplete: true,
    effectiveWindowSpanMs: 90_000,
    effectiveWindowStartedAt: now - 90_000,
    lastPublishedRegimeSwitchAt: now - 90_000,
    lastPublishedRegimeSwitchFrom: "range",
    lastPublishedRegimeSwitchTo: "trend",
    postSwitchCoveragePct: 0.375,
    rollingMaturity: 0.82,
    rollingSampleSize: 140,
    sampleSize: 140,
    structureState: "trending",
    summary: "Context ready.",
    symbol: "BTC/USDT",
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete: true,
    windowMode: "post_switch_segment",
    windowSpanMs: 240_000,
    windowStartedAt: now - 240_000
  });
  store.setArchitectPublishedAssessment("BTC/USDT", createPublishedArchitect(now, {
    mtf: {
      mtfAgreement: 0.8,
      mtfDominantFrame: "medium",
      mtfDominantTimeframe: "15m",
      mtfEnabled: true,
      mtfInstability: 0.2,
      mtfMetaRegime: "range",
      mtfReadyFrameCount: 3,
      mtfSufficientFrames: true
    }
  }));
  store.setArchitectObservedAssessment("BTC/USDT", createPublishedArchitect(now - 1000));
  store.setArchitectPublisherState("BTC/USDT", {
    challengerCount: 1,
    challengerRegime: "range",
    challengerRequired: 2,
    hysteresisActive: true,
    lastObservedAt: now,
    lastPublishedAt: now,
    lastPublishedRegime: "trend",
    nextPublishAt: now + 30_000,
    publishIntervalMs: 30_000,
    ready: true,
    symbol: "BTC/USDT",
    warmupStartedAt: now - 30_000
  });
  store.updateBotState("bot_a", {
    architectSyncStatus: "synced",
    postLossArchitectLatchActive: true,
    postLossArchitectLatchFreshPublishCount: 1,
    postLossArchitectLatchStrategyId: "emaCross"
  });
  store.setPosition("bot_a", {
    botId: "bot_a",
    confidence: 0.7,
    entryPrice: 66800,
    id: "position-1",
    notes: ["ema_cross_confirmed"],
    openedAt: now - 60_000,
    quantity: 0.02,
    side: "long",
    lifecycleMode: "managed_recovery",
    lifecycleState: "MANAGED_RECOVERY",
    managedRecoveryDeferredReason: "rsi_exit_deferred",
    managedRecoveryStartedAt: now - 30_000,
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  store.appendClosedTrade("bot_a", {
    botId: "bot_a",
    closedAt: now,
    entryPrice: 66800,
    entryReason: ["ema_cross_confirmed"],
    exitPrice: 67050,
    exitReason: ["take_profit_hit"],
    fees: 0.2,
    id: "trade-1",
    netPnl: 4.8,
    openedAt: now - 120000,
    pnl: 5,
    quantity: 0.02,
    reason: ["take_profit_hit"],
    side: "long",
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  store.setPortfolioKillSwitchConfig({
    enabled: true,
    maxDrawdownPct: 8,
    mode: "block_entries_only"
  });
  store.setSymbolStateRetentionMs(90_000);

  const server = new SystemServer({
    architectWarmupMs: 20_000,
    executionMode: "paper",
    feeRate: 0.001,
    feedMode: "live",
    logger: { info() {} },
    port: 3101,
    startedAt: now - 1000,
    store
  });

  const system = server.buildSystemPayload();
  const bots = server.buildBotsPayload();
  const prices = server.buildPricesPayload();
  const events = server.buildEventsPayload();
  const chart = server.buildChartPayload("BTC/USDT");
  const analytics = server.buildAnalyticsPayload();
  const trades = server.buildTradesPayload();
  const pulse = server.buildPulsePayload({ botId: "bot_a" });

  if (system.feedMode !== "live") {
    throw new Error("system payload missing feed mode");
  }
  if (system.botsPaused !== 0 || system.botsManualResumeRequired !== 0) {
    throw new Error(`system payload should distinguish paused/manual-resume counts even when zero: ${JSON.stringify(system)}`);
  }
  if (system.executionMode !== "paper" || system.executionSafety !== "simulated_only") {
    throw new Error("system payload missing execution safety mode");
  }
  if (system.accountingModel !== "paper_full_notional_simplified"
    || !Array.isArray(system.accountingWarnings)
    || !system.accountingWarnings[0]?.includes("simplified full-notional accounting")) {
    throw new Error(`system payload should expose paper accounting safety metadata: ${JSON.stringify(system)}`);
  }
  if (!system.portfolioKillSwitch || system.portfolioKillSwitch.enabled !== true || system.portfolioKillSwitch.mode !== "block_entries_only") {
    throw new Error(`system payload should expose portfolio kill switch state clearly: ${JSON.stringify(system)}`);
  }
  if (!system.symbolState
    || system.symbolState.staleAfterMs !== 90_000
    || !Array.isArray(system.symbolState.trackedSymbols)
    || !system.symbolState.trackedSymbols.includes("BTC/USDT")) {
    throw new Error(`system payload should expose symbol-state retention diagnostics clearly: ${JSON.stringify(system)}`);
  }
  if (!Array.isArray(bots) || bots.length !== 1 || bots[0].botId !== "bot_a") {
    throw new Error("bots payload invalid");
  }
  if (!bots[0].portfolioKillSwitch || bots[0].portfolioKillSwitch.enabled !== true || bots[0].portfolioKillSwitch.triggered !== false) {
    throw new Error(`bots payload should include the shared portfolio kill switch snapshot: ${JSON.stringify(bots[0])}`);
  }
  if (bots[0].pausedReason !== null || bots[0].manualResumeRequired !== false) {
    throw new Error(`bots payload should keep bot-level pause semantics explicit and separate from portfolio kill switch state: ${JSON.stringify(bots[0])}`);
  }
  if (bots[0].postLossArchitectLatchActive !== true || bots[0].postLossArchitectLatchFreshPublishCount !== 1 || bots[0].postLossArchitectLatchStrategyId !== "emaCross") {
    throw new Error(`bots payload should expose compact latch state without moving dashboard concerns into bot logic: ${JSON.stringify(bots[0])}`);
  }
  if (bots[0].openPosition?.lifecycleMode !== "managed_recovery" || bots[0].openPosition?.lifecycleState !== "MANAGED_RECOVERY" || bots[0].openPosition?.managedRecoveryDeferredReason !== "rsi_exit_deferred") {
    throw new Error(`bots payload should expose compact open-position recovery state: ${JSON.stringify(bots[0].openPosition)}`);
  }
  if (bots[0].architect?.recommendedFamily !== "trend_following" || bots[0].architect?.authoritative !== true) {
    throw new Error("bots payload missing published architect assessment");
  }
  if (bots[0].architectPublished?.recommendedFamily !== "trend_following") {
    throw new Error("bots payload missing authoritative architectPublished");
  }
  if (bots[0].architectPublished?.mtf?.mtfDominantFrame !== "medium"
    || bots[0].architectPublished?.mtf?.mtfAgreement !== 0.8
    || bots[0].architectPublished?.mtf?.mtfInstability !== 0.2
    || bots[0].architectPublished?.mtf?.mtfSufficientFrames !== true) {
    throw new Error(`bots payload should preserve published MTF diagnostics: ${JSON.stringify(bots[0].architectPublished?.mtf)}`);
  }
  if (bots[0].architectObserved?.source !== "observed" || bots[0].architectObserved?.authoritative !== false) {
    throw new Error("bots payload missing observed architect distinction");
  }
  if (bots[0].architect?.decisionStrength !== 0.18 || bots[0].architect?.signalAgreement !== 0.76) {
    throw new Error("bots payload missing architect diagnostics");
  }
  if (bots[0].architect?.dataQuality !== 0.91) {
    throw new Error("bots payload missing architect data quality");
  }
  if (bots[0].architect?.contextFeatures?.directionalEfficiency !== 0.74 || bots[0].architect?.contextFeatures?.volatilityRisk !== 0.2) {
    throw new Error("bots payload missing architect context features");
  }
  if (bots[0].architect?.contextFeatures?.architectContextRsi !== 64 || bots[0].architect?.contextFeatures?.architectRsiIntensity !== 0.28) {
    throw new Error("bots payload should distinguish architect context RSI diagnostics");
  }
  if (bots[0].architect?.effectiveWindowStartedAt !== now - 90_000 || bots[0].architect?.postSwitchCoveragePct !== 0.375 || bots[0].architect?.rollingMaturity !== 0.82) {
    throw new Error("bots payload missing post-switch warmup diagnostics");
  }
  if (bots[0].architect?.challenger?.regime !== "range" || bots[0].architect?.hysteresisActive !== true) {
    throw new Error("bots payload missing publisher hysteresis state");
  }
  if (bots[0].syntheticArchitect !== false || bots[0].architectFallback !== null) {
    throw new Error("bots payload should not mark published architect as synthetic");
  }
  if (bots[0].syncStatus !== "synced") {
    throw new Error(`unexpected bot sync status: ${bots[0].syncStatus}`);
  }
  if (bots[0].performance?.avgTradePnlUsdt !== 0) {
    throw new Error("bots payload should expose avgTradePnlUsdt on performance");
  }
  const expectedUnrealizedPnl = ((67000 - 66800) * 0.02) - ((66800 * 0.02) + (67000 * 0.02)) * 0.001;
  if (Math.abs(Number(bots[0].openPosition?.unrealizedPnl) - expectedUnrealizedPnl) > 1e-9) {
    throw new Error(`bots payload unrealizedPnl should be fee-aware net economics: ${JSON.stringify(bots[0].openPosition)}`);
  }
  if (!Array.isArray(prices) || prices.length !== 1 || prices[0].symbol !== "BTC/USDT") {
    throw new Error("prices payload invalid");
  }
  if (!Array.isArray(events) || events.length !== 1 || events[0].message !== "system_ready") {
    throw new Error("events payload invalid");
  }
  if (!Array.isArray(chart.lineData) || chart.lineData.length !== 1) {
    throw new Error("chart line payload invalid");
  }
  if (!Array.isArray(chart.candles["1m"]) || chart.candles["1m"].length !== 1) {
    throw new Error("chart candle payload invalid");
  }
  if (!Array.isArray(chart.markers) || chart.markers.length !== 3) {
    throw new Error("chart marker payload invalid");
  }
  if (!Array.isArray(analytics.comparison) || analytics.comparison.length !== 1) {
    throw new Error("analytics comparison payload invalid");
  }
  if (!Array.isArray(trades) || trades.length !== 1 || trades[0].entryReason[0] !== "ema_cross_confirmed") {
    throw new Error("trades payload invalid");
  }
  const positions = server.buildPositionsPayload();
  if (!Array.isArray(positions) || positions.length !== 1 || Math.abs(Number(positions[0].unrealizedPnl) - expectedUnrealizedPnl) > 1e-9) {
    throw new Error(`positions payload unrealizedPnl should stay aligned with fee-aware server economics: ${JSON.stringify(positions)}`);
  }
  if (pulse.statusBar.feedMode !== "LIVE" || pulse.statusBar.executionMode !== "PAPER" || pulse.statusBar.bots.running !== 0 || pulse.statusBar.bots.total !== 1) {
    throw new Error(`pulse status bar should normalize operator-visible runtime modes and bot counts: ${JSON.stringify(pulse.statusBar)}`);
  }
  if (pulse.statusBar.accountingModel !== "paper_full_notional_simplified"
    || !Array.isArray(pulse.statusBar.accountingWarnings)
    || !pulse.statusBar.accountingWarnings[0]?.includes("does not model margin")) {
    throw new Error(`pulse status bar should expose paper accounting safety metadata: ${JSON.stringify(pulse.statusBar)}`);
  }
  if (pulse.statusBar.killSwitch.state !== "armed" || pulse.statusBar.killSwitch.severity !== "normal") {
    throw new Error(`pulse should normalize non-triggered kill switch state: ${JSON.stringify(pulse.statusBar.killSwitch)}`);
  }
  if (pulse.statusBar.marketStream.status !== "disconnected" || !Number.isFinite(Number(pulse.statusBar.lastTickAgeMs))) {
    throw new Error(`pulse should normalize market stream status and tick freshness: ${JSON.stringify(pulse.statusBar)}`);
  }
  if (pulse.statusBar.openPositions !== 1 || Math.abs(Number(pulse.statusBar.netPnlUsdt) - expectedUnrealizedPnl) > 1e-9) {
    throw new Error(`pulse should derive open positions and net pnl consistently: ${JSON.stringify(pulse.statusBar)}`);
  }
  if (!Array.isArray(pulse.botCards) || pulse.botCards.length !== 1 || pulse.botCards[0].regime !== "trend" || pulse.botCards[0].syncStatus !== "synced") {
    throw new Error(`pulse bot card should expose normalized regime/sync state: ${JSON.stringify(pulse.botCards)}`);
  }
  if (pulse.botCards[0].position.state !== "long" || Math.abs(Number(pulse.botCards[0].position.pnlUsdt) - expectedUnrealizedPnl) > 1e-9 || !String(pulse.botCards[0].position.label).startsWith("LONG +")) {
    throw new Error(`pulse bot card should expose normalized position state: ${JSON.stringify(pulse.botCards[0].position)}`);
  }
  if (pulse.botCards[0].alert?.type !== "managed_recovery" || pulse.botCards[0].alert?.severity !== "warning") {
    throw new Error(`pulse bot card should derive a single structured managed-recovery alert: ${JSON.stringify(pulse.botCards[0].alert)}`);
  }
  if (pulse.focusPanel.botId !== "bot_a"
    || pulse.focusPanel.architect.line !== "trend regime . trend-following bias . strength 0.18"
    || pulse.focusPanel.architect.bias !== "trend_following"
    || pulse.focusPanel.actions.resume.visible !== false
    || pulse.focusPanel.actions.history.enabled !== true) {
    throw new Error(`pulse focus panel should expose normalized architect summary and actions: ${JSON.stringify(pulse.focusPanel)}`);
  }

  const pureReadStore = new StateStore();
  pureReadStore.registerBot({
    allowedStrategies: ["emaCross"],
    enabled: true,
    id: "bot_pure_read",
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "BTC/USDT"
  });
  pureReadStore.setPortfolioKillSwitchConfig({
    enabled: true,
    maxDrawdownPct: 5,
    mode: "block_entries_only"
  });
  pureReadStore.updateBotState("bot_pure_read", {
    realizedPnl: -60
  });
  const pureReadServer = new SystemServer({
    executionMode: "paper",
    feeRate: 0.001,
    feedMode: "live",
    logger: { info() {} },
    port: 3111,
    startedAt: now - 1000,
    store: pureReadStore
  });
  const pureReadSystem = pureReadServer.buildSystemPayload();
  if (!pureReadSystem.portfolioKillSwitch?.triggered) {
    throw new Error(`system payload should still compute a triggered kill switch snapshot for API readers: ${JSON.stringify(pureReadSystem.portfolioKillSwitch)}`);
  }
  if (pureReadStore.portfolioKillSwitchState.triggered || pureReadStore.portfolioKillSwitchState.updatedAt !== null) {
    throw new Error(`system-server read paths must not latch or mutate portfolio kill switch state: ${JSON.stringify(pureReadStore.portfolioKillSwitchState)}`);
  }

  const observedOnlyStore = new StateStore();
  observedOnlyStore.registerBot({
    allowedStrategies: ["emaCross", "rsiReversion"],
    id: "bot_observed",
    symbol: "ETH/USDT",
    strategy: "emaCross",
    enabled: true,
    riskProfile: "medium"
  });
  observedOnlyStore.setContextSnapshot("ETH/USDT", {
    dataMode: "live",
    features: {
      breakoutDirection: "none",
      breakoutInstability: 0.04,
      breakoutQuality: 0.18,
      chopiness: 0.31,
      dataQuality: 0.88,
      directionalEfficiency: 0.58,
      emaBias: 0.21,
      emaSeparation: 0.51,
      featureConflict: 0.09,
      maturity: 0.74,
      netMoveRatio: 0.01,
      reversionStretch: 0.16,
      rsiIntensity: 0.2,
      slopeConsistency: 0.6,
      volatilityRisk: 0.19
    },
    observedAt: now,
    sampleSize: 100,
    structureState: "trending",
    summary: "Observed architect context.",
    symbol: "ETH/USDT",
    trendBias: "bullish",
    volatilityState: "normal",
    warmupComplete: true,
    windowSpanMs: 180_000,
    windowStartedAt: now - 180_000
  });
  observedOnlyStore.setArchitectObservedAssessment("ETH/USDT", {
    ...createPublishedArchitect(now),
    symbol: "ETH/USDT"
  });
  observedOnlyStore.setArchitectPublisherState("ETH/USDT", {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: now,
    lastPublishedAt: null,
    lastPublishedRegime: null,
    nextPublishAt: now + 30_000,
    publishIntervalMs: 30_000,
    ready: false,
    symbol: "ETH/USDT",
    warmupStartedAt: now - 15_000
  });
  const observedOnlyBots = new SystemServer({
    architectWarmupMs: 20_000,
    executionMode: "paper",
    feedMode: "live",
    logger: { info() {} },
    port: 3102,
    startedAt: now - 1000,
    store: observedOnlyStore
  }).buildBotsPayload();
  if (observedOnlyBots[0].architect !== null || observedOnlyBots[0].architectPublished !== null) {
    throw new Error("observed-only payload should not pretend published architect authority exists");
  }
  if (observedOnlyBots[0].architectObserved?.source !== "observed" || observedOnlyBots[0].syntheticArchitect !== false) {
    throw new Error("observed-only payload did not preserve non-authoritative observed state");
  }

  const shortStore = new StateStore();
  shortStore.registerBot({
    allowedStrategies: ["emaCross", "rsiReversion"],
    id: "bot_short",
    symbol: "ETH/USDT",
    strategy: "rsiReversion",
    enabled: true,
    riskProfile: "medium"
  });
  shortStore.updatePrice({
    price: 2480,
    receivedAt: now,
    source: "mock",
    symbol: "ETH/USDT",
    timestamp: now
  });
  shortStore.updateKline({
    close: 2480,
    closedAt: now,
    high: 2490,
    interval: "1m",
    isClosed: true,
    low: 2470,
    open: 2485,
    openedAt: now - 60000,
    receivedAt: now,
    source: "ws",
    symbol: "ETH/USDT",
    timestamp: now,
    volume: 7.2
  });
  shortStore.setPosition("bot_short", {
    botId: "bot_short",
    confidence: 0.82,
    entryPrice: 2500,
    id: "position-short-open",
    notes: ["overbought_mean_reversion"],
    openedAt: now - 45_000,
    quantity: 0.5,
    side: "short",
    strategyId: "rsiReversion",
    symbol: "ETH/USDT"
  });
  shortStore.appendClosedTrade("bot_short", {
    botId: "bot_short",
    closedAt: now - 5_000,
    entryPrice: 2520,
    entryReason: ["overbought_mean_reversion"],
    exitPrice: 2490,
    exitReason: ["reversion_price_target_hit"],
    fees: 0.3,
    id: "trade-short-1",
    netPnl: 14.7,
    openedAt: now - 95_000,
    pnl: 15,
    quantity: 0.5,
    reason: ["reversion_price_target_hit"],
    side: "short",
    strategyId: "rsiReversion",
    symbol: "ETH/USDT"
  });
  const shortServer = new SystemServer({
    executionMode: "paper",
    feeRate: 0.001,
    feedMode: "live",
    logger: { info() {} },
    port: 3110,
    startedAt: now - 1000,
    store: shortStore
  });
  const shortTrades = shortServer.buildTradesPayload();
  if (!Array.isArray(shortTrades) || shortTrades.length !== 1 || shortTrades[0].side !== "short" || shortTrades[0].exitReason[0] !== "reversion_price_target_hit") {
    throw new Error(`trades payload should surface short closed trades explicitly: ${JSON.stringify(shortTrades)}`);
  }
  if (shortTrades[0].accountingModel !== "paper_full_notional_simplified"
    || !Array.isArray(shortTrades[0].accountingWarnings)
    || !shortTrades[0].accountingWarnings[0]?.includes("funding, or liquidation")) {
    throw new Error(`short trades payload should expose paper accounting safety metadata: ${JSON.stringify(shortTrades[0])}`);
  }
  const shortChart = shortServer.buildChartPayload("ETH/USDT");
  const shortEntryMarker = shortChart.markers.find((marker) => String(marker.text || "").startsWith("SHORT "));
  const shortExitMarker = shortChart.markers.find((marker) => String(marker.text || "").startsWith("COVER "));
  if (!shortEntryMarker || !shortExitMarker) {
    throw new Error(`chart payload should label short entry/exit markers as SHORT/COVER: ${JSON.stringify(shortChart.markers)}`);
  }
  if (shortEntryMarker.shape !== "arrowDown" || shortExitMarker.shape !== "arrowUp") {
    throw new Error(`short chart markers should preserve directional arrow semantics: ${JSON.stringify(shortChart.markers)}`);
  }
  const shortPositions = shortServer.buildPositionsPayload();
  const shortPulse = shortServer.buildPulsePayload({ botId: "bot_short" });
  if (!Array.isArray(shortPositions) || shortPositions.length !== 1 || shortPositions[0].side !== "short") {
    throw new Error(`positions payload should surface open shorts with normalized side: ${JSON.stringify(shortPositions)}`);
  }
  if (shortPositions[0].accountingModel !== "paper_full_notional_simplified"
    || !Array.isArray(shortPositions[0].accountingWarnings)
    || !shortPositions[0].accountingWarnings[0]?.includes("borrowing")) {
    throw new Error(`short positions payload should expose paper accounting safety metadata: ${JSON.stringify(shortPositions[0])}`);
  }
  if (shortChart.position?.accountingModel !== "paper_full_notional_simplified"
    || !Array.isArray(shortChart.position?.accountingWarnings)) {
    throw new Error(`chart short position payload should expose paper accounting safety metadata: ${JSON.stringify(shortChart.position)}`);
  }
  if (shortPulse.botCards[0].position.state !== "short" || !String(shortPulse.botCards[0].position.label).startsWith("SHORT ")) {
    throw new Error(`pulse payload should render open short positions explicitly: ${JSON.stringify(shortPulse.botCards[0].position)}`);
  }

  const syntheticStore = new StateStore();
  syntheticStore.registerBot({
    allowedStrategies: ["emaCross", "rsiReversion"],
    id: "bot_synthetic",
    symbol: "SOL/USDT",
    strategy: "emaCross",
    enabled: true,
    riskProfile: "medium"
  });
  syntheticStore.setContextSnapshot("SOL/USDT", {
    dataMode: "live",
    features: {
      breakoutDirection: "none",
      breakoutInstability: 0.02,
      breakoutQuality: 0.08,
      chopiness: 0.4,
      dataQuality: 0.7,
      directionalEfficiency: 0.22,
      emaBias: 0.05,
      emaSeparation: 0.1,
      featureConflict: 0.12,
      maturity: 0.14,
      netMoveRatio: 0.003,
      reversionStretch: 0.1,
      rsiIntensity: 0.12,
      slopeConsistency: 0.2,
      volatilityRisk: 0.28
    },
    observedAt: now,
    sampleSize: 20,
    structureState: "choppy",
    summary: "Warm-up context.",
    symbol: "SOL/USDT",
    trendBias: "neutral",
    volatilityState: "normal",
    warmupComplete: false,
    windowSpanMs: 12_000,
    windowStartedAt: now - 12_000
  });
  syntheticStore.setArchitectPublisherState("SOL/USDT", {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: now,
    lastPublishedAt: null,
    lastPublishedRegime: null,
    nextPublishAt: now + 18_000,
    publishIntervalMs: 30_000,
    ready: false,
    symbol: "SOL/USDT",
    warmupStartedAt: now - 12_000
  });
  const syntheticServer = new SystemServer({
    architectWarmupMs: 20_000,
    executionMode: "paper",
    feedMode: "live",
    logger: { info() {} },
    port: 3103,
    startedAt: now - 1000,
    store: syntheticStore
  });
  const syntheticBots = syntheticServer.buildBotsPayload();
  const syntheticPulse = syntheticServer.buildPulsePayload({ botId: "bot_synthetic" });
  if (syntheticBots[0].architect !== null || syntheticBots[0].architectObserved !== null) {
    throw new Error("synthetic warm-up payload should not expose fake architect authority");
  }
  if (syntheticBots[0].syntheticArchitect !== true || syntheticBots[0].architectFallback?.source !== "synthetic") {
    throw new Error("synthetic warm-up payload missing explicit synthetic architect marker");
  }
  if (syntheticBots[0].architectFallback?.warmupRemainingMs !== 8_000) {
    throw new Error(`synthetic warm-up payload should respect configured architect warmup: ${JSON.stringify(syntheticBots[0].architectFallback)}`);
  }
  if (syntheticPulse.botCards[0].regime !== "warming_up"
    || syntheticPulse.botCards[0].syncStatus !== "warming_up"
    || syntheticPulse.focusPanel.architect.line !== "warming up..."
    || syntheticPulse.focusPanel.architect.regime !== "warming_up") {
    throw new Error(`pulse should not promote synthetic warm-up into published architect authority: ${JSON.stringify(syntheticPulse)}`);
  }

  const pausedStore = new StateStore();
  pausedStore.registerBot({
    allowedStrategies: ["emaCross"],
    enabled: true,
    id: "bot_paused",
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "XRP/USDT"
  });
  pausedStore.updateBotState("bot_paused", {
    pausedReason: "max_drawdown_reached",
    status: "paused"
  });
  pausedStore.setPortfolioKillSwitchConfig({
    enabled: true,
    maxDrawdownPct: 8,
    mode: "block_entries_only"
  });
  const pausedServer = new SystemServer({
    architectWarmupMs: 20_000,
    executionMode: "paper",
    feedMode: "live",
    logger: { info() {} },
    port: 3105,
    startedAt: now - 1000,
    store: pausedStore
  });
  const pausedSystem = pausedServer.buildSystemPayload();
  const pausedBots = pausedServer.buildBotsPayload();
  const pausedPulse = pausedServer.buildPulsePayload({ botId: "bot_paused" });
  if (pausedSystem.botsPaused !== 1 || pausedSystem.botsManualResumeRequired !== 1) {
    throw new Error(`system payload should count drawdown-paused bots requiring manual resume explicitly: ${JSON.stringify(pausedSystem)}`);
  }
  if (pausedBots[0].status !== "paused" || pausedBots[0].pausedReason !== "max_drawdown_reached" || pausedBots[0].manualResumeRequired !== true) {
    throw new Error(`bots payload should expose drawdown pause semantics explicitly: ${JSON.stringify(pausedBots[0])}`);
  }
  if (pausedBots[0].portfolioKillSwitch.triggered !== false) {
    throw new Error(`bot payload should keep bot-level drawdown pause distinct from portfolio kill switch state: ${JSON.stringify(pausedBots[0])}`);
  }
  if (pausedPulse.botCards[0].alert?.type !== "manual_resume_required"
    || pausedPulse.botCards[0].alert?.severity !== "critical"
    || pausedPulse.focusPanel.actions.resume.visible !== true
    || pausedPulse.focusPanel.actions.resume.enabled !== true) {
    throw new Error(`pulse should expose manual-resume action only when the bot-level pause requires it: ${JSON.stringify(pausedPulse)}`);
  }
  const resumeLogs = [];
  const resumeServer = new SystemServer({
    architectWarmupMs: 20_000,
    executionMode: "paper",
    feedMode: "live",
    logger: {
      info(message, metadata) {
        resumeLogs.push({ message, metadata });
      }
    },
    port: 3107,
    startedAt: now - 1000,
    store: pausedStore
  });
  const resumeResponse = createResponseRecorder();
  resumeServer.handleRequest({
    headers: { host: "127.0.0.1:3107" },
    method: "POST",
    url: "/api/bots/bot_paused/resume"
  }, resumeResponse);
  const resumedState = pausedStore.getBotState("bot_paused");
  const resumePayload = JSON.parse(String(resumeResponse.body || "{}"));
  if (resumeResponse.statusCode !== 200 || resumePayload.ok !== true || resumedState.status !== "running" || resumedState.pausedReason !== null) {
    throw new Error(`manual resume API should explicitly resume drawdown-paused bots: ${JSON.stringify({ resumeResponse, resumePayload, resumedState })}`);
  }
  if (!resumeLogs.find((entry) => entry.message === "bot_manual_resume" && entry.metadata?.botId === "bot_paused")) {
    throw new Error(`manual resume API should log the explicit operator action: ${JSON.stringify(resumeLogs)}`);
  }
  const repeatResumeResponse = createResponseRecorder();
  resumeServer.handleRequest({
    headers: { host: "127.0.0.1:3107" },
    method: "POST",
    url: "/api/bots/bot_paused/resume"
  }, repeatResumeResponse);
  if (repeatResumeResponse.statusCode !== 409 || JSON.parse(String(repeatResumeResponse.body || "{}")).error !== "manual_resume_not_required") {
    throw new Error(`manual resume API should reject bots that do not require manual resume: ${JSON.stringify(repeatResumeResponse)}`);
  }

  pausedStore.updateBotState("bot_paused", {
    cooldownReason: "loss_cooldown",
    cooldownUntil: now + 60_000,
    lastDecisionReasons: [
      "post_loss_latch_timeout_requires_operator",
      "cooldown_active"
    ],
    pausedReason: "max_drawdown_reached",
    postLossArchitectLatchActive: true,
    postLossArchitectLatchActivatedAt: now - 30_000,
    postLossArchitectLatchFreshPublishCount: 1,
    postLossArchitectLatchLastCountedPublishedAt: now - 10_000,
    postLossArchitectLatchStartedAt: now - 30_000,
    postLossArchitectLatchStrategyId: "emaCross",
    postLossArchitectLatchTimedOutAt: now - 5_000,
    status: "paused"
  });
  const latchResetResponse = createResponseRecorder();
  resumeServer.handleRequest({
    headers: { host: "127.0.0.1:3107" },
    method: "POST",
    url: "/api/bots/bot_paused/reset-post-loss-latch"
  }, latchResetResponse);
  const latchResetPayload = JSON.parse(String(latchResetResponse.body || "{}"));
  const latchResetState = pausedStore.getBotState("bot_paused");
  if (latchResetResponse.statusCode !== 200 || latchResetPayload.ok !== true || latchResetPayload.action !== "manual_post_loss_latch_reset") {
    throw new Error(`post-loss latch reset API should surface the explicit operator action: ${JSON.stringify({ latchResetResponse, latchResetPayload })}`);
  }
  if (latchResetState.postLossArchitectLatchActive !== false
    || latchResetState.postLossArchitectLatchActivatedAt !== null
    || latchResetState.postLossArchitectLatchFreshPublishCount !== 0
    || latchResetState.postLossArchitectLatchLastCountedPublishedAt !== null
    || latchResetState.postLossArchitectLatchStartedAt !== null
    || latchResetState.postLossArchitectLatchStrategyId !== null
    || latchResetState.postLossArchitectLatchTimedOutAt !== null) {
    throw new Error(`post-loss latch reset API should clear only latch state: ${JSON.stringify(latchResetState)}`);
  }
  if (latchResetState.status !== "paused"
    || latchResetState.pausedReason !== "max_drawdown_reached"
    || latchResetState.cooldownReason !== "loss_cooldown"
    || latchResetState.cooldownUntil !== now + 60_000
    || latchResetState.lastDecisionReasons.includes("post_loss_latch_timeout_requires_operator")
    || !latchResetState.lastDecisionReasons.includes("cooldown_active")) {
    throw new Error(`post-loss latch reset API should preserve paused/cooldown state and remove only latch reasons: ${JSON.stringify(latchResetState)}`);
  }
  if (!resumeLogs.find((entry) => entry.message === "manual_post_loss_latch_reset" && entry.metadata?.botId === "bot_paused")) {
    throw new Error(`post-loss latch reset API should log the manual reset action: ${JSON.stringify(resumeLogs)}`);
  }
  const repeatLatchResetResponse = createResponseRecorder();
  resumeServer.handleRequest({
    headers: { host: "127.0.0.1:3107" },
    method: "POST",
    url: "/api/bots/bot_paused/reset-post-loss-latch"
  }, repeatLatchResetResponse);
  if (repeatLatchResetResponse.statusCode !== 409 || JSON.parse(String(repeatLatchResetResponse.body || "{}")).error !== "post_loss_latch_reset_not_required") {
    throw new Error(`post-loss latch reset API should reject bots without active/timed-out latch state: ${JSON.stringify(repeatLatchResetResponse)}`);
  }
  const missingLatchResetResponse = createResponseRecorder();
  resumeServer.handleRequest({
    headers: { host: "127.0.0.1:3107" },
    method: "POST",
    url: "/api/bots/missing/reset-post-loss-latch"
  }, missingLatchResetResponse);
  if (missingLatchResetResponse.statusCode !== 404 || JSON.parse(String(missingLatchResetResponse.body || "{}")).error !== "bot_not_found") {
    throw new Error(`post-loss latch reset API should follow bot-not-found style: ${JSON.stringify(missingLatchResetResponse)}`);
  }

  const killSwitchResumeStore = new StateStore();
  killSwitchResumeStore.registerBot({
    allowedStrategies: ["emaCross"],
    enabled: true,
    id: "bot_kill_paused",
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "ADA/USDT"
  });
  killSwitchResumeStore.updateBotState("bot_kill_paused", {
    availableBalanceUsdt: 80,
    cooldownReason: "loss_cooldown",
    cooldownUntil: now + 90_000,
    lastDecisionReasons: ["post_loss_architect_latch", "cooldown_active"],
    pausedReason: "max_drawdown_reached",
    postLossArchitectLatchActive: true,
    postLossArchitectLatchStartedAt: now - 20_000,
    postLossArchitectLatchStrategyId: "emaCross",
    realizedPnl: -20,
    status: "paused"
  });
  killSwitchResumeStore.setMarketDataFreshness("ADA/USDT", {
    lastTickTimestamp: now - 120_000,
    reason: "market_data_stale",
    status: "stale",
    updatedAt: now - 120_000
  });
  killSwitchResumeStore.setPortfolioKillSwitchConfig({
    enabled: true,
    maxDrawdownPct: 1,
    mode: "block_entries_only"
  });
  killSwitchResumeStore.updatePrice({
    price: 1,
    receivedAt: now,
    source: "mock",
    symbol: "ADA/USDT",
    timestamp: now
  });
  killSwitchResumeStore.setPerformance("bot_kill_paused", {
    avgTradePnlUsdt: -20,
    botId: "bot_kill_paused",
    currentEquity: 80,
    drawdown: 20,
    grossLoss: 20,
    grossProfit: 0,
    losses: 1,
    peakEquity: 100,
    pnl: -20,
    profitFactor: 0,
    recentNetPnl: [-20],
    tradesCount: 1,
    winRate: 0,
    wins: 0
  });
  const killSwitchLogs = [];
  const killSwitchResumeServer = new SystemServer({
    executionMode: "paper",
    feedMode: "live",
    logger: {
      info(message, metadata) {
        killSwitchLogs.push({ message, metadata });
      }
    },
    port: 3108,
    startedAt: now - 1000,
    store: killSwitchResumeStore
  });
  const killSwitchResumeResponse = createResponseRecorder();
  killSwitchResumeServer.handleRequest({
    headers: { host: "127.0.0.1:3108" },
    method: "POST",
    url: "/api/bots/bot_kill_paused/resume"
  }, killSwitchResumeResponse);
  if (killSwitchResumeResponse.statusCode !== 423 || killSwitchResumeStore.getBotState("bot_kill_paused").status !== "paused") {
    throw new Error(`manual resume API must not bypass an active portfolio kill switch: ${JSON.stringify(killSwitchResumeResponse)}`);
  }
  const killSwitchPulse = killSwitchResumeServer.buildPulsePayload({ botId: "bot_kill_paused" });
  if (killSwitchPulse.statusBar.killSwitch.state !== "triggered"
    || killSwitchPulse.statusBar.killSwitch.severity !== "critical"
    || killSwitchPulse.focusPanel.actions.resume.visible !== true
    || killSwitchPulse.focusPanel.actions.resume.enabled !== false
    || killSwitchPulse.focusPanel.actions.resume.reason !== "portfolio_kill_switch_active") {
    throw new Error(`pulse should normalize kill-switch-triggered state and disable resume explicitly: ${JSON.stringify(killSwitchPulse)}`);
  }
  const killSwitchStateBeforeReset = killSwitchResumeStore.getPortfolioKillSwitchState({ feeRate: 0, now });
  if (!killSwitchStateBeforeReset.triggered || !killSwitchStateBeforeReset.blockingEntries) {
    throw new Error(`portfolio kill switch should block entries before manual reset: ${JSON.stringify(killSwitchStateBeforeReset)}`);
  }
  const stateBeforeKillSwitchReset = killSwitchResumeStore.getBotState("bot_kill_paused");
  const freshnessBeforeKillSwitchReset = killSwitchResumeStore.getMarketDataFreshness("ADA/USDT");
  const resetKillSwitchResponse = createResponseRecorder();
  killSwitchResumeServer.handleRequest({
    headers: { host: "127.0.0.1:3108" },
    method: "POST",
    url: "/api/kill-switch/reset"
  }, resetKillSwitchResponse);
  const resetKillSwitchPayload = JSON.parse(String(resetKillSwitchResponse.body || "{}"));
  const killSwitchStateAfterReset = killSwitchResumeStore.getPortfolioKillSwitchState({ feeRate: 0, now: now + 1 });
  const stateAfterKillSwitchReset = killSwitchResumeStore.getBotState("bot_kill_paused");
  const freshnessAfterKillSwitchReset = killSwitchResumeStore.getMarketDataFreshness("ADA/USDT");
  if (resetKillSwitchResponse.statusCode !== 200
    || resetKillSwitchPayload.ok !== true
    || resetKillSwitchPayload.action !== "manual_portfolio_kill_switch_reset"
    || resetKillSwitchPayload.portfolioKillSwitch?.triggered !== false) {
    throw new Error(`portfolio kill-switch reset API should surface the explicit operator action: ${JSON.stringify({ resetKillSwitchResponse, resetKillSwitchPayload })}`);
  }
  if (killSwitchStateAfterReset.triggered !== false
    || killSwitchStateAfterReset.blockingEntries !== false
    || killSwitchStateAfterReset.triggeredAt !== null
    || killSwitchStateAfterReset.reason !== null) {
    throw new Error(`portfolio kill-switch reset API should clear only trigger state: ${JSON.stringify(killSwitchStateAfterReset)}`);
  }
  if (stateAfterKillSwitchReset.status !== stateBeforeKillSwitchReset.status
    || stateAfterKillSwitchReset.pausedReason !== stateBeforeKillSwitchReset.pausedReason
    || stateAfterKillSwitchReset.cooldownReason !== stateBeforeKillSwitchReset.cooldownReason
    || stateAfterKillSwitchReset.cooldownUntil !== stateBeforeKillSwitchReset.cooldownUntil
    || stateAfterKillSwitchReset.postLossArchitectLatchActive !== stateBeforeKillSwitchReset.postLossArchitectLatchActive
    || stateAfterKillSwitchReset.postLossArchitectLatchStartedAt !== stateBeforeKillSwitchReset.postLossArchitectLatchStartedAt
    || stateAfterKillSwitchReset.postLossArchitectLatchStrategyId !== stateBeforeKillSwitchReset.postLossArchitectLatchStrategyId
    || stateAfterKillSwitchReset.availableBalanceUsdt !== stateBeforeKillSwitchReset.availableBalanceUsdt
    || stateAfterKillSwitchReset.realizedPnl !== stateBeforeKillSwitchReset.realizedPnl
    || JSON.stringify(freshnessAfterKillSwitchReset) !== JSON.stringify(freshnessBeforeKillSwitchReset)) {
    throw new Error(`portfolio kill-switch reset API must not mutate unrelated bot/freshness state: ${JSON.stringify({ stateBeforeKillSwitchReset, stateAfterKillSwitchReset, freshnessBeforeKillSwitchReset, freshnessAfterKillSwitchReset })}`);
  }
  if (!killSwitchLogs.find((entry) => entry.message === "manual_portfolio_kill_switch_reset")) {
    throw new Error(`portfolio kill-switch reset API should log the manual reset action: ${JSON.stringify(killSwitchLogs)}`);
  }
  const repeatKillSwitchResetResponse = createResponseRecorder();
  killSwitchResumeServer.handleRequest({
    headers: { host: "127.0.0.1:3108" },
    method: "POST",
    url: "/api/kill-switch/reset"
  }, repeatKillSwitchResetResponse);
  if (repeatKillSwitchResetResponse.statusCode !== 409 || JSON.parse(String(repeatKillSwitchResetResponse.body || "{}")).error !== "portfolio_kill_switch_reset_not_required") {
    throw new Error(`portfolio kill-switch reset API should reject no-op reset when not triggered: ${JSON.stringify(repeatKillSwitchResetResponse)}`);
  }

  const filteredApiStore = new StateStore();
  filteredApiStore.registerBot({
    allowedStrategies: ["emaCross"],
    enabled: true,
    id: "bot_filter_a",
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "BNB/USDT"
  });
  filteredApiStore.registerBot({
    allowedStrategies: ["emaCross"],
    enabled: true,
    id: "bot_filter_b",
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "DOGE/USDT"
  });
  filteredApiStore.appendEvent({
    id: "filter-event-a-old",
    level: "INFO",
    message: "old_a",
    metadata: { botId: "bot_filter_a" },
    scope: "bot",
    time: now
  });
  filteredApiStore.appendEvent({
    id: "filter-event-b",
    level: "INFO",
    message: "event_b",
    metadata: { botId: "bot_filter_b" },
    scope: "bot",
    time: now + 1
  });
  filteredApiStore.appendEvent({
    id: "filter-event-a-new",
    level: "WARN",
    message: "new_a",
    metadata: { botId: "bot_filter_a" },
    scope: "bot",
    time: now + 2
  });
  filteredApiStore.appendClosedTrade("bot_filter_a", {
    botId: "bot_filter_a",
    closedAt: now,
    entryPrice: 300,
    entryReason: ["entry_a_old"],
    exitPrice: 301,
    exitReason: ["exit_a_old"],
    fees: 0.1,
    id: "filter-trade-a-old",
    netPnl: 0.9,
    openedAt: now - 10_000,
    pnl: 1,
    quantity: 1,
    side: "long",
    strategyId: "emaCross",
    symbol: "BNB/USDT"
  });
  filteredApiStore.appendClosedTrade("bot_filter_b", {
    botId: "bot_filter_b",
    closedAt: now + 1,
    entryPrice: 0.1,
    entryReason: ["entry_b"],
    exitPrice: 0.11,
    exitReason: ["exit_b"],
    fees: 0.01,
    id: "filter-trade-b",
    netPnl: 0.09,
    openedAt: now - 9_000,
    pnl: 0.1,
    quantity: 10,
    side: "long",
    strategyId: "emaCross",
    symbol: "DOGE/USDT"
  });
  filteredApiStore.appendClosedTrade("bot_filter_a", {
    botId: "bot_filter_a",
    closedAt: now + 2,
    entryPrice: 302,
    entryReason: ["entry_a_new"],
    exitPrice: 303,
    exitReason: ["exit_a_new"],
    fees: 0.1,
    id: "filter-trade-a-new",
    netPnl: 0.9,
    openedAt: now - 8_000,
    pnl: 1,
    quantity: 1,
    side: "long",
    strategyId: "emaCross",
    symbol: "BNB/USDT"
  });
  const filteredApiServer = new SystemServer({
    executionMode: "paper",
    feedMode: "live",
    logger: { info() {} },
    port: 3109,
    startedAt: now - 1000,
    store: filteredApiStore
  });
  const unfilteredEvents = filteredApiServer.buildEventsPayload();
  const filteredEvents = filteredApiServer.buildEventsPayload({ botId: "bot_filter_a", limit: 1 });
  if (unfilteredEvents.length !== 3 || filteredEvents.length !== 1 || filteredEvents[0].message !== "new_a") {
    throw new Error(`events payload should preserve unfiltered behavior and support botId/limit filters newest-first: ${JSON.stringify({ filteredEvents, unfilteredEvents })}`);
  }
  const unfilteredTrades = filteredApiServer.buildTradesPayload();
  const filteredTrades = filteredApiServer.buildTradesPayload({ botId: "bot_filter_a", limit: 1 });
  if (unfilteredTrades.length !== 3 || filteredTrades.length !== 1 || filteredTrades[0].tradeId !== "filter-trade-a-new") {
    throw new Error(`trades payload should preserve unfiltered behavior and support botId/limit filters newest-first: ${JSON.stringify({ filteredTrades, unfilteredTrades })}`);
  }
  const filteredEventsResponse = createResponseRecorder();
  filteredApiServer.handleRequest({
    headers: { host: "127.0.0.1:3109" },
    url: "/api/events?botId=bot_filter_a&limit=1"
  }, filteredEventsResponse);
  const filteredEventsPayload = JSON.parse(String(filteredEventsResponse.body || "[]"));
  if (filteredEventsResponse.statusCode !== 200 || filteredEventsPayload.length !== 1 || filteredEventsPayload[0].message !== "new_a") {
    throw new Error(`events API should support Pulse botId/limit filters: ${JSON.stringify(filteredEventsResponse)}`);
  }
  const unfilteredEventsResponse = createResponseRecorder();
  filteredApiServer.handleRequest({
    headers: { host: "127.0.0.1:3109" },
    url: "/api/events"
  }, unfilteredEventsResponse);
  const unfilteredEventsPayload = JSON.parse(String(unfilteredEventsResponse.body || "[]"));
  if (unfilteredEventsResponse.statusCode !== 200 || unfilteredEventsPayload.length !== 3) {
    throw new Error(`events API should preserve unfiltered endpoint behavior without query params: ${JSON.stringify(unfilteredEventsResponse)}`);
  }
  const filteredTradesResponse = createResponseRecorder();
  filteredApiServer.handleRequest({
    headers: { host: "127.0.0.1:3109" },
    url: "/api/trades?botId=bot_filter_a&limit=1"
  }, filteredTradesResponse);
  const filteredTradesPayload = JSON.parse(String(filteredTradesResponse.body || "[]"));
  if (filteredTradesResponse.statusCode !== 200 || filteredTradesPayload.length !== 1 || filteredTradesPayload[0].tradeId !== "filter-trade-a-new") {
    throw new Error(`trades API should support Pulse botId/limit filters: ${JSON.stringify(filteredTradesResponse)}`);
  }
  const unfilteredTradesResponse = createResponseRecorder();
  filteredApiServer.handleRequest({
    headers: { host: "127.0.0.1:3109" },
    url: "/api/trades"
  }, unfilteredTradesResponse);
  const unfilteredTradesPayload = JSON.parse(String(unfilteredTradesResponse.body || "[]"));
  if (unfilteredTradesResponse.statusCode !== 200 || unfilteredTradesPayload.length !== 3) {
    throw new Error(`trades API should preserve unfiltered endpoint behavior without query params: ${JSON.stringify(unfilteredTradesResponse)}`);
  }

  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradingbot-public-"));
  try {
    fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>pulse</title>");
    fs.writeFileSync(path.join(publicDir, "pulse.js"), "window.__pulseLoaded = true;");
    fs.writeFileSync(path.join(publicDir, "styles.css"), "body{background:#000;}");

    const assetServer = new SystemServer({
      architectWarmupMs: 20_000,
      executionMode: "paper",
      feedMode: "live",
      logger: { info() {} },
      port: 3104,
      publicDir,
      startedAt: now - 1000,
      store
    });

    const indexResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/"
    }, indexResponse);
    if (indexResponse.statusCode !== 200 || !String(indexResponse.headers?.["Content-Type"] || "").includes("text/html")) {
      throw new Error(`system server should serve the single Pulse UI entry point: ${JSON.stringify(indexResponse)}`);
    }
    if (!String(indexResponse.body).includes("pulse")) {
      throw new Error("system server did not return the Pulse UI HTML body");
    }

    const pulseJsResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/pulse.js"
    }, pulseJsResponse);
    if (pulseJsResponse.statusCode !== 200 || !String(pulseJsResponse.headers?.["Content-Type"] || "").includes("application/javascript")) {
      throw new Error(`system server should serve Pulse JS assets: ${JSON.stringify(pulseJsResponse)}`);
    }

    const pulseApiResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/api/pulse?botId=bot_a"
    }, pulseApiResponse);
    const pulseApiPayload = JSON.parse(String(pulseApiResponse.body || "{}"));
    if (pulseApiResponse.statusCode !== 200 || pulseApiPayload.focusPanel?.botId !== "bot_a" || !Array.isArray(pulseApiPayload.botCards)) {
      throw new Error(`system server should expose the additive /api/pulse projection endpoint: ${JSON.stringify(pulseApiResponse)}`);
    }

    const sseRequest = new EventEmitter();
    sseRequest.headers = { host: "127.0.0.1:3104" };
    sseRequest.url = "/api/pulse/stream";
    const sseResponse = new EventEmitter();
    sseResponse.headers = {};
    sseResponse.writes = [];
    sseResponse.setHeader = function setHeader(key, value) {
      this.headers[key] = value;
    };
    sseResponse.flushHeaders = function flushHeaders() {
      this.flushed = true;
    };
    sseResponse.write = function write(chunk) {
      this.writes.push(String(chunk));
      return true;
    };
    assetServer.handleRequest(sseRequest, sseResponse);
    if (sseResponse.headers["Content-Type"] !== "text/event-stream"
      || sseResponse.headers["Cache-Control"] !== "no-cache"
      || sseResponse.headers["Connection"] !== "keep-alive"
      || sseResponse.flushed !== true) {
      throw new Error(`pulse SSE stream should open with event-stream headers: ${JSON.stringify(sseResponse.headers)}`);
    }
    if (!sseResponse.writes[0]?.startsWith("data: ")) {
      throw new Error(`pulse SSE stream should write at least one event payload immediately: ${JSON.stringify(sseResponse.writes)}`);
    }
    const ssePayload = JSON.parse(sseResponse.writes[0].replace(/^data: /, "").trim());
    if (!Array.isArray(ssePayload.botCards) || ssePayload.statusBar?.feedMode !== "LIVE") {
      throw new Error(`pulse SSE stream should send a valid Pulse payload: ${JSON.stringify(ssePayload)}`);
    }
    const writesBeforeClose = sseResponse.writes.length;
    sseRequest.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    if (sseResponse.writes.length !== writesBeforeClose) {
      throw new Error(`pulse SSE stream should stop writing after request close: ${JSON.stringify(sseResponse.writes)}`);
    }

    const removedCompactResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/compact"
    }, removedCompactResponse);
    if (removedCompactResponse.statusCode !== 404) {
      throw new Error(`system server should not serve the removed compact route: ${JSON.stringify(removedCompactResponse)}`);
    }

    const openedUrls = [];
    const compactAutoOpenServer = new SystemServer({
      architectWarmupMs: 20_000,
      autoOpenCompactUi: true,
      compactUiRoute: "/compact",
      executionMode: "paper",
      feedMode: "live",
      host: "0.0.0.0",
      logger: { info() {}, warn() {} },
      openExternalUrl: (url) => openedUrls.push(url),
      port: 3106,
      publicDir,
      startedAt: now - 1000,
      store
    });
    if (!compactAutoOpenServer.maybeOpenCompactUi() || openedUrls[0] !== "http://127.0.0.1:3106/") {
      throw new Error(`UI auto-open should request the single Pulse route without launching a browser in tests: ${JSON.stringify(openedUrls)}`);
    }

  } finally {
    fs.rmSync(publicDir, { force: true, recursive: true });
  }
}

module.exports = {
  runSystemServerTests
};
