# TradingBot v18.3 — Type Truth, Ownership, and Structural Integrity

## Goal

Make the repo understandable, safe, and verifiable.

v18.3 is not a feature phase.
v18.3 is not a big refactor phase.

v18.3 exists to make the current paper runtime easier to trust and safer to change.

The bot must keep doing five clear things:

1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

---

## Core Principle

Truth before elegance.

A type must describe real runtime behavior.
A state write must have one owner.
A config value must be validated before use.
An error must be visible.
A patch must preserve behavior unless explicitly approved.

Do not make the repo more abstract.
Do not invent internal frameworks.
Do not add coordinators where a function is enough.

---

## TypeScript Module Resolution Policy

The repo currently carries legacy CommonJS / `require(...)` erosion.

This is part of the v18.3 Type Truth work.

Do not solve it with a drive-by ESM or `moduleResolution` migration.

Allowed short-term patch:

* use `"ignoreDeprecations": "6.0"` only to silence the TypeScript 6 `moduleResolution=node10` deprecation warning while v18.3 hardening is in progress

Required direction:

1. audit type-blind `require(...)` in runtime-critical files;
2. replace safe cases with truthful imports;
3. add narrow module contracts where CommonJS must remain temporarily;
4. protect startup/runtime behavior with tests;
5. decide module resolution modernization only as a dedicated patch series.

---

# P0 — Truth Boundaries

These block further refactor work.

## P0.1 — State Ownership

Problem:
Important runtime state can still be written through APIs that do not strongly enforce ownership.

Target:
Make ownership explicit for:

* bot state
* positions
* orders
* closed trades
* performance

Required work:

* prevent cross-bot mismatch between method `botId` and entity `botId`
* restrict `updateBotState(...)` so owner fields cannot be patched casually
* clarify whether each mutator derives ownership from the entity or validates it against the provided `botId`
* add contract tests for rejected ownership mismatch

Do not:

* rely on discipline
*  DO NOT hide this with casts
* DO NOT create a second state path

---

## P0.2 — Type-Blind Runtime Imports / CommonJS Erosion

Problem:
Critical runtime files still use `require(...)` / CommonJS patterns that weaken Type Truth.

This is not only a TypeScript deprecation warning.
It can hide:

* implicit `any`
* config drift
* false module contracts
* missing return types
* runtime boundary mistakes
* startup/runtime behavior that the compiler cannot verify

Target:
Stop type erosion in the main runtime path without starting a rushed ESM migration.

First files to address:

* `src/core/orchestrator.ts`
* `src/bots/tradingBot.ts`
* `src/core/configLoader.ts`
* `src/core/systemServer.ts`
* `src/core/stateStore.ts`
* `src/streams/marketStream.ts`
* `src/streams/userStream.ts`
* `src/engines/executionEngine.ts`

Required work:

* audit raw and weakly typed `require(...)`
* replace raw untyped `require(...)` where safe
* where CommonJS must remain temporarily, add narrow truthful module contracts
* give `loadJson()` and config loaders truthful return types
* protect startup/runtime behavior with tests before broad module rewrites

Temporary allowance:

* `tsconfig.json` may use `"ignoreDeprecations": "6.0"` to silence the TypeScript 6 `moduleResolution=node10` warning while v18.3 hardening is in progress

This does not solve the underlying CommonJS erosion.

Do not:

* treat `ignoreDeprecations` as a fix
* start a full ESM/moduleResolution migration as the first move
* replace raw `require(...)` with `as any`
* use `unknown as SomeModule`
* use broad module casts
* perform broad import rewrites without startup/runtime tests

---

## P0.3 — False Public Contracts

Problem:
Some interfaces mark capabilities as optional even though runtime code treats them as required.

Target:
Make public contracts honest.

Known areas:

* logger capabilities
* SSE response/write capability
* registered bot state/performance getters
* config fields used by orchestrator

Required work:

* make required runtime capabilities required in types
* add required getters only where registration guarantees the value exists
* split generic HTTP response types from SSE response types if needed
* define shared config types used by loader and runtime

Do not:

* sprinkle `?.`
* add `!`
* cast nullable values to silence TypeScript

---

# P1 — Runtime Boundary Safety

## P1.1 — Config Truth

Target:
Config used at runtime must be declared, validated, and typed in one place.

Required work:

* align JSON config, loader output, and runtime consumers
* validate important runtime slices explicitly
* preserve paper-only defaults and startup safety
* reject dangerous invalid config instead of silently accepting it

Initial config slices:

