const { createConfigError } = require("./errors.ts");
const { VALID_PORTFOLIO_KILL_SWITCH_MODES } = require("./portfolioKillSwitch.ts");

const DEFAULT_RUNTIME_MODES = {
  executionMode: "paper",
  marketMode: "live"
} as const;

const DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG = {
  enabled: false,
  maxDrawdownPct: 0,
  mode: "block_entries_only"
} as const;

const DEFAULT_RUNTIME_TIMING_CONFIG = {
  architectPublishIntervalMs: 30_000,
  architectWarmupMs: 30_000,
  postLossLatchMaxMs: null,
  postLossLatchMinFreshPublications: 2,
  symbolStateRetentionMs: 30 * 60 * 1000,
  userStreamRequestTimeoutMs: 10_000
} as const;

type ParsedPortfolioKillSwitchConfig = {
  enabled: boolean;
  maxDrawdownPct: number;
  mode: string;
};

type ParsedRuntimeTimingConfig = {
  architectPublishIntervalMs: number;
  architectWarmupMs: number;
  postLossLatchMaxMs: number | null;
  postLossLatchMinFreshPublications: number;
  symbolStateRetentionMs: number;
  userStreamRequestTimeoutMs: number;
};

type RuntimeModeConfigInput = {
  executionMode?: unknown;
  marketMode?: unknown;
};

type NumericValidationRule = {
  min?: number;
};

function createBotsConfigError(code: string, message: string, context: Record<string, unknown> = {}) {
  return createConfigError(code, message, {
    configPath: "bots.config.json",
    ...context
  });
}

function requirePlainConfigObject(value: unknown, code: string, message: string, context: Record<string, unknown> = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createBotsConfigError(code, message, context);
  }
  return value as Record<string, unknown>;
}

function parseRuntimeModeConfig(config: RuntimeModeConfigInput = {}) {
  const parsed = {
    executionMode: DEFAULT_RUNTIME_MODES.executionMode,
    marketMode: DEFAULT_RUNTIME_MODES.marketMode
  };

  if (config.executionMode !== undefined) {
    const executionMode = String(config.executionMode || "").trim().toLowerCase();
    if (executionMode === "live") {
      throw createBotsConfigError(
        "unsupported_execution_mode",
        "bots.config.json has unsupported executionMode \"live\"; active runtime is paper-only",
        { field: "executionMode", value: config.executionMode }
      );
    }
    if (executionMode !== "paper") {
      throw createBotsConfigError(
        "invalid_execution_mode",
        `bots.config.json has invalid executionMode "${String(config.executionMode || "")}"`,
        { field: "executionMode", value: config.executionMode }
      );
    }
    parsed.executionMode = executionMode;
  }

  if (config.marketMode !== undefined) {
    const marketMode = String(config.marketMode || "").trim().toLowerCase();
    if (marketMode !== "live") {
      throw createBotsConfigError(
        "unsupported_market_mode",
        `bots.config.json has unsupported marketMode "${String(config.marketMode || "")}"; active runtime requires live market data`,
        { field: "marketMode", value: config.marketMode }
      );
    }
    parsed.marketMode = marketMode;
  }

  return parsed;
}

