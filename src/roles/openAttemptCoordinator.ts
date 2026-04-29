import type { BotRuntimeState, RiskOverrides, RiskProfile } from "../types/bot.ts";
import type { PerformanceSnapshot } from "../types/performance.ts";
import type { ExecutionEngineLike, RiskManagerLike, TradeConstraints } from "../types/runtime.ts";
import type { PositionRecord, TradeDirection } from "../types/trade.ts";
import type { TradeConstraintValidationResult } from "../utils/tradeConstraints.ts";

type TradeConstraintsModule = {
  validateTradeConstraints: (params: {
    minNotionalUsdt: number;
    minQuantity: number;
    price: number;
    quantity: number;
  }) => TradeConstraintValidationResult;
};

type TradeSideModule = {
  normalizeTradeSide: (side: unknown) => TradeDirection;
};

const { validateTradeConstraints } = require("../utils/tradeConstraints.ts") as TradeConstraintsModule;
const { normalizeTradeSide } = require("../utils/tradeSide.ts") as TradeSideModule;

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
    edgeDiagnostics?: {
      expectedGrossEdgePctAtEntry?: number | null;
      expectedNetEdgePctAtEntry?: number | null;
      requiredEdgePctAtEntry?: number | null;
      expectedEntryPrice?: number | null;
      expectedExitPrice?: number | null;
      entryArchitectRegime?: string | null;
    };
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
    volatilityRisk?: unknown;
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
    volatilityRisk?: unknown;
  }): PreparedOpenAttempt {
    const sizing = this.riskManager.calculatePositionSize({
      balanceUsdt: params.balanceUsdt,
      confidence: params.confidence,
      latestPrice: params.latestPrice,
      performance: params.performance,
      riskProfile: params.riskProfile,
      riskOverrides: params.riskOverrides,
      state: params.state,
      volatilityRisk: params.volatilityRisk
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
    edgeDiagnostics?: {
      expectedGrossEdgePctAtEntry?: number | null;
      expectedNetEdgePctAtEntry?: number | null;
      requiredEdgePctAtEntry?: number | null;
      expectedEntryPrice?: number | null;
      expectedExitPrice?: number | null;
      entryArchitectRegime?: string | null;
    };
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
      edgeDiagnostics: params.edgeDiagnostics,
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

    const openResult = typeof this.executionEngine.openPosition === "function"
      ? this.executionEngine.openPosition({ ...openParams, side })
      : side === "short"
        ? this.executionEngine.openShort(openParams)
        : this.executionEngine.openLong(openParams);

    if (openResult.ok === false) {
      const blockReason = openResult.error.code === "quantity_below_minimum"
        ? "execution_quantity_below_minimum"
        : openResult.error.code === "notional_below_minimum"
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
    const opened = openResult.position;

    return {
      kind: "opened",
      opened,
      statePatch: {
        // Paper runtime short accounting uses the same full-notional balance reservation as longs.
        // This is intentionally not a realistic leveraged margin model.
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
