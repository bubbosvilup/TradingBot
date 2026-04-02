"use strict";

const { ExecutionEngine } = require("../src/engines/executionEngine.ts");
const { StateStore } = require("../src/core/stateStore.ts");
const { UserStream } = require("../src/streams/userStream.ts");

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

function runExecutionEngineTests() {
  const store = new StateStore();
  const logs = [];
  const engine = new ExecutionEngine({
    executionMode: "paper",
    feeRate: 0.001,
    logger: {
      info(event, metadata) {
        logs.push({ event, metadata });
      }
    },
    minTradeNotionalUsdt: 25,
    minTradeQuantity: 1e-6,
    store,
    userStream: createUserStream(store)
  });

  const rejectedByQuantity = engine.openLong({
    botId: "bot_qty",
    confidence: 0.8,
    price: 100,
    quantity: 1e-7,
    reason: ["test_order"],
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (rejectedByQuantity !== null) {
    throw new Error("execution engine accepted quantity below minimum");
  }
  if (store.getPosition("bot_qty")) {
    throw new Error("execution engine should not create a position when quantity is below minimum");
  }
  if (!logs.find((entry) => entry.event === "position_open_rejected" && entry.metadata.reason === "quantity_below_minimum")) {
    throw new Error("missing quantity_below_minimum rejection log");
  }

  const rejectedByNotional = engine.openLong({
    botId: "bot_notional",
    confidence: 0.8,
    price: 100,
    quantity: 0.1,
    reason: ["test_order"],
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (rejectedByNotional !== null) {
    throw new Error("execution engine accepted notional below minimum");
  }
  if (store.getPosition("bot_notional")) {
    throw new Error("execution engine should not create a position when notional is below minimum");
  }
  if (!logs.find((entry) => entry.event === "position_open_rejected" && entry.metadata.reason === "notional_below_minimum")) {
    throw new Error("missing notional_below_minimum rejection log");
  }

  const opened = engine.openLong({
    botId: "bot_valid",
    confidence: 0.8,
    price: 100,
    quantity: 0.5,
    reason: ["test_order"],
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (!opened) {
    throw new Error("execution engine rejected a valid open");
  }
  if (!store.getPosition("bot_valid")) {
    throw new Error("execution engine did not persist a valid opened position");
  }
  if (!logs.find((entry) => entry.event === "position_opened" && entry.metadata.botId === "bot_valid")) {
    throw new Error("missing position_opened log for valid order");
  }
}

module.exports = {
  runExecutionEngineTests
};
