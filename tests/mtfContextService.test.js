"use strict";

const { MtfContextService } = require("../src/core/mtfContextService.ts");

/** Helper: create a mock tick at a given timestamp. */
function makeTick(timestamp, price, source) {
  return { symbol: "BTC/USDT", price: price || 100, timestamp, source: source || "ws" };
}

/** Helper: create a mock store returning configurable tick history. */
function makeStore(history) {
  return {
    getPriceHistory() {
      return history;
    },
  };
}

/** Helper: create a mock contextBuilder that returns a controllable context snapshot. */
function makeContextBuilder(contextOverrides) {
  return {
    createSnapshot(params) {
      const tickCount = (params.ticks || []).length;
      const oldestTs = tickCount > 0 ? Number(params.ticks[0].timestamp) : params.observedAt;
      const span = tickCount > 0 ? params.observedAt - oldestTs : 0;
      return {
        symbol: params.symbol,
        dataMode: params.dataMode,
        observedAt: params.observedAt,
        warmupComplete: span >= params.warmupMs,
        trendBias: "bullish",
        volatilityState: "normal",
        structureState: "trending",
        windowSpanMs: span,
        effectiveWindowSpanMs: span,
        sampleSize: tickCount,
        effectiveSampleSize: tickCount,
        features: {
          directionalEfficiency: 0.7,
          emaSeparation: 0.5,
          slopeConsistency: 0.6,
          reversionStretch: 0.2,
          contextRsi: 55,
          rsiIntensity: 0.1,
          volatilityRisk: 0.2,
          chopiness: 0.3,
          breakoutQuality: 0.1,
          dataQuality: 0.8,
          maturity: 0.6,
          emaBias: 0.3,
          breakoutDirection: "none",
          netMoveRatio: 0.001,
          featureConflict: 0.1,
          breakoutInstability: 0.05,
        },
        ...contextOverrides,
      };
    },
  };
}

/** Helper: create a mock architect that returns a controllable assessment. */
function makeArchitect(assessmentOverrides) {
  return {
    assess(context) {
      return {
        marketRegime: "trend",
        confidence: 0.75,
        sufficientData: context.warmupComplete && context.features.dataQuality >= 0.45,
        ...assessmentOverrides,
      };
    },
  };
}

