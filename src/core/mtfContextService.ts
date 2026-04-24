// Strictly additive layer — no store writes, no mutation, no side effects.
// All behavior is behind mtf.enabled === true at the call site.
// Reuses ContextBuilder for feature extraction and BotArchitect for regime classification.

import type { ArchitectDataMode } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";
import type { MtfFrameConfig, MtfFrameSnapshot, MtfHorizonFrameId, MtfTimeframeId } from "../types/mtf.ts";

const MIN_WARMUP_MS = 5_000;
const WARMUP_FRACTION = 0.1;

class MtfContextService {
  store: any;
  contextBuilder: any;
  architect: any;

  constructor(deps: { store: any; contextBuilder: any; architect: any }) {
    this.store = deps.store;
    this.contextBuilder = deps.contextBuilder;
    this.architect = deps.architect;
  }

  /**
   * Build multi-timeframe frame snapshots for a single symbol.
   *
   * Pure read-only: reads tick history from the store, builds a ContextSnapshot
   * per frame via ContextBuilder, classifies regime via BotArchitect, and maps
   * the results into MtfFrameSnapshot[]. No store writes, no global mutation.
   */
  buildMtfSnapshots(params: {
    symbol: string;
    now: number;
    frames: MtfFrameConfig[];
  }): MtfFrameSnapshot[] {
    const { symbol, now, frames } = params;
    const oldestWindowStart = frames.reduce((oldest: number, frame: MtfFrameConfig) => {
      const windowStart = now - frame.windowMs;
      return windowStart < oldest ? windowStart : oldest;
    }, now);
    const fullHistory: MarketTick[] | null = typeof this.store.getPriceHistorySince === "function"
      ? this.store.getPriceHistorySince(symbol, oldestWindowStart)
      : this.store.getPriceHistory(symbol);

    if (!Array.isArray(fullHistory) || fullHistory.length === 0) {
      return frames.map(frame => this.createEmptyFrame(frame.id, frame.horizonFrame, now));
    }

    const results: MtfFrameSnapshot[] = [];

    for (const frame of frames) {
      const windowStart = now - frame.windowMs;
      const ticks = fullHistory.filter(
        (tick: MarketTick) => Number(tick.timestamp) >= windowStart
      );

      if (ticks.length === 0) {
        results.push(this.createEmptyFrame(frame.id, frame.horizonFrame, now));
        continue;
      }

      const warmupMs = Math.max(MIN_WARMUP_MS, frame.windowMs * WARMUP_FRACTION);
      const dataMode = this.resolveDataMode(ticks);

      const context = this.contextBuilder.createSnapshot({
        symbol,
        ticks,
        dataMode,
        observedAt: now,
        warmupMs,
        maxWindowMs: frame.windowMs,
      });

      const assessment = this.architect.assess(context);

      results.push({
        timeframe: frame.id,
        horizonFrame: frame.horizonFrame,
        regime: assessment.marketRegime,
        trendBias: context.trendBias,
        volatilityState: context.volatilityState,
        structureState: context.structureState,
        confidence: assessment.confidence,
        ready: context.warmupComplete && assessment.sufficientData,
        observedAt: now,
      });
    }

    return results;
  }

  private createEmptyFrame(id: MtfTimeframeId, horizonFrame: MtfHorizonFrameId, now: number): MtfFrameSnapshot {
    return {
      timeframe: id,
      horizonFrame,
      regime: "unclear",
      trendBias: "neutral",
      volatilityState: "normal",
      structureState: "choppy",
      confidence: 0,
      ready: false,
      observedAt: now,
    };
  }

  private resolveDataMode(ticks: MarketTick[]): ArchitectDataMode {
    const sources = [...new Set(
      ticks
        .map(tick => String(tick?.source || "").trim().toLowerCase())
        .filter(source => source === "mock" || source === "ws" || source === "rest")
    )];
    if (sources.length <= 0) return "unknown";
    if (sources.every(source => source === "mock")) return "mock";
    if (sources.some(source => source === "mock")) return "mixed";
    return "live";
  }
}

module.exports = {
  MtfContextService,
};
