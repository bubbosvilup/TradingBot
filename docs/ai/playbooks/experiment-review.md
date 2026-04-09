# Experiment Review

Use when reviewing config or runtime changes tied to experiments such as `allow_small_loss_floor05`.

Checklist:

1. Name the experiment and where it is activated.
2. State whether it is quarantined, defaulted, or leaking into baseline behavior.
3. Check config, runtime, telemetry, and reports for hidden coupling.
4. Verify whether the experiment changes entry qualification, exit timing, or recovery behavior.
5. Require a rollback path.

Current standing:

- `allow_small_loss_floor05` is an active experiment label in `src/data/bots.config.json`.
- Treat it as quarantine material under P0 until explicitly reviewed and promoted.

Reject changes that:

- make the experiment the implicit default
- remove the ability to distinguish experiment telemetry from baseline telemetry
- blur the line between experiment code and baseline risk controls
