"use strict";

const { TradingBotTelemetry } = require("../src/roles/tradingBotTelemetry.ts");

function runTradingBotTelemetryTests() {
  const telemetry = new TradingBotTelemetry({
    botId: "bot_test",
    symbol: "BTC/USDT"
  });

  const setupMetadata = {
    allowReason: null,
    blockReason: "architect_stale",
    decisionAction: "buy",
    entryDebounceRequired: 2,
    entrySignalStreak: 1,
    publishedFamily: "trend_following",
    publishedRegime: "trend",
    riskReason: "cooldown_active",
    strategy: "emaCross"
  };
  const setupSignatureA = telemetry.buildSetupStateSignature(setupMetadata, "emaCross");
  const setupSignatureB = telemetry.buildSetupStateSignature({ ...setupMetadata }, "emaCross");
  const setupSignatureChanged = telemetry.buildSetupStateSignature({
    ...setupMetadata,
    entrySignalStreak: 2
  }, "emaCross");
  if (setupSignatureA !== setupSignatureB) {
    throw new Error("setup dedupe signature should remain stable for identical inputs");
  }
  if (setupSignatureA === setupSignatureChanged) {
    throw new Error("setup dedupe signature should change when readiness state changes");
  }

  const blockDescriptorA = telemetry.maybeBuildCompactBlockChangeDescriptor({
    blockReason: "architect_stale",
    decisionAction: "buy",
    riskReason: "cooldown_active",
    strategy: "emaCross"
  }, "emaCross");
  const blockDescriptorB = telemetry.maybeBuildCompactBlockChangeDescriptor({
    blockReason: "architect_stale",
    decisionAction: "buy",
    riskReason: "cooldown_active",
    strategy: "emaCross"
  }, "emaCross");
  const blockDescriptorChanged = telemetry.maybeBuildCompactBlockChangeDescriptor({
    blockReason: "architect_no_trade",
    decisionAction: "buy",
    riskReason: "cooldown_active",
    strategy: "emaCross"
  }, "emaCross");
  if (!blockDescriptorA || !blockDescriptorB || !blockDescriptorChanged) {
    throw new Error("block-change dedupe descriptor should still be produced when blockReason is present");
  }
  if (blockDescriptorA.signature !== blockDescriptorB.signature) {
    throw new Error("block-change dedupe signature should remain stable for identical inputs");
  }
  if (blockDescriptorA.signature === blockDescriptorChanged.signature) {
    throw new Error("block-change dedupe signature should change on meaningful block changes");
  }
  if (blockDescriptorA.message !== "BLOCK_CHANGE" || blockDescriptorA.metadata.blockReason !== "architect_stale") {
    throw new Error(`block-change descriptor payload should remain stable: ${JSON.stringify(blockDescriptorA)}`);
  }

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

  const compactEntryMetadata = telemetry.buildCompactEntryMetadata({
    allowReason: "entry_opened",
    architectState: {
      actionableFamily: "trend_following",
      architect: {
        marketRegime: "trend",
        recommendedFamily: "trend_following"
      },
      usable: true
    },
    context: {
      indicators: {
        rsi: 61.23456
      }
    },
    decision: {
      action: "buy",
      confidence: 0.91234
    },
    economics: {
      estimatedEntryFeePct: 0.001,
      estimatedExitFeePct: 0.001,
      estimatedSlippagePct: 0.0005,
      expectedGrossEdgePct: 0.01234,
      expectedNetEdgePct: 0.00984
    },
    outcome: "opened",
    profile: {
      entryDebounceTicks: 2
    },
    quantity: 1,
    riskGate: {
      allowed: true,
      reason: "allowed"
    },
    signalState: {
      entrySignalStreak: 2
    },
    state: {},
    strategyId: "emaCross",
    tick: {
      price: 101.23456
    }
  });
  if (compactEntryMetadata.expectedNetEdgePct !== 0.0098 || compactEntryMetadata.estimatedCostPct !== 0.0025) {
    throw new Error(`compact entry metadata should preserve compact descriptor field meaning: ${JSON.stringify(compactEntryMetadata)}`);
  }
  if (compactEntryMetadata.publishedFamily !== "trend_following" || compactEntryMetadata.strategyRsi !== 61.2346) {
    throw new Error(`compact entry metadata should preserve architect/indicator compact fields: ${JSON.stringify(compactEntryMetadata)}`);
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
  const compactMtfEntryMetadata = telemetry.buildCompactEntryMetadata({
    allowReason: "entry_opened",
    architectState: {
      actionableFamily: "mean_reversion",
      architect: {
        marketRegime: "range",
        mtf: publishedMtf,
        recommendedFamily: "mean_reversion"
      },
      usable: true
    },
    context: {
      indicators: {
        rsi: 30.12345
      }
    },
    decision: {
      action: "buy",
      confidence: 0.88
    },
    economics: mtfEconomics,
    outcome: "opened",
    profile: {
      entryDebounceTicks: 1
    },
    quantity: 1,
    riskGate: {
      allowed: true,
      reason: "allowed"
    },
    signalState: {
      entrySignalStreak: 1
    },
    state: {},
    strategyId: "rsiReversion",
    tick: {
      price: 100
    }
  });
  if (compactMtfEntryMetadata.targetDistancePct !== 0.0142
    || compactMtfEntryMetadata.maxTargetDistancePctForShortHorizon !== 0.015
    || compactMtfEntryMetadata.mtfAdjustmentApplied !== true
    || compactMtfEntryMetadata.mtfResolvedTargetDistanceCapPct !== 0.015
    || compactMtfEntryMetadata.mtfParamResolutionReason !== "mtf_coherent_medium"
    || compactMtfEntryMetadata.mtfDominantFrame !== "medium") {
    throw new Error(`compact entry metadata should expose MTF target-distance resolution: ${JSON.stringify(compactMtfEntryMetadata)}`);
  }
  const compactSetupDescriptor = telemetry.maybeBuildCompactSetupDescriptor(compactMtfEntryMetadata, "rsiReversion");
  if (!compactSetupDescriptor
    || compactSetupDescriptor.metadata.targetDistancePct !== 0.0142
    || compactSetupDescriptor.metadata.mtfDominantFrame !== "medium"
    || compactSetupDescriptor.metadata.mtfResolvedTargetDistanceCapPct !== 0.015) {
    throw new Error(`compact SETUP metadata should carry MTF target-distance fields: ${JSON.stringify(compactSetupDescriptor)}`);
  }
  const compactBlockDescriptor = telemetry.maybeBuildCompactBlockChangeDescriptor({
    ...compactMtfEntryMetadata,
    blockReason: "target_distance_exceeds_short_horizon",
    maxTargetDistancePctForShortHorizon: 0.01,
    mtfAdjustmentApplied: false,
    mtfParamFallbackReason: "mtf_instability_above_threshold",
    mtfParamResolutionReason: "mtf_instability_above_threshold",
    mtfResolvedTargetDistanceCapPct: 0.01
  }, "rsiReversion");
  if (!compactBlockDescriptor
    || compactBlockDescriptor.metadata.blockReason !== "target_distance_exceeds_short_horizon"
    || compactBlockDescriptor.metadata.maxTargetDistancePctForShortHorizon !== 0.01
    || compactBlockDescriptor.metadata.mtfAdjustmentApplied !== false
    || compactBlockDescriptor.metadata.mtfParamFallbackReason !== "mtf_instability_above_threshold"
    || compactBlockDescriptor.metadata.mtfResolvedTargetDistanceCapPct !== 0.01
    || compactBlockDescriptor.metadata.publishedFamily !== "mean_reversion"
    || compactBlockDescriptor.metadata.publishedRegime !== "range"
    || compactBlockDescriptor.metadata.targetFamily !== "mean_reversion") {
    throw new Error(`compact BLOCK_CHANGE metadata should carry MTF fallback target-distance fields: ${JSON.stringify(compactBlockDescriptor)}`);
  }

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
}

module.exports = {
  runTradingBotTelemetryTests
};
