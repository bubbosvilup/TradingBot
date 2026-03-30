require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const ccxt = require("ccxt");

const DEFAULT_SYMBOL = (process.env.SYMBOL || "BTC/USDT").trim();

/**
 * Parse a comma-separated symbol list from .env.
 *
 * @param {string | undefined} rawValue
 * @returns {string[]}
 */
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
const HAS_STATIC_SYMBOLS = configuredSymbols.length > 0;
let SYMBOLS = configuredSymbols.length > 0 ? configuredSymbols : [];
let SYMBOLS_SOURCE = configuredSymbols.length > 0 ? "SYMBOLS" : "dynamic";
const EXCHANGE_ID = process.env.EXCHANGE || "binance";
const PAPER_TRADING = (process.env.PAPER_TRADING || "true").toLowerCase() === "true";
let btcFilterEnabled = (process.env.BTC_FILTER_ENABLED || "true").toLowerCase() === "true";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);
const INITIAL_USDT_BALANCE = Number(process.env.INITIAL_USDT_BALANCE || 100);
const OHLCV_LIMIT = Math.max(Number(process.env.OHLCV_LIMIT || 100), 100);
const TOP_SYMBOLS_COUNT = Math.max(Number(process.env.TOP_SYMBOLS_COUNT || 10), 1);
const SYMBOLS_REFRESH_CYCLES = Math.max(Number(process.env.SYMBOLS_REFRESH_CYCLES || 120), 1);
const BATCH_SIZE = Math.max(Number(process.env.BATCH_SIZE || 5), 1);
const BATCH_DELAY_MS = Math.max(Number(process.env.BATCH_DELAY_MS || 500), 0);
const FETCH_TIMEOUT_MS = Math.max(Number(process.env.FETCH_TIMEOUT_MS || 15000), 1000);
const LOOP_STALL_WARNING_MS = Math.max(Number(process.env.LOOP_STALL_WARNING_MS || 45000), 5000);
const USE_CCXT_PRO_WS = false; // [MIGRAZIONE ARCHITETTURALE] Disabilitato forzatamente per prevenire stream errors (1008) su Binance. Usiamo polling REST puro gestito dalla queue ccxt, totalmente stabile per 5s.
const WS_BACKOFF_BASE_MS = Math.max(Number(process.env.WS_BACKOFF_BASE_MS || 1000), 250);
const WS_BACKOFF_MAX_MS = Math.max(Number(process.env.WS_BACKOFF_MAX_MS || 15000), WS_BACKOFF_BASE_MS);
const WS_WATCH_TIMEOUT_MS = Math.max(Number(process.env.WS_WATCH_TIMEOUT_MS || 45000), FETCH_TIMEOUT_MS);
const WS_FAILURE_WINDOW_MS = Math.max(Number(process.env.WS_FAILURE_WINDOW_MS || 20000), 1000);
const WS_FAILURE_THRESHOLD = Math.max(Number(process.env.WS_FAILURE_THRESHOLD || 6), 1);
const WS_GLOBAL_COOLDOWN_MS = Math.max(Number(process.env.WS_GLOBAL_COOLDOWN_MS || 120000), 1000);
const FEE_BPS = Math.max(Number(process.env.FEE_BPS || 10), 0);
const SLIPPAGE_BPS_BASE = Math.max(Number(process.env.SLIPPAGE_BPS_BASE || 5), 0);
const RISK_PCT_PER_TRADE = Math.max(Number(process.env.RISK_PCT_PER_TRADE || 0.01), 0);
const ATR_STOP_MULT = Number(process.env.ATR_STOP_MULT || 1.5);
const ATR_TP_MULT = Number(process.env.ATR_TP_MULT || 3.0);
const ATR_TRAIL_MULT = Number(process.env.ATR_TRAIL_MULT || 2.0);
const TRAILING_PCT = Number(process.env.TRAILING_PCT || 0.007);
const HARD_STOP_PCT = Number(process.env.HARD_STOP_PCT || 0.05);
const MAX_CONCURRENT_POSITIONS = Number(process.env.MAX_CONCURRENT_POSITIONS || 3); // Numero massimo di trade aperti contemporaneamente
const POSITION_SIZE_MIN = Number(process.env.POSITION_SIZE_MIN || 0.2);
const POSITION_SIZE_MAX = Number(process.env.POSITION_SIZE_MAX || 0.7);
const MIN_SCORE_ENTRY = Number(process.env.MIN_SCORE_ENTRY || 6);
const MIN_HOLD_CANDLES = Number(process.env.MIN_HOLD_CANDLES || 5);
const MIN_HOLD_SECONDS = Math.max(Number(process.env.MIN_HOLD_SECONDS || 180), 0);
const LOSS_COOLDOWN_CYCLES = Math.max(Number(process.env.LOSS_COOLDOWN_CYCLES || 8), 0);
const PARTIAL_TP_R = Math.max(Number(process.env.PARTIAL_TP_R || 1.5), 0);
const TIME_STOP_CANDLES = Math.max(Number(process.env.TIME_STOP_CANDLES || 12), 1);
const NEUTRAL_TOP_N = Math.max(Number(process.env.NEUTRAL_TOP_N || 10), 1);
const TREND_SLOPE_MIN = Number(process.env.TREND_SLOPE_MIN || 0.001);
const SPREAD_MAX_PCT = Math.max(Number(process.env.SPREAD_MAX_PCT || 0.001), 0);
const RSI_PERIOD = Number(process.env.RSI_PERIOD || 14);
const RSI_MIN = Number(process.env.RSI_MIN || 42);
const RSI_MAX = Number(process.env.RSI_MAX || 62);
const VOLUME_MULT = Number(process.env.VOLUME_MULT || 1.15);
const MACD_FAST = Number(process.env.MACD_FAST || 12);
const MACD_SLOW = Number(process.env.MACD_SLOW || 26);
const MACD_SIGNAL = Number(process.env.MACD_SIGNAL || 9);
const TRADES_LOG_FILE = "trades.log";
const SERVER_HOST = "127.0.0.1";
const SERVER_PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const STATE_FILE = path.join(__dirname, "state.json");
const STRATEGY_NAME = "mtf-trend-following-1h-5m-1m";
const ATR_PERIOD = 14;
const VOLUME_SMA_PERIOD = 20;
const EMA20_1H_PERIOD = 20;
const EMA50_1H_PERIOD = 50;
const EMA9_5M_PERIOD = 9;
const EMA21_5M_PERIOD = 21;
const EMA9_1M_PERIOD = 9;
const FETCH_LIMIT_1H = Math.max(60, Math.min(OHLCV_LIMIT, 200));
const FETCH_LIMIT_5M = Math.max(100, Math.min(OHLCV_LIMIT, 300));
const FETCH_LIMIT_1M = Math.max(20, Math.min(OHLCV_LIMIT, 100));
const MAX_POSITION_EXPOSURE_PCT = 0.85;
const ENTRY_VOLUME_MULT = Number(process.env.ENTRY_VOLUME_MULT || 0.8); // Abbassato da 1.5: con 1.5x il bot non entrava mai in mercati normali. 1.1x = volume leggermente sopra la media, filtro realistico.
const EXCLUDED_BASE_ASSETS = new Set(["USDC", "BUSD", "TUSD", "FDUSD", "DAI", "USDP", "EUR", "GBP", "WBTC", "WETH", "STETH", "WSTETH", "RETH", "USD1", "U", "NOM", "NIGHT", "STO", "SENT", "ANKR", "BARD", "KITE", "CFG"]);
const LEVERAGED_TOKEN_REGEX = /\d+[LS]$/i;
const RECENTLY_DROPPED_TTL_CYCLES = 10;
const recentlyDropped = new Set();
const recentlyDroppedExpiry = new Map();
const symbolCooldown = new Map();
const recentlyExited = new Set();
const recentlyExitedExpiry = new Map();
const wsBackoffDelay = new Map();
const wsBackoffUntil = new Map();
const WS_REALTIME_TIMEFRAMES = new Set(["5m", "1m"]);
const wsFailureTimestamps = [];
let wsDisabledUntil = 0;
let wsLastDisabledLogAt = 0;
let watchlistRotationCycle = 0;
let currentScanCycle = 0;
let lastConsoleLogMessage = "";
let lastConsoleLogAt = 0;
const LOG_DEDUPE_WINDOW_MS = 8000;

const state = {
  // [UPGRADE v2.0] Persisted bot state now includes regime and trade execution realism metadata.
  botActive: false,
  botStartedAt: null,
  lastUpdate: null,
  usdtBalance: INITIAL_USDT_BALANCE,
  positions: [], // [UPGRADE] Da singola posizione a array per gestire multi-trade
  trades: [],
  markets: {},
  candleData: {},
  bestCandidateSymbol: null,
  btcRegime: "risk-on",
  strategyName: STRATEGY_NAME,
  exchange: EXCHANGE_ID,
  paperTrading: PAPER_TRADING
};

/**
 * Print a timestamped message to stdout, suppressing identical consecutive noise for a short window.
 *
 * @param {string} message
 * @param {{dedupe?: boolean}} [options]
 * @returns {void}
 */
function log(message, options = {}) {
  const { dedupe = true } = options;
  const now = Date.now();
  if (dedupe && message === lastConsoleLogMessage && now - lastConsoleLogAt < LOG_DEDUPE_WINDOW_MS) {
    return;
  }

  lastConsoleLogMessage = message;
  lastConsoleLogAt = now;
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Print a log line with a stable category prefix for easier filtering.
 *
 * @param {string} scope
 * @param {string} message
 * @param {{dedupe?: boolean}} [options]
 * @returns {void}
 */
function logScoped(scope, message, options = {}) {
  log(`${scope} | ${message}`, options);
}

/**
 * Append a timestamped trade event to the local trade log.
 *
 * @param {string} message
 * @returns {void}
 */
function appendTradeLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(TRADES_LOG_FILE, `[${timestamp}] ${message}\n`);
}

/**
 * Format a numeric amount for logs and API output.
 *
 * @param {number} value
 * @returns {string}
 */
function formatAmount(value) {
  return Number(value).toFixed(8);
}

/**
 * Format a numeric value for compact human-readable logs.
 *
 * @param {number | null | undefined} value
 * @param {number} decimals
 * @returns {string}
 */
function formatLogNumber(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return Number(value).toFixed(decimals);
}

/**
 * Return a short blocker preview for concise debug logs.
 *
 * @param {object | undefined} market
 * @param {number} limit
 * @returns {string}
 */
function getBlockerPreview(market, limit = 2) {
  if (!market || !Array.isArray(market.entryBlockers) || market.entryBlockers.length === 0) {
    return "none";
  }

  return market.entryBlockers.slice(0, limit).join(" | ");
}

/**
 * Build a compact one-line market summary for human-readable logs.
 *
 * @param {object | undefined} market
 * @returns {string}
 */
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

/**
 * Emit a compact per-cycle summary instead of one line per watched symbol.
 *
 * @param {number} scanCycle
 * @param {Set<string>} realtimeSymbols
 * @returns {void}
 */
function logCycleSummary(scanCycle, realtimeSymbols) {
  const markets = Object.values(state.markets).filter(Boolean);
  const readyMarkets = markets.filter((market) => !market.warmingUp);
  const bullishMarkets = readyMarkets.filter((market) => market.trendBull_1h === true);
  const buyCandidates = markets
    .filter((market) => market.signal === "BUY candidate")
    .sort((left, right) => (right.compositeScore || 0) - (left.compositeScore || 0));
  const executableBuys = markets.filter((market) => market.action === "BUY");
  const focusMarket = selectFocusMarket();
  const bestMarket = state.bestCandidateSymbol ? state.markets[state.bestCandidateSymbol] : null;

  const positionLabel = state.positions.length > 0 
    ? state.positions.map(p => {
        const pnl = p.lastPrice ? ((p.btcAmount * p.lastPrice) - p.usdtAllocated) : 0;
        const pnlPct = p.usdtAllocated > 0 ? (pnl / p.usdtAllocated) * 100 : 0;
        return `${p.symbol}:${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`;
      }).join(", ")
    : "none";

  logScoped(
    "SCAN",
    `cycle=${scanCycle} | watch=${SYMBOLS.length} | ready=${readyMarkets.length} | bull=${bullishMarkets.length} | btc=${state.btcRegime} | ws=${realtimeSymbols.size} | buy_candidates=${buyCandidates.length} | executable=${executableBuys.length} | positions=${positionLabel}`
  );

  for (const pos of state.positions) {
    const market = state.markets[pos.symbol];
    if (market) {
      logScoped("POSITION", summarizeMarketForLog(market));
    }
  }

  if (focusMarket && !state.positions.some(p => p.symbol === focusMarket.symbol)) {
    logScoped("FOCUS", summarizeMarketForLog(focusMarket));
  }

  if (bestMarket && !state.positions.some(p => p.symbol === bestMarket.symbol) && (focusMarket ? bestMarket.symbol !== focusMarket.symbol : true)) {
    logScoped("CANDIDATE", summarizeMarketForLog(bestMarket));
  }

  if (state.positions.length < MAX_CONCURRENT_POSITIONS && buyCandidates.length > 1) {
    const topCandidates = buyCandidates
      .filter(m => !state.positions.some(p => p.symbol === m.symbol))
      .slice(0, 3)
      .map((market) => `${market.symbol}:${market.compositeScore}/${market.action === "BUY" ? "ready" : "candidate"}`)
      .join(" | ");
    if (topCandidates) {
      logScoped("CANDIDATES", topCandidates);
    }
  }
}

/**
 * Reject a promise if it does not settle within the configured timeout window.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {string} label
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(promise, label, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

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

/**
 * Compute RSI with Wilder smoothing.
 *
 * @param {number[]} prices
 * @param {number} period
 * @returns {number | null}
 */
