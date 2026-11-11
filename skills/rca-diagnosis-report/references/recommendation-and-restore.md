# rca-diagnosis-report — the recommendation and the restore answer

Part of `rca-diagnosis-report`: items 5 and 5a of the report — what to recommend, and whether anything
needs rolling back — and the two pre-send checks that test them for a delivery incident. The skill's
`SKILL.md` holds the rest of the report (summary, root cause, evidence, consequences, confidence), the
rule that nothing internal reaches the user, and the language rules — the branch labels below are written
in the user's language, and the pairing rule holds for the translated labels just the same.

## The recommendation and the restore answer

5. **Recommendation** — the concrete next action. Be specific about *what* and *where*. Remember the
   agent is read-only: everything here is a manual step for a human, never performed by the agent.

   **Structure it as labelled branches, in this order, and put nothing outside them** (see
   `rca-root-cause-vs-consequence`, "Quick unblock"). The **order** is fixed; which of the three
   the incident actually has is decided below:

   - **Unblock now (temporary)** — the fastest route back to working software, usually on the **target**.
     State the concrete action, **what it costs them** (what is lost or undone), and that it is a stopgap
     that leaves the underlying defect in place. Never present it as the preferred option. **It comes first
     even when the proper fix is obviously better** — a reader who is blocked is looking for this one, and
     making them read past the durable fix to reach it is the wrong order.
   - **Proper fix** — the resolution that removes the defect, usually on the **source**. This is the
     recommended path whenever the user is not blocked.
   - **Technical option (database)** — last, and labelled as technical. Give it wherever a database route
     exists at all, **even when a UI path is available**, and state the condition that would make someone
     choose it: usually that an identifier has to be **preserved** because something else already depends
     on it. Say plainly that the interface cannot do it, and **write the statement out** — a sentence saying
     that an insert or update is needed is not the statement, and nobody can run prose. Where a value is
     genuinely unavailable from here, put a named placeholder in the script and say what to substitute.

   **One step belongs to one branch.** Do not fold the proper fix into the unblock or the reverse, and do
   not leave a numbered step that belongs to neither. A caveat that applies to more than one branch goes
   **after** all of them, said once and marked as applying to both — not tucked inside one of them.

   **A step that only makes sense inside a branch goes *in* that branch, as one of its steps** — not after
   the branches as a remark. Left trailing it reads as an aside, and a reader working through the branch
   never reaches the thing that completes it.

   **A step that *every* branch needs is still a step, not a shared footnote.** Repeat it inside each branch
   that requires it; a branch the reader can follow to completion is worth more than a report with no
   duplication in it. Only **caveats** — costs, warnings, conditions — are gathered after the branches. The
   test is simple: if a branch would be **incomplete** without it, it is a step, and it belongs in every
   branch that is incomplete without it.

   Both branches describe the same incident, so make the relationship explicit: the unblock buys time,
   the proper fix ends the problem.

   **Every step must be one a person can actually perform, and the product's UI is the first place to
   look.** Name the path — the section or designer, and what to click — so the reader does not have to work
   out *how*.

   **Before calling a step impossible in the UI, check whether the step itself is necessary.** An action the
   interface cannot perform is often an artefact of the approach rather than of the problem — reproducing an
   identifier, for instance, is usually avoidable by changing what references it. Look for the path that
   removes the impossible step, and recommend that one. **"The UI cannot do this" is a claim about the
   product**, so do not make it to excuse a path you never looked for. Dressing a database operation up as
   "create the record with the same `Id`" leaves the reader stuck at the first click.

   **A resolved incident gets no branches at all.** If the failure is historical — a later run succeeded or
   completed with warnings, or the offending element no longer exists — the user is **not blocked**, so
   there is nothing to unblock and no reason to tell them to delete or revert anything. Report the incident
   as resolved, say what resolved it, and stop. Offering an "unblock" for a build that is already green is
   advice to break a working environment.

   **The labels come as a pair or not at all.** The heading "Proper fix" may appear **only** when
   "Unblock now (temporary)" appears directly above it. One branch ⇒ **no labels at all** — write a single
   plain recommendation. A lone "Proper fix" heading is always a defect: it tells the reader an alternative
   exists and then withholds it. So before you write either label, decide which case you are in:
   - You have a reversal ⇒ write **both** headings.
   - You have no reversal ⇒ write **neither** heading.

   **The technical option sits outside that pair.** It is not the other half of anything, so it may appear
   beside the pair or under a single plain recommendation — include it whenever a database route exists.
   Its label is what keeps it from being read as the recommended path, so when it is present, label it.

   Never resolve the tension by keeping the label and dropping the branch, and never invent a reversal to
   fill the shape. If you reached for "Proper fix" and found nothing to put above it, that is the signal to
   re-check `rca-root-cause-vs-consequence`'s reversal table against your trigger's `Operation` — a trigger
   that **created** something is reversible by deleting it, which is easy to miss — and if nothing there
   fits, remove the label.
5a. **Restore answer** — *its own section under its own heading, for every delivery incident (install /
   update / reinstall / uninstall). Not at your discretion, and not something the Recommendation can
   absorb: a recommendation says what to change, this says what state the environment is in, and a reader
   scanning for one will not find it inside the other. Omit it only for domains where nothing was
   delivered.* Say plainly whether anything needs
   rolling back, **including when the answer is "nothing"** — that is the most reassuring finding in the
   delivery domain and the easiest to drop, and its absence reads as an oversight rather than as good
   news. The answer belongs to the domain file's own restore gate: carry what it concluded, do not
   improvise one here. When the delivery left a partial state, say which part persisted and which did
   not, because that is what decides whether a plain retry is safe. **Close on the environment as you
   read it** — whether the delivered elements are on it now, and whether the failure is still the latest
   event of its kind. An incident that has since been undone needs no restore at all, and saying so is
   the whole answer; leaving it unsaid makes a resolved incident read as a live one.

## Before you send — the recommendation checks for a delivery incident

Read the recommendation and the restore answer you actually wrote, not your intention:

7. **A build inside a delivery — the recommendation.** Is the restore answer "no", with its reason, unless
   the requester is abandoning the delivery? Is the unblock a change on the target that makes the blocking
   reference resolve — not a restore, not an uninstall, and not a revert of an edit whose earlier version
   you have not read? And when an element did not land, is the fix addressed to that element rather than
   to the delivered code? Is each part of the fix addressed to the package that owns it — a failing file
   outside the delivery is not fixed by re-exporting the delivered package?
8. **An element refused as locally modified.** Before any step that resets its flags: does the report say
   how it is known that the package carries that element — and when it is not known, is confirming it on
   the source the first step? Is the reset written as statements with the element named, not as "remove
   the protection"?

Each of these costs a sentence to fix here. Left out, each costs the reader the part they came for.
