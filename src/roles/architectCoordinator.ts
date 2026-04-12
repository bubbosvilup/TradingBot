// Module responsibility: centralize published Architect state interpretation and flat-state sync/apply coordination.

import type { ArchitectAssessment, ArchitectPublisherState, MarketRegime, RecommendedFamily } from "../types/architect.ts";
import type { ArchitectSyncStatus, BotConfig, BotRuntimeState } from "../types/bot.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { BotStateStoreLike, StrategyRegistryLike, StrategySwitchPlan, StrategySwitcherLike } from "../types/runtime.ts";
import type { Strategy } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";

const { now } = require("../utils/time.ts");

export interface ArchitectTimingMetadata {
  architectDecisionAgeMs: number | null;
  architectPublishAgeMs: number | null;
}

export interface ArchitectUsabilityState {
  actionableFamily: RecommendedFamily | null;
  architect: ArchitectAssessment | null;
  architectAgeMs: number | null;
  architectStale: boolean;
  blockReason: string | null;
  currentFamily: RecommendedFamily | "other" | null;
  entryMaturityThreshold: number;
  familyMatch: boolean | null;
  publisher: ArchitectPublisherState | null;
  ready: boolean;
  staleThresholdMs: number;
  usable: boolean;
}

export interface ArchitectDivergenceLogMetadata extends Record<string, unknown> {
  currentFamily: RecommendedFamily | "other" | null;
  publishedAt: number | null;
  recommendedFamily: RecommendedFamily | null;
  syncStatus: ArchitectSyncStatus;
}

export interface ArchitectSyncUpdateResult {
  architectState: ArchitectUsabilityState;
  nextDivergenceActive: boolean;
  published: ArchitectAssessment | null;
  state: BotRuntimeState | null;
  divergenceLogMetadata?: ArchitectDivergenceLogMetadata;
}

export interface ArchitectApplyLogEvent {
  message: "strategy_aligned" | "strategy_alignment_skipped";
  metadata: Record<string, unknown>;
}

export interface ArchitectApplyResult {
  architectState: ArchitectUsabilityState;
  published: ArchitectAssessment | null;
  state: BotRuntimeState | null;
  syncUpdate?: ArchitectSyncUpdateResult;
  switchPlan?: StrategySwitchPlan;
  nextStrategy?: Strategy;
  compactArchitectChangeMetadata?: Record<string, unknown>;
  logEvent?: ArchitectApplyLogEvent;
}

export interface EvaluateArchitectUsabilityParams {
  activeStrategyId?: string | null;
  architect?: ArchitectAssessment | null;
  contextSnapshot?: ContextSnapshot | null;
  currentFamily?: RecommendedFamily | "other" | null;
  publisher?: ArchitectPublisherState | null;
  timestamp?: number;
  mtfEnabled?: boolean;
  mtfInstability?: number | null;
  mtfAgreement?: number | null;
  mtfDominantTimeframe?: string | null;
  mtfSufficientFrames?: boolean;
}

export interface ArchitectSyncParams extends EvaluateArchitectUsabilityParams {
  architectState?: ArchitectUsabilityState | null;
  currentDivergenceActive?: boolean;
  state?: BotRuntimeState | null;
}

export interface ArchitectCoordinatorParams {
  allowedStrategies: string[];
  botConfig: BotConfig;
  maxArchitectStateAgeMs: number;
  minEntryContextMaturity: number;
  minPostSwitchEntryContextMaturity: number;
  store: BotStateStoreLike;
  strategyRegistry: StrategyRegistryLike;
  strategySwitcher: StrategySwitcherLike;
  mtfInstabilityThreshold?: number;
}

export interface ArchitectCoordinatorInstance {
  applyPublishedState(position: PositionRecord | null, params?: ArchitectSyncParams): ArchitectApplyResult | undefined;
  evaluateUsability(params?: EvaluateArchitectUsabilityParams): ArchitectUsabilityState;
  getPublishedAssessment(): ArchitectAssessment | null;
  getTimingMetadata(timestamp: number, params?: {
    architect?: ArchitectAssessment | null;
    publisher?: ArchitectPublisherState | null;
  }): ArchitectTimingMetadata;
  resolveArchitectMaturityBlockReason(contextSnapshot?: ContextSnapshot | null): string;
  resolveEntryMaturityThreshold(contextSnapshot?: ContextSnapshot | null): number;
  updateSyncState(position: PositionRecord | null, params?: ArchitectSyncParams): ArchitectSyncUpdateResult | null;
}

