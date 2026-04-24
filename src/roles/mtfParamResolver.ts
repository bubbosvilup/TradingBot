import type { MtfDecisionTrace, MtfHorizonFrameId, MtfPublishDiagnostics } from "../types/mtf.ts";

const RSI_MIN_EXPECTED_NET_EDGE_FLOOR = 0.0015;
const DEFAULT_BUY_RSI = 33;
const DEFAULT_SELL_RSI = 58;
// Resolver-level coherence gate for parameter widening. This is intentionally stricter
// than the architect usability gate (`mtf.instabilityThreshold`, default 0.5).
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
  mtfDecisionTrace: MtfDecisionTrace;
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
  instabilityThreshold: number;
  coherenceReason?: string;
  dominantTimeframe?: MtfHorizonFrameId | null;
  mtfDiagnostics?: MtfPublishDiagnostics | null;
  targetDistanceProfile?: RsiReversionTargetDistanceProfile;
}): RsiReversionMtfResolvedParams {
  const reason = params.coherenceReason || params.fallbackReason || "baseline";
  return {
    resolvedBuyRsi: params.baseBuyRsi,
    resolvedSellRsi: params.baseSellRsi,
    resolvedMinExpectedNetEdgePct: params.baseMinExpectedNetEdgePct,
    resolvedTargetDistanceCapPct: params.baseTargetDistanceCapPct,
    dominantTimeframe: params.dominantTimeframe ?? null,
    targetDistanceProfile: params.targetDistanceProfile || "baseline",
    mtfAdjustmentApplied: false,
    fallbackReason: params.fallbackReason,
    coherenceReason: reason,
    mtfDecisionTrace: buildMtfDecisionTrace({
      adjusted: false,
      baselineParamsUsed: true,
      capMultiplier: 1,
      fallbackReason: params.fallbackReason,
      instabilityThreshold: params.instabilityThreshold,
      mtfDiagnostics: params.mtfDiagnostics || null,
      reason
    })
  };
}

function buildMtfDecisionTrace(params: {
  adjusted: boolean;
  baselineParamsUsed: boolean;
  capMultiplier: number | null;
  fallbackReason?: string | null;
  instabilityThreshold: number;
  mtfDiagnostics?: MtfPublishDiagnostics | null;
  reason: string | null;
}): MtfDecisionTrace {
  const mtf = params.mtfDiagnostics || null;
  const instability = Number(mtf?.mtfInstability);
  return {
    adjusted: params.adjusted,
    baselineParamsUsed: params.baselineParamsUsed,
    capMultiplier: params.capMultiplier,
    dominantFrame: mtf?.mtfDominantFrame ?? null,
    enabled: Boolean(mtf?.mtfEnabled),
    instability: Number.isFinite(instability) ? instability : null,
    instabilityThreshold: params.instabilityThreshold,
    reason: params.fallbackReason || params.reason
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
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
      fallbackReason: "mtf_disabled"
    });
  }
  if (!mtf.mtfSufficientFrames) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
      fallbackReason: "mtf_insufficient_frames"
    });
  }
  if (mtf.mtfMetaRegime !== "range") {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
      fallbackReason: "mtf_non_range"
    });
  }
  if (!mtf.mtfDominantFrame) {
    return buildBaseline({
      baseBuyRsi,
      baseSellRsi,
      baseMinExpectedNetEdgePct,
      baseTargetDistanceCapPct,
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
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
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
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
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
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
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
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
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
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
    coherenceReason: `mtf_coherent_${mtf.mtfDominantFrame}`,
    mtfDecisionTrace: buildMtfDecisionTrace({
      adjusted: true,
      baselineParamsUsed: false,
      capMultiplier,
      fallbackReason: null,
      instabilityThreshold: maxInstability,
      mtfDiagnostics: mtf,
      reason: `mtf_coherent_${mtf.mtfDominantFrame}`
    })
  };
}

module.exports = {
  DEFAULT_MAX_INSTABILITY,
  DEFAULT_MIN_AGREEMENT,
  resolveRsiReversionMtfParams
};
