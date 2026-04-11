"use strict";

const { createLogger } = require("../src/utils/logger.ts");

function runLoggerTests() {
  const originalConsoleLog = console.log;
  const lines = [];
  console.log = (line) => {
    lines.push(String(line));
  };

  try {
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
