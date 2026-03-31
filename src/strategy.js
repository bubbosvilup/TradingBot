"use strict";

const DECISION_ACTIONS = {
  BUY: "BUY",
  HOLD: "HOLD",
  SELL: "SELL",
  WAIT: "WAIT"
};

const DECISION_STATES = {
  BUY_READY: "buy_ready",
  EXIT_SIGNAL: "exit_signal",
  HOLD_POSITION: "hold_position",
  INCOMPLETE_SETUP: "incomplete_setup",
  LOW_SCORE: "low_score",
  NO_SIGNAL: "no_signal",
  POSITION_OPEN: "position_open",
  TREND_FILTER: "trend_filter",
  WAIT_VOLUME: "wait_volume",
  WARMUP: "warmup"
};

const ENTRY_ENGINES = {
  NONE: "none",
  SFP_REVERSAL: "sfp_reversal",
  TREND_CONTINUATION: "trend_continuation"
};

const EXIT_REASON_CODES = {
  ATR_STOP: "atr_stop",
  HARD_STOP: "hard_stop",
  PARTIAL_TAKE_PROFIT: "partial_take_profit",
  TAKE_PROFIT: "take_profit",
  TIME_STOP: "time_stop",
  TRAILING_STOP: "trailing_stop",
  TREND_REVERSAL: "trend_reversal",
  VOLUME_ABSORPTION: "volume_absorption"
};

const EXIT_REASON_LABELS = {
  [EXIT_REASON_CODES.ATR_STOP]: "ATR stop loss reached.",
  [EXIT_REASON_CODES.HARD_STOP]: "Hard stop triggered.",
  [EXIT_REASON_CODES.PARTIAL_TAKE_PROFIT]: "Partial take profit reached.",
  [EXIT_REASON_CODES.TAKE_PROFIT]: "Take profit reached.",
  [EXIT_REASON_CODES.TIME_STOP]: "Time stop: trade flat",
  [EXIT_REASON_CODES.TRAILING_STOP]: "Trailing stop reached.",
  [EXIT_REASON_CODES.TREND_REVERSAL]: "1h trend reversed.",
  [EXIT_REASON_CODES.VOLUME_ABSORPTION]: "Volume absorption detected."
};

function pickVariant(variants, key) {
  const seed = String(key || "default")
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  return variants[seed % variants.length];
}

function wilderRsi(prices, period) {
  if (!Array.isArray(prices) || prices.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = prices[index] - prices[index - 1];
    if (change >= 0) {
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
    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEma(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  for (let index = period; index < prices.length; index += 1) {
    ema = (prices[index] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateEmaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const series = [];
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  series.push(ema);

  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    series.push(ema);
  }

  return series;
}

function calculateAtr(candles, period) {
  if (!Array.isArray(candles) || candles.length <= period) {
    return null;
  }

  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const currentHigh = Number(candles[index][2]);
    const currentLow = Number(candles[index][3]);
    const previousClose = Number(candles[index - 1][4]);
    trueRanges.push(Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - previousClose),
      Math.abs(currentLow - previousClose)
    ));
  }

  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = ((atr * (period - 1)) + trueRanges[index]) / period;
  }

  return atr;
}

function calculateMacd(prices, fast, slow, signal) {
  if (!Array.isArray(prices) || prices.length < slow + signal) {
    return null;
  }

  const fastSeries = calculateEmaSeries(prices, fast);
  const slowSeries = calculateEmaSeries(prices, slow);
  if (fastSeries.length === 0 || slowSeries.length === 0) {
    return null;
  }

  const alignmentOffset = slow - fast;
  const macdSeries = slowSeries.map((slowValue, index) => fastSeries[index + alignmentOffset] - slowValue);
  const signalSeries = calculateEmaSeries(macdSeries, signal);
  if (signalSeries.length === 0) {
    return null;
  }

  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];
  const previousMacd = macdSeries[macdSeries.length - 2];
  const previousSignal = signalSeries[signalSeries.length - 2];

  return {
    histogram: macdLine - signalLine,
    macdLine,
    prevHistogram: previousMacd !== undefined && previousSignal !== undefined ? previousMacd - previousSignal : null,
    signalLine
  };
}

function calculateSma(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const subset = values.slice(-period);
  return subset.reduce((total, value) => total + value, 0) / subset.length;
}

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

function getExitReasonLabel(exitReasonCode) {
  return EXIT_REASON_LABELS[exitReasonCode] || "Exit triggered.";
}

