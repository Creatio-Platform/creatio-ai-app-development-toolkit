# Domain: Compilation

How to analyze a Creatio **compilation** result recorded in the Configuration Activity Log — whether it
succeeded cleanly, succeeded **with warnings**, or **failed**. Covers the base case (a source-code schema
edit that breaks the build and/or leaves non-blocking warnings). Two separate references hold the rest —
each kept deliberately small so it reliably reads in full:
- `compilation-catalog-cases.md` — real-world cases matched **by error signature**. **Open
  it only at Verify step 7 below**, after you have already classified the outcome and identified the
  actual blocking error(s)/warning(s) from `CompilationHistory`. Do not open it earlier "just in case" —
  recognizing a catalog signature is never a substitute for checking `IsWarning` first, and a
  well-documented warning is not more relevant than an error you haven't found yet.
- `compilation-catalog-reference.md` — generic `CS####` fallback tables (when no specific case
  matches), advisory/consultation topics (recurring expected-behavior questions with **no error at all**,
  e.g. "why does the system freeze during compile"), **and the cross-turn currency rule (§3, case C39)**
  for follow-up turns. Open this one directly, skipping the whole Verify loop below, whenever the incident
  has no error to classify or partition — see §1's last bullet.

Pattern: **signature → classify the outcome → warnings gate → verify → (only if still needed) case catalog / fix → report.**

---

## 1. Signature — does this domain apply?

Open this file when a `ConfActivityLog` record has **Operation = `Compilation`** (any `Status`:
`Success` / `Warning` / `Error`) and links to **`CompilationHistory`** rows (one per compiled project),
each carrying an **`ErrorsWarnings`** JSON array of diagnostics
`[{ Line, Column, ErrorNumber, ErrorText, IsWarning, FileName }]`. It also applies when the user **pastes
a build/compiler/server/browser error signature directly** (a log excerpt, a stack trace, a browser-console
error, an installer message) — for that case, check it against `compilation-catalog-cases.md`
directly, even before you have located — or when there never will be — a `ConfActivityLog` record for it
(many Tier B/C cases never produce one; there is no `ErrorsWarnings` array to partition in that situation).

**First, check whether the compilation ran as part of an installation.** If the `Compilation` record has
a `Parent` whose Operation is `Install application or package` / any `Install*` — or the
user was delivering a package when it broke — the incident belongs to `installation.md`, which
owns the delivery context and reuses this file's mechanics from its **compilation stage**. Route there —
**unless you arrived from that spine already**: it sends the agent here *for the mechanics*, so in that
case read §2 and Verify step 2 for the `ErrorsWarnings` / `IsWarning` partition, hand the diagnostics back
to the spine, and do not route out again. Coming from the classifier instead, stop here and route there:
the fix for an install-time build failure is almost never "correct this line", it is "the delivery was
incomplete", and only the spine has the installation log that shows which stage produced the error.
A compilation someone started on its own (no install parent) is this file's own case — continue below.

> **What the spine does with what you hand back.** Its §5.2 runs a gate before any cause is named: did the
> delivery break the build, or did it run a build that was already broken? That question is not answerable
> from this file — it needs the delivery's package list, the build's scope and the build state that
> preceded the delivery — and its answer decides who the fix is addressed to. So when you arrive from the
> spine, supply the partition and the per-project attribution (`ProjectName`, `FileName`, `ErrorNumber`)
> and let §5.2 settle the verdict; when you arrive from the classifier with an install parent in front of
> you, route there rather than answering from the error text alone.

