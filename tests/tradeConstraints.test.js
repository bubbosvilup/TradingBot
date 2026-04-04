"use strict";

const { validateTradeConstraints } = require("../src/utils/tradeConstraints.ts");

function runTradeConstraintsTests() {
  const quantityOnly = validateTradeConstraints({
    minNotionalUsdt: 10,
    minQuantity: 0.001,
    price: 200000,
    quantity: 0.0001
  });
  if (!quantityOnly.belowMinQuantity || quantityOnly.belowMinNotional || quantityOnly.valid) {
    throw new Error(`quantity-only minimum violation should be reported precisely: ${JSON.stringify(quantityOnly)}`);
  }

  const notionalOnly = validateTradeConstraints({
    minNotionalUsdt: 20,
    minQuantity: 0.001,
    price: 5,
    quantity: 1
  });
  if (!notionalOnly.belowMinNotional || notionalOnly.belowMinQuantity || notionalOnly.valid) {
    throw new Error(`notional-only minimum violation should be reported precisely: ${JSON.stringify(notionalOnly)}`);
  }

  const validTrade = validateTradeConstraints({
    minNotionalUsdt: 25,
    minQuantity: 0.001,
    price: 100,
    quantity: 0.5
  });
  if (!validTrade.valid || validTrade.belowMinQuantity || validTrade.belowMinNotional) {
    throw new Error(`valid trade should pass shared constraint validation: ${JSON.stringify(validTrade)}`);
  }

  const bothViolations = validateTradeConstraints({
    minNotionalUsdt: 25,
    minQuantity: 0.001,
    price: 1,
    quantity: 0.0001
  });
  if (!bothViolations.belowMinQuantity || !bothViolations.belowMinNotional || bothViolations.valid) {
    throw new Error(`shared validation should expose both violations when they coexist: ${JSON.stringify(bothViolations)}`);
  }
}

module.exports = {
  runTradeConstraintsTests
};
