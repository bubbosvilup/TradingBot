require("dotenv").config();

const path = require("path");
const ccxt = require("ccxt");

const { createPersistence } = require("./src/persistence");
const { createRuntime } = require("./src/runtime");
const { createServerApi } = require("./src/server");
const { createStrategy } = require("./src/strategy");

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

const configuredSymbols = parseSymbols(process.env.SYMBOLS);
const config = {
  ATR_PERIOD: 14,
  ATR_STOP_MULT: Number(process.env.ATR_STOP_MULT || 1.5),
  ATR_TP_MULT: Number(process.env.ATR_TP_MULT || 3.0),
  ATR_TRAIL_MULT: Number(process.env.ATR_TRAIL_MULT || 2.0),
  BATCH_DELAY_MS: Math.max(Number(process.env.BATCH_DELAY_MS || 500), 0),
  BATCH_SIZE: Math.max(Number(process.env.BATCH_SIZE || 5), 1),
  DEFAULT_SYMBOL: (process.env.SYMBOL || "BTC/USDT").trim(),
  DYNAMIC_QUOTE_PRIORITY: new Map([["USDT", 0], ["USDC", 1], ["FDUSD", 2]]),
  EMA20_1H_PERIOD: 20,
  EMA21_5M_PERIOD: 21,
  EMA50_1H_PERIOD: 50,
  EMA9_1M_PERIOD: 9,
  EMA9_5M_PERIOD: 9,
  ENTRY_FEE_BPS: Math.max(Number(process.env.ENTRY_FEE_BPS || process.env.FEE_BPS || 10), 0),
  ENTRY_VOLUME_MULT: Number(process.env.ENTRY_VOLUME_MULT || 0.8),
  EXCHANGE_ID: process.env.EXCHANGE || "binance",
  EXCLUDED_BASE_ASSETS: new Set(["USDC", "BUSD", "TUSD", "FDUSD", "DAI", "USDP", "EUR", "GBP", "WBTC", "WETH", "STETH", "WSTETH", "RETH", "USD1", "U", "NOM", "NIGHT", "STO", "SENT", "ANKR", "BARD", "KITE", "CFG"]),
  FEE_BPS: Math.max(Number(process.env.FEE_BPS || 10), 0),
  FETCH_LIMIT_1H: Math.max(60, Math.min(Math.max(Number(process.env.OHLCV_LIMIT || 100), 100), 200)),
  FETCH_LIMIT_1M: Math.max(20, Math.min(Math.max(Number(process.env.OHLCV_LIMIT || 100), 100), 100)),
  FETCH_LIMIT_5M: Math.max(100, Math.min(Math.max(Number(process.env.OHLCV_LIMIT || 100), 100), 300)),
  FETCH_TIMEOUT_MS: Math.max(Number(process.env.FETCH_TIMEOUT_MS || 15000), 1000),
  HARD_STOP_PCT: Number(process.env.HARD_STOP_PCT || 0.05),
  HAS_STATIC_SYMBOLS: configuredSymbols.length > 0,
  HOT_SYMBOLS_POOL_COUNT: Math.max(
    Number(process.env.HOT_SYMBOLS_POOL_COUNT || process.env.TOP_SYMBOLS_POOL_COUNT || (Math.max(Number(process.env.TOP_SYMBOLS_COUNT || 10), 1) * 3)),
    Math.max(Number(process.env.TOP_SYMBOLS_COUNT || 10), 1)
  ),
  HOT_SYMBOLS_REFRESH_MS: Math.max(Number(process.env.HOT_SYMBOLS_REFRESH_MS || process.env.SYMBOLS_REFRESH_MS || 60000), 10000),
  INITIAL_USDT_BALANCE: Number(process.env.INITIAL_USDT_BALANCE || 100),
  LEVERAGED_TOKEN_REGEX: /\d+[LS]$/i,
  LOG_DEDUPE_WINDOW_MS: 8000,
  LOOP_STALL_WARNING_MS: Math.max(Number(process.env.LOOP_STALL_WARNING_MS || 45000), 5000),
  LOSS_COOLDOWN_CYCLES: Math.max(Number(process.env.LOSS_COOLDOWN_CYCLES || 8), 0),
  MACD_FAST: Number(process.env.MACD_FAST || 12),
  MACD_SIGNAL: Number(process.env.MACD_SIGNAL || 9),
  MACD_SLOW: Number(process.env.MACD_SLOW || 26),
  MAX_CONCURRENT_POSITIONS: Number(process.env.MAX_CONCURRENT_POSITIONS || 3),
  MAX_POSITION_EXPOSURE_PCT: 0.85,
  MIN_HOLD_CANDLES: Number(process.env.MIN_HOLD_CANDLES || 5),
  MIN_HOLD_SECONDS: Math.max(Number(process.env.MIN_HOLD_SECONDS || 180), 0),
  MIN_EXPECTED_NET_EDGE_BPS: Math.max(Number(process.env.MIN_EXPECTED_NET_EDGE_BPS || 25), 0),
  MIN_POSITION_NOTIONAL_USDT: Math.max(Number(process.env.MIN_POSITION_NOTIONAL_USDT || 10), 1),
  MIN_RISK_REWARD_RATIO: Math.max(Number(process.env.MIN_RISK_REWARD_RATIO || 1.8), 0),
  MIN_SCORE_ENTRY: Number(process.env.MIN_SCORE_ENTRY || 6),
  NEUTRAL_TOP_N: Math.max(Number(process.env.NEUTRAL_TOP_N || 10), 1),
  PAPER_TRADING: (process.env.PAPER_TRADING || "true").toLowerCase() === "true",
  PARTIAL_TP_R: Math.max(Number(process.env.PARTIAL_TP_R || 1.5), 0),
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS || 30000),
  POSITION_SIZE_MAX: Number(process.env.POSITION_SIZE_MAX || 0.7),
  POSITION_SIZE_MIN: Number(process.env.POSITION_SIZE_MIN || 0.2),
  PUBLIC_DIR: path.join(__dirname, "public"),
  RECENTLY_DROPPED_TTL_CYCLES: 10,
  RISK_PCT_PER_TRADE: Math.max(Number(process.env.RISK_PCT_PER_TRADE || 0.01), 0),
  RSI_MAX: Number(process.env.RSI_MAX || 62),
  RSI_MIN: Number(process.env.RSI_MIN || 42),
  RSI_PERIOD: Number(process.env.RSI_PERIOD || 14),
  SERVER_HOST: "127.0.0.1",
  SERVER_PORT: Number(process.env.PORT || 3000),
  SLIPPAGE_BPS_BASE: Math.max(Number(process.env.SLIPPAGE_BPS_BASE || 5), 0),
  SFP_ENTRY_MIN_SCORE: Math.max(Number(process.env.SFP_ENTRY_MIN_SCORE || process.env.MIN_SCORE_ENTRY || 7), Number(process.env.MIN_SCORE_ENTRY || 6)),
  SPREAD_MAX_PCT: Math.max(Number(process.env.SPREAD_MAX_PCT || 0.001), 0),
  STATE_FILE: path.join(__dirname, "state.json"),
  STRATEGY_NAME: "mtf-trend-following-1h-5m-1m",
  TIME_STOP_CANDLES: Math.max(Number(process.env.TIME_STOP_CANDLES || 12), 1),
  TOP_SYMBOLS_COUNT: Math.max(Number(process.env.TOP_SYMBOLS_COUNT || 10), 1),
  TARGET_NET_EDGE_BPS_FOR_MAX_SIZE: Math.max(Number(process.env.TARGET_NET_EDGE_BPS_FOR_MAX_SIZE || 120), 1),
  TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE: Math.max(Number(process.env.TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE || 3.0), 1),
  TRADES_LOG_FILE: "trades.log",
  TRAILING_PCT: Number(process.env.TRAILING_PCT || 0.007),
  TREND_ENTRY_MIN_SCORE: Math.max(Number(process.env.TREND_ENTRY_MIN_SCORE || process.env.MIN_SCORE_ENTRY || 7), Number(process.env.MIN_SCORE_ENTRY || 6)),
  TREND_SLOPE_MIN: Number(process.env.TREND_SLOPE_MIN || 0.001),
  USE_CCXT_PRO_WS: (process.env.USE_CCXT_PRO_WS || "false").toLowerCase() === "true",
  VOLUME_MULT: Number(process.env.VOLUME_MULT || 1.15),
  VOLUME_SMA_PERIOD: 20,
  WEAK_SYMBOL_ROTATION_MS: Math.max(Number(process.env.WEAK_SYMBOL_ROTATION_MS || 10000), 5000),
  WEAK_SYMBOL_RSI_MAX: Number(process.env.WEAK_SYMBOL_RSI_MAX || 45),
  EXIT_FEE_BPS: Math.max(Number(process.env.EXIT_FEE_BPS || process.env.FEE_BPS || 10), 0),
  MIN_TAKE_PROFIT_BPS: Math.max(Number(process.env.MIN_TAKE_PROFIT_BPS || ((Number(process.env.MIN_EXPECTED_NET_EDGE_BPS || 25)) + (Number(process.env.ENTRY_FEE_BPS || process.env.FEE_BPS || 10)) + (Number(process.env.EXIT_FEE_BPS || process.env.FEE_BPS || 10)))), 1),
  WS_BACKOFF_BASE_MS: Math.max(Number(process.env.WS_BACKOFF_BASE_MS || 1000), 250),
  WS_BACKOFF_MAX_MS: Math.max(Number(process.env.WS_BACKOFF_MAX_MS || 15000), Math.max(Number(process.env.WS_BACKOFF_BASE_MS || 1000), 250)),
  WS_FAILURE_THRESHOLD: Math.max(Number(process.env.WS_FAILURE_THRESHOLD || 6), 1),
  WS_FAILURE_WINDOW_MS: Math.max(Number(process.env.WS_FAILURE_WINDOW_MS || 20000), 1000),
  WS_GLOBAL_COOLDOWN_MS: Math.max(Number(process.env.WS_GLOBAL_COOLDOWN_MS || 120000), 1000),
  WS_REALTIME_TIMEFRAMES: new Set(["5m", "1m"]),
  WS_WATCH_TIMEOUT_MS: Math.max(Number(process.env.WS_WATCH_TIMEOUT_MS || 45000), Math.max(Number(process.env.FETCH_TIMEOUT_MS || 15000), 1000))
};

