"use strict";

const { OpenAttemptCoordinator } = require("../src/roles/openAttemptCoordinator.ts");

function createCoordinator(overrides = {}) {
  const executionEngine = {
    getTradeConstraints() {
      return {
        minNotionalUsdt: 10,
        minQuantity: 0.001
      };
    },
    openLong() {
      return {
        ok: false,
        error: {
          kind: "execution",
          code: "execution_open_rejected",
          message: "fixture rejected",
          recoverable: true
        }
      };
    },
    ...overrides.executionEngine
  };
  const riskManager = {
    calculatePositionSize() {
      return {
        notionalUsdt: 100,
        quantity: 1
      };
    },
    getTradeConstraints() {
      return {
        minNotionalUsdt: 10,
        minQuantity: 0.001
      };
    },
    ...overrides.riskManager
  };

  return new OpenAttemptCoordinator({
    executionEngine,
    riskManager
  });
}

async function runOpenAttemptCoordinatorTests() {
  const sizeSkipCoordinator = createCoordinator({
    riskManager: {
      calculatePositionSize() {
        return {
          notionalUsdt: 0,
          quantity: 0
        };
      }
    }
  });
  const sizeSkip = sizeSkipCoordinator.prepare({
    balanceUsdt: 1000,
    confidence: 0.9,
    latestPrice: 100,
    performance: {
      avgTradePnlUsdt: 0,
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      tradesCount: 0,
      winRate: 0
    },
    riskProfile: "medium",
    state: {
      entrySignalStreak: 1
    }
  });
  if (sizeSkip.kind !== "skipped" || sizeSkip.skipReason !== "quantity_non_positive") {
    throw new Error(`non-positive sizing should remain a skipped open attempt: ${JSON.stringify(sizeSkip)}`);
  }

  const quantityRejectCoordinator = createCoordinator({
    executionEngine: {
      openLong() {
        return {
          ok: false,
          error: {
            kind: "execution",
            code: "quantity_below_minimum",
            message: "fixture rejected quantity",
            recoverable: true
          }
        };
      }
    }
  });
  const quantityReject = quantityRejectCoordinator.execute({
    availableBalanceUsdt: 1000,
    botId: "bot_test",
    confidence: 0.9,
    entryDebounceTicks: 2,
    price: 100,
    quantity: 0.0001,
    reason: ["buy_signal"],
    recordedAt: 2_000,
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (quantityReject.kind !== "execution_rejected" || quantityReject.blockReason !== "execution_quantity_below_minimum") {
    throw new Error(`sub-minimum quantity should preserve execution_quantity_below_minimum: ${JSON.stringify(quantityReject)}`);
  }

  const notionalRejectCoordinator = createCoordinator({
    executionEngine: {
      openLong() {
        return {
          ok: false,
          error: {
            kind: "execution",
            code: "notional_below_minimum",
            message: "fixture rejected notional",
            recoverable: true
          }
        };
      },
      getTradeConstraints() {
        return {
          minNotionalUsdt: 20,
          minQuantity: 0.001
        };
      }
    }
  });
  const notionalReject = notionalRejectCoordinator.execute({
    availableBalanceUsdt: 1000,
    botId: "bot_test",
    confidence: 0.9,
    entryDebounceTicks: 2,
    price: 5,
    quantity: 1,
    reason: ["buy_signal"],
    recordedAt: 2_000,
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (notionalReject.kind !== "execution_rejected" || notionalReject.blockReason !== "execution_notional_below_minimum") {
    throw new Error(`sub-minimum notional should preserve execution_notional_below_minimum: ${JSON.stringify(notionalReject)}`);
  }

  const openedCoordinator = createCoordinator({
    executionEngine: {
      openLong(params) {
        return {
          ok: true,
          position: {
            botId: params.botId,
            confidence: params.confidence,
            entryPrice: params.price,
            id: "pos-1",
            notes: ["entry"],
            openedAt: 3_000,
            quantity: params.quantity,
            strategyId: params.strategyId,
            symbol: params.symbol
          }
        };
      }
    }
  });
  const openedResult = openedCoordinator.execute({
    availableBalanceUsdt: 1000,
    botId: "bot_test",
    confidence: 0.93,
    entryDebounceTicks: 2,
    price: 100,
    quantity: 2,
    reason: ["buy_signal"],
    recordedAt: 3_500,
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (openedResult.kind !== "opened") {
    throw new Error(`successful execution should return an opened result: ${JSON.stringify(openedResult)}`);
  }
  if (openedResult.statePatch.availableBalanceUsdt !== 800 || openedResult.statePatch.entrySignalStreak !== 0 || openedResult.statePatch.lastExecutionAt !== 3_000 || openedResult.statePatch.lastTradeAt !== 3_500) {
    throw new Error(`successful execution should preserve the existing post-open state reset/update: ${JSON.stringify(openedResult.statePatch)}`);
  }

  let openedShortParams = null;
  const openedShortCoordinator = createCoordinator({
    executionEngine: {
      openPosition(params) {
        openedShortParams = params;
        return {
          ok: true,
          position: {
            botId: params.botId,
            confidence: params.confidence,
            entryPrice: params.price,
            id: "pos-short-1",
            notes: ["entry"],
            openedAt: 4_000,
            quantity: params.quantity,
            side: params.side,
            strategyId: params.strategyId,
            symbol: params.symbol
          }
        };
      }
    }
  });
  const openedShortResult = openedShortCoordinator.execute({
    availableBalanceUsdt: 1000,
    botId: "bot_test",
    confidence: 0.91,
    edgeDiagnostics: {
      entryArchitectRegime: "range",
      expectedEntryPrice: 100,
      expectedExitPrice: null,
      expectedGrossEdgePctAtEntry: 0.012,
      expectedNetEdgePctAtEntry: 0.01,
      requiredEdgePctAtEntry: 0.002
    },
    entryDebounceTicks: 2,
    price: 100,
    quantity: 2,
    reason: ["bearish_cross_confirmed"],
    recordedAt: 4_500,
    side: "short",
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (openedShortResult.kind !== "opened" || openedShortResult.opened.side !== "short" || openedShortParams.side !== "short") {
    throw new Error(`open attempt coordinator should pass short side into execution: ${JSON.stringify({ openedShortParams, openedShortResult })}`);
  }
  if (openedShortParams.edgeDiagnostics?.expectedNetEdgePctAtEntry !== 0.01 || openedShortParams.edgeDiagnostics?.entryArchitectRegime !== "range") {
    throw new Error(`open attempt coordinator should pass entry edge diagnostics into execution: ${JSON.stringify(openedShortParams)}`);
  }

  let fallbackLongCalled = false;
  const unsupportedShortCoordinator = createCoordinator({
    executionEngine: {
      openLong() {
        fallbackLongCalled = true;
        return {
          ok: true,
          position: {
            botId: "bot_test",
            entryPrice: 100,
            id: "wrong-long",
            openedAt: 5_000,
            quantity: 1,
            strategyId: "emaCross",
            symbol: "BTC/USDT"
          }
        };
      }
    }
  });
  const unsupportedShortResult = unsupportedShortCoordinator.execute({
    availableBalanceUsdt: 1000,
    botId: "bot_test",
    confidence: 0.91,
    entryDebounceTicks: 2,
    price: 100,
    quantity: 2,
    reason: ["bearish_cross_confirmed"],
    recordedAt: 5_500,
    side: "short",
    strategyId: "emaCross",
    symbol: "BTC/USDT"
  });
  if (fallbackLongCalled || unsupportedShortResult.kind !== "execution_rejected" || unsupportedShortResult.blockReason !== "execution_short_unsupported") {
    throw new Error(`unsupported short execution should reject explicitly instead of falling back to long: ${JSON.stringify({ fallbackLongCalled, unsupportedShortResult })}`);
  }
}

module.exports = {
  runOpenAttemptCoordinatorTests
};
