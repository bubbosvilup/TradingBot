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
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);
const INITIAL_USDT_BALANCE = Number(process.env.INITIAL_USDT_BALANCE || 10);
const OHLCV_LIMIT = Math.max(Number(process.env.OHLCV_LIMIT || 100), 100);
const TOP_SYMBOLS_COUNT = Math.max(Number(process.env.TOP_SYMBOLS_COUNT || 40), 1);
const SYMBOLS_REFRESH_CYCLES = Math.max(Number(process.env.SYMBOLS_REFRESH_CYCLES || 120), 1);
const BATCH_SIZE = Math.max(Number(process.env.BATCH_SIZE || 5), 1);
const BATCH_DELAY_MS = Math.max(Number(process.env.BATCH_DELAY_MS || 500), 0);
const ATR_STOP_MULT = Number(process.env.ATR_STOP_MULT || 1.5);
const ATR_TP_MULT = Number(process.env.ATR_TP_MULT || 3.0);
const ATR_TRAIL_MULT = Number(process.env.ATR_TRAIL_MULT || 2.0);
const TRAILING_PCT = Number(process.env.TRAILING_PCT || 0.007);
const HARD_STOP_PCT = Number(process.env.HARD_STOP_PCT || 0.05);
const POSITION_SIZE_PCT = Number(process.env.POSITION_SIZE_PCT || 0.4);
const MIN_SCORE_ENTRY = Number(process.env.MIN_SCORE_ENTRY || 6);
const MIN_HOLD_CANDLES = Number(process.env.MIN_HOLD_CANDLES || 5);
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
const EXCLUDED_BASE_ASSETS = new Set(["USDC", "BUSD", "TUSD", "FDUSD", "DAI", "USDP", "EUR", "GBP", "WBTC", "WETH", "STETH", "WSTETH", "RETH"]);
const LEVERAGED_TOKEN_REGEX = /\d+[LS]$/i;
const RECENTLY_DROPPED_TTL_CYCLES = 10;
const recentlyDropped = new Set();
const recentlyDroppedExpiry = new Map();
let watchlistRotationCycle = 0;

const state = {
  botActive: false,
  botStartedAt: null,
  lastUpdate: null,
  usdtBalance: INITIAL_USDT_BALANCE,
  position: null,
  trades: [],
  markets: {},
  candleData: {},
  bestCandidateSymbol: null,
  strategyName: STRATEGY_NAME,
  exchange: EXCHANGE_ID,
  paperTrading: PAPER_TRADING
};

