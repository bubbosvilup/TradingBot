const { compareStrategyModes: legacyCompareStrategyModes } = require("../../legacy/backtest");
const { printBacktestReport: legacyPrintBacktestReport, runBacktestJob: legacyRunBacktestJob } = require("../../legacy/backtest_runner");

type BacktestParams = {
  baseConfig?: unknown;
  symbolHistories?: unknown;
  [key: string]: unknown;
};

type BacktestEngineDeps = {
  compareStrategyModes?: (params: BacktestParams) => unknown;
  printBacktestReport?: (report: unknown) => unknown;
  runBacktestJob?: (params: BacktestParams) => unknown | Promise<unknown>;
};

class BacktestEngine {
  private compareStrategyModesImpl: (params: BacktestParams) => unknown;
  private printBacktestReportImpl: (report: unknown) => unknown;
  private runBacktestJobImpl: (params: BacktestParams) => unknown | Promise<unknown>;

  constructor(deps: BacktestEngineDeps = {}) {
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

  compareStrategyModes(params: BacktestParams) {
    return this.compareStrategyModesImpl(params);
  }

  async runJob(params: BacktestParams) {
    return this.runBacktestJobImpl(params);
  }

  printReport(report: unknown) {
    return this.printBacktestReportImpl(report);
  }

  async run(params: BacktestParams = {}) {
    if (params?.symbolHistories) {
      return this.compareStrategyModes(params);
    }
    if (params?.baseConfig) {
      return this.runJob(params);
    }
    return {
      capabilities: this.getCapabilities(),
      message: "Backtest engine bridges modern callers to preserved legacy replay modules. Paper runtime supports shorts, but current replay/backtest is still legacy-backed, long-only, and not valid for short-capable strategy validation.",
      ok: true
    };
  }
}

module.exports = {
  BacktestEngine
};
