"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

function createServerApi(context) {
  const { config, state } = context;

  function groupTradeRounds() {
    const groups = new Map();
    for (const trade of state.trades) {
      const tradeId = trade.tradeId || `legacy-${trade.time}-${trade.symbol}`;
      if (!groups.has(tradeId)) {
        groups.set(tradeId, []);
      }
      groups.get(tradeId).push(trade);
    }

    return Array.from(groups.values())
      .map((events) => {
        const sortedEvents = [...events].sort((left, right) => new Date(left.time) - new Date(right.time));
        const first = sortedEvents[0];
        const last = sortedEvents[sortedEvents.length - 1];
        const isClosed = sortedEvents.some((event) => event.action === "SELL_FULL");
        const buys = sortedEvents.filter((event) => event.action === "BUY");
        const totalFees = sortedEvents.reduce((sum, event) => sum + (event.feePaid || 0), 0);
        const totalSlippage = sortedEvents.reduce((sum, event) => sum + (event.slippagePaid || 0), 0);
        const turnoverUsdt = sortedEvents.reduce((sum, event) => sum + Math.abs(event.usdtAmount || 0), 0);
        const realizedPnl = sortedEvents.reduce((sum, event) => sum + (event.netPnlUsdt || 0), 0);
        const durationMs = last?.time && first?.time ? Math.max(0, new Date(last.time).getTime() - new Date(first.time).getTime()) : 0;

        return {
          closed: isClosed,
          durationMs,
          endTime: last?.time || first?.time || null,
          entryEngine: first?.entryEngine || first?.entryType || null,
          equityAfter: realizedPnl,
          eventCount: sortedEvents.length,
          realizedPnl,
          startTime: first?.time || null,
          symbol: first?.symbol || "n/a",
          totalFees,
          totalSlippage,
          turnoverUsdt,
          tradeId
        };
      })
      .sort((left, right) => new Date(left.startTime || 0) - new Date(right.startTime || 0));
  }

  function getWatchlistPayload(focusSymbol) {
    const activeSymbols = Array.isArray(state.watchlist?.activeSymbols) && state.watchlist.activeSymbols.length > 0
      ? state.watchlist.activeSymbols
      : context.getSymbols();
    const hotPool = Array.isArray(state.watchlist?.hotPool) ? state.watchlist.hotPool : [];
    const activeSet = new Set(activeSymbols);
    const positionSymbols = new Set(state.positions.map((position) => position.symbol));
    const lastRotationSummary = state.watchlist?.lastRotationSummary || null;
    const weakSymbolMap = new Map(
      Array.isArray(lastRotationSummary?.weakSymbols)
        ? lastRotationSummary.weakSymbols.map((item) => [item.symbol, item])
        : []
    );

    return {
      active: activeSymbols.map((symbol) => {
        const market = state.markets[symbol];
        const weakInfo = weakSymbolMap.get(symbol);
        return {
          decisionState: market?.decisionState || "warmup",
          entryEngine: market?.entryEngine || null,
          focusScore: market?.focusScore ?? null,
          isFocus: symbol === focusSymbol,
          isInPosition: positionSymbols.has(symbol),
          isWeak: weakSymbolMap.has(symbol),
          lastPrice: market?.lastPrice ?? null,
          marketRegime: market?.marketRegime || "n/a",
          opportunityScore: market?.opportunityScore ?? null,
          reason: market?.reason || "In attesa di dati.",
          rsi: market?.rsi_5m ?? null,
          score: market?.compositeScore ?? null,
          setupQualityScore: market?.setupQualityScore ?? null,
          signal: market?.signal || "HOLD",
          symbol,
          trend: market?.trend || "non disponibile",
          weakRsi: weakInfo?.rsi ?? null
        };
      }),
      hotPool: hotPool.map((symbol, index) => {
        const market = state.markets[symbol];
        return {
          index: index + 1,
          isActive: activeSet.has(symbol),
          isBestCandidate: symbol === state.bestCandidateSymbol,
          isFocus: symbol === focusSymbol,
          lastPrice: market?.lastPrice ?? null,
          marketRegime: market?.marketRegime || "n/a",
          opportunityScore: market?.opportunityScore ?? null,
          rsi: market?.rsi_5m ?? null,
          score: market?.compositeScore ?? null,
          symbol,
          trend: market?.trend || "non disponibile"
        };
      }),
      lastPoolRefreshAt: state.watchlist?.lastPoolRefreshAt || null,
      lastRotationAt: state.watchlist?.lastRotationAt || null,
      recentSwaps: Array.isArray(state.watchlist?.recentSwaps) ? state.watchlist.recentSwaps : [],
      source: state.watchlist?.source || "dynamic",
      weakThresholdRsi: state.watchlist?.weakThresholdRsi ?? config.WEAK_SYMBOL_RSI_MAX
    };
  }

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
    const tradeRounds = groupTradeRounds();
    const closedRounds = tradeRounds.filter((round) => round.closed);
    const profitableTrades = closedRounds.filter((round) => round.realizedPnl > 0);
    const losingTrades = closedRounds.filter((round) => round.realizedPnl < 0);
    const breakEvenTrades = closedRounds.filter((round) => round.realizedPnl === 0);
    const totalClosedPnl = closedRounds.reduce((total, round) => total + round.realizedPnl, 0);
    const averageClosedTradePnl = closedRounds.length === 0 ? 0 : totalClosedPnl / closedRounds.length;
    const totalFeesPaid = state.trades.reduce((sum, trade) => sum + (trade.feePaid || 0), 0);
    const totalSlippagePaid = state.trades.reduce((sum, trade) => sum + (trade.slippagePaid || 0), 0);
    const grossProfit = profitableTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0);
    const grossLossAbs = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0));
    const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? grossProfit : 0);
    const expectancyUsdt = closedRounds.length > 0 ? totalClosedPnl / closedRounds.length : 0;
    const avgWinnerUsdt = profitableTrades.length > 0 ? grossProfit / profitableTrades.length : 0;
    const avgLoserUsdt = losingTrades.length > 0 ? losingTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0) / losingTrades.length : 0;
    const turnoverUsdt = state.trades.reduce((sum, trade) => sum + Math.abs(trade.usdtAmount || 0), 0);
    const averageHoldMinutes = closedRounds.length > 0
      ? closedRounds.reduce((sum, round) => sum + (round.durationMs / 60000), 0) / closedRounds.length
      : 0;
    let cumulativePnl = 0;
    let equityPeak = 0;
    let maxDrawdownUsdt = 0;
    for (const round of closedRounds) {
      cumulativePnl += round.realizedPnl;
      equityPeak = Math.max(equityPeak, cumulativePnl);
      maxDrawdownUsdt = Math.max(maxDrawdownUsdt, equityPeak - cumulativePnl);
    }
    const maxDrawdownPct = config.INITIAL_USDT_BALANCE > 0 ? (maxDrawdownUsdt / config.INITIAL_USDT_BALANCE) * 100 : 0;
    const engineBreakdownMap = new Map();
    for (const round of closedRounds) {
      const key = round.entryEngine || "unknown";
      if (!engineBreakdownMap.has(key)) {
        engineBreakdownMap.set(key, {
          avgPnlUsdt: 0,
          count: 0,
          grossPnlUsdt: 0,
          wins: 0
        });
      }
      const bucket = engineBreakdownMap.get(key);
      bucket.count += 1;
      bucket.grossPnlUsdt += round.realizedPnl;
      if (round.realizedPnl > 0) {
        bucket.wins += 1;
      }
    }
    const engineBreakdown = Array.from(engineBreakdownMap.entries()).map(([engine, bucket]) => ({
      avgPnlUsdt: bucket.count > 0 ? bucket.grossPnlUsdt / bucket.count : 0,
      count: bucket.count,
      engine,
      grossPnlUsdt: bucket.grossPnlUsdt,
      winRatePct: bucket.count > 0 ? (bucket.wins / bucket.count) * 100 : 0,
      wins: bucket.wins
    }));
    const lastTrade = state.trades.length === 0 ? null : state.trades[state.trades.length - 1];

    return {
      averageClosedTradePnl,
      averageHoldMinutes,
      avgLoserUsdt,
      avgWinnerUsdt,
      breakEvenTrades: breakEvenTrades.length,
      closedRounds,
      engineBreakdown,
      expectancyUsdt,
      grossLossAbs,
      grossProfit,
      hasOpenPosition: state.positions.length > 0,
      lastTrade,
      losingTrades: losingTrades.length,
      maxDrawdownPct,
      maxDrawdownUsdt,
      profitFactor,
      profitableTrades: profitableTrades.length,
      sessionPnl: getSessionPnl(),
      totalFeesPaid,
      totalSlippagePaid,
      totalClosedRounds: closedRounds.length,
      totalTrades: state.trades.length,
      turnoverUsdt,
      winRatePct: closedRounds.length > 0 ? (profitableTrades.length / closedRounds.length) * 100 : 0
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
        const leftTier = left.positionOpen ? 4 : left.action === "BUY" ? 3 : left.displayAction === "WAIT" ? 2 : left.signal === "BUY candidate" ? 1 : 0;
        const rightTier = right.positionOpen ? 4 : right.action === "BUY" ? 3 : right.displayAction === "WAIT" ? 2 : right.signal === "BUY candidate" ? 1 : 0;
        if (rightTier !== leftTier) {
          return rightTier - leftTier;
        }
        if ((right.focusScore || 0) !== (left.focusScore || 0)) {
          return (right.focusScore || 0) - (left.focusScore || 0);
        }
        if ((right.opportunityScore || 0) !== (left.opportunityScore || 0)) {
          return (right.opportunityScore || 0) - (left.opportunityScore || 0);
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
      const grossExitValue = position.lastPrice ? position.btcAmount * position.lastPrice : 0;
      const estimatedExitFeeUsdt = grossExitValue * (config.EXIT_FEE_BPS / 10000);
      const netExitValue = Math.max(0, grossExitValue - estimatedExitFeeUsdt);
      const pnlUsdt = netExitValue - position.costBasisUsdt;
      const pnlPercent = position.costBasisUsdt > 0 ? (pnlUsdt / position.costBasisUsdt) * 100 : 0;
      return {
        ...position,
        estimatedExitFeeUsdt,
        netExitValue,
        pnlLabel: `${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}% (${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT)`,
        pnlPercent,
        pnlUsdt
      };
    });
    const watchlist = getWatchlistPayload(focusSymbol);

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
        expectedNetProfitUsdt: focusMarket.expectedNetProfitUsdt ?? null,
        exitReasonCode: focusMarket.exitReasonCode,
        focusScore: focusMarket.focusScore,
        focusMode,
        focusReason,
        highWaterMark: focusMarket.highWaterMark,
        holdCandles: focusMarket.holdCandles,
        longMa: focusMarket.ema21_5m,
        macdHistogram: focusMarket.macdHistogram,
        macdLine: focusMarket.macdLine,
        marketRegime: focusMarket.marketRegime,
        missingIndicators: focusMarket.missingIndicators,
        opportunityScore: focusMarket.opportunityScore,
        plannedStopLoss: focusMarket.plannedStopLoss,
        plannedTakeProfit: focusMarket.plannedTakeProfit,
        projectedNetEdgeBps: focusMarket.projectedNetEdgeBps,
        projectedRiskRewardRatio: focusMarket.projectedRiskRewardRatio,
        projectedRoundTripFeeBps: focusMarket.projectedRoundTripFeeBps,
        reason: focusMarket.reason,
        reasonList: focusMarket.reasonList,
        rsi: focusMarket.rsi_5m,
        rsi_5m: focusMarket.rsi_5m,
        score: focusMarket.compositeScore,
        setupQualityScore: focusMarket.setupQualityScore,
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
        volumeRatio_5m: focusMarket.volumeRatio_5m,
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
        expectedNetProfitUsdt: null,
        exitReasonCode: null,
        focusScore: null,
        focusMode,
        focusReason,
        highWaterMark: null,
        holdCandles: 0,
        longMa: null,
        macdHistogram: null,
        macdLine: null,
        marketRegime: "warmup",
        missingIndicators: ["OHLCV"],
        opportunityScore: null,
        plannedStopLoss: null,
        plannedTakeProfit: null,
        projectedNetEdgeBps: null,
        projectedRiskRewardRatio: null,
        projectedRoundTripFeeBps: null,
        reason: "Nessun mercato disponibile.",
        reasonList: ["Trend: non disponibile", "RSI: non disponibile", "Prezzo: non valutabile", "Stato posizione: nessuna", "Decisione finale: HOLD"],
        rsi: null,
        rsi_5m: null,
        score: null,
        setupQualityScore: null,
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
        volumeRatio_5m: null,
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
          focusScore: market.focusScore,
          isBestCandidate: state.bestCandidateSymbol === market.symbol,
          isInPosition: state.positions.some((position) => position.symbol === market.symbol),
          lastPrice: market.lastPrice,
          marketRegime: market.marketRegime,
          opportunityScore: market.opportunityScore,
          reason: market.reason,
          rsi: market.rsi,
          score: market.score,
          setupQualityScore: market.setupQualityScore,
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
      runtime: {
        lastCompletedCycleAt: state.runtime?.lastCompletedCycleAt || null,
        lastCycleDurationMs: state.runtime?.lastCycleDurationMs ?? null,
        realtimeSymbols: state.runtime?.realtimeSymbols || [],
        restSymbolCount: state.runtime?.restSymbolCount ?? 0,
        scanCycle: state.runtime?.scanCycle ?? 0
      },
      stats,
      watchlist
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
