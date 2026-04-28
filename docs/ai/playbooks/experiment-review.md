# Experiment Review

Use this when reviewing experimental config or runtime behavior.

Goal:
An experiment must stay visible, isolated, reversible, and easy to remove.

No experiment may become baseline behavior by accident.

---

## Steps

1. Name the experiment.
   - exact config key / label
   - exact files where it is activated
   - exact runtime path where it changes behavior

2. State its status:
   - quarantined
   - active experiment
   - promoted to baseline
   - deprecated / removable

3. Check whether it leaks into baseline behavior.

   Ask:
   - Does normal config use it without saying so?
   - Does baseline telemetry hide it?
   - Do reports mix experiment results with baseline results?
   - Does the code make the experiment look like normal risk logic?

4. Check what behavior it changes.

   It must be clear whether it affects:
   - entry qualification
   - exit timing
   - loss handling
   - managed recovery
   - position sizing
   - risk gates
   - telemetry/reporting only

5. Check baseline guardrails.

   The experiment must not bypass or weaken:

   - `architect_challenger_pending`
   - managed-recovery invalidation grace/confirmation
   - confirmed recovery target precedence over invalidation
   - RSI target-distance gate in `entryCoordinator`
   - MTF coherence thresholds for RSI cap widening
   - portfolio kill-switch / risk-stop behavior

6. Require a rollback path.

   There must be a simple way to:
   - disable the experiment
   - identify trades affected by it
   - compare experiment behavior against baseline behavior
   - remove the experiment later

7. Apply TradingBot doctrine.

   Any patch must:
   - preserve baseline behavior unless explicitly changed
   - keep experiment code clearly named
   - avoid broad abstractions
   - avoid new coordinators unless strictly necessary
   - avoid `any`, casts, or hidden config magic
   - keep errors and telemetry visible

---

## Current standing

`allow_small_loss_floor05` is active in:

- `src/data/bots.config.json`

Treat it as quarantined P0 material until explicitly reviewed.

It must not be considered baseline behavior.

---

## Reject changes that

- make the experiment the implicit default
- hide experiment behavior behind generic names
- mix experiment telemetry with baseline telemetry
- make experiment trades indistinguishable from baseline trades
- remove the rollback path
- weaken entry, exit, recovery, or risk guards silently
- blur baseline RSI target-distance blocking with MTF cap widening
- rename quarantined behavior to make it look modern or safe
- add framework-like experiment infrastructure before the experiment is understood

---

## Output format

- Experiment name
- Status: quarantined / active / promoted / deprecated
- Files involved
- Behavior changed
- Baseline guardrails affected
- Telemetry/reporting impact
- Rollback path
- Verdict: KEEP QUARANTINED / SAFE TO TEST / PROMOTE / REMOVE