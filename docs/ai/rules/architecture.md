# Architecture Rules

Non-negotiable:

- `AGENT.md` is the constitutional file. This folder extends it; it does not replace it.
- Keep `TradingBot` orchestration-focused.
- Prefer extracting or refining focused roles in `src/roles/` over enlarging `src/bots/tradingBot.ts`.

Do not do these regressions:

- Do not reintroduce strategy-name branching into `TradingBot`.
- Do not move extracted coordinator logic back into `TradingBot`.
- Do not move Architect interpretation or published-family logic back into `TradingBot`.
- Do not move latch state handling back into `TradingBot`.
- Do not move telemetry payload shaping back into `TradingBot`.
- Do not collapse dashboard concerns into runtime decision modules.
- Do not move compact monitor shaping into trading decision modules.
- Do not put managed-recovery invalidation confirmation policy into strategy modules.
- Do not put short-horizon target-distance gating into individual signal formulas.
- Do not put MTF interpretation, raw timeframe-label mapping, or strategy-specific MTF branching into `TradingBot`.
- Do not let `mtfParamResolver` interpret raw market timeframe labels such as `1m`, `5m`, `15m`, or `1h`; it consumes only internal horizon frame ids.
- Do not use strategy ids or symbol names as hidden switches in shared economics code. Use explicit strategy/config policy surfaces.
- Do not move sizing or post-trade cooldown policy into `TradingBot`; `RiskManager` owns that behavior.

Expected ownership:

- `src/core/`: lifecycle/bootstrap/store/system composition
- `src/roles/`: focused policy, planning, gating, shaping, and coordination logic
- `src/bots/`: orchestration and execution sequencing
- `src/ui/` and `public/`: dashboard rendering/adapters only
- `tests/`: behavior locks for every non-trivial extraction

Current ownership notes:

- `architectCoordinator` owns published Architect usability, including entry blocking during pending challenger hysteresis.
- `MtfContextService` owns optional MTF frame snapshot construction behind `mtf.enabled`.
- `mtfContextAggregator` owns MTF aggregation and dominant internal horizon-frame diagnostics.
- MTF raw-to-internal frame mapping belongs in MTF frame configuration / aggregation plumbing.
- `mtfParamResolver` owns pure MTF-driven RSI entry hint/cap resolution only.
- `entryEconomicsEstimator` owns fee-aware edge estimates, strategy economics policy interpretation, capture-gap cap resolution, resolved cap computation, and target-distance diagnostics.
- `entryCoordinator` owns final entry gates, including `target_distance_exceeds_short_horizon`.
- `RiskManager` owns position sizing penalties, drawdown/loss gating, loss cooldowns, post-win cooldown nuance, and trade constraint baselines.
- `exitDecisionCoordinator` owns managed-recovery invalidation confirmation/grace policy.
- `managedRecoveryExitResolver` owns managed-recovery exit precedence.
- `SystemServer` and `public/compact.*` own compact monitor presentation only.

When planning a refactor:

- Name the responsibility being moved.
- Name the destination module that should own it.
- State what must remain stable externally: events, log fields, lifecycle semantics, thresholds, timing.
- Prefer incremental extraction over simultaneous redesign.

If a change touches `TradingBot`:

- ask whether the logic already belongs in an existing role
- extract before expanding inline branches
- keep method count and branch count moving down, not up
