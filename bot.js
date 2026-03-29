require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const ccxt = require("ccxt");

const DEFAULT_SYMBOL = (process.env.SYMBOL || "BTC/USDT").trim();

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
const SYMBOLS = configuredSymbols.length > 0 ? configuredSymbols : [DEFAULT_SYMBOL];
const SYMBOLS_SOURCE = configuredSymbols.length > 0 ? "SYMBOLS" : "SYMBOL";
const EXCHANGE_ID = process.env.EXCHANGE || "binance";
const PAPER_TRADING = (process.env.PAPER_TRADING || "true").toLowerCase() === "true";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);
const INITIAL_USDT_BALANCE = Number(process.env.INITIAL_USDT_BALANCE || 10);
const OHLCV_LIMIT = Math.max(Number(process.env.OHLCV_LIMIT || 100), 100);
const EMA_FAST_PERIOD = Number(process.env.EMA_FAST_PERIOD || 9);
const EMA_SLOW_PERIOD = Number(process.env.EMA_SLOW_PERIOD || 21);
const RSI_PERIOD = Number(process.env.RSI_PERIOD || 14);
const ENTRY_RSI_MIN = Number(process.env.ENTRY_RSI_MIN || 40);
const ENTRY_RSI_MAX = Number(process.env.ENTRY_RSI_MAX || 65);
const ENTRY_PULLBACK_PCT = Number(process.env.ENTRY_PULLBACK_PCT || 0.003);
const STOP_LOSS_PCT = Number(process.env.STOP_LOSS_PCT || 0.01);
const TAKE_PROFIT_PCT = Number(process.env.TAKE_PROFIT_PCT || 0.02);
const POSITION_SIZE_PCT = Number(process.env.POSITION_SIZE_PCT || 0.5);
const TRADES_LOG_FILE = "trades.log";
const SERVER_HOST = "127.0.0.1";
const SERVER_PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const STRATEGY_NAME = "multi-market-ohlcv-ema-rsi-long-1m";

const state = {
  botActive: false,
  botStartedAt: null,
  lastUpdate: null,
  usdtBalance: INITIAL_USDT_BALANCE,
  position: null,
  trades: [],
  markets: {},
  bestCandidateSymbol: null,
  strategyName: STRATEGY_NAME,
  exchange: EXCHANGE_ID,
  paperTrading: PAPER_TRADING
};

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function appendTradeLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(TRADES_LOG_FILE, `[${timestamp}] ${message}\n`);
}

function formatAmount(value) {
  return Number(value).toFixed(8);
}

