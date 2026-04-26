"use strict";

const { resolveRecoveryTarget, resolveRecoveryTargetPolicy } = require("../src/domain/recoveryTargetResolver.ts");
const { getManagedRecoveryPolicy } = require("../src/roles/positionLifecycleManager.ts");

function approxEqual(actual, expected, epsilon = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

function buildContext(overrides = {}) {
  return {
    botId: "bot_target_test",
    hasOpenPosition: true,
    indicators: {
      emaBaseline: 102,
      emaFast: 101,
      emaSlow: 100,
      momentum: 0.2,
      rsi: 55,
      volatility: 1,
      ...(overrides.indicators || {})
    },
    latestPrice: 100.5,
    localRegimeHint: "range",
    performance: {
      avgTradePnlUsdt: 0,
      drawdown: 0,
      pnl: 0,
      profitFactor: 0,
      tradesCount: 0,
      winRate: 0
    },
    prices: overrides.prices || Array.from({ length: 20 }, (_, index) => 100 + index),
    strategyId: "rsiReversion",
    symbol: "BTC/USDT",
    timestamp: Date.now(),
    unrealizedPnl: 0
  };
}

function runRecoveryTargetResolverTests() {
  const defaultPolicy = resolveRecoveryTargetPolicy({});
  if (defaultPolicy.targetSource !== "emaSlow" || defaultPolicy.targetOffsetPct !== 0.015) {
    throw new Error(`unexpected default recovery target policy: ${JSON.stringify(defaultPolicy)}`);
  }
  const missingPolicy = resolveRecoveryTargetPolicy({ recovery: {} });
  if (missingPolicy.targetOffsetPct !== 0.015) {
    throw new Error(`missing recovery target offset should use the default: ${JSON.stringify(missingPolicy)}`);
  }
  const zeroPolicy = resolveRecoveryTargetPolicy({ recovery: { targetOffsetPct: 0 } });
  if (zeroPolicy.targetOffsetPct !== 0) {
    throw new Error(`zero recovery target offset should preserve current exact-base behavior: ${JSON.stringify(zeroPolicy)}`);
  }
  const positivePolicy = resolveRecoveryTargetPolicy({ recovery: { targetOffsetPct: 0.02 } });
  if (positivePolicy.targetOffsetPct !== 0.02) {
    throw new Error(`positive recovery target offset should be accepted: ${JSON.stringify(positivePolicy)}`);
  }
  let negativePolicyError = null;
  try {
    resolveRecoveryTargetPolicy({ recovery: { targetOffsetPct: -0.01 } });
  } catch (error) {
    negativePolicyError = error;
  }
  if (!negativePolicyError || !String(negativePolicyError.message || negativePolicyError).includes("targetOffsetPct")) {
    throw new Error(`negative recovery target offset should be rejected clearly: ${negativePolicyError}`);
  }
  let negativeRuntimeError = null;
  try {
    resolveRecoveryTarget({
      context: buildContext(),
      targetOffsetPct: -0.01,
      targetSource: "emaSlow"
    });
  } catch (error) {
    negativeRuntimeError = error;
  }
  if (!negativeRuntimeError || !String(negativeRuntimeError.message || negativeRuntimeError).includes("targetOffsetPct")) {
    throw new Error(`negative runtime recovery target offset should be rejected clearly: ${negativeRuntimeError}`);
  }
  let negativeManagedPolicyError = null;
  try {
    getManagedRecoveryPolicy({ recovery: { targetOffsetPct: -0.01 } });
  } catch (error) {
    negativeManagedPolicyError = error;
  }
  if (!negativeManagedPolicyError || !String(negativeManagedPolicyError.message || negativeManagedPolicyError).includes("targetOffsetPct")) {
    throw new Error(`negative managed recovery policy target offset should be rejected clearly: ${negativeManagedPolicyError}`);
  }

  const emaSlowTarget = resolveRecoveryTarget({
    context: buildContext(),
    targetOffsetPct: 0.015,
    targetSource: "emaSlow"
  });
  if (emaSlowTarget.source !== "emaSlow" || emaSlowTarget.basePrice !== 100 || !approxEqual(emaSlowTarget.targetPrice, 101.5)) {
    throw new Error(`emaSlow recovery target resolution mismatch: ${JSON.stringify(emaSlowTarget)}`);
  }

  const sma20Target = resolveRecoveryTarget({
    context: buildContext({
      prices: Array.from({ length: 20 }, (_, index) => 90 + index)
    }),
    targetOffsetPct: 0,
    targetSource: "sma20"
  });
  if (sma20Target.source !== "sma20" || sma20Target.basePrice !== 99.5 || sma20Target.targetPrice !== 99.5) {
    throw new Error(`sma20 recovery target resolution mismatch: ${JSON.stringify(sma20Target)}`);
  }

  const entryRelativeTarget = resolveRecoveryTarget({
    position: {
      botId: "bot_target_test",
      confidence: 0.8,
      entryPrice: 98,
      id: "pos-entry-relative",
      notes: ["entry"],
      openedAt: 1000,
      quantity: 1,
      side: "long",
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    },
    targetOffsetPct: 0.01,
    targetSource: "entryPrice"
  });
  if (entryRelativeTarget.source !== "entryPrice" || entryRelativeTarget.basePrice !== 98 || !approxEqual(entryRelativeTarget.targetPrice, 98.98)) {
    throw new Error(`entry-relative recovery target resolution mismatch: ${JSON.stringify(entryRelativeTarget)}`);
  }

  const shortEntryRelativeTarget = resolveRecoveryTarget({
    position: {
      botId: "bot_target_test",
      confidence: 0.8,
      entryPrice: 102,
      id: "pos-short-entry-relative",
      notes: ["entry"],
      openedAt: 1000,
      quantity: 1,
      side: "short",
      strategyId: "rsiReversion",
      symbol: "BTC/USDT"
    },
    targetOffsetPct: 0.01,
    targetSource: "entryPrice"
  });
  if (shortEntryRelativeTarget.source !== "entryPrice" || shortEntryRelativeTarget.basePrice !== 102 || !approxEqual(shortEntryRelativeTarget.targetPrice, 100.98) || shortEntryRelativeTarget.side !== "short") {
    throw new Error(`short entry-relative recovery target should resolve below entry: ${JSON.stringify(shortEntryRelativeTarget)}`);
  }
}

module.exports = {
  runRecoveryTargetResolverTests
};