function wilderRsi(prices, period) {
  if (!Array.isArray(prices) || prices.length < period * 2) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = prices[index] - prices[index - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let index = period + 1; index < prices.length; index += 1) {
    const change = prices[index] - prices[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Compute a classic EMA from a numeric series.
 *
 * @param {number[]} prices
 * @param {number} period
 * @returns {number | null}
 */
function calculateEma(prices, period) {
  if (prices.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((total, value) => total + value, 0) / period;

  for (let index = period; index < prices.length; index += 1) {
    ema = (prices[index] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Build an EMA series aligned to the input length.
 *
 * @param {number[]} values
 * @param {number} period
 * @returns {(number | null)[]}
 */
function calculateEmaSeries(values, period) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const series = Array(values.length).fill(null);
  if (values.length < period) {
    return series;
  }

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((total, value) => total + value, 0) / period;
  series[period - 1] = ema;

  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    series[index] = ema;
  }

  return series;
}

/**
 * Compute ATR with Wilder smoothing on OHLCV candles.
 *
 * @param {Array<Array<number>>} candles
 * @param {number} period
 * @returns {number | null}
 */
function calculateAtr(candles, period) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return null;
  }

  const trueRanges = [];

  for (let index = 1; index < candles.length; index += 1) {
    const currentHigh = Number(candles[index][2]);
    const currentLow = Number(candles[index][3]);
    const previousClose = Number(candles[index - 1][4]);
    trueRanges.push(
      Math.max(
        currentHigh - currentLow,
        Math.abs(currentHigh - previousClose),
        Math.abs(currentLow - previousClose)
      )
    );
  }

  if (trueRanges.length < period) {
    return null;
  }

  let atr = trueRanges.slice(0, period).reduce((total, value) => total + value, 0) / period;
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = (atr * (period - 1) + trueRanges[index]) / period;
  }

  return atr;
}

/**
 * Compute MACD values and previous histogram.
 *
 * @param {number[]} prices
 * @param {number} fast
 * @param {number} slow
 * @param {number} signal
 * @returns {{macdLine: number, signalLine: number, histogram: number, prevHistogram: number | null} | null}
 */
function calculateMacd(prices, fast, slow, signal) {
  if (!Array.isArray(prices) || prices.length < slow + signal + 5) {
    return null;
  }

  const fastSeries = calculateEmaSeries(prices, fast);
  const slowSeries = calculateEmaSeries(prices, slow);
  const macdSeries = prices
    .map((_, index) => {
      if (fastSeries[index] === null || slowSeries[index] === null) {
        return null;
      }

      return fastSeries[index] - slowSeries[index];
    })
    .filter((value) => value !== null);

  if (macdSeries.length < signal + 2) {
    return null;
  }

  const signalSeries = calculateEmaSeries(macdSeries, signal);
  const macdLine = macdSeries[macdSeries.length - 1];
  const prevMacdLine = macdSeries[macdSeries.length - 2];
  const signalLine = signalSeries[signalSeries.length - 1];
  const prevSignalLine = signalSeries[signalSeries.length - 2];

  if (signalLine === null || prevSignalLine === null) {
    return null;
  }

  return {
    macdLine,
    signalLine,
    histogram: macdLine - signalLine,
    prevHistogram: prevMacdLine - prevSignalLine
  };
}

/**
 * Compute a simple moving average.
 *
 * @param {number[]} values
 * @param {number} period
 * @returns {number | null}
 */
function calculateSma(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const subset = values.slice(-period);
  return subset.reduce((total, value) => total + value, 0) / subset.length;
}

/**
 * Convert RSI into a simple qualitative label.
 *
 * @param {number | null} rsi
 * @returns {string}
 */
function getRsiState(rsi) {
  if (rsi === null) {
    return "non disponibile";
  }

  if (rsi < RSI_MIN) {
    return "troppo basso";
  }

  if (rsi > RSI_MAX) {
    return "troppo alto";
  }

  return "favorevole";
}

/**
 * Describe current price location relative to the 5m pullback zone.
 *
 * @param {number | null} lastPrice
 * @param {number | null} ema21
 * @param {number | null} atr
 * @returns {string}
 */
function getPriceState(lastPrice, ema21, atr) {
  if (lastPrice === null || ema21 === null || atr === null) {
    return "non valutabile";
  }

  const distance = Math.abs(lastPrice - ema21);
  if (distance <= atr * 0.5) {
    return "vicino al punto di ingresso";
  }

  if (lastPrice > ema21) {
    return "troppo esteso sopra la media";
  }

  return "troppo debole sotto la media";
}

function pickVariant(variants, key) {
  const seed = String(key || "default")
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  return variants[seed % variants.length];
}

function buildDecisionExplanationObject(snapshot) {
  return {
    action: snapshot.displayAction,
    trend: snapshot.trendBull_1h ? "rialzista" : snapshot.ema20_1h === null || snapshot.ema50_1h === null ? "non disponibile" : "ribassista",
    rsiState: getRsiState(snapshot.rsi_5m),
    priceState: getPriceState(snapshot.lastPrice_5m, snapshot.ema21_5m, snapshot.atr14_5m),
    positionState: snapshot.positionOpen ? "aperta" : "nessuna",
    warmingUp: snapshot.warmingUp,
    missingIndicators: snapshot.missingIndicators,
    entryBlockers: Array.isArray(snapshot.entryBlockers) ? snapshot.entryBlockers : [],
    score: snapshot.compositeScore,
    reason: snapshot.reason,
    symbol: snapshot.symbol
  };
}

function renderDecisionExplanation(explanationObject) {
  const { action, trend, rsiState, priceState, positionState, warmingUp, missingIndicators, entryBlockers, score, reason, symbol } = explanationObject;
  let shortExplanation;
  let detailedExplanation;
  const blockersLabel = entryBlockers.length > 0 ? ` Blocchi principali: ${entryBlockers.slice(0, 3).join("; ")}.` : "";

  if (warmingUp) {
    shortExplanation = pickVariant(
      [
        `Il bot aspetta su ${symbol}: i dati non sono ancora sufficienti.`,
        `Su ${symbol} il bot resta fermo: gli indicatori non sono pronti.`,
        `Il bot non agisce su ${symbol}: serve ancora un po' di storico.`
      ],
      reason
    );
    detailedExplanation = `Il bot non prende decisioni su ${symbol} finche non ha dati sufficienti su 1h, 5m e 1m. In questo momento mancano ancora: ${missingIndicators.join(", ")}. Per questo la scelta finale resta HOLD.${blockersLabel}`;
  } else if (action === "BUY") {
    shortExplanation = pickVariant(
      [
        `Il bot compra ${symbol}: i tre livelli di conferma sono allineati.`,
        `Il bot apre una posizione su ${symbol}: trend, setup ed entrata sono coerenti.`,
        `Il bot compra ${symbol}: il quadro multi-timeframe e favorevole.`
      ],
      reason
    );
    detailedExplanation = `Il bot ha scelto ${symbol} perche il trend orario e rialzista, il setup sul 5 minuti e valido e il trigger sul 1 minuto conferma il rientro del prezzo. Inoltre il punteggio complessivo ha superato la soglia minima richiesta per entrare.`;
  } else if (action === "SELL" && reason === "Hard stop triggered.") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: e stato colpito il limite di sicurezza assoluto.`,
        `Il bot chiude ${symbol}: il prezzo ha toccato il livello di protezione massima.`,
        `Il bot esce da ${symbol}: la perdita ha raggiunto il pavimento di sicurezza.`
      ],
      reason
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il prezzo e sceso fino al livello di protezione piu rigido previsto. La posizione viene chiusa subito per evitare che il danno aumenti ulteriormente.`;
  } else if (action === "SELL" && reason === "Trailing stop reached.") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il prezzo ha perso forza dopo il rialzo.`,
        `Il bot chiude ${symbol}: il trailing stop e stato raggiunto.`,
        `Il bot esce da ${symbol}: protegge parte del profitto accumulato.`
      ],
      reason
    );
    detailedExplanation = `Il bot aveva attivato una protezione dinamica dopo che il trade era andato in profitto. Ora il prezzo e tornato indietro abbastanza da toccare quel livello, quindi la posizione viene chiusa per difendere il risultato ottenuto.`;
  } else if (action === "SELL" && reason === "ATR stop loss reached.") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il prezzo ha colpito lo stop basato sulla volatilita.`,
        `Il bot chiude ${symbol}: il movimento contrario ha raggiunto il limite ATR.`,
        `Il bot esce da ${symbol}: la perdita ha superato la soglia prevista dal rischio.`
      ],
      reason
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il prezzo si e mosso contro il trade fino a raggiungere lo stop basato sull'ATR. Questo stop usa la volatilita del mercato per stabilire un limite di rischio coerente.`;
  } else if (action === "SELL" && reason === "Take profit reached.") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il target di profitto e stato raggiunto.`,
        `Il bot chiude ${symbol} in guadagno: il take profit e stato colpito.`,
        `Il bot esce da ${symbol}: il movimento favorevole ha raggiunto l'obiettivo.`
      ],
      reason
    );
    detailedExplanation = `Il prezzo di ${symbol} ha raggiunto il livello di take profit impostato all'ingresso. Questo significa che il movimento favorevole ha centrato l'obiettivo previsto, quindi il bot chiude la posizione.`;
  } else if (action === "SELL") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il trend orario si e indebolito.`,
        `Il bot chiude ${symbol}: il filtro di trend non sostiene piu il trade.`,
        `Il bot esce da ${symbol}: il contesto generale non e piu favorevole.`
      ],
      reason
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il trend sul timeframe orario non e piu coerente con l'idea iniziale. Dopo un numero minimo di candele tenute a mercato, la posizione viene chiusa per evitare di restare dentro quando il contesto peggiora.`;
  } else if (positionState === "aperta") {
    shortExplanation = pickVariant(
      [
        `Il bot mantiene ${symbol}: non ci sono segnali chiari di uscita.`,
        `Il bot resta fermo su ${symbol}: la posizione aperta resta valida.`,
        `Il bot aspetta su ${symbol}: il trade e ancora gestito in modo ordinato.`
      ],
      reason
    );
    detailedExplanation = `Il bot ha gia una posizione aperta su ${symbol}. Al momento non e stato colpito alcun livello di uscita e il trend orario non ha ancora invalidato il trade. Per questo la decisione resta HOLD e la posizione continua a essere monitorata.`;
  } else if (trend !== "rialzista") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: il trend orario non e favorevole.`,
        `Il bot non entra su ${symbol}: il filtro di trend blocca nuovi acquisti.`,
        `Il bot aspetta su ${symbol}: il contesto orario non sostiene un ingresso.`
      ],
      reason
    );
    detailedExplanation = `Il bot non apre una posizione su ${symbol} perche il trend sul timeframe orario non e rialzista. In questo sistema il filtro a 1 ora deve essere favorevole prima ancora di valutare il setup operativo.${blockersLabel}`;
  } else if (rsiState !== "favorevole") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: la forza del movimento non e nella zona giusta.`,
        `Il bot non compra ${symbol}: l'RSI non conferma un ingresso prudente.`,
        `Il bot aspetta su ${symbol}: il ritmo del mercato non e adatto a entrare ora.`
      ],
      reason
    );
    detailedExplanation = `Su ${symbol} il filtro di trend puo anche essere buono, ma l'RSI sul 5 minuti non si trova nella fascia operativa scelta. Il bot preferisce evitare ingressi quando il mercato e troppo debole o troppo tirato.${blockersLabel}`;
  } else if (priceState !== "vicino al punto di ingresso") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: il prezzo non e in una zona di ingresso sensata.`,
        `Il bot non entra su ${symbol}: il prezzo e troppo lontano dalla media operativa.`,
        `Il bot aspetta su ${symbol}: preferisce un pullback piu ordinato.`
      ],
      reason
    );
    detailedExplanation = `Anche se parte del contesto e interessante, il prezzo di ${symbol} non si trova abbastanza vicino alla zona di pullback definita sul 5 minuti. Il bot evita di inseguire movimenti gia estesi.${blockersLabel}`;
  } else {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: al momento non vede un'opportunita pulita.`,
        `Il bot aspetta su ${symbol}: il quadro non e abbastanza convincente.`,
        `Il bot non agisce su ${symbol}: preferisce attendere condizioni piu lineari.`
      ],
      reason
    );
    detailedExplanation = `Il bot non ha trovato su ${symbol} un insieme di condizioni abbastanza coerente per comprare o vendere. Score attuale: ${score ?? "n/a"}/10. Per questo mantiene un comportamento prudente e resta in HOLD.${blockersLabel}`;
  }

  return {
    shortExplanation,
    detailedExplanation,
    reasonList: [
      `Trend: ${trend}`,
      `RSI: ${rsiState}`,
      `Prezzo: ${priceState}`,
      `Stato posizione: ${positionState}`,
      `Decisione finale: ${action}`,
      entryBlockers.length > 0 ? `Blocchi: ${entryBlockers.slice(0, 3).join("; ")}` : null
    ].filter(Boolean)
  };
}

/**
 * Find the most recent confirmed swing low inside the requested lookback window.
 *
 * @param {Array<Array<number>>} candles
 * @param {number} lookback
 * @param {number} strength
 * @returns {{value: number, index: number} | null}
 */
function findSwingLow(candles, lookback = 30, strength = 3) {
  if (!Array.isArray(candles) || candles.length < strength * 2 + 1) {
    return null;
  }

  const startIndex = Math.max(0, candles.length - lookback);
  const firstCandidateIndex = startIndex + strength;
  const lastCandidateIndex = candles.length - 1 - strength;

  if (firstCandidateIndex > lastCandidateIndex) {
    return null;
  }

  for (let index = lastCandidateIndex; index >= firstCandidateIndex; index -= 1) {
    const currentLow = Number(candles[index][3]);
    let isSwingLow = true;

    for (let offset = 1; offset <= strength; offset += 1) {
      const previousLow = Number(candles[index - offset][3]);
      const nextLow = Number(candles[index + offset][3]);

      if (!(currentLow < previousLow && currentLow < nextLow)) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      return { value: currentLow, index };
    }
  }

  return null;
}

/**
 * Build a multi-timeframe market snapshot with indicators and a 1m trigger confirmed on the last closed candle.
 *
 * @param {string} symbol
 * @param {{candles_1h: Array<Array<number>>, candles_5m: Array<Array<number>>, candles_1m: Array<Array<number>>}} candleSet
 * @returns {object}
 */
