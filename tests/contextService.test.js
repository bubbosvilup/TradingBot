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
}

module.exports = {
  runContextServiceTests
};
