// Module responsibility: build TradingBot diagnostics and compact-log metadata without owning emission timing.

import type { ArchitectTimingMetadata, ArchitectUsabilityState } from "./architectCoordinator.ts";
import type { BotRuntimeState, BotConfig } from "../types/bot.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { ExitPolicy, InvalidationMode, ProtectionStopMode } from "../types/exitPolicy.ts";
import type { MarketTick } from "../types/market.ts";
import type { PositionExitMechanism, PositionLifecycleEvent, PositionLifecycleState } from "../types/positionLifecycle.ts";
import type { RiskProfileSettings, TradeConstraints } from "../types/runtime.ts";
import type { EntryEconomicsEstimate, MarketContext, StrategyDecision } from "../types/strategy.ts";
import type { ClosedTradeRecord, PositionRecord } from "../types/trade.ts";

const { getPositionLifecycleState, isManagedRecoveryPosition, POSITION_LIFECYCLE_EVENTS, resolveLifecycleEventFromReasons } = require("./positionLifecycleManager.ts");
const { applyDirectionalOffset, isEntryAction, normalizeTradeSide } = require("../utils/tradeSide.ts");

export interface CompactLogDescriptor {
  dedupeKey?: string;
  message: string;
  metadata: Record<string, unknown>;
  signature?: string;
}

export interface PostLossArchitectLatchTelemetryState {
  activatedAt: number | null;
  active: boolean;
  blocking: boolean;
  freshPublishCount: number;
  requiredPublishes: number;
  strategyId: string | null;
}

export interface EntryRiskGateTelemetry {
  allowed?: boolean;
  reason?: string | null;
}

export interface EntryEvaluationMetadata extends Record<string, unknown> {
  allowReason: string | null;
  blockReason: string | null;
  decisionAction: string;
  outcome: "blocked" | "opened" | "skipped";
  signalEvaluated: boolean;
  skipReason: string | null;
}

export interface TradingBotTelemetryParams {
  botId: string;
  symbol: string;
}

export interface TradingBotTelemetryInstance {
  buildArchitectEntryShortCircuitCompactDescriptor(strategyId: string): CompactLogDescriptor;
  buildArchitectEntryShortCircuitLogMetadata(architectState: ArchitectUsabilityState | null): Record<string, unknown>;
  buildCompactArchitectDescriptor(metadata: Record<string, unknown>): CompactLogDescriptor;
  buildCompactBuyDescriptor(metadata: Record<string, unknown>): CompactLogDescriptor;
  buildCompactEntryMetadata(params: {
    allowReason?: string | null;
    architectState: ArchitectUsabilityState;
    context?: Partial<MarketContext> | null;
    decision?: StrategyDecision | null;
    economics: EntryEconomicsEstimate;
    outcome: "blocked" | "opened" | "skipped";
    profile?: Pick<RiskProfileSettings, "entryDebounceTicks"> | null;
    quantity: number | null;
    riskGate?: EntryRiskGateTelemetry | null;
    signalState?: Partial<BotRuntimeState> | null;
    blockReason?: string | null;
    state?: Partial<BotRuntimeState> | null;
    strategyId: string;
    tick: MarketTick;
  }): Record<string, unknown>;
  buildCompactRiskDescriptor(strategyId: string, metadata: Record<string, unknown>, dedupeKey?: string, signature?: string): CompactLogDescriptor;
  buildCompactSellDescriptor(metadata: Record<string, unknown>): CompactLogDescriptor;
  buildEntryBlockedMetadata(params: {
    postLossArchitectLatch?: PostLossArchitectLatchTelemetryState | null;
    reason: string;
  }): Record<string, unknown>;
  buildEntryDiagnostics(params: BuildEntryDiagnosticsParams): Record<string, unknown>;
  buildEntryEvaluationLogKey(metadata: Partial<EntryEvaluationMetadata>): string;
  buildEntryEvaluationMetadata(params: BuildEntryEvaluationMetadataParams): EntryEvaluationMetadata;
  buildManagedRecoverySignature(metadata: Record<string, unknown>): string;
  buildSetupLogMetadata(metadata: Record<string, unknown>, strategyId: string): Record<string, unknown>;
  buildSetupStateSignature(metadata: Record<string, unknown>, strategyId: string): string;
  buildExitTelemetry(params: BuildExitTelemetryParams): Record<string, unknown>;
  maybeBuildCompactBlockChangeDescriptor(metadata: Record<string, unknown>, strategyId: string): CompactLogDescriptor | null;
  maybeBuildCompactSetupDescriptor(metadata: Record<string, unknown>, strategyId: string): CompactLogDescriptor | null;
  resolveInvalidationLevel(architectState?: ArchitectUsabilityState | null, invalidationMode?: InvalidationMode | null): string | null;
}

