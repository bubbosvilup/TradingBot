Legacy modules preserved for compatibility and research tooling.

These files are not part of the new orchestrator runtime.
They remain here because:
- some tests still validate legacy behavior
- the legacy backtest/research tooling still depends on them
- they may be useful as migration reference while the new architecture absorbs older capabilities

Current legacy entry points:
- `backtest.js`
- `backtest_runner.js`
- `persistence.js`
- `research.js`
- `runtime.js`
- `server.js`
- `strategy.js`
