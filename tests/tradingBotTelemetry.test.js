"use strict";

const { TradingBotTelemetry } = require("../src/roles/tradingBotTelemetry.ts");

function runTradingBotTelemetryTests() {
  const telemetry = new TradingBotTelemetry({
    botId: "bot_test",
    symbol: "BTC/USDT"
  });

  const managedRecoverySignatureA = telemetry.buildManagedRecoverySignature({
    exitEvent: "rsi_exit_deferred",
    invalidationLevel: null,
    positionStatus: "MANAGED_RECOVERY",
    status: "managed_recovery_target_ready",
    targetPrice: 101.25,
    timeoutRemainingMs: 45000
  });
  const managedRecoverySignatureB = telemetry.buildManagedRecoverySignature({
    exitEvent: "rsi_exit_deferred",
    invalidationLevel: null,
    positionStatus: "MANAGED_RECOVERY",
    status: "managed_recovery_target_ready",
    targetPrice: 101.25,
    timeoutRemainingMs: 45000
  });
  const managedRecoverySignatureChanged = telemetry.buildManagedRecoverySignature({
    exitEvent: "rsi_exit_deferred",
    invalidationLevel: "family_mismatch",
    positionStatus: "MANAGED_RECOVERY",
    status: "managed_recovery_target_ready",
    targetPrice: 101.25,
    timeoutRemainingMs: 45000
  });
  if (managedRecoverySignatureA !== managedRecoverySignatureB) {
    throw new Error("managed-recovery dedupe signature should remain stable for identical inputs");
  }
  if (managedRecoverySignatureA === managedRecoverySignatureChanged) {
    throw new Error("managed-recovery dedupe signature should change on meaningful telemetry changes");
  }

  const publishedMtf = {
    mtfAgreement: 0.8,
    mtfDominantFrame: "medium",
    mtfDominantTimeframe: "15m",
    mtfEnabled: true,
    mtfInstability: 0.2,
    mtfMetaRegime: "range",
    mtfReadyFrameCount: 3,
    mtfSufficientFrames: true
  };
  const mtfParamResolution = {
    coherenceReason: "mtf_coherent_medium",
    dominantTimeframe: "medium",
    fallbackReason: null,
    mtfAdjustmentApplied: true,
    resolvedBuyRsi: 33,
    resolvedMinExpectedNetEdgePct: 0.0015,
    resolvedSellRsi: 58,
    resolvedTargetDistanceCapPct: 0.015,
    targetDistanceProfile: "medium"
  };
  const mtfEconomics = {
    estimatedEntryFeePct: 0.001,
    estimatedExitFeePct: 0.001,
    estimatedRoundTripFeesUsdt: 0.2,
    estimatedSlippagePct: 0.0005,
    expectedGrossEdgePct: 0.01234,
    expectedGrossEdgeUsdt: 1.234,
    expectedNetEdgePct: 0.00984,
    maxTargetDistancePctForShortHorizon: 0.015,
    minExpectedNetEdgePct: 0.0015,
    mtfParamResolution,
    notionalUsdt: 100,
    profitSafetyBufferPct: 0,
    requiredEdgePct: 0.0025,
    side: "long",
    targetDistancePct: 0.0142
  };
  const fullEntryDiagnostics = telemetry.buildEntryDiagnostics({
    architectState: {
      actionableFamily: "mean_reversion",
      architect: {
        contextMaturity: 0.8,
        marketRegime: "range",
        mtf: publishedMtf,
        recommendedFamily: "mean_reversion",
        signalAgreement: 0.76,
        symbol: "BTC/USDT",
        updatedAt: 123000
      },
      architectAgeMs: 1000,
      architectStale: false,
      blockReason: null,
      currentFamily: "mean_reversion",
      entryMaturityThreshold: 0.25,
      familyMatch: true,
      publisher: {
        lastObservedAt: 123000,
        lastPublishedAt: 123000
      },
      ready: true,
      staleThresholdMs: 90000,
      usable: true
    },
    context: {
      indicators: {
        rsi: 30.12345
      }
    },
    contextSnapshot: {
      features: {
        contextRsi: 31.23456,
        dataQuality: 0.9,
        maturity: 0.8,
        rsiIntensity: 0.4
      },
      postSwitchCoveragePct: 0.7,
      rollingMaturity: 0.8,
      symbol: "BTC/USDT",
      windowMode: "rolling_full"
    },
    decision: {
      action: "buy",
      confidence: 0.88,
      reason: ["rsi_oversold"]
    },
    economics: mtfEconomics,
    entryMaturityThreshold: 0.25,
    postLossArchitectLatch: {
      activatedAt: null,
      active: false,
      blocking: false,
      freshPublishCount: 0,
      requiredPublishes: 1,
      strategyId: null
    },
    profile: {
      entryDebounceTicks: 1
    },
    quantity: 1,
    riskGate: {
      allowed: true,
      reason: "allowed"
    },
    signalEvaluated: true,
    signalState: {
      entrySignalStreak: 1
    },
    state: {},
    strategyId: "rsiReversion",
    tick: {
      price: 100,
      symbol: "BTC/USDT",
      timestamp: 124000
    },
    tradeConstraints: {
      minNotionalUsdt: 10,
      minQuantity: 0.0001
    }
  });
  if (fullEntryDiagnostics.mtfDominantFrame !== "medium"
    || fullEntryDiagnostics.mtfDominantTimeframe !== "medium"
    || fullEntryDiagnostics.publishedMtfEnabled !== true
    || fullEntryDiagnostics.publishedMtfAgreement !== 0.8
    || fullEntryDiagnostics.publishedMtfInstability !== 0.2
    || fullEntryDiagnostics.publishedMtfDominantFrame !== "medium"
    || fullEntryDiagnostics.publishedMtfDominantTimeframe !== "15m"
    || fullEntryDiagnostics.publishedMtfSufficientFrames !== true
    || fullEntryDiagnostics.publishedMtfMetaRegime !== "range") {
    throw new Error(`full entry diagnostics should expose canonical and published MTF fields: ${JSON.stringify(fullEntryDiagnostics)}`);
  }

  const mtfDisabledDiagnostics = telemetry.buildEntryDiagnostics({
    architectState: {
      actionableFamily: "mean_reversion",
      architect: {
        contextMaturity: 0.8,
        marketRegime: "range",
        mtf: {
          mtfAgreement: null,
          mtfDominantFrame: null,
          mtfDominantTimeframe: null,
          mtfEnabled: false,
          mtfInstability: null,
          mtfMetaRegime: null,
          mtfReadyFrameCount: 0,
          mtfSufficientFrames: false
        },
        recommendedFamily: "mean_reversion",
        signalAgreement: 0.76,
        symbol: "BTC/USDT",
        updatedAt: 123000
      },
      architectAgeMs: 1000,
      architectStale: false,
      blockReason: null,
      currentFamily: "mean_reversion",
      entryMaturityThreshold: 0.25,
      familyMatch: true,
      publisher: {
        lastObservedAt: 123000,
        lastPublishedAt: 123000
      },
      ready: true,
      staleThresholdMs: 90000,
      usable: true
    },
    context: {
      indicators: {
        rsi: 30.12345
      }
    },
    contextSnapshot: {
      features: {
        contextRsi: 31.23456,
        dataQuality: 0.9,
        maturity: 0.8,
        rsiIntensity: 0.4
      },
      postSwitchCoveragePct: 0.7,
      rollingMaturity: 0.8,
      symbol: "BTC/USDT",
      windowMode: "rolling_full"
    },
    decision: {
      action: "buy",
      confidence: 0.88,
      reason: ["rsi_oversold"]
    },
    economics: {
      ...mtfEconomics,
      mtfParamResolution: {
        ...mtfParamResolution,
        fallbackReason: "mtf_disabled",
        mtfAdjustmentApplied: false
      }
    },
    entryMaturityThreshold: 0.25,
    postLossArchitectLatch: {
      activatedAt: null,
      active: false,
      blocking: false,
      freshPublishCount: 0,
      requiredPublishes: 1,
      strategyId: null
    },
    profile: {
      entryDebounceTicks: 1
    },
    quantity: 1,
    riskGate: {
      allowed: true,
      reason: "allowed"
    },
    signalEvaluated: true,
    signalState: {
      entrySignalStreak: 1
    },
    state: {},
    strategyId: "rsiReversion",
    tick: {
      price: 100,
      symbol: "BTC/USDT",
      timestamp: 124000
    },
    tradeConstraints: {
      minNotionalUsdt: 10,
      minQuantity: 0.0001
    }
  });
  const omittedMtfKeys = [
    "mtfAdjustmentApplied",
    "mtfDominantFrame",
    "mtfDominantTimeframe",
    "mtfParamFallbackReason",
    "mtfParamResolutionReason",
    "mtfResolvedTargetDistanceCapPct",
    "mtfTargetDistanceProfile",
    "publishedMtfAgreement",
    "publishedMtfDominantFrame",
    "publishedMtfDominantTimeframe",
    "publishedMtfEnabled",
    "publishedMtfInstability",
    "publishedMtfMetaRegime",
    "publishedMtfSufficientFrames"
  ];
  for (const key of omittedMtfKeys) {
    if (Object.prototype.hasOwnProperty.call(mtfDisabledDiagnostics, key)) {
      throw new Error(`mtf-disabled entry diagnostics should omit ${key}: ${JSON.stringify(mtfDisabledDiagnostics)}`);
    }
  }
}

module.exports = {
  runTradingBotTelemetryTests
};
