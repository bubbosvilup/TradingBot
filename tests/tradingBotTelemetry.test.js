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
}

module.exports = {
  runTradingBotTelemetryTests
};
