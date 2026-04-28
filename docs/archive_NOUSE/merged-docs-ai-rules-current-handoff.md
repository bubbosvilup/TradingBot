# Current Project Handoff

This is the current operational handoff for TradingBot.

Goal:
Keep the repo understandable, safe, and verifiable.

The bot must:
1. read the market;
2. build reliable state;
3. decide enter / exit / hold;
4. execute only through risk gates;
5. record what happened and why.

---

## Current Status

The active runtime is paper-only.

Pulse is the active operator UI.

Backtest/replay is not yet modern parity.
Legacy replay must not be treated as proof that live/runtime behavior is valid.

Short support exists in the paper runtime, but margin/futures realism is not complete.

The repo is now in a repo-humanization / Type Truth phase.

---

## Current Focus

v18.3 focus:

1. make the repo easier to understand;
2. restore truthful TypeScript types;
3. clarify ownership boundaries;
4. reduce `any`, casts, and hidden type lies;
5. make state ownership explicit;
6. make config/runtime boundaries safer;
7. preserve trading behavior unless explicitly changed.

---

## Hard Rules

Do not make the repo more abstract.

Do not invent internal frameworks.

Do not add coordinators if a function is enough.

Do not use `any`, `as any`, broad casts, or `!` to bypass TypeScript.

Do not change trading behavior silently.

Do not perform cosmetic refactors while touching trading logic.

Do not move architect, latch, outcome, entry, or exit logic back into `TradingBot`.

Do not let UI, launcher, debug capture, or reporting concerns influence trading decisions.

When uncertain, stop and ask.

---

## Known Dangerous Areas

- `StateStore` ownership and mutation rules
- `UserStream` vs `ExecutionEngine` ownership boundaries
- `TradingBot` becoming too large or too responsible
- raw external payloads entering runtime logic
- config drift between JSON, loader, runtime, and docs
- `require(...)` / CommonJS type blindness
- `any` and broad casts in runtime boundaries
- swallowed errors and fake-success reporting
- experiment behavior leaking into baseline behavior

---

## Current Experiments

`allow_small_loss_floor05` is quarantine material.

It must not become baseline behavior unless explicitly reviewed and promoted.

Any experiment must remain:
- visible
- reversible
- separately reported
- removable

---

## Do Not Do Next

- do not start modern backtest parity yet
- do not start margin/futures realism yet
- do not start strategy optimization yet
- do not redesign the runtime
- do not migrate everything to ESM as a first move
- do not segment `TradingBot` before contracts and boundaries are clear
- do not add new abstractions to “prepare” for future work

---

## Next Work Class

Before any code patch:

1. update repo doctrine docs;
2. update agent/AI instruction files;
3. update README to match the doctrine;
4. define v18.3 technical work only after documentation is aligned.

The next technical work should be small, proven, and behavior-preserving.