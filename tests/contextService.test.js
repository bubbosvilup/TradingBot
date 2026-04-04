"use strict";

const { IndicatorEngine } = require("../src/engines/indicatorEngine.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { ContextService } = require("../src/core/contextService.ts");
const { ContextBuilder } = require("../src/roles/contextBuilder.ts");

function runContextServiceTests() {
  const store = new StateStore({ maxPriceHistory: 1000 });
  const logs = [];
  const service = new ContextService({
    contextBuilder: new ContextBuilder({ indicatorEngine: new IndicatorEngine() }),
    logger: {
      info(event, metadata) {
        logs.push({ event, metadata });
      }
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    maxWindowMs: 300_000,
    store,
    warmupMs: 30_000
  });

  const symbol = "BTC/USDT";
  const start = 1_000_000;

  for (let index = 0; index < 20; index += 1) {
    const timestamp = start + (index * 1_000);
    store.updatePrice({
      price: 100 + (index * 0.4),
      receivedAt: timestamp + 5,
      source: "mock",
      symbol,
      timestamp
    });
  }

  let snapshot = service.observe(symbol, start + 19_000);
  if (!snapshot || snapshot.warmupComplete) {
    throw new Error("context warm-up should remain incomplete before 30s");
  }

  for (let index = 20; index < 70; index += 1) {
    const timestamp = start + (index * 1_000);
    store.updatePrice({
      price: 108 + (index * 0.2),
      receivedAt: timestamp + 5,
      source: "mock",
      symbol,
      timestamp
    });
  }

  snapshot = service.observe(symbol, start + 69_000);
  if (!snapshot || !snapshot.warmupComplete) {
    throw new Error("context warm-up did not complete after 30s+ of data");
  }
  if (snapshot.features.maturity <= 0 || snapshot.features.dataQuality <= 0) {
    throw new Error("context features were not populated after warm-up");
  }
  if (typeof snapshot.features.contextRsi !== "number" || !Number.isFinite(snapshot.features.contextRsi)) {
    throw new Error("context snapshot should expose the raw architect context RSI alongside rsiIntensity");
  }

  for (let index = 70; index < 420; index += 1) {
    const timestamp = start + (index * 1_000);
    store.updatePrice({
      price: 120 + (Math.sin(index / 12) * 2) + (index * 0.03),
      receivedAt: timestamp + 5,
      source: "mock",
      symbol,
      timestamp
    });
  }

  snapshot = service.observe(symbol, start + 419_000);
  if (!snapshot) {
    throw new Error("context snapshot missing after long rolling history");
  }
  if (snapshot.windowSpanMs > 300_000) {
    throw new Error(`context window exceeded rolling cap: ${snapshot.windowSpanMs}`);
  }
  if (snapshot.windowMode !== "rolling_full") {
    throw new Error(`context should use the full rolling window before any published regime switch: ${snapshot.windowMode}`);
  }
  if (snapshot.effectiveWindowSpanMs !== snapshot.windowSpanMs || snapshot.features.maturity !== snapshot.rollingMaturity) {
    throw new Error("effective context window should match the rolling window before any published regime switch");
  }

  const switchAt = start + 390_000;
  store.setArchitectPublisherState(symbol, {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: start + 419_000,
    lastPublishedAt: start + 390_000,
    lastPublishedRegime: "range",
    lastRegimeSwitchAt: switchAt,
    lastRegimeSwitchFrom: "trend",
    lastRegimeSwitchTo: "range",
    nextPublishAt: start + 420_000,
    publishIntervalMs: 30_000,
    ready: true,
    symbol,
    warmupStartedAt: start
  });

  snapshot = service.observe(symbol, start + 419_000);
  if (!snapshot || snapshot.windowMode !== "post_switch_segment") {
    throw new Error("context did not activate a post-switch segment after a published regime transition");
  }
  if (snapshot.effectiveWindowStartedAt !== switchAt) {
    throw new Error(`effective context window should start at the published regime switch: ${snapshot.effectiveWindowStartedAt}`);
  }
  if (snapshot.effectiveWindowSpanMs >= snapshot.windowSpanMs) {
    throw new Error("post-switch effective window should be narrower than the full rolling window");
  }
  if (snapshot.features.maturity >= snapshot.rollingMaturity) {
    throw new Error("effective maturity should reset below rolling maturity after a published regime switch");
  }
  if (snapshot.lastPublishedRegimeSwitchFrom !== "trend" || snapshot.lastPublishedRegimeSwitchTo !== "range") {
    throw new Error("context snapshot is missing published regime switch metadata");
  }
  const segmentedAudit = logs.find((entry) => entry.event === "context_window_segmented");
  if (!segmentedAudit || segmentedAudit.metadata.lastPublishedRegimeSwitchAt !== switchAt) {
    throw new Error("missing context_window_segmented audit log after published regime switch");
  }

  let createSnapshotCalls = 0;
  const spyStore = new StateStore({ maxPriceHistory: 1000 });
  const spyService = new ContextService({
    contextBuilder: {
      createSnapshot(params) {
        createSnapshotCalls += 1;
        return new ContextBuilder({ indicatorEngine: new IndicatorEngine() }).createSnapshot(params);
      }
    },
    logger: {
      info() {}
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    maxWindowMs: 300_000,
    store: spyStore,
    warmupMs: 30_000
  });
  for (let index = 0; index < 80; index += 1) {
    const timestamp = start + (index * 1_000);
    spyStore.updatePrice({
      price: 100 + (index * 0.1),
      receivedAt: timestamp + 5,
      source: "mock",
      symbol,
      timestamp
    });
  }
  const firstEligible = spyService.observe(symbol, start + 79_000);
  const repeatedEligible = spyService.observe(symbol, start + 79_500);
  if (!firstEligible || !repeatedEligible || createSnapshotCalls !== 1) {
    throw new Error(`repeated observes without effective window change should not rebuild context: ${createSnapshotCalls}`);
  }
  if (repeatedEligible.observedAt !== start + 79_500 || repeatedEligible.summary !== firstEligible.summary) {
    throw new Error("memoized context refresh should only advance observedAt while preserving the computed snapshot");
  }
  if (typeof spyStore.getPriceHistoryRevision !== "function" || spyStore.getPriceHistoryRevision(symbol) !== 80) {
    throw new Error(`state store should expose a per-symbol price history revision: ${spyStore.getPriceHistoryRevision(symbol)}`);
  }
  spyStore.updatePrice({
    price: 108.5,
    receivedAt: start + 80_000 + 5,
    source: "mock",
    symbol,
    timestamp: start + 80_000
  });
  const afterInputChange = spyService.observe(symbol, start + 80_000);
  if (!afterInputChange || createSnapshotCalls !== 2) {
    throw new Error(`context should rebuild once the effective input window changes: ${createSnapshotCalls}`);
  }
  if (spyService.resolveDataMode([
    { price: 100, source: "ws", symbol, timestamp: start },
    { price: 101, source: "rest", symbol, timestamp: start + 1_000 }
  ]) !== "live") {
    throw new Error("resolveDataMode should classify ws/rest-only inputs as live");
  }
  if (spyService.resolveDataMode([
    { price: 100, source: "mock", symbol, timestamp: start },
    { price: 101, source: "mock", symbol, timestamp: start + 1_000 }
  ]) !== "mock") {
    throw new Error("resolveDataMode should classify mock-only inputs as mock");
  }
  if (spyService.resolveDataMode([
    { price: 100, source: "mock", symbol, timestamp: start },
    { price: 101, source: "ws", symbol, timestamp: start + 1_000 }
  ]) !== "mixed") {
    throw new Error("resolveDataMode should classify mixed mock/live inputs as mixed");
  }
  if (spyService.resolveDataMode([
    { price: 100, source: "", symbol, timestamp: start },
    { price: 101, symbol, timestamp: start + 1_000 }
  ]) !== "unknown") {
    throw new Error("resolveDataMode should fall back to unknown when no usable sources are present");
  }

  let trickyCreateSnapshotCalls = 0;
  const trickyStore = new StateStore({ maxPriceHistory: 3 });
  const trickyService = new ContextService({
    contextBuilder: {
      createSnapshot(params) {
        trickyCreateSnapshotCalls += 1;
        return new ContextBuilder({ indicatorEngine: new IndicatorEngine() }).createSnapshot(params);
      }
    },
    logger: {
      info() {}
    },
    marketStream: {
      subscribe() {
        return () => {};
      }
    },
    maxWindowMs: 300_000,
    store: trickyStore,
    warmupMs: 30_000
  });
  trickyStore.updatePrice({ price: 100, receivedAt: start + 5, source: "mock", symbol, timestamp: start });
  trickyStore.updatePrice({ price: 101, receivedAt: start + 5, source: "mock", symbol, timestamp: start });
  trickyStore.updatePrice({ price: 102, receivedAt: start + 1_005, source: "mock", symbol, timestamp: start + 1_000 });
  const trickyFirst = trickyService.observe(symbol, start + 1_000);
  trickyStore.updatePrice({ price: 103, receivedAt: start + 1_005, source: "mock", symbol, timestamp: start + 1_000 });
  const trickySecond = trickyService.observe(symbol, start + 1_000);
  if (!trickyFirst || !trickySecond || trickyCreateSnapshotCalls !== 2) {
    throw new Error(`a new price append should invalidate memoized context even when timestamp/count boundaries can stay the same: ${trickyCreateSnapshotCalls}`);
  }
  if (trickySecond.features.netMoveRatio === trickyFirst.features.netMoveRatio && trickySecond.summary === trickyFirst.summary) {
    throw new Error("tricky capped-history append should produce a fresh snapshot rather than reusing stale derived features");
  }
}

module.exports = {
  runContextServiceTests
};
