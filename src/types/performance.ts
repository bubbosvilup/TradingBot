// Module responsibility: performance aggregates used by monitoring and strategy switching.

export interface PerformanceSnapshot {
  botId: string;
  pnl: number;
  winRate: number;
  drawdown: number;
  profitFactor: number;
  tradesCount: number;
  grossProfit: number;
  grossLoss: number;
  wins: number;
  losses: number;
  peakEquity: number;
  currentEquity: number;
  expectancy: number;
  recentNetPnl: number[];
}

