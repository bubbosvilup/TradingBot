# Project Map

Current runtime shape:

- `src/core/`: bootstrap, config, store, system server, architect/context services
- `src/roles/`: extracted operational roles and coordinators
- `src/bots/`: bot classes; `tradingBot.ts` is the top-level runtime orchestrator
- `src/engines/`: execution, indicators, backtest engine adapter
- `src/streams/`: market and user stream integration
- `src/ui/` and `public/`: dashboard adapters and static frontend
- `tests/`: behavior lock for runtime, roles, store, server, and stream flows
- `legacy/`: isolated old code, not the target architecture

Important repo facts:

- `src/core/orchestrator.ts` currently enforces `market-mode=live`.
- `src/core/orchestrator.ts` currently rejects `execution-mode=live`; execution remains paper-only.
- `src/core/stateStore.ts` now evicts stale symbol-scoped state conservatively while preserving registered symbols and open-position symbols.
- `src/streams/marketStream.ts` now narrows REST fallback fetches to stale symbols and uses batch ticker fetches when possible.
- `src/engines/backtestEngine.ts` is now a modern adapter over legacy backtest modules, not a full replay runtime.
- `src/core/systemServer.ts` now derives architect warmup diagnostics from the configured runtime warmup and exposes bot-level drawdown-pause/manual-resume state separately from the shared portfolio kill switch.
- `src/data/bots.config.json` now carries experiment label `quarantined_allow_small_loss_floor05`.
- `reports/experiments/` still contains historical outputs for the quarantined label.
- `src/bots/tradingBot.ts` still contains a large behavior-sensitive exit path, including `shouldExitPosition(...)`.

Boundary map:

- `ContextService` and `ContextBuilder`: rolling feature inputs only
- `ArchitectService`, `BotArchitect`, `architectCoordinator`: regime/family/usability publish and apply flow
- `TradingBot`: per-tick orchestration, coordination, execution handoff
- `entryCoordinator`, `openAttemptCoordinator`, `entryOutcomeCoordinator`: entry-side flow ownership
- `exitDecisionCoordinator`, `exitOutcomeCoordinator`, `managedRecoveryExitResolver`, `recoveryTargetResolver`: exit planning and shaping
- `postLossArchitectLatch`: post-loss re-entry defense
- `tradingBotTelemetry`: operator-facing metadata shaping
- `StateStore`: single runtime state container
- `BacktestEngine`: adapter boundary for future replay migration, not full runtime parity yet
- `SystemServer` plus `public/` and `src/ui/`: dashboard/API surface, separate from core decision logic

Hotspots to treat carefully:

- `src/bots/tradingBot.ts`
- `src/core/stateStore.ts`
- `src/core/orchestrator.ts`
- `src/core/systemServer.ts`
- `src/roles/architectCoordinator.ts`
- `src/roles/postLossArchitectLatch.ts`
- `src/roles/exitDecisionCoordinator.ts`
- `src/streams/marketStream.ts`
- `tests/tradingBot.test.js`
- `tests/systemServer.test.js`
- `tests/stateStore.test.js`
