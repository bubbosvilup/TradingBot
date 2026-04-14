// Module responsibility: modern adapter boundary around the preserved legacy backtest modules.

const { compareStrategyModes: legacyCompareStrategyModes } = require("../../legacy/backtest");
const { printBacktestReport: legacyPrintBacktestReport, runBacktestJob: legacyRunBacktestJob } = require("../../legacy/backtest_runner");

class BacktestEngine {
  constructor(deps = {}) {
    this.compareStrategyModesImpl = typeof deps.compareStrategyModes === "function"
      ? deps.compareStrategyModes
      : legacyCompareStrategyModes;
    this.printBacktestReportImpl = typeof deps.printBacktestReport === "function"
      ? deps.printBacktestReport
      : legacyPrintBacktestReport;
    this.runBacktestJobImpl = typeof deps.runBacktestJob === "function"
      ? deps.runBacktestJob
      : legacyRunBacktestJob;
  }

  getCapabilities() {
    return {
      compareStrategyModes: true,
      runBacktestJob: true,
      source: "legacy_adapter",
      status: "bridged_not_fully_migrated"
    };
  }

  compareStrategyModes(params) {
    return this.compareStrategyModesImpl(params);
  }

  async runJob(params) {
    return this.runBacktestJobImpl(params);
  }

  printReport(report) {
    return this.printBacktestReportImpl(report);
  }

  async run(params = {}) {
    if (params?.symbolHistories) {
      return this.compareStrategyModes(params);
    }
    if (params?.baseConfig) {
      return this.runJob(params);
    }
    return {
      capabilities: this.getCapabilities(),
      message: "Backtest engine bridges modern callers to the preserved legacy backtest modules while replay migration is still in progress.",
      ok: true
    };
  }
}

module.exports = {
  BacktestEngine
};
