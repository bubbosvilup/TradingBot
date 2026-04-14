Legacy modules preserved for compatibility and research tooling.

These files are not part of the new orchestrator runtime.
They remain here because:
- some tests still validate legacy behavior
- the legacy backtest tooling still depends on them
- they may be useful as migration reference while the new architecture absorbs older capabilities

Current blockers to deletion:
- `src/engines/backtestEngine.ts` bridges to `backtest.js` and `backtest_runner.js`
- `scripts/backtest.js` enters through `BacktestEngine`, which still bridges to `backtest_runner.js`
- `tests/backtest.test.js` validates the current `BacktestEngine` legacy-adapter contract
- `tests/runtime.test.js` directly validates `runtime.js`
- `tests/server.test.js` directly validates `server.js`
- `tests/strategy.test.js` directly validates `strategy.js`

Current legacy entry points:
- `backtest.js`
- `backtest_runner.js`
- `runtime.js`
- `server.js`
- `strategy.js`
