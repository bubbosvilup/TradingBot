// Module responsibility: prepare interpretable rolling market features for the architect layer.

import type { TrendBias, VolatilityState, StructureState, ArchitectDataMode, MarketRegime } from "../types/architect.ts";
import type { ContextSnapshot } from "../types/context.ts";
import type { MarketTick } from "../types/market.ts";

const { clamp, mean, stddev } = require("../utils/math.ts");

class ContextBuilder {
  indicatorEngine: any;

  constructor(deps: { indicatorEngine: any }) {
    this.indicatorEngine = deps.indicatorEngine;
  }

  createSnapshot(params: {
    symbol: string;
    ticks: MarketTick[];
    effectiveTicks?: MarketTick[];
    dataMode: ArchitectDataMode;
    observedAt: number;
    warmupMs: number;
    maxWindowMs: number;
    lastPublishedRegimeSwitchAt?: number | null;
    lastPublishedRegimeSwitchFrom?: MarketRegime | null;
    lastPublishedRegimeSwitchTo?: MarketRegime | null;
  }): ContextSnapshot {
    const ticks = Array.isArray(params.ticks)
      ? params.ticks.filter((tick) => Number.isFinite(Number(tick?.price)) && Number.isFinite(Number(tick?.timestamp)))
      : [];
    const requestedEffectiveTicks = Array.isArray(params.effectiveTicks)
      ? params.effectiveTicks.filter((tick) => Number.isFinite(Number(tick?.price)) && Number.isFinite(Number(tick?.timestamp)))
      : [];
    const observedAt = params.observedAt || Date.now();

    if (ticks.length <= 0) {
      return this.createEmptySnapshot(params.symbol, params.dataMode, observedAt);
    }

    const rollingLatestTimestamp = Number(ticks[ticks.length - 1].timestamp);
    const rollingOldestTimestamp = Number(ticks[0].timestamp);
    const windowSpanMs = Math.max(0, rollingLatestTimestamp - rollingOldestTimestamp);
    const rollingMaturity = clamp(windowSpanMs / params.maxWindowMs, 0, 1);
    const warmupComplete = windowSpanMs >= params.warmupMs;
    const hasPublishedRegimeSwitch = params.lastPublishedRegimeSwitchAt !== null
      && params.lastPublishedRegimeSwitchAt !== undefined
      && Number.isFinite(Number(params.lastPublishedRegimeSwitchAt));
    const usePostSwitchSegment = hasPublishedRegimeSwitch
      && requestedEffectiveTicks.length > 0
      && requestedEffectiveTicks.length < ticks.length;
    const effectiveTicks = usePostSwitchSegment ? requestedEffectiveTicks : ticks;
    const prices = new Array<number>(effectiveTicks.length);
    const timestamps = new Array<number>(effectiveTicks.length);
    let windowHigh = -Infinity;
    let windowLow = Infinity;
    for (let index = 0; index < effectiveTicks.length; index += 1) {
      const tick = effectiveTicks[index];
      const price = Number(tick.price);
      prices[index] = price;
      timestamps[index] = Number(tick.timestamp);
      if (price > windowHigh) windowHigh = price;
      if (price < windowLow) windowLow = price;
    }
    const latestPrice = prices[prices.length - 1];
    const latestTimestamp = timestamps[timestamps.length - 1];
    const oldestTimestamp = timestamps[0];
    const effectiveWindowSpanMs = Math.max(0, latestTimestamp - oldestTimestamp);
    const maturity = clamp(effectiveWindowSpanMs / params.maxWindowMs, 0, 1);
    const effectiveWarmupComplete = effectiveWindowSpanMs >= params.warmupMs;
    const postSwitchCoveragePct = usePostSwitchSegment && windowSpanMs > 0
      ? clamp(effectiveWindowSpanMs / windowSpanMs, 0, 1)
      : null;

    const diffs = new Array<number>(Math.max(prices.length - 1, 0));
    const absoluteDiffs = new Array<number>(Math.max(prices.length - 1, 0));
    const returns = new Array<number>(Math.max(prices.length - 1, 0));
    for (let index = 1; index < prices.length; index += 1) {
      const previous = prices[index - 1];
      const diff = prices[index] - previous;
      const targetIndex = index - 1;
      diffs[targetIndex] = diff;
      absoluteDiffs[targetIndex] = Math.abs(diff);
      returns[targetIndex] = previous > 0 ? diff / previous : 0;
    }
    const recentLength = Math.max(8, Math.min(30, prices.length - 1));
    const recentReturns = returns.slice(-recentLength);
    const recentAbsoluteDiffs = absoluteDiffs.slice(-recentLength);
    const rollingMean = mean(prices);
    const rollingStd = stddev(prices);
    const emaFast = this.indicatorEngine.ema(prices, Math.min(9, Math.max(3, Math.floor(prices.length / 6))));
    const emaSlow = this.indicatorEngine.ema(prices, Math.min(21, Math.max(5, Math.floor(prices.length / 3))));
    const emaFastPrev = prices.length > 5 ? this.indicatorEngine.ema(prices.slice(0, -5), Math.min(9, Math.max(3, Math.floor((prices.length - 5) / 6)))) : null;
    const emaSlowPrev = prices.length > 5 ? this.indicatorEngine.ema(prices.slice(0, -5), Math.min(21, Math.max(5, Math.floor((prices.length - 5) / 3)))) : null;
    const contextRsi = this.indicatorEngine.rsi(prices, Math.min(14, Math.max(5, Math.floor(prices.length / 4))));
    const epsilon = Math.max(latestPrice * 1e-6, 1e-8);
    const netChange = Math.abs(latestPrice - prices[0]);
    const travel = absoluteDiffs.reduce((sum, value) => sum + value, 0);
    const directionalEfficiency = clamp(travel > 0 ? netChange / travel : 0, 0, 1);
    const windowRange = windowHigh - windowLow;
    const atrProxy = Math.max(mean(recentAbsoluteDiffs) || 0, windowRange / Math.max(prices.length - 1, 1), epsilon);
    const emaSeparationRaw = Math.abs((emaFast || latestPrice) - (emaSlow || latestPrice)) / (atrProxy + epsilon);
    const emaSeparation = clamp(emaSeparationRaw / (1 + emaSeparationRaw), 0, 1);

    const fastSlopeRaw = Number.isFinite(Number(emaFast)) && Number.isFinite(Number(emaFastPrev))
      ? ((Number(emaFast) - Number(emaFastPrev)) / (atrProxy + epsilon))
      : 0;
    const slowSlopeRaw = Number.isFinite(Number(emaSlow)) && Number.isFinite(Number(emaSlowPrev))
      ? ((Number(emaSlow) - Number(emaSlowPrev)) / (atrProxy + epsilon))
      : 0;
    const sameSlopeSign = Math.sign(fastSlopeRaw) !== 0 && Math.sign(fastSlopeRaw) === Math.sign(slowSlopeRaw) ? 1 : 0;
    const slowSlopeStrength = clamp(Math.abs(slowSlopeRaw) / (1 + Math.abs(slowSlopeRaw)), 0, 1);
    const slopeAlignment = 1 - clamp(
      Math.abs(fastSlopeRaw - slowSlopeRaw) / (Math.abs(fastSlopeRaw) + Math.abs(slowSlopeRaw) + 1),
      0,
      1
    );
    const slopeConsistency = clamp(sameSlopeSign * ((0.6 * slowSlopeStrength) + (0.4 * slopeAlignment)), 0, 1);

    const zScore = rollingStd > 0 ? (latestPrice - rollingMean) / (rollingStd + epsilon) : 0;
    const reversionStretch = clamp(Math.abs(zScore) / 2.5, 0, 1);
    const rsiIntensity = contextRsi === null ? 0 : clamp(Math.abs(contextRsi - 50) / 50, 0, 1);

    const baselineVol = stddev(returns);
    const recentVol = stddev(recentReturns);
    const volRatio = recentVol / (baselineVol + epsilon);
    const volLift = Math.max(0, volRatio - 1);
    const midPoint = Math.max(2, Math.floor(prices.length / 2));
    let baselineHigh = prices[0];
    let baselineLow = prices[0];
    for (let index = 1; index < midPoint; index += 1) {
      const price = prices[index];
      if (price > baselineHigh) baselineHigh = price;
      if (price < baselineLow) baselineLow = price;
    }
    const baselineRange = midPoint > 1 ? baselineHigh - baselineLow : windowRange;
    const rangeExpansion = Math.max(0, (windowRange / (baselineRange + epsilon)) - 1);
    const volatilityRisk = clamp(
      (0.65 * (volLift / (1 + volLift))) + (0.35 * (rangeExpansion / (1 + rangeExpansion))),
      0,
      1
    );

    const signFlipRate = returns.length > 2
      ? returns.slice(1).reduce((count, value, index) => {
          const previous = returns[index];
          if (value === 0 || previous === 0) return count;
          return Math.sign(value) !== Math.sign(previous) ? count + 1 : count;
        }, 0) / Math.max(returns.length - 1, 1)
      : 0;
    const chopiness = clamp((0.65 * (1 - directionalEfficiency)) + (0.35 * signFlipRate), 0, 1);

    const breakoutWindowLength = Math.min(prices.length, 40);
    const breakoutStartIndex = prices.length - breakoutWindowLength;
    let breakoutHigh = latestPrice;
    let breakoutLow = latestPrice;
    if (breakoutWindowLength > 1) {
      breakoutHigh = prices[breakoutStartIndex];
      breakoutLow = prices[breakoutStartIndex];
      for (let index = breakoutStartIndex + 1; index < prices.length - 1; index += 1) {
        const price = prices[index];
        if (price > breakoutHigh) breakoutHigh = price;
        if (price < breakoutLow) breakoutLow = price;
      }
    }
    const breakoutUpDistance = latestPrice > breakoutHigh ? (latestPrice - breakoutHigh) / (atrProxy + epsilon) : 0;
    const breakoutDownDistance = latestPrice < breakoutLow ? (breakoutLow - latestPrice) / (atrProxy + epsilon) : 0;
    const breakoutDirection = breakoutUpDistance > 0
      ? "up"
      : breakoutDownDistance > 0
        ? "down"
        : "none";
    const breakoutDistance = Math.max(breakoutUpDistance, breakoutDownDistance);
    const breakoutTailLength = Math.min(8, breakoutWindowLength);
    const breakoutTailStartIndex = prices.length - breakoutTailLength;
    let breakoutPersistenceMatches = 0;
    if (breakoutDirection !== "none") {
      for (let index = breakoutTailStartIndex; index < prices.length; index += 1) {
        const price = prices[index];
        if (breakoutDirection === "up" && price >= breakoutHigh) {
          breakoutPersistenceMatches += 1;
        }
        if (breakoutDirection === "down" && price <= breakoutLow) {
          breakoutPersistenceMatches += 1;
        }
      }
    }
    const breakoutPersistence = breakoutDirection === "none"
      ? 0
      : breakoutPersistenceMatches / Math.max(breakoutTailLength, 1);
    const breakoutQuality = clamp(
      (0.55 * (breakoutDistance / (1 + breakoutDistance))) + (0.45 * breakoutPersistence),
      0,
      1
    );

    const timeDiffs = [];
    for (let index = 1; index < timestamps.length; index += 1) {
      const diff = timestamps[index] - timestamps[index - 1];
      if (diff > 0) {
        timeDiffs.push(diff);
      }
    }
    const averageIntervalMs = timeDiffs.length > 0 ? mean(timeDiffs) : 1000;
    const expectedSamples = Math.max(2, Math.floor(Math.max(windowSpanMs, params.warmupMs) / Math.max(averageIntervalMs, 250)));
    const sampleDensity = clamp(prices.length / expectedSamples, 0, 1);
    const maxGapMs = timeDiffs.length > 0 ? Math.max(...timeDiffs) : averageIntervalMs;
    const gapPenalty = clamp(maxGapMs / Math.max(windowSpanMs, params.warmupMs, 1), 0, 1);
    const sourceScore = params.dataMode === "unknown" ? 0.6 : 1;
    const dataQuality = clamp(
      (0.55 * sampleDensity) + (0.25 * (1 - gapPenalty)) + (0.20 * sourceScore),
      0,
      1
    );

    const trendSignal = clamp((directionalEfficiency + emaSeparation + slopeConsistency) / 3, 0, 1);
    const featureConflict = clamp(
      (0.30 * Math.min(emaSeparation, 1 - directionalEfficiency)) +
      (0.25 * Math.min(breakoutQuality, 1 - slopeConsistency)) +
      (0.25 * Math.min(reversionStretch, trendSignal)) +
      (0.20 * Math.min(volatilityRisk, 1 - slopeConsistency)),
      0,
      1
    );
    const breakoutInstability = clamp(breakoutQuality * ((0.55 * (1 - slopeConsistency)) + (0.45 * volatilityRisk)), 0, 1);
    const emaBias = clamp((emaFast || latestPrice) - (emaSlow || latestPrice), -Infinity, Infinity) / (atrProxy + epsilon);
    const netMoveRatio = prices[0] > 0 ? (latestPrice - prices[0]) / prices[0] : 0;

    const trendBias = emaBias > 0.15 || netMoveRatio > 0.002
      ? "bullish"
      : emaBias < -0.15 || netMoveRatio < -0.002
        ? "bearish"
        : "neutral";
    const volatilityState = volatilityRisk >= 0.66
      ? "expanding"
      : volatilityRisk <= 0.28
        ? "compressed"
        : "normal";
    const structureState = breakoutQuality >= 0.6
      ? "breakout-watch"
      : reversionStretch >= 0.72 && trendSignal >= 0.6
        ? "reversal-risk"
        : directionalEfficiency >= 0.56 && chopiness <= 0.42
          ? "trending"
          : "choppy";

    return {
      dataMode: params.dataMode,
      effectiveSampleSize: prices.length,
      effectiveWarmupComplete,
      effectiveWindowSpanMs,
      effectiveWindowStartedAt: oldestTimestamp,
      features: {
        breakoutDirection,
        breakoutInstability,
        breakoutQuality,
        chopiness,
        contextRsi,
        dataQuality,
        directionalEfficiency,
        emaBias,
        emaSeparation,
        featureConflict,
        maturity,
        netMoveRatio,
        reversionStretch,
        rsiIntensity,
        slopeConsistency,
        volatilityRisk
      },
      observedAt,
      rollingSampleSize: ticks.length,
      sampleSize: prices.length,
      structureState,
      summary: usePostSwitchSegment
        ? `Market window ${Math.round(windowSpanMs / 1000)}s | post-switch ${Math.round(effectiveWindowSpanMs / 1000)}s | maturity ${Math.round(maturity * 100)}% (rolling ${Math.round(rollingMaturity * 100)}%) | quality ${Math.round(dataQuality * 100)}%.`
        : `Market window ${Math.round(windowSpanMs / 1000)}s | maturity ${Math.round(maturity * 100)}% | quality ${Math.round(dataQuality * 100)}%.`,
      lastPublishedRegimeSwitchAt: params.lastPublishedRegimeSwitchAt ?? null,
      lastPublishedRegimeSwitchFrom: params.lastPublishedRegimeSwitchFrom ?? null,
      lastPublishedRegimeSwitchTo: params.lastPublishedRegimeSwitchTo ?? null,
      postSwitchCoveragePct,
      rollingMaturity,
      symbol: params.symbol,
      trendBias,
      volatilityState,
      warmupComplete,
      windowMode: usePostSwitchSegment ? "post_switch_segment" : "rolling_full",
      windowSpanMs,
      windowStartedAt: rollingOldestTimestamp
    };
  }

