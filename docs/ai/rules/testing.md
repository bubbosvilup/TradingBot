# Testing Rules

Minimum check set for guidance-driven patches:

- `npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false`
- `npm test`

Test expectations by change type:

- role extraction: add or update focused tests near the extracted role
- `TradingBot` exit or entry changes: update `tests/tradingBot.test.js` and any dedicated coordinator tests
- `StateStore` changes: update `tests/stateStore.test.js`
- dashboard/API changes: update `tests/systemServer.test.js` when behavior is observable through the server surface
- runtime/bootstrap changes: update `tests/orchestrator.test.js`, `tests/runtime.test.js`, or stream/server tests as needed
- historical preload changes: update `tests/historicalBootstrapService.test.js`, `tests/orchestrator.test.js`, and stream/store/MTF readiness tests when behavior is observable
- market stream teardown/fallback changes: update `tests/marketStream.test.js` and verify `npm test` exits without late runtime logs after `PASS all`
- MTF parameter resolution: update `tests/mtfParamResolver.test.js`, `tests/entryEconomicsEstimator.test.js`, and tick-path coverage only when runtime behavior is observable
- Strategy economics policy changes: update `tests/entryEconomicsEstimator.test.js`; include baseline-missing-config, explicit-config, invalid-config fallback, and unrelated-strategy cases
- Risk sizing/cooldown policy changes: update `tests/riskManager.test.js`; include disabled/missing baseline cases and tests proving loss cooldown behavior is unchanged
- telemetry-only MTF changes: update `tests/tradingBotTelemetry.test.js` and `tests/systemServer.test.js` before broad runtime tests
- launcher/debug capture changes: update `tests/systemServer.test.js` and any focused launcher/config serialization tests; cover startup-mode selection, capture-field validation, and output-shape stability when behavior is observable

Behavior-sensitive areas needing lock coverage:

- managed recovery transitions and breakers
- managed recovery invalidation grace and target-vs-invalidation precedence
- architect publish/apply timing
- architect challenger hysteresis entry blocking
- post-loss latch semantics
- entry gating and open attempt outcomes
- short-horizon target-distance gating and RSI edge-floor behavior
- capture-gap cap baseline and explicit policy/config override behavior
- conservative volatility-aware sizing and win-specific reentry cooldown behavior
- MTF publish diagnostics and RSI MTF target-distance cap resolution diagnostics
- historical preload disabled/success/optional-degraded/required-fatal startup behavior
- market stream REST fallback lifecycle and teardown idempotency
- exit reason shaping and lifecycle reporting
- operator-facing telemetry fields consumed by dashboard/API
- launcher mode selection and debug-capture field/schema stability once implemented

Current tests that should move with these behaviors:

- `tests/architectCoordinator.test.js`: `architect_challenger_pending`
- `tests/entryCoordinator.test.js`: `target_distance_exceeds_short_horizon`
- `tests/entryEconomicsEstimator.test.js`: RSI MTF cap resolution into economics without moving gate ownership
- `tests/exitDecisionCoordinator.test.js`: post-entry invalidation grace and `rsi_exit_floor_failed`
- `tests/managedRecoveryExitResolver.test.js`: confirmed target beats invalidation
- `tests/mtfParamResolver.test.js`: pure RSI MTF resolution and baseline fallback policy
- `tests/mtfContextAggregator.test.js`: dominant internal MTF frame aggregation
- `tests/mtfContextService.test.js`: optional MTF frame snapshot construction
- `tests/tradingBotTelemetry.test.js`: operator-facing telemetry field shape, including MTF entry diagnostics
- `tests/tradingBot.test.js`: full tick-path coverage for the same runtime behaviors
- `tests/systemServer.test.js`: Pulse UI/API payload behavior and published Architect diagnostics pass-through

Do not:

- rely on manual clicking as the only validation for dashboard work
- remove assertions just to make a refactor pass
- treat existing tests as incidental when they encode runtime semantics
