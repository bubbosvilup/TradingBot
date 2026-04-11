// Module responsibility: strategy-aware entry economics estimation with shared cost normalization.

import type { EntryEconomicsEstimate, IndicatorSnapshot, MarketContext, Strategy, StrategyEntryEdgeInputs } from "../types/strategy.ts";

function deriveEntryEdgeInputs(params: {
  context?: Partial<MarketContext> | null;
  price: number;
}): StrategyEntryEdgeInputs {
  const latestPrice = Math.max(Number(params.price) || 0, 1e-8);
  const indicators: Partial<IndicatorSnapshot> = params.context?.indicators || {};
  const emaFast = Number(indicators.emaFast);
  const emaSlow = Number(indicators.emaSlow);
  const momentum = Number(indicators.momentum);
  const meanReversionGapPct = Number.isFinite(emaSlow)
    ? Math.abs(latestPrice - emaSlow) / latestPrice
    : 0;
  const downsideMeanReversionGapPct = Number.isFinite(emaSlow)
    ? Math.max(0, emaSlow - latestPrice) / latestPrice
    : 0;
  const emaGapPct = Number.isFinite(emaFast) && Number.isFinite(emaSlow)
    ? Math.abs(emaFast - emaSlow) / latestPrice
    : 0;
  const momentumEdgePct = Number.isFinite(momentum)
    ? Math.abs(momentum) / latestPrice
    : 0;
  const exitTarget = Number.isFinite(emaSlow)
    ? emaSlow * 1.015
    : latestPrice;
  const captureGapPct = Number.isFinite(emaSlow)
    ? Math.min(0.03, Math.max(0, exitTarget - latestPrice) / latestPrice)
    : 0;

  return {
    captureGapPct,
    downsideMeanReversionGapPct,
    emaFast,
    emaGapPct,
    emaSlow,
    exitTarget,
    latestPrice,
    meanReversionGapPct,
    momentum,
    momentumEdgePct
  };
}

function estimateGenericExpectedGrossEdgePct(inputs: StrategyEntryEdgeInputs) {
  return Math.max(
    0,
    (0.4 * inputs.meanReversionGapPct) +
    (0.35 * inputs.emaGapPct) +
    (0.25 * inputs.momentumEdgePct)
  );
}

function normalizeExpectedGrossEdgePct(value: unknown) {
  const normalized = Number(value);
  return Math.max(Number.isFinite(normalized) ? normalized : 0, 0);
}

function estimateEntryEconomics(params: {
  context?: Partial<MarketContext> | null;
  defaultMinExpectedNetEdgePct: number;
  estimatedSlippagePct: number;
  feeRate: number;
  price: number;
  profitSafetyBufferPct: number;
  quantity: number | null;
  strategy?: Strategy | null;
}): EntryEconomicsEstimate {
  const inputs = deriveEntryEdgeInputs({
    context: params.context,
    price: params.price
  });
  const expectedGrossEdgePct = params.strategy?.estimateExpectedGrossEdgePct
    ? normalizeExpectedGrossEdgePct(params.strategy.estimateExpectedGrossEdgePct(inputs))
    : estimateGenericExpectedGrossEdgePct(inputs);
  const estimatedEntryFeePct = params.feeRate;
  const estimatedExitFeePct = params.feeRate;
  const requiredEdgePct = estimatedEntryFeePct + estimatedExitFeePct + params.estimatedSlippagePct + params.profitSafetyBufferPct;
  const expectedNetEdgePct = expectedGrossEdgePct - requiredEdgePct;
  const configuredMinExpectedNetEdgePct = Number(params.strategy?.config?.minExpectedNetEdgePct);
  const strategyMinExpectedNetEdgePctFloor = params.strategy?.id === "rsiReversion"
    ? 0.0015
    : 0;
  const minExpectedNetEdgePct = Math.max(
    Number.isFinite(configuredMinExpectedNetEdgePct)
      ? configuredMinExpectedNetEdgePct
      : params.defaultMinExpectedNetEdgePct,
    strategyMinExpectedNetEdgePctFloor,
    0
  );
  const configuredMaxTargetDistancePctForShortHorizon = Number(params.strategy?.config?.maxTargetDistancePctForShortHorizon);
  const maxTargetDistancePctForShortHorizon = Number.isFinite(configuredMaxTargetDistancePctForShortHorizon)
    ? Math.max(configuredMaxTargetDistancePctForShortHorizon, 0)
    : null;
  const quantity = Number.isFinite(Number(params.quantity)) ? Number(params.quantity) : 0;
  const notionalUsdt = inputs.latestPrice * Math.max(quantity, 0);

  return {
    estimatedEntryFeePct,
    estimatedExitFeePct,
    estimatedRoundTripFeesUsdt: notionalUsdt * (estimatedEntryFeePct + estimatedExitFeePct),
    estimatedSlippagePct: params.estimatedSlippagePct,
    expectedGrossEdgePct,
    expectedGrossEdgeUsdt: notionalUsdt * expectedGrossEdgePct,
    expectedNetEdgePct,
    maxTargetDistancePctForShortHorizon,
    minExpectedNetEdgePct,
    notionalUsdt,
    profitSafetyBufferPct: params.profitSafetyBufferPct,
    requiredEdgePct,
    targetDistancePct: inputs.captureGapPct
  };
}

module.exports = {
  deriveEntryEdgeInputs,
  estimateEntryEconomics
};
