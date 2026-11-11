---
name: rca-cal-read
description: Read the Creatio Configuration Activity Log (ConfActivityLog) through the Creatio data tools to gather evidence for a Root-Cause Analysis. Find an incident record (by Id, Number, or by filtering operation/status/date), read its Description summary, and walk the parent-child operation tree. Read-only.
required_tools: [creatio_describe_object, creatio_search_objects, creatio_list_records, creatio_get_record]
supported_modes: [Builder, SDK]
---

# rca-cal-read — read the Configuration Activity Log

Read-only access to `ConfActivityLog` (the Configuration Activity Log) through `creatio_list_records` and `creatio_get_record`. This skill is the primary evidence source for an RCA. It never writes.

## Step 0 — confirm the schema only when needed

Field and lookup captions are environment-specific, but the schema below is the **expected shape** — you do
**not** need to `describe_object` every run. Use `creatio_describe_object` only when a query **errors**
(unknown column/entity) or a caption is genuinely uncertain; then describe `ConfActivityLog` (and the
relevant lookup) and adapt. Prefer filtering lookups by **dotted navigation** (`Operation.Name`,
`Status.Name`) so you never need to read a lookup table to resolve its GUIDs. Lookup cells returned by
`creatio_list_records` / `creatio_get_record` already carry `{ value, displayValue }`, so the caption is
part of the row — no extra lookup read needed. If `ConfActivityLog` is not exposed, call `creatio_search_objects` with `{ "query": "configuration activity log" }` to find the correct object code before concluding it is unavailable (`rca-env-readonly-query`, "Finding an object's code").

Describe returns the **structural** metadata (`columnCode`, `columnType`, `refersToObjectCode`, `required`,
`primaryColumn`, `primaryDisplayColumn`); a semantic `title` / `description` may be absent, and RCA does not
need it. The describe response is paginated (default 200 columns, max 500) — for `ConfActivityLog` the
default is more than enough.

## Entity model (verified; confirm per environment)

| Field | Meaning |
|---|---|
| `Id` | Primary key (GUID). |
| `Operation` → lookup **`ConfOperation`** | What happened: Create / Update / Delete / Install application / **Compilation** / … Filter as `Operation.Name`. |
| `Type` → lookup **`ConfElementType`** | Element type. Filter as `Type.Name`. |
| `Status` → lookup **`ConfActivityStatus`** | Result: **Success / Error / Warning**. Filter as `Status.Name`. |
| `Name` | Record title (e.g. `Compilation (LOG-000123)`). |
| `Element`, `ElementUId` | Affected element text / UId (can be empty on a top-level compilation). |
| `PackageName`, `ApplicationCode` | Package / application context (often empty for a whole-workspace compilation). |
| `Description` | Large **HTML** summary. For compilations prefer the structured `CompilationHistory` detail (see `rca-env-readonly-query`); never pull it in a multi-row list. |
| `Parent` → self `ConfActivityLog` | Parent operation; builds the parent-child tree. Filter children as `Parent.Id`. |
| `DurationInSeconds` | Duration of the operation. |
| `Number` | Unique per-record number, e.g. `LOG-000123`. |
| `IsReplacedSchema` | Whether the element is a replacing schema. **Version-dependent — absent on older Creatio.** An absent column fails the WHOLE read with `INVALID_FIELD` rather than returning null, so keep it out of a default `columns` list and add it only after a describe confirms it. |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | Audit columns. **Use `CreatedOn` for time ordering — there is no `OperationDate` column.** |

## Finding the incident record

Use `creatio_list_records` on `ConfActivityLog`.

- **By Number:** `{ "objectCode": "ConfActivityLog", "columns": ["Id","Number","Name","Element","ElementUId","PackageName","ApplicationCode","DurationInSeconds","CreatedOn"], "filters": { "all": [ { "field": "Number", "op": "eq", "value": "LOG-000123" } ] } }`
- **By Id:** use `creatio_get_record` with `{ "objectCode": "ConfActivityLog", "ids": ["<guid>"], "columns": [ ... ] }`.
- **⭐ Latest compilation, ANY status — the default when no Id is given.** Filter by the **operation only**
  and let the ordering pick the newest row; narrow columns —
  `{ "objectCode": "ConfActivityLog", "columns": ["Id","Number","Status","CreatedOn","CreatedBy","Parent"], "filters": { "all": [ { "field": "Operation.Name", "op": "eq", "value": "Compilation" } ] }, "orderBy": "CreatedOn desc", "limit": 5 }`
  This is the right starting query for **"what's the status of the last compilation?"**, for any question
  about current state, and for the **currency re-check** on a follow-up turn (see below). Keep it this
  narrow — no `Description`, no wide column set: cheap enough to re-run on every follow-up message.
  **Do not add a `Status` filter here.** The newest run's status *is* the answer you're looking for — if it
  is `Success`/`Warning`, filtering to `Status = Error` silently skips it and hands back an **older, already
  resolved** failure (or nothing at all), which is exactly how a healthy environment gets reported as
  broken and how "the agent sometimes finds the latest compilation and sometimes doesn't" happens. Read the
  status off the row; don't pre-filter for the answer you expect.
