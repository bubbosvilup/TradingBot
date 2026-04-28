# TradingBot

Paper-trading runtime for multi-bot market observation, strategy evaluation, risk-gated execution, and operator observability.

This repository is currently in the v18.3 phase:

**Type Truth, state ownership, runtime boundaries, contract tests, and documentation alignment.**

The goal is not to add features.
The goal is to make the current runtime easier to understand, safer to change, and more verifiable.

---

## Current Runtime Status

| Area                     | Status                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| Execution                | Paper-only                                                              |
| Market data              | Live market data                                                        |
| Live order routing       | Disabled / not active                                                   |
| UI                       | Pulse UI at `/`                                                         |
| State source             | `StateStore`                                                            |
| Backtest                 | Legacy-backed adapter, not modern runtime parity                        |
| Short support            | Present in paper runtime                                                |
| Futures / margin realism | Not implemented                                                         |
| MTF                      | Optional runtime feature, must preserve baseline behavior when disabled |
| Historical preload       | Startup-only bootstrap feature                                          |
| Current focus            | v18.3 structural integrity                                              |

Important:

* The active runtime must not place real orders.
* The presence of live-related code does not imply live readiness.
* Legacy replay/backtest results do not prove modern runtime parity.
* Paper short support is not futures or margin realism.

---

## What The Bot Does

The bot has five jobs:

1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

Every module should support one of these jobs clearly.

---

## Architecture Overview

```text
market data
  -> streams
  -> StateStore
  -> ContextService
  -> ArchitectService
  -> TradingBot
  -> ExecutionEngine
  -> StateStore
  -> SystemServer / Pulse
```

Main responsibilities:

* `StateStore` is the runtime source of truth.
* `ContextService` builds rolling market context.
* `ArchitectService` publishes regime / family / usability state.
* `TradingBot` orchestrates the per-tick flow.
* `src/roles/` owns focused entry, exit, recovery, risk, telemetry, and policy flows.
* `ExecutionEngine` owns paper open/close execution.
* `SystemServer` and `public/` expose operator UI/API surfaces.
* `legacy/` contains old code and is not the target architecture.

---

## Non-Negotiable Rules

Do not:

* enable live execution accidentally;
* move policy logic back into `TradingBot`;
* use `any`, `as any`, broad casts, or `!` to bypass TypeScript;
* change trading behavior silently;
* perform cosmetic refactors while touching trading logic;
* let UI, debug capture, reporting, or launcher code influence trading decisions;
* promote experiments into baseline behavior without explicit approval;
* treat legacy backtest as runtime parity.

When uncertain, stop and ask.

---

## v18.3 Baseline
- `v18.3-baseline.md` — current technical baseline for Type Truth, ownership, and structural integrityTruth, ownership, and structural integrity

v18.3 is focused on structural integrity.

Current priorities:

1. align documentation and agent rules;
2. archive stale docs into `docs/archive_NOUSE`;
3. clarify state ownership;
4. remove type-blind runtime boundaries;
5. make config contracts truthful;
6. add behavior/contract tests;
7. reduce `any`, casts, and false TypeScript types;
8. write flow docs from the real runtime path;
9. only then consider structural extraction from `TradingBot`.

Deferred work:

* v19: modern replay/backtest parity
* v20: futures/margin realism
* v21: strategy lab / optimization

---

## Install

```bash
npm install
```

---

## Run

Standard startup:

```bash
npm start
```

Short smoke run:

```bash
npm start -- --duration-ms=5000 --summary-ms=1000
```

Pulse UI:

```text
http://127.0.0.1:3000/
```

Notes:

* execution is paper-only;
* live execution mode must fail explicitly;
* market data currently comes from live market feeds;
* Pulse is an observability/operator surface, not trading decision logic.

---

## Test

Full test suite:

```bash
npm test
```

TypeScript check:

```bash
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
```

Run both before accepting code patches.

---

## Key API Surfaces

Common operator/API surfaces include:

* `GET /api/system`
* `GET /api/bots`
* `GET /api/pulse`
* `GET /api/pulse/stream`
* `GET /api/prices`
* `GET /api/positions`
* `GET /api/events`
* `GET /api/trades`
* `POST /api/bots/:botId/resume`
* `POST /api/bots/:botId/reset-post-loss-latch`
* `POST /api/kill-switch/reset`

Manual recovery endpoints are narrow operator tools.
They must not become generic risk bypasses.

See:

* `docs/operations.md`

---

## Repository Layout

```text
src/
  bots/        bot orchestration
  core/        bootstrap, config, StateStore, services, server
  domain/      pure domain rules, selectors, transitions
  engines/     execution, indicators, backtest adapter
  roles/       focused entry/exit/risk/recovery/telemetry roles
  streams/     market and user stream integration
  strategies/  strategy-specific signal logic and config
  data/        runtime configuration data
  types/       shared types
  utils/       small utilities

public/        Pulse UI static assets
legacy/        isolated old code, not target architecture
tests/         behavior locks and contract tests
docs/          active documentation
```

Archived or stale documentation belongs in:

```text
docs/archive_NOUSE
```

Archived docs are history.
They must not guide current agent behavior.

---

## Important Docs

Start here:

* `AGENT.md`
* `docs/ai/project-map.md`
* `docs/ai/priorities.md`
* `docs/ai/rules/README.md`
* `docs/ai/runtime-contracts.md`
* `docs/operations.md`
* `docs/ai/current-handoff.md`


For future work boundaries:

* v19 modern replay/backtest parity is deferred.
* v20 futures/margin realism is deferred.
* v21 strategy lab / optimization is deferred.

---

## Current Limits

* No real exchange orders.
* No live readiness.
* No modern replay parity yet.
* Legacy backtest is not proof of runtime behavior.
* Paper short support is not margin/futures realism.
* No finalized debug `jsonl` contract yet.
* Do not use current reports to claim profitability.

---

## Development Rule

Small, behavior-preserving patches first.

Before coding, state:

1. goal;
2. touched files;
3. invariants that must not change;
4. whether trading behavior changes;
5. required tests.

If behavior changes, update code, tests, and docs together.
