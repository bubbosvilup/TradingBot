---
name: audit
description: Repo-specific audit skill for TradingBot. Finds proven architecture, safety, type-truth, ownership, and runtime-boundary issues without inventing redesigns.
---

# Audit Skill

Purpose:
Perform repo-specific audits without inventing problems, architecture, or future work.

An audit must help keep the repo understandable, safe, and verifiable.

## Required Reading

Before auditing, read:

1. `AGENT.md`
2. `docs/ai/project-map.md`
3. `docs/ai/priorities.md`
4. `docs/ai/playbooks/audit-flow.md`
5. relevant files in `docs/ai/rules/`

If these documents conflict, `AGENT.md` wins.

If docs and code conflict, report the mismatch.

---

## Audit Goal

Find proven problems.

Do not:

- invent issues;
- speculate as fact;
- propose broad redesigns;
- create a second architecture;
- recommend abstractions before proving a boundary;
- turn future roadmap ideas into current work.

---

## Mandatory Checks

Every audit must check for:

- strategy-name branching added back to `TradingBot`
- extracted coordinator logic moved back into `TradingBot`
- policy logic leaking into `TradingBot`
- unsafe runtime/live-path drift
- experiment leakage into baseline behavior
- UI/debug/reporting concerns leaking into trading decisions
- state mutation from non-owner paths
- hidden behavior changes in refactors
- `any`, `as any`, broad casts, or `!` used to bypass TypeScript
- swallowed errors or fake-success behavior
- tests that prove only capability strings instead of behavior

---

## Output Format

Audit output must include:

- Verdict:
  - OK
  - FIX BEFORE CONTINUING
  - BLOCKED

- Findings ordered by severity:
  - P0
  - P1
  - P2
  - P3

For each finding include:

- exact files and functions involved
- why the finding is proven by code
- behavior or boundary at risk
- owner of the violated responsibility
- minimal behavior-preserving patch recommendation
- required tests
- what not to change

---

## Severity Guide

P0:
State correctness, trading safety, runtime mode safety, ownership corruption, live-path drift, or silent trading behavior change.

P1:
Type truth, config contract, error visibility, runtime boundary, or behavior lock issue that can hide real failures.

P2:
Maintainability, local abstraction debt, test gaps, logging/telemetry clarity, or boundary cleanup.

P3:
Small cleanup, naming, docs, or low-risk hygiene.

---

## Patch Recommendation Rules

When recommending patches:

- preserve runtime behavior unless the task explicitly requests a semantic change
- prefer small patches
- prefer deletion/simplification over new machinery
- do not add internal frameworks
- do not add coordinators where a function is enough
- do not recommend cosmetic refactors while touching trading logic
- do not fix TypeScript by lying to TypeScript

Tests must prove behavior through:

- state
- decisions
- return values
- logs
- events
- API payloads

Do not treat self-reported capability strings as sufficient proof.

---

## Hard Stop Conditions

Stop and ask if:

- the code contradicts the documentation;
- ownership is unclear;
- trading behavior impact is unknown;
- a patch would need broad casts;
- the audit cannot prove the finding from code;
- the proposed fix risks changing entry, exit, recovery, risk, or execution behavior silently.