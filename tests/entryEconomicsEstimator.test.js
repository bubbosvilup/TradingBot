"use strict";

const { createStrategy: createRsiReversion } = require("../src/strategies/rsiReversion/strategy.ts");
const { estimateEntryEconomics } = require("../src/roles/entryEconomicsEstimator.ts");

function buildContext(overrides = {}) {
  return {
    indicators: {
      emaBaseline: 100,
      emaFast: 101.5,
      emaSlow: 100,
      momentum: 1.2,
      rsi: 68,
      volatility: 1,
      ...(overrides.indicators || {})
    },
    latestPrice: 102,
    prices: [99, 100, 101, 102],
    strategyId: "rsiReversion",
    ...overrides
  };
}

function runEntryEconomicsEstimatorTests() {
  const strategy = createRsiReversion({
    maxTargetDistancePctForShortHorizon: 0.01,
    minExpectedNetEdgePct: 0.0015
  });
  const coherentMtf = {
    mtfAgreement: 0.8,
    mtfDominantFrame: "medium",
    mtfDominantTimeframe: "15m",
    mtfEnabled: true,
    mtfInstability: 0.2,
    mtfMetaRegime: "range",
    mtfReadyFrameCount: 3,
    mtfSufficientFrames: true
  };

  const shortEdge = estimateEntryEconomics({
    context: buildContext(),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.001,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "short",
    strategy
  });
  if (shortEdge.side !== "short" || !(shortEdge.targetDistancePct > 0) || !(shortEdge.expectedNetEdgePct > 0)) {
    throw new Error(`short edge should be favorable when the target is below entry and fees are covered: ${JSON.stringify(shortEdge)}`);
  }

  const farShortTarget = estimateEntryEconomics({
    context: buildContext({
      indicators: {
        emaSlow: 80
      }
    }),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.001,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "short",
    strategy
  });
  if (!(farShortTarget.targetDistancePct > farShortTarget.maxTargetDistancePctForShortHorizon)) {
    throw new Error(`short target distance should expose short-horizon blocking input: ${JSON.stringify(farShortTarget)}`);
  }

  const mediumMtfTarget = estimateEntryEconomics({
    context: buildContext({
      indicators: {
        emaSlow: 80
      }
    }),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.001,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "short",
    strategy,
    mtfDiagnostics: coherentMtf
  });
  if (mediumMtfTarget.maxTargetDistancePctForShortHorizon !== 0.015 || !mediumMtfTarget.mtfParamResolution?.mtfAdjustmentApplied) {
    throw new Error(`coherent medium MTF should widen the RSI cap to 1.5x: ${JSON.stringify(mediumMtfTarget)}`);
  }

  const longMtfTarget = estimateEntryEconomics({
    context: buildContext(),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.001,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "short",
    strategy,
    mtfDiagnostics: {
      ...coherentMtf,
      mtfDominantFrame: "long",
      mtfDominantTimeframe: "1h"
    }
  });
  if (longMtfTarget.maxTargetDistancePctForShortHorizon !== 0.02 || longMtfTarget.mtfParamResolution?.targetDistanceProfile !== "long") {
    throw new Error(`coherent long MTF should widen the RSI cap to 2.0x: ${JSON.stringify(longMtfTarget)}`);
  }

  const unstableMtfTarget = estimateEntryEconomics({
    context: buildContext(),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.001,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "short",
    strategy,
    mtfDiagnostics: {
      ...coherentMtf,
      mtfInstability: 0.26,
      mtfAgreement: 0.9
    }
  });
  if (unstableMtfTarget.maxTargetDistancePctForShortHorizon !== 0.01 || unstableMtfTarget.mtfParamResolution?.fallbackReason !== "mtf_instability_above_threshold") {
    throw new Error(`unstable MTF should preserve baseline cap: ${JSON.stringify(unstableMtfTarget)}`);
  }

  const feeDominatedShort = estimateEntryEconomics({
    context: buildContext({
      indicators: {
        emaSlow: 103,
        momentum: 0.05,
        rsi: 59
      }
    }),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.004,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "short",
    strategy
  });
  if (!(feeDominatedShort.expectedNetEdgePct < feeDominatedShort.minExpectedNetEdgePct)) {
    throw new Error(`short economics should fail when fees overwhelm edge: ${JSON.stringify(feeDominatedShort)}`);
  }

  const nonRsiStrategy = {
    config: {},
    id: "emaCross"
  };
  const nonRsiEconomics = estimateEntryEconomics({
    context: buildContext({ strategyId: "emaCross" }),
    defaultMinExpectedNetEdgePct: 0.0005,
    estimatedSlippagePct: 0.0005,
    feeRate: 0.001,
    price: 102,
    profitSafetyBufferPct: 0.0005,
    quantity: 1,
    side: "long",
    strategy: nonRsiStrategy,
    mtfDiagnostics: {
      ...coherentMtf,
      mtfDominantFrame: "long"
    }
  });
  if (nonRsiEconomics.maxTargetDistancePctForShortHorizon !== null || nonRsiEconomics.mtfParamResolution !== null) {
    throw new Error(`non-RSI strategies should not consume MTF cap resolution: ${JSON.stringify(nonRsiEconomics)}`);
  }
}

module.exports = {
  runEntryEconomicsEstimatorTests
};
