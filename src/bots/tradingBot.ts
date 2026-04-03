// Module responsibility: real bot implementation composed from strategy, risk, performance and execution roles.

import type { BotConfig } from "../types/bot.ts";
import type { ArchitectAssessment } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";
import type { Strategy } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";
import type { ExitPolicy, InvalidationMode } from "../types/exitPolicy.ts";
import type { PositionExitMechanism } from "../types/positionLifecycle.ts";

const { BaseBot } = require("./baseBot.ts");
const { resolveLogType } = require("../utils/logger.ts");
const {
  beginPositionExit,
  closePositionLifecycle,
  enterManagedRecovery,
  getManagedRecoveryPolicy,
  getPositionLifecycleState,
  isManagedRecoveryPosition,
  POSITION_LIFECYCLE_EVENTS,
  resolveLifecycleEventFromReasons
} = require("../roles/positionLifecycleManager.ts");
const { resolveExitPolicy } = require("../roles/exitPolicyRegistry.ts");
const { resolveRecoveryTarget, resolveRecoveryTargetPolicy } = require("../roles/recoveryTargetResolver.ts");
const { now } = require("../utils/time.ts");

class TradingBot extends BaseBot {
  strategy: Strategy;
  allowedStrategies: string[];
  cooldownWindowLoggedUntil: number | null;
  cooldownWasActive: boolean;
  lastNonCooldownBlockReason: string | null;
  architectDivergenceActive: boolean;
  minEntryContextMaturity: number;
  minPostSwitchEntryContextMaturity: number;
  maxArchitectStateAgeMs: number;
  entrySlippageBufferPct: number;
  entryProfitSafetyBufferPct: number;
  minExpectedNetEdgePct: number;
  entryEvaluationLogSampleMs: number;
  lastEntryEvaluationLogKey: string | null;
  lastEntryEvaluationLogAt: number | null;
  compactLogSignatures: Record<string, string | null>;
  postLossArchitectLatchPublishesRequired: number;

  constructor(config: BotConfig, deps: any) {
    super(config, deps);
    this.strategy = deps.strategyRegistry.createStrategy(config.strategy);
    this.allowedStrategies = Array.isArray(config.allowedStrategies) && config.allowedStrategies.length > 0
      ? [...config.allowedStrategies]
      : [config.strategy];
    this.cooldownWindowLoggedUntil = null;
    this.cooldownWasActive = false;
    this.lastNonCooldownBlockReason = null;
    this.architectDivergenceActive = false;
    this.minEntryContextMaturity = 0.5;
    this.minPostSwitchEntryContextMaturity = 0.3;
    this.maxArchitectStateAgeMs = Math.max(
      Number.isFinite(Number(config.maxArchitectStateAgeMs))
        ? Number(config.maxArchitectStateAgeMs)
        : 90_000,
      0
    );
    this.entrySlippageBufferPct = 0.0005;
    this.entryProfitSafetyBufferPct = 0.0005;
    this.minExpectedNetEdgePct = 0.0005;
    this.entryEvaluationLogSampleMs = 30_000;
    this.lastEntryEvaluationLogKey = null;
    this.lastEntryEvaluationLogAt = null;
    this.compactLogSignatures = {};
    this.postLossArchitectLatchPublishesRequired = Math.max(
      Number.isFinite(Number(config.postLossArchitectLatchPublishesRequired))
        ? Number(config.postLossArchitectLatchPublishesRequired)
        : 2,
      1
    );
  }

  start() {
    if (this.started || !this.config.enabled) return;
    this.started = true;
    this.deps.store.updateBotState(this.config.id, { status: "running" });
    const nonRoutableStrategies = this.getNonRoutableAllowedStrategies();
    if (nonRoutableStrategies.length > 0) {
      this.deps.logger.bot(this.config, "non_routable_allowed_strategies", {
        allowedStrategies: this.allowedStrategies.join(","),
        nonRoutableStrategies: nonRoutableStrategies.join(","),
        note: "ignored_for_architect_family_switching"
      });
    }
    this.unsubscribe = this.deps.marketStream.subscribe(this.config.symbol, (tick: MarketTick) => {
      this.onMarketTick(tick);
    });
    this.deps.logger.bot(this.config, "started", { strategy: this.strategy.id });
  }

  stop() {
    super.stop();
    this.deps.store.updateBotState(this.config.id, { status: "stopped" });
    this.deps.logger.bot(this.config, "stopped");
  }

  buildContext(tick: MarketTick) {
    const priceSeries = this.deps.store.getRecentPrices(this.config.symbol, 120);
    const indicators = this.deps.indicatorEngine.createSnapshot(priceSeries);
    const position = this.deps.store.getPosition(this.config.id);
    const performance = this.deps.store.getPerformance(this.config.id);
    // Local regime remains informational for strategy-local diagnostics only.
    // System-level family routing comes from the published Architect decision.
    const regime = this.deps.regimeDetector.detect(priceSeries);

    return {
      botId: this.config.id,
      hasOpenPosition: Boolean(position),
      indicators,
      latestPrice: tick.price,
      localRegimeHint: regime,
      metadata: {
        updatedAt: tick.timestamp
      },
      performance: {
        avgTradePnlUsdt: performance?.avgTradePnlUsdt || 0,
        drawdown: performance?.drawdown || 0,
        pnl: performance?.pnl || 0,
        profitFactor: performance?.profitFactor || 0,
        tradesCount: performance?.tradesCount || 0,
        winRate: performance?.winRate || 0
      },
      prices: priceSeries,
      strategyId: this.strategy.id,
      symbol: this.config.symbol,
      timestamp: tick.timestamp,
      unrealizedPnl: position ? (tick.price - position.entryPrice) * position.quantity : 0
    };
  }

  logArchitectEntryShortCircuit(architectState: any) {
    const blockKey = `architect_not_usable_for_entry:${architectState?.blockReason || "unknown"}`;
    if (this.lastNonCooldownBlockReason === blockKey) {
      return;
    }

    this.lastNonCooldownBlockReason = blockKey;
    this.deps.logger.bot(this.config, "entry_blocked", {
      architectAgeMs: architectState?.architectAgeMs || null,
      architectBlockReason: architectState?.blockReason || null,
      architectStaleThresholdMs: architectState?.staleThresholdMs || null,
      reason: "architect_not_usable_for_entry"
    });
    this.emitCompactBotLog("BLOCK_CHANGE", {
      blockReason: "architect_not_usable_for_entry",
      botId: this.config.id,
      strategy: this.strategy.id,
      symbol: this.config.symbol
    }, "BLOCK_CHANGE");
  }

  buildEntryEvaluationLogKey(metadata: Record<string, any>) {
    return [
      metadata.outcome || "unknown",
      metadata.blockReason || "none",
      metadata.skipReason || "none",
      metadata.architectUsable ? "usable" : "blocked",
      metadata.signalEvaluated ? "evaluated" : "not_evaluated",
      metadata.decisionAction || "not_evaluated"
    ].join("|");
  }

  getLogType() {
    return resolveLogType(process.env.LOG_TYPE);
  }

  emitCompactBotLog(message: string, metadata: Record<string, unknown>, dedupeKey?: string, signatureOverride?: string) {
    if (this.getLogType() === "verbose") {
      return;
    }

    if (dedupeKey) {
      const signature = signatureOverride || JSON.stringify(metadata);
      if (this.compactLogSignatures[dedupeKey] === signature) {
        return;
      }
      this.compactLogSignatures[dedupeKey] = signature;
    }

    this.deps.logger.bot(this.config, message, metadata);
  }

  buildSetupLogMetadata(metadata: Record<string, any>) {
    return {
      allowReason: metadata.allowReason || null,
      blockReason: metadata.blockReason || null,
      botId: this.config.id,
      decisionAction: metadata.decisionAction || "not_evaluated",
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
      strategy: metadata.strategy || this.strategy.id,
      symbol: this.config.symbol
    };
  }

  buildSetupStateSignature(metadata: Record<string, any>) {
    const debounceRequired = Number(metadata.entryDebounceRequired || 0);
    const streak = Number(metadata.entrySignalStreak || 0);
    const readinessState = metadata.decisionAction !== "buy"
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

    return JSON.stringify({
      allowReason: metadata.allowReason || null,
      blockReason: metadata.blockReason || null,
      decisionAction: metadata.decisionAction || "not_evaluated",
      family: metadata.publishedFamily || metadata.targetFamily || null,
      readinessState,
      regime: metadata.publishedRegime || null,
      riskReason: metadata.riskReason || null,
      strategy: metadata.strategy || this.strategy.id
    });
  }

  maybeLogCompactSetup(metadata: Record<string, any>) {
    const entryDebounceRequired = Number(metadata.entryDebounceRequired || 0);
    const entrySignalStreak = Number(metadata.entrySignalStreak || 0);
    const nearReady = entryDebounceRequired > 0 && entrySignalStreak >= Math.max(entryDebounceRequired - 1, 1);
    const shouldLog = metadata.decisionAction === "buy"
      || Boolean(metadata.allowReason)
      || Boolean(metadata.blockReason)
      || nearReady;
    if (!shouldLog) {
      return;
    }

    this.emitCompactBotLog(
      "SETUP",
      this.buildSetupLogMetadata(metadata),
      "SETUP",
      this.buildSetupStateSignature(metadata)
    );
  }

