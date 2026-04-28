# AGENT.md

## Purpose

This is the active agent constitution for TradingBot.

The repo must stay understandable, safe, and verifiable. The bot has five jobs:

1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

Every change must support those jobs without making the repo more abstract, more magical, or harder to review.

Do not create new active AI guidance files, rules folders, playbooks, skill docs, handoff files, or parallel agent instructions without explicit user approval.

## Doctrine

Preserve behavior unless the task explicitly asks for a semantic change.

Truth matters more than elegance:

- TypeScript types must describe real runtime behavior.
- State must have clear ownership.
- External data must be checked before trusted logic uses it.
- Important errors must be visible.
- Config must be explicit and validated.
- Tests must prove behavior, not implementation decoration.

Do not use `any`, `as any`, broad casts, `unknown as SomeType`, or non-null assertions to bypass the compiler.

When unsure, stop and ask.

## Architecture Rules

The core runtime shape is:

- Context informs.
- Architect decides regime, family, and usability.
- `TradingBot` orchestrates within that perimeter.
- Focused roles own focused operational flows.
- Execution happens only through risk-gated execution paths.
- `StateStore` is the runtime source of truth.

Keep out of `TradingBot` unless explicitly requested:

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

## Runtime And Risk Rules

The active runtime is paper-only. Live execution must not become easier to enter.

`StateStore` owns authoritative runtime state for bot lifecycle, positions, orders, closed trades, performance, market freshness, and risk-relevant runtime state. State writes must not allow cross-bot ownership mismatch.

Paused state must remain coherent:

- paused bots must not open new positions;
- open positions may still close safely;
- paused state must have a real pause reason.

Risk behavior must not become more permissive by accident. Do not silently:

- allow more entries
- delay or suppress exits
- weaken recovery, invalidation, protective exits, cooldowns, latches, or kill-switch behavior
- make sizing more aggressive
- alter fee assumptions, thresholds, hold times, or publish cadence

Telemetry warnings are not guardrails. Real safety controls must live in runtime/risk logic, not UI labels or logs.

Experiments remain quarantined unless explicitly promoted. `allow_small_loss_floor05` is not baseline behavior.

## Code Rules

Prefer small explicit code over broad abstraction.

Use precise verbs when they fit: `parse`, `coerce`, `sanitize`, `clamp`, `enforce`, `ingest`, `mark`, `expire`.

Avoid vague names when a narrower verb is true: `normalize`, `process`, `handle`, `manage`, `coordinate`.

Rules:

- no generic file headers like `// Module responsibility:`
- comments should explain why an invariant or boundary exists
- extract magic numbers into named constants at the smallest useful scope
- do not create wrappers, adapters, or capability objects unless they protect a real boundary or add testable behavior
- do not hide type problems with casts
- do not hide runtime behavior behind nicer names

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
```

Documentation-only patches do not require the runtime test suite unless they change executable files or generated artifacts.

## Minimal Workflow

Before a code patch, state:

- goal
- priority: P0 / P1 / P2 / P3
- patch type
- touched files
- invariants protected
- trading behavior impact
- state ownership impact, if any
- config/runtime impact, if any
- telemetry/API impact, if any
- tests to run

For audits, report proven findings only. Include the files/functions involved, why the issue is proven, the behavior or boundary at risk, the owner of the violated responsibility, the smallest behavior-preserving patch, required tests, and what not to change.

For validation, confirm whether the patch changed entry, exit, recovery, risk, sizing, cooldown, execution, config defaults, startup behavior, telemetry/API/log contracts, `TradingBot`, `StateStore`, runtime boundaries, experiment logic, type truth, wrappers/coordinators, or tests.

## Stop Conditions

Stop and ask if:

- docs and code disagree in a way that affects the patch
- ownership is unclear
- trading behavior impact is unknown
- a fix would require broad casts or type lies
- the patch risks changing entry, exit, recovery, risk, or execution behavior silently
- the change would touch too many unrelated files
- a requested documentation change would create competing active guidance
