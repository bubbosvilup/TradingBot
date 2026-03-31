"use strict";

const path = require("path");
const ccxt = require("ccxt");

const { compareStrategyModes } = require("./backtest");
const { createRuntime } = require("./runtime");

function parseSymbols(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return [];
  }

  const normalizedValue = rawValue.trim().replace(/^['"]|['"]$/g, "");
  if (!normalizedValue) {
    return [];
  }

  return [...new Set(
    normalizedValue
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean)
  )];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFetchLimits(config) {
  const days = Math.max(Number(config.BACKTEST_DAYS || 3), 1);
  return {
    candles_1h: Math.max(Number(config.FETCH_LIMIT_1H || 140), Math.ceil(days * 24) + 60),
    candles_1m: Math.max(Number(config.FETCH_LIMIT_1M || 160), Math.ceil(days * 24 * 60) + 180),
    candles_5m: Math.max(Number(config.FETCH_LIMIT_5M || 220), Math.ceil(days * 24 * 12) + 80)
  };
}

function normalizeBacktestRequest(baseConfig, request = {}) {
  const customSymbols = Array.isArray(request.customSymbols)
    ? request.customSymbols.filter(Boolean)
    : parseSymbols(request.symbols);

  return {
    aggressiveMode: typeof request.aggressiveMode === "boolean"
      ? request.aggressiveMode
      : (baseConfig.AGGRESSIVE_MODE_ENABLED ?? false),
    btcFilterEnabled: typeof request.btcFilterEnabled === "boolean"
      ? request.btcFilterEnabled
      : (baseConfig.BACKTEST_BTC_FILTER_ENABLED ?? true),
    customSymbols,
    days: Math.max(Number(request.days ?? baseConfig.BACKTEST_DAYS ?? 3), 1),
    fetchBatchSize: Math.max(Number(request.fetchBatchSize ?? baseConfig.BACKTEST_FETCH_BATCH_SIZE ?? 2), 1),
    fetchDelayMs: Math.max(Number(request.fetchDelayMs ?? baseConfig.BACKTEST_FETCH_DELAY_MS ?? 800), 0),
    symbolLimit: Math.max(Number(request.symbolLimit ?? baseConfig.BACKTEST_SYMBOL_LIMIT ?? 6), 1),
    useActiveWatchlist: typeof request.useActiveWatchlist === "boolean" ? request.useActiveWatchlist : true,
    useHotPool: typeof request.useHotPool === "boolean" ? request.useHotPool : true
  };
}

function buildBacktestConfig(baseConfig, normalizedRequest) {
  return {
    ...baseConfig,
    AGGRESSIVE_MODE_ENABLED: normalizedRequest.aggressiveMode,
    BACKTEST_BTC_FILTER_ENABLED: normalizedRequest.btcFilterEnabled,
    BACKTEST_DAYS: normalizedRequest.days,
    BACKTEST_FETCH_BATCH_SIZE: normalizedRequest.fetchBatchSize,
    BACKTEST_FETCH_DELAY_MS: normalizedRequest.fetchDelayMs,
    BACKTEST_REPORT_FILE: baseConfig.BACKTEST_REPORT_FILE || path.join(process.cwd(), "backtest-report.json"),
    BACKTEST_SYMBOL_LIMIT: normalizedRequest.symbolLimit,
    POLL_INTERVAL_MS: 0,
    STRATEGY_MODE: "adaptive",
    USE_CCXT_PRO_WS: false
  };
}

async function resolveSymbols(exchange, config, options = {}) {
  const explicitSymbols = Array.isArray(options.customSymbols) ? options.customSymbols.filter(Boolean) : [];
  if (explicitSymbols.length > 0) {
    return {
      source: "custom_symbols",
      symbols: explicitSymbols.slice(0, config.BACKTEST_SYMBOL_LIMIT)
    };
  }

  if (options.useActiveWatchlist && Array.isArray(options.activeSymbols) && options.activeSymbols.length > 0) {
    return {
      source: "active_watchlist",
      symbols: [...new Set(options.activeSymbols)].slice(0, config.BACKTEST_SYMBOL_LIMIT)
    };
  }

  if (options.useHotPool && Array.isArray(options.hotPool) && options.hotPool.length > 0) {
    return {
      source: "hot_pool",
      symbols: [...new Set(options.hotPool)].slice(0, config.BACKTEST_SYMBOL_LIMIT)
    };
  }

  const runtime = createRuntime({
    config,
    logScoped: () => {},
    state: { positions: [], watchlist: { recentSwaps: [] } },
    withTimeout: async (value) => value
  });
  const topSymbols = await runtime.fetchTopSymbols(exchange);
  return {
    source: "dynamic_hot",
    symbols: topSymbols.slice(0, config.BACKTEST_SYMBOL_LIMIT)
  };
}

async function fetchSymbolHistories(exchange, symbols, config, progress = () => {}) {
  const limits = buildFetchLimits(config);
  const histories = {};

  for (let index = 0; index < symbols.length; index += config.BACKTEST_FETCH_BATCH_SIZE) {
    const batch = symbols.slice(index, index + config.BACKTEST_FETCH_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (symbol) => {
      const [candles_1h, candles_5m, candles_1m] = await Promise.all([
        exchange.fetchOHLCV(symbol, "1h", undefined, limits.candles_1h),
        exchange.fetchOHLCV(symbol, "5m", undefined, limits.candles_5m),
        exchange.fetchOHLCV(symbol, "1m", undefined, limits.candles_1m)
      ]);

      return {
        candles_1h,
        candles_1m,
        candles_5m,
        symbol
      };
    }));

    for (const result of batchResults) {
      histories[result.symbol] = {
        candles_1h: result.candles_1h,
        candles_1m: result.candles_1m,
        candles_5m: result.candles_5m
      };
      progress({
        message: `Storico scaricato per ${result.symbol} (${Object.keys(histories).length}/${symbols.length}).`,
        progressPct: 20 + Math.round((Object.keys(histories).length / Math.max(symbols.length, 1)) * 50),
        stage: "fetching_history",
        symbol: result.symbol
      });
    }

    if (index + config.BACKTEST_FETCH_BATCH_SIZE < symbols.length && config.BACKTEST_FETCH_DELAY_MS > 0) {
      await sleep(config.BACKTEST_FETCH_DELAY_MS);
    }
  }

  return histories;
}

