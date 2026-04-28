# Architecture Rules

`AGENT.md` is the main constitutional file.

This document extends it for TradingBot architecture.
It does not replace it.

Goal:
Keep the repo understandable, safe, and verifiable.

Architecture must make ownership clear.
It must not make the repo more abstract

---

## Core Doctrine

The bot has five jobs:

1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

Every module must support one of those jobs clearly.

Every important state must have one owner.

Every external input must be validated before trusted.

Every TypeScript type must tell the truth.

Every behavior change must be explicit.

---

## Patch Handoff Rule

`docs/ai/current-handoff.md` records the current patch/application state.

It must be updated after each patch prompt with:

- date
- patch goal
- files changed
- what was done
- behavior changed, if any
- tests run
- remaining risks or next step

The handoff is operational state.
It is not architecture doctrine.

If the handoff conflicts with `AGENT.md`, `AGENT.md` wins.
If the handoff conflicts with code, stop and report the mismatch.

## Expected Ownership

- `src/core/`
  - bootstrap
  - lifecycle
  - composition
  - runtime store
  - system/API surfaces

- `src/bots/`
  - orchestration
  - sequencing
  - connecting already-owned decisions
  - no hidden policy ownership

- `src/roles/`
  - focused trading policies
  - planning
  - gating
  - shaping
  - coordination logic

- `src/domain/`
  - pure domain rules
  - state transitions
  - selectors
  - invariants

- `src/streams/`
  - external stream boundaries
  - ingestion
  - payload narrowing
  - freshness state

- `public/`
  - browser UI only
  - Pulse presentation only
  - no trading decisions

- `tests/`
  - behavior locks
  - boundary contracts
  - regression proof

---

## TradingBot Rule

Keep `TradingBot` orchestration-focused.

`TradingBot` may sequence work.

`TradingBot` must not become the owner of:

- strategy-specific policy
- Architect interpretation
- latch policy
- entry policy
- exit policy
- managed-recovery policy
- sizing policy
- cooldown policy
- telemetry shaping
- UI shaping
- debug-capture policy

If logic can live in an existing role, it should not be added to `TradingBot`.

If touching `TradingBot`, state why the change cannot live elsewhere.

---

## Forbidden Regressions

Do not:

- reintroduce strategy-name branching into `TradingBot`
- move extracted coordinator logic back into `TradingBot`
- move Architect interpretation or published-family logic back into `TradingBot`
- move latch state handling back into `TradingBot`
- move telemetry payload shaping back into `TradingBot`
- move sizing or cooldown policy into `TradingBot`
- collapse UI/dashboard concerns into runtime decision modules
- let Pulse UI influence trading decisions
- let launcher/debug-capture concerns influence trading decisions
- put managed-recovery invalidation confirmation policy into strategy modules
- put short-horizon target-distance gating into individual signal formulas
- put MTF interpretation or strategy-specific MTF branching into `TradingBot`
- use strategy ids or symbol names as hidden switches in shared economics code
- hide legacy behavior behind cleaner names
- create wrappers, adapters, or capability objects unless they protect a real boundary or add testable behavior

---

## Current Ownership Notes

- `architectCoordinator`
  - owns published Architect usability
  - owns entry blocking during pending challenger hysteresis

- `MtfContextService`
  - owns optional MTF frame snapshot construction behind `mtf.enabled`

- `mtfContextAggregator`
  - owns MTF aggregation
  - owns dominant internal horizon-frame diagnostics

- MTF frame config / aggregation plumbing
  - owns raw timeframe to internal horizon-frame mapping

- `mtfParamResolver`
  - owns pure MTF-driven RSI entry hint/cap resolution
  - consumes only internal horizon frame ids
  - must not interpret raw labels like `1m`, `5m`, `15m`, or `1h`

- `entryEconomicsEstimator`
  - owns fee-aware edge estimates
  - owns strategy economics policy interpretation
  - owns capture-gap cap resolution
  - owns resolved cap computation
  - owns target-distance diagnostics

- `entryCoordinator`
  - owns final entry gates
  - owns `target_distance_exceeds_short_horizon`

- `RiskManager`
  - owns position sizing
  - owns risk gates
  - owns drawdown/loss gating
  - owns loss cooldowns
  - owns post-win cooldown nuance
  - owns trade constraint baselines

- `exitDecisionCoordinator`
  - owns managed-recovery invalidation confirmation/grace policy

- `managedRecoveryExitResolver`
  - owns managed-recovery exit precedence

- `SystemServer` and `public/`
  - own Pulse/API presentation only

---

## Refactor Rules

Before moving logic:

1. name the responsibility being moved;
2. name the current owner;
3. name the correct destination;
4. state what must remain stable:
   - trading behavior
   - lifecycle semantics
   - thresholds
   - timing
   - events
   - log fields
   - API fields

Prefer incremental extraction over redesign.

Prefer deletion and simplification over new machinery.

Do not add abstraction to prepare for hypothetical future work.

---

## Code Rules

Use precise verbs.

Prefer:

- `parse`
- `coerce`
- `sanitize`
- `clamp`
- `enforce`
- `ingest`
- `mark`
- `expire`

Avoid vague names when a precise verb fits:

- `normalize`
- `process`
- `handle`
- `manage`
- `coordinate`

Rules:

- no generic file headers
- no inline magic numbers
- no hidden state mutation in `get*` or `read*`
- no `any`, `as any`, broad casts, or non-null assertions to silence TypeScript
- no cosmetic refactors while touching trading logic
- no behavior change unless explicitly stated
- comments should explain why an invariant or boundary exists, not restate the file name
- tests must prove behavior, not self-reported capability strings

---

## When Touching TradingBot

Before editing, answer:

1. What exact behavior needs to change?
2. Can this live in an existing role?
3. Can this be solved by a pure domain helper?
4. Can this be solved by config validation?
5. Can this be solved by a test instead?
6. What invariant proves this did not change trading behavior silently?

If the answer is unclear, stop and ask.

Keep method count and branch count moving down, not up.