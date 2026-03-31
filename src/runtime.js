"use strict";

function createRuntime(context) {
  const { config, state } = context;
  const symbolCooldown = new Map();
  const recentlyExited = new Set();
  const recentlyExitedExpiry = new Map();
  const wsBackoffDelay = new Map();
  const wsBackoffUntil = new Map();
  const wsFailureTimestamps = [];

  let wsDisabledUntil = 0;
  let wsLastDisabledLogAt = 0;
  let watchlistRotationCycle = 0;
  let hotPoolCursor = 0;
  let currentScanCycle = 0;
  let lastWsSubscribeTime = 0;

  function setCurrentScanCycle(scanCycle) {
    currentScanCycle = scanCycle;
  }

  function resetTransientState() {
    symbolCooldown.clear();
    recentlyExited.clear();
    recentlyExitedExpiry.clear();
    wsBackoffDelay.clear();
    wsBackoffUntil.clear();
    wsFailureTimestamps.length = 0;
    wsDisabledUntil = 0;
    wsLastDisabledLogAt = 0;
    watchlistRotationCycle = 0;
    hotPoolCursor = 0;
    currentScanCycle = 0;
    lastWsSubscribeTime = 0;
  }

  function normalizeDynamicSymbols(symbols, options = {}) {
    const { includeBtc = true, maxCount = config.TOP_SYMBOLS_COUNT } = options;
    const normalized = [];
    const seen = new Set();

    const pushSymbol = (symbol) => {
      if (!symbol || seen.has(symbol) || normalized.length >= maxCount) {
        return;
      }
      seen.add(symbol);
      normalized.push(symbol);
    };

    for (const position of state.positions) {
      pushSymbol(position.symbol);
    }
    if (includeBtc) {
      pushSymbol("BTC/USDT");
    }
    for (const symbol of symbols) {
      pushSymbol(symbol);
    }

    return normalized;
  }

  function selectRealtimeSymbols(activeSymbols) {
    const realtimeSymbols = [];
    const pushSymbol = (symbol) => {
      if (!symbol || realtimeSymbols.includes(symbol) || realtimeSymbols.length >= 3) {
        return;
      }
      realtimeSymbols.push(symbol);
    };

    for (const position of state.positions) {
      pushSymbol(position.symbol);
    }
    pushSymbol(state.bestCandidateSymbol);
    for (const symbol of activeSymbols) {
      pushSymbol(symbol);
    }

    return new Set(realtimeSymbols);
  }

  function calcSlippageBps(currentVolume, volumeSMA, baseSlippageBps = config.SLIPPAGE_BPS_BASE) {
    if (!Number.isFinite(currentVolume) || !Number.isFinite(volumeSMA) || volumeSMA <= 0) {
      return baseSlippageBps * 2;
    }
    const ratio = currentVolume / volumeSMA;
    if (ratio >= 1.5) return baseSlippageBps;
    if (ratio >= 1.0) return baseSlippageBps * 1.5;
    if (ratio >= 0.5) return baseSlippageBps * 2.0;
    return baseSlippageBps * 3.0;
  }

  function calculateRiskPositionSize(equity, entryPrice, stopLoss, sfpValid = false) {
    const stopDistanceUsdt = entryPrice - stopLoss;
    if (!Number.isFinite(equity) || !Number.isFinite(entryPrice) || !Number.isFinite(stopLoss) || stopDistanceUsdt <= 0) {
      return { positionSizePct: 0, sizeFromRiskUsdt: 0, stopDistanceUsdt: 0 };
    }

    let sizeFromRiskUsdt = (equity * config.RISK_PCT_PER_TRADE * entryPrice) / stopDistanceUsdt;
    if (sfpValid) {
      sizeFromRiskUsdt *= 1.1;
    }

    const maxAllocationUsdt = equity * config.POSITION_SIZE_MAX;
    const cappedSizeUsdt = Math.min(sizeFromRiskUsdt, maxAllocationUsdt);
    return {
      positionSizePct: equity > 0 ? cappedSizeUsdt / equity : 0,
      sizeFromRiskUsdt: cappedSizeUsdt,
      stopDistanceUsdt
    };
  }

  function simulateBuyExecution(referencePrice, notionalUsdt, slippageBps) {
    const executionPrice = referencePrice * (1 + slippageBps / 10000);
    const btcAmount = executionPrice > 0 ? notionalUsdt / executionPrice : 0;
    const feePaid = notionalUsdt * (config.ENTRY_FEE_BPS / 10000);
    const slippagePaid = btcAmount * Math.max(0, executionPrice - referencePrice);

    return {
      btcAmount,
      cashOut: notionalUsdt + feePaid,
      executionPrice,
      feePaid,
      slippagePaid
    };
  }

  function simulateSellExecution(referencePrice, btcAmount, slippageBps) {
    const executionPrice = referencePrice * (1 - slippageBps / 10000);
    const grossProceeds = btcAmount * executionPrice;
    const feePaid = grossProceeds * (config.EXIT_FEE_BPS / 10000);
    const slippagePaid = btcAmount * Math.max(0, referencePrice - executionPrice);

    return {
      executionPrice,
      feePaid,
      grossProceeds,
      netProceeds: grossProceeds - feePaid,
      slippagePaid
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function calculateProfitabilityAllocation(snapshot, equity, budget, availableUsdt) {
    const scoreFloor = snapshot.entryEngine === context.strategy.ENTRY_ENGINES.SFP_REVERSAL
      ? config.SFP_ENTRY_MIN_SCORE
      : config.TREND_ENTRY_MIN_SCORE;
    const scoreFactor = clamp((snapshot.compositeScore - scoreFloor) / Math.max(1, 10 - scoreFloor), 0, 1);
    const edgeFactor = clamp((snapshot.projectedNetEdgeBps || 0) / config.TARGET_NET_EDGE_BPS_FOR_MAX_SIZE, 0, 1);
    const riskRewardExcess = Math.max(0, (snapshot.projectedRiskRewardRatio || 0) - config.MIN_RISK_REWARD_RATIO);
    const riskRewardRange = Math.max(0.25, config.TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE - config.MIN_RISK_REWARD_RATIO);
    const riskRewardFactor = clamp(riskRewardExcess / riskRewardRange, 0, 1);
    const blendedConfidence = (scoreFactor * 0.3) + (edgeFactor * 0.45) + (riskRewardFactor * 0.25);
    const targetAllocationPct = config.POSITION_SIZE_MIN + ((config.POSITION_SIZE_MAX - config.POSITION_SIZE_MIN) * blendedConfidence);
    const targetAllocationUsdt = equity * targetAllocationPct;
    const cappedAllocationUsdt = Math.min(targetAllocationUsdt, budget.perTradeBudget, budget.budgetRemaining, availableUsdt);
    const expectedNetProfitUsdt = cappedAllocationUsdt * ((snapshot.projectedNetEdgeBps || 0) / 10000);

    return {
      blendedConfidence,
      cappedAllocationUsdt,
      edgeFactor,
      expectedNetProfitUsdt,
      riskRewardFactor,
      scoreFactor,
      targetAllocationPct
    };
  }

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
    while (wsFailureTimestamps.length > 0 && now - wsFailureTimestamps[0] > config.WS_FAILURE_WINDOW_MS) {
      wsFailureTimestamps.shift();
    }

    if (wsFailureTimestamps.length >= config.WS_FAILURE_THRESHOLD) {
      wsDisabledUntil = now + config.WS_GLOBAL_COOLDOWN_MS;
      wsFailureTimestamps.length = 0;
      if (now - wsLastDisabledLogAt > 5000) {
        wsLastDisabledLogAt = now;
        context.logScoped("WS", `circuit_open | realtime_disabled_for=${config.WS_GLOBAL_COOLDOWN_MS}ms | reason=${isTimeout ? "repeated_timeouts" : "repeated_remote_closes"}`);
      }
    }
  }

  async function getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, timeframe, limit, realtimeSymbols) {
    const backoffKey = `${symbol}:${timeframe}`;
    const now = Date.now();
    const backoffUntil = wsBackoffUntil.get(backoffKey) || 0;
    const canUseWs =
      config.USE_CCXT_PRO_WS &&
      realtimeSymbols.has(symbol) &&
      config.WS_REALTIME_TIMEFRAMES.has(timeframe) &&
      streamExchange &&
      streamExchange.has &&
      streamExchange.has.watchOHLCV &&
      now >= backoffUntil &&
      now >= wsDisabledUntil;

    if (config.USE_CCXT_PRO_WS && now < wsDisabledUntil && now - wsLastDisabledLogAt > 5000) {
      wsLastDisabledLogAt = now;
      context.logScoped("WS", `cooldown_active | fallback=REST | retry_after=${wsDisabledUntil - now}ms`);
    }

    if (canUseWs) {
      try {
        const nowMs = Date.now();
        let delay = 0;
        if (lastWsSubscribeTime < nowMs) {
          lastWsSubscribeTime = nowMs;
        } else {
          lastWsSubscribeTime += 333;
          delay = lastWsSubscribeTime - nowMs;
        }
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        let candles = await context.withTimeout(
          streamExchange.watchOHLCV(symbol, timeframe, undefined, limit),
          `${symbol} ${timeframe} watchOHLCV`,
          config.WS_WATCH_TIMEOUT_MS
        );
        wsBackoffDelay.delete(backoffKey);
        wsBackoffUntil.delete(backoffKey);

        if (Array.isArray(candles)) {
          const minRequired = timeframe === "1h" ? 60 : timeframe === "5m" ? 30 : 15;
          if (candles.length < minRequired) {
            const cached = state.candleData?.[symbol]?.[`candles_${timeframe}`] || [];
            if (cached.length > 0) {
              const mergedMap = new Map();
              for (const candle of cached) mergedMap.set(candle[0], candle);
              for (const candle of candles) mergedMap.set(candle[0], candle);
              candles = Array.from(mergedMap.values()).sort((left, right) => left[0] - right[0]);
            } else {
              try {
                const restCandles = await restExchange.fetchOHLCV(symbol, timeframe, undefined, limit);
                const mergedMap = new Map();
                for (const candle of restCandles) mergedMap.set(candle[0], candle);
                for (const candle of candles) mergedMap.set(candle[0], candle);
                candles = Array.from(mergedMap.values()).sort((left, right) => left[0] - right[0]);
              } catch (_) {}
            }
          }
          return candles.slice(-limit);
        }
        return [];
      } catch (error) {
        const previousDelay = wsBackoffDelay.get(backoffKey) || config.WS_BACKOFF_BASE_MS;
        const nextDelay = Math.min(previousDelay * 2, config.WS_BACKOFF_MAX_MS);
        wsBackoffDelay.set(backoffKey, nextDelay);
        wsBackoffUntil.set(backoffKey, Date.now() + nextDelay);
        registerWsFailure(error);
        context.logScoped("WS", `stream_error | symbol=${symbol} | timeframe=${timeframe} | fallback=REST | retry_in=${nextDelay}ms | message=${error.message}`);
      }
    }

    return context.withTimeout(
      restExchange.fetchOHLCV(symbol, timeframe, undefined, limit),
      `${symbol} ${timeframe} OHLCV`
    );
  }

  function openPaperPosition(snapshot) {
    const existingPosition = state.positions.find((position) => position.symbol === snapshot.symbol);
    if (!existingPosition && state.positions.length >= config.MAX_CONCURRENT_POSITIONS) {
      return;
    }

    const cooldownExpiry = symbolCooldown.get(snapshot.symbol);
    if (cooldownExpiry !== undefined && cooldownExpiry > currentScanCycle) {
      context.logScoped("GUARD", `cooldown_active | symbol=${snapshot.symbol} | remaining=${cooldownExpiry - currentScanCycle} cycles`);
      return;
    }

    const recentExitExpiry = recentlyExitedExpiry.get(snapshot.symbol);
    if (recentlyExited.has(snapshot.symbol) && recentExitExpiry !== undefined && recentExitExpiry > currentScanCycle) {
      context.logScoped("GUARD", `recently_exited | symbol=${snapshot.symbol} | remaining=${recentExitExpiry - currentScanCycle} cycles`);
      return;
    }

    if (existingPosition && snapshot.lastFiveMinuteCandleTime !== null && existingPosition.lastEntryCandleTime === snapshot.lastFiveMinuteCandleTime) {
      return;
    }

    if (snapshot.currentVolume_5m === null || snapshot.volumeSMA20 === null || snapshot.currentVolume_5m < snapshot.volumeSMA20 * config.ENTRY_VOLUME_MULT) {
      context.logScoped(
        "ENTRY",
        `rejected | symbol=${snapshot.symbol} | reason=volume_too_low | volume=${context.formatLogNumber(snapshot.currentVolume_5m, 2)} | sma=${context.formatLogNumber(snapshot.volumeSMA20, 2)} | required=${config.ENTRY_VOLUME_MULT}x`
      );
      return;
    }

    if (existingPosition && existingPosition.partialExitDone) {
      return;
    }

    const equity = context.serverApi.getPortfolioValue();
    const entryEngine = snapshot.entryType || context.strategy.ENTRY_ENGINES.TREND_CONTINUATION;
    const plannedStopLoss = snapshot.sfpValid && snapshot.sfpStopLevel !== null ? snapshot.sfpStopLevel : snapshot.lastPrice - snapshot.atr14_5m * config.ATR_STOP_MULT;
    const riskSizing = calculateRiskPositionSize(equity, snapshot.lastPrice, plannedStopLoss, snapshot.sfpValid === true);
    const budget = context.serverApi.getPositionBudgetMetrics();
    const feeRate = config.ENTRY_FEE_BPS / 10000;
    const maxAffordableUsdt = state.usdtBalance / (1 + feeRate);
    const profitabilityAllocation = calculateProfitabilityAllocation(snapshot, equity, budget, maxAffordableUsdt);
    const requestedAllocation = Math.min(riskSizing.sizeFromRiskUsdt, profitabilityAllocation.cappedAllocationUsdt);
    const usdtToUse = Math.max(0, requestedAllocation);

    context.logScoped(
      "ENTRY",
      `sizing | symbol=${snapshot.symbol} | size_pct=${riskSizing.positionSizePct.toFixed(3)} | target_alloc_pct=${profitabilityAllocation.targetAllocationPct.toFixed(3)} | score=${snapshot.compositeScore} | edge_bps=${context.formatLogNumber(snapshot.projectedNetEdgeBps, 1)} | rr=${context.formatLogNumber(snapshot.projectedRiskRewardRatio, 2)} | exp_net=${context.formatLogNumber(profitabilityAllocation.expectedNetProfitUsdt, 2)} | sfp=${snapshot.sfpValid === true} | risk_pct=${config.RISK_PCT_PER_TRADE.toFixed(3)} | stop_distance=${context.formatLogNumber(riskSizing.stopDistanceUsdt, 4)} | size_from_risk=${context.formatLogNumber(riskSizing.sizeFromRiskUsdt, 2)}`
    );

    if (usdtToUse <= 0 || snapshot.lastPrice === null || snapshot.atr14_5m === null) {
      return;
    }

    if (usdtToUse < config.MIN_POSITION_NOTIONAL_USDT) {
      context.logScoped(
        "ENTRY",
        `rejected | symbol=${snapshot.symbol} | reason=notional_too_small | notional=${context.formatLogNumber(usdtToUse, 2)} | min_required=${context.formatLogNumber(config.MIN_POSITION_NOTIONAL_USDT, 2)} | edge_bps=${context.formatLogNumber(snapshot.projectedNetEdgeBps, 1)}`
      );
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
    const stopLoss = snapshot.sfpValid && snapshot.sfpStopLevel !== null ? snapshot.sfpStopLevel : averageEntryPrice - snapshot.atr14_5m * config.ATR_STOP_MULT;
    const hardFloor = averageEntryPrice * (1 - config.HARD_STOP_PCT);
    const minimumTakeProfit = averageEntryPrice * (1 + (config.MIN_TAKE_PROFIT_BPS / 10000));
    const takeProfit = snapshot.sfpValid && snapshot.sfpStopLevel !== null
      ? Math.max(averageEntryPrice + (averageEntryPrice - snapshot.sfpStopLevel) * config.ATR_TP_MULT, minimumTakeProfit)
      : Math.max(averageEntryPrice + snapshot.atr14_5m * config.ATR_TP_MULT, minimumTakeProfit);
    const initialRiskPerUnit = averageEntryPrice - stopLoss;
    const nextEntryCount = (existingPosition ? existingPosition.entryCount : 0) + 1;
    const tradeId = existingPosition ? existingPosition.tradeId : `T-${Date.now().toString(36).toUpperCase()}`;
    const tradeTime = new Date().toISOString();
    const budgetRemainingAfter = Math.max(0, budget.budgetCap - totalNotionalAllocated);
    const explanationShort = existingPosition ? `Il bot aggiunge un ingresso su ${snapshot.symbol}: il segnale resta forte e c'e ancora budget disponibile.` : snapshot.shortExplanation;
    const explanationDetailed = existingPosition ? `${snapshot.detailedExplanation} Il bot ha aggiunto un ingresso sullo stesso mercato per aumentare la posizione in modo controllato, mantenendo un margine di budget disponibile.` : snapshot.detailedExplanation;

    const positionData = {
      atr: snapshot.atr14_5m,
      btcAmount: totalBtcAmount,
      costBasisUsdt: totalCostBasis,
      entryCount: nextEntryCount,
      entryEMA20_1h: snapshot.ema20_1h,
      entryEngine,
      expectedNetProfitUsdt: profitabilityAllocation.expectedNetProfitUsdt,
      entryFeesPaid: totalEntryFeesPaid,
      entryPrice: averageEntryPrice,
      entrySlippagePaid: totalEntrySlippagePaid,
      entryTime: existingPosition ? existingPosition.entryTime : Date.now(),
      hardFloor,
      highWaterMark: existingPosition ? Math.max(existingPosition.highWaterMark, snapshot.lastPrice) : snapshot.lastPrice,
      initialRiskPerUnit,
      lastEntryAt: tradeTime,
      lastEntryCandleTime: snapshot.lastFiveMinuteCandleTime,
      lastPrice: snapshot.lastPrice,
      partialExitDone: existingPosition ? existingPosition.partialExitDone === true : false,
      partialTargetPrice: averageEntryPrice + initialRiskPerUnit * config.PARTIAL_TP_R,
      stopLoss,
      symbol: snapshot.symbol,
      takeProfit,
      tradeId,
      trailingActive: existingPosition ? existingPosition.trailingActive : false,
      trailingStop: existingPosition ? existingPosition.trailingStop : null,
      usdtAllocated: totalNotionalAllocated
    };

    if (existingPosition) {
      const index = state.positions.findIndex((position) => position.symbol === snapshot.symbol);
      state.positions[index] = positionData;
    } else {
      state.positions.push(positionData);
    }

    state.usdtBalance -= buyExecution.cashOut;
    state.trades.push({
      action: "BUY",
      btcAmount: buyExecution.btcAmount,
      budgetRemainingAfter,
      budgetUsedAfter: totalNotionalAllocated,
      decisionState: snapshot.decisionState,
      detailedExplanation: explanationDetailed,
      entryEngine,
      entryIndex: nextEntryCount,
      entryType: entryEngine,
      expectedNetProfitUsdt: profitabilityAllocation.expectedNetProfitUsdt,
      exitReasonCode: null,
      explanationShort,
      feePaid: buyExecution.feePaid,
      netPnlUsdt: null,
      pnlUsdt: null,
      price: buyExecution.executionPrice,
      reason: snapshot.reason,
      reasonList: snapshot.reasonList,
      slippagePaid: buyExecution.slippagePaid,
      symbol: snapshot.symbol,
      time: tradeTime,
      tradeId,
      usdtAmount: usdtToUse
    });

    context.persistence.appendTradeLog(
      `BUY | symbol=${snapshot.symbol} | tradeId=${tradeId} | entry=${entryEngine} | price=${context.formatAmount(buyExecution.executionPrice)} | btc=${context.formatAmount(buyExecution.btcAmount)} | usdt_spent=${context.formatAmount(usdtToUse)} | expected_net_profit=${context.formatAmount(profitabilityAllocation.expectedNetProfitUsdt)} | edge_bps=${context.formatAmount(snapshot.projectedNetEdgeBps || 0)} | rr=${context.formatAmount(snapshot.projectedRiskRewardRatio || 0)} | score=${snapshot.compositeScore} | atr=${context.formatAmount(snapshot.atr14_5m)} | sl=${context.formatAmount(stopLoss)} | tp=${context.formatAmount(takeProfit)} | hard_floor_nuclear=${context.formatAmount(hardFloor)} | feePaid=${context.formatAmount(buyExecution.feePaid)} | slippagePaid=${context.formatAmount(buyExecution.slippagePaid)} | netPnlUsdt=null | trend_1h=${snapshot.trendBull_1h ? "bullish" : "neutral"} | entry_count=${nextEntryCount} | reason=${snapshot.reason}`
    );
    context.logScoped("TRADE", `${existingPosition ? "buy_add" : "buy"} | symbol=${snapshot.symbol} | engine=${entryEngine} | price=${context.formatLogNumber(buyExecution.executionPrice, 6)} | btc=${context.formatLogNumber(buyExecution.btcAmount, 6)} | usdt=${context.formatLogNumber(usdtToUse, 2)} | exp_net=${context.formatLogNumber(profitabilityAllocation.expectedNetProfitUsdt, 2)} | fee=${context.formatLogNumber(buyExecution.feePaid, 4)} | slip=${context.formatLogNumber(buyExecution.slippagePaid, 4)} | score=${snapshot.compositeScore} | sl=${context.formatLogNumber(stopLoss, 6)} | tp=${context.formatLogNumber(takeProfit, 6)} | entry_count=${nextEntryCount}`);
    context.persistence.saveStateToDisk();
  }

  function executePartialExit(snapshot) {
    const currentPosition = state.positions.find((position) => position.symbol === snapshot.symbol);
    if (!currentPosition || !snapshot || snapshot.lastPrice === null || currentPosition.partialExitDone) {
      return;
    }

    const exitAmount = currentPosition.btcAmount * 0.5;
    const slippageBps = calcSlippageBps(snapshot.currentVolume_5m, snapshot.volumeSMA20);
    const execution = simulateSellExecution(snapshot.lastPrice, exitAmount, slippageBps);
    const costShare = currentPosition.costBasisUsdt * (exitAmount / currentPosition.btcAmount);
    const notionalShare = currentPosition.usdtAllocated * (exitAmount / currentPosition.btcAmount);
    const netPnlUsdt = execution.netProceeds - costShare;

    currentPosition.btcAmount -= exitAmount;
    currentPosition.costBasisUsdt -= costShare;
    currentPosition.usdtAllocated -= notionalShare;
    currentPosition.partialExitDone = true;
    currentPosition.stopLoss = currentPosition.entryPrice;
    currentPosition.trailingActive = true;
    currentPosition.trailingStop = currentPosition.entryPrice;
    currentPosition.takeProfit = null;
    currentPosition.lastPrice = snapshot.lastPrice;
    state.usdtBalance += execution.netProceeds;

    state.trades.push({
      action: "SELL_PARTIAL",
      btcAmount: exitAmount,
      decisionState: context.strategy.DECISION_STATES.EXIT_SIGNAL,
      detailedExplanation: `Il trade su ${currentPosition.symbol} ha raggiunto ${config.PARTIAL_TP_R}R. Il bot chiude il 50% della posizione e sposta lo stop a breakeven sulla parte restante.`,
      entryEngine: currentPosition.entryEngine,
      entryIndex: currentPosition.entryCount,
      exitReasonCode: context.strategy.EXIT_REASON_CODES.PARTIAL_TAKE_PROFIT,
      explanationShort: "Il bot incassa una parte del profitto e lascia correre il resto.",
      feePaid: execution.feePaid,
      netPnlUsdt,
      pnlUsdt: netPnlUsdt,
      price: execution.executionPrice,
      reason: context.strategy.getExitReasonLabel(context.strategy.EXIT_REASON_CODES.PARTIAL_TAKE_PROFIT),
      reasonList: ["Decisione finale: SELL_PARTIAL", `Motivo: target parziale ${config.PARTIAL_TP_R}R raggiunto`, "Stop spostato a breakeven"],
      slippagePaid: execution.slippagePaid,
      symbol: currentPosition.symbol,
      time: new Date().toISOString(),
      tradeId: currentPosition.tradeId,
      usdtAmount: execution.netProceeds
    });

    context.persistence.appendTradeLog(
      `SELL_PARTIAL | symbol=${currentPosition.symbol} | tradeId=${currentPosition.tradeId} | price=${context.formatAmount(execution.executionPrice)} | btc=${context.formatAmount(exitAmount)} | usdt_received=${context.formatAmount(execution.netProceeds)} | feePaid=${context.formatAmount(execution.feePaid)} | slippagePaid=${context.formatAmount(execution.slippagePaid)} | netPnlUsdt=${context.formatAmount(netPnlUsdt)} | reason=${context.strategy.getExitReasonLabel(context.strategy.EXIT_REASON_CODES.PARTIAL_TAKE_PROFIT)}`
    );
    context.logScoped("TRADE", `sell_partial | symbol=${currentPosition.symbol} | price=${context.formatLogNumber(execution.executionPrice, 6)} | btc=${context.formatLogNumber(exitAmount, 6)} | usdt=${context.formatLogNumber(execution.netProceeds, 2)} | fee=${context.formatLogNumber(execution.feePaid, 4)} | slip=${context.formatLogNumber(execution.slippagePaid, 4)} | net_pnl=${context.formatLogNumber(netPnlUsdt, 2)} | stop=breakeven`);
    context.persistence.saveStateToDisk();
  }

  function manageOpenPosition(snapshot) {
    const currentPosition = state.positions.find((position) => position.symbol === snapshot.symbol);
    if (!currentPosition || !snapshot || snapshot.lastPrice === null) {
      return { exitReasonCode: null, shouldExit: false, shouldPartialExit: false };
    }

    const trailingAtr = snapshot.atr14_5m ?? currentPosition.atr ?? null;
    currentPosition.holdCandles = (currentPosition.holdCandles || 0) + 1;
    currentPosition.lastPrice = snapshot.lastPrice;
    currentPosition.highWaterMark = Math.max(currentPosition.highWaterMark || snapshot.lastPrice, snapshot.lastPrice);

    if (snapshot.lastPrice <= currentPosition.hardFloor) {
      return { exitReasonCode: context.strategy.EXIT_REASON_CODES.HARD_STOP, shouldExit: true, shouldPartialExit: false };
    }

    const elapsedSeconds = currentPosition.entryTime ? (Date.now() - currentPosition.entryTime) / 1000 : Number.MAX_SAFE_INTEGER;
    const halfRTarget = currentPosition.entryPrice + currentPosition.initialRiskPerUnit * 0.5;
    const partialTargetPrice = currentPosition.partialTargetPrice || (currentPosition.entryPrice + currentPosition.initialRiskPerUnit * config.PARTIAL_TP_R);
    const partialTargetHit = !currentPosition.partialExitDone && snapshot.lastPrice >= partialTargetPrice;
    if (partialTargetHit) {
      return { exitReasonCode: context.strategy.EXIT_REASON_CODES.PARTIAL_TAKE_PROFIT, shouldExit: false, shouldPartialExit: true };
    }

    if (currentPosition.partialExitDone) {
      const trailingCandidate = trailingAtr !== null ? currentPosition.highWaterMark - trailingAtr * config.ATR_TRAIL_MULT : snapshot.ema21_5m !== null ? Math.max(snapshot.ema21_5m, currentPosition.entryPrice) : currentPosition.highWaterMark * (1 - config.TRAILING_PCT);
      currentPosition.trailingActive = true;
      currentPosition.trailingStop = Math.max(currentPosition.trailingStop || trailingCandidate, trailingCandidate, currentPosition.entryPrice);
    } else if (!currentPosition.trailingActive && trailingAtr !== null && snapshot.lastPrice - currentPosition.entryPrice >= trailingAtr) {
      currentPosition.trailingActive = true;
      currentPosition.trailingStop = trailingAtr !== null ? currentPosition.highWaterMark - trailingAtr * config.ATR_TRAIL_MULT : currentPosition.highWaterMark * (1 - config.TRAILING_PCT);
    } else if (currentPosition.trailingActive) {
      const candidate = trailingAtr !== null ? currentPosition.highWaterMark - trailingAtr * config.ATR_TRAIL_MULT : currentPosition.highWaterMark * (1 - config.TRAILING_PCT);
      currentPosition.trailingStop = Math.max(currentPosition.trailingStop || candidate, candidate);
    }

    const trailingStopHit = currentPosition.trailingActive && currentPosition.trailingStop !== null && snapshot.lastPrice <= currentPosition.trailingStop;
    const stopLossHit = snapshot.lastPrice <= currentPosition.stopLoss;
    const takeProfitHit = !currentPosition.partialExitDone && currentPosition.takeProfit !== null && snapshot.lastPrice >= currentPosition.takeProfit;
    const volumeAbsorptionHit = currentPosition.holdCandles >= config.MIN_HOLD_CANDLES && snapshot.currentVolume_5m !== null && snapshot.volumeSMA20 !== null && snapshot.previousClose_5m !== null && snapshot.lastPrice_5m !== null && snapshot.currentVolume_5m > snapshot.volumeSMA20 * 2.5 && snapshot.lastPrice_5m <= snapshot.previousClose_5m;
    const trendReversalHit = currentPosition.holdCandles >= config.MIN_HOLD_CANDLES && snapshot.trendBull_1h === false;
    const timeStopHit = currentPosition.holdCandles >= config.TIME_STOP_CANDLES && snapshot.lastPrice < halfRTarget;
    const hardExitHit = trailingStopHit || stopLossHit || takeProfitHit;
    const softExitHit = volumeAbsorptionHit || trendReversalHit || timeStopHit;

    if (softExitHit && !hardExitHit && elapsedSeconds < config.MIN_HOLD_SECONDS) {
      return { exitReasonCode: null, shouldExit: false, shouldPartialExit: false };
    }
    if (trailingStopHit) return { exitReasonCode: context.strategy.EXIT_REASON_CODES.TRAILING_STOP, shouldExit: true, shouldPartialExit: false };
    if (stopLossHit) return { exitReasonCode: context.strategy.EXIT_REASON_CODES.ATR_STOP, shouldExit: true, shouldPartialExit: false };
    if (takeProfitHit) return { exitReasonCode: context.strategy.EXIT_REASON_CODES.TAKE_PROFIT, shouldExit: true, shouldPartialExit: false };
    if (volumeAbsorptionHit) return { exitReasonCode: context.strategy.EXIT_REASON_CODES.VOLUME_ABSORPTION, shouldExit: true, shouldPartialExit: false };
    if (trendReversalHit) return { exitReasonCode: context.strategy.EXIT_REASON_CODES.TREND_REVERSAL, shouldExit: true, shouldPartialExit: false };
    if (timeStopHit) return { exitReasonCode: context.strategy.EXIT_REASON_CODES.TIME_STOP, shouldExit: true, shouldPartialExit: false };

    return { exitReasonCode: null, shouldExit: false, shouldPartialExit: false };
  }

  function refreshPositionSnapshot(snapshot, management) {
    const currentPosition = state.positions.find((position) => position.symbol === snapshot.symbol);
    if (!snapshot || !currentPosition) {
      return;
    }

    snapshot.positionOpen = true;
    snapshot.entryPrice = currentPosition.entryPrice;
    snapshot.stopLoss = currentPosition.stopLoss;
    snapshot.takeProfit = currentPosition.takeProfit;
    snapshot.highWaterMark = currentPosition.highWaterMark;
    snapshot.trailingStop = currentPosition.trailingStop;
    snapshot.holdCandles = currentPosition.holdCandles;
    snapshot.entryCount = currentPosition.entryCount;
    snapshot.signal = management.shouldExit ? "SELL candidate" : "HOLD";
    snapshot.action = management.shouldExit ? "SELL" : "HOLD";
    snapshot.displayAction = management.shouldExit ? "SELL" : "HOLD";
    snapshot.decisionState = management.shouldExit ? context.strategy.DECISION_STATES.EXIT_SIGNAL : context.strategy.DECISION_STATES.HOLD_POSITION;
    snapshot.exitReasonCode = management.exitReasonCode || null;
    snapshot.reason = context.strategy.getDecisionReason(snapshot.decisionState, { exitReasonCode: management.exitReasonCode });

    const explanation = context.strategy.buildDecisionExplanation({
      ...snapshot,
      positionOpen: true
    });
    snapshot.shortExplanation = explanation.shortExplanation;
    snapshot.detailedExplanation = explanation.detailedExplanation;
    snapshot.reasonList = explanation.reasonList;
  }

  function closePaperPosition(snapshot, exitReasonCode) {
    const currentPosition = state.positions.find((position) => position.symbol === snapshot.symbol);
    if (!currentPosition || !snapshot || snapshot.lastPrice === null) {
      return;
    }

    const closedSymbol = currentPosition.symbol;
    const slippageBps = calcSlippageBps(snapshot.currentVolume_5m, snapshot.volumeSMA20);
    const execution = simulateSellExecution(snapshot.lastPrice, currentPosition.btcAmount, slippageBps);
    const profit = execution.netProceeds - currentPosition.costBasisUsdt;
    const explanation = context.strategy.buildDecisionExplanation({
      ...snapshot,
      action: "SELL",
      decisionState: context.strategy.DECISION_STATES.EXIT_SIGNAL,
      displayAction: "SELL",
      exitReasonCode,
      positionOpen: true,
      reason: context.strategy.getExitReasonLabel(exitReasonCode)
    });

    state.trades.push({
      action: "SELL_FULL",
      btcAmount: currentPosition.btcAmount,
      budgetRemainingAfter: (state.usdtBalance + execution.netProceeds) * config.MAX_POSITION_EXPOSURE_PCT,
      budgetUsedAfter: state.positions.reduce((sum, position) => position.symbol === closedSymbol ? sum : sum + position.usdtAllocated, 0),
      decisionState: context.strategy.DECISION_STATES.EXIT_SIGNAL,
      detailedExplanation: explanation.detailedExplanation,
      entryEngine: currentPosition.entryEngine,
      entryIndex: currentPosition.entryCount,
      exitReasonCode,
      explanationShort: explanation.shortExplanation,
      feePaid: execution.feePaid,
      netPnlUsdt: profit,
      pnlUsdt: profit,
      price: execution.executionPrice,
      reason: context.strategy.getExitReasonLabel(exitReasonCode),
      reasonList: explanation.reasonList,
      slippagePaid: execution.slippagePaid,
      symbol: currentPosition.symbol,
      time: new Date().toISOString(),
      tradeId: currentPosition.tradeId,
      usdtAmount: execution.netProceeds
    });

    context.persistence.appendTradeLog(
      `SELL_FULL | symbol=${currentPosition.symbol} | tradeId=${currentPosition.tradeId} | price=${context.formatAmount(execution.executionPrice)} | btc=${context.formatAmount(currentPosition.btcAmount)} | usdt_received=${context.formatAmount(execution.netProceeds)} | feePaid=${context.formatAmount(execution.feePaid)} | slippagePaid=${context.formatAmount(execution.slippagePaid)} | netPnlUsdt=${context.formatAmount(profit)} | holdCandles=${currentPosition.holdCandles} | highWaterMark=${context.formatAmount(currentPosition.highWaterMark)} | trailing=${currentPosition.trailingStop === null ? "null" : context.formatAmount(currentPosition.trailingStop)} | reason=${context.strategy.getExitReasonLabel(exitReasonCode)}`
    );
    context.logScoped("TRADE", `sell_full | symbol=${currentPosition.symbol} | price=${context.formatLogNumber(execution.executionPrice, 6)} | btc=${context.formatLogNumber(currentPosition.btcAmount, 6)} | usdt=${context.formatLogNumber(execution.netProceeds, 2)} | fee=${context.formatLogNumber(execution.feePaid, 4)} | slip=${context.formatLogNumber(execution.slippagePaid, 4)} | net_pnl=${context.formatLogNumber(profit, 2)} | hold=${currentPosition.holdCandles} | trailing=${currentPosition.trailingStop === null ? "null" : context.formatLogNumber(currentPosition.trailingStop, 6)} | reason=${exitReasonCode}`);

    state.usdtBalance += execution.netProceeds;
    recentlyExited.add(closedSymbol);
    recentlyExitedExpiry.set(closedSymbol, currentScanCycle + 30);
    if (profit < 0) {
      symbolCooldown.set(closedSymbol, currentScanCycle + Math.max(30, config.LOSS_COOLDOWN_CYCLES));
    }

    state.positions = state.positions.filter((position) => position.symbol !== closedSymbol);
    context.persistence.saveStateToDisk();
  }

  async function fetchTopSymbols(exchange) {
    const tickers = await context.withTimeout(exchange.fetchTickers(), "fetchTickers");
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
        const volumeScore = Number.isFinite(quoteVolume) && quoteVolume > 0 ? quoteVolume : Number.isFinite(baseVolume) && Number.isFinite(lastPrice) && baseVolume > 0 && lastPrice > 0 ? baseVolume * lastPrice : Number.isFinite(infoQuoteVolume) && infoQuoteVolume > 0 ? infoQuoteVolume : 0;
        const percentage = Number.isFinite(ticker?.percentage) ? Math.abs(ticker.percentage) : 0;

        return {
          active: ticker?.active !== false,
          askPrice,
          baseAsset,
          bidPrice,
          highPrice,
          hotnessScore: volumeScore * (1 + (percentage / 100) * 5),
          lastPrice,
          lowPrice,
          openPrice,
          quoteAsset,
          symbol: normalizedSymbol,
          volumeScore
        };
      })
      .filter((ticker) => {
        if (!ticker.symbol || !ticker.baseAsset || !["USDT", "USDC", "FDUSD"].includes(ticker.quoteAsset)) return false;
        if (!ticker.active) return false;
        if (config.EXCLUDED_BASE_ASSETS.has(ticker.baseAsset.toUpperCase())) return false;
        if (config.LEVERAGED_TOKEN_REGEX.test(ticker.baseAsset)) return false;
        if (/[^\x20-\x7E]/.test(ticker.baseAsset)) return false;
        if (ticker.baseAsset.length > 10) return false;
        if (!Number.isFinite(ticker.volumeScore) || ticker.volumeScore < 500000) return false;
        if (Number.isFinite(ticker.lastPrice) && ticker.lastPrice < 0.0001) return false;
        if (Number.isFinite(ticker.highPrice) && Number.isFinite(ticker.lowPrice) && Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0) {
          const atrPct = (ticker.highPrice - ticker.lowPrice) / ticker.lastPrice;
          if (atrPct < 0.005 || atrPct > 0.08) return false;
        }
        if (Number.isFinite(ticker.highPrice) && Number.isFinite(ticker.lowPrice) && Number.isFinite(ticker.openPrice) && Number.isFinite(ticker.lastPrice)) {
          const fullRange = ticker.highPrice - ticker.lowPrice;
          if (fullRange > 0) {
            const wickRatio = (fullRange - Math.abs(ticker.openPrice - ticker.lastPrice)) / fullRange;
            if (wickRatio > 0.65) return false;
          }
        }
        if (Number.isFinite(ticker.bidPrice) && Number.isFinite(ticker.askPrice) && ticker.askPrice > 0) {
          const spreadPct = (ticker.askPrice - ticker.bidPrice) / ticker.askPrice;
          if (spreadPct > config.SPREAD_MAX_PCT) return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (right.hotnessScore !== left.hotnessScore) return right.hotnessScore - left.hotnessScore;
        const leftPriority = config.DYNAMIC_QUOTE_PRIORITY.get(left.quoteAsset) ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = config.DYNAMIC_QUOTE_PRIORITY.get(right.quoteAsset) ?? Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return right.volumeScore - left.volumeScore;
      })
      .reduce((selected, ticker) => {
        if (selected.seenBaseAssets.has(ticker.baseAsset)) return selected;
        selected.seenBaseAssets.add(ticker.baseAsset);
        selected.symbols.push(ticker.symbol);
        return selected;
      }, { seenBaseAssets: new Set(), symbols: [] })
      .symbols
      .slice(0, config.HOT_SYMBOLS_POOL_COUNT);
  }

  async function fetchCandlesBatched(restExchange, streamExchange, symbols, realtimeSymbols) {
    const results = [];
    for (let index = 0; index < symbols.length; index += config.BATCH_SIZE) {
      const batchSymbols = symbols.slice(index, index + config.BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batchSymbols.map(async (symbol) => {
          const [candles_1h, candles_5m, candles_1m] = await Promise.all([
            getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, "1h", config.FETCH_LIMIT_1H, realtimeSymbols),
            getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, "5m", config.FETCH_LIMIT_5M, realtimeSymbols),
            getCandlesWithRealtimeFallback(restExchange, streamExchange, symbol, "1m", config.FETCH_LIMIT_1M, realtimeSymbols)
          ]);
          return { candleSet: { candles_1h, candles_5m, candles_1m }, symbol };
        })
      );

      for (const [batchOffset, result] of batchResults.entries()) {
        if (result.status !== "fulfilled") {
          context.logScoped("FETCH", `market_error | symbol=${batchSymbols[batchOffset]} | message=${result.reason?.message || "Unknown error"}`);
          continue;
        }
        results.push(result.value);
      }

      if (index + config.BATCH_SIZE < symbols.length && config.BATCH_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.BATCH_DELAY_MS));
      }
    }
    return results;
  }

  function rotateWeakSymbols(currentMarkets, allCandidates, currentSymbols, focusSymbol = null, options = {}) {
    const { includeBtc = true, weakRsiMax = 45 } = options;
    watchlistRotationCycle = currentScanCycle;
    if (!Array.isArray(allCandidates) || allCandidates.length === 0) {
      return currentSymbols;
    }

    const anchoredSymbols = [];
    const anchoredSet = new Set();
    const pushAnchored = (symbol) => {
      if (!symbol || anchoredSet.has(symbol)) {
        return;
      }
      anchoredSet.add(symbol);
      anchoredSymbols.push(symbol);
    };

    for (const position of state.positions) {
      pushAnchored(position.symbol);
    }
    pushAnchored(focusSymbol);
    if (includeBtc) {
      pushAnchored("BTC/USDT");
    }

    const nextSymbols = [...currentSymbols];
    const activeSet = new Set(currentSymbols);
    const candidatePool = allCandidates.filter((candidateSymbol) => !activeSet.has(candidateSymbol) && !anchoredSet.has(candidateSymbol));
    const weakSymbols = currentSymbols
      .filter((symbol) => {
        if (anchoredSet.has(symbol)) {
          return false;
        }
        const market = currentMarkets[symbol];
        if (!market || market.positionOpen) {
          return false;
        }
        const rsi = Number(market.rsi_5m);
        return !Number.isFinite(rsi) || rsi <= weakRsiMax;
      })
      .sort((left, right) => {
        const leftRsi = Number(currentMarkets[left]?.rsi_5m);
        const rightRsi = Number(currentMarkets[right]?.rsi_5m);
        const normalizedLeft = Number.isFinite(leftRsi) ? leftRsi : Number.NEGATIVE_INFINITY;
        const normalizedRight = Number.isFinite(rightRsi) ? rightRsi : Number.NEGATIVE_INFINITY;
        return normalizedLeft - normalizedRight;
      });

    const replacements = [];
    for (const weakSymbol of weakSymbols) {
      if (candidatePool.length === 0) {
        break;
      }

      let replacementIndex = -1;
      for (let offset = 0; offset < candidatePool.length; offset += 1) {
        const candidateIndex = (hotPoolCursor + offset) % candidatePool.length;
        const candidateSymbol = candidatePool[candidateIndex];
        if (activeSet.has(candidateSymbol) || anchoredSet.has(candidateSymbol)) {
          continue;
        }
        replacementIndex = candidateIndex;
        break;
      }

      if (replacementIndex === -1) {
        break;
      }

      const replacement = candidatePool.splice(replacementIndex, 1)[0];
      hotPoolCursor = candidatePool.length > 0 ? replacementIndex % candidatePool.length : 0;
      const weakIndex = nextSymbols.indexOf(weakSymbol);
      if (weakIndex === -1) {
        continue;
      }

      const weakRsi = Number(currentMarkets[weakSymbol]?.rsi_5m);
      nextSymbols[weakIndex] = replacement;
      activeSet.delete(weakSymbol);
      activeSet.add(replacement);
      replacements.push({
        added: replacement,
        dropped: weakSymbol,
        weakRsi: Number.isFinite(weakRsi) ? weakRsi : null
      });
    }

    const previousLabel = currentSymbols.join(",");
    const nextLabel = nextSymbols.join(",");
    state.watchlist.lastRotationAt = new Date().toISOString();
    state.watchlist.weakThresholdRsi = weakRsiMax;
    state.watchlist.lastRotationSummary = {
      anchoredSymbols: [...anchoredSymbols],
      focusSymbol,
      replacedCount: replacements.length,
      thresholdRsi: weakRsiMax,
      weakSymbols: weakSymbols.map((symbol) => ({
        rsi: Number.isFinite(Number(currentMarkets[symbol]?.rsi_5m)) ? Number(currentMarkets[symbol].rsi_5m) : null,
        symbol
      }))
    };
    if (replacements.length > 0) {
      const stampedReplacements = replacements.map((replacement) => ({
        ...replacement,
        time: new Date().toISOString()
      }));
      state.watchlist.recentSwaps = [...stampedReplacements, ...(state.watchlist.recentSwaps || [])].slice(0, 20);
    }
    if (replacements.length > 0 && previousLabel !== nextLabel) {
      context.logScoped(
        "WATCHLIST",
        `rotate_weak | focus=${focusSymbol || "none"} | anchors=${anchoredSymbols.join(",") || "none"} | weak=${replacements.length} | threshold_rsi=${weakRsiMax}`
      );
      for (const replacement of replacements) {
        context.logScoped(
          "WATCHLIST",
          `swap | dropped=${replacement.dropped} | weak_rsi=${replacement.weakRsi === null ? "n/a" : replacement.weakRsi.toFixed(2)} | added=${replacement.added}`
        );
      }
      context.logScoped("WATCHLIST", `symbols | ${nextLabel}`);
    }

    return nextSymbols;
  }

  function pruneExpiringState() {
    for (const [symbol, expiryCycle] of symbolCooldown.entries()) {
      if (expiryCycle <= currentScanCycle) symbolCooldown.delete(symbol);
    }
    for (const symbol of [...recentlyExited]) {
      const expiryCycle = recentlyExitedExpiry.get(symbol);
      if (expiryCycle === undefined || expiryCycle <= currentScanCycle) {
        recentlyExited.delete(symbol);
        recentlyExitedExpiry.delete(symbol);
      }
    }
  }

  return {
    calcSlippageBps,
    closePaperPosition,
    executePartialExit,
    fetchCandlesBatched,
    fetchTopSymbols,
    getCandlesWithRealtimeFallback,
    manageOpenPosition,
    normalizeDynamicSymbols,
    openPaperPosition,
    pruneExpiringState,
    refreshPositionSnapshot,
    resetTransientState,
    rotateWeakSymbols,
    selectRealtimeSymbols,
    setCurrentScanCycle
  };
}

module.exports = {
  createRuntime
};
