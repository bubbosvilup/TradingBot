# Runtime Safety

Current runtime posture:

- market data path is currently hard-wired toward live input in `src/core/orchestrator.ts`
- execution is still paper-only and must remain so
- `StateStore` is the runtime truth source
- the dashboard reads server/store state; it should not become a side channel for business logic
- compact UI is served as a static observability surface; it must stay separate from operator controls and trading decisions
- managed-recovery invalidation is now intentionally stricter than a single early `family_mismatch`

Safe-change rules:

- isolate runtime mode changes from strategy logic changes
- isolate dashboard fixes from risk and execution changes
- keep config changes explicit; avoid hidden fallback behavior
- preserve startup failures that prevent unsupported live execution
- preserve protective-stop priority when changing invalidation or recovery ordering
- preserve entry blocking during Architect challenger hysteresis

P0-specific guidance:

- If removing or segregating live-path assumptions, keep the result obvious in config and startup behavior.
- If changing managed recovery, define exact precedence versus target-hit, invalidation, timeout, and protective stop flows.
- Current managed-recovery precedence is: protective stop, timeout, confirmed target, invalidation.
- Current non-protective regime invalidation must respect the post-entry grace/confirmation policy.
- If fixing the dashboard, confirm API payload compatibility before changing server-side structures.
- If changing compact UI, keep it dense, read-only, and API-facing; do not add trading controls.

Before touching runtime plumbing:

- identify the failure mode being prevented
- identify the operator-visible signal for that failure mode
- identify the tests that should fail if the safety boundary regresses
