import type { HistoricalPreloadConfig, MarketKline, MarketTick } from "../types/market.ts";
import type { MtfRuntimeConfig } from "../types/mtf.ts";
import type { LoggerLike } from "../types/runtime.ts";

const DEFAULT_PRICE_TIMEFRAME = "1m";
const DEFAULT_MAX_HORIZON_MS = 4 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 600;
const VALID_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

type HistoricalPreloadStore = {
  updateKline(kline: MarketKline): void;
  updatePrice(tick: MarketTick): void;
};

type HistoricalKlineSymbolResult = {
  error: string | null;
  klineCount: number;
  symbol: string;
};

type HistoricalKlineFetchResult = {
  interval: string;
  klinesBySymbol: Record<string, MarketKline[]>;
  observedAt: number;
  since: number;
  symbolResults: HistoricalKlineSymbolResult[];
};

type HistoricalPreloadMarketStream = {
  fetchHistoricalKlines(params: {
    symbols: string[];
    interval: string;
    since: number;
    limit: number;
    observedAt?: number;
  }): Promise<HistoricalKlineFetchResult>;
};

type HistoricalPreloadSymbolStats = {
  errors: string[];
  klineCounts: Record<string, number>;
  priceTicks: number;
  symbol: string;
};

type HistoricalPreloadSummary = {
  durationMs: number;
  enabled: boolean;
  errors?: string[];
  horizonMs?: number;
  missingPriceSymbols?: string[];
  outcome: "completed" | "disabled" | "failed" | "partial";
  priceTimeframe?: string;
  reason?: string | null;
  required: boolean;
  symbolStats?: HistoricalPreloadSymbolStats[];
  symbols: string[];
  timeframes?: string[];
};

type HistoricalPreloadError = Error & {
  historicalPreloadLogged?: boolean;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseOptionalBooleanFlag(value: string | undefined | null, name: string) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name}=${value} is invalid; expected true/false, 1/0, yes/no, or on/off`);
}

function parseOptionalPositiveNumber(value: string | undefined | null, name: string) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${name}=${value} is invalid; expected a positive number`);
  }
  return Math.floor(normalized);
}

function parseTimeframeList(value: string | undefined | null, name: string) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const timeframes = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (timeframes.length <= 0) {
    throw new Error(`${name} is invalid; expected a comma-separated timeframe list`);
  }
  for (const timeframe of timeframes) {
    if (!VALID_TIMEFRAMES.has(timeframe)) {
      throw new Error(`${name} has invalid timeframe "${timeframe}"`);
    }
  }
  return [...new Set(timeframes)];
}

function timeframeToMs(timeframe: string) {
  const normalized = String(timeframe || "").trim();
  const match = normalized.match(/^(\d+)([mhd])$/);
  if (!match) return 60_000;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 60_000;
  if (match[2] === "m") return value * 60_000;
  if (match[2] === "h") return value * 60 * 60_000;
  return value * 24 * 60 * 60_000;
}

function normalizeTimeframe(value: unknown, fallback: string, name: string) {
  const timeframe = String(value || fallback).trim();
  if (!VALID_TIMEFRAMES.has(timeframe)) {
    throw new Error(`${name} has invalid timeframe "${timeframe}"`);
  }
  return timeframe;
}

function uniqueTimeframes(values: unknown[]) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].filter((timeframe) => VALID_TIMEFRAMES.has(timeframe));
}

