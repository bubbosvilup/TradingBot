// Module responsibility: lightweight HTTP layer exposing stateStore data and serving the observability UI.

import type { ArchitectAssessment, ArchitectPublisherState, RecommendedFamily } from "../types/architect.ts";
import type { BotConfig, BotRuntimeState } from "../types/bot.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { SystemEvent } from "../types/event.ts";
import type { MarketKline, PriceSnapshot } from "../types/market.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { ClosedTradeRecord, PositionRecord } from "../types/trade.ts";
import type { LoggerLike, PortfolioKillSwitchState, SymbolStateRetentionSnapshot } from "../types/runtime.ts";

const fs = require("node:fs");
const childProcess = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { calculateDirectionalGrossPnl, normalizeTradeSide } = require("../utils/tradeSide.ts");

interface PipelineSnapshotLike {
  symbol: string;
  lastStateUpdatedAt: number | null;
  [key: string]: unknown;
}

interface WsConnectionSnapshotLike {
  connectionId: string;
  [key: string]: unknown;
}

interface SystemSnapshotLike {
  botStates: BotRuntimeState[];
  events: SystemEvent[];
  latestPrices: Array<{
    price: number;
    symbol: string;
    updatedAt: number;
  }>;
  openPositions: PositionRecord[];
}

interface SystemServerStore {
  botConfigs: Map<string, BotConfig>;
  positions: Map<string, PositionRecord | null>;
  getAllClosedTrades(): ClosedTradeRecord[];
  getAllPipelineSnapshots(): PipelineSnapshotLike[];
  getArchitectObservedAssessment(symbol: string): ArchitectAssessment | null;
  getArchitectPublishedAssessment(symbol: string): ArchitectAssessment | null;
  getArchitectPublisherState(symbol: string): ArchitectPublisherState | null;
  getBotState(botId: string): BotRuntimeState | null;
  getClosedTradesForSymbol(symbol: string): ClosedTradeRecord[];
  getContextSnapshot(symbol: string): ContextSnapshot | null;
  getKlines(symbol: string, interval: string, limit?: number): MarketKline[];
  getLatestPrice(symbol: string): number | null;
  getPerformance(botId: string): PerformanceSnapshot | null;
  getPerformanceHistory(botId: string, limit?: number): Array<{
    drawdown: number;
    pnl: number;
    profitFactor: number;
    time: number;
    winRate: number;
  }>;
  getPipelineSnapshot(symbol: string): PipelineSnapshotLike | null;
  getPriceSnapshot(symbol: string): PriceSnapshot | null;
  getPortfolioKillSwitchState(options?: {
    feeRate?: number;
    now?: number;
  }): PortfolioKillSwitchState;
  getSymbolStateSnapshot(options?: {
    now?: number;
  }): SymbolStateRetentionSnapshot;
  getRecentEvents(limit?: number): SystemEvent[];
  getSystemSnapshot(): SystemSnapshotLike;
  getWsConnections(): WsConnectionSnapshotLike[];
  getPosition(botId: string): PositionRecord | null;
}

function getMimeType(filePath: string) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/html; charset=utf-8";
}

