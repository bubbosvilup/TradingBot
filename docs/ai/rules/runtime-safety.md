# Runtime Safety

Current runtime posture:

- market data path is currently hard-wired toward live input in `src/core/orchestrator.ts`
- execution is still paper-only and must remain so
- `StateStore` is the runtime truth source
- startup historical preload, when enabled, seeds `StateStore` before live observation starts and remains bootstrap-only
- the dashboard reads server/store state; it should not become a side channel for business logic
- the Pulse UI is served as a static observability surface; it must stay separate from trading decisions
- managed-recovery invalidation is now intentionally stricter than a single early `family_mismatch`
- MTF context is optional and behind `mtf.enabled`; current default config enables it, and `MTF_ENABLED=false` disables it at runtime
- historical preload is optional by default in config; required mode must abort startup on preload failure before market stream/context/Architect/bots start
- `TradingBot` stays passive for MTF and may only pass published diagnostics through generic context/economics paths
- `TradingBot` exit handling uses a defensive position snapshot for planning/lifecycle/telemetry, while execution still closes through `ExecutionEngine` and `StateStore`
- shared entry economics uses explicit strategy policy for RSI economics, MTF cap opt-in, and capture-gap cap configuration; the baseline capture-gap cap remains `0.03`
- `RiskManager` owns volatility-aware sizing and post-win cooldown controls; volatility sizing cannot increase size and loss cooldown behavior must remain unchanged
- manual resume for bot-level max-drawdown pauses is explicit through `POST /api/bots/:botId/resume` and must not bypass an active portfolio kill switch

Safe-change rules:

- isolate runtime mode changes from strategy logic changes
- isolate dashboard fixes from risk and execution changes
- keep config changes explicit; avoid hidden fallback behavior
- keep historical preload out of `TradingBot`, downstream strategy roles, and per-tick paths
- seed preload data through existing store update paths where possible; do not create shadow histories
- preserve startup failures that prevent unsupported live execution
- preserve protective-stop priority when changing invalidation or recovery ordering
- preserve entry blocking during Architect challenger hysteresis
- preserve baseline-identical RSI entry behavior when MTF diagnostics are absent or disabled
- keep MTF raw timeframe mapping in frame config / aggregation plumbing, not in `TradingBot` or downstream strategy logic
- preserve baseline capture-gap cap behavior when `captureGapCapPct` is absent or invalid
- preserve baseline sizing when volatility sizing is disabled or `volatilityRisk` is missing/invalid
- preserve stronger post-loss cooldown semantics when adding post-win cooldown nuance

P0-specific guidance:

- If removing or segregating live-path assumptions, keep the result obvious in config and startup behavior.
- If changing historical preload, preserve the source boundary: same exchange/data source as `MarketStream`, bounded coverage, explicit degraded/fatal diagnostics.
- If changing managed recovery, define exact precedence versus target-hit, invalidation, timeout, and protective stop flows.
- Current managed-recovery precedence is: protective stop, timeout, confirmed target, invalidation.
- Current non-protective regime invalidation must respect the post-entry grace/confirmation policy.
- If fixing the dashboard, confirm API payload compatibility before changing server-side structures.
- If changing Pulse UI, keep it operator-focused and API-facing; do not add trading-side decisions.

Before touching runtime plumbing:

- identify the failure mode being prevented
- identify the operator-visible signal for that failure mode
- identify the tests that should fail if the safety boundary regresses