function buildMarketSnapshot(symbol, candleSet) {
  const candles_1h = Array.isArray(candleSet?.candles_1h) ? candleSet.candles_1h : [];
  const candles_5m = Array.isArray(candleSet?.candles_5m) ? candleSet.candles_5m : [];
  const candles_1m = Array.isArray(candleSet?.candles_1m) ? candleSet.candles_1m : [];

  const closes_1h = candles_1h.map((candle) => Number(candle[4]));
  const closes_5m = candles_5m.map((candle) => Number(candle[4]));
  const closes_1m = candles_1m.map((candle) => Number(candle[4]));
  const volumes_5m = candles_5m.map((candle) => Number(candle[5]));
  const previousClose_5m = closes_5m.length > 1 ? closes_5m[closes_5m.length - 2] : null;

  const lastPrice_1m = closes_1m.length > 0 ? closes_1m[closes_1m.length - 1] : null;
  const lastPrice_5m = closes_5m.length > 0 ? closes_5m[closes_5m.length - 1] : null;
  const currentPrice = lastPrice_1m ?? lastPrice_5m;

  const ema20Series_1h = calculateEmaSeries(closes_1h, EMA20_1H_PERIOD);
  const ema20_1h = calculateEma(closes_1h, EMA20_1H_PERIOD);
  const ema50_1h = calculateEma(closes_1h, EMA50_1H_PERIOD);
  const trendBull_1h = ema20_1h !== null && ema50_1h !== null ? ema20_1h > ema50_1h : false;
  const ema20_1h_3ago = ema20Series_1h.length >= 4 ? ema20Series_1h[ema20Series_1h.length - 4] : null;
  const trendSlope_1h =
    ema20_1h !== null && ema20_1h_3ago !== null && ema20_1h !== 0
      ? (ema20_1h - ema20_1h_3ago) / ema20_1h
      : null;
  const trendLateral = trendSlope_1h !== null ? trendSlope_1h <= TREND_SLOPE_MIN : false;

  const ema9_5m = calculateEma(closes_5m, EMA9_5M_PERIOD);
  const ema21_5m = calculateEma(closes_5m, EMA21_5M_PERIOD);
  const rsi_5m = wilderRsi(closes_5m, RSI_PERIOD);
  const atr14_5m = calculateAtr(candles_5m, ATR_PERIOD);
  const volumeSMA20 = calculateSma(volumes_5m, VOLUME_SMA_PERIOD);
  const currentVolume_5m = volumes_5m.length > 1 ? volumes_5m[volumes_5m.length - 2] : (volumes_5m.length > 0 ? volumes_5m[volumes_5m.length - 1] : null); // [FIX] Usa la candela 5m già CHIUSA, non quella in formazione che ha volume parziale!
  const macd = calculateMacd(closes_5m, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
  const ema9_1m = calculateEma(closes_1m, EMA9_1M_PERIOD);

  const missingIndicators = [];
  if (ema20_1h === null) missingIndicators.push("EMA20_1h");
  if (ema50_1h === null) missingIndicators.push("EMA50_1h");
  if (ema9_5m === null) missingIndicators.push("EMA9_5m");
  if (ema21_5m === null) missingIndicators.push("EMA21_5m");
  if (rsi_5m === null) missingIndicators.push("RSI_5m");
  if (atr14_5m === null) missingIndicators.push("ATR14_5m");
  if (volumeSMA20 === null || currentVolume_5m === null) missingIndicators.push("Volume_5m");
  if (macd === null) missingIndicators.push("MACD_5m");
  if (ema9_1m === null || candles_1m.length < 2) missingIndicators.push("Trigger_1m");

  const warmingUp = missingIndicators.length > 0;
  const pullbackZoneOk =
    lastPrice_5m !== null && ema21_5m !== null && atr14_5m !== null
      ? Math.abs(lastPrice_5m - ema21_5m) <= atr14_5m * 1.0 // [FIX] Allargato da 0.5 a 1.0 ATR: con 0.5 ATR il prezzo era quasi sempre "troppo lontano" in mercati trending normali
      : false;
  const volumeOk =
    currentVolume_5m !== null && volumeSMA20 !== null
      ? currentVolume_5m >= volumeSMA20 * VOLUME_MULT
      : false;
  const entryVolumeReady =
    currentVolume_5m !== null && volumeSMA20 !== null
      ? currentVolume_5m >= volumeSMA20 * ENTRY_VOLUME_MULT
      : false;
  const macdPositive = macd !== null ? macd.histogram > 0 : false;
  const latestOneMinuteTimestamp = candles_1m.length > 0 ? Number(candles_1m[candles_1m.length - 1][0]) : null;
  const previousOneMinuteTimestamp = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][0]) : null;
  const previousOneMinuteClose = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][4]) : null;
  const previousOneMinuteLow = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][3]) : null;
  const swingLow = findSwingLow(candles_5m, 30, 3);
  const sfpSweep = swingLow !== null && previousOneMinuteLow !== null ? previousOneMinuteLow < swingLow.value : false;
  const sfpReclaim = swingLow !== null && previousOneMinuteClose !== null ? previousOneMinuteClose > swingLow.value : false;
  const sfpStrongClose = previousOneMinuteClose !== null && ema9_1m !== null ? previousOneMinuteClose > ema9_1m : false;
  const sfpVolumeConfirm =
    currentVolume_5m !== null && volumeSMA20 !== null
      ? currentVolume_5m >= volumeSMA20 * VOLUME_MULT
      : false;
  const sfpValid = !warmingUp && swingLow !== null && sfpSweep && sfpReclaim && sfpStrongClose && sfpVolumeConfirm;
  const sfpStopLevel = sfpValid ? previousOneMinuteLow : null;
  const triggerFired =
    previousOneMinuteTimestamp !== null &&
    latestOneMinuteTimestamp !== null &&
    latestOneMinuteTimestamp > previousOneMinuteTimestamp &&
    previousOneMinuteClose !== null &&
    ema9_1m !== null
      ? (previousOneMinuteClose > ema9_1m || (lastPrice_5m !== null && lastPrice_5m > ema9_1m)) // [FIX] Accetta sia la chiusura candela che il prezzo live sopra EMA9 asincrono
      : false;
  const setupValid =
    !warmingUp &&
    trendBull_1h &&
    trendSlope_1h !== null &&
    trendSlope_1h > TREND_SLOPE_MIN &&
    ema9_5m > ema21_5m &&
    rsi_5m >= RSI_MIN &&
    rsi_5m <= RSI_MAX &&
    // pullbackZoneOk rimosso da hard-requirement: ora è solo +1 score. In mercati trending il prezzo sta sopra EMA21 a lungo e questo bloccava sempre gli ingressi.
    triggerFired;

  let trendContinuationScore = 0;
  if (trendBull_1h) trendContinuationScore += 2;
  if (trendSlope_1h !== null && trendSlope_1h > TREND_SLOPE_MIN) trendContinuationScore += 1;
  if (ema9_5m !== null && ema21_5m !== null && ema9_5m > ema21_5m) trendContinuationScore += 1;
  if (rsi_5m !== null && rsi_5m >= RSI_MIN && rsi_5m <= RSI_MAX) trendContinuationScore += 1;
  if (pullbackZoneOk) trendContinuationScore += 1;
  if (triggerFired) trendContinuationScore += 1;
  if (macdPositive) trendContinuationScore += 1;
  if (entryVolumeReady) trendContinuationScore += 1; // [FIX] Volume ora contribuisce allo score (+1) invece di bloccare duramente l'ingresso

  let sfpScore = 0;
  if (sfpSweep && sfpReclaim) sfpScore += 2;
  if (sfpStrongClose) sfpScore += 1;
  if (sfpVolumeConfirm) sfpScore += 1;
  if (trendBull_1h) sfpScore += 2;

  const compositeScore = Math.max(trendContinuationScore, sfpScore);
  const positionOpen = state.positions.some(p => p.symbol === symbol);
  const trendContinuationValid = setupValid;
  const entryBlockers = [];
  const trendBlockers = [];
  const sfpBlockers = [];

  if (warmingUp) {
    const warmupMessage = `Indicatori mancanti: ${missingIndicators.join(", ")}`;
    entryBlockers.push(warmupMessage);
    trendBlockers.push(warmupMessage);
    sfpBlockers.push(warmupMessage);
  } else {
    if (!trendBull_1h && !positionOpen) {
      trendBlockers.push("Trend 1h non rialzista");
    }

    if (trendSlope_1h !== null && trendSlope_1h <= TREND_SLOPE_MIN) {
      trendBlockers.push(`Trend 1h laterale (slope=${trendSlope_1h.toFixed(4)})`);
    }

    if (!(ema9_5m > ema21_5m)) {
      trendBlockers.push("EMA 5m non allineate al rialzo");
    }

    if (rsi_5m !== null && (rsi_5m < RSI_MIN || rsi_5m > RSI_MAX)) {
      trendBlockers.push(`RSI fuori range operativo (${rsi_5m.toFixed(2)})`);
    }

    if (!pullbackZoneOk) {
      trendBlockers.push("Prezzo fuori zona di pullback 5m");
    }

    if (!entryVolumeReady) {
      trendBlockers.push(`Volume 5m insufficiente per ingresso reale (${ENTRY_VOLUME_MULT}x SMA richiesto)`);
      sfpBlockers.push(`Volume 5m insufficiente per ingresso reale (${ENTRY_VOLUME_MULT}x SMA richiesto)`);
    }

    if (!macdPositive) {
      trendBlockers.push("MACD 5m non conferma il trend");
    }

    if (!triggerFired) {
      trendBlockers.push("Trigger 1m non confermato su candela chiusa");
    }

    if (!sfpValid) {
      if (swingLow === null) {
        sfpBlockers.push("Nessun swing low 5m valido per SFP");
      } else if (!sfpSweep) {
        sfpBlockers.push("SFP assente: nessuno sweep del minimo");
      } else if (!sfpReclaim) {
        sfpBlockers.push("SFP assente: sweep senza reclaim");
      } else if (!sfpStrongClose) {
        sfpBlockers.push("SFP debole: close 1m non forte");
      } else if (!sfpVolumeConfirm) {
        sfpBlockers.push("SFP debole: reclaim senza volume");
      }
    }
  }

  let signal = "HOLD";
  let action = "HOLD";
  let displayAction = "HOLD";
  let reason = "Nessun segnale operativo rilevante.";
  let entryType = "none";

  if (warmingUp) {
    reason = `Indicatori non pronti: ${missingIndicators.join(", ")}`;
  } else if (!trendBull_1h && !positionOpen) {
    reason = "Trend 1h non rialzista: nuovi ingressi bloccati.";
  } else if (positionOpen) {
    reason = "Posizione aperta in gestione.";
  } else if (false) {
    // [FIX] Rimosso blocco hard sul volume: il volume ora è solo un contributo allo score (+1 punto)
    // In mercati laterali a basso volume il bot si bloccava perennemente anche con setup tecnici perfetti
    reason = `Setup valido ma ingresso bloccato: volume 5m sotto ${ENTRY_VOLUME_MULT}x della media.`;
  } else if (compositeScore < MIN_SCORE_ENTRY) {
    // [VERSIONE REATTIVA] Se lo score è già alto (>= MIN_SCORE_ENTRY), ignoriamo i blocchi millimetrici e entriamo nel trend.
    // Se lo score è invece basso, rimaniamo in HOLD spiegando perché.
    reason = `Score ${compositeScore}/10 sotto la soglia minima ${MIN_SCORE_ENTRY}. In attesa di segnali più forti.`;
    if (entryBlockers.length > 0) reason += ` (Blockers primari: ${entryBlockers.slice(0, 1).join(", ")})`;
  } else {
    signal = "BUY candidate";
    action = "BUY";
    displayAction = "BUY";
    entryType = sfpValid && sfpScore > trendContinuationScore ? "sfp_reversal" : "trend_continuation";
    reason = entryType === "sfp_reversal"
      ? "Liquidity spring / SFP confermato: sweep del minimo, reclaim e volume coerente."
      : "Trend continuation valido: trend 1h inclinato al rialzo, pullback pulito e trigger confermato.";
  }

  if (entryType === "trend_continuation") {
    entryBlockers.push(...trendBlockers);
    if (sfpBlockers.length > 0) {
      entryBlockers.push(sfpBlockers[0]);
    }
  } else if (entryType === "sfp_reversal") {
    entryBlockers.push(...sfpBlockers);
    if (trendBlockers.length > 0) {
      entryBlockers.push(trendBlockers[0]);
    }
  } else {
    entryBlockers.push(...trendBlockers, ...sfpBlockers);
  }

  const deduplicatedBlockers = Array.from(new Set(entryBlockers));

  const explanation = renderDecisionExplanation(
    buildDecisionExplanationObject({
      symbol,
      displayAction,
      trendBull_1h,
      ema20_1h,
      ema50_1h,
      rsi_5m,
      lastPrice_5m,
      ema21_5m,
      atr14_5m,
      warmingUp,
      missingIndicators,
      entryBlockers: deduplicatedBlockers,
      reason,
      positionOpen
    })
  );

  return {
    symbol,
    lastPrice: currentPrice,
    lastPrice_5m,
    lastPrice_1m,
    trend: trendBull_1h ? "rialzista" : ema20_1h === null || ema50_1h === null ? "non disponibile" : "ribassista",
    signal,
    action,
    displayAction,
    reason,
    warmingUp,
    missingIndicators,
    entryBlockers: deduplicatedBlockers,
    score: compositeScore,
    compositeScore,
    positionOpen,
    shortExplanation: explanation.shortExplanation,
    detailedExplanation: explanation.detailedExplanation,
    reasonList: explanation.reasonList,
    ema20_1h,
    ema50_1h,
    trendBull_1h,
    trendSlope_1h,
    trendLateral,
    ema9_5m,
    ema21_5m,
    rsi_5m,
    atr14_5m,
    macdHistogram: macd ? macd.histogram : null,
    macdLine: macd ? macd.macdLine : null,
    signalLine: macd ? macd.signalLine : null,
    prevHistogram: macd ? macd.prevHistogram : null,
    volumeSMA20,
    currentVolume_5m,
    entryVolumeReady,
    triggerFired,
    setupValid,
    trendContinuationValid,
    trendContinuationScore,
    sfpScore,
    swingLow,
    sfpSweep,
    sfpReclaim,
    sfpStrongClose,
    sfpVolumeConfirm,
    sfpValid,
    sfpStopLevel,
    entryType,
    emaFast: ema9_5m,
    emaSlow: ema21_5m,
    rsi: rsi_5m,
    previousClose_5m,
    lastFiveMinuteCandleTime: candles_5m.length > 0 ? candles_5m[candles_5m.length - 1][0] : null,
    entryPrice: positionOpen ? state.positions.find(p => p.symbol === symbol).entryPrice : null,
    stopLoss: positionOpen ? state.positions.find(p => p.symbol === symbol).stopLoss : null,
    takeProfit: positionOpen ? state.positions.find(p => p.symbol === symbol).takeProfit : null,
    highWaterMark: positionOpen ? state.positions.find(p => p.symbol === symbol).highWaterMark : null,
    trailingStop: positionOpen ? state.positions.find(p => p.symbol === symbol).trailingStop : null,
    holdCandles: positionOpen ? (state.positions.find(p => p.symbol === symbol).holdCandles || 0) : 0,
    entryCount: positionOpen ? state.positions.find(p => p.symbol === symbol).entryCount : 0
  };
}

/**
 * Estimate total portfolio value in USDT using the latest open-position price.
 *
 * @returns {number}
 */
function getPortfolioValue() {
  const positionsValue = state.positions.reduce((sum, pos) => {
    return sum + (pos.lastPrice ? pos.btcAmount * pos.lastPrice : 0);
  }, 0);
  return state.usdtBalance + positionsValue;
}

/**
 * Compute the current position budget usage and remaining buying room.
 *
 * @returns {{budgetCap: number, budgetUsed: number, budgetRemaining: number, entryCount: number}}
 */
