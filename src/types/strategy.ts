// Module responsibility: shared strategy contracts used by bots, registry and engines.

export interface StrategyDecision {
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string[];
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
  latestPrice: number;
  meanReversionGapPct: number;
  momentum: number;
  momentumEdgePct: number;
}

export interface EntryEconomicsEstimate {
  estimatedEntryFeePct: number;
  estimatedExitFeePct: number;
  estimatedRoundTripFeesUsdt: number;
  estimatedSlippagePct: number;
  expectedGrossEdgePct: number;
  expectedGrossEdgeUsdt: number;
  expectedNetEdgePct: number;
  minExpectedNetEdgePct: number;
  notionalUsdt: number;
  profitSafetyBufferPct: number;
  requiredEdgePct: number;
}

export interface Strategy {
  config?: Record<string, unknown>;
  id: string;
  evaluate(context: MarketContext): StrategyDecision;
  estimateExpectedGrossEdgePct?(inputs: StrategyEntryEdgeInputs): number;
}
