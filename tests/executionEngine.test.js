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

function approxEqual(actual, expected, epsilon = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
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

  const injectedFeeEngine = new ExecutionEngine({
    executionMode: "paper",
    feeRate: 0.0019,
    logger: {
      info() {}
    },
    store: new StateStore(),
    userStream: createUserStream(new StateStore())
  });
  if (injectedFeeEngine.feeRate !== 0.0019) {
    throw new Error(`execution engine did not preserve the injected feeRate exactly: ${injectedFeeEngine.feeRate}`);
  }

  let missingFeeRateError = null;
  try {
    new ExecutionEngine({
      executionMode: "paper",
      logger: {
        info() {}
      },
      store: new StateStore(),
      userStream: createUserStream(new StateStore())
    });
  } catch (error) {
    missingFeeRateError = error;
  }
  if (!missingFeeRateError || !String(missingFeeRateError.message || missingFeeRateError).includes("feeRate")) {
    throw new Error(`execution engine should fail loudly when feeRate is missing: ${missingFeeRateError}`);
  }

  let liveModeError = null;
  try {
    new ExecutionEngine({
      executionMode: "live",
      feeRate: 0.001,
      logger: {
        info() {}
      },
      store: new StateStore(),
      userStream: createUserStream(new StateStore())
    });
  } catch (error) {
    liveModeError = error;
  }
  if (!liveModeError || !String(liveModeError.message || liveModeError).includes("paper-only")) {
    throw new Error(`execution engine should reject live mode construction explicitly: ${liveModeError}`);
  }

  try {
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
    const unrealized = engine.calculateUnrealizedEconomics(opened, 102);
    if (!approxEqual(unrealized.grossPnl, 1) || !approxEqual(unrealized.fees, 0.101, 1e-6) || !approxEqual(unrealized.netPnl, 0.899, 1e-6) || unrealized.side !== "long") {
      throw new Error(`execution engine should expose fee-aware unrealized economics for long positions: ${JSON.stringify(unrealized)}`);
    }
    const shortEconomics = engine.calculateUnrealizedEconomics({
      botId: "bot_short_probe",
      confidence: 0.8,
      entryPrice: 100,
      id: "position_short_probe",
      notes: ["probe"],
      openedAt: 1_000,
      quantity: 1,
      side: "short",
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    }, 98);
    if (!approxEqual(shortEconomics.grossPnl, 2) || !approxEqual(shortEconomics.fees, 0.198, 1e-6) || !approxEqual(shortEconomics.netPnl, 1.802, 1e-6) || shortEconomics.side !== "short") {
      throw new Error(`execution engine should stay directionally correct for future short-shaped positions without enabling short execution: ${JSON.stringify(shortEconomics)}`);
    }

    const closed = engine.closePosition({
      botId: "bot_valid",
      price: 102,
      reason: ["take_profit"],
      timestamp: 12_345
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
    if (closed.closedAt !== 12_345) {
      throw new Error(`execution engine should prefer the provided close timestamp over Date.now(): ${JSON.stringify(closed)}`);
    }
    const validCloseLog = logs.find((entry) => entry.event === "position_closed" && entry.metadata.botId === "bot_valid");
    if (!validCloseLog || validCloseLog.metadata.entryPrice !== 100 || validCloseLog.metadata.exitPrice !== 102 || validCloseLog.metadata.grossPnl !== 1 || validCloseLog.metadata.fees !== 0.101 || validCloseLog.metadata.netPnl !== 0.899) {
      throw new Error(`position_closed log should expose structured PnL components: ${JSON.stringify(validCloseLog)}`);
    }

    const pnlCases = [
      {
        botId: "bot_profit_after_fees",
        expected: { fees: 0.201, grossPnl: 1, netPnl: 0.799, outcome: "profit" },
        exitPrice: 101,
        open: { price: 100, quantity: 1 }
      },
      {
        botId: "bot_breakeven_after_fees",
        expected: { fees: 0.2002, grossPnl: 0.20020020020020013, netPnl: 0, outcome: "breakeven" },
        exitPrice: 100.2002002002002,
        open: { price: 100, quantity: 1 }
      },
      {
        botId: "bot_loss_after_fees",
        expected: { fees: 0.199, grossPnl: -1, netPnl: -1.199, outcome: "loss" },
        exitPrice: 99,
        open: { price: 100, quantity: 1 }
      },
      {
        botId: "bot_small_move_fee_dominates",
        expected: { fees: 0.2001, grossPnl: 0.09999999999999432, netPnl: -0.10010000000000569, outcome: "fee_dominated_loss" },
        exitPrice: 100.1,
        open: { price: 100, quantity: 1 }
      }
    ];

    for (const testCase of pnlCases) {
      const openedCase = engine.openLong({
        botId: testCase.botId,
        confidence: 0.8,
        price: testCase.open.price,
        quantity: testCase.open.quantity,
        reason: ["test_order"],
        strategyId: "emaCross",
        symbol: "BTC/USDT"
      });
      if (!openedCase) {
        throw new Error(`execution engine rejected close-math test open for ${testCase.botId}`);
      }

      const closedCase = engine.closePosition({
        botId: testCase.botId,
        price: testCase.exitPrice,
        reason: ["test_close"]
      });
      if (!closedCase) {
        throw new Error(`execution engine rejected close-math test close for ${testCase.botId}`);
      }

      if (!approxEqual(closedCase.pnl, testCase.expected.grossPnl)) {
        throw new Error(`${testCase.botId} grossPnl mismatch: ${closedCase.pnl}`);
      }
      if (!approxEqual(closedCase.fees, testCase.expected.fees, 1e-6)) {
        throw new Error(`${testCase.botId} fees mismatch: ${closedCase.fees}`);
      }
      if (!approxEqual(closedCase.netPnl, testCase.expected.netPnl, 1e-6)) {
        throw new Error(`${testCase.botId} netPnl mismatch: ${closedCase.netPnl}`);
      }
      if (!approxEqual(closedCase.netPnl, closedCase.pnl - closedCase.fees, 1e-9)) {
        throw new Error(`${testCase.botId} netPnl should equal grossPnl - fees`);
      }
      if (testCase.expected.outcome === "profit" && !(closedCase.netPnl > 0)) {
        throw new Error(`${testCase.botId} should remain profitable after fees`);
      }
      if (testCase.expected.outcome === "breakeven" && !approxEqual(closedCase.netPnl, 0, 1e-9)) {
        throw new Error(`${testCase.botId} should be break-even after fees`);
      }
      if ((testCase.expected.outcome === "loss" || testCase.expected.outcome === "fee_dominated_loss") && !(closedCase.netPnl < 0)) {
        throw new Error(`${testCase.botId} should be net-negative after fees`);
      }
      if (testCase.expected.outcome === "fee_dominated_loss" && !(closedCase.pnl > 0 && closedCase.netPnl < 0)) {
        throw new Error(`${testCase.botId} should demonstrate a positive gross move overwhelmed by fees`);
      }
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
  }
}

module.exports = {
  runExecutionEngineTests
};
