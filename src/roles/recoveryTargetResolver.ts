// Module responsibility: resolve symbolic recovery target sources into concrete price levels.

import type { MarketContext } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";
import type { ExitPolicy } from "../types/exitPolicy.ts";
import type { IndicatorSnapshot } from "../types/strategy.ts";

const { mean } = require("../utils/math.ts");

const DEFAULT_RECOVERY_TARGET_SOURCE = "emaSlow";
const DEFAULT_RECOVERY_TARGET_OFFSET_PCT = 0.015;

function normalizeRecoveryTargetSource(source: unknown) {
  const normalized = String(source || DEFAULT_RECOVERY_TARGET_SOURCE).trim();
  if (normalized === "emaSlow" || normalized === "emaBaseline" || normalized === "sma20" || normalized === "entryPrice") {
    return normalized;
  }
  return DEFAULT_RECOVERY_TARGET_SOURCE;
}

function resolveRecoveryTargetPolicy(exitPolicy: ExitPolicy | null | undefined) {
  const targetOffsetPct = Number(exitPolicy?.recovery?.targetOffsetPct);
  return {
    targetOffsetPct: Number.isFinite(targetOffsetPct)
      ? targetOffsetPct
      : DEFAULT_RECOVERY_TARGET_OFFSET_PCT,
    targetSource: normalizeRecoveryTargetSource(exitPolicy?.recovery?.targetSource)
  };
}

function resolveBaseTargetPrice(params: {
  context?: MarketContext | null;
  position?: PositionRecord | null;
  targetSource?: unknown;
}) {
  const source = normalizeRecoveryTargetSource(params.targetSource);
  const indicators: Partial<IndicatorSnapshot> = params.context?.indicators || {};
  const prices = Array.isArray(params.context?.prices) ? params.context.prices : [];

  if (source === "emaSlow") {
    return {
      basePrice: Number(indicators.emaSlow),
      source
    };
  }

  if (source === "emaBaseline") {
    return {
      basePrice: Number(indicators.emaBaseline),
      source
    };
  }

  if (source === "sma20") {
    return {
      basePrice: prices.length >= 20 ? mean(prices.slice(-20)) : NaN,
      source
    };
  }

  return {
    basePrice: Number(params.position?.entryPrice),
    source: "entryPrice"
  };
}

function resolveRecoveryTarget(params: {
  context?: MarketContext | null;
  position?: PositionRecord | null;
  targetOffsetPct?: unknown;
  targetSource?: unknown;
}) {
  const targetOffsetPct = Number(params.targetOffsetPct);
  const normalizedOffsetPct = Number.isFinite(targetOffsetPct)
    ? targetOffsetPct
    : DEFAULT_RECOVERY_TARGET_OFFSET_PCT;
  const baseTarget = resolveBaseTargetPrice(params);
  const basePrice = Number(baseTarget.basePrice);

  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return {
      basePrice: null,
      source: baseTarget.source,
      targetOffsetPct: normalizedOffsetPct,
      targetPrice: null
    };
  }

  return {
    basePrice,
    source: baseTarget.source,
    targetOffsetPct: normalizedOffsetPct,
    targetPrice: basePrice * (1 + normalizedOffsetPct)
  };
}

module.exports = {
  DEFAULT_RECOVERY_TARGET_OFFSET_PCT,
  DEFAULT_RECOVERY_TARGET_SOURCE,
  normalizeRecoveryTargetSource,
  resolveRecoveryTarget,
  resolveRecoveryTargetPolicy
};
