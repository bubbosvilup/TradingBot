# Operational Runbook

This runbook covers the active paper runtime.

It does not imply live-order readiness.

Goal:
Describe safe operator actions and what they do.

Operator actions must be explicit, limited, and observable.

---

## Runtime Posture

Current runtime assumptions:

- execution is paper-only
- Pulse is the operator UI
- `StateStore` is the runtime source of truth
- manual recovery actions must not bypass risk controls
- UI/API actions must not become trading decision logic

If any of these change, update this runbook, tests, and runtime docs together.

---

## Manual Post-Loss Latch Reset

Use only when a bot is blocked by:

```text
post_loss_latch_timeout_requires_operator