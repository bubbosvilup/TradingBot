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

    this.publish(symbol, assessment, observedAt);
    return assessment;
  }

  publish(symbol: string, candidate: ArchitectAssessment, observedAt: number) {
    const currentPublished = this.store.getArchitectPublishedAssessment(symbol);
    const currentPublisher = this.ensurePublisherState(symbol);

    if (!currentPublished) {
      const baseline = this.finalizePublishedAssessment(candidate, currentPublisher, {
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      });
      this.store.setArchitectPublishedAssessment(symbol, baseline);
      this.store.setArchitectPublisherState(symbol, {
        ...currentPublisher,
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastObservedAt: observedAt,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      });
      this.logger.info("architect_published", {
        marketRegime: baseline.marketRegime,
        recommendedFamily: baseline.recommendedFamily,
        symbol,
        summary: baseline.summary
      });
      return;
    }

    if (candidate.marketRegime === currentPublished.marketRegime) {
      const published = this.finalizePublishedAssessment(candidate, currentPublisher, {
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      });
      this.store.setArchitectPublishedAssessment(symbol, published);
      this.store.setArchitectPublisherState(symbol, {
        ...currentPublisher,
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastObservedAt: observedAt,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      });
      return;
    }

    const candidateScore = Number(candidate.regimeScores[candidate.marketRegime] || 0);
    const incumbentScore = Number(candidate.regimeScores[currentPublished.marketRegime] || 0);
    const canImmediateSwitch = candidateScore > (incumbentScore + this.switchDelta);
    const sameChallenger = currentPublisher.challengerRegime === candidate.marketRegime;
    const challengerCount = sameChallenger ? currentPublisher.challengerCount + 1 : 1;

    if (canImmediateSwitch || challengerCount >= this.requiredConfirmations) {
      const published = this.finalizePublishedAssessment(candidate, currentPublisher, {
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      });
      this.store.setArchitectPublishedAssessment(symbol, published);
      this.store.setArchitectPublisherState(symbol, {
        ...currentPublisher,
        challengerCount: 0,
        challengerRegime: null,
        hysteresisActive: false,
        lastObservedAt: observedAt,
        lastPublishedAt: observedAt,
        lastPublishedRegime: candidate.marketRegime,
        nextPublishAt: observedAt + this.publishIntervalMs,
        ready: true
      });
      this.logger.info("architect_changed", {
        marketRegime: candidate.marketRegime,
        previousRegime: currentPublished.marketRegime,
        recommendedFamily: candidate.recommendedFamily,
        symbol,
        via: canImmediateSwitch ? "switch_delta" : "challenger_persistence"
      });
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

    const held = this.finalizePublishedAssessment(currentPublished, currentPublisher, {
      challengerCount,
      challengerRegime: candidate.marketRegime,
      hysteresisActive: true,
      lastPublishedAt: observedAt,
      nextPublishAt: observedAt + this.publishIntervalMs,
      ready: true
    });
    this.store.setArchitectPublishedAssessment(symbol, held);
    this.store.setArchitectPublisherState(symbol, {
      ...currentPublisher,
      challengerCount,
      challengerRegime: candidate.marketRegime,
      hysteresisActive: true,
      lastObservedAt: observedAt,
      lastPublishedAt: observedAt,
      lastPublishedRegime: currentPublished.marketRegime,
      nextPublishAt: observedAt + this.publishIntervalMs,
      ready: true
    });
  }

  finalizePublishedAssessment(
    assessment: ArchitectAssessment,
    publisher: ArchitectPublisherState,
    patch: Partial<ArchitectPublisherState>
  ): ArchitectAssessment {
    const publishedAt = patch.lastPublishedAt ?? publisher.lastPublishedAt ?? assessment.updatedAt;
    return {
      ...assessment,
      summary: assessment.summary,
      updatedAt: publishedAt,
      confidence: Number(assessment.confidence.toFixed(4))
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
