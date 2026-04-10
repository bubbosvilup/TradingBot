// Module responsibility: structured exit policy contracts shared across lifecycle and strategy logic.

export type ExitQualificationMode =
  | "strict_net_positive"
  | "cost_buffered_positive"
  | "allow_small_loss_on_regime_risk";

export type RecoveryTargetSource =
  | "emaSlow"
  | "emaBaseline"
  | "sma20"
  | "entryPrice";

export type ProtectionStopMode =
  | "structural_min"
  | "atr_trailing"
  | "fixed_pct";

export type InvalidationMode =
  | "regime_change"
  | "low_maturity"
  | "unclear"
  | "family_mismatch"
  | "extreme_volatility"
  | "no_trade"
  | "not_ready"
  | "stale"
  | "symbol_mismatch";

export interface ExitPolicy {
  id: string;
  qualification: {
    pnlExitFloorMode: ExitQualificationMode;
    estimatedCostMultiplier: number;
    minTickProfit?: number;
  };
  recovery: {
    targetSource: RecoveryTargetSource;
    targetOffsetPct: number;
    maxConsecutiveEntries?: number;
    timeoutTicks?: number;
    timeoutMs?: number;
  };
  protection: {
    stopMode: ProtectionStopMode;
    allowBreakEven: boolean;
    breakEvenUpgradeThresholdPct?: number;
  };
  invalidation: {
    modes: InvalidationMode[];
  };
}