function resolveHistoricalPreloadRuntimeConfig(params: {
  config?: HistoricalPreloadConfig | null;
  env?: NodeJS.ProcessEnv;
  contextMaxWindowMs: number;
  architectWarmupMs: number;
  mtfConfig?: MtfRuntimeConfig | null;
  marketKlineIntervals?: string[];
}) {
  const config = params.config || {};
  const env = params.env || process.env;
  const envEnabled = parseOptionalBooleanFlag(env.HISTORICAL_PRELOAD_ENABLED, "HISTORICAL_PRELOAD_ENABLED");
  const envRequired = parseOptionalBooleanFlag(env.HISTORICAL_PRELOAD_REQUIRED, "HISTORICAL_PRELOAD_REQUIRED");
  const envHorizonMs = parseOptionalPositiveNumber(env.HISTORICAL_PRELOAD_HORIZON_MS, "HISTORICAL_PRELOAD_HORIZON_MS");
  const envMaxHorizonMs = parseOptionalPositiveNumber(env.HISTORICAL_PRELOAD_MAX_HORIZON_MS, "HISTORICAL_PRELOAD_MAX_HORIZON_MS");
  const envTimeoutMs = parseOptionalPositiveNumber(env.HISTORICAL_PRELOAD_TIMEOUT_MS, "HISTORICAL_PRELOAD_TIMEOUT_MS");
  const envLimit = parseOptionalPositiveNumber(env.HISTORICAL_PRELOAD_LIMIT, "HISTORICAL_PRELOAD_LIMIT");
  const envTimeframes = parseTimeframeList(env.HISTORICAL_PRELOAD_TIMEFRAMES, "HISTORICAL_PRELOAD_TIMEFRAMES");

  const mtfFrames = Array.isArray(params.mtfConfig?.frames) ? params.mtfConfig?.frames || [] : [];
  const largestMtfFrameMs = Boolean(params.mtfConfig?.enabled)
    ? mtfFrames.reduce((largest, frame) => Math.max(largest, Number(frame?.windowMs) || 0), 0)
    : 0;
  const requiredCoverageMs = Math.max(
    Math.floor(Number(params.contextMaxWindowMs) || 0),
    Math.floor(Number(params.architectWarmupMs) || 0),
    largestMtfFrameMs,
    5_000
  );

  const priceTimeframe = normalizeTimeframe(
    env.HISTORICAL_PRELOAD_PRICE_TIMEFRAME || config.priceTimeframe,
    DEFAULT_PRICE_TIMEFRAME,
    "historicalPreload.priceTimeframe"
  );
  const configuredTimeframes = Array.isArray(config.timeframes) ? config.timeframes : null;
  const derivedTimeframes = uniqueTimeframes([
    priceTimeframe,
    ...(params.marketKlineIntervals || []),
    ...mtfFrames.map((frame) => frame?.id)
  ]);
  const timeframes = uniqueTimeframes([
    priceTimeframe,
    ...(envTimeframes || configuredTimeframes || derivedTimeframes)
  ]);

  const configuredMaxHorizonMs = Number(config.maxHorizonMs);
  const maxHorizonMs = envMaxHorizonMs
    ?? (Number.isFinite(configuredMaxHorizonMs) && configuredMaxHorizonMs > 0 ? Math.floor(configuredMaxHorizonMs) : DEFAULT_MAX_HORIZON_MS);
  const configuredHorizonMs = Number(config.horizonMs);
  const explicitHorizonMs = envHorizonMs
    ?? (Number.isFinite(configuredHorizonMs) && configuredHorizonMs > 0 ? Math.floor(configuredHorizonMs) : null);
  const maxHorizonIsExplicit = envMaxHorizonMs !== null || (Number.isFinite(configuredMaxHorizonMs) && configuredMaxHorizonMs > 0);
  const requestedHorizonMs = explicitHorizonMs ?? requiredCoverageMs;
  const boundedRequestedHorizonMs = maxHorizonIsExplicit
    ? Math.min(requestedHorizonMs, maxHorizonMs)
    : requestedHorizonMs;
  const horizonMs = Math.max(requiredCoverageMs, boundedRequestedHorizonMs);

  return {
    enabled: envEnabled === null ? Boolean(config.enabled) : envEnabled,
    required: envRequired === null ? Boolean(config.required) : envRequired,
    horizonMs,
    limit: envLimit ?? Math.max(Math.floor(Number(config.limit) || DEFAULT_LIMIT), 1),
    maxHorizonMs,
    priceTimeframe,
    requiredCoverageMs,
    timeframes,
    timeoutMs: envTimeoutMs ?? Math.max(Math.floor(Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS), 1)
  };
}

