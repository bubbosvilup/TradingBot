# Price-Series Hot-Path Audit

---

## 1. Current Price-Series Hot-Path Map

```
TICK FIRES → both ContextService.observe() AND TradingBot.onMarketTick() subscribe
to the same marketStream. Each runs independently in the same tick:

┌── PATH A: ContextService.observe() (Architect pipeline) ──────────┐
│                                                                    │
│  store.getPriceHistory(symbol)        → full MarketTick[]          │
│  ticks.filter(windowStart)           → time-windowed ticks        │
│  effectiveTicks (post-switch segment)→ possibly smaller tick subset│
│                                                                    │
│  ContextBuilder.createSnapshot():                                  │
│    rollingPrices = ticks.map(t→price)       ◄─── DERIVATION #1    │
│    rollingTimestamps = ticks.map(t→ts)                             │
│    … compute rollingMaturity …                                     │
│                                                                    │
│    effectiveTicks = usePostSwitchSegment ? requested : ticks       │
│    prices = effectiveTicks.map(t→price)     ◄─── DERIVATION #2    │
│    timestamps = effectiveTicks.map(t→ts)                           │
│    … compute all features from prices[] …                          │
│                                                                    │
│  Result: ContextSnapshot stored in store.setContextSnapshot()      │
│  (This contextSnapshot is later READ by TradingBot, not derived)   │
└────────────────────────────────────────────────────────────────────┘

┌── PATH B: TradingBot.onMarketTick() (Strategy decision pipeline) ─┐
│                                                                    │
│  prepareTickSnapshot()       → no price extraction                 │
│  applyArchitectTickPhase()   → reads stored contextSnapshot        │
│                              → does NOT derive prices              │
│                                                                    │
│  evaluateTickDecision():                                           │
│    buildContext(tick):                                             │
│      getRecentPrices(120)    ◄─── DERIVATION #3                   │
│        = history.slice(-120).map(t→t.price)                        │
│        → new number[], up to 120 elements                          │
│                                                                    │
│      indicatorEngine.createSnapshot(priceSeries)                   │
│        → ema×3, rsi, momentum, volatility all iterate same array   │
│                                                                    │
│      regimeDetector.detect(priceSeries)                            │
│        → prices.slice(-20)  ◄─── DERIVATION #4 (small array)      │
│                                                                    │
│      Return context with context.prices = priceSeries (same ref)   │
│                                                                    │
│    strategy.evaluate(context)                                      │
│      → may do context.prices.slice(-lookback) (strategy-specific)  │
│                                                                    │
│  handleEntryTick()  → reads context, no new price extraction       │
│  handleExitTick()   → reads context, no new price extraction       │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Confirmed Repeated Price-Series Extraction Work

### CONFIRMED — ContextBuilder double-maps prices (DERIVATION #1 and #2)

**File:** `src/roles/contextBuilder.ts`, lines 40 and 54

```typescript
// Line 40 — first map, used only for rolling window metadata
const rollingPrices = ticks.map((tick) => Number(tick.price));

