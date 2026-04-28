---
name: validation
description: Repo-specific validation skill for TradingBot. Verifies that patches preserve behavior, ownership, runtime safety, type truth, and documentation contracts.
---

# Validation Skill

Purpose:
Validate that a patch did not create architectural, runtime, type-safety, or behavior regressions.

Validation must prove the patch stayed within the TradingBot doctrine:

- understandable
- safe
- verifiable

---

## Required Reading

Before validating, read:

1. `AGENT.md`
2. `docs/ai/project-map.md`
3. `docs/ai/priorities.md`
4. `docs/ai/rules/testing-rules.md`
5. `docs/ai/rules/risk-guardrails.md`
6. relevant rule/playbook files for the touched area

If docs conflict, `AGENT.md` wins.

If code and docs conflict, report the mismatch.

---

## Validation Goal

Confirm that the patch:

- preserved expected behavior
- did not silently change trading logic
- did not violate ownership boundaries
- did not weaken runtime safety
- did not leak experiments into baseline behavior
- did not move policy logic back into `TradingBot`
- did not hide type problems with casts
- added or updated behavior-proving tests where needed

---

## Mandatory Checks

Check whether the patch:

- changed entry, exit, recovery, risk, sizing, cooldown, or execution behavior
- changed config defaults or startup behavior
- changed telemetry/API/log field contracts
- touched `TradingBot`
- touched `StateStore`
- touched runtime boundary files
- touched experiment logic
- added `any`, `as any`, broad casts, or non-null assertions
- added wrappers, adapters, coordinators, or capability objects
- removed assertions or weakened tests

Any “yes” must be explained.

---

## Architecture Checks

Confirm:

- `TradingBot` stayed orchestration-focused
- extracted coordinator logic was not moved back into `TradingBot`
- UI/debug/reporting concerns did not leak into trading decisions
- state writes still go through the correct owner
- no hidden state mutation was added to `get*` or `read*`
- no strategy-name or symbol-name branching was added to shared runtime logic

---

## Runtime Safety Checks

Confirm:

- paper-only execution safety is preserved
- live execution was not made easier to enter
- `StateStore` remains the runtime source of truth
- paused-state semantics remain coherent
- manual operator endpoints did not become generic risk bypasses
- experiments remain quarantined unless explicitly promoted

---

## Type Truth Checks

Confirm:

- no new `any`
- no new `as any`
- no broad casts hiding uncertainty
- no non-null assertions masking real nullability
- external data is narrowed or validated before trusted use
- public contracts still match runtime behavior

---

## Test Checks

Confirm which checks were run:

```text
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
npm test