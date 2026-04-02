// Module responsibility: observe rolling context continuously and publish stable architect decisions on cadence.

import type { ArchitectAssessment, ArchitectPublisherState, MarketRegime } from "../types/architect.ts";
import type { MarketTick } from "../types/market.ts";

class ArchitectService {
  store: any;
  marketStream: any;
  botArchitect: any;
  logger: any;
  publishIntervalMs: number;
  switchDelta: number;
  requiredConfirmations: number;
  subscriptions: Array<() => void>;

  constructor(deps: {
    store: any;
    marketStream: any;
    botArchitect: any;
    logger: any;
    publishIntervalMs?: number;
    switchDelta?: number;
    requiredConfirmations?: number;
  }) {
    this.store = deps.store;
    this.marketStream = deps.marketStream;
    this.botArchitect = deps.botArchitect;
    this.logger = deps.logger;
    this.publishIntervalMs = Math.max(deps.publishIntervalMs || 30_000, 5_000);
    this.switchDelta = deps.switchDelta ?? 0.12;
    this.requiredConfirmations = Math.max(deps.requiredConfirmations || 2, 1);
    this.subscriptions = [];
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

  observe(symbol: string, observedAt: number) {
    const context = this.store.getContextSnapshot(symbol);
    if (!context) return null;

    let publisher = this.ensurePublisherState(symbol);
    if (publisher.warmupStartedAt === null) {
      publisher = {
        ...publisher,
        nextPublishAt: context.windowStartedAt !== null ? context.windowStartedAt + this.publishIntervalMs : observedAt + this.publishIntervalMs,
        warmupStartedAt: context.windowStartedAt !== null ? context.windowStartedAt : observedAt
      };
    }

    const assessment = this.botArchitect.assess(context);
    this.store.setArchitectObservedAssessment(symbol, assessment);
    publisher = {
      ...publisher,
      lastObservedAt: observedAt
    };
    this.store.setArchitectPublisherState(symbol, publisher);

    // Warm-up readiness belongs to ContextService; Architect only publishes after context is ready.
    if (!context.warmupComplete || (publisher.nextPublishAt && observedAt < publisher.nextPublishAt)) {
      return assessment;
    }

    this.publish(symbol, assessment, observedAt, context);
    return assessment;
  }

  publish(symbol: string, candidate: ArchitectAssessment, observedAt: number, context: any) {
    const currentPublished = this.store.getArchitectPublishedAssessment(symbol);
    const currentPublisher = this.ensurePublisherState(symbol);

    if (!currentPublished) {
      const baseline = this.createPublishedAssessment(candidate, observedAt);
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
      const published = this.createPublishedAssessment(candidate, observedAt);
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
      const published = this.createPublishedAssessment(candidate, observedAt);
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

  createPublishedAssessment(assessment: ArchitectAssessment, publishedAt: number): ArchitectAssessment {
    return {
      ...assessment,
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
      publisherReady: params.publisher.ready,
      symbol: params.symbol,
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
