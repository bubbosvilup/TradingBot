// Module responsibility: coordinate risk-sized open attempts and execution outcomes without owning surrounding orchestration.

import type { BotRuntimeState, RiskOverrides, RiskProfile } from "../types/bot.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { ExecutionEngineLike, RiskManagerLike, TradeConstraints } from "../types/runtime.ts";
import type { PositionRecord, TradeDirection } from "../types/trade.ts";

const { validateTradeConstraints } = require("../utils/tradeConstraints.ts");
const { normalizeTradeSide } = require("../utils/tradeSide.ts");

export interface OpenAttemptCoordinatorParams {
  executionEngine: ExecutionEngineLike;
  riskManager: RiskManagerLike;
}

export interface OpenSizingResult {
  notionalUsdt: number;
  quantity: number;
}

export type PreparedOpenAttempt =
  | {
      kind: "ready";
      sizing: OpenSizingResult;
    }
  | {
      kind: "skipped";
      quantity: number;
      sizing: OpenSizingResult;
      skipReason: "quantity_non_positive";
    };

export type ExecutedOpenAttempt =
  | {
      blockReason: "execution_quantity_below_minimum" | "execution_notional_below_minimum" | "execution_open_rejected" | "execution_short_unsupported";
      executionDiagnostics: {
        minNotionalUsdt: number;
        minQuantity: number;
        notionalUsdt: number;
        quantity: number;
      };
      kind: "execution_rejected";
    }
  | {
      kind: "opened";
      opened: PositionRecord;
      statePatch: Partial<BotRuntimeState>;
    };

export interface OpenAttemptCoordinatorInstance {
  execute(params: {
    availableBalanceUsdt: number;
    botId: string;
    confidence: number;
    entryDebounceTicks: number;
    price: number;
    quantity: number;
    reason: string[];
    recordedAt: number;
    strategyId: string;
    symbol: string;
    side?: TradeDirection;
  }): ExecutedOpenAttempt;
  prepare(params: {
    balanceUsdt: number;
    confidence: number;
    latestPrice: number;
    performance: PerformanceSnapshot | null;
    riskProfile: RiskProfile;
    riskOverrides?: RiskOverrides | null;
    state: BotRuntimeState;
  }): PreparedOpenAttempt;
}

class OpenAttemptCoordinator implements OpenAttemptCoordinatorInstance {
  executionEngine: ExecutionEngineLike;
  riskManager: RiskManagerLike;

  constructor(params: OpenAttemptCoordinatorParams) {
    this.executionEngine = params.executionEngine;
    this.riskManager = params.riskManager;
  }

  prepare(params: {
    balanceUsdt: number;
    confidence: number;
    latestPrice: number;
    performance: PerformanceSnapshot | null;
    riskProfile: RiskProfile;
    riskOverrides?: RiskOverrides | null;
    state: BotRuntimeState;
  }): PreparedOpenAttempt {
    const sizing = this.riskManager.calculatePositionSize({
      balanceUsdt: params.balanceUsdt,
      confidence: params.confidence,
      latestPrice: params.latestPrice,
      performance: params.performance,
      riskProfile: params.riskProfile,
      riskOverrides: params.riskOverrides,
      state: params.state
    });

    if (sizing.quantity <= 0) {
      return {
        kind: "skipped",
        quantity: sizing.quantity,
        sizing,
        skipReason: "quantity_non_positive"
      };
    }

    return {
      kind: "ready",
      sizing
    };
  }

  getExecutionConstraints() {
    return typeof this.executionEngine.getTradeConstraints === "function"
      ? this.executionEngine.getTradeConstraints()
      : this.riskManager.getTradeConstraints();
  }

  execute(params: {
    availableBalanceUsdt: number;
    botId: string;
    confidence: number;
    entryDebounceTicks: number;
    price: number;
    quantity: number;
    reason: string[];
    recordedAt: number;
    strategyId: string;
    symbol: string;
    side?: TradeDirection;
  }): ExecutedOpenAttempt {
    const side = normalizeTradeSide(params.side);
    const openParams = {
      botId: params.botId,
      confidence: params.confidence,
      price: params.price,
      quantity: params.quantity,
      reason: [...params.reason, `entry_confirmed_${params.entryDebounceTicks}ticks`],
      strategyId: params.strategyId,
      symbol: params.symbol
    };
    const executionConstraints = this.getExecutionConstraints();
    const validation = validateTradeConstraints({
      minNotionalUsdt: executionConstraints.minNotionalUsdt,
      minQuantity: executionConstraints.minQuantity,
      price: params.price,
      quantity: params.quantity
    });

    if (side === "short" && typeof this.executionEngine.openPosition !== "function" && typeof this.executionEngine.openShort !== "function") {
      return {
        blockReason: "execution_short_unsupported",
        executionDiagnostics: {
          minNotionalUsdt: Number(validation.minNotionalUsdt.toFixed(4)),
          minQuantity: Number(validation.minQuantity.toFixed(8)),
          notionalUsdt: Number(validation.notionalUsdt.toFixed(4)),
          quantity: Number(validation.quantity.toFixed(8))
        },
        kind: "execution_rejected"
      };
    }

    const opened = typeof this.executionEngine.openPosition === "function"
      ? this.executionEngine.openPosition({ ...openParams, side })
      : side === "short"
        ? this.executionEngine.openShort(openParams)
        : this.executionEngine.openLong(openParams);

    if (!opened) {
      const blockReason = validation.quantity < executionConstraints.minQuantity
        ? "execution_quantity_below_minimum"
        : validation.notionalUsdt < executionConstraints.minNotionalUsdt
          ? "execution_notional_below_minimum"
          : "execution_open_rejected";
      return {
        blockReason,
        executionDiagnostics: {
          minNotionalUsdt: Number(validation.minNotionalUsdt.toFixed(4)),
          minQuantity: Number(validation.minQuantity.toFixed(8)),
          notionalUsdt: Number(validation.notionalUsdt.toFixed(4)),
          quantity: Number(validation.quantity.toFixed(8))
        },
        kind: "execution_rejected"
      };
    }

    return {
      kind: "opened",
      opened,
      statePatch: {
        availableBalanceUsdt: Math.max(0, params.availableBalanceUsdt - (opened.quantity * opened.entryPrice)),
        entrySignalStreak: 0,
        exitSignalStreak: 0,
        lastExecutionAt: opened.openedAt,
        lastTradeAt: params.recordedAt
      }
    };
  }
}

module.exports = {
  OpenAttemptCoordinator
};