* runtime mode
* market config
* historical preload
* MTF config
* recovery/exit policy
* experiment labels
* logging/experiment metrics if still used

---

## P1.2 — External Payload Boundaries

Target:
External data must enter the core as `unknown` or narrow raw types, then be validated/narrowed before trusted logic uses it.

Focus areas:

* market stream payloads
* user stream payloads
* exchange responses
* API inputs
* config file data

Do not:

* validate everything everywhere
* introduce schema systems deep inside trading logic
* parse hot-path data expensively without need

Use schemas or guards at boundaries only.

---

## P1.3 — Error Visibility

Target:
Important runtime failures must be visible and typed enough to act on.

Required work:

* normalize caught `unknown` errors safely
* stop swallowing important stop/stream/report failures
* distinguish “no data” from “failed to collect data”
* add structured logs for real failure modes

Possible error classes/helpers:

* `ConfigError`
* `InvariantError`
* `StrategyError`
* `MarketDataError`
* `ExecutionError`
* `ExchangeError`

Do not:

* build a giant taxonomy before fixing real call sites
* hide errors as successful empty results
* turn error handling into framework code

---

# P2 — Contract Tests and Behavior Locks

Target:
Before deeper refactors, lock the behavior that must not drift.

Required contract tests:

* state ownership mismatch is rejected
* registered bot required state/performance invariants hold
* entry blocked on stale/degraded data where expected
* exit still allowed on degraded data where expected
* paused state blocks entry but allows safe close handling
* kill-switch behavior stays explicit
* strategy evaluation failure is visible and does not kill the system
* disabled exit capabilities do not fire through fallback paths
* config invalid cases fail safely

Tests must prove behavior through:

* state
* return values
* events
* logs
* API payloads

Do not test only capability strings.

---

# P3 — Targeted Type Safety

Target:
Reduce type lies in runtime boundaries without cosmetic churn.

Priority hotspots:

* `WSManager`
* `ExecutionEngine`
* `MarketStream`
* `UserStream`
* `ContextService`
* `MtfContextService`
* `StrategyRegistry`
* `ExperimentReporter`
* local `as any` / `Record<string, any>` pockets

Method:

* replace `any` with concrete small interfaces where the shape is known
* use `unknown` plus narrowing where the shape is external
* remove broad casts
* avoid non-null assertion fixes
* keep legacy/raw payload surfaces honest

Do not enable global `strict:true` by brute force.

`strict:true` is the destination, not the first patch.

Strict mode comes after the main truth boundaries are fixed, contract tests exist, and the main runtime type-blind imports are reduced or contained.

---

# P4 — Humanization and Future Refactor Preparation

Target:
Make the repo easier for a human to follow before splitting large files.

Required docs:

* `ENTRY_FLOW.md`
* `EXIT_FLOW.md`
* `STATE_OWNERSHIP.md`
* `RUNTIME_BOUNDARIES.md`

Each flow doc must describe the real current path, not the ideal architecture.

Include:

* owner
* inputs
* outputs
* guard precedence
* state mutations
* error behavior
* tests that protect it

TradingBot split is preparation-only.

Do not segment `TradingBot` until:

* ownership is clear
* boundary contracts exist
* behavior tests are green
* responsibilities have named destinations

---

# Deferred Work

These are not v18.3 work unless explicitly ordered.

## v19 — Modern Replay / Backtest Parity

Deferred.

Do not treat legacy backtest as proof of runtime parity.

## v20 — Futures / Margin / Economic Short Realism

Deferred.

Paper short support is not full margin realism.

## v21 — Strategy Lab / Optimization

Deferred.

Do not optimize strategy behavior before replay is trustworthy.

---

# Execution Order

1. Update docs and agent rules
2. Archive stale documentation into `docs/archive_NOUSE`
3. Add or confirm contract tests for the P0 areas being touched
4. Fix P0 state ownership
5. Fix P0 type-blind runtime imports/contracts
6. Fix P0/P1 config truth
7. Add missing behavior locks discovered during P0/P1 work
8. Reduce boundary `any`
9. Write flow docs from the actual runtime
10. Only then consider structural extraction from `TradingBot`

---

# Hard Rules

Do not:

* change trading behavior silently
* use `any`, `as any`, broad casts, or `!` to finish faster
* add abstractions before proving the boundary
* add coordinators where a function is enough
* perform cosmetic refactors while touching trading logic
* move policy logic back into `TradingBot`
* let UI/debug/reporting influence trading decisions
* promote experiments into baseline behavior
* start v19/v20/v21 work inside v18.3

When uncertain, stop and ask.
