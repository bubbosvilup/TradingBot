Test lineage notes
==================

Most tests in this directory protect the active TypeScript paper runtime under `src/`.

Legacy-anchor tests are different: they preserve old modules while backtest migration is incomplete. They should not be read as evidence that `legacy/` is part of the active orchestrator runtime.

Current legacy anchors:
- `backtest.test.js`: `BacktestEngine` boundary coverage; the engine still reports a legacy adapter internally, but the test should not import legacy modules directly.
- `runtime.test.js`: pure legacy `legacy/runtime.js` coverage.
- `server.test.js`: pure legacy `legacy/server.js` coverage.
- `strategy.test.js`: pure legacy `legacy/strategy.js` coverage.
