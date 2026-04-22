// Module responsibility: named exit policies and lightweight resolution helpers.

import type { ExitPolicy, InvalidationMode } from "../types/exitPolicy.ts";

const RSI_REVERSION_PRO: ExitPolicy = {
  id: "RSI_REVERSION_PRO",
  invalidation: {
    modes: ["family_mismatch", "low_maturity", "no_trade", "not_ready", "stale", "symbol_mismatch", "unclear"]
  },
  protection: {
    allowBreakEven: false,
    stopMode: "fixed_pct"
  },
  qualification: {
    estimatedCostMultiplier: 1,
    minTickProfit: 0.05,
    pnlExitFloorMode: "strict_net_positive",
    rsiThresholdExit: true
  },
  recovery: {
    maxConsecutiveEntries: 2,
    priceTargetExit: true,
    targetOffsetPct: 0.015,
    targetSource: "emaSlow",
    timeoutMs: 30_000
  }
};

const RSI_REVERSION_FAST_TIMEOUT: ExitPolicy = {
  ...RSI_REVERSION_PRO,
  id: "RSI_REVERSION_FAST_TIMEOUT",
  recovery: {
    ...RSI_REVERSION_PRO.recovery,
    timeoutMs: 15_000
  }
};

const EXIT_POLICIES: Record<string, ExitPolicy> = {
  RSI_REVERSION_FAST_TIMEOUT,
  RSI_REVERSION_PRO
};

function cloneExitPolicy(policy: ExitPolicy): ExitPolicy {
  return {
    ...policy,
    invalidation: {
      modes: [...policy.invalidation.modes]
    },
    protection: {
      ...policy.protection
    },
    qualification: {
      ...policy.qualification
    },
    recovery: {
      ...policy.recovery
    }
  };
}

function isInvalidationMode(value: unknown): value is InvalidationMode {
  return value === "regime_change"
    || value === "low_maturity"
    || value === "unclear"
    || value === "family_mismatch"
    || value === "extreme_volatility"
    || value === "no_trade"
    || value === "not_ready"
    || value === "stale"
    || value === "symbol_mismatch";
}

function normalizeInvalidationModes(value: unknown, fallbackModes: InvalidationMode[]): InvalidationMode[] {
  if (!Array.isArray(value) || value.length <= 0) {
    return [...fallbackModes];
  }
  const normalized = value
    .map((mode) => String(mode))
    .filter(isInvalidationMode);
  return normalized.length > 0 ? normalized : [...fallbackModes];
}

function resolveExitPolicy(strategyConfig: Record<string, unknown> | null | undefined, fallbackPolicyId?: string | null): ExitPolicy | null {
  const policyId = String(strategyConfig?.exitPolicyId || fallbackPolicyId || "").trim();
  const basePolicy = policyId ? EXIT_POLICIES[policyId] : null;
  const override = strategyConfig?.exitPolicy as Record<string, any> | undefined;

  if (!basePolicy && !override) {
    return null;
  }

  const base = basePolicy ? cloneExitPolicy(basePolicy) : {
    id: String(override?.id || policyId || "custom_exit_policy"),
    invalidation: { modes: [] },
    protection: { allowBreakEven: false, stopMode: "fixed_pct" as const },
    qualification: { estimatedCostMultiplier: 1, pnlExitFloorMode: "strict_net_positive" as const },
    recovery: { maxConsecutiveEntries: 2, targetOffsetPct: 0, targetSource: "emaSlow" as const }
  };

  return {
    ...base,
    ...override,
    id: String(override?.id || base.id),
    invalidation: {
      modes: normalizeInvalidationModes(override?.invalidation?.modes, base.invalidation.modes)
    },
    protection: {
      ...base.protection,
      ...(override?.protection || {})
    },
    qualification: {
      ...base.qualification,
      ...(override?.qualification || {})
    },
    recovery: {
      ...base.recovery,
      ...(override?.recovery || {})
    }
  };
}

module.exports = {
  EXIT_POLICIES,
  RSI_REVERSION_FAST_TIMEOUT,
  RSI_REVERSION_PRO,
  resolveExitPolicy
};