function getRsiState(rsi, config) {
  if (rsi === null) {
    return "non disponibile";
  }

  if (rsi < config.RSI_MIN) {
    return "troppo basso";
  }

  if (rsi > config.RSI_MAX) {
    return "troppo alto";
  }

  return "favorevole";
}

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

function getDecisionReason(decisionState, meta = {}) {
  switch (decisionState) {
    case DECISION_STATES.WARMUP:
      return `Indicatori non pronti: ${(meta.missingIndicators || []).join(", ")}`;
    case DECISION_STATES.TREND_FILTER:
      return "Trend 1h non rialzista: nuovi ingressi bloccati.";
    case DECISION_STATES.POSITION_OPEN:
      return "Posizione aperta in gestione.";
    case DECISION_STATES.LOW_SCORE:
      return `Score ${meta.compositeScore}/10 sotto la soglia minima ${meta.minScoreEntry}. In attesa di segnali piu forti.`;
    case DECISION_STATES.INCOMPLETE_SETUP:
      return "Setup interessante ma non ancora confermato da un engine di ingresso completo.";
    case DECISION_STATES.WAIT_VOLUME:
      return `Setup valido ma ingresso bloccato: volume 5m sotto ${meta.entryVolumeMult}x della media.`;
    case DECISION_STATES.BUY_READY:
      return meta.entryEngine === ENTRY_ENGINES.SFP_REVERSAL
        ? "Liquidity spring / SFP confermato: sweep del minimo, reclaim e volume coerente."
        : "Trend continuation valido: trend 1h inclinato al rialzo, pullback pulito e trigger confermato.";
    case DECISION_STATES.HOLD_POSITION:
      return "Posizione aperta ancora in gestione.";
    case DECISION_STATES.EXIT_SIGNAL:
      return getExitReasonLabel(meta.exitReasonCode);
    case DECISION_STATES.NO_SIGNAL:
    default:
      return "Nessun segnale operativo rilevante.";
  }
}

function buildDecisionExplanationObject(snapshot, config) {
  return {
    action: snapshot.displayAction || snapshot.action || DECISION_ACTIONS.HOLD,
    decisionState: snapshot.decisionState || DECISION_STATES.NO_SIGNAL,
    entryBlockers: Array.isArray(snapshot.entryBlockers) ? snapshot.entryBlockers : [],
    exitReasonCode: snapshot.exitReasonCode || null,
    missingIndicators: snapshot.missingIndicators || [],
    positionState: snapshot.positionOpen ? "aperta" : "nessuna",
    priceState: getPriceState(snapshot.lastPrice_5m, snapshot.ema21_5m, snapshot.atr14_5m),
    reason: snapshot.reason,
    rsiState: getRsiState(snapshot.rsi_5m, config),
    score: snapshot.compositeScore,
    symbol: snapshot.symbol,
    trend: snapshot.trendBull_1h
      ? "rialzista"
      : snapshot.ema20_1h === null || snapshot.ema50_1h === null
        ? "non disponibile"
        : "ribassista",
    warmingUp: Boolean(snapshot.warmingUp)
  };
}

