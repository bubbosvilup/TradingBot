// v18.2 dependency boundary rules.
// These rules are error-level now that v18.2-D removed the measured baseline violations.
// Historical warning findings at introduction, now resolved:
// - src/core/botManager.ts -> src/bots/tradingBot.ts
// - src/core/stateStore.ts -> src/core/configLoader.ts
// - src/strategies/rsiReversion/strategy.ts -> src/roles/exitPolicyRegistry.ts
// - src/strategies/rsiReversion/strategy.ts -> src/roles/recoveryTargetResolver.ts
// - src/types/runtime.ts -> src/core/clock.ts
// - src/utils/time.ts -> src/core/clock.ts
// Enforcement keeps these known violations from returning.

module.exports = {
  forbidden: [
    {
      name: "no-circular-imports",
      severity: "error",
      comment: "Circular imports are blocked after v18.2-D because the measured baseline is clean.",
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      comment: "src/domain/** contains pure contracts/helpers and must not import runtime or public layers.",
      from: {
        path: "^src/domain/"
      },
      to: {
        path: "^(src/(core|roles|streams|bots|engines|infra|public)|public)/"
      }
    },
    {
      name: "types-stay-foundational",
      severity: "error",
      comment: "src/types/** must not depend on runtime layers.",
      from: {
        path: "^src/types/"
      },
      to: {
        path: "^src/(core|bots|streams|engines|roles|strategies)/"
      }
    },
    {
      name: "utils-do-not-import-core",
      severity: "error",
      comment: "src/utils/** should stay below src/core/**.",
      from: {
        path: "^src/utils/"
      },
      to: {
        path: "^src/core/"
      }
    },
    {
      name: "strategies-do-not-import-runtime-layers",
      severity: "error",
      comment: "Strategies should expose decisions without importing orchestration/runtime roles.",
      from: {
        path: "^src/strategies/"
      },
      to: {
        path: "^src/(core|bots|streams|roles)/"
      }
    },
    {
      name: "roles-do-not-import-streams-or-bots",
      severity: "error",
      comment: "Roles should remain policy/coordinator logic below streams and concrete bots.",
      from: {
        path: "^src/roles/"
      },
      to: {
        path: "^src/(streams|bots)/"
      }
    },
    {
      name: "runtime-does-not-import-legacy",
      severity: "error",
      comment: "Only backtestEngine may bridge from src/** to legacy/** because backtests are the legacy compatibility boundary.",
      from: {
        path: "^src/",
        pathNot: "^src/engines/backtestEngine\\.ts$"
      },
      to: {
        path: "^legacy/"
      }
    },
    {
      name: "core-does-not-import-concrete-bots",
      severity: "error",
      comment: "Core must not depend on concrete bot implementations; orchestrator is the composition root and may wire concrete TradingBot instances.",
      from: {
        path: "^src/core/",
        pathNot: "^src/core/orchestrator\\.ts$"
      },
      to: {
        path: "^src/bots/"
      }
    },
    {
      name: "engines-do-not-import-bots-or-strategies",
      severity: "error",
      comment: "Engines should consume contracts/registries rather than concrete bots or strategy modules.",
      from: {
        path: "^src/engines/"
      },
      to: {
        path: "^src/(bots|strategies)/"
      }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules"
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json"
    }
  }
};
