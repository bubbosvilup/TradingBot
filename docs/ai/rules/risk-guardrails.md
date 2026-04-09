# Risk Guardrails

This is a paper-trading runtime, but runtime safety still matters.

Guardrails:

- Preserve the current rejection of live order routing.
- Treat `allow_small_loss_floor05` as quarantined experiment scope, not default behavior.
- Do not weaken managed recovery exits, protective exits, or invalidation paths without explicit approval.
- Do not silently change entry/exit thresholds, hold times, publish cadence, cooldowns, or fee assumptions.
- Do not hide risk changes inside UI or telemetry patches.

Required review questions for risk-sensitive patches:

- Does this expand trading eligibility?
- Does this delay or suppress an exit?
- Does this bypass Architect usability or latch protection?
- Does this alter economics or net-PnL qualification?
- Does this create a path that can look paper-safe but behave more aggressively?

Escalate patch review if any answer is yes.

Explicit warnings:

- Do not reintroduce ad hoc strategy-name conditionals to special-case risk.
- Do not push managed recovery coordination back into `TradingBot`.
- Do not merge experiment behavior into baseline config without quarantine language and tests.
