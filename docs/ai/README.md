# AI Workflow Scaffold

`AGENT.md` remains the top-level constitution for this repository.

Use this folder for repo-specific execution guidance when planning audits, safe refactors, and small patch sets in the active paper-trading runtime.

Start here:

1. Read `AGENT.md`.
2. Read `docs/ai/project-map.md`.
3. Read `docs/ai/priorities.md`.
4. Read the relevant files under `docs/ai/rules/`.
5. Follow the matching playbook under `docs/ai/playbooks/`.

Default operating assumptions:

- Preserve current runtime behavior unless the task explicitly requests a semantic change.
- Treat `src/core/stateStore.ts` as the in-memory source of truth.
- Keep `TradingBot` as orchestrator, not a dumping ground for extracted logic.
- Do not reintroduce strategy-name branching into `src/bots/tradingBot.ts`.
- Do not move `architectCoordinator`, latch logic, telemetry shaping, or outcome shaping back into `TradingBot`.
- Keep paper-trading safety intact. The current runtime already rejects live execution.

Primary use cases:

- architecture audit
- patch planning before touching behavior-sensitive paths
- runtime safety review
- UI/dashboard fixes that avoid collateral damage in core trading paths
