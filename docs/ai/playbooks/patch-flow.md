# Patch Flow

Use before coding a refactor or safety fix.

Checklist:

1. State the patch goal in one sentence.
2. Mark the priority level: P0, P1, P2, or P3.
3. List touched files.
4. List invariants that must not change.
5. Decide whether the patch is:
   - behavior-preserving extraction
   - bug fix
   - risk control
   - UI/dashboard-only
   - UI/API observability-only
6. If `TradingBot` is touched, justify why the change cannot live in an existing or new role.
7. If config or runtime mode is touched, state the startup and safety effect explicitly.
8. Define the exact tests to run.
9. If logging or debug output is touched, state which fields remain stable, which are intentionally renamed, and whether the change affects future `jsonl` capture contracts.

Patch acceptance gate:

- no strategy-name branching added to `TradingBot`
- no extracted coordinator logic moved back into `TradingBot`
- no unsupported live path made easier to enter
- no experiment logic normalized without quarantine
- no dashboard patch coupled to execution/risk changes without a reason
- no Pulse UI patch adds trading-side decisions
- no launcher/debug-capture patch leaks mode selection or capture policy into trading decisions
- no logging patch duplicates high-cardinality state when a rolling counter/latest snapshot would preserve the same signal
- no managed-recovery patch restores single early `family_mismatch` invalidation
- no entry patch bypasses pending Architect challenger hysteresis
