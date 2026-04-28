# TradingBot Architecture

## Current Runtime Shape

TradingBot is a paper-trading runtime for multi-bot market observation, strategy evaluation, risk-gated paper execution, and operator observability.

The active runtime path is:

```text
startup historical preload
  -> StateStore
market data
  -> streams
  -> StateStore
  -> ContextService
  -> optional MTF context / aggregation
  -> ArchitectService
  -> TradingBot
  -> ExecutionEngine
  -> StateStore
  -> SystemServer / Pulse
```

Current runtime facts:

- execution is paper-only
- Pulse is the only active operator UI
- market data uses live stream input
- `StateStore` is the single runtime truth source
- historical preload is startup-only
- legacy replay is not modern runtime parity
- short support exists in the paper runtime
- margin/futures realism is not complete
- MTF is optional and must preserve baseline behavior when disabled or unclear
- experiments remain quarantined unless explicitly promoted

## Ownership Map

`src/core/` owns bootstrap, config loading, runtime composition, `StateStore`, system/API surfaces, context services, Architect services, and MTF context service.

`src/bots/` owns bot orchestration and per-tick sequencing. `TradingBot` may coordinate the tick flow, but must not own strategy policy, risk policy, sizing policy, cooldown policy, Architect interpretation, MTF interpretation, recovery policy, UI shaping, or debug-capture policy.

`src/roles/` owns focused trading roles: entry flow, open attempt flow, entry outcome shaping, exit planning, exit outcome shaping, recovery policy, risk management, post-loss latching, telemetry shaping, and small policy helpers.

`src/domain/` owns pure domain rules, state transitions, selectors, invariants, and reusable trading-domain helpers.

`src/engines/` owns execution, indicators, and the current backtest adapter boundary.

`src/streams/` owns market and account stream ingestion, external payload boundaries, and freshness handling.

`src/data/` owns runtime configuration data, bot configuration, and strategy selection/config surfaces.

`src/strategies/` owns strategy-specific signal logic, strategy config, and explicit strategy capabilities/policies.

`public/` owns Pulse browser presentation only. It must not influence trading decisions.

`tests/` owns behavior locks, boundary contracts, and regressions.

`legacy/` contains old code assets preserved for adapters, tests, and research. It is not the target architecture.

## Runtime Contracts

### Paper Runtime

The active runtime is paper-only. Live execution must not become easier to enter. Any change touching runtime mode, execution mode, or startup safety is P0.

### StateStore

`StateStore` owns authoritative runtime state for:

- bot lifecycle state
- positions
- orders
- closed trades
- performance
- market-data freshness
- symbol-scoped runtime maps

Read-like methods must not mutate observable state. Failed operations must leave authoritative state unchanged unless the method contract explicitly says otherwise.

`registerBot(...)` owns bot registration defaults and must preserve valid runtime fields on re-registration.

Paused state must stay coherent:

- `status === "paused"` requires a non-empty `pausedReason`
- non-paused state must not keep stale pause reasons
- paused + flat bot must not open new positions
- paused + open position may still close safely

Target contract for v18.3 P0.1: state write APIs must enforce ownership. A write must not allow mismatch between method `botId`, entity `botId`, and state owner. `updateBotState(...)` must not casually patch owner fields such as `botId` or `symbol`.

### Strategy Evaluation

`strategy.evaluate(context)` returns a decision with action `buy`, `hold`, or `sell`.

Decision fields must be valid:

- `confidence` finite and within `[0, 1]`
- `reason` is an array
- evaluation must not mutate input context

If evaluation throws, the failure is recoverable at the bot tick boundary. The tick must not open a position, the system must emit visible strategy-error telemetry, and later ticks must continue unless breaker policy pauses the bot.

### Execution

Execution is the only path that may open or close positions. Execution must go through `ExecutionEngine` and `StateStore`.

Open behavior:

- successful open creates one observable open position
- rejected open must not create a position
- rejected open must not append a closed trade
- rejected open must not silently mutate authoritative state

Close behavior:

- successful close clears the open position
- successful close appends one closed trade
- missing-position close must not append a closed trade
- missing-position close must not fake success

## Module Boundaries

`ArchitectService`, `BotArchitect`, and `architectCoordinator` own regime/family/usability publishing and entry blocking from Architect instability.

`ContextService` and `ContextBuilder` own rolling feature inputs.

`MtfContextService` owns optional MTF frame snapshots. `mtfContextAggregator` owns aggregation and dominant internal frame diagnostics. `mtfParamResolver` owns pure MTF-driven RSI hint/cap resolution. Raw timeframe labels stay in MTF config and aggregation plumbing; downstream policy resolvers consume only internal frame ids.

`entryCoordinator`, `openAttemptCoordinator`, and `entryOutcomeCoordinator` own entry-side flow. `entryEconomicsEstimator` owns fee-aware entry economics, capture-gap policy interpretation, target-distance diagnostics, and resolved cap computation.

`RiskManager` owns position sizing, drawdown gates, loss gates, cooldown policy, and volatility-aware sizing penalties. Volatility-aware sizing may reduce or preserve size, never increase it.

`exitDecisionCoordinator`, `exitOutcomeCoordinator`, `managedRecoveryExitResolver`, and domain exit/recovery helpers own exit planning and shaping. Managed recovery precedence is:

1. protective stop
2. timeout
3. confirmed target
4. invalidation

`tradingBotTelemetry` owns operator-facing trading metadata shaping. Telemetry must describe behavior, not become behavior.

`SystemServer` and `public/` own operator-facing API/UI presentation. They must not influence trading decisions.

`BacktestEngine` is currently an adapter boundary. It is not proof of modern runtime replay parity.

## Hard Boundaries

Do not:

- enable live execution
- treat legacy replay as runtime parity
- move policy logic back into `TradingBot`
- let UI, debug, launcher, or reporting influence trading decisions
- use strategy ids or symbols as hidden switches
- hide legacy behavior behind cleaner names
- add frameworks or wrappers unless they protect a real boundary
- use `any`, `as any`, broad casts, or `!` to bypass TypeScript
- change trading behavior silently

## Hotspots

Treat these areas carefully:

- `src/bots/tradingBot.ts`
- `src/core/stateStore.ts`
- `src/core/orchestrator.ts`
- `src/core/systemServer.ts`
- `src/core/configLoader.ts`
- `src/streams/marketStream.ts`
- `src/streams/userStream.ts`
- `src/engines/executionEngine.ts`
- `src/roles/entryCoordinator.ts`
- `src/roles/openAttemptCoordinator.ts`
- `src/roles/entryEconomicsEstimator.ts`
- `src/roles/riskManager.ts`
- `src/roles/exitDecisionCoordinator.ts`
- `src/roles/exitOutcomeCoordinator.ts`
- `src/roles/managedRecoveryExitResolver.ts`
- `src/roles/mtfParamResolver.ts`
- `src/roles/postLossArchitectLatch.ts`
- `src/core/mtfContextService.ts`

## Deferred Roadmap

Current focus is v18.3 Type Truth, ownership, boundaries, contracts, and documentation consolidation / humanization.

Deferred work:

- v19 modern replay/backtest parity
- v20 futures/margin realism
- v21 strategy lab / optimization

Do not pull deferred work into v18.3 unless explicitly ordered.

## Legacy-Code Status

`legacy/` contains code assets still used by adapter and compatibility tests:

- `backtest.js`
- `backtest_runner.js`
- `runtime.js`
- `server.js`
- `strategy.js`

Current blockers to deletion include the `BacktestEngine` bridge and tests that validate legacy adapter behavior. Legacy code is preserved for compatibility and research tooling, not as the active runtime architecture.
