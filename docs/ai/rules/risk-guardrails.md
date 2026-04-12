# Risk Guardrails

This is a paper-trading runtime, but runtime safety still matters.

Guardrails:

- Preserve the current rejection of live order routing.
- Treat `allow_small_loss_floor05` as quarantined experiment scope, not default behavior.
- Do not weaken managed recovery exits, protective exits, or invalidation paths without explicit approval.
- Do not reintroduce single-mismatch managed-recovery invalidation for `family_mismatch`.
- Do not remove the post-entry grace/confirmation requirement for non-protective regime invalidation.
- Do not make invalidation outrank a confirmed recovery target unless the task explicitly changes recovery precedence.
- Do not remove `architect_challenger_pending` entry blocking without replacing it with an equivalent instability guard.
- Do not silently change entry/exit thresholds, hold times, publish cadence, cooldowns, or fee assumptions.
- Do not lower the `rsiReversion` edge floor or target-distance cap without test updates and explicit rationale.
- Do not widen the `rsiReversion` target-distance cap outside the MTF-enabled, coherent range-context path.
- Coherent MTF RSI cap widening requires enabled MTF, sufficient ready frames, `mtfMetaRegime === "range"`, present internal dominant frame, `mtfInstability <= 0.25`, and `mtfAgreement >= 0.75`.
- The only allowed MTF cap policy today is `short` = baseline, `medium` = `1.5x`, `long` = `2.0x`; disabled, unclear, unstable, insufficient, non-range, or missing-dominant context must remain baseline.
- Do not hide risk changes inside UI or telemetry patches.

Required review questions for risk-sensitive patches:

- Does this expand trading eligibility?
- Does this delay or suppress an exit?
- Does this bypass Architect usability or latch protection?
- Does this alter economics or net-PnL qualification?
- Does this bypass Architect challenger hysteresis at entry?
- Does this make recovery/invalidation ordering easier to trigger than entry?
- Does this change the target-distance gate or the resolved target-distance cap?
- Does this change MTF coherence thresholds or the RSI resolved cap policy?
- Does this create a path that can look paper-safe but behave more aggressively?

Escalate patch review if any answer is yes.

Explicit warnings:

- Do not reintroduce ad hoc strategy-name conditionals to special-case risk.
- Do not push managed recovery coordination back into `TradingBot`.
- Do not merge experiment behavior into baseline config without quarantine language and tests.
