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
          this.lastNonCooldownBlockReason = null;
        }
        return;
      }

      if (decision.action === "buy" && !riskGate.allowed) {
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
