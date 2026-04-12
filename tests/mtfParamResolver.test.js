"use strict";

const { resolveRsiReversionMtfParams } = require("../src/roles/mtfParamResolver.ts");

function buildMtf(overrides = {}) {
  return {
    mtfAgreement: 0.8,
    mtfDominantFrame: "medium",
    mtfDominantTimeframe: "15m",
    mtfEnabled: true,
    mtfInstability: 0.2,
    mtfMetaRegime: "range",
    mtfReadyFrameCount: 3,
    mtfSufficientFrames: true,
    ...overrides
  };
}

function resolve(overrides = {}) {
  return resolveRsiReversionMtfParams({
    baseBuyRsi: 33,
    baseSellRsi: 58,
    baseMinExpectedNetEdgePct: 0.0015,
    baseTargetDistanceCapPct: 0.01,
    ...overrides
  });
}

function runMtfParamResolverTests() {
  {
    const result = resolve({ mtfDiagnostics: null });
    if (result.resolvedTargetDistanceCapPct !== 0.01 || result.mtfAdjustmentApplied || result.fallbackReason !== "mtf_disabled") {
      throw new Error(`disabled MTF should preserve baseline cap: ${JSON.stringify(result)}`);
    }
    if (result.resolvedBuyRsi !== 33 || result.resolvedSellRsi !== 58 || result.resolvedMinExpectedNetEdgePct !== 0.0015) {
      throw new Error(`disabled MTF should preserve RSI thresholds and edge floor: ${JSON.stringify(result)}`);
    }
  }

  {
    const result = resolve({ mtfDiagnostics: buildMtf({ mtfSufficientFrames: false }) });
    if (result.resolvedTargetDistanceCapPct !== 0.01 || result.fallbackReason !== "mtf_insufficient_frames") {
      throw new Error(`insufficient frames should fall back: ${JSON.stringify(result)}`);
    }
  }

  {
    const result = resolve({ mtfDiagnostics: buildMtf({ mtfMetaRegime: "trend" }) });
    if (result.resolvedTargetDistanceCapPct !== 0.01 || result.fallbackReason !== "mtf_non_range") {
      throw new Error(`non-range MTF should fall back: ${JSON.stringify(result)}`);
    }
  }

  {
    const result = resolve({ mtfDiagnostics: buildMtf({ mtfDominantFrame: null }) });
    if (result.resolvedTargetDistanceCapPct !== 0.01 || result.fallbackReason !== "mtf_missing_dominant_frame") {
      throw new Error(`missing dominant frame should fall back: ${JSON.stringify(result)}`);
    }
  }

  {
    const unstable = resolve({ mtfDiagnostics: buildMtf({ mtfInstability: 0.26, mtfAgreement: 0.9 }) });
    if (unstable.resolvedTargetDistanceCapPct !== 0.01 || unstable.fallbackReason !== "mtf_instability_above_threshold") {
      throw new Error(`above-threshold instability should fall back: ${JSON.stringify(unstable)}`);
    }
    const lowAgreement = resolve({ mtfDiagnostics: buildMtf({ mtfInstability: 0.1, mtfAgreement: 0.74 }) });
    if (lowAgreement.resolvedTargetDistanceCapPct !== 0.01 || lowAgreement.fallbackReason !== "mtf_agreement_below_threshold") {
      throw new Error(`below-threshold agreement should fall back: ${JSON.stringify(lowAgreement)}`);
    }
  }

  {
    const result = resolve({ mtfDiagnostics: buildMtf({ mtfDominantFrame: "short", mtfDominantTimeframe: "5m" }) });
    if (result.resolvedTargetDistanceCapPct !== 0.01 || result.mtfAdjustmentApplied || result.targetDistanceProfile !== "short") {
      throw new Error(`short MTF should remain baseline without permissive adjustment: ${JSON.stringify(result)}`);
    }
  }

  {
    const result = resolve({ mtfDiagnostics: buildMtf({ mtfDominantFrame: "medium", mtfDominantTimeframe: "15m" }) });
    if (result.resolvedTargetDistanceCapPct !== 0.015 || !result.mtfAdjustmentApplied || result.targetDistanceProfile !== "medium") {
      throw new Error(`medium MTF should widen to 1.5x: ${JSON.stringify(result)}`);
    }
  }

  {
    const result = resolve({ mtfDiagnostics: buildMtf({ mtfDominantFrame: "long", mtfDominantTimeframe: "1h" }) });
    if (result.resolvedTargetDistanceCapPct !== 0.02 || !result.mtfAdjustmentApplied || result.targetDistanceProfile !== "long") {
      throw new Error(`long MTF should widen to 2.0x: ${JSON.stringify(result)}`);
    }
  }

  {
    const result = resolve({
      baseMinExpectedNetEdgePct: 0.0003,
      mtfDiagnostics: buildMtf({ mtfDominantFrame: "long" })
    });
    if (result.resolvedMinExpectedNetEdgePct !== 0.0015) {
      throw new Error(`RSI edge floor should not be lowered by MTF: ${JSON.stringify(result)}`);
    }
  }
}

module.exports = {
  runMtfParamResolverTests
};