function parsePortfolioKillSwitchConfig(config?: unknown) {
  const parsed: ParsedPortfolioKillSwitchConfig = {
    ...DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG
  };

  if (config === undefined) {
    return parsed;
  }

  const portfolioKillSwitch = requirePlainConfigObject(
    config,
    "invalid_portfolio_kill_switch",
    "bots.config.json has invalid portfolioKillSwitch; expected an object",
    { field: "portfolioKillSwitch", value: config }
  );

  if (portfolioKillSwitch.enabled !== undefined) {
    if (typeof portfolioKillSwitch.enabled !== "boolean") {
      throw createBotsConfigError(
        "invalid_portfolio_kill_switch_enabled",
        `bots.config.json has invalid portfolioKillSwitch.enabled "${String(portfolioKillSwitch.enabled)}"`,
        { field: "portfolioKillSwitch.enabled", value: portfolioKillSwitch.enabled }
      );
    }
    parsed.enabled = portfolioKillSwitch.enabled;
  }

  if (portfolioKillSwitch.maxDrawdownPct !== undefined) {
    const maxDrawdownPct = Number(portfolioKillSwitch.maxDrawdownPct);
    if (!Number.isFinite(maxDrawdownPct) || maxDrawdownPct <= 0) {
      throw createBotsConfigError(
        "invalid_portfolio_kill_switch_max_drawdown",
        `bots.config.json has invalid portfolioKillSwitch.maxDrawdownPct "${String(portfolioKillSwitch.maxDrawdownPct)}"`,
        { field: "portfolioKillSwitch.maxDrawdownPct", value: portfolioKillSwitch.maxDrawdownPct }
      );
    }
    parsed.maxDrawdownPct = maxDrawdownPct;
  }

  if (portfolioKillSwitch.mode !== undefined) {
    const mode = String(portfolioKillSwitch.mode || "").trim();
    if (!VALID_PORTFOLIO_KILL_SWITCH_MODES.has(mode)) {
      throw createBotsConfigError(
        "invalid_portfolio_kill_switch_mode",
        `bots.config.json has invalid portfolioKillSwitch.mode "${String(portfolioKillSwitch.mode || "")}"`,
        { field: "portfolioKillSwitch.mode", value: portfolioKillSwitch.mode }
      );
    }
    parsed.mode = mode;
  }

  return parsed;
}

function parseOptionalRuntimeTimingNumber(
  config: Record<string, unknown>,
  field: keyof ParsedRuntimeTimingConfig,
  code: string,
  messageLabel: string,
  rule: NumericValidationRule,
  parsed: ParsedRuntimeTimingConfig
) {
  const value = config[field];
  if (value === undefined) return;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || (rule.min !== undefined && numericValue < rule.min)) {
    throw createBotsConfigError(
      code,
      `bots.config.json has invalid ${messageLabel} "${String(value)}"`,
      { field, value }
    );
  }
  if (field === "postLossLatchMaxMs") {
    parsed.postLossLatchMaxMs = numericValue;
    return;
  }
  parsed[field] = numericValue;
}

function parseRuntimeTimingConfig(config: Record<string, unknown> = {}) {
  const parsed: ParsedRuntimeTimingConfig = {
    ...DEFAULT_RUNTIME_TIMING_CONFIG
  };

  parseOptionalRuntimeTimingNumber(
    config,
    "architectWarmupMs",
    "invalid_architect_warmup_ms",
    "architectWarmupMs",
    { min: 5_000 },
    parsed
  );
  parseOptionalRuntimeTimingNumber(
    config,
    "architectPublishIntervalMs",
    "invalid_architect_publish_interval_ms",
    "architectPublishIntervalMs",
    { min: 5_000 },
    parsed
  );
  parseOptionalRuntimeTimingNumber(
    config,
    "postLossLatchMaxMs",
    "invalid_post_loss_latch_max_ms",
    "postLossLatchMaxMs",
    { min: 1 },
    parsed
  );
  parseOptionalRuntimeTimingNumber(
    config,
    "postLossLatchMinFreshPublications",
    "invalid_post_loss_latch_min_fresh_publications",
    "postLossLatchMinFreshPublications",
    { min: 1 },
    parsed
  );
  parseOptionalRuntimeTimingNumber(
    config,
    "symbolStateRetentionMs",
    "invalid_symbol_state_retention_ms",
    "symbolStateRetentionMs",
    { min: 60_000 },
    parsed
  );
  parseOptionalRuntimeTimingNumber(
    config,
    "userStreamRequestTimeoutMs",
    "invalid_user_stream_request_timeout_ms",
    "userStreamRequestTimeoutMs",
    { min: 1 },
    parsed
  );

  return parsed;
}

module.exports = {
  DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG,
  DEFAULT_RUNTIME_TIMING_CONFIG,
  DEFAULT_RUNTIME_MODES,
  parsePortfolioKillSwitchConfig,
  parseRuntimeTimingConfig,
  parseRuntimeModeConfig
};