let SYMBOLS = config.HAS_STATIC_SYMBOLS ? [...configuredSymbols] : [];
let SYMBOLS_SOURCE = config.HAS_STATIC_SYMBOLS ? "SYMBOLS" : "dynamic";
let btcFilterEnabled = (process.env.BTC_FILTER_ENABLED || "true").toLowerCase() === "true";
let lastConsoleLogAt = 0;
let lastConsoleLogMessage = "";

const state = {
  bestCandidateSymbol: null,
  botActive: false,
  botStartedAt: null,
  btcRegime: "risk-on",
  candleData: {},
  exchange: config.EXCHANGE_ID,
  lastUpdate: null,
  markets: {},
  paperTrading: config.PAPER_TRADING,
  positions: [],
  runtime: {
    lastCompletedCycleAt: null,
    lastCycleDurationMs: null,
    realtimeSymbols: [],
    restSymbolCount: 0,
    scanCycle: 0
  },
  strategyName: config.STRATEGY_NAME,
  trades: [],
  usdtBalance: config.INITIAL_USDT_BALANCE,
  watchlist: {
    activeSymbols: [],
    hotPool: [],
    lastPoolRefreshAt: null,
    lastRotationAt: null,
    lastRotationSummary: null,
    recentSwaps: [],
    source: SYMBOLS_SOURCE,
    weakThresholdRsi: config.WEAK_SYMBOL_RSI_MAX
  }
};