function getPositionBudgetMetrics() {
  const portfolioValue = getPortfolioValue();
  const budgetCap = portfolioValue * MAX_POSITION_EXPOSURE_PCT;
  // Calcoliamo il budget totale usato sommando tutte le posizioni attive
  const budgetUsed = state.positions.reduce((sum, pos) => sum + pos.usdtAllocated, 0);
  const activeCount = state.positions.length;

  return {
    budgetCap,
    budgetUsed,
    budgetRemaining: Math.max(0, budgetCap - budgetUsed),
    activeCount,
    perTradeBudget: budgetCap / MAX_CONCURRENT_POSITIONS // Budget teorico per singolo trade
  };
}

/**
 * Compute total session PnL in USDT.
 *
 * @returns {number}
 */
function getSessionPnl() {
  return getPortfolioValue() - INITIAL_USDT_BALANCE;
}

/**
 * Compute total session PnL percentage relative to the initial balance.
 *
 * @returns {number}
 */
function getSessionPnlPercent() {
  if (INITIAL_USDT_BALANCE === 0) {
    return 0;
  }

  return (getSessionPnl() / INITIAL_USDT_BALANCE) * 100;
}

/**
 * Build aggregate trade statistics for the current session.
 *
 * @returns {object}
 */
function getSessionStats() {
  const closedTrades = state.trades.filter((trade) => trade.action === "SELL_FULL" || trade.action === "SELL_PARTIAL");
  const profitableTrades = closedTrades.filter((trade) => trade.netPnlUsdt !== null && trade.netPnlUsdt > 0);
  const losingTrades = closedTrades.filter((trade) => trade.netPnlUsdt !== null && trade.netPnlUsdt < 0);
  const totalClosedPnl = closedTrades.reduce((total, trade) => total + (trade.netPnlUsdt || 0), 0);
  const averageClosedTradePnl = closedTrades.length === 0 ? 0 : totalClosedPnl / closedTrades.length;
  const lastTrade = state.trades.length === 0 ? null : state.trades[state.trades.length - 1];

  return {
    totalTrades: state.trades.length,
    profitableTrades: profitableTrades.length,
    losingTrades: losingTrades.length,
    sessionPnl: getSessionPnl(),
    averageClosedTradePnl,
    lastTrade,
    hasOpenPosition: state.positions.length > 0
  };
}

/**
 * Build a short Italian summary for the dashboard header.
 *
 * @returns {string}
 */
function buildSummary() {
  const sessionPnl = getSessionPnl();
  const sessionPnlLabel = `${sessionPnl >= 0 ? "+" : ""}${sessionPnl.toFixed(2)} USDT`;

  if (!state.botActive) {
    return "Il bot e fermo.";
  }

  if (state.positions.length > 0) {
    const symbolList = state.positions.map(p => p.symbol).join(", ");
    return `Il bot e attivo e sta gestendo ${state.positions.length} posizioni (${symbolList}). Risultato sessione: ${sessionPnlLabel}.`;
  }

  if (state.bestCandidateSymbol) {
    return `Il bot e attivo e sta confrontando ${SYMBOLS.length} mercati. Al momento il candidato migliore e ${state.bestCandidateSymbol}. Risultato sessione: ${sessionPnlLabel}.`;
  }

  return `Il bot e attivo e sta osservando ${SYMBOLS.length} mercati. Risultato sessione: ${sessionPnlLabel}.`;
}

/**
 * Choose the market that should drive the dashboard focus panel.
 *
 * @returns {object | null}
 */
function selectFocusMarket() {
  const readyMarkets = Object.values(state.markets).filter((market) => !market.warmingUp);

  const openPos = state.positions[0];
  if (openPos && state.markets[openPos.symbol]) {
    return state.markets[openPos.symbol];
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

      const leftTrend = left.trend === "rialzista" ? 1 : 0;
      const rightTrend = right.trend === "rialzista" ? 1 : 0;
      return rightTrend - leftTrend;
    });

    return scoredMarkets[0];
  }

  const warmedMarkets = availableMarkets.filter((market) => !market.warmingUp);
  if (warmedMarkets.length > 0) {
    return warmedMarkets[0];
  }

  return availableMarkets[0];
}

/**
 * Build the full API payload consumed by the local dashboard.
 *
 * @returns {object}
 */
function getStatusPayload() {
  const focusMarket = selectFocusMarket();
  const activePositionSymbols = state.positions.map(p => p.symbol);
  const focusSymbol = focusMarket ? focusMarket.symbol : (activePositionSymbols[0] || state.bestCandidateSymbol);
  let focusMode = "no_data";
  let focusReason = "Nessun mercato ha ancora dati sufficienti.";

  if (focusMarket) {
    if (activePositionSymbols.includes(focusMarket.symbol)) {
      focusMode = "open_position";
      focusReason = `Questo mercato e in focus perche il bot ha gia una posizione aperta su ${focusMarket.symbol}.`;
    } else if (state.bestCandidateSymbol && focusMarket.symbol === state.bestCandidateSymbol) {
      focusMode = "best_candidate";
      focusReason = `Questo mercato e in focus perche al momento e il candidato migliore tra quelli osservati.`;
    } else {
      focusMode = "best_available";
      focusReason = `Questo mercato e in focus perche e quello con i dati piu utili disponibili in questo momento.`;
    }
  }

  const portfolioValue = getPortfolioValue();
  const sessionPnl = getSessionPnl();
  const sessionPnlPercent = getSessionPnlPercent();
  const stats = getSessionStats();
  const budget = getPositionBudgetMetrics();

  // Calcolo PnL live per ogni posizione
  const positionsWithDetails = state.positions.map(pos => {
    const pnlUsdt = pos.lastPrice ? (pos.btcAmount * pos.lastPrice) - pos.costBasisUsdt : 0;
    const pnlPercent = (pnlUsdt / pos.costBasisUsdt) * 100;
    return {
      ...pos,
      pnlUsdt,
      pnlPercent,
      pnlLabel: `${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}% (${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT)`
    };
  });

  return {
    bot: {
      active: state.botActive,
      exchange: state.exchange,
      symbol: focusSymbol || DEFAULT_SYMBOL,
      paperTrading: state.paperTrading,
      btcRegime: state.btcRegime,
      startedAt: state.botStartedAt,
      lastUpdate: state.lastUpdate,
      lastPrice: focusMarket ? focusMarket.lastPrice : null,
      strategy: state.strategyName,
      summary: buildSummary()
    },
    overview: {
      botActive: state.botActive,
      paperTrading: state.paperTrading,
      btcFilterEnabled,
      btcRegime: state.btcRegime,
      portfolioValue,
      sessionPnl,
      hasOpenPosition: state.positions.length > 0,
      bestCandidateSymbol: state.bestCandidateSymbol,
      positions: positionsWithDetails,
      activeCount: state.positions.length,
      entryCount: budget.activeCount
    },
    portfolio: {
      usdtBalance: state.usdtBalance,
      btcPosition: state.positions.reduce((sum, p) => sum + (p.lastPrice ? p.btcAmount * p.lastPrice : 0), 0),
      estimatedTotalValue: portfolioValue,
      sessionPnl,
      sessionPnlPercent,
      budgetCap: budget.budgetCap,
      budgetUsed: budget.budgetUsed,
      budgetRemaining: budget.budgetRemaining,
      entryCount: budget.entryCount
    },
    decision: focusMarket
      ? {
          action: focusMarket.displayAction,
          symbol: focusMarket.symbol,
          strategy: state.strategyName,
          rsi: focusMarket.rsi_5m,
          shortMa: focusMarket.ema9_5m,
          longMa: focusMarket.ema21_5m,
          ema9: focusMarket.ema9_5m,
          ema21: focusMarket.ema21_5m,
          warmingUp: focusMarket.warmingUp,
          missingIndicators: focusMarket.missingIndicators,
          entryPrice: focusMarket.entryPrice,
          stopLoss: focusMarket.stopLoss,
          takeProfit: focusMarket.takeProfit,
          score: focusMarket.compositeScore,
          compositeScore: focusMarket.compositeScore,
          reason: focusMarket.reason,
          focusMode,
          focusReason,
          shortExplanation: focusMarket.shortExplanation,
          detailedExplanation: focusMarket.detailedExplanation,
          reasonList: focusMarket.reasonList,
          ema20_1h: focusMarket.ema20_1h,
          ema50_1h: focusMarket.ema50_1h,
          trendBull_1h: focusMarket.trendBull_1h,
          trendSlope_1h: focusMarket.trendSlope_1h,
          trendLateral: focusMarket.trendLateral,
          ema9_5m: focusMarket.ema9_5m,
          ema21_5m: focusMarket.ema21_5m,
          rsi_5m: focusMarket.rsi_5m,
          atr14_5m: focusMarket.atr14_5m,
          macdHistogram: focusMarket.macdHistogram,
          macdLine: focusMarket.macdLine,
          signalLine: focusMarket.signalLine,
          volumeSMA20: focusMarket.volumeSMA20,
          currentVolume_5m: focusMarket.currentVolume_5m,
          triggerFired: focusMarket.triggerFired,
          highWaterMark: focusMarket.highWaterMark,
          trailingStop: focusMarket.trailingStop,
          holdCandles: focusMarket.holdCandles,
          entryCount: focusMarket.entryCount,
          entryEngine: focusMarket.entryType
        }
      : {
          action: "HOLD",
          symbol: null,
          strategy: state.strategyName,
          rsi: null,
          shortMa: null,
          longMa: null,
          ema9: null,
          ema21: null,
          warmingUp: true,
          missingIndicators: ["OHLCV"],
          entryPrice: null,
          stopLoss: null,
          takeProfit: null,
          score: null,
          compositeScore: null,
          reason: "Nessun mercato disponibile.",
          focusMode,
          focusReason,
          shortExplanation: "Il bot non ha ancora dati da mostrare.",
          detailedExplanation: "Il sistema e attivo ma non ha ancora ricevuto dati sufficienti per una valutazione.",
          reasonList: ["Trend: non disponibile", "RSI: non disponibile", "Prezzo: non valutabile", "Stato posizione: nessuna", "Decisione finale: HOLD"],
          ema20_1h: null,
          ema50_1h: null,
          trendBull_1h: null,
          trendSlope_1h: null,
          trendLateral: null,
          ema9_5m: null,
          ema21_5m: null,
          rsi_5m: null,
          atr14_5m: null,
          macdHistogram: null,
          macdLine: null,
          signalLine: null,
          volumeSMA20: null,
          currentVolume_5m: null,
          triggerFired: null,
          highWaterMark: null,
          trailingStop: null,
          holdCandles: 0,
          entryCount: 0,
          entryEngine: null
        },
    markets: SYMBOLS.map((symbol) => {
      const market = state.markets[symbol];
      if (!market) {
        return {
          symbol,
          lastPrice: null,
          trend: "non disponibile",
          signal: "HOLD",
          score: null,
          rsi: null,
          emaFast: null,
          emaSlow: null,
          isBestCandidate: false,
          isInPosition: false,
          reason: "In attesa di dati."
        };
      }

      return {
        symbol: market.symbol,
        lastPrice: market.lastPrice,
        trend: market.trend,
        signal: market.signal,
        score: market.score,
        rsi: market.rsi,
        emaFast: market.emaFast,
        emaSlow: market.emaSlow,
        isBestCandidate: state.bestCandidateSymbol === market.symbol,
        isInPosition: state.positions.some(p => p.symbol === market.symbol),
        reason: market.reason
      };
    }),
    stats
  };
}

/**
 * Send a JSON response through the local HTTP server.
 *
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} payload
 * @returns {void}
 */
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

/**
 * Read and parse a JSON request body.
 *
 * @param {http.IncomingMessage} request
 * @returns {Promise<any>}
 */
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

/**
 * Serve a static file from disk.
 *
 * @param {http.ServerResponse} response
 * @param {string} filePath
 * @param {string} contentType
 * @returns {void}
 */