function runMtfContextServiceTests() {
  const now = 1_000_000;

  // ── empty history ⇒ all frames return empty (not ready, unclear) ──

  {
    const service = new MtfContextService({
      store: makeStore([]),
      contextBuilder: makeContextBuilder(),
      architect: makeArchitect(),
    });
    const result = service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [
        { id: "5m", horizonFrame: "short", windowMs: 300_000 },
        { id: "1h", horizonFrame: "long", windowMs: 3_600_000 },
      ],
    });
    if (result.length !== 2) throw new Error("expected 2 frames for empty history");
    for (const frame of result) {
      if (frame.ready !== false) throw new Error("empty history frame should not be ready");
      if (frame.regime !== "unclear") throw new Error("empty history frame should be unclear");
      if (frame.confidence !== 0) throw new Error("empty history frame confidence should be 0");
      if (frame.trendBias !== "neutral") throw new Error("empty history frame trendBias should be neutral");
      if (frame.observedAt !== now) throw new Error("observedAt should match now");
    }
    if (result[0].timeframe !== "5m") throw new Error("first frame id mismatch");
    if (result[1].timeframe !== "1h") throw new Error("second frame id mismatch");
    if (result[0].horizonFrame !== "short") throw new Error("first horizon frame mismatch");
    if (result[1].horizonFrame !== "long") throw new Error("second horizon frame mismatch");
  }

  {
    let requestedSince = null;
    const ticks = [
      makeTick(now - 600_000, 99),
      makeTick(now - 300_000, 100),
      makeTick(now - 60_000, 101),
    ];
    const sinceStore = {
      getPriceHistory() {
        throw new Error("getPriceHistory should not be used when getPriceHistorySince is available");
      },
      getPriceHistorySince(_symbol, sinceTimestamp) {
        requestedSince = sinceTimestamp;
        return ticks.filter((tick) => Number(tick.timestamp) >= sinceTimestamp);
      }
    };
    const service = new MtfContextService({
      store: sinceStore,
      contextBuilder: makeContextBuilder({ warmupComplete: true }),
      architect: makeArchitect({ sufficientData: true }),
    });
    const result = service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [
        { id: "1m", horizonFrame: "short", windowMs: 60_000 },
        { id: "5m", horizonFrame: "short", windowMs: 300_000 },
      ],
    });
    if (requestedSince !== now - 300_000 || result.length !== 2) {
      throw new Error(`MTF should narrow history reads to the oldest needed frame window: ${JSON.stringify({ requestedSince, result })}`);
    }
  }

  // ── null history ⇒ same as empty ──

  {
    const service = new MtfContextService({
      store: makeStore(null),
      contextBuilder: makeContextBuilder(),
      architect: makeArchitect(),
    });
    const result = service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "15m", horizonFrame: "medium", windowMs: 900_000 }],
    });
    if (result.length !== 1) throw new Error("expected 1 frame for null history");
    if (result[0].ready !== false) throw new Error("null history frame should not be ready");
    if (result[0].regime !== "unclear") throw new Error("null history frame should be unclear");
  }

  // ── ticks within window ⇒ context built and regime mapped ──

  {
    const ticks = [];
    // 60 ticks spanning 60 seconds, all within a 5m (300s) window
    for (let i = 0; i < 60; i++) {
      ticks.push(makeTick(now - 60_000 + i * 1000, 100 + i * 0.1));
    }
    const service = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: makeContextBuilder(),
      architect: makeArchitect(),
    });
    const result = service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
    if (result.length !== 1) throw new Error("expected 1 frame");
    const frame = result[0];
    if (frame.timeframe !== "5m") throw new Error("timeframe mismatch");
    if (frame.horizonFrame !== "short") throw new Error("horizonFrame mismatch");
    if (frame.regime !== "trend") throw new Error(`regime should be trend from architect, got ${frame.regime}`);
    if (frame.confidence !== 0.75) throw new Error(`confidence should be 0.75, got ${frame.confidence}`);
    if (frame.trendBias !== "bullish") throw new Error("trendBias should come from context");
    if (frame.volatilityState !== "normal") throw new Error("volatilityState should come from context");
    if (frame.structureState !== "trending") throw new Error("structureState should come from context");
    if (frame.observedAt !== now) throw new Error("observedAt mismatch");
  }

  // ── ticks outside window ⇒ frame returns empty ──

  {
    // All ticks are older than the 5m window
    const ticks = [
      makeTick(now - 600_000, 100),
      makeTick(now - 500_000, 101),
    ];
    const service = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: makeContextBuilder(),
      architect: makeArchitect(),
    });
    const result = service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
    if (result[0].ready !== false) throw new Error("out-of-window ticks should yield not-ready frame");
    if (result[0].regime !== "unclear") throw new Error("out-of-window ticks should yield unclear");
  }

  // ── window slicing: short frame gets fewer ticks than long frame ──

  {
    let shortTickCount = 0;
    let longTickCount = 0;
    const ticks = [];
    // Ticks spanning 10 minutes
    for (let i = 0; i < 120; i++) {
      ticks.push(makeTick(now - 600_000 + i * 5000, 100 + i * 0.05));
    }
    const trackingBuilder = {
      createSnapshot(params) {
        if (params.maxWindowMs === 60_000) shortTickCount = params.ticks.length;
        if (params.maxWindowMs === 600_000) longTickCount = params.ticks.length;
        return {
          symbol: params.symbol,
          dataMode: params.dataMode,
          observedAt: params.observedAt,
          warmupComplete: true,
          trendBias: "neutral",
          volatilityState: "normal",
          structureState: "choppy",
          features: {
            directionalEfficiency: 0.5, emaSeparation: 0.3, slopeConsistency: 0.4,
            reversionStretch: 0.2, contextRsi: 50, rsiIntensity: 0.1,
            volatilityRisk: 0.2, chopiness: 0.4, breakoutQuality: 0.1,
            dataQuality: 0.7, maturity: 0.5, emaBias: 0, breakoutDirection: "none",
            netMoveRatio: 0, featureConflict: 0.15, breakoutInstability: 0.05,
          },
        };
      },
    };
    const service = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: trackingBuilder,
      architect: makeArchitect(),
    });
    service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [
        { id: "1m", horizonFrame: "short", windowMs: 60_000 },
        { id: "5m", horizonFrame: "medium", windowMs: 600_000 },
      ],
    });
    if (shortTickCount >= longTickCount) {
      throw new Error(`short window should get fewer ticks: short=${shortTickCount}, long=${longTickCount}`);
    }
    if (longTickCount !== 120) {
      throw new Error(`long window should get all 120 ticks, got ${longTickCount}`);
    }
  }

  // ── ready flag depends on warmupComplete AND sufficientData ──

  {
    const ticks = [];
    for (let i = 0; i < 30; i++) {
      ticks.push(makeTick(now - 30_000 + i * 1000, 100 + i * 0.1));
    }

    // Case: warmupComplete=true but sufficientData=false
    const serviceInsufficientData = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: makeContextBuilder({ warmupComplete: true }),
      architect: makeArchitect({ sufficientData: false }),
    });
    const r1 = serviceInsufficientData.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
    if (r1[0].ready !== false) throw new Error("warmupComplete + !sufficientData should not be ready");

    // Case: warmupComplete=false but sufficientData=true
    const serviceNotWarmedUp = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: makeContextBuilder({ warmupComplete: false }),
      architect: makeArchitect({ sufficientData: true }),
    });
    const r2 = serviceNotWarmedUp.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
    if (r2[0].ready !== false) throw new Error("!warmupComplete + sufficientData should not be ready");

    // Case: both true
    const serviceReady = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: makeContextBuilder({ warmupComplete: true }),
      architect: makeArchitect({ sufficientData: true }),
    });
    const r3 = serviceReady.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
    if (r3[0].ready !== true) throw new Error("warmupComplete + sufficientData should be ready");
  }

  // ── data mode resolution: ws-only → live ──

  {
    let capturedDataMode = null;
    const ticks = [makeTick(now - 1000, 100, "ws"), makeTick(now - 500, 101, "ws")];
    const capturingBuilder = {
      createSnapshot(params) {
        capturedDataMode = params.dataMode;
        return {
          symbol: params.symbol, dataMode: params.dataMode, observedAt: params.observedAt,
          warmupComplete: true, trendBias: "neutral", volatilityState: "normal",
          structureState: "choppy",
          features: {
            directionalEfficiency: 0.5, emaSeparation: 0.3, slopeConsistency: 0.4,
            reversionStretch: 0.2, contextRsi: 50, rsiIntensity: 0.1, volatilityRisk: 0.2,
            chopiness: 0.4, breakoutQuality: 0.1, dataQuality: 0.7, maturity: 0.5,
            emaBias: 0, breakoutDirection: "none", netMoveRatio: 0,
            featureConflict: 0.15, breakoutInstability: 0.05,
          },
        };
      },
    };
    const service = new MtfContextService({
      store: makeStore(ticks),
      contextBuilder: capturingBuilder,
      architect: makeArchitect(),
    });
    service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
    if (capturedDataMode !== "live") throw new Error(`ws-only ticks should resolve to live, got ${capturedDataMode}`);
  }

  // ── no store writes: store has no set/write methods ──

  {
    const readOnlyStore = {
      getPriceHistory() { return [makeTick(now - 1000, 100)]; },
    };
    // If the service tried to call any setter, it would throw.
    const service = new MtfContextService({
      store: readOnlyStore,
      contextBuilder: makeContextBuilder(),
      architect: makeArchitect(),
    });
    // Should not throw
    service.buildMtfSnapshots({
      symbol: "BTC/USDT",
      now,
      frames: [{ id: "5m", horizonFrame: "short", windowMs: 300_000 }],
    });
  }
}

module.exports = {
  runMtfContextServiceTests,
};
