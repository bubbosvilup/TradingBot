import type { TradeDirection } from "../types/trade.ts";

function normalizeTradeSide(side: unknown): TradeDirection {
  return side === "short" ? "short" : "long";
}

function isEntryAction(action: unknown) {
  return action === "buy" || action === "sell";
}

function inferEntrySideFromAction(action: unknown): TradeDirection | null {
  if (action === "buy") return "long";
  if (action === "sell") return "short";
  return null;
}

function normalizeEntrySide(side: unknown, action?: unknown): TradeDirection {
  return side === "short" || side === "long"
    ? side
    : normalizeTradeSide(inferEntrySideFromAction(action));
}

function getEntryOrderSide(side: unknown): "buy" | "sell" {
  return normalizeTradeSide(side) === "short" ? "sell" : "buy";
}

function getCloseOrderSide(side: unknown): "buy" | "sell" {
  return normalizeTradeSide(side) === "short" ? "buy" : "sell";
}

function isExitActionForSide(side: unknown, action: unknown) {
  return action === getCloseOrderSide(side);
}

function applyDirectionalOffset(basePrice: number, offsetPct: number, side?: unknown) {
  const normalizedBasePrice = Number(basePrice);
  const normalizedOffsetPct = Number(offsetPct);
  if (!Number.isFinite(normalizedBasePrice) || !Number.isFinite(normalizedOffsetPct)) {
    return NaN;
  }
  return normalizeTradeSide(side) === "short"
    ? normalizedBasePrice * (1 - normalizedOffsetPct)
    : normalizedBasePrice * (1 + normalizedOffsetPct);
}

function calculateTargetDistancePct(params: {
  latestPrice: number;
  targetPrice: number;
  side?: unknown;
}) {
  const latestPrice = Math.max(Number(params.latestPrice) || 0, 1e-8);
  const targetPrice = Number(params.targetPrice);
  if (!Number.isFinite(targetPrice)) return 0;
  return normalizeTradeSide(params.side) === "short"
    ? Math.max(0, latestPrice - targetPrice) / latestPrice
    : Math.max(0, targetPrice - latestPrice) / latestPrice;
}

function calculateAdverseMovePct(params: {
  entryPrice: number;
  markPrice: number;
  side?: unknown;
}) {
  const entryPrice = Math.max(Number(params.entryPrice) || 0, 0);
  const markPrice = Math.max(Number(params.markPrice) || 0, 0);
  if (entryPrice <= 0) return 0;
  return normalizeTradeSide(params.side) === "short"
    ? Math.max(0, markPrice - entryPrice) / entryPrice
    : Math.max(0, entryPrice - markPrice) / entryPrice;
}

function isTargetHit(side: unknown, latestPrice: number, targetPrice: number) {
  const price = Number(latestPrice);
  const target = Number(targetPrice);
  if (!Number.isFinite(price) || !Number.isFinite(target)) return false;
  return normalizeTradeSide(side) === "short"
    ? price <= target
    : price >= target;
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
  applyDirectionalOffset,
  calculateAdverseMovePct,
  calculateDirectionalGrossPnl,
  calculateTargetDistancePct,
  getCloseOrderSide,
  getEntryOrderSide,
  inferEntrySideFromAction,
  isEntryAction,
  isExitActionForSide,
  isTargetHit,
  normalizeEntrySide,
  normalizeTradeSide
};
