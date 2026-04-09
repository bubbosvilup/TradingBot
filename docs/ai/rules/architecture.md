# Architecture Rules

Non-negotiable:

- `AGENT.md` is the constitutional file. This folder extends it; it does not replace it.
- Keep `TradingBot` orchestration-focused.
- Prefer extracting or refining focused roles in `src/roles/` over enlarging `src/bots/tradingBot.ts`.

Do not do these regressions:

- Do not reintroduce strategy-name branching into `TradingBot`.
- Do not move extracted coordinator logic back into `TradingBot`.
- Do not move Architect interpretation or published-family logic back into `TradingBot`.
- Do not move latch state handling back into `TradingBot`.
- Do not move telemetry payload shaping back into `TradingBot`.
- Do not collapse dashboard concerns into runtime decision modules.

Expected ownership:

- `src/core/`: lifecycle/bootstrap/store/system composition
- `src/roles/`: focused policy, planning, gating, shaping, and coordination logic
- `src/bots/`: orchestration and execution sequencing
- `src/ui/` and `public/`: dashboard rendering/adapters only
- `tests/`: behavior locks for every non-trivial extraction

When planning a refactor:

- Name the responsibility being moved.
- Name the destination module that should own it.
- State what must remain stable externally: events, log fields, lifecycle semantics, thresholds, timing.
- Prefer incremental extraction over simultaneous redesign.

If a change touches `TradingBot`:

- ask whether the logic already belongs in an existing role
- extract before expanding inline branches
- keep method count and branch count moving down, not up