function calculateRsi(prices, period) {
  if (prices.length < period + 1) {
    return null;
  }

  const recentPrices = prices.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < recentPrices.length; index += 1) {
    const change = recentPrices[index] - recentPrices[index - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) {
    return 100;
  }

  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

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

function getTrendState(emaFast, emaSlow) {
  if (emaFast === null || emaSlow === null) {
    return "non disponibile";
  }

  if (emaFast > emaSlow) {
    return "rialzista";
  }

  if (emaFast < emaSlow) {
    return "ribassista";
  }

  return "neutro";
}

function getMissingIndicators({ emaFast, emaSlow, rsi }) {
  const missingIndicators = [];

  if (emaFast === null) {
    missingIndicators.push(`EMA${EMA_FAST_PERIOD}`);
  }

  if (emaSlow === null) {
    missingIndicators.push(`EMA${EMA_SLOW_PERIOD}`);
  }

  if (rsi === null) {
    missingIndicators.push("RSI");
  }

  return missingIndicators;
}

function getRsiState(rsi) {
  if (rsi === null) {
    return "non disponibile";
  }

  if (rsi < ENTRY_RSI_MIN) {
    return "troppo basso";
  }

  if (rsi > ENTRY_RSI_MAX) {
    return "troppo alto";
  }

  return "favorevole";
}

function getPriceState(lastPrice, emaFast) {
  if (lastPrice === null || emaFast === null) {
    return "non valutabile";
  }

  const distancePct = Math.abs(lastPrice - emaFast) / emaFast;
  if (distancePct <= ENTRY_PULLBACK_PCT) {
    return "vicino al punto di ingresso";
  }

  if (lastPrice < emaFast) {
    return "in lieve debolezza";
  }

  return "lontano dal punto di ingresso";
}

function calculateOpportunityScore({ warmingUp, emaFast, emaSlow, rsi, lastPrice }) {
  if (warmingUp || emaFast === null || emaSlow === null || rsi === null || lastPrice === null) {
    return null;
  }

  let score = 0;
  const distancePct = Math.abs(lastPrice - emaFast) / emaFast;

  if (emaFast > emaSlow) {
    score += 3;
  } else if (emaFast < emaSlow) {
    score -= 3;
  }

  if (rsi >= ENTRY_RSI_MIN && rsi <= ENTRY_RSI_MAX) {
    score += 2;
  } else {
    score -= 1;
  }

  if (distancePct <= ENTRY_PULLBACK_PCT) {
    score += 2;
  } else if (distancePct <= ENTRY_PULLBACK_PCT * 2) {
    score += 1;
  } else {
    score -= 1;
  }

  return score;
}

function pickVariant(variants, key) {
  const seed = String(key || "default")
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  return variants[seed % variants.length];
}

function buildDecisionExplanationObject(snapshot) {
  return {
    action: snapshot.action,
    trend: snapshot.trend,
    rsiState: getRsiState(snapshot.rsi),
    priceState: getPriceState(snapshot.lastPrice, snapshot.emaFast),
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
    detailedExplanation = `Il bot non prende decisioni su ${symbol} finche gli indicatori non sono completi. In questo momento mancano: ${missingIndicators.join(", ")}. Per questo la scelta finale resta HOLD.`;
  } else if (action === "BUY") {
    shortExplanation = pickVariant(
      [
        `Il bot compra ${symbol}: il trend e favorevole e il prezzo e in una zona interessante.`,
        `Il bot apre una posizione su ${symbol}: il contesto e abbastanza ordinato per entrare.`,
        `Il bot compra ${symbol}: vede un ingresso prudente e coerente con il trend.`
      ],
      reason
    );
    detailedExplanation = `Il bot ha scelto ${symbol} perche la media veloce e sopra la media lenta, l'RSI e in una zona considerata sana e il prezzo non e troppo lontano dalla media veloce. Non c'era gia una posizione aperta, quindi e stato possibile entrare.`;
  } else if (action === "SELL" && reason === "Stop loss reached.") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il prezzo ha colpito la protezione.`,
        `Il bot chiude ${symbol}: e stato raggiunto lo stop loss.`,
        `Il bot esce da ${symbol}: il mercato e sceso oltre il limite previsto.`
      ],
      reason
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il prezzo e sceso fino al livello di stop loss. Per evitare che una perdita cresca troppo, la posizione viene chiusa automaticamente.`;
  } else if (action === "SELL" && reason === "Take profit reached.") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: l'obiettivo di profitto e stato raggiunto.`,
        `Il bot chiude ${symbol} in guadagno: il take profit e stato colpito.`,
        `Il bot esce da ${symbol}: il movimento favorevole ha raggiunto il target.`
      ],
      reason
    );
    detailedExplanation = `Il prezzo di ${symbol} ha raggiunto il livello di take profit impostato all'ingresso. Questo significa che il movimento favorevole ha centrato l'obiettivo previsto, quindi il bot chiude la posizione.`;
  } else if (action === "SELL") {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il segnale favorevole si e indebolito.`,
        `Il bot chiude ${symbol}: il trend non sostiene piu la posizione.`,
        `Il bot esce da ${symbol}: le condizioni iniziali non sono piu valide.`
      ],
      reason
    );
    detailedExplanation = `Il bot aveva una posizione su ${symbol}, ma ora il trend e peggiorato. In particolare la media veloce non sta piu sopra la media lenta come prima, quindi il segnale di forza si e indebolito e la posizione viene chiusa.`;
  } else if (positionState === "aperta") {
    shortExplanation = pickVariant(
      [
        `Il bot mantiene ${symbol}: non ci sono segnali chiari di uscita.`,
        `Il bot resta fermo su ${symbol}: la posizione aperta resta valida.`,
        `Il bot aspetta su ${symbol}: per ora non vede motivi forti per vendere.`
      ],
      reason
    );
    detailedExplanation = `Il bot ha gia una posizione aperta su ${symbol}. In questo momento non e stato colpito ne lo stop loss ne il take profit, e il trend non si e ancora invertito in modo netto. Per questo la decisione resta HOLD.`;
  } else if (trend !== "rialzista") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: il trend non e abbastanza chiaro.`,
        `Il bot non entra su ${symbol}: il mercato non mostra una spinta rialzista sufficiente.`,
        `Il bot aspetta su ${symbol}: il trend non sostiene ancora un ingresso.`
      ],
      reason
    );
    detailedExplanation = `Il bot non apre una posizione su ${symbol} perche il trend non appare abbastanza favorevole. In pratica la media veloce non sta guidando chiaramente il movimento sopra la media lenta, quindi il contesto non e considerato abbastanza robusto.`;
  } else if (rsiState !== "favorevole") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: la forza del movimento non e nella zona giusta.`,
        `Il bot non compra ${symbol}: l'RSI non conferma un ingresso prudente.`,
        `Il bot aspetta su ${symbol}: il ritmo del mercato non e adatto a entrare ora.`
      ],
      reason
    );
    detailedExplanation = `Su ${symbol} il trend puo anche sembrare discreto, ma l'RSI non e nel range scelto per entrare. Questo serve a evitare ingressi troppo anticipati o troppo tirati.`;
  } else if (priceState === "lontano dal punto di ingresso") {
    shortExplanation = pickVariant(
      [
        `Il bot resta fermo su ${symbol}: il prezzo e troppo lontano dalla zona di ingresso.`,
        `Il bot non entra su ${symbol}: il prezzo si e gia allontanato troppo.`,
        `Il bot aspetta su ${symbol}: preferisce un prezzo piu vicino alla media veloce.`
      ],
      reason
    );
    detailedExplanation = `Anche se il trend di ${symbol} non e negativo, il prezzo e troppo distante dalla media veloce. Il bot preferisce non inseguire il movimento e attende una zona di ingresso piu equilibrata.`;
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

function buildMarketSnapshot(symbol, candles) {
  const closes = candles.map((candle) => Number(candle[4]));
  const lastPrice = closes.length > 0 ? closes[closes.length - 1] : null;
  const emaFast = calculateEma(closes, EMA_FAST_PERIOD);
  const emaSlow = calculateEma(closes, EMA_SLOW_PERIOD);
  const rsi = calculateRsi(closes, RSI_PERIOD);
  const missingIndicators = getMissingIndicators({ emaFast, emaSlow, rsi });
  const warmingUp = missingIndicators.length > 0;
  const trend = getTrendState(emaFast, emaSlow);
  const score = calculateOpportunityScore({ warmingUp, emaFast, emaSlow, rsi, lastPrice });
  const hasOpenPosition = state.position && state.position.symbol === symbol;
  let signal = "HOLD";
  let action = "HOLD";
  let reason = "Condizioni non sufficienti.";

  if (warmingUp) {
    reason = `Indicatori non pronti: ${missingIndicators.join(", ")}`;
  } else if (hasOpenPosition) {
    if (lastPrice <= state.position.stopLoss) {
      signal = "SELL candidate";
      action = "SELL";
      reason = "Stop loss reached.";
    } else if (lastPrice >= state.position.takeProfit) {
      signal = "SELL candidate";
      action = "SELL";
      reason = "Take profit reached.";
    } else if (emaFast < emaSlow) {
      signal = "SELL candidate";
      action = "SELL";
      reason = `EMA${EMA_FAST_PERIOD} crossed below EMA${EMA_SLOW_PERIOD}.`;
    } else {
      reason = "Posizione aperta ancora coerente con il trend.";
    }
  } else if (state.position) {
    if (score !== null && score >= 6) {
      signal = "BUY candidate";
      reason = "Buon candidato, ma c'e gia una posizione aperta su un altro mercato.";
    } else {
      reason = "Monitoraggio attivo, ma nessuna azione mentre esiste un'altra posizione.";
    }
  } else if (emaFast <= emaSlow) {
    reason = `Trend non rialzista: EMA${EMA_FAST_PERIOD} non sopra EMA${EMA_SLOW_PERIOD}.`;
  } else if (rsi < ENTRY_RSI_MIN || rsi > ENTRY_RSI_MAX) {
    reason = `RSI fuori dal range ${ENTRY_RSI_MIN}-${ENTRY_RSI_MAX}.`;
  } else {
    const distancePct = Math.abs(lastPrice - emaFast) / emaFast;

    if (distancePct > ENTRY_PULLBACK_PCT) {
      reason = `Prezzo troppo lontano da EMA${EMA_FAST_PERIOD}.`;
    } else if (state.usdtBalance <= 0) {
      reason = "Saldo USDT non disponibile.";
    } else {
      signal = "BUY candidate";
      action = "BUY";
      reason = "Trend favorevole, RSI sano e prezzo vicino alla media veloce.";
    }
  }

  const snapshot = {
    symbol,
    lastPrice,
    emaFast,
    emaSlow,
    rsi,
    trend,
    score,
    warmingUp,
    missingIndicators,
    signal,
    action,
    reason,
    positionOpen: hasOpenPosition,
    entryPrice: hasOpenPosition ? state.position.entryPrice : null,
    stopLoss: hasOpenPosition ? state.position.stopLoss : null,
    takeProfit: hasOpenPosition ? state.position.takeProfit : null
  };

  const explanation = renderDecisionExplanation(buildDecisionExplanationObject(snapshot));

  return {
    ...snapshot,
    shortExplanation: explanation.shortExplanation,
    detailedExplanation: explanation.detailedExplanation,
    reasonList: explanation.reasonList
  };
}

function getPortfolioValue() {
  const btcValue = state.position && state.position.lastPrice ? state.position.btcAmount * state.position.lastPrice : 0;
  return state.usdtBalance + btcValue;
}

function getSessionPnl() {
  return getPortfolioValue() - INITIAL_USDT_BALANCE;
}

function getSessionPnlPercent() {
  if (INITIAL_USDT_BALANCE === 0) {
    return 0;
  }

  return (getSessionPnl() / INITIAL_USDT_BALANCE) * 100;
}

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

function buildSummary() {
  const sessionPnl = getSessionPnl();
  const sessionPnlLabel = `${sessionPnl >= 0 ? "+" : ""}${formatAmount(sessionPnl)} USDT`;

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
      positionSymbol: state.position ? state.position.symbol : null
    },
    portfolio: {
      usdtBalance: state.usdtBalance,
      btcPosition: state.position ? state.position.btcAmount : 0,
      estimatedTotalValue: portfolioValue,
      sessionPnl,
      sessionPnlPercent
    },
    decision: focusMarket
      ? {
          action: state.position ? focusMarket.action : focusMarket.signal === "BUY candidate" ? "BUY" : "HOLD",
          symbol: focusMarket.symbol,
          strategy: state.strategyName,
          rsi: focusMarket.rsi,
          shortMa: focusMarket.emaFast,
          longMa: focusMarket.emaSlow,
          ema9: focusMarket.emaFast,
          ema21: focusMarket.emaSlow,
          warmingUp: focusMarket.warmingUp,
          missingIndicators: focusMarket.missingIndicators,
          entryPrice: focusMarket.entryPrice,
          stopLoss: focusMarket.stopLoss,
          takeProfit: focusMarket.takeProfit,
          score: focusMarket.score,
          reason: focusMarket.reason,
          focusMode,
          focusReason,
          shortExplanation: focusMarket.shortExplanation,
          detailedExplanation: focusMarket.detailedExplanation,
          reasonList: focusMarket.reasonList
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
          reason: "Nessun mercato disponibile.",
          focusMode,
          focusReason,
          shortExplanation: "Il bot non ha ancora dati da mostrare.",
          detailedExplanation: "Il sistema e attivo ma non ha ancora ricevuto dati sufficienti per una valutazione.",
          reasonList: ["Trend: non disponibile", "RSI: non disponibile", "Prezzo: non valutabile", "Stato posizione: nessuna", "Decisione finale: HOLD"]
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

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

function clearTradesLog() {
  fs.writeFileSync(TRADES_LOG_FILE, "");
}

function resetSession() {
  state.usdtBalance = INITIAL_USDT_BALANCE;
  state.position = null;
  state.trades = [];
  state.markets = {};
  state.lastUpdate = null;
  state.bestCandidateSymbol = null;
  clearTradesLog();
  log(`Session reset | usdt_balance=${formatAmount(state.usdtBalance)} | position=none`);
}

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

  log(`Loaded ${SYMBOLS.length} market(s) from ${SYMBOLS_SOURCE}.`);
  log(`Loaded symbols: ${SYMBOLS.join(", ")}`);
  log(`Bot started | exchange=${EXCHANGE_ID} | symbols=${SYMBOLS.join(",")} | PAPER_TRADING=${PAPER_TRADING} | interval=${POLL_INTERVAL_MS}ms`);

  while (true) {
    try {
      const candleResults = await Promise.all(
        SYMBOLS.map(async (symbol) => {
          const candles = await exchange.fetchOHLCV(symbol, "1m", undefined, OHLCV_LIMIT);
          return { symbol, candles };
        })
      );

      const nextMarkets = {};
      for (const result of candleResults) {
        nextMarkets[result.symbol] = buildMarketSnapshot(result.symbol, result.candles);
      }

      state.markets = nextMarkets;
      state.lastUpdate = new Date().toISOString();

      const buyCandidates = Object.values(state.markets)
        .filter((market) => market.signal === "BUY candidate")
        .sort((left, right) => (right.score || -999) - (left.score || -999));

      state.bestCandidateSymbol = buyCandidates.length > 0 ? buyCandidates[0].symbol : null;

      if (state.position) {
        const positionMarket = state.markets[state.position.symbol];

        if (positionMarket) {
          state.position.lastPrice = positionMarket.lastPrice;

          if (positionMarket.action === "SELL") {
            const exitUsdt = state.position.btcAmount * positionMarket.lastPrice;
            const profit = exitUsdt - state.position.usdtAllocated;
            const trade = {
              time: new Date().toISOString(),
              symbol: state.position.symbol,
              action: "SELL",
              price: positionMarket.lastPrice,
              btcAmount: state.position.btcAmount,
              usdtAmount: exitUsdt,
              pnlUsdt: profit,
              reason: positionMarket.reason
            };

            state.trades.push(trade);
            state.usdtBalance += exitUsdt;
            appendTradeLog(
              `SELL | symbol=${trade.symbol} | price=${formatAmount(trade.price)} | btc=${formatAmount(trade.btcAmount)} | usdt_received=${formatAmount(trade.usdtAmount)} | pnl_usdt=${formatAmount(trade.pnlUsdt)} | reason=${trade.reason}`
            );
            log(
              `Paper SELL | symbol=${trade.symbol} | sell_price=${formatAmount(trade.price)} | btc_sold=${formatAmount(trade.btcAmount)} | usdt_received=${formatAmount(trade.usdtAmount)} | pnl_usdt=${formatAmount(trade.pnlUsdt)} | reason=${trade.reason}`
            );
            state.position = null;
          }
        }
      } else if (state.bestCandidateSymbol) {
        const bestMarket = state.markets[state.bestCandidateSymbol];

        if (bestMarket && bestMarket.action === "BUY") {
          const usdtToUse = state.usdtBalance * POSITION_SIZE_PCT;
          const btcAmount = usdtToUse / bestMarket.lastPrice;
          const stopLoss = bestMarket.lastPrice * (1 - STOP_LOSS_PCT);
          const takeProfit = bestMarket.lastPrice * (1 + TAKE_PROFIT_PCT);
          const trade = {
            time: new Date().toISOString(),
            symbol: bestMarket.symbol,
            action: "BUY",
            price: bestMarket.lastPrice,
            btcAmount,
            usdtAmount: usdtToUse,
            pnlUsdt: null,
            reason: bestMarket.reason
          };

          state.position = {
            symbol: bestMarket.symbol,
            entryPrice: bestMarket.lastPrice,
            btcAmount,
            usdtAllocated: usdtToUse,
            stopLoss,
            takeProfit,
            lastPrice: bestMarket.lastPrice
          };
          state.trades.push(trade);
          state.usdtBalance -= usdtToUse;
          appendTradeLog(
            `BUY | symbol=${trade.symbol} | price=${formatAmount(trade.price)} | btc=${formatAmount(trade.btcAmount)} | usdt_spent=${formatAmount(trade.usdtAmount)} | stop_loss=${formatAmount(stopLoss)} | take_profit=${formatAmount(takeProfit)} | reason=${trade.reason}`
          );
          log(
            `Paper BUY | symbol=${trade.symbol} | buy_price=${formatAmount(trade.price)} | btc_bought=${formatAmount(trade.btcAmount)} | usdt_spent=${formatAmount(trade.usdtAmount)} | stop_loss=${formatAmount(stopLoss)} | take_profit=${formatAmount(takeProfit)} | reason=${trade.reason}`
          );
        }
      }

      for (const symbol of SYMBOLS) {
        const market = state.markets[symbol];
        if (!market) {
          continue;
        }

        const badge = state.position && state.position.symbol === symbol ? "position" : state.bestCandidateSymbol === symbol ? "best" : "watch";
        log(
          `Market | symbol=${symbol} | badge=${badge} | price=${market.lastPrice === null ? "n/a" : formatAmount(market.lastPrice)} | trend=${market.trend} | signal=${market.signal} | score=${market.score === null ? "n/a" : market.score} | rsi=${market.rsi === null ? "n/a" : formatAmount(market.rsi)}`
        );
      }
    } catch (error) {
      log(`Market scan error | exchange=${EXCHANGE_ID} | message=${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((error) => {
  state.botActive = false;
  log(`Fatal error | PAPER_TRADING=${PAPER_TRADING} | message=${error.message}`);
  process.exit(1);
});
