"use strict";

const { createRuntime } = require("./runtime");
const { createServerApi } = require("./server");
const { createStrategy } = require("./strategy");

const SUPPORTED_STRATEGY_MODES = ["adaptive", "trend", "range_grid"];

function uniqueSortedTimestamps(histories) {
  const timestampSet = new Set();
  for (const candleSet of Object.values(histories || {})) {
    for (const candle of candleSet?.candles_5m || []) {
      timestampSet.add(Number(candle[0]));
    }
  }
  return Array.from(timestampSet).sort((left, right) => left - right);
}

function createReplayState(config, symbols) {
  return {
    aggressiveModeEnabled: config.AGGRESSIVE_MODE_ENABLED === true,
    bestCandidateSymbol: null,
    botActive: true,
    botStartedAt: null,
    btcRegime: "risk-on",
    candleData: {},
    exchange: config.EXCHANGE_ID || "binance",
    lastUpdate: null,
    markets: {},
    paperTrading: true,
    positions: [],
    research: {
      backtestReport: null
    },
    runtime: {
      lastCompletedCycleAt: null,
      lastCycleDurationMs: null,
      realtimeSymbols: [],
      restSymbolCount: symbols.length,
      scanCycle: 0
    },
    strategyName: `backtest-${config.STRATEGY_MODE}`,
    trades: [],
    usdtBalance: config.INITIAL_USDT_BALANCE,
    watchlist: {
      activeSymbols: [...symbols],
      hotPool: [...symbols],
      lastPoolRefreshAt: null,
      lastRotationAt: null,
      lastRotationSummary: null,
      recentSwaps: [],
      source: "backtest",
      weakThresholdRsi: config.WEAK_SYMBOL_RSI_MAX ?? null
    }
  };
}

function createReplayContext(baseConfig, symbols, strategyMode, timestamps) {
  const clock = {
    index: 0,
    timestamps
  };
  const config = {
    ...baseConfig,
    MIN_HOLD_SECONDS: 0,
    POLL_INTERVAL_MS: 0,
    STRATEGY_MODE: strategyMode,
    STRATEGY_NAME: `backtest-${strategyMode}`,
    USE_CCXT_PRO_WS: false
  };
  const state = createReplayState(config, symbols);
  const context = {
    config,
    formatAmount: (value) => Number(value || 0).toFixed(8),
    formatLogNumber: (value, decimals = 4) => Number.isFinite(value) ? Number(value).toFixed(decimals) : "n/a",
    getBtcFilterEnabled: () => config.BACKTEST_BTC_FILTER_ENABLED !== false,
    getNowIso: () => new Date(clock.timestamps[clock.index] || Date.now()).toISOString(),
    getNowMs: () => clock.timestamps[clock.index] || Date.now(),
    getSymbols: () => symbols,
    logScoped: () => {},
    persistence: {
      appendTradeLog: () => {},
      saveStateToDisk: () => {}
    },
    setBtcFilterEnabled: () => {},
    state,
    withTimeout: async (value) => value
  };

  context.strategy = createStrategy(context);
  context.serverApi = createServerApi(context);
  context.runtime = createRuntime(context);

  return { clock, context };
}

function createWindowReaders(symbolHistories, config) {
  const readers = new Map();

  for (const [symbol, candleSet] of Object.entries(symbolHistories || {})) {
    readers.set(symbol, {
      candles_1h: Array.isArray(candleSet?.candles_1h) ? candleSet.candles_1h : [],
      candles_1m: Array.isArray(candleSet?.candles_1m) ? candleSet.candles_1m : [],
      candles_5m: Array.isArray(candleSet?.candles_5m) ? candleSet.candles_5m : [],
      index_1h: 0,
      index_1m: 0,
      index_5m: 0
    });
  }

  return {
    buildWindow(symbol, timestamp) {
      const reader = readers.get(symbol);
      if (!reader) {
        return { candles_1h: [], candles_1m: [], candles_5m: [] };
      }

      while (reader.index_1h < reader.candles_1h.length && Number(reader.candles_1h[reader.index_1h][0]) <= timestamp) {
        reader.index_1h += 1;
      }
      while (reader.index_5m < reader.candles_5m.length && Number(reader.candles_5m[reader.index_5m][0]) <= timestamp) {
        reader.index_5m += 1;
      }
      while (reader.index_1m < reader.candles_1m.length && Number(reader.candles_1m[reader.index_1m][0]) <= timestamp) {
        reader.index_1m += 1;
      }

      return {
        candles_1h: reader.candles_1h.slice(Math.max(0, reader.index_1h - config.FETCH_LIMIT_1H), reader.index_1h),
        candles_1m: reader.candles_1m.slice(Math.max(0, reader.index_1m - config.FETCH_LIMIT_1M), reader.index_1m),
        candles_5m: reader.candles_5m.slice(Math.max(0, reader.index_5m - config.FETCH_LIMIT_5M), reader.index_5m)
      };
    }
  };
}