/**
 * Print a timestamped message to stdout.
 *
 * @param {string} message
 * @returns {void}
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
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
    reason: snapshot.reason,
    symbol: snapshot.symbol
  };
}

function renderDecisionExplanation(explanationObject) {
  const { action, trend, rsiState, priceState, positionState, warmingUp, missingIndicators, reason, symbol } = explanationObject;
  let shortExplanation;
  let detailedExplanation;

  if (warmingUp) {
    shortExplanation = pickVariant(
      [
        `Il bot aspetta su ${symbol}: i dati non sono ancora sufficienti.`,
        `Su ${symbol} il bot resta fermo: gli indicatori non sono pronti.`,
        `Il bot non agisce su ${symbol}: serve ancora un po' di storico.`
      ],
      reason
    );
    detailedExplanation = `Il bot non prende decisioni su ${symbol} finche non ha dati sufficienti su 1h, 5m e 1m. In questo momento mancano ancora: ${missingIndicators.join(", ")}. Per questo la scelta finale resta HOLD.`;
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
    detailedExplanation = `Il bot non apre una posizione su ${symbol} perche il trend sul timeframe orario non e rialzista. In questo sistema il filtro a 1 ora deve essere favorevole prima ancora di valutare il setup operativo.`;
  } else if (rsiState !== "favorevole") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: la forza del movimento non e nella zona giusta.`,
        `Il bot non compra ${symbol}: l'RSI non conferma un ingresso prudente.`,
        `Il bot aspetta su ${symbol}: il ritmo del mercato non e adatto a entrare ora.`
      ],
      reason
    );
    detailedExplanation = `Su ${symbol} il filtro di trend puo anche essere buono, ma l'RSI sul 5 minuti non si trova nella fascia operativa scelta. Il bot preferisce evitare ingressi quando il mercato e troppo debole o troppo tirato.`;
  } else if (priceState !== "vicino al punto di ingresso") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: il prezzo non e in una zona di ingresso sensata.`,
        `Il bot non entra su ${symbol}: il prezzo e troppo lontano dalla media operativa.`,
        `Il bot aspetta su ${symbol}: preferisce un pullback piu ordinato.`
      ],
      reason
    );
    detailedExplanation = `Anche se parte del contesto e interessante, il prezzo di ${symbol} non si trova abbastanza vicino alla zona di pullback definita sul 5 minuti. Il bot evita di inseguire movimenti gia estesi.`;
  } else {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: al momento non vede un'opportunita pulita.`,
        `Il bot aspetta su ${symbol}: il quadro non e abbastanza convincente.`,
        `Il bot non agisce su ${symbol}: preferisce attendere condizioni piu lineari.`
      ],
      reason
    );
    detailedExplanation = `Il bot non ha trovato su ${symbol} un insieme di condizioni abbastanza coerente per comprare o vendere. Per questo mantiene un comportamento prudente e resta in HOLD.`;
  }

  return {
    shortExplanation,
    detailedExplanation,
    reasonList: [
      `Trend: ${trend}`,
      `RSI: ${rsiState}`,
      `Prezzo: ${priceState}`,
      `Stato posizione: ${positionState}`,
      `Decisione finale: ${action}`
    ]
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

  const ema20_1h = calculateEma(closes_1h, EMA20_1H_PERIOD);
  const ema50_1h = calculateEma(closes_1h, EMA50_1H_PERIOD);
  const trendBull_1h = ema20_1h !== null && ema50_1h !== null ? ema20_1h > ema50_1h : false;

  const ema9_5m = calculateEma(closes_5m, EMA9_5M_PERIOD);
  const ema21_5m = calculateEma(closes_5m, EMA21_5M_PERIOD);
  const rsi_5m = wilderRsi(closes_5m, RSI_PERIOD);
  const atr14_5m = calculateAtr(candles_5m, ATR_PERIOD);
  const volumeSMA20 = calculateSma(volumes_5m, VOLUME_SMA_PERIOD);
  const currentVolume_5m = volumes_5m.length > 0 ? volumes_5m[volumes_5m.length - 1] : null;
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
      ? Math.abs(lastPrice_5m - ema21_5m) <= atr14_5m * 0.5
      : false;
  const volumeOk =
    currentVolume_5m !== null && volumeSMA20 !== null
      ? currentVolume_5m >= volumeSMA20 * VOLUME_MULT
      : false;
  const macdPositive = macd !== null ? macd.histogram > 0 : false;
  const latestOneMinuteTimestamp = candles_1m.length > 0 ? Number(candles_1m[candles_1m.length - 1][0]) : null;
  const previousOneMinuteTimestamp = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][0]) : null;
  const previousOneMinuteClose = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][4]) : null;
  const previousOneMinuteLow = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][3]) : null;
  const swingLow = findSwingLow(candles_5m, 30, 3);
  const sfpSweep = swingLow !== null && previousOneMinuteLow !== null ? previousOneMinuteLow < swingLow.value : false;
  const sfpReclaim = swingLow !== null && previousOneMinuteClose !== null ? previousOneMinuteClose > swingLow.value : false;
  const sfpValid = swingLow !== null && sfpSweep && sfpReclaim && trendBull_1h;
  const sfpStopLevel = sfpValid ? previousOneMinuteLow : null;
  const triggerFired =
    previousOneMinuteTimestamp !== null &&
    latestOneMinuteTimestamp !== null &&
    latestOneMinuteTimestamp > previousOneMinuteTimestamp &&
    previousOneMinuteClose !== null &&
    ema9_1m !== null
      ? previousOneMinuteClose > ema9_1m
      : false;
  const setupValid =
    !warmingUp &&
    ema9_5m > ema21_5m &&
    rsi_5m >= RSI_MIN &&
    rsi_5m <= RSI_MAX &&
    pullbackZoneOk &&
    volumeOk &&
    macdPositive;

  let compositeScore = 0;
  if (trendBull_1h) compositeScore += 2;
  if (ema20_1h !== null && ema50_1h !== null && ema20_1h > ema50_1h * 1.003) compositeScore += 1;
  if (setupValid) compositeScore += 2;
  if (rsi_5m !== null && rsi_5m >= 47 && rsi_5m <= 58) compositeScore += 1;
  if (macd !== null && macd.prevHistogram !== null && macd.histogram > macd.prevHistogram) compositeScore += 1;
  if (currentVolume_5m !== null && volumeSMA20 !== null && currentVolume_5m > volumeSMA20 * 1.4) compositeScore += 1;
  if (lastPrice_5m !== null && ema9_5m !== null && ema21_5m !== null && lastPrice_5m > ema9_5m && lastPrice_5m > ema21_5m) compositeScore += 1;
  if (triggerFired) compositeScore += 1;
  if (sfpValid) compositeScore += 3;

  const positionOpen = state.position !== null && state.position.symbol === symbol;
  const classicEntryValid = setupValid && triggerFired;
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
  } else if (!classicEntryValid && !sfpValid && !setupValid) {
    reason = "Setup 5m non valido.";
  } else if (!classicEntryValid && !sfpValid && !triggerFired) {
    reason = "Trigger 1m non ancora confermato.";
  } else if (compositeScore < MIN_SCORE_ENTRY) {
    signal = "BUY candidate";
    reason = sfpValid
      ? `SFP valido ma score ${compositeScore}/10 sotto soglia ${MIN_SCORE_ENTRY}.`
      : `Setup valido ma score ${compositeScore}/10 sotto soglia ${MIN_SCORE_ENTRY}.`;
  } else {
    signal = "BUY candidate";
    action = "BUY";
    displayAction = "BUY";
    entryType = sfpValid ? "sfp" : "classic";
    reason = sfpValid
      ? "Liquidity spring / SFP confermato: sweep del minimo e recupero del livello."
      : "Tutti i livelli sono allineati e il punteggio e sufficiente per entrare.";
  }

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
    score: compositeScore,
    compositeScore,
    positionOpen,
    shortExplanation: explanation.shortExplanation,
    detailedExplanation: explanation.detailedExplanation,
    reasonList: explanation.reasonList,
    ema20_1h,
    ema50_1h,
    trendBull_1h,
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
    triggerFired,
    setupValid,
    swingLow,
    sfpSweep,
    sfpReclaim,
    sfpValid,
    sfpStopLevel,
    entryType,
    emaFast: ema9_5m,
    emaSlow: ema21_5m,
    rsi: rsi_5m,
    previousClose_5m,
    lastFiveMinuteCandleTime: candles_5m.length > 0 ? candles_5m[candles_5m.length - 1][0] : null,
    entryPrice: positionOpen ? state.position.entryPrice : null,
    stopLoss: positionOpen ? state.position.stopLoss : null,
    takeProfit: positionOpen ? state.position.takeProfit : null,
    highWaterMark: positionOpen ? state.position.highWaterMark : null,
    trailingStop: positionOpen ? state.position.trailingStop : null,
    holdCandles: positionOpen ? state.position.holdCandles : 0,
    entryCount: positionOpen ? state.position.entryCount : 0
  };
}

/**
 * Estimate total portfolio value in USDT using the latest open-position price.
 *
 * @returns {number}
 */