function openUrlWithDefaultBrowser(url: string) {
  const platform = process.platform;
  const opener = platform === "win32"
    ? { command: "cmd", args: ["/c", "start", "", url] }
    : platform === "darwin"
      ? { command: "open", args: [url] }
      : { command: "xdg-open", args: [url] };
  const child = childProcess.spawn(opener.command, opener.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.on("error", () => {});
  child.unref();
}

function normalizeCompactUiRoute(route?: string | null) {
  const value = String(route || "/compact").trim();
  if (!value || !/^\/[A-Za-z0-9/_-]*$/.test(value)) {
    return "/compact";
  }
  return value;
}

class SystemServer {
  store: SystemServerStore;
  logger: LoggerLike;
  host: string;
  port: number;
  publicDir: string;
  startedAt: number;
  server: any;
  autoOpenCompactUi: boolean;
  compactUiRoute: string;
  feedMode: string;
  executionMode: string;
  feeRate: number;
  architectWarmupMs: number;
  openExternalUrl: (url: string) => void;
  resolveStrategyFamily: (strategyId: string | null | undefined) => RecommendedFamily | "other";

  constructor(deps: {
    store: SystemServerStore;
    logger: LoggerLike;
    host?: string;
    port?: number;
    publicDir?: string;
    startedAt?: number;
    autoOpenCompactUi?: boolean;
    compactUiRoute?: string;
    feedMode?: string;
    executionMode?: string;
    feeRate?: number;
    architectWarmupMs?: number;
    openExternalUrl?: (url: string) => void;
    resolveStrategyFamily?: (strategyId: string | null | undefined) => RecommendedFamily | "other";
  }) {
    this.store = deps.store;
    this.logger = deps.logger;
    this.host = deps.host || "127.0.0.1";
    this.port = deps.port || 3000;
    this.publicDir = deps.publicDir || path.resolve(process.cwd(), "public");
    this.startedAt = deps.startedAt || Date.now();
    this.server = null;
    this.autoOpenCompactUi = Boolean(deps.autoOpenCompactUi);
    this.compactUiRoute = normalizeCompactUiRoute(deps.compactUiRoute);
    this.feedMode = deps.feedMode || "live";
    this.executionMode = deps.executionMode || "paper";
    this.feeRate = Math.max(Number(deps.feeRate) || 0, 0);
    this.architectWarmupMs = Math.max(Number(deps.architectWarmupMs) || 30_000, 5_000);
    this.openExternalUrl = typeof deps.openExternalUrl === "function"
      ? deps.openExternalUrl
      : openUrlWithDefaultBrowser;
    this.resolveStrategyFamily = typeof deps.resolveStrategyFamily === "function"
      ? deps.resolveStrategyFamily
      : () => "other";
  }

  calculateUnrealizedPnl(position: PositionRecord | null, latestPrice: number | null) {
    if (!position || !Number.isFinite(Number(latestPrice))) return 0;
    const entryPrice = Math.max(Number(position.entryPrice) || 0, 0);
    const markPrice = Math.max(Number(latestPrice) || 0, 0);
    const quantity = Math.max(Number(position.quantity) || 0, 0);
    const side = normalizeTradeSide(position.side);
    const entryNotionalUsdt = entryPrice * quantity;
    const markNotionalUsdt = markPrice * quantity;
    const grossPnl = calculateDirectionalGrossPnl({
      entryPrice,
      exitPrice: markPrice,
      quantity,
      side
    }).grossPnl;
    const fees = (entryNotionalUsdt + markNotionalUsdt) * this.feeRate;
    return grossPnl - fees;
  }

  start() {
    if (this.server) return;
    this.server = http.createServer((request: any, response: any) => {
      this.handleRequest(request, response);
    });
    this.server.listen(this.port, this.host, () => {
      this.logger.info("dashboard_ready", {
        executionMode: this.executionMode,
        feedMode: this.feedMode,
        url: `http://${this.host}:${this.port}`
      });
      this.maybeOpenCompactUi();
    });
  }

  stop() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
  }

  json(response: any, payload: unknown) {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(payload));
  }

  notFound(response: any) {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
  }

  serveFile(response: any, filePath: string) {
    if (!fs.existsSync(filePath)) {
      this.notFound(response);
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getMimeType(filePath)
    });
    response.end(fs.readFileSync(filePath));
  }

  getPublicHost() {
    if (this.host === "0.0.0.0" || this.host === "::") return "127.0.0.1";
    return this.host;
  }

  getCompactUiUrl() {
    return `http://${this.getPublicHost()}:${this.port}${this.compactUiRoute}`;
  }

  maybeOpenCompactUi() {
    if (!this.autoOpenCompactUi) return false;
    const url = this.getCompactUiUrl();
    try {
      this.openExternalUrl(url);
      this.logger.info("compact_dashboard_open_requested", {
        route: this.compactUiRoute,
        url,
        windowSizing: "default_browser_window"
      });
      return true;
    } catch (error) {
      this.logger.warn?.("compact_dashboard_open_failed", {
        error: error instanceof Error ? error.message : String(error),
        route: this.compactUiRoute,
        url
      });
      return false;
    }
  }

  getArchitectContextFeatures(context: any) {
    const features = context?.features || null;
    if (!features) return null;
    const architectContextRsi = Number.isFinite(Number(features.contextRsi))
      ? Number(features.contextRsi)
      : null;
    const architectRsiIntensity = Number(features.rsiIntensity || 0);
    return {
      architectContextRsi,
      architectContextRsiSource: architectContextRsi === null ? null : "effective_context_window",
      architectRsiIntensity,
      breakoutInstability: Number(features.breakoutInstability || 0),
      breakoutQuality: Number(features.breakoutQuality || 0),
      chopiness: Number(features.chopiness || 0),
      dataQuality: Number(features.dataQuality || 0),
      directionalEfficiency: Number(features.directionalEfficiency || 0),
      emaSeparation: Number(features.emaSeparation || 0),
      featureConflict: Number(features.featureConflict || 0),
      reversionStretch: Number(features.reversionStretch || 0),
      rsiIntensity: architectRsiIntensity,
      slopeConsistency: Number(features.slopeConsistency || 0),
      volatilityRisk: Number(features.volatilityRisk || 0)
    };
  }

  getArchitectWarmupRemainingMs(context: any) {
    if (context?.warmupComplete || !context?.windowSpanMs) return 0;
    return Math.max(0, this.architectWarmupMs - context.windowSpanMs);
  }

  isManualResumeRequired(state: BotRuntimeState | null | undefined) {
    return state?.status === "paused" && state?.pausedReason === "max_drawdown_reached";
  }

  decorateArchitectAssessment(assessment: any, publisher: any, context: any, source: "published" | "observed") {
    const contextFeatures = this.getArchitectContextFeatures(context);
    return {
      ...assessment,
      authoritative: source === "published",
      challenger: publisher?.challengerRegime ? {
        count: publisher.challengerCount,
        regime: publisher.challengerRegime,
        required: publisher.challengerRequired
      } : null,
      contextFeatures,
      contextWindowMode: context?.windowMode || null,
      dataQuality: contextFeatures?.dataQuality || 0,
      effectiveWindowStartedAt: context?.effectiveWindowStartedAt ?? null,
      hysteresisActive: publisher?.hysteresisActive || false,
      nextPublishAt: publisher?.nextPublishAt || null,
      postSwitchCoveragePct: context?.postSwitchCoveragePct ?? null,
      publisherLastObservedAt: publisher?.lastObservedAt || null,
      publisherLastPublishedAt: publisher?.lastPublishedAt || null,
      ready: source === "published" ? (publisher ? publisher.ready : Boolean(assessment?.sufficientData)) : false,
      rollingMaturity: context?.rollingMaturity ?? null,
      source,
      warmupRemainingMs: this.getArchitectWarmupRemainingMs(context)
    };
  }

  buildSyntheticArchitect(params: { config: any; context: any; publisher: any }) {
    const contextFeatures = this.getArchitectContextFeatures(params.context);
    if (!params.publisher && !params.context) return null;
    return {
      authoritative: false,
      challenger: params.publisher?.challengerRegime ? {
        count: params.publisher.challengerCount,
        regime: params.publisher.challengerRegime,
        required: params.publisher.challengerRequired
      } : null,
      contextMaturity: params.context?.features?.maturity || 0,
      contextFeatures,
      contextWindowMode: params.context?.windowMode || null,
      dataMode: params.context?.dataMode || "unknown",
      dataQuality: contextFeatures?.dataQuality || 0,
      decisionStrength: 0,
      effectiveWindowStartedAt: params.context?.effectiveWindowStartedAt ?? null,
      familyScores: {
        mean_reversion: 0,
        no_trade: 1,
        trend_following: 0
      },
      featureConflict: params.context?.features?.featureConflict || 0,
      hysteresisActive: params.publisher?.hysteresisActive || false,
      marketRegime: "unclear",
      nextPublishAt: params.publisher?.nextPublishAt || null,
      postSwitchCoveragePct: params.context?.postSwitchCoveragePct ?? null,
      publisherLastObservedAt: params.publisher?.lastObservedAt || null,
      publisherLastPublishedAt: params.publisher?.lastPublishedAt || null,
      ready: false,
      reasonCodes: [],
      recommendedFamily: "no_trade",
      regimeScores: {
        range: 0,
        trend: 0,
        unclear: 1,
        volatile: 0
      },
      sampleSize: params.context?.sampleSize || 0,
      signalAgreement: 0,
      source: "synthetic",
      structureState: params.context?.structureState || "choppy",
      summary: params.context?.summary || "Architect warming up.",
      symbol: params.config.symbol,
      trendBias: params.context?.trendBias || "neutral",
      updatedAt: null,
      volatilityState: params.context?.volatilityState || "normal",
      rollingMaturity: params.context?.rollingMaturity ?? null,
      warmupRemainingMs: this.getArchitectWarmupRemainingMs(params.context)
    };
  }

  buildSystemPayload() {
    const snapshot = this.store.getSystemSnapshot();
    const portfolioKillSwitch = this.store.getPortfolioKillSwitchState({ feeRate: this.feeRate });
    const symbolState = this.store.getSymbolStateSnapshot({ now: Date.now() });
    const running = snapshot.botStates.filter((bot: any) => bot.status === "running").length;
    const paused = snapshot.botStates.filter((bot: any) => bot.status === "paused");
    const manualResumeRequiredBots = paused.filter((bot: any) => this.isManualResumeRequired(bot)).length;
    const marketConnection = this.store.getWsConnections().find((connection: any) => connection.connectionId === "market-stream") || null;
    const latestLatency = this.store.getAllPipelineSnapshots()
      .filter((item: any) => item.lastStateUpdatedAt)
      .sort((left: any, right: any) => (right.lastStateUpdatedAt || 0) - (left.lastStateUpdatedAt || 0))[0] || null;
    return {
      botsManualResumeRequired: manualResumeRequiredBots,
      botsPaused: paused.length,
      botsRunning: running,
      botsTotal: snapshot.botStates.length,
      executionMode: this.executionMode,
      executionSafety: this.executionMode === "paper" ? "simulated_only" : "exchange_execution_enabled",
      eventCount: this.store.getRecentEvents(500).length,
      feedMode: this.feedMode,
      latency: latestLatency,
      openPositions: snapshot.openPositions.length,
      portfolioKillSwitch,
      symbolState,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      wsConnection: marketConnection,
      wsConnections: this.store.getWsConnections()
    };
  }

  buildBotsPayload() {
    const now = Date.now();
    const portfolioKillSwitch = this.store.getPortfolioKillSwitchState({ feeRate: this.feeRate, now });
    return Array.from(this.store.botConfigs.values()).map((config: any) => {
      const state = this.store.getBotState(config.id);
      const performance = this.store.getPerformance(config.id);
      const position = this.store.getPosition(config.id);
      const latestPrice = this.store.getLatestPrice(config.symbol);
      const architectPublishedRaw = this.store.getArchitectPublishedAssessment(config.symbol);
      const architectObservedRaw = this.store.getArchitectObservedAssessment(config.symbol);
      const architectPublisher = this.store.getArchitectPublisherState(config.symbol);
      const context = this.store.getContextSnapshot(config.symbol);
      const architectPublished = architectPublishedRaw
        ? this.decorateArchitectAssessment(architectPublishedRaw, architectPublisher, context, "published")
        : null;
      const architectObserved = architectObservedRaw
        ? this.decorateArchitectAssessment(architectObservedRaw, architectPublisher, context, "observed")
        : null;
      const architectFallback = !architectPublished && !architectObserved
        ? this.buildSyntheticArchitect({ config, context, publisher: architectPublisher })
        : null;
      const architect = architectPublished;
      const activeFamily = this.resolveStrategyFamily(state?.activeStrategyId || config.strategy);
      const targetFamily = architectPublished?.recommendedFamily && architectPublished.recommendedFamily !== "no_trade"
        ? architectPublished.recommendedFamily
        : null;
      const cooldownRemainingMs = state?.cooldownUntil ? Math.max(0, state.cooldownUntil - now) : 0;
      const unrealizedPnl = this.calculateUnrealizedPnl(position, latestPrice);
      const derivedSyncStatus = position && targetFamily && activeFamily !== targetFamily
        ? "waiting_flat"
        : architect
          ? "synced"
          : "pending";
      const syncStatus = state?.architectSyncStatus || derivedSyncStatus;
      const manualResumeRequired = this.isManualResumeRequired(state);

      return {
        activeStrategyId: state?.activeStrategyId || config.strategy,
        architect,
        architectFallback,
        architectObserved,
        architectPublished,
        availableBalanceUsdt: state?.availableBalanceUsdt || 0,
        botId: config.id,
        cooldownReason: state?.cooldownReason || null,
        cooldownRemainingMs,
        entrySignalStreak: state?.entrySignalStreak || 0,
        exitSignalStreak: state?.exitSignalStreak || 0,
        lastDecision: state?.lastDecision || "hold",
        lastDecisionConfidence: state?.lastDecisionConfidence || 0,
        lastDecisionReasons: state?.lastDecisionReasons || [],
        latency: this.store.getPipelineSnapshot(config.symbol),
        lastEvaluationAt: state?.lastEvaluationAt || null,
        lastExecutionAt: state?.lastExecutionAt || null,
        lastTickAt: state?.lastTickAt || null,
        lossStreak: state?.lossStreak || 0,
        manualResumeRequired,
        managedRecoveryConsecutiveCount: state?.managedRecoveryConsecutiveCount || 0,
        openPosition: position ? {
          entryPrice: position.entryPrice,
          lifecycleMode: position.lifecycleMode || "normal",
          lifecycleState: position.lifecycleState || null,
          managedRecoveryDeferredReason: position.managedRecoveryDeferredReason || null,
          managedRecoveryStartedAt: position.managedRecoveryStartedAt || null,
          openedAt: position.openedAt,
          quantity: position.quantity,
          side: normalizeTradeSide(position.side),
          unrealizedPnl
        } : null,
        pausedReason: state?.pausedReason || null,
        performance,
        postLossArchitectLatchActive: Boolean(state?.postLossArchitectLatchActive),
        postLossArchitectLatchFreshPublishCount: state?.postLossArchitectLatchFreshPublishCount || 0,
        postLossArchitectLatchStrategyId: state?.postLossArchitectLatchStrategyId || null,
        portfolioKillSwitch,
        price: latestPrice,
        riskProfile: config.riskProfile,
        syntheticArchitect: Boolean(architectFallback),
        syncStatus,
        status: state?.status || "idle",
        symbol: config.symbol
      };
    });
  }

  buildPricesPayload() {
    return this.store.getSystemSnapshot().latestPrices
      .sort((left: any, right: any) => left.symbol.localeCompare(right.symbol));
  }

  buildPositionsPayload() {
    const now = Date.now();
    return Array.from(this.store.botConfigs.values())
      .map((config: any) => {
        const position = this.store.getPosition(config.id);
        if (!position) return null;
        const latestPrice = this.store.getLatestPrice(position.symbol) || position.entryPrice;
        return {
          botId: config.id,
          currentPrice: latestPrice,
          entryPrice: position.entryPrice,
          holdMs: now - position.openedAt,
          quantity: position.quantity,
          side: normalizeTradeSide(position.side),
          strategyId: position.strategyId,
          symbol: position.symbol,
          unrealizedPnl: this.calculateUnrealizedPnl(position, latestPrice)
        };
      })
      .filter(Boolean);
  }

  buildEventsPayload() {
    return this.store.getRecentEvents(60).slice().reverse();
  }

  buildTradesPayload() {
    return this.store.getAllClosedTrades()
      .map((trade: any) => {
        const config = this.store.botConfigs.get(trade.botId);
        return {
          botId: trade.botId,
          botName: config?.id || trade.botId,
          entryPrice: trade.entryPrice,
          entryReason: Array.isArray(trade.entryReason) ? trade.entryReason : [],
          entryTime: trade.openedAt,
          exitPrice: trade.exitPrice,
          exitReason: Array.isArray(trade.exitReason) ? trade.exitReason : Array.isArray(trade.reason) ? trade.reason : [],
          exitTime: trade.closedAt,
          fees: trade.fees,
          grossPnl: trade.pnl,
          holdMs: Math.max(0, Number(trade.closedAt) - Number(trade.openedAt)),
          netPnl: trade.netPnl,
          quantity: trade.quantity,
          result: trade.netPnl > 0 ? "win" : trade.netPnl < 0 ? "loss" : "flat",
          side: normalizeTradeSide(trade.side),
          strategyId: trade.strategyId,
          symbol: trade.symbol,
          tradeId: trade.id
        };
      })
      .sort((left: any, right: any) => Number(right.exitTime || 0) - Number(left.exitTime || 0));
  }

  buildChartPayload(symbol: string | null) {
    const fallbackSymbol = Array.from(this.store.botConfigs.values())[0]?.symbol || null;
    const resolvedSymbol = symbol || fallbackSymbol;
    if (!resolvedSymbol) {
      return {
        candles: {},
        lineData: [],
        markers: [],
        position: null,
        symbol: null
      };
    }

    const priceSnapshot = this.store.getPriceSnapshot(resolvedSymbol);
    const closedTrades = this.store.getClosedTradesForSymbol(resolvedSymbol).slice(-100);
    const openPosition = Array.from(this.store.positions.values()).find((position) => position?.symbol === resolvedSymbol) || null;
    const latestPrice = priceSnapshot?.latestPrice || null;
    const lineData = (priceSnapshot?.history || []).map((tick: any) => ({
      time: Math.floor(Number(tick.timestamp) / 1000),
      value: Number(tick.price)
    }));
    const markerMap = new Map<string, {
      color: string;
      position: "aboveBar" | "belowBar";
      shape: "arrowUp" | "arrowDown";
      text: string;
      time: number;
    }>();
    for (const trade of closedTrades) {
      const entryTimeSeconds = Math.floor(Number(trade.openedAt) / 1000);
      const exitTimeSeconds = Math.floor(Number(trade.closedAt) / 1000);
      const tradeSide = normalizeTradeSide(trade.side);
      if (Number.isFinite(entryTimeSeconds) && entryTimeSeconds > 0) {
        markerMap.set(`entry:${trade.id}:${entryTimeSeconds}`, {
          color: tradeSide === "short" ? "#f97316" : "#22c55e",
          position: tradeSide === "short" ? "aboveBar" : "belowBar",
          shape: tradeSide === "short" ? "arrowDown" : "arrowUp",
          text: `${tradeSide === "short" ? "SHORT" : "BUY"} ${trade.botId} @ ${Number(trade.entryPrice).toFixed(4)} ${new Date(trade.openedAt).toLocaleTimeString()}`,
          time: entryTimeSeconds
        });
      }
      if (Number.isFinite(exitTimeSeconds) && exitTimeSeconds > 0) {
        markerMap.set(`exit:${trade.id}:${exitTimeSeconds}`, {
          color: trade.netPnl >= 0 ? "#22c55e" : "#ef4444",
          position: tradeSide === "short" ? "belowBar" : "aboveBar",
          shape: tradeSide === "short" ? "arrowUp" : "arrowDown",
          text: `${tradeSide === "short" ? "COVER" : "SELL"} ${trade.botId} @ ${Number(trade.exitPrice).toFixed(4)} ${new Date(trade.closedAt).toLocaleTimeString()} PnL ${Number(trade.netPnl).toFixed(2)}`,
          time: exitTimeSeconds
        });
      }
    }
    if (openPosition && Number.isFinite(Number(openPosition.openedAt))) {
      const openPositionSide = normalizeTradeSide(openPosition.side);
      const openTimeSeconds = Math.floor(Number(openPosition.openedAt) / 1000);
      if (openTimeSeconds > 0) {
        markerMap.set(`open:${openPosition.id}:${openTimeSeconds}`, {
          color: openPositionSide === "short" ? "#f97316" : "#22c55e",
          position: openPositionSide === "short" ? "aboveBar" : "belowBar",
          shape: openPositionSide === "short" ? "arrowDown" : "arrowUp",
          text: `${openPositionSide === "short" ? "SHORT" : "BUY"} ${openPosition.botId} @ ${Number(openPosition.entryPrice).toFixed(4)} ${new Date(openPosition.openedAt).toLocaleTimeString()}`,
          time: openTimeSeconds
        });
      }
    }
    const markers = Array.from(markerMap.values())
      .filter((marker: any) => Number.isFinite(Number(marker.time)) && Number(marker.time) > 0)
      .sort((left: any, right: any) => Number(left.time) - Number(right.time));
    const candles = {};
    for (const interval of ["1m", "5m", "1h"]) {
      candles[interval] = this.store.getKlines(resolvedSymbol, interval, 200).map((kline: any) => ({
        close: Number(kline.close),
        high: Number(kline.high),
        low: Number(kline.low),
        open: Number(kline.open),
        time: Math.floor(Number(kline.openedAt) / 1000)
      }));
    }

    return {
      candles,
      lineData,
      lastPrice: latestPrice,
      markers,
      position: openPosition ? {
        botId: openPosition.botId,
        currentPrice: latestPrice,
        entryPrice: openPosition.entryPrice,
        openedAt: openPosition.openedAt,
        quantity: openPosition.quantity,
        side: normalizeTradeSide(openPosition.side)
      } : null,
      symbol: resolvedSymbol
    };
  }

  buildAnalyticsPayload() {
    const comparison = Array.from(this.store.botConfigs.values()).map((config: any) => {
      const performance = this.store.getPerformance(config.id);
      return {
        botId: config.id,
        drawdown: performance?.drawdown || 0,
        pnl: performance?.pnl || 0,
        profitFactor: performance?.profitFactor || 0,
        strategyId: this.store.getBotState(config.id)?.activeStrategyId || config.strategy,
        symbol: config.symbol,
        tradesCount: performance?.tradesCount || 0,
        winRate: performance?.winRate || 0
      };
    });

    const botSeries = comparison.map((item: any) => ({
      botId: item.botId,
      drawdownSeries: this.store.getPerformanceHistory(item.botId, 120).map((point: any) => [point.time, point.drawdown]),
      pnlSeries: this.store.getPerformanceHistory(item.botId, 120).map((point: any) => [point.time, point.pnl]),
      profitFactorSeries: this.store.getPerformanceHistory(item.botId, 120).map((point: any) => [point.time, point.profitFactor]),
      winRateSeries: this.store.getPerformanceHistory(item.botId, 120).map((point: any) => [point.time, point.winRate])
    }));

    return {
      botSeries,
      comparison
    };
  }

  handleRequest(request: any, response: any) {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${this.host}:${this.port}`}`);
    const pathname = url.pathname;

    if (pathname === "/api/system") {
      this.json(response, this.buildSystemPayload());
      return;
    }
    if (pathname === "/api/bots") {
      this.json(response, this.buildBotsPayload());
      return;
    }
    if (pathname === "/api/prices") {
      this.json(response, this.buildPricesPayload());
      return;
    }
    if (pathname === "/api/positions") {
      this.json(response, this.buildPositionsPayload());
      return;
    }
    if (pathname === "/api/events") {
      this.json(response, this.buildEventsPayload());
      return;
    }
    if (pathname === "/api/trades") {
      this.json(response, this.buildTradesPayload());
      return;
    }
    if (pathname === "/api/chart") {
      this.json(response, this.buildChartPayload(url.searchParams.get("symbol")));
      return;
    }
    if (pathname === "/api/analytics") {
      this.json(response, this.buildAnalyticsPayload());
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      this.serveFile(response, path.join(this.publicDir, "index.html"));
      return;
    }
    if (pathname === "/compact" || pathname === "/compact.html") {
      this.serveFile(response, path.join(this.publicDir, "compact.html"));
      return;
    }
    if (pathname === "/app.js") {
      this.serveFile(response, path.join(this.publicDir, "app.js"));
      return;
    }
    if (pathname === "/styles.css") {
      this.serveFile(response, path.join(this.publicDir, "styles.css"));
      return;
    }
    if (pathname === "/compact.js") {
      this.serveFile(response, path.join(this.publicDir, "compact.js"));
      return;
    }
    if (pathname === "/compact.css") {
      this.serveFile(response, path.join(this.publicDir, "compact.css"));
      return;
    }
    if (pathname.startsWith("/ui/")) {
      const fileName = pathname.replace(/^\/ui\//, "");
      this.serveFile(response, path.join(this.publicDir, "ui", fileName));
      return;
    }

    this.notFound(response);
  }
}

module.exports = {
  SystemServer
};
