# Testing Rules

Goal:
Tests must prove behavior.
Tests must prevent silent trading changes.

---

## Minimum Checks

Before any patch:

- `npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false`
- `npm test`

If either fails → stop

---

## Core Rules

Tests must prove:

- state changes
- decisions (enter / exit / hold)
- risk gating
- execution outcomes
- observable telemetry

Do not:

- trust internal flags or capability strings
- test implementation details instead of behavior
- accept tests that pass while behavior changed

---

## Required Test Mindset

Every patch must answer:

- What behavior is being fixed or protected?
- What must stay identical?
- What would break if this regresses?

If this is unclear → stop

---

## When Tests Are Required

Add or update tests when touching:

- entry logic
- exit logic
- recovery behavior
- risk/sizing/cooldown
- state ownership or mutation
- runtime/bootstrap behavior
- config validation
- stream ingestion or freshness
- telemetry that operators rely on

---

## Boundary Testing

If a wrapper or adapter exists:

- test the boundary it protects
- test invalid input handling
- test fallback behavior

Do not test the wrapper itself if it adds no behavior.

---

## Behavior-Critical Areas

These must always be covered:

- managed recovery transitions and precedence
- entry gating and open attempt outcomes
- Architect publish/apply timing
- Architect challenger hysteresis blocking
- post-loss latch behavior
- target-distance gating and RSI edge behavior
- capture-gap cap baseline vs override
- volatility sizing (must not increase size)
- cooldown behavior (must not weaken post-loss protection)
- MTF influence vs baseline fallback
- startup behavior (success / degraded / fail-fast)
- stream fallback and teardown correctness
- exit classification and lifecycle reporting
- API/telemetry fields consumed by UI

---

## Mapping Changes → Tests

- Trading logic → `tests/tradingBot.test.js` + related role tests
- State changes → `tests/stateStore.test.js`
- Risk logic → `tests/riskManager.test.js`
- Entry/exit coordination → dedicated coordinator tests
- Runtime/bootstrap → `tests/orchestrator.test.js`
- Streams → `tests/marketStream.test.js`
- API/UI → `tests/systemServer.test.js`

If unsure → add a focused test near the changed module

---

## Do Not

- rely on manual UI testing
- remove assertions to make tests pass
- ignore failing tests during refactor
- treat tests as optional or secondary
- change behavior without updating tests
- keep tests that no longer reflect real behavior

---

## Hard Rule

If a patch changes behavior:

- tests must change with it
- the change must be explicit

If tests do not change:

- behavior must not change