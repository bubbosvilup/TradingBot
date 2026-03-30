"use strict";

const fs = require("fs");

function createPersistence(context) {
  const { config, state, logScoped, formatLogNumber } = context;

  function appendTradeLog(message) {
    const timestamp = new Date().toISOString();
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
    resetSession,
    saveStateToDisk
  };
}

module.exports = {
  createPersistence
};
