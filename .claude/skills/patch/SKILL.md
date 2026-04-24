# Patch Skill

Purpose: plan and execute small safe patches in the active refactor.

Workflow:

1. Read `AGENT.md`.
2. Read `docs/ai/priorities.md`.
3. Follow `docs/ai/playbooks/patch-flow.md`.
4. Use `docs/ai/rules/architecture.md` and `docs/ai/rules/runtime-safety.md` as patch gates.
5. Apply the human-readable coding rules in `AGENT.md`: no generic file headers, precise names, named constants, read-only `get*`/`read*`, small explicit code, and behavior-proving tests.

Mandatory checks:

- keep `TradingBot` orchestration-focused
- preserve paper-only execution safety
- quarantine experiment behavior unless explicitly promoted
- run the required test set for the touched area
