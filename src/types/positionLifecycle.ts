export type PositionLifecycleState =
  | "ACTIVE"
  | "MANAGED_RECOVERY"
  | "EXITING"
  | "CLOSED";

export type PositionLifecycleEvent =
  | "RSI_EXIT_HIT"
  | "PRICE_TARGET_HIT"
  | "REGIME_INVALIDATION"
  | "PROTECTIVE_STOP_HIT"
  | "RECOVERY_TIMEOUT"
  | "MANAGED_RECOVERY_BREAKER_HIT"
  | "FAILED_RSI_EXIT";

export type PositionExitMechanism =
  | "qualification"
  | "recovery"
  | "breaker"
  | "protection"
  | "invalidation";