  maybeLogCompactBlockChange(metadata: Record<string, any>) {
    if (!metadata.blockReason) {
      return;
    }

    const blockMetadata = {
      blockReason: metadata.blockReason,
      botId: this.config.id,
      decisionAction: metadata.decisionAction || "not_evaluated",
      entryDebounceRequired: metadata.entryDebounceRequired ?? null,
      entrySignalStreak: metadata.entrySignalStreak ?? 0,
      expectedNetEdgePct: metadata.expectedNetEdgePct ?? null,
      latestPrice: metadata.latestPrice ?? null,
      riskReason: metadata.riskReason || null,
      strategy: metadata.strategy || this.strategy.id,
      symbol: this.config.symbol
    };

    this.emitCompactBotLog("BLOCK_CHANGE", blockMetadata, "BLOCK_CHANGE", JSON.stringify({
      blockReason: blockMetadata.blockReason,
      decisionAction: blockMetadata.decisionAction,
      riskReason: blockMetadata.riskReason,
      strategy: blockMetadata.strategy
    }));
  }

  logCompactRiskChange(metadata: Record<string, unknown>) {
    this.emitCompactBotLog("RISK_CHANGE", {
      botId: this.config.id,
      strategy: this.strategy.id,
      symbol: this.config.symbol,
      ...metadata
    }, "RISK_CHANGE");
  }

  logCompactArchitectChange(metadata: Record<string, unknown>) {
    this.emitCompactBotLog("ARCHITECT_CHANGE", {
      botId: this.config.id,
      symbol: this.config.symbol,
      ...metadata
    }, "ARCHITECT_CHANGE");
  }

  logCompactBuy(metadata: Record<string, unknown>) {
    this.emitCompactBotLog("BUY", {
      botId: this.config.id,
      symbol: this.config.symbol,
      ...metadata
    });
  }

  logCompactSell(metadata: Record<string, unknown>) {
    this.emitCompactBotLog("SELL", {
      botId: this.config.id,
      symbol: this.config.symbol,
      ...metadata
    });
  }

  recordEntryEvaluationCounters(outcome: "allowed" | "blocked" | "opened" | "skipped", logged: boolean) {
    const state = this.deps.store.getBotState(this.config.id);
    if (!state) return;

    const patch: any = {
      entryEvaluationsCount: (state.entryEvaluationsCount || 0) + 1
    };
    if (logged) {
      patch.entryEvaluationLogsCount = (state.entryEvaluationLogsCount || 0) + 1;
    }
    if (outcome === "blocked") {
      patch.entryBlockedCount = (state.entryBlockedCount || 0) + 1;
    } else if (outcome === "skipped") {
      patch.entrySkippedCount = (state.entrySkippedCount || 0) + 1;
    } else if (outcome === "opened") {
      patch.entryOpenedCount = (state.entryOpenedCount || 0) + 1;
    } else if (outcome === "allowed") {
      patch.entryAllowedCount = (state.entryAllowedCount || 0) + 1;
    }

    this.deps.store.updateBotState(this.config.id, patch);
  }

  logEntryEvaluation(params: {
    allowReason?: string | null;
    architectState: any;
    blockReason?: string | null;
    context?: any;
    contextSnapshot: any;
    decision?: any;
    diagnostics?: any;
    economics: any;
    outcome: "allowed" | "blocked" | "opened" | "skipped";
    profile?: any;
    quantity: number | null;
    riskGate?: any;
    signalEvaluated?: boolean;
    signalState?: any;
    skipReason?: string | null;
    state?: any;
    strategyId: string;
    tick: MarketTick;
  }) {
    const baseDiagnostics = this.buildEntryDiagnostics({
      architectState: params.architectState,
      context: params.context,
      contextSnapshot: params.contextSnapshot,
      decision: params.decision,
      economics: params.economics,
      profile: params.profile,
      quantity: params.quantity,
      riskGate: params.riskGate,
      signalEvaluated: params.signalEvaluated,
      signalState: params.signalState,
      state: params.state,
      strategyId: params.strategyId,
      tick: params.tick
    });
    const diagnostics = params.diagnostics
      ? { ...baseDiagnostics, ...params.diagnostics }
      : baseDiagnostics;

    const metadata = {
      ...diagnostics,
      allowReason: params.allowReason || null,
      blockReason: params.blockReason || null,
      outcome: params.outcome,
      signalEvaluated: params.signalEvaluated !== false,
      skipReason: params.skipReason || null
    };
    this.maybeLogCompactSetup(metadata);
    this.maybeLogCompactBlockChange(metadata);
    const logAt = Number.isFinite(Number(params.tick?.timestamp)) ? Number(params.tick.timestamp) : now();
    const logKey = this.buildEntryEvaluationLogKey(metadata);
    const shouldLog = this.lastEntryEvaluationLogKey !== logKey
      || this.lastEntryEvaluationLogAt === null
      || (logAt - this.lastEntryEvaluationLogAt) >= this.entryEvaluationLogSampleMs;

    this.recordEntryEvaluationCounters(params.outcome, shouldLog);
    if (!shouldLog) {
      return;
    }

    this.lastEntryEvaluationLogKey = logKey;
    this.lastEntryEvaluationLogAt = logAt;
    this.deps.logger.bot(this.config, "entry_evaluated", metadata);
  }

  ensureCooldownState(timestamp: number) {
    const state = this.deps.store.getBotState(this.config.id);
    if (!state) return null;

    const cooldownActive = Boolean(state.cooldownUntil && state.cooldownUntil > timestamp);
    if (cooldownActive && !this.cooldownWasActive) {
      this.cooldownWasActive = true;
      this.cooldownWindowLoggedUntil = null;
      this.deps.logger.bot(this.config, "cooldown_started", {
        reason: state.cooldownReason || "cooldown_active",
        until: state.cooldownUntil
      });
      this.logCompactRiskChange({
        cooldownReason: state.cooldownReason || "cooldown_active",
        cooldownUntil: state.cooldownUntil || null,
        lossStreak: state.lossStreak || 0,
        status: "cooldown_started"
      });
      return state;
    }

    if (!cooldownActive && this.cooldownWasActive) {
      this.cooldownWasActive = false;
      this.cooldownWindowLoggedUntil = null;
      const profile = this.deps.riskManager.getProfile(this.config.riskProfile);
      const shouldRelaxLossStreak = state.cooldownReason === "loss_cooldown"
        && state.lossStreak >= profile.maxLossStreak;
      this.deps.store.updateBotState(this.config.id, {
        cooldownReason: null,
        cooldownUntil: null,
        lossStreak: shouldRelaxLossStreak
          ? Math.max(state.lossStreak - 1, 0)
          : state.lossStreak
      });
      this.deps.logger.bot(this.config, "cooldown_ended");
      this.logCompactRiskChange({
        cooldownReason: null,
        cooldownUntil: null,
        lossStreak: shouldRelaxLossStreak
          ? Math.max(state.lossStreak - 1, 0)
          : state.lossStreak,
        status: "cooldown_ended"
      });
      return this.deps.store.getBotState(this.config.id);
    }

    return state;
  }

  updateSignalState(params: {
    hasPosition: boolean;
    decisionAction: "buy" | "sell" | "hold";
    decisionReasons?: string[];
    managedRecoveryPriceTargetHit?: boolean;
    position?: PositionRecord | null;
    state: any;
    timestamp: number;
  }) {
    const cooldownActive = Boolean(params.state.cooldownUntil && params.state.cooldownUntil > params.timestamp);
    const decisionReasons = Array.isArray(params.decisionReasons) ? params.decisionReasons : [];
    const inManagedRecovery = isManagedRecoveryPosition(params.position || null);
    const managedRecoveryPriceTargetSignal = inManagedRecovery && Boolean(params.managedRecoveryPriceTargetHit);
    const nextEntrySignalStreak = cooldownActive
      ? params.state.entrySignalStreak
      : !params.hasPosition && params.decisionAction === "buy"
        ? params.state.entrySignalStreak + 1
        : 0;
    const nextExitSignalStreak = params.hasPosition && (
      (!inManagedRecovery && params.decisionAction === "sell")
      || managedRecoveryPriceTargetSignal
    )
      ? params.state.exitSignalStreak + 1
      : 0;

    this.deps.store.updateBotState(this.config.id, {
      entrySignalStreak: nextEntrySignalStreak,
      exitSignalStreak: nextExitSignalStreak
    });

    return this.deps.store.getBotState(this.config.id);
  }

  getPostLossArchitectLatchState(state?: any) {
    const runtimeState = state || this.deps.store.getBotState(this.config.id) || {};
    const publisher = this.deps.store.getArchitectPublisherState(this.config.symbol);
    const strategyId = runtimeState.postLossArchitectLatchStrategyId || null;
    const active = Boolean(runtimeState.postLossArchitectLatchActive);
    return {
      activatedAt: runtimeState.postLossArchitectLatchActivatedAt || null,
      active,
      blocking: active && Boolean(strategyId) && strategyId === this.strategy.id,
      freshPublishCount: Number(runtimeState.postLossArchitectLatchFreshPublishCount || 0),
      lastCountedPublishedAt: runtimeState.postLossArchitectLatchLastCountedPublishedAt || null,
      latestPublishedAt: publisher?.lastPublishedAt || null,
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      strategyId
    };
  }

  activatePostLossArchitectLatch(params: { closedAt: number; netPnl: number; strategyId: string }) {
    if (!(Number(params.netPnl) < 0)) {
      return;
    }

    this.deps.store.updateBotState(this.config.id, {
      postLossArchitectLatchActive: true,
      postLossArchitectLatchActivatedAt: params.closedAt,
      postLossArchitectLatchFreshPublishCount: 0,
      postLossArchitectLatchLastCountedPublishedAt: null,
      postLossArchitectLatchStrategyId: params.strategyId
    });
    this.deps.logger.bot(this.config, "post_loss_architect_latch_activated", {
      activatedAt: params.closedAt,
      netPnl: Number(Number(params.netPnl).toFixed(4)),
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      strategy: params.strategyId
    });
    this.logCompactRiskChange({
      freshPublishCount: 0,
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      status: "post_loss_architect_latch_activated",
      strategy: params.strategyId
    });
  }

