Run a runtime-safety review using:

- `docs/ai/rules/runtime-safety.md`
- `docs/ai/rules/risk-guardrails.md`
- `docs/ai/rules/testing.md`

Check startup mode handling, paper-only guarantees, store truth boundaries, managed recovery safety, authoritative exit-policy capability behavior, and paused-state coherence before proposing changes.
When proposing code changes, apply `AGENT.md` human-readable coding rules and avoid self-reported capability checks that do not prove behavior.
