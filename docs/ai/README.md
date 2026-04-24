# AI Workflow Scaffold

`AGENT.md` remains the top-level constitution for this repository.

Use this folder for repo-specific execution guidance when planning audits, safe refactors, and small patch sets in the active paper-trading runtime.

Start here:

1. Read `AGENT.md`.
2. Read `docs/ai/project-map.md`.
3. Read `docs/ai/priorities.md`.
4. Read the relevant files under `docs/ai/rules/`.
5. Follow the matching playbook under `docs/ai/playbooks/`.

All coding agents must apply the human-readable coding rules in `AGENT.md`. Do not copy the full rule block into every local instruction file; reference `AGENT.md` unless a task needs a narrower local constraint.

Default operating assumptions:

- Preserve current runtime behavior unless the task explicitly requests a semantic change.
- Treat `src/core/stateStore.ts` as the in-memory source of truth.
- Treat startup historical preload as bootstrap/store/history plumbing only: it seeds `StateStore` before observation, uses the same market source as `MarketStream`, and must not enter the hot tick path.
- Keep `TradingBot` as orchestrator, not a dumping ground for extracted logic.
- Do not reintroduce strategy-name branching into `src/bots/tradingBot.ts`.
- Keep exit semantics policy-driven:
  - use exit-policy capabilities instead of strategy-id coupling
  - disabled exit semantics must not still fire through a fallback path
- Do not move `architectCoordinator`, latch logic, telemetry shaping, or outcome shaping back into `TradingBot`.
- Keep paper-trading safety intact. The current runtime already rejects live execution.
- Keep Pulse UI work in `SystemServer` / `public/`; it is observability/control-surface presentation, not trading decision logic.
- Keep paused state coherent and runtime-authoritative:
  - paused bots must not reopen while paused
  - open positions may still close while paused
  - no persisted `paused` state without a non-empty `pausedReason`
- Keep launcher preparation in startup/UI/config plumbing; `Normal` / `Debug` selection and debug-capture field selection must not leak into trading decisions.
- Keep future debug `jsonl` capture deliberate:
  - append-only events for high-cardinality timelines
  - rolling latest-value snapshots/counters for numeric state that would otherwise explode log volume
- Preserve the current Architect/entry/exit consistency guards:
  - entry blocks on pending challenger hysteresis
  - managed-recovery invalidation has post-entry grace/confirmation
  - confirmed recovery target beats invalidation
  - RSI entry economics can resolve the target-distance cap, but `entryCoordinator` owns the final target-distance gate
  - MTF-disabled or absent diagnostics keep RSI behavior baseline-identical
- Preserve deterministic teardown for runtime/stream tests; do not hide late logs by global suppression when a stop/cleanup path should own the fix.

Primary use cases:

- architecture audit
- patch planning before touching behavior-sensitive paths
- runtime safety review
- UI/dashboard fixes that avoid collateral damage in core trading paths
- Pulse UI changes that preserve the existing static frontend model
- launcher/debug-capture planning that preserves runtime safety and keeps output schemas intentional
- roadmap planning:
  - v18.1 stays cleanup-only after stabilization
  - v19 owns modern replay/backtest parity
  - v20 owns futures/margin realism
  - v21 owns strategy lab and optimization discipline
