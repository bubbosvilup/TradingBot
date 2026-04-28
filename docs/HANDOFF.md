# TradingBot Handoff

## Current State

TradingBot is in v18.3: Type Truth, ownership, structural integrity, contract tests, and documentation consolidation / humanization.

v18.3 is not a feature phase and not a broad refactor phase. It exists to make the current paper runtime easier to understand, safer to change, and more verifiable.

Current runtime assumptions:

- runtime is paper-only
- Pulse-only is the active operator UI posture
- Pulse must stay separate from trading decisions
- legacy replay is not modern runtime parity
- backtest parity remains incomplete
- short paper runtime support exists
- margin/futures realism is incomplete
- experiments remain quarantined unless explicitly promoted

## Current Priority Shift

The active priority is documentation consolidation / humanization before deeper technical P0 patches.

The repo previously carried overlapping AI docs, rules, playbooks, handoffs, priorities, and skill files. That second documentation codebase is being collapsed into:

- `AGENT.md`
- `docs/ARCHITECTURE.md`
- `docs/HANDOFF.md`

Do not recreate active AI guidance trees, playbooks, skill instructions, rules folders, or parallel handoff structures without explicit user approval.

## Technical P0s

### P0.1 State Ownership

Problem: important runtime state can still be written through APIs that do not strongly enforce ownership.

Target: make ownership explicit for bot state, positions, orders, closed trades, and performance.

Required work:

- prevent cross-bot mismatch between method `botId` and entity `botId`
- restrict `updateBotState(...)` so owner fields cannot be patched casually
- clarify whether each mutator derives ownership from the entity or validates it against the provided `botId`
- add contract tests for rejected ownership mismatch

Do not:

- rely on discipline
- hide this with casts
- create a second state path

### P0.2 Type-Blind Runtime Imports / CommonJS Erosion

Problem: critical runtime files still use `require(...)` / CommonJS patterns that weaken Type Truth. This can hide implicit `any`, config drift, false module contracts, missing return types, runtime boundary mistakes, and startup/runtime behavior the compiler cannot verify.

Target: stop type erosion in the main runtime path without starting a rushed ESM migration.

First files to address:

- `src/core/orchestrator.ts`
- `src/bots/tradingBot.ts`
- `src/core/configLoader.ts`
- `src/core/systemServer.ts`
- `src/core/stateStore.ts`
- `src/streams/marketStream.ts`
- `src/streams/userStream.ts`
- `src/engines/executionEngine.ts`

Required work:

- audit raw and weakly typed `require(...)`
- replace raw untyped `require(...)` where safe
- where CommonJS must remain temporarily, add narrow truthful module contracts
- give `loadJson()` and config loaders truthful return types
- protect startup/runtime behavior with tests before broad module rewrites

Temporary allowance:

- `tsconfig.json` may use `"ignoreDeprecations": "6.0"` only to silence the TypeScript 6 `moduleResolution=node10` deprecation warning while v18.3 hardening is in progress

Do not:

- treat `ignoreDeprecations` as a fix
- start a full ESM/moduleResolution migration as the first move
- replace raw `require(...)` with `as any`
- use `unknown as SomeModule`
- use broad module casts
- perform broad import rewrites without startup/runtime tests

`strict:true` is the destination, not the first patch. Strict mode comes after truth boundaries are fixed, contract tests exist, and main runtime type-blind imports are reduced or contained.

### P0.3 False Public Contracts

Problem: some interfaces mark capabilities as optional even though runtime code treats them as required.

Target: make public contracts honest.

Known areas:

- logger capabilities
- SSE response/write capability
- registered bot state/performance getters
- config fields used by orchestrator

Required work:

- make required runtime capabilities required in types
- add required getters only where registration guarantees the value exists
- split generic HTTP response types from SSE response types if needed
- define shared config types used by loader and runtime

Do not:

- sprinkle `?.`
- add `!`
- cast nullable values to silence TypeScript

## Execution Order

Current execution order:

1. documentation consolidation / humanization
2. require/import cleanup
3. StateStore split
4. test migration
5. technical P0 enforcement: ownership, type truth, false contracts

The next technical work should be small, proven, and behavior-preserving.

## Current Experiment Status

`allow_small_loss_floor05` remains quarantine material.

It must not:

- become default behavior
- be mixed into baseline telemetry
- be renamed to look safe
- influence baseline risk controls silently

Any experiment must remain visible, reversible, separately reported, and removable.

## Paper-Only Safety Invariants

- active execution is paper-only
- live execution mode must fail explicitly
- manual operator endpoints must not become generic risk bypasses
- `StateStore` remains the runtime source of truth
- paused + flat blocks entry
- paused + open position may still close safely
- protective exits must not be weakened
- managed recovery precedence remains protective stop, timeout, confirmed target, invalidation
- volatility sizing may reduce or preserve size, never increase it
- UI, Pulse, telemetry, launcher, debug capture, and reporting must not influence trading decisions

## Run And Test Notes

Install:

```bash
npm install
```

Run:

```bash
npm start
```

Short smoke run:

```bash
npm start -- --duration-ms=5000 --summary-ms=1000
```

Pulse:

```text
http://127.0.0.1:3000/
```

Full test suite:

```bash
npm test
```

TypeScript check:

```bash
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
```

Run both checks before accepting code patches. Documentation-only patches do not require runtime tests unless executable files or generated artifacts change.

## Operator Notes

Common operator/API surfaces include:

- `GET /api/system`
- `GET /api/bots`
- `GET /api/pulse`
- `GET /api/pulse/stream`
- `GET /api/prices`
- `GET /api/positions`
- `GET /api/events`
- `GET /api/trades`
- `POST /api/bots/:botId/resume`
- `POST /api/bots/:botId/reset-post-loss-latch`
- `POST /api/kill-switch/reset`

Manual recovery endpoints are narrow operator tools. They must not bypass risk controls.

Manual post-loss latch reset is only for a bot blocked by:

```text
post_loss_latch_timeout_requires_operator
```

Manual resume remains intentionally limited to drawdown pause recovery and must not bypass portfolio kill-switch behavior.

## Next Patch Order

After this documentation consolidation:

1. audit `require(...)` and weak import surfaces in runtime-critical files
2. convert safe runtime imports to truthful imports or narrow module contracts
3. split or clarify `StateStore` ownership boundaries without introducing a second state path
4. migrate or add contract tests around ownership and runtime boundaries
5. enforce P0 ownership, type truth, and false contract fixes in small patches

## Do Not Do Now

Do not:

- start v19 replay work
- start v20 margin/futures realism
- start v21 optimization
- re-open live execution
- perform broad runtime rewrites
- migrate everything to ESM as a first move
- enable global `strict:true` by brute force
- segment `TradingBot` before boundaries and contract tests
- add new internal frameworks
- add coordinators where a function is enough
- change trading behavior silently
- perform cosmetic refactors while touching trading logic
- hide type problems with `any`, `as any`, broad casts, or `!`
- recreate active AI guidance folders, skill files, playbooks, or extra handoffs
