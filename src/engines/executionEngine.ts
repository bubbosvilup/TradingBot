// Module responsibility: simulated execution for opening and closing positions.

import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "../types/trade.ts";

const { validateTradeConstraints } = require("../utils/tradeConstraints.ts");

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
    this.executionMode = deps.executionMode || "paper";
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
    const entryPrice = Math.max(Number(position?.entryPrice) || 0, 0);
    const exitPrice = Math.max(Number(exitPriceInput) || 0, 0);
    const quantity = Math.max(Number(position?.quantity) || 0, 0);
    const entryNotionalUsdt = entryPrice * quantity;
    const exitNotionalUsdt = exitPrice * quantity;
    const grossPnl = (exitPrice - entryPrice) * quantity;
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
      quantity
    };
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
      side: "buy",
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
      strategyId: params.strategyId,
      symbol: params.symbol
    };

    this.userStream.publishOrderUpdate({ order, position, type: "opened" });
    this.store.setPosition(params.botId, position);
    this.logger.info("position_opened", {
      botId: params.botId,
      executionMode: this.executionMode,
      price: constraints.price.toFixed(4),
      quantity: constraints.quantity.toFixed(6),
      strategy: params.strategyId,
      symbol: params.symbol
    });
    return position;
  }

  closePosition(params: {
    botId: string;
    lifecycleEvent?: any;
    lifecycleState?: any;
    price: number;
    reason: string[];
  }): ClosedTradeRecord | null {
    const position = this.store.getPosition(params.botId);
    if (!position) return null;

    const economics = this.calculateCloseEconomics(position, params.price);
    const closedTrade: ClosedTradeRecord = {
      botId: params.botId,
      closedAt: Date.now(),
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
      side: "long",
      strategyId: position.strategyId,
      symbol: position.symbol
    };

    const order: OrderRecord = {
      botId: params.botId,
      id: this.buildOrderId(params.botId),
      price: economics.exitPrice,
      quantity: economics.quantity,
      reason: params.reason,
      side: "sell",
      strategyId: position.strategyId,
      symbol: position.symbol,
      timestamp: closedTrade.closedAt
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
      quantity: Number(economics.quantity.toFixed(8)),
      symbol: position.symbol
    });
    return closedTrade;
  }
}

module.exports = {
  ExecutionEngine
};