function sendFile(response, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

/**
 * Persist the minimal paper-trading state to disk.
 *
 * @returns {void}
 */
function saveStateToDisk() {
  const persistedState = {
    usdtBalance: state.usdtBalance,
    positions: state.positions,
    trades: state.trades
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(persistedState, null, 2));
}

/**
 * Restore the persisted paper-trading state from disk if present.
 *
 * @returns {void}
 */
function loadStateFromDisk() {
  if (!fs.existsSync(STATE_FILE)) {
    return;
  }

  const rawState = fs.readFileSync(STATE_FILE, "utf-8");
  const persistedState = JSON.parse(rawState);

  if (typeof persistedState.usdtBalance === "number") {
    state.usdtBalance = persistedState.usdtBalance;
  }

  if (Array.isArray(persistedState.trades)) {
    state.trades = persistedState.trades;
  }

  if (persistedState.positions && Array.isArray(persistedState.positions)) {
    state.positions = persistedState.positions;
  }
}

/**
 * Recreate the trade log file as empty.
 *
 * @returns {void}
 */
function clearTradesLog() {
  fs.writeFileSync(TRADES_LOG_FILE, "");
}

/**
 * Reset the in-memory paper session and clear the trade log.
 *
 * @returns {void}
 */
function resetSession() {
  state.usdtBalance = INITIAL_USDT_BALANCE;
  state.positions = [];
  state.trades = [];
  state.markets = {};
  state.candleData = {};
  state.lastUpdate = null;
  state.bestCandidateSymbol = null;
  state.btcRegime = "risk-on";
  clearTradesLog();
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
  logScoped("SESSION", `reset | usdt_balance=${formatLogNumber(state.usdtBalance, 2)} | position=none`);
}

/**
 * Pick the best symbol currently worth focusing on.
 *
 * @param {object[]} snapshots
 * @returns {string | null}
 */
function pickBestCandidateSymbol(snapshots) {
  const eligibleBuyCandidates = snapshots
    .filter((snapshot) => snapshot.signal === "BUY candidate")
    .sort((left, right) => {
      if (right.compositeScore !== left.compositeScore) {
        return right.compositeScore - left.compositeScore;
      }

      return Number(right.triggerFired) - Number(left.triggerFired);
    });

  if (eligibleBuyCandidates.length > 0) {
    return eligibleBuyCandidates[0].symbol;
  }

  const scoredSnapshots = snapshots
    .filter((snapshot) => snapshot.lastPrice !== null)
    .sort((left, right) => {
      if (right.compositeScore !== left.compositeScore) {
        return right.compositeScore - left.compositeScore;
      }

      return Number(right.trendBull_1h) - Number(left.trendBull_1h);
    });

  return scoredSnapshots.length > 0 ? scoredSnapshots[0].symbol : null;
}

/**
 * Classify the BTC market regime from the latest 1h trend snapshot.
 *
 * @param {object | undefined} btcSnapshot
 * @returns {"risk-on" | "neutral" | "risk-off"}
 */
function getBtcRegime(btcSnapshot) {
  if (!btcSnapshot || btcSnapshot.ema20_1h === null || btcSnapshot.ema50_1h === null) {
    return "risk-on";
  }

  if (btcSnapshot.ema20_1h < btcSnapshot.ema50_1h) {
    return "risk-off";
  }

  if (btcSnapshot.trendSlope_1h !== null && btcSnapshot.trendSlope_1h > TREND_SLOPE_MIN) {
    return "risk-on";
  }

  return "neutral";
}

/**
 * Build the set of symbols still eligible for fresh entries under the current BTC regime.
 *
 * @param {"risk-on" | "neutral" | "risk-off"} btcRegime
 * @param {string[]} candidateSymbols
 * @returns {Set<string>}
 */
function getNeutralEligibleSymbols(btcRegime, candidateSymbols) {
  if (btcRegime !== "neutral") {
    return new Set(candidateSymbols);
  }

  return new Set(candidateSymbols.slice(0, NEUTRAL_TOP_N));
}

/**
 * Keep the dynamic watchlist small and stable while preserving the active position and BTC regime symbol.
 *
 * @param {string[]} symbols
 * @returns {string[]}
 */
function normalizeDynamicSymbols(symbols) {
  const normalized = [];
  const seen = new Set();

  const pushSymbol = (symbol) => {
    if (!symbol || seen.has(symbol) || normalized.length >= TOP_SYMBOLS_COUNT) {
      return;
    }

    seen.add(symbol);
    normalized.push(symbol);
  };

  for (const pos of state.positions) {
    pushSymbol(pos.symbol);
  }

  pushSymbol("BTC/USDT");

  for (const symbol of symbols) {
    pushSymbol(symbol);
  }

  return normalized;
}

/**
 * Select the subset of symbols that deserve realtime WS updates (Limit to 3 to prevent Binance 1008 stream errors).
 *
 * @param {string[]} activeSymbols
 * @returns {Set<string>}
 */
function selectRealtimeSymbols(activeSymbols) {
  const realtimeSymbols = [];
  const pushSymbol = (symbol) => {
    if (!symbol || realtimeSymbols.includes(symbol) || realtimeSymbols.length >= 3) {
      return;
    }
    realtimeSymbols.push(symbol);
  };

  for (const pos of state.positions) {
    pushSymbol(pos.symbol);
  }
  pushSymbol(state.bestCandidateSymbol);

  for (const symbol of activeSymbols) {
    pushSymbol(symbol);
  }

  return new Set(realtimeSymbols);
}

/**
 * Estimate execution slippage in basis points from the current vs average volume.
 *
 * @param {number | null} currentVolume
 * @param {number | null} volumeSMA
 * @param {number} baseSlippageBps
 * @returns {number}
 */
function calcSlippageBps(currentVolume, volumeSMA, baseSlippageBps = SLIPPAGE_BPS_BASE) {
  if (!Number.isFinite(currentVolume) || !Number.isFinite(volumeSMA) || volumeSMA <= 0) {
    return baseSlippageBps * 2;
  }

  const ratio = currentVolume / volumeSMA;
  if (ratio >= 1.5) return baseSlippageBps;
  if (ratio >= 1.0) return baseSlippageBps * 1.5;
  if (ratio >= 0.5) return baseSlippageBps * 2.0;
  return baseSlippageBps * 3.0;
}

/**
 * Compute a risk-based position size in USDT, capped by the absolute max allocation.
 *
 * @param {number} equity
 * @param {number} entryPrice
 * @param {number} stopLoss
 * @param {boolean} sfpValid
 * @returns {{positionSizePct: number, stopDistanceUsdt: number, sizeFromRiskUsdt: number}}
 */
function calculateRiskPositionSize(equity, entryPrice, stopLoss, sfpValid = false) {
  const stopDistanceUsdt = entryPrice - stopLoss;
  if (!Number.isFinite(equity) || !Number.isFinite(entryPrice) || !Number.isFinite(stopLoss) || stopDistanceUsdt <= 0) {
    return {
      positionSizePct: 0,
      stopDistanceUsdt: 0,
      sizeFromRiskUsdt: 0
    };
  }

  let sizeFromRiskUsdt = (equity * RISK_PCT_PER_TRADE * entryPrice) / stopDistanceUsdt;
  if (sfpValid) {
    sizeFromRiskUsdt *= 1.1;
  }

  const maxAllocationUsdt = equity * POSITION_SIZE_MAX;
  const cappedSizeUsdt = Math.min(sizeFromRiskUsdt, maxAllocationUsdt);

  return {
    positionSizePct: equity > 0 ? cappedSizeUsdt / equity : 0,
    stopDistanceUsdt,
    sizeFromRiskUsdt: cappedSizeUsdt
  };
}

/**
 * Compute a simulated execution for a buy order.
 *
 * @param {number} referencePrice
 * @param {number} notionalUsdt
 * @param {number} slippageBps
 * @returns {{executionPrice: number, btcAmount: number, feePaid: number, slippagePaid: number, cashOut: number}}
 */
function simulateBuyExecution(referencePrice, notionalUsdt, slippageBps) {
  const executionPrice = referencePrice * (1 + slippageBps / 10000);
  const btcAmount = executionPrice > 0 ? notionalUsdt / executionPrice : 0;
  const feePaid = notionalUsdt * (FEE_BPS / 10000);
  const slippagePaid = btcAmount * Math.max(0, executionPrice - referencePrice);

  return {
    executionPrice,
    btcAmount,
    feePaid,
    slippagePaid,
    cashOut: notionalUsdt + feePaid
  };
}

/**
 * Compute a simulated execution for a sell order.
 *
 * @param {number} referencePrice
 * @param {number} btcAmount
 * @param {number} slippageBps
 * @returns {{executionPrice: number, grossProceeds: number, feePaid: number, slippagePaid: number, netProceeds: number}}
 */
function simulateSellExecution(referencePrice, btcAmount, slippageBps) {
  const executionPrice = referencePrice * (1 - slippageBps / 10000);
  const grossProceeds = btcAmount * executionPrice;
  const feePaid = grossProceeds * (FEE_BPS / 10000);
  const slippagePaid = btcAmount * Math.max(0, referencePrice - executionPrice);

  return {
    executionPrice,
    grossProceeds,
    feePaid,
    slippagePaid,
    netProceeds: grossProceeds - feePaid
  };
}

let lastWsSubscribeTime = 0;

/**
 * Record repeated WebSocket remote closes and temporarily disable realtime mode when Binance starts rejecting streams.
 *
 * @param {Error} error
 * @returns {void}
 */
function registerWsFailure(error) {
  const message = String(error?.message || "");
  const normalizedMessage = message.toLowerCase();
  const isRemotePolicyClose = message.includes("1008") || normalizedMessage.includes("connection closed by remote server");
  const isTimeout = normalizedMessage.includes("timed out after");
  if (!isRemotePolicyClose && !isTimeout) {
    return;
  }

  const now = Date.now();
  wsFailureTimestamps.push(now);

  while (wsFailureTimestamps.length > 0 && now - wsFailureTimestamps[0] > WS_FAILURE_WINDOW_MS) {
    wsFailureTimestamps.shift();
  }

  if (wsFailureTimestamps.length >= WS_FAILURE_THRESHOLD) {
    wsDisabledUntil = now + WS_GLOBAL_COOLDOWN_MS;
    wsFailureTimestamps.length = 0;
    if (now - wsLastDisabledLogAt > 5000) {
      wsLastDisabledLogAt = now;
      logScoped("WS", `circuit_open | realtime_disabled_for=${WS_GLOBAL_COOLDOWN_MS}ms | reason=${isTimeout ? "repeated_timeouts" : "repeated_remote_closes"}`);
    }
  }
}

/**
 * Read OHLCV from WebSocket when available, then fall back to REST with exponential backoff.
 *
 * @param {ccxt.Exchange} restExchange
 * @param {ccxt.Exchange | null} streamExchange
 * @param {string} symbol
 * @param {"1h" | "5m" | "1m"} timeframe
 * @param {number} limit
 * @param {Set<string>} realtimeSymbols
 * @returns {Promise<Array<Array<number>>>}
 */
async function getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, timeframe, limit, realtimeSymbols) {
  const backoffKey = `${symbol}:${timeframe}`;
  const now = Date.now();
  const backoffUntil = wsBackoffUntil.get(backoffKey) || 0;
  const canUseWs =
    USE_CCXT_PRO_WS &&
    realtimeSymbols.has(symbol) &&
    WS_REALTIME_TIMEFRAMES.has(timeframe) &&
    streamExchange &&
    streamExchange.has &&
    streamExchange.has.watchOHLCV &&
    now >= backoffUntil &&
    now >= wsDisabledUntil;

  if (USE_CCXT_PRO_WS && now < wsDisabledUntil && now - wsLastDisabledLogAt > 5000) {
    wsLastDisabledLogAt = now;
    logScoped("WS", `cooldown_active | fallback=REST | retry_after=${wsDisabledUntil - now}ms`);
  }

  if (canUseWs) {
    try {
      const nowMs = Date.now();
      let delay = 0;
      if (lastWsSubscribeTime < nowMs) {
        lastWsSubscribeTime = nowMs;
      } else {
        lastWsSubscribeTime += 333; // ~3 richieste al secondo, sicuro e stabile per Binance
        delay = lastWsSubscribeTime - nowMs;
      }

      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }

      // [UPGRADE v2.4] Prefer ccxt.pro OHLCV streams but fall back to REST on any stream failure.
      let candles = await withTimeout(
        streamExchange.watchOHLCV(symbol, timeframe, undefined, limit),
        `${symbol} ${timeframe} watchOHLCV`,
        WS_WATCH_TIMEOUT_MS
      );
      wsBackoffDelay.delete(backoffKey);
      wsBackoffUntil.delete(backoffKey);
      
      if (Array.isArray(candles)) {
        const minRequired = timeframe === "1h" ? 60 : timeframe === "5m" ? 30 : 15;
        if (candles.length < minRequired) {
          const cached = state.candleData && state.candleData[symbol] && state.candleData[symbol][`candles_${timeframe}`] ? state.candleData[symbol][`candles_${timeframe}`] : [];
          if (cached.length > 0) {
            const mergedMap = new Map();
            for (const c of cached) mergedMap.set(c[0], c);
            for (const c of candles) mergedMap.set(c[0], c);
            candles = Array.from(mergedMap.values()).sort((a, b) => a[0] - b[0]);
          } else {
            try {
              const restCandles = await restExchange.fetchOHLCV(symbol, timeframe, undefined, limit);
              const mergedMap = new Map();
              for (const c of restCandles) mergedMap.set(c[0], c);
              for (const c of candles) mergedMap.set(c[0], c);
              candles = Array.from(mergedMap.values()).sort((a, b) => a[0] - b[0]);
            } catch (err) {}
          }
        }
        return candles.slice(-limit);
      }
      return [];
    } catch (error) {
      const previousDelay = wsBackoffDelay.get(backoffKey) || WS_BACKOFF_BASE_MS;
      const nextDelay = Math.min(previousDelay * 2, WS_BACKOFF_MAX_MS);
      wsBackoffDelay.set(backoffKey, nextDelay);
      wsBackoffUntil.set(backoffKey, Date.now() + nextDelay);
      registerWsFailure(error);
      logScoped("WS", `stream_error | symbol=${symbol} | timeframe=${timeframe} | fallback=REST | retry_in=${nextDelay}ms | message=${error.message}`);
    }
  }

  return withTimeout(
    restExchange.fetchOHLCV(symbol, timeframe, undefined, limit),
    `${symbol} ${timeframe} OHLCV`
  );
}

/**
 * Open a new paper position using ATR-based risk parameters.
 *
 * @param {object} snapshot
 * @returns {void}
 */
