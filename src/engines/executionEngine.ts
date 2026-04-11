// Module responsibility: simulated execution for opening and closing positions.

import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "../types/trade.ts";

const { validateTradeConstraints } = require("../utils/tradeConstraints.ts");
const {
  calculateDirectionalGrossPnl,
  getCloseOrderSide,
  getEntryOrderSide,
  normalizeTradeSide
} = require("../utils/tradeSide.ts");

class ExecutionEngine {
  store: any;
  userStream: any;
  logger: any;
  feeRate: number;
  executionMode: string;
  minTradeNotionalUsdt: number;
  minTradeQuantity: number;

  constructor(deps: {
    store: any;
    userStream: any;
    logger: any;
    feeRate: number;
    executionMode?: string;
    minTradeNotionalUsdt?: number;
    minTradeQuantity?: number;
  }) {
    const resolvedFeeRate = Number(deps.feeRate);
    if (deps.feeRate === undefined || deps.feeRate === null || !Number.isFinite(resolvedFeeRate) || resolvedFeeRate < 0) {
      throw new Error("ExecutionEngine requires a finite non-negative feeRate dependency");
    }
    this.store = deps.store;
    this.userStream = deps.userStream;
    this.logger = deps.logger;
    this.feeRate = resolvedFeeRate;
    this.executionMode = String(deps.executionMode || "paper").toLowerCase();
    if (this.executionMode !== "paper") {
      throw new Error(`ExecutionEngine does not support executionMode=${this.executionMode}; active runtime is paper-only until future live-readiness work is completed`);
    }
    this.minTradeNotionalUsdt = Math.max(Number(deps.minTradeNotionalUsdt) || 25, 0);
    this.minTradeQuantity = Math.max(Number(deps.minTradeQuantity) || 1e-6, 0);
  }

