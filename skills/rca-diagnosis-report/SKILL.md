---
name: rca-diagnosis-report
description: Format the outcome of a Creatio Root-Cause Analysis into a clear diagnosis — a support/internal technical report. Use at the end of an investigation to present the root cause, the supporting evidence, and concrete recommendations (a temporary unblock alongside the proper fix where one exists), degrading gracefully when some evidence is missing.
supported_modes: [Builder, SDK]
---

# rca-diagnosis-report — present the diagnosis

Turn the investigation into an explanation a human can act on. Lead with the answer, back it with evidence,
and be honest about confidence and gaps. Domain-agnostic — used at the end of every RCA.

## Never expose your own internal reasoning scaffolding

The user has never seen this skill's reference material and doesn't know it exists. That means an entire
category of true statements about *how you reached your answer* are meaningless or actively confusing to
them, no matter how naturally they occur to you while writing. This is not a style preference to weigh
against clarity — it's a hard boundary, because every one of the concepts below is invisible to the user
by construction.

**This governs every line the user sees, not only the final report.** Progress notes, interim status
lines, "now checking…" asides and anything else you emit while still working are part of the answer from
the user's side — they are read, and they leak the same vocabulary. Verified: an otherwise clean report was
preceded by the interim line `Now checking the outcome (§4)`, which exposes an internal section number for
no gain. Apply the list below from the first word you write to the last.

**Write in the user's language, throughout — whichever it is.** Answer in the language the incident was
reported in, and keep every user-visible line in it, interim notes included. A progress line that slips
into another language reads as a seam between your machinery and your answer, which is exactly what this
section exists to remove. Verbatim evidence — log lines, exception text, identifiers, column and entity
names — stays in its original form and is never translated.

**Forbidden, in any form, position, or phrasing — prose, header, footnote, parenthetical, or "for
context"** — regardless of how naturally it fits the sentence:
- Any case identifier from a domain reference file. This is **not** one specific pattern — every domain
  file mints its own short letter-prefix-plus-digits scheme (`C1`–`C39` in compilation, `FS1`–`FS6` in
  feature flags & system settings, `IB*` / `IL*` / `IC*` / `ID*` across the installation catalogs, and
  whatever the next domain invents). One domain can mint **several** prefixes — installation alone has
  four, one per catalog — so scrubbing the one you happen to remember is not scrubbing the rule. Do not
  treat "avoid `C` + digits" as the whole rule and assume you're covered — check for *any* such token,
  from *any* domain file you consulted this run, not just the one you happen to remember an example for.
- Any confidence-tier label (`Tier A`/`B`/`C`).
- The nouns "knowledge base", "KB", "signature catalog", "documented case", "known case", or "known
  signature" used to mean *your own internal reference material* (as opposed to, say, a customer's own
  documented incident — that's a different, legitimate use of "documented").
- Any file path under `./references/` (or any internal skill file path at all).
- Any line number tied to an internal document.
- Any **section reference** into internal material — `§4`, `§2.1`, "section 3", "the routing section",
  "per the spine". These read like a citation the user could look up, and there is nothing to look up. The
  *substance* of the section is what you report: name the outcome or the stage, not the section that
  defines it. (Naming a **stage** or an **outcome** in the user's own terms is not a leak — that is the
  finding. It is the numbering and the file structure that are internal.)
- Narrating the act of matching/routing/classifying your own investigation against internal material
  ("this matches...", "classified as...", "routed to...", "recognized from...") when what's being matched
  against is your own reference material rather than the user's own evidence.