function getPortfolioValue() {
  const btcValue = state.position && state.position.lastPrice ? state.position.btcAmount * state.position.lastPrice : 0;
  return state.usdtBalance + btcValue;
}

/**
 * Compute the current position budget usage and remaining buying room.
 *
 * @returns {{budgetCap: number, budgetUsed: number, budgetRemaining: number, entryCount: number}}
 */
function getPositionBudgetMetrics() {
  const portfolioValue = getPortfolioValue();
  const budgetCap = portfolioValue * MAX_POSITION_EXPOSURE_PCT;
  const budgetUsed = state.position ? state.position.usdtAllocated : 0;

  return {
    budgetCap,
    budgetUsed,
    budgetRemaining: Math.max(0, budgetCap - budgetUsed),
    entryCount: state.position ? state.position.entryCount : 0
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
  const closedTrades = state.trades.filter((trade) => trade.action === "SELL");
  const profitableTrades = closedTrades.filter((trade) => trade.pnlUsdt !== null && trade.pnlUsdt > 0);
  const losingTrades = closedTrades.filter((trade) => trade.pnlUsdt !== null && trade.pnlUsdt < 0);
  const totalClosedPnl = closedTrades.reduce((total, trade) => total + (trade.pnlUsdt || 0), 0);
  const averageClosedTradePnl = closedTrades.length === 0 ? 0 : totalClosedPnl / closedTrades.length;
  const lastTrade = state.trades.length === 0 ? null : state.trades[state.trades.length - 1];

  return {
    totalTrades: state.trades.length,
    profitableTrades: profitableTrades.length,
    losingTrades: losingTrades.length,
    sessionPnl: getSessionPnl(),
    averageClosedTradePnl,
    lastTrade,
    hasOpenPosition: state.position !== null
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

  if (state.position) {
    return `Il bot e attivo, sta gestendo una posizione su ${state.position.symbol} e continua a osservare gli altri mercati. Risultato sessione: ${sessionPnlLabel}.`;
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
  if (state.position && state.markets[state.position.symbol]) {
    return state.markets[state.position.symbol];
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
  const focusSymbol = focusMarket ? focusMarket.symbol : state.position ? state.position.symbol : state.bestCandidateSymbol;
  let focusMode = "no_data";
  let focusReason = "Nessun mercato ha ancora dati sufficienti.";

  if (focusMarket) {
    if (state.position && focusMarket.symbol === state.position.symbol) {
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

  return {
    bot: {
      active: state.botActive,
      exchange: state.exchange,
      symbol: focusSymbol || DEFAULT_SYMBOL,
      paperTrading: state.paperTrading,
      startedAt: state.botStartedAt,
      lastUpdate: state.lastUpdate,
      lastPrice: focusMarket ? focusMarket.lastPrice : null,
      strategy: state.strategyName,
      summary: buildSummary()
    },
    overview: {
      botActive: state.botActive,
      paperTrading: state.paperTrading,
      portfolioValue,
      sessionPnl,
      hasOpenPosition: state.position !== null,
      bestCandidateSymbol: state.bestCandidateSymbol,
      positionSymbol: state.position ? state.position.symbol : null,
      entryCount: budget.entryCount
    },
    portfolio: {
      usdtBalance: state.usdtBalance,
      btcPosition: state.position ? state.position.btcAmount : 0,
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
          entryCount: focusMarket.entryCount
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
          entryCount: 0
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
        isInPosition: state.position ? state.position.symbol === market.symbol : false,
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
  state.position = null;
  state.trades = [];
  state.markets = {};
  state.candleData = {};
  state.lastUpdate = null;
  state.bestCandidateSymbol = null;
  clearTradesLog();
  log(`Session reset | usdt_balance=${formatAmount(state.usdtBalance)} | position=none`);
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
 * Convert a strategy score into an allocation multiplier.
 *
 * @param {number} score
 * @returns {number}
 */
function getScoreMultiplier(score) {
  if (score >= 9) return 1.0;
  if (score === 8) return 0.85;
  if (score === 7) return 0.7;
  if (score === 6) return 0.55;
  return 0;
}

/**
 * Open a new paper position using ATR-based risk parameters.
 *
 * @param {object} snapshot
 * @returns {void}
 */
function openPaperPosition(snapshot) {
  if (state.position && state.position.symbol !== snapshot.symbol) {
    return;
  }

  const existingPosition = state.position && state.position.symbol === snapshot.symbol ? state.position : null;
  if (existingPosition && snapshot.lastFiveMinuteCandleTime !== null && existingPosition.lastEntryCandleTime === snapshot.lastFiveMinuteCandleTime) {
    return;
  }

  const baseAllocation = state.usdtBalance * POSITION_SIZE_PCT;
  const scoreMultiplier = getScoreMultiplier(snapshot.compositeScore);
  const requestedAllocation = baseAllocation * scoreMultiplier;
  const budget = getPositionBudgetMetrics();
  const usdtToUse = Math.max(
    0,
    Math.min(
      requestedAllocation,
      state.usdtBalance * MAX_POSITION_EXPOSURE_PCT,
      budget.budgetRemaining
    )
  );

  if (usdtToUse <= 0 || snapshot.lastPrice === null || snapshot.atr14_5m === null) {
    return;
  }

  const btcAmount = usdtToUse / snapshot.lastPrice;
  const totalBtcAmount = (existingPosition ? existingPosition.btcAmount : 0) + btcAmount;
  const totalUsdtAllocated = (existingPosition ? existingPosition.usdtAllocated : 0) + usdtToUse;
  const averageEntryPrice = totalUsdtAllocated / totalBtcAmount;
  const entryType = snapshot.sfpValid ? "sfp" : "classic";
  const stopLoss = snapshot.sfpValid && snapshot.sfpStopLevel !== null
    ? snapshot.sfpStopLevel
    : averageEntryPrice - snapshot.atr14_5m * ATR_STOP_MULT;
  // Nuclear shield: ultima protezione assoluta, non lo stop operativo principale.
  const hardFloor = averageEntryPrice * (1 - HARD_STOP_PCT);
  const takeProfit = snapshot.sfpValid && snapshot.sfpStopLevel !== null
    ? averageEntryPrice + (averageEntryPrice - snapshot.sfpStopLevel) * ATR_TP_MULT
    : averageEntryPrice + snapshot.atr14_5m * ATR_TP_MULT;
  const nextEntryCount = (existingPosition ? existingPosition.entryCount : 0) + 1;
  const tradeTime = new Date().toISOString();
  const budgetRemainingAfter = Math.max(0, budget.budgetCap - totalUsdtAllocated);
  const explanationShort = existingPosition
    ? `Il bot aggiunge un ingresso su ${snapshot.symbol}: il segnale resta forte e c'e ancora budget disponibile.`
    : snapshot.shortExplanation;
  const explanationDetailed = existingPosition
    ? `${snapshot.detailedExplanation} Il bot ha aggiunto un ingresso sullo stesso mercato per aumentare la posizione in modo controllato, mantenendo un margine di budget disponibile.`
    : snapshot.detailedExplanation;

  state.position = {
    symbol: snapshot.symbol,
    entryPrice: averageEntryPrice,
    btcAmount: totalBtcAmount,
    usdtAllocated: totalUsdtAllocated,
    atr: snapshot.atr14_5m,
    stopLoss,
    hardFloor,
    takeProfit,
    highWaterMark: existingPosition ? Math.max(existingPosition.highWaterMark, snapshot.lastPrice) : snapshot.lastPrice,
    trailingActive: existingPosition ? existingPosition.trailingActive : false,
    trailingStop: existingPosition ? existingPosition.trailingStop : null,
    holdCandles: existingPosition ? existingPosition.holdCandles : 0,
    entryEMA20_1h: snapshot.ema20_1h,
    lastPrice: snapshot.lastPrice,
    entryCount: nextEntryCount,
    lastEntryCandleTime: snapshot.lastFiveMinuteCandleTime,
    lastEntryAt: tradeTime
  };

  state.usdtBalance -= usdtToUse;
  state.trades.push({
    time: tradeTime,
    symbol: snapshot.symbol,
    action: "BUY",
    price: snapshot.lastPrice,
    btcAmount,
    usdtAmount: usdtToUse,
    pnlUsdt: null,
    reason: snapshot.reason,
    explanationShort,
    detailedExplanation: explanationDetailed,
    reasonList: snapshot.reasonList,
    entryType,
    entryIndex: nextEntryCount,
    budgetUsedAfter: totalUsdtAllocated,
    budgetRemainingAfter
  });

  appendTradeLog(
    `BUY | symbol=${snapshot.symbol} | entry=${entryType} | price=${formatAmount(snapshot.lastPrice)} | btc=${formatAmount(btcAmount)} | usdt_spent=${formatAmount(usdtToUse)} | score=${snapshot.compositeScore} | atr=${formatAmount(snapshot.atr14_5m)} | sl=${formatAmount(stopLoss)} | tp=${formatAmount(takeProfit)} | hard_floor_nuclear=${formatAmount(hardFloor)} | trend_1h=bullish | entry_count=${nextEntryCount} | reason=${snapshot.reason}`
  );
  log(
    `Paper ${existingPosition ? "BUY ADD" : "BUY"} | symbol=${snapshot.symbol} | entry=${entryType} | buy_price=${formatAmount(snapshot.lastPrice)} | btc_bought=${formatAmount(btcAmount)} | usdt_spent=${formatAmount(usdtToUse)} | score=${snapshot.compositeScore} | atr=${formatAmount(snapshot.atr14_5m)} | sl=${formatAmount(stopLoss)} | tp=${formatAmount(takeProfit)} | hard_floor_nuclear=${formatAmount(hardFloor)} | trend_1h=bullish | entry_count=${nextEntryCount} | budget_used=${formatAmount(totalUsdtAllocated)} | budget_remaining=${formatAmount(budgetRemainingAfter)} | reason=${snapshot.reason}`
  );
}

/**
 * Update trailing state and decide whether the open paper position must exit.
 *
 * @param {object} snapshot
 * @returns {{shouldExit: boolean, exitReason: string | null}}
 */
function manageOpenPosition(snapshot) {
  if (!state.position || !snapshot || snapshot.lastPrice === null) {
    return { shouldExit: false, exitReason: null };
  }

  const trailingAtr = snapshot.atr14_5m ?? state.position.atr ?? null;
  state.position.holdCandles += 1;
  state.position.lastPrice = snapshot.lastPrice;
  state.position.highWaterMark = Math.max(state.position.highWaterMark, snapshot.lastPrice);

  if (!state.position.trailingActive && trailingAtr !== null && snapshot.lastPrice - state.position.entryPrice >= trailingAtr) {
    state.position.trailingActive = true;
    state.position.trailingStop = trailingAtr !== null
      ? state.position.highWaterMark - trailingAtr * ATR_TRAIL_MULT
      : state.position.highWaterMark * (1 - TRAILING_PCT);
  }

  if (state.position.trailingActive) {
    const candidate = trailingAtr !== null
      ? state.position.highWaterMark - trailingAtr * ATR_TRAIL_MULT
      : state.position.highWaterMark * (1 - TRAILING_PCT);
    state.position.trailingStop = Math.max(state.position.trailingStop || candidate, candidate);
  }

  if (snapshot.lastPrice <= state.position.hardFloor) return { shouldExit: true, exitReason: "Hard stop triggered." };
  if (state.position.trailingActive && state.position.trailingStop !== null && snapshot.lastPrice <= state.position.trailingStop) return { shouldExit: true, exitReason: "Trailing stop reached." };
  if (snapshot.lastPrice <= state.position.stopLoss) return { shouldExit: true, exitReason: "ATR stop loss reached." };
  if (snapshot.lastPrice >= state.position.takeProfit) return { shouldExit: true, exitReason: "Take profit reached." };
  if (
    state.position.holdCandles >= MIN_HOLD_CANDLES &&
    snapshot.currentVolume_5m !== null &&
    snapshot.volumeSMA20 !== null &&
    snapshot.previousClose_5m !== null &&
    snapshot.lastPrice_5m !== null &&
    snapshot.currentVolume_5m > snapshot.volumeSMA20 * 2.5 &&
    snapshot.lastPrice_5m <= snapshot.previousClose_5m
  ) {
    return { shouldExit: true, exitReason: "Volume absorption detected." };
  }
  if (state.position.holdCandles >= MIN_HOLD_CANDLES && snapshot.trendBull_1h === false) return { shouldExit: true, exitReason: "1h trend reversed." };

  return { shouldExit: false, exitReason: null };
}

/**
 * Update the snapshot for the active position after management checks.
 *
 * @param {object} snapshot
 * @param {{shouldExit: boolean, exitReason: string | null}} management
 * @returns {void}
 */
function refreshPositionSnapshot(snapshot, management) {
  if (!snapshot || !state.position || snapshot.symbol !== state.position.symbol) {
    return;
  }

  snapshot.positionOpen = true;
  snapshot.entryPrice = state.position.entryPrice;
  snapshot.stopLoss = state.position.stopLoss;
  snapshot.takeProfit = state.position.takeProfit;
  snapshot.highWaterMark = state.position.highWaterMark;
  snapshot.trailingStop = state.position.trailingStop;
  snapshot.holdCandles = state.position.holdCandles;
  snapshot.entryCount = state.position.entryCount;
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
  if (!state.position || !snapshot || snapshot.lastPrice === null) {
    return;
  }

  const exitUsdt = state.position.btcAmount * snapshot.lastPrice;
  const profit = exitUsdt - state.position.usdtAllocated;
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
    symbol: state.position.symbol,
    action: "SELL",
    price: snapshot.lastPrice,
    btcAmount: state.position.btcAmount,
    usdtAmount: exitUsdt,
    pnlUsdt: profit,
    reason: exitReason,
    explanationShort: explanation.shortExplanation,
    detailedExplanation: explanation.detailedExplanation,
    reasonList: explanation.reasonList,
    entryIndex: state.position.entryCount,
    budgetUsedAfter: 0,
    budgetRemainingAfter: (state.usdtBalance + exitUsdt) * MAX_POSITION_EXPOSURE_PCT
  });

  appendTradeLog(
    `SELL | symbol=${state.position.symbol} | price=${formatAmount(snapshot.lastPrice)} | btc=${formatAmount(state.position.btcAmount)} | usdt_received=${formatAmount(exitUsdt)} | pnl_usdt=${formatAmount(profit)} | holdCandles=${state.position.holdCandles} | highWaterMark=${formatAmount(state.position.highWaterMark)} | trailing=${state.position.trailingStop === null ? "null" : formatAmount(state.position.trailingStop)} | reason=${exitReason}`
  );
  log(
    `Paper SELL | symbol=${state.position.symbol} | sell_price=${formatAmount(snapshot.lastPrice)} | btc_sold=${formatAmount(state.position.btcAmount)} | usdt_received=${formatAmount(exitUsdt)} | pnl_usdt=${formatAmount(profit)} | holdCandles=${state.position.holdCandles} | highWaterMark=${formatAmount(state.position.highWaterMark)} | trailing=${state.position.trailingStop === null ? "null" : formatAmount(state.position.trailingStop)} | reason=${exitReason}`
  );

  state.usdtBalance += exitUsdt;
  state.position = null;
}

/**
 * Start the local dashboard HTTP server.
 *
 * @returns {void}
 */
function startServer() {
  const server = http.createServer((request, response) => {
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
    log(`Dashboard available | url=http://${SERVER_HOST}:${SERVER_PORT}`);
  });
}

/**
 * Discover the top liquid spot `/USDT` symbols from public ticker data.
 *
 * @param {ccxt.Exchange} exchange
 * @returns {Promise<string[]>}
 */
async function fetchTopSymbols(exchange) {
  const tickers = await exchange.fetchTickers();

  return Object.entries(tickers)
    .map(([symbol, ticker]) => {
      const normalizedSymbol = ticker?.symbol || symbol;
      const [baseAsset, quoteAsset] = normalizedSymbol.split("/");

      const quoteVolume = Number(ticker?.quoteVolume);
      const baseVolume = Number(ticker?.baseVolume);
      const lastPrice = Number(ticker?.last);
      const infoQuoteVolume = Number(ticker?.info?.quoteVolume);
      const volumeScore = Number.isFinite(quoteVolume) && quoteVolume > 0
        ? quoteVolume
        : Number.isFinite(baseVolume) && Number.isFinite(lastPrice) && baseVolume > 0 && lastPrice > 0
          ? baseVolume * lastPrice
          : Number.isFinite(infoQuoteVolume) && infoQuoteVolume > 0
            ? infoQuoteVolume
            : 0;

      return {
        symbol: normalizedSymbol,
        baseAsset,
        quoteAsset,
        active: ticker?.active !== false,
        volumeScore,
        lastPrice
      };
    })
    .filter((ticker) => {
      if (!ticker.symbol || !ticker.baseAsset || ticker.quoteAsset !== "USDT") {
        return false;
      }

      if (!ticker.symbol.endsWith("/USDT") || !ticker.active) {
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

      if (!Number.isFinite(ticker.volumeScore) || ticker.volumeScore < 50000) {
        return false;
      }

      if (Number.isFinite(ticker.lastPrice) && ticker.lastPrice < 0.000001) {
        return false;
      }

      return true;
    })
    .sort((left, right) => right.volumeScore - left.volumeScore)
    .slice(0, TOP_SYMBOLS_COUNT)
    .map((ticker) => ticker.symbol);
}

/**
 * Fetch OHLCV data in sequential batches to stay well below public rate limits.
 *
 * @param {ccxt.Exchange} exchange
 * @param {string[]} symbols
 * @returns {Promise<Array<{symbol: string, candleSet: {candles_1h: Array<Array<number>>, candles_5m: Array<Array<number>>, candles_1m: Array<Array<number>>}}>>}
 */
async function fetchCandlesBatched(exchange, symbols) {
  const results = [];

  for (let index = 0; index < symbols.length; index += BATCH_SIZE) {
    const batchSymbols = symbols.slice(index, index + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batchSymbols.map(async (symbol) => {
        const [candles_1h, candles_5m, candles_1m] = await Promise.all([
          exchange.fetchOHLCV(symbol, "1h", undefined, FETCH_LIMIT_1H),
          exchange.fetchOHLCV(symbol, "5m", undefined, FETCH_LIMIT_5M),
          exchange.fetchOHLCV(symbol, "1m", undefined, FETCH_LIMIT_1M)
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
        log(`Market fetch error | symbol=${batchSymbols[batchOffset]} | message=${result.reason?.message || "Unknown error"}`);
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
    if (state.position?.symbol === symbol) {
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
    log(`Watchlist rotate | dropped=${deadSymbol} reason=dead | added=${replacement}`);
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

  state.botActive = true;
  state.botStartedAt = new Date().toISOString();

  startServer();

  let scanCycle = 0;
  let allCandidates = [];

  if (HAS_STATIC_SYMBOLS) {
    SYMBOLS = [...configuredSymbols];
    SYMBOLS_SOURCE = "SYMBOLS";
    log(`Loaded ${SYMBOLS.length} market(s) from ${SYMBOLS_SOURCE}.`);
    log(`Loaded symbols: ${SYMBOLS.join(", ")}`);
  } else {
    const discoveredSymbols = await fetchTopSymbols(exchange);
    allCandidates = [...discoveredSymbols];
    if (!allCandidates.includes("BTC/USDT")) {
      allCandidates.push("BTC/USDT");
    }
    SYMBOLS = discoveredSymbols.length > 0 ? [...discoveredSymbols] : [DEFAULT_SYMBOL];
    if (!SYMBOLS.includes("BTC/USDT")) {
      SYMBOLS.push("BTC/USDT");
    }
    SYMBOLS_SOURCE = discoveredSymbols.length > 0 ? "dynamic" : "fallback";
    log(`Dynamic discovery loaded ${SYMBOLS.length} market(s).`);
    log(`Loaded symbols: ${SYMBOLS.join(", ")}`);

    if (discoveredSymbols.length === 0) {
      log(`Dynamic discovery returned no symbols. Fallback active on ${DEFAULT_SYMBOL}.`);
    }
  }

  log(`Bot started | exchange=${EXCHANGE_ID} | symbols=${SYMBOLS.join(",")} | source=${SYMBOLS_SOURCE} | PAPER_TRADING=${PAPER_TRADING} | interval=${POLL_INTERVAL_MS}ms`);

  while (true) {
    try {
      if (!HAS_STATIC_SYMBOLS && scanCycle > 0 && scanCycle % SYMBOLS_REFRESH_CYCLES === 0) {
        const refreshedSymbols = await fetchTopSymbols(exchange);

        if (refreshedSymbols.length > 0) {
          const previousCandidates = [...allCandidates];
          allCandidates = [...refreshedSymbols];
          if (!allCandidates.includes("BTC/USDT")) {
            allCandidates.push("BTC/USDT");
          }

          if (state.position && !allCandidates.includes(state.position.symbol)) {
            allCandidates = [state.position.symbol, ...allCandidates];
          }

          if (!SYMBOLS.includes("BTC/USDT")) {
            SYMBOLS = [...SYMBOLS, "BTC/USDT"];
          }

          const candidatesChanged = previousCandidates.join(",") !== allCandidates.join(",");
          log(`Dynamic watchlist refresh | candidates=${allCandidates.length} | changed=${candidatesChanged ? "yes" : "no"}`);
          if (candidatesChanged) {
            log(`Candidate symbols: ${allCandidates.join(", ")}`);
          }
        } else {
          log("Dynamic watchlist refresh skipped: no symbols returned, keeping previous candidate pool.");
        }
      }

      const candleResults = await fetchCandlesBatched(exchange, SYMBOLS);

      state.candleData = {};
      const nextMarkets = {};
      for (const result of candleResults) {
        state.candleData[result.symbol] = result.candleSet;
        nextMarkets[result.symbol] = buildMarketSnapshot(result.symbol, result.candleSet);
      }

      state.markets = nextMarkets;
      state.lastUpdate = new Date().toISOString();
      const btcRegimeBull = state.markets["BTC/USDT"] ? state.markets["BTC/USDT"].trendBull_1h === true : true;

      if (!HAS_STATIC_SYMBOLS) {
        watchlistRotationCycle = scanCycle;
        const rotatedSymbols = rotateWatchlist(state.markets, allCandidates);

        if (state.position && !rotatedSymbols.includes(state.position.symbol)) {
          SYMBOLS = [state.position.symbol, ...rotatedSymbols.filter((symbol) => symbol !== state.position.symbol)];
        } else {
          SYMBOLS = rotatedSymbols;
        }

        if (!SYMBOLS.includes("BTC/USDT")) {
          SYMBOLS = [...SYMBOLS, "BTC/USDT"];
        }
      }

      let positionClosedThisCycle = false;

      if (state.position) {
        const positionMarket = state.markets[state.position.symbol];

        if (positionMarket) {
          const management = manageOpenPosition(positionMarket);
          refreshPositionSnapshot(positionMarket, management);

          if (management.shouldExit && management.exitReason) {
            closePaperPosition(positionMarket, management.exitReason);
            positionClosedThisCycle = true;
          } else if (
            positionMarket.trendBull_1h &&
            positionMarket.setupValid &&
            positionMarket.triggerFired &&
            positionMarket.compositeScore >= MIN_SCORE_ENTRY
          ) {
            if (!btcRegimeBull) {
              log("BTC regime bear: no new entries.");
            } else {
              const previousEntryCount = state.position.entryCount;
              openPaperPosition(positionMarket);

              if (state.position && state.position.entryCount !== previousEntryCount) {
                refreshPositionSnapshot(positionMarket, { shouldExit: false, exitReason: null });
              }
            }
          }
        }
      }

      state.bestCandidateSymbol = pickBestCandidateSymbol(Object.values(state.markets));

      if (!state.position && !positionClosedThisCycle && state.bestCandidateSymbol) {
        const bestMarket = state.markets[state.bestCandidateSymbol];
        if (bestMarket && bestMarket.action === "BUY" && bestMarket.compositeScore >= MIN_SCORE_ENTRY) {
          if (!btcRegimeBull) {
            log("BTC regime bear: no new entries.");
          } else {
          openPaperPosition(bestMarket);

          if (state.position && state.position.symbol === bestMarket.symbol) {
            refreshPositionSnapshot(bestMarket, { shouldExit: false, exitReason: null });
          }
          }
        }
      }

      for (const symbol of SYMBOLS) {
        const market = state.markets[symbol];
        if (!market) {
          continue;
        }

        const badge = state.position && state.position.symbol === symbol ? "position" : state.bestCandidateSymbol === symbol ? "best" : "watch";
        const trendLabel = market.trendBull_1h ? "bull" : market.ema20_1h === null || market.ema50_1h === null ? "n/a" : "bear";
        const setupLabel = market.setupValid ? "valid" : "invalid";
        log(
          `Market | symbol=${symbol} | badge=${badge} | trend_1h=${trendLabel} | setup=${setupLabel} | score=${market.compositeScore === null ? "n/a" : market.compositeScore} | signal=${market.signal} | price=${market.lastPrice === null ? "n/a" : formatAmount(market.lastPrice)}`
        );
      }
    } catch (error) {
      log(`Market scan error | exchange=${EXCHANGE_ID} | message=${error.message}`);
    }

    scanCycle += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  state.botActive = false;
  log(`Fatal error | PAPER_TRADING=${PAPER_TRADING} | message=${error.message}`);
  process.exit(1);
});
