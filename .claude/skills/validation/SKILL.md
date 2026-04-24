# Validation Skill

Purpose: validate that a patch did not create architectural or runtime regressions.

Workflow:

1. Read `docs/ai/rules/testing.md`.
2. Read `docs/ai/rules/risk-guardrails.md`.
3. Re-check the touched files against `docs/ai/project-map.md`.
4. Re-check changed code against `AGENT.md` human-readable coding rules: no generic headers, no vague names where precise verbs fit, no hidden mutation in `get*`/`read*`, and no untested wrapper/capability claims.

Validation output should confirm:

- which invariants were preserved
- which tests were run or still need to run
- whether `TradingBot` absorbed forbidden logic
- whether runtime safety or experiment quarantine regressed