class HistoricalBootstrapService {
  store: HistoricalPreloadStore;
  marketStream: HistoricalPreloadMarketStream;
  logger: LoggerLike;
  config: ReturnType<typeof resolveHistoricalPreloadRuntimeConfig>;

  constructor(deps: {
    store: HistoricalPreloadStore;
    marketStream: HistoricalPreloadMarketStream;
    logger: LoggerLike;
    config?: HistoricalPreloadConfig | null;
    env?: NodeJS.ProcessEnv;
    contextMaxWindowMs: number;
    architectWarmupMs: number;
    mtfConfig?: MtfRuntimeConfig | null;
    marketKlineIntervals?: string[];
  }) {
    this.store = deps.store;
    this.marketStream = deps.marketStream;
    this.logger = deps.logger;
    this.config = resolveHistoricalPreloadRuntimeConfig({
      architectWarmupMs: deps.architectWarmupMs,
      config: deps.config,
      contextMaxWindowMs: deps.contextMaxWindowMs,
      env: deps.env,
      marketKlineIntervals: deps.marketKlineIntervals,
      mtfConfig: deps.mtfConfig
    });
  }

  isEnabled() {
    return this.config.enabled;
  }

  resolveLimitForTimeframe(timeframe: string) {
    const neededSamples = Math.ceil(this.config.horizonMs / timeframeToMs(timeframe)) + 2;
    return Math.max(1, Math.min(this.config.limit, neededSamples));
  }

  async run(symbols: string[], options: { observedAt?: number } = {}) {
    const requestedSymbols = [...new Set(symbols || [])].map((symbol) => String(symbol || "").trim()).filter(Boolean);
    const startedAt = Date.now();
    const observedAt = Number.isFinite(Number(options.observedAt)) ? Number(options.observedAt) : startedAt;
    if (!this.config.enabled) {
      return {
        durationMs: 0,
        enabled: false,
        outcome: "disabled",
        required: this.config.required,
        symbols: requestedSymbols
      };
    }

    this.logger.info("historical_preload_requested", {
      horizonMs: this.config.horizonMs,
      priceTimeframe: this.config.priceTimeframe,
      required: this.config.required,
      requiredCoverageMs: this.config.requiredCoverageMs,
      symbols: requestedSymbols.join(","),
      timeframes: this.config.timeframes.join(","),
      timeoutMs: this.config.timeoutMs
    });

    try {
      const summary = await this.executePreload(requestedSymbols, observedAt);
      if (summary.outcome === "completed") {
        this.logger.info("historical_preload_completed", this.logSummary(summary));
        return summary;
      }
      if (this.config.required) {
        this.logger.error("historical_preload_failed", this.logSummary(summary));
        const error = new Error(`required historical preload failed: ${summary.reason}`) as HistoricalPreloadError;
        error.historicalPreloadLogged = true;
        throw error;
      }
      this.logger.warn("historical_preload_degraded", this.logSummary(summary));
      return summary;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const failed = {
        durationMs: Date.now() - startedAt,
        enabled: true,
        errors: [message],
        horizonMs: this.config.horizonMs,
        outcome: "failed",
        priceTimeframe: this.config.priceTimeframe,
        reason: message,
        required: this.config.required,
        symbols: requestedSymbols,
        timeframes: this.config.timeframes
      } as HistoricalPreloadSummary;
      if (this.config.required) {
        if (!(error as HistoricalPreloadError)?.historicalPreloadLogged) {
          this.logger.error("historical_preload_failed", this.logSummary(failed));
        }
        throw error;
      }
      this.logger.warn("historical_preload_degraded", this.logSummary(failed));
      return failed;
    }
  }

