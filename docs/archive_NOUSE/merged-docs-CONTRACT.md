# Runtime Contracts

This document records runtime contracts that must stay true during refactors.

A contract is valid only if it is:

- implemented in code
- observable through behavior
- protected by tests

If a rule is not fully implemented yet, mark it as a target contract.

Do not treat target contracts as current runtime truth.

---

## Goal

Keep runtime behavior understandable, safe, and verifiable.

Future refactors must preserve these contracts unless a patch explicitly changes:

- code
- tests
- documentation

in the same change.

---

# Current Contracts

## Paper Runtime Contract

The active runtime is paper-only.

Live execution must not become easier to enter.

Any change that touches runtime mode, execution mode, or startup safety is P0.

---

## StateStore Contract

`StateStore` is the runtime source of truth.

It owns authoritative runtime state for:

- bot lifecycle state
- positions
- orders
- closed trades
- performance
- market-data freshness
- symbol-scoped runtime maps

Read-like methods must not mutate observable state.

Failed operations must leave authoritative state unchanged unless the method contract explicitly says otherwise.

`registerBot(...)` owns bot registration defaults and must preserve valid runtime fields on re-registration.

Paused state must stay coherent:

- `status === "paused"` requires a non-empty `pausedReason`
- non-paused state must not keep stale pause reasons
- paused + flat bot must not open new positions
- paused + open position may still close safely

### Target Contract

State write APIs should enforce ownership.

A write must not allow mismatch between:

- method `botId`
- entity `botId`
- state owner

`updateBotState(...)` should not allow casual patching of owner fields such as `botId` or `symbol`.

This is a v18.3 P0 Type Truth target.

---

## Strategy Evaluation Contract

`strategy.evaluate(context)` returns a decision.

Decision action must be one of:

- `buy`
- `hold`
- `sell`

Decision fields must be valid:

- `confidence` finite and within `[0, 1]`
- `reason` is an array
- evaluation must not mutate input context

If `evaluate(context)` throws:

- the failure is recoverable at the bot tick boundary
- the tick must not open a position
- the system must emit visible strategy-error telemetry
- later ticks must continue unless breaker policy pauses the bot

### Target Contract

Repeated strategy failures should be represented by a clear breaker contract:

- per-bot counter
- rolling window
- visible pause reason
- explicit manual recovery path

Do not build a large breaker framework before the current failure paths are typed and tested.

---

## Execution Contract

Execution is the only path that may open or close positions.

Execution must go through:

- `ExecutionEngine`
- `StateStore`

No side paths.

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

### Target Contract

Open/close results should be discriminated results:

```ts
{ ok: true, value: ... } | { ok: false, error: ExecutionError }