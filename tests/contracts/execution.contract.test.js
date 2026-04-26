"use strict";

const { ExecutionEngine } = require("../../src/engines/executionEngine.ts");
const { StateStore } = require("../../src/core/stateStore.ts");
const { UserStream } = require("../../src/streams/userStream.ts");
const { derivePositionState } = require("../../src/domain/stateSelectors.ts");

function createUserStream(store) {
  return new UserStream({
    logger: {
      info() {},
      warn() {},
      error() {}
    },
    store,
    wsManager: {
      publish() {},
      subscribe() {
        return () => {};
      }
    }
  });
}

function createEngine() {
  const store = new StateStore();
  return {
    engine: new ExecutionEngine({
      executionMode: "paper",
      feeRate: 0.001,
      logger: {
        info() {}
      },
      minTradeNotionalUsdt: 25,
      minTradeQuantity: 1e-6,
      store,
      userStream: createUserStream(store)
    }),
    store
  };
}

function runExecutionContractTests() {
  {
    const { engine, store } = createEngine();
    const opened = engine.openLong({
      botId: "bot_contract_open",
      confidence: 0.8,
      price: 100,
      quantity: 0.5,
      reason: ["contract_open"],
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    });

    if (opened.ok !== true || !opened.position) {
      throw new Error(`valid open should return ok:true with a position: ${JSON.stringify(opened)}`);
    }
    const persistedPosition = store.getPosition("bot_contract_open");
    if (!persistedPosition || persistedPosition.id !== opened.position.id) {
      throw new Error(`valid open should create exactly one observable open position: ${JSON.stringify(persistedPosition)}`);
    }
    if (derivePositionState(persistedPosition) !== "open_active") {
      throw new Error(`valid open should derive open_active state: ${JSON.stringify(persistedPosition)}`);
    }
    if (store.getClosedTrades("bot_contract_open").length !== 0) {
      throw new Error("valid open should not record a closed trade");
    }
  }

  {
    const { engine, store } = createEngine();
    const rejected = engine.openLong({
      botId: "bot_contract_rejected",
      confidence: 0.8,
      price: 100,
      quantity: 1e-7,
      reason: ["contract_rejected"],
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    });

    if (rejected.ok !== false || rejected.error?.kind !== "execution" || rejected.error?.code !== "quantity_below_minimum") {
      throw new Error(`rejected open should return structured execution error: ${JSON.stringify(rejected)}`);
    }
    if (store.getPosition("bot_contract_rejected") !== null || store.getClosedTrades("bot_contract_rejected").length !== 0) {
      throw new Error("rejected open should not mutate position or closed-trade state");
    }
  }

  {
    const { engine, store } = createEngine();
    const opened = engine.openLong({
      botId: "bot_contract_close",
      confidence: 0.8,
      price: 100,
      quantity: 1,
      reason: ["contract_open"],
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    });
    if (opened.ok !== true) {
      throw new Error(`valid close setup failed to open: ${JSON.stringify(opened)}`);
    }

    const closed = engine.closePosition({
      botId: "bot_contract_close",
      price: 102,
      reason: ["contract_close"],
      timestamp: 12_345
    });

    if (closed.ok !== true || !closed.closedTrade) {
      throw new Error(`valid close should return ok:true with a closed trade: ${JSON.stringify(closed)}`);
    }
    if (store.getPosition("bot_contract_close") !== null || derivePositionState(store.getPosition("bot_contract_close")) !== "flat") {
      throw new Error("valid close should clear the open position");
    }
    const closedTrades = store.getClosedTrades("bot_contract_close");
    if (closedTrades.length !== 1 || closedTrades[0].id !== closed.closedTrade.id) {
      throw new Error(`valid close should record exactly one closed trade through StateStore: ${JSON.stringify(closedTrades)}`);
    }
  }

  {
    const { engine, store } = createEngine();
    const beforeSnapshot = JSON.stringify(store.getSystemSnapshot());
    const closed = engine.closePosition({
      botId: "bot_contract_missing",
      price: 102,
      reason: ["contract_missing_close"],
      timestamp: 12_345
    });
    const afterSnapshot = JSON.stringify(store.getSystemSnapshot());

    if (closed.ok !== false || closed.error?.kind !== "execution" || closed.error?.code !== "position_not_found") {
      throw new Error(`missing-position close should return stable execution error: ${JSON.stringify(closed)}`);
    }
    if (afterSnapshot !== beforeSnapshot) {
      throw new Error("missing-position close should not mutate StateStore snapshot");
    }
  }
}

module.exports = {
  runExecutionContractTests
};
