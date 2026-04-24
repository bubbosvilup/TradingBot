export interface PerformanceSnapshot {
  botId: string;
  pnl: number;
  avgTradePnlUsdt: number;
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
  recentNetPnl: number[];
}
