// Module responsibility: scoped console logger with consistent formatting.

import type { BotConfig } from "../types/bot.ts";

type LogType = "verbose" | "minimal" | "only_trades" | "strategy_debug" | "silent";
type LogCategory =
  | "startup"
  | "architect_change"
  | "setup"
  | "blocked"
  | "cooldown"
  | "risk_change"
  | "trade_open"
  | "trade_close"
  | "shutdown"
  | "warning"
  | "error"
  | "evaluation"
  | "heartbeat"
  | "ws_flow"
  | "experiment_summary"
  | "other";

function resolveLogType(value?: string | null): LogType {
  const normalized = String(value || process.env.LOG_TYPE || "minimal").trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (normalized === "minimal" || normalized === "only_trades" || normalized === "strategy_debug" || normalized === "silent") {
    return normalized;
  }
  if (normalized === "verbose") return "verbose";
  return "minimal";
}

function categorizeEvent(scope: string, level: string, message: string): LogCategory {
  if (level === "ERROR") return "error";
  if (level === "WARN") return "warning";

  if (message === "BUY" || message === "SHORT") return "trade_open";
  if (message === "SELL" || message === "COVER") return "trade_close";
  if (message === "SETUP") return "setup";
  if (message === "BLOCK_CHANGE") return "blocked";
  if (message === "RISK_CHANGE") return "risk_change";
  if (message === "ARCHITECT_CHANGE") return "architect_change";
  if (message === "entry_blocked") return "blocked";
  if (message === "failed_rsi_exit") return "trade_close";
  if (message === "rsi_exit_deferred" || message === "managed_recovery_entered" || message === "managed_recovery_updated" || message === "managed_recovery_exited") {
    return "risk_change";
  }
  if (message === "post_loss_architect_latch_activated" || message === "post_loss_architect_latch_publish_counted" || message === "post_loss_architect_latch_released") {
    return "risk_change";
  }

  if (message === "started" || message === "system_ready" || message === "market_stream_started" || message === "context_ready" || message === "dashboard_ready" || message === "execution_mode_forced_paper" || message === "non_routable_allowed_strategies") {
    return "startup";
  }
  if (message === "stopped" || message === "system_stopped" || message === "duration_reached") {
    return "shutdown";
  }
  if (message === "experiment_enabled") {
    return "startup";
  }
  if (message === "cooldown_started" || message === "cooldown_ended") {
    return "cooldown";
  }
  if (message === "heartbeat") {
    return "heartbeat";
  }
  if (message === "entry_evaluated" || message === "entry_gate_allowed" || message === "entry_gate_blocked" || message === "position_opened" || message === "position_closed" || message === "position_open_rejected") {
    return "evaluation";
  }
  if (message === "tick_pipeline_latency" || message === "tick_pipeline_latency_high") {
    return "evaluation";
  }
  if (message === "experiment_summary" || message === "experiment_final_summary") {
    return "experiment_summary";
  }
  if (message === "architect_published") {
    return "architect_change";
  }
  if (message === "strategy_aligned" || message === "architect_changed" || message === "architect_strategy_divergence") {
    return "architect_change";
  }
  if (message.startsWith("ws_") || message.startsWith("user_stream_") || message.startsWith("market_rest_") || scope.includes(":ws")) {
    return "ws_flow";
  }

  return "other";
}

function shouldLog(logType: LogType, category: LogCategory) {
  if (logType === "verbose") return true;
  if (logType === "silent") return false;

  const categorySets: Record<Exclude<LogType, "verbose" | "silent">, Set<LogCategory>> = {
    minimal: new Set(["startup", "architect_change", "blocked", "cooldown", "risk_change", "trade_open", "trade_close", "shutdown", "warning", "error", "experiment_summary"]),
    only_trades: new Set(["trade_open", "trade_close", "warning", "error"]),
    strategy_debug: new Set(["setup", "blocked", "risk_change", "architect_change", "trade_open", "trade_close", "warning", "error"])
  };
  return categorySets[logType].has(category);
}

// Noisy message patterns that should be deduplicated/throttled in minimal mode.
const NOISY_MESSAGES = new Set([
  "BLOCK_CHANGE",
  "entry_blocked",
  "managed_recovery_updated",
  "architect_published"
]);

const DEDUPE_WINDOW_MS = 15_000; // suppress identical noisy messages within 15s
const lastNoisyEmit = new Map<string, number>();

function makeDedupeKey(message: string, metadata?: Record<string, unknown>): string {
  if (message === "BLOCK_CHANGE") {
    return `BLOCK_CHANGE|${metadata?.botId || ""}|${metadata?.blockReason || metadata?.reason || ""}`;
  }
  if (message === "entry_blocked") {
    return `entry_blocked|${metadata?.botId || ""}|${metadata?.reason || ""}`;
  }
  if (message === "managed_recovery_updated") {
    return `managed_recovery_updated|${metadata?.botId || ""}|${metadata?.status || ""}`;
  }
  if (message === "architect_published") {
    return `architect_published|${metadata?.symbol || ""}|${metadata?.publishedMarketRegime || metadata?.marketRegime || ""}|${metadata?.publishedRecommendedFamily || metadata?.recommendedFamily || ""}`;
  }
  return `${message}|${JSON.stringify(metadata || {})}`;
}

function compactArchitectMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return metadata;
  return {
    candidateMarketRegime: metadata.candidateMarketRegime ?? null,
    candidateRecommendedFamily: metadata.candidateRecommendedFamily ?? null,
    candidateMtfAgreement: metadata.candidateMtfAgreement ?? null,
    candidateMtfDominantFrame: metadata.candidateMtfDominantFrame ?? null,
    candidateMtfEnabled: metadata.candidateMtfEnabled ?? false,
    candidateMtfInstability: metadata.candidateMtfInstability ?? null,
    candidateMtfMetaRegime: metadata.candidateMtfMetaRegime ?? null,
    candidateMtfSufficientFrames: metadata.candidateMtfSufficientFrames ?? false,
    previousRegime: metadata.previousRegime ?? null,
    publishOutcome: metadata.publishOutcome ?? null,
    publishedMarketRegime: metadata.publishedMarketRegime ?? null,
    publishedRecommendedFamily: metadata.publishedRecommendedFamily ?? null,
    publishedDecisionStrength: metadata.publishedDecisionStrength ?? null,
    publishedMtfAgreement: metadata.publishedMtfAgreement ?? null,
    publishedMtfDominantFrame: metadata.publishedMtfDominantFrame ?? null,
    publishedMtfEnabled: metadata.publishedMtfEnabled ?? false,
    publishedMtfInstability: metadata.publishedMtfInstability ?? null,
    publishedMtfMetaRegime: metadata.publishedMtfMetaRegime ?? null,
    publishedMtfSufficientFrames: metadata.publishedMtfSufficientFrames ?? false,
    publisherChallengerCount: metadata.publisherChallengerCount ?? 0,
    publisherChallengerRegime: metadata.publisherChallengerRegime ?? null,
    publisherChallengerRequired: metadata.publisherChallengerRequired ?? null,
    publisherHysteresisActive: metadata.publisherHysteresisActive ?? false,
    symbol: metadata.symbol ?? null,
    updatedAt: metadata.updatedAt ?? null,
    via: metadata.via ?? null
  };
}

function shouldSuppressNoisy(message: string, metadata?: Record<string, unknown>): boolean {
  if (!NOISY_MESSAGES.has(message)) return false;
  const key = makeDedupeKey(message, metadata);
  const last = lastNoisyEmit.get(key) || 0;
  return (Date.now() - last) < DEDUPE_WINDOW_MS;
}

function recordNoisyEmit(message: string, metadata?: Record<string, unknown>) {
  const key = makeDedupeKey(message, metadata);
  lastNoisyEmit.set(key, Date.now());
}

function createLogger(scope: string, options: { eventSink?: ((event: any) => void) | null; logType?: string | null } = {}) {
  const logType = resolveLogType(options.logType);

  function emit(level: string, message: string, metadata?: Record<string, unknown>) {
    const category = categorizeEvent(scope, level, message);
    if (!shouldLog(logType, category)) {
      return;
    }

    // Deduplicate noisy messages in minimal mode only
    if (logType === "minimal" && shouldSuppressNoisy(message, metadata)) {
      return;
    }

    const time = Date.now();

    // Keep full Architect feature/context dumps behind verbose logging.
    let compactMetadata = metadata;
    if (logType !== "verbose" && (message === "architect_published" || message === "architect_changed")) {
      compactMetadata = compactArchitectMetadata(metadata);
    }

    const suffix = compactMetadata && Object.keys(compactMetadata).length > 0
      ? ` | ${Object.entries(compactMetadata).map(([key, value]) => `${key}=${String(value)}`).join(" | ")}`
      : "";
    console.log(`[${new Date(time).toISOString()}] ${scope} | ${level} | ${message}${suffix}`);
    if (typeof options.eventSink === "function" && message !== "heartbeat") {
      options.eventSink({
        id: `${time}-${Math.random().toString(16).slice(2, 8)}`,
        category,
        level,
        message,
        metadata: compactMetadata || {},
        scope,
        time
      });
    }

    if (logType === "minimal" && NOISY_MESSAGES.has(message)) {
      recordNoisyEmit(message, metadata);
    }
  }

  return {
    child(childScope: string) {
      return createLogger(`${scope}:${childScope}`, options);
    },
    info(message: string, metadata?: Record<string, unknown>) {
      emit("INFO", message, metadata);
    },
    warn(message: string, metadata?: Record<string, unknown>) {
      emit("WARN", message, metadata);
    },
    error(message: string, metadata?: Record<string, unknown>) {
      emit("ERROR", message, metadata);
    },
    bot(botConfig: BotConfig, message: string, metadata?: Record<string, unknown>) {
      emit("BOT", message, { botId: botConfig.id, symbol: botConfig.symbol, ...metadata });
    }
  };
}

module.exports = {
  categorizeEvent,
  createLogger,
  resolveLogType,
  shouldLog
};
