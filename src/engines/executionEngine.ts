// Module responsibility: simulated execution for opening and closing positions.

import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "../types/trade.ts";

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
    feeRate?: number;
    executionMode?: string;
    minTradeNotionalUsdt?: number;
    minTradeQuantity?: number;
  }) {
    this.store = deps.store;
    this.userStream = deps.userStream;
    this.logger = deps.logger;
    this.feeRate = Math.max(deps.feeRate || 0.001, 0);
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

  openLong(params: {
    botId: string;
    symbol: string;
    strategyId: string;
    price: number;
    quantity: number;
    confidence: number;
    reason: string[];
  }): PositionRecord | null {
    const quantity = Math.max(Number(params.quantity) || 0, 0);
    const price = Math.max(Number(params.price) || 0, 0);
    const notionalUsdt = price * quantity;
    const rejectReason = quantity < this.minTradeQuantity
      ? "quantity_below_minimum"
      : notionalUsdt < this.minTradeNotionalUsdt
        ? "notional_below_minimum"
        : null;

    if (rejectReason) {
      this.logger.info("position_open_rejected", {
        botId: params.botId,
        executionMode: this.executionMode,
        minNotionalUsdt: Number(this.minTradeNotionalUsdt.toFixed(4)),
        minQuantity: Number(this.minTradeQuantity.toFixed(8)),
        notionalUsdt: Number(notionalUsdt.toFixed(4)),
        price: price.toFixed(4),
        quantity: quantity.toFixed(8),
        reason: rejectReason,
        strategy: params.strategyId,
        symbol: params.symbol
      });
      return null;
    }

    const order: OrderRecord = {
      botId: params.botId,
      id: this.buildOrderId(params.botId),
      price,
      quantity,
      reason: params.reason,
      side: "buy",
      strategyId: params.strategyId,
      symbol: params.symbol,
      timestamp: Date.now()
    };

    const position: PositionRecord = {
      botId: params.botId,
      confidence: params.confidence,
      entryPrice: price,
      id: order.id,
      notes: params.reason,
      openedAt: order.timestamp,
      quantity,
      strategyId: params.strategyId,
      symbol: params.symbol
    };

    this.userStream.publishOrderUpdate({ order, position, type: "opened" });
    this.logger.info("position_opened", {
      botId: params.botId,
      executionMode: this.executionMode,
      price: price.toFixed(4),
      quantity: quantity.toFixed(6),
      strategy: params.strategyId,
      symbol: params.symbol
    });
    return position;
  }

  closePosition(params: { botId: string; price: number; reason: string[] }): ClosedTradeRecord | null {
    const position = this.store.getPosition(params.botId);
    if (!position) return null;

    const grossPnl = (params.price - position.entryPrice) * position.quantity;
    const fees = ((position.entryPrice * position.quantity) + (params.price * position.quantity)) * this.feeRate;
    const netPnl = grossPnl - fees;
    const closedTrade: ClosedTradeRecord = {
      botId: params.botId,
      closedAt: Date.now(),
      entryReason: Array.isArray(position.notes) ? [...position.notes] : [],
      entryPrice: position.entryPrice,
      exitReason: [...params.reason],
      exitPrice: params.price,
      fees,
      id: position.id,
      netPnl,
      openedAt: position.openedAt,
      pnl: grossPnl,
      quantity: position.quantity,
      reason: params.reason,
      side: "long",
      strategyId: position.strategyId,
      symbol: position.symbol
    };

    const order: OrderRecord = {
      botId: params.botId,
      id: this.buildOrderId(params.botId),
      price: params.price,
      quantity: position.quantity,
      reason: params.reason,
      side: "sell",
      strategyId: position.strategyId,
      symbol: position.symbol,
      timestamp: closedTrade.closedAt
    };

    this.userStream.publishOrderUpdate({ order, position: null, trade: closedTrade, type: "closed" });
    this.logger.info("position_closed", {
      botId: params.botId,
      executionMode: this.executionMode,
      netPnl: netPnl.toFixed(4),
      price: params.price.toFixed(4),
      symbol: position.symbol
    });
    return closedTrade;
  }
}

module.exports = {
  ExecutionEngine
};
