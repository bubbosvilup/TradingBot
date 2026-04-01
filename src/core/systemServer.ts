// Module responsibility: lightweight HTTP layer exposing stateStore data and serving the observability UI.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function getMimeType(filePath: string) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".ts")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/html; charset=utf-8";
}

function getStrategyFamily(strategyId: string | null | undefined) {
  if (strategyId === "emaCross") return "trend_following";
  if (strategyId === "rsiReversion") return "mean_reversion";
  return "other";
}

class SystemServer {
  store: any;
  logger: any;
  host: string;
  port: number;
  publicDir: string;
  uiDir: string;
  startedAt: number;
  server: any;
  feedMode: string;

  constructor(deps: { store: any; logger: any; host?: string; port?: number; publicDir?: string; uiDir?: string; startedAt?: number; feedMode?: string }) {
    this.store = deps.store;
    this.logger = deps.logger;
    this.host = deps.host || "127.0.0.1";
    this.port = deps.port || 3000;
    this.publicDir = deps.publicDir || path.resolve(process.cwd(), "public");
    this.uiDir = deps.uiDir || path.resolve(process.cwd(), "src", "ui");
    this.startedAt = deps.startedAt || Date.now();
    this.server = null;
    this.feedMode = deps.feedMode || "mock";
  }

  start() {
    if (this.server) return;
    this.server = http.createServer((request: any, response: any) => {
      this.handleRequest(request, response);
    });
    this.server.listen(this.port, this.host, () => {
      this.logger.info("dashboard_ready", { feedMode: this.feedMode, url: `http://${this.host}:${this.port}` });
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

  buildSystemPayload() {
    const snapshot = this.store.getSystemSnapshot();
    const running = snapshot.botStates.filter((bot: any) => bot.status === "running").length;
    const marketConnection = this.store.getWsConnections().find((connection: any) => connection.connectionId === "market-stream") || null;
    const latestLatency = this.store.getAllPipelineSnapshots()
      .filter((item: any) => item.lastStateUpdatedAt)
      .sort((left: any, right: any) => (right.lastStateUpdatedAt || 0) - (left.lastStateUpdatedAt || 0))[0] || null;
    return {
      botsRunning: running,
      botsTotal: snapshot.botStates.length,
      eventCount: this.store.getRecentEvents(500).length,
      feedMode: this.feedMode,
      latency: latestLatency,
      openPositions: snapshot.openPositions.length,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      wsConnection: marketConnection,
      wsConnections: this.store.getWsConnections()
    };
  }

  buildBotsPayload() {
    const now = Date.now();
    return Array.from(this.store.botConfigs.values()).map((config: any) => {
      const state = this.store.getBotState(config.id);
      const performance = this.store.getPerformance(config.id);
      const position = this.store.getPosition(config.id);
      const latestPrice = this.store.getLatestPrice(config.symbol);
      const architect = this.store.getArchitectAssessment(config.symbol);
      const architectPublisher = this.store.getArchitectPublisherState(config.symbol);
      const context = this.store.getContextSnapshot(config.symbol);
      const activeFamily = getStrategyFamily(state?.activeStrategyId || config.strategy);
      const targetFamily = architect?.recommendedFamily && architect.recommendedFamily !== "no_trade"
        ? architect.recommendedFamily
        : null;
      const cooldownRemainingMs = state?.cooldownUntil ? Math.max(0, state.cooldownUntil - now) : 0;
      const unrealizedPnl = position && latestPrice
        ? (latestPrice - position.entryPrice) * position.quantity
        : 0;
      const derivedSyncStatus = position && targetFamily && activeFamily !== targetFamily
        ? "waiting_flat"
        : architect
          ? "synced"
          : "pending";
      const syncStatus = !state?.architectSyncStatus || state.architectSyncStatus === "pending"
        ? derivedSyncStatus
        : state.architectSyncStatus;

      return {
        activeStrategyId: state?.activeStrategyId || config.strategy,
        architect: architect ? {
          ...architect,
          challenger: architectPublisher?.challengerRegime ? {
            count: architectPublisher.challengerCount,
            regime: architectPublisher.challengerRegime,
            required: architectPublisher.challengerRequired
          } : null,
          hysteresisActive: architectPublisher?.hysteresisActive || false,
          nextPublishAt: architectPublisher?.nextPublishAt || null,
          ready: architectPublisher ? architectPublisher.ready : true,
          warmupRemainingMs: !context?.warmupComplete && context?.windowSpanMs
            ? Math.max(0, 30_000 - context.windowSpanMs)
            : 0
        } : architectPublisher ? {
          absoluteConviction: 0,
          challenger: architectPublisher.challengerRegime ? {
            count: architectPublisher.challengerCount,
            regime: architectPublisher.challengerRegime,
            required: architectPublisher.challengerRequired
          } : null,
          contextMaturity: context?.features?.maturity || 0,
          dataMode: context?.dataMode || "unknown",
          decisionStrength: 0,
          familyScores: {
            mean_reversion: 0,
            no_trade: 1,
            trend_following: 0
          },
          featureConflict: context?.features?.featureConflict || 0,
          hysteresisActive: architectPublisher.hysteresisActive || false,
          marketRegime: "unclear",
          nextPublishAt: architectPublisher.nextPublishAt || null,
          ready: architectPublisher.ready || false,
          recommendedFamily: "no_trade",
          regimeScores: {
            range: 0,
            trend: 0,
            unclear: 1,
            volatile: 0
          },
          reasonCodes: [],
          sampleSize: context?.sampleSize || 0,
          signalAgreement: 0,
          structureState: context?.structureState || "choppy",
          summary: context?.summary || "Architect warming up.",
          trendBias: context?.trendBias || "neutral",
          updatedAt: architectPublisher.lastPublishedAt || architectPublisher.lastObservedAt || now,
          volatilityState: context?.volatilityState || "normal",
          warmupRemainingMs: !context?.warmupComplete && context?.windowSpanMs
            ? Math.max(0, 30_000 - context.windowSpanMs)
            : 0
        } : null,
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
        openPosition: position ? {
          entryPrice: position.entryPrice,
          openedAt: position.openedAt,
          quantity: position.quantity,
          unrealizedPnl
        } : null,
        performance,
        price: latestPrice,
        riskProfile: config.riskProfile,
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
          strategyId: position.strategyId,
          symbol: position.symbol,
          unrealizedPnl: (latestPrice - position.entryPrice) * position.quantity
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
          side: trade.side || "long",
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
    const openPosition = Array.from(this.store.positions.values()).find((position: any) => position?.symbol === resolvedSymbol) || null;
    const latestPrice = priceSnapshot?.latestPrice || null;
    const lineData = (priceSnapshot?.history || []).map((tick: any) => ({
      time: Math.floor(Number(tick.timestamp) / 1000),
      value: Number(tick.price)
    }));
    const markerMap = new Map();
    for (const trade of closedTrades) {
      const entryTimeSeconds = Math.floor(Number(trade.openedAt) / 1000);
      const exitTimeSeconds = Math.floor(Number(trade.closedAt) / 1000);
      if (Number.isFinite(entryTimeSeconds) && entryTimeSeconds > 0) {
        markerMap.set(`entry:${trade.id}:${entryTimeSeconds}`, {
          color: "#22c55e",
          position: "belowBar",
          shape: "arrowUp",
          text: `BUY ${trade.botId} @ ${Number(trade.entryPrice).toFixed(4)} ${new Date(trade.openedAt).toLocaleTimeString()}`,
          time: entryTimeSeconds
        });
      }
      if (Number.isFinite(exitTimeSeconds) && exitTimeSeconds > 0) {
        markerMap.set(`exit:${trade.id}:${exitTimeSeconds}`, {
          color: trade.netPnl >= 0 ? "#22c55e" : "#ef4444",
          position: "aboveBar",
          shape: "arrowDown",
          text: `SELL ${trade.botId} @ ${Number(trade.exitPrice).toFixed(4)} ${new Date(trade.closedAt).toLocaleTimeString()} PnL ${Number(trade.netPnl).toFixed(2)}`,
          time: exitTimeSeconds
        });
      }
    }
    if (openPosition && Number.isFinite(Number(openPosition.openedAt))) {
      const openTimeSeconds = Math.floor(Number(openPosition.openedAt) / 1000);
      if (openTimeSeconds > 0) {
        markerMap.set(`open:${openPosition.id}:${openTimeSeconds}`, {
          color: "#22c55e",
          position: "belowBar",
          shape: "arrowUp",
          text: `BUY ${openPosition.botId} @ ${Number(openPosition.entryPrice).toFixed(4)} ${new Date(openPosition.openedAt).toLocaleTimeString()}`,
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
        quantity: openPosition.quantity
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
    if (pathname === "/app.js") {
      this.serveFile(response, path.join(this.publicDir, "app.js"));
      return;
    }
    if (pathname === "/styles.css") {
      this.serveFile(response, path.join(this.publicDir, "styles.css"));
      return;
    }
    if (pathname.startsWith("/ui/")) {
      const fileName = pathname.replace(/^\/ui\//, "");
      this.serveFile(response, path.join(this.uiDir, fileName));
      return;
    }

    this.notFound(response);
  }
}

module.exports = {
  SystemServer
};
