import type { BotConfig } from "../types/bot.ts";
import type { ArchitectAssessment } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";
import type { EntryEconomicsEstimate, MarketContext, Strategy } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";
import type { ExitPolicy, InvalidationMode } from "../types/exitPolicy.ts";
import type { PositionExitMechanism } from "../types/positionLifecycle.ts";
import type { BotDeps, MarketDataFreshnessState } from "../types/runtime.ts";
import type { Clock } from "../core/clock.ts";
import type { BaseBotClass } from "./baseBot.ts";
import type {
  ArchitectCoordinatorInstance,
  ArchitectCoordinatorParams,
  ArchitectSyncUpdateResult,
  ArchitectUsabilityState
} from "../roles/architectCoordinator.ts";
import type {
  EntryCoordinatorInstance,
  EntryCoordinatorParams,
  EntryGateResult
} from "../roles/entryCoordinator.ts";
import type {
  EntryOutcomeCoordinatorInstance,
  EntryOutcomeCoordinatorParams,
  EntryOutcomePlan
} from "../roles/entryOutcomeCoordinator.ts";
import type {
  ExitClassification,
  ExitOutcomeCoordinatorInstance,
  ExitOutcomeCoordinatorParams
} from "../roles/exitOutcomeCoordinator.ts";
import type {
  OpenAttemptCoordinatorInstance,
  OpenAttemptCoordinatorParams
} from "../roles/openAttemptCoordinator.ts";
import type { PostLossArchitectLatchTransition } from "../roles/postLossArchitectLatch.ts";
import type {
  CompactLogDescriptor,
  PostLossArchitectLatchTelemetryState,
  TradingBotTelemetryInstance,
  TradingBotTelemetryParams
} from "../roles/tradingBotTelemetry.ts";
import type { ExitPlan } from "../roles/exitDecisionCoordinator.ts";

const { BaseBot } = require("./baseBot.ts") as { BaseBot: BaseBotClass<BotDeps> };
const { resolveLogType } = require("../utils/logger.ts");
const {
  beginPositionExit,
  closePositionLifecycle,
  isManagedRecoveryPosition,
  POSITION_LIFECYCLE_EVENTS,
  resolveLifecycleEventFromReasons
} = require("../roles/positionLifecycleManager.ts");
const { resolveExitPolicy } = require("../roles/exitPolicyRegistry.ts");
const { resolveRecoveryTarget, resolveRecoveryTargetPolicy } = require("../roles/recoveryTargetResolver.ts");
const {
  calculateDirectionalGrossPnl,
  isTargetHit,
  normalizeEntrySide,
  normalizeTradeSide
} = require("../utils/tradeSide.ts");
const { ExitDecisionCoordinator } = require("../roles/exitDecisionCoordinator.ts") as {
  ExitDecisionCoordinator: new () => { resolve: (params: any) => ExitPlan; };
};
const { validateTradeConstraints } = require("../utils/tradeConstraints.ts");
const { estimateEntryEconomics: estimateStrategyEntryEconomics } = require("../roles/entryEconomicsEstimator.ts");
const { elapsedMs, startTimer } = require("../utils/timing.ts");
const { ArchitectCoordinator } = require("../roles/architectCoordinator.ts") as {
  ArchitectCoordinator: new (params: ArchitectCoordinatorParams) => ArchitectCoordinatorInstance;
};
const { EntryCoordinator } = require("../roles/entryCoordinator.ts") as {
  EntryCoordinator: new (params: EntryCoordinatorParams) => EntryCoordinatorInstance;
};
const { EntryOutcomeCoordinator } = require("../roles/entryOutcomeCoordinator.ts") as {
  EntryOutcomeCoordinator: new (params: EntryOutcomeCoordinatorParams) => EntryOutcomeCoordinatorInstance;
};
const { ExitOutcomeCoordinator } = require("../roles/exitOutcomeCoordinator.ts") as {
  ExitOutcomeCoordinator: new (params: ExitOutcomeCoordinatorParams) => ExitOutcomeCoordinatorInstance;
};
const { OpenAttemptCoordinator } = require("../roles/openAttemptCoordinator.ts") as {
  OpenAttemptCoordinator: new (params: OpenAttemptCoordinatorParams) => OpenAttemptCoordinatorInstance;
};
const { TradingBotTelemetry } = require("../roles/tradingBotTelemetry.ts") as {
  TradingBotTelemetry: new (params: TradingBotTelemetryParams) => TradingBotTelemetryInstance;
};
const { PostLossArchitectLatch } = require("../roles/postLossArchitectLatch.ts") as {
  PostLossArchitectLatch: new (params: {
    botId: string;
    requiredPublishes: number;
    store: BotDeps["store"];
    symbol: string;
  }) => {
    activateOnLoss(params: { closedAt: number; netPnl: number; startedAt?: number | null; strategyId: string }): { state: any; transition?: PostLossArchitectLatchTransition };
    getState(activeStrategyId: string, runtimeState?: any): any;
    refresh(): { state: any; transition?: PostLossArchitectLatchTransition };
  };
};
const { resolveClock } = require("../core/clock.ts");

type TradingTickSnapshot = Readonly<{
  tick: MarketTick;
  state: any;
  position: PositionRecord | null;
  performance: any;
  contextSnapshot: any;
  currentFamily: ArchitectUsabilityState["currentFamily"];
  publishedArchitect: ArchitectAssessment | null;
  publisherState: any;
}>;

type TradingTickArchitectContext = Readonly<TradingTickSnapshot & {
  architectState: ArchitectUsabilityState | null;
}>;

type TradingTickDecisionContext = Readonly<TradingTickArchitectContext & {
  context: any;
  decision: any;
  managedRecoveryTarget: any;
  profile: any;
  signalState: any;
}>;

