// Module responsibility: trade, order and position models shared by execution and state.

export interface OrderRecord {
  id: string;
  botId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  strategyId: string;
  reason: string[];
  timestamp: number;
}

export interface PositionRecord {
  id: string;
  botId: string;
  symbol: string;
  strategyId: string;
  quantity: number;
  entryPrice: number;
  openedAt: number;
  confidence: number;
  notes: string[];
}

export interface ClosedTradeRecord {
  id: string;
  botId: string;
  symbol: string;
  side: "long";
  strategyId: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  openedAt: number;
  closedAt: number;
  pnl: number;
  fees: number;
  netPnl: number;
  entryReason: string[];
  exitReason: string[];
  reason: string[];
}
