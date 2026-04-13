// Module responsibility: trade, order and position models shared by execution and state.

import type { PositionLifecycleEvent, PositionLifecycleState } from "./positionLifecycle.ts";

export type TradeDirection = "long" | "short";

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
  side: TradeDirection;
  quantity: number;
  entryPrice: number;
  openedAt: number;
  confidence: number;
  notes: string[];
  lifecycleState?: PositionLifecycleState;
  lastLifecycleEvent?: PositionLifecycleEvent | null;
  lifecycleUpdatedAt?: number | null;
  lifecycleMode?: "normal" | "managed_recovery";
  managedRecoveryStartedAt?: number | null;
  managedRecoveryDeferredReason?: string | null;
  managedRecoveryExitFloorNetPnlUsdt?: number | null;
  expectedGrossEdgePctAtEntry?: number | null;
  expectedNetEdgePctAtEntry?: number | null;
  requiredEdgePctAtEntry?: number | null;
  expectedEntryPrice?: number | null;
  expectedExitPrice?: number | null;
  entryArchitectRegime?: string | null;
}

export interface ClosedTradeRecord {
  id: string;
  botId: string;
  symbol: string;
  side: TradeDirection;
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
  lifecycleEvent?: PositionLifecycleEvent | null;
  lifecycleState?: PositionLifecycleState | null;
  expectedGrossEdgePctAtEntry?: number | null;
  expectedNetEdgePctAtEntry?: number | null;
  requiredEdgePctAtEntry?: number | null;
  expectedEntryPrice?: number | null;
  expectedExitPrice?: number | null;
  realizedNetPnlPct?: number | null;
  realizedNetPnlUsdt?: number | null;
  edgeErrorPct?: number | null;
  slippageImpactPct?: number | null;
  entryArchitectRegime?: string | null;
}