- **Latest *failed* compilation** — only when the user has explicitly reported a failure (e.g. "the
  compilation is failing", "why did the build break") **and** you specifically need the most recent
  erroring run rather than the most recent run: add `{ "field": "Status.Name", "op": "eq", "value": "Error" }`
  to the filter above. Even then, still establish where that failure sits relative to the **actual latest**
  compilation (the default query) before calling it current — a failure followed by a later success is a
  historical incident, not a live outage.
- **On a follow-up turn**, re-run the default query above and compare its newest row's `Number`/`CreatedOn`
  against the record you examined earlier in the conversation. If it differs, read that row's
  `CreatedBy` and follow its `Parent` (see "Walking the parent-child tree"): a `Parent` whose
  `Operation` is `Install application` means the compilation was triggered **by an application
  installation**, not by someone pressing Compile — surface it to the user per the follow-up-turn rule (`rca-orchestration`; on the AI Platform, the system prompt).

> Filter lookups by **dotted navigation** — `Operation.Name`, `Status.Name`, `Type.Name`, `Parent.Id`.
> Either dot or slash is accepted; dot is the canonical form.
> The filter shape is strict, so a typo like `column:` instead of `field:` is refused loudly.
> If a navigation filter still returns an empty result where you expect data, suspect the filter (spelling,
> then caption) before concluding the data doesn't exist.
> Verify the exact **captions** against the lookup tables when a filter on a name returns nothing; they can
> differ per environment.

## Reading the Description

`Description` is **large HTML** — fetch it for a single record, never in a multi-row list read. But do not
treat it as optional colour: outside compilations it is frequently the only place the operation's *detail*
exists.

**Rule: when a log entry is evidence you are correlating against something else, open its `Description`
if it is non-empty and use what is in it.** A configuration `Update` records the change itself there —
typically an explicit previous-value / current-value pair. Nothing else on the platform retains the old
value: the record's own `ModifiedOn`/`ModifiedBy` say when and who, and the object you are diagnosing
only ever shows its *current* state. Skipping `Description` is how an answer ends up reporting "the value
is X" when the evidence supported "someone changed it from Y to X" — the same facts, but one names a
regression and hands back the value to restore, and the other does not.

Two consequences worth stating plainly:

- an **empty** `Description` means nothing — **ignore it and move on.** The field is only populated for
  some element types, so its emptiness is not evidence that no change happened and is not worth a sentence
  in the report. Draw no inference from it either way;
- when it *is* filled, do not paraphrase it away. Quote the values it gives; they are the strongest
  evidence in the record.

**The one exemption is compilations**, where the structured detail in `CompilationHistory` already
carries the same diagnostics — see `rca-env-readonly-query`.

> **Always exclude `Description`** from list `columns` (it is large HTML). For compilations, the actionable
> detail is in `CompilationHistory`, not this record — see `rca-env-readonly-query`.

## Resolving lookup captions

Every lookup cell carries **both** the GUID and its display caption —
`Status: { value: "<guid>", displayValue: "Error" }`. So reading a caption off a row costs nothing
extra; you almost never need a separate lookup read. If you do need the full lookup table (e.g. to
enumerate every `Operation`), `creatio_list_records` on `ConfOperation` /
`ConfActivityStatus` / `ConfElementType` with `columns: ["Id","Name"]` still works.

## When there is no error: deciding which records are candidates

The queries above find *a* record. They do not tell you whether it has anything to do with the incident —
and when the symptom carries **no error at all** ("the change isn't there", "the section behaves oddly",
"this stopped working"), that question is the whole investigation.

**The environment will not be quiet.** A working stand accumulates deliveries, builds, schema saves and
per-element rows from other people's work, most of it unrelated to what was reported. Picking the newest
row and explaining the symptom with it is the single easiest way to produce a confident wrong answer.

> **The newest record is not the default cause** `[observed]` — on an environment with several
> recent deliveries, the most recent one is easily analysed and reported as the incident when the incident
> was elsewhere, or left no record at all. Recency is a tiebreaker, never a reason.

Work the gates in order. Each one either keeps a record as a candidate or **sets it aside with a stated
reason** — never by impression.

**Gate 0 — name the anchor.** Filtering needs something to filter *on*: the object, section, page,
package or application the symptom is about. If the user named nothing concrete, ask for it. Without an
anchor there is no relevance test, and what looks like analysis is a guess with extra steps.

**Gate 1 — bound the window from the last known good, not from the newest row.** "It worked on Monday"
is the lower bound; the report time is the upper one. If no lower bound is available, say so explicitly —
an unbounded search makes every record a candidate, and that is a fact about the evidence, not a licence
to pick one.

**Gate 2 — element overlap, the strongest test.** A record is a candidate when it, or one of its
children, touches the anchor: the object itself, its package, the schema it inherits from, or something
that depends on it. Resolve those first (the anchor's package and parent schema are one read each), then
match against the `Element` values on the rows. **A record touching none of them is set aside.**

**Gate 3 — could this operation produce this symptom at all?** Ask it mechanically, not charitably: an
operation that cannot reach the thing that broke is out. Localization work does not remove a column; a
binding install does not change compiled behaviour; a build does not alter data.

**Gate 4 — did it change anything?** A record that failed before writing anything — no child rows, a
terminal failure at an early stage — cannot be the cause of *new broken behaviour*.
> **Mind the direction of this one.** The same record is the **prime** candidate for the opposite
> symptom: when the complaint is *"our change is missing"*, a delivery that ran and applied nothing is
> exactly the explanation. Gate 4 excludes on "new breakage", and promotes on "expected change absent".

**Gate 5 — authorship and routine noise.** Rows from other people's work, and the per-element cascades a
single operation generates, crowd the result. This demotes a record, it does not eliminate it — someone
else's change breaks things as often as your own.

**Then report the sift, not just the survivor.** Say how many records were in the window, how many
survived, and on which gate the rest were set aside. An exclusion nobody can see is an exclusion nobody
can challenge — and the cost of discarding the real cause is paid by the next person, who has no way of
knowing it was discarded.

**If nothing survives, that is a finding — and it is not the end of the investigation.** "No record in the
window relates to the reported object" is a useful, defensible answer, and you must not relax the gates
until something passes. But an empty log **hands the investigation over, it does not close it**: the
domain's catalogs are organised by **signature and symptom**, not by record, so the next move is to sweep
them with what the user actually reported — the error text they pasted, the dialog they saw, the behaviour
they described.

> **For whole families of incident, no record is the expected state, not a gap.** Anything refused before
> the platform was reached — by a proxy, by a pre-flight check in the UI, by a pipeline step that never
> got to the site — leaves nothing to find, and several catalog entries are written around exactly that.
> So an empty result narrows the search instead of ending it: it **rules out** everything that would have
> left a trace, and points at the entries that would not.

Report it in that shape: what the gates eliminated, that no record remains, and which catalog entries the
symptom was then matched against — including the ones that were ruled out. An investigation that stops at
"I found no evidence" has searched one of the two places the answer lives.

## Walking the parent-child tree

- **Children of a record:** `creatio_list_records` on `ConfActivityLog` with
  `filters: { all: [ { field: "Parent.Id", op: "eq", value: "<recordId>" } ] }`, `orderBy: "CreatedOn asc"`.
- **Parent of a record:** read the record's `Parent` value, then `creatio_get_record` that Id.

Use the tree to place a failed operation next to the change (e.g. an `Update`) that preceded it — this is how
`rca-root-cause-vs-consequence` separates the trigger from the cascade.

## Guardrails

- Read-only: use only `creatio_describe_object`, `creatio_search_objects`, `creatio_list_records`, `creatio_get_record`.
  Never `creatio_create_record` / `creatio_update_record` / `delete` / `execute-process` — see the read-only rules (`rca-safety-and-access`; on the AI Platform, the system prompt).
- If a query returns nothing, widen the time window or relax a filter before concluding "no data".
- Report the exact record `Id`/`Number` used, so findings are reproducible.
- **A record's `Operation` and `Status` are evidence that an operation was *attempted and reported*, never
  evidence of what it *did* to the environment.** The log is a record of intent and self-reported outcome;
  the effect lives in the data. So a row does not license a claim about consequences — read the affected
  data and say what you found there.

  Verified live, and it is the trap: a `Clear configuration activity log` row with `Status = Success`
  invited the conclusion that earlier history had been erased. One read falsified it — the same
  `ConfActivityLog` still held **32 665 rows spanning three months**, including records older than the
  clear. Nothing observable was removed.

  The same shape recurs across operations, so treat the pattern rather than this instance: an install that
  reports `Success` may have persisted nothing; a `Compilation` row says a build ran, not that the current
  binaries came from it; a restore row says a restore was requested. **Whenever a conclusion depends on an
  operation's effect, name the read that shows it** — and if no allowed read can show it, report the
  operation as a claim and the effect as **not established**.
