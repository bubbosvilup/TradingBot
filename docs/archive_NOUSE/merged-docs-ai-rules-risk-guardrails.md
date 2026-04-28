# Risk Guardrails

This is a paper-trading runtime.

Even in paper mode, risk behavior must stay stable, visible, and controlled.

Goal:
No patch may silently make the bot more aggressive, less safe, or harder to understand.

---

## Core Rules

Do not change trading behavior unless explicitly requested.

Do not make the bot more permissive by accident.

Do not hide risk changes behind refactors, UI changes, or naming cleanup.

---

## Non-Negotiable Guardrails

Do not:

- enable or reintroduce live order routing
- promote experiments to baseline behavior without explicit approval
- weaken exit logic (protective exits, invalidation, managed recovery)
- change recovery vs invalidation precedence silently
- remove or weaken entry blocking from Architect instability (`architect_challenger_pending`)
- silently change:
  - entry thresholds
  - exit thresholds
  - hold timing
  - cooldowns
  - fee assumptions
  - publish cadence
- make sizing more aggressive
  - volatility logic may only reduce or preserve size
- weaken post-loss protections (cooldowns, latches, gating)
- move risk logic into UI, telemetry, or naming changes
- hide legacy risk behavior behind cleaner names

---

## Experiments

Experiments (e.g. `allow_small_loss_floor05`) are:

- quarantined
- not baseline
- must remain visible
- must remain removable

Do not:
- make them default
- mix their telemetry with baseline
- blur their effect inside shared logic

---

## MTF Guardrails

MTF must never silently widen risk.

MTF widening is allowed only if ALL conditions are true:

- MTF is enabled
- frames are ready
- regime is `"range"`
- dominant frame exists
- instability ≤ 0.25
- agreement ≥ 0.75

Allowed policy only:

- short → baseline
- medium → 1.5x
- long → 2.0x

Any other condition → baseline

Do not:
- interpret raw timeframe labels inside runtime logic
- widen caps outside this path
- make MTF more permissive without explicit config + tests

---

## Economics Guardrails

Do not:

- lower edge thresholds silently
- increase capture-gap caps by default
- introduce symbol-specific tuning via hardcoded logic

All tuning must be explicit in config or policy.

---

## Managed Recovery Guardrails

Do not:

- make invalidation easier than entry
- make invalidation outrank confirmed recovery targets
- remove grace/confirmation for regime-sensitive invalidation
- reintroduce single-step `family_mismatch` invalidation

Recovery logic must remain harder to trigger than entry.

---

## Required Review Questions

For any patch, answer:

- Does this allow more trades?
- Does this delay or suppress exits?
- Does this bypass risk or Architect protection?
- Does this change economics or net PnL qualification?
- Does this weaken cooldown or post-loss protection?
- Does this widen target distance or caps?
- Does this change MTF behavior or thresholds?
- Does this make behavior look safe but act more aggressive?

If any answer is YES → escalate review.

---

## Hard Warnings

- Do not use strategy-name branching for risk behavior
- Do not move recovery or risk logic into `TradingBot`
- Do not merge experiment logic into baseline silently