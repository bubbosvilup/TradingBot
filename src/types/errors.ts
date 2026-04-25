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

export type ConfigError = TradingError & {
  kind: "config";
};

export type StrategyError = TradingError & {
  kind: "strategy";
};

export type InvariantError = TradingError & {
  kind: "invariant";
};

function createTradingError(params: {
  cause?: unknown;
  code: string;
  context?: Record<string, unknown>;
  kind: TradingErrorKind;
  message: string;
  recoverable: boolean;
}): TradingError & Error {
  return Object.assign(new Error(params.message), {
    cause: params.cause,
    code: params.code,
    context: params.context,
    kind: params.kind,
    recoverable: params.recoverable
  });
}

function createConfigError(code: string, message: string, context?: Record<string, unknown>, cause?: unknown): ConfigError & Error {
  return createTradingError({
    cause,
    code,
    context,
    kind: "config",
    message,
    recoverable: false
  }) as ConfigError & Error;
}

function createStrategyError(code: string, message: string, context?: Record<string, unknown>, cause?: unknown): StrategyError & Error {
  return createTradingError({
    cause,
    code,
    context,
    kind: "strategy",
    message,
    recoverable: true
  }) as StrategyError & Error;
}

function createInvariantError(code: string, message: string, context?: Record<string, unknown>, cause?: unknown): InvariantError & Error {
  return createTradingError({
    cause,
    code,
    context,
    kind: "invariant",
    message,
    recoverable: false
  }) as InvariantError & Error;
}

module.exports = {
  createConfigError,
  createInvariantError,
  createStrategyError,
  createTradingError
};