  refreshPostLossArchitectLatch() {
    const state = this.deps.store.getBotState(this.config.id);
    if (!state?.postLossArchitectLatchActive) {
      return state;
    }

    const activatedAt = Number(state.postLossArchitectLatchActivatedAt || 0);
    const publisher = this.deps.store.getArchitectPublisherState(this.config.symbol);
    const latestPublishedAt = Number(publisher?.lastPublishedAt || 0);
    const lastCountedPublishedAt = Number(state.postLossArchitectLatchLastCountedPublishedAt || 0);

    if (!Number.isFinite(latestPublishedAt) || latestPublishedAt <= 0 || latestPublishedAt <= activatedAt || latestPublishedAt <= lastCountedPublishedAt) {
      return state;
    }

    const freshPublishCount = Number(state.postLossArchitectLatchFreshPublishCount || 0) + 1;
    this.deps.store.updateBotState(this.config.id, {
      postLossArchitectLatchFreshPublishCount: freshPublishCount,
      postLossArchitectLatchLastCountedPublishedAt: latestPublishedAt
    });
    this.deps.logger.bot(this.config, "post_loss_architect_latch_publish_counted", {
      freshPublishCount,
      lastPublishedAt: latestPublishedAt,
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      strategy: state.postLossArchitectLatchStrategyId || this.strategy.id
    });
    this.logCompactRiskChange({
      freshPublishCount,
      lastPublishedAt: latestPublishedAt,
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      status: "post_loss_architect_latch_publish_counted",
      strategy: state.postLossArchitectLatchStrategyId || this.strategy.id
    });

    if (freshPublishCount < this.postLossArchitectLatchPublishesRequired) {
      return this.deps.store.getBotState(this.config.id);
    }

    this.deps.store.updateBotState(this.config.id, {
      postLossArchitectLatchActive: false,
      postLossArchitectLatchActivatedAt: null,
      postLossArchitectLatchFreshPublishCount: freshPublishCount,
      postLossArchitectLatchLastCountedPublishedAt: latestPublishedAt,
      postLossArchitectLatchStrategyId: null
    });
    this.deps.logger.bot(this.config, "post_loss_architect_latch_released", {
      freshPublishCount,
      lastPublishedAt: latestPublishedAt,
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      strategy: state.postLossArchitectLatchStrategyId || this.strategy.id
    });
    this.logCompactRiskChange({
      freshPublishCount,
      lastPublishedAt: latestPublishedAt,
      requiredPublishes: this.postLossArchitectLatchPublishesRequired,
      status: "post_loss_architect_latch_released",
      strategy: state.postLossArchitectLatchStrategyId || this.strategy.id
    });
    return this.deps.store.getBotState(this.config.id);
  }

  classifyClosedTrade(closedTrade: any) {
    const exitReasons = Array.isArray(closedTrade?.exitReason)
      ? closedTrade.exitReason
      : Array.isArray(closedTrade?.reason)
        ? closedTrade.reason
        : [];
    const rsiExit = this.isRsiExitReason(exitReasons);
    const failedRsiExit = rsiExit && Number(closedTrade?.netPnl) < 0;
    return {
      closeClassification: failedRsiExit ? "failed_rsi_exit" : "confirmed_exit",
      failedRsiExit,
      rsiExit
    };
  }

  isRsiExitReason(exitReasons: string[]) {
    return exitReasons.includes("rsi_exit_confirmed") || exitReasons.includes("rsi_exit_threshold_hit");
  }

  getDecisionReasons(decision: any) {
    return Array.isArray(decision?.reason) ? decision.reason : [];
  }

  getPositionStatus(position: PositionRecord | null | undefined) {
    if (!position) return "flat";
    return getPositionLifecycleState(position);
  }