- `IsWarning = false` → a real **error** (blocking; the project fails, `Result = false`).
- `IsWarning = true` → a **warning** (non-blocking, but still a real problem to fix).
- **No error at all — a pure advisory/consultation question** (e.g. "why does compile freeze the system
  for everyone", "can we schedule compile to run at night", "what's the difference between Compile and
  Compile all", "why does full source generation take hours"): there is nothing to classify or partition.
  Skip straight to `compilation-catalog-reference.md` §2 for the matching topic — do not run
  the Verify loop below looking for an error that isn't the point of the question.

## 2. Classify the outcome — always do this first, and state it explicitly

Read the detail (see Verify) and report **exactly one** outcome. Never round a warning-bearing build up
to a plain "success":

| Outcome | Condition |
|---|---|
| **Success** | no `Result = false` row **and** no `IsWarning = true` entry — clean build. |
| **Success with warnings** | no `Result = false` row, but ≥1 `IsWarning = true` entry. Build produced output, **but has non-blocking issues that still should be fixed**. |
| **Failed** | ≥1 `Result = false` row (errors, `IsWarning = false`), no warnings. |
| **Failed + warnings** | errors **and** warnings both present. |

> Warnings are **not** "nothing". `Status = Warning` / any `IsWarning = true` means real, non-blocking
> problems — report them as such and offer fixes; do not call the build a clean success.

This classification applies to the base `ConfActivityLog`/`CompilationHistory` path. Some
`compilation-catalog-cases.md` entries (especially Tier B/C) describe symptoms that never reach this
classification at all — e.g. the build never started, or the log never recorded it. If the user's report
already has that shape (a pasted signature with no plausible record), skip this classification and open
the cases catalog directly for the matching entry.

## 3. Warnings gate — ask the user before the detailed analysis

Whenever the outcome includes warnings (**Success with warnings** or **Failed + warnings**), then
**before** starting the pointed root-cause↔consequence analysis, **ask the user** whether they also want
the **warnings** analyzed and fixed. It is optional — their choice. For example:

> "The build has **N warning(s)**" (and, if applicable, "besides **M error(s)**"). "Do you want me to
> analyze the warnings and give fix recommendations too, or focus on the error(s) only?"

- If **errors are present**, always analyze the error root cause; the **warnings analysis is the optional
  add-on** the user opts into.
- If it is **Success with warnings** (no errors), ask whether to break the warnings down with fixes or
  just summarize them.
- Proceed per the answer. If you genuinely cannot ask (non-interactive run), default to: full error
  analysis (if any) + a short warnings summary, and state that a detailed warnings breakdown/fix is
  available on request.

## 4. Verify — gather evidence (read-only)

1. **Get the record** (`rca-cal-read`): by Id/Number if given. Otherwise:
   - **Default — the latest `Operation = Compilation` of *any* status**, `orderBy CreatedOn desc`, filtered
     by the **operation only**. Use this for "what's the status of the last compilation?", for any question
     about current state, and whenever the user hasn't specifically reported a failure. **Do not add a
     `Status` filter**: the newest run's status is part of the answer, and filtering to `Status = Error`
     when the latest run actually succeeded returns an **older, already-resolved** failure — or nothing at
     all — which is how a healthy environment gets reported as broken.
   - **Only when the user has explicitly reported a failure** ("the compilation is failing", "why did the
     build break") **and** you need the most recent *erroring* run specifically: add
     `Status = Error` to that filter. Even then, still compare it against the actual latest compilation
     (the default query) before treating it as current — see step 6.

   **If there is no record** — the user only pasted an error signature — skip straight to step 7.
2. **Read the build detail** (`rca-env-readonly-query`): read `CompilationHistory` filtered by
   `ConfActivityLog = <recordId>`. Parse each row's `ErrorsWarnings` JSON:
   - **Errors** = entries with `IsWarning = false` (rows with `Result = false`) → `ErrorNumber`,
     `ErrorText`, `FileName`, `Line`, `Column`. `FileName` names the offending schema **and its
     package** — `<Schema>.<Package>.cs`, e.g. `UsrSourceCodeWithSomeLogic.NewPackageFortesting.cs` — so
     attribute by it: `ProjectName` names a package only for a separate-assembly project
     (`<Package>.csproj`), while the shared configuration project (`Terrasoft.Configuration.Dev.csproj`)
     compiles every ordinary package at once.
   - **Warnings** = entries with `IsWarning = true` (may span many projects — e.g. generated code).
   Use this to classify the outcome (step 2). **Finish this partition — the complete list of errors vs.
   warnings for the failing row(s) — before going anywhere near step 7's catalog.** An entry being a
   recognizable, well-documented warning signature is not a reason to report it as the blocker instead of
   continuing to look for the actual `IsWarning: false` entry.
   **Zero rows on a `Success` record is a valid result, not missing data.** `CompilationHistory` gets one
   row per project that actually went through the compiler, so an empty result for a successful compilation
   means the build was **incremental and found nothing that needed rebuilding** — no project was compiled.
   Report it as that outcome; do not describe it as detail you were unable to read, or as a limitation of
   the query you ran.
3. **(Optional) Read the log `Description`** only for a narrative summary; the structured
   `ErrorsWarnings` above is the primary evidence.
4. **Find the trigger** (`rca-root-cause-vs-consequence`, for errors): follow the dependency direction — the
   schema whose *own* code is invalid is the root; schemas failing only because they reference it are
   consequences. If a change preceded the build, check the parent-child tree (`Parent.Id`) for an
   `Update` to the offending schema just before the `Compilation`.
5. **Confirm** each reported error's schema/file + exact `ErrorNumber`/`ErrorText` is backed by a
   `CompilationHistory` row you actually read. If not, present it as a hypothesis with lowered confidence.
6. **Check currency — is this still the build state?** A failed compilation may already be fixed.
   Determine whether the failing record is the **latest** `Operation = Compilation`, or whether a **more
   recent** `Compilation` with `Status = Success`/`Warning` ran after it (⇒ the failure was resolved).
   Also note any later `Clear configuration activity log` / cleanup operation, which can leave an **old**
   failure as the last visible compilation. Report the failure with its **date** and say plainly whether
   it reflects the current state or is a historical incident whose current status you cannot confirm from
   the log.
   **On a follow-up turn, currency is not something you established once — re-establish it, as your first
   action, before deciding what the follow-up is even asking for.** A request to explain the finding, break
   down a warning, or give a fix path does **not** exempt you: the fix and the "recompile and verify" step
   you attach to it are about the live environment. The
   environment is shared: between your last answer and this message, another user can have compiled, or
   **installed an application, which runs a compilation of its own**, with the person talking to you having
   no way to know. Re-run `rca-cal-read`'s **currency re-check** (latest `Operation = Compilation`, *any*
   status, narrow columns — not filtered to `Status = Error`, since a newer `Success`/`Warning` run is
   precisely what you're looking for) and compare it to the record you analyzed earlier in the
   conversation. If a newer run appeared, **notify the user about it before answering** — how many, when,
   each status, and `CreatedBy`/`StartedBy` plus the record's `Parent` (a `Parent` of `Install application`
   means an app installation triggered the compile, not a person) — then answer the question they actually
   asked, saying explicitly which run your answer describes. See case **C39** in
   `compilation-catalog-reference.md` §3.
7. **Only now, open `compilation-catalog-cases.md`** and match the signature you already
   identified in step 2 (the actual `IsWarning: false` error(s), or a pasted excerpt) against its entries.
   Beyond the generic `CS####` code, check the exact `ErrorText`/stack-trace shape against the catalog's
   entries — several real cases share a `CS####` code with the base happy-path but need a *different, more specific* check (e.g. a plain `CS0234` is usually stale generated code, but if it started right after an 8.3.x upgrade and regeneration didn't help, that's a different case). When a catalog entry matches, follow **its own** Verify/Recommendation and tier
   discipline instead of improvising. If nothing there matches, `compilation-catalog-reference.md`
   §1 has generic `CS####` fallback tables. If step 2 already gave you a clean, self-explanatory error with
   an obvious fix, you may skip this step entirely — the catalogs are a lookup aid for recognized/tricky
   signatures, not a mandatory stop on every investigation.
   **If the build ran under a delivery, read the entry's delivery variant, not its stand-alone reading.**
   Several entries carry both, and they differ in the only way that matters: the stand-alone fix acts on
   the environment in front of you, while the delivery variant usually acts on the **source** environment
   and the archive it produced. Recommending "regenerate source code and compile all" for a package that
   arrived broken is the characteristic form of this mistake — it is the right answer for exactly one of
   the delivery entries and wrong for the rest.

## 5. Report

State the **precise outcome first** (Success / Success with warnings / Failed / Failed + warnings — or,
for a signature-only Tier B/C match with no `ConfActivityLog` record, say so plainly instead), then hand
to `rca-diagnosis-report`:

- **Errors** (if any): root cause (the offending schema + error, or the underlying condition identified via
  a matched catalog entry — describe it in plain technical language; never cite the catalog entry's own
  `C##` id or its tier to the user, see `rca-diagnosis-report`) → evidence (log record Id/Number +
  operation/status; verbatim `ErrorNumber`/`ErrorText`/`FileName` from the failing `CompilationHistory`
  row, plus whatever catalog-specific check you ran — e.g. an `IsPublic` value, a `VwCompilationErrors`
  state) → consequences (dependent errors, briefly) → recommendation.
  **If the build was broken by something that can simply be undone** — a schema or business process newly
  created, an application installed, a schema edited, a package deleted, an assembly reference removed —
  the recommendation splits into the labelled **Unblock now (temporary)** / **Proper fix** branches (see
  `rca-root-cause-vs-consequence`'s "Quick unblock"). **The most common case by far is a newly created
  element**: a business process or source-code schema is added, its generated code doesn't compile
  (`CS0161`, `CS0029`, `CS1002` in a `UsrProcess_*`/`Usr*` generated file), and every build fails from
  that moment. Deleting the element that was just created — or removing only the script task whose
  generated code is broken — restores a compiling configuration immediately, at the cost of that new
  element, while the proper fix repairs its logic. Do not force the split when the trigger has no real
  reversal — an environment/SDK condition, or an error whose only fix is correcting the source.
- **Tier B/C matches** (see `compilation-catalog-cases.md`'s legend): apply the tier discipline, don't
  narrate it — never say "Tier B", "Tier C", or a `C##` id to the user. For a **Tier B** match: lead with
  what you confirmed on-platform vs. what you're inferring from the error signature alone, in plain
  language (e.g. "the error text matches a known pattern where X; I could confirm Y from the environment,
  but not Z"). For a **Tier C** match: lead with a plain-language description of the likely cause based on
  the signature (e.g. "this matches a known .NET SDK / permissions / server-configuration problem" — never
  "this looks like case C18"), say clearly you cannot verify the server/file-system/browser state from
  this environment, and give the known fix as a recommendation to relay to infra/support — not as a
  confirmed diagnosis you performed.
- **Warnings** (only if the user opted in): grouped by code, each with meaning + fix recommendation,
  actionable vs benign clearly separated (see `compilation-catalog-reference.md` §1b for common warning
  signatures). If the user declined, give just the count and note that a detailed breakdown is available
  on request.
- **Recency:** state the failing compilation's **date** and whether it is the current build state or a
  historical incident (per Verify step 6). Never present an old, possibly-resolved failure as a live
  outage.
- **Advisory topics:** for a recurring expected-behavior question (compile-time load/restart, full
  generation duration, `VwCompilationErrors` DB load, Compile vs. Compile all) rather than a real
  incident — see `compilation-catalog-reference.md` §2 — no error/recency framing needed; lead with the
  explanation, close with the recommendation.
- **Confidence & gaps.**

---

## Boundaries (current scope)

**Covered:** the base compilation flow above (§1-4), plus the compilation cases
**and the delivery-context cases** of the installation domain — split across two on-demand references, neither
read up front:
- `compilation-catalog-cases.md` — the error-signature cases, opened at Verify step 7.
- `compilation-catalog-reference.md` — generic fallback tables, the advisory topics and the
  cross-turn currency rule (C39), opened at Verify step 7 (fallback), directly from §1's last bullet (pure
  advisory questions, no error), or on any follow-up turn.

See each file's own Boundaries section for exact coverage/tier details.

**Covered, but owned by another file:** install-time build failures — a `Compilation` whose `Parent` is an
install operation. They are the **compilation stage of a delivery**, and `installation.md` owns
them: it reads the installation log, runs the §5.2 gate that establishes whether the delivery broke the
build or found it broken, and reuses this file's `ErrorsWarnings` mechanics and the delivery variants in
`compilation-catalog-cases.md`. Route there (see §1's first rule) — do not answer an install-time
build failure from this file alone, and do not report it as an uncovered incident.

**Not yet covered:**
- Anything outside compilation (App Hub, schema conflict, localization, data-binding, etc.) — route via
  `NAVIGATION.md` instead of improvising here.
