// Module responsibility: market-context labels and published architect decisions.

export type MarketRegime = "trend" | "range" | "volatile" | "unclear";
export type TrendBias = "bullish" | "bearish" | "neutral";
export type VolatilityState = "compressed" | "normal" | "expanding";
export type StructureState = "trending" | "choppy" | "reversal-risk" | "breakout-watch";
export type RecommendedFamily = "trend_following" | "mean_reversion" | "no_trade";
export type ArchitectDataMode = "mock" | "live" | "mixed" | "unknown";

export interface RegimeScores {
  trend: number;
  range: number;
  volatile: number;
  unclear: number;
}

export interface FamilyScores {
  trend_following: number;
  mean_reversion: number;
  no_trade: number;
}

export interface ArchitectAssessment {
  symbol: string;
  marketRegime: MarketRegime;
  trendBias: TrendBias;
  confidence: number;
  volatilityState: VolatilityState;
  structureState: StructureState;
  recommendedFamily: RecommendedFamily;
  regimeScores: RegimeScores;
  familyScores: FamilyScores;
  decisionStrength: number;
  absoluteConviction: number;
  signalAgreement: number;
  contextMaturity: number;
  featureConflict: number;
  reasonCodes: string[];
  summary: string;
  dataMode: ArchitectDataMode;
  sufficientData: boolean;
  sampleSize: number;
  updatedAt: number;
}

export interface ArchitectPublisherState {
  symbol: string;
  warmupStartedAt: number | null;
  lastObservedAt: number | null;
  lastPublishedAt: number | null;
  lastRegimeSwitchAt: number | null;
  lastRegimeSwitchFrom: MarketRegime | null;
  lastRegimeSwitchTo: MarketRegime | null;
  nextPublishAt: number | null;
  publishIntervalMs: number;
  ready: boolean;
  hysteresisActive: boolean;
  challengerRegime: MarketRegime | null;
  challengerCount: number;
  challengerRequired: number;
  lastPublishedRegime: MarketRegime | null;
}
