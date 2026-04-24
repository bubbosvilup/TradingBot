# Project Map

Current runtime shape:

- `src/core/`: bootstrap, config, store, system server, architect/context services, optional MTF context service
- `src/roles/`: extracted operational roles, coordinators, and pure policy resolvers
- `src/bots/`: bot classes; `tradingBot.ts` is the top-level runtime orchestrator
- `src/engines/`: execution, indicators, backtest engine adapter
- `src/streams/`: market and user stream integration
- `public/`: static browser frontend for the active Pulse operator UI; the live Pulse chart frontend was removed for v18 stability and no chart library is loaded in the active browser path
- `tests/`: behavior lock for runtime, roles, store, server, and stream flows
- `legacy/`: isolated old code, not the target architecture

Important repo facts:

- `src/core/orchestrator.ts` currently enforces `market-mode=live`.
- `src/core/orchestrator.ts` currently rejects `execution-mode=live`; execution remains paper-only.
- `src/core/stateStore.ts` now evicts stale symbol-scoped state conservatively while preserving registered symbols and open-position symbols.
- `src/core/stateStore.ts` now validates portfolio kill-switch mode against the shared config-loader source of truth, rejects unsupported modes explicitly, sanitizes stale restored `stopped` state on enabled bot re-registration, and preserves valid paused states only when they already have a real `pausedReason`.
- `src/streams/marketStream.ts` now narrows REST fallback fetches to stale symbols and uses batch ticker fetches when possible.
- Market freshness expiry is wall-clock based: `receivedAt` / `updatedAt` drive stale detection, while exchange `lastTickTimestamp` remains metadata.
- `src/core/historicalBootstrapService.ts` owns startup-only historical preload. It uses the same `MarketStream`/ccxt Binance REST source, seeds `StateStore` through existing price/kline update paths, and runs before market stream/context/Architect/bots start.
- `src/streams/marketStream.ts` guards shutdown so WS close during teardown cannot start REST fallback, and in-flight fallback snapshots are invalidated after stop; this keeps test teardown clean without muting production logs.
- `src/engines/backtestEngine.ts` is now a modern adapter over legacy backtest modules, not a full replay runtime.
- Legacy backtest adapter coverage is not replay parity. v18.1 should add only a small deterministic legacy smoke test; v19 owns modern event-driven replay.
- `src/core/systemServer.ts` now derives architect warmup diagnostics from the configured runtime warmup, exposes bot-level drawdown-pause/manual-resume state separately from the shared portfolio kill switch, provides explicit `POST /api/bots/:botId/resume` for `max_drawdown_reached` bot pauses, and projects Pulse-focused operator payloads.
- `src/core/systemServer.ts` also provides explicit `POST /api/bots/:botId/reset-post-loss-latch` for operator recovery from `post_loss_latch_timeout_requires_operator`. It clears only post-loss latch state and does not unpause the bot or bypass cooldown, kill-switch, market freshness, or risk gates.
- `src/core/systemServer.ts` serves the single Pulse dashboard entry point at `/` and static UI assets. `/compact` now normalizes to `/`; the dashboard remains UI/API-facing only and must not become a control plane.
- `src/core/systemServer.ts` exposes additive `/api/pulse` server-side projection and `/api/pulse/stream` SSE for the operator-facing Pulse contract; the active Pulse frontend no longer renders a chart, while backend chart data, filtered events/trades, and legacy API endpoints remain available separately.
- `src/core/systemServer.ts` short-facing report surfaces are now covered by regression tests:
  - `buildTradesPayload()` preserves `side: "short"`
  - `buildChartPayload()` emits `SHORT` / `COVER` markers
  - Pulse and positions payloads expose open short state clearly
- `src/core/orchestrator.ts` can opt into opening the Pulse UI at startup through env flags, but this must remain explicit and non-essential to trading behavior.
- `src/data/bots.config.json` now carries experiment label `quarantined_allow_small_loss_floor05`.
- `reports/experiments/` still contains historical outputs for the quarantined label.
- `src/core/architectService.ts` switch-delta publishing now compares challenger score against the true published incumbent score, not the candidate assessment's incumbent-regime score.
- `src/bots/tradingBot.ts` still contains a large behavior-sensitive exit path, including `shouldExitPosition(...)`, but the close path now takes a defensive position snapshot for planning/lifecycle/telemetry shaping and emits explicit `position_close_rejected` risk telemetry when `closePosition(...)` returns null.
- `src/roles/exitPolicyRegistry.ts` now carries explicit runtime exit capabilities for RSI reversion policies:
  - `qualification.rsiThresholdExit`
  - `recovery.priceTargetExit`
