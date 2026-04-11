# Audit Flow

Use for architecture audits, refactor risk reviews, and hotspot inspection.

Checklist:

1. Read `AGENT.md`, `docs/ai/project-map.md`, and `docs/ai/priorities.md`.
2. Name the target area and classify it: core, role, bot, stream, UI, or test.
3. List owned responsibilities in that area.
4. List any leaked responsibilities that belong elsewhere.
5. Check for forbidden regressions:
   - strategy-name branching in `TradingBot`
   - coordinator logic pulled back into `TradingBot`
   - runtime/UI coupling
   - silent risk behavior drift
   - compact monitor concerns leaking into trading decisions
   - managed-recovery invalidation becoming easier than entry
   - entry ignoring active Architect challenger hysteresis
6. Identify the smallest safe patch set.
7. Name required tests before editing.

Audit output should include:

- findings ordered by severity
- exact files involved
- proposed ownership destination for each leaked responsibility
- patch scope kept small enough to review
