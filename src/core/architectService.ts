// Module responsibility: observe rolling context continuously and publish stable architect decisions on cadence.

import type { ArchitectAssessment, ArchitectPublisherState, MarketRegime, RecommendedFamily } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";
import type { MtfFrameConfig, MtfPublishDiagnostics, MtfSnapshot } from "../types/mtf.ts";

const { aggregateMtfSnapshots } = require("../roles/mtfContextAggregator.ts");
const { elapsedMs, startTimer } = require("../utils/timing.ts");

const DEFAULT_MTF_FRAMES: MtfFrameConfig[] = [
  { id: "1m", horizonFrame: "short", windowMs: 60_000 },
  { id: "5m", horizonFrame: "short", windowMs: 300_000 },
  { id: "15m", horizonFrame: "medium", windowMs: 900_000 },
];
const DEFAULT_MTF_INSTABILITY_THRESHOLD = 0.5;
const MTF_MIN_READY_FRAMES = 2;

class ArchitectService {
  store: any;
  marketStream: any;
  botArchitect: any;
  logger: any;
  publishIntervalMs: number;
  switchDelta: number;
  requiredConfirmations: number;
  subscriptions: Array<() => void>;
  warmupMs: number;
  mtfEnabled: boolean;
  mtfContextService: any;
  mtfFrames: MtfFrameConfig[];
  mtfInstabilityThreshold: number;

  constructor(deps: {
    store: any;
    marketStream: any;
    botArchitect: any;
    logger: any;
    publishIntervalMs?: number;
    switchDelta?: number;
    requiredConfirmations?: number;
    warmupMs?: number;
    mtfContextService?: any;
    mtfConfig?: {
      enabled?: boolean;
      frames?: MtfFrameConfig[];
      instabilityThreshold?: number;
    };
  }) {
    this.store = deps.store;
    this.marketStream = deps.marketStream;
    this.botArchitect = deps.botArchitect;
    this.logger = deps.logger;
    this.publishIntervalMs = Math.max(deps.publishIntervalMs || 30_000, 5_000);
    this.switchDelta = deps.switchDelta ?? 0.12;
    this.requiredConfirmations = Math.max(deps.requiredConfirmations || 2, 1);
    this.warmupMs = Math.max(deps.warmupMs || 30_000, 5_000);
    this.subscriptions = [];
    this.mtfEnabled = Boolean(deps.mtfConfig?.enabled) && Boolean(deps.mtfContextService);
    this.mtfContextService = deps.mtfContextService || null;
    this.mtfFrames = deps.mtfConfig?.frames || DEFAULT_MTF_FRAMES;
    this.mtfInstabilityThreshold = deps.mtfConfig?.instabilityThreshold ?? DEFAULT_MTF_INSTABILITY_THRESHOLD;
  }

  start(symbols: string[]) {
    this.stop();
    for (const symbol of [...new Set(symbols)]) {
      const unsubscribe = this.marketStream.subscribe(symbol, (tick: MarketTick) => {
        this.observe(symbol, tick.timestamp);
      });
      this.subscriptions.push(unsubscribe);
      this.ensurePublisherState(symbol);
    }
  }

