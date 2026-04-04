// Module responsibility: real bot implementation composed from strategy, risk, performance and execution roles.

import type { BotConfig } from "../types/bot.ts";
import type { ArchitectAssessment } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";
import type { EntryEconomicsEstimate, MarketContext, Strategy } from "../types/strategy.ts";
import type { PositionRecord } from "../types/trade.ts";
import type { ExitPolicy, InvalidationMode } from "../types/exitPolicy.ts";
import type { PositionExitMechanism } from "../types/positionLifecycle.ts";
import type { BotDeps } from "../types/runtime.ts";
import type { BaseBotClass } from "./baseBot.ts";
import type {
  ArchitectCoordinatorInstance,
  ArchitectCoordinatorParams,
  ArchitectSyncUpdateResult,
  ArchitectTimingMetadata,
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
    activateOnLoss(params: { closedAt: number; netPnl: number; strategyId: string }): { state: any; transition?: PostLossArchitectLatchTransition };
    getState(activeStrategyId: string, runtimeState?: any): any;
    refresh(): { state: any; transition?: PostLossArchitectLatchTransition };
  };
};
const { now } = require("../utils/time.ts");

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
  architectCoordinator: ArchitectCoordinatorInstance;
  entryCoordinator: EntryCoordinatorInstance;
  entryOutcomeCoordinator: EntryOutcomeCoordinatorInstance;
  exitOutcomeCoordinator: ExitOutcomeCoordinatorInstance;
  exitDecisionCoordinator: InstanceType<typeof ExitDecisionCoordinator>;
  openAttemptCoordinator: OpenAttemptCoordinatorInstance;
  telemetry: TradingBotTelemetryInstance;
  postLossArchitectLatch: InstanceType<typeof PostLossArchitectLatch>;

  constructor(config: BotConfig, deps: BotDeps) {
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
    this.architectCoordinator = new ArchitectCoordinator({
      allowedStrategies: this.allowedStrategies,
      botConfig: this.config,
      maxArchitectStateAgeMs: this.maxArchitectStateAgeMs,
      minEntryContextMaturity: this.minEntryContextMaturity,
      minPostSwitchEntryContextMaturity: this.minPostSwitchEntryContextMaturity,
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
    this.deps.logger.bot(this.config, "entry_blocked", this.telemetry.buildArchitectEntryShortCircuitLogMetadata(architectState));
    this.emitCompactDescriptor(this.telemetry.buildArchitectEntryShortCircuitCompactDescriptor(this.strategy.id));
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

  emitCompactDescriptor(descriptor?: CompactLogDescriptor | null) {
    if (!descriptor) {
      return;
    }
    this.emitCompactBotLog(descriptor.message, descriptor.metadata, descriptor.dedupeKey, descriptor.signature);
  }

  logCompactRiskChange(metadata: Record<string, unknown>) {
    this.emitCompactDescriptor(this.telemetry.buildCompactRiskDescriptor(this.strategy.id, metadata));
  }

  logCompactArchitectChange(metadata: Record<string, unknown>) {
    this.emitCompactDescriptor(this.telemetry.buildCompactArchitectDescriptor(metadata));
  }

  emitPostLossArchitectLatchTransition(transition?: PostLossArchitectLatchTransition) {
    if (!transition) {
      return;
    }
    this.deps.logger.bot(this.config, transition.message, transition.logMetadata);
    this.logCompactRiskChange(transition.compactMetadata);
  }

  logCompactBuy(metadata: Record<string, unknown>) {
    this.emitCompactDescriptor(this.telemetry.buildCompactBuyDescriptor(metadata));
  }

  logCompactSell(metadata: Record<string, unknown>) {
    this.emitCompactDescriptor(this.telemetry.buildCompactSellDescriptor(metadata));
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

  logEntryEvaluation(params: {
    allowReason?: string | null;
    architectState: any;
    blockReason?: string | null;
    context?: any;
    contextSnapshot: any;
    decision?: any;
    diagnostics?: any;
    economics: any;
    outcome: "blocked" | "opened" | "skipped";
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
    const metadata = this.telemetry.buildEntryEvaluationMetadata({
      allowReason: params.allowReason,
      blockReason: params.blockReason,
      diagnostics,
      outcome: params.outcome,
      signalEvaluated: params.signalEvaluated,
      skipReason: params.skipReason
    });
    this.emitCompactDescriptor(this.telemetry.maybeBuildCompactSetupDescriptor(metadata, this.strategy.id));
    this.emitCompactDescriptor(this.telemetry.maybeBuildCompactBlockChangeDescriptor(metadata, this.strategy.id));
    const logAt = Number.isFinite(Number(params.tick?.timestamp)) ? Number(params.tick.timestamp) : now();
    const logKey = this.telemetry.buildEntryEvaluationLogKey(metadata);
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

  applyEntryOutcome(outcome: EntryOutcomePlan) {
    this.logEntryEvaluation(outcome.entryEvaluated);
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
      this.deps.store.recordExecution(this.config.id, this.config.symbol, Number(outcome.recordExecutionAt));
    }
    if (outcome.entryOpenedMetadata) {
      this.deps.logger.bot(this.config, "entry_opened", outcome.entryOpenedMetadata);
    }
    if (outcome.compactBuyMetadata) {
      this.logCompactBuy(outcome.compactBuyMetadata);
    }
    if (outcome.lastNonCooldownBlockReason !== undefined) {
      this.lastNonCooldownBlockReason = outcome.lastNonCooldownBlockReason;
    }
  }

  applyClosedTradeOutcome(outcome: ReturnType<ExitOutcomeCoordinatorInstance["buildClosedTradeOutcome"]>) {
    this.deps.store.updateBotState(this.config.id, outcome.statePatch);
    const latchActivation = this.postLossArchitectLatch.activateOnLoss(outcome.latchActivation);
    this.emitPostLossArchitectLatchTransition(latchActivation.transition);
    this.logCompactRiskChange(outcome.compactRiskMetadata);
    if (outcome.failedRsiExitLogMetadata) {
      this.deps.logger.bot(this.config, "failed_rsi_exit", outcome.failedRsiExitLogMetadata);
    }
    if (outcome.managedRecoveryExitedLogMetadata) {
      this.deps.logger.bot(this.config, "managed_recovery_exited", outcome.managedRecoveryExitedLogMetadata);
    }
    this.logCompactSell(outcome.compactSellMetadata);
    this.deps.store.recordExecution(this.config.id, this.config.symbol, outcome.recordExecutionAt);
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

  updateSignalState(params: {
    hasPosition: boolean;
    decisionAction: "buy" | "sell" | "hold";
    decisionReasons?: string[];
    managedRecoveryPriceTargetHit?: boolean;
    position?: PositionRecord | null;
    state: any;
    timestamp: number;
  }) {
    return this.entryCoordinator.updateSignalState({
      decisionAction: params.decisionAction,
      hasPosition: params.hasPosition,
      managedRecoveryPriceTargetHit: params.managedRecoveryPriceTargetHit,
      position: params.position,
      state: params.state,
      timestamp: params.timestamp
    });
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
    } as ExitClassification;
  }

  isRsiExitReason(exitReasons: string[]) {
    return exitReasons.includes("rsi_exit_confirmed") || exitReasons.includes("rsi_exit_threshold_hit");
  }

  getArchitectTimingMetadata(timestamp: number): ArchitectTimingMetadata {
    return this.architectCoordinator.getTimingMetadata(timestamp);
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
      architectTiming: this.getArchitectTimingMetadata(Number(params.signalTimestamp)),
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

  getExitPolicy(): ExitPolicy | null {
    return resolveExitPolicy(this.strategy?.config);
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

  handleDeferredManagedRecoveryExit(params: {
    architectState: any;
    exitPlan: ExitPlan;
    snapshot: TradingTickDecisionContext;
  }) {
    if (params.exitPlan.transition !== "managed_recovery" || !params.exitPlan.nextPosition) {
      return false;
    }

    const estimatedExitEconomics = params.exitPlan.estimatedExitEconomics || this.estimateExitEconomics(params.snapshot.position, params.snapshot.tick.price);
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
    snapshot: TradingTickDecisionContext;
  }) {
    if (params.exitPlan.exitNow) {
      return false;
    }
    if (!isManagedRecoveryPosition(params.snapshot.position)) {
      return false;
    }
    if (!params.snapshot.managedRecoveryTarget?.hit && !(Array.isArray(params.exitPlan.reason) && params.exitPlan.reason.includes("managed_recovery_rsi_ignored"))) {
      return false;
    }

    this.logManagedRecoveryUpdate(this.exitOutcomeCoordinator.buildPendingManagedRecoveryUpdate({
      metadata: {
        ...this.buildExitTelemetry({
          architectState: params.architectState,
          exitMechanism: params.snapshot.managedRecoveryTarget?.hit ? "recovery" : null,
          exitReasons: Array.isArray(params.exitPlan.reason) ? params.exitPlan.reason : [],
          lifecycleEvent: params.snapshot.managedRecoveryTarget?.hit
            ? POSITION_LIFECYCLE_EVENTS.PRICE_TARGET_HIT
            : null,
          managedRecoveryTarget: params.snapshot.managedRecoveryTarget,
          position: params.snapshot.position,
          signalTimestamp: params.snapshot.tick.timestamp,
          tick: params.snapshot.tick
        }),
        exitSignalStreak: params.snapshot.signalState.exitSignalStreak,
        latestPrice: Number(Number(params.snapshot.tick.price || 0).toFixed(4)),
        status: params.snapshot.managedRecoveryTarget?.hit ? "managed_recovery_target_ready" : "managed_recovery_rsi_ignored",
        strategy: this.strategy.id
      }
    }));
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

  getPublishedArchitectAssessment(): ArchitectAssessment | null {
    return this.architectCoordinator.getPublishedAssessment();
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
      this.logCompactArchitectChange(applyResult.compactArchitectChangeMetadata);
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
      strategy: this.resolveEntryEconomicsStrategy(params.context)
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
  }): EntryGateResult {
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
      quantity: params.quantity
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
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "notional_below_minimum" } };
    }
    if (tradeConstraintValidation.belowMinQuantity) {
      return { allowed: false, diagnostics: { ...diagnostics, blockReason: "quantity_below_minimum" } };
    }
    return this.entryCoordinator.evaluateFinalGate({
      architectState,
      diagnostics,
      economics,
      postLossArchitectLatchBlocking: this.postLossArchitectLatch.getState(this.strategy.id, params.state).blocking,
      quantity: params.quantity,
      tradeConstraints: {
        minNotionalUsdt: 0,
        minQuantity: 0
      }
    });
  }

  createTickSnapshot(tick: MarketTick, overrides: Partial<TradingTickSnapshot> = {}): TradingTickSnapshot {
    return Object.freeze({
      tick,
      state: overrides.state !== undefined ? overrides.state : this.deps.store.getBotState(this.config.id),
      position: overrides.position !== undefined ? overrides.position : this.deps.store.getPosition(this.config.id),
      performance: overrides.performance !== undefined ? overrides.performance : this.deps.store.getPerformance(this.config.id),
      contextSnapshot: overrides.contextSnapshot !== undefined ? overrides.contextSnapshot : this.deps.store.getContextSnapshot(this.config.symbol),
      currentFamily: overrides.currentFamily !== undefined ? overrides.currentFamily : this.deps.strategySwitcher.getStrategyFamily(this.strategy.id),
      publishedArchitect: overrides.publishedArchitect !== undefined ? overrides.publishedArchitect : this.getPublishedArchitectAssessment(),
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
    // Max-drawdown pause is intentionally manual-only. Once this state is reached, ticks are ignored
    // until an explicit external resume flips the bot back to running.
    if (!state || (state.status === "paused" && state.pausedReason === "max_drawdown_reached")) {
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
    return Object.freeze({
      ...nextSnapshot,
      architectState: !nextSnapshot.position
        ? this.evaluateArchitectStateForTick(nextSnapshot, snapshot.tick.timestamp)
        : null
    });
  }

  handleArchitectEntryShortCircuit(snapshot: TradingTickArchitectContext) {
    const shortCircuitEconomics = this.estimateEntryEconomics({
      context: null,
      price: snapshot.tick.price,
      quantity: null
    });
    this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, now());
    this.deps.store.updateBotState(
      this.config.id,
      this.entryCoordinator.buildArchitectEntryShortCircuitStatePatch(snapshot.architectState?.blockReason)
    );
    this.logEntryEvaluation({
      architectState: snapshot.architectState,
      blockReason: snapshot.architectState?.blockReason,
      context: null,
      contextSnapshot: snapshot.contextSnapshot,
      decision: null,
      economics: shortCircuitEconomics,
      outcome: "blocked",
      profile: this.deps.riskManager.getProfile(this.config.riskProfile, this.config.riskOverrides || null),
      quantity: null,
      signalEvaluated: false,
      state: this.deps.store.getBotState(this.config.id) || snapshot.state,
      strategyId: this.strategy.id,
      tick: snapshot.tick
    });
    this.logArchitectEntryShortCircuit(snapshot.architectState);
  }

  evaluateTickDecision(snapshot: TradingTickArchitectContext): TradingTickDecisionContext {
    const context = this.buildContext(snapshot.tick, {
      performance: snapshot.performance,
      position: snapshot.position
    });
    const decision = this.strategy.evaluate(context);
    this.deps.store.recordBotEvaluation(this.config.id, this.config.symbol, now());
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
    const signalState = this.updateSignalState({
      decisionAction: decision.action,
      decisionReasons: decision.reason,
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
    const riskGate = this.deps.riskManager.canOpenTrade({
      now: snapshot.tick.timestamp,
      performance: snapshot.performance,
      positionOpen: false,
      riskProfile: this.config.riskProfile,
      riskOverrides: this.config.riskOverrides || null,
      state: snapshot.signalState
    });
    const baseEconomics = this.estimateEntryEconomics({
      context: snapshot.context,
      price: snapshot.tick.price,
      quantity: null
    });
    const evaluationState = snapshot.state;
    const entryAttempt = this.entryCoordinator.resolveEntryAttempt({
      decisionAction: snapshot.decision.action,
      entryDebounceTicks: snapshot.profile.entryDebounceTicks,
      entrySignalStreak: snapshot.signalState.entrySignalStreak,
      riskAllowed: riskGate.allowed,
      riskReason: riskGate.reason
    });

    if (entryAttempt.kind === "eligible") {
      const preparedOpenAttempt = this.openAttemptCoordinator.prepare({
        balanceUsdt: snapshot.signalState.availableBalanceUsdt,
        confidence: snapshot.decision.confidence,
        latestPrice: snapshot.tick.price,
        performance: snapshot.performance,
        riskProfile: this.config.riskProfile,
        riskOverrides: this.config.riskOverrides || null,
        state: snapshot.signalState
      });
      if (preparedOpenAttempt.kind === "skipped") {
        const sizingEconomics = this.estimateEntryEconomics({
          context: snapshot.context,
          price: snapshot.tick.price,
          quantity: preparedOpenAttempt.quantity
        });
        this.applyEntryOutcome(this.entryOutcomeCoordinator.buildSkippedOutcome({
          architectState: currentArchitectState,
          context: snapshot.context,
          contextSnapshot: snapshot.contextSnapshot,
          decision: snapshot.decision,
          economics: sizingEconomics,
          profile: snapshot.profile,
          quantity: preparedOpenAttempt.quantity,
          riskGate,
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
          economics: this.estimateEntryEconomics({
            context: snapshot.context,
            price: snapshot.tick.price,
            quantity: sizing.quantity
          }),
          profile: snapshot.profile,
          quantity: sizing.quantity,
          riskGate,
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
        entryDebounceTicks: snapshot.profile.entryDebounceTicks,
        price: snapshot.tick.price,
        quantity: sizing.quantity,
        reason: snapshot.decision.reason,
        recordedAt: now(),
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
          economics: this.estimateEntryEconomics({
            context: snapshot.context,
            price: snapshot.tick.price,
            quantity: sizing.quantity
          }),
          profile: snapshot.profile,
          quantity: sizing.quantity,
          riskGate,
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
        economics: this.estimateEntryEconomics({
          context: snapshot.context,
          price: snapshot.tick.price,
          quantity: sizing.quantity
        }),
        openedAt: opened.openedAt,
        openedQuantity: opened.quantity,
        profile: snapshot.profile,
        publishedArchitect,
        riskGate,
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
          riskGate,
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
        riskGate,
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
        riskGate,
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
        riskGate,
        signalState: snapshot.signalState,
        skipReason: entryAttempt.skipReason,
        state: evaluationState,
        strategyId: this.strategy.id,
        tick: snapshot.tick
      }));
    }
  }

  handleExitTick(snapshot: TradingTickDecisionContext) {
    const managedRecoveryArchitectState = isManagedRecoveryPosition(snapshot.position)
      ? this.evaluateArchitectStateForTick(snapshot, snapshot.tick.timestamp)
      : null;

    const exitPlan = this.shouldExitPosition({
      architectState: managedRecoveryArchitectState,
      decision: snapshot.decision,
      managedRecoveryTarget: snapshot.managedRecoveryTarget,
      position: snapshot.position,
      signalState: snapshot.signalState,
      tick: snapshot.tick
    });

    if (this.handleDeferredManagedRecoveryExit({
      architectState: managedRecoveryArchitectState,
      exitPlan,
      snapshot
    })) {
      return;
    }

    if (this.handlePendingManagedRecoveryExit({
      architectState: managedRecoveryArchitectState,
      exitPlan,
      snapshot
    })) {
      return;
    }

    if (!exitPlan.exitNow) {
      return;
    }

    const exitingTransition = exitPlan.lifecycleEvent
      ? beginPositionExit(snapshot.position, {
          event: exitPlan.lifecycleEvent,
          timestamp: snapshot.tick.timestamp
        })
      : null;
    const exitingPosition = exitingTransition?.allowed
      ? exitingTransition.position
      : snapshot.position;

    const closedTrade = this.deps.executionEngine.closePosition({
      botId: this.config.id,
      lifecycleEvent: exitPlan.lifecycleEvent || null,
      lifecycleState: "EXITING",
      price: snapshot.tick.price,
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
      managedRecoveryTarget: snapshot.managedRecoveryTarget,
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
      positionWasManagedRecovery: isManagedRecoveryPosition(snapshot.position),
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
