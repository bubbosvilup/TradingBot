// Module responsibility: prepared rolling market context produced before architect classification.

import type { ArchitectDataMode, TrendBias, VolatilityState, StructureState } from "./architect.ts";

export type BreakoutDirection = "up" | "down" | "none";

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
  warmupComplete: boolean;
  trendBias: TrendBias;
  volatilityState: VolatilityState;
  structureState: StructureState;
  features: ContextFeatures;
  summary: string;
}
