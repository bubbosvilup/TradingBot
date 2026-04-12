# AGENT.md

## Purpose
This repository is being actively refactored toward clearer architectural role separation while preserving runtime behavior.

The core architectural spirit must remain:

- Context informs
- Architect decides regime/family/usability
- TradingBot executes within that perimeter
- Local coordinators/roles own focused operational flows
- TradingBot should orchestrate, not absorb every responsibility

## Non-negotiable design intent
Do not reintroduce strategy-name branching, Architect decision logic, latch state machines, telemetry shaping, or other extracted concerns back into `TradingBot` unless explicitly requested.

Prefer extracting focused roles over growing the bot further.

Preserve behavior unless the task explicitly asks for semantic changes.

## Current role boundaries
- `Context*` services: produce market/context inputs
- `MtfContextService` / `mtfContextAggregator`: optional multi-timeframe context construction and internal horizon-frame diagnostics
- `Architect*` services/coordinators: interpret/publish regime-family-usability state
- `TradingBot`: top-level tick orchestration and execution coordination
- `mtfParamResolver`: pure MTF-driven RSI entry hint/cap resolution from published internal frame diagnostics
- `entryEconomicsEstimator`: strategy-specific entry edge formulas and resolved economics diagnostics
- `postLossArchitectLatch`: post-loss re-entry defense
- `architectCoordinator`: published Architect sync/usability/apply logic
- `tradingBotTelemetry`: log/diagnostic metadata shaping
- `entryCoordinator`: entry gating / signal-state coordination
- `openAttemptCoordinator`: open attempt / execution rejection flow
- `entryOutcomeCoordinator`: final entry outcome shaping
- `exitOutcomeCoordinator`: final close outcome shaping

## Keep out of TradingBot
Avoid putting these back into `TradingBot`:
- strategy-specific formulas
- Architect interpretation/state machine logic
- latch state machine logic
- telemetry/log payload builders
- entry debounce/gating reasoning
- MTF interpretation, raw timeframe mapping, or strategy-specific MTF branching
- open-attempt outcome shaping
- close-outcome shaping

## Safe refactor rules
- Prefer minimal, behavior-preserving extraction
- Do not silently change thresholds, debounce rules, lifecycle semantics, or risk behavior
- Reuse existing store/runtime state; do not invent parallel persistence unless required
- Keep operator-facing log names/fields stable unless explicitly asked to change them
- Add tests for extracted roles when behavior is non-trivial
- Run:
  - `npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false`
  - `npm test`

## Current hotspots
The largest remaining area in `TradingBot` is the exit decision/reason planning logic (`shouldExitPosition(...)` or equivalent inline decision engine). Treat this as behavior-sensitive code. Refactor carefully.

UI/chart/dashboard cleanup is still pending and should be evaluated separately from core trading logic.

## When unsure
Favor:
- clearer role boundaries
- smaller focused modules
- preserving runtime behavior
- explicit typing
- incremental refactors over rewrites
