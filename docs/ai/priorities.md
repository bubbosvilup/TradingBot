# Current Priorities

Work top-down unless a task explicitly says otherwise.

## P0

- Completed: segregate the live execution path from the active paper runtime.
- Completed: quarantine `allow_small_loss_floor05`; do not normalize it into the default runtime path.
- Completed: add a strong managed recovery breaker.
- Completed: fix the UI dashboard serving model and consolidate the Pulse UI entry point.
- Completed: harden managed-recovery invalidation so a single early `family_mismatch` is not enough.
- Completed: block entry during pending Architect challenger hysteresis.

## P1

- Completed: realign runtime telemetry and fee-aware economics.
- Completed: add a portfolio-wide kill switch.
- Completed: add deterministic short-horizon entry sanity for RSI target distance.
- Completed: add MTF-aware RSI target-distance cap resolution with baseline-identical disabled behavior.
- Completed: expose MTF publish and RSI entry cap-resolution diagnostics in full and compact telemetry.
- Completed: add startup-only historical preload so ContextService/MTF/Architect can warm start from recent store history.
- Completed: remove strategy-name branching from shared entry economics by moving RSI economics behavior behind explicit strategy policy.
- Completed: make the shared capture-gap cap configurable through strategy economics policy while preserving the `0.03` baseline.
- Completed: add conservative volatility-aware sizing and win-specific reentry cooldown controls in `RiskManager`.
- Completed: harden the exit tick path with defensive position snapshots and explicit close-failure telemetry.
- Completed: fix Architect switch-delta incumbent score comparison basis.
- Completed: make exit-policy capability flags authoritative for RSI-threshold and price-target exits, including managed recovery target gating.
- Completed: make paused state runtime-authoritative for new-entry suppression while still allowing close handling on open positions.
- Completed: eliminate the paused-state dead end by forbidding persisted `paused` state without a non-empty `pausedReason`.
- Completed: make `classifyClosedTrade` structured-first via exit lifecycle metadata, with reason-string fallback only for the bounded ambiguous RSI subcase.
- Completed: expose architect usability MTF instability gating through `mtf.instabilityThreshold` while preserving the default `0.5`.

## P2

- Completed: add stale-symbol retention and cleanup for `StateStore` symbol-scoped maps.
- Completed: reduce REST fallback cost with stale-symbol narrowing and batch ticker fetches.
- Completed: harden market stream teardown so shutdown does not leave REST fallback snapshots logging after tests finish.
- In progress: integrate backtest with the modern runtime through `src/engines/backtestEngine.ts`; full replay parity is still not done.
- Completed: realign repo documentation with the current Pulse UI, short-side runtime support, authoritative exit capabilities, and coherent paused-state behavior.
- Completed: close the current short-facing runtime/report audit loop with legacy replay guardrails, short-aware report matching, `ExperimentReporter` sideSummary, and `SystemServer` short-report regression coverage.
- Completed: logging cleanup P2 across entry, Architect, and exit telemetry ownership; `trade_closed` is now the canonical detailed exit event and compact lifecycle events stay compact.
- Next: define a launcher-ready runtime surface with explicit startup modes `Normal` and `Debug`.
- Next: prepare a debug-run capture contract for `jsonl`, including which fields are append-only event records versus rolling numeric counters/snapshots.

## P3

- Implement the launcher flow:
  - first window selects startup mode
  - `Debug` opens a second window for run-capture selection
  - selected capture fields persist into a `jsonl`-friendly config/runtime contract
- Continue short work only on the remaining replay/backtest parity gap and any future low-priority reporting polish.
- Continue hot-path micro-optimizations after the latest `ContextBuilder` allocation pass.
- Continue architectural refinements after the latest trimming patches and role extraction work land.

Priority notes:

- P0 safety and quarantine work outranks convenience refactors.
- Dashboard work should stay decoupled from core trading logic where possible.
- Compact monitor work should stay read-only and separate from operator controls.
- MTF work should remain behind `mtf.enabled` / `MTF_ENABLED`; raw timeframe mapping belongs in MTF frame config, not in downstream strategy/economics roles.
- Historical preload remains a bootstrap/store/history concern. It must not move into `TradingBot`, downstream strategy roles, or the hot tick path.
- RSI target-distance permissiveness may only come from coherent MTF medium/long internal frames and must remain observable in telemetry.
- Capture-gap cap permissiveness must be explicit via strategy/economics policy; the default remains `0.03`.
- Volatility-aware sizing may only reduce or preserve position size, and post-loss cooldown behavior must remain stronger than post-win cooldown behavior.
- Avoid broad rewrites while the runtime is under active refactor.
- Pulse remains the single operator UI entry point; keep it API-facing and separate from trading decisions.
- Treat active runtime short support and its current report/export surfaces as verified; replay/backtest parity remains explicitly out of scope and still incomplete.
- Launcher prep should stay outside trading decision paths; mode selection and debug capture configuration belong in startup/UI/config plumbing.
- Debug capture design should separate:
  - high-cardinality append-only events for `jsonl`
  - rolling numeric state that should be updated as a single latest value instead of duplicated on every tick
- Logging ownership already fixed for v18:
  - entry gate events are the detailed entry record
  - architect events carry causal publish/decision facts only
  - `trade_closed` is the detailed exit record
  - `BUY` / `SHORT` / `SELL` / `COVER` / `RISK_CHANGE` remain compact lifecycle transitions
- MTF thresholds intentionally remain split:
  - `mtf.instabilityThreshold` default `0.5` = architect usability/blocking threshold
  - `mtfParamResolver` `0.25` = stricter parameter-widening coherence threshold
