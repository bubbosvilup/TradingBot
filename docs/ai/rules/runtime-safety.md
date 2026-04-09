# Runtime Safety

Current runtime posture:

- market data path is currently hard-wired toward live input in `src/core/orchestrator.ts`
- execution is still paper-only and must remain so
- `StateStore` is the runtime truth source
- the dashboard reads server/store state; it should not become a side channel for business logic

Safe-change rules:

- isolate runtime mode changes from strategy logic changes
- isolate dashboard fixes from risk and execution changes
- keep config changes explicit; avoid hidden fallback behavior
- preserve startup failures that prevent unsupported live execution

P0-specific guidance:

- If removing or segregating live-path assumptions, keep the result obvious in config and startup behavior.
- If adding a managed recovery breaker, define exact precedence versus target-hit, invalidation, timeout, and protective stop flows.
- If fixing the dashboard, confirm API payload compatibility before changing server-side structures.

Before touching runtime plumbing:

- identify the failure mode being prevented
- identify the operator-visible signal for that failure mode
- identify the tests that should fail if the safety boundary regresses