None of this is extra detail that happens to be unnecessary — from the user's side it is either false (they
have no such catalog) or meaningless (a path/line number in a system they can't see). If your only basis
for a claim is "the reference file documents a case with this exact signature," that is a *reason for your
confidence*, not a sentence to write down. Translate it into the plain technical claim you're prepared to
defend on its own merits. For example, instead of:

> "This is a known signature in the compilation reference: C32 — install blocked by 'compilation errors on
> site' despite a clean compile (references/compilation.md)."

write:

> "This is a well-understood pattern, not a deadlock: the installer reads a stored compile-error state that
> a partial compile doesn't refresh, so it can still see errors after a manual compile comes back clean."

Same confidence, same technical content, zero reference to how or where you looked it up.

A second, real example — this one from the feature flags & settings domain, caught live — instead of:

> "This is a known case in this repo's knowledge base (references/feature-flags-and-settings.md, case FS3)."

write nothing at all in that sentence's place, or if a sentence like it is truly needed for flow, replace
it with the plain fact it was standing in for (here, simply move straight to reporting what was read —
the sentence added no technical content of its own, only the citation).

**Before sending any report, re-read your own draft sentence by
sentence and check for**: any bare letter-prefix-plus-digits token that could be an internal case id (not
just `C`+digits — check against whatever scheme the domain file(s) you actually opened this run use, e.g.
`FS`/`IB`/`IL`/`IC`/`ID`+digits), the words "knowledge base"/"KB"/"signature"/"case"/"repo"/"this repository" used as a noun
referring to your own internal reference material, any file path (any `./references/...` path or any
internal skill file path at all), or any line number. If you find one, rewrite that sentence around the
underlying technical fact instead of just deleting the citation — a vague half-scrubbed reference ("this
matches a documented pattern" with no further explanation) is still a leak of the fact that a catalog
exists, and also a weaker report. This check is mandatory every time, not only when you notice yourself
citing a case — the leaks that got through before were the ones that didn't feel like citations while
being written, and every leak caught so far has involved **multiple** forbidden categories landing in the
same sentence at once (case id + "knowledge base" + path together) — so finding one of these in a
sentence is a strong signal to check that same sentence for the others too, not just fix the one you
spotted.

## The confidence section is a contract with the rest of the report

Whatever you list as **not established** must not appear anywhere else as a premise. A hedge in one
paragraph does not license using the same guess as a fact in another — the reader takes the causal
narrative as your answer and rarely reconciles it against a caveat further down.

Observed live: a report correctly stated that "the column and table are **not established**, and the index
name cannot be resolved from inside the platform", and refused to split the index name to guess a table —
then, two paragraphs earlier, described the cause as a delivered row colliding "on column `Code`", inferred
from that same index name and marked only with a parenthetical "judging by the name". Both halves cannot be
true. The reader keeps the confident one.

So before you finish: take each item in your not-established list and search your own draft for it. If it
is doing work anywhere above — carrying a mechanism, naming a record, standing in for a value you asked the
user to supply — either remove it from the narrative, or demote the narrative to match. The wanted form is
to name the *shape* of the missing thing without filling it in: "the row being inserted duplicates a value
the target already holds under this index" needs no column name to be true and complete.

## Support / internal format (default)

**The sections below are the report, not a style.** Keep every one that applies — in particular the
Recommendation, the Restore answer under its own heading, and Confidence & gaps — even when the host or
your own habit favours a short reply in plain paragraphs. Shorten what a section says, never drop the
section: a reader looks for the fix and for how sure you are by their headings, and a report that folds
them into prose has left them out.

0. **Currency notice** — *only on a follow-up turn, and only when the state moved since your last answer.*
   If the currency re-check found **newer run(s)** than the record you reported earlier in this
   conversation, this goes **first, above the Summary**, as a short, visually distinct notice — not folded
   into Summary, not buried in Evidence, not a closing footnote. Say how many newer runs there were, when
   (at least the latest timestamp), each one's status, and **who or what triggered them** — naming the
   application-installation case explicitly when that's what it was, since a compilation started by an app
   install is the one cause the user cannot guess. Then continue with the normal report below, stating
   plainly **which run** the rest of the report describes.
   This notice is about **the user's own environment**, not your internal reference material — the
   scrubbing rules above do **not** apply to it, and it must never be dropped for brevity. The user asked
   their question without knowing the ground had shifted; that fact can change what they want investigated
   at all, so surfacing it is part of the answer, not noise around it. Omit this item entirely on a first
   turn, or when the re-check confirmed nothing changed.
1. **Summary** — one or two sentences: **state the outcome/status precisely** (for a compilation:
   success / success with warnings / failed / failed + warnings — never overstate success when non-blocking
   issues like warnings are present), then the root cause and the recommended fix.
   **When the domain file has its own outcome table, name one of its outcomes verbatim — a paraphrase
   does not count, and neither does the bare word "failed".** For a delivery that means the outcome *and*
   the stage it reached: which stage it stopped at is what tells the reader whether schemas, the database
   structure, or only data were touched, and whether anything is left half-applied. "The installation
   failed" on its own withholds exactly that.
   **Write it as a filled-in sentence, not as a thing to bear in mind.** Compose this line first, straight
   from the table, before any other part of the summary — then make the rest of the report agree with it:
   `Outcome: <the row you copied> — <the stage it reached>.` And know the shape that keeps getting written
   instead: **"failed during the <stage> stage" is not one of the rows.** It is the wording of *Failed at
   the named stage*, and a delivery whose log carried on past the error is *Completed with errors* however
   blocking that error reads. If your own evidence section says the run continued, the summary may not say
   it stopped.
2. **Root cause** — the triggering change/condition (from `rca-root-cause-vs-consequence`), stated plainly.
3. **Evidence** — the concrete facts you read, each with its source so it is reproducible:
   `ConfActivityLog` record `Id`/`Number`, operation/status, and the relevant linked detail (for a
   compilation: verbatim `CS####` codes, schema/element names, timestamps from `CompilationHistory`).
   **Every time you print carries the name of its clock.** A record's own timestamp and a timestamp read
   out of a log file are two different clocks whenever the server runs on a different offset, and a report
   that prints both bare has handed the reader an apparent contradiction it never explains. Say which is
   which, and give the offset when you can measure it. Two unexplained times that disagree cost more
   trust than one time would have.
4. **Consequences** — briefly, the downstream errors the root cause produced (so the reader isn't confused
   by the noise in the log).
   **This section is the check on your Summary, so read the two together before you send.** If the
   consequences say part of the work persisted, the Summary may not say the operation stopped — those are
   different outcomes and the reader will act on whichever they read first. When the two disagree, **the
   Summary is the one to fix**: the consequences describe what you actually read, the Summary is where
   the rounding happens.
5. **Recommendation** and **5a. Restore answer** — **before you write either, read
   `./references/recommendation-and-restore.md` of this skill (on the AI Platform: with `read_skill_file`) — in every report, not
   only when the recommendation looks hard.** It holds how the recommendation is built (labelled branches
   in a fixed order, which of them the incident has, what makes a step one a person can perform, when there
   are no branches at all), the restore answer every delivery incident carries under its own heading, and
   the two pre-send checks that test both. Write these two parts from that file, not from memory of an
   earlier report: they are the part of a report most often got wrong.
6. **Confidence & gaps** — Confirmed / Likely / Uncertain, and any evidence you could not obtain (e.g. an
   object not reachable, record not found) and how it limits the conclusion.
   **Say how far you looked, not only what you found.** How many records you swept and over what period,
   and whether you checked for the same failure on neighbouring runs. "I found one" and "I looked at the
   most recent N and found one" are different claims, and only the second lets the reader judge whether
   the problem is isolated or a pattern they are about to hit again.

## Before you send — one read-through of what you actually wrote

These get dropped often enough to be worth a pass of their own, and they are dropped in the finished
text, not in the thinking. So read the report, not your intention — each check is answerable by looking:

1. **Outcome.** Is there a line that names **one row of the domain's outcome table**, and does the
   consequences section agree with it? A summary saying the run stopped, over an evidence section saying
   the run carried on, fails this — fix the summary.
2. **Restore answer.** For a delivery incident: is it under **its own heading**? Folded into the
   recommendation does not count, however complete the sentence there is.
3. **Clocks.** Does every timestamp say which clock it came from, and when two disagree, is the offset
   stated — or said plainly to be unestablished? An unexplained gap between two times is itself the
   defect. Explaining it away with something you did not verify is worse than leaving it unexplained.
4. **The blocking thing, named.** Where the evidence let you pin a specific record, element or value,
   does the report carry **its Id**, not only its description? "One record is too long" and "record
   <Id> is too long" are different findings to whoever has to act.
5. **Scope.** Does the report say **how far you looked** — how many records, over what period — and not
   only what you found?

The next three apply to a delivery incident only, and they are the ones a delivery report drops most:

6. **A build inside a delivery — whose file, before, and now.** When the failing compilation was a child
   of an installation:
   - Does the report name the **package each failing file belongs to** — the file is named
     `<Schema>.<Package>.cs` — and say whether this delivery carried that package? When it did **not**,
     does it say which of the two established the verdict: the delivery changed something the file uses
     (the file compiled clean in the build before the delivery and has not changed since — the delivery
     broke it), or the file was changed after the last clean build and never compiled (the delivery only
     ran a build that was already broken)? A failing file outside the delivery settles nothing by itself.
   - Does it say whether the build was healthy **before** the delivery, naming the compilation record that
     shows it — or that no earlier compilation could be read, so it is unknown?
   - Does it say what the **current** build-state read returned, including an empty result that
     contradicts the failed build?

   These are findings, not background: the first two decide who the fix is addressed to, the third whether
   the break is live.
7. **The recommendation checks (7 and 8).** For a delivery incident, run them from the end of
   `./references/recommendation-and-restore.md`, against the recommendation you actually wrote — whether the
   restore answer and the unblock fit a build that failed inside a delivery, and how an element refused as
   locally modified is handled.

Each of these costs a sentence to fix here. Left out, each costs the reader the part they came for.

## Language

Write the analysis in the language the user asked for (or the language of their latest message). Keep
technical identifiers — error codes, schema/file/package names, product names — unchanged; translate the
explanation around them, not the diagnostic tokens.

**Labels and headings are explanation, not identifiers.** The branch names this skill uses ("Unblock now
(temporary)", "Proper fix", "Technical option"), the section headings, and the names of a domain's outcome
rows ("Completed with errors") are written in the user's language; the pairing rule for the branch labels
holds for the translated labels just the same. Only verbatim evidence — log lines, error text, entity and
column names — stays in its original form.

## Graceful degradation

- Missing evidence is not a dead end: report what you *did* establish, mark the rest as unverified, and name
  the exact query/record that would close the gap.
- Never fabricate a record Id, error code, or field value to fill a hole. Absence of evidence is a finding.
- **A statement taken from the public documentation is labelled as one, and stands apart from the rest.**
  When the `rca-academy-lookup` gate was used, the report says so in its own words — what the log and the
  knowledge base did and did not cover, and that the product's documentation was consulted for the rest
  — and every claim drawn from it carries the page title and URL. It explains how the product is meant to behave; it never asserts what **this**
  environment did, and it never outranks something a read established. Keep it visually separate from
  evidence so a reader skimming the report cannot mistake one for the other.
- **Before sending: every step, menu path, button and requirement has a source.** A read, a
  knowledge-base entry, or a documentation page. "Usually the order is…" with no source is the failure
  this check exists for — your own recollection of the product's UI, which invents sections and buttons
  that do not exist. If the draft has one: when the knowledge base left that part unanswered, open
  `rca-academy-lookup` now and replace it with what the documentation says; otherwise delete it and say what was not
  covered.
- **When only the user can close the gap, make the ask concrete and put it where it will be acted on.**
  Some evidence never reaches the platform at all — a dialog shown in their browser, a second
  environment, a log on the server. Name exactly what to send and in what form: **pasted text rather than
  a screenshot or a summary** whenever a table, an identifier or a version number is involved, since those
  are precisely what a retelling drops. Say why it cannot be recovered any other way. That belongs in the
  **recommendation**, as the next step — an ask filed under "confidence and gaps" reads as an excuse and
  gets skipped.
