// Module responsibility: typed multi-timeframe snapshot structures.

import type { MarketRegime, TrendBias, VolatilityState, StructureState } from "./architect.ts";

/** Canonical timeframe identifiers for MTF analysis. */
export type MtfTimeframeId = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** Internal horizon buckets consumed by downstream policy roles. */
export type MtfHorizonFrameId = "short" | "medium" | "long";

/** Raw market timeframe plus its internal horizon bucket. */
export interface MtfFrameConfig {
  id: MtfTimeframeId;
  horizonFrame: MtfHorizonFrameId;
  windowMs: number;
}

/** Runtime switch plus raw-timeframe to internal-horizon frame mapping. */
export interface MtfRuntimeConfig {
  enabled?: boolean;
  frames?: MtfFrameConfig[];
  /** Architect-level usability gate. Default 0.5; separate from the stricter resolver-level 0.25 threshold. */
  instabilityThreshold?: number;
}

/** Per-timeframe normalized snapshot fed into the MTF aggregator. */
export interface MtfFrameSnapshot {
  timeframe: MtfTimeframeId;
  horizonFrame: MtfHorizonFrameId;
  regime: MarketRegime;
  trendBias: TrendBias;
  volatilityState: VolatilityState;
  structureState: StructureState;
  confidence: number;
  ready: boolean;
  observedAt: number;
}

/** Aggregated multi-timeframe snapshot produced by the MTF aggregator. */
export interface MtfSnapshot {
  /** Consensus regime across ready frames, or "unclear" when insufficient agreement. */
  metaRegime: MarketRegime;
  /** Timeframe with highest confidence among frames aligned with metaRegime, or null. */
  dominantTimeframe: MtfTimeframeId | null;
  /** Internal horizon bucket for the dominant timeframe, or null. */
  dominantFrame: MtfHorizonFrameId | null;
  /** 0–1 score reflecting cross-frame disagreement. Higher means more conflict. */
  instability: number;
  /** Number of ready frames that contributed to the aggregation. */
  readyFrameCount: number;
  /** Per-frame inputs preserved for diagnostics. */
  frames: MtfFrameSnapshot[];
  /** Timestamp of aggregation. */
  aggregatedAt: number;
}

/** Downstream risk hint derived from the MTF snapshot. Not consumed yet. */
export interface MtfRiskHint {
  /** Whether the MTF layer considers the regime stable enough for entries. */
  regimeStable: boolean;
  /** Suggested position-size scalar (1 = unchanged, <1 = reduce). */
  sizeScalar: number;
  /** Reason codes for downstream diagnostics. */
  reasonCodes: string[];
}

/** MTF diagnostics attached to architect publish/usability telemetry. */
export interface MtfPublishDiagnostics {
  mtfEnabled: boolean;
  mtfAgreement: number | null;
  mtfDominantFrame: MtfHorizonFrameId | null;
  mtfDominantTimeframe: MtfTimeframeId | null;
  mtfInstability: number | null;
  mtfMetaRegime: MarketRegime | null;
  mtfReadyFrameCount: number;
  mtfSufficientFrames: boolean;
}

/** Compact audit trail for MTF parameter decisions. */
export interface MtfDecisionTrace {
  adjusted: boolean;
  baselineParamsUsed: boolean;
  capMultiplier: number | null;
  dominantFrame: MtfHorizonFrameId | null;
  enabled: boolean;
  instability: number | null;
  instabilityThreshold: number;
  reason: string | null;
}