type FinalEntryGateEvaluationResult = EntryGateResult & {
  economics: EntryEconomicsEstimate;
};

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
  postLossLatchMaxMs: number | null;
  compactLogSignatures: Record<string, string | null>;
  architectCoordinator: ArchitectCoordinatorInstance;
  entryCoordinator: EntryCoordinatorInstance;
  entryOutcomeCoordinator: EntryOutcomeCoordinatorInstance;
  exitOutcomeCoordinator: ExitOutcomeCoordinatorInstance;
  exitDecisionCoordinator: InstanceType<typeof ExitDecisionCoordinator>;
  openAttemptCoordinator: OpenAttemptCoordinatorInstance;
  telemetry: TradingBotTelemetryInstance;
  postLossArchitectLatch: InstanceType<typeof PostLossArchitectLatch>;
  clock: Clock;

  constructor(config: BotConfig, deps: BotDeps) {
    super(config, deps);
    this.clock = resolveClock(deps.clock);
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
    this.postLossLatchMaxMs = Number.isFinite(Number(config.postLossLatchMaxMs)) && Number(config.postLossLatchMaxMs) > 0
      ? Math.floor(Number(config.postLossLatchMaxMs))
      : null;
    this.compactLogSignatures = {};
    this.architectCoordinator = new ArchitectCoordinator({
      allowedStrategies: this.allowedStrategies,
      botConfig: this.config,
      maxArchitectStateAgeMs: this.maxArchitectStateAgeMs,
      minEntryContextMaturity: this.minEntryContextMaturity,
      minPostSwitchEntryContextMaturity: this.minPostSwitchEntryContextMaturity,
      mtfInstabilityThreshold: this.config.mtf?.instabilityThreshold,
      store: this.deps.store,
      strategyRegistry: this.deps.strategyRegistry,
      strategySwitcher: this.deps.strategySwitcher
    });
    this.entryCoordinator = new EntryCoordinator({
      botId: this.config.id,
      store: this.deps.store
    });
    this.entryOutcomeCoordinator = new EntryOutcomeCoordinator({
      symbol: this.config.symbol
    });
    this.exitOutcomeCoordinator = new ExitOutcomeCoordinator({
      riskManager: this.deps.riskManager
    });
    this.exitDecisionCoordinator = new ExitDecisionCoordinator();
    this.openAttemptCoordinator = new OpenAttemptCoordinator({
      executionEngine: this.deps.executionEngine,
      riskManager: this.deps.riskManager
    });
    this.telemetry = new TradingBotTelemetry({
      botId: this.config.id,
      symbol: this.config.symbol
    });
    this.postLossArchitectLatch = new PostLossArchitectLatch({
      botId: this.config.id,
      requiredPublishes: Math.max(
      Number.isFinite(Number(config.postLossArchitectLatchPublishesRequired))
        ? Number(config.postLossArchitectLatchPublishesRequired)
        : 2,
      1
      ),
      store: this.deps.store,
      symbol: this.config.symbol
    });
  }

  now() {
    return this.clock.now();
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

  buildContext(tick: MarketTick, params: {
    performance?: any;
    position?: PositionRecord | null;
  } = {}) {
    const priceSeries = this.deps.store.getRecentPrices(this.config.symbol, 120);
    const indicators = this.deps.indicatorEngine.createSnapshot(priceSeries);
    const position = params.position !== undefined
      ? params.position
      : this.deps.store.getPosition(this.config.id);
    const performance = params.performance !== undefined
      ? params.performance
      : this.deps.store.getPerformance(this.config.id);
    // Local regime remains informational for strategy-local diagnostics only.
    // System-level family routing comes from the published Architect decision.
    const regime = this.deps.regimeDetector.detect(priceSeries);
    const unrealizedPnl = position
      ? this.estimateUnrealizedEconomics(position, tick.price).netPnl
      : 0;

    return {
      botId: this.config.id,
      hasOpenPosition: Boolean(position),
      indicators,
      latestPrice: tick.price,
      localRegimeHint: regime,
      metadata: {
        architectMtf: this.architectCoordinator.getPublishedAssessment()?.mtf || null,
        positionEntryPrice: position?.entryPrice ?? null,
        positionSide: position ? normalizeTradeSide(position.side) : null,
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
      positionSide: position ? normalizeTradeSide(position.side) : null,
      strategyId: this.strategy.id,
      symbol: this.config.symbol,
      timestamp: tick.timestamp,
      unrealizedPnl
    };
  }

  estimateUnrealizedEconomics(position: PositionRecord, price: number) {
    if (typeof this.deps.executionEngine?.calculateUnrealizedEconomics === "function") {
      return this.deps.executionEngine.calculateUnrealizedEconomics(position, price);
    }

    const entryPrice = Math.max(Number(position?.entryPrice) || 0, 0);
    const markPrice = Math.max(Number(price) || 0, 0);
    const quantity = Math.max(Number(position?.quantity) || 0, 0);
    const feeRate = Math.max(Number(this.deps.executionEngine?.feeRate) || 0, 0);
    const side = normalizeTradeSide(position?.side);
    const entryNotionalUsdt = entryPrice * quantity;
    const markNotionalUsdt = markPrice * quantity;
    const grossPnl = calculateDirectionalGrossPnl({
      entryPrice,
      exitPrice: markPrice,
      quantity,
      side
    }).grossPnl;
    const fees = (entryNotionalUsdt + markNotionalUsdt) * feeRate;
    return {
      entryNotionalUsdt,
      entryPrice,
      fees,
      grossPnl,
      markNotionalUsdt,
      markPrice,
      netPnl: grossPnl - fees,
      quantity,
      side
    };
  }

  logArchitectEntryShortCircuit(architectState: any) {
    const blockKey = `architect_not_usable_for_entry:${architectState?.blockReason || "unknown"}`;
    if (this.lastNonCooldownBlockReason === blockKey) {
      return;
    }

    this.lastNonCooldownBlockReason = blockKey;
    this.deps.logger.bot(this.config, "entry_blocked", this.telemetry.buildArchitectEntryShortCircuitLogMetadata(architectState));
    this.emitCompactDescriptor(this.telemetry.buildArchitectEntryShortCircuitCompactDescriptor(this.strategy.id));
  }

  getLogType() {
    return resolveLogType(process.env.LOG_TYPE);
  }

  emitCompactDescriptor(descriptor?: CompactLogDescriptor | null) {
    if (!descriptor) {
      return;
    }
    if (this.getLogType() === "verbose") {
      return;
    }

    if (descriptor.dedupeKey) {
      const signature = descriptor.signature || JSON.stringify(descriptor.metadata);
      if (this.compactLogSignatures[descriptor.dedupeKey] === signature) {
        return;
      }
      this.compactLogSignatures[descriptor.dedupeKey] = signature;
    }

    this.deps.logger.bot(this.config, descriptor.message, descriptor.metadata);
  }

  logCompactRiskChange(metadata: Record<string, unknown>) {
    const descriptor = this.telemetry.buildCompactRiskDescriptor(this.strategy.id, metadata);
    // Manual-resume-required drawdown pauses are critical runtime state changes.
    // Emit them even in verbose mode so operators and tests do not lose the
    // machine-readable pause semantics behind compact-log suppression.
    if (this.getLogType() === "verbose" && metadata.manualResumeRequired === true) {
      this.deps.logger.bot(this.config, descriptor.message, descriptor.metadata);
      return;
    }
    this.emitCompactDescriptor(descriptor);
  }

  emitPostLossArchitectLatchTransition(transition?: PostLossArchitectLatchTransition) {
    if (!transition) {
      return;
    }
    this.deps.logger.bot(this.config, transition.message, transition.logMetadata);
    this.logCompactRiskChange(transition.compactMetadata);
  }

  recordEntryEvaluationCounters(outcome: "blocked" | "opened" | "skipped", logged: boolean) {
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
    }

    this.deps.store.updateBotState(this.config.id, patch);
  }

  buildEntryEdgeDiagnostics(params: {
    architectState?: ArchitectUsabilityState | null;
    economics: EntryEconomicsEstimate;
    tick: MarketTick;
  }) {
    return {
      entryArchitectRegime: params.architectState?.architect?.marketRegime || null,
      expectedEntryPrice: Number.isFinite(Number(params.tick?.price)) ? Number(params.tick.price) : null,
      expectedExitPrice: null,
      expectedGrossEdgePctAtEntry: Number.isFinite(Number(params.economics.expectedGrossEdgePct))
        ? Number(params.economics.expectedGrossEdgePct)
        : null,
      expectedNetEdgePctAtEntry: Number.isFinite(Number(params.economics.expectedNetEdgePct))
        ? Number(params.economics.expectedNetEdgePct)
        : null,
      requiredEdgePctAtEntry: Number.isFinite(Number(params.economics.requiredEdgePct))
        ? Number(params.economics.requiredEdgePct)
        : null
    };
  }

  resolveExpectedExitPrice(params: {
    exitPlan: ExitPlan;
    managedRecoveryTarget?: any;
    tick: MarketTick;
  }) {
    if (Number.isFinite(Number(params.exitPlan.estimatedExitEconomics?.exitPrice))) {
      return Number(params.exitPlan.estimatedExitEconomics.exitPrice);
    }
    if (Number.isFinite(Number(params.managedRecoveryTarget?.targetPrice))) {
      return Number(params.managedRecoveryTarget.targetPrice);
    }
    return Number.isFinite(Number(params.tick?.price)) ? Number(params.tick.price) : null;
  }

  recordBlockedOpportunityDiagnostics(outcome: EntryOutcomePlan) {
    if (outcome.entryEvaluated.outcome !== "blocked") {
      return;
    }
    const recorder = (this.deps.store as any).recordBlockedOpportunityEdgeDiagnostics;
    if (typeof recorder !== "function") {
      return;
    }
    const economics = outcome.entryEvaluated.economics;
    recorder.call(this.deps.store, {
      botId: this.config.id,
      expectedGrossEdgePct: Number.isFinite(Number(economics?.expectedGrossEdgePct)) ? Number(economics.expectedGrossEdgePct) : null,
      expectedNetEdgePct: Number.isFinite(Number(economics?.expectedNetEdgePct)) ? Number(economics.expectedNetEdgePct) : null,
      reason: outcome.entryEvaluated.blockReason || outcome.entryBlockedReason || "unknown",
      regime: outcome.entryEvaluated.architectState?.architect?.marketRegime || null,
      requiredEdgePct: Number.isFinite(Number(economics?.requiredEdgePct)) ? Number(economics.requiredEdgePct) : null,
      strategyId: this.strategy.id,
      symbol: this.config.symbol,
      timestamp: outcome.entryEvaluated.tick?.timestamp || null
    });
  }

  applyEntryOutcome(outcome: EntryOutcomePlan) {
    this.recordEntryEvaluationCounters(outcome.entryEvaluated.outcome, false);
    this.recordBlockedOpportunityDiagnostics(outcome);
    if (outcome.gateLog) {
      this.deps.logger.bot(this.config, outcome.gateLog.message, outcome.gateLog.metadata);
    }
    if (outcome.entryBlockedReason) {
      this.logEntryBlocked(
        (outcome.entryEvaluated.signalState || outcome.entryEvaluated.state) as any,
        outcome.entryBlockedReason
      );
    }
    if (outcome.statePatch) {
      this.deps.store.updateBotState(this.config.id, outcome.statePatch);
    }
    if (Number.isFinite(Number(outcome.recordExecutionAt))) {
      this.deps.store.recordExecution(this.config.id, this.config.symbol, Number(outcome.recordExecutionAt), {
        skipBotStateWrite: true
      });
    }
    if (outcome.compactBuyMetadata) {
      this.emitCompactDescriptor(this.telemetry.buildCompactBuyDescriptor(outcome.compactBuyMetadata));
    }
    if (outcome.lastNonCooldownBlockReason !== undefined) {
      this.lastNonCooldownBlockReason = outcome.lastNonCooldownBlockReason;
    }
  }

  applyClosedTradeOutcome(outcome: ReturnType<ExitOutcomeCoordinatorInstance["buildClosedTradeOutcome"]>) {
    this.deps.store.updateBotState(this.config.id, outcome.statePatch);
    const latchActivation = this.postLossArchitectLatch.activateOnLoss({
      ...outcome.latchActivation,
      startedAt: this.now()
    });
    this.emitPostLossArchitectLatchTransition(latchActivation.transition);
    this.deps.logger.bot(this.config, "trade_closed", outcome.detailedExitLogMetadata);
    this.logCompactRiskChange(outcome.compactRiskMetadata);
    if (outcome.failedRsiExitLogMetadata) {
      this.deps.logger.bot(this.config, "failed_rsi_exit", outcome.failedRsiExitLogMetadata);
    }
    if (outcome.managedRecoveryExitedLogMetadata) {
      this.deps.logger.bot(this.config, "managed_recovery_exited", outcome.managedRecoveryExitedLogMetadata);
    }
    this.emitCompactDescriptor(this.telemetry.buildCompactSellDescriptor(outcome.compactSellMetadata));
    this.deps.store.recordExecution(this.config.id, this.config.symbol, outcome.recordExecutionAt, {
      skipBotStateWrite: true
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
      const profile = this.deps.riskManager.getProfile(this.config.riskProfile, this.config.riskOverrides || null);
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

  classifyClosedTrade(closedTrade: any, exitPlan?: Pick<ExitPlan, "lifecycleEvent"> | null) {
    const exitReasons = Array.isArray(closedTrade?.exitReason)
      ? closedTrade.exitReason
      : Array.isArray(closedTrade?.reason)
        ? closedTrade.reason
        : [];
    const lifecycleEvent = exitPlan?.lifecycleEvent || closedTrade?.lifecycleEvent || null;
    const rsiExit = this.isStructuredRsiExit({
      exitReasons,
      lifecycleEvent
    });
    const failedRsiExit = lifecycleEvent === POSITION_LIFECYCLE_EVENTS.FAILED_RSI_EXIT
      || (rsiExit && Number(closedTrade?.netPnl) < 0);
    return {
      closeClassification: failedRsiExit ? "failed_rsi_exit" : "confirmed_exit",
      failedRsiExit,
      rsiExit
    } as ExitClassification;
  }

  isStructuredRsiExit(params: { exitReasons: string[]; lifecycleEvent?: string | null }) {
    if (params.lifecycleEvent === POSITION_LIFECYCLE_EVENTS.FAILED_RSI_EXIT) {
      return true;
    }
    if (params.lifecycleEvent === POSITION_LIFECYCLE_EVENTS.RSI_EXIT_HIT) {
      return this.isRsiExitReason(params.exitReasons);
    }
    if (params.lifecycleEvent) {
      return false;
    }
    return this.isRsiExitReason(params.exitReasons);
  }

  isRsiExitReason(exitReasons: string[]) {
    return exitReasons.includes("rsi_exit_confirmed") || exitReasons.includes("rsi_exit_threshold_hit");
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
    return this.telemetry.buildExitTelemetry({
      architectState: params.architectState,
      architectTiming: this.architectCoordinator.getTimingMetadata(Number(params.signalTimestamp)),
      closedTrade: params.closedTrade,
      executionTimestamp: params.executionTimestamp,
      exitMechanism: params.exitMechanism,
      exitPolicy,
      exitReasons: params.exitReasons,
      invalidationLevel: params.invalidationLevel,
      invalidationMode: params.invalidationMode,
      lifecycleEvent: params.lifecycleEvent,
      managedRecoveryTarget: params.managedRecoveryTarget,
      position: params.position,
      protectionMode: params.protectionMode,
      protectionStopPct: this.deps.riskManager.getProfile(this.config.riskProfile, this.config.riskOverrides || null).emergencyStopPct,
      signalTimestamp: params.signalTimestamp
    });
  }

  logManagedRecoveryUpdate(metadata: Record<string, unknown>) {
    this.emitCompactDescriptor(this.telemetry.buildCompactRiskDescriptor(
      this.strategy.id,
      metadata,
      "MANAGED_RECOVERY",
      this.telemetry.buildManagedRecoverySignature(metadata)
    ));
  }

  estimateExitEconomics(position: PositionRecord, price: number) {
    if (typeof this.deps.executionEngine?.calculateCloseEconomics === "function") {
      return this.deps.executionEngine.calculateCloseEconomics(position, price);
    }

    const entryPrice = Math.max(Number(position?.entryPrice) || 0, 0);
    const exitPrice = Math.max(Number(price) || 0, 0);
    const quantity = Math.max(Number(position?.quantity) || 0, 0);
    const feeRate = Math.max(Number(this.deps.executionEngine?.feeRate) || 0, 0);
    const side = normalizeTradeSide(position?.side);
    const entryNotionalUsdt = entryPrice * quantity;
    const exitNotionalUsdt = exitPrice * quantity;
    const grossPnl = calculateDirectionalGrossPnl({
      entryPrice,
      exitPrice,
      quantity,
      side
    }).grossPnl;
    const fees = (entryNotionalUsdt + exitNotionalUsdt) * feeRate;
    return {
      entryNotionalUsdt,
      entryPrice,
      exitNotionalUsdt,
      exitPrice,
      fees,
      grossPnl,
      netPnl: grossPnl - fees,
      quantity,
      side
    };
  }

  clonePositionSnapshot(position: PositionRecord): PositionRecord {
    return {
      ...position,
      notes: Array.isArray(position.notes) ? [...position.notes] : []
    };
  }

  getExitPolicy(): ExitPolicy | null {
    return resolveExitPolicy(this.strategy?.config);
  }

  resolveManagedRecoveryTarget(params: { context: any; position: PositionRecord }) {
    const policy = this.getExitPolicy();
    const recoveryTargetPolicy = resolveRecoveryTargetPolicy(policy);
    const priceTargetExitEnabled = Boolean(policy?.recovery?.priceTargetExit);
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
        priceTargetExitEnabled
        &&
        Number.isFinite(Number(latestPrice))
        && Number.isFinite(Number(resolvedTarget.targetPrice))
        && isTargetHit(params.position.side, Number(latestPrice), Number(resolvedTarget.targetPrice))
      )
    };
  }

  persistManagedRecoveryPosition(position: PositionRecord, metadata: Record<string, unknown>) {
    this.deps.store.setPosition(this.config.id, position);
    const currentState = this.deps.store.getBotState(this.config.id);
    this.deps.store.updateBotState(this.config.id, {
      exitSignalStreak: 0,
      managedRecoveryConsecutiveCount: Math.max(Number(currentState?.managedRecoveryConsecutiveCount || 0), 0) + 1
    });
    this.deps.logger.bot(this.config, "rsi_exit_deferred", metadata);
    this.logCompactRiskChange({
      ...metadata,
      status: "rsi_exit_deferred"
    });
  }

  handleDeferredManagedRecoveryExit(params: {
    architectState: any;
    exitPlan: ExitPlan;
    positionSnapshot: PositionRecord;
    snapshot: TradingTickDecisionContext;
  }) {
    if (params.exitPlan.transition !== "managed_recovery" || !params.exitPlan.nextPosition) {
      return false;
    }

    const estimatedExitEconomics = params.exitPlan.estimatedExitEconomics || this.estimateExitEconomics(params.positionSnapshot, params.snapshot.tick.price);
    const managedRecoveryPosition = params.exitPlan.nextPosition;
    const deferredRecoveryTarget = this.resolveManagedRecoveryTarget({
      context: params.snapshot.context,
      position: managedRecoveryPosition
    });
    const managedRecoveryTelemetry = this.buildExitTelemetry({
      architectState: params.architectState,
      exitMechanism: params.exitPlan.exitMechanism || "qualification",
      exitReasons: Array.isArray(params.exitPlan.reason) ? params.exitPlan.reason : [],
      lifecycleEvent: params.exitPlan.lifecycleEvent,
      managedRecoveryTarget: deferredRecoveryTarget,
      position: managedRecoveryPosition,
      signalTimestamp: params.snapshot.tick.timestamp,
      tick: params.snapshot.tick
    });
    this.persistManagedRecoveryPosition(
      managedRecoveryPosition,
      this.exitOutcomeCoordinator.buildDeferredManagedRecoveryOutcome({
        estimatedNetPnl: estimatedExitEconomics.netPnl,
        exitFloorNetPnlUsdt: Number(managedRecoveryPosition.managedRecoveryExitFloorNetPnlUsdt || 0),
        managedRecoveryStartedAt: managedRecoveryPosition.managedRecoveryStartedAt || params.snapshot.tick.timestamp,
        metadata: {
          ...managedRecoveryTelemetry,
          latestPrice: Number(Number(params.snapshot.tick.price || 0).toFixed(4))
        },
        nextPosition: managedRecoveryPosition
      })
    );
    return true;
  }

  handlePendingManagedRecoveryExit(params: {
    architectState: any;
    exitPlan: ExitPlan;
    managedRecoveryTarget: any;
    positionSnapshot: PositionRecord;
    snapshot: TradingTickDecisionContext;
  }) {
    if (params.exitPlan.exitNow) {
      return false;
    }
    if (!isManagedRecoveryPosition(params.positionSnapshot)) {
      return false;
    }
    if (!params.managedRecoveryTarget?.hit && !(Array.isArray(params.exitPlan.reason) && params.exitPlan.reason.includes("managed_recovery_rsi_ignored"))) {
      return false;
    }

    this.logManagedRecoveryUpdate({
      ...this.buildExitTelemetry({
        architectState: params.architectState,
        exitMechanism: params.managedRecoveryTarget?.hit ? "recovery" : null,
        exitReasons: Array.isArray(params.exitPlan.reason) ? params.exitPlan.reason : [],
        lifecycleEvent: params.managedRecoveryTarget?.hit
          ? POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT
          : null,
        managedRecoveryTarget: params.managedRecoveryTarget,
        position: params.positionSnapshot,
        signalTimestamp: params.snapshot.tick.timestamp,
        tick: params.snapshot.tick
      }),
      exitSignalStreak: params.snapshot.signalState.exitSignalStreak,
      latestPrice: Number(Number(params.snapshot.tick.price || 0).toFixed(4)),
      status: params.managedRecoveryTarget?.hit ? "managed_recovery_target_ready" : "managed_recovery_rsi_ignored",
      strategy: this.strategy.id
    });
    return true;
  }

  shouldExitPosition(params: {
    architectState?: any;
    decision: any;
    managedRecoveryTarget?: any;
    position: PositionRecord;
    signalState: any;
    tick: MarketTick;
  }): ExitPlan {
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile, this.config.riskOverrides || null);
    return this.exitDecisionCoordinator.resolve({
      architectState: params.architectState,
      decision: params.decision,
      emergencyStopPct: profile.emergencyStopPct,
      estimateExitEconomics: (position: PositionRecord, price: number) => this.estimateExitEconomics(position, price),
      exitConfirmationTicks: profile.exitConfirmationTicks,
      exitPolicy: this.getExitPolicy(),
      managedRecoveryTarget: params.managedRecoveryTarget,
      minHoldMs: profile.minHoldMs,
      position: params.position,
      resolveInvalidationLevel: (architectState: any, mode: InvalidationMode) =>
        this.telemetry.resolveInvalidationLevel(architectState, mode),
      signalState: params.signalState,
      tick: params.tick
    });
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
        ? this.postLossArchitectLatch.getState(this.strategy.id, state)
        : null;
      this.deps.logger.bot(this.config, "entry_blocked", this.telemetry.buildEntryBlockedMetadata({
        postLossArchitectLatch,
        reason
      }));
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

  evaluateArchitectUsability(params: {
    architect?: ArchitectAssessment | null;
    contextSnapshot?: any;
    currentFamily?: ArchitectUsabilityState["currentFamily"];
    publisher?: any;
    timestamp?: number;
  } = {}): ArchitectUsabilityState {
    return this.architectCoordinator.evaluateUsability({
      activeStrategyId: this.strategy.id,
      architect: params.architect,
      contextSnapshot: params.contextSnapshot,
      currentFamily: params.currentFamily !== undefined ? params.currentFamily : undefined,
      mtfAgreement: params.architect?.mtf?.mtfAgreement ?? null,
      mtfDominantTimeframe: params.architect?.mtf?.mtfDominantTimeframe ?? null,
      mtfEnabled: params.architect?.mtf?.mtfEnabled ?? false,
      mtfInstability: params.architect?.mtf?.mtfInstability ?? null,
      mtfSufficientFrames: params.architect?.mtf?.mtfSufficientFrames ?? false,
      publisher: params.publisher,
      timestamp: params.timestamp
    });
  }

  applyArchitectSyncUpdate(result: ArchitectSyncUpdateResult | null) {
    if (!result) return null;
    this.architectDivergenceActive = result.nextDivergenceActive;
    if (result.divergenceLogMetadata) {
      this.deps.logger.bot(this.config, "architect_strategy_divergence", result.divergenceLogMetadata);
    }
    return result;
  }

  updateArchitectSyncState(position: PositionRecord | null, timestamp?: number, params: {
    architectState?: ArchitectUsabilityState | null;
    contextSnapshot?: any;
    currentFamily?: ArchitectUsabilityState["currentFamily"];
    publisher?: any;
    state?: any;
  } = {}) {
    const syncUpdate = this.applyArchitectSyncUpdate(this.architectCoordinator.updateSyncState(position, {
      activeStrategyId: this.strategy.id,
      architectState: params.architectState,
      contextSnapshot: params.contextSnapshot,
      currentDivergenceActive: this.architectDivergenceActive,
      currentFamily: params.currentFamily !== undefined ? params.currentFamily : undefined,
      publisher: params.publisher,
      state: params.state,
      timestamp
    }));
    if (!syncUpdate) return null;
    return {
      architectState: syncUpdate.architectState,
      published: syncUpdate.published,
      state: syncUpdate.state
    };
  }

  maybeApplyPublishedArchitect(position: PositionRecord | null, timestamp?: number, params: {
    architectState?: ArchitectUsabilityState | null;
    contextSnapshot?: any;
    currentFamily?: ArchitectUsabilityState["currentFamily"];
    publisher?: any;
    state?: any;
  } = {}) {
    const applyResult = this.architectCoordinator.applyPublishedState(position, {
      activeStrategyId: this.strategy.id,
      architectState: params.architectState,
      contextSnapshot: params.contextSnapshot,
      currentDivergenceActive: this.architectDivergenceActive,
      currentFamily: params.currentFamily !== undefined ? params.currentFamily : undefined,
      publisher: params.publisher,
      state: params.state,
      timestamp
    });
    if (!applyResult) return;
    if (applyResult.syncUpdate) {
      this.applyArchitectSyncUpdate(applyResult.syncUpdate);
    }
    if (applyResult.nextStrategy) {
      this.strategy = applyResult.nextStrategy;
    }
    if (applyResult.logEvent) {
      this.deps.logger.bot(this.config, applyResult.logEvent.message, applyResult.logEvent.metadata);
    }
    if (applyResult.compactArchitectChangeMetadata) {
      this.emitCompactDescriptor(this.telemetry.buildCompactArchitectDescriptor(applyResult.compactArchitectChangeMetadata));
    }
    return applyResult;
  }

  resolveEntryEconomicsStrategy(context?: Partial<MarketContext> | null): Strategy {
    const strategyId = String(context?.strategyId || this.strategy?.id || "").trim();
    if (!strategyId || strategyId === this.strategy?.id) {
      return this.strategy;
    }
    return this.deps.strategyRegistry.createStrategy(strategyId);
  }

  estimateEntryEconomics(params: {
    context?: Partial<MarketContext> | null;
    price: number;
    quantity: number | null;
    side?: "long" | "short" | null;
    mtfDiagnostics?: ArchitectAssessment["mtf"] | null;
  }): EntryEconomicsEstimate {
    const resolvedFeeRate = Number(this.deps.executionEngine?.feeRate);
    const feeRate = Math.max(Number.isFinite(resolvedFeeRate) ? resolvedFeeRate : 0, 0);
    return estimateStrategyEntryEconomics({
      context: params.context,
      defaultMinExpectedNetEdgePct: this.minExpectedNetEdgePct,
      estimatedSlippagePct: this.entrySlippageBufferPct,
      feeRate,
      price: params.price,
      profitSafetyBufferPct: this.entryProfitSafetyBufferPct,
      quantity: params.quantity,
      side: params.side,
      strategy: this.resolveEntryEconomicsStrategy(params.context),
      mtfDiagnostics: params.mtfDiagnostics || ((params.context?.metadata as any)?.architectMtf as ArchitectAssessment["mtf"] | null | undefined) || null
    });
  }

  buildEntryDiagnostics(params: {
    architectState: ArchitectUsabilityState;
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
    return this.telemetry.buildEntryDiagnostics({
      architectState: params.architectState,
      context: params.context,
      contextSnapshot: params.contextSnapshot,
      decision: params.decision,
      economics: params.economics,
      entryMaturityThreshold: params.architectState.entryMaturityThreshold ?? this.architectCoordinator.resolveEntryMaturityThreshold(params.contextSnapshot),
      postLossArchitectLatch: this.postLossArchitectLatch.getState(this.strategy.id, params.state) as PostLossArchitectLatchTelemetryState,
      profile: params.profile,
      quantity: params.quantity,
      riskGate: params.riskGate,
      signalEvaluated: params.signalEvaluated,
      signalState: params.signalState,
      state: params.state,
      strategyId: params.strategyId,
      tick: params.tick,
      tradeConstraints: this.deps.riskManager.getTradeConstraints()
    });
  }

  resolvePostLossArchitectLatchBlockReason(state?: any) {
    const latchState = this.postLossArchitectLatch.getState(this.strategy.id, state);
    if (!latchState.blocking) {
      return null;
    }
    if (Number.isFinite(Number(latchState.timedOutAt)) && Number(latchState.timedOutAt) > 0) {
      return "post_loss_latch_timeout_requires_operator";
    }
    if (this.postLossLatchMaxMs === null) {
      return "post_loss_architect_latch";
    }

    const startedAt = Number(latchState.startedAt || latchState.activatedAt || 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      return "post_loss_architect_latch";
    }

    const observedAt = this.now();
    if (Math.max(0, observedAt - startedAt) < this.postLossLatchMaxMs) {
      return "post_loss_architect_latch";
    }

    this.deps.store.updateBotState(this.config.id, {
      lastDecision: "hold",
      lastDecisionConfidence: 0,
      lastDecisionReasons: ["post_loss_latch_timeout_requires_operator"],
      postLossArchitectLatchTimedOutAt: observedAt
    } as any);
    return "post_loss_latch_timeout_requires_operator";
  }

  evaluateFinalEntryGate(params: {
    architectState?: ArchitectUsabilityState | null;
    context: any;
    contextSnapshot?: any;
    currentFamily?: ArchitectUsabilityState["currentFamily"];
    decision: any;
    profile?: any;
    quantity: number;
    state?: any;
    tick: MarketTick;
  }): FinalEntryGateEvaluationResult {
    const entrySide = normalizeEntrySide(params.decision?.side, params.decision?.action);
    const contextSnapshot = params.contextSnapshot !== undefined
      ? params.contextSnapshot
      : this.deps.store.getContextSnapshot(this.config.symbol);
    const currentFamily = params.currentFamily || this.deps.strategySwitcher.getStrategyFamily(this.strategy.id);
    const architectState = params.architectState || this.evaluateArchitectUsability({
      contextSnapshot,
      currentFamily,
      timestamp: params.tick.timestamp
    });
    const economics = this.estimateEntryEconomics({
      context: params.context,
      price: params.tick.price,
      quantity: params.quantity,
      side: entrySide,
      mtfDiagnostics: architectState.architect?.mtf || null
    });
    const tradeConstraints = this.deps.riskManager.getTradeConstraints();
    const tradeConstraintValidation = validateTradeConstraints({
      minNotionalUsdt: tradeConstraints.minNotionalUsdt,
      minQuantity: tradeConstraints.minQuantity,
      price: params.tick.price,
      quantity: params.quantity
    });
    const diagnostics = this.buildEntryDiagnostics({
      architectState,
      context: params.context,
      contextSnapshot,
      decision: params.decision,
      economics,
      profile: params.profile || this.deps.riskManager.getProfile(this.config.riskProfile, this.config.riskOverrides || null),
      quantity: params.quantity,
      signalEvaluated: true,
      state: params.state || this.deps.store.getBotState(this.config.id),
      strategyId: this.strategy.id,
      tick: params.tick
    });
    if (tradeConstraintValidation.belowMinNotional) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "notional_below_minimum" }, economics };
    }
    if (tradeConstraintValidation.belowMinQuantity) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "quantity_below_minimum" }, economics };
    }
    const latchBlockReason = this.resolvePostLossArchitectLatchBlockReason(params.state || this.deps.store.getBotState(this.config.id));
    if (latchBlockReason) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: latchBlockReason }, economics };
    }

    const gateResult = this.entryCoordinator.evaluateFinalGate({
      architectState,
      diagnostics,
      economics,
      postLossArchitectLatchBlocking: false,
      quantity: params.quantity,
      tradeConstraints: {
        minNotionalUsdt: 0,
        minQuantity: 0
      }
    });
    return {
      ...gateResult,
      economics
    };
  }

  createTickSnapshot(tick: MarketTick, overrides: Partial<TradingTickSnapshot> = {}): TradingTickSnapshot {
    return Object.freeze({
      tick,
      state: overrides.state !== undefined ? overrides.state : this.deps.store.getBotState(this.config.id),
      position: overrides.position !== undefined ? overrides.position : this.deps.store.getPosition(this.config.id),
      performance: overrides.performance !== undefined ? overrides.performance : this.deps.store.getPerformance(this.config.id),
      contextSnapshot: overrides.contextSnapshot !== undefined ? overrides.contextSnapshot : this.deps.store.getContextSnapshot(this.config.symbol),
      currentFamily: overrides.currentFamily !== undefined ? overrides.currentFamily : this.deps.strategySwitcher.getStrategyFamily(this.strategy.id),
      publishedArchitect: overrides.publishedArchitect !== undefined ? overrides.publishedArchitect : this.architectCoordinator.getPublishedAssessment(),
      publisherState: overrides.publisherState !== undefined ? overrides.publisherState : this.deps.store.getArchitectPublisherState(this.config.symbol)
    });
  }

  prepareTickSnapshot(tick: MarketTick): TradingTickSnapshot | null {
    let state = this.ensureCooldownState(tick.timestamp);
    if (!state || state.status === "stopped") return null;

    this.deps.store.updateBotState(this.config.id, {
      lastTickAt: tick.timestamp
    });
    const latchRefresh = this.postLossArchitectLatch.refresh();
    this.emitPostLossArchitectLatchTransition(latchRefresh.transition);
    state = latchRefresh.state || this.deps.store.getBotState(this.config.id);
    if (!state) {
      return null;
    }

    return this.createTickSnapshot(tick, { state });
  }

  evaluateArchitectStateForTick(snapshot: TradingTickSnapshot, timestamp?: number) {
    return this.evaluateArchitectUsability({
      architect: snapshot.publishedArchitect,
      contextSnapshot: snapshot.contextSnapshot,
      currentFamily: snapshot.currentFamily,
      publisher: snapshot.publisherState,
      timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : snapshot.tick.timestamp
    });
  }

  applyArchitectTickPhase(snapshot: TradingTickSnapshot): TradingTickArchitectContext {
    const architectState = !snapshot.position
      ? this.evaluateArchitectStateForTick(snapshot, snapshot.tick.timestamp)
      : null;

    this.updateArchitectSyncState(snapshot.position, snapshot.tick.timestamp, {
      architectState,
      contextSnapshot: snapshot.contextSnapshot,
      currentFamily: snapshot.currentFamily,
      publisher: snapshot.publisherState,
      state: snapshot.state
    });
    this.maybeApplyPublishedArchitect(snapshot.position, snapshot.tick.timestamp, {
      architectState,
      contextSnapshot: snapshot.contextSnapshot,
      currentFamily: snapshot.currentFamily,
      publisher: snapshot.publisherState,
      state: snapshot.state
    });

    const nextSnapshot = this.createTickSnapshot(snapshot.tick);
    let nextArchitectState = null;
    if (!nextSnapshot.position && architectState) {
      if (architectState.currentFamily === nextSnapshot.currentFamily) {
        nextArchitectState = architectState;
      } else {
        const actionableFamily = architectState.actionableFamily;
        nextArchitectState = {
          ...architectState,
          currentFamily: nextSnapshot.currentFamily,
          familyMatch: actionableFamily ? nextSnapshot.currentFamily === actionableFamily : null
        };
      }
    }
    return Object.freeze({
      ...nextSnapshot,
      architectState: nextArchitectState
    });
  }

  handleArchitectEntryShortCircuit(snapshot: TradingTickArchitectContext) {
    this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, this.now());
    this.deps.store.updateBotState(
      this.config.id,
      this.entryCoordinator.buildArchitectEntryShortCircuitStatePatch(snapshot.architectState?.blockReason)
    );
    this.recordEntryEvaluationCounters("blocked", false);
    this.logArchitectEntryShortCircuit(snapshot.architectState);
  }

  getMarketDataFreshnessState(): MarketDataFreshnessState {
    const observedAt = this.now();
    return typeof this.deps.store.getMarketDataFreshness === "function"
      ? this.deps.store.getMarketDataFreshness(this.config.symbol, {
          now: observedAt
        })
      : {
          reason: "market_data_freshness_unavailable",
          status: "stale",
          updatedAt: observedAt
        };
  }

  handleMarketDataFreshnessShortCircuit(snapshot: TradingTickArchitectContext, freshness: MarketDataFreshnessState) {
    this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, this.now());
    this.deps.store.updateBotState(this.config.id, {
      entrySignalStreak: 0,
      exitSignalStreak: 0,
      lastDecision: "hold",
      lastDecisionConfidence: 0,
      lastDecisionReasons: [
        "market_data_not_fresh",
        freshness.status,
        freshness.reason || null
      ].filter(Boolean)
    });
    const blockedState = this.deps.store.getBotState(this.config.id) || snapshot.state;
    this.recordEntryEvaluationCounters("blocked", false);
    this.deps.logger.bot(this.config, "entry_gate_blocked", {
      blockReason: "market_data_not_fresh",
      marketDataFreshnessReason: freshness.reason || null,
      marketDataFreshnessStatus: freshness.status,
      riskAllowed: false,
      riskReason: "market_data_not_fresh"
    });
    this.logEntryBlocked(blockedState, "market_data_not_fresh");
  }

  logDegradedDataExitWarning(freshness: MarketDataFreshnessState, tick: MarketTick) {
    if (freshness.status === "fresh") {
      return;
    }
    this.deps.logger.bot(this.config, "degraded_data_exit_warning", {
      marketDataFreshnessReason: freshness.reason || null,
      marketDataFreshnessReceivedAt: freshness.receivedAt || null,
      marketDataFreshnessStatus: freshness.status,
      marketDataFreshnessUpdatedAt: freshness.updatedAt || null,
      signalTimestamp: tick.timestamp,
      symbol: this.config.symbol
    });
  }

  evaluateTickDecision(snapshot: TradingTickArchitectContext): TradingTickDecisionContext {
    const context = this.buildContext(snapshot.tick, {
      performance: snapshot.performance,
      position: snapshot.position
    });
    const decision = this.strategy.evaluate(context);
    this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, this.now());
    this.deps.store.updateBotState(this.config.id, {
      lastDecision: decision.action,
      lastDecisionConfidence: decision.confidence,
      lastDecisionReasons: decision.reason
    });

    const postDecisionSnapshot = this.createTickSnapshot(snapshot.tick);
    const position = postDecisionSnapshot.position;
    const managedRecoveryTarget = position && isManagedRecoveryPosition(position)
      ? this.resolveManagedRecoveryTarget({ context, position })
      : null;
    const signalState = this.entryCoordinator.updateSignalState({
      decisionAction: decision.action,
      hasPosition: Boolean(position),
      managedRecoveryPriceTargetHit: managedRecoveryTarget?.hit,
      position,
      state: postDecisionSnapshot.state,
      timestamp: snapshot.tick.timestamp
    });
    const profile = this.deps.riskManager.getProfile(this.config.riskProfile, this.config.riskOverrides || null);

    return Object.freeze({
      ...postDecisionSnapshot,
      architectState: snapshot.architectState,
      context,
      decision,
      managedRecoveryTarget,
      profile,
      signalState,
      state: signalState
    });
  }

  handleEntryTick(snapshot: TradingTickDecisionContext) {
    const currentArchitectState = snapshot.architectState || this.evaluateArchitectStateForTick(snapshot, snapshot.tick.timestamp);
    const portfolioKillSwitch = typeof this.deps.store.getPortfolioKillSwitchState === "function"
      ? this.deps.store.getPortfolioKillSwitchState({
          feeRate: Number(this.deps.executionEngine?.feeRate || 0),
          now: this.now()
        })
      : null;
    const marketDataFreshness = this.getMarketDataFreshnessState();
    const riskGate = this.deps.riskManager.canOpenTrade({
      now: snapshot.tick.timestamp,
      performance: snapshot.performance,
      portfolioKillSwitch,
      positionOpen: false,
      riskProfile: this.config.riskProfile,
      riskOverrides: this.config.riskOverrides || null,
      state: snapshot.signalState
    });
    const entryRiskGate = marketDataFreshness.status === "fresh" || !riskGate.allowed
      ? riskGate
      : {
          allowed: false,
          reason: "market_data_not_fresh"
        };
    const baseEconomics = this.estimateEntryEconomics({
      context: snapshot.context,
      price: snapshot.tick.price,
      quantity: null,
      side: normalizeEntrySide(snapshot.decision?.side, snapshot.decision?.action),
      mtfDiagnostics: currentArchitectState.architect?.mtf || null
    });
    const evaluationState = snapshot.state;
    const entryAttempt = this.entryCoordinator.resolveEntryAttempt({
      decisionAction: snapshot.decision.action,
      entryDebounceTicks: snapshot.profile.entryDebounceTicks,
      entrySignalStreak: snapshot.signalState.entrySignalStreak,
      riskAllowed: entryRiskGate.allowed,
      riskReason: entryRiskGate.reason
    });

    if (entryAttempt.kind === "eligible") {
      const preparedOpenAttempt = this.openAttemptCoordinator.prepare({
        balanceUsdt: snapshot.signalState.availableBalanceUsdt,
        confidence: snapshot.decision.confidence,
        latestPrice: snapshot.tick.price,
        performance: snapshot.performance,
        riskProfile: this.config.riskProfile,
        riskOverrides: this.config.riskOverrides || null,
        state: snapshot.signalState,
        volatilityRisk: snapshot.contextSnapshot?.features?.volatilityRisk
      });
      if (preparedOpenAttempt.kind === "skipped") {
        const sizingEconomics = this.estimateEntryEconomics({
          context: snapshot.context,
          price: snapshot.tick.price,
          quantity: preparedOpenAttempt.quantity,
          side: normalizeEntrySide(snapshot.decision?.side, snapshot.decision?.action),
          mtfDiagnostics: currentArchitectState.architect?.mtf || null
        });
        this.applyEntryOutcome(this.entryOutcomeCoordinator.buildSkippedOutcome({
          architectState: currentArchitectState,
          context: snapshot.context,
          contextSnapshot: snapshot.contextSnapshot,
          decision: snapshot.decision,
          economics: sizingEconomics,
          profile: snapshot.profile,
          quantity: preparedOpenAttempt.quantity,
          riskGate: entryRiskGate,
          signalState: snapshot.signalState,
          skipReason: preparedOpenAttempt.skipReason,
          state: evaluationState,
          strategyId: this.strategy.id,
          tick: snapshot.tick
        }));
        return;
      }
      const sizing = preparedOpenAttempt.sizing;

      const finalEntryGate = this.evaluateFinalEntryGate({
        architectState: currentArchitectState,
        context: snapshot.context,
        contextSnapshot: snapshot.contextSnapshot,
        currentFamily: snapshot.currentFamily,
        decision: snapshot.decision,
        profile: snapshot.profile,
        quantity: sizing.quantity,
        state: evaluationState,
        tick: snapshot.tick
      });
      if (!finalEntryGate.allowed) {
        this.applyEntryOutcome(this.entryOutcomeCoordinator.buildFinalGateBlockedOutcome({
          architectState: currentArchitectState,
          blockReason: finalEntryGate.diagnostics.blockReason,
          context: snapshot.context,
          contextSnapshot: snapshot.contextSnapshot,
          decision: snapshot.decision,
          diagnostics: finalEntryGate.diagnostics,
          economics: finalEntryGate.economics,
          profile: snapshot.profile,
          quantity: sizing.quantity,
          riskGate: entryRiskGate,
          signalState: snapshot.signalState,
          state: evaluationState,
          strategyId: this.strategy.id,
          tick: snapshot.tick
        }));
        return;
      }

      const publishedArchitect = finalEntryGate.architect;
      const executionResult = this.openAttemptCoordinator.execute({
        availableBalanceUsdt: snapshot.signalState.availableBalanceUsdt,
        botId: this.config.id,
        confidence: snapshot.decision.confidence,
        edgeDiagnostics: this.buildEntryEdgeDiagnostics({
          architectState: currentArchitectState,
          economics: finalEntryGate.economics,
          tick: snapshot.tick
        }),
        entryDebounceTicks: snapshot.profile.entryDebounceTicks,
        price: snapshot.tick.price,
        quantity: sizing.quantity,
        reason: snapshot.decision.reason,
        recordedAt: this.now(),
        side: normalizeEntrySide(snapshot.decision?.side, snapshot.decision?.action),
        strategyId: this.strategy.id,
        symbol: this.config.symbol
      });
      if (executionResult.kind === "execution_rejected") {
        const executionDiagnostics = {
          ...finalEntryGate.diagnostics,
          ...executionResult.executionDiagnostics
        };
        this.applyEntryOutcome(this.entryOutcomeCoordinator.buildExecutionRejectedOutcome({
          architectState: currentArchitectState,
          blockReason: executionResult.blockReason,
          context: snapshot.context,
          contextSnapshot: snapshot.contextSnapshot,
          decision: snapshot.decision,
          diagnostics: executionDiagnostics,
          economics: finalEntryGate.economics,
          profile: snapshot.profile,
          quantity: sizing.quantity,
          riskGate: entryRiskGate,
          signalState: snapshot.signalState,
          state: evaluationState,
          strategyId: this.strategy.id,
          tick: snapshot.tick
        }));
        return;
      }
      const opened = executionResult.opened;

      this.applyEntryOutcome(this.entryOutcomeCoordinator.buildOpenedOutcome({
        architectState: currentArchitectState,
        context: snapshot.context,
        contextSnapshot: snapshot.contextSnapshot,
        decision: snapshot.decision,
        diagnostics: finalEntryGate.diagnostics,
        economics: finalEntryGate.economics,
        openedAt: opened.openedAt,
        openedQuantity: opened.quantity,
        profile: snapshot.profile,
        publishedArchitect,
        riskGate: entryRiskGate,
        signalState: snapshot.signalState,
        state: evaluationState,
        statePatch: executionResult.statePatch,
        strategyId: this.strategy.id,
        tick: snapshot.tick
      }));
      return;
    }

    if (entryAttempt.kind === "blocked") {
      const blockedDiagnostics = {
        ...this.buildEntryDiagnostics({
          architectState: currentArchitectState,
          context: snapshot.context,
          contextSnapshot: snapshot.contextSnapshot,
          decision: snapshot.decision,
          economics: baseEconomics,
          profile: snapshot.profile,
          quantity: null,
          riskGate: entryRiskGate,
          signalEvaluated: true,
          signalState: snapshot.signalState,
          state: evaluationState,
          strategyId: this.strategy.id,
          tick: snapshot.tick
        }),
        blockReason: entryAttempt.blockReason
      };
      this.applyEntryOutcome(this.entryOutcomeCoordinator.buildRiskBlockedOutcome({
        architectState: currentArchitectState,
        blockReason: entryAttempt.blockReason,
        context: snapshot.context,
        contextSnapshot: snapshot.contextSnapshot,
        decision: snapshot.decision,
        diagnostics: blockedDiagnostics,
        economics: baseEconomics,
        profile: snapshot.profile,
        riskGate: entryRiskGate,
        signalState: snapshot.signalState,
        state: evaluationState,
        strategyId: this.strategy.id,
        tick: snapshot.tick
      }));
    } else if (entryAttempt.skipReason === "debounce_not_satisfied") {
      this.applyEntryOutcome(this.entryOutcomeCoordinator.buildSkippedOutcome({
        architectState: currentArchitectState,
        context: snapshot.context,
        contextSnapshot: snapshot.contextSnapshot,
        decision: snapshot.decision,
        economics: baseEconomics,
        profile: snapshot.profile,
        quantity: null,
        riskGate: entryRiskGate,
        signalState: snapshot.signalState,
        skipReason: entryAttempt.skipReason,
        state: evaluationState,
        strategyId: this.strategy.id,
        tick: snapshot.tick
      }));
    } else if (entryAttempt.skipReason === "no_entry_signal") {
      this.applyEntryOutcome(this.entryOutcomeCoordinator.buildSkippedOutcome({
        architectState: currentArchitectState,
        context: snapshot.context,
        contextSnapshot: snapshot.contextSnapshot,
        decision: snapshot.decision,
        economics: baseEconomics,
        profile: snapshot.profile,
        quantity: null,
        riskGate: entryRiskGate,
        signalState: snapshot.signalState,
        skipReason: entryAttempt.skipReason,
        state: evaluationState,
        strategyId: this.strategy.id,
        tick: snapshot.tick
      }));
    }
  }

  handleExitTick(snapshot: TradingTickDecisionContext) {
    if (!snapshot.position) {
      return;
    }
    const positionSnapshot = this.clonePositionSnapshot(snapshot.position);
    const managedRecoveryTarget = isManagedRecoveryPosition(positionSnapshot)
      ? this.resolveManagedRecoveryTarget({
          context: snapshot.context,
          position: positionSnapshot
        })
      : snapshot.managedRecoveryTarget;
    const managedRecoveryArchitectState = isManagedRecoveryPosition(positionSnapshot)
      ? this.evaluateArchitectStateForTick(snapshot, snapshot.tick.timestamp)
      : null;

    const exitPlan = this.shouldExitPosition({
      architectState: managedRecoveryArchitectState,
      decision: snapshot.decision,
      managedRecoveryTarget,
      position: positionSnapshot,
      signalState: snapshot.signalState,
      tick: snapshot.tick
    });

    if (this.handleDeferredManagedRecoveryExit({
      architectState: managedRecoveryArchitectState,
      exitPlan,
      positionSnapshot,
      snapshot
    })) {
      return;
    }

    if (this.handlePendingManagedRecoveryExit({
      architectState: managedRecoveryArchitectState,
      exitPlan,
      managedRecoveryTarget,
      positionSnapshot,
      snapshot
    })) {
      return;
    }

    if (!exitPlan.exitNow) {
      return;
    }

    const exitingTransition = exitPlan.lifecycleEvent
      ? beginPositionExit(positionSnapshot, {
          event: exitPlan.lifecycleEvent,
          timestamp: snapshot.tick.timestamp
        })
      : null;
    const exitingPosition = exitingTransition?.allowed
      ? exitingTransition.position
      : positionSnapshot;

    const closedTrade = this.deps.executionEngine.closePosition({
      botId: this.config.id,
      expectedExitPrice: this.resolveExpectedExitPrice({
        exitPlan,
        managedRecoveryTarget,
        tick: snapshot.tick
      }),
      lifecycleEvent: exitPlan.lifecycleEvent || null,
      lifecycleState: "EXITING",
      price: snapshot.tick.price,
      reason: exitPlan.reason,
      timestamp: snapshot.tick.timestamp
    });

    if (!closedTrade) {
      this.deps.logger.bot(this.config, "RISK_CHANGE", {
        status: "position_close_rejected",
        reason: "close_position_returned_null",
        botId: this.config.id,
        symbol: this.config.symbol,
        strategyId: this.strategy.id,
        lifecycleEvent: exitPlan.lifecycleEvent || null,
        lifecycleState: "EXITING",
        exitMechanism: exitPlan.exitMechanism || null,
        exitReasons: exitPlan.reason,
        invalidationLevel: exitPlan.invalidationLevel || null,
        invalidationMode: exitPlan.invalidationMode || null,
        positionId: positionSnapshot.id,
        positionLifecycleMode: positionSnapshot.lifecycleMode || null,
        positionLifecycleState: positionSnapshot.lifecycleState || null,
        signalTimestamp: snapshot.tick.timestamp,
        tickPrice: snapshot.tick.price
      });
      return;
    }
    const closeClassification = this.classifyClosedTrade(closedTrade, exitPlan);
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
      signalTimestamp: snapshot.tick.timestamp,
      tick: snapshot.tick
    });

    const nextPerformance = this.deps.performanceMonitor.update(snapshot.performance, closedTrade);
    this.deps.store.setPerformance(this.config.id, nextPerformance);
    this.applyClosedTradeOutcome(this.exitOutcomeCoordinator.buildClosedTradeOutcome({
      classification: closeClassification,
      closedTrade,
      exitTelemetry,
      feeRate: Number(this.deps.executionEngine?.feeRate || 0),
      lifecycleStatus: snapshot.signalState.status,
      nextPerformance,
      positionWasManagedRecovery: isManagedRecoveryPosition(positionSnapshot),
      riskProfile: this.config.riskProfile,
      riskOverrides: this.config.riskOverrides || null,
      signalState: snapshot.signalState,
      strategyId: this.strategy.id,
      tickPrice: snapshot.tick.price
    }));
    this.ensureCooldownState(closedTrade.closedAt);
    const closedSnapshot = this.createTickSnapshot(snapshot.tick);
    const closedArchitectState = this.evaluateArchitectStateForTick(closedSnapshot, closedTrade.closedAt);
    this.updateArchitectSyncState(null, closedTrade.closedAt, {
      architectState: closedArchitectState,
      contextSnapshot: closedSnapshot.contextSnapshot,
      currentFamily: closedSnapshot.currentFamily,
      publisher: closedSnapshot.publisherState,
      state: closedSnapshot.state
    });
    this.maybeApplyPublishedArchitect(null, closedTrade.closedAt, {
      architectState: closedArchitectState,
      contextSnapshot: closedSnapshot.contextSnapshot,
      currentFamily: closedSnapshot.currentFamily,
      publisher: closedSnapshot.publisherState,
      state: closedSnapshot.state
    });
  }

  onMarketTick(tick: MarketTick) {
    const tickTimer = startTimer();
    const botTickStartedAt = this.now();
    if (typeof this.deps.store.recordBotTickStart === "function") {
      this.deps.store.recordBotTickStart(this.config.id, this.config.symbol, botTickStartedAt);
    }
    const prepareTimer = startTimer();
    const preparedSnapshot = this.prepareTickSnapshot(tick);
    const botPrepareMs = elapsedMs(prepareTimer);
    if (!preparedSnapshot) {
      if (typeof this.deps.store.recordTickLatencySample === "function") {
        this.deps.store.recordTickLatencySample(this.config.symbol, {
          botActionMs: 0,
          botArchitectPhaseMs: 0,
          botDecisionMs: 0,
          botPrepareMs,
          botTickMs: elapsedMs(tickTimer)
        }, tick.timestamp);
      }
      return;
    }

    if (preparedSnapshot.state?.status === "stopped" || (preparedSnapshot.state?.status === "paused" && !preparedSnapshot.position)) {
      if (typeof this.deps.store.recordTickLatencySample === "function") {
        this.deps.store.recordTickLatencySample(this.config.symbol, {
          botActionMs: 0,
          botArchitectPhaseMs: 0,
          botDecisionMs: 0,
          botPrepareMs,
          botTickMs: elapsedMs(tickTimer)
        }, tick.timestamp);
      }
      return;
    }

    const architectPhaseTimer = startTimer();
    const architectSnapshot = this.applyArchitectTickPhase(preparedSnapshot);
    const botArchitectPhaseMs = elapsedMs(architectPhaseTimer);
    if (!architectSnapshot.position && architectSnapshot.architectState && !architectSnapshot.architectState.usable) {
      const actionTimer = startTimer();
      this.handleArchitectEntryShortCircuit(architectSnapshot);
      if (typeof this.deps.store.recordTickLatencySample === "function") {
        this.deps.store.recordTickLatencySample(this.config.symbol, {
          botActionMs: elapsedMs(actionTimer),
          botArchitectPhaseMs,
          botDecisionMs: 0,
          botPrepareMs,
          botTickMs: elapsedMs(tickTimer)
        }, tick.timestamp);
      }
      return;
    }

    if (!architectSnapshot.position) {
      const marketDataFreshness = this.getMarketDataFreshnessState();
      if (marketDataFreshness.status !== "fresh") {
        const actionTimer = startTimer();
        this.handleMarketDataFreshnessShortCircuit(architectSnapshot, marketDataFreshness);
        if (typeof this.deps.store.recordTickLatencySample === "function") {
          this.deps.store.recordTickLatencySample(this.config.symbol, {
            botActionMs: elapsedMs(actionTimer),
            botArchitectPhaseMs,
            botDecisionMs: 0,
            botPrepareMs,
            botTickMs: elapsedMs(tickTimer)
          }, tick.timestamp);
        }
        return;
      }
    } else {
      this.logDegradedDataExitWarning(this.getMarketDataFreshnessState(), tick);
    }

    const decisionTimer = startTimer();
    const decisionSnapshot = this.evaluateTickDecision(architectSnapshot);
    const botDecisionMs = elapsedMs(decisionTimer);
    const actionTimer = startTimer();
    if (!decisionSnapshot.position) {
      this.handleEntryTick(decisionSnapshot);
      if (typeof this.deps.store.recordTickLatencySample === "function") {
        this.deps.store.recordTickLatencySample(this.config.symbol, {
          botActionMs: elapsedMs(actionTimer),
          botArchitectPhaseMs,
          botDecisionMs,
          botPrepareMs,
          botTickMs: elapsedMs(tickTimer)
        }, tick.timestamp);
      }
      return;
    }

    this.handleExitTick(decisionSnapshot);
    if (typeof this.deps.store.recordTickLatencySample === "function") {
      this.deps.store.recordTickLatencySample(this.config.symbol, {
        botActionMs: elapsedMs(actionTimer),
        botArchitectPhaseMs,
        botDecisionMs,
        botPrepareMs,
        botTickMs: elapsedMs(tickTimer)
      }, tick.timestamp);
    }
  }
}

module.exports = {
  TradingBot
};
