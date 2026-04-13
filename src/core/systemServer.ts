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
  updateBotState(botId: string, patch: Partial<BotRuntimeState>): void;
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
  const value = String(route || "/").trim();
  if (!value || !/^\/[A-Za-z0-9/_-]*$/.test(value)) {
    return "/";
  }
  if (value === "/compact" || value === "/compact.html") return "/";
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

  json(response: any, payload: unknown, statusCode: number = 200) {
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(payload));
  }

  notFound(response: any) {
    this.json(response, { error: "Not found" }, 404);
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

  handleManualResumeRequest(botId: string, response: any) {
    const state = this.store.getBotState(botId);
    if (!state) {
      this.json(response, {
        botId,
        error: "bot_not_found",
        ok: false
      }, 404);
      return;
    }

    if (!this.isManualResumeRequired(state)) {
      this.json(response, {
        botId,
        error: "manual_resume_not_required",
        ok: false,
        pausedReason: state.pausedReason,
        status: state.status
      }, 409);
      return;
    }

    const portfolioKillSwitch = this.store.getPortfolioKillSwitchState({ feeRate: this.feeRate });
    if (portfolioKillSwitch.blockingEntries || portfolioKillSwitch.triggered) {
      this.json(response, {
        botId,
        error: "portfolio_kill_switch_active",
        ok: false,
        portfolioKillSwitchReason: portfolioKillSwitch.reason
      }, 423);
      return;
    }

    this.store.updateBotState(botId, {
      pausedReason: null,
      status: "running"
    });
    this.logger.info("bot_manual_resume", {
      botId,
      reason: "max_drawdown_manual_resume"
    });
    this.json(response, {
      botId,
      ok: true,
      pausedReason: null,
      status: "running"
    });
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

  formatPulseMoney(value: unknown) {
    const amount = Number(value);
    const normalized = Number.isFinite(amount) ? amount : 0;
    const sign = normalized > 0 ? "+" : normalized < 0 ? "-" : "";
    return `${sign}${Math.abs(normalized).toFixed(2)}`;
  }

  humanizePulseToken(value: unknown) {
    return String(value || "n/a").replace(/_/g, "-");
  }

  getPulseMarketStreamStatus(system: any) {
    const marketConnection = (system?.wsConnections || []).find((connection: any) => connection.connectionId === "market-stream")
      || system?.wsConnection
      || null;
    const status = String(marketConnection?.status || "disconnected").toLowerCase();
    if (status.includes("reconnect") || status.includes("connecting")) return "reconnecting";
    if (status.includes("connect") && !status.includes("disconnect")) return "connected";
    return status === "connected" ? "connected" : "disconnected";
  }

  getPulseLastTickAgeMs(system: any, bots: any[], now: number) {
    const latestPrices = this.store.getSystemSnapshot().latestPrices || [];
    const latestPriceAt = latestPrices.reduce((max: number, price: any) => Math.max(max, Number(price?.updatedAt) || 0), 0);
    const latestBotTickAt = bots.reduce((max: number, bot: any) => Math.max(max, Number(bot?.lastTickAt) || 0), 0);
    const marketConnection = (system?.wsConnections || []).find((connection: any) => connection.connectionId === "market-stream")
      || system?.wsConnection
      || null;
    const latestWsAt = Math.max(
      Number(system?.latency?.lastWsReceivedAt) || 0,
      Number(system?.latency?.lastStateUpdatedAt) || 0,
      Number(marketConnection?.lastWsReceivedAt) || 0,
      Number(marketConnection?.updatedAt) || 0
    );
    const latestAt = Math.max(latestPriceAt, latestBotTickAt, latestWsAt);
    return latestAt > 0 ? Math.max(0, now - latestAt) : null;
  }

  getPulseNetPnlUsdt(system: any, bots: any[]) {
    const portfolio = system?.portfolioKillSwitch || {};
    if (Number.isFinite(Number(portfolio.realizedPnl)) || Number.isFinite(Number(portfolio.unrealizedPnl))) {
      return (Number(portfolio.realizedPnl) || 0) + (Number(portfolio.unrealizedPnl) || 0);
    }
    return bots.reduce((sum: number, bot: any) => {
      return sum + (Number(bot?.performance?.pnl) || 0) + (Number(bot?.openPosition?.unrealizedPnl) || 0);
    }, 0);
  }

  buildPulseKillSwitch(portfolio: any) {
    if (portfolio?.triggered) {
      return {
        reason: portfolio.reason || null,
        severity: "critical",
        state: "triggered"
      };
    }
    if (portfolio?.blockingEntries) {
      return {
        reason: portfolio.reason || null,
        severity: "warning",
        state: "armed"
      };
    }
    if (portfolio?.enabled) {
      return {
        reason: portfolio.reason || null,
        severity: "normal",
        state: "armed"
      };
    }
    return {
      reason: portfolio?.reason || null,
      severity: "normal",
      state: "inactive"
    };
  }

  getPulseArchitect(bot: any) {
    return bot?.architectPublished || bot?.architect || null;
  }

  getPulseRegime(bot: any) {
    const architect = this.getPulseArchitect(bot);
    return architect?.marketRegime || "warming_up";
  }

  getPulseSyncStatus(bot: any) {
    const architect = this.getPulseArchitect(bot);
    if (!architect?.marketRegime) return "warming_up";
    const syncStatus = String(bot?.syncStatus || "pending");
    if (syncStatus === "waiting_flat") return "diverged";
    if (syncStatus === "synced" || syncStatus === "pending" || syncStatus === "diverged") return syncStatus;
    return syncStatus;
  }

  buildPulsePosition(bot: any) {
    const position = bot?.openPosition || null;
    if (!position) {
      return {
        label: "FLAT",
        pnlUsdt: 0,
        state: "flat"
      };
    }
    const state = normalizeTradeSide(position.side);
    const pnlUsdt = Number(position.unrealizedPnl) || 0;
    return {
      label: `${state.toUpperCase()} ${this.formatPulseMoney(pnlUsdt)}`,
      pnlUsdt,
      state
    };
  }

  buildPulseAlert(bot: any) {
    if (bot?.manualResumeRequired) {
      return {
        message: "Manual resume required",
        severity: "critical",
        type: "manual_resume_required"
      };
    }
    if (bot?.openPosition?.lifecycleMode === "managed_recovery" || bot?.openPosition?.lifecycleState === "MANAGED_RECOVERY") {
      return {
        message: "Managed recovery active",
        severity: "warning",
        type: "managed_recovery"
      };
    }
    if (bot?.pausedReason) {
      return {
        message: this.humanizePulseToken(bot.pausedReason),
        severity: "warning",
        type: "manual_resume_required"
      };
    }
    if (bot?.cooldownReason || Number(bot?.cooldownRemainingMs || 0) > 0) {
      return {
        message: bot.cooldownReason ? this.humanizePulseToken(bot.cooldownReason) : "Cooldown active",
        severity: "info",
        type: "cooldown"
      };
    }
    if (!this.getPulseArchitect(bot) && bot?.status === "running") {
      return {
        message: "Architect warming up",
        severity: "info",
        type: "architect_blocked"
      };
    }
    if (bot?.postLossArchitectLatchActive) {
      return {
        message: "Post-loss latch active",
        severity: "warning",
        type: "architect_blocked"
      };
    }
    return null;
  }

  buildPulseArchitectSummary(bot: any) {
    const architect = this.getPulseArchitect(bot);
    if (!architect?.marketRegime) {
      return {
        bias: null,
        line: "warming up...",
        regime: "warming_up",
        strength: 0,
        updatedAt: null
      };
    }
    const regime = architect.marketRegime || "unclear";
    const bias = architect.recommendedFamily || "no_trade";
    const strength = Number.isFinite(Number(architect.decisionStrength)) ? Number(architect.decisionStrength) : 0;
    return {
      bias,
      line: `${this.humanizePulseToken(regime)} regime . ${this.humanizePulseToken(bias)} bias . strength ${strength.toFixed(2)}`,
      regime,
      strength,
      updatedAt: architect.updatedAt || null
    };
  }

  buildPulseActions(bot: any, portfolio: any) {
    const resumeVisible = bot?.pausedReason === "max_drawdown_reached" || bot?.manualResumeRequired === true;
    const killSwitchBlocks = Boolean(portfolio?.triggered || portfolio?.blockingEntries);
    return {
      history: {
        enabled: Boolean(bot?.botId),
        reason: bot?.botId ? null : "bot_not_selected",
        visible: true
      },
      resume: {
        enabled: resumeVisible && !killSwitchBlocks,
        reason: !resumeVisible
          ? "manual_resume_not_required"
          : killSwitchBlocks
            ? "portfolio_kill_switch_active"
            : null,
        visible: resumeVisible
      }
    };
  }

  selectPulseFocusBot(bots: any[], requestedBotId?: string | null) {
    return bots.find((bot: any) => bot.botId === requestedBotId)
      || bots.find((bot: any) => bot.openPosition)
      || bots.find((bot: any) => bot.status === "running")
      || bots[0]
      || null;
  }

  buildPulsePayload(options: { botId?: string | null } = {}) {
    const now = Date.now();
    const system = this.buildSystemPayload();
    const bots = this.buildBotsPayload();
    const portfolio = system.portfolioKillSwitch || {};
    const focusBot = this.selectPulseFocusBot(bots, options.botId || null);
    return {
      botCards: bots.map((bot: any) => ({
        alert: this.buildPulseAlert(bot),
        botId: bot.botId,
        position: this.buildPulsePosition(bot),
        regime: this.getPulseRegime(bot),
        strategy: bot.activeStrategyId,
        symbol: bot.symbol,
        syncStatus: this.getPulseSyncStatus(bot)
      })),
      focusPanel: focusBot ? {
        actions: this.buildPulseActions(focusBot, portfolio),
        architect: this.buildPulseArchitectSummary(focusBot),
        botId: focusBot.botId,
        symbol: focusBot.symbol
      } : null,
      generatedAt: now,
      statusBar: {
        bots: {
          running: system.botsRunning || 0,
          total: system.botsTotal || bots.length
        },
        executionMode: String(system.executionMode || "paper").toUpperCase(),
        feedMode: String(system.feedMode || "n/a").toUpperCase(),
        killSwitch: this.buildPulseKillSwitch(portfolio),
        lastTickAgeMs: this.getPulseLastTickAgeMs(system, bots, now),
        marketStream: {
          status: this.getPulseMarketStreamStatus(system)
        },
        netPnlUsdt: this.getPulseNetPnlUsdt(system, bots),
        openPositions: system.openPositions || 0
      }
    };
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

  getPositiveQueryLimit(value: string | null, fallback: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
  }

  buildEventsPayload(options: { botId?: string | null; limit?: number | null } = {}) {
    const hasExplicitLimit = options.limit !== null && options.limit !== undefined && Number.isFinite(Number(options.limit));
    const hasFilter = Boolean(options.botId) || hasExplicitLimit;
    const limit = hasFilter ? Math.min(Math.max(Number(options.limit) || 60, 1), 500) : 60;
    return this.store.getRecentEvents(hasFilter ? 500 : 60)
      .slice()
      .reverse()
      .filter((event: any) => {
        if (!options.botId) return true;
        if (event?.botId === options.botId) return true;
        if (event?.metadata?.botId === options.botId) return true;
        return false;
      })
      .slice(0, limit);
  }

  buildTradesPayload(options: { botId?: string | null; limit?: number | null } = {}) {
    const hasExplicitLimit = options.limit !== null && options.limit !== undefined && Number.isFinite(Number(options.limit));
    const hasFilter = Boolean(options.botId) || hasExplicitLimit;
    const limit = hasFilter ? Math.min(Math.max(Number(options.limit) || 100, 1), 500) : null;
    const trades = this.store.getAllClosedTrades()
      .filter((trade: any) => !options.botId || trade.botId === options.botId)
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
    return limit ? trades.slice(0, limit) : trades;
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

  streamPulsePayload(request: any, response: any) {
    const headers = {
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream"
    };
    if (typeof response.setHeader === "function") {
      for (const [key, value] of Object.entries(headers)) {
        response.setHeader(key, value);
      }
    } else {
      response.writeHead(200, headers);
    }
    if (typeof response.flushHeaders === "function") {
      response.flushHeaders();
    }

    let closed = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const sendPulse = () => {
      if (closed) return;
      try {
        response.write(`data: ${JSON.stringify(this.buildPulsePayload())}\n\n`);
      } catch {
        cleanup();
      }
    };

    sendPulse();
    interval = setInterval(sendPulse, 1000);
    request.on?.("close", cleanup);
    response.on?.("close", cleanup);
  }

  handleRequest(request: any, response: any) {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${this.host}:${this.port}`}`);
    const pathname = url.pathname;
    const method = String(request.method || "GET").toUpperCase();

    const resumeMatch = pathname.match(/^\/api\/bots\/([^/]+)\/resume$/);
    if (method === "POST" && resumeMatch) {
      this.handleManualResumeRequest(decodeURIComponent(resumeMatch[1]), response);
      return;
    }

    if (pathname === "/api/system") {
      this.json(response, this.buildSystemPayload());
      return;
    }
    if (pathname === "/api/bots") {
      this.json(response, this.buildBotsPayload());
      return;
    }
    if (pathname === "/api/pulse/stream") {
      this.streamPulsePayload(request, response);
      return;
    }
    if (pathname === "/api/pulse") {
      this.json(response, this.buildPulsePayload({ botId: url.searchParams.get("botId") }));
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
      const limitParam = url.searchParams.get("limit");
      this.json(response, this.buildEventsPayload({
        botId: url.searchParams.get("botId"),
        limit: limitParam === null ? null : this.getPositiveQueryLimit(limitParam, 60, 500)
      }));
      return;
    }
    if (pathname === "/api/trades") {
      const limitParam = url.searchParams.get("limit");
      this.json(response, this.buildTradesPayload({
        botId: url.searchParams.get("botId"),
        limit: limitParam === null ? null : this.getPositiveQueryLimit(limitParam, 100, 500)
      }));
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
    if (pathname === "/pulse.js") {
      this.serveFile(response, path.join(this.publicDir, "pulse.js"));
      return;
    }
    if (pathname === "/styles.css") {
      this.serveFile(response, path.join(this.publicDir, "styles.css"));
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