function summarizeRounds(trades) {
  const grouped = new Map();
  for (const trade of trades) {
    const tradeId = trade.tradeId || `legacy-${trade.time}-${trade.symbol}`;
    if (!grouped.has(tradeId)) {
      grouped.set(tradeId, []);
    }
    grouped.get(tradeId).push(trade);
  }

  return Array.from(grouped.values()).map((events) => {
    const sorted = [...events].sort((left, right) => new Date(left.time) - new Date(right.time));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const buys = sorted.filter((event) => event.action === "BUY");
    const totalBtc = buys.reduce((sum, event) => sum + (event.btcAmount || 0), 0);
    const totalUsdt = buys.reduce((sum, event) => sum + (event.usdtAmount || ((event.price || 0) * (event.btcAmount || 0))), 0);
    const realizedPnl = sorted.reduce((sum, event) => sum + (event.netPnlUsdt || 0), 0);
    const totalFees = sorted.reduce((sum, event) => sum + (event.feePaid || 0), 0);
    const totalSlippage = sorted.reduce((sum, event) => sum + (event.slippagePaid || 0), 0);
    const closed = sorted.some((event) => event.action === "SELL_FULL");
    const startTime = first?.time || null;
    const endTime = last?.time || null;
    const durationMs = startTime && endTime ? Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime()) : 0;
    return {
      closed,
      durationMinutes: durationMs / 60000,
      endTime,
      entryEngine: first?.entryEngine || first?.entryType || "unknown",
      entryReason: first?.reason || null,
      entryShortExplanation: first?.explanationShort || null,
      eventCount: sorted.length,
      events: sorted.map((event) => ({
        action: event.action,
        decisionState: event.decisionState || null,
        expectedNetProfitUsdt: event.expectedNetProfitUsdt ?? null,
        feePaid: event.feePaid || 0,
        netPnlUsdt: event.netPnlUsdt ?? null,
        price: event.price ?? null,
        reason: event.reason || null,
        slippagePaid: event.slippagePaid || 0,
        time: event.time
      })),
      exitPrice: closed ? (last?.price ?? null) : null,
      lastReason: last?.reason || null,
      realizedPnl,
      startTime,
      symbol: first?.symbol || "n/a",
      totalFees,
      totalSlippage,
      tradeId: first?.tradeId || null,
      weightedEntryPrice: totalBtc > 0 ? totalUsdt / totalBtc : (first?.price ?? null)
    };
  });
}

function buildSymbolBreakdown(trades) {
  const rounds = summarizeRounds(trades).filter((round) => round.closed);
  const buckets = new Map();

  for (const round of rounds) {
    if (!buckets.has(round.symbol)) {
      buckets.set(round.symbol, {
        closedRounds: 0,
        grossPnlUsdt: 0,
        symbol: round.symbol,
        totalFees: 0,
        totalSlippage: 0,
        wins: 0
      });
    }
    const bucket = buckets.get(round.symbol);
    bucket.closedRounds += 1;
    bucket.grossPnlUsdt += round.realizedPnl;
    bucket.totalFees += round.totalFees;
    bucket.totalSlippage += round.totalSlippage;
    if (round.realizedPnl > 0) {
      bucket.wins += 1;
    }
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      avgPnlUsdt: bucket.closedRounds > 0 ? bucket.grossPnlUsdt / bucket.closedRounds : 0,
      closedRounds: bucket.closedRounds,
      grossPnlUsdt: bucket.grossPnlUsdt,
      symbol: bucket.symbol,
      totalFees: bucket.totalFees,
      totalSlippage: bucket.totalSlippage,
      winRatePct: bucket.closedRounds > 0 ? (bucket.wins / bucket.closedRounds) * 100 : 0
    }))
    .sort((left, right) => {
      if (right.grossPnlUsdt !== left.grossPnlUsdt) {
        return right.grossPnlUsdt - left.grossPnlUsdt;
      }
      return right.closedRounds - left.closedRounds;
    });
}

function scoreMode(stats, portfolioValue, initialBalance) {
  const pnlPct = initialBalance > 0 ? ((portfolioValue - initialBalance) / initialBalance) * 100 : 0;
  return (
    (pnlPct * 4.2) +
    ((stats.expectancyUsdt || 0) * 9) +
    ((stats.profitFactor || 0) * 2.5) +
    ((stats.winRatePct || 0) * 0.12) -
    ((stats.maxDrawdownPct || 0) * 2.4)
  );
}

