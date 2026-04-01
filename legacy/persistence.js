"use strict";

const fs = require("fs");

function createPersistence(context) {
  const { config, state, logScoped, formatLogNumber } = context;
  let backtestReportMtimeMs = null;
  const getNowIso = typeof context.getNowIso === "function" ? context.getNowIso : () => new Date().toISOString();

  function appendTradeLog(message) {
    const timestamp = getNowIso();
    fs.appendFileSync(config.TRADES_LOG_FILE, `[${timestamp}] ${message}\n`);
  }

  function saveStateToDisk() {
    const persistedState = {
      trades: state.trades,
      positions: state.positions,
      usdtBalance: state.usdtBalance
    };
    fs.writeFileSync(config.STATE_FILE, JSON.stringify(persistedState, null, 2));
  }

  function loadStateFromDisk() {
    if (!fs.existsSync(config.STATE_FILE)) {
      return;
    }

    const rawState = fs.readFileSync(config.STATE_FILE, "utf-8");
    const persistedState = JSON.parse(rawState);
    if (typeof persistedState.usdtBalance === "number") {
      state.usdtBalance = persistedState.usdtBalance;
    }
    if (Array.isArray(persistedState.trades)) {
      state.trades = persistedState.trades;
    }
    if (Array.isArray(persistedState.positions)) {
      state.positions = persistedState.positions;
    }
  }

  function clearTradesLog() {
    fs.writeFileSync(config.TRADES_LOG_FILE, "");
  }

  function refreshBacktestReportFromDisk() {
    if (!config.BACKTEST_REPORT_FILE) {
      return state.research?.backtestReport || null;
    }

    if (!fs.existsSync(config.BACKTEST_REPORT_FILE)) {
      backtestReportMtimeMs = null;
      if (state.research) {
        state.research.backtestReport = null;
      }
      return null;
    }

    const stats = fs.statSync(config.BACKTEST_REPORT_FILE);
    if (backtestReportMtimeMs === stats.mtimeMs && state.research?.backtestReport) {
      return state.research.backtestReport;
    }

    const rawReport = fs.readFileSync(config.BACKTEST_REPORT_FILE, "utf-8");
    const parsedReport = JSON.parse(rawReport);
    backtestReportMtimeMs = stats.mtimeMs;
    if (state.research) {
      state.research.backtestReport = parsedReport;
    }
    return parsedReport;
  }

  function saveBacktestReport(report) {
    if (!config.BACKTEST_REPORT_FILE) {
      return;
    }

    fs.writeFileSync(config.BACKTEST_REPORT_FILE, JSON.stringify(report, null, 2));
    backtestReportMtimeMs = null;
    refreshBacktestReportFromDisk();
  }

  function resetSession() {
    state.usdtBalance = config.INITIAL_USDT_BALANCE;
    state.positions = [];
    state.trades = [];
    state.markets = {};
    state.candleData = {};
    state.lastUpdate = null;
    state.bestCandidateSymbol = null;
    state.btcRegime = "risk-on";
    clearTradesLog();
    if (typeof context.onReset === "function") {
      context.onReset();
    }
    if (fs.existsSync(config.STATE_FILE)) {
      fs.unlinkSync(config.STATE_FILE);
    }
    logScoped("SESSION", `reset | usdt_balance=${formatLogNumber(state.usdtBalance, 2)} | position=none`);
  }

  return {
    appendTradeLog,
    clearTradesLog,
    loadStateFromDisk,
    refreshBacktestReportFromDisk,
    resetSession,
    saveBacktestReport,
    saveStateToDisk
  };
}

module.exports = {
  createPersistence
};
