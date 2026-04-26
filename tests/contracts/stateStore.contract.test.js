"use strict";

const { StateStore } = require("../../src/core/stateStore.ts");
const {
  assertValidBotLifecycleView,
  deriveBotLifecycleView
} = require("../../src/domain/stateSelectors.ts");

function createBotConfig(overrides = {}) {
  return {
    enabled: true,
    id: "bot_state_contract",
    initialBalanceUsdt: 1000,
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "BTC/USDT",
    ...overrides
  };
}

function runStateStoreContractTests() {
  {
    const store = new StateStore();
    store.registerBot(createBotConfig());
    store.updatePrice({
      price: 100,
      source: "mock",
      symbol: "BTC/USDT",
      timestamp: 1_000
    });

    const beforeSnapshot = JSON.stringify(store.getSystemSnapshot());
    store.getBotState("bot_state_contract");
    store.getPosition("bot_state_contract");
    store.getClosedTrades("bot_state_contract");
    store.getMarketDataFreshness("BTC/USDT", { now: 1_000 });
    store.getSymbolStateSnapshot({ now: 1_000 });
    const afterSnapshot = JSON.stringify(store.getSystemSnapshot());

    if (afterSnapshot !== beforeSnapshot) {
      throw new Error("StateStore read-like methods should not mutate observable system state");
    }
  }

  {
    const store = new StateStore();
    store.registerBot(createBotConfig({ id: "bot_pause_contract", symbol: "ETH/USDT" }));
    store.updateBotState("bot_pause_contract", {
      pausedReason: null,
      status: "paused"
    });

    const sanitizedState = store.getBotState("bot_pause_contract");
    if (sanitizedState?.status === "paused" || sanitizedState?.pausedReason !== null) {
      throw new Error(`paused state without pausedReason should be sanitized: ${JSON.stringify(sanitizedState)}`);
    }
    assertValidBotLifecycleView(sanitizedState);

    store.updateBotState("bot_pause_contract", {
      pausedReason: "manual_pause",
      status: "paused"
    });
    const pausedState = store.getBotState("bot_pause_contract");
    if (deriveBotLifecycleView(pausedState) !== "paused" || pausedState.pausedReason !== "manual_pause") {
      throw new Error(`valid paused state should preserve pausedReason: ${JSON.stringify(pausedState)}`);
    }
    assertValidBotLifecycleView(pausedState);

    store.updateBotState("bot_pause_contract", {
      pausedReason: "manual_pause",
      status: "running"
    });
    const runningState = store.getBotState("bot_pause_contract");
    if (deriveBotLifecycleView(runningState) !== "running" || runningState.pausedReason !== null) {
      throw new Error(`non-paused state should clear pausedReason: ${JSON.stringify(runningState)}`);
    }
  }

  {
    const store = new StateStore();
    store.registerBot(createBotConfig({ id: "bot_reregister_contract", symbol: "SOL/USDT" }));
    store.updateBotState("bot_reregister_contract", {
      lossStreak: 2,
      pausedReason: "manual_pause",
      realizedPnl: -12.5,
      status: "paused"
    });
    store.registerBot(createBotConfig({ id: "bot_reregister_contract", symbol: "SOL/USDT" }));

    const state = store.getBotState("bot_reregister_contract");
    if (state?.status !== "paused"
      || state?.pausedReason !== "manual_pause"
      || state?.lossStreak !== 2
      || state?.realizedPnl !== -12.5) {
      throw new Error(`re-register should preserve valid runtime fields: ${JSON.stringify(state)}`);
    }
  }

  {
    const originalDateNow = Date.now;
    try {
      Date.now = () => 1_000;
      const store = new StateStore({ symbolStateRetentionMs: 60_000 });
      store.registerBot(createBotConfig({ id: "bot_symbol_contract", symbol: "XRP/USDT" }));
      store.updatePrice({
        price: 0.5,
        source: "mock",
        symbol: "XRP/USDT",
        timestamp: 1_000
      });

      const eviction = store.evictStaleSymbolState({ now: 61_000 });
      if (eviction.evictedSymbols.length !== 0 || !eviction.protectedSymbols.includes("XRP/USDT")) {
        throw new Error(`symbol eviction should protect registered bot symbols: ${JSON.stringify(eviction)}`);
      }
      if (!store.prices.has("XRP/USDT")) {
        throw new Error("symbol eviction should preserve protected symbol market state");
      }
    } finally {
      Date.now = originalDateNow;
    }
  }
}

module.exports = {
  runStateStoreContractTests
};