function pickCandidateMarkets(markets) {
  return [...markets]
    .filter((market) => market.signal === "BUY candidate")
    .sort((left, right) => {
      if ((right.opportunityScore || 0) !== (left.opportunityScore || 0)) {
        return (right.opportunityScore || 0) - (left.opportunityScore || 0);
      }
      if ((right.compositeScore || 0) !== (left.compositeScore || 0)) {
        return (right.compositeScore || 0) - (left.compositeScore || 0);
      }
      return Number(right.triggerFired) - Number(left.triggerFired);
    });
}

function replayStrategyMode(options) {
  const { baseConfig, strategyMode, symbolHistories, symbols } = options;
  const timestamps = uniqueSortedTimestamps(symbolHistories);
  const { clock, context } = createReplayContext(baseConfig, symbols, strategyMode, timestamps);
  const readers = createWindowReaders(symbolHistories, context.config);
  const markets = context.state.markets;
  let scanCycle = 0;
  let processedSnapshots = 0;
  let buyReadyCount = 0;
  let waitCount = 0;
  let incompleteCount = 0;

  for (const [timestampIndex, timestamp] of timestamps.entries()) {
    clock.index = timestampIndex;
    context.runtime.setCurrentScanCycle(scanCycle);
    context.state.lastUpdate = new Date(timestamp).toISOString();
    context.state.runtime.scanCycle = scanCycle;
    context.state.runtime.lastCompletedCycleAt = new Date(timestamp).toISOString();

    for (const symbol of symbols) {
      const candleSet = readers.buildWindow(symbol, timestamp);
      context.state.candleData[symbol] = candleSet;
      const snapshot = context.strategy.buildMarketSnapshot(symbol, candleSet);
      markets[symbol] = snapshot;
      processedSnapshots += 1;
      if (snapshot.decisionState === context.strategy.DECISION_STATES.BUY_READY) buyReadyCount += 1;
      if (snapshot.decisionState === context.strategy.DECISION_STATES.WAIT_VOLUME) waitCount += 1;
      if (snapshot.decisionState === context.strategy.DECISION_STATES.INCOMPLETE_SETUP) incompleteCount += 1;
    }

    const btcSnapshot = markets["BTC/USDT"] || null;
    const btcRegime = context.getBtcFilterEnabled() ? context.strategy.getBtcRegime(btcSnapshot) : "risk-on";
    context.state.btcRegime = btcRegime;
    const candidateSymbols = pickCandidateMarkets(Object.values(markets)).map((market) => market.symbol);
    const neutralEligibleSymbols = context.strategy.getNeutralEligibleSymbols(btcRegime, candidateSymbols);

    let positionClosedThisCycle = false;
    const symbolsToClose = [];
    for (const position of context.state.positions) {
      const positionMarket = markets[position.symbol];
      if (!positionMarket) {
        continue;
      }

      const management = context.runtime.manageOpenPosition(positionMarket);
      if (management.shouldPartialExit) {
        context.runtime.executePartialExit(positionMarket);
        context.runtime.refreshPositionSnapshot(positionMarket, { exitReasonCode: null, shouldExit: false, shouldPartialExit: false });
      } else {
        context.runtime.refreshPositionSnapshot(positionMarket, management);
      }

      if (management.shouldExit && management.exitReasonCode) {
        symbolsToClose.push({ exitReasonCode: management.exitReasonCode, market: positionMarket });
      } else if (!management.shouldPartialExit && positionMarket.action === "BUY") {
        const neutralBlocked = context.getBtcFilterEnabled() && btcRegime === "neutral" && !neutralEligibleSymbols.has(positionMarket.symbol);
        if (!(context.getBtcFilterEnabled() && btcRegime === "risk-off") && !neutralBlocked) {
          const previousEntryCount = position.entryCount;
          context.runtime.openPaperPosition(positionMarket);
          const updatedPosition = context.state.positions.find((activePosition) => activePosition.symbol === position.symbol);
          if (updatedPosition && updatedPosition.entryCount !== previousEntryCount) {
            context.runtime.refreshPositionSnapshot(positionMarket, { exitReasonCode: null, shouldExit: false, shouldPartialExit: false });
          }
        }
      }
    }

    for (const { market, exitReasonCode } of symbolsToClose) {
      context.runtime.closePaperPosition(market, exitReasonCode);
      positionClosedThisCycle = true;
    }

    const tradableBuyCandidate = pickCandidateMarkets(Object.values(markets))
      .find((market) => !(context.getBtcFilterEnabled() && btcRegime === "neutral" && !neutralEligibleSymbols.has(market.symbol)));

    context.state.bestCandidateSymbol = tradableBuyCandidate
      ? tradableBuyCandidate.symbol
      : context.strategy.pickBestCandidateSymbol(Object.values(markets));

    if (context.state.positions.length < context.config.MAX_CONCURRENT_POSITIONS && !positionClosedThisCycle && context.state.bestCandidateSymbol) {
      const bestMarket = markets[context.state.bestCandidateSymbol];
      if (bestMarket && bestMarket.action === "BUY") {
        const neutralBlocked = context.getBtcFilterEnabled() && btcRegime === "neutral" && !neutralEligibleSymbols.has(bestMarket.symbol);
        if (!(context.getBtcFilterEnabled() && btcRegime === "risk-off") && !neutralBlocked) {
          const countBefore = context.state.positions.length;
          context.runtime.openPaperPosition(bestMarket);
          const newPosition = context.state.positions.find((position) => position.symbol === bestMarket.symbol);
          if (newPosition && context.state.positions.length > countBefore) {
            context.runtime.refreshPositionSnapshot(bestMarket, { exitReasonCode: null, shouldExit: false, shouldPartialExit: false });
          }
        }
      }
    }

    scanCycle += 1;
  }

  if (timestamps.length > 0) {
    clock.index = timestamps.length - 1;
    for (const position of [...context.state.positions]) {
      const snapshot = context.state.markets[position.symbol];
      if (snapshot) {
        context.runtime.closePaperPosition(snapshot, context.strategy.EXIT_REASON_CODES.BACKTEST_END);
      }
    }
  }

  const stats = context.serverApi.getSessionStats();
  const portfolioValue = context.serverApi.getPortfolioValue();
  const symbolBreakdown = buildSymbolBreakdown(context.state.trades);
  const rounds = summarizeRounds(context.state.trades)
    .sort((left, right) => new Date(right.startTime || 0) - new Date(left.startTime || 0));
  const initialBalance = context.config.INITIAL_USDT_BALANCE;

  return {
    generatedAt: new Date().toISOString(),
    portfolioValue,
    processedSnapshots,
    recommendationScore: scoreMode(stats, portfolioValue, initialBalance),
    scanCycles: scanCycle,
    stats: {
      averageClosedTradePnl: stats.averageClosedTradePnl,
      averageHoldMinutes: stats.averageHoldMinutes,
      avgLoserUsdt: stats.avgLoserUsdt,
      avgWinnerUsdt: stats.avgWinnerUsdt,
      expectancyUsdt: stats.expectancyUsdt,
      maxDrawdownPct: stats.maxDrawdownPct,
      maxDrawdownUsdt: stats.maxDrawdownUsdt,
      profitFactor: stats.profitFactor,
      totalClosedRounds: stats.totalClosedRounds,
      totalFeesPaid: stats.totalFeesPaid,
      totalSlippagePaid: stats.totalSlippagePaid,
      turnoverUsdt: stats.turnoverUsdt,
      winRatePct: stats.winRatePct
    },
    strategyMode,
    summary: {
      buyReadyCount,
      completedRounds: stats.totalClosedRounds,
      incompleteCount,
      pnlPct: initialBalance > 0 ? ((portfolioValue - initialBalance) / initialBalance) * 100 : 0,
      sessionPnl: portfolioValue - initialBalance,
      waitCount
    },
    rounds,
    strategyProfile: context.state.aggressiveModeEnabled ? "aggressive" : "normal",
    symbolBreakdown,
    symbols: [...symbols],
    timeline: {
      end: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
      points: timestamps.length,
      start: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null
    }
  };
}

