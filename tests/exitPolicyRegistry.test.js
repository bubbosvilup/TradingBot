"use strict";

const { resolveExitPolicy } = require("../src/roles/exitPolicyRegistry.ts");

function runExitPolicyRegistryTests() {
  const rsiReversionPro = resolveExitPolicy({ exitPolicyId: "RSI_REVERSION_PRO" });
  if (!rsiReversionPro || rsiReversionPro.id !== "RSI_REVERSION_PRO") {
    throw new Error(`named RSI reversion exit policy should resolve explicitly: ${JSON.stringify(rsiReversionPro)}`);
  }
  if (rsiReversionPro.qualification.minTickProfit !== 0.05 || rsiReversionPro.recovery.targetSource !== "emaSlow" || rsiReversionPro.recovery.timeoutMs !== 30_000 || rsiReversionPro.recovery.maxConsecutiveEntries !== 2) {
    throw new Error(`resolved RSI_REVERSION_PRO shape mismatch: ${JSON.stringify(rsiReversionPro)}`);
  }

  const overridden = resolveExitPolicy({
    exitPolicy: {
      invalidation: {
        modes: ["family_mismatch"]
      },
      recovery: {
        timeoutMs: 45_000
      }
    },
    exitPolicyId: "RSI_REVERSION_PRO"
  });
  if (!overridden || overridden.recovery.timeoutMs !== 45_000 || overridden.qualification.minTickProfit !== 0.05) {
    throw new Error(`exit policy override should preserve base blocks and override only requested fields: ${JSON.stringify(overridden)}`);
  }
  if (overridden.invalidation.modes.length !== 1 || overridden.invalidation.modes[0] !== "family_mismatch") {
    throw new Error(`exit policy override should replace invalidation modes cleanly: ${JSON.stringify(overridden)}`);
  }
}

module.exports = {
  runExitPolicyRegistryTests
};