export interface BuildEntryDiagnosticsParams {
  architectState: ArchitectUsabilityState;
  context?: Partial<MarketContext> | null;
  contextSnapshot: ContextSnapshot | null;
  decision?: StrategyDecision | null;
  economics: EntryEconomicsEstimate;
  entryMaturityThreshold: number;
  postLossArchitectLatch: PostLossArchitectLatchTelemetryState;
  profile?: Pick<RiskProfileSettings, "entryDebounceTicks"> | null;
  quantity: number | null;
  riskGate?: EntryRiskGateTelemetry | null;
  signalEvaluated?: boolean;
  signalState?: Partial<BotRuntimeState> | null;
  state?: Partial<BotRuntimeState> | null;
  strategyId: string;
  tick: MarketTick;
  tradeConstraints: TradeConstraints;
}

export interface BuildEntryEvaluationMetadataParams {
  allowReason?: string | null;
  blockReason?: string | null;
  diagnostics: Record<string, unknown>;
  outcome: "blocked" | "opened" | "skipped";
  signalEvaluated?: boolean;
  skipReason?: string | null;
}

export interface BuildExitTelemetryParams {
  architectState?: ArchitectUsabilityState | null;
  architectTiming: ArchitectTimingMetadata;
  closedTrade?: ClosedTradeRecord | null;
  exitMechanism?: PositionExitMechanism | null;
  executionTimestamp?: number | null;
  exitPolicy: ExitPolicy | null;
  exitReasons: string[];
  invalidationLevel?: string | null;
  invalidationMode?: InvalidationMode | null;
  lifecycleEvent?: PositionLifecycleEvent | null;
  managedRecoveryTarget?: {
    source?: string | null;
    targetPrice?: number | null;
  } | null;
  position: PositionRecord;
  protectionMode?: ProtectionStopMode | string | null;
  protectionStopPct: number;
  signalTimestamp: number;
}

class TradingBotTelemetry implements TradingBotTelemetryInstance {
  botId: string;
  symbol: string;

  constructor(params: TradingBotTelemetryParams) {
    this.botId = params.botId;
    this.symbol = params.symbol;
  }

  toFixedNumber(value: unknown, digits: number) {
    return Number(Number(value || 0).toFixed(digits));
  }

  toFixedNumberOrNull(value: unknown, digits: number) {
    return Number.isFinite(Number(value))
      ? Number(Number(value).toFixed(digits))
      : null;
  }

  toSignaturePart(value: unknown) {
    if (value === null || value === undefined) return "~";
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "~";
    return String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll("|", "\\|");
  }

  buildPrimitiveSignature(parts: unknown[]) {
    return parts.map((part) => this.toSignaturePart(part)).join("|");
  }

  buildArchitectEntryShortCircuitLogMetadata(architectState: ArchitectUsabilityState | null) {
    return {
      architectAgeMs: architectState?.architectAgeMs || null,
      architectBlockReason: architectState?.blockReason || null,
      architectStaleThresholdMs: architectState?.staleThresholdMs || null,
      reason: "architect_not_usable_for_entry"
    };
  }

