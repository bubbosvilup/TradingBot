---
name: patch
description: Repo-specific patch skill for TradingBot. Plans and executes small, behavior-preserving patches with explicit ownership, safety, and test gates.
---

# Patch Skill

Purpose:
Plan and execute small safe patches in the active TradingBot refactor.

A patch must keep the repo understandable, safe, and verifiable.

---

## Required Reading

Before planning or editing, read:

1. `AGENT.md`
2. `docs/ai/project-map.md`
3. `docs/ai/priorities.md`
4. `docs/ai/playbooks/patch-flow.md`
5. relevant files in `docs/ai/rules/`

If these documents conflict, `AGENT.md` wins.

If docs and code conflict, stop and report the mismatch.

---

## Patch Goal

Every patch must be:

- small
- reviewable
- behavior-preserving unless explicitly requested otherwise
- covered by tests appropriate to the touched area

Do not use a patch to smuggle in architecture changes.

---

## Mandatory Checks

Before editing, state:

- patch goal
- priority: P0 / P1 / P2 / P3
- touched files
- invariants that must not change
- whether trading behavior changes
- state ownership impact, if any
- config/runtime impact, if any
- telemetry/API impact, if any
- tests to run

---

## Patch Gates

A patch must:

- keep `TradingBot` orchestration-focused
- preserve paper-only execution safety
- preserve `StateStore` as runtime source of truth
- preserve current entry/exit/risk behavior unless explicitly changed
- quarantine experiment behavior unless explicitly promoted
- keep UI/debug/reporting concerns out of trading decisions
- avoid state mutation from non-owner paths
- run the required test set for the touched area

---

## Type Safety Rules

Do not:

- use `any` to finish faster
- use `as any`
- use broad casts
- use non-null assertions to bypass real nullability
- hide config or external payload uncertainty behind casts

Use:

- concrete small interfaces for known internal shapes
- `unknown` plus narrowing for external/raw boundary data
- explicit validation where behavior depends on the value

---

## Code Rules

Apply the human-readable coding rules in `AGENT.md`.

Especially:

- no generic file headers
- precise function names
- named constants for magic numbers
- read-only `get*` / `read*` methods
- small explicit code
- no needless wrappers
- no new coordinators where a function is enough
- no cosmetic refactors while touching trading logic
- tests must prove behavior, not capability strings

---

## Hard Stop Conditions

Stop and ask if:

- ownership is unclear
- trading behavior impact is unknown
- the patch would require broad casts
- docs and code disagree
- the fix would touch too many unrelated files
- the patch risks changing entry, exit, recovery, risk, or execution behavior silently

---

## Required Output

Before coding:

- Goal
- Priority
- Patch type
- Files touched
- Invariants protected
- Trading behavior impact
- State ownership impact
- Config/runtime impact
- Telemetry/API impact
- Tests to run

After coding:

- Files changed
- Behavior changed, if any
- Tests run
- Result
- Remaining risk