"use strict";

const { StateStore } = require("../src/core/stateStore.ts");
const { HistoricalBootstrapService } = require("../src/core/historicalBootstrapService.ts");
const { MtfContextService } = require("../src/core/mtfContextService.ts");

function makeKline(symbol, interval, openedAt, close, intervalMs = 60_000) {
  return {
    close,
    closedAt: openedAt + intervalMs - 1,
    high: close + 1,
    interval,
    isClosed: true,
    low: close - 1,
    open: close - 0.5,
    openedAt,
    receivedAt: openedAt + intervalMs,
    source: "rest",
    symbol,
    timestamp: openedAt + intervalMs - 1,
    volume: 10
  };
}

function makeFetchResult(symbols, interval, observedAt, options = {}) {
  const intervalMs = interval === "5m" ? 300_000 : interval === "1h" ? 3_600_000 : 60_000;
  const count = options.count || 10;
  const klinesBySymbol = {};
  for (const symbol of symbols) {
    if (options.failSymbol === symbol) {
      klinesBySymbol[symbol] = [];
      continue;
    }
    klinesBySymbol[symbol] = Array.from({ length: count }, (_, index) => {
      const openedAt = observedAt - (count - index) * intervalMs;
      return makeKline(symbol, interval, openedAt, 100 + index, intervalMs);
    });
  }
  return {
    interval,
    klinesBySymbol,
    requestedSymbols: symbols,
    symbolResults: symbols.map((symbol) => ({
      error: options.failSymbol === symbol ? "boom" : null,
      klineCount: options.failSymbol === symbol ? 0 : count,
      symbol
    }))
  };
}

function makeService(params) {
  const store = params.store || new StateStore();
  const calls = [];
  const logs = [];
  const marketStream = {
    async fetchHistoricalKlines(request) {
      calls.push(request);
      if (params.throwFetch) {
        throw new Error(params.throwFetch);
      }
      return makeFetchResult(request.symbols, request.interval, request.observedAt, {
        count: params.count || 10,
        failSymbol: params.failSymbol
      });
    }
  };
  const logger = {
    error(event, metadata) { logs.push({ event, level: "error", metadata }); },
    info(event, metadata) { logs.push({ event, level: "info", metadata }); },
    warn(event, metadata) { logs.push({ event, level: "warn", metadata }); }
  };
  const service = new HistoricalBootstrapService({
    architectWarmupMs: 20_000,
    config: params.config || {},
    contextMaxWindowMs: 300_000,
    logger,
    marketKlineIntervals: params.marketKlineIntervals || [],
    marketStream,
    mtfConfig: params.mtfConfig || null,
    store
  });
  return { calls, logs, service, store };
}

