// Module responsibility: pure MTF-driven entry parameter resolution for strategy economics.

import type { MtfHorizonFrameId, MtfPublishDiagnostics } from "../types/mtf.ts";

const RSI_MIN_EXPECTED_NET_EDGE_FLOOR = 0.0015;
const DEFAULT_BUY_RSI = 33;
const DEFAULT_SELL_RSI = 58;
const DEFAULT_MAX_INSTABILITY = 0.25;
const DEFAULT_MIN_AGREEMENT = 0.75;

export type RsiReversionTargetDistanceProfile = "baseline" | "short" | "medium" | "long";

export interface RsiReversionMtfResolvedParams {
  resolvedBuyRsi: number;
  resolvedSellRsi: number;
  resolvedMinExpectedNetEdgePct: number;
  resolvedTargetDistanceCapPct: number | null;
  dominantTimeframe: MtfHorizonFrameId | null;
  targetDistanceProfile: RsiReversionTargetDistanceProfile;
  mtfAdjustmentApplied: boolean;
  fallbackReason: string | null;
  coherenceReason: string;
}

export interface ResolveRsiReversionMtfParamsInput {
  baseBuyRsi?: unknown;
  baseSellRsi?: unknown;
  baseMinExpectedNetEdgePct?: unknown;
  baseTargetDistanceCapPct?: unknown;
  maxInstability?: unknown;
  minAgreement?: unknown;
  mtfDiagnostics?: MtfPublishDiagnostics | null;
}

function resolveFiniteNumber(value: unknown, fallback: number) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function resolveNonNegativeNumber(value: unknown, fallback: number | null) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(normalized, 0);
}

function buildBaseline(params: {
  baseBuyRsi: number;
  baseSellRsi: number;
  baseMinExpectedNetEdgePct: number;
  baseTargetDistanceCapPct: number | null;
  fallbackReason: string | null;
  coherenceReason?: string;
  dominantTimeframe?: MtfHorizonFrameId | null;
  targetDistanceProfile?: RsiReversionTargetDistanceProfile;
}): RsiReversionMtfResolvedParams {
  return {
    resolvedBuyRsi: params.baseBuyRsi,
    resolvedSellRsi: params.baseSellRsi,
    resolvedMinExpectedNetEdgePct: params.baseMinExpectedNetEdgePct,
    resolvedTargetDistanceCapPct: params.baseTargetDistanceCapPct,
    dominantTimeframe: params.dominantTimeframe ?? null,
    targetDistanceProfile: params.targetDistanceProfile || "baseline",
    mtfAdjustmentApplied: false,
    fallbackReason: params.fallbackReason,
    coherenceReason: params.coherenceReason || params.fallbackReason || "baseline"
  };
}

function resolveRsiReversionMtfParams(params: ResolveRsiReversionMtfParamsInput): RsiReversionMtfResolvedParams {
  const baseBuyRsi = resolveFiniteNumber(params.baseBuyRsi, DEFAULT_BUY_RSI);
  const baseSellRsi = resolveFiniteNumber(params.baseSellRsi, DEFAULT_SELL_RSI);
  const baseMinExpectedNetEdgePct = Math.max(
    resolveFiniteNumber(params.baseMinExpectedNetEdgePct, RSI_MIN_EXPECTED_NET_EDGE_FLOOR),
    RSI_MIN_EXPECTED_NET_EDGE_FLOOR,
    0
  );
  const baseTargetDistanceCapPct = resolveNonNegativeNumber(
    params.baseTargetDistanceCapPct,
    null
  );
  const maxInstability = Math.max(resolveFiniteNumber(params.maxInstability, DEFAULT_MAX_INSTABILITY), 0);
  const minAgreement = Math.max(resolveFiniteNumber(params.minAgreement, DEFAULT_MIN_AGREEMENT), 0);
  const mtf = params.mtfDiagnostics || null;

  if (!mtf || !mtf.mtfEnabled) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      fallbackReason: "mtf_disabled"
    });
  }
  if (!mtf.mtfSufficientFrames) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      fallbackReason: "mtf_insufficient_frames"
    });
  }
  if (mtf.mtfMetaRegime !== "range") {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      fallbackReason: "mtf_non_range"
    });
  }
  if (!mtf.mtfDominantFrame) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      fallbackReason: "mtf_missing_dominant_frame"
    });
  }

  const instability = Number(mtf.mtfInstability);
  if (!Number.isFinite(instability) || instability > maxInstability) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      dominantTimeframe: mtf.mtfDominantFrame,
      fallbackReason: "mtf_instability_above_threshold"
    });
  }

  const agreement = Number(mtf.mtfAgreement);
  if (!Number.isFinite(agreement) || agreement < minAgreement) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      dominantTimeframe: mtf.mtfDominantFrame,
      fallbackReason: "mtf_agreement_below_threshold"
    });
  }

  if (baseTargetDistanceCapPct === null) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      dominantTimeframe: mtf.mtfDominantFrame,
      fallbackReason: "missing_baseline_target_distance_cap"
    });
  }

  if (mtf.mtfDominantFrame === "short") {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      coherenceReason: "mtf_coherent_short_baseline",
      dominantTimeframe: "short",
      fallbackReason: null,
      targetDistanceProfile: "short"
    });
  }

  const capMultiplier = mtf.mtfDominantFrame === "medium" ? 1.5 : 2;
  return {
    resolvedBuyRsi: baseBuyRsi,
    resolvedSellRsi: baseSellRsi,
    resolvedMinExpectedNetEdgePct: baseMinExpectedNetEdgePct,
    resolvedTargetDistanceCapPct: Number((baseTargetDistanceCapPct * capMultiplier).toFixed(8)),
    dominantTimeframe: mtf.mtfDominantFrame,
    targetDistanceProfile: mtf.mtfDominantFrame,
    mtfAdjustmentApplied: true,
    fallbackReason: null,
    coherenceReason: `mtf_coherent_${mtf.mtfDominantFrame}`
  };
}

module.exports = {
  DEFAULT_MAX_INSTABILITY,
  DEFAULT_MIN_AGREEMENT,
  resolveRsiReversionMtfParams
};