function openPaperPosition(snapshot) {
  // Verifichiamo se abbiamo già una posizione aperta su questo specifico simbolo
  const existingPosition = state.positions.find(p => p.symbol === snapshot.symbol);
  
  // Se non abbiamo una posizione su questo simbolo, verifichiamo il limite massimo di mercati contemporanei
  if (!existingPosition && state.positions.length >= MAX_CONCURRENT_POSITIONS) {
    return;
  }

  const cooldownExpiry = symbolCooldown.get(snapshot.symbol);
  if (cooldownExpiry !== undefined && cooldownExpiry > currentScanCycle) {
    logScoped("GUARD", `cooldown_active | symbol=${snapshot.symbol} | remaining=${cooldownExpiry - currentScanCycle} cycles`);
    return;
  }

  const recentExitExpiry = recentlyExitedExpiry.get(snapshot.symbol);
  if (recentlyExited.has(snapshot.symbol) && recentExitExpiry !== undefined && recentExitExpiry > currentScanCycle) {
    logScoped("GUARD", `recently_exited | symbol=${snapshot.symbol} | remaining=${recentExitExpiry - currentScanCycle} cycles`);
    return;
  }

  if (existingPosition && snapshot.lastFiveMinuteCandleTime !== null && existingPosition.lastEntryCandleTime === snapshot.lastFiveMinuteCandleTime) {
    return;
  }

  if (
    snapshot.currentVolume_5m === null ||
    snapshot.volumeSMA20 === null ||
    snapshot.currentVolume_5m < snapshot.volumeSMA20 * ENTRY_VOLUME_MULT
  ) {
    logScoped(
      "ENTRY",
      `rejected | symbol=${snapshot.symbol} | reason=volume_too_low | volume=${formatLogNumber(snapshot.currentVolume_5m, 2)} | sma=${formatLogNumber(snapshot.volumeSMA20, 2)} | required=${ENTRY_VOLUME_MULT}x`
    );
    return;
  }

  if (existingPosition && existingPosition.partialExitDone) {
    return;
  }

  const equity = getPortfolioValue();
  const entryEngine = snapshot.entryType || "trend_continuation";
  const plannedStopLoss = snapshot.sfpValid && snapshot.sfpStopLevel !== null
    ? snapshot.sfpStopLevel
    : snapshot.lastPrice - snapshot.atr14_5m * ATR_STOP_MULT;
  const riskSizing = calculateRiskPositionSize(equity, snapshot.lastPrice, plannedStopLoss, snapshot.sfpValid === true);
  const budget = getPositionBudgetMetrics();
  const feeRate = FEE_BPS / 10000;
  const requestedAllocation = Math.min(
    riskSizing.sizeFromRiskUsdt,
    state.usdtBalance / (1 + feeRate)
  );
  const usdtToUse = Math.max(
    0,
    Math.min(
      requestedAllocation,
      equity * POSITION_SIZE_MAX,
      budget.perTradeBudget, // Limitiamo ogni ingresso alla fetta destinata al singolo trade
      budget.budgetRemaining
    )
  );

  logScoped(
    "ENTRY",
    `sizing | symbol=${snapshot.symbol} | size_pct=${riskSizing.positionSizePct.toFixed(3)} | score=${snapshot.compositeScore} | sfp=${snapshot.sfpValid === true} | risk_pct=${RISK_PCT_PER_TRADE.toFixed(3)} | stop_distance=${formatLogNumber(riskSizing.stopDistanceUsdt, 4)} | size_from_risk=${formatLogNumber(riskSizing.sizeFromRiskUsdt, 2)}`
  );

  if (usdtToUse <= 0 || snapshot.lastPrice === null || snapshot.atr14_5m === null) {
    return;
  }

  const slippageBps = calcSlippageBps(snapshot.currentVolume_5m, snapshot.volumeSMA20);
  const buyExecution = simulateBuyExecution(snapshot.lastPrice, usdtToUse, slippageBps);
  if (buyExecution.cashOut > state.usdtBalance || buyExecution.btcAmount <= 0) {
    return;
  }

  const totalBtcAmount = (existingPosition ? existingPosition.btcAmount : 0) + buyExecution.btcAmount;
  const totalNotionalAllocated = (existingPosition ? existingPosition.usdtAllocated : 0) + usdtToUse;
  const totalCostBasis = (existingPosition ? existingPosition.costBasisUsdt : 0) + buyExecution.cashOut;
  const totalEntryFeesPaid = (existingPosition ? existingPosition.entryFeesPaid : 0) + buyExecution.feePaid;
  const totalEntrySlippagePaid = (existingPosition ? existingPosition.entrySlippagePaid : 0) + buyExecution.slippagePaid;
  const averageEntryPrice = totalNotionalAllocated / totalBtcAmount;
  const stopLoss = snapshot.sfpValid && snapshot.sfpStopLevel !== null
    ? snapshot.sfpStopLevel
    : averageEntryPrice - snapshot.atr14_5m * ATR_STOP_MULT;
  // Nuclear shield: ultima protezione assoluta, non lo stop operativo principale.
  const hardFloor = averageEntryPrice * (1 - HARD_STOP_PCT);
  const takeProfit = snapshot.sfpValid && snapshot.sfpStopLevel !== null
    ? averageEntryPrice + (averageEntryPrice - snapshot.sfpStopLevel) * ATR_TP_MULT
    : averageEntryPrice + snapshot.atr14_5m * ATR_TP_MULT;
  const initialRiskPerUnit = averageEntryPrice - stopLoss;
  const nextEntryCount = (existingPosition ? existingPosition.entryCount : 0) + 1;
  const tradeId = existingPosition ? existingPosition.tradeId : `T-${Date.now().toString(36).toUpperCase()}`;
  const tradeTime = new Date().toISOString();
  const budgetRemainingAfter = Math.max(0, budget.budgetCap - totalNotionalAllocated);
  const explanationShort = existingPosition
    ? `Il bot aggiunge un ingresso su ${snapshot.symbol}: il segnale resta forte e c'e ancora budget disponibile.`
    : snapshot.shortExplanation;
  const explanationDetailed = existingPosition
    ? `${snapshot.detailedExplanation} Il bot ha aggiunto un ingresso sullo stesso mercato per aumentare la posizione in modo controllato, mantenendo un margine di budget disponibile.`
    : snapshot.detailedExplanation;

  // [UPGRADE v2.1] Realistic execution and risk-based sizing are now applied on every paper entry.
  const positionData = {
    symbol: snapshot.symbol,
    entryPrice: averageEntryPrice,
    btcAmount: totalBtcAmount,
    usdtAllocated: totalNotionalAllocated,
    costBasisUsdt: totalCostBasis,
    entryFeesPaid: totalEntryFeesPaid,
    entrySlippagePaid: totalEntrySlippagePaid,
    atr: snapshot.atr14_5m,
    stopLoss,
    hardFloor,
    takeProfit,
    partialTargetPrice: averageEntryPrice + initialRiskPerUnit * PARTIAL_TP_R,
    partialExitDone: existingPosition ? existingPosition.partialExitDone === true : false,
    initialRiskPerUnit,
    highWaterMark: existingPosition ? Math.max(existingPosition.highWaterMark, snapshot.lastPrice) : snapshot.lastPrice,
    trailingActive: existingPosition ? existingPosition.trailingActive : false,
    trailingStop: existingPosition ? existingPosition.trailingStop : null,
    holdCandles: existingPosition ? existingPosition.holdCandles : 0,
    entryEMA20_1h: snapshot.ema20_1h,
    lastPrice: snapshot.lastPrice,
    entryCount: nextEntryCount,
    entryTime: existingPosition ? existingPosition.entryTime : Date.now(),
    entryEngine,
    tradeId,
    lastEntryCandleTime: snapshot.lastFiveMinuteCandleTime,
    lastEntryAt: tradeTime
  };

  if (existingPosition) {
    const idx = state.positions.findIndex(p => p.symbol === snapshot.symbol);
    state.positions[idx] = positionData;
  } else {
    state.positions.push(positionData);
  }

  state.usdtBalance -= buyExecution.cashOut;
  state.trades.push({
    time: tradeTime,
    symbol: snapshot.symbol,
    action: "BUY",
    price: buyExecution.executionPrice,
    btcAmount: buyExecution.btcAmount,
    usdtAmount: usdtToUse,
    pnlUsdt: null,
    netPnlUsdt: null,
    feePaid: buyExecution.feePaid,
    slippagePaid: buyExecution.slippagePaid,
    reason: snapshot.reason,
    explanationShort,
    detailedExplanation: explanationDetailed,
    reasonList: snapshot.reasonList,
    entryType: entryEngine,
    entryEngine,
    entryIndex: nextEntryCount,
    tradeId,
    budgetUsedAfter: totalNotionalAllocated,
    budgetRemainingAfter
  });

  appendTradeLog(
    `BUY | symbol=${snapshot.symbol} | tradeId=${tradeId} | entry=${entryEngine} | price=${formatAmount(buyExecution.executionPrice)} | btc=${formatAmount(buyExecution.btcAmount)} | usdt_spent=${formatAmount(usdtToUse)} | score=${snapshot.compositeScore} | atr=${formatAmount(snapshot.atr14_5m)} | sl=${formatAmount(stopLoss)} | tp=${formatAmount(takeProfit)} | hard_floor_nuclear=${formatAmount(hardFloor)} | feePaid=${formatAmount(buyExecution.feePaid)} | slippagePaid=${formatAmount(buyExecution.slippagePaid)} | netPnlUsdt=null | trend_1h=${snapshot.trendBull_1h ? "bullish" : "neutral"} | entry_count=${nextEntryCount} | reason=${snapshot.reason}`
  );
  logScoped(
    "TRADE",
    `${existingPosition ? "buy_add" : "buy"} | symbol=${snapshot.symbol} | engine=${entryEngine} | price=${formatLogNumber(buyExecution.executionPrice, 6)} | btc=${formatLogNumber(buyExecution.btcAmount, 6)} | usdt=${formatLogNumber(usdtToUse, 2)} | fee=${formatLogNumber(buyExecution.feePaid, 4)} | slip=${formatLogNumber(buyExecution.slippagePaid, 4)} | score=${snapshot.compositeScore} | sl=${formatLogNumber(stopLoss, 6)} | tp=${formatLogNumber(takeProfit, 6)} | entry_count=${nextEntryCount}`
  );
  saveStateToDisk();
}

/**
 * Execute a partial exit, realize PnL on half the position and move the stop to breakeven.
 *
 * @param {object} snapshot
 * @returns {void}
 */
function executePartialExit(snapshot) {
  const currentPos = state.positions.find(p => p.symbol === snapshot.symbol);
  if (!currentPos || !snapshot || snapshot.lastPrice === null || currentPos.partialExitDone) {
    return;
  }

  const exitAmount = currentPos.btcAmount * 0.5;
  const slippageBps = calcSlippageBps(snapshot.currentVolume_5m, snapshot.volumeSMA20);
  const execution = simulateSellExecution(snapshot.lastPrice, exitAmount, slippageBps);
  const positionBtcBefore = currentPos.btcAmount;
  const costShare = currentPos.costBasisUsdt * (exitAmount / positionBtcBefore);
  const notionalShare = currentPos.usdtAllocated * (exitAmount / positionBtcBefore);
  const netPnlUsdt = execution.netProceeds - costShare;

  currentPos.btcAmount -= exitAmount;
  currentPos.costBasisUsdt -= costShare;
  currentPos.usdtAllocated -= notionalShare;
  currentPos.partialExitDone = true;
  currentPos.stopLoss = currentPos.entryPrice;
  currentPos.trailingActive = true;
  currentPos.trailingStop = currentPos.entryPrice;
  currentPos.takeProfit = null;
  currentPos.lastPrice = snapshot.lastPrice;
  state.usdtBalance += execution.netProceeds;

  state.trades.push({
    time: new Date().toISOString(),
    symbol: currentPos.symbol,
    action: "SELL_PARTIAL",
    price: execution.executionPrice,
    btcAmount: exitAmount,
    usdtAmount: execution.netProceeds,
    pnlUsdt: netPnlUsdt,
    netPnlUsdt,
    feePaid: execution.feePaid,
    slippagePaid: execution.slippagePaid,
    reason: "Partial take profit reached.",
    explanationShort: "Il bot incassa una parte del profitto e lascia correre il resto.",
    detailedExplanation: `Il trade su ${currentPos.symbol} ha raggiunto ${PARTIAL_TP_R}R. Il bot chiude il 50% della posizione e sposta lo stop a breakeven sulla parte restante.`,
    reasonList: ["Decisione finale: SELL_PARTIAL", `Motivo: target parziale ${PARTIAL_TP_R}R raggiunto`, "Stop spostato a breakeven"],
    entryIndex: currentPos.entryCount,
    entryEngine: currentPos.entryEngine,
    tradeId: currentPos.tradeId,
    feePaidTotal: execution.feePaid,
    slippagePaidTotal: execution.slippagePaid
  });

  appendTradeLog(
    `SELL_PARTIAL | symbol=${currentPos.symbol} | tradeId=${currentPos.tradeId} | price=${formatAmount(execution.executionPrice)} | btc=${formatAmount(exitAmount)} | usdt_received=${formatAmount(execution.netProceeds)} | feePaid=${formatAmount(execution.feePaid)} | slippagePaid=${formatAmount(execution.slippagePaid)} | netPnlUsdt=${formatAmount(netPnlUsdt)} | reason=Partial take profit reached.`
  );
  logScoped(
    "TRADE",
    `sell_partial | symbol=${currentPos.symbol} | price=${formatLogNumber(execution.executionPrice, 6)} | btc=${formatLogNumber(exitAmount, 6)} | usdt=${formatLogNumber(execution.netProceeds, 2)} | fee=${formatLogNumber(execution.feePaid, 4)} | slip=${formatLogNumber(execution.slippagePaid, 4)} | net_pnl=${formatLogNumber(netPnlUsdt, 2)} | stop=breakeven`
  );
  saveStateToDisk();
}

/**
 * Update trailing state and decide whether the open paper position must exit.
 *
 * @param {object} snapshot
 * @returns {{shouldExit: boolean, exitReason: string | null, shouldPartialExit: boolean}}
 */
function manageOpenPosition(snapshot) {
  const currentPos = state.positions.find(p => p.symbol === snapshot.symbol);
  if (!currentPos || !snapshot || snapshot.lastPrice === null) {
    return { shouldExit: false, exitReason: null, shouldPartialExit: false };
  }

  const trailingAtr = snapshot.atr14_5m ?? currentPos.atr ?? null;
  currentPos.holdCandles = (currentPos.holdCandles || 0) + 1;
  currentPos.lastPrice = snapshot.lastPrice;
  currentPos.highWaterMark = Math.max(currentPos.highWaterMark || snapshot.lastPrice, snapshot.lastPrice);

  if (snapshot.lastPrice <= currentPos.hardFloor) return { shouldExit: true, exitReason: "Hard stop triggered.", shouldPartialExit: false };
  const elapsedSeconds = currentPos.entryTime ? (Date.now() - currentPos.entryTime) / 1000 : Number.MAX_SAFE_INTEGER;
  const halfRTarget = currentPos.entryPrice + currentPos.initialRiskPerUnit * 0.5;
  const partialTargetPrice = currentPos.partialTargetPrice || (currentPos.entryPrice + currentPos.initialRiskPerUnit * PARTIAL_TP_R);
  const partialTargetHit = !currentPos.partialExitDone && snapshot.lastPrice >= partialTargetPrice;

  if (partialTargetHit) {
    return { shouldExit: false, exitReason: "Partial TP reached", shouldPartialExit: true };
  }

  if (currentPos.partialExitDone) {
    const trailingCandidate = trailingAtr !== null
      ? currentPos.highWaterMark - trailingAtr * ATR_TRAIL_MULT
      : snapshot.ema21_5m !== null
        ? Math.max(snapshot.ema21_5m, currentPos.entryPrice)
        : currentPos.highWaterMark * (1 - TRAILING_PCT);

    currentPos.trailingActive = true;
    currentPos.trailingStop = Math.max(currentPos.trailingStop || trailingCandidate, trailingCandidate, currentPos.entryPrice);
  } else if (!currentPos.trailingActive && trailingAtr !== null && snapshot.lastPrice - currentPos.entryPrice >= trailingAtr) {
    currentPos.trailingActive = true;
    currentPos.trailingStop = trailingAtr !== null
      ? currentPos.highWaterMark - trailingAtr * ATR_TRAIL_MULT
      : currentPos.highWaterMark * (1 - TRAILING_PCT);
  } else if (currentPos.trailingActive) {
    const candidate = trailingAtr !== null
      ? currentPos.highWaterMark - trailingAtr * ATR_TRAIL_MULT
      : currentPos.highWaterMark * (1 - TRAILING_PCT);
    currentPos.trailingStop = Math.max(currentPos.trailingStop || candidate, candidate);
  }

  const trailingStopHit = currentPos.trailingActive && currentPos.trailingStop !== null && snapshot.lastPrice <= currentPos.trailingStop;
  const stopLossHit = snapshot.lastPrice <= currentPos.stopLoss;
  const takeProfitHit = !currentPos.partialExitDone && currentPos.takeProfit !== null && snapshot.lastPrice >= currentPos.takeProfit;
  const volumeAbsorptionHit =
    currentPos.holdCandles >= MIN_HOLD_CANDLES &&
    snapshot.currentVolume_5m !== null &&
    snapshot.volumeSMA20 !== null &&
    snapshot.previousClose_5m !== null &&
    snapshot.lastPrice_5m !== null &&
    snapshot.currentVolume_5m > snapshot.volumeSMA20 * 2.5 &&
    snapshot.lastPrice_5m <= snapshot.previousClose_5m;
  const trendReversalHit = currentPos.holdCandles >= MIN_HOLD_CANDLES && snapshot.trendBull_1h === false;
  const timeStopHit =
    currentPos.holdCandles >= TIME_STOP_CANDLES &&
    snapshot.lastPrice < halfRTarget;

  const hardExitHit = trailingStopHit || stopLossHit || takeProfitHit;
  const softExitHit = volumeAbsorptionHit || trendReversalHit || timeStopHit;

  if (softExitHit && !hardExitHit && elapsedSeconds < MIN_HOLD_SECONDS) {
    return { shouldExit: false, exitReason: null, shouldPartialExit: false };
  }

  if (trailingStopHit) return { shouldExit: true, exitReason: "Trailing stop reached.", shouldPartialExit: false };
  if (stopLossHit) return { shouldExit: true, exitReason: "ATR stop loss reached.", shouldPartialExit: false };
  if (takeProfitHit) return { shouldExit: true, exitReason: "Take profit reached.", shouldPartialExit: false };
  if (volumeAbsorptionHit) {
    return { shouldExit: true, exitReason: "Volume absorption detected.", shouldPartialExit: false };
  }
  if (trendReversalHit) return { shouldExit: true, exitReason: "1h trend reversed.", shouldPartialExit: false };
  if (timeStopHit) return { shouldExit: true, exitReason: "Time stop: trade flat", shouldPartialExit: false };

  return { shouldExit: false, exitReason: null, shouldPartialExit: false };
}