const DEFAULT_MTF_USABILITY_INSTABILITY_THRESHOLD = 0.5;

class ArchitectCoordinator implements ArchitectCoordinatorInstance {
  allowedStrategies: string[];
  botConfig: BotConfig;
  maxArchitectStateAgeMs: number;
  minEntryContextMaturity: number;
  minPostSwitchEntryContextMaturity: number;
  mtfInstabilityThreshold: number;
  store: BotStateStoreLike;
  strategyRegistry: StrategyRegistryLike;
  strategySwitcher: StrategySwitcherLike;

  constructor(params: ArchitectCoordinatorParams) {
    this.allowedStrategies = Array.isArray(params.allowedStrategies) ? [...params.allowedStrategies] : [];
    this.botConfig = params.botConfig;
    this.maxArchitectStateAgeMs = params.maxArchitectStateAgeMs;
    this.minEntryContextMaturity = params.minEntryContextMaturity;
    this.minPostSwitchEntryContextMaturity = params.minPostSwitchEntryContextMaturity;
    this.mtfInstabilityThreshold = params.mtfInstabilityThreshold ?? DEFAULT_MTF_USABILITY_INSTABILITY_THRESHOLD;
    this.store = params.store;
    this.strategyRegistry = params.strategyRegistry;
    this.strategySwitcher = params.strategySwitcher;
  }

  getPublishedAssessment(): ArchitectAssessment | null {
    return this.store.getArchitectPublishedAssessment(this.botConfig.symbol);
  }

  getTimingMetadata(timestamp: number, params: {
    architect?: ArchitectAssessment | null;
    publisher?: ArchitectPublisherState | null;
  } = {}): ArchitectTimingMetadata {
    const architect = params.architect !== undefined
      ? params.architect
      : this.getPublishedAssessment();
    const publisher = params.publisher !== undefined
      ? params.publisher
      : this.store.getArchitectPublisherState(this.botConfig.symbol);
    const publishedAt = publisher?.lastPublishedAt || architect?.updatedAt || null;
    return {
      architectDecisionAgeMs: architect?.updatedAt ? Math.max(0, timestamp - architect.updatedAt) : null,
      architectPublishAgeMs: publishedAt ? Math.max(0, timestamp - publishedAt) : null
    };
  }

  resolveArchitectMaturityBlockReason(contextSnapshot?: ContextSnapshot | null) {
    if (contextSnapshot?.windowMode === "post_switch_segment") {
      return "architect_post_switch_low_maturity";
    }
    return "architect_low_maturity";
  }

  resolveEntryMaturityThreshold(contextSnapshot?: ContextSnapshot | null) {
    if (contextSnapshot?.windowMode === "post_switch_segment") {
      return this.minPostSwitchEntryContextMaturity;
    }
    return this.minEntryContextMaturity;
  }

  resolveRegimeFamily(regime?: MarketRegime | null): RecommendedFamily | null {
    if (regime === "trend") return "trend_following";
    if (regime === "range") return "mean_reversion";
    if (regime === "volatile" || regime === "unclear") return "no_trade";
    return null;
  }

