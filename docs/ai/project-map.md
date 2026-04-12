# Project Map

Current runtime shape:

- `src/core/`: bootstrap, config, store, system server, architect/context services, optional MTF context service
- `src/roles/`: extracted operational roles, coordinators, and pure policy resolvers
- `src/bots/`: bot classes; `tradingBot.ts` is the top-level runtime orchestrator
- `src/engines/`: execution, indicators, backtest engine adapter
- `src/streams/`: market and user stream integration
- `src/ui/` and `public/`: dashboard adapters and static frontend, including the separate compact monitor route
- `tests/`: behavior lock for runtime, roles, store, server, and stream flows
- `legacy/`: isolated old code, not the target architecture

Important repo facts:

- `src/core/orchestrator.ts` currently enforces `market-mode=live`.
- `src/core/orchestrator.ts` currently rejects `execution-mode=live`; execution remains paper-only.
- `src/core/stateStore.ts` now evicts stale symbol-scoped state conservatively while preserving registered symbols and open-position symbols.
- `src/streams/marketStream.ts` now narrows REST fallback fetches to stale symbols and uses batch ticker fetches when possible.
- `src/core/historicalBootstrapService.ts` owns startup-only historical preload. It uses the same `MarketStream`/ccxt Binance REST source, seeds `StateStore` through existing price/kline update paths, and runs before market stream/context/Architect/bots start.
- `src/streams/marketStream.ts` guards shutdown so WS close during teardown cannot start REST fallback, and in-flight fallback snapshots are invalidated after stop; this keeps test teardown clean without muting production logs.
- `src/engines/backtestEngine.ts` is now a modern adapter over legacy backtest modules, not a full replay runtime.
- `src/core/systemServer.ts` now derives architect warmup diagnostics from the configured runtime warmup, exposes bot-level drawdown-pause/manual-resume state separately from the shared portfolio kill switch, and provides explicit `POST /api/bots/:botId/resume` for `max_drawdown_reached` bot pauses.
- `src/core/systemServer.ts` serves both the full dashboard and the dedicated compact monitor. The compact route is UI/API-facing only and must not become a control plane.
- `src/core/orchestrator.ts` can opt into opening the compact UI at startup through env flags, but this must remain explicit and non-essential to trading behavior.
- `src/data/bots.config.json` now carries experiment label `quarantined_allow_small_loss_floor05`.
- `reports/experiments/` still contains historical outputs for the quarantined label.
- `src/bots/tradingBot.ts` still contains a large behavior-sensitive exit path, including `shouldExitPosition(...)`.
- `src/strategies/rsiReversion/config.json` now carries conservative short-horizon entry economics: `minExpectedNetEdgePct: 0.0015` and `maxTargetDistancePctForShortHorizon: 0.01`.
- MTF is enabled in `src/data/bots.config.json` and can be overridden with `MTF_ENABLED=false` / `MTF_ENABLED=true`; when absent or disabled, RSI entry behavior must remain baseline-identical.
- Historical preload is enabled by default in optional mode through `historicalPreload`; `HISTORICAL_PRELOAD_REQUIRED=true` makes preload failure abort startup before live observation begins.
- `src/types/mtf.ts` defines internal horizon frame ids (`short`, `medium`, `long`). Raw timeframe labels stay mapped to these ids in MTF frame config / aggregation plumbing, not in downstream policy resolvers.
- `src/core/architectService.ts` can attach optional MTF publish diagnostics to `ArchitectAssessment.mtf`, including `mtfDominantFrame`, agreement, instability, meta regime, and sufficient-frame status.
- `src/roles/mtfParamResolver.ts` is the pure RSI MTF parameter resolver. It keeps RSI thresholds at baseline, floors the RSI min edge at `0.0015`, and only widens the target-distance cap under coherent range MTF: `short` = baseline, `medium` = `1.5x`, `long` = `2.0x`.
- `src/roles/tradingBotTelemetry.ts` now exposes both published MTF diagnostics and entry-side RSI MTF cap-resolution diagnostics in full entry logs and compact `SETUP` / `BLOCK_CHANGE` metadata.
- `src/core/systemServer.ts` preserves published Architect `mtf` diagnostics through `/api/bots`; it does not interpret or reshape MTF trading policy.

Boundary map:

- `ContextService` and `ContextBuilder`: rolling feature inputs only
- `HistoricalBootstrapService`: startup-only historical preload into `StateStore`; no tick-path fetches and no trading policy ownership
- `MtfContextService`: optional MTF frame snapshot construction behind `mtf.enabled`
- `mtfContextAggregator`: MTF frame aggregation and dominant internal frame diagnostics
- `ArchitectService`, `BotArchitect`, `architectCoordinator`: regime/family/usability publish and apply flow; `architectCoordinator` owns entry blocking for pending challenger hysteresis
- `TradingBot`: per-tick orchestration, coordination, execution handoff
- `entryCoordinator`, `openAttemptCoordinator`, `entryOutcomeCoordinator`: entry-side flow ownership, including short-horizon target-distance gating
- `mtfParamResolver`: pure MTF-driven RSI entry hint/cap resolution only; no sizing, cooldown, hold, or gate ownership
- `entryEconomicsEstimator`: fee-aware edge estimate plus deterministic short-horizon target-distance diagnostics and resolved cap computation
- `exitDecisionCoordinator`, `exitOutcomeCoordinator`, `managedRecoveryExitResolver`, `recoveryTargetResolver`: exit planning and shaping; managed-recovery invalidation grace and target-vs-invalidation precedence live here
- `postLossArchitectLatch`: post-loss re-entry defense
- `tradingBotTelemetry`: operator-facing metadata shaping, including full/compact MTF publish and entry cap-resolution diagnostics
- `StateStore`: single runtime state container
- `BacktestEngine`: adapter boundary for future replay migration, not full runtime parity yet
- `SystemServer` plus `public/` and `src/ui/`: dashboard/API surface, separate from core decision logic

Hotspots to treat carefully:

- `src/bots/tradingBot.ts`
- `src/core/stateStore.ts`
- `src/core/orchestrator.ts`
- `src/core/systemServer.ts`
- `src/roles/architectCoordinator.ts`
- `src/roles/entryCoordinator.ts`
- `src/roles/entryEconomicsEstimator.ts`
- `src/roles/mtfParamResolver.ts`
- `src/roles/mtfContextAggregator.ts`
- `src/core/mtfContextService.ts`
- `src/roles/postLossArchitectLatch.ts`
- `src/roles/exitDecisionCoordinator.ts`
- `src/roles/managedRecoveryExitResolver.ts`
- `src/streams/marketStream.ts`
- `tests/tradingBot.test.js`
- `tests/mtfParamResolver.test.js`
- `tests/mtfContextAggregator.test.js`
- `tests/mtfContextService.test.js`
- `tests/systemServer.test.js`
- `tests/stateStore.test.js`