function printBacktestReport(report) {
  console.log("");
  console.log(`Backtest generated: ${report.generatedAt}`);
  console.log(`Strategy profile: ${report.strategyProfile || "normal"}`);
  console.log(`Symbols: ${report.symbols.join(", ")}`);
  console.log(`Recommended mode: ${report.recommendedMode}`);
  for (const mode of report.modes) {
    console.log(
      [
        `${mode.strategyMode}:`,
        `pnl=${mode.summary.sessionPnl.toFixed(2)} USDT`,
        `pnl_pct=${mode.summary.pnlPct.toFixed(2)}%`,
        `win_rate=${mode.stats.winRatePct.toFixed(2)}%`,
        `pf=${mode.stats.profitFactor.toFixed(2)}`,
        `drawdown=${mode.stats.maxDrawdownPct.toFixed(2)}%`,
        `rounds=${mode.stats.totalClosedRounds}`,
        `score=${mode.recommendationScore.toFixed(2)}`
      ].join(" | ")
    );
  }
}

async function runBacktestJob(options) {
  const {
    activeSymbols = [],
    baseConfig,
    hotPool = [],
    log = () => {},
    onProgress = () => {},
    request = {}
  } = options || {};

  const normalizedRequest = normalizeBacktestRequest(baseConfig, request);
  const config = buildBacktestConfig(baseConfig, normalizedRequest);
  const exchangeClass = ccxt[config.EXCHANGE_ID];
  if (!exchangeClass) {
    throw new Error(`Unsupported exchange: ${config.EXCHANGE_ID}`);
  }

  const exchange = new exchangeClass({
    enableRateLimit: true,
    options: {
      defaultType: "spot"
    }
  });

  const reportStartedAt = new Date().toISOString();
  const reportProgress = (payload) => {
    if (payload?.message) {
      log(payload.message);
    }
    onProgress(payload);
  };

  try {
    reportProgress({
      message: "Connessione exchange: caricamento mercati.",
      progressPct: 5,
      stage: "loading_markets"
    });
    await exchange.loadMarkets();

    reportProgress({
      message: "Selezione simboli per la ricerca.",
      progressPct: 12,
      stage: "resolving_symbols"
    });
    const resolved = await resolveSymbols(exchange, config, {
      activeSymbols,
      customSymbols: normalizedRequest.customSymbols,
      hotPool,
      useActiveWatchlist: normalizedRequest.useActiveWatchlist,
      useHotPool: normalizedRequest.useHotPool
    });

    let symbols = resolved.symbols;
    if (config.BACKTEST_BTC_FILTER_ENABLED && !symbols.includes("BTC/USDT")) {
      symbols = ["BTC/USDT", ...symbols].slice(0, Math.max(config.BACKTEST_SYMBOL_LIMIT, 2));
    }
    if (symbols.length === 0) {
      throw new Error("No symbols available for backtest.");
    }

    reportProgress({
      message: `Ricerca pronta su ${symbols.length} simboli (${resolved.source}).`,
      progressPct: 18,
      stage: "resolving_symbols",
      symbols
    });

    const symbolHistories = await fetchSymbolHistories(exchange, symbols, config, reportProgress);

    reportProgress({
      message: "Replay delle strategie sui dati storici.",
      progressPct: 80,
      stage: "replaying"
    });
    const report = compareStrategyModes({
      baseConfig: config,
      symbolHistories
    });

    report.generatedAt = new Date().toISOString();
    report.request = {
      activeSymbolsCount: activeSymbols.length,
      aggressiveMode: normalizedRequest.aggressiveMode,
      btcFilterEnabled: normalizedRequest.btcFilterEnabled,
      customSymbols: normalizedRequest.customSymbols,
      days: normalizedRequest.days,
      fetchBatchSize: normalizedRequest.fetchBatchSize,
      fetchDelayMs: normalizedRequest.fetchDelayMs,
      hotPoolCount: hotPool.length,
      requestedAt: reportStartedAt,
      resolvedSource: resolved.source,
      symbolLimit: normalizedRequest.symbolLimit,
      symbols,
      useActiveWatchlist: normalizedRequest.useActiveWatchlist,
      useHotPool: normalizedRequest.useHotPool
    };
    report.strategyProfile = normalizedRequest.aggressiveMode ? "aggressive" : "normal";

    reportProgress({
      message: `Replay completato. Modalita raccomandata: ${report.recommendedMode || "n/a"}.`,
      progressPct: 100,
      stage: "completed"
    });

    return report;
  } finally {
    if (typeof exchange.close === "function") {
      await exchange.close();
    }
  }
}

module.exports = {
  buildBacktestConfig,
  buildFetchLimits,
  normalizeBacktestRequest,
  parseSymbols,
  printBacktestReport,
  runBacktestJob
};
