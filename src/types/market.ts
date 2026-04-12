// Module responsibility: market data contracts used across streams and state.

export interface MarketTick {
  symbol: string;
  price: number;
  timestamp: number;
  source: "mock" | "ws" | "rest";
  receivedAt?: number;
  stateUpdatedAt?: number;
}

export type MarketMode = "live";

export interface MarketKline {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openedAt: number;
  closedAt: number;
  timestamp: number;
  isClosed: boolean;
  source: "ws" | "rest";
  receivedAt?: number;
}

export interface PriceSnapshot {
  symbol: string;
  latestPrice: number;
  updatedAt: number;
  history: MarketTick[];
}

export interface MarketStreamConfig {
  mode?: MarketMode;
  provider?: "binance";
  streamType?: "trade" | "aggTrade";
  wsBaseUrl?: string;
  klineIntervals?: string[];
  liveEmitIntervalMs?: number;
}

export interface HistoricalPreloadConfig {
  enabled?: boolean;
  required?: boolean;
  horizonMs?: number;
  maxHorizonMs?: number;
  timeoutMs?: number;
  timeframes?: string[];
  priceTimeframe?: string;
  limit?: number;
}
