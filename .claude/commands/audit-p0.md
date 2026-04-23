Run a P0 audit using `docs/ai/playbooks/audit-flow.md`, `docs/ai/priorities.md`, and the rules under `docs/ai/rules/`.

Focus first on:

- live-path segregation in `src/core/orchestrator.ts`
- `allow_small_loss_floor05` quarantine
- managed recovery breaker safety
- dashboard breakage without spilling into runtime logic
- exit-policy capability gating for RSI-threshold / price-target semantics
- paused-state coherence and explicit resume boundaries
