# Runtime Safety

Goal:
Keep runtime behavior safe, predictable, and verifiable.

The runtime must not become more complex, more implicit, or more permissive.

---

## Current Runtime Facts

- execution is paper-only → must remain so
- market data comes from live streams
- `StateStore` is the single source of truth
- historical preload is bootstrap-only
- Pulse UI is observability only (no trading decisions)

If any of these change → it is a P0 decision

---

## Core Safety Rules

Do not:

- enable or reintroduce live execution
- bypass `StateStore` as the source of truth
- introduce alternative state paths or shadow histories
- let UI, telemetry, or debug systems influence trading decisions
- mix startup/bootstrap logic with per-tick runtime logic
- hide failures that should stop or degrade the system

---

## State Safety

- every important state has one owner
- state must not be mutated from multiple uncontrolled paths
- paused state must always have a valid reason
- paused state blocks entry but must still allow safe exits

If state ownership becomes unclear → stop

---

## Startup Safety

- invalid or incomplete config must fail fast
- required preload must block startup if it fails
- startup must not silently degrade into unsafe mode
- runtime mode must be explicit (paper-only, no hidden live paths)

---

## Risk & Execution Safety

Do not:

- weaken protective exits
- change recovery vs invalidation precedence silently
- bypass Architect gating (`architect_challenger_pending`)
- change entry/exit behavior through runtime plumbing
- make execution paths implicit or harder to trace

Execution must always go through:

- `ExecutionEngine`
- `StateStore`

No side paths allowed

---

## Managed Recovery Safety

Current precedence must remain:

1. protective stop
2. timeout
3. confirmed target
4. invalidation

Do not:

- reorder this silently
- make invalidation easier than entry
- remove grace/confirmation for regime invalidation

---

## MTF Safety

MTF is optional.

If disabled or unclear → behavior must match baseline exactly.

Do not:

- leak MTF logic into `TradingBot`
- interpret raw timeframe labels outside MTF config/aggregation
- widen behavior outside defined policy

---

## Economics & Sizing Safety

- baseline capture-gap cap remains `0.03`
- volatility-aware sizing must never increase size
- missing or invalid data must fall back to baseline behavior

Do not:

- make sizing more aggressive
- introduce hidden tuning via runtime logic

---

## Config Safety

- config must be explicit and validated
- no hidden defaults that change behavior silently
- no fallback behavior that makes the system more permissive

---

## Observability Safety

- telemetry must not act as a guardrail
- UI must not affect trading decisions
- logs must reflect real behavior, not hide it

---

## P0 Change Rules

Before changing runtime:

1. What failure are we preventing?
2. What signal shows this failure to the operator?
3. What test proves this boundary holds?

If one of these is missing → stop

---

## Hard Rules

- do not mix runtime changes with strategy changes
- do not mix UI fixes with execution/risk logic
- do not introduce hidden behavior through refactors
- do not make the system “smarter” at the cost of clarity
- when unsure → stop and ask