  stop() {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      try {
        unsubscribe();
      } catch {}
    }
  }

  ensurePublisherState(symbol: string): ArchitectPublisherState {
    const existing = this.store.getArchitectPublisherState(symbol);
    if (existing) return existing;
    const created = {
      challengerCount: 0,
      challengerRegime: null,
      challengerRequired: this.requiredConfirmations,
      hysteresisActive: false,
      lastObservedAt: null,
      lastPublishedAt: null,
      lastPublishedRegime: null,
      lastRegimeSwitchAt: null,
      lastRegimeSwitchFrom: null,
      lastRegimeSwitchTo: null,
      nextPublishAt: null,
      publishIntervalMs: this.publishIntervalMs,
      ready: false,
      symbol,
      warmupStartedAt: null
    };
    this.store.setArchitectPublisherState(symbol, created);
    return created;
  }

  prepareObservation(symbol: string, observedAt: number, context: any) {
    let publisher = this.ensurePublisherState(symbol);
    if (publisher.warmupStartedAt === null) {
      publisher = {
        ...publisher,
        nextPublishAt: context.windowStartedAt !== null ? context.windowStartedAt + this.publishIntervalMs : observedAt + this.publishIntervalMs,
        warmupStartedAt: context.windowStartedAt !== null ? context.windowStartedAt : observedAt
      };
    }
    publisher = {
      ...publisher,
      lastObservedAt: observedAt
    };
    this.store.setArchitectPublisherState(symbol, publisher);
    return publisher;
  }

  shouldAssess(context: any, publisher: ArchitectPublisherState, observedAt: number) {
    // Architect publish cadence is authoritative here: if the tick cannot possibly result in a publish
    // cycle yet, skip the heavy assessment path and only keep publisher timing metadata fresh.
    if (!context.warmupComplete) {
      return false;
    }
    if (publisher.nextPublishAt && observedAt < publisher.nextPublishAt) {
      return false;
    }
    return true;
  }

  observe(symbol: string, observedAt: number) {
    const observeTimer = startTimer();
    const context = this.store.getContextSnapshot(symbol);
    if (!context) return null;

    const publisher = this.prepareObservation(symbol, observedAt, context);
    if (!this.shouldAssess(context, publisher, observedAt)) {
      if (typeof this.store.recordTickLatencySample === "function") {
        this.store.recordTickLatencySample(symbol, {
          architectAssessMs: 0,
          architectObserveMs: elapsedMs(observeTimer),
          architectPublishMs: 0
        }, observedAt);
      }
      return null;
    }

    const assessTimer = startTimer();
    const rawAssessment = this.botArchitect.assess(context);
    const architectAssessMs = elapsedMs(assessTimer);
    this.store.setArchitectObservedAssessment(symbol, rawAssessment);
    const minPublishMaturity = Math.max(Number(this.botArchitect?.minMaturity) || 0, 0);
    if (rawAssessment.contextMaturity < minPublishMaturity) {
      if (typeof this.store.recordTickLatencySample === "function") {
        this.store.recordTickLatencySample(symbol, {
          architectAssessMs,
          architectObserveMs: elapsedMs(observeTimer),
          architectPublishMs: 0
        }, observedAt);
      }
      return rawAssessment;
    }

    // MTF consolidation: build multi-timeframe context and override candidate when enabled.
    let assessment = rawAssessment;
    let lastMtfSnapshot: MtfSnapshot | null = null;
    if (this.mtfEnabled && this.mtfContextService) {
      const frameSnapshots = this.mtfContextService.buildMtfSnapshots({
        symbol,
        now: observedAt,
        frames: this.mtfFrames,
      });
      lastMtfSnapshot = aggregateMtfSnapshots(frameSnapshots, observedAt);
      assessment = this.consolidateWithMtf(rawAssessment, lastMtfSnapshot);
    }

    const publishTimer = startTimer();
    this.publish(symbol, assessment, observedAt, context, lastMtfSnapshot);
    const architectPublishMs = elapsedMs(publishTimer);
    if (typeof this.store.recordTickLatencySample === "function") {
      this.store.recordTickLatencySample(symbol, {
        architectAssessMs,
        architectObserveMs: elapsedMs(observeTimer),
        architectPublishMs
      }, observedAt);
    }
    return assessment;
  }

  resolveRegimeFamily(regime: MarketRegime): RecommendedFamily {
    if (regime === "trend") return "trend_following";
    if (regime === "range") return "mean_reversion";
    return "no_trade";
  }

  /**
   * Consolidate a single-frame assessment with multi-timeframe consensus.
   *
   * Rules (in precedence order):
   * 1. Insufficient ready frames → return baseline unchanged.
   * 2. High instability (>= threshold) → force "unclear" / "no_trade", penalize confidence.
   * 3. MTF metaRegime is "unclear" → force "unclear" / "no_trade", penalize confidence.
   * 4. MTF metaRegime disagrees with candidate → override to MTF metaRegime, penalize confidence.
   * 5. MTF agrees → keep candidate, apply small confidence penalty proportional to instability.
   *
   * MTF never makes a candidate more aggressive; it can only hold or degrade.
   */
  consolidateWithMtf(candidate: ArchitectAssessment, mtf: MtfSnapshot): ArchitectAssessment {
    if (mtf.readyFrameCount < MTF_MIN_READY_FRAMES) {
      return candidate;
    }

    const instability = mtf.instability;

    // High instability → force unclear regardless of agreement.
    if (instability >= this.mtfInstabilityThreshold) {
      return {
        ...candidate,
        marketRegime: "unclear" as MarketRegime,
        recommendedFamily: "no_trade" as RecommendedFamily,
        confidence: Number((candidate.confidence * Math.max(0, 1 - instability)).toFixed(4)),
        reasonCodes: [...new Set([...candidate.reasonCodes, "mtf_instability_override"])],
      };
    }

    // MTF consensus is unclear → force unclear conservatively.
    if (mtf.metaRegime === "unclear") {
      return {
        ...candidate,
        marketRegime: "unclear" as MarketRegime,
        recommendedFamily: "no_trade" as RecommendedFamily,
        confidence: Number((candidate.confidence * Math.max(0, 1 - instability * 0.5)).toFixed(4)),
        reasonCodes: [...new Set([...candidate.reasonCodes, "mtf_unclear_override"])],
      };
    }

    // MTF disagrees with single-frame → override to MTF consensus.
    if (mtf.metaRegime !== candidate.marketRegime) {
      return {
        ...candidate,
        marketRegime: mtf.metaRegime,
        recommendedFamily: this.resolveRegimeFamily(mtf.metaRegime),
        confidence: Number((candidate.confidence * Math.max(0, 1 - instability * 0.5)).toFixed(4)),
        reasonCodes: [...new Set([...candidate.reasonCodes, "mtf_regime_override"])],
      };
    }

    // Agreement → slight confidence penalty proportional to residual instability.
    if (instability > 0) {
      return {
        ...candidate,
        confidence: Number((candidate.confidence * (1 - instability * 0.3)).toFixed(4)),
        reasonCodes: [...new Set([...candidate.reasonCodes, "mtf_agreement_partial"])],
      };
    }

    return candidate;
  }

  buildMtfDiagnostics(mtf: MtfSnapshot | null): MtfPublishDiagnostics | null {
    if (!mtf) {
      if (!this.mtfEnabled) {
        return null;
      }
      return {
        mtfEnabled: this.mtfEnabled,
        mtfAgreement: null,
        mtfDominantFrame: null,
        mtfDominantTimeframe: null,
        mtfInstability: null,
        mtfMetaRegime: null,
        mtfReadyFrameCount: 0,
        mtfSufficientFrames: false,
      };
    }
    return {
      mtfEnabled: true,
      mtfAgreement: Number((1 - mtf.instability).toFixed(4)),
      mtfDominantFrame: mtf.dominantFrame,
      mtfDominantTimeframe: mtf.dominantTimeframe,
      mtfInstability: Number(mtf.instability.toFixed(4)),
      mtfMetaRegime: mtf.metaRegime,
      mtfReadyFrameCount: mtf.readyFrameCount,
      mtfSufficientFrames: mtf.readyFrameCount >= MTF_MIN_READY_FRAMES,
    };
  }

  publish(symbol: string, candidate: ArchitectAssessment, observedAt: number, context: any, mtfSnapshot?: MtfSnapshot | null) {
    const currentPublished = this.store.getArchitectPublishedAssessment(symbol);
    const currentPublisher = this.ensurePublisherState(symbol);

    if (!currentPublished) {
      const baseline = this.createPublishedAssessment(candidate, observedAt, mtfSnapshot || null);
      const nextPublisher = {
        ...currentPublisher,
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastObservedAt: observedAt,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        lastRegimeSwitchAt: currentPublisher.lastRegimeSwitchAt ?? null,
        lastRegimeSwitchFrom: currentPublisher.lastRegimeSwitchFrom ?? null,
        lastRegimeSwitchTo: currentPublisher.lastRegimeSwitchTo ?? null,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      };
      this.store.setArchitectPublishedAssessment(symbol, baseline);
      this.store.setArchitectPublisherState(symbol, nextPublisher);
      this.logger.info("architect_published", this.buildPublishDiagnostics({
        candidate,
        context,
        published: baseline,
        publishedPayloadChanged: true,
        publisher: nextPublisher,
        publisherMetadataOnly: false,
        publishOutcome: "published",
        symbol
      }));
      return;
    }

    if (candidate.marketRegime === currentPublished.marketRegime) {
      const published = this.createPublishedAssessment(candidate, observedAt, mtfSnapshot || null);
      const nextPublisher = {
        ...currentPublisher,
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastObservedAt: observedAt,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        lastRegimeSwitchAt: currentPublisher.lastRegimeSwitchAt ?? null,
        lastRegimeSwitchFrom: currentPublisher.lastRegimeSwitchFrom ?? null,
        lastRegimeSwitchTo: currentPublisher.lastRegimeSwitchTo ?? null,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      };
      this.store.setArchitectPublishedAssessment(symbol, published);
      this.store.setArchitectPublisherState(symbol, nextPublisher);
      this.logger.info("architect_publish_refreshed", this.buildPublishDiagnostics({
        candidate,
        context,
        published,
        publishedPayloadChanged: true,
        publisher: nextPublisher,
        publisherMetadataOnly: false,
        publishOutcome: "refreshed",
        symbol
      }));
      return;
    }

    const candidateScore = Number(candidate.regimeScores[candidate.marketRegime] || 0);
    const incumbentScore = Number(candidate.regimeScores[currentPublished.marketRegime] || 0);
    const canImmediateSwitch = candidateScore > (incumbentScore + this.switchDelta);
    const sameChallenger = currentPublisher.challengerRegime === candidate.marketRegime;
    const challengerCount = sameChallenger ? currentPublisher.challengerCount + 1 : 1;

    if (canImmediateSwitch || challengerCount >= this.requiredConfirmations) {
      const published = this.createPublishedAssessment(candidate, observedAt, mtfSnapshot || null);
      const nextPublisher = {
        ...currentPublisher,
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastObservedAt: observedAt,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        lastRegimeSwitchAt: observedAt,
        lastRegimeSwitchFrom: currentPublished.marketRegime,
        lastRegimeSwitchTo: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      };
      this.store.setArchitectPublishedAssessment(symbol, published);
      this.store.setArchitectPublisherState(symbol, nextPublisher);
      this.logger.info("architect_changed", this.buildPublishDiagnostics({
        candidate,
        context,
        previousRegime: currentPublished.marketRegime,
        published,
        publishedPayloadChanged: true,
        publisher: nextPublisher,
        publisherMetadataOnly: false,
        symbol,
        via: canImmediateSwitch ? "switch_delta" : "challenger_persistence"
      }));
      return;
    }

    const blockedReason = "below_switch_delta";
    this.logBlockedSwitch({
      candidateRegime: candidate.marketRegime,
      candidateScore,
      challengerCount,
      currentRegime: currentPublished.marketRegime,
      incumbentScore,
      reason: blockedReason,
      requiredConfirmations: this.requiredConfirmations,
      symbol
    });

    const nextPublisher = {
      ...currentPublisher,
      challengerCount,
      challengerRegime: candidate.marketRegime,
      hysteresisActive: true,
      lastObservedAt: observedAt,
      lastPublishedAt: observedAt,
      lastPublishedRegime: currentPublished.marketRegime,
      lastRegimeSwitchAt: currentPublisher.lastRegimeSwitchAt ?? null,
      lastRegimeSwitchFrom: currentPublisher.lastRegimeSwitchFrom ?? null,
      lastRegimeSwitchTo: currentPublisher.lastRegimeSwitchTo ?? null,
      nextPublishAt: observedAt + this.publishIntervalMs,
      ready: true
    };
    this.store.setArchitectPublisherState(symbol, nextPublisher);
    this.logger.info("architect_publish_held", this.buildPublishDiagnostics({
      candidate,
      context,
      incumbentScore,
      previousRegime: currentPublished.marketRegime,
      published: currentPublished,
      publishedPayloadChanged: false,
      publisher: nextPublisher,
      publisherMetadataOnly: true,
      publishOutcome: "held",
      symbol
    }));
  }

  createPublishedAssessment(assessment: ArchitectAssessment, publishedAt: number, mtfSnapshot?: MtfSnapshot | null): ArchitectAssessment {
    const mtfDiagnostics = this.buildMtfDiagnostics(mtfSnapshot || null);
    return {
      ...assessment,
      ...(mtfDiagnostics ? { mtf: mtfDiagnostics } : {}),
      summary: assessment.summary,
      updatedAt: publishedAt,
      confidence: Number(assessment.confidence.toFixed(4))
    };
  }

  roundMetric(value: unknown, decimals: number = 4) {
    if (!Number.isFinite(Number(value))) return 0;
    return Number(Number(value).toFixed(decimals));
  }

  buildPublishDiagnostics(params: {
    symbol: string;
    candidate: ArchitectAssessment;
    published: ArchitectAssessment;
    publisher: ArchitectPublisherState;
    context: any;
    previousRegime?: MarketRegime | null;
    via?: string;
    publishOutcome?: string;
    incumbentScore?: number;
    publishedPayloadChanged: boolean;
    publisherMetadataOnly: boolean;
  }) {
    const features = params.context?.features || {};
    const candidate = params.candidate;
    const published = params.published;
    const candidateMtf = candidate.mtf || null;
    const publishedMtf = published.mtf || null;
    return {
      candidateAbsoluteConviction: this.roundMetric(candidate.absoluteConviction),
      candidateContextMaturity: this.roundMetric(candidate.contextMaturity),
      candidateDecisionStrength: this.roundMetric(candidate.decisionStrength),
      candidateMarketRegime: candidate.marketRegime,
      candidateObservedAt: candidate.updatedAt,
      candidateRangeScore: this.roundMetric(candidate.regimeScores?.range),
      candidateRecommendedFamily: candidate.recommendedFamily,
      candidateSignalAgreement: this.roundMetric(candidate.signalAgreement),
      candidateSummary: candidate.summary,
      candidateTrendScore: this.roundMetric(candidate.regimeScores?.trend),
      candidateVolatileScore: this.roundMetric(candidate.regimeScores?.volatile),
      candidateMtfAgreement: candidateMtf ? candidateMtf.mtfAgreement : null,
      candidateMtfDominantFrame: candidateMtf ? candidateMtf.mtfDominantFrame : null,
      candidateMtfDominantTimeframe: candidateMtf ? candidateMtf.mtfDominantTimeframe : null,
      candidateMtfEnabled: candidateMtf ? candidateMtf.mtfEnabled : false,
      candidateMtfInstability: candidateMtf ? candidateMtf.mtfInstability : null,
      candidateMtfMetaRegime: candidateMtf ? candidateMtf.mtfMetaRegime : null,
      candidateMtfReadyFrameCount: candidateMtf ? candidateMtf.mtfReadyFrameCount : 0,
      candidateMtfSufficientFrames: candidateMtf ? candidateMtf.mtfSufficientFrames : false,
      contextBreakoutInstability: this.roundMetric(features.breakoutInstability),
      contextBreakoutQuality: this.roundMetric(features.breakoutQuality),
      contextChopiness: this.roundMetric(features.chopiness),
      contextDataQuality: this.roundMetric(features.dataQuality),
      contextDirectionalEfficiency: this.roundMetric(features.directionalEfficiency),
      contextEffectiveWindowSpanMs: Number(params.context?.effectiveWindowSpanMs || 0),
      contextFeatureConflict: this.roundMetric(features.featureConflict),
      contextPostSwitchCoveragePct: params.context?.postSwitchCoveragePct === null || params.context?.postSwitchCoveragePct === undefined
        ? null
        : this.roundMetric(params.context.postSwitchCoveragePct),
      contextReversionStretch: this.roundMetric(features.reversionStretch),
      contextRollingMaturity: this.roundMetric(params.context?.rollingMaturity),
      contextSlopeConsistency: this.roundMetric(features.slopeConsistency),
      contextVolatilityRisk: this.roundMetric(features.volatilityRisk),
      contextWindowMode: params.context?.windowMode || "rolling_full",
      incumbentScore: params.incumbentScore === undefined ? null : this.roundMetric(params.incumbentScore),
      previousRegime: params.previousRegime || null,
      publishOutcome: params.publishOutcome || "published",
      publishedAbsoluteConviction: this.roundMetric(published.absoluteConviction),
      publishedContextMaturity: this.roundMetric(published.contextMaturity),
      publishedDecisionStrength: this.roundMetric(published.decisionStrength),
      publishedMarketRegime: published.marketRegime,
      publishedPayloadChanged: params.publishedPayloadChanged,
      publishedPayloadUpdatedAt: published.updatedAt,
      publishedRangeScore: this.roundMetric(published.regimeScores?.range),
      publishedRecommendedFamily: published.recommendedFamily,
      publishedSignalAgreement: this.roundMetric(published.signalAgreement),
      publishedSummary: published.summary,
      publishedTrendScore: this.roundMetric(published.regimeScores?.trend),
      publishedVolatileScore: this.roundMetric(published.regimeScores?.volatile),
      publishedMtfAgreement: publishedMtf ? publishedMtf.mtfAgreement : null,
      publishedMtfDominantFrame: publishedMtf ? publishedMtf.mtfDominantFrame : null,
      publishedMtfDominantTimeframe: publishedMtf ? publishedMtf.mtfDominantTimeframe : null,
      publishedMtfEnabled: publishedMtf ? publishedMtf.mtfEnabled : false,
      publishedMtfInstability: publishedMtf ? publishedMtf.mtfInstability : null,
      publishedMtfMetaRegime: publishedMtf ? publishedMtf.mtfMetaRegime : null,
      publishedMtfReadyFrameCount: publishedMtf ? publishedMtf.mtfReadyFrameCount : 0,
      publishedMtfSufficientFrames: publishedMtf ? publishedMtf.mtfSufficientFrames : false,
      publisherChallengerCount: params.publisher.challengerCount,
      publisherChallengerRegime: params.publisher.challengerRegime || null,
      publisherChallengerRequired: params.publisher.challengerRequired,
      publisherHysteresisActive: params.publisher.hysteresisActive,
      publisherLastObservedAt: params.publisher.lastObservedAt,
      publisherLastPublishedAt: params.publisher.lastPublishedAt,
      publisherLastRegimeSwitchAt: params.publisher.lastRegimeSwitchAt,
      publisherLastRegimeSwitchFrom: params.publisher.lastRegimeSwitchFrom,
      publisherLastRegimeSwitchTo: params.publisher.lastRegimeSwitchTo,
      publisherMetadataOnly: params.publisherMetadataOnly,
      publisherNextPublishAt: params.publisher.nextPublishAt,
      publisherPublishIntervalMs: params.publisher.publishIntervalMs,
      publisherReady: params.publisher.ready,
      symbol: params.symbol,
      warmupMs: this.warmupMs,
      trendBias: candidate.trendBias || params.context?.trendBias || "neutral",
      updatedAt: published.updatedAt,
      via: params.via || null,
      volatilityState: candidate.volatilityState || params.context?.volatilityState || "normal",
      structureState: candidate.structureState || params.context?.structureState || "choppy"
    };
  }

  logBlockedSwitch(params: {
    symbol: string;
    currentRegime: MarketRegime;
    candidateRegime: MarketRegime;
    incumbentScore: number;
    candidateScore: number;
    challengerCount: number;
    requiredConfirmations: number;
    reason: string;
  }) {
    this.logger.info("architect_switch_blocked", {
      candidateRegime: params.candidateRegime,
      candidateScore: Number(params.candidateScore.toFixed(4)),
      challengerCount: params.challengerCount,
      currentRegime: params.currentRegime,
      incumbentScore: Number(params.incumbentScore.toFixed(4)),
      reason: params.reason,
      requiredConfirmations: params.requiredConfirmations,
      switchDelta: this.switchDelta,
      symbol: params.symbol
    });
  }
}

module.exports = {
  ArchitectService
};