  async executePreload(symbols: string[], observedAt: number): Promise<HistoricalPreloadSummary> {
    const startedAt = Date.now();
    const statsBySymbol = new Map<string, HistoricalPreloadSymbolStats>();
    for (const symbol of symbols) {
      statsBySymbol.set(symbol, {
        errors: [],
        klineCounts: {},
        priceTicks: 0,
        symbol
      });
    }
    const fetchErrors: string[] = [];
    const since = Math.max(0, observedAt - this.config.horizonMs);

    for (const timeframe of this.config.timeframes) {
      const limit = this.resolveLimitForTimeframe(timeframe);
      const result = await this.withTimeout<HistoricalKlineFetchResult>(
        this.marketStream.fetchHistoricalKlines({
          interval: timeframe,
          limit,
          observedAt,
          since,
          symbols
        }),
        this.config.timeoutMs,
        `historical preload timed out fetching ${timeframe}`
      );

      for (const symbolResult of result.symbolResults || []) {
        const symbolStats = statsBySymbol.get(symbolResult.symbol);
        if (!symbolStats) continue;
        if (symbolResult.error) {
          const message = `${symbolResult.symbol} ${timeframe}: ${symbolResult.error}`;
          symbolStats.errors.push(message);
          fetchErrors.push(message);
        }
      }

      for (const symbol of symbols) {
        const symbolStats = statsBySymbol.get(symbol);
        if (!symbolStats) continue;
        const klines = result.klinesBySymbol?.[symbol] || [];
        const closedKlines = klines.filter((kline: MarketKline) => kline && kline.isClosed !== false);
        symbolStats.klineCounts[timeframe] = closedKlines.length;
        for (const kline of closedKlines) {
          this.store.updateKline(kline);
          if (timeframe === this.config.priceTimeframe) {
            this.store.updatePrice(this.klineToTick(kline));
            symbolStats.priceTicks += 1;
          }
        }
      }
    }

    const symbolStats = Array.from(statsBySymbol.values());
    const missingPriceSymbols = symbolStats
      .filter((entry) => entry.priceTicks <= 0)
      .map((entry) => entry.symbol);
    const isPartial = fetchErrors.length > 0 || missingPriceSymbols.length > 0;
    const reason = missingPriceSymbols.length > 0
      ? `missing price preload for ${missingPriceSymbols.join(",")}`
      : fetchErrors.length > 0
        ? `historical fetch errors: ${fetchErrors.join("; ")}`
        : null;

    return {
      durationMs: Date.now() - startedAt,
      enabled: true,
      errors: fetchErrors,
      horizonMs: this.config.horizonMs,
      missingPriceSymbols,
      outcome: isPartial ? "partial" as const : "completed" as const,
      priceTimeframe: this.config.priceTimeframe,
      reason,
      required: this.config.required,
      symbolStats,
      symbols,
      timeframes: this.config.timeframes
    };
  }

  klineToTick(kline: MarketKline): MarketTick {
    return {
      price: Number(kline.close),
      receivedAt: kline.receivedAt || Date.now(),
      source: "rest",
      symbol: kline.symbol,
      timestamp: Number(kline.timestamp || kline.closedAt)
    };
  }

  withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      if (timer && typeof timer.unref === "function") {
        timer.unref();
      }
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }) as Promise<T>;
  }

  logSummary(summary: HistoricalPreloadSummary) {
    return {
      durationMs: summary.durationMs,
      errors: Array.isArray(summary.errors) ? summary.errors.join("; ") : "",
      horizonMs: summary.horizonMs,
      missingPriceSymbols: Array.isArray(summary.missingPriceSymbols) ? summary.missingPriceSymbols.join(",") : "",
      outcome: summary.outcome,
      priceTimeframe: summary.priceTimeframe,
      reason: summary.reason || null,
      required: summary.required,
      symbols: Array.isArray(summary.symbols) ? summary.symbols.join(",") : "",
      symbolStats: summary.symbolStats ? JSON.stringify(summary.symbolStats) : "",
      timeframes: Array.isArray(summary.timeframes) ? summary.timeframes.join(",") : ""
    };
  }
}

module.exports = {
  HistoricalBootstrapService,
  resolveHistoricalPreloadRuntimeConfig,
  timeframeToMs
};
