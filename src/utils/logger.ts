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
  if (message === "trade_closed") return "trade_close";
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
  if (message === "bot_manual_resume") {
    return "risk_change";
  }

  if (message === "started" || message === "system_ready" || message === "market_stream_started" || message === "context_ready" || message === "dashboard_ready" || message === "execution_mode_forced_paper" || message === "non_routable_allowed_strategies" || message.startsWith("historical_preload_")) {
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
  if (message === "tick_pipeline_latency" || message === "tick_pipeline_latency_high" || message === "tick_pipeline_latency_invariant_mismatch") {
    return "evaluation";
  }
  if (message === "experiment_summary" || message === "experiment_final_summary" || message === "experiment_report_written") {
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
    minimal: new Set(["startup", "shutdown", "warning", "error"]),
    only_trades: new Set(["trade_open", "trade_close", "warning", "error"]),
    strategy_debug: new Set(["setup", "blocked", "risk_change", "architect_change", "trade_open", "trade_close", "warning", "error"])
  };
  return categorySets[logType].has(category);
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

function omitUndefinedMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedMetadata(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, omitUndefinedMetadata(entryValue)])
  );
}

function createLogger(scope: string, options: { eventSink?: ((event: any) => void) | null; logType?: string | null } = {}) {
  const logType = resolveLogType(options.logType);

  function emit(level: string, message: string, metadata?: Record<string, unknown>) {
    const category = categorizeEvent(scope, level, message);
    if (!shouldLog(logType, category)) {
      return;
    }

    const time = Date.now();

    // Keep full Architect feature/context dumps behind verbose logging.
    let compactMetadata = metadata;
    if (logType !== "verbose" && (message === "architect_published" || message === "architect_changed")) {
      compactMetadata = compactArchitectMetadata(metadata);
    }

    const sanitizedMetadata = omitUndefinedMetadata(compactMetadata) as Record<string, unknown> | undefined;
    const suffix = sanitizedMetadata && Object.keys(sanitizedMetadata).length > 0
      ? ` | ${Object.entries(sanitizedMetadata).map(([key, value]) => `${key}=${String(value)}`).join(" | ")}`
      : "";
    console.log(`[${new Date(time).toISOString()}] ${scope} | ${level} | ${message}${suffix}`);
    if (typeof options.eventSink === "function" && message !== "heartbeat") {
      options.eventSink({
        id: `${time}-${Math.random().toString(16).slice(2, 8)}`,
        category,
        level,
        message,
        metadata: sanitizedMetadata || {},
        scope,
        time
      });
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