function renderDecisionExplanation(explanationObject) {
  const {
    action,
    decisionState,
    entryBlockers,
    exitReasonCode,
    missingIndicators,
    positionState,
    priceState,
    reason,
    rsiState,
    score,
    symbol,
    trend,
    warmingUp
  } = explanationObject;

  let shortExplanation;
  let detailedExplanation;
  const blockersLabel = entryBlockers.length > 0 ? ` Blocchi principali: ${entryBlockers.slice(0, 3).join("; ")}.` : "";

  if (warmingUp || decisionState === DECISION_STATES.WARMUP) {
    shortExplanation = pickVariant(
      [
        `Il bot aspetta su ${symbol}: i dati non sono ancora sufficienti.`,
        `Su ${symbol} il bot resta fermo: gli indicatori non sono pronti.`,
        `Il bot non agisce su ${symbol}: serve ancora un po' di storico.`
      ],
      reason
    );
    detailedExplanation = `Il bot non prende decisioni su ${symbol} finche non ha dati sufficienti su 1h, 5m e 1m. In questo momento mancano ancora: ${missingIndicators.join(", ")}. Per questo la scelta finale resta HOLD.${blockersLabel}`;
  } else if (decisionState === DECISION_STATES.BUY_READY && action === DECISION_ACTIONS.BUY) {
    shortExplanation = pickVariant(
      [
        `Il bot compra ${symbol}: i tre livelli di conferma sono allineati.`,
        `Il bot apre una posizione su ${symbol}: trend, setup ed entrata sono coerenti.`,
        `Il bot compra ${symbol}: il quadro multi-timeframe e favorevole.`
      ],
      reason
    );
    detailedExplanation = `Il bot ha scelto ${symbol} perche il trend orario e rialzista, il setup sul 5 minuti e valido e il trigger sul 1 minuto conferma il rientro del prezzo. Inoltre il punteggio complessivo ha superato la soglia minima richiesta per entrare.`;
  } else if (decisionState === DECISION_STATES.EXIT_SIGNAL && action === DECISION_ACTIONS.SELL && exitReasonCode === EXIT_REASON_CODES.HARD_STOP) {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: e stato colpito il limite di sicurezza assoluto.`,
        `Il bot chiude ${symbol}: il prezzo ha toccato il livello di protezione massima.`,
        `Il bot esce da ${symbol}: la perdita ha raggiunto il pavimento di sicurezza.`
      ],
      exitReasonCode
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il prezzo e sceso fino al livello di protezione piu rigido previsto. La posizione viene chiusa subito per evitare che il danno aumenti ulteriormente.`;
  } else if (decisionState === DECISION_STATES.EXIT_SIGNAL && action === DECISION_ACTIONS.SELL && exitReasonCode === EXIT_REASON_CODES.TRAILING_STOP) {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il prezzo ha perso forza dopo il rialzo.`,
        `Il bot chiude ${symbol}: il trailing stop e stato raggiunto.`,
        `Il bot esce da ${symbol}: protegge parte del profitto accumulato.`
      ],
      exitReasonCode
    );
    detailedExplanation = `Il bot aveva attivato una protezione dinamica dopo che il trade era andato in profitto. Ora il prezzo e tornato indietro abbastanza da toccare quel livello, quindi la posizione viene chiusa per difendere il risultato ottenuto.`;
  } else if (decisionState === DECISION_STATES.EXIT_SIGNAL && action === DECISION_ACTIONS.SELL && exitReasonCode === EXIT_REASON_CODES.ATR_STOP) {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il prezzo ha colpito lo stop basato sulla volatilita.`,
        `Il bot chiude ${symbol}: il movimento contrario ha raggiunto il limite ATR.`,
        `Il bot esce da ${symbol}: la perdita ha superato la soglia prevista dal rischio.`
      ],
      exitReasonCode
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il prezzo si e mosso contro il trade fino a raggiungere lo stop basato sull'ATR. Questo stop usa la volatilita del mercato per stabilire un limite di rischio coerente.`;
  } else if (decisionState === DECISION_STATES.EXIT_SIGNAL && action === DECISION_ACTIONS.SELL && exitReasonCode === EXIT_REASON_CODES.TAKE_PROFIT) {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il target di profitto e stato raggiunto.`,
        `Il bot chiude ${symbol} in guadagno: il take profit e stato colpito.`,
        `Il bot esce da ${symbol}: il movimento favorevole ha raggiunto l'obiettivo.`
      ],
      exitReasonCode
    );
    detailedExplanation = `Il prezzo di ${symbol} ha raggiunto il livello di take profit impostato all'ingresso. Questo significa che il movimento favorevole ha centrato l'obiettivo previsto, quindi il bot chiude la posizione.`;
  } else if (decisionState === DECISION_STATES.EXIT_SIGNAL && action === DECISION_ACTIONS.SELL) {
    shortExplanation = pickVariant(
      [
        `Il bot vende ${symbol}: il trend orario si e indebolito.`,
        `Il bot chiude ${symbol}: il filtro di trend non sostiene piu il trade.`,
        `Il bot esce da ${symbol}: il contesto generale non e piu favorevole.`
      ],
      exitReasonCode || reason
    );
    detailedExplanation = `Il bot aveva una posizione aperta su ${symbol}, ma il trend sul timeframe orario non e piu coerente con l'idea iniziale. Dopo un numero minimo di candele tenute a mercato, la posizione viene chiusa per evitare di restare dentro quando il contesto peggiora.`;
  } else if (decisionState === DECISION_STATES.HOLD_POSITION || positionState === "aperta") {
    shortExplanation = pickVariant(
      [
        `Il bot mantiene ${symbol}: non ci sono segnali chiari di uscita.`,
        `Il bot resta fermo su ${symbol}: la posizione aperta resta valida.`,
        `Il bot aspetta su ${symbol}: il trade e ancora gestito in modo ordinato.`
      ],
      reason
    );
    detailedExplanation = `Il bot ha gia una posizione aperta su ${symbol}. Al momento non e stato colpito alcun livello di uscita e il trend orario non ha ancora invalidato il trade. Per questo la decisione resta HOLD e la posizione continua a essere monitorata.`;
  } else if (decisionState === DECISION_STATES.WAIT_VOLUME || action === DECISION_ACTIONS.WAIT) {
    shortExplanation = pickVariant(
      [
        `Il bot aspetta su ${symbol}: il setup c'e, ma manca ancora la conferma finale per entrare.`,
        `Il bot resta in attesa su ${symbol}: il mercato e interessante, ma non ancora eseguibile.`,
        `Il bot osserva ${symbol}: il candidato e valido, ma l'ingresso e rinviato.`
      ],
      reason
    );
    detailedExplanation = `Su ${symbol} il quadro tecnico e abbastanza buono da tenerlo in focus come candidato, ma manca ancora una condizione operativa per entrare davvero. Per questo la decisione mostrata e WAIT e non BUY.${blockersLabel}`;
  } else if (decisionState === DECISION_STATES.TREND_FILTER || trend !== "rialzista") {
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
    detailedExplanation,
    reasonList: [
      `Trend: ${trend}`,
      `RSI: ${rsiState}`,
      `Prezzo: ${priceState}`,
      `Stato posizione: ${positionState}`,
      `Decisione finale: ${action}`,
      `Decision state: ${decisionState}`,
      exitReasonCode ? `Exit reason: ${exitReasonCode}` : null,
      entryBlockers.length > 0 ? `Blocchi: ${entryBlockers.slice(0, 3).join("; ")}` : null
    ].filter(Boolean),
    shortExplanation
  };
}