  buildArchitectEntryShortCircuitCompactDescriptor(strategyId: string): CompactLogDescriptor {
    return {
      dedupeKey: "BLOCK_CHANGE",
      message: "BLOCK_CHANGE",
      metadata: {
        blockReason: "architect_not_usable_for_entry",
        botId: this.botId,
        strategy: strategyId,
        symbol: this.symbol
      }
    };
  }

  buildEntryEvaluationLogKey(metadata: Partial<EntryEvaluationMetadata>) {
    return [
      metadata.outcome || "unknown",
      metadata.blockReason || "none",
      metadata.skipReason || "none",
      metadata.architectUsable ? "usable" : "blocked",
      metadata.signalEvaluated ? "evaluated" : "not_evaluated",
      metadata.decisionAction || "not_evaluated"
    ].join("|");
  }

  buildSetupLogMetadata(metadata: Record<string, unknown>, strategyId: string) {
    return {
      allowReason: metadata.allowReason || null,
      blockReason: metadata.blockReason || null,
      botId: this.botId,
      decisionAction: metadata.decisionAction || "not_evaluated",
      decisionSide: metadata.decisionSide || null,
      decisionConfidence: metadata.decisionConfidence ?? 0,
      entryDebounceRequired: metadata.entryDebounceRequired ?? null,
      entrySignalStreak: metadata.entrySignalStreak ?? 0,
      estimatedCostPct: metadata.estimatedCostPct ?? null,
      expectedGrossEdgePct: metadata.expectedGrossEdgePct ?? null,
      expectedNetEdgePct: metadata.expectedNetEdgePct ?? null,
      family: metadata.publishedFamily || metadata.targetFamily || null,
      latestPrice: metadata.latestPrice ?? null,
      regime: metadata.publishedRegime || null,
      rsi: metadata.strategyRsi ?? null,
      strategy: metadata.strategy || strategyId,
      symbol: this.symbol
    };
  }

  buildSetupStateSignature(metadata: Record<string, unknown>, strategyId: string) {
    const debounceRequired = Number(metadata.entryDebounceRequired || 0);
    const streak = Number(metadata.entrySignalStreak || 0);
    const readinessState = !isEntryAction(metadata.decisionAction)
      ? "inactive"
      : debounceRequired <= 0
        ? "ready"
        : streak >= debounceRequired
          ? "ready"
          : streak >= Math.max(debounceRequired - 1, 1)
            ? "near_ready"
            : streak > 0
              ? "arming"
              : "idle";

    return this.buildPrimitiveSignature([
      metadata.allowReason || null,
      metadata.blockReason || null,
      metadata.decisionAction || "not_evaluated",
      metadata.publishedFamily || metadata.targetFamily || null,
      readinessState,
      metadata.publishedRegime || null,
      metadata.riskReason || null,
      metadata.strategy || strategyId
    ]);
  }

  maybeBuildCompactSetupDescriptor(metadata: Record<string, unknown>, strategyId: string): CompactLogDescriptor | null {
    const entryDebounceRequired = Number(metadata.entryDebounceRequired || 0);
    const entrySignalStreak = Number(metadata.entrySignalStreak || 0);
    const nearReady = entryDebounceRequired > 0 && entrySignalStreak >= Math.max(entryDebounceRequired - 1, 1);
    const shouldLog = isEntryAction(metadata.decisionAction)
      || Boolean(metadata.allowReason)
      || Boolean(metadata.blockReason)
      || nearReady;
    if (!shouldLog) {
      return null;
    }

    return {
      dedupeKey: "SETUP",
      message: "SETUP",
      metadata: this.buildSetupLogMetadata(metadata, strategyId),
      signature: this.buildSetupStateSignature(metadata, strategyId)
    };
  }

  maybeBuildCompactBlockChangeDescriptor(metadata: Record<string, unknown>, strategyId: string): CompactLogDescriptor | null {
    if (!metadata.blockReason) {
      return null;
    }

    const blockMetadata = {
      blockReason: metadata.blockReason,
      botId: this.botId,
      decisionAction: metadata.decisionAction || "not_evaluated",
      decisionSide: metadata.decisionSide || null,
      entryDebounceRequired: metadata.entryDebounceRequired ?? null,
      entrySignalStreak: metadata.entrySignalStreak ?? 0,
      expectedNetEdgePct: metadata.expectedNetEdgePct ?? null,
      latestPrice: metadata.latestPrice ?? null,
      riskReason: metadata.riskReason || null,
      strategy: metadata.strategy || strategyId,
      symbol: this.symbol
    };

    return {
      dedupeKey: "BLOCK_CHANGE",
      message: "BLOCK_CHANGE",
      metadata: blockMetadata,
      signature: this.buildPrimitiveSignature([
        blockMetadata.blockReason,
        blockMetadata.decisionAction,
        blockMetadata.riskReason,
        blockMetadata.strategy
      ])
    };
  }

  buildCompactRiskDescriptor(strategyId: string, metadata: Record<string, unknown>, dedupeKey = "RISK_CHANGE", signature?: string): CompactLogDescriptor {
    return {
      dedupeKey,
      message: "RISK_CHANGE",
      metadata: {
        botId: this.botId,
        strategy: strategyId,
        symbol: this.symbol,
        ...metadata
      },
      signature
    };
  }

  buildCompactArchitectDescriptor(metadata: Record<string, unknown>): CompactLogDescriptor {
    return {
      dedupeKey: "ARCHITECT_CHANGE",
      message: "ARCHITECT_CHANGE",
      metadata: {
        botId: this.botId,
        symbol: this.symbol,
        ...metadata
      }
    };
  }

  buildCompactBuyDescriptor(metadata: Record<string, unknown>): CompactLogDescriptor {
    const side = normalizeTradeSide(metadata.side);
    return {
      message: side === "short" ? "SHORT" : "BUY",
      metadata: {
        botId: this.botId,
        symbol: this.symbol,
        ...metadata,
        side
      }
    };
  }

  buildCompactSellDescriptor(metadata: Record<string, unknown>): CompactLogDescriptor {
    const side = normalizeTradeSide(metadata.side);
    return {
      message: side === "short" ? "COVER" : "SELL",
      metadata: {
        botId: this.botId,
        symbol: this.symbol,
        ...metadata,
        side
      }
    };
  }

  buildCompactEntryMetadata(params: {
    allowReason?: string | null;
    architectState: ArchitectUsabilityState;
    context?: Partial<MarketContext> | null;
    decision?: StrategyDecision | null;
    economics: EntryEconomicsEstimate;
    outcome: "blocked" | "opened" | "skipped";
    profile?: Pick<RiskProfileSettings, "entryDebounceTicks"> | null;
    quantity: number | null;
    riskGate?: EntryRiskGateTelemetry | null;
    signalState?: Partial<BotRuntimeState> | null;
    blockReason?: string | null;
    state?: Partial<BotRuntimeState> | null;
    strategyId: string;
    tick: MarketTick;
  }) {
    const state = params.state || {};
    const signalState = params.signalState || state;
    const architect = params.architectState.architect;
    const strategyRsiRaw = params.context?.indicators?.rsi;
    const strategyRsi = Number.isFinite(Number(strategyRsiRaw))
      ? Number(Number(strategyRsiRaw).toFixed(4))
      : null;

    return {
      allowReason: params.allowReason || null,
      blockReason: params.blockReason || null,
      decisionAction: params.decision?.action || "not_evaluated",
      decisionConfidence: params.decision ? Number(Number(params.decision.confidence || 0).toFixed(4)) : 0,
      decisionSide: isEntryAction(params.decision?.action) ? (params.decision?.side || params.economics.side || null) : null,
      entryDebounceRequired: params.profile?.entryDebounceTicks ?? null,
      entrySignalStreak: signalState?.entrySignalStreak ?? state.entrySignalStreak ?? 0,
      estimatedCostPct: Number((params.economics.estimatedEntryFeePct + params.economics.estimatedExitFeePct + params.economics.estimatedSlippagePct).toFixed(4)),
      expectedGrossEdgePct: Number(params.economics.expectedGrossEdgePct.toFixed(4)),
      expectedNetEdgePct: Number(params.economics.expectedNetEdgePct.toFixed(4)),
      latestPrice: Number(Number(params.tick?.price || 0).toFixed(4)),
      outcome: params.outcome,
      publishedFamily: architect?.recommendedFamily || null,
      publishedRegime: architect?.marketRegime || null,
      riskReason: params.riskGate?.reason || null,
      strategy: params.strategyId,
      strategyRsi,
      targetFamily: params.architectState.actionableFamily || null
    };
  }