/**
 * Update the snapshot for the active position after management checks.
 *
 * @param {object} snapshot
 * @param {{shouldExit: boolean, exitReason: string | null}} management
 * @returns {void}
 */
function refreshPositionSnapshot(snapshot, management) {
  const currentPos = state.positions.find(p => p.symbol === snapshot.symbol);
  if (!snapshot || !currentPos) {
    return;
  }

  snapshot.positionOpen = true;
  snapshot.entryPrice = currentPos.entryPrice;
  snapshot.stopLoss = currentPos.stopLoss;
  snapshot.takeProfit = currentPos.takeProfit;
  snapshot.highWaterMark = currentPos.highWaterMark;
  snapshot.trailingStop = currentPos.trailingStop;
  snapshot.holdCandles = currentPos.holdCandles;
  snapshot.entryCount = currentPos.entryCount;
  snapshot.signal = management.shouldExit ? "SELL candidate" : "HOLD";
  snapshot.action = management.shouldExit ? "SELL" : "HOLD";
  snapshot.displayAction = management.shouldExit ? "SELL" : "HOLD";
  snapshot.reason = management.exitReason || "Posizione aperta ancora in gestione.";

  const explanation = renderDecisionExplanation(
    buildDecisionExplanationObject({
      ...snapshot,
      positionOpen: true
    })
  );

  snapshot.shortExplanation = explanation.shortExplanation;
  snapshot.detailedExplanation = explanation.detailedExplanation;
  snapshot.reasonList = explanation.reasonList;
}

/**
 * Close the active paper position and record the trade.
 *
 * @param {object} snapshot
 * @param {string} exitReason
 * @returns {void}
 */
function closePaperPosition(snapshot, exitReason) {
  const currentPos = state.positions.find(p => p.symbol === snapshot.symbol);
  if (!currentPos || !snapshot || snapshot.lastPrice === null) {
    return;
  }

  const closedSymbol = currentPos.symbol;
  const slippageBps = calcSlippageBps(snapshot.currentVolume_5m, snapshot.volumeSMA20);
  const execution = simulateSellExecution(snapshot.lastPrice, currentPos.btcAmount, slippageBps);
  const profit = execution.netProceeds - currentPos.costBasisUsdt;
  const explanation = renderDecisionExplanation(
    buildDecisionExplanationObject({
      ...snapshot,
      displayAction: "SELL",
      positionOpen: true,
      reason: exitReason
    })
  );

  state.trades.push({
    time: new Date().toISOString(),
    symbol: currentPos.symbol,
    action: "SELL_FULL",
    price: execution.executionPrice,
    btcAmount: currentPos.btcAmount,
    usdtAmount: execution.netProceeds,
    pnlUsdt: profit,
    netPnlUsdt: profit,
    feePaid: execution.feePaid,
    slippagePaid: execution.slippagePaid,
    reason: exitReason,
    explanationShort: explanation.shortExplanation,
    detailedExplanation: explanation.detailedExplanation,
    reasonList: explanation.reasonList,
    entryIndex: currentPos.entryCount,
    entryEngine: currentPos.entryEngine,
    tradeId: currentPos.tradeId,
    budgetUsedAfter: state.positions.reduce((sum, p) => p.symbol === closedSymbol ? sum : sum + p.usdtAllocated, 0),
    budgetRemainingAfter: (state.usdtBalance + execution.netProceeds) * MAX_POSITION_EXPOSURE_PCT // Nota: questa formula è una stima dell'esposizione libera
  });

  appendTradeLog(
    `SELL_FULL | symbol=${currentPos.symbol} | tradeId=${currentPos.tradeId} | price=${formatAmount(execution.executionPrice)} | btc=${formatAmount(currentPos.btcAmount)} | usdt_received=${formatAmount(execution.netProceeds)} | feePaid=${formatAmount(execution.feePaid)} | slippagePaid=${formatAmount(execution.slippagePaid)} | netPnlUsdt=${formatAmount(profit)} | holdCandles=${currentPos.holdCandles} | highWaterMark=${formatAmount(currentPos.highWaterMark)} | trailing=${currentPos.trailingStop === null ? "null" : formatAmount(currentPos.trailingStop)} | reason=${exitReason}`
  );
  logScoped(
    "TRADE",
    `sell_full | symbol=${currentPos.symbol} | price=${formatLogNumber(execution.executionPrice, 6)} | btc=${formatLogNumber(currentPos.btcAmount, 6)} | usdt=${formatLogNumber(execution.netProceeds, 2)} | fee=${formatLogNumber(execution.feePaid, 4)} | slip=${formatLogNumber(execution.slippagePaid, 4)} | net_pnl=${formatLogNumber(profit, 2)} | hold=${currentPos.holdCandles} | trailing=${currentPos.trailingStop === null ? "null" : formatLogNumber(currentPos.trailingStop, 6)} | reason=${exitReason}`
  );

  state.usdtBalance += execution.netProceeds;
  recentlyExited.add(closedSymbol);
  
  // Aumentato da 3 cicli a 30 cicli (circa 2.5 min a 5s ping) per impedire il rebuy fulmineo e dare tempo al mercato di respirare
  recentlyExitedExpiry.set(closedSymbol, currentScanCycle + 30);

  if (profit < 0) {
    symbolCooldown.set(closedSymbol, currentScanCycle + Math.max(30, LOSS_COOLDOWN_CYCLES));
  }

  state.positions = state.positions.filter(p => p.symbol !== closedSymbol);
  saveStateToDisk();
}

/**
 * Start the local dashboard HTTP server.
 *
 * @returns {void}
 */