function log(message, options = {}) {
  const { dedupe = true } = options;
  const now = Date.now();
  if (dedupe && message === lastConsoleLogMessage && now - lastConsoleLogAt < config.LOG_DEDUPE_WINDOW_MS) {
    return;
  }

  lastConsoleLogMessage = message;
  lastConsoleLogAt = now;
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logScoped(scope, message, options = {}) {
  log(`${scope} | ${message}`, options);
}

function formatAmount(value) {
  return Number(value).toFixed(8);
}

function formatLogNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return Number(value).toFixed(decimals);
}

function withTimeout(promise, label, timeoutMs = config.FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

const context = {
  config,
  formatAmount,
  formatLogNumber,
  getBtcFilterEnabled: () => btcFilterEnabled,
  getSymbols: () => SYMBOLS,
  logScoped,
  setBtcFilterEnabled: (value) => {
    btcFilterEnabled = value;
  },
  state,
  withTimeout
};

context.strategy = createStrategy(context);
context.persistence = createPersistence(context);
context.serverApi = createServerApi(context);
context.runtime = createRuntime(context);
context.onReset = context.runtime.resetTransientState;

function getBlockerPreview(market, limit = 2) {
  if (!market || !Array.isArray(market.entryBlockers) || market.entryBlockers.length === 0) {
    return "none";
  }
  return market.entryBlockers.slice(0, limit).join(" | ");
}

function summarizeMarketForLog(market) {
  if (!market) {
    return "symbol=n/a | action=n/a | score=n/a | price=n/a";
  }

  return [
    `symbol=${market.symbol}`,
    `action=${market.displayAction || market.action || "HOLD"}`,
    `score=${market.compositeScore ?? "n/a"}`,
    `trend=${market.trendBull_1h === true ? "bull" : market.trendBull_1h === false ? "bear" : "n/a"}`,
    `price=${formatLogNumber(market.lastPrice, 6)}`,
    `reason=${market.reason || "n/a"}`,
    `blockers=${getBlockerPreview(market)}`
  ].join(" | ");
}

function logCycleSummary(scanCycle, realtimeSymbols) {
  const markets = Object.values(state.markets).filter(Boolean);
  const readyMarkets = markets.filter((market) => !market.warmingUp);
  const bullishMarkets = readyMarkets.filter((market) => market.trendBull_1h === true);
  const buyCandidates = markets.filter((market) => market.signal === "BUY candidate").sort((left, right) => (right.compositeScore || 0) - (left.compositeScore || 0));
  const executableBuys = markets.filter((market) => market.action === "BUY");
  const focusMarket = context.serverApi.selectFocusMarket();
  const bestMarket = state.bestCandidateSymbol ? state.markets[state.bestCandidateSymbol] : null;
  const positionLabel = state.positions.length > 0
    ? state.positions.map((position) => {
        const pnl = position.lastPrice ? ((position.btcAmount * position.lastPrice) - position.usdtAllocated) : 0;
        const pnlPct = position.usdtAllocated > 0 ? (pnl / position.usdtAllocated) * 100 : 0;
        return `${position.symbol}:${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
      }).join(", ")
    : "none";

  logScoped("SCAN", `cycle=${scanCycle} | watch=${SYMBOLS.length} | ready=${readyMarkets.length} | bull=${bullishMarkets.length} | btc=${state.btcRegime} | ws=${realtimeSymbols.size} | buy_candidates=${buyCandidates.length} | executable=${executableBuys.length} | positions=${positionLabel}`);

  for (const position of state.positions) {
    const market = state.markets[position.symbol];
    if (market) logScoped("POSITION", summarizeMarketForLog(market));
  }
  if (focusMarket && !state.positions.some((position) => position.symbol === focusMarket.symbol)) {
    logScoped("FOCUS", summarizeMarketForLog(focusMarket));
  }
  if (bestMarket && !state.positions.some((position) => position.symbol === bestMarket.symbol) && (!focusMarket || bestMarket.symbol !== focusMarket.symbol)) {
    logScoped("CANDIDATE", summarizeMarketForLog(bestMarket));
  }
}

async function main() {
  if (!config.PAPER_TRADING) {
    throw new Error("Process blocked: PAPER_TRADING=false. Real trading is not allowed.");
  }

  const ExchangeClass = ccxt[config.EXCHANGE_ID];
  if (!ExchangeClass) {
    throw new Error(`Unsupported exchange: ${config.EXCHANGE_ID}`);
  }

  const exchange = new ExchangeClass({ enableRateLimit: true });
  const ProExchangeClass = config.USE_CCXT_PRO_WS && ccxt.pro ? ccxt.pro[config.EXCHANGE_ID] : null;
  const streamExchange = ProExchangeClass ? new ProExchangeClass({ enableRateLimit: true }) : null;
  if (config.USE_CCXT_PRO_WS && !streamExchange) {
    logScoped("WS", `unavailable | exchange=${config.EXCHANGE_ID} | mode=REST_only`);
  }

  state.botActive = true;
  state.botStartedAt = new Date().toISOString();
  context.persistence.loadStateFromDisk();
  if (state.positions.length > 0) {
    logScoped("SESSION", `restored | positions=${state.positions.length} | usdt=${formatLogNumber(state.usdtBalance, 2)} | trades=${state.trades.length}`);
  }

  context.serverApi.startServer();

  let scanCycle = 0;
  let allCandidates = [];
  let lastCompletedCycleAt = Date.now();
  let lastHotPoolRefreshAt = Date.now();
  let lastWeakRotationAt = Date.now();
  let lastRealtimeSymbolsLabel = "";
  let lastWatchdogLogAt = 0;

  setInterval(() => {
    if (!state.botActive) return;
    const stalledForMs = Date.now() - lastCompletedCycleAt;
    if (stalledForMs >= config.LOOP_STALL_WARNING_MS && Date.now() - lastWatchdogLogAt >= config.LOOP_STALL_WARNING_MS) {
      lastWatchdogLogAt = Date.now();
      logScoped("WATCHDOG", `loop_stalled | stalled_for=${stalledForMs}ms | symbols=${SYMBOLS.length} | source=${SYMBOLS_SOURCE}`);
    }
  }, Math.min(config.LOOP_STALL_WARNING_MS, 10000));

  if (config.HAS_STATIC_SYMBOLS) {
    SYMBOLS = [...configuredSymbols];
    for (const position of state.positions) {
      if (!SYMBOLS.includes(position.symbol)) SYMBOLS = [position.symbol, ...SYMBOLS];
    }
    state.watchlist.activeSymbols = [...SYMBOLS];
    state.watchlist.hotPool = [...SYMBOLS];
    state.watchlist.lastPoolRefreshAt = new Date().toISOString();
    state.watchlist.source = SYMBOLS_SOURCE;
    logScoped("WATCHLIST", `loaded | count=${SYMBOLS.length} | source=${SYMBOLS_SOURCE}`);
    logScoped("WATCHLIST", `symbols | ${SYMBOLS.join(", ")}`);
  } else {
    const discoveredSymbols = await context.runtime.fetchTopSymbols(exchange);
    allCandidates = context.runtime.normalizeDynamicSymbols(discoveredSymbols, { includeBtc: btcFilterEnabled, maxCount: config.HOT_SYMBOLS_POOL_COUNT });
    SYMBOLS = allCandidates.length > 0
      ? context.runtime.normalizeDynamicSymbols(allCandidates, { includeBtc: btcFilterEnabled, maxCount: config.TOP_SYMBOLS_COUNT })
      : context.runtime.normalizeDynamicSymbols([config.DEFAULT_SYMBOL], { includeBtc: btcFilterEnabled, maxCount: config.TOP_SYMBOLS_COUNT });
    SYMBOLS_SOURCE = allCandidates.length > 0 ? "dynamic" : "fallback";
    state.watchlist.activeSymbols = [...SYMBOLS];
    state.watchlist.hotPool = [...allCandidates];
    state.watchlist.lastPoolRefreshAt = new Date().toISOString();
    state.watchlist.source = SYMBOLS_SOURCE;
    logScoped("WATCHLIST", `pool_loaded | count=${allCandidates.length}`);
    logScoped("WATCHLIST", `dynamic_loaded | count=${SYMBOLS.length}`);
    logScoped("WATCHLIST", `symbols | ${SYMBOLS.join(", ")}`);
  }

  const initialRealtimeSymbols = [...context.runtime.selectRealtimeSymbols(SYMBOLS)];
  lastRealtimeSymbolsLabel = initialRealtimeSymbols.join(",");
  logScoped("BOOT", `started | exchange=${config.EXCHANGE_ID} | symbols=${SYMBOLS.length} | source=${SYMBOLS_SOURCE} | paper=${config.PAPER_TRADING} | interval=${config.POLL_INTERVAL_MS}ms | market_data=${streamExchange ? "hybrid_WS+REST" : "REST_only"} | ws_symbols=${initialRealtimeSymbols.length > 0 ? initialRealtimeSymbols.join(",") : "none"}`);

  while (true) {
    const cycleStartedAt = Date.now();
    try {
      context.runtime.setCurrentScanCycle(scanCycle);
      context.runtime.pruneExpiringState();

      if (!config.HAS_STATIC_SYMBOLS && scanCycle > 0 && Date.now() - lastHotPoolRefreshAt >= config.HOT_SYMBOLS_REFRESH_MS) {
        lastHotPoolRefreshAt = Date.now();
        const refreshedSymbols = await context.runtime.fetchTopSymbols(exchange);
        if (refreshedSymbols.length > 0) {
          const previousCandidates = [...allCandidates];
          allCandidates = context.runtime.normalizeDynamicSymbols(refreshedSymbols, { includeBtc: btcFilterEnabled, maxCount: config.HOT_SYMBOLS_POOL_COUNT });
          const candidatesChanged = previousCandidates.join(",") !== allCandidates.join(",");
          state.watchlist.hotPool = [...allCandidates];
          state.watchlist.lastPoolRefreshAt = new Date().toISOString();
          logScoped("WATCHLIST", `pool_refresh | cycle=${scanCycle} | every_ms=${config.HOT_SYMBOLS_REFRESH_MS} | candidates=${allCandidates.length} | changed=${candidatesChanged ? "yes" : "no"}`);
          if (candidatesChanged) logScoped("WATCHLIST", `candidates | ${allCandidates.join(", ")}`);
        }
      }

      const realtimeSymbols = context.runtime.selectRealtimeSymbols(SYMBOLS);
      const realtimeSymbolsLabel = [...realtimeSymbols].join(",");
      if (realtimeSymbolsLabel !== lastRealtimeSymbolsLabel) {
        lastRealtimeSymbolsLabel = realtimeSymbolsLabel;
        logScoped("WS", `symbols_update | ws_symbols=${realtimeSymbolsLabel || "none"} | rest_symbols=${Math.max(0, SYMBOLS.length - realtimeSymbols.size)}`);
      }
      state.runtime.realtimeSymbols = [...realtimeSymbols];
      state.runtime.restSymbolCount = Math.max(0, SYMBOLS.length - realtimeSymbols.size);

      const candleResults = await context.runtime.fetchCandlesBatched(exchange, streamExchange, SYMBOLS, realtimeSymbols);
      state.candleData = {};
      const nextMarkets = {};
      for (const result of candleResults) {
        state.candleData[result.symbol] = result.candleSet;
        nextMarkets[result.symbol] = context.strategy.buildMarketSnapshot(result.symbol, result.candleSet);
      }

      state.markets = nextMarkets;
      state.lastUpdate = new Date().toISOString();
      const btcRegime = context.strategy.getBtcRegime(state.markets["BTC/USDT"]);
      const openSymbols = new Set(state.positions.map((position) => position.symbol));
      const candidateUniverse = config.HAS_STATIC_SYMBOLS ? SYMBOLS.filter((symbol) => !openSymbols.has(symbol)) : allCandidates.length > 0 ? allCandidates : SYMBOLS;
      const neutralEligibleSymbols = context.strategy.getNeutralEligibleSymbols(btcRegime, candidateUniverse);
      state.btcRegime = btcRegime;

      if (btcFilterEnabled && btcRegime !== "risk-on") {
        for (const market of Object.values(state.markets)) {
          if (!market || market.positionOpen || market.action !== "BUY") continue;
          const neutralBlocked = btcRegime === "neutral" && !neutralEligibleSymbols.has(market.symbol);
          if (btcRegime === "neutral" && !neutralBlocked) continue;

          market.action = "HOLD";
          market.signal = "HOLD";
          market.displayAction = "HOLD";
          market.decisionState = context.strategy.DECISION_STATES.NO_SIGNAL;
          market.reason = btcRegime === "risk-off"
            ? `Filtro BTC attivo: regime BTC ${btcRegime}, nuovi ingressi sospesi anche con score ${market.compositeScore}/10.`
            : `Filtro BTC attivo: regime BTC ${btcRegime}, ${market.symbol} fuori dalla top ${config.NEUTRAL_TOP_N} osservabile in questa fase.`;
          market.entryBlockers = [...new Set([...(market.entryBlockers || []), btcRegime === "risk-off" ? "Filtro BTC: regime 1h risk-off" : `Filtro BTC: solo top ${config.NEUTRAL_TOP_N} simboli ammessi in regime neutral`])];
          const explanation = context.strategy.buildDecisionExplanation({ ...market, positionOpen: false });
          market.shortExplanation = explanation.shortExplanation;
          market.detailedExplanation = explanation.detailedExplanation;
          market.reasonList = explanation.reasonList;
        }
      }

      let positionClosedThisCycle = false;
      const symbolsToClose = [];
      for (const position of state.positions) {
        const positionMarket = state.markets[position.symbol];
        if (!positionMarket) continue;

        const management = context.runtime.manageOpenPosition(positionMarket);
        if (management.shouldPartialExit) {
          context.runtime.executePartialExit(positionMarket);
          context.runtime.refreshPositionSnapshot(positionMarket, { exitReasonCode: null, shouldExit: false });
        } else {
          context.runtime.refreshPositionSnapshot(positionMarket, management);
        }

        if (management.shouldExit && management.exitReasonCode) {
          symbolsToClose.push({ exitReasonCode: management.exitReasonCode, market: positionMarket });
        } else if (!management.shouldPartialExit && positionMarket.action === "BUY" && positionMarket.compositeScore >= config.MIN_SCORE_ENTRY) {
          const neutralBlocked = btcFilterEnabled && btcRegime === "neutral" && !neutralEligibleSymbols.has(positionMarket.symbol);
          if (btcFilterEnabled && btcRegime === "risk-off") {
            logScoped("GUARD", `btc_regime_risk_off | scaling_blocked | symbol=${position.symbol}`);
          } else if (neutralBlocked) {
            logScoped("GUARD", `btc_regime_neutral | scaling_blocked | symbol=${position.symbol} | top_limit=${config.NEUTRAL_TOP_N}`);
          } else {
            const previousEntryCount = position.entryCount;
            context.runtime.openPaperPosition(positionMarket);
            const updatedPosition = state.positions.find((activePosition) => activePosition.symbol === position.symbol);
            if (updatedPosition && updatedPosition.entryCount !== previousEntryCount) {
              context.runtime.refreshPositionSnapshot(positionMarket, { exitReasonCode: null, shouldExit: false });
            }
          }
        }
      }

      for (const { market, exitReasonCode } of symbolsToClose) {
        context.runtime.closePaperPosition(market, exitReasonCode);
        positionClosedThisCycle = true;
      }

      const tradableBuyCandidate = Object.values(state.markets)
        .filter((market) => market.signal === "BUY candidate")
        .sort((left, right) => right.compositeScore !== left.compositeScore ? right.compositeScore - left.compositeScore : Number(right.triggerFired) - Number(left.triggerFired))
        .find((market) => !(btcFilterEnabled && btcRegime === "neutral" && !neutralEligibleSymbols.has(market.symbol)));

      state.bestCandidateSymbol = tradableBuyCandidate ? tradableBuyCandidate.symbol : context.strategy.pickBestCandidateSymbol(Object.values(state.markets));

      if (state.positions.length < config.MAX_CONCURRENT_POSITIONS && !positionClosedThisCycle && state.bestCandidateSymbol) {
        const bestMarket = state.markets[state.bestCandidateSymbol];
        if (bestMarket && bestMarket.action === "BUY" && bestMarket.compositeScore >= config.MIN_SCORE_ENTRY) {
          const neutralBlocked = btcFilterEnabled && btcRegime === "neutral" && !neutralEligibleSymbols.has(bestMarket.symbol);
          if (btcFilterEnabled && btcRegime === "risk-off") {
            logScoped("GUARD", "btc_regime_risk_off | entry_blocked");
          } else if (neutralBlocked) {
            logScoped("GUARD", `btc_regime_neutral | entry_blocked | symbol=${bestMarket.symbol} | top_limit=${config.NEUTRAL_TOP_N}`);
          } else {
            const countBefore = state.positions.length;
            context.runtime.openPaperPosition(bestMarket);
            const newPosition = state.positions.find((position) => position.symbol === bestMarket.symbol);
            if (newPosition && state.positions.length > countBefore) {
              context.runtime.refreshPositionSnapshot(bestMarket, { exitReasonCode: null, shouldExit: false });
            } else if (state.positions.length === countBefore && !state.positions.some((position) => position.symbol === bestMarket.symbol)) {
              logScoped("ENTRY", `blocked_internal | symbol=${bestMarket.symbol} | score=${bestMarket.compositeScore} | volume=${formatLogNumber(bestMarket.currentVolume_5m, 2)} | volume_sma=${formatLogNumber(bestMarket.volumeSMA20, 2)} | action=${bestMarket.action}`);
            }
          }
        }
      }

      logCycleSummary(scanCycle, realtimeSymbols);

      if (!config.HAS_STATIC_SYMBOLS && Date.now() - lastWeakRotationAt >= config.WEAK_SYMBOL_ROTATION_MS) {
        lastWeakRotationAt = Date.now();
        const focusMarket = context.serverApi.selectFocusMarket();
        SYMBOLS = context.runtime.rotateWeakSymbols(
          state.markets,
          allCandidates,
          SYMBOLS,
          focusMarket ? focusMarket.symbol : null,
          {
            includeBtc: btcFilterEnabled,
            weakRsiMax: config.WEAK_SYMBOL_RSI_MAX
          }
        );
      }
      state.watchlist.activeSymbols = [...SYMBOLS];
      state.watchlist.source = SYMBOLS_SOURCE;
    } catch (error) {
      logScoped("ERROR", `market_scan | exchange=${config.EXCHANGE_ID} | message=${error.message}`, { dedupe: false });
    }

    lastCompletedCycleAt = Date.now();
    state.runtime.lastCompletedCycleAt = new Date(lastCompletedCycleAt).toISOString();
    state.runtime.lastCycleDurationMs = Math.max(0, lastCompletedCycleAt - cycleStartedAt);
    state.runtime.scanCycle = scanCycle;
    scanCycle += 1;
    await new Promise((resolve) => setTimeout(resolve, config.POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  state.botActive = false;
  logScoped("FATAL", `paper=${config.PAPER_TRADING} | message=${error.message}`, { dedupe: false });
  process.exit(1);
});
