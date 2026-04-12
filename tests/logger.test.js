"use strict";

const { createLogger } = require("../src/utils/logger.ts");

function runLoggerTests() {
  const originalConsoleLog = console.log;
  const lines = [];
  console.log = (line) => {
    lines.push(String(line));
  };

  try {
    if (require("../src/utils/logger.ts").resolveLogType(null) !== "minimal") {
      throw new Error("default log type should be minimal for operator-facing runtime logs");
    }

    const verboseLogger = createLogger("test:verbose", { logType: "verbose" });
    verboseLogger.info("heartbeat");
    verboseLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "entry_evaluated", { outcome: "blocked" });
    if (lines.length !== 2) {
      throw new Error(`verbose mode should keep current output behavior, found ${lines.length} lines`);
    }

    lines.length = 0;
    const minimalLogger = createLogger("test:minimal", { logType: "minimal" });
    minimalLogger.info("system_ready", { bots: 2 });
    minimalLogger.info("architect_publish_refreshed", { regime: "trend" });
    minimalLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "entry_evaluated", { outcome: "blocked" });
    minimalLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "entry_blocked", { reason: "architect_stale" });
    minimalLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BLOCK_CHANGE", { blockReason: "loss_streak_limit" });
    minimalLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BUY", { latestPrice: 100 });
    if (lines.length !== 4 || lines.some((line) => line.includes("entry_evaluated"))) {
      throw new Error(`minimal mode should suppress evaluation spam and keep essential events: ${JSON.stringify(lines)}`);
    }

    lines.length = 0;
    const compactArchitectLogger = createLogger("test:architect", { logType: "minimal" });
    compactArchitectLogger.info("architect_published", {
      candidateMarketRegime: "range",
      candidateRecommendedFamily: "mean_reversion",
      contextBreakoutQuality: 0.7,
      contextDataQuality: 0.92,
      publishedDecisionStrength: 0.2,
      publishedMarketRegime: "range",
      publishedMtfAgreement: 0.8,
      publishedMtfDominantFrame: "medium",
      publishedMtfEnabled: true,
      publishedMtfInstability: 0.2,
      publishedMtfMetaRegime: "range",
      publishedMtfSufficientFrames: true,
      publishedRecommendedFamily: "mean_reversion",
      symbol: "BTC/USDT",
      updatedAt: 123
    });
    compactArchitectLogger.info("architect_changed", {
      candidateMarketRegime: "trend",
      candidateRecommendedFamily: "trend_following",
      contextDataQuality: 0.88,
      previousRegime: "range",
      publishedMarketRegime: "trend",
      publishedRecommendedFamily: "trend_following",
      symbol: "BTC/USDT",
      via: "switch_delta"
    });
    if (lines.length !== 2
      || !lines[0].includes("publishedMarketRegime=range")
      || !lines[0].includes("publishedMtfDominantFrame=medium")
      || lines[0].includes("contextDataQuality")
      || lines[0].includes("contextBreakoutQuality")) {
      throw new Error(`minimal architect publish should keep compact MTF state and drop feature dumps: ${JSON.stringify(lines)}`);
    }
    if (!lines[1].includes("architect_changed") || lines[1].includes("contextDataQuality")) {
      throw new Error(`minimal architect changed should also drop feature dumps: ${JSON.stringify(lines)}`);
    }

    lines.length = 0;
    const eventSinkEvents = [];
    const undefinedLogger = createLogger("test:sanitize", {
      eventSink: (event) => eventSinkEvents.push(event),
      logType: "verbose"
    });
    undefinedLogger.info("architect_published", {
      nested: {
        kept: "value",
        omitted: undefined
      },
      publishedMarketRegime: "range",
      symbol: "BTC/USDT",
      undefinedField: undefined
    });
    if (lines[0].includes("undefinedField") || lines[0].includes("undefined") || eventSinkEvents[0].metadata.undefinedField !== undefined || eventSinkEvents[0].metadata.nested.omitted !== undefined) {
      throw new Error(`logger should omit undefined metadata fields from console and event sink: ${JSON.stringify({ lines, eventSinkEvents })}`);
    }

    lines.length = 0;
    const blockDedupeLogger = createLogger("test:block-dedupe", { logType: "minimal" });
    blockDedupeLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BLOCK_CHANGE", { blockReason: "architect_stale" });
    blockDedupeLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BLOCK_CHANGE", { blockReason: "target_distance_exceeds_short_horizon" });
    if (lines.length !== 2) {
      throw new Error(`minimal BLOCK_CHANGE dedupe should not suppress distinct block reasons: ${JSON.stringify(lines)}`);
    }

    lines.length = 0;
    const onlyTradesLogger = createLogger("test:trades", { logType: "only_trades" });
    onlyTradesLogger.info("system_ready", { bots: 2 });
    onlyTradesLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BUY", { latestPrice: 100 });
    onlyTradesLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "SHORT", { latestPrice: 101 });
    onlyTradesLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "SELL", { netPnl: 1.2 });
    onlyTradesLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "COVER", { netPnl: 1.1 });
    onlyTradesLogger.warn("ws_error", { channel: "ticker" });
    if (lines.length !== 5 || lines.some((line) => line.includes("system_ready"))) {
      throw new Error(`only_trades mode should keep only trade and warning/error events: ${JSON.stringify(lines)}`);
    }

    lines.length = 0;
    const strategyDebugLogger = createLogger("test:debug", { logType: "strategy_debug" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "SETUP", { decisionAction: "buy" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BLOCK_CHANGE", { blockReason: "loss_streak_limit" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "RISK_CHANGE", { cooldownReason: "loss_cooldown" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "ARCHITECT_CHANGE", { nextStrategy: "rsiReversion" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "rsi_exit_deferred", { exitEvent: "rsi_exit_deferred" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "failed_rsi_exit", { closeClassification: "failed_rsi_exit" });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "BUY", { latestPrice: 100 });
    strategyDebugLogger.bot({ id: "bot_a", symbol: "BTC/USDT" }, "SELL", { netPnl: 0.8 });
    strategyDebugLogger.info("architect_publish_refreshed", { regime: "trend" });
    strategyDebugLogger.info("heartbeat", { bots: 1 });
    strategyDebugLogger.info("ws_connected", { channel: "ticker" });
    if (lines.length !== 8 || lines.some((line) => line.includes("heartbeat")) || lines.some((line) => line.includes("ws_connected")) || lines.some((line) => line.includes("architect_publish_refreshed"))) {
      throw new Error(`strategy_debug mode should keep only strategy-tuning events: ${JSON.stringify(lines)}`);
    }
    lines.length = 0;
    const { categorizeEvent } = require("../src/utils/logger.ts");
    if (categorizeEvent("orchestrator:market", "INFO", "tick_pipeline_latency") !== "evaluation") {
      throw new Error("tick_pipeline_latency should be categorized as evaluation, not other");
    }
    if (categorizeEvent("orchestrator:market", "WARN", "tick_pipeline_latency_high") !== "warning") {
      throw new Error("tick_pipeline_latency_high at WARN level should be categorized as warning");
    }
  } finally {
    console.log = originalConsoleLog;
  }
}

module.exports = {
  runLoggerTests
};
