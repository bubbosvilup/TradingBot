# AGENT.md

## Purpose

This repository must stay understandable, safe, and verifiable.

The bot has five jobs:

1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

Every change must support those jobs without making the repo more abstract, more magical, or harder to review.

---

## Core Doctrine

Preserve behavior unless the task explicitly asks for a semantic change.

Truth matters more than elegance:

- TypeScript types must describe real runtime behavior.
- State must have clear ownership.
- External data must be checked before trusted logic uses it.
- Important errors must be visible.
- Config must be explicit and validated.
- Tests must prove behavior, not implementation decoration.

Do not use `any`, `as any`, broad casts, or non-null assertions to bypass the compiler.

When unsure, stop and ask.

---

## Architecture Spirit

The core architecture is:

- Context informs.
- Architect decides regime / family / usability.
- TradingBot orchestrates within that perimeter.
- Focused roles own focused operational flows.
- Execution happens only through risk-gated execution paths.
- StateStore is the runtime source of truth.

`TradingBot` should orchestrate.

`TradingBot` must not become the owner of every policy, exception, or side concern.

---

## Keep Out of TradingBot

Do not move these back into `TradingBot` unless explicitly requested:

- strategy-specific formulas
- Architect interpretation
- latch policy
- entry policy
- exit policy
- managed-recovery policy
- sizing policy
- cooldown policy
- telemetry payload shaping
- UI shaping
- startup history preload
- launcher/debug-capture policy
- MTF interpretation or raw timeframe mapping

If logic can live in an existing role, domain helper, config validator, stream boundary, or test, do not add it to `TradingBot`.

---

## Non-Negotiable Rules

Do not:

- reintroduce strategy-name branching into shared runtime logic
- use symbol names as hidden switches
- move extracted coordinator logic back into `TradingBot`
- let UI, Pulse, launcher, debug capture, or reporting influence trading decisions
- enable or make live execution easier to enter
- promote experiments into baseline behavior without explicit approval
- hide legacy behavior behind cleaner names
- create internal frameworks where small functions are enough
- add coordinators where a focused function would do
- perform cosmetic refactors while touching trading logic
- silently change thresholds, timing, lifecycle semantics, risk behavior, or telemetry contracts
- mutate important state from read-like `get*` or `read*` methods

---

## State and Runtime Rules

`StateStore` is the runtime truth source.

Important state must have one owner:

- bot lifecycle state
- positions
- orders
- closed trades
- performance
- market freshness
- risk-relevant runtime state

State writes must not allow cross-bot ownership mismatch.

Runtime must remain paper-only unless explicitly changed by a dedicated safety-reviewed task.

Paused state must remain coherent:

- paused bots must not open new positions;
- open positions may still close safely;
- paused state must have a real pause reason.

---

## Risk Rules

Risk behavior must not become more permissive by accident.

Do not silently:

- allow more entries
- delay or suppress exits
- weaken recovery, invalidation, protective exits, cooldowns, latches, or kill-switch behavior
- make sizing more aggressive
- alter fee assumptions, thresholds, hold times, or publish cadence

A telemetry warning is not a guardrail.

Real safety controls must live in runtime/risk logic, not in UI labels or logs.

---

## Code Rules

Prefer small explicit code over broad abstraction.

Use precise verbs when they fit:

- `parse`
- `coerce`
- `sanitize`
- `clamp`
- `enforce`
- `ingest`
- `mark`
- `expire`

Avoid vague names when a narrower verb is true:

- `normalize`
- `process`
- `handle`
- `manage`
- `coordinate`

Rules:

- no generic file headers like `// Module responsibility:`
- comments should explain why an invariant or boundary exists
- extract magic numbers into named constants at the smallest useful scope
- do not create wrappers, adapters, or capability objects unless they protect a real boundary or add testable behavior
- do not hide type problems with casts
- do not hide runtime behavior behind nicer names

---

## Test Rules

Tests must prove behavior through:

- state
- decisions
- return values
- events
- logs
- API payloads

Do not rely on self-reported capability strings as proof.

Any non-trivial extraction, boundary change, state mutation change, risk change, config change, or runtime behavior change must have tests.

Minimum checks for code patches:

```text
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
npm test