async function runHistoricalBootstrapServiceTests() {
  const observedAt = 1_700_000_000_000;

  {
    const { calls, service, store } = makeService({
      config: { enabled: false, required: true, timeframes: ["1m"], priceTimeframe: "1m" }
    });
    const result = await service.run(["BTC/USDT"], { observedAt });
    if (result.outcome !== "disabled" || result.enabled !== false) {
      throw new Error(`disabled preload should return a disabled result: ${JSON.stringify(result)}`);
    }
    if (calls.length !== 0 || store.getPriceHistory("BTC/USDT").length !== 0) {
      throw new Error("disabled preload should not fetch or seed the store");
    }
  }

  {
    const { calls, logs, service, store } = makeService({
      config: {
        enabled: true,
        required: false,
        horizonMs: 3_600_000,
        priceTimeframe: "1m",
        timeframes: ["1m", "5m"],
        timeoutMs: 1_000,
        limit: 100
      },
      count: 12
    });
    const result = await service.run(["BTC/USDT", "ETH/USDT"], { observedAt });
    if (result.outcome !== "completed") {
      throw new Error(`successful preload should complete: ${JSON.stringify(result)}`);
    }
    if (calls.length !== 2 || calls[0].interval !== "1m" || calls[1].interval !== "5m") {
      throw new Error(`preload should fetch the configured bounded timeframes: ${JSON.stringify(calls)}`);
    }
    if (store.getPriceHistory("BTC/USDT").length !== 12 || store.getPriceHistory("ETH/USDT").length !== 12) {
      throw new Error("preload should seed price history for each symbol through StateStore.updatePrice");
    }
    if (store.getKlines("BTC/USDT", "5m", 20).length !== 12) {
      throw new Error("preload should seed kline history through StateStore.updateKline");
    }
    if (!logs.some((entry) => entry.event === "historical_preload_requested")
      || !logs.some((entry) => entry.event === "historical_preload_completed")) {
      throw new Error(`successful preload should emit startup diagnostics: ${JSON.stringify(logs)}`);
    }
  }

  {
    const { logs, service } = makeService({
      config: {
        enabled: true,
        required: false,
        priceTimeframe: "1m",
        timeframes: ["1m"],
        timeoutMs: 1_000,
        limit: 100
      },
      failSymbol: "ETH/USDT"
    });
    const result = await service.run(["BTC/USDT", "ETH/USDT"], { observedAt });
    if (result.outcome !== "partial" || !String(result.reason || "").includes("missing price preload")) {
      throw new Error(`optional partial preload should degrade explicitly: ${JSON.stringify(result)}`);
    }
    if (!logs.some((entry) => entry.event === "historical_preload_degraded" && entry.level === "warn")) {
      throw new Error(`optional partial preload should log a degraded warning: ${JSON.stringify(logs)}`);
    }
  }

  {
    const { service } = makeService({
      config: {
        enabled: true,
        required: true,
        priceTimeframe: "1m",
        timeframes: ["1m"],
        timeoutMs: 1_000,
        limit: 100
      },
      failSymbol: "ETH/USDT"
    });
    let threw = false;
    try {
      await service.run(["BTC/USDT", "ETH/USDT"], { observedAt });
    } catch (error) {
      threw = String(error && error.message).includes("required historical preload failed");
    }
    if (!threw) {
      throw new Error("required partial preload should abort startup clearly");
    }
  }

  {
    const store = new StateStore({ maxPriceHistory: 200 });
    const { service } = makeService({
      config: {
        enabled: true,
        required: true,
        horizonMs: 3_600_000,
        priceTimeframe: "1m",
        timeframes: ["1m"],
        timeoutMs: 1_000,
        limit: 100
      },
      count: 70,
      store
    });
    await service.run(["BTC/USDT"], { observedAt });
    const mtfService = new MtfContextService({
      architect: {
        assess(context) {
          return {
            confidence: 0.8,
            marketRegime: "trend",
            sufficientData: context.warmupComplete
          };
        }
      },
      contextBuilder: {
        createSnapshot(params) {
          const ticks = params.ticks || [];
          const span = ticks.length > 1
            ? Number(ticks[ticks.length - 1].timestamp) - Number(ticks[0].timestamp)
            : 0;
          return {
            features: { dataQuality: 1 },
            observedAt: params.observedAt,
            structureState: "trending",
            symbol: params.symbol,
            trendBias: "bullish",
            volatilityState: "normal",
            warmupComplete: span >= params.warmupMs
          };
        }
      },
      store
    });
    const frames = mtfService.buildMtfSnapshots({
      frames: [
        { id: "5m", horizonFrame: "short", windowMs: 300_000 },
        { id: "1h", horizonFrame: "long", windowMs: 3_600_000 }
      ],
      now: observedAt,
      symbol: "BTC/USDT"
    });
    if (frames.length !== 2 || !frames.every((frame) => frame.ready)) {
      throw new Error(`preloaded store history should make MTF frames ready early: ${JSON.stringify(frames)}`);
    }
  }
}

module.exports = {
  runHistoricalBootstrapServiceTests
};
