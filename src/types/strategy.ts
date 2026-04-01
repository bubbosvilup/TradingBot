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
  marketRegime: string;
  hasOpenPosition: boolean;
  unrealizedPnl: number;
  performance: {
    pnl: number;
    winRate: number;
    drawdown: number;
    profitFactor: number;
    tradesCount: number;
    expectancy: number;
  };
  metadata?: Record<string, unknown>;
}

export interface Strategy {
  id: string;
  evaluate(context: MarketContext): StrategyDecision;
}

