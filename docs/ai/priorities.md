# Current Priorities

Work top-down unless a task explicitly says otherwise.

## P0

- Segregate or remove the live-path assumptions from the current runtime.
- Quarantine `allow_small_loss_floor05`; do not normalize it into the default runtime path.
- Add a strong managed recovery breaker.
- Fix the UI dashboard.

## P1

- Realign telemetry and economics.
- Add a portfolio-wide kill switch.
- Reduce architect/latch/publish cadence rigidity.

## P2

- Completed: add stale-symbol retention and cleanup for `StateStore` symbol-scoped maps.
- Completed: reduce REST fallback cost with stale-symbol narrowing and batch ticker fetches.
- In progress: integrate backtest with the modern runtime through `src/engines/backtestEngine.ts`; full replay parity is still not done.

## P3

- Add shorts.
- Continue hot-path micro-optimizations after the latest `ContextBuilder` allocation pass.
- Continue architectural refinements after the safety and separation work lands.

Priority notes:

- P0 safety and quarantine work outranks convenience refactors.
- Dashboard work should stay decoupled from core trading logic where possible.
- Avoid broad rewrites while the runtime is under active refactor.
- Treat short support as an audit-and-prep area until entry/exit/risk/UI semantics are explicitly upgraded end-to-end.
