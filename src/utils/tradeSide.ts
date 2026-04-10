// Module responsibility: normalize trade side semantics and directional price math.

import type { TradeDirection } from "../types/trade.ts";

function normalizeTradeSide(side: unknown): TradeDirection {
  return side === "short" ? "short" : "long";
}

function calculateDirectionalGrossPnl(params: {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  side?: unknown;
}) {
  const side = normalizeTradeSide(params.side);
  const grossPnl = side === "short"
    ? (params.entryPrice - params.exitPrice) * params.quantity
    : (params.exitPrice - params.entryPrice) * params.quantity;
  return {
    grossPnl,
    side
  };
}

module.exports = {
  calculateDirectionalGrossPnl,
  normalizeTradeSide
};
