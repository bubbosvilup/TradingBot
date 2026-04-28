# AI Workflow Scaffold

`AGENT.md` is the top-level constitution for this repository.

This folder contains repo-specific workflow rules for audits, patch planning, runtime safety, testing, and experiment review.

These files extend `AGENT.md`.
They do not replace it.

---

## Goal

Help coding agents work safely on TradingBot.

Every change must keep the repo:

- understandable
- safe
- verifiable

The bot should stay simple:

1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

---

## Start Here

Before planning or editing:

1. read `AGENT.md`
2. read `docs/ai/project-map.md`
3. read `docs/ai/priorities.md`
4. read the relevant file in `docs/ai/rules/`
5. follow the matching playbook in `docs/ai/playbooks/`

If the documents conflict, `AGENT.md` wins.

If the repo/code conflicts with docs, stop and report the mismatch.

---

## Default Operating Rules

- preserve behavior unless a semantic change is explicitly requested
- keep `TradingBot` orchestration-focused
- keep `StateStore` as the runtime source of truth
- keep Pulse UI separate from trading decisions
- keep debug/launcher/reporting concerns separate from trading decisions
- keep experiments quarantined unless explicitly promoted
- keep paper-only runtime safety intact
- do not start future roadmap work unless explicitly ordered

---

## Never Do

Do not:

- make the repo more abstract
- invent internal frameworks
- add coordinators where a function is enough
- use `any`, `as any`, broad casts, or `!` to bypass TypeScript
- change trading behavior silently
- perform cosmetic refactors while touching trading logic
- move policy logic back into `TradingBot`
- let UI, telemetry, launcher, or debug capture influence trading decisions
- hide legacy behavior behind cleaner names

When uncertain, stop and ask.

---

## Rule Files

Use the specific rule file for the work being planned:

- `architecture-rules.md`
  - ownership, module boundaries, TradingBot scope

- `runtime-safety.md`
  - startup, paper-only runtime, StateStore, execution safety

- `risk-guardrails.md`
  - entry/exit/recovery/risk behavior protection

- `testing-rules.md`
  - required checks and behavior-proof testing

- `experiment-review.md`
  - quarantined experiments and baseline leakage

---

## Playbooks

Use playbooks for task execution flow:

- audit flow
- patch flow
- experiment review
- other focused workflows

A playbook tells the agent how to proceed.
A rule file tells the agent what must not be violated.

---

## Current Scope

Current work is v18.3 doctrine, Type Truth, ownership, boundaries, contracts, and documentation alignment.

Deferred work:

- v19 modern replay/backtest parity
- v20 futures/margin realism
- v21 strategy lab / optimization

Do not pull deferred work into v18.3 unless explicitly ordered.

---

## Archive Rule

Stale or historical documentation belongs in:

`docs/archive_NOUSE`

Archived docs are history.
They must not guide current agent behavior.