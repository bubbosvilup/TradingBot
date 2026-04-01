// Module responsibility: maintain rolling per-symbol context snapshots on top of the raw market store.

import type { ArchitectDataMode } from "../types/architect.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { MarketTick } from "../types/market.ts";

class ContextService {
  store: any;
  marketStream: any;
  contextBuilder: any;
  logger: any;
  warmupMs: number;
  maxWindowMs: number;
  subscriptions: Array<() => void>;
  readyLoggedBySymbol: Set<string>;

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

  observe(symbol: string, observedAt: number) {
    const history = this.store.getPriceHistory(symbol);
    if (!Array.isArray(history) || history.length <= 0) return null;
    const latestTimestamp = Number(history[history.length - 1].timestamp || observedAt);
    const oldestTimestamp = Number(history[0].timestamp || latestTimestamp);
    const currentSpanMs = Math.max(0, latestTimestamp - oldestTimestamp);
    const targetWindowMs = Math.min(this.maxWindowMs, Math.max(currentSpanMs, this.warmupMs));
    const windowStart = latestTimestamp - targetWindowMs;
    const ticks = history.filter((tick: MarketTick) => Number(tick.timestamp) >= windowStart);
    const snapshot = this.contextBuilder.createSnapshot({
      dataMode: this.resolveDataMode(ticks),
      maxWindowMs: this.maxWindowMs,
      observedAt,
      symbol,
      ticks,
      warmupMs: this.warmupMs
    });
    this.store.setContextSnapshot(symbol, snapshot);

    if (snapshot.warmupComplete && !this.readyLoggedBySymbol.has(symbol)) {
      this.readyLoggedBySymbol.add(symbol);
      this.logger.info("context_ready", {
        dataMode: snapshot.dataMode,
        quality: snapshot.features.dataQuality.toFixed(2),
        symbol,
        windowSec: Math.round(snapshot.windowSpanMs / 1000)
      });
    }

    return snapshot;
  }

  resolveDataMode(ticks: MarketTick[]): ArchitectDataMode {
    const sources = [...new Set((ticks || []).map((tick) => tick?.source).filter(Boolean))];
    if (sources.length <= 0) return "unknown";
    if (sources.every((source) => source === "mock")) return "mock";
    if (sources.some((source) => source === "mock") && sources.some((source) => source !== "mock")) return "mixed";
    return "live";
  }
}

module.exports = {
  ContextService
};
