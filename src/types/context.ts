// Module responsibility: prepared rolling market context produced before architect classification.

import type { ArchitectDataMode, TrendBias, VolatilityState, StructureState, MarketRegime } from "./architect.ts";

export type BreakoutDirection = "up" | "down" | "none";
export type ContextWindowMode = "rolling_full" | "post_switch_segment";

export interface ContextFeatures {
  directionalEfficiency: number;
  emaSeparation: number;
  slopeConsistency: number;
  reversionStretch: number;
  rsiIntensity: number;
  volatilityRisk: number;
  chopiness: number;
  breakoutQuality: number;
  dataQuality: number;
  maturity: number;
  emaBias: number;
  breakoutDirection: BreakoutDirection;
  netMoveRatio: number;
  featureConflict: number;
  breakoutInstability: number;
}

export interface ContextSnapshot {
  symbol: string;
  dataMode: ArchitectDataMode;
  observedAt: number;
  windowStartedAt: number | null;
  windowSpanMs: number;
  sampleSize: number;
  rollingSampleSize: number;
  warmupComplete: boolean;
  rollingMaturity: number;
  windowMode: ContextWindowMode;
  effectiveWindowStartedAt: number | null;
  effectiveWindowSpanMs: number;
  effectiveSampleSize: number;
  effectiveWarmupComplete: boolean;
  lastPublishedRegimeSwitchAt: number | null;
  lastPublishedRegimeSwitchFrom: MarketRegime | null;
  lastPublishedRegimeSwitchTo: MarketRegime | null;
  postSwitchCoveragePct: number | null;
  trendBias: TrendBias;
  volatilityState: VolatilityState;
  structureState: StructureState;
  features: ContextFeatures;
  summary: string;
}
