"use strict";

const { IndicatorEngine } = require("../src/engines/indicatorEngine.ts");
const { ContextBuilder } = require("../src/roles/contextBuilder.ts");

function assertClose(actual, expected, message, tolerance = 1e-9) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function buildTicks(start, count, stepMs, basePrice, priceStep) {
  return Array.from({ length: count }, (_, index) => ({
    price: basePrice + (index * priceStep),
    source: "ws",
    symbol: "BTC/USDT",
    timestamp: start + (index * stepMs)
  }));
}

function runContextBuilderTests() {
  const builder = new ContextBuilder({ indicatorEngine: new IndicatorEngine() });
  const ticks = buildTicks(1_000_000, 12, 10_000, 100, 1);

  const fullWindow = builder.createSnapshot({
    dataMode: "live",
    maxWindowMs: 60_000,
    observedAt: 1_200_000,
    symbol: "BTC/USDT",
    ticks,
    warmupMs: 30_000
  });

  if (fullWindow.windowMode !== "rolling_full" || fullWindow.rollingSampleSize !== 12 || fullWindow.sampleSize !== 12 || fullWindow.effectiveSampleSize !== 12) {
    throw new Error(`rolling-full context snapshot regressed: ${JSON.stringify(fullWindow)}`);
  }
  if (fullWindow.windowStartedAt !== 1_000_000 || fullWindow.effectiveWindowStartedAt !== 1_000_000 || fullWindow.windowSpanMs !== 110_000 || fullWindow.effectiveWindowSpanMs !== 110_000) {
    throw new Error(`rolling-full window metadata regressed: ${JSON.stringify(fullWindow)}`);
  }
  if (!fullWindow.warmupComplete || !fullWindow.effectiveWarmupComplete || fullWindow.postSwitchCoveragePct !== null) {
    throw new Error(`rolling-full warmup/post-switch semantics regressed: ${JSON.stringify(fullWindow)}`);
  }
  if (fullWindow.summary !== "Market window 110s | maturity 100% | quality 98%.") {
    throw new Error(`rolling-full summary regressed: ${fullWindow.summary}`);
  }
  assertClose(fullWindow.features.netMoveRatio, 0.11, "rolling-full netMoveRatio should remain unchanged");
  assertClose(fullWindow.features.dataQuality, 0.9772727272727273, "rolling-full dataQuality should remain unchanged");

  const postSwitch = builder.createSnapshot({
    dataMode: "live",
    effectiveTicks: ticks.slice(7),
    lastPublishedRegimeSwitchAt: ticks[7].timestamp,
    lastPublishedRegimeSwitchFrom: "trend",
    lastPublishedRegimeSwitchTo: "range",
    maxWindowMs: 60_000,
    observedAt: 1_200_000,
    symbol: "BTC/USDT",
    ticks,
    warmupMs: 30_000
  });

  if (postSwitch.windowMode !== "post_switch_segment" || postSwitch.rollingSampleSize !== 12 || postSwitch.sampleSize !== 5 || postSwitch.effectiveSampleSize !== 5) {
    throw new Error(`post-switch context snapshot regressed: ${JSON.stringify(postSwitch)}`);
  }
  if (postSwitch.windowStartedAt !== 1_000_000 || postSwitch.effectiveWindowStartedAt !== ticks[7].timestamp || postSwitch.windowSpanMs !== 110_000 || postSwitch.effectiveWindowSpanMs !== 40_000) {
    throw new Error(`post-switch window metadata regressed: ${JSON.stringify(postSwitch)}`);
  }
  if (postSwitch.lastPublishedRegimeSwitchFrom !== "trend" || postSwitch.lastPublishedRegimeSwitchTo !== "range") {
    throw new Error(`post-switch regime metadata regressed: ${JSON.stringify(postSwitch)}`);
  }
  if (postSwitch.summary !== "Market window 110s | post-switch 40s | maturity 67% (rolling 100%) | quality 68%.") {
    throw new Error(`post-switch summary regressed: ${postSwitch.summary}`);
  }
  assertClose(postSwitch.postSwitchCoveragePct, 40_000 / 110_000, "post-switch coverage should remain unchanged");
  assertClose(postSwitch.features.netMoveRatio, (111 - 107) / 107, "post-switch netMoveRatio should remain unchanged");
  assertClose(postSwitch.features.dataQuality, 0.6772727272727272, "post-switch dataQuality should remain unchanged");
}

module.exports = {
  runContextBuilderTests
};
