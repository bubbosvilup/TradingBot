import type { ArchitectDataMode } from "../types/architect.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { MarketTick } from "../types/market.ts";

type TimingModule = {
  elapsedMs: (startedAt: bigint) => number;
  startTimer: () => bigint;
};

const { elapsedMs, startTimer } = require("../utils/timing.ts") as TimingModule;

class ContextService {
  store: any;
  marketStream: any;
  contextBuilder: any;
  logger: any;
  warmupMs: number;
  maxWindowMs: number;
  subscriptions: Array<() => void>;
  readyLoggedBySymbol: Set<string>;
  lastWindowModeBySymbol: Map<string, string>;
  lastRebuildSignatureBySymbol: Map<string, string>;

  constructor(deps: {
    store: any;
    marketStream: any;
    contextBuilder: any;
    logger: any;
    warmupMs?: number;
    maxWindowMs?: number;
  }) {
    this.store = deps.store;
    this.marketStream = deps.marketStream;
    this.contextBuilder = deps.contextBuilder;
    this.logger = deps.logger;
    this.warmupMs = Math.max(deps.warmupMs || 30_000, 5_000);
    this.maxWindowMs = Math.max(deps.maxWindowMs || 300_000, this.warmupMs);
    this.subscriptions = [];
    this.readyLoggedBySymbol = new Set();
    this.lastWindowModeBySymbol = new Map();
    this.lastRebuildSignatureBySymbol = new Map();
  }

  start(symbols: string[]) {
    this.stop();
    for (const symbol of [...new Set(symbols)]) {
      const unsubscribe = this.marketStream.subscribe(symbol, (tick: MarketTick) => {
        this.observe(symbol, tick.timestamp);
      });
      this.subscriptions.push(unsubscribe);
    }
  }

  stop() {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      try {
        unsubscribe();
      } catch {}
    }
  }

  pruneSymbols(symbols: string[]) {
    for (const symbol of [...new Set(symbols || [])]) {
      this.readyLoggedBySymbol.delete(symbol);
      this.lastWindowModeBySymbol.delete(symbol);
      this.lastRebuildSignatureBySymbol.delete(symbol);
    }
  }

  buildRebuildSignature(params: {
    effectiveTicks: MarketTick[];
    hasPublishedRegimeSwitch: boolean;
    latestTimestamp: number;
    publisher: any;
    priceHistoryRevision: number;
    ticks: MarketTick[];
    windowStart: number;
  }) {
    const effectiveFirstTimestamp = params.effectiveTicks.length > 0
      ? Number(params.effectiveTicks[0]?.timestamp || 0)
      : null;
    const effectiveLastTimestamp = params.effectiveTicks.length > 0
      ? Number(params.effectiveTicks[params.effectiveTicks.length - 1]?.timestamp || 0)
      : null;
    return JSON.stringify({
      effectiveCount: params.effectiveTicks.length,
      effectiveFirstTimestamp,
      effectiveLastTimestamp,
      hasPublishedRegimeSwitch: params.hasPublishedRegimeSwitch,
      lastPublishedRegimeSwitchAt: params.publisher?.lastRegimeSwitchAt ?? null,
      latestTimestamp: params.latestTimestamp,
      priceHistoryRevision: params.priceHistoryRevision,
      tickCount: params.ticks.length,
      windowStart: params.windowStart
    });
  }

  observe(symbol: string, observedAt: number) {
    const observeTimer = startTimer();
    const history = this.store.getPriceHistory(symbol);
    if (!Array.isArray(history) || history.length <= 0) return null;
    const latestTimestamp = Number(history[history.length - 1].timestamp || observedAt);
    const oldestTimestamp = Number(history[0].timestamp || latestTimestamp);
    const currentSpanMs = Math.max(0, latestTimestamp - oldestTimestamp);
    const targetWindowMs = Math.min(this.maxWindowMs, Math.max(currentSpanMs, this.warmupMs));
    const windowStart = latestTimestamp - targetWindowMs;
    const ticks = history.filter((tick: MarketTick) => Number(tick.timestamp) >= windowStart);
    const publisher = this.store.getArchitectPublisherState(symbol);
    const hasPublishedRegimeSwitch = publisher?.lastRegimeSwitchAt !== null
      && publisher?.lastRegimeSwitchAt !== undefined
      && Number.isFinite(Number(publisher.lastRegimeSwitchAt));
    const effectiveWindowStart = hasPublishedRegimeSwitch
      ? Math.max(windowStart, Number(publisher?.lastRegimeSwitchAt))
      : null;
    const effectiveTicks = effectiveWindowStart === null
      ? ticks
      : ticks.filter((tick: MarketTick) => Number(tick.timestamp) >= effectiveWindowStart);
    const priceHistoryRevision = typeof this.store.getPriceHistoryRevision === "function"
      ? this.store.getPriceHistoryRevision(symbol)
      : history.length;
    const rebuildSignature = this.buildRebuildSignature({
      effectiveTicks,
      hasPublishedRegimeSwitch,
      latestTimestamp,
      publisher,
      priceHistoryRevision,
      ticks,
      windowStart
    });
    const previousSnapshot = this.store.getContextSnapshot(symbol);
    if (previousSnapshot && this.lastRebuildSignatureBySymbol.get(symbol) === rebuildSignature) {
      const refreshedSnapshot = {
        ...previousSnapshot,
        observedAt
      };
      this.store.setContextSnapshot(symbol, refreshedSnapshot);
      if (typeof this.store.recordTickLatencySample === "function") {
        this.store.recordTickLatencySample(symbol, {
          contextBuildMs: 0,
          contextObserveMs: elapsedMs(observeTimer)
        }, observedAt);
      }
      return refreshedSnapshot;
    }
    const buildTimer = startTimer();
    const snapshot = this.contextBuilder.createSnapshot({
      dataMode: this.resolveDataMode(ticks),
      effectiveTicks,
      lastPublishedRegimeSwitchAt: publisher?.lastRegimeSwitchAt ?? null,
      lastPublishedRegimeSwitchFrom: publisher?.lastRegimeSwitchFrom ?? null,
      lastPublishedRegimeSwitchTo: publisher?.lastRegimeSwitchTo ?? null,
      maxWindowMs: this.maxWindowMs,
      observedAt,
      symbol,
      ticks,
      warmupMs: this.warmupMs
    });
    const contextBuildMs = elapsedMs(buildTimer);
    this.lastRebuildSignatureBySymbol.set(symbol, rebuildSignature);
    this.store.setContextSnapshot(symbol, snapshot);
    if (typeof this.store.recordTickLatencySample === "function") {
      this.store.recordTickLatencySample(symbol, {
        contextBuildMs,
        contextObserveMs: elapsedMs(observeTimer)
      }, observedAt);
    }

    const previousWindowMode = this.lastWindowModeBySymbol.get(symbol);
    if (snapshot.windowMode !== previousWindowMode) {
      this.lastWindowModeBySymbol.set(symbol, snapshot.windowMode);
      if (snapshot.windowMode === "post_switch_segment") {
        this.logger.info("context_window_segmented", {
          effectiveMaturity: Number(snapshot.features.maturity.toFixed(4)),
          effectiveWindowSec: Math.round(snapshot.effectiveWindowSpanMs / 1000),
          lastPublishedRegimeSwitchAt: snapshot.lastPublishedRegimeSwitchAt,
          lastPublishedRegimeSwitchFrom: snapshot.lastPublishedRegimeSwitchFrom,
          lastPublishedRegimeSwitchTo: snapshot.lastPublishedRegimeSwitchTo,
          postSwitchCoveragePct: snapshot.postSwitchCoveragePct === null ? null : Number(snapshot.postSwitchCoveragePct.toFixed(4)),
          rollingMaturity: Number(snapshot.rollingMaturity.toFixed(4)),
          rollingWindowSec: Math.round(snapshot.windowSpanMs / 1000),
          symbol
        });
      }
    }

    if (snapshot.warmupComplete && !this.readyLoggedBySymbol.has(symbol)) {
      this.readyLoggedBySymbol.add(symbol);
      this.logger.info("context_ready", {
        dataMode: snapshot.dataMode,
        effectiveWindowSec: Math.round(snapshot.effectiveWindowSpanMs / 1000),
        quality: snapshot.features.dataQuality.toFixed(2),
        symbol,
        windowMode: snapshot.windowMode,
        windowSec: Math.round(snapshot.windowSpanMs / 1000)
      });
    }

    return snapshot;
  }

  resolveDataMode(ticks: MarketTick[]): ArchitectDataMode {
    const sources = [...new Set(
      (ticks || [])
        .map((tick) => String(tick?.source || "").trim().toLowerCase())
        .filter((source) => source === "mock" || source === "ws" || source === "rest")
    )];
    if (sources.length <= 0) return "unknown";
    if (sources.every((source) => source === "mock")) return "mock";
    if (sources.some((source) => source === "mock")) return "mixed";
    return "live";
  }
}

module.exports = {
  ContextService
};
