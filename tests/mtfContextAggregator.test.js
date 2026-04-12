"use strict";

const { aggregateMtfSnapshots } = require("../src/roles/mtfContextAggregator.ts");

/** Helper: build a minimal MtfFrameSnapshot with overrides. */
function makeFrame(overrides) {
  return {
    timeframe: "5m",
    horizonFrame: "medium",
    regime: "trend",
    trendBias: "bullish",
    volatilityState: "normal",
    structureState: "trending",
    confidence: 0.8,
    ready: true,
    observedAt: 1000,
    ...overrides,
  };
}

function runMtfContextAggregatorTests() {
  const now = Date.now();

  // ── fewer than 2 ready frames ⇒ metaRegime unclear, instability 1 ──

  {
    const result = aggregateMtfSnapshots([], now);
    if (result.metaRegime !== "unclear") throw new Error("empty frames should yield unclear metaRegime");
    if (result.instability !== 1) throw new Error("empty frames should yield instability 1");
    if (result.dominantTimeframe !== null) throw new Error("empty frames should yield null dominant");
    if (result.dominantFrame !== null) throw new Error("empty frames should yield null dominant frame");
    if (result.readyFrameCount !== 0) throw new Error("empty frames should yield readyFrameCount 0");
  }

  {
    const result = aggregateMtfSnapshots([makeFrame({ ready: true })], now);
    if (result.metaRegime !== "unclear") throw new Error("single ready frame should yield unclear metaRegime");
    if (result.instability !== 1) throw new Error("single ready frame should yield instability 1");
    if (result.dominantTimeframe !== null) throw new Error("single ready frame should yield null dominant");
    if (result.dominantFrame !== null) throw new Error("single ready frame should yield null dominant frame");
    if (result.readyFrameCount !== 1) throw new Error("single ready frame should yield readyFrameCount 1");
  }

  {
    // Two frames but only one ready.
    const frames = [
      makeFrame({ timeframe: "5m", ready: true }),
      makeFrame({ timeframe: "15m", ready: false }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "unclear") throw new Error("only 1 ready of 2 frames should yield unclear");
    if (result.readyFrameCount !== 1) throw new Error("readyFrameCount should be 1 when only 1 frame is ready");
  }

  // ── agreement across frames ⇒ stable dominant regime ──

  {
    const frames = [
      makeFrame({ timeframe: "5m", horizonFrame: "short", regime: "trend", confidence: 0.7 }),
      makeFrame({ timeframe: "15m", horizonFrame: "medium", regime: "trend", confidence: 0.9 }),
      makeFrame({ timeframe: "1h", horizonFrame: "long", regime: "trend", confidence: 0.6 }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "trend") throw new Error("unanimous trend should yield trend metaRegime");
    if (result.instability !== 0) throw new Error(`unanimous agreement should yield instability 0, got ${result.instability}`);
    if (result.dominantTimeframe !== "15m") throw new Error(`dominant should be 15m (highest confidence), got ${result.dominantTimeframe}`);
    if (result.dominantFrame !== "medium") throw new Error(`dominant frame should be medium, got ${result.dominantFrame}`);
    if (result.readyFrameCount !== 3) throw new Error("readyFrameCount should be 3");
  }

  {
    // range agreement
    const frames = [
      makeFrame({ timeframe: "1h", horizonFrame: "long", regime: "range", confidence: 0.5 }),
      makeFrame({ timeframe: "4h", horizonFrame: "long", regime: "range", confidence: 0.85 }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "range") throw new Error("unanimous range should yield range");
    if (result.instability !== 0) throw new Error("unanimous range should yield instability 0");
    if (result.dominantTimeframe !== "4h") throw new Error("dominant should be 4h");
    if (result.dominantFrame !== "long") throw new Error("dominant frame should be long");
  }

  // ── disagreement across frames ⇒ higher instability ──

  {
    // 2 trend vs 1 range ⇒ trend wins, instability > 0
    const frames = [
      makeFrame({ timeframe: "5m", horizonFrame: "short", regime: "trend", confidence: 0.8 }),
      makeFrame({ timeframe: "15m", horizonFrame: "medium", regime: "trend", confidence: 0.7 }),
      makeFrame({ timeframe: "1h", horizonFrame: "long", regime: "range", confidence: 0.9 }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "trend") throw new Error("2-of-3 trend should yield trend");
    const expectedInstability = 1 - (2 / 3);
    if (Math.abs(result.instability - expectedInstability) > 1e-9) {
      throw new Error(`expected instability ~${expectedInstability}, got ${result.instability}`);
    }
    // dominant only among trend-aligned frames, not the range frame with 0.9
    if (result.dominantTimeframe !== "5m") throw new Error(`dominant should be 5m among trend-aligned, got ${result.dominantTimeframe}`);
    if (result.dominantFrame !== "short") throw new Error(`dominant frame should be short among trend-aligned, got ${result.dominantFrame}`);
  }

  {
    // Perfect tie: 2 trend vs 2 range ⇒ unclear, instability 1
    const frames = [
      makeFrame({ timeframe: "5m", regime: "trend", confidence: 0.9 }),
      makeFrame({ timeframe: "15m", regime: "trend", confidence: 0.8 }),
      makeFrame({ timeframe: "1h", regime: "range", confidence: 0.85 }),
      makeFrame({ timeframe: "4h", regime: "range", confidence: 0.95 }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "unclear") throw new Error("tied votes should yield unclear metaRegime");
    if (result.instability !== 1) throw new Error("tied votes should yield instability 1");
    if (result.dominantTimeframe !== null) throw new Error("tied votes should yield null dominant");
    if (result.dominantFrame !== null) throw new Error("tied votes should yield null dominant frame");
  }

  // ── dominant timeframe chosen only among frames aligned with metaRegime ──

  {
    // 3 volatile (low confidence) vs 1 trend (high confidence)
    // metaRegime = volatile; dominant must be a volatile frame, not the trend one.
    const frames = [
      makeFrame({ timeframe: "5m", horizonFrame: "short", regime: "volatile", confidence: 0.4 }),
      makeFrame({ timeframe: "15m", horizonFrame: "medium", regime: "volatile", confidence: 0.6 }),
      makeFrame({ timeframe: "1h", horizonFrame: "long", regime: "volatile", confidence: 0.5 }),
      makeFrame({ timeframe: "4h", horizonFrame: "long", regime: "trend", confidence: 0.99 }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "volatile") throw new Error("3-of-4 volatile should yield volatile");
    if (result.dominantTimeframe !== "15m") {
      throw new Error(`dominant should be 15m (highest confidence among volatile), got ${result.dominantTimeframe}`);
    }
    if (result.dominantFrame !== "medium") throw new Error(`dominant frame should be medium, got ${result.dominantFrame}`);
  }

  // ── non-ready frames are excluded from voting ──

  {
    const frames = [
      makeFrame({ timeframe: "5m", regime: "trend", confidence: 0.9, ready: true }),
      makeFrame({ timeframe: "15m", regime: "trend", confidence: 0.8, ready: true }),
      makeFrame({ timeframe: "1h", regime: "range", confidence: 0.99, ready: false }),
      makeFrame({ timeframe: "4h", regime: "range", confidence: 0.99, ready: false }),
    ];
    const result = aggregateMtfSnapshots(frames, now);
    if (result.metaRegime !== "trend") throw new Error("non-ready frames should not count; 2 ready trend ⇒ trend");
    if (result.readyFrameCount !== 2) throw new Error("readyFrameCount should be 2");
    if (result.instability !== 0) throw new Error("2 agreeing ready frames should yield instability 0");
    // All frames still preserved in output.
    if (result.frames.length !== 4) throw new Error("all input frames should be preserved");
  }

  // ── aggregatedAt is propagated ──

  {
    const ts = 1234567890;
    const result = aggregateMtfSnapshots([makeFrame({}), makeFrame({})], ts);
    if (result.aggregatedAt !== ts) throw new Error("aggregatedAt should match provided timestamp");
  }
}

module.exports = {
  runMtfContextAggregatorTests,
};
