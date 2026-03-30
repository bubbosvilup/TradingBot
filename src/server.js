"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

function createServerApi(context) {
  const { config, state } = context;

  function getPortfolioValue() {
    const positionsValue = state.positions.reduce((sum, position) => {
      return sum + (position.lastPrice ? position.btcAmount * position.lastPrice : 0);
    }, 0);
    return state.usdtBalance + positionsValue;
  }

  function getPositionBudgetMetrics() {
    const portfolioValue = getPortfolioValue();
    const budgetCap = portfolioValue * config.MAX_POSITION_EXPOSURE_PCT;
    const budgetUsed = state.positions.reduce((sum, position) => sum + position.usdtAllocated, 0);
    const activeCount = state.positions.length;

    return {
      activeCount,
      budgetCap,
      budgetRemaining: Math.max(0, budgetCap - budgetUsed),
      budgetUsed,
      entryCount: activeCount,
      perTradeBudget: budgetCap / config.MAX_CONCURRENT_POSITIONS
    };
  }

  function getSessionPnl() {
    return getPortfolioValue() - config.INITIAL_USDT_BALANCE;
  }

  function getSessionPnlPercent() {
    if (config.INITIAL_USDT_BALANCE === 0) {
      return 0;
    }
    return (getSessionPnl() / config.INITIAL_USDT_BALANCE) * 100;
  }

  function getSessionStats() {
    const closedTrades = state.trades.filter((trade) => trade.action === "SELL_FULL" || trade.action === "SELL_PARTIAL");
    const profitableTrades = closedTrades.filter((trade) => trade.netPnlUsdt !== null && trade.netPnlUsdt > 0);
    const losingTrades = closedTrades.filter((trade) => trade.netPnlUsdt !== null && trade.netPnlUsdt < 0);
    const totalClosedPnl = closedTrades.reduce((total, trade) => total + (trade.netPnlUsdt || 0), 0);
    const averageClosedTradePnl = closedTrades.length === 0 ? 0 : totalClosedPnl / closedTrades.length;
    const lastTrade = state.trades.length === 0 ? null : state.trades[state.trades.length - 1];

    return {
      averageClosedTradePnl,
      hasOpenPosition: state.positions.length > 0,
      lastTrade,
      losingTrades: losingTrades.length,
      profitableTrades: profitableTrades.length,
      sessionPnl: getSessionPnl(),
      totalTrades: state.trades.length
    };
  }

  function buildSummary() {
    const sessionPnl = getSessionPnl();
    const sessionPnlLabel = `${sessionPnl >= 0 ? "+" : ""}${sessionPnl.toFixed(2)} USDT`;

    if (!state.botActive) {
      return "Il bot e fermo.";
    }
    if (state.positions.length > 0) {
      const symbolList = state.positions.map((position) => position.symbol).join(", ");
      return `Il bot e attivo e sta gestendo ${state.positions.length} posizioni (${symbolList}). Risultato sessione: ${sessionPnlLabel}.`;
    }
    if (state.bestCandidateSymbol) {
      return `Il bot e attivo e sta confrontando ${context.getSymbols().length} mercati. Al momento il candidato migliore e ${state.bestCandidateSymbol}. Risultato sessione: ${sessionPnlLabel}.`;
    }

    return `Il bot e attivo e sta osservando ${context.getSymbols().length} mercati. Risultato sessione: ${sessionPnlLabel}.`;
  }

  function selectFocusMarket() {
    const openPosition = state.positions[0];
    if (openPosition && state.markets[openPosition.symbol]) {
      return state.markets[openPosition.symbol];
    }
    if (state.bestCandidateSymbol && state.markets[state.bestCandidateSymbol]) {
      return state.markets[state.bestCandidateSymbol];
    }

    const availableMarkets = Object.values(state.markets).filter((market) => market && market.lastPrice !== null);
    if (availableMarkets.length === 0) {
      return null;
    }

    const scoredMarkets = availableMarkets.filter((market) => market.score !== null && market.score !== undefined);
    if (scoredMarkets.length > 0) {
      scoredMarkets.sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return Number(right.trend === "rialzista") - Number(left.trend === "rialzista");
      });
      return scoredMarkets[0];
    }

    return availableMarkets[0];
  }

  function getStatusPayload() {
    const focusMarket = selectFocusMarket();
    const activePositionSymbols = state.positions.map((position) => position.symbol);
    const focusSymbol = focusMarket ? focusMarket.symbol : (activePositionSymbols[0] || state.bestCandidateSymbol);
    let focusMode = "no_data";
    let focusReason = "Nessun mercato ha ancora dati sufficienti.";

    if (focusMarket) {
      if (activePositionSymbols.includes(focusMarket.symbol)) {
        focusMode = "open_position";
        focusReason = `Questo mercato e in focus perche il bot ha gia una posizione aperta su ${focusMarket.symbol}.`;
      } else if (state.bestCandidateSymbol && focusMarket.symbol === state.bestCandidateSymbol) {
        focusMode = "best_candidate";
        focusReason = "Questo mercato e in focus perche al momento e il candidato migliore tra quelli osservati.";
      } else {
        focusMode = "best_available";
        focusReason = "Questo mercato e in focus perche e quello con i dati piu utili disponibili in questo momento.";
      }
    }

    const portfolioValue = getPortfolioValue();
    const sessionPnl = getSessionPnl();
    const stats = getSessionStats();
    const budget = getPositionBudgetMetrics();
    const positionsWithDetails = state.positions.map((position) => {
      const pnlUsdt = position.lastPrice ? (position.btcAmount * position.lastPrice) - position.costBasisUsdt : 0;
      const pnlPercent = position.costBasisUsdt > 0 ? (pnlUsdt / position.costBasisUsdt) * 100 : 0;
      return {
        ...position,
        pnlLabel: `${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}% (${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT)`,
        pnlPercent,
        pnlUsdt
      };
    });

    return {
      bot: {
        active: state.botActive,
        btcRegime: state.btcRegime,
        exchange: state.exchange,
        lastPrice: focusMarket ? focusMarket.lastPrice : null,
        lastUpdate: state.lastUpdate,
        paperTrading: state.paperTrading,
        startedAt: state.botStartedAt,
        strategy: state.strategyName,
        summary: buildSummary(),
        symbol: focusSymbol || config.DEFAULT_SYMBOL
      },
      decision: focusMarket ? {
        action: focusMarket.displayAction,
        atr14_5m: focusMarket.atr14_5m,
        compositeScore: focusMarket.compositeScore,
        currentVolume_5m: focusMarket.currentVolume_5m,
        decisionState: focusMarket.decisionState,
        detailedExplanation: focusMarket.detailedExplanation,
        ema20_1h: focusMarket.ema20_1h,
        ema21: focusMarket.ema21_5m,
        ema21_5m: focusMarket.ema21_5m,
        ema50_1h: focusMarket.ema50_1h,
        ema9: focusMarket.ema9_5m,
        ema9_5m: focusMarket.ema9_5m,
        entryCount: focusMarket.entryCount,
        entryEngine: focusMarket.entryEngine,
        entryPrice: focusMarket.entryPrice,
        exitReasonCode: focusMarket.exitReasonCode,
        focusMode,
        focusReason,
        highWaterMark: focusMarket.highWaterMark,
        holdCandles: focusMarket.holdCandles,
        longMa: focusMarket.ema21_5m,
        macdHistogram: focusMarket.macdHistogram,
        macdLine: focusMarket.macdLine,
        missingIndicators: focusMarket.missingIndicators,
        reason: focusMarket.reason,
        reasonList: focusMarket.reasonList,
        rsi: focusMarket.rsi_5m,
        rsi_5m: focusMarket.rsi_5m,
        score: focusMarket.compositeScore,
        shortExplanation: focusMarket.shortExplanation,
        shortMa: focusMarket.ema9_5m,
        signalLine: focusMarket.signalLine,
        stopLoss: focusMarket.stopLoss,
        strategy: state.strategyName,
        symbol: focusMarket.symbol,
        takeProfit: focusMarket.takeProfit,
        trailingStop: focusMarket.trailingStop,
        trendBull_1h: focusMarket.trendBull_1h,
        trendLateral: focusMarket.trendLateral,
        trendSlope_1h: focusMarket.trendSlope_1h,
        triggerFired: focusMarket.triggerFired,
        volumeSMA20: focusMarket.volumeSMA20,
        warmingUp: focusMarket.warmingUp
      } : {
        action: "HOLD",
        compositeScore: null,
        currentVolume_5m: null,
        decisionState: "warmup",
        detailedExplanation: "Il sistema e attivo ma non ha ancora ricevuto dati sufficienti per una valutazione.",
        ema20_1h: null,
        ema21: null,
        ema21_5m: null,
        ema50_1h: null,
        ema9: null,
        ema9_5m: null,
        entryCount: 0,
        entryEngine: null,
        entryPrice: null,
        exitReasonCode: null,
        focusMode,
        focusReason,
        highWaterMark: null,
        holdCandles: 0,
        longMa: null,
        macdHistogram: null,
        macdLine: null,
        missingIndicators: ["OHLCV"],
        reason: "Nessun mercato disponibile.",
        reasonList: ["Trend: non disponibile", "RSI: non disponibile", "Prezzo: non valutabile", "Stato posizione: nessuna", "Decisione finale: HOLD"],
        rsi: null,
        rsi_5m: null,
        score: null,
        shortExplanation: "Il bot non ha ancora dati da mostrare.",
        shortMa: null,
        signalLine: null,
        stopLoss: null,
        strategy: state.strategyName,
        symbol: null,
        takeProfit: null,
        trailingStop: null,
        trendBull_1h: null,
        trendLateral: null,
        trendSlope_1h: null,
        triggerFired: null,
        volumeSMA20: null,
        warmingUp: true
      },
      markets: context.getSymbols().map((symbol) => {
        const market = state.markets[symbol];
        if (!market) {
          return {
            decisionState: "warmup",
            entryEngine: null,
            exitReasonCode: null,
            isBestCandidate: false,
            isInPosition: false,
            lastPrice: null,
            reason: "In attesa di dati.",
            rsi: null,
            score: null,
            signal: "HOLD",
            symbol,
            trend: "non disponibile"
          };
        }

        return {
          decisionState: market.decisionState,
          emaFast: market.emaFast,
          emaSlow: market.emaSlow,
          entryEngine: market.entryEngine,
          exitReasonCode: market.exitReasonCode,
          isBestCandidate: state.bestCandidateSymbol === market.symbol,
          isInPosition: state.positions.some((position) => position.symbol === market.symbol),
          lastPrice: market.lastPrice,
          reason: market.reason,
          rsi: market.rsi,
          score: market.score,
          signal: market.signal,
          symbol: market.symbol,
          trend: market.trend
        };
      }),
      overview: {
        activeCount: state.positions.length,
        bestCandidateSymbol: state.bestCandidateSymbol,
        botActive: state.botActive,
        btcFilterEnabled: context.getBtcFilterEnabled(),
        btcRegime: state.btcRegime,
        entryCount: budget.activeCount,
        hasOpenPosition: state.positions.length > 0,
        paperTrading: state.paperTrading,
        portfolioValue,
        positions: positionsWithDetails,
        sessionPnl
      },
      portfolio: {
        btcPosition: state.positions.reduce((sum, position) => sum + (position.lastPrice ? position.btcAmount * position.lastPrice : 0), 0),
        budgetCap: budget.budgetCap,
        budgetRemaining: budget.budgetRemaining,
        budgetUsed: budget.budgetUsed,
        entryCount: budget.entryCount,
        estimatedTotalValue: portfolioValue,
        sessionPnl,
        sessionPnlPercent: getSessionPnlPercent(),
        usdtBalance: state.usdtBalance
      },
      stats
    };
  }

  function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
  }

  function readJsonBody(request) {
    return new Promise((resolve, reject) => {
      let rawBody = "";
      request.on("data", (chunk) => {
        rawBody += chunk.toString();
      });
      request.on("end", () => {
        if (!rawBody) {
          resolve({});
          return;
        }

        try {
          resolve(JSON.parse(rawBody));
        } catch (error) {
          reject(new Error("Invalid JSON body."));
        }
      });
      request.on("error", reject);
    });
  }

  function sendFile(response, filePath, contentType) {
    try {
      const content = fs.readFileSync(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Content-Type": contentType,
        Expires: "0",
        Pragma: "no-cache"
      });
      response.end(content);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  }

  function startServer() {
    const server = http.createServer(async (request, response) => {
      if (!request.url) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Bad request");
        return;
      }

      const url = new URL(request.url, `http://${config.SERVER_HOST}:${config.SERVER_PORT}`);
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, getStatusPayload());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/trades") {
        sendJson(response, 200, { trades: state.trades });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/reset") {
        context.persistence.resetSession();
        sendJson(response, 200, { ok: true, status: getStatusPayload(), trades: state.trades });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/btc-filter") {
        try {
          const body = await readJsonBody(request);
          if (typeof body.enabled !== "boolean") {
            sendJson(response, 400, { ok: false, message: "Field 'enabled' must be boolean." });
            return;
          }
          context.setBtcFilterEnabled(body.enabled);
          sendJson(response, 200, { btcFilterEnabled: context.getBtcFilterEnabled(), ok: true });
        } catch (error) {
          sendJson(response, 400, { ok: false, message: error.message });
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        sendFile(response, path.join(config.PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        sendFile(response, path.join(config.PUBLIC_DIR, "app.js"), "application/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        sendFile(response, path.join(config.PUBLIC_DIR, "styles.css"), "text/css; charset=utf-8");
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    server.listen(config.SERVER_PORT, config.SERVER_HOST, () => {
      context.logScoped("SERVER", `dashboard_ready | url=http://${config.SERVER_HOST}:${config.SERVER_PORT}`);
    });
    return server;
  }

  return {
    buildSummary,
    getPortfolioValue,
    getPositionBudgetMetrics,
    getSessionPnl,
    getSessionStats,
    getStatusPayload,
    selectFocusMarket,
    startServer
  };
}

module.exports = {
  createServerApi
};