  buildManagedRecoverySignature(metadata: Record<string, unknown>) {
    return this.buildPrimitiveSignature([
      metadata.exitEvent || null,
      metadata.invalidationLevel || null,
      metadata.positionStatus || null,
      metadata.status || null,
      metadata.targetPrice || null,
      metadata.timeoutRemainingMs || null
    ]);
  }

  buildEntryBlockedMetadata(params: {
    postLossArchitectLatch?: PostLossArchitectLatchTelemetryState | null;
    reason: string;
  }) {
    return {
      postLossArchitectLatchActive: params.postLossArchitectLatch?.active ?? null,
      postLossArchitectLatchFreshPublishCount: params.postLossArchitectLatch?.freshPublishCount ?? null,
      postLossArchitectLatchRequiredPublishes: params.postLossArchitectLatch?.requiredPublishes ?? null,
      reason: params.reason
    };
  }

  buildEntryDiagnostics(params: BuildEntryDiagnosticsParams) {
    const architect = params.architectState.architect;
    const state = params.state || {};
    const signalState = params.signalState || state;
    const latestPrice = Number(params.tick?.price || 0);
    const strategyRsiRaw = params.context?.indicators?.rsi;
    const strategyRsi = Number.isFinite(Number(strategyRsiRaw))
      ? Number(Number(strategyRsiRaw).toFixed(4))
      : null;
    const cooldownUntil = signalState?.cooldownUntil || state.cooldownUntil || null;
    const estimatedFeePct = params.economics.estimatedEntryFeePct + params.economics.estimatedExitFeePct;
    const estimatedCostPct = estimatedFeePct + params.economics.estimatedSlippagePct;
    const contextMaturity = architect?.contextMaturity ?? params.contextSnapshot?.features?.maturity ?? null;
    const architectContextRsiRaw = params.contextSnapshot?.features?.contextRsi;
    const architectContextRsi = Number.isFinite(Number(architectContextRsiRaw))
      ? Number(Number(architectContextRsiRaw).toFixed(4))
      : null;
    const architectRsiIntensityRaw = params.contextSnapshot?.features?.rsiIntensity;
    const architectRsiIntensity = architectRsiIntensityRaw === undefined || architectRsiIntensityRaw === null
      ? null
      : Number(Number(architectRsiIntensityRaw).toFixed(4));
    const dataQuality = params.contextSnapshot?.features?.dataQuality !== undefined
      ? Number(Number(params.contextSnapshot.features.dataQuality).toFixed(4))
      : null;
    const rollingMaturityRaw = params.contextSnapshot?.rollingMaturity;
    const rollingMaturity = rollingMaturityRaw === undefined || rollingMaturityRaw === null
      ? null
      : Number(Number(rollingMaturityRaw).toFixed(4));
    const postSwitchCoveragePctRaw = params.contextSnapshot?.postSwitchCoveragePct;
    const postSwitchCoveragePct = postSwitchCoveragePctRaw === undefined || postSwitchCoveragePctRaw === null
      ? null
      : Number(Number(postSwitchCoveragePctRaw).toFixed(4));
    const contextWindowMode = params.contextSnapshot?.windowMode || null;
    const effectiveWindowStartedAt = params.contextSnapshot?.effectiveWindowStartedAt ?? null;
    const entryMaturityThreshold = Number(Number(params.entryMaturityThreshold).toFixed(4));
    const postSwitchWarmupActive = contextWindowMode === "post_switch_segment"
      && contextMaturity !== null
      && contextMaturity < entryMaturityThreshold;
    const architectPublishedAt = params.architectState.publisher?.lastPublishedAt || architect?.updatedAt || null;
    const architectSymbol = architect?.symbol || null;
    const architectSymbolMatch = architectSymbol ? architectSymbol === this.symbol : null;
    const contextSymbol = params.contextSnapshot?.symbol || null;
    const contextSymbolMatch = contextSymbol ? contextSymbol === this.symbol : null;
    const tickSymbol = params.tick?.symbol || null;
    const tickSymbolMatch = tickSymbol ? tickSymbol === this.symbol : null;
    const debounceRequired = params.profile?.entryDebounceTicks ?? null;
    const entrySignalStreak = signalState?.entrySignalStreak ?? state.entrySignalStreak ?? 0;

    return {
      architectAuthoritative: Boolean(architect),
      architectAgeMs: params.architectState.architectAgeMs,
      architectBlockReason: params.architectState.blockReason,
      architectPublishedAt,
      architectReady: params.architectState.ready,
      architectSourceUsed: architect ? "published" : "none",
      architectContextRsi,
      architectContextRsiSource: architectContextRsi === null ? null : "effective_context_window",
      architectRsiIntensity,
      architectStale: params.architectState.architectStale,
      architectStaleThresholdMs: params.architectState.staleThresholdMs,
      architectSymbol,
      architectSymbolMatch,
      architectUpdatedAt: architect?.updatedAt || null,
      architectUsable: params.architectState.usable,
      botId: this.botId,
      contextSymbol,
      contextSymbolMatch,
      cooldownActive: Boolean(cooldownUntil && params.tick?.timestamp && cooldownUntil > params.tick.timestamp),
      cooldownReason: signalState?.cooldownReason || state.cooldownReason || null,
      cooldownUntil,
      currentFamily: params.architectState.currentFamily,
      contextMaturity: contextMaturity === null ? null : Number(Number(contextMaturity).toFixed(4)),
      contextWindowMode,
      dataQuality,
      decisionAction: params.decision?.action || "not_evaluated",
      decisionConfidence: params.decision ? Number(Number(params.decision.confidence || 0).toFixed(4)) : 0,
      decisionSide: isEntryAction(params.decision?.action) ? (params.decision?.side || params.economics.side || null) : null,
      effectiveWindowStartedAt,
      entryDebounceRequired: debounceRequired,
      entryMaturityThreshold,
      entrySignalStreak,
      estimatedCostPct: Number(estimatedCostPct.toFixed(4)),
      estimatedEntryFeePct: Number(params.economics.estimatedEntryFeePct.toFixed(4)),
      estimatedExitFeePct: Number(params.economics.estimatedExitFeePct.toFixed(4)),
      estimatedFeePct: Number(estimatedFeePct.toFixed(4)),
      estimatedRoundTripFeesUsdt: Number(params.economics.estimatedRoundTripFeesUsdt.toFixed(4)),
      estimatedSlippagePct: Number(params.economics.estimatedSlippagePct.toFixed(4)),
      expectedGrossEdgePct: Number(params.economics.expectedGrossEdgePct.toFixed(4)),
      expectedGrossEdgeUsdt: Number(params.economics.expectedGrossEdgeUsdt.toFixed(4)),
      expectedNetEdgePct: Number(params.economics.expectedNetEdgePct.toFixed(4)),
      familyMatch: params.architectState.familyMatch,
      latestPrice: Number(latestPrice.toFixed(4)),
      localReasons: Array.isArray(params.decision?.reason) ? params.decision.reason.slice(0, 3) : [],
      maxTargetDistancePctForShortHorizon: Number.isFinite(Number(params.economics.maxTargetDistancePctForShortHorizon))
        ? Number(Number(params.economics.maxTargetDistancePctForShortHorizon).toFixed(4))
        : null,
      minExpectedNetEdgePct: Number(params.economics.minExpectedNetEdgePct.toFixed(4)),
      minNotionalUsdt: Number(params.tradeConstraints.minNotionalUsdt.toFixed(4)),
      minQuantity: Number(params.tradeConstraints.minQuantity.toFixed(8)),
      notionalUsdt: Number(params.economics.notionalUsdt.toFixed(4)),
      postLossArchitectLatchActive: params.postLossArchitectLatch.active,
      postLossArchitectLatchActivatedAt: params.postLossArchitectLatch.activatedAt,
      postLossArchitectLatchBlocking: params.postLossArchitectLatch.blocking,
      postLossArchitectLatchFreshPublishCount: params.postLossArchitectLatch.freshPublishCount,
      postLossArchitectLatchRequiredPublishes: params.postLossArchitectLatch.requiredPublishes,
      postLossArchitectLatchStrategyId: params.postLossArchitectLatch.strategyId,
      postSwitchCoveragePct,
      postSwitchWarmupActive,
      postSwitchWarmupReason: postSwitchWarmupActive ? "post_switch_context_immature" : null,
      publisherLastObservedAt: params.architectState.publisher?.lastObservedAt || null,
      publisherLastPublishedAt: params.architectState.publisher?.lastPublishedAt || null,
      publishedFamily: architect?.recommendedFamily || null,
      publishedRegime: architect?.marketRegime || null,
      publishedUpdatedAt: architect?.updatedAt || null,
      quantity: Number.isFinite(Number(params.quantity)) ? Number(Number(params.quantity).toFixed(8)) : 0,
      requiredEdgePct: Number(params.economics.requiredEdgePct.toFixed(4)),
      riskAllowed: params.riskGate ? Boolean(params.riskGate.allowed) : null,
      riskReason: params.riskGate?.reason || null,
      rollingMaturity,
      signalAgreement: architect ? Number(architect.signalAgreement.toFixed(4)) : null,
      signalEvaluated: params.signalEvaluated !== false,
      strategy: params.strategyId,
      strategyRsi,
      targetDistancePct: Number.isFinite(Number(params.economics.targetDistancePct))
        ? Number(Number(params.economics.targetDistancePct).toFixed(4))
        : null,
      strategyRsiSource: strategyRsi === null ? null : "strategy_indicator_snapshot",
      symbol: this.symbol,
      targetFamily: params.architectState.actionableFamily || null,
      tickSymbol,
      tickSymbolMatch,
      tickTimestamp: params.tick?.timestamp || null
    };
  }