  createEmptySnapshot(symbol: string, dataMode: ArchitectDataMode, observedAt: number): ContextSnapshot {
    return {
      dataMode,
      effectiveSampleSize: 0,
      effectiveWarmupComplete: false,
      effectiveWindowSpanMs: 0,
      effectiveWindowStartedAt: null,
      features: {
        breakoutDirection: "none",
        breakoutInstability: 0,
        breakoutQuality: 0,
        chopiness: 0,
        contextRsi: null,
        dataQuality: 0,
        directionalEfficiency: 0,
        emaBias: 0,
        emaSeparation: 0,
        featureConflict: 0,
        maturity: 0,
        netMoveRatio: 0,
        reversionStretch: 0,
        rsiIntensity: 0,
        slopeConsistency: 0,
        volatilityRisk: 0
      },
      lastPublishedRegimeSwitchAt: null,
      lastPublishedRegimeSwitchFrom: null,
      lastPublishedRegimeSwitchTo: null,
      observedAt,
      postSwitchCoveragePct: null,
      rollingSampleSize: 0,
      rollingMaturity: 0,
      sampleSize: 0,
      structureState: "choppy",
      summary: "No market history available yet.",
      symbol,
      trendBias: "neutral",
      volatilityState: "normal",
      warmupComplete: false,
      windowMode: "rolling_full",
      windowSpanMs: 0,
      windowStartedAt: null
    };
  }
}

module.exports = {
  ContextBuilder
};
