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

Behavior-sensitive areas needing lock coverage:

- managed recovery transitions and breakers
- managed recovery invalidation grace and target-vs-invalidation precedence
- architect publish/apply timing
- architect challenger hysteresis entry blocking
- post-loss latch semantics
- entry gating and open attempt outcomes
- short-horizon target-distance gating and RSI edge-floor behavior
- exit reason shaping and lifecycle reporting
- operator-facing telemetry fields consumed by dashboard/API

Current tests that should move with these behaviors:

- `tests/architectCoordinator.test.js`: `architect_challenger_pending`
- `tests/entryCoordinator.test.js`: `target_distance_exceeds_short_horizon`
- `tests/exitDecisionCoordinator.test.js`: post-entry invalidation grace and `rsi_exit_floor_failed`
- `tests/managedRecoveryExitResolver.test.js`: confirmed target beats invalidation
- `tests/tradingBot.test.js`: full tick-path coverage for the same runtime behaviors
- `tests/systemServer.test.js`: compact monitor/API payload behavior

Do not:

- rely on manual clicking as the only validation for dashboard work
- remove assertions just to make a refactor pass
- treat existing tests as incidental when they encode runtime semantics