// Line 54 — second map
// When usePostSwitchSegment is FALSE (common case, no recent regime switch):
//   effectiveTicks === ticks (same reference)
// So this re-iterates the exact same ticks to produce the same number[]
const prices = effectiveTicks.map((tick) => Number(tick.price));
```

**Impact:** Two separate `.map()` passes over the same data, producing two separate `number[]`
arrays with identical content. The first array (`rollingPrices`) is used only for:
- `rollingMaturity` calculation (line 45)
- The returned snapshot's `rollingMaturity` and `rollingSampleSize` fields

**When this fires:** Every tick where `observe()` is called and ticks.length > 0. The double-map
waste occurs when there is no post-switch segment, which is the normal operating mode.

**Confidence level:** CONFIRMED from code

### CONFIRMED — regimeDetector allocates a slice from priceSeries (DERIVATION #4)

**File:** `src/roles/regimeDetector.ts`, lines 10-12

```typescript
const start = prices[Math.max(0, prices.length - 20)];
const end = prices[prices.length - 1];
const slope = start > 0 ? ((end - start) / start) * 100 : 0;
const window = prices.slice(-20);  // ← allocates new array of 20 numbers
```

**Impact:** Allocates a new `number[20]` from the already-derived 120-element priceSeries on
every tick. This is inside one `buildContext()` call, so the 120-element series itself is not
re-derived — but the regime detector creates its own window slice.

**Could this reuse the original array?** Most regimeDetector operations use direct index access
(`prices[Math.max(0, prices.length - 20)]`), not the slice. The slice is only used for
`Math.max(...window)` and `Math.min(...window)`.

**Confidence level:** CONFIRMED from code

### CONFIRMED — getRecentPrices(120) allocates a new array each call (DERIVATION #3)

**File:** `src/core/stateStore.ts`, lines 332-334

```typescript
getRecentPrices(symbol: string, limit: number = 120): number[] {
  const history = this.prices.get(symbol)?.history || [];
  return history.slice(-limit).map((tick) => tick.price);
}
```

Every invocation creates a new `number[]` via `.map()`. There is no caching or memoization.

**Confidence level:** CONFIRMED from code

---

## 3. Necessary vs Unnecessary Repeated Derivation

| # | Derivation | Location | Result | Necessary? | Analysis |
|---|-----------|----------|--------|------------|----------|
| 1 | `ticks.map(t→price)` → rollingPrices | contextBuilder.ts:40 | number[] from time-windowed ticks | **NO — can reuse** | Only used for rollingMaturity. When usePostSwitchSegment is false, this is entirely redundant with line 54's `prices` map. |
| 2 | `effectiveTicks.map(t→price)` → prices | contextBuilder.ts:54 | number[] from effective window | **YES** | This is the primary price array for all feature calculations. |
| 3 | `getRecentPrices(120)` → priceSeries | tradingBot.ts:244 | number[] from count window | **YES** | Count-windowed (120), different from ContextBuilder's time window. No sharing possible without changing semantics. |
| 4 | `prices.slice(-20)` → window | regimeDetector.ts:13 | number[20] | **NO — can avoid** | Direct index access already used for slope. `Math.max(...prices)` and `Math.min(...prices)` works on the full array; last-20 can be computed via index loops without allocating a slice. |

### Breakdown:

**Unnecessary (candidate for removal):**
- **ContextBuilder rollingPrices double-map (DERIVATION #1):** When `!usePostSwitchSegment`, `rollingPrices` and `prices` are identical. The rolling window metadata (rollingMaturity, rollingSampleSize) can be computed from `prices` directly after it's derived.
- **RegimeDetector.slice(-20) (DERIVATION #4):** The slice allocates a new array unnecessarily. Index-based access to the last 20 elements of the already-derived prices array avoids allocation.

**Necessary (cannot be removed without changing semantics):**
- **getRecentPrices(120) (DERIVATION #3):** Unique count-window. Not derivable from ContextBuilder's time-windowed result without changing the formula.
- **prices from effectiveTicks (DERIVATION #2):** Primary feature array. The effective window may differ from the rolling window (post-switch segment), so both derivations exist, but the rolling one is redundant when no post-switch is active.

---

## 4. Smallest Safe Patch

### Patch 1: Eliminate ContextBuilder rollingPrices double-map

**File:** `src/roles/contextBuilder.ts`

**Current code (lines 36-64):**
```typescript
if (ticks.length <= 0) {
  return this.createEmptySnapshot(params.symbol, params.dataMode, observedAt);
}

const rollingPrices = ticks.map((tick) => Number(tick.price));
const rollingTimestamps = ticks.map((tick) => Number(tick.timestamp));
const rollingLatestTimestamp = rollingTimestamps[rollingTimestamps.length - 1];
const rollingOldestTimestamp = rollingTimestamps[0];
const windowSpanMs = Math.max(0, rollingLatestTimestamp - rollingOldestTimestamp);
const rollingMaturity = clamp(windowSpanMs / params.maxWindowMs, 0, 1);
const warmupComplete = windowSpanMs >= params.warmupMs;
const hasPublishedRegimeSwitch = params.lastPublishedRegimeSwitchAt !== null
  && params.lastPublishedRegimeSwitchAt !== undefined
  && Number.isFinite(Number(params.lastPublishedRegimeSwitchAt));
const usePostSwitchSegment = hasPublishedRegimeSwitch
  && requestedEffectiveTicks.length > 0
  && requestedEffectiveTicks.length < ticks.length;
const effectiveTicks = usePostSwitchSegment ? requestedEffectiveTicks : ticks;
const prices = effectiveTicks.map((tick) => Number(tick.price));
const timestamps = effectiveTicks.map((tick) => Number(tick.timestamp));
```

**Proposed change:** Defer the full tick→price mapping. Compute rolling window metadata from
tick objects directly, then map prices once:

```typescript
// No rollingPrices map. Use ticks directly for timestamps.
const rollingLatestTimestamp = Number(ticks[ticks.length - 1].timestamp);
const rollingOldestTimestamp = Number(ticks[0].timestamp);
const windowSpanMs = Math.max(0, rollingLatestTimestamp - rollingOldestTimestamp);
const rollingMaturity = clamp(windowSpanMs / params.maxWindowMs, 0, 1);
const warmupComplete = windowSpanMs >= params.warmupMs;

const hasPublishedRegimeSwitch = params.lastPublishedRegimeSwitchAt !== null
  && params.lastPublishedRegimeSwitchAt !== undefined
  && Number.isFinite(Number(params.lastPublishedRegimeSwitchAt));
