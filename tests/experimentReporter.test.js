"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ExperimentReporter } = require("../src/core/experimentReporter.ts");
const { StateStore } = require("../src/core/stateStore.ts");

function runExperimentReporterTests() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tradingbot-experiment-reporter-"));
  const originalReportDir = process.env.EXPERIMENT_REPORT_DIR;
  const originalDisableDesktop = process.env.EXPERIMENT_REPORT_DISABLE_DESKTOP;
  const originalConsoleError = console.error;
  const stderrLines = [];
  console.error = (...args) => {
    stderrLines.push(args.join(" "));
  };

  process.env.EXPERIMENT_REPORT_DIR = tempRoot;
  process.env.EXPERIMENT_REPORT_DISABLE_DESKTOP = "1";

  try {
    const store = new StateStore();
    store.registerBot({
      enabled: true,
      id: "bot_report",
      initialBalanceUsdt: 1000,
      riskProfile: "medium",
      strategy: "emaCross",
      symbol: "BTC/USDT"
    });
    store.botStates.set("bot_report", {
      ...store.getBotState("bot_report"),
      entryBlockedCount: 1,
      entryEvaluationsCount: 3,
      managedRecoveryConsecutiveCount: 0,
      entryOpenedCount: 1,
      entrySkippedCount: 1
    });
    store.closedTrades.set("bot_report", [
      {
        botId: "bot_report",
        closedAt: 2_000,
        entryPrice: 100,
        entryReason: ["entry_signal"],
        exitPrice: 101,
        exitReason: ["take_profit_hit"],
        fees: 0.2,
        id: "trade_report",
        lifecycleEvent: "PRICE_TARGET_HIT",
        lifecycleMode: "normal",
        lifecycleState: "CLOSED",
        netPnl: 0.8,
        openedAt: 1_000,
        pnl: 1,
        quantity: 1,
        reason: ["round_trip"],
        side: "long",
        strategyId: "emaCross",
        symbol: "BTC/USDT"
      },
      {
        botId: "bot_report",
        closedAt: 4_000,
        entryPrice: 100,
        entryReason: ["entry_signal"],
        exitPrice: 99.9,
        exitReason: ["managed_recovery_breaker_exit"],
        fees: 0.2,
        id: "trade_report_breaker",
        lifecycleEvent: "MANAGED_RECOVERY_BREAKER_HIT",
        lifecycleMode: "normal",
        lifecycleState: "CLOSED",
        netPnl: -0.3,
        openedAt: 3_000,
        pnl: -0.1,
        quantity: 1,
        reason: ["managed_recovery_breaker_exit"],
        side: "long",
        strategyId: "rsiReversion",
        symbol: "BTC/USDT"
      }
    ]);
    store.events.push(
      { message: "rsi_exit_deferred" },
      { message: "rsi_exit_deferred" },
      { message: "rsi_exit_deferred" }
    );

    const reporter = new ExperimentReporter({
      config: {
        enabled: true,
        label: "ctrlc_report",
        summaryIntervalMs: 10_000
      },
      logger: {
        info() {}
      },
      loggingMode: "silent",
      store
    });

    reporter.writeCheckpoint();
    const latestPath = path.join(tempRoot, "tradingbot_experiment_ctrlc_report_latest.txt");
    if (!fs.existsSync(latestPath)) {
      throw new Error(`checkpoint report should be written to the configured report dir: ${latestPath}`);
    }
    const latestContent = fs.readFileSync(latestPath, "utf8");
    if (!latestContent.includes("label=ctrlc_report") || !latestContent.includes("closedTradesCount=2")) {
      throw new Error(`checkpoint report content should include summary metrics: ${latestContent}`);
    }
    if (!latestContent.includes("managedRecoveryEntries=1") || !latestContent.includes("managedRecoveryClosedOutcomes=1") || !latestContent.includes("managedRecoveryOpenDeferredEvents=2") || !latestContent.includes("managedRecoveryUnpairedDeferredEvents=2") || !latestContent.includes("exitManagedRecoveryBreaker=1")) {
      throw new Error(`checkpoint report should conservatively reconcile managed recovery entry/exit counts: ${latestContent}`);
    }

    reporter.logFinalSummary();
    if (stderrLines.some((line) => line.includes("Report written to"))) {
      throw new Error(`successful experiment report writes should not use stderr: ${JSON.stringify(stderrLines)}`);
    }
    const files = fs.readdirSync(tempRoot).filter((entry) =>
      entry === "tradingbot_experiment_ctrlc_report_latest.txt"
      || /^tradingbot_experiment_ctrlc_report_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(entry)
    );
    if (files.length < 2) {
      throw new Error(`final report should preserve latest and timestamped files: ${JSON.stringify(files)}`);
    }

    const quarantinedReporter = new ExperimentReporter({
      config: {
        enabled: true,
        label: "allow_small_loss_floor05",
        summaryIntervalMs: 10_000
      },
      logger: {
        info() {}
      },
      loggingMode: "silent",
      store
    });
    if (quarantinedReporter.isEnabled() !== false || quarantinedReporter.getLabel() !== "quarantined_allow_small_loss_floor05") {
      throw new Error("toxic allow_small_loss_floor05 experiment label should be quarantined out of active use");
    }
  } finally {
    console.error = originalConsoleError;
    if (originalReportDir === undefined) {
      delete process.env.EXPERIMENT_REPORT_DIR;
    } else {
      process.env.EXPERIMENT_REPORT_DIR = originalReportDir;
    }
    if (originalDisableDesktop === undefined) {
      delete process.env.EXPERIMENT_REPORT_DISABLE_DESKTOP;
    } else {
      process.env.EXPERIMENT_REPORT_DISABLE_DESKTOP = originalDisableDesktop;
    }
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
}

module.exports = {
  runExperimentReporterTests
};