  buildEntryEvaluationMetadata(params: BuildEntryEvaluationMetadataParams): EntryEvaluationMetadata {
    return {
      ...params.diagnostics,
      allowReason: params.allowReason || null,
      blockReason: params.blockReason || null,
      outcome: params.outcome,
      signalEvaluated: params.signalEvaluated !== false,
      skipReason: params.skipReason || null
    } as EntryEvaluationMetadata;
  }

  getPositionStatus(position: PositionRecord | null | undefined) {
    if (!position) return "flat";
    return getPositionLifecycleState(position);
  }

  getProtectiveStopLevel(position: PositionRecord | null | undefined, protectionStopPct: number) {
    if (!position) return null;
    if (!Number.isFinite(Number(position.entryPrice))) return null;
    const side = normalizeTradeSide(position.side);
    const stopLevel = side === "short"
      ? Number(position.entryPrice) * (1 + Number(protectionStopPct))
      : applyDirectionalOffset(Number(position.entryPrice), -Math.abs(Number(protectionStopPct)), "long");
    return Number(stopLevel.toFixed(4));
  }

  extractPrimaryExitEvent(exitReasons: string[]) {
    const prioritizedEvents = [
      "rsi_exit_deferred",
      "rsi_exit_confirmed",
      "reversion_price_target_hit",
      "regime_invalidation_exit",
      "protective_stop_exit",
      "time_exhaustion_exit"
    ];
    return prioritizedEvents.find((reason) => exitReasons.includes(reason)) || (exitReasons[0] || null);
  }

