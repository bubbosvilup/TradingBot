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
  const originalFeeBps = process.env.FEE_BPS;
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

  try {
    process.env.FEE_BPS = "19";
    const envResolvedEngine = new ExecutionEngine({
      executionMode: "paper",
      logger: {
        info() {}
      },
      store: new StateStore(),
      userStream: createUserStream(new StateStore())
    });
    if (envResolvedEngine.feeRate !== 0.0019) {
      throw new Error(`execution engine did not resolve fee rate from env: ${envResolvedEngine.feeRate}`);
    }

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

    const closed = engine.closePosition({
      botId: "bot_valid",
      price: 102,
      reason: ["take_profit"]
    });
    if (!closed) {
      throw new Error("execution engine rejected a valid close");
    }
    if (store.getPosition("bot_valid") !== null) {
      throw new Error("execution engine did not clear persisted position state after close");
    }
    if (store.getClosedTrades("bot_valid").length !== 1) {
      throw new Error(`execution engine should append exactly one closed trade on close, found ${store.getClosedTrades("bot_valid").length}`);
    }
    if (!logs.find((entry) => entry.event === "position_closed" && entry.metadata.botId === "bot_valid")) {
      throw new Error("missing position_closed log for valid close");
    }

    store.setPosition("bot_missing", null);
    const failedClose = engine.closePosition({
      botId: "bot_missing",
      price: 101,
      reason: ["no_position"]
    });
    if (failedClose !== null) {
      throw new Error("execution engine closed a missing position");
    }
    if (store.getPosition("bot_missing") !== null) {
      throw new Error("execution engine should not mutate persisted position state on failed close");
    }
    if (store.getClosedTrades("bot_missing").length !== 0) {
      throw new Error("execution engine should not append a closed trade on failed close");
    }
  } finally {
    if (originalFeeBps === undefined) {
      delete process.env.FEE_BPS;
    } else {
      process.env.FEE_BPS = originalFeeBps;
    }
  }
}

module.exports = {
  runExecutionEngineTests
};
