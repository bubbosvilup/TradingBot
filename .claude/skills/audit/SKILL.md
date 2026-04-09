# Audit Skill

Purpose: perform repo-specific audits without inventing a second architecture.

Workflow:

1. Read `AGENT.md`.
2. Read `docs/ai/project-map.md`.
3. Read `docs/ai/priorities.md`.
4. Follow `docs/ai/playbooks/audit-flow.md`.
5. Apply the rules in `docs/ai/rules/`.

Mandatory checks:

- no strategy-name branching added back to `TradingBot`
- no extracted coordinator logic moved back into `TradingBot`
- no unsafe runtime/live-path drift
- no experiment leakage into baseline behavior
