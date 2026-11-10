---
name: rca-root-cause-vs-consequence
description: Separate the true root cause of a Creatio incident from its downstream consequences, so a Root-Cause Analysis reports the triggering change rather than the loudest symptom. Use during any RCA when there are many errors, a cascade of failures, or when it is unclear which failure caused the others (e.g. one broken source file producing dozens of compiler errors across dependent schemas).
supported_modes: [Builder, SDK]
---

# rca-root-cause-vs-consequence — isolate the trigger

Incidents cascade: one change breaks something, which breaks the next thing, and the log fills with errors.
The goal of an RCA is the **earliest confirmed trigger**, not the most numerous or most visible error. This
skill is the discipline for getting there. It is domain-agnostic — it applies to every RCA, not just compilation.

## Classify every finding into one layer

- **Symptom** — what the user reported ("compilation failed", "site won't start").
- **Immediate failure** — the condition that directly produced the symptom (e.g. the build returned errors,
  so the assembly was not produced).
- **Root trigger** — the earliest confirmed cause that set off the chain (e.g. a specific source-code
  schema was edited and no longer compiles).
- **Amplifiers** — things that widened the impact but did not start it (many dependent schemas, retries,
  restarts, high load).
- **Recovery** — what restored a working state, and why it worked.

Report the **root trigger** as the root cause. Mention immediate failure and amplifiers briefly for context;
do not promote a consequence to a cause.

## How to find the trigger (with the evidence you have)

1. **Order by time.** Sort the relevant `ConfActivityLog` records / errors by `CreatedOn` (there is no
   `OperationDate` column). The first meaningful error is a far better trigger candidate than the last.
2. **Use the parent-child tree.** A failed operation's parent and preceding siblings (via the self-lookup
   `Parent`, from `rca-cal-read`) often contain the change that caused it — e.g. an `Update` to a schema right
   before the failed operation.
3. **Follow the dependency direction.** The element whose own definition is invalid is the trigger; elements
   that fail only because they reference it are consequences. (In compilation: a `CS0246`/`CS0103` in many
   files that all point back to one changed type ⇒ that one type is the root.)
4. **Prefer the most specific error.** A concrete error on a named element/line beats a generic
   "operation failed" message.

## Current or already recovered? (place the incident in time)

The root cause of an incident is not the same as the **current state** of the system. Before you report,
decide whether the incident is **live** or **historical**:

- Is the failure the **latest** event of its kind, or did a **later** success / recovery run after it?
- Was there a **cleanup** afterwards (e.g. a log-clearing operation) that leaves an old failure as the last
  visible one?
- Reason about "before" and "after" with `CreatedOn` ordering, not record position. **Before you write that
  a run "followed" the failure, compare the two timestamps and confirm the later one is genuinely greater.**
  A list ordered `CreatedOn desc` puts *earlier* runs below the failure, so a record sitting under it in the
  output is usually the one that came **before** — citing it as the recovery inverts the timeline and turns
  a live failure into a "resolved" one, or the reverse. Name both timestamps when you make the claim, so the
  ordering is visible and checkable in your own text.
- **The absence of a newer record is not proof the failure is still live.** A project/package that stops
  being touched may never produce another run at all — no new record doesn't mean nothing changed, it can
  mean nothing was *attempted*. When the last stored failure names a specific schema/file, check whether
  that artifact **still exists** (e.g. `SysSchema` by name via `creatio_list_records`) before trusting the
  stored error. A deleted schema cannot currently be failing to compile, no matter how recent-looking the
  last error record is — this is a stronger check than comparing timestamps, because timestamp comparison
  only catches staleness when a newer run happened to occur.

If the evidence does not confirm the failure is still unresolved, report it as a **dated, historical
finding** and lower the confidence in `rca-diagnosis-report` — never present a stale failure as a live outage.

## Quick unblock — can the trigger simply be reversed?

Fixing the defect and restoring working software are **two different goals**, and the user may need the
second one first. Once you have a confirmed trigger you often already know the answer to "how do I make it
work again right now?": **undo whatever introduced it.** This costs no extra reads — it is a reading of the
trigger you already identified, not a new investigation.

Derive it **only when all four hold**:

1. There is a **confirmed blocking failure that is still current** — not warnings alone, not an
   expected-behavior/consultation question, and **not a failure that has already been resolved**. This is
   the condition most easily got wrong: finding a failure record with real blocking errors is *not* enough,
   because a stored failure can be hours old and already fixed. If a later run succeeded (or completed with
   warnings only), or the element named in the error **no longer exists** (see the existence check in
   "Current or already recovered?" above), then **nothing is blocked and there is nothing to unblock** —
   the environment is already working, and telling the user to delete or revert something is advice to
   damage a healthy system. Establish currency **first**, then decide about the unblock. When the incident
   is historical, say so and stop: no unblock branch, and reconsider whether the proper fix is even still
   needed — an element that has been removed cannot still need repairing.
2. The trigger is **confirmed from a record you actually read** — not a signature match you could not
   corroborate on-platform. **No confident trigger ⇒ no quick unblock**; a reversal proposed against a
   guessed cause is worse than offering none.
3. The trigger has a **real reversal** — a concrete action that undoes it.
4. The reversal is **meaningfully faster or simpler** than the proper fix. If the proper fix is already a
   one-line change, there is no quick path to offer.

Common reversals — the logged operation types map directly onto them, so **start from the `Operation` of
the record that triggered the failure** (`Create` / `Update` / `Delete` / `Install application`):

| Trigger (`Operation`) | Reversal | What it costs |
|---|---|---|
| **Something was newly created** (`Create`) — a business process, source-code schema, object, package | **delete the newly created element**, or remove just the part of it that fails to compile (e.g. the script task generating the broken code) | the new element and the work put into it — usually small, since it was created moments before the failure |
| An application was installed (`Install application`) | uninstall it (App Hub) | the app's data/configuration; it must be reinstalled later |
| A schema was edited (`Update`) | revert the edit | the change that was being made |
| A package/dependency was deleted (`Delete`) | restore it from the repository or a backup | — |
| A feature/setting was switched | set it back to its previous value | whatever the change was meant to enable |
| An assembly reference was removed | add it back | — |

**`Create` is the most common trigger of a broken build in a working environment** — someone adds a process
or a schema, its generated code doesn't compile, and the build has been failing ever since. Deleting the
element that was just added is almost always the fastest way back to a compiling configuration, and the
cost is genuinely low precisely because it is new. Do not overlook it just because "delete" sounds
heavier than "fix": reverting a five-minute-old creation is a smaller action than debugging its generated
code under pressure.

**A build that failed inside a delivery is the exception to the install row.** When the failing compilation
is a child of an installation — its `Parent` is the installation record — the build ran over content the
delivery had just written, and most of that content applied correctly. Uninstalling the application or
restoring the delivery's backup takes all of it away to cure one unresolved reference. Whether to take it
away is the delivery domain's restore gate, not an unblock, and for a failed build that gate answers "no"
unless the requester is abandoning the delivery. The unblock here is the **smallest change on the target
that makes the reference in the blocking error resolve** — usually bringing the one element that did not
land to the version the delivered code expects. Its cost is that it is a hand edit on the target, which the
next delivery will refuse or overwrite unless the proper fix follows.

**"Revert the edit" needs the version from before the edit.** Offer it only when you have read that version
— the element's artefacts on the activity-log row that preceded the edit — and it satisfies the reference in
the blocking error. An edit made shortly before a failing build is not its cause by proximity: when the
earlier version lacks the member the error names as well, reverting changes nothing and still costs the
edit.

**Naming the cost is mandatory.** A reversal is a destructive step in a way "correct line 7" is not — if you
cannot say what the user loses by reverting, do not offer the reversal at all.

Hand both paths to `rca-diagnosis-report`, which presents them as the labelled **Unblock now (temporary)** /
**Proper fix** branches. The unblock is never the preferred option — it is what you offer someone who is
blocked, and it explicitly leaves the underlying defect in place.

## Test your conclusion

- Would fixing the proposed root trigger plausibly clear the downstream errors? If not, keep looking.
- Is the trigger backed by a specific record/field you actually read? If not, mark it as a hypothesis, not a
  conclusion, and lower the confidence in `rca-diagnosis-report`.
- Avoid claiming a product defect unless the evidence directly supports it; prefer "the evidence indicates" /
  "the most likely cause is" when the trail is circumstantial.