function compareStrategyModes(options) {
  const { baseConfig, symbolHistories } = options;
  const symbols = Object.keys(symbolHistories || {}).sort();
  const modes = (options.strategyModes || SUPPORTED_STRATEGY_MODES).filter((mode) => SUPPORTED_STRATEGY_MODES.includes(mode));
  const modeReports = modes.map((strategyMode) => replayStrategyMode({
    baseConfig,
    strategyMode,
    symbolHistories,
    symbols
  }));

  const sortedReports = [...modeReports].sort((left, right) => {
    if (right.recommendationScore !== left.recommendationScore) {
      return right.recommendationScore - left.recommendationScore;
    }
    return (right.summary.sessionPnl || 0) - (left.summary.sessionPnl || 0);
  });
  const recommended = sortedReports[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    heuristics: {
      description: "Score composito: pnl, expectancy, profit factor, win rate e drawdown.",
      recommendedModeScore: recommended?.recommendationScore ?? null
    },
    recommendedMode: recommended?.strategyMode || null,
    strategyProfile: baseConfig.AGGRESSIVE_MODE_ENABLED === true ? "aggressive" : "normal",
    symbolCount: symbols.length,
    symbols,
    timeframe: "1h/5m/1m replay",
    timeline: recommended?.timeline || {
      end: null,
      points: 0,
      start: null
    },
    modes: sortedReports
  };
}

module.exports = {
  compareStrategyModes,
  replayStrategyMode,
  SUPPORTED_STRATEGY_MODES
};