function createStrategy(context) {
  const { config, state } = context;

  function buildDecisionExplanation(snapshot) {
    return renderDecisionExplanation(buildDecisionExplanationObject(snapshot, config));
  }

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

    const ema20Series_1h = calculateEmaSeries(closes_1h, config.EMA20_1H_PERIOD);
    const ema20_1h = calculateEma(closes_1h, config.EMA20_1H_PERIOD);
    const ema50_1h = calculateEma(closes_1h, config.EMA50_1H_PERIOD);
    const trendBull_1h = ema20_1h !== null && ema50_1h !== null ? ema20_1h > ema50_1h : false;
    const ema20_1h_3ago = ema20Series_1h.length >= 4 ? ema20Series_1h[ema20Series_1h.length - 4] : null;
    const trendSlope_1h = ema20_1h !== null && ema20_1h_3ago !== null && ema20_1h !== 0 ? (ema20_1h - ema20_1h_3ago) / ema20_1h : null;
    const trendLateral = trendSlope_1h !== null ? trendSlope_1h <= config.TREND_SLOPE_MIN : false;
    const ema9_5m = calculateEma(closes_5m, config.EMA9_5M_PERIOD);
    const ema21_5m = calculateEma(closes_5m, config.EMA21_5M_PERIOD);
    const rsi_5m = wilderRsi(closes_5m, config.RSI_PERIOD);
    const atr14_5m = calculateAtr(candles_5m, config.ATR_PERIOD);
    const volumeSMA20 = calculateSma(volumes_5m, config.VOLUME_SMA_PERIOD);
    const currentVolume_5m = volumes_5m.length > 1 ? volumes_5m[volumes_5m.length - 2] : (volumes_5m.length > 0 ? volumes_5m[volumes_5m.length - 1] : null);
    const macd = calculateMacd(closes_5m, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL);
    const ema9_1m = calculateEma(closes_1m, config.EMA9_1M_PERIOD);

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
    const pullbackZoneOk = lastPrice_5m !== null && ema21_5m !== null && atr14_5m !== null ? Math.abs(lastPrice_5m - ema21_5m) <= atr14_5m * 1.0 : false;
    const entryVolumeReady = currentVolume_5m !== null && volumeSMA20 !== null ? currentVolume_5m >= volumeSMA20 * config.ENTRY_VOLUME_MULT : false;
    const macdPositive = macd !== null ? macd.histogram > 0 : false;
    const latestOneMinuteTimestamp = candles_1m.length > 0 ? Number(candles_1m[candles_1m.length - 1][0]) : null;
    const previousOneMinuteTimestamp = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][0]) : null;
    const previousOneMinuteClose = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][4]) : null;
    const previousOneMinuteLow = candles_1m.length > 1 ? Number(candles_1m[candles_1m.length - 2][3]) : null;
    const swingLow = findSwingLow(candles_5m, 30, 3);
    const sfpSweep = swingLow !== null && previousOneMinuteLow !== null ? previousOneMinuteLow < swingLow.value : false;
    const sfpReclaim = swingLow !== null && previousOneMinuteClose !== null ? previousOneMinuteClose > swingLow.value : false;
    const sfpStrongClose = previousOneMinuteClose !== null && ema9_1m !== null ? previousOneMinuteClose > ema9_1m : false;
    const sfpVolumeConfirm = currentVolume_5m !== null && volumeSMA20 !== null ? currentVolume_5m >= volumeSMA20 * config.VOLUME_MULT : false;
    const sfpValid = !warmingUp && swingLow !== null && sfpSweep && sfpReclaim && sfpStrongClose && sfpVolumeConfirm;
    const sfpStopLevel = sfpValid ? previousOneMinuteLow : null;
    const triggerFired = previousOneMinuteTimestamp !== null && latestOneMinuteTimestamp !== null && latestOneMinuteTimestamp > previousOneMinuteTimestamp && previousOneMinuteClose !== null && ema9_1m !== null ? (previousOneMinuteClose > ema9_1m || (lastPrice_5m !== null && lastPrice_5m > ema9_1m)) : false;
    const setupValid = !warmingUp && trendBull_1h && trendSlope_1h !== null && trendSlope_1h > config.TREND_SLOPE_MIN && ema9_5m > ema21_5m && rsi_5m >= config.RSI_MIN && rsi_5m <= config.RSI_MAX && triggerFired;
    const projectedEntryPrice = currentPrice;
    const projectedTrendStopLoss = projectedEntryPrice !== null && atr14_5m !== null ? projectedEntryPrice - atr14_5m * config.ATR_STOP_MULT : null;
    const minimumTargetPrice = projectedEntryPrice !== null ? projectedEntryPrice * (1 + (config.MIN_TAKE_PROFIT_BPS / 10000)) : null;
    const projectedTrendTakeProfit = projectedEntryPrice !== null && atr14_5m !== null ? Math.max(projectedEntryPrice + atr14_5m * config.ATR_TP_MULT, minimumTargetPrice) : null;
    const projectedSfpStopLoss = sfpStopLevel;
    const projectedSfpTakeProfit = projectedEntryPrice !== null && sfpStopLevel !== null ? Math.max(projectedEntryPrice + (projectedEntryPrice - sfpStopLevel) * config.ATR_TP_MULT, minimumTargetPrice) : null;

    let trendContinuationScore = 0;
    if (trendBull_1h) trendContinuationScore += 2;
    if (trendSlope_1h !== null && trendSlope_1h > config.TREND_SLOPE_MIN) trendContinuationScore += 1;
    if (ema9_5m !== null && ema21_5m !== null && ema9_5m > ema21_5m) trendContinuationScore += 1;
    if (rsi_5m !== null && rsi_5m >= config.RSI_MIN && rsi_5m <= config.RSI_MAX) trendContinuationScore += 1;
    if (pullbackZoneOk) trendContinuationScore += 1;
    if (triggerFired) trendContinuationScore += 1;
    if (macdPositive) trendContinuationScore += 1;
    if (entryVolumeReady) trendContinuationScore += 1;

    let sfpScore = 0;
    if (sfpSweep && sfpReclaim) sfpScore += 2;
    if (sfpStrongClose) sfpScore += 1;
    if (sfpVolumeConfirm) sfpScore += 1;
    if (trendBull_1h) sfpScore += 2;

    const compositeScore = Math.max(trendContinuationScore, sfpScore);
    const currentPosition = state.positions.find((position) => position.symbol === symbol) || null;
    const positionOpen = Boolean(currentPosition);
    const calculateProjectedMetrics = (entryPrice, stopLoss, takeProfit) => {
      if (!Number.isFinite(entryPrice) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit) || entryPrice <= 0) {
        return {
          grossEdgeBps: 0,
          netEdgeBps: 0,
          rewardDistance: 0,
          riskDistance: 0,
          riskRewardRatio: 0,
          roundTripFeeBps: (config.ENTRY_FEE_BPS || 0) + (config.EXIT_FEE_BPS || 0)
        };
      }

      const riskDistance = entryPrice - stopLoss;
      const rewardDistance = takeProfit - entryPrice;
      const roundTripFeeBps = (config.ENTRY_FEE_BPS || 0) + (config.EXIT_FEE_BPS || 0);
      const grossEdgeBps = rewardDistance > 0 ? (rewardDistance / entryPrice) * 10000 : 0;
      return {
        grossEdgeBps,
        netEdgeBps: grossEdgeBps - roundTripFeeBps,
        rewardDistance,
        riskDistance,
        riskRewardRatio: riskDistance > 0 ? rewardDistance / riskDistance : 0,
        roundTripFeeBps
      };
    };
    const trendMetrics = calculateProjectedMetrics(projectedEntryPrice, projectedTrendStopLoss, projectedTrendTakeProfit);
    const sfpMetrics = calculateProjectedMetrics(projectedEntryPrice, projectedSfpStopLoss, projectedSfpTakeProfit);
    const trendRiskRewardOk = trendMetrics.riskRewardRatio >= config.MIN_RISK_REWARD_RATIO;
    const sfpRiskRewardOk = sfpMetrics.riskRewardRatio >= config.MIN_RISK_REWARD_RATIO;
    const trendNetEdgeOk = trendMetrics.netEdgeBps >= config.MIN_EXPECTED_NET_EDGE_BPS;
    const sfpNetEdgeOk = sfpMetrics.netEdgeBps >= config.MIN_EXPECTED_NET_EDGE_BPS;
    const trendContinuationValid = setupValid && pullbackZoneOk && macdPositive;
    const trendContinuationEligible = trendContinuationValid && trendRiskRewardOk && trendNetEdgeOk && trendContinuationScore >= config.TREND_ENTRY_MIN_SCORE;
    const sfpEligible = sfpValid && sfpRiskRewardOk && sfpNetEdgeOk && sfpScore >= config.SFP_ENTRY_MIN_SCORE;
    const hasEligibleEntryPath = trendContinuationEligible || sfpEligible;
    const preferredEntryType = sfpEligible && sfpScore > trendContinuationScore ? ENTRY_ENGINES.SFP_REVERSAL : trendContinuationEligible ? ENTRY_ENGINES.TREND_CONTINUATION : sfpEligible ? ENTRY_ENGINES.SFP_REVERSAL : ENTRY_ENGINES.NONE;

    const trendBlockers = [];
    const sfpBlockers = [];
    const entryBlockers = [];
    if (warmingUp) {
      const warmupMessage = `Indicatori mancanti: ${missingIndicators.join(", ")}`;
      trendBlockers.push(warmupMessage);
      sfpBlockers.push(warmupMessage);
    } else {
      if (!trendBull_1h && !positionOpen) trendBlockers.push("Trend 1h non rialzista");
      if (trendSlope_1h !== null && trendSlope_1h <= config.TREND_SLOPE_MIN) trendBlockers.push(`Trend 1h laterale (slope=${trendSlope_1h.toFixed(4)})`);
      if (!(ema9_5m > ema21_5m)) trendBlockers.push("EMA 5m non allineate al rialzo");
      if (rsi_5m !== null && (rsi_5m < config.RSI_MIN || rsi_5m > config.RSI_MAX)) trendBlockers.push(`RSI fuori range operativo (${rsi_5m.toFixed(2)})`);
      if (!pullbackZoneOk) trendBlockers.push("Prezzo fuori zona di pullback 5m");
      if (!entryVolumeReady) {
        const volumeBlocker = `Volume 5m insufficiente per ingresso reale (${config.ENTRY_VOLUME_MULT}x SMA richiesto)`;
        trendBlockers.push(volumeBlocker);
        sfpBlockers.push(volumeBlocker);
      }
      if (!macdPositive) trendBlockers.push("MACD 5m non conferma il trend");
      if (!trendRiskRewardOk) trendBlockers.push(`Risk/reward insufficiente (${trendMetrics.riskRewardRatio.toFixed(2)}x < ${config.MIN_RISK_REWARD_RATIO}x)`);
      if (!trendNetEdgeOk) trendBlockers.push(`Edge netto atteso insufficiente (${trendMetrics.netEdgeBps.toFixed(1)}bps < ${config.MIN_EXPECTED_NET_EDGE_BPS}bps)`);
      if (!triggerFired) trendBlockers.push("Trigger 1m non confermato su candela chiusa");
      if (!sfpValid) {
        if (swingLow === null) sfpBlockers.push("Nessun swing low 5m valido per SFP");
        else if (!sfpSweep) sfpBlockers.push("SFP assente: nessuno sweep del minimo");
        else if (!sfpReclaim) sfpBlockers.push("SFP assente: sweep senza reclaim");
        else if (!sfpStrongClose) sfpBlockers.push("SFP debole: close 1m non forte");
        else if (!sfpVolumeConfirm) sfpBlockers.push("SFP debole: reclaim senza volume");
      }
      if (!sfpRiskRewardOk) sfpBlockers.push(`Risk/reward insufficiente (${sfpMetrics.riskRewardRatio.toFixed(2)}x < ${config.MIN_RISK_REWARD_RATIO}x)`);
      if (!sfpNetEdgeOk) sfpBlockers.push(`Edge netto atteso insufficiente (${sfpMetrics.netEdgeBps.toFixed(1)}bps < ${config.MIN_EXPECTED_NET_EDGE_BPS}bps)`);
    }

    let signal = DECISION_ACTIONS.HOLD;
    let action = DECISION_ACTIONS.HOLD;
    let displayAction = DECISION_ACTIONS.HOLD;
    let decisionState = DECISION_STATES.NO_SIGNAL;
    let entryType = ENTRY_ENGINES.NONE;

    if (warmingUp) {
      decisionState = DECISION_STATES.WARMUP;
    } else if (!trendBull_1h && !positionOpen) {
      decisionState = DECISION_STATES.TREND_FILTER;
    } else if (positionOpen) {
      decisionState = DECISION_STATES.POSITION_OPEN;
    } else if (!hasEligibleEntryPath && compositeScore < config.MIN_SCORE_ENTRY) {
      decisionState = DECISION_STATES.LOW_SCORE;
    } else if (!hasEligibleEntryPath) {
      decisionState = DECISION_STATES.INCOMPLETE_SETUP;
    } else if (!entryVolumeReady) {
      signal = "BUY candidate";
      displayAction = DECISION_ACTIONS.WAIT;
      decisionState = DECISION_STATES.WAIT_VOLUME;
      entryType = preferredEntryType;
    } else {
      signal = "BUY candidate";
      action = DECISION_ACTIONS.BUY;
      displayAction = DECISION_ACTIONS.BUY;
      decisionState = DECISION_STATES.BUY_READY;
      entryType = preferredEntryType;
    }

    if (entryType === ENTRY_ENGINES.TREND_CONTINUATION) {
      entryBlockers.push(...trendBlockers);
      if (sfpBlockers.length > 0) entryBlockers.push(sfpBlockers[0]);
    } else if (entryType === ENTRY_ENGINES.SFP_REVERSAL) {
      entryBlockers.push(...sfpBlockers);
      if (trendBlockers.length > 0) entryBlockers.push(trendBlockers[0]);
    } else {
      entryBlockers.push(...trendBlockers, ...sfpBlockers);
    }

    let reason = getDecisionReason(decisionState, {
      compositeScore,
      entryEngine: entryType,
      entryVolumeMult: config.ENTRY_VOLUME_MULT,
      minScoreEntry: config.MIN_SCORE_ENTRY,
      missingIndicators
    });
    if ((decisionState === DECISION_STATES.LOW_SCORE || decisionState === DECISION_STATES.INCOMPLETE_SETUP) && entryBlockers.length > 0) {
      reason += ` (Blockers primari: ${entryBlockers.slice(0, decisionState === DECISION_STATES.LOW_SCORE ? 1 : 2).join(", ")})`;
    }

    const deduplicatedBlockers = Array.from(new Set(entryBlockers));
    const explanation = buildDecisionExplanation({
      action,
      atr14_5m,
      compositeScore,
      decisionState,
      displayAction,
      ema20_1h,
      ema21_5m,
      ema50_1h,
      entryBlockers: deduplicatedBlockers,
      exitReasonCode: null,
      lastPrice_5m,
      missingIndicators,
      positionOpen,
      reason,
      rsi_5m,
      symbol,
      trendBull_1h,
      warmingUp
    });

    return {
      action,
      atr14_5m,
      compositeScore,
      currentVolume_5m,
      decisionState,
      detailedExplanation: explanation.detailedExplanation,
      displayAction,
      ema20_1h,
      ema21_5m,
      ema50_1h,
      ema9_5m,
      emaFast: ema9_5m,
      emaSlow: ema21_5m,
      entryBlockers: deduplicatedBlockers,
      entryCount: currentPosition ? currentPosition.entryCount : 0,
      entryEngine: entryType,
      entryPrice: currentPosition ? currentPosition.entryPrice : null,
      entryType,
      entryVolumeReady,
      exitReasonCode: null,
      highWaterMark: currentPosition ? currentPosition.highWaterMark : null,
      holdCandles: currentPosition ? (currentPosition.holdCandles || 0) : 0,
      lastFiveMinuteCandleTime: candles_5m.length > 0 ? candles_5m[candles_5m.length - 1][0] : null,
      lastPrice: currentPrice,
      lastPrice_1m,
      lastPrice_5m,
      macdHistogram: macd ? macd.histogram : null,
      macdLine: macd ? macd.macdLine : null,
      missingIndicators,
      positionOpen,
      prevHistogram: macd ? macd.prevHistogram : null,
      previousClose_5m,
      projectedNetEdgeBps: preferredEntryType === ENTRY_ENGINES.SFP_REVERSAL ? sfpMetrics.netEdgeBps : trendMetrics.netEdgeBps,
      projectedRiskRewardRatio: preferredEntryType === ENTRY_ENGINES.SFP_REVERSAL ? sfpMetrics.riskRewardRatio : trendMetrics.riskRewardRatio,
      projectedRoundTripFeeBps: preferredEntryType === ENTRY_ENGINES.SFP_REVERSAL ? sfpMetrics.roundTripFeeBps : trendMetrics.roundTripFeeBps,
      reason,
      reasonList: explanation.reasonList,
      rsi: rsi_5m,
      rsi_5m,
      score: compositeScore,
      setupValid,
      sfpReclaim,
      sfpScore,
      sfpStopLevel,
      sfpStrongClose,
      sfpSweep,
      sfpValid,
      sfpVolumeConfirm,
      shortExplanation: explanation.shortExplanation,
      signal,
      signalLine: macd ? macd.signalLine : null,
      stopLoss: currentPosition ? currentPosition.stopLoss : null,
      swingLow,
      symbol,
      takeProfit: currentPosition ? currentPosition.takeProfit : null,
      trailingStop: currentPosition ? currentPosition.trailingStop : null,
      trend: trendBull_1h ? "rialzista" : ema20_1h === null || ema50_1h === null ? "non disponibile" : "ribassista",
      trendBull_1h,
      trendContinuationScore,
      trendContinuationValid,
      trendLateral,
      trendSlope_1h,
      triggerFired,
      volumeSMA20,
      warmingUp
    };
  }

  function pickBestCandidateSymbol(snapshots) {
    const eligibleBuyCandidates = snapshots
      .filter((snapshot) => snapshot.signal === "BUY candidate")
      .sort((left, right) => {
        if (right.compositeScore !== left.compositeScore) return right.compositeScore - left.compositeScore;
        return Number(right.triggerFired) - Number(left.triggerFired);
      });
    if (eligibleBuyCandidates.length > 0) return eligibleBuyCandidates[0].symbol;

    const scoredSnapshots = snapshots
      .filter((snapshot) => snapshot.lastPrice !== null)
      .sort((left, right) => {
        if (right.compositeScore !== left.compositeScore) return right.compositeScore - left.compositeScore;
        return Number(right.trendBull_1h) - Number(left.trendBull_1h);
      });

    return scoredSnapshots.length > 0 ? scoredSnapshots[0].symbol : null;
  }

  function getBtcRegime(btcSnapshot) {
    if (!btcSnapshot || btcSnapshot.ema20_1h === null || btcSnapshot.ema50_1h === null) return "risk-on";
    if (btcSnapshot.ema20_1h < btcSnapshot.ema50_1h) return "risk-off";
    if (btcSnapshot.trendSlope_1h !== null && btcSnapshot.trendSlope_1h > config.TREND_SLOPE_MIN) return "risk-on";
    return "neutral";
  }

  function getNeutralEligibleSymbols(btcRegime, candidateSymbols) {
    if (btcRegime !== "neutral") return new Set(candidateSymbols);
    return new Set(candidateSymbols.slice(0, config.NEUTRAL_TOP_N));
  }

  return {
    DECISION_ACTIONS,
    DECISION_STATES,
    ENTRY_ENGINES,
    EXIT_REASON_CODES,
    buildDecisionExplanation,
    buildDecisionExplanationObject(snapshot) {
      return buildDecisionExplanationObject(snapshot, config);
    },
    buildMarketSnapshot,
    calculateAtr,
    calculateEma,
    calculateEmaSeries,
    calculateMacd,
    calculateSma,
    findSwingLow,
    getBtcRegime,
    getDecisionReason,
    getExitReasonLabel,
    getNeutralEligibleSymbols,
    pickBestCandidateSymbol,
    renderDecisionExplanation,
    wilderRsi
  };
}

module.exports = {
  createStrategy,
  DECISION_ACTIONS,
  DECISION_STATES,
  ENTRY_ENGINES,
  EXIT_REASON_CODES,
  getExitReasonLabel
};
