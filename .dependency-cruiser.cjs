// v18.2-B dependency boundary baseline.
// All architecture rules are warnings while v18.2 removes current violations.
// Known warning findings at introduction:
// - src/core/botManager.ts -> src/bots/tradingBot.ts
// - src/core/stateStore.ts -> src/core/configLoader.ts
// - src/strategies/rsiReversion/strategy.ts -> src/roles/exitPolicyRegistry.ts
// - src/strategies/rsiReversion/strategy.ts -> src/roles/recoveryTargetResolver.ts
// - src/types/runtime.ts -> src/core/clock.ts
// - src/utils/time.ts -> src/core/clock.ts
// After v18.2-D, BotManager no longer imports TradingBot.
// src/core/orchestrator.ts is the composition root and may wire concrete bot implementations.

module.exports = {
  forbidden: [
    {
      name: "no-circular-imports",
      severity: "warn",
      comment: "Cycles are visible in warning mode during the v18.2 refactor.",
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: "types-stay-foundational",
      severity: "warn",
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
      severity: "warn",
      comment: "src/utils/** should stay below src/core/**.",
      from: {
        path: "^src/utils/"
      },
      to: {
        path: "^src/core/"
      }
    },
    {
      name: "state-store-config-loader-baseline",
      severity: "warn",
      comment: "Explicit baseline warning for current StateStore dependency on ConfigLoader constants.",
      from: {
        path: "^src/core/stateStore\\.ts$"
      },
      to: {
        path: "^src/core/configLoader\\.ts$"
      }
    },
    {
      name: "strategies-do-not-import-runtime-layers",
      severity: "warn",
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
      severity: "warn",
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
      severity: "warn",
      comment: "Only backtestEngine may bridge from src/** to legacy/** during migration.",
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
      severity: "warn",
      comment: "Core should not depend on concrete bot implementations; orchestrator is the composition root exception.",
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
      severity: "warn",
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
