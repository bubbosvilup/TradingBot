// Module responsibility: modern adapter boundary around the preserved legacy backtest modules.

const { compareStrategyModes: legacyCompareStrategyModes } = require("../../legacy/backtest");
const { runBacktestJob: legacyRunBacktestJob } = require("../../legacy/backtest_runner");

class BacktestEngine {
  compareStrategyModesImpl: (params: any) => any;
  runBacktestJobImpl: (params: any) => Promise<any>;

  constructor(deps: {
    compareStrategyModes?: ((params: any) => any) | null;
    runBacktestJob?: ((params: any) => Promise<any>) | null;
  } = {}) {
    this.compareStrategyModesImpl = typeof deps.compareStrategyModes === "function"
      ? deps.compareStrategyModes
      : legacyCompareStrategyModes;
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

  compareStrategyModes(params: any) {
    return this.compareStrategyModesImpl(params);
  }

  async runJob(params: any) {
    return this.runBacktestJobImpl(params);
  }

  async run(params: any = {}) {
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
