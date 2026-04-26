# Runtime Contracts

This document records the current runtime contracts that future refactors must preserve unless a patch explicitly changes the contract and updates tests and docs at the same time.

## Error Policy

### InvariantError

- Represents a non-recoverable programmer or state contract violation.
- Must not be swallowed silently.
- Current behavior is fail-fast unless the error is caught at a top-level runtime boundary for logging or shutdown handling.

### StrategyError

- Represents a recoverable per-tick strategy evaluation failure.
- A `strategy.evaluate(...)` failure is wrapped as a structured `StrategyError`.
- The tick must produce a safe `hold` decision with `strategy_error` metadata.
- The failure must not open a position.
- A repeated `StrategyError` breaker is future work and is not part of the current contract.

### ExecutionError

- Returned by `ExecutionEngine` as a discriminated result with `ok:false`.
- `ok:false` must not mutate authoritative state.
- Callers must branch on `ok` before reading success payloads.

### ConfigError

- Represents startup/config validation failure.
- Non-recoverable until the config is fixed.
- Config loading should reject unsupported or malformed runtime settings before the orchestrator starts.

### MarketDataError / ExchangeError

- Future taxonomy targets.
- Must not be mapped to `ExecutionError` by default.
- Market data and exchange connectivity failures should preserve their boundary context so callers do not confuse data quality problems with order execution rejections.

## Boundary Contracts

### Strategy.evaluate

- Accepts a strategy context and returns a decision object.
- The decision action must be one of `buy`, `hold`, or `sell`.
- `confidence` must be finite and within `[0, 1]`.
- `reason` must be an array.
- `evaluate(context)` must not mutate the input context.
- Throwing from `evaluate(context)` is recoverable at the bot tick boundary and must become a safe hold with `strategy_error`.

### ExecutionEngine Open/Close

- `openLong(...)` / `openShort(...)` return `ExecutionOpenResult`.
- Successful opens return `ok:true` with an order and position, and create one observable open position.
- Rejected opens return `ok:false` with an `ExecutionError`; they must not create a position, append a closed trade, or change authoritative balance/state.
- `closePosition(...)` returns `ExecutionCloseResult`.
- Successful closes return `ok:true` with a closed trade and order, clear the open position, and append one closed trade.
- Missing-position closes return `ok:false` with `code="position_not_found"` and must not append a closed trade or mutate observable state.

### Position / Order Transitions

- Position transition helpers live in `src/domain/stateTransitions.ts`.
- Runtime persistence shape is unchanged; helpers are pure contract rails and are not deeply wired into runtime mutation paths yet.
- Current observable position states are:
  - `flat`
  - `open_active`
  - `open_managed_recovery`
  - `exiting`
- Allowed observable position transitions:
  - `flat -> open_active`
  - `open_active -> open_managed_recovery`
  - `open_active -> exiting`
  - `open_active -> flat`
  - `open_managed_recovery -> exiting`
  - `open_managed_recovery -> flat`
  - `exiting -> flat`
- `flat -> flat` is idempotent; opening from an already open position is invalid.
- Managed recovery positions must preserve a finite `managedRecoveryStartedAt`.
- Closing from `flat` and opening from a non-flat state are invalid transition contracts.
- Current minimal order states are:
  - `created`
  - `opened`
  - `closed`
  - `rejected`
- Allowed order transitions:
  - `created -> opened`
  - `created -> closed`
  - `created -> rejected`
  - `opened -> closed`
- `closed` and `rejected` orders are terminal for this contract layer.
- Future wiring target: use these helpers at runtime mutation boundaries after state ownership is narrowed enough to avoid behavior changes.

### StateStore Read/Update

- Read-like methods must not mutate the observable system snapshot.
- `registerBot(...)` owns bot registration defaults and must preserve valid runtime fields on re-registration.
- `updateBotState(...)` must enforce lifecycle invariants:
  - paused state requires `pausedReason`
  - non-paused state clears stale `pausedReason`
- Position, order, closed-trade, performance, market-data freshness, and symbol-retention maps are authoritative state. Failed operations must leave them unchanged unless the contract says otherwise.

### Market Freshness / EntryGuard

- Market freshness statuses are `fresh`, `degraded`, and `stale`.
- Flat bots must not open new positions when market data is `degraded` or `stale`.
- Derived `EntryGuardState` for non-fresh market data is `market_data_block`.
- Non-fresh market data must flow through entry diagnostics as an explicit market-data block.
- Open-position exit handling remains allowed on degraded/stale data and should emit degraded-data exit warning telemetry.

### ConfigLoader

- Loads and validates bot/runtime config before orchestration.
- Throws structured `ConfigError` for converted validation groups.
- Must preserve accepted/rejected config semantics and the returned config shape unless a patch explicitly changes the API contract.
- Defaults exposed by schema helpers document runtime defaults; missing config fields are not automatically injected into the loaded config object unless already part of current behavior.

### UserStream / WS Events

- `UserStream` normalizes remote and locally published user events before subscribers mutate state.
- User stream keepalive and websocket failures are degraded connectivity states, not execution failures.
- WS event payloads are external boundary data and must be parsed defensively.
- Local execution events published through the user stream must preserve the same mutation semantics as remote user events.
- Disconnect/degraded events must be visible through connection state and logs for operator diagnosis.
