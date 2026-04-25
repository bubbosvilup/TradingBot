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
    if (rejectedByQuantity.ok !== false || rejectedByQuantity.error.code !== "quantity_below_minimum") {
      throw new Error(`execution engine should reject quantity below minimum with a structured result: ${JSON.stringify(rejectedByQuantity)}`);
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
    if (rejectedByNotional.ok !== false || rejectedByNotional.error.code !== "notional_below_minimum") {
      throw new Error(`execution engine should reject notional below minimum with a structured result: ${JSON.stringify(rejectedByNotional)}`);
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
    if (opened.ok !== true || !opened.position) {
      throw new Error(`execution engine should return ok true and position for a valid open: ${JSON.stringify(opened)}`);
    }
    if (!store.getPosition("bot_valid")) {
      throw new Error("execution engine did not persist a valid opened position");
    }
    if (!logs.find((entry) => entry.event === "position_opened" && entry.metadata.botId === "bot_valid")) {
      throw new Error("missing position_opened log for valid order");
    }
    const unrealized = engine.calculateUnrealizedEconomics(opened.position, 102);
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
    if (closed.ok !== true || !closed.closedTrade) {
      throw new Error(`execution engine should return ok true and closedTrade for a valid close: ${JSON.stringify(closed)}`);
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
    if (closed.closedTrade.closedAt !== 12_345) {
      throw new Error(`execution engine should prefer the provided close timestamp over Date.now(): ${JSON.stringify(closed)}`);
    }
    const validCloseLog = logs.find((entry) => entry.event === "position_closed" && entry.metadata.botId === "bot_valid");
    if (!validCloseLog || validCloseLog.metadata.entryPrice !== 100 || validCloseLog.metadata.exitPrice !== 102 || validCloseLog.metadata.grossPnl !== 1 || validCloseLog.metadata.fees !== 0.101 || validCloseLog.metadata.netPnl !== 0.899) {
      throw new Error(`position_closed log should expose structured PnL components: ${JSON.stringify(validCloseLog)}`);
    }

    const openedWithEdge = engine.openLong({
      botId: "bot_edge_diagnostics",
      confidence: 0.8,
      edgeDiagnostics: {
        entryArchitectRegime: "range",
        expectedEntryPrice: 100,
        expectedExitPrice: 101,
        expectedGrossEdgePctAtEntry: 0.012,
        expectedNetEdgePctAtEntry: 0.01,
        requiredEdgePctAtEntry: 0.002
      },
      price: 100,
      quantity: 1,
      reason: ["edge_entry"],
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    });
    if (openedWithEdge.ok !== true) {
      throw new Error(`execution engine rejected edge diagnostics open: ${JSON.stringify(openedWithEdge)}`);
    }
    if (openedWithEdge.position.expectedNetEdgePctAtEntry !== 0.01 || openedWithEdge.position.entryArchitectRegime !== "range") {
      throw new Error(`opened position should retain entry-time edge diagnostics: ${JSON.stringify(openedWithEdge)}`);
    }
    const closedWithEdge = engine.closePosition({
      botId: "bot_edge_diagnostics",
      price: 101,
      reason: ["edge_exit"],
      timestamp: 12_400
    });
    if (closedWithEdge.ok !== true) {
      throw new Error(`execution engine rejected edge diagnostics close: ${JSON.stringify(closedWithEdge)}`);
    }
    if (closedWithEdge.closedTrade.expectedGrossEdgePctAtEntry !== 0.012
      || closedWithEdge.closedTrade.expectedNetEdgePctAtEntry !== 0.01
      || closedWithEdge.closedTrade.requiredEdgePctAtEntry !== 0.002
      || closedWithEdge.closedTrade.entryArchitectRegime !== "range") {
      throw new Error(`closed trade should carry entry-time edge diagnostics: ${JSON.stringify(closedWithEdge)}`);
    }
    if (!approxEqual(closedWithEdge.closedTrade.realizedNetPnlUsdt, closedWithEdge.closedTrade.netPnl)
      || !approxEqual(closedWithEdge.closedTrade.realizedNetPnlPct, 0.799 / 100)
      || !approxEqual(closedWithEdge.closedTrade.edgeErrorPct, (0.799 / 100) - 0.01)
      || !approxEqual(closedWithEdge.closedTrade.slippageImpactPct, 0)) {
      throw new Error(`closed trade should expose realized edge discrepancy metrics: ${JSON.stringify(closedWithEdge)}`);
    }

    const openedShort = engine.openShort({
      botId: "bot_short_valid",
      confidence: 0.82,
      price: 100,
      quantity: 1,
      reason: ["bearish_cross_confirmed"],
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    });
    if (openedShort.ok !== true || openedShort.position.side !== "short") {
      throw new Error(`execution engine should open first-class short positions: ${JSON.stringify(openedShort)}`);
    }
    const closedShortProfit = engine.closePosition({
      botId: "bot_short_valid",
      price: 98,
      reason: ["cover_profit"],
      timestamp: 12_456
    });
    if (closedShortProfit.ok !== true || closedShortProfit.closedTrade.side !== "short" || !approxEqual(closedShortProfit.closedTrade.pnl, 2) || !approxEqual(closedShortProfit.closedTrade.fees, 0.198, 1e-6) || !approxEqual(closedShortProfit.closedTrade.netPnl, 1.802, 1e-6)) {
      throw new Error(`short close should profit when price falls and charge both fees: ${JSON.stringify(closedShortProfit)}`);
    }
    const shortCloseLog = logs.find((entry) => entry.event === "position_closed" && entry.metadata.botId === "bot_short_valid");
    if (!shortCloseLog || shortCloseLog.metadata.side !== "short" || shortCloseLog.metadata.orderSide !== "buy") {
      throw new Error(`short close log should disambiguate cover order side: ${JSON.stringify(shortCloseLog)}`);
    }

    const openedShortLoss = engine.openShort({
      botId: "bot_short_loss",
      confidence: 0.82,
      price: 100,
      quantity: 1,
      reason: ["bearish_cross_confirmed"],
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    });
    if (openedShortLoss.ok !== true) {
      throw new Error(`execution engine rejected valid short loss test open: ${JSON.stringify(openedShortLoss)}`);
    }
    const closedShortLoss = engine.closePosition({
      botId: "bot_short_loss",
      price: 102,
      reason: ["cover_loss"]
    });
    if (closedShortLoss.ok !== true || closedShortLoss.closedTrade.side !== "short" || !approxEqual(closedShortLoss.closedTrade.pnl, -2) || !approxEqual(closedShortLoss.closedTrade.fees, 0.202, 1e-6) || !approxEqual(closedShortLoss.closedTrade.netPnl, -2.202, 1e-6)) {
      throw new Error(`short close should lose when price rises and charge both fees: ${JSON.stringify(closedShortLoss)}`);
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
      if (openedCase.ok !== true) {
        throw new Error(`execution engine rejected close-math test open for ${testCase.botId}`);
      }

      const closedCase = engine.closePosition({
        botId: testCase.botId,
        price: testCase.exitPrice,
        reason: ["test_close"]
      });
      if (closedCase.ok !== true) {
        throw new Error(`execution engine rejected close-math test close for ${testCase.botId}`);
      }
      const closedTrade = closedCase.closedTrade;

      if (!approxEqual(closedTrade.pnl, testCase.expected.grossPnl)) {
        throw new Error(`${testCase.botId} grossPnl mismatch: ${closedTrade.pnl}`);
      }
      if (!approxEqual(closedTrade.fees, testCase.expected.fees, 1e-6)) {
        throw new Error(`${testCase.botId} fees mismatch: ${closedTrade.fees}`);
      }
      if (!approxEqual(closedTrade.netPnl, testCase.expected.netPnl, 1e-6)) {
        throw new Error(`${testCase.botId} netPnl mismatch: ${closedTrade.netPnl}`);
      }
      if (!approxEqual(closedTrade.netPnl, closedTrade.pnl - closedTrade.fees, 1e-9)) {
        throw new Error(`${testCase.botId} netPnl should equal grossPnl - fees`);
      }
      if (testCase.expected.outcome === "profit" && !(closedTrade.netPnl > 0)) {
        throw new Error(`${testCase.botId} should remain profitable after fees`);
      }
      if (testCase.expected.outcome === "breakeven" && !approxEqual(closedTrade.netPnl, 0, 1e-9)) {
        throw new Error(`${testCase.botId} should be break-even after fees`);
      }
      if ((testCase.expected.outcome === "loss" || testCase.expected.outcome === "fee_dominated_loss") && !(closedTrade.netPnl < 0)) {
        throw new Error(`${testCase.botId} should be net-negative after fees`);
      }
      if (testCase.expected.outcome === "fee_dominated_loss" && !(closedTrade.pnl > 0 && closedTrade.netPnl < 0)) {
        throw new Error(`${testCase.botId} should demonstrate a positive gross move overwhelmed by fees`);
      }
    }

    store.setPosition("bot_missing", null);
    const failedClose = engine.closePosition({
      botId: "bot_missing",
      price: 101,
      reason: ["no_position"]
    });
    if (failedClose.ok !== false || failedClose.error.code !== "position_not_found") {
      throw new Error(`execution engine should reject a missing position with position_not_found: ${JSON.stringify(failedClose)}`);
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