const usePostSwitchSegment = hasPublishedRegimeSwitch
  && requestedEffectiveTicks.length > 0
  && requestedEffectiveTicks.length < ticks.length;
const effectiveTicks = usePostSwitchSegment ? requestedEffectiveTicks : ticks;
const prices = effectiveTicks.map((tick) => Number(tick.price));
const timestamps = effectiveTicks.map((tick) => Number(tick.timestamp));
```

The only reference to `rollingPrices` in the rest of the function is the returned
`rollingSampleSize` field, which can use `ticks.length` instead. This eliminates one full
`.map()` pass and one `number[]` allocation per tick.

**Change summary:**
- Remove: `const rollingPrices = ticks.map((tick) => Number(tick.price));`
- Change: `rollingLatestTimestamp` / `rollingOldestTimestamp` to read from ticks directly
- `rollingSampleSize` in return already uses `ticks.length`

### Patch 2: Eliminate regimeDetector's slice(-20) allocation

**File:** `src/roles/regimeDetector.ts`

**Current code:**
```typescript
const start = prices[Math.max(0, prices.length - 20)];
const end = prices[prices.length - 1];
const slope = start > 0 ? ((end - start) / start) * 100 : 0;
const window = prices.slice(-20);
const max = Math.max(...window);
const min = Math.min(...window);
```

**Proposed change:**
```typescript
const window = Math.min(prices.length, 20);
const offset = prices.length - window;
let max = -Infinity;
let min = Infinity;
for (let i = offset; i < prices.length; i++) {
  const p = prices[i];
  if (p > max) max = p;
  if (p < min) min = p;
}
const start = prices[offset];
const end = prices[prices.length - 1];
const slope = start > 0 ? ((end - start) / start) * 100 : 0;
const rangePct = min > 0 ? ((max - min) / min) * 100 : 0;
```

This avoids allocating `number[20]` on every tick. The loop replaces `Math.max(...)` /
`Math.min(...)` spread which would fail on very large arrays anyway.

---

## 5. Behavior Risks

| Risk | Level | Detail |
|------|-------|--------|
| **Patch 1 semantics drift** | LOW | `rollingPrices` was derived from `ticks` in original iteration order. If `rollingPrices` was used anywhere in feature calculations, removing it would change values. Verified: it is NOT used in feature calculations — only for `rollingMaturity` which depends on timestamps, not prices. The returned `rollingSampleSize` already uses `ticks.length`. No behavior change. |
| **Patch 2 floating-point precision** | NONE | Index-based iteration produces identical values. The `slice(-20)` and the loop both access the same elements `prices[offset..N-1]`. Spread `Math.max(...window)` and loop-based max produce the same result. |
| **Temporal inconsistency between paths** | LOW (existing, not new) | ContextService.observe() and TradingBot.onMarketTick() both receive the same tick from the market stream but run independently. If observe() runs first, ContextBuilder's time-window may include the new tick while TradingBot's getRecentPrices(120) reads the same tick since it was already stored. This is existing behavior and both paths see consistent data. |
| **getRecentPrices(120) not shareable** | LOW | The count-window (120) and time-window (ContextBuilder) produce different arrays. Reusing one from the other would change the window semantics. These are legitimately separate. |

---

## 6. Final Recommendation

**Two small, safe patches are confirmed and actionable:**

### Recommended (Patch 1 — ContextBuilder double-map):
**File:** `src/roles/contextBuilder.ts`
- **What:** Remove the `rollingPrices = ticks.map(t→price)` map at line 40
- **Why:** When there is no post-switch segment (common case), this produces an identical array to `prices` at line 54, wasting one `.map()` iteration and one allocation per tick
- **Impact:** Saves ~N operations and ~N×8 bytes allocation per tick (where N = tick count in time window, typically 100-300+)
- **Risk:** None — `rollingPrices` is not used in feature calculations

### Recommended (Patch 2 — regimeDetector slice):
**File:** `src/roles/regimeDetector.ts`
- **What:** Replace `prices.slice(-20)` allocation with index-based max/min loop
- **Why:** Avoids allocating a new `number[20]` array on every tick for a value computed once
- **Impact:** Eliminates one small allocation per tick; spread-to-loop also removes call stack risk on large arrays
- **Risk:** None — produces identical results

### NOT recommended (no duplication exists):
- `getRecentPrices(120)` is called **exactly once** per tick in `buildContext()` and the
  result is correctly reused by reference for indicatorEngine, regimeDetector, and context
  storage. No duplication to fix here.
- ContextBuilder's price derivation serves the Architect pipeline with time-windowing and
  post-switch segmentation. It is not interchangeable with TradingBot's count-windowed
  `getRecentPrices(120)`.