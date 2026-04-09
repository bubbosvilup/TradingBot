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
- architect publish/apply timing
- post-loss latch semantics
- entry gating and open attempt outcomes
- exit reason shaping and lifecycle reporting
- operator-facing telemetry fields consumed by dashboard/API

Do not:

- rely on manual clicking as the only validation for dashboard work
- remove assertions just to make a refactor pass
- treat existing tests as incidental when they encode runtime semantics
