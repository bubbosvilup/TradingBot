// Module responsibility: real bot implementation composed from strategy, risk, performance and execution roles.

import type { BotConfig } from "../types/bot.ts";
import type { ArchitectAssessment } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";
import type { Strategy } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";

const { BaseBot } = require("./baseBot.ts");
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
    this.maxArchitectStateAgeMs = 90_000;
    this.entrySlippageBufferPct = 0.0005;
    this.entryProfitSafetyBufferPct = 0.0005;
    this.minExpectedNetEdgePct = 0.0005;
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
      architectBlockReason: architectState?.blockReason || null,
      reason: "architect_not_usable_for_entry"
    });
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

    this.deps.logger.bot(this.config, "entry_evaluated", {
      ...diagnostics,
      allowReason: params.allowReason || null,
      blockReason: params.blockReason || null,
      outcome: params.outcome,
      signalEvaluated: params.signalEvaluated !== false,
      skipReason: params.skipReason || null
    });
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
      return state;
    }

    if (!cooldownActive && this.cooldownWasActive) {
      this.cooldownWasActive = false;
      this.cooldownWindowLoggedUntil = null;
      this.deps.store.updateBotState(this.config.id, {
        cooldownReason: null,
        cooldownUntil: null
      });
      this.deps.logger.bot(this.config, "cooldown_ended");
      return this.deps.store.getBotState(this.config.id);
    }

    return state;
  }

  updateSignalState(params: {
    hasPosition: boolean;
    decisionAction: "buy" | "sell" | "hold";
    state: any;
  }) {
    const nextEntrySignalStreak = !params.hasPosition && params.decisionAction === "buy"
      ? params.state.entrySignalStreak + 1
      : 0;
    const nextExitSignalStreak = params.hasPosition && params.decisionAction === "sell"
      ? params.state.exitSignalStreak + 1
      : 0;

    this.deps.store.updateBotState(this.config.id, {
      entrySignalStreak: nextEntrySignalStreak,
      exitSignalStreak: nextExitSignalStreak
    });

    return this.deps.store.getBotState(this.config.id);
  }

  isEmergencyExit(position: PositionRecord, price: number) {
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile);
    const drawdownPct = position.entryPrice > 0 ? ((position.entryPrice - price) / position.entryPrice) : 0;
    return drawdownPct >= profile.emergencyStopPct;
  }

  shouldExitPosition(params: {
    decision: any;
    position: PositionRecord;
    signalState: any;
    tick: MarketTick;
  }) {
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile);
    const holdMs = params.tick.timestamp - params.position.openedAt;
    const emergency = this.isEmergencyExit(params.position, params.tick.price);

    if (emergency) {
      return {
        exitNow: true,
        reason: [...params.decision.reason, "emergency_stop"]
      };
    }

    if (holdMs < profile.minHoldMs) {
      return {
        exitNow: false,
        reason: [...params.decision.reason, `minimum_hold_${profile.minHoldMs}ms`]
      };
    }

    if (params.decision.action === "sell" && params.signalState.exitSignalStreak >= profile.exitConfirmationTicks) {
      return {
        exitNow: true,
        reason: [...params.decision.reason, `exit_confirmed_${profile.exitConfirmationTicks}ticks`]
      };
    }

    return {
      exitNow: false,
      reason: params.decision.reason
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
      this.deps.logger.bot(this.config, "entry_blocked", { reason });
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
    const emaGapPct = Number.isFinite(emaFast) && Number.isFinite(emaSlow)
      ? Math.abs(emaFast - emaSlow) / latestPrice
      : 0;
    const momentumEdgePct = Number.isFinite(momentum)
      ? Math.abs(momentum) / latestPrice
      : 0;
    const strategyId = params.context?.strategyId || this.strategy?.id || "";
    const expectedGrossEdgePct = strategyId === "rsiReversion"
      ? Math.max(0, (0.6 * meanReversionGapPct) + (0.25 * emaGapPct) + (0.15 * momentumEdgePct))
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
    const minExpectedNetEdgePct = this.minExpectedNetEdgePct;
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
      strategyId: this.strategy.id,
      tick: params.tick
    });

    if (!architectState.usable) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: architectState.blockReason } };
    }
    if (architectState.familyMatch === false) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "strategy_family_mismatch" } };
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
    const performance = this.deps.store.getPerformance(this.config.id);
    const signalState = this.updateSignalState({
      decisionAction: decision.action,
      hasPosition: Boolean(position),
      state: this.deps.store.getBotState(this.config.id)
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

    const exitPlan = this.shouldExitPosition({
      decision,
      position,
      signalState,
      tick
    });

    if (!exitPlan.exitNow) {
      return;
    }

    const closedTrade = this.deps.executionEngine.closePosition({
      botId: this.config.id,
      price: tick.price,
      reason: exitPlan.reason
    });

    if (!closedTrade) return;

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
    this.deps.store.recordExecution(this.config.id, this.config.symbol, closedTrade.closedAt);
    this.ensureCooldownState(closedTrade.closedAt);
    this.updateArchitectSyncState(null, closedTrade.closedAt);
    this.maybeApplyPublishedArchitect(null, closedTrade.closedAt);
  }
}

module.exports = {
  TradingBot
};
