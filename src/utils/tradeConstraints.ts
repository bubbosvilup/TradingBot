// Module responsibility: pure minimum trade-constraint validation shared across entry layers.

export interface TradeConstraintValidationResult {
  belowMinNotional: boolean;
  belowMinQuantity: boolean;
  minNotionalUsdt: number;
  minQuantity: number;
  notionalUsdt: number;
  price: number;
  quantity: number;
  valid: boolean;
}

function validateTradeConstraints(params: {
  minNotionalUsdt: number;
  minQuantity: number;
  price: number;
  quantity: number;
}): TradeConstraintValidationResult {
  const quantity = Math.max(Number(params.quantity) || 0, 0);
  const price = Math.max(Number(params.price) || 0, 0);
  const minQuantity = Math.max(Number(params.minQuantity) || 0, 0);
  const minNotionalUsdt = Math.max(Number(params.minNotionalUsdt) || 0, 0);
  const notionalUsdt = price * quantity;
  const belowMinQuantity = quantity < minQuantity;
  const belowMinNotional = notionalUsdt < minNotionalUsdt;

  return {
    belowMinNotional,
    belowMinQuantity,
    minNotionalUsdt,
    minQuantity,
    notionalUsdt,
    price,
    quantity,
    valid: !belowMinQuantity && !belowMinNotional
  };
}

module.exports = {
  validateTradeConstraints
};
