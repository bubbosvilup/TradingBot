// Module responsibility: incremental PnL, win rate, drawdown and expectancy tracking per bot.

import type { PerformanceSnapshot } from "../types/performance.ts";
import type { ClosedTradeRecord } from "../types/trade.ts";

class PerformanceMonitor {
  update(snapshot: PerformanceSnapshot, trade: ClosedTradeRecord): PerformanceSnapshot {
    const tradesCount = snapshot.tradesCount + 1;
    const wins = snapshot.wins + (trade.netPnl > 0 ? 1 : 0);
    const losses = snapshot.losses + (trade.netPnl <= 0 ? 1 : 0);
    const grossProfit = snapshot.grossProfit + (trade.netPnl > 0 ? trade.netPnl : 0);
    const grossLoss = snapshot.grossLoss + (trade.netPnl < 0 ? Math.abs(trade.netPnl) : 0);
    const pnl = snapshot.pnl + trade.netPnl;
    const currentEquity = snapshot.currentEquity + trade.netPnl;
    const peakEquity = Math.max(snapshot.peakEquity, currentEquity);
    const drawdown = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
    const recentNetPnl = [...snapshot.recentNetPnl, trade.netPnl].slice(-20);

    return {
      ...snapshot,
      currentEquity,
      drawdown,
      expectancy: tradesCount > 0 ? pnl / tradesCount : 0,
      grossLoss,
      grossProfit,
      losses,
      peakEquity,
      pnl,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit,
      recentNetPnl,
      tradesCount,
      winRate: tradesCount > 0 ? (wins / tradesCount) * 100 : 0,
      wins
    };
  }
}

module.exports = {
  PerformanceMonitor
};

