// Module responsibility: explicit runtime lifecycle states and events for open positions.

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
  | "FAILED_RSI_EXIT";

export type PositionExitMechanism =
  | "qualification"
  | "recovery"
  | "protection"
  | "invalidation";