- `src/roles/exitDecisionCoordinator.ts` is now the authoritative exit capability gate:
  - disabled RSI-threshold and price-target triggers are hard-blocked instead of falling through to generic exits
  - managed recovery price-target behavior respects `recovery.priceTargetExit`
  - disabled raw reason strings are sanitized before downstream lifecycle/telemetry code sees the final exit plan
- `src/bots/tradingBot.ts` now treats paused state as runtime-authoritative for new entry work:
  - paused + flat bot returns before strategy/entry evaluation
  - paused + open position still reaches exit handling
- `src/roles/exitOutcomeCoordinator.ts` now preserves coherent pause state on close:
  - a bot closing while paused keeps its non-empty `pausedReason`
  - runtime state must not persist `status === "paused"` with a null/empty reason
- `src/engines/executionEngine.ts`, `src/roles/openAttemptCoordinator.ts`, `src/core/systemServer.ts`, and active strategies are now side-aware for first-class short handling in paper runtime and operator telemetry.
- `src/utils/exitLifecycleReport.ts` is now short-aware for runtime event enrichment:
  - short close logs from `COVER` enrich report snapshots like long `SELL` closes
  - latch analysis recognizes later `SHORT` entries alongside `BUY`
- `src/core/experimentReporter.ts` now emits additive `sideSummary=long_only|short_only|mixed|none` in the text export without changing the broader report shape.
- `src/engines/indicatorEngine.ts` still implements simple-window RSI, not Wilder-smoothed RSI; strategy thresholds are calibrated to that exact implementation.
- `src/roles/openAttemptCoordinator.ts` and `src/roles/exitOutcomeCoordinator.ts` document short balance handling as a paper-only full-notional model, not realistic leveraged margin accounting.
- `paper_full_notional_simplified` means the active paper runtime models short PnL with full notional accounting. It is a safety/clarity label, not realistic futures margin. v20 owns margin, liquidation, mark price, leverage, and funding realism.
- `src/strategies/rsiReversion/config.json` now carries conservative short-horizon entry economics: `minExpectedNetEdgePct: 0.0015` and `maxTargetDistancePctForShortHorizon: 0.01`.
- `src/strategies/rsiReversion/strategy.ts` declares explicit entry economics capabilities through `entryEconomicsPolicy`; shared economics code must use that policy surface instead of strategy-name branching.
- MTF is enabled in `src/data/bots.config.json` and can be overridden with `MTF_ENABLED=false` / `MTF_ENABLED=true`; when absent or disabled, RSI entry behavior must remain baseline-identical.
- Historical preload is enabled by default in optional mode through `historicalPreload`; `HISTORICAL_PRELOAD_REQUIRED=true` makes preload failure abort startup before live observation begins.
- `src/types/mtf.ts` defines internal horizon frame ids (`short`, `medium`, `long`). Raw timeframe labels stay mapped to these ids in MTF frame config / aggregation plumbing, not in downstream policy resolvers.
- `src/core/architectService.ts` can attach optional MTF publish diagnostics to `ArchitectAssessment.mtf`, including `mtfDominantFrame`, agreement, instability, meta regime, and sufficient-frame status.
- `src/roles/mtfParamResolver.ts` is the pure RSI MTF parameter resolver. It keeps RSI thresholds at baseline, floors the RSI min edge at `0.0015`, and only widens the target-distance cap under coherent range MTF: `short` = baseline, `medium` = `1.5x`, `long` = `2.0x`.
- `src/roles/entryEconomicsEstimator.ts` owns the configurable capture-gap cap through strategy economics policy. The baseline default remains `0.03`, and explicit config such as `captureGapCapPct` must be policy/config driven, not symbol-name driven.
- `src/roles/riskManager.ts` owns conservative volatility-aware sizing and post-trade cooldown nuance. Volatility sizing may only reduce/preserve size; missing or disabled volatility sizing remains baseline-identical. Loss cooldown semantics remain stronger than post-win reentry cooldown.
- `src/roles/tradingBotTelemetry.ts` now exposes both published MTF diagnostics and entry-side RSI MTF cap-resolution diagnostics in full entry logs and compact `SETUP` / `BLOCK_CHANGE` metadata.
- `src/core/systemServer.ts` preserves published Architect `mtf` diagnostics through `/api/bots`; it does not interpret or reshape MTF trading policy.

Boundary map:

- `ContextService` and `ContextBuilder`: rolling feature inputs only
- `HistoricalBootstrapService`: startup-only historical preload into `StateStore`; no tick-path fetches and no trading policy ownership
- `MtfContextService`: optional MTF frame snapshot construction behind `mtf.enabled`
- `mtfContextAggregator`: MTF frame aggregation and dominant internal frame diagnostics
- `ArchitectService`, `BotArchitect`, `architectCoordinator`: regime/family/usability publish and apply flow; `architectCoordinator` owns entry blocking for pending challenger hysteresis
- `TradingBot`: per-tick orchestration, coordination, execution handoff
- `entryCoordinator`, `openAttemptCoordinator`, `entryOutcomeCoordinator`: entry-side flow ownership, including short-horizon target-distance gating and side-aware execution handoff
- `mtfParamResolver`: pure MTF-driven RSI entry hint/cap resolution only; no sizing, cooldown, hold, or gate ownership
- `entryEconomicsEstimator`: fee-aware edge estimate plus deterministic capture-gap, short-horizon target-distance diagnostics, and resolved cap computation from explicit strategy economics policy
- `RiskManager`: drawdown gates, loss-streak policy, volatility-aware sizing penalties, and post-close cooldown timing
- `exitDecisionCoordinator`, `exitOutcomeCoordinator`, `managedRecoveryExitResolver`, `recoveryTargetResolver`: exit planning and shaping; managed-recovery invalidation grace, target-vs-invalidation precedence, capability gating, and paused-close state coherence live here
- `postLossArchitectLatch`: post-loss re-entry defense
- `tradingBotTelemetry`: operator-facing metadata shaping, including full/Pulse-facing MTF publish and entry cap-resolution diagnostics
- `StateStore`: single runtime state container
- `BacktestEngine`: adapter boundary for future replay migration, not full runtime parity yet
- `SystemServer` plus `public/`: Pulse UI/API surface, separate from core decision logic

Roadmap boundary:

- v18.1: cleanup and runbook work only. Safe targets are TickProcessingSnapshot/hot-path history sharing, MTF boundary validation if shared cleanly, injected SystemServer clock use, legacy smoke tests, local MarketStream naming, and operator docs.
- v19: modern backtest parity. It must solve data quality, event replay, execution realism, strategic reporting, anti-lookahead, and legacy deprecation.
- v20: paper futures isolated-margin realism for economically honest shorts.
- v21: strategy lab and optimization focused on robustness, walk-forward validation, out-of-sample discipline, Monte Carlo stress, and fair benchmarks.

Hotspots to treat carefully:

- `src/bots/tradingBot.ts`
- `src/core/stateStore.ts`
- `src/core/orchestrator.ts`
- `src/core/systemServer.ts`
- `src/roles/architectCoordinator.ts`
- `src/roles/entryCoordinator.ts`
- `src/roles/entryEconomicsEstimator.ts`
- `src/roles/riskManager.ts`
- `src/roles/mtfParamResolver.ts`
- `src/roles/mtfContextAggregator.ts`
- `src/core/mtfContextService.ts`
- `src/roles/postLossArchitectLatch.ts`
- `src/roles/exitDecisionCoordinator.ts`
- `src/roles/managedRecoveryExitResolver.ts`
- `src/streams/marketStream.ts`
- future `ReplayFeed` / modern backtest modules once v19 starts
- `tests/tradingBot.test.js`
- `tests/executionEngine.test.js`
- `tests/activeStrategies.test.js`
- `tests/mtfParamResolver.test.js`
- `tests/mtfContextAggregator.test.js`
- `tests/mtfContextService.test.js`
- `tests/systemServer.test.js`
- `tests/stateStore.test.js`
