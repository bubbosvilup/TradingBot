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
- Completed: v18 pre-closure stabilization patches:
  - explicit post-loss latch timeout reset API
  - wall-clock market freshness semantics
  - wall-clock kill-switch preview timestamps in TradingBot
  - degraded/stale exit warning telemetry
  - readability cleanup around lifecycle invariants, freshness expiry naming, MarketStream constants, and coding-agent docs
- Completed: final v18 release-candidate blockers:
  - post-loss Architect latch blocks globally at bot level while active; strategy id remains metadata
  - negative `exitPolicy.recovery.targetOffsetPct` is rejected explicitly
  - default WebSocket construction uses `globalThis.WebSocket` with a clear Node/runtime guard
- Current: v18 release candidate / commit safety. Only release-critical regressions should enter v18.
- Next: v18.1 technical microfixes. Keep this small and targeted:
  - TickProcessingSnapshot / hot-path history sharing only if it reduces duplicate price-history reads without broad runtime churn
  - time-base cleanup where residual mixed clocks affect determinism/testability
  - strategy error boundary if it can isolate strategy failures without changing decisions
  - config validation gaps with small shared validators
  - portfolio kill-switch reset only as an explicit operator action
  - small deterministic/testability fixes
  - MTF boundary validation in `MtfContextService` only if it can reuse shared validation logic
  - SystemServer injected-clock cleanup for deterministic payload/API tests
  - legacy backtest smoke test with deterministic trade count / PnL expectations
  - local MarketStream naming cleanup where safe
  - operational runbook for post-loss latch reset, disconnected UserStream, and paper short accounting
- v18.2: repo humanization + boundaries + contracts + types:
  - A: dependency map + rules: import graph, circular import audit, layer rules, dependency-cruiser, CI/test script
  - B: error taxonomy: discriminated errors for config/risk/execution/invariants, no downstream string matching
  - C: state machines: position/order transitions, guards, contract tests
  - D: Zod config validation: schema, explicit defaults, readable errors, less fragile manual parsing
  - E: contract tests: Strategy, Execution, StateStore, MarketStream, Bot, Architect
  - F: reduce `any`: initial audit count, target at least 70% reduction, replace with real types or `unknown`
  - G: human flow docs: entry, exit, recovery, architect switch, and "where to look to understand X" file map
  - exit criteria: dependency-cruiser passes, no circular imports between main layers, contract tests green, explicit position/order state machines, schema-validated config, discriminated errors in main paths, `any` reduced by at least 70%, clear entry/exit docs, and `TradingBot.ts` more readable or clearly segmented

## P3

- v19: build modern replay/backtest parity:
  - serious data layer and dataset quality scanner
  - event-driven replay through `ReplayFeed -> StateStore -> ContextService -> Architect -> TradingBot -> ExecutionEngine`
  - deterministic replay clock, explicit warm-up, no lookahead, MTF without leakage
  - execution realism v1: fees, slippage, spread, exchange filters, fill assumptions, base latency
  - strategic reports focused on daily stability, drawdown, recovery, fee/slippage impact, regime/strategy/reason breakdown, managed recovery, MTF, and blocked trades
  - anti-lookahead harness and legacy deprecation path
- v20: paper futures isolated-margin realism:
  - unified long/short accounting
  - leverage, initial/maintenance/available margin, isolated margin
  - liquidation price/event/forced close
  - mark price, simplified funding first, portfolio exposure/leverage kill-switch compatibility
- v21: strategy lab / optimization:
  - walk-forward analysis
  - parameter sweeps and robustness heatmaps
  - out-of-sample validation
  - Monte Carlo stress tests
  - benchmarks and strategy comparison by stability/drawdown/tail risk/recovery, not only profit

Priority notes:

- P0 safety and quarantine work outranks convenience refactors.
- Dashboard work should stay decoupled from core trading logic where possible.
- The removed compact monitor/chart surfaces should not be reintroduced casually; Pulse remains the only active UI and should stay read-only/operator-scoped.
- MTF work should remain behind `mtf.enabled` / `MTF_ENABLED`; raw timeframe mapping belongs in MTF frame config, not in downstream strategy/economics roles.
- Historical preload remains a bootstrap/store/history concern. It must not move into `TradingBot`, downstream strategy roles, or the hot tick path.
- RSI target-distance permissiveness may only come from coherent MTF medium/long internal frames and must remain observable in telemetry.
- Capture-gap cap permissiveness must be explicit via strategy/economics policy; the default remains `0.03`.
- Volatility-aware sizing may only reduce or preserve position size, and post-loss cooldown behavior must remain stronger than post-win cooldown behavior.
- Avoid broad rewrites while the runtime is under active refactor.
- Pulse remains the single operator UI entry point; keep it API-facing and separate from trading decisions.
- The active Pulse frontend no longer includes chart rendering; keep any future chart work out of scope unless explicitly re-approved.
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
- v18.1 must stay microfix-only and v18.2 must stay repo-humanization/boundary/contract/type work. Do not start v19 replay, v20 margin realism, or v21 optimization work inside either track.
- Modern backtest work must not claim profitability until data quality, execution assumptions, anti-lookahead tests, and reporting are in place.