  resolveExitMechanism(exitReasons: string[], lifecycleEvent?: PositionLifecycleEvent | null): PositionExitMechanism | null {
    if (exitReasons.includes("protective_stop_exit") || lifecycleEvent === POSITION_LIFECYCLE_EVENTS.PROTECTIVE_STOP_HIT) {
      return "protection";
    }
    if (exitReasons.includes("regime_invalidation_exit") || lifecycleEvent === POSITION_LIFECYCLE_EVENTS.REGIME_INVALIDATION) {
      return "invalidation";
    }
    if (
      exitReasons.includes("reversion_price_target_hit")
      || exitReasons.includes("time_exhaustion_exit")
      || lifecycleEvent === POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT
      || lifecycleEvent === POSITION_LIFECYCLE_EVENTS.RECOVERY_TIMEOUT
    ) {
      return "recovery";
    }
    if (
      exitReasons.includes("rsi_exit_confirmed")
      || exitReasons.includes("rsi_exit_deferred")
      || exitReasons.includes("rsi_exit_threshold_hit")
      || lifecycleEvent === POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT
      || lifecycleEvent === POSITION_LIFECYCLE_EVENTS.FAILED_RSI_EXIT
    ) {
      return "qualification";
    }
    return null;
  }

  resolveInvalidationLevel(architectState?: ArchitectUsabilityState | null, invalidationMode?: InvalidationMode | null) {
    return architectState?.blockReason || invalidationMode || null;
  }

