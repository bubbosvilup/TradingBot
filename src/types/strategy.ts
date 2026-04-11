// Module responsibility: shared strategy contracts used by bots, registry and engines.

import type { TradeDirection } from "./trade.ts";

export interface StrategyDecision {
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string[];
  side?: TradeDirection | null;
}

export interface IndicatorSnapshot {
  emaFast: number | null;
  emaSlow: number | null;
  emaBaseline: number | null;
  rsi: number | null;
  momentum: number | null;
  volatility: number | null;
}

export interface MarketContext {
  botId: string;
  symbol: string;
  strategyId: string;
  timestamp: number;
  latestPrice: number;
  prices: number[];
  indicators: IndicatorSnapshot;
  localRegimeHint: string;
  hasOpenPosition: boolean;
  positionSide?: TradeDirection | null;
  unrealizedPnl: number;
  performance: {
    pnl: number;
    winRate: number;
    drawdown: number;
    profitFactor: number;
    tradesCount: number;
    avgTradePnlUsdt: number;
  };
  metadata?: Record<string, unknown>;
}

export interface StrategyEntryEdgeInputs {
  captureGapPct: number;
  downsideMeanReversionGapPct: number;
  emaFast: number;
  emaGapPct: number;
  emaSlow: number;
  exitTarget: number;
  favorableMeanReversionGapPct?: number;
  latestPrice: number;
  meanReversionGapPct: number;
  momentum: number;
  momentumEdgePct: number;
  side?: TradeDirection;
}

export interface EntryEconomicsEstimate {
  estimatedEntryFeePct: number;
  estimatedExitFeePct: number;
  estimatedRoundTripFeesUsdt: number;
  estimatedSlippagePct: number;
  expectedGrossEdgePct: number;
  expectedGrossEdgeUsdt: number;
  expectedNetEdgePct: number;
  maxTargetDistancePctForShortHorizon?: number | null;
  minExpectedNetEdgePct: number;
  notionalUsdt: number;
  profitSafetyBufferPct: number;
  requiredEdgePct: number;
  side?: TradeDirection;
  targetDistancePct?: number;
}

export interface Strategy {
  config?: Record<string, unknown>;
  id: string;
  evaluate(context: MarketContext): StrategyDecision;
  estimateExpectedGrossEdgePct?(inputs: StrategyEntryEdgeInputs): number;
}
