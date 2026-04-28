# Patch Flow

Use this before coding any refactor, bug fix, safety fix, or observability change.

Goal:
Every patch must be small, understandable, safe, and verifiable.

A patch must improve the repo without making it more abstract, more magical, or harder to review.

---

## Steps

1. State the patch goal in one sentence.

   Example:
   - "Prevent cross-bot state ownership mismatch in StateStore."
   - "Make config loading reject invalid runtime values at startup."

2. Mark priority:

   - P0: safety, state correctness, trading correctness, live/paper boundary
   - P1: strict typing, config correctness, error visibility, runtime boundary cleanup
   - P2: maintainability, test coverage, observability quality
   - P3: cleanup with no behavior risk

3. List touched files.

   If the list grows too much, stop and split the patch.

4. Classify the patch:

   - behavior-preserving refactor
   - bug fix
   - risk control
   - type-safety fix
   - config/startup safety fix
   - UI/dashboard-only
   - API/observability-only
   - test-only

5. List invariants that must not change.

   Include:
   - entry behavior
   - exit behavior
   - recovery behavior
   - risk gates
   - position/order state transitions
   - telemetry fields
   - config defaults
   - paper/live safety behavior

6. State whether trading behavior changes.

   Must be one of:

   - no trading behavior change
   - intentional trading behavior change
   - unknown → stop and ask

7. If `TradingBot` is touched, justify it.

   Explain why the change cannot live in:
   - an existing role
   - a domain helper
   - a stream boundary
   - config validation
   - tests only

   Do not move coordinator logic back into `TradingBot`.

8. If state is touched, name the owner.

   State:
   - who owns the state
   - who is allowed to write it
   - which writes are forbidden
   - which invariant/test proves it

9. If config or runtime mode is touched, state startup/safety impact.

   Include:
   - default behavior
   - failure behavior
   - paper/live effect
   - whether invalid config blocks startup

10. If logging, telemetry, or debug output is touched, state contract impact.

   Include:
   - fields unchanged
   - fields added
   - fields renamed
   - fields removed
   - whether jsonl/debug-capture contracts change
   - whether high-cardinality spam is avoided

11. Define tests before editing.

   Tests must prove:
   - the intended fix works
   - protected behavior did not drift
   - risky paths fail safely

12. Check against TradingBot doctrine.

   The patch must:
   - make the repo easier to understand
   - preserve behavior unless explicitly changed
   - keep one responsibility per part
   - validate external data before trusting it
   - keep important errors visible
   - keep TypeScript types truthful
   - avoid `any`, broad casts, and non-null assertion fixes
   - avoid new frameworks, coordinators, or wrappers unless strictly necessary

---

## Patch Acceptance Gate

Reject the patch if it:

- adds strategy-name branching to `TradingBot`
- moves extracted coordinator logic back into `TradingBot`
- makes unsupported live behavior easier to enter
- normalizes experiment logic without quarantine
- couples dashboard/UI changes to execution/risk behavior without explicit reason
- lets Pulse UI influence trading decisions
- lets launcher/debug-capture policy influence trading decisions
- hides or swallows important errors
- mutates important state from a non-owner
- changes trading behavior silently
- uses `any`, `as any`, broad casts, or `!` to bypass TypeScript
- fixes typing by lying to the compiler
- adds abstraction where a simple function is enough
- duplicates high-cardinality log/state data where a rolling snapshot is enough
- restores single early `family_mismatch` managed-recovery invalidation
- bypasses pending Architect challenger hysteresis
- introduces vague names, generic headers, inline magic numbers, or capability-string tests instead of behavior tests

---

## Required Patch Output

Before coding, write:

- Goal
- Priority
- Patch type
- Files touched
- Invariants protected
- Trading behavior impact
- State ownership impact, if any
- Config/runtime impact, if any
- Telemetry/logging impact, if any
- Tests to run
- Acceptance gate result

After coding, write:

- Files changed
- Behavior changed, if any
- Tests run
- Result
- Remaining risk