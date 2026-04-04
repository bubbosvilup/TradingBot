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
      return null;
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
        return null;
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
        return null;
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
          botId: params.botId,
          confidence: params.confidence,
          entryPrice: params.price,
          id: "pos-1",
          notes: ["entry"],
          openedAt: 3_000,
          quantity: params.quantity,
          strategyId: params.strategyId,
          symbol: params.symbol
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
}

module.exports = {
  runOpenAttemptCoordinatorTests
};
