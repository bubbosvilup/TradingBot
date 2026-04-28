# Project Map

Goal:
Show where the main parts of the repo live and what each part owns.

This file is a map, not a changelog.
Historical notes belong in `docs/archive_NOUSE`.

---

## Runtime Shape

- `src/core/`
  - bootstrap
  - config loading
  - runtime composition
  - `StateStore`
  - system/API server
  - context and Architect services

- `src/bots/`
  - bot orchestration
  - per-tick sequencing
  - execution handoff
  - `TradingBot` must stay orchestration-focused

- `src/roles/`
  - focused trading roles
  - entry, exit, recovery, risk, telemetry, and coordination helpers
  - policy logic that does not belong directly in `TradingBot`

- `src/domain/`
  - pure domain rules
  - state transitions
  - selectors
  - invariants
  - reusable trading-domain helpers

- `src/engines/`
  - execution
  - indicators
  - backtest adapter boundary

- `src/streams/`
  - market stream integration
  - user/account stream integration
  - external payload ingestion and freshness handling

- `src/data/`
  - runtime configuration data
  - bot configuration
  - strategy selection/config surfaces

- `src/strategies/`
  - strategy-specific signal logic
  - strategy config
  - explicit strategy capabilities/policies

- `public/`
  - static Pulse UI assets
  - browser presentation only
  - no trading decisions

- `tests/`
  - behavior locks
  - boundary contracts
  - regression tests

- `legacy/`
  - old isolated code
  - not the target architecture

---

## Current Runtime Facts

- execution is paper-only
- market data uses live stream input
- `StateStore` is the single runtime truth source
- Pulse is the active operator UI
- Pulse must stay separate from trading decisions
- legacy backtest is not modern replay parity
- modern replay/backtest parity is future v19 work
- short support exists in paper runtime
- margin/futures realism is not complete
- MTF is optional and must preserve baseline behavior when disabled or unclear
- experiments remain quarantined unless explicitly promoted

---

## Ownership Map

### State

`StateStore` owns runtime state.

No module should create shadow state paths for positions, orders, trades, balances, or bot lifecycle.

---

### Bot Orchestration

`TradingBot` owns sequencing.

It may coordinate the tick flow, but must not own:

- strategy-specific policy
- risk policy
- sizing policy
- cooldown policy
- Architect interpretation
- MTF interpretation
- recovery policy
- UI shaping
- debug-capture policy

---

### Market and Account Streams

`MarketStream` and `UserStream` own external stream ingestion.

They must narrow or validate external data before trusted runtime logic consumes it.

---

### Context and Architect

`ContextService` / `ContextBuilder` own rolling feature inputs.

`ArchitectService`, `BotArchitect`, and `architectCoordinator` own regime/family/usability publishing and entry blocking from Architect instability.

---

### Entry

`entryCoordinator`, `openAttemptCoordinator`, and `entryOutcomeCoordinator` own entry-side flow.

`entryEconomicsEstimator` owns fee-aware entry economics, capture-gap policy interpretation, target-distance diagnostics, and resolved cap computation.

---

### Risk

`RiskManager` owns:

- position sizing
- drawdown gates
- loss gates
- cooldown policy
- volatility-aware sizing penalties

Volatility-aware sizing may reduce or preserve size, never increase it.

---

### Exit and Recovery

`exitDecisionCoordinator`, `exitOutcomeCoordinator`, `managedRecoveryExitResolver`, and domain exit/recovery helpers own exit planning and shaping.

Managed recovery precedence is:

1. protective stop
2. timeout
3. confirmed target
4. invalidation

---

### MTF

`MtfContextService` owns optional MTF frame snapshots.

`mtfContextAggregator` owns aggregation and dominant internal frame diagnostics.

`mtfParamResolver` owns pure MTF-driven RSI hint/cap resolution.

Raw timeframe labels must stay in MTF config / aggregation plumbing.
Downstream policy resolvers consume only internal frame ids.

---

### Telemetry

`tradingBotTelemetry` owns operator-facing trading metadata shaping.

Telemetry must describe behavior, not become behavior.

---

### UI/API

`SystemServer` and `public/` own operator-facing API/UI presentation.

They must not influence trading decisions.

---

### Backtest

`BacktestEngine` is currently an adapter boundary.

It is not proof of modern runtime replay parity.

Modern replay belongs to v19.

---

## Hard Boundaries

Do not:

- enable live execution
- treat legacy replay as runtime parity
- move policy logic back into `TradingBot`
- let UI/debug/reporting influence trading decisions
- use strategy ids or symbols as hidden switches
- hide legacy behavior behind cleaner names
- add frameworks or wrappers unless they protect a real boundary
- use `any`, `as any`, broad casts, or `!` to bypass TypeScript
- change trading behavior silently

---

## Roadmap Boundary

Current focus:
v18.3 Type Truth, ownership, boundaries, contracts, and documentation alignment.

Deferred:

- v19 modern replay/backtest parity
- v20 futures/margin realism
- v21 strategy lab / optimization

Do not pull deferred work into v18.3 unless explicitly ordered.

---

## Hotspots

Treat these areas carefully:

- `src/bots/tradingBot.ts`
- `src/core/stateStore.ts`
- `src/core/orchestrator.ts`
- `src/core/systemServer.ts`
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
- `tests/tradingBot.test.js`
- `tests/stateStore.test.js`
- `tests/systemServer.test.js`