"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

function runSystemServerTests() {
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

  if (system.feedMode !== "live") {
    throw new Error("system payload missing feed mode");
  }
  if (system.botsPaused !== 0 || system.botsManualResumeRequired !== 0) {
    throw new Error(`system payload should distinguish paused/manual-resume counts even when zero: ${JSON.stringify(system)}`);
  }
  if (system.executionMode !== "paper" || system.executionSafety !== "simulated_only") {
    throw new Error("system payload missing execution safety mode");
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
  const syntheticBots = new SystemServer({
    architectWarmupMs: 20_000,
    executionMode: "paper",
    feedMode: "live",
    logger: { info() {} },
    port: 3103,
    startedAt: now - 1000,
    store: syntheticStore
  }).buildBotsPayload();
  if (syntheticBots[0].architect !== null || syntheticBots[0].architectObserved !== null) {
    throw new Error("synthetic warm-up payload should not expose fake architect authority");
  }
  if (syntheticBots[0].syntheticArchitect !== true || syntheticBots[0].architectFallback?.source !== "synthetic") {
    throw new Error("synthetic warm-up payload missing explicit synthetic architect marker");
  }
  if (syntheticBots[0].architectFallback?.warmupRemainingMs !== 8_000) {
    throw new Error(`synthetic warm-up payload should respect configured architect warmup: ${JSON.stringify(syntheticBots[0].architectFallback)}`);
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
  if (pausedSystem.botsPaused !== 1 || pausedSystem.botsManualResumeRequired !== 1) {
    throw new Error(`system payload should count drawdown-paused bots requiring manual resume explicitly: ${JSON.stringify(pausedSystem)}`);
  }
  if (pausedBots[0].status !== "paused" || pausedBots[0].pausedReason !== "max_drawdown_reached" || pausedBots[0].manualResumeRequired !== true) {
    throw new Error(`bots payload should expose drawdown pause semantics explicitly: ${JSON.stringify(pausedBots[0])}`);
  }
  if (pausedBots[0].portfolioKillSwitch.triggered !== false) {
    throw new Error(`bot payload should keep bot-level drawdown pause distinct from portfolio kill switch state: ${JSON.stringify(pausedBots[0])}`);
  }

  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradingbot-public-"));
  try {
    fs.mkdirSync(path.join(publicDir, "ui"), { recursive: true });
    fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>dashboard</title>");
    fs.writeFileSync(path.join(publicDir, "compact.html"), "<!doctype html><title>compact</title>");
    fs.writeFileSync(path.join(publicDir, "app.js"), "window.__appLoaded = true;");
    fs.writeFileSync(path.join(publicDir, "styles.css"), "body{background:#000;}");
    fs.writeFileSync(path.join(publicDir, "compact.js"), "window.__compactLoaded = true;");
    fs.writeFileSync(path.join(publicDir, "compact.css"), "body{background:#050505;}");
    fs.writeFileSync(path.join(publicDir, "ui", "chartAdapter.js"), "window.ChartAdapter = { create() {} };");

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

    const jsResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/ui/chartAdapter.js"
    }, jsResponse);
    if (jsResponse.statusCode !== 200 || !String(jsResponse.headers?.["Content-Type"] || "").includes("application/javascript")) {
      throw new Error(`system server should serve dashboard JS assets from public/ui: ${JSON.stringify(jsResponse)}`);
    }
    if (!String(jsResponse.body).includes("ChartAdapter")) {
      throw new Error("system server did not return the public JS dashboard asset body");
    }

    const compactResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/compact"
    }, compactResponse);
    if (compactResponse.statusCode !== 200 || !String(compactResponse.headers?.["Content-Type"] || "").includes("text/html")) {
      throw new Error(`system server should serve the compact monitor route: ${JSON.stringify(compactResponse)}`);
    }
    if (!String(compactResponse.body).includes("compact")) {
      throw new Error("system server did not return the compact monitor HTML body");
    }

    const compactJsResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/compact.js"
    }, compactJsResponse);
    if (compactJsResponse.statusCode !== 200 || !String(compactJsResponse.headers?.["Content-Type"] || "").includes("application/javascript")) {
      throw new Error(`system server should serve compact JS assets: ${JSON.stringify(compactJsResponse)}`);
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
    if (!compactAutoOpenServer.maybeOpenCompactUi() || openedUrls[0] !== "http://127.0.0.1:3106/compact") {
      throw new Error(`compact auto-open should request the local compact route without launching a browser in tests: ${JSON.stringify(openedUrls)}`);
    }

    const tsResponse = createResponseRecorder();
    assetServer.handleRequest({
      headers: { host: "127.0.0.1:3104" },
      url: "/ui/chartAdapter.ts"
    }, tsResponse);
    if (tsResponse.statusCode !== 404) {
      throw new Error(`system server should not serve raw TypeScript dashboard assets anymore: ${JSON.stringify(tsResponse)}`);
    }
  } finally {
    fs.rmSync(publicDir, { force: true, recursive: true });
  }
}

module.exports = {
  runSystemServerTests
};
