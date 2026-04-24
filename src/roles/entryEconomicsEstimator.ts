import type { EntryEconomicsEstimate, IndicatorSnapshot, MarketContext, Strategy, StrategyEntryEdgeInputs } from "../types/strategy.ts";
import type { MtfPublishDiagnostics } from "../types/mtf.ts";
import type { TradeDirection } from "../types/trade.ts";

const {
  applyDirectionalOffset,
  calculateTargetDistancePct,
  normalizeTradeSide
} = require("../utils/tradeSide.ts");
const { resolveRsiReversionMtfParams } = require("./mtfParamResolver.ts");

const DEFAULT_CAPTURE_GAP_CAP_PCT = 0.03;

function deriveEntryEdgeInputs(params: {
  captureGapCapPct?: unknown;
  context?: Partial<MarketContext> | null;
  price: number;
  side?: TradeDirection | null;
}): StrategyEntryEdgeInputs {
  const latestPrice = Math.max(Number(params.price) || 0, 1e-8);
  const side = normalizeTradeSide(params.side);
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
  const favorableMeanReversionGapPct = Number.isFinite(emaSlow)
    ? side === "short"
      ? Math.max(0, latestPrice - emaSlow) / latestPrice
      : Math.max(0, emaSlow - latestPrice) / latestPrice
    : 0;
  const emaGapPct = Number.isFinite(emaFast) && Number.isFinite(emaSlow)
    ? Math.abs(emaFast - emaSlow) / latestPrice
    : 0;
  const momentumEdgePct = Number.isFinite(momentum)
    ? Math.abs(momentum) / latestPrice
    : 0;
  const exitTarget = Number.isFinite(emaSlow)
    ? applyDirectionalOffset(emaSlow, 0.015, side)
    : latestPrice;
  const configuredCaptureGapCapPct = Number(params.captureGapCapPct);
  const captureGapCapPct = Number.isFinite(configuredCaptureGapCapPct) && configuredCaptureGapCapPct >= 0
    ? configuredCaptureGapCapPct
    : DEFAULT_CAPTURE_GAP_CAP_PCT;
  const captureGapPct = Number.isFinite(emaSlow)
    ? Math.min(captureGapCapPct, calculateTargetDistancePct({ latestPrice, targetPrice: exitTarget, side }))
    : 0;

  return {
    captureGapPct,
    downsideMeanReversionGapPct,
    emaFast,
    emaGapPct,
    emaSlow,
    exitTarget,
    favorableMeanReversionGapPct,
    latestPrice,
    meanReversionGapPct,
    momentum,
    momentumEdgePct,
    side
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
  side?: TradeDirection | null;
  strategy?: Strategy | null;
  mtfDiagnostics?: MtfPublishDiagnostics | null;
}): EntryEconomicsEstimate {
  const inputs = deriveEntryEdgeInputs({
    captureGapCapPct: params.strategy?.entryEconomicsPolicy?.captureGapCapPct ?? params.strategy?.config?.captureGapCapPct,
    context: params.context,
    price: params.price,
    side: params.side
  });
  const expectedGrossEdgePct = params.strategy?.estimateExpectedGrossEdgePct
    ? normalizeExpectedGrossEdgePct(params.strategy.estimateExpectedGrossEdgePct(inputs))
    : estimateGenericExpectedGrossEdgePct(inputs);
  const estimatedEntryFeePct = params.feeRate;
  const estimatedExitFeePct = params.feeRate;
  const requiredEdgePct = estimatedEntryFeePct + estimatedExitFeePct + params.estimatedSlippagePct + params.profitSafetyBufferPct;
  const expectedNetEdgePct = expectedGrossEdgePct - requiredEdgePct;
  const configuredMinExpectedNetEdgePct = Number(params.strategy?.config?.minExpectedNetEdgePct);
  const strategyMinExpectedNetEdgePctFloor = Number(params.strategy?.entryEconomicsPolicy?.minExpectedNetEdgePctFloor);
  const minExpectedNetEdgePct = Math.max(
    Number.isFinite(configuredMinExpectedNetEdgePct)
      ? configuredMinExpectedNetEdgePct
      : params.defaultMinExpectedNetEdgePct,
    Number.isFinite(strategyMinExpectedNetEdgePctFloor)
      ? strategyMinExpectedNetEdgePctFloor
      : 0,
    0
  );
  const configuredMaxTargetDistancePctForShortHorizon = Number(params.strategy?.config?.maxTargetDistancePctForShortHorizon);
  const baseMaxTargetDistancePctForShortHorizon = Number.isFinite(configuredMaxTargetDistancePctForShortHorizon)
    ? Math.max(configuredMaxTargetDistancePctForShortHorizon, 0)
    : null;
  const mtfParamResolution = params.strategy?.entryEconomicsPolicy?.mtfParamPolicy === "range_reversion_target_distance_cap"
    ? resolveRsiReversionMtfParams({
        baseBuyRsi: params.strategy?.config?.buyRsi,
        baseSellRsi: params.strategy?.config?.sellRsi,
        baseMinExpectedNetEdgePct: minExpectedNetEdgePct,
        baseTargetDistanceCapPct: baseMaxTargetDistancePctForShortHorizon,
        mtfDiagnostics: params.mtfDiagnostics || ((params.context?.metadata as any)?.architectMtf as MtfPublishDiagnostics | null | undefined) || null
      })
    : null;
  const maxTargetDistancePctForShortHorizon = mtfParamResolution
    ? mtfParamResolution.resolvedTargetDistanceCapPct
    : baseMaxTargetDistancePctForShortHorizon;
  const resolvedMinExpectedNetEdgePct = mtfParamResolution
    ? mtfParamResolution.resolvedMinExpectedNetEdgePct
    : minExpectedNetEdgePct;
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
    mtfParamResolution,
    minExpectedNetEdgePct: resolvedMinExpectedNetEdgePct,
    notionalUsdt,
    profitSafetyBufferPct: params.profitSafetyBufferPct,
    requiredEdgePct,
    side: inputs.side,
    targetDistancePct: inputs.captureGapPct
  };
}

module.exports = {
  DEFAULT_CAPTURE_GAP_CAP_PCT,
  deriveEntryEdgeInputs,
  estimateEntryEconomics
};