  getProtectiveStopLevel(position: PositionRecord | null | undefined) {
    if (!position) return null;
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile);
    if (!Number.isFinite(Number(position.entryPrice))) return null;
    return Number((Number(position.entryPrice) * (1 - profile.emergencyStopPct)).toFixed(4));
  }

  getProtectionStopMode() {
    const stopMode = String(this.getExitPolicy()?.protection?.stopMode || "fixed_pct");
    return stopMode === "structural_min" || stopMode === "atr_trailing" || stopMode === "fixed_pct"
      ? stopMode
      : "fixed_pct";
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

  resolveExitMechanism(exitReasons: string[], lifecycleEvent?: any): PositionExitMechanism | null {
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

  resolveInvalidationLevel(architectState: any, invalidationMode?: InvalidationMode | null) {
    return architectState?.blockReason || invalidationMode || null;
  }

  getArchitectTimingMetadata(timestamp: number) {
    const architect = this.getPublishedArchitectAssessment();
    const publisher = this.deps.store.getArchitectPublisherState(this.config.symbol);
    const publishedAt = publisher?.lastPublishedAt || architect?.updatedAt || null;
    return {
      architectDecisionAgeMs: architect?.updatedAt ? Math.max(0, timestamp - architect.updatedAt) : null,
      architectPublishAgeMs: publishedAt ? Math.max(0, timestamp - publishedAt) : null
    };
  }

  buildExitTelemetry(params: {
    architectState?: any;
    closedTrade?: any;
    exitMechanism?: PositionExitMechanism | null;
    executionTimestamp?: number | null;
    exitReasons: string[];
    invalidationMode?: InvalidationMode | null;
    lifecycleEvent?: any;
    invalidationLevel?: string | null;
    managedRecoveryTarget?: any;
    position: PositionRecord;
    protectionMode?: string | null;
    signalTimestamp: number;
    tick: MarketTick;
  }) {
    const exitPolicy = this.getExitPolicy();
    const managedRecoveryPolicy = getManagedRecoveryPolicy(exitPolicy);
    const signalTimestamp = Number(params.signalTimestamp);
    const executionTimestamp = Number.isFinite(Number(params.executionTimestamp))
      ? Number(params.executionTimestamp)
      : null;
    const architectTiming = this.getArchitectTimingMetadata(signalTimestamp);
    const timeoutRemainingMs = isManagedRecoveryPosition(params.position)
      ? Math.max(
          0,
          (Number(params.position.managedRecoveryStartedAt || params.position.openedAt || signalTimestamp) + managedRecoveryPolicy.timeoutMs) - signalTimestamp
        )
      : null;

    return {
      architectDecisionAgeMs: architectTiming.architectDecisionAgeMs,
      architectPublishAgeMs: architectTiming.architectPublishAgeMs,
      closeClassification: null,
      closeReason: params.exitReasons.join(","),
      exitMechanism: params.exitMechanism || this.resolveExitMechanism(params.exitReasons, params.lifecycleEvent),
      executionTimestamp,
      exitEvent: this.extractPrimaryExitEvent(params.exitReasons),
      invalidationMode: params.invalidationMode || null,
      lifecycleEvent: params.lifecycleEvent || resolveLifecycleEventFromReasons(params.exitReasons),
      fees: params.closedTrade ? Number(Number(params.closedTrade.fees || 0).toFixed(4)) : null,
      grossPnl: params.closedTrade ? Number(Number(params.closedTrade.pnl || 0).toFixed(4)) : null,
      invalidationLevel: params.invalidationLevel || this.resolveInvalidationLevel(params.architectState, params.invalidationMode),
      netPnl: params.closedTrade ? Number(Number(params.closedTrade.netPnl || 0).toFixed(4)) : null,
      policyId: exitPolicy?.id || null,
      positionStatus: this.getPositionStatus(params.position),
      protectionMode: params.protectionMode || null,
      signalTimestamp,
      signalToExecutionMs: executionTimestamp === null ? null : Math.max(0, executionTimestamp - signalTimestamp),
      stopLevel: this.getProtectiveStopLevel(params.position),
      targetPrice: Number.isFinite(Number(params.managedRecoveryTarget?.targetPrice))
        ? Number(Number(params.managedRecoveryTarget.targetPrice).toFixed(4))
        : null,
      targetSource: params.managedRecoveryTarget?.source || null,
      timeoutRemainingMs
    };
  }

  logManagedRecoveryUpdate(metadata: Record<string, unknown>) {
    const signature = JSON.stringify({
      exitEvent: metadata.exitEvent || null,
      invalidationLevel: metadata.invalidationLevel || null,
      positionStatus: metadata.positionStatus || null,
      status: metadata.status || null,
      targetPrice: metadata.targetPrice || null,
      timeoutRemainingMs: metadata.timeoutRemainingMs || null
    });

    this.emitCompactBotLog("RISK_CHANGE", {
      botId: this.config.id,
      strategy: this.strategy.id,
      symbol: this.config.symbol,
      ...metadata
    }, "MANAGED_RECOVERY", signature);
  }

  buildExitReason(decisionReasons: string[], primaryReason: string, confirmationTicks?: number | null) {
    const nextReasons = decisionReasons.filter((reason) =>
      reason !== "rsi_exit_threshold_hit"
      && reason !== "emergency_stop"
      && reason !== "managed_recovery_rsi_ignored"
    );
    if (!nextReasons.includes(primaryReason)) {
      nextReasons.push(primaryReason);
    }
    if (Number.isFinite(Number(confirmationTicks)) && Number(confirmationTicks) > 0) {
      nextReasons.push(`exit_confirmed_${Number(confirmationTicks)}ticks`);
    }
    return nextReasons;
  }

  estimateExitEconomics(position: PositionRecord, price: number) {
    if (typeof this.deps.executionEngine?.calculateCloseEconomics === "function") {
      return this.deps.executionEngine.calculateCloseEconomics(position, price);
    }

    const entryPrice = Math.max(Number(position?.entryPrice) || 0, 0);
    const exitPrice = Math.max(Number(price) || 0, 0);
    const quantity = Math.max(Number(position?.quantity) || 0, 0);
    const feeRate = Math.max(Number(this.deps.executionEngine?.feeRate) || 0, 0);
    const entryNotionalUsdt = entryPrice * quantity;
    const exitNotionalUsdt = exitPrice * quantity;
    const grossPnl = (exitPrice - entryPrice) * quantity;
    const fees = (entryNotionalUsdt + exitNotionalUsdt) * feeRate;
    return {
      entryNotionalUsdt,
      entryPrice,
      exitNotionalUsdt,
      exitPrice,
      fees,
      grossPnl,
      netPnl: grossPnl - fees,
      quantity
    };
  }

  getManagedRecoveryPolicy() {
    return getManagedRecoveryPolicy(this.getExitPolicy());
  }

  getExitPolicy(): ExitPolicy | null {
    const fallbackPolicyId = this.strategy?.id === "rsiReversion"
      ? "RSI_REVERSION_PRO"
      : null;
    return resolveExitPolicy(this.strategy?.config, fallbackPolicyId);
  }

  getRsiExitFloorNetPnlUsdt() {
    const exitPolicy = this.getExitPolicy();
    const estimatedCostMultiplier = Number(exitPolicy?.qualification?.estimatedCostMultiplier);
    const costMultiplier = Number.isFinite(estimatedCostMultiplier)
      ? estimatedCostMultiplier
      : 1;
    const minTickProfit = Number(exitPolicy?.qualification?.minTickProfit);
    const baseFloor = Number.isFinite(minTickProfit)
      ? minTickProfit
      : 0;
    const qualificationMode = String(exitPolicy?.qualification?.pnlExitFloorMode || "strict_net_positive");

    if (qualificationMode === "allow_small_loss_on_regime_risk") {
      return baseFloor * -1;
    }

    if (qualificationMode === "cost_buffered_positive") {
      return Math.max(baseFloor * costMultiplier, 0);
    }

    return Math.max(baseFloor, 0);
  }

  matchesInvalidationMode(architectState: any, mode: InvalidationMode) {
    const blockReason = architectState?.blockReason || null;
    if (mode === "family_mismatch") {
      return architectState?.familyMatch === false;
    }
    if (mode === "low_maturity") {
      return blockReason === "architect_low_maturity" || blockReason === "architect_post_switch_low_maturity";
    }
    if (mode === "unclear") {
      return blockReason === "architect_unclear";
    }
    if (mode === "no_trade") {
      return blockReason === "architect_no_trade";
    }
    if (mode === "not_ready") {
      return blockReason === "architect_not_ready" || blockReason === "missing_published_architect";
    }
    if (mode === "stale") {
      return blockReason === "architect_stale";
    }
    if (mode === "symbol_mismatch") {
      return blockReason === "architect_symbol_mismatch";
    }
    if (mode === "regime_change") {
      return architectState?.usable && architectState?.familyMatch === false;
    }
    if (mode === "extreme_volatility") {
      return false;
    }
    return false;
  }

  resolveManagedRecoveryInvalidation(architectState: any, decisionReasons: string[]) {
    const exitPolicy = this.getExitPolicy();
    const modes = Array.isArray(exitPolicy?.invalidation?.modes)
      ? exitPolicy.invalidation.modes
      : [];
    const invalidationMode = modes.find((mode) => this.matchesInvalidationMode(architectState, mode)) || null;
    if (!invalidationMode) {
      return null;
    }
    return {
      exitMechanism: "invalidation" as const,
      invalidationLevel: this.resolveInvalidationLevel(architectState, invalidationMode),
      invalidationMode,
      lifecycleEvent: POSITION_LIFECYCLE_EVENTS.REGIME_INVALIDATION,
      reason: this.buildExitReason(decisionReasons, "regime_invalidation_exit")
    };
  }

  isProtectiveExitTriggered(position: PositionRecord, price: number) {
    if (this.getProtectionStopMode() !== "fixed_pct") {
      return false;
    }
    return this.isEmergencyExit(position, price);
  }

  resolveProtectiveExit(position: PositionRecord, price: number, decisionReasons: string[]) {
    if (!this.isProtectiveExitTriggered(position, price)) {
      return null;
    }
    return {
      exitMechanism: "protection" as const,
      lifecycleEvent: POSITION_LIFECYCLE_EVENTS.PROTECTIVE_STOP_HIT,
      protectionMode: this.getProtectionStopMode(),
      reason: this.buildExitReason(decisionReasons, "protective_stop_exit")
    };
  }

  resolveManagedRecoveryTarget(params: { context: any; position: PositionRecord }) {
    const policy = this.getExitPolicy();
    const recoveryTargetPolicy = resolveRecoveryTargetPolicy(policy);
    const resolvedTarget = resolveRecoveryTarget({
      context: params.context,
      position: params.position,
      targetOffsetPct: recoveryTargetPolicy.targetOffsetPct,
      targetSource: recoveryTargetPolicy.targetSource
    });
    const latestPrice = Number(params.context?.latestPrice);
    return {
      ...resolvedTarget,
      hit: Boolean(
        Number.isFinite(Number(latestPrice))
        && Number.isFinite(Number(resolvedTarget.targetPrice))
        && Number(latestPrice) >= Number(resolvedTarget.targetPrice)
      )
    };
  }

  resolveManagedRecoveryPosition(position: PositionRecord, tick: MarketTick, exitFloorNetPnlUsdt: number) {
    const transition = enterManagedRecovery(position, {
      exitFloorNetPnlUsdt,
      reason: "rsi_exit_deferred",
      startedAt: tick.timestamp
    });
    return transition.allowed ? transition.position : null;
  }

  persistManagedRecoveryPosition(position: PositionRecord, metadata: Record<string, unknown>) {
    this.deps.store.setPosition(this.config.id, position);
    this.deps.store.updateBotState(this.config.id, {
      exitSignalStreak: 0
    });
    this.deps.logger.bot(this.config, "rsi_exit_deferred", metadata);
    this.logCompactRiskChange({
      ...metadata,
      status: "rsi_exit_deferred"
    });
  }

  isEmergencyExit(position: PositionRecord, price: number) {
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile);
    const drawdownPct = position.entryPrice > 0 ? ((position.entryPrice - price) / position.entryPrice) : 0;
    return drawdownPct >= profile.emergencyStopPct;
  }

  shouldExitPosition(params: {
    architectState?: any;
    decision: any;
    managedRecoveryTarget?: any;
    position: PositionRecord;
    signalState: any;
    tick: MarketTick;
  }) {
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile);
    const holdMs = params.tick.timestamp - params.position.openedAt;
    const decisionReasons = this.getDecisionReasons(params.decision);
    const protectiveExit = this.resolveProtectiveExit(params.position, params.tick.price, decisionReasons);
    const exitPolicy = this.getExitPolicy();
    const inManagedRecovery = isManagedRecoveryPosition(params.position);
    const managedRecoveryPolicy = getManagedRecoveryPolicy(exitPolicy);
    const meanReversionPosition = params.position.strategyId === "rsiReversion";
    const priceTargetHit = inManagedRecovery
      ? Boolean(params.managedRecoveryTarget?.hit)
      : decisionReasons.includes("reversion_price_target_hit");
    const rsiExitThresholdHit = decisionReasons.includes("rsi_exit_threshold_hit");

    if (inManagedRecovery) {
      if (protectiveExit) {
        return {
          exitNow: true,
          ...protectiveExit
        };
      }

      const managedRecoveryStartedAt = Number(params.position.managedRecoveryStartedAt || params.position.openedAt || 0);
      if ((params.tick.timestamp - managedRecoveryStartedAt) >= managedRecoveryPolicy.timeoutMs) {
        return {
          exitMechanism: "recovery" as const,
          exitNow: true,
          lifecycleEvent: POSITION_LIFECYCLE_EVENTS.RECOVERY_TIMEOUT,
          reason: this.buildExitReason(decisionReasons, "time_exhaustion_exit")
        };
      }

      const invalidationExit = params.architectState
        ? this.resolveManagedRecoveryInvalidation(params.architectState, decisionReasons)
        : null;
      if (invalidationExit) {
        return {
          exitNow: true,
          ...invalidationExit
        };
      }

      if (priceTargetHit && params.signalState.exitSignalStreak >= profile.exitConfirmationTicks) {
        return {
          exitMechanism: "recovery" as const,
          exitNow: true,
          lifecycleEvent: POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT,
          reason: this.buildExitReason(decisionReasons, "reversion_price_target_hit", profile.exitConfirmationTicks)
        };
      }

      return {
        exitNow: false,
        reason: rsiExitThresholdHit
          ? ["managed_recovery_rsi_ignored"]
          : decisionReasons
      };
    }

    if (protectiveExit) {
      return {
        exitNow: true,
        ...protectiveExit
      };
    }

    if (holdMs < profile.minHoldMs) {
      return {
        exitNow: false,
        reason: [...decisionReasons, `minimum_hold_${profile.minHoldMs}ms`]
      };
    }

    if (params.decision.action === "sell" && params.signalState.exitSignalStreak >= profile.exitConfirmationTicks) {
      if (meanReversionPosition && rsiExitThresholdHit) {
        const estimatedExitEconomics = this.estimateExitEconomics(params.position, params.tick.price);
        const exitFloorNetPnlUsdt = this.getRsiExitFloorNetPnlUsdt();
        if (estimatedExitEconomics.netPnl < exitFloorNetPnlUsdt) {
          return {
            estimatedExitEconomics,
            exitMechanism: "qualification" as const,
            exitNow: false,
            lifecycleEvent: POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT,
            nextPosition: this.resolveManagedRecoveryPosition(params.position, params.tick, exitFloorNetPnlUsdt),
            reason: this.buildExitReason(decisionReasons, "rsi_exit_deferred"),
            transition: "managed_recovery"
          };
        }

        return {
          exitMechanism: "qualification" as const,
          exitNow: true,
          lifecycleEvent: POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT,
          reason: this.buildExitReason(decisionReasons, "rsi_exit_confirmed", profile.exitConfirmationTicks)
        };
      }

      return {
        exitMechanism: meanReversionPosition && priceTargetHit
          ? "recovery"
          : null,
        exitNow: true,
        lifecycleEvent: meanReversionPosition && priceTargetHit
          ? POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT
          : null,
        reason: meanReversionPosition && priceTargetHit
          ? this.buildExitReason(decisionReasons, "reversion_price_target_hit", profile.exitConfirmationTicks)
          : [...decisionReasons, `exit_confirmed_${profile.exitConfirmationTicks}ticks`]
      };
    }

    return {
      exitNow: false,
      reason: decisionReasons
    };
  }

  logEntryBlocked(state: any, reason: string) {
    if (reason === "loss_cooldown" || reason === "post_exit_reentry_guard" || reason === "cooldown_active") {
      const cooldownUntil = state.cooldownUntil || null;
      if (cooldownUntil && this.cooldownWindowLoggedUntil !== cooldownUntil) {
        this.cooldownWindowLoggedUntil = cooldownUntil;
        this.deps.logger.bot(this.config, "entry_blocked", {
          reason: "cooldown_active",
          until: cooldownUntil
        });
      }
      return;
    }

    if (this.lastNonCooldownBlockReason !== reason) {
      this.lastNonCooldownBlockReason = reason;
      const postLossArchitectLatch = reason === "post_loss_architect_latch"
        ? this.getPostLossArchitectLatchState(state)
        : null;
      this.deps.logger.bot(this.config, "entry_blocked", {
        postLossArchitectLatchActive: postLossArchitectLatch?.active ?? null,
        postLossArchitectLatchFreshPublishCount: postLossArchitectLatch?.freshPublishCount ?? null,
        postLossArchitectLatchRequiredPublishes: postLossArchitectLatch?.requiredPublishes ?? null,
        reason
      });
    }
  }

  getNonRoutableAllowedStrategies() {
    if (typeof this.deps.strategySwitcher?.getNonRoutableStrategies === "function") {
      return this.deps.strategySwitcher.getNonRoutableStrategies(this.allowedStrategies);
    }
    return (this.allowedStrategies || []).filter((strategyId) => {
      if (typeof this.deps.strategySwitcher?.getStrategyFamily !== "function") return false;
      return this.deps.strategySwitcher.getStrategyFamily(strategyId) === "other";
    });
  }

  getPublishedArchitectAssessment(): ArchitectAssessment | null {
    return this.deps.store.getArchitectPublishedAssessment(this.config.symbol);
  }

  resolveArchitectMaturityBlockReason(contextSnapshot: any) {
    if (contextSnapshot?.windowMode === "post_switch_segment") {
      return "architect_post_switch_low_maturity";
    }
    return "architect_low_maturity";
  }

  resolveEntryMaturityThreshold(contextSnapshot: any) {
    if (contextSnapshot?.windowMode === "post_switch_segment") {
      return this.minPostSwitchEntryContextMaturity;
    }
    return this.minEntryContextMaturity;
  }

  evaluateArchitectUsability(params: {
    currentFamily?: string | null;
    timestamp?: number;
  } = {}) {
    const architect = this.getPublishedArchitectAssessment();
    const contextSnapshot = this.deps.store.getContextSnapshot(this.config.symbol);
    const publisher = this.deps.store.getArchitectPublisherState(this.config.symbol);
    const evaluatedAt = Number.isFinite(Number(params.timestamp)) ? Number(params.timestamp) : now();
    const entryMaturityThreshold = this.resolveEntryMaturityThreshold(contextSnapshot);
    const currentFamily = params.currentFamily || this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const architectAgeMs = architect?.updatedAt ? Math.max(0, evaluatedAt - architect.updatedAt) : null;
    const staleThresholdMs = Math.max((publisher?.publishIntervalMs || 30_000) * 2, this.maxArchitectStateAgeMs);
    const architectStale = architectAgeMs !== null && architectAgeMs > staleThresholdMs;
    const actionableFamily = architect?.recommendedFamily && architect.recommendedFamily !== "no_trade"
      ? architect.recommendedFamily
      : null;

    let blockReason = null;
    if (!architect) {
      blockReason = "missing_published_architect";
    } else if (architect.symbol && architect.symbol !== this.config.symbol) {
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

  updateArchitectSyncState(position: PositionRecord | null, timestamp?: number) {
    const state = this.deps.store.getBotState(this.config.id);
    if (!state) return null;

    const currentFamily = this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const architectState = this.evaluateArchitectUsability({
      currentFamily,
      timestamp
    });
    const published = architectState.architect;
    const waitingForFlat = Boolean(position) && architectState.usable && architectState.familyMatch === false;
    const flatMisaligned = !position && architectState.usable && architectState.familyMatch === false;
    const nextStatus = !architectState.usable || flatMisaligned
      ? "pending"
      : waitingForFlat
        ? "waiting_flat"
        : "synced";

    this.deps.store.updateBotState(this.config.id, {
      architectRecommendedFamily: published?.recommendedFamily || null,
      architectRecommendationStreak: 0,
      architectSyncStatus: nextStatus,
      lastArchitectAssessmentAt: published?.updatedAt || null
    });

    const divergenceActive = architectState.usable && Boolean(architectState.actionableFamily) && architectState.familyMatch === false;
    if (divergenceActive !== this.architectDivergenceActive) {
      this.architectDivergenceActive = divergenceActive;
      if (divergenceActive) {
        this.deps.logger.bot(this.config, "architect_strategy_divergence", {
          currentFamily,
          publishedAt: published?.updatedAt || null,
          recommendedFamily: architectState.actionableFamily,
          syncStatus: nextStatus
        });
      }
    }

    return {
      architectState,
      published,
      state: this.deps.store.getBotState(this.config.id)
    };
  }

  maybeApplyPublishedArchitect(position: PositionRecord | null, timestamp?: number) {
    const state = this.deps.store.getBotState(this.config.id);
    if (!state) return;
    if (position) return;

    const currentFamily = this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const architectState = this.evaluateArchitectUsability({
      currentFamily,
      timestamp
    });
    if (!architectState.usable || !architectState.actionableFamily || architectState.familyMatch !== false) return;

    const published = architectState.architect;
    if (!published) return;

    const switchPlan = this.deps.strategySwitcher.evaluate({
      architect: published,
      availableStrategies: this.allowedStrategies,
      botConfig: this.config,
      now: Number.isFinite(Number(timestamp)) ? Number(timestamp) : now(),
      positionOpen: Boolean(position),
      state
    });

    if (!switchPlan) return;
    const livePosition = this.deps.store.getPosition(this.config.id);
    if (livePosition) {
      this.updateArchitectSyncState(livePosition, timestamp);
      this.deps.logger.bot(this.config, "strategy_alignment_skipped", {
        nextStrategy: switchPlan.nextStrategyId,
        reason: "position_opened_before_apply",
        targetFamily: switchPlan.targetFamily
      });
      return;
    }
    this.strategy = this.deps.strategyRegistry.createStrategy(switchPlan.nextStrategyId);
    this.deps.store.updateBotState(this.config.id, {
      activeStrategyId: switchPlan.nextStrategyId,
      architectSyncStatus: "synced",
      lastStrategySwitchAt: Number.isFinite(Number(timestamp)) ? Number(timestamp) : now()
    });
    this.deps.logger.bot(this.config, "strategy_aligned", {
      absoluteConviction: published.absoluteConviction.toFixed(2),
      decisionStrength: published.decisionStrength.toFixed(2),
      nextStrategy: switchPlan.nextStrategyId,
      publishedRegime: published.marketRegime,
      reason: switchPlan.reason,
      targetFamily: switchPlan.targetFamily
    });
    this.logCompactArchitectChange({
      nextStrategy: switchPlan.nextStrategyId,
      publishedFamily: published.recommendedFamily,
      publishedRegime: published.marketRegime,
      reason: switchPlan.reason,
      targetFamily: switchPlan.targetFamily
    });
  }

  estimateEntryEconomics(params: {
    context: any;
    price: number;
    quantity: number | null;
  }) {
    const latestPrice = Math.max(Number(params.price) || 0, 1e-8);
    const indicators = params.context?.indicators || {};
    const emaFast = Number(indicators.emaFast);
    const emaSlow = Number(indicators.emaSlow);
    const momentum = Number(indicators.momentum);
    const meanReversionGapPct = Number.isFinite(emaSlow)
      ? Math.abs(latestPrice - emaSlow) / latestPrice
      : 0;
    const downsideMeanReversionGapPct = Number.isFinite(emaSlow)
      ? Math.max(0, emaSlow - latestPrice) / latestPrice
      : 0;
    const emaGapPct = Number.isFinite(emaFast) && Number.isFinite(emaSlow)
      ? Math.abs(emaFast - emaSlow) / latestPrice
      : 0;
    const momentumEdgePct = Number.isFinite(momentum)
      ? Math.abs(momentum) / latestPrice
      : 0;
    const exitTarget = Number.isFinite(emaSlow)
      ? emaSlow * 1.015
      : latestPrice;
    const captureGapPct = Number.isFinite(emaSlow)
      ? Math.min(0.03, Math.max(0, exitTarget - latestPrice) / latestPrice)
      : 0;
    const strategyId = params.context?.strategyId || this.strategy?.id || "";
    const expectedGrossEdgePct = strategyId === "rsiReversion"
      ? Math.min(0.02, Math.max(0,
        (0.7 * captureGapPct) +
        (0.2 * downsideMeanReversionGapPct) +
        (0.07 * emaGapPct) +
        (0.03 * momentumEdgePct)
      ))
      : strategyId === "emaCross"
        ? Math.max(0, (0.5 * emaGapPct) + (0.35 * momentumEdgePct) + (0.15 * meanReversionGapPct))
        : Math.max(0, (0.4 * meanReversionGapPct) + (0.35 * emaGapPct) + (0.25 * momentumEdgePct));
    const resolvedFeeRate = Number(this.deps.executionEngine?.feeRate);
    const feeRate = Math.max(Number.isFinite(resolvedFeeRate) ? resolvedFeeRate : 0, 0);
    const estimatedEntryFeePct = feeRate;
    const estimatedExitFeePct = feeRate;
    const estimatedSlippagePct = this.entrySlippageBufferPct;
    const profitSafetyBufferPct = this.entryProfitSafetyBufferPct;
    const requiredEdgePct = estimatedEntryFeePct + estimatedExitFeePct + estimatedSlippagePct + profitSafetyBufferPct;
    const expectedNetEdgePct = expectedGrossEdgePct - requiredEdgePct;
    const configuredMinExpectedNetEdgePct = Number(this.strategy?.config?.minExpectedNetEdgePct);
    const minExpectedNetEdgePct = Math.max(
      Number.isFinite(configuredMinExpectedNetEdgePct)
        ? configuredMinExpectedNetEdgePct
        : this.minExpectedNetEdgePct,
      0
    );
    const quantity = Number.isFinite(Number(params.quantity)) ? Number(params.quantity) : 0;
    const notionalUsdt = latestPrice * Math.max(quantity, 0);

    return {
      estimatedEntryFeePct,
      estimatedExitFeePct,
      estimatedRoundTripFeesUsdt: notionalUsdt * (estimatedEntryFeePct + estimatedExitFeePct),
      estimatedSlippagePct,
      expectedGrossEdgePct,
      expectedGrossEdgeUsdt: notionalUsdt * expectedGrossEdgePct,
      expectedNetEdgePct,
      minExpectedNetEdgePct,
      notionalUsdt,
      profitSafetyBufferPct,
      requiredEdgePct
    };
  }

  buildEntryDiagnostics(params: {
    architectState: any;
    context?: any;
    contextSnapshot: any;
    decision?: any;
    economics: any;
    profile?: any;
    quantity: number | null;
    riskGate?: any;
    signalEvaluated?: boolean;
    signalState?: any;
    state?: any;
    strategyId: string;
    tick: MarketTick;
  }) {
    const architect = params.architectState.architect;
    const tradeConstraints = this.deps.riskManager.getTradeConstraints();
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
    const entryMaturityThreshold = Number(Number(
      params.architectState.entryMaturityThreshold ?? this.resolveEntryMaturityThreshold(params.contextSnapshot)
    ).toFixed(4));
    const postSwitchWarmupActive = contextWindowMode === "post_switch_segment"
      && contextMaturity !== null
      && contextMaturity < entryMaturityThreshold;
    const architectPublishedAt = params.architectState.publisher?.lastPublishedAt || architect?.updatedAt || null;
    const architectSymbol = architect?.symbol || null;
    const architectSymbolMatch = architectSymbol ? architectSymbol === this.config.symbol : null;
    const contextSymbol = params.contextSnapshot?.symbol || null;
    const contextSymbolMatch = contextSymbol ? contextSymbol === this.config.symbol : null;
    const tickSymbol = params.tick?.symbol || null;
    const tickSymbolMatch = tickSymbol ? tickSymbol === this.config.symbol : null;
    const debounceRequired = params.profile?.entryDebounceTicks ?? null;
    const entrySignalStreak = signalState?.entrySignalStreak ?? state.entrySignalStreak ?? 0;
    const postLossArchitectLatch = this.getPostLossArchitectLatchState(state);

    return {
      architectAuthoritative: Boolean(architect),
      architectAgeMs: params.architectState.architectAgeMs,
      architectBlockReason: params.architectState.blockReason,
      architectObservedUsed: false,
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
      architectSyntheticUsed: false,
      architectUpdatedAt: architect?.updatedAt || null,
      architectUsable: params.architectState.usable,
      botId: this.config.id,
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
      entryMaturityThreshold,
      entryDebounceRequired: debounceRequired,
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
      minExpectedNetEdgePct: Number(params.economics.minExpectedNetEdgePct.toFixed(4)),
      minNotionalUsdt: Number(tradeConstraints.minNotionalUsdt.toFixed(4)),
      minQuantity: Number(tradeConstraints.minQuantity.toFixed(8)),
      notionalUsdt: Number(params.economics.notionalUsdt.toFixed(4)),
      postLossArchitectLatchActive: postLossArchitectLatch.active,
      postLossArchitectLatchActivatedAt: postLossArchitectLatch.activatedAt,
      postLossArchitectLatchBlocking: postLossArchitectLatch.blocking,
      postLossArchitectLatchFreshPublishCount: postLossArchitectLatch.freshPublishCount,
      postLossArchitectLatchRequiredPublishes: postLossArchitectLatch.requiredPublishes,
      postLossArchitectLatchStrategyId: postLossArchitectLatch.strategyId,
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
      strategyRsi,
      strategyRsiSource: strategyRsi === null ? null : "strategy_indicator_snapshot",
      strategy: params.strategyId,
      targetFamily: params.architectState.actionableFamily || null,
      symbol: this.config.symbol,
      tickSymbol,
      tickSymbolMatch,
      tickTimestamp: params.tick?.timestamp || null,
      effectiveWindowStartedAt
    };
  }

  evaluateFinalEntryGate(params: {
    context: any;
    decision: any;
    quantity: number;
    tick: MarketTick;
  }) {
    const contextSnapshot = this.deps.store.getContextSnapshot(this.config.symbol);
    const currentFamily = this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const architectState = this.evaluateArchitectUsability({
      currentFamily,
      timestamp: params.tick.timestamp
    });
    const economics = this.estimateEntryEconomics({
      context: params.context,
      price: params.tick.price,
      quantity: params.quantity
    });
    const tradeConstraints = this.deps.riskManager.getTradeConstraints();
    const diagnostics = this.buildEntryDiagnostics({
      architectState,
      context: params.context,
      contextSnapshot,
      decision: params.decision,
      economics,
      profile: this.deps.riskManager.getProfile(this.config.riskProfile),
      quantity: params.quantity,
      signalEvaluated: true,
      state: this.deps.store.getBotState(this.config.id),
      strategyId: this.strategy.id,
      tick: params.tick
    });
    const postLossArchitectLatch = this.getPostLossArchitectLatchState();

    if (!architectState.usable) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: architectState.blockReason } };
    }
    if (architectState.familyMatch === false) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "strategy_family_mismatch" } };
    }
    if (postLossArchitectLatch.blocking) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "post_loss_architect_latch" } };
    }
    if (economics.notionalUsdt < tradeConstraints.minNotionalUsdt) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "notional_below_minimum" } };
    }
    if (params.quantity < tradeConstraints.minQuantity) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "quantity_below_minimum" } };
    }
    if (economics.expectedNetEdgePct < economics.minExpectedNetEdgePct) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "insufficient_edge_after_costs" } };
    }

    return {
      allowed: true,
      architect: architectState.architect,
      diagnostics: { ...diagnostics, blockReason: "allowed" }
    };
  }

  onMarketTick(tick: MarketTick) {
    let state = this.ensureCooldownState(tick.timestamp);
    if (!state || state.status === "stopped") return;

    this.deps.store.updateBotState(this.config.id, {
      lastTickAt: tick.timestamp
    });
    state = this.refreshPostLossArchitectLatch() || this.deps.store.getBotState(this.config.id);

    state = this.deps.store.getBotState(this.config.id);
    if (!state || (state.status === "paused" && state.pausedReason === "max_drawdown_reached")) {
      return;
    }

    const currentPosition = this.deps.store.getPosition(this.config.id);
    this.updateArchitectSyncState(currentPosition, tick.timestamp);
    this.maybeApplyPublishedArchitect(currentPosition, tick.timestamp);

    const positionBeforeDecision = this.deps.store.getPosition(this.config.id);
    const architectState = !positionBeforeDecision
      ? this.evaluateArchitectUsability({
          currentFamily: this.deps.strategySwitcher.getStrategyFamily(this.strategy.id),
          timestamp: tick.timestamp
        })
      : null;

    if (!positionBeforeDecision && architectState && !architectState.usable) {
      const shortCircuitState = this.deps.store.getBotState(this.config.id);
      const shortCircuitEconomics = this.estimateEntryEconomics({
        context: null,
        price: tick.price,
        quantity: null
      });
      const shortCircuitContextSnapshot = this.deps.store.getContextSnapshot(this.config.symbol);
      this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, now());
      this.deps.store.updateBotState(this.config.id, {
        entrySignalStreak: 0,
        exitSignalStreak: 0,
        lastDecision: "hold",
        lastDecisionConfidence: 0,
        lastDecisionReasons: [
          "architect_not_usable_for_entry",
          architectState.blockReason
        ].filter(Boolean)
      });
      this.logEntryEvaluation({
        architectState,
        blockReason: architectState.blockReason,
        context: null,
        contextSnapshot: shortCircuitContextSnapshot,
        decision: null,
        economics: shortCircuitEconomics,
        outcome: "blocked",
        profile: this.deps.riskManager.getProfile(this.config.riskProfile),
        quantity: null,
        signalEvaluated: false,
        state: this.deps.store.getBotState(this.config.id) || shortCircuitState,
        strategyId: this.strategy.id,
        tick
      });
      this.logArchitectEntryShortCircuit(architectState);
      return;
    }

    const context = this.buildContext(tick);
    const decision = this.strategy.evaluate(context);
    this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, now());
    this.deps.store.updateBotState(this.config.id, {
      lastDecision: decision.action,
      lastDecisionConfidence: decision.confidence,
      lastDecisionReasons: decision.reason
    });

    const position = this.deps.store.getPosition(this.config.id);
    const managedRecoveryTarget = position && isManagedRecoveryPosition(position)
      ? this.resolveManagedRecoveryTarget({ context, position })
      : null;
    const performance = this.deps.store.getPerformance(this.config.id);
    const signalState = this.updateSignalState({
      decisionAction: decision.action,
      decisionReasons: decision.reason,
      hasPosition: Boolean(position),
      managedRecoveryPriceTargetHit: managedRecoveryTarget?.hit,
      position,
      state: this.deps.store.getBotState(this.config.id),
      timestamp: tick.timestamp
    });
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile);

    if (!position) {
      const latestContextSnapshot = this.deps.store.getContextSnapshot(this.config.symbol);
      const currentArchitectState = architectState || this.evaluateArchitectUsability({
        currentFamily: this.deps.strategySwitcher.getStrategyFamily(this.strategy.id),
        timestamp: tick.timestamp
      });
      const riskGate = this.deps.riskManager.canOpenTrade({
        now: tick.timestamp,
        performance,
        positionOpen: false,
        riskProfile: this.config.riskProfile,
        state: signalState
      });
      const baseEconomics = this.estimateEntryEconomics({
        context,
        price: tick.price,
        quantity: null
      });
      const evaluationState = this.deps.store.getBotState(this.config.id);

      if (decision.action === "buy" && riskGate.allowed && signalState.entrySignalStreak >= profile.entryDebounceTicks) {
        const sizing = this.deps.riskManager.calculatePositionSize({
          balanceUsdt: signalState.availableBalanceUsdt,
          confidence: decision.confidence,
          latestPrice: tick.price,
          performance,
          riskProfile: this.config.riskProfile,
          state: signalState
        });

        if (sizing.quantity <= 0) {
          const sizingEconomics = this.estimateEntryEconomics({
            context,
            price: tick.price,
            quantity: sizing.quantity
          });
          this.logEntryEvaluation({
            architectState: currentArchitectState,
            contextSnapshot: latestContextSnapshot,
            context,
            decision,
            economics: sizingEconomics,
            outcome: "skipped",
            profile,
            quantity: sizing.quantity,
            riskGate,
            signalEvaluated: true,
            signalState,
            skipReason: "quantity_non_positive",
            state: evaluationState,
            strategyId: this.strategy.id,
            tick
          });
          this.lastNonCooldownBlockReason = null;
          return;
        }

        const finalEntryGate = this.evaluateFinalEntryGate({
          context,
          decision,
          quantity: sizing.quantity,
          tick
        });
        if (!finalEntryGate.allowed) {
          this.logEntryEvaluation({
            architectState: currentArchitectState,
            blockReason: finalEntryGate.diagnostics.blockReason,
            context,
            contextSnapshot: latestContextSnapshot,
            decision,
            diagnostics: finalEntryGate.diagnostics,
            economics: this.estimateEntryEconomics({
              context,
              price: tick.price,
              quantity: sizing.quantity
            }),
            outcome: "blocked",
            profile,
            quantity: sizing.quantity,
            riskGate,
            signalEvaluated: true,
            signalState,
            state: evaluationState,
            strategyId: this.strategy.id,
            tick
          });
          this.deps.logger.bot(this.config, "entry_gate_blocked", finalEntryGate.diagnostics);
          if (finalEntryGate.diagnostics.blockReason === "post_loss_architect_latch") {
            this.logEntryBlocked(evaluationState, "post_loss_architect_latch");
          }
          this.lastNonCooldownBlockReason = finalEntryGate.diagnostics.blockReason;
          return;
        }

        const publishedArchitect = finalEntryGate.architect;
        const opened = this.deps.executionEngine.openLong({
          botId: this.config.id,
          confidence: decision.confidence,
          price: tick.price,
          quantity: sizing.quantity,
          reason: [...decision.reason, `entry_confirmed_${profile.entryDebounceTicks}ticks`],
          strategyId: this.strategy.id,
          symbol: this.config.symbol
        });
        if (!opened) {
          const executionConstraints = typeof this.deps.executionEngine.getTradeConstraints === "function"
            ? this.deps.executionEngine.getTradeConstraints()
            : this.deps.riskManager.getTradeConstraints();
          const executionNotionalUsdt = tick.price * Math.max(sizing.quantity, 0);
          const executionRejectReason = sizing.quantity < executionConstraints.minQuantity
            ? "execution_quantity_below_minimum"
            : executionNotionalUsdt < executionConstraints.minNotionalUsdt
              ? "execution_notional_below_minimum"
              : "execution_open_rejected";
          const executionDiagnostics = {
            ...finalEntryGate.diagnostics,
            minNotionalUsdt: Number(Number(executionConstraints.minNotionalUsdt || 0).toFixed(4)),
            minQuantity: Number(Number(executionConstraints.minQuantity || 0).toFixed(8)),
            notionalUsdt: Number(executionNotionalUsdt.toFixed(4)),
            quantity: Number(Number(sizing.quantity).toFixed(8))
          };
          this.logEntryEvaluation({
            architectState: currentArchitectState,
            blockReason: executionRejectReason,
            context,
            contextSnapshot: latestContextSnapshot,
            decision,
            diagnostics: executionDiagnostics,
            economics: this.estimateEntryEconomics({
              context,
              price: tick.price,
              quantity: sizing.quantity
            }),
            outcome: "blocked",
            profile,
            quantity: sizing.quantity,
            riskGate,
            signalEvaluated: true,
            signalState,
            state: evaluationState,
            strategyId: this.strategy.id,
            tick
          });
          this.logEntryBlocked(signalState, executionRejectReason);
          return;
        }

        this.deps.logger.bot(this.config, "entry_gate_allowed", finalEntryGate.diagnostics);
        this.logEntryEvaluation({
          allowReason: "entry_opened",
          architectState: currentArchitectState,
          context,
          contextSnapshot: latestContextSnapshot,
          decision,
          diagnostics: finalEntryGate.diagnostics,
          economics: this.estimateEntryEconomics({
            context,
            price: tick.price,
            quantity: sizing.quantity
          }),
          outcome: "opened",
          profile,
          quantity: sizing.quantity,
          riskGate,
          signalEvaluated: true,
          signalState,
          state: evaluationState,
          strategyId: this.strategy.id,
          tick
        });
        this.deps.store.updateBotState(this.config.id, {
          availableBalanceUsdt: Math.max(0, signalState.availableBalanceUsdt - (opened.quantity * opened.entryPrice)),
          entrySignalStreak: 0,
          exitSignalStreak: 0,
          lastExecutionAt: opened.openedAt,
          lastTradeAt: now()
        });
        this.deps.store.recordExecution(this.config.id, this.config.symbol, opened.openedAt);
        this.deps.logger.bot(this.config, "entry_opened", {
          decisionStrength: publishedArchitect ? Number(publishedArchitect.decisionStrength.toFixed(4)) : null,
          publishedFamily: publishedArchitect?.recommendedFamily || null,
          publishedRegime: publishedArchitect?.marketRegime || null,
          signalAgreement: publishedArchitect ? Number(publishedArchitect.signalAgreement.toFixed(4)) : null,
          strategy: this.strategy.id,
          symbol: this.config.symbol
        });
        this.logCompactBuy({
          decisionConfidence: Number(Number(decision.confidence || 0).toFixed(4)),
          expectedGrossEdgePct: Number(Number(finalEntryGate.diagnostics.expectedGrossEdgePct || 0).toFixed(4)),
          expectedNetEdgePct: Number(Number(finalEntryGate.diagnostics.expectedNetEdgePct || 0).toFixed(4)),
          latestPrice: Number(Number(tick.price || 0).toFixed(4)),
          quantity: Number(Number(opened.quantity || 0).toFixed(8)),
          strategy: this.strategy.id
        });
        this.lastNonCooldownBlockReason = null;
        return;
      }

      if (decision.action === "buy" && !riskGate.allowed) {
        const blockedDiagnostics = {
          ...this.buildEntryDiagnostics({
            architectState: currentArchitectState,
            context,
            contextSnapshot: latestContextSnapshot,
            decision,
            economics: baseEconomics,
            profile,
            quantity: null,
            riskGate,
            signalEvaluated: true,
            signalState,
            state: evaluationState,
            strategyId: this.strategy.id,
            tick
          }),
          blockReason: riskGate.reason
        };
        this.logEntryEvaluation({
          architectState: currentArchitectState,
          blockReason: riskGate.reason,
          context,
          contextSnapshot: latestContextSnapshot,
          decision,
          diagnostics: blockedDiagnostics,
          economics: baseEconomics,
          outcome: "blocked",
          profile,
          quantity: null,
          riskGate,
          signalEvaluated: true,
          signalState,
          state: evaluationState,
          strategyId: this.strategy.id,
          tick
        });
        this.deps.logger.bot(this.config, "entry_gate_blocked", blockedDiagnostics);
        this.logEntryBlocked(signalState, riskGate.reason);
      } else if (decision.action === "buy") {
        this.logEntryEvaluation({
          architectState: currentArchitectState,
          context,
          contextSnapshot: latestContextSnapshot,
          decision,
          economics: baseEconomics,
          outcome: "skipped",
          profile,
          quantity: null,
          riskGate,
          signalEvaluated: true,
          signalState,
          skipReason: "debounce_not_satisfied",
          state: evaluationState,
          strategyId: this.strategy.id,
          tick
        });
        this.lastNonCooldownBlockReason = null;
      } else if (decision.action !== "buy") {
        this.logEntryEvaluation({
          architectState: currentArchitectState,
          context,
          contextSnapshot: latestContextSnapshot,
          decision,
          economics: baseEconomics,
          outcome: "skipped",
          profile,
          quantity: null,
          riskGate,
          signalEvaluated: true,
          signalState,
          skipReason: "no_entry_signal",
          state: evaluationState,
          strategyId: this.strategy.id,
          tick
        });
        this.lastNonCooldownBlockReason = null;
      }
      return;
    }

    const managedRecoveryArchitectState = isManagedRecoveryPosition(position)
      ? this.evaluateArchitectUsability({
          currentFamily: this.deps.strategySwitcher.getStrategyFamily(this.strategy.id),
          timestamp: tick.timestamp
        })
      : null;

    const exitPlan = this.shouldExitPosition({
      architectState: managedRecoveryArchitectState,
      decision,
      managedRecoveryTarget,
      position,
      signalState,
      tick
    });

    if (exitPlan.transition === "managed_recovery" && exitPlan.nextPosition) {
      const estimatedExitEconomics = exitPlan.estimatedExitEconomics || this.estimateExitEconomics(position, tick.price);
      const managedRecoveryPosition = exitPlan.nextPosition;
      const deferredRecoveryTarget = this.resolveManagedRecoveryTarget({
        context,
        position: managedRecoveryPosition
      });
      const managedRecoveryTelemetry = this.buildExitTelemetry({
        architectState: managedRecoveryArchitectState,
        exitMechanism: exitPlan.exitMechanism || "qualification",
        exitReasons: Array.isArray(exitPlan.reason) ? exitPlan.reason : [],
        lifecycleEvent: exitPlan.lifecycleEvent,
        managedRecoveryTarget: deferredRecoveryTarget,
        position: managedRecoveryPosition,
        signalTimestamp: tick.timestamp,
        tick
      });
      this.persistManagedRecoveryPosition(managedRecoveryPosition, {
        ...managedRecoveryTelemetry,
        estimatedNetPnl: Number(Number(estimatedExitEconomics.netPnl || 0).toFixed(4)),
        exitFloorNetPnlUsdt: Number(Number(managedRecoveryPosition.managedRecoveryExitFloorNetPnlUsdt || 0).toFixed(4)),
        latestPrice: Number(Number(tick.price || 0).toFixed(4)),
        managedRecoveryStartedAt: managedRecoveryPosition.managedRecoveryStartedAt || tick.timestamp,
        strategy: this.strategy.id
      });
      return;
    }

    if (!exitPlan.exitNow) {
      if (isManagedRecoveryPosition(position) && (managedRecoveryTarget?.hit || Array.isArray(exitPlan.reason) && exitPlan.reason.includes("managed_recovery_rsi_ignored"))) {
        this.logManagedRecoveryUpdate({
          ...this.buildExitTelemetry({
            architectState: managedRecoveryArchitectState,
            exitMechanism: managedRecoveryTarget?.hit ? "recovery" : null,
            exitReasons: Array.isArray(exitPlan.reason) ? exitPlan.reason : [],
            lifecycleEvent: managedRecoveryTarget?.hit
              ? POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT
              : null,
            managedRecoveryTarget,
            position,
            signalTimestamp: tick.timestamp,
            tick
          }),
          exitSignalStreak: signalState.exitSignalStreak,
          latestPrice: Number(Number(tick.price || 0).toFixed(4)),
          status: managedRecoveryTarget?.hit ? "managed_recovery_target_ready" : "managed_recovery_rsi_ignored",
          strategy: this.strategy.id
        });
      }
      return;
    }

    const exitingTransition = exitPlan.lifecycleEvent
      ? beginPositionExit(position, {
          event: exitPlan.lifecycleEvent,
          timestamp: tick.timestamp
        })
      : null;
    const exitingPosition = exitingTransition?.allowed
      ? exitingTransition.position
      : position;

    const closedTrade = this.deps.executionEngine.closePosition({
      botId: this.config.id,
      lifecycleEvent: exitPlan.lifecycleEvent || null,
      lifecycleState: "EXITING",
      price: tick.price,
      reason: exitPlan.reason
    });

    if (!closedTrade) return;
    const closeClassification = this.classifyClosedTrade(closedTrade);
    const closedLifecycleEvent = resolveLifecycleEventFromReasons(
      Array.isArray(closedTrade.exitReason) ? closedTrade.exitReason : [],
      closeClassification.closeClassification
    );
    const closedTransition = closePositionLifecycle(exitingPosition, {
      event: closedLifecycleEvent || exitPlan.lifecycleEvent || POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT,
      timestamp: closedTrade.closedAt
    });
    closedTrade.lifecycleEvent = closedLifecycleEvent || exitPlan.lifecycleEvent || null;
    closedTrade.lifecycleState = closedTransition?.allowed
      ? closedTransition.nextState
      : "CLOSED";
    const exitTelemetry = this.buildExitTelemetry({
      architectState: managedRecoveryArchitectState,
      closedTrade,
      exitMechanism: exitPlan.exitMechanism || null,
      executionTimestamp: closedTrade.closedAt,
      exitReasons: Array.isArray(exitPlan.reason) ? exitPlan.reason : [],
      invalidationLevel: exitPlan.invalidationLevel || null,
      invalidationMode: exitPlan.invalidationMode || null,
      lifecycleEvent: closedTrade.lifecycleEvent,
      managedRecoveryTarget,
      position: exitingPosition,
      protectionMode: exitPlan.protectionMode || null,
      signalTimestamp: tick.timestamp,
      tick
    });

    const nextPerformance = this.deps.performanceMonitor.update(performance, closedTrade);
    this.deps.store.setPerformance(this.config.id, nextPerformance);
    const balancePatch = this.deps.riskManager.onTradeClosed({
      netPnl: closedTrade.netPnl,
      now: closedTrade.closedAt,
      riskProfile: this.config.riskProfile,
      state: signalState
    });
    const updatedBalance = signalState.availableBalanceUsdt + (closedTrade.quantity * closedTrade.exitPrice) - closedTrade.fees;
    this.deps.store.updateBotState(this.config.id, {
      availableBalanceUsdt: updatedBalance,
      cooldownReason: balancePatch.cooldownReason,
      cooldownUntil: balancePatch.cooldownUntil,
      entrySignalStreak: 0,
      exitSignalStreak: 0,
      lastExecutionAt: closedTrade.closedAt,
      lastTradeAt: closedTrade.closedAt,
      lossStreak: balancePatch.lossStreak,
      realizedPnl: signalState.realizedPnl + closedTrade.netPnl,
      status: nextPerformance.drawdown >= this.deps.riskManager.profiles[this.config.riskProfile].maxDrawdownPct ? "paused" : signalState.status,
      pausedReason: nextPerformance.drawdown >= this.deps.riskManager.profiles[this.config.riskProfile].maxDrawdownPct ? "max_drawdown_reached" : null
    });
    this.activatePostLossArchitectLatch({
      closedAt: closedTrade.closedAt,
      netPnl: closedTrade.netPnl,
      strategyId: this.strategy.id
    });
    this.logCompactRiskChange({
      ...exitTelemetry,
      cooldownReason: balancePatch.cooldownReason,
      cooldownUntil: balancePatch.cooldownUntil,
      closeClassification: closeClassification.closeClassification,
      lossStreak: balancePatch.lossStreak,
      status: "trade_closed"
    });
    if (closeClassification.failedRsiExit) {
      this.deps.logger.bot(this.config, "failed_rsi_exit", {
        ...exitTelemetry,
        closeClassification: closeClassification.closeClassification,
        closeReason: Array.isArray(closedTrade.exitReason) ? closedTrade.exitReason.join(",") : null,
        cooldownReason: balancePatch.cooldownReason,
        entryPrice: Number(Number(closedTrade.entryPrice || 0).toFixed(4)),
        exitPrice: Number(Number(closedTrade.exitPrice || 0).toFixed(4)),
        fees: Number(Number(closedTrade.fees || 0).toFixed(4)),
        grossPnl: Number(Number(closedTrade.pnl || 0).toFixed(4)),
        netPnl: Number(Number(closedTrade.netPnl || 0).toFixed(4)),
        strategy: this.strategy.id
      });
    }
    if (isManagedRecoveryPosition(position)) {
      this.deps.logger.bot(this.config, "managed_recovery_exited", {
        ...exitTelemetry,
        closeClassification: closeClassification.closeClassification,
        closeReason: Array.isArray(closedTrade.exitReason) ? closedTrade.exitReason.join(",") : null,
        strategy: this.strategy.id
      });
    }
    this.logCompactSell({
      ...exitTelemetry,
      closeClassification: closeClassification.closeClassification,
      closeReason: Array.isArray(exitPlan.reason) ? exitPlan.reason.join(",") : null,
      entryPrice: Number(Number(closedTrade.entryPrice || 0).toFixed(4)),
      exitPrice: Number(Number(closedTrade.exitPrice || 0).toFixed(4)),
      feeRate: Number(Number(this.deps.executionEngine?.feeRate || 0).toFixed(6)),
      fees: Number(Number(closedTrade.fees || 0).toFixed(4)),
      grossPnl: Number(Number(closedTrade.pnl || 0).toFixed(4)),
      latestPrice: Number(Number(tick.price || 0).toFixed(4)),
      netPnl: Number(Number(closedTrade.netPnl || 0).toFixed(4)),
      outcome: closedTrade.netPnl > 0 ? "profit" : closedTrade.netPnl < 0 ? "loss" : "flat",
      quantity: Number(Number(closedTrade.quantity || 0).toFixed(8)),
      strategy: this.strategy.id
    });
    this.deps.store.recordExecution(this.config.id, this.config.symbol, closedTrade.closedAt);
    this.ensureCooldownState(closedTrade.closedAt);
    this.updateArchitectSyncState(null, closedTrade.closedAt);
    this.maybeApplyPublishedArchitect(null, closedTrade.closedAt);
  }
}

module.exports = {
  TradingBot
};
