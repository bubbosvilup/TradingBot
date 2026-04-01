"use strict";

const { IndicatorEngine } = require("../src/engines/indicatorEngine.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { ContextService } = require("../src/core/contextService.ts");
const { ContextBuilder } = require("../src/roles/contextBuilder.ts");

function runContextServiceTests() {
  const store = new StateStore({ maxPriceHistory: 1000 });
  const service = new ContextService({
    contextBuilder: new ContextBuilder({ indicatorEngine: new IndicatorEngine() }),
    logger: { info() {} },
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
}

module.exports = {
  runContextServiceTests
};
