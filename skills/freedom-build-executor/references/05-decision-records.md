# 05 — Decision records

What this workflow REFUSES, and why the refusal is the right behaviour rather than a gap. A
hard stop with no in-contract way around it is a design commitment, not an oversight — this file
is where those commitments are written down with the alternatives that were rejected, so a later
reader (or reviewer) does not re-open a closed decision by mistaking a deliberate refusal for a
missing feature.

Each record states the decision, the reason, the alternatives considered and rejected, and what
would have to change for the decision to be revisited.

---

## DR-1 — The `plan-unvalidated-against-stand` stop has no operator override

**Decision.** When a round's component answers did not come from the target stand — every
`componentResolution` entry carries `resolvedFrom`, and only `'stand'` confirms — the run stops
with `stopped: 'plan-unvalidated-against-stand'` and there is **deliberately no flag, answer, or
run-scoped acknowledgement that turns a catalog-sourced answer into a confirmation**. The only way
forward is to make the environment answerable and re-run. The stop fires before the first build
unit and again at every in-run Reconcile, so a stand that goes away mid-run stops the next unit
rather than clearing the gate on a catalog answer (ENG-95468, residual).

**Why.** The whole defect this axis closes is *a catalog answer being read as a stand
confirmation*. `get-component-info` does not fail when it cannot probe the environment: it answers
from its bundled `latest` catalog and still reports `resolved: true`, recording the substitution
only in free text (`resolvedFromReason=probe-error`). A stand that is up but whose version cannot
be probed produces the **same** catalog answer as one that is down. An override that let an
operator declare "proceed anyway on this catalog answer" would therefore be an override of the
exact condition the gate exists to detect — it would re-open the defect under a different name, and
the round would build against a `latest` catalog that may not match the stand at all. The rationale
is stated inline at the stop (`skills/_workflow-core/build-executor/core.mjs`, the Hard Stop 3.4
header: *"There is deliberately no override…"*).

**Consistency, not exception.** Every sibling hard stop in this executor is terminal with no
operator override: the approval stop, the package-precondition stop
(`new-app-over-existing-package` / `target-package-unknown`), and `plan-invalid-against-stand`. A
gate returns a `stopped` verdict and a `next`; the caller acts out of contract (fix the stand, fix
the plan, re-approve) and re-runs. `plan-unvalidated-against-stand` is a member of that family, not
the lone outlier.

**Alternatives considered and rejected.**

| Alternative | Why rejected |
|---|---|
| A boolean override flag ("proceed on a catalog answer") | Re-opens the defect directly — it authorises exactly the catalog-as-confirmation read the gate closes. |
| A run-scoped acknowledgement routed through an existing operator-answer channel | There is no such run-scoped gate-override channel to reuse. `resolutions.json` → `resolutionsForUnit` is the **per-build-unit ⚠ Confirm preflight** channel (it answers open plan questions for a unit), not a mechanism for overriding a hard stop; no hard stop consults it to clear itself. Building a new run-scoped acknowledgement channel purely to weaken this gate would add the override the first alternative was rejected for, only with more machinery. |
| Downgrade the stop to a warning and build anyway | This is the pre-ENG-95468 behaviour and the measured failure (ST_2 round 5: five agents, ~1.68M weighted tokens, zero stand writes, on a round that had already seen a hard DNS failure in its own first phase). |

**What the operator does instead.** The `next` points at the environment, not the plan: check the
registered environment, its DNS and its credentials (`clio ping`), confirm `get-component-info`
answers from the environment itself, then re-run. Nothing about a catalog answer implicates the
plan, so this is never a re-plan (a catalog `resolved: false` is no more evidence about this stand
than a catalog `resolved: true`).

**Cross-repo note.** CAADT is driven against real stands by the `creatio-adaclio-testing` harness,
so a transient probe failure hard-stops a harness run with no in-contract bypass. That is intended:
a harness run that "passed" without reaching the stand is the false green this gate exists to
prevent. The remedy is the same — make the stand answerable and re-run — and the stop is cheap
(no agents are spent confirming a record on a round that is already over).

**Trust boundary (related).** The gate keys on the agent's `resolvedFrom` *classification* of
clio's free-text note, not on a machine field carried across the MCP contract. Rather than trust
that classification blindly, `componentSweepFaults` FAULT 3 refuses a `resolvedFrom: 'stand'` claim
whose own `note` carries clio's catalog-fallback tokens (`probe-error` / `latest-fallback`) — so a
catalog answer cannot be mis-classified into a stand confirmation at the model layer either
(PR #159 review, Major 7). Transcribing clio's own `resolvedFromReason` verbatim across the
contract would be stronger still and remains a possible future change (it would also let the script,
not the model, own the stand/catalog mapping); the contradiction fault was chosen for this round as
the self-contained way to close the one-directional hole.

**When to revisit.** This decision changes only if the underlying tool behaviour changes — for
example, if `get-component-info` gains a way to *fail* (rather than silently substitute the catalog)
when it cannot probe the environment, or carries an unambiguous machine-readable "this answer is
from the stand" signal end to end. At that point the gate could rest on the tool signal directly and
the question of an operator override would not arise, because there would be no ambiguous catalog
answer to override. Any change here belongs in this record with the caller-migration path, because
it changes what the workflow returns and what it refuses.
