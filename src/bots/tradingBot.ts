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
  maxArchitectStateAgeMs: number;
  entrySlippageBufferPct: number;
  entryProfitSafetyBufferPct: number;

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
    this.maxArchitectStateAgeMs = 90_000;
    this.entrySlippageBufferPct = 0.0005;
    this.entryProfitSafetyBufferPct = 0.0005;
  }

  start() {
    if (this.started || !this.config.enabled) return;
    this.started = true;
    this.deps.store.updateBotState(this.config.id, { status: "running" });
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
      marketRegime: regime,
      metadata: {
        updatedAt: tick.timestamp
      },
      performance: {
        drawdown: performance?.drawdown || 0,
        expectancy: performance?.expectancy || 0,
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

  getPublishedArchitectAssessment(): ArchitectAssessment | null {
    return this.deps.store.getArchitectPublishedAssessment(this.config.symbol);
  }

  updateArchitectSyncState(position: PositionRecord | null) {
    const state = this.deps.store.getBotState(this.config.id);
    if (!state) return null;

    const published = this.getPublishedArchitectAssessment();
    const currentFamily = this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const targetFamily = published?.recommendedFamily || null;
    const actionableTarget = targetFamily && targetFamily !== "no_trade" ? targetFamily : null;
    const waitingForFlat = Boolean(position) && Boolean(actionableTarget) && currentFamily !== actionableTarget;
    const nextStatus = !published ? "pending" : waitingForFlat ? "waiting_flat" : "synced";

    this.deps.store.updateBotState(this.config.id, {
      architectRecommendedFamily: published?.recommendedFamily || null,
      architectRecommendationStreak: 0,
      architectSyncStatus: nextStatus,
      lastArchitectAssessmentAt: published?.updatedAt || null
    });

    const divergenceActive = Boolean(actionableTarget) && currentFamily !== actionableTarget;
    if (divergenceActive !== this.architectDivergenceActive) {
      this.architectDivergenceActive = divergenceActive;
      if (divergenceActive) {
        this.deps.logger.bot(this.config, "architect_strategy_divergence", {
          currentFamily,
          publishedAt: published?.updatedAt || null,
          recommendedFamily: actionableTarget,
          syncStatus: nextStatus
        });
      }
    }

    return {
      published,
      state: this.deps.store.getBotState(this.config.id)
    };
  }

  maybeApplyPublishedArchitect(position: PositionRecord | null) {
    const state = this.deps.store.getBotState(this.config.id);
    const published = this.getPublishedArchitectAssessment();
    if (!state || !published) return;
    if (position) return;

    const switchPlan = this.deps.strategySwitcher.evaluate({
      architect: published,
      availableStrategies: this.allowedStrategies,
      botConfig: this.config,
      now: now(),
      positionOpen: Boolean(position),
      state
    });

    if (!switchPlan) return;
    this.strategy = this.deps.strategyRegistry.createStrategy(switchPlan.nextStrategyId);
    this.deps.store.updateBotState(this.config.id, {
      activeStrategyId: switchPlan.nextStrategyId,
      architectSyncStatus: "synced",
      lastStrategySwitchAt: now()
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
    const expectedGrossEdgePct = Math.max(meanReversionGapPct, emaGapPct, momentumEdgePct, 0);
    const feeRate = Math.max(Number(this.deps.executionEngine?.feeRate) || 0.001, 0);
    const estimatedEntryFeePct = feeRate;
    const estimatedExitFeePct = feeRate;
    const estimatedSlippagePct = this.entrySlippageBufferPct;
    const profitSafetyBufferPct = this.entryProfitSafetyBufferPct;
    const requiredEdgePct = estimatedEntryFeePct + estimatedExitFeePct + estimatedSlippagePct + profitSafetyBufferPct;
    const expectedNetEdgePct = expectedGrossEdgePct - requiredEdgePct;
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
      notionalUsdt,
      profitSafetyBufferPct,
      requiredEdgePct
    };
  }

  buildEntryDiagnostics(params: {
    architect: ArchitectAssessment | null;
    architectAgeMs: number | null;
    architectStale: boolean;
    contextSnapshot: any;
    decision: any;
    economics: any;
    strategyId: string;
  }) {
    return {
      architectAgeMs: params.architectAgeMs,
      architectStale: params.architectStale,
      blockReason: null,
      botId: this.config.id,
      contextMaturity: params.architect ? Number(params.architect.contextMaturity.toFixed(4)) : 0,
      dataQuality: params.contextSnapshot?.features?.dataQuality !== undefined
        ? Number(Number(params.contextSnapshot.features.dataQuality).toFixed(4))
        : null,
      estimatedEntryFeePct: Number(params.economics.estimatedEntryFeePct.toFixed(4)),
      estimatedExitFeePct: Number(params.economics.estimatedExitFeePct.toFixed(4)),
      estimatedRoundTripFeesUsdt: Number(params.economics.estimatedRoundTripFeesUsdt.toFixed(4)),
      estimatedSlippagePct: Number(params.economics.estimatedSlippagePct.toFixed(4)),
      expectedGrossEdgePct: Number(params.economics.expectedGrossEdgePct.toFixed(4)),
      expectedGrossEdgeUsdt: Number(params.economics.expectedGrossEdgeUsdt.toFixed(4)),
      expectedNetEdgePct: Number(params.economics.expectedNetEdgePct.toFixed(4)),
      localReasons: Array.isArray(params.decision.reason) ? params.decision.reason.slice(0, 3) : [],
      publishedFamily: params.architect?.recommendedFamily || null,
      publishedRegime: params.architect?.marketRegime || null,
      requiredEdgePct: Number(params.economics.requiredEdgePct.toFixed(4)),
      signalAgreement: params.architect ? Number(params.architect.signalAgreement.toFixed(4)) : null,
      strategy: params.strategyId,
      symbol: this.config.symbol
    };
  }

  evaluateFinalEntryGate(params: {
    context: any;
    decision: any;
    quantity: number;
    tick: MarketTick;
  }) {
    const architect = this.getPublishedArchitectAssessment();
    const publisher = this.deps.store.getArchitectPublisherState(this.config.symbol);
    const contextSnapshot = this.deps.store.getContextSnapshot(this.config.symbol);
    const architectAgeMs = architect?.updatedAt ? Math.max(0, params.tick.timestamp - architect.updatedAt) : null;
    const staleThresholdMs = Math.max((publisher?.publishIntervalMs || 30_000) * 2, this.maxArchitectStateAgeMs);
    const architectStale = architectAgeMs !== null && architectAgeMs > staleThresholdMs;
    const currentFamily = this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const economics = this.estimateEntryEconomics({
      context: params.context,
      price: params.tick.price,
      quantity: params.quantity
    });
    const diagnostics = this.buildEntryDiagnostics({
      architect,
      architectAgeMs,
      architectStale,
      contextSnapshot,
      decision: params.decision,
      economics,
      strategyId: this.strategy.id
    });

    if (!architect) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "missing_published_architect" } };
    }
    if (!publisher?.ready || !architect.sufficientData) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "architect_not_ready" } };
    }
    if (architect.marketRegime === "unclear") {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "architect_unclear" } };
    }
    if (architect.recommendedFamily === "no_trade") {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "architect_no_trade" } };
    }
    if (architectStale) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "architect_stale" } };
    }
    if (architect.contextMaturity < this.minEntryContextMaturity) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "architect_low_maturity" } };
    }
    if (currentFamily !== architect.recommendedFamily) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "strategy_family_mismatch" } };
    }
    if (economics.expectedGrossEdgePct <= economics.requiredEdgePct) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "insufficient_edge_after_costs" } };
    }

    return {
      allowed: true,
      architect,
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
    this.updateArchitectSyncState(currentPosition);
    this.maybeApplyPublishedArchitect(currentPosition);

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
      const latestPublishedArchitect = this.getPublishedArchitectAssessment();
      const latestContextSnapshot = this.deps.store.getContextSnapshot(this.config.symbol);
      const riskGate = this.deps.riskManager.canOpenTrade({
        now: tick.timestamp,
        performance,
        positionOpen: false,
        riskProfile: this.config.riskProfile,
        state: signalState
      });

      if (decision.action === "buy" && riskGate.allowed && signalState.entrySignalStreak >= profile.entryDebounceTicks) {
        const sizing = this.deps.riskManager.calculatePositionSize({
          balanceUsdt: signalState.availableBalanceUsdt,
          confidence: decision.confidence,
          latestPrice: tick.price,
          performance,
          riskProfile: this.config.riskProfile,
          state: signalState
        });

        if (sizing.quantity > 0) {
          const finalEntryGate = this.evaluateFinalEntryGate({
            context,
            decision,
            quantity: sizing.quantity,
            tick
          });
          if (!finalEntryGate.allowed) {
            this.deps.logger.bot(this.config, "entry_gate_blocked", finalEntryGate.diagnostics);
            this.lastNonCooldownBlockReason = finalEntryGate.diagnostics.blockReason;
            return;
          }
          const publishedArchitect = finalEntryGate.architect;
          this.deps.logger.bot(this.config, "entry_gate_allowed", finalEntryGate.diagnostics);
          const opened = this.deps.executionEngine.openLong({
            botId: this.config.id,
            confidence: decision.confidence,
            price: tick.price,
            quantity: sizing.quantity,
            reason: [...decision.reason, `entry_confirmed_${profile.entryDebounceTicks}ticks`],
            strategyId: this.strategy.id,
            symbol: this.config.symbol
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
        }
        return;
      }

      if (decision.action === "buy" && !riskGate.allowed) {
        const economics = this.estimateEntryEconomics({
          context,
          price: tick.price,
          quantity: null
        });
        this.deps.logger.bot(this.config, "entry_gate_blocked", {
          ...this.buildEntryDiagnostics({
            architect: latestPublishedArchitect,
            architectAgeMs: latestPublishedArchitect?.updatedAt ? Math.max(0, tick.timestamp - latestPublishedArchitect.updatedAt) : null,
            architectStale: false,
            contextSnapshot: latestContextSnapshot,
            decision,
            economics,
            strategyId: this.strategy.id
          }),
          blockReason: riskGate.reason
        });
        this.logEntryBlocked(signalState, riskGate.reason);
      } else if (decision.action !== "buy") {
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
    this.updateArchitectSyncState(null);
    this.maybeApplyPublishedArchitect(null);
  }
}

module.exports = {
  TradingBot
};