  evaluateUsability(params: EvaluateArchitectUsabilityParams = {}): ArchitectUsabilityState {
    const architect = params.architect !== undefined
      ? params.architect
      : this.getPublishedAssessment();
    const contextSnapshot = params.contextSnapshot !== undefined
      ? params.contextSnapshot
      : this.store.getContextSnapshot(this.botConfig.symbol);
    const publisher = params.publisher !== undefined
      ? params.publisher
      : this.store.getArchitectPublisherState(this.botConfig.symbol);
    const evaluatedAt = Number.isFinite(Number(params.timestamp)) ? Number(params.timestamp) : now();
    const entryMaturityThreshold = this.resolveEntryMaturityThreshold(contextSnapshot);
    const currentFamily = params.currentFamily !== undefined
      ? params.currentFamily
      : this.strategySwitcher.getStrategyFamily(params.activeStrategyId || null);
    const architectAgeMs = architect?.updatedAt ? Math.max(0, evaluatedAt - architect.updatedAt) : null;
    const staleThresholdMs = Math.max((publisher?.publishIntervalMs || 30_000) * 2, this.maxArchitectStateAgeMs);
    const architectStale = architectAgeMs !== null && architectAgeMs > staleThresholdMs;
    const actionableFamily = architect?.recommendedFamily && architect.recommendedFamily !== "no_trade"
      ? architect.recommendedFamily
      : null;
    const challengerFamily = this.resolveRegimeFamily(publisher?.challengerRegime || null);

    let blockReason = null;
    if (!architect) {
      blockReason = "missing_published_architect";
    } else if (architect.symbol && architect.symbol !== this.botConfig.symbol) {
      blockReason = "architect_symbol_mismatch";
    } else if (!publisher?.ready || !architect.sufficientData) {
      blockReason = "architect_not_ready";
    } else if (architect.marketRegime === "unclear") {
      blockReason = "architect_unclear";
    } else if (architect.recommendedFamily === "no_trade") {
      blockReason = "architect_no_trade";
    } else if (architectStale) {
      blockReason = "architect_stale";
    } else if (architect.contextMaturity < entryMaturityThreshold) {
      blockReason = this.resolveArchitectMaturityBlockReason(contextSnapshot);
    } else if (
      publisher?.hysteresisActive
      && challengerFamily
      && challengerFamily !== currentFamily
    ) {
      blockReason = "architect_challenger_pending";
    } else if (
      params.mtfEnabled
      && params.mtfSufficientFrames
      && typeof params.mtfInstability === "number"
      && params.mtfInstability >= this.mtfInstabilityThreshold
    ) {
      blockReason = "mtf_instability_high";
    }

    const familyMatch = actionableFamily ? currentFamily === actionableFamily : null;
    return {
      actionableFamily,
      architect,
      architectAgeMs,
      architectStale,
      blockReason,
      currentFamily,
      entryMaturityThreshold,
      familyMatch,
      publisher,
      ready: Boolean(architect && publisher?.ready && architect.sufficientData),
      staleThresholdMs,
      usable: blockReason === null
    };
  }

  updateSyncState(position: PositionRecord | null, params: ArchitectSyncParams = {}): ArchitectSyncUpdateResult | null {
    const state = params.state || this.store.getBotState(this.botConfig.id);
    if (!state) return null;

    const currentFamily = params.currentFamily !== undefined
      ? params.currentFamily
      : this.strategySwitcher.getStrategyFamily(params.activeStrategyId || state.activeStrategyId || null);
    const architectState = params.architectState || (params.architect || params.contextSnapshot || params.publisher || params.timestamp !== undefined || params.currentFamily !== undefined
      ? this.evaluateUsability({
          activeStrategyId: params.activeStrategyId || state.activeStrategyId || null,
          architect: params.architect,
          contextSnapshot: params.contextSnapshot,
          currentFamily,
          publisher: params.publisher,
          timestamp: params.timestamp
        })
      : this.evaluateUsability({
          activeStrategyId: params.activeStrategyId || state.activeStrategyId || null,
          currentFamily
        }));
    const published = architectState.architect;
    const waitingForFlat = Boolean(position) && architectState.usable && architectState.familyMatch === false;
    const flatMisaligned = !position && architectState.usable && architectState.familyMatch === false;
    const nextStatus: ArchitectSyncStatus = !architectState.usable || flatMisaligned
      ? "pending"
      : waitingForFlat
        ? "waiting_flat"
        : "synced";

    this.store.updateBotState(this.botConfig.id, {
      architectSyncStatus: nextStatus
    });

    const nextDivergenceActive = architectState.usable
      && Boolean(architectState.actionableFamily)
      && architectState.familyMatch === false;
    const divergenceLogMetadata = nextDivergenceActive && nextDivergenceActive !== Boolean(params.currentDivergenceActive)
      ? {
          currentFamily,
          publishedAt: published?.updatedAt || null,
          recommendedFamily: architectState.actionableFamily,
          syncStatus: nextStatus
        }
      : undefined;

    return {
      architectState,
      divergenceLogMetadata,
      nextDivergenceActive,
      published,
      state: this.store.getBotState(this.botConfig.id)
    };
  }

