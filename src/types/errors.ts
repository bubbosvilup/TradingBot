export type TradingErrorKind = "execution" | "invariant" | "strategy" | "config" | "market_data";

export interface TradingError {
  kind: TradingErrorKind;
  code: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export type ExecutionError = TradingError & {
  kind: "execution";
};