  buildOrderId(botId: string) {
    return `${botId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  getTradeConstraints() {
    return {
      minNotionalUsdt: this.minTradeNotionalUsdt,
      minQuantity: this.minTradeQuantity
    };
  }

  calculateCloseEconomics(position: PositionRecord, exitPriceInput: number) {
    const side = normalizeTradeSide(position?.side);
    const entryPrice = Math.max(Number(position?.entryPrice) || 0, 0);
    const exitPrice = Math.max(Number(exitPriceInput) || 0, 0);
    const quantity = Math.max(Number(position?.quantity) || 0, 0);
    const entryNotionalUsdt = entryPrice * quantity;
    const exitNotionalUsdt = exitPrice * quantity;
    const grossPnl = calculateDirectionalGrossPnl({
      entryPrice,
      exitPrice,
      quantity,
      side
    }).grossPnl;
    const fees = (entryNotionalUsdt + exitNotionalUsdt) * this.feeRate;
    const netPnl = grossPnl - fees;

    return {
      entryNotionalUsdt,
      entryPrice,
      exitNotionalUsdt,
      exitPrice,
      fees,
      grossPnl,
      netPnl,
      quantity,
      side
    };
  }

  calculateUnrealizedEconomics(position: PositionRecord, markPriceInput: number) {
    const side = normalizeTradeSide(position?.side);
    const entryPrice = Math.max(Number(position?.entryPrice) || 0, 0);
    const markPrice = Math.max(Number(markPriceInput) || 0, 0);
    const quantity = Math.max(Number(position?.quantity) || 0, 0);
    const entryNotionalUsdt = entryPrice * quantity;
    const markNotionalUsdt = markPrice * quantity;
    const grossPnl = calculateDirectionalGrossPnl({
      entryPrice,
      exitPrice: markPrice,
      quantity,
      side
    }).grossPnl;
    const fees = (entryNotionalUsdt + markNotionalUsdt) * this.feeRate;
    const netPnl = grossPnl - fees;

    return {
      entryNotionalUsdt,
      entryPrice,
      fees,
      grossPnl,
      markNotionalUsdt,
      markPrice,
      netPnl,
      quantity,
      side
    };
  }

  openPosition(params: {
    botId: string;
    symbol: string;
    strategyId: string;
    price: number;
    quantity: number;
    confidence: number;
    reason: string[];
    side?: "long" | "short";
  }): PositionRecord | null {
    const side = normalizeTradeSide(params.side);
    const constraints = validateTradeConstraints({
      minNotionalUsdt: this.minTradeNotionalUsdt,
      minQuantity: this.minTradeQuantity,
      price: params.price,
      quantity: params.quantity
    });
    const rejectReason = constraints.quantity < this.minTradeQuantity
      ? "quantity_below_minimum"
      : constraints.notionalUsdt < this.minTradeNotionalUsdt
        ? "notional_below_minimum"
        : null;

    if (rejectReason) {
      this.logger.info("position_open_rejected", {
        botId: params.botId,
        executionMode: this.executionMode,
        minNotionalUsdt: Number(constraints.minNotionalUsdt.toFixed(4)),
        minQuantity: Number(constraints.minQuantity.toFixed(8)),
        notionalUsdt: Number(constraints.notionalUsdt.toFixed(4)),
        price: constraints.price.toFixed(4),
        quantity: constraints.quantity.toFixed(8),
        reason: rejectReason,
        side,
        strategy: params.strategyId,
        symbol: params.symbol
      });
      return null;
    }

    const order: OrderRecord = {
      botId: params.botId,
      id: this.buildOrderId(params.botId),
      price: constraints.price,
      quantity: constraints.quantity,
      reason: params.reason,
      side: getEntryOrderSide(side),
      strategyId: params.strategyId,
      symbol: params.symbol,
      timestamp: Date.now()
    };

    const position: PositionRecord = {
      botId: params.botId,
      confidence: params.confidence,
      entryPrice: constraints.price,
      id: order.id,
      lastLifecycleEvent: null,
      lifecycleState: "ACTIVE",
      lifecycleUpdatedAt: order.timestamp,
      lifecycleMode: "normal",
      managedRecoveryDeferredReason: null,
      managedRecoveryExitFloorNetPnlUsdt: null,
      managedRecoveryStartedAt: null,
      notes: params.reason,
      openedAt: order.timestamp,
      quantity: constraints.quantity,
      side,
      strategyId: params.strategyId,
      symbol: params.symbol
    };

    this.userStream.publishOrderUpdate({ order, position, type: "opened" });
    this.store.setPosition(params.botId, position);
    this.logger.info("position_opened", {
      botId: params.botId,
      executionMode: this.executionMode,
      orderSide: order.side,
      price: constraints.price.toFixed(4),
      quantity: constraints.quantity.toFixed(6),
      side,
      strategy: params.strategyId,
      symbol: params.symbol
    });
    return position;
  }

  openLong(params: {
    botId: string;
    symbol: string;
    strategyId: string;
    price: number;
    quantity: number;
    confidence: number;
    reason: string[];
  }): PositionRecord | null {
    return this.openPosition({ ...params, side: "long" });
  }

  openShort(params: {
    botId: string;
    symbol: string;
    strategyId: string;
    price: number;
    quantity: number;
    confidence: number;
    reason: string[];
  }): PositionRecord | null {
    return this.openPosition({ ...params, side: "short" });
  }

  closePosition(params: {
    botId: string;
    lifecycleEvent?: any;
    lifecycleState?: any;
    price: number;
    reason: string[];
    timestamp?: number;
  }): ClosedTradeRecord | null {
    const position = this.store.getPosition(params.botId);
    if (!position) return null;

    const economics = this.calculateCloseEconomics(position, params.price);
    const closedAt = Number.isFinite(Number(params.timestamp))
      ? Number(params.timestamp)
      : Date.now();
    const closedTrade: ClosedTradeRecord = {
      botId: params.botId,
      closedAt,
      entryReason: Array.isArray(position.notes) ? [...position.notes] : [],
      entryPrice: economics.entryPrice,
      exitReason: [...params.reason],
      exitPrice: economics.exitPrice,
      fees: economics.fees,
      id: position.id,
      lifecycleEvent: params.lifecycleEvent || null,
      lifecycleState: params.lifecycleState || null,
      netPnl: economics.netPnl,
      openedAt: position.openedAt,
      pnl: economics.grossPnl,
      quantity: economics.quantity,
      reason: params.reason,
      side: economics.side,
      strategyId: position.strategyId,
      symbol: position.symbol
    };

    const order: OrderRecord = {
      botId: params.botId,
      id: this.buildOrderId(params.botId),
      price: economics.exitPrice,
      quantity: economics.quantity,
      reason: params.reason,
      side: getCloseOrderSide(economics.side),
      strategyId: position.strategyId,
      symbol: position.symbol,
      timestamp: closedAt
    };

    this.userStream.publishOrderUpdate({ order, position: null, trade: closedTrade, type: "closed" });
    this.store.setPosition(params.botId, null);
    this.logger.info("position_closed", {
      botId: params.botId,
      executionMode: this.executionMode,
      entryNotionalUsdt: Number(economics.entryNotionalUsdt.toFixed(4)),
      entryPrice: Number(economics.entryPrice.toFixed(4)),
      exitNotionalUsdt: Number(economics.exitNotionalUsdt.toFixed(4)),
      exitPrice: Number(economics.exitPrice.toFixed(4)),
      feeRate: Number(this.feeRate.toFixed(6)),
      fees: Number(economics.fees.toFixed(4)),
      grossPnl: Number(economics.grossPnl.toFixed(4)),
      netPnl: Number(economics.netPnl.toFixed(4)),
      orderSide: order.side,
      quantity: Number(economics.quantity.toFixed(8)),
      side: economics.side,
      symbol: position.symbol
    });
    return closedTrade;
  }
}

module.exports = {
  ExecutionEngine
};