  applyPublishedState(position: PositionRecord | null, params: ArchitectSyncParams = {}): ArchitectApplyResult | undefined {
    const state = params.state || this.store.getBotState(this.botConfig.id);
    if (!state || position) return;

    const currentFamily = params.currentFamily !== undefined
      ? params.currentFamily
      : this.strategySwitcher.getStrategyFamily(params.activeStrategyId || state.activeStrategyId || null);
    const architectState = params.architectState || (params.architect || params.contextSnapshot || params.publisher || params.timestamp !== undefined || params.currentFamily !== undefined
      ? this.evaluateUsability({
          activeStrategyId: params.activeStrategyId || state.activeStrategyId || null,
          architect: params.architect,
          contextSnapshot: params.contextSnapshot,
          currentFamily,
          publisher: params.publisher,
          timestamp: params.timestamp
        })
      : this.evaluateUsability({
          activeStrategyId: params.activeStrategyId || state.activeStrategyId || null,
          currentFamily
        }));
    if (!architectState.usable || !architectState.actionableFamily || architectState.familyMatch !== false) {
      return {
        architectState,
        published: architectState.architect,
        state
      };
    }

    const published = architectState.architect;
    if (!published) {
      return {
        architectState,
        published,
        state
      };
    }

    const switchPlan = this.strategySwitcher.evaluate({
      architect: published,
      availableStrategies: this.allowedStrategies,
      botConfig: this.botConfig,
      now: Number.isFinite(Number(params.timestamp)) ? Number(params.timestamp) : now(),
      positionOpen: Boolean(position),
      state
    });
    if (!switchPlan) {
      return {
        architectState,
        published,
        state
      };
    }

    const livePosition = this.store.getPosition(this.botConfig.id);
    if (livePosition) {
      const syncUpdate = this.updateSyncState(livePosition, {
        activeStrategyId: params.activeStrategyId || state.activeStrategyId || null,
        currentDivergenceActive: params.currentDivergenceActive,
        timestamp: params.timestamp
      });
      return {
        architectState,
        published,
        state: syncUpdate?.state || this.store.getBotState(this.botConfig.id),
        syncUpdate,
        switchPlan,
        logEvent: {
          message: "strategy_alignment_skipped",
          metadata: {
            nextStrategy: switchPlan.nextStrategyId,
            reason: "position_opened_before_apply",
            targetFamily: switchPlan.targetFamily
          }
        }
      };
    }

    const nextStrategy = this.strategyRegistry.createStrategy(switchPlan.nextStrategyId);
    this.store.updateBotState(this.botConfig.id, {
      activeStrategyId: switchPlan.nextStrategyId,
      architectSyncStatus: "synced",
      lastStrategySwitchAt: Number.isFinite(Number(params.timestamp)) ? Number(params.timestamp) : now()
    });

    return {
      architectState,
      published,
      state: this.store.getBotState(this.botConfig.id),
      switchPlan,
      nextStrategy,
      logEvent: {
        message: "strategy_aligned",
        metadata: {
          absoluteConviction: published.absoluteConviction.toFixed(2),
          decisionStrength: published.decisionStrength.toFixed(2),
          nextStrategy: switchPlan.nextStrategyId,
          publishedRegime: published.marketRegime,
          reason: switchPlan.reason,
          targetFamily: switchPlan.targetFamily
        }
      },
      compactArchitectChangeMetadata: {
        nextStrategy: switchPlan.nextStrategyId,
        publishedFamily: published.recommendedFamily,
        publishedRegime: published.marketRegime,
        reason: switchPlan.reason,
        targetFamily: switchPlan.targetFamily
      }
    };
  }
}

module.exports = {
  ArchitectCoordinator
};