function startServer() {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }

    const url = new URL(request.url, `http://${SERVER_HOST}:${SERVER_PORT}`);

    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, getStatusPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/trades") {
      sendJson(response, 200, { trades: state.trades });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      resetSession();
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

        btcFilterEnabled = body.enabled;
        sendJson(response, 200, { ok: true, btcFilterEnabled });
      } catch (error) {
        sendJson(response, 400, { ok: false, message: error.message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      sendFile(response, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/app.js") {
      sendFile(response, path.join(PUBLIC_DIR, "app.js"), "application/javascript; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/styles.css") {
      sendFile(response, path.join(PUBLIC_DIR, "styles.css"), "text/css; charset=utf-8");
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  server.listen(SERVER_PORT, SERVER_HOST, () => {
    logScoped("SERVER", `dashboard_ready | url=http://${SERVER_HOST}:${SERVER_PORT}`);
  });
}

/**
 * Discover the top liquid spot `/USDT` symbols from public ticker data.
 *
 * @param {ccxt.Exchange} exchange
 * @returns {Promise<string[]>}
 */
async function fetchTopSymbols(exchange) {
  const tickers = await withTimeout(exchange.fetchTickers(), "fetchTickers");

  return Object.entries(tickers)
    .map(([symbol, ticker]) => {
      const normalizedSymbol = ticker?.symbol || symbol;
      const [baseAsset, quoteAsset] = normalizedSymbol.split("/");

      const quoteVolume = Number(ticker?.quoteVolume);
      const baseVolume = Number(ticker?.baseVolume);
      const lastPrice = Number(ticker?.last);
      const openPrice = Number(ticker?.open);
      const highPrice = Number(ticker?.high);
      const lowPrice = Number(ticker?.low);
      const bidPrice = Number(ticker?.bid);
      const askPrice = Number(ticker?.ask);
      const infoQuoteVolume = Number(ticker?.info?.quoteVolume);
      const volumeScore = Number.isFinite(quoteVolume) && quoteVolume > 0
        ? quoteVolume
        : Number.isFinite(baseVolume) && Number.isFinite(lastPrice) && baseVolume > 0 && lastPrice > 0
          ? baseVolume * lastPrice
          : Number.isFinite(infoQuoteVolume) && infoQuoteVolume > 0
            ? infoQuoteVolume
            : 0;

      const percentage = Number.isFinite(ticker?.percentage) ? Math.abs(ticker.percentage) : 0;
      const hotnessScore = volumeScore * (1 + (percentage / 100) * 5); // Boost volume by 5x the percentage change

      return {
        symbol: normalizedSymbol,
        baseAsset,
        quoteAsset,
        active: ticker?.active !== false,
        volumeScore,
        hotnessScore,
        lastPrice,
        openPrice,
        highPrice,
        lowPrice,
        bidPrice,
        askPrice
      };
    })
    .filter((ticker) => {
      if (!ticker.symbol || !ticker.baseAsset || !["USDT", "USDC", "FDUSD"].includes(ticker.quoteAsset)) {
        return false;
      }

      if (!ticker.active) {
        return false;
      }

      if (EXCLUDED_BASE_ASSETS.has(ticker.baseAsset.toUpperCase())) {
        return false;
      }

      if (LEVERAGED_TOKEN_REGEX.test(ticker.baseAsset)) {
        return false;
      }

      if (/[^\x20-\x7E]/.test(ticker.baseAsset)) {
        return false;
      }

      if (ticker.baseAsset.length > 10) {
        return false;
      }

      if (!Number.isFinite(ticker.volumeScore) || ticker.volumeScore < 500000) {
        return false;
      }

      if (Number.isFinite(ticker.lastPrice) && ticker.lastPrice < 0.0001) {
        return false;
      }

      if (Number.isFinite(ticker.highPrice) && Number.isFinite(ticker.lowPrice) && Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0) {
        const atrPct = (ticker.highPrice - ticker.lowPrice) / ticker.lastPrice;
        if (atrPct < 0.005 || atrPct > 0.08) {
          return false;
        }
      }

      if (Number.isFinite(ticker.highPrice) && Number.isFinite(ticker.lowPrice) && Number.isFinite(ticker.openPrice) && Number.isFinite(ticker.lastPrice)) {
        const fullRange = ticker.highPrice - ticker.lowPrice;
        if (fullRange > 0) {
          const wickRatio = (fullRange - Math.abs(ticker.openPrice - ticker.lastPrice)) / fullRange;
          if (wickRatio > 0.65) {
            return false;
          }
        }
      }

      if (Number.isFinite(ticker.bidPrice) && Number.isFinite(ticker.askPrice) && ticker.askPrice > 0) {
        const spreadPct = (ticker.askPrice - ticker.bidPrice) / ticker.askPrice;
        if (spreadPct > SPREAD_MAX_PCT) {
          return false;
        }
      }

      return true;
    })
    .sort((left, right) => right.hotnessScore - left.hotnessScore)
    .slice(0, TOP_SYMBOLS_COUNT)
    .map((ticker) => ticker.symbol);
}

/**
 * Fetch OHLCV data in sequential batches, preferring WebSocket streams and falling back to REST.
 *
 * @param {ccxt.Exchange} restExchange
 * @param {ccxt.Exchange | null} streamExchange
 * @param {string[]} symbols
 * @param {Set<string>} realtimeSymbols
 * @returns {Promise<Array<{symbol: string, candleSet: {candles_1h: Array<Array<number>>, candles_5m: Array<Array<number>>, candles_1m: Array<Array<number>>}}>>}
 */
async function fetchCandlesBatched(restExchange, streamExchange, symbols, realtimeSymbols) {
  const results = [];

  for (let index = 0; index < symbols.length; index += BATCH_SIZE) {
    const batchSymbols = symbols.slice(index, index + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batchSymbols.map(async (symbol) => {
        const [candles_1h, candles_5m, candles_1m] = await Promise.all([
          getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, "1h", FETCH_LIMIT_1H, realtimeSymbols),
          getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, "5m", FETCH_LIMIT_5M, realtimeSymbols),
          getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, "1m", FETCH_LIMIT_1M, realtimeSymbols)
        ]);

        return {
          symbol,
          candleSet: {
            candles_1h,
            candles_5m,
            candles_1m
          }
        };
      })
    );

    for (const [batchOffset, result] of batchResults.entries()) {
      if (result.status !== "fulfilled") {
        logScoped("FETCH", `market_error | symbol=${batchSymbols[batchOffset]} | message=${result.reason?.message || "Unknown error"}`);
        continue;
      }

      results.push(result.value);
    }

    if (index + BATCH_SIZE < symbols.length && BATCH_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return results;
}

/**
 * Rotate clearly weak markets out of the active watchlist using the last known candidate pool.
 *
 * @param {Record<string, any>} currentMarkets
 * @param {string[]} allCandidates
 * @returns {string[]}
 */
function rotateWatchlist(currentMarkets, allCandidates) {
  for (const symbol of [...recentlyDropped]) {
    const expiryCycle = recentlyDroppedExpiry.get(symbol);
    if (expiryCycle === undefined || expiryCycle <= watchlistRotationCycle) {
      recentlyDropped.delete(symbol);
      recentlyDroppedExpiry.delete(symbol);
    }
  }

  const currentSymbols = SYMBOLS.length > 0 ? [...SYMBOLS] : Object.keys(currentMarkets || {});
  if (currentSymbols.length === 0 || !Array.isArray(allCandidates) || allCandidates.length === 0) {
    return currentSymbols;
  }

  const activeSymbols = new Set(currentSymbols);
  const droppedSymbols = new Set();
  const deadSymbols = currentSymbols.filter((symbol) => {
    if (state.positions.some(p => p.symbol === symbol)) {
      return false;
    }

    const market = currentMarkets[symbol];
    if (!market) {
      return false;
    }

    return market.trendBull_1h === false && market.setupValid === false && market.compositeScore <= 2;
  });

  if (deadSymbols.length === 0) {
    return currentSymbols;
  }

  const rotatedSymbols = [...currentSymbols];

  for (const deadSymbol of deadSymbols) {
    const replacement = allCandidates.find((candidateSymbol) => {
      if (activeSymbols.has(candidateSymbol)) {
        return false;
      }

      if (droppedSymbols.has(candidateSymbol) || recentlyDropped.has(candidateSymbol)) {
        return false;
      }

      return true;
    });

    if (!replacement) {
      continue;
    }

    const deadIndex = rotatedSymbols.indexOf(deadSymbol);
    if (deadIndex === -1) {
      continue;
    }

    rotatedSymbols[deadIndex] = replacement;
    activeSymbols.delete(deadSymbol);
    activeSymbols.add(replacement);
    droppedSymbols.add(deadSymbol);
    recentlyDropped.add(deadSymbol);
    recentlyDroppedExpiry.set(deadSymbol, watchlistRotationCycle + RECENTLY_DROPPED_TTL_CYCLES);
    logScoped("WATCHLIST", `rotate | dropped=${deadSymbol} | reason=dead | added=${replacement}`);
  }

  return rotatedSymbols;
}

/**
 * Main bot loop: fetch candles, build snapshots, manage the open position and scan all markets.
 *
 * @returns {Promise<void>}
 */
async function main() {
  if (!PAPER_TRADING) {
    throw new Error("Process blocked: PAPER_TRADING=false. Real trading is not allowed.");
  }

  const ExchangeClass = ccxt[EXCHANGE_ID];
  if (!ExchangeClass) {
    throw new Error(`Unsupported exchange: ${EXCHANGE_ID}`);
  }

  const exchange = new ExchangeClass({
    enableRateLimit: true
  });
  const ProExchangeClass = USE_CCXT_PRO_WS && ccxt.pro ? ccxt.pro[EXCHANGE_ID] : null;
  const streamExchange = ProExchangeClass
    ? new ProExchangeClass({
        enableRateLimit: true
      })
    : null;
  if (USE_CCXT_PRO_WS && !streamExchange) {
    logScoped("WS", `unavailable | exchange=${EXCHANGE_ID} | mode=REST_only`);
  }

  state.botActive = true;
  state.botStartedAt = new Date().toISOString();
  // [UPGRADE v2.2] Restore persisted paper state before the dashboard and loop come online.
  loadStateFromDisk();
  if (state.positions.length > 0) {
    logScoped("SESSION", `restored | positions=${state.positions.length} | usdt=${formatLogNumber(state.usdtBalance, 2)} | trades=${state.trades.length}`);
  }

  startServer();

  let scanCycle = 0;
  let allCandidates = [];
  let lastCompletedCycleAt = Date.now();
  let lastWatchdogLogAt = 0;
  let lastRealtimeSymbolsLabel = "";
  let lastWatchlistRefreshTime = Date.now();

  setInterval(() => {
    if (!state.botActive) {
      return;
    }

    const stalledForMs = Date.now() - lastCompletedCycleAt;
    if (stalledForMs >= LOOP_STALL_WARNING_MS && Date.now() - lastWatchdogLogAt >= LOOP_STALL_WARNING_MS) {
      lastWatchdogLogAt = Date.now();
      logScoped("WATCHDOG", `loop_stalled | stalled_for=${stalledForMs}ms | symbols=${SYMBOLS.length} | source=${SYMBOLS_SOURCE}`);
    }
  }, Math.min(LOOP_STALL_WARNING_MS, 10000));

  if (HAS_STATIC_SYMBOLS) {
    SYMBOLS = [...configuredSymbols];
    for (const pos of state.positions) {
      if (!SYMBOLS.includes(pos.symbol)) {
        SYMBOLS = [pos.symbol, ...SYMBOLS];
      }
    }
    SYMBOLS_SOURCE = "SYMBOLS";
    logScoped("WATCHLIST", `loaded | count=${SYMBOLS.length} | source=${SYMBOLS_SOURCE}`);
    logScoped("WATCHLIST", `symbols | ${SYMBOLS.join(", ")}`);
  } else {
    const discoveredSymbols = await fetchTopSymbols(exchange);
    allCandidates = normalizeDynamicSymbols(discoveredSymbols);
    SYMBOLS = allCandidates.length > 0 ? [...allCandidates] : normalizeDynamicSymbols([DEFAULT_SYMBOL]);
    SYMBOLS_SOURCE = allCandidates.length > 0 ? "dynamic" : "fallback";
    logScoped("WATCHLIST", `dynamic_loaded | count=${SYMBOLS.length}`);
    logScoped("WATCHLIST", `symbols | ${SYMBOLS.join(", ")}`);

    if (allCandidates.length === 0) {
      logScoped("WATCHLIST", `dynamic_empty | fallback=${DEFAULT_SYMBOL}`);
    }
  }

  const initialRealtimeSymbols = [...selectRealtimeSymbols(SYMBOLS)];
  lastRealtimeSymbolsLabel = initialRealtimeSymbols.join(",");
  logScoped(
    "BOOT",
    `started | exchange=${EXCHANGE_ID} | symbols=${SYMBOLS.length} | source=${SYMBOLS_SOURCE} | paper=${PAPER_TRADING} | interval=${POLL_INTERVAL_MS}ms | market_data=${streamExchange ? "hybrid_WS+REST" : "REST_only"} | ws_symbols=${initialRealtimeSymbols.length > 0 ? initialRealtimeSymbols.join(",") : "none"}`
  );

  while (true) {
    try {
      currentScanCycle = scanCycle;

      for (const [symbol, expiryCycle] of symbolCooldown.entries()) {
        if (expiryCycle <= currentScanCycle) {
          symbolCooldown.delete(symbol);
        }
      }

      for (const symbol of [...recentlyExited]) {
        const expiryCycle = recentlyExitedExpiry.get(symbol);
        if (expiryCycle === undefined || expiryCycle <= currentScanCycle) {
          recentlyExited.delete(symbol);
          recentlyExitedExpiry.delete(symbol);
        }
      }

      if (!HAS_STATIC_SYMBOLS && (Date.now() - lastWatchlistRefreshTime >= 300000)) {
        lastWatchlistRefreshTime = Date.now();
        const refreshedSymbols = await fetchTopSymbols(exchange);

        if (refreshedSymbols.length > 0) {
          const previousCandidates = [...allCandidates];
          allCandidates = normalizeDynamicSymbols(refreshedSymbols);

          const candidatesChanged = previousCandidates.join(",") !== allCandidates.join(",");
          logScoped("WATCHLIST", `refresh | candidates=${allCandidates.length} | changed=${candidatesChanged ? "yes" : "no"}`);
          if (candidatesChanged) {
            logScoped("WATCHLIST", `candidates | ${allCandidates.join(", ")}`);
          }
        } else {
          logScoped("WATCHLIST", "refresh_skipped | reason=no_symbols_returned");
        }
      }

      const realtimeSymbols = selectRealtimeSymbols(SYMBOLS);
      const realtimeSymbolsLabel = [...realtimeSymbols].join(",");
      if (realtimeSymbolsLabel !== lastRealtimeSymbolsLabel) {
        lastRealtimeSymbolsLabel = realtimeSymbolsLabel;
        logScoped("WS", `symbols_update | ws_symbols=${realtimeSymbolsLabel || "none"} | rest_symbols=${Math.max(0, SYMBOLS.length - realtimeSymbols.size)}`);
      }

      const candleResults = await fetchCandlesBatched(exchange, streamExchange, SYMBOLS, realtimeSymbols);

      state.candleData = {};
      const nextMarkets = {};
      for (const result of candleResults) {
        state.candleData[result.symbol] = result.candleSet;
        nextMarkets[result.symbol] = buildMarketSnapshot(result.symbol, result.candleSet);
      }

      state.markets = nextMarkets;
      state.lastUpdate = new Date().toISOString();
      const btcSnapshot = state.markets["BTC/USDT"];
      const btcRegime = getBtcRegime(btcSnapshot);
      const openSymbols = new Set(state.positions.map(p => p.symbol));
      const candidateUniverse = HAS_STATIC_SYMBOLS
        ? SYMBOLS.filter((symbol) => !openSymbols.has(symbol))
        : allCandidates.length > 0
          ? allCandidates
          : SYMBOLS;
      const neutralEligibleSymbols = getNeutralEligibleSymbols(btcRegime, candidateUniverse);
      state.btcRegime = btcRegime;

      // [UPGRADE v2.3] BTC regime is now three-state and can throttle fresh entries before execution.
      if (btcFilterEnabled && btcRegime !== "risk-on") {
        for (const market of Object.values(state.markets)) {
          if (!market || market.positionOpen || market.action !== "BUY") {
            continue;
          }

          const neutralBlocked = btcRegime === "neutral" && !neutralEligibleSymbols.has(market.symbol);
          if (btcRegime === "neutral" && !neutralBlocked) {
            continue;
          }

          const regimeMessage = btcRegime === "risk-off"
            ? `Filtro BTC attivo: regime BTC ${btcRegime}, nuovi ingressi sospesi anche con score ${market.compositeScore}/10.`
            : `Filtro BTC attivo: regime BTC ${btcRegime}, ${market.symbol} fuori dalla top ${NEUTRAL_TOP_N} osservabile in questa fase.`;

          market.action = "HOLD";
          market.signal = "HOLD";
          market.displayAction = "HOLD";
          market.reason = regimeMessage;
          market.entryBlockers = [...new Set([
            ...(market.entryBlockers || []),
            btcRegime === "risk-off"
              ? "Filtro BTC: regime 1h risk-off"
              : `Filtro BTC: solo top ${NEUTRAL_TOP_N} simboli ammessi in regime neutral`
          ])];

          const explanation = renderDecisionExplanation(
            buildDecisionExplanationObject({
              ...market,
              positionOpen: false
            })
          );

          market.shortExplanation = explanation.shortExplanation;
          market.detailedExplanation = explanation.detailedExplanation;
          market.reasonList = explanation.reasonList;
        }
      }

      if (!HAS_STATIC_SYMBOLS) {
        watchlistRotationCycle = scanCycle;
        const rotatedSymbols = rotateWatchlist(state.markets, allCandidates);
        SYMBOLS = normalizeDynamicSymbols(rotatedSymbols);
      }

      let positionClosedThisCycle = false;

      const symbolsToClose = [];

      for (const pos of state.positions) {
        const positionMarket = state.markets[pos.symbol];
        if (!positionMarket) continue;

        const management = manageOpenPosition(positionMarket);
        if (management.shouldPartialExit) {
          executePartialExit(positionMarket);
          refreshPositionSnapshot(positionMarket, { shouldExit: false, exitReason: null });
        } else {
          refreshPositionSnapshot(positionMarket, management);
        }

        if (management.shouldExit && management.exitReason) {
          symbolsToClose.push({ market: positionMarket, reason: management.exitReason });
        } else if (
          !management.shouldPartialExit &&
          positionMarket.action === "BUY" &&
          positionMarket.compositeScore >= MIN_SCORE_ENTRY
        ) {
          // Re-entry or scaling logic
          const neutralBlocked = btcFilterEnabled && btcRegime === "neutral" && !neutralEligibleSymbols.has(positionMarket.symbol);
          if (btcFilterEnabled && btcRegime === "risk-off") {
            logScoped("GUARD", `btc_regime_risk_off | scaling_blocked | symbol=${pos.symbol}`);
          } else if (neutralBlocked) {
            logScoped("GUARD", `btc_regime_neutral | scaling_blocked | symbol=${pos.symbol} | top_limit=${NEUTRAL_TOP_N}`);
          } else {
            const previousEntryCount = pos.entryCount;
            openPaperPosition(positionMarket);
            const updatedPos = state.positions.find(p => p.symbol === pos.symbol);
            if (updatedPos && updatedPos.entryCount !== previousEntryCount) {
              refreshPositionSnapshot(positionMarket, { shouldExit: false, exitReason: null });
            }
          }
        }
      }

      for (const { market, reason } of symbolsToClose) {
        closePaperPosition(market, reason);
        positionClosedThisCycle = true;
      }

      const tradableBuyCandidate = Object.values(state.markets)
        .filter((market) => market.signal === "BUY candidate")
        .sort((left, right) => {
          if (right.compositeScore !== left.compositeScore) {
            return right.compositeScore - left.compositeScore;
          }

          return Number(right.triggerFired) - Number(left.triggerFired);
        })
        .find((market) => {
          if (btcFilterEnabled && btcRegime === "neutral" && !neutralEligibleSymbols.has(market.symbol)) {
            return false;
          }

          const cooldownExpiry = symbolCooldown.get(market.symbol);
          if (cooldownExpiry !== undefined && cooldownExpiry > currentScanCycle) {
            return false;
          }

          const recentExitExpiry = recentlyExitedExpiry.get(market.symbol);
          if (recentlyExited.has(market.symbol) && recentExitExpiry !== undefined && recentExitExpiry > currentScanCycle) {
            return false;
          }

          return true;
        });

      state.bestCandidateSymbol = tradableBuyCandidate ? tradableBuyCandidate.symbol : pickBestCandidateSymbol(Object.values(state.markets));

      if (state.positions.length < MAX_CONCURRENT_POSITIONS && !positionClosedThisCycle && state.bestCandidateSymbol) {
        const bestMarket = state.markets[state.bestCandidateSymbol];
        if (bestMarket && bestMarket.action === "BUY" && bestMarket.compositeScore >= MIN_SCORE_ENTRY) {
          const neutralBlocked = btcFilterEnabled && btcRegime === "neutral" && !neutralEligibleSymbols.has(bestMarket.symbol);
          if (btcFilterEnabled && btcRegime === "risk-off") {
            logScoped("GUARD", "btc_regime_risk_off | entry_blocked");
          } else if (neutralBlocked) {
            logScoped("GUARD", `btc_regime_neutral | entry_blocked | symbol=${bestMarket.symbol} | top_limit=${NEUTRAL_TOP_N}`);
          } else {
            const countBefore = state.positions.length;
            openPaperPosition(bestMarket);

            const newPos = state.positions.find(p => p.symbol === bestMarket.symbol);
            if (newPos && state.positions.length > countBefore) {
              refreshPositionSnapshot(bestMarket, { shouldExit: false, exitReason: null });
            } else if (state.positions.length === countBefore && !state.positions.some(p => p.symbol === bestMarket.symbol)) {
              logScoped(
                "ENTRY",
                `blocked_internal | symbol=${bestMarket.symbol} | score=${bestMarket.compositeScore} | volume=${formatLogNumber(bestMarket.currentVolume_5m, 2)} | volume_sma=${formatLogNumber(bestMarket.volumeSMA20, 2)} | action=${bestMarket.action}`
              );
            }
          }
        }
      }

      logCycleSummary(scanCycle, realtimeSymbols);
    } catch (error) {
      logScoped("ERROR", `market_scan | exchange=${EXCHANGE_ID} | message=${error.message}`, { dedupe: false });
    }

    lastCompletedCycleAt = Date.now();
    scanCycle += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  state.botActive = false;
  logScoped("FATAL", `paper=${PAPER_TRADING} | message=${error.message}`, { dedupe: false });
  process.exit(1);
});
