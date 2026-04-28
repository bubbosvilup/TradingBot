# Current Priorities

Goal:
Keep the repo understandable, safe, and verifiable.

Work top-down unless a task explicitly says otherwise.

This file describes current priorities only.
Historical completed work belongs in `docs/archive_NOUSE`.

---

## P0 — Safety and Doctrine

Current P0 work is documentation and control alignment.

Before more technical refactor work:

1. update repo doctrine docs;
2. update AI / agent instruction files;
3. update README;
4. remove or archive stale operational documentation;
5. define the next technical patch sequence only after docs agree.

No code agent should start broad refactors before this is done.

---

## P1 — v18.3 Type Truth and Structural Integrity

v18.3 focus:

1. make the repo easier to understand;
2. restore truthful TypeScript types;
3. clarify state ownership;
4. clarify runtime boundaries;
5. reduce `any`, `as any`, broad casts, and non-null assertion fixes;
6. make config/runtime validation more explicit;
7. preserve trading behavior unless a change is explicitly approved.

The repo must become simpler and safer, not cleverer.

---

## P1 Technical Priorities

After documentation is aligned, the first technical priorities are:

1. State ownership
   - clarify who can mutate position/order/trade state
   - reduce `ExecutionEngine` / `UserStream` double ownership
   - prevent cross-bot state mismatch
   - add open/close/state ownership contract tests

2. Type truth
   - measure current `any` / `as any` / non-null assertion usage
   - replace unsafe boundary types with `unknown` + narrowing
   - avoid broad casts
   - do not enable global `strict:true` by brute force

3. Runtime boundaries
   - identify raw external payloads
   - validate or narrow them before runtime logic trusts them
   - keep UI/debug/reporting outside trading decisions

4. Config safety
   - make defaults explicit
   - reject invalid dangerous config
   - keep paper-only runtime constraints obvious

5. Error visibility
   - stop swallowing important runtime errors
   - normalize unknown caught errors safely
   - distinguish real failure from empty/zero telemetry

6. Contract tests
   - protect entry, exit, recovery, risk, state ownership, config, and telemetry behavior
   - tests must prove behavior, not capability strings

---

## P2 — Architecture Cleanup

Only after P1 boundaries are clear:

1. dependency graph cleanup
2. circular import reduction
3. layer-boundary enforcement in warning mode first
4. small focused extraction from `TradingBot` only when contract tests exist
5. flow documentation for entry, exit, recovery, kill-switch, latch, and state ownership

Do not segment `TradingBot` before contracts and boundaries are clear.

---

## P3 — Deferred Work

These are not current v18.3 work:

### v19 — Modern Backtest Parity

Build modern replay only after v18.3 structural work is stable.

Required later:
- serious data layer
- dataset quality checks
- event-driven replay through modern runtime components
- deterministic replay clock
- no lookahead
- explicit warm-up
- execution realism
- strategic reporting
- anti-lookahead tests
- legacy deprecation path

Do not claim profitability from legacy replay.

### v20 — Margin / Futures / Short Realism

Deferred.

Current short support is paper-runtime support.
It is not full futures or margin realism.

Required later:
- isolated margin model
- leverage
- liquidation
- mark price
- funding
- portfolio exposure limits

### v21 — Strategy Lab / Optimization

Deferred.

Do not optimize strategies until modern replay is trustworthy.

Required later:
- walk-forward analysis
- parameter sweeps
- out-of-sample validation
- Monte Carlo
- benchmarks
- robustness-focused comparison

---

## Active Runtime Assumptions

- runtime is paper-only
- Pulse is the only active operator UI
- Pulse must stay separate from trading decisions
- legacy replay is not modern runtime parity
- backtest parity remains incomplete
- short paper runtime support exists
- margin/futures realism is incomplete
- experiments remain quarantined unless explicitly promoted

---

## Current Experiment Status

`allow_small_loss_floor05` remains quarantine material.

It must not:
- become default behavior
- be mixed into baseline telemetry
- be renamed to look safe
- influence baseline risk controls silently

---

## Do Not Do Now

Do not:

- start v19 replay work
- start v20 margin/futures realism
- start v21 optimization
- re-open live execution
- perform broad runtime rewrites
- migrate everything to ESM as a first move
- segment `TradingBot` before boundaries and contract tests
- add new internal frameworks
- add coordinators where a function is enough
- change trading behavior silently
- perform cosmetic refactors while touching trading logic
- hide type problems with `any`, `as any`, broad casts, or `!`

---

## Priority Notes

P0 safety and doctrine outrank convenience refactors.

P1 Type Truth and ownership work outrank architecture elegance.

P2 cleanup must be behavior-preserving.

P3 future systems must not be pulled into v18.3.

When uncertain, stop and ask.