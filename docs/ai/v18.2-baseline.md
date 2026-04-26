# v18.2-A Baseline Measurement

Date: 2026-04-26

Scope: measurement only before the v18.2 human-design refactor.

Do not fix these findings yet. This baseline records the current repository shape so the refactor has measurable starting points.

## Commands Added

- `npm run audit:any`
- `npm run audit:architecture`
- `npm run audit:boundaries`
- `npm run audit:circular`
- `npm run audit:deps`

No dev dependencies were added. An attempted `npm install --save-dev madge dependency-cruiser` was rejected by npm because `madge@8.0.0` has an optional peer range for TypeScript 5.x while this repo currently lists TypeScript 6.0.2. To keep this baseline non-invasive, the package scripts use pinned `npx -p` invocations instead.

## Exact Commands Run

```powershell
npm install --save-dev madge dependency-cruiser
npm run audit:any
npm run audit:architecture
npm run audit:boundaries
npm run audit:circular
npm run audit:deps
npm test
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
```

The install command was attempted during baseline setup and failed with `ERESOLVE`; it changed no committed files. It is recorded here because it explains why the audit packages are not committed as dev dependencies.

Fresh verification rerun on 2026-04-26 used:

```powershell
npm run audit:any
npm run audit:architecture
npm run audit:circular
npm run audit:deps
npm test
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
```

## Test And TypeScript Baseline

- `npm test`: pass, exit code 0.
- `npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false`: pass, exit code 0, no diagnostics.

The test log includes expected fixture logging from the orchestrator historical preload failure case; the suite still reports `PASS all`.

## Dependency Graph Baseline

`npm run audit:deps` command:

```powershell
npx -y -p dependency-cruiser@16.10.4 depcruise "src/**/*.ts" --include-only "^src" --output-type err --no-config
```

Result:

- 122 modules cruised.
- 242 dependencies cruised.
- 0 dependency-cruiser violations.

Limitation: this command runs without a dependency-cruiser config and therefore does not enforce architecture rules. It only proves that dependency-cruiser can parse the graph. The next stage should add warning-mode boundary rules before any hard enforcement.

## Circular Imports

`npm run audit:circular` command:

```powershell
npx -y -p madge@8.0.0 madge src --circular --extensions ts
```

Result:

- 64 files processed.
- 1 circular dependency found.
- `src/types/architect.ts > src/types/mtf.ts`

Madge exits with code 1 when cycles exist. That is expected for this baseline.

The local architecture audit reports the same cycle as:

- `src/types/architect.ts > src/types/mtf.ts > src/types/architect.ts`

## Explicit `any` Baseline

`npm run audit:any` result:

- Total explicit `any`: 301

By category:

- internal business state: 145
- unknown: 82
- raw external payload: 54
- telemetry/payload: 20

Top files by explicit `any`:

| File | Count | Main categories |
| --- | ---: | --- |
| `src/core/systemServer.ts` | 73 | internal business state, raw external payload, unknown |
| `src/bots/tradingBot.ts` | 59 | internal business state, unknown |
| `src/core/wsManager.ts` | 32 | raw external payload, unknown, internal business state |
| `src/roles/exitDecisionCoordinator.ts` | 20 | internal business state |
| `src/streams/userStream.ts` | 16 | unknown, raw external payload |
| `src/streams/marketStream.ts` | 15 | raw external payload |
| `src/core/architectService.ts` | 14 | internal business state |
| `src/core/orchestrator.ts` | 14 | internal business state |
| `src/core/historicalBootstrapService.ts` | 13 | unknown |
| `src/core/experimentReporter.ts` | 10 | internal business state |

Limitation: `scripts/audit-any.js` uses the TypeScript parser and scans `.ts` and `.js` files under `src`, `tests`, and `scripts`. The current 301 findings are all in `src`. The category is a heuristic based on file path and same-line context; it is useful for triage, not as a type-design verdict.

## Boundary Snapshot

`npm run audit:architecture` result:

- Source files: 64
- Local parser import cycles: 1
- Boundary findings: 6

Boundary findings:

- `src/core/botManager.ts:4 -> src/bots/tradingBot.ts`: `src/core/botManager.ts` imports concrete `TradingBot`.
- `src/core/stateStore.ts:18 -> src/core/configLoader.ts`: `StateStore` imports `ConfigLoader` constants.
- Historical before v18.2-C: `src/strategies/rsiReversion/strategy.ts` imported the runtime role-layer exit/recovery helpers.
- `src/types/runtime.ts:8 -> src/core/clock.ts`: `src/types/**` imports `src/core/**`.
- `src/utils/time.ts:1 -> src/core/clock.ts`: `src/utils/**` imports `src/core/**`.

Checked boundary classes with no current findings from the local audit:

- `src/roles/**` importing `src/streams/**` or `src/bots/**`: none found.
- Runtime importing `legacy/**` outside `src/engines/backtestEngine.ts`: none found.

Known shared mutation ownership hotspot:

- `src/engines/executionEngine.ts` publishes opened/closed order updates through `UserStream`.
- `src/streams/userStream.ts` normalizes remote and local user events and republishes to subscribers.
- `src/core/orchestrator.ts` wires `UserStream` subscriber mutations back into `StateStore`.

## Architecture Hotspots

Largest files by line count:

| File | Lines | Imports |
| --- | ---: | ---: |
| `src/bots/tradingBot.ts` | 1830 | 36 |
| `src/core/stateStore.ts` | 1532 | 12 |
| `src/core/systemServer.ts` | 1275 | 9 |
| `src/streams/marketStream.ts` | 630 | 4 |
| `src/core/wsManager.ts` | 625 | 3 |
| `src/core/architectService.ts` | 543 | 5 |
| `src/core/orchestrator.ts` | 539 | 25 |
| `src/core/experimentReporter.ts` | 511 | 1 |
| `src/roles/tradingBotTelemetry.ts` | 475 | 11 |
| `src/streams/userStream.ts` | 416 | 3 |

Likely v18.2 touch points:

- `src/bots/tradingBot.ts`: largest runtime coordinator and second-highest explicit `any` count.
- `src/core/systemServer.ts`: highest explicit `any` count and broad payload shaping surface.
- `src/core/stateStore.ts`: largest shared mutable state owner and imports config constants.
- `src/engines/executionEngine.ts`, `src/streams/userStream.ts`, `src/core/orchestrator.ts`: shared order/event mutation path.
- `src/core/botManager.ts`: core-to-concrete bot dependency.
- `src/types/architect.ts` and `src/types/mtf.ts`: current import cycle.
- `src/strategies/rsiReversion/strategy.ts`: strategy-to-role boundary crossing.
- `src/types/runtime.ts` and `src/utils/time.ts`: type/util imports into core clock.

Recommended order of attack:

1. Add dependency-cruiser warning-mode rules for the measured boundaries, with current violations documented as allowed warnings.
2. Break the `src/types/architect.ts` / `src/types/mtf.ts` cycle by extracting shared type primitives.
3. Move pure clock types/helpers out of `src/core/clock.ts` or invert imports so `types` and `utils` do not depend on `core`.
4. Decouple `BotManager` from concrete `TradingBot` through an injected factory or registry.
5. Separate `StateStore` from `ConfigLoader` constants by moving shared constants to a neutral module.
6. Define typed event/order contracts around `ExecutionEngine`, `UserStream`, and `StateStore` before changing mutation ownership.
7. Triage `any` in `systemServer`, `tradingBot`, and websocket/user-stream boundaries, starting with raw external payload guards and then internal business state.

## Limitations

- This is a baseline only; no runtime behavior was intentionally changed.
- No hard dependency rules were added.
- The dependency-cruiser command currently proves parseability and graph size, not policy compliance.
- The `any` categories are rough and should be reviewed during type-design work.
- File line count is a complexity proxy, not cyclomatic complexity.

## v18.2-B Dependency Boundaries Warning Mode

Added `.dependency-cruiser.cjs` with warning-level dependency boundary rules. No dev dependencies were added; `npm run audit:boundaries` uses the same pinned `dependency-cruiser@16.10.4` `npx -p` approach as the v18.2-A graph baseline.

`npm run audit:boundaries` command:

```powershell
npx -y -p dependency-cruiser@16.10.4 depcruise "src/**/*.ts" --include-only "^(src|legacy)" --config .dependency-cruiser.cjs --output-type err
```

Warning rules added:

- `no-circular-imports`
- `types-stay-foundational`: `src/types/**` must not import runtime layers.
- `utils-do-not-import-core`: `src/utils/**` must not import `src/core/**`.
- `state-store-config-loader-baseline`: visible warning for `StateStore` importing `ConfigLoader` constants.
- `strategies-do-not-import-runtime-layers`: `src/strategies/**` must not import `src/core/**`, `src/bots/**`, `src/streams/**`, or `src/roles/**`.
- `roles-do-not-import-streams-or-bots`
- `runtime-does-not-import-legacy`: only `src/engines/backtestEngine.ts` may bridge to `legacy/**`.
- `core-does-not-import-concrete-bots`
- `bot-manager-concrete-bot-baseline`: visible warning for `src/core/botManager.ts` importing `src/bots/tradingBot.ts`.
- `engines-do-not-import-bots-or-strategies`

Current `audit:boundaries` result:

- 129 modules cruised.
- 250 dependencies cruised.
- 0 errors.
- 6 warnings.

Current warning list:

- `src/utils/time.ts -> src/core/clock.ts`: `utils-do-not-import-core`
- `src/types/runtime.ts -> src/core/clock.ts`: `types-stay-foundational`
- Historical before v18.2-C: `src/strategies/rsiReversion/strategy.ts` violated `strategies-do-not-import-runtime-layers` through role-layer exit/recovery helper imports.
- `src/core/stateStore.ts -> src/core/configLoader.ts`: `state-store-config-loader-baseline`
- `src/core/botManager.ts -> src/bots/tradingBot.ts`: `bot-manager-concrete-bot-baseline`

The `src/types/architect.ts` / `src/types/mtf.ts` cycle was fixed with a small type-only extraction to `src/types/architectPrimitives.ts`. `npm run audit:circular` now reports no circular dependencies. Runtime behavior was not intentionally changed.

## v18.2-C Foundation Boundary Cleanup

Removed five of the six v18.2-B boundary warnings without changing runtime behavior.

Warnings before v18.2-C:

- `src/utils/time.ts -> src/core/clock.ts`
- `src/types/runtime.ts -> src/core/clock.ts`
- Historical before v18.2-C: RSI strategy imports pointed at role-layer exit/recovery helpers.
- `src/core/stateStore.ts -> src/core/configLoader.ts`
- `src/core/botManager.ts -> src/bots/tradingBot.ts`

Changes:

- Added `src/types/clock.ts` as the neutral clock contract/runtime helper module.
- Kept `src/core/clock.ts` as a temporary compatibility re-export.
- Updated `src/types/runtime.ts` and `src/utils/time.ts` so foundation modules no longer import `src/core/clock.ts`.
- Added `src/types/portfolioKillSwitch.ts` for the portfolio kill-switch mode and valid-mode set.
- Updated `src/core/configLoader.ts` and `src/core/stateStore.ts` to import the kill-switch constant from the neutral type module.
- Added `src/domain/exitPolicyRegistry.ts` and `src/domain/recoveryTargetResolver.ts` for the pure RSI exit/recovery helpers.
- Temporary `src/roles/exitPolicyRegistry.ts` and `src/roles/recoveryTargetResolver.ts` compatibility re-exports existed after v18.2-C and were retired in the release-closing patch.
- Updated `src/strategies/rsiReversion/strategy.ts` to import the pure helpers from `src/domain/**` instead of `src/roles/**`.

Current warning list after v18.2-C:

- `src/core/botManager.ts -> src/bots/tradingBot.ts`: `bot-manager-concrete-bot-baseline`

Current `audit:boundaries` result:

- 136 modules cruised.
- 255 dependencies cruised.
- 0 errors.
- 1 warning.

`rsiReversion` decoupling was completed through pure helper extraction to `src/domain/**`. No strategy thresholds or decision logic were intentionally changed.

## v18.2-D Final Boundary Warning Removal

Removed the final `src/core/botManager.ts -> src/bots/tradingBot.ts` boundary warning by introducing a small factory contract and moving concrete bot construction to the composition root.

Bot factory shape:

```typescript
export interface BotFactory {
  createBot(config: BotConfig, deps: BotDeps): BotController;
}
```

Changes:

- Added `src/types/botFactory.ts`.
- Updated `src/core/botManager.ts` to accept `{ deps, botFactory }` and call `botFactory.createBot(config, deps)`.
- Removed the direct `TradingBot` import from `src/core/botManager.ts`.
- Updated `src/core/orchestrator.ts` to import `TradingBot` and pass a minimal factory into `BotManager`.
- Added `tests/botManager.test.js` to prove `BotManager` registers enabled bots, uses the injected factory, stores bots by config id, and preserves start/stop behavior.
- Updated dependency-cruiser config so `src/core/orchestrator.ts` is the explicit composition-root exception for concrete bot wiring.

Boundary status after v18.2-D:

- `npm run audit:architecture`: 0 boundary findings.
- `npm run audit:boundaries`: 0 errors, 0 warnings.
- `npm run audit:circular`: no circular dependencies.

No runtime behavior was intentionally changed. Bot ids, enabled-config filtering, registration order, and start/stop delegation remain covered by the BotManager test.

## v18.2-E Enforced Dependency Boundaries

Promoted selected dependency-cruiser rules from warning to error after v18.2-D reached 0 boundary warnings and 0 circular imports.

Rules now enforced as errors:

- `no-circular-imports`
- `types-stay-foundational`
- `utils-do-not-import-core`
- `strategies-do-not-import-runtime-layers`
- `roles-do-not-import-streams-or-bots`
- `runtime-does-not-import-legacy`
- `core-does-not-import-concrete-bots`
- `engines-do-not-import-bots-or-strategies`

Exceptions kept:

- `src/core/orchestrator.ts` may import concrete bot implementations because it is the composition root that wires runtime dependencies.
- `src/engines/backtestEngine.ts` remains the only allowed `src/**` bridge to `legacy/**`, because backtests are the legacy compatibility boundary.

Removed obsolete baseline warning rules:

- `state-store-config-loader-baseline`
- `bot-manager-concrete-bot-baseline`

Current enforced boundary status:

- `npm run audit:boundaries`: 0 errors, 0 warnings.
- `npm run audit:architecture`: 0 boundary findings.
- `npm run audit:circular`: no circular dependencies.

Dependency boundaries are now enforced rather than only reported as a warning baseline.

## v18.2-F Execution Result Contracts And Error Taxonomy V1

Replaced ambiguous `ExecutionEngine` open/close `null` outcomes with explicit discriminated result objects.

Error shape:

```typescript
export interface TradingError {
  kind: "execution" | "invariant" | "strategy" | "config" | "market_data";
  code: string;
  message: string;
  recoverable: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}
```

Execution result shapes:

```typescript
export type ExecutionOpenResult =
  | { ok: true; order: OrderRecord; position: PositionRecord }
  | { ok: false; error: ExecutionError };

export type ExecutionCloseResult =
  | { ok: true; closedTrade: ClosedTradeRecord; order: OrderRecord }
  | { ok: false; error: ExecutionError };
```

Old `null` cases and new codes:

- Open rejected by minimum quantity: `quantity_below_minimum`
- Open rejected by minimum notional: `notional_below_minimum`
- Close rejected because no position exists: `position_not_found`
- Existing coordinator fallback still maps unknown execution rejects to `execution_open_rejected`

Caller updates:

- `OpenAttemptCoordinator` unwraps `ExecutionOpenResult` and keeps existing `execution_quantity_below_minimum`, `execution_notional_below_minimum`, and `execution_open_rejected` block reasons.
- `TradingBot` unwraps `ExecutionCloseResult`; close rejection telemetry now records the structured execution error code/kind/message instead of `close_position_returned_null`.

Runtime behavior was not intentionally changed. Open failure still does not create a position, close failure still does not mutate state or append a closed trade, and close accounting formulas were not changed.

## v18.2-G Error Taxonomy V2

Extended the plain-object error taxonomy with minimal helper constructors. No class hierarchy was added.

Helper shapes:

```typescript
createConfigError(code, message, context?, cause?)
createStrategyError(code, message, context?, cause?)
createInvariantError(code, message, context?, cause?)
```

All helpers return `Error` objects augmented with the discriminated fields:

- `kind`
- `code`
- `message`
- `recoverable`
- `context`
- `cause`

Converted ConfigError points in `ConfigLoader`:

- `unsupported_execution_mode`: `executionMode=live`
- `invalid_execution_mode`: non-paper/non-live execution mode values
- `unsupported_market_mode`: non-live market mode values

Converted StrategyError behavior:

- `TradingBot` wraps `strategy.evaluate` failures with `kind="strategy"` and `code="strategy_evaluate_failed"`.
- The original thrown error is preserved as `cause`.
- Safe hold behavior remains unchanged with `reason=["strategy_error"]`.
- Logs now include `errorKind`, `errorCode`, `errorMessage`, and `recoverable`.

Converted InvariantError point:

- `ContextBuilder.createSnapshot` missing/non-finite `observedAt` now throws `kind="invariant"` and `code="context_observed_at_invalid"`.

Future taxonomy targets:

- Convert remaining `ConfigLoader` direct validation throws incrementally when tests need structured codes.
- Convert narrowly scoped `StrategyError` cases in strategy registry/module loading.
- Convert local state invariants only where callers benefit from structured handling.

## v18.2-H State Machine Selectors V1

Introduced pure derived state selectors without changing `StateStore` persistence shape and without wiring them into `TradingBot`.

Selector module:

- `src/domain/stateSelectors.ts`

Derived state types:

```typescript
type PositionState = "flat" | "open_active" | "open_managed_recovery" | "exiting";
type BotLifecycleView = "idle" | "running" | "paused" | "stopped";
type EntryGuardState =
  | "open_allowed"
  | "cooldown_block"
  | "post_loss_latch_block"
  | "manual_pause_block"
  | "kill_switch_block"
  | "market_data_block"
  | "drawdown_block"
  | "strategy_error_block";
```

Selectors/helpers added:

- `derivePositionState(position)`
- `deriveBotLifecycleView(botState)`
- `deriveEntryGuardState({ botState, now, marketDataFreshness?, portfolioKillSwitch? })`
- `assertValidPositionState(position)`
- `assertValidBotLifecycleView(botState)`

Invariants encoded:

- `null` position derives `flat`.
- `managed_recovery` position requires finite `managedRecoveryStartedAt`.
- `paused` bot requires `pausedReason`.
- non-paused bot must not preserve `pausedReason`.
- active cooldown derives `cooldown_block`.
- active post-loss latch derives `post_loss_latch_block`.
- portfolio kill switch blocking entries derives `kill_switch_block`.
- non-fresh market data derives `market_data_block`.
- `max_drawdown_reached` pause derives `drawdown_block`.
- last `strategy_error` reason derives `strategy_error_block`.

Tests added:

- `tests/stateSelectors.test.js`

No runtime behavior was intentionally changed. This patch is selector/test/documentation-first.

## v18.2-I Contract Tests V1

Added first-layer contract tests between major runtime boundaries. These tests assert behavior-level inputs, outputs, and observable state rather than implementation details.

Contract test files added:

- `tests/contracts/execution.contract.test.js`
- `tests/contracts/stateStore.contract.test.js`
- `tests/contracts/strategy.contract.test.js`

Boundaries covered:

- `ExecutionEngine`:
  - valid open returns `ok:true` and creates one observable open position.
  - rejected open returns `ok:false` with `kind="execution"` and stable code `quantity_below_minimum`.
  - valid close returns `ok:true`, clears the open position, and records exactly one closed trade through `StateStore`.
  - missing-position close returns `ok:false` with code `position_not_found` and does not mutate the system snapshot.
- `StateStore`:
  - read-like methods do not mutate the observable system snapshot.
  - paused state without `pausedReason` is sanitized.
  - valid paused state preserves `pausedReason`.
  - non-paused state clears `pausedReason`.
  - re-registration preserves valid runtime fields such as pause, loss streak, and realized PnL.
  - stale symbol eviction preserves symbols protected by registered bots.
- Active strategies:
  - `breakout`, `emaCross`, and `rsiReversion` return a valid decision object.
  - action is one of `buy`, `hold`, or `sell`.
  - confidence is finite and within `[0, 1]`.
  - `evaluate(context)` does not mutate its input context.

State selectors are used where helpful:

- `derivePositionState`
- `deriveBotLifecycleView`
- `assertValidBotLifecycleView`

TradingBot entry/exit contract gap:

- No new high-level `TradingBot` contract test was added in this patch to avoid duplicating the already broad `tests/tradingBot.test.js` coverage.
- Existing `TradingBot` tests already cover successful entries, rejected/blocked entries, strategy errors, exits, cooldown, post-loss latch, and market-data blocks.
- A future contract pass can extract one or two stable high-level scenarios if `TradingBot` is split later.

No runtime behavior, persistence shape, or `TradingBot` structure was intentionally changed.

## v18.2-J Config Schema Validation V1

Started moving `ConfigLoader` validation toward schema-like parsing without adding a runtime dependency and without changing accepted/rejected config semantics.

Validation groups audited in `src/core/configLoader.ts`:

- `executionMode` / `marketMode`
- bot list, known strategies, risk profiles, `allowedStrategies`, risk overrides, duplicate enabled symbols
- runtime timing values: architect warmup/publish interval, post-loss latch, symbol retention, user stream timeout
- portfolio kill-switch config
- market stream config
- historical preload/bootstrap config
- MTF config

Chosen approach:

- Internal schema helpers for v1.
- Zod was not added. The current package keeps runtime dependencies narrow (`ccxt`, `dotenv`), and adding a schema dependency for one small slice would be broader than this patch needs.
- Zod remains a future option if config validation expands enough to justify a dedicated parser dependency.

Schema helper added:

- `src/types/configSchema.ts`

Helper shape:

```typescript
const DEFAULT_RUNTIME_MODES = {
  executionMode: "paper",
  marketMode: "live"
};

parseRuntimeModeConfig(config)
```

Converted validation group:

- `executionMode` / `marketMode`

Stable `ConfigError` codes for this slice:

- `unsupported_execution_mode`
- `invalid_execution_mode`
- `unsupported_market_mode`

Compatibility notes:

- `ConfigLoader.loadBotsConfig()` still returns the loaded config object without injecting default fields, preserving existing config shape.
- `parseRuntimeModeConfig({})` makes runtime defaults explicit for the schema layer: `paper` execution and `live` market data.
- Existing human-readable messages were preserved for converted validation paths.
- `allowedStrategies` base-strategy validation remains manual and covered by tests.

Remaining validation groups:

- bot schema and risk override schema
- portfolio kill-switch schema
- market stream schema
- historical preload/bootstrap schema
- MTF schema
- runtime timing schema

## v18.2-K Config Schema Validation V2

Moved portfolio kill-switch validation into the internal schema-helper approach without adding Zod and without changing accepted/rejected config semantics.

Schema helper extended:

- `src/types/configSchema.ts`

Helper shape:

```typescript
const DEFAULT_PORTFOLIO_KILL_SWITCH_CONFIG = {
  enabled: false,
  maxDrawdownPct: 0,
  mode: "block_entries_only"
};

parsePortfolioKillSwitchConfig(config)
```

Converted validation group:

- `portfolioKillSwitch`

Current semantics preserved:

- Missing `portfolioKillSwitch` still preserves the loaded config shape; `ConfigLoader.loadBotsConfig()` does not inject defaults.
- The schema helper exposes current runtime defaults: disabled, `maxDrawdownPct=0`, `mode="block_entries_only"`.
- If present, `portfolioKillSwitch` must be a plain object.
- `enabled`, if present, must be boolean.
- `maxDrawdownPct`, if present, must be finite and greater than `0`.
- `mode`, if present, must be one of `VALID_PORTFOLIO_KILL_SWITCH_MODES`.
- Valid configured values are accepted without changing the returned config shape.

Stable `ConfigError` codes for this slice:

- `invalid_portfolio_kill_switch`
- `invalid_portfolio_kill_switch_enabled`
- `invalid_portfolio_kill_switch_max_drawdown`
- `invalid_portfolio_kill_switch_mode`

Remaining validation groups:

- bot schema and risk override schema
- market stream schema
- historical preload/bootstrap schema
- MTF schema
- runtime timing schema

## v18.2-L Any Reduction Pass 1

Reduced explicit `any` at raw external payload boundaries without changing WebSocket/feed semantics, `TradingBot`, or backtest.

Files touched:

- `src/core/wsManager.ts`
- `src/streams/userStream.ts`
- `src/streams/marketStream.ts`

Before/after explicit `any` counts:

- Total: `301` -> `268`
- `src/core/wsManager.ts`: `32` -> `16`
- `src/streams/userStream.ts`: `16` -> `6`
- `src/streams/marketStream.ts`: `15` -> `8`

Boundary categories converted:

- raw WebSocket message payloads
- JSON.parse payloads
- Binance trade/kline/user event payload reads
- user stream remote events and listen-key JSON payload
- REST ticker/OHLCV rows
- error objects in boundary catch blocks
- WebSocket status payloads consumed by market/user streams

Local helper shapes added:

```typescript
isRecord(value): value is Record<string, unknown>
getField(source, field)
getErrorMessage(error)
readString(value)
```

Behavior compatibility notes:

- malformed WebSocket JSON still logs `ws_message_parse_failed` and is ignored.
- market tick/kline timestamp and freshness logic were not intentionally changed.
- user stream event publish paths still forward normalized events.
- REST fallback normalization still accepts the same ticker/OHLCV shapes.
- remaining `any` in these files is mostly internal dependency seams (`store`, `logger`, fake exchange/socket types), generic listener signatures, or internal connection state and was intentionally deferred.

## v18.2-M Config Schema Validation V3

Moved top-level runtime timing validation into the internal schema-helper approach without adding Zod and without changing accepted/rejected config semantics.

Schema helper extended:

- `src/types/configSchema.ts`

Helper shape:

```typescript
const DEFAULT_RUNTIME_TIMING_CONFIG = {
  architectPublishIntervalMs: 30_000,
  architectWarmupMs: 30_000,
  postLossLatchMaxMs: null,
  postLossLatchMinFreshPublications: 2,
  symbolStateRetentionMs: 30 * 60 * 1000,
  userStreamRequestTimeoutMs: 10_000
};

parseRuntimeTimingConfig(config)
```

Converted top-level timing fields:

- `architectWarmupMs`: finite number, minimum `5_000`
- `architectPublishIntervalMs`: finite number, minimum `5_000`
- `postLossLatchMaxMs`: finite number, minimum `1`
- `postLossLatchMinFreshPublications`: finite number, minimum `1`
- `symbolStateRetentionMs`: finite number, minimum `60_000`
- `userStreamRequestTimeoutMs`: finite number, minimum `1`

Semantics preserved:

- Missing values are not injected into `ConfigLoader.loadBotsConfig()` output.
- Numeric strings remain accepted through `Number(value)`, matching previous validation.
- `0`, negative, below-minimum, `null`, and non-finite values are rejected according to the same existing thresholds.
- `market.liveEmitIntervalMs` remains in the market config validation group and was not converted in this slice.
- Bot-level `postLossLatchMaxMs` remains in bot validation and was not converted in this slice.

Stable `ConfigError` codes for this slice:

- `invalid_architect_warmup_ms`
- `invalid_architect_publish_interval_ms`
- `invalid_post_loss_latch_max_ms`
- `invalid_post_loss_latch_min_fresh_publications`
- `invalid_symbol_state_retention_ms`
- `invalid_user_stream_request_timeout_ms`

Remaining config validation groups:

- bot schema and risk override schema
- market stream schema
- historical preload/bootstrap schema
- MTF schema

## v18.2-N Any Reduction Pass 2

Reduced explicit `any` usage in `src/core/systemServer.ts` by typing API payload boundaries and local dashboard projections without changing API response shape.

Files touched:

- `src/core/systemServer.ts`
- `docs/ai/v18.2-baseline.md`

Before/after explicit `any` counts:

- Total: `268` -> `195`
- `src/core/systemServer.ts`: `73` -> `0`

Local helper/type shapes added:

```typescript
interface HttpRequestLike
interface HttpResponseLike
interface HttpServerLike
interface SystemPayload
interface BotPayload
interface PositionPayload
interface TradePayload
interface ChartMarkerPayload
isRecord(value): value is Record<string, unknown>
```

Boundary categories converted:

- HTTP request/response/server boundary
- `/api/system` payload projection
- `/api/positions` position projection
- `/api/trades` trade projection
- `/api/chart` line/candle/marker projection
- `/api/pulse` and pulse SSE helper projections
- system snapshot, bot snapshot, price snapshot, event, trade, kline, and performance history callbacks already backed by store types

Behavior compatibility notes:

- `/api/system`, `/api/positions`, `/api/trades`, `/api/chart`, `/api/pulse`, and `/api/pulse/stream` response shapes were not intentionally changed.
- Reset endpoints keep the same status codes and payload fields.
- No `TradingBot`, backtest, or execution logic was touched.
- Remaining project-wide `any` is concentrated in `TradingBot`, coordinator/runtime internals, telemetry payloads, and a few external payload seams outside this pass.

## v18.2-O Contract Policy And Any Hotspot Metrics

Added `docs/CONTRACT.md` as the current runtime contract policy for future refactors.

Documented error policies:

- `InvariantError`: non-recoverable programmer/state contract violation; must not be swallowed silently; currently fail-fast unless caught at a top-level boundary.
- `StrategyError`: recoverable per tick; `strategy.evaluate(...)` failures produce structured `StrategyError` metadata, safe hold / `strategy_error`, and must not open a position. Consecutive strategy evaluation failures now pause the bot with `pausedReason="repeated_strategy_error"`.
- `ExecutionError`: discriminated `ExecutionEngine` result with `ok:false`; failed execution results must not mutate authoritative state.
- `ConfigError`: startup/config validation failure; non-recoverable until config is fixed.
- `MarketDataError` / `ExchangeError`: future taxonomy targets; must not be mapped to `ExecutionError` by default.

Documented boundary contracts:

- `Strategy.evaluate`
- `ExecutionEngine` open/close
- `StateStore` read/update
- market freshness / `EntryGuardState`
- `ConfigLoader`
- `UserStream` / WS events

Contract test gaps closed:

- `tests/contracts/execution.contract.test.js` now asserts a rejected open leaves balance and the observable `StateStore` snapshot unchanged.
- `tests/stateSelectors.test.js` now asserts degraded market data derives `EntryGuardState = "market_data_block"` in addition to stale market data.
- Existing contract and TradingBot tests already covered missing-position close without mutation and throwing strategy safe-hold/no-open behavior, so no duplicate high-level TradingBot contract test was added.

`scripts/audit-any.js` now reports hotspot-oriented metrics in addition to total count:

- total explicit `any`
- category counts
- top files by any count
- top files by any density when line count is available
- files above hotspot threshold
- current top offenders
- risk labels: `hotspot`, `watchlist`, `low`

Hotspot threshold policy:

- `hotspot`: more than 20 explicit `any` in one file
- `watchlist`: 10-20 explicit `any` in one file
- `low`: fewer than 10 explicit `any` in one file

Current `npm run audit:any` result:

- Total explicit `any`: 195
- `src/core/systemServer.ts`: 0

Current top offenders by explicit `any` count:

| File | Count | Density | Risk |
| --- | ---: | ---: | --- |
| `src/bots/tradingBot.ts` | 59 | 3.19 any/100 lines | hotspot |
| `src/roles/exitDecisionCoordinator.ts` | 20 | 4.91 any/100 lines | watchlist |
| `src/core/wsManager.ts` | 16 | 2.50 any/100 lines | watchlist |
| `src/core/architectService.ts` | 14 | 2.58 any/100 lines | watchlist |
| `src/core/orchestrator.ts` | 14 | 2.54 any/100 lines | watchlist |

Current density offenders:

| File | Count | Density | Risk |
| --- | ---: | ---: | --- |
| `src/core/strategyRegistry.ts` | 4 | 5.88 any/100 lines | low |
| `src/core/mtfContextService.ts` | 6 | 4.96 any/100 lines | low |
| `src/roles/exitDecisionCoordinator.ts` | 20 | 4.91 any/100 lines | watchlist |
| `src/core/contextService.ts` | 9 | 4.25 any/100 lines | low |
| `src/core/historicalBootstrapService.ts` | 13 | 3.51 any/100 lines | watchlist |

Only one file currently exceeds the hotspot threshold:

- `src/bots/tradingBot.ts`: 59 explicit `any`

## v18.2-S Position/Order Transition Contracts

Added pure transition contracts without changing runtime behavior or `StateStore` persistence shape.

Files added/updated:

- `src/domain/stateTransitions.ts`
- `tests/contracts/stateTransitions.contract.test.js`
- `tests/run-tests.js`
- `docs/CONTRACT.md`

Transition helper surface:

```typescript
canTransitionPosition(from, to)
assertPositionTransition(from, to)
canTransitionOrder(from, to)
assertOrderTransition(from, to)
```

Position states remain the existing derived selector states:

- `flat`
- `open_active`
- `open_managed_recovery`
- `exiting`

Allowed observable position transitions:

- `flat -> open_active`
- `open_active -> open_managed_recovery`
- `open_active -> exiting`
- `open_active -> flat`
- `open_managed_recovery -> exiting`
- `open_managed_recovery -> flat`
- `exiting -> flat`

Order states are minimal because `OrderRecord` does not currently persist a lifecycle status:

- `created`
- `opened`
- `closed`
- `rejected`

Allowed order transitions:

- `created -> opened`
- `created -> closed`
- `created -> rejected`
- `opened -> closed`

Contract tests added:

- allowed position transitions pass
- invalid position transitions throw structured `InvariantError`
- managed recovery transition requires finite `managedRecoveryStartedAt`
- closing from `flat` is invalid
- opening from non-flat is invalid
- allowed order transitions pass
- terminal order states cannot reopen

Runtime compatibility notes:

- No runtime mutation path was rewired.
- `StateStore` persistence shape was not changed.
- `TradingBot`, backtest, and strategy logic were not touched.
- These helpers are contract rails only. They are not fully wired runtime guardrails across every execution/user-stream/state-store mutation boundary.

## Suggested Next Stage

Proceed to the next narrow schema slice, likely market stream config or historical preload, then deeper state transition contracts using selectors and contract tests as read-only safety rails.
