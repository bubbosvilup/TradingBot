# Audit Flow

Use this for architecture audits, refactor reviews, and hotspot inspection.

Goal:
Keep the repo understandable, safe, and verifiable.

An audit must find real problems in the code.
It must not invent abstractions, frameworks, or redesigns.

---

## Required reading

Before auditing, read:

- `AGENT.md`
- `docs/ai/project-map.md`
- `docs/ai/priorities.md`

---

## Steps

1. Name the target area.
   - file, module, or flow
   - classify it: core, role, bot, stream, UI, or test

2. Describe its job in simple words.
   - What should this area do?
   - Keep it to 1–3 sentences.

3. List what it owns.

4. List what it should not own.

5. Check whether it violates the TradingBot doctrine:

   - Does it have more than one clear responsibility?
   - Does it accept external data without validation?
   - Does it mutate state it does not own?
   - Does it hide important errors?
   - Does it use false TypeScript types?
   - Does it use `any`, `as any`, or casts to silence the compiler?
   - Does it change trading behavior silently?
   - Does it add abstraction instead of clarity?
   - Does it add a coordinator, wrapper, or framework where a function would be enough?

6. Check for known forbidden regressions:

   - strategy-name branching in `TradingBot`
   - coordinator logic pulled back into `TradingBot`
   - runtime/UI coupling
   - Pulse UI concerns leaking into trading decisions
   - launcher/debug-capture concerns leaking into trading decisions
   - silent entry/exit/risk behavior drift
   - managed-recovery invalidation becoming easier than entry
   - entry ignoring active Architect challenger hysteresis
   - log/output volume growing because rolling numeric state is emitted as append-only noise
   - hidden state mutation inside `get*` or `read*`
   - vague names, generic file headers, inline magic numbers, broad wrappers

7. Identify the smallest safe patch.
   - preserve behavior unless a behavior change is explicitly requested
   - prefer deletion/simplification over new machinery
   - do not touch trading logic for cosmetic cleanup

8. Name required tests before editing.
   - what behavior must stay the same
   - what failure must now be prevented

---

## Output format

- Verdict: OK / FIX BEFORE CONTINUING / BLOCKED
- Findings ordered by severity: P0, P1, P2, P3
- Exact files and functions involved
- Why each finding is proven by the code
- Which responsibility is leaking, and where it should live instead
- Minimal patch plan
- Required tests

---

## Hard rules

- Do not invent problems.
- Do not propose broad redesigns.
- Do not add internal frameworks.
- Do not add coordinators unless strictly necessary.
- Do not use `any`, broad casts, or non-null assertions to finish faster.
- Do not change trading behavior silently.
- Do not perform cosmetic refactors while touching trading logic.
- If uncertain, stop and ask.