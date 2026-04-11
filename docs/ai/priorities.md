# Current Priorities

Work top-down unless a task explicitly says otherwise.

## P0

- Completed: segregate the live execution path from the active paper runtime.
- Completed: quarantine `allow_small_loss_floor05`; do not normalize it into the default runtime path.
- Completed: add a strong managed recovery breaker.
- Completed: fix the UI dashboard serving model and add the compact monitor.
- Completed: harden managed-recovery invalidation so a single early `family_mismatch` is not enough.
- Completed: block entry during pending Architect challenger hysteresis.

## P1

- Completed: realign runtime telemetry and fee-aware economics.
- Completed: add a portfolio-wide kill switch.
- Completed: add deterministic short-horizon entry sanity for RSI target distance.
- Continue: reduce architect/latch/publish cadence rigidity where evidence shows churn remains.

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
- Compact monitor work should stay read-only and separate from operator controls.
- Avoid broad rewrites while the runtime is under active refactor.
- Treat short support as an audit-and-prep area until entry/exit/risk/UI semantics are explicitly upgraded end-to-end.