  buildExitTelemetry(params: BuildExitTelemetryParams) {
    const signalTimestamp = Number(params.signalTimestamp);
    const executionTimestamp = Number.isFinite(Number(params.executionTimestamp))
      ? Number(params.executionTimestamp)
      : null;
    const managedRecoveryTimeoutMs = Number(params.exitPolicy?.recovery?.timeoutMs || 0);
    const timeoutRemainingMs = isManagedRecoveryPosition(params.position)
      ? Math.max(
          0,
          (Number(params.position.managedRecoveryStartedAt || params.position.openedAt || signalTimestamp) + managedRecoveryTimeoutMs) - signalTimestamp
        )
      : null;

    return {
      architectDecisionAgeMs: params.architectTiming.architectDecisionAgeMs,
      architectPublishAgeMs: params.architectTiming.architectPublishAgeMs,
      closeClassification: null,
      closeReason: params.exitReasons.join(","),
      executionTimestamp,
      exitEvent: this.extractPrimaryExitEvent(params.exitReasons),
      exitMechanism: params.exitMechanism || this.resolveExitMechanism(params.exitReasons, params.lifecycleEvent),
      fees: params.closedTrade ? Number(Number(params.closedTrade.fees || 0).toFixed(4)) : null,
      grossPnl: params.closedTrade ? Number(Number(params.closedTrade.pnl || 0).toFixed(4)) : null,
      invalidationLevel: params.invalidationLevel || this.resolveInvalidationLevel(params.architectState, params.invalidationMode),
      invalidationMode: params.invalidationMode || null,
      lifecycleEvent: params.lifecycleEvent || resolveLifecycleEventFromReasons(params.exitReasons),
      netPnl: params.closedTrade ? Number(Number(params.closedTrade.netPnl || 0).toFixed(4)) : null,
      policyId: params.exitPolicy?.id || null,
      positionSide: normalizeTradeSide(params.position.side),
      positionStatus: this.getPositionStatus(params.position),
      protectionMode: params.protectionMode || null,
      signalTimestamp,
      signalToExecutionMs: executionTimestamp === null ? null : Math.max(0, executionTimestamp - signalTimestamp),
      stopLevel: this.getProtectiveStopLevel(params.position, params.protectionStopPct),
      targetPrice: Number.isFinite(Number(params.managedRecoveryTarget?.targetPrice))
        ? Number(Number(params.managedRecoveryTarget?.targetPrice).toFixed(4))
        : null,
      targetSource: params.managedRecoveryTarget?.source || null,
      timeoutRemainingMs
    };
  }
}

module.exports = {
  TradingBotTelemetry
};
