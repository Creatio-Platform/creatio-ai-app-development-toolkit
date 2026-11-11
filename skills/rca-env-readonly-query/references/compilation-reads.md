# rca-env-readonly-query — compilation reads

Part of `rca-env-readonly-query`: the reads that answer what a compilation reported, project by project,
and whether the build is broken now — also when the compilation ran as a stage of a delivery. The skill's
`SKILL.md` holds what applies to every read here: read-only access, when to describe an object first, and
the lookup naming rule (filter through the bare lookup name, never the `Id` alias).

## CompilationHistory — details of a compilation

`CompilationHistory` stores build results **linked to a `ConfActivityLog` record**, with **one row per
compiled project** (a full workspace build produces many rows — e.g. ~26). It is server-side read-only (the
platform's `CompilationHistoryEventListener` rejects any write), so it is safe evidence.

Expected schema (confirm per environment with `creatio_describe_object`):

| Field | Meaning |
|---|---|
| `ConfActivityLog` (Guid) | **FK to the `ConfActivityLog` record** — filter on this. (Plain Guid column, not `ConfActivityLogId`.) |
| `ProjectName` | Compiled project: `<Package>.csproj` for a package compiled into a separate assembly, or the shared configuration project (`Terrasoft.Configuration.Dev.csproj`) that compiles **every ordinary package at once**. Attribute a diagnostic to a package by its `FileName` (`<Schema>.<Package>.cs`), not by this column. |
| `Result` (Boolean) | `true` = built OK, **`false` = this project failed**. |
| `ErrorsWarnings` (text) | **JSON array** of diagnostics: `[{ "Line", "Column", "ErrorNumber", "ErrorText", "IsWarning", "FileName" }]`. Empty build = `"[]"`. |
| `DurationInSeconds` (Integer), `StartedBy` (lookup) | Build timing / initiator. |

Query pattern — go straight to the failures:

1. `creatio_list_records` on `CompilationHistory` with
   `{ "objectCode": "CompilationHistory", "columns": ["Id","ProjectName","Result","ErrorsWarnings","DurationInSeconds"], "filters": { "all": [ { "field": "ConfActivityLog", "op": "eq", "value": "<logId>" }, { "field": "Result", "op": "eq", "value": false } ] } }`.
   **Filter `Result = false` only when the log record's `Status` is `Error`.** For a record whose status is
   `Warning` or `Success`, drop that filter and read every row of the record: warnings live on
   `Result = true` rows, so a warning-only build has no `Result = false` row at all — the filter returns
   nothing and hides exactly what the warnings gate in `compilation.md` needs.
   Always include `Id` in `columns` — you need the row's own Id for the narrow re-fetch in step 2.
   **Issue this broad query once per investigation — where "an investigation" means one user request, not
   the whole conversation.** A new message from the user starts a **new** investigation, and a new
   investigation re-establishes currency first (see the closing note on follow-up turns below); this
   anti-repetition rule governs only what happens *inside* one request and never licenses carrying a
   previous turn's conclusion forward as still true. If the row(s) you need aren't in the result (e.g. you
   filtered by the wrong `ConfActivityLog` value, or need the warning-bearing rows too — see below), fix
   the filter and reissue — don't stack a second, broader, unfiltered listing on top of a result you
   already have. A full `CompilationHistory` listing (up to ~26 rows, each carrying a JSON diagnostics
   array) is large; re-reading the same rows a second or third time with slightly different `columns`
   wastes context budget you need for the actual analysis and is a known cause of degraded answers on long
   runs. If you already have a row's `ErrorsWarnings` in context from an earlier call **for this same user
   request**, reuse it — never re-fetch it "to be sure". (This is about not repeating the *broad* listing —
   narrowing in on one row you already found, per step 2 below, is a different, encouraged thing.) Reuse
   is only safe once the row is still known to belong to the current latest compilation: on a **follow-up
   turn**, confirm that first (see the closing note below) — reusing a row whose compilation has since
   been superseded is not efficiency, it is a stale answer.
2. **If a response looks cut short** (the JSON ends mid-object, or reading the rest of the same call keeps
   returning the same prefix instead of more of the array (on the AI Platform: a follow-up
   `fetch_full_tool_result` on that call)), **don't just retry the
   identical broad query — narrow it.** Re-read the *same row* with
   `{ "objectCode": "CompilationHistory", "columns": ["ErrorsWarnings"], "filters": { "all": [ { "field": "Id", "op": "eq", "value": "<the row's own Id>" } ] } }`
   — a single column, filtered directly by the row's own Id, dropping `ProjectName`/`Result`/
   `DurationInSeconds`. Every column in a response shares the same size budget as the array itself;
   dropping the ones you don't need for this pass leaves more room for `ErrorsWarnings` and is more
   effective than repeating the exact same multi-column query and hoping for a longer answer.
3. Parse each row's `ErrorsWarnings` JSON. For each entry: `IsWarning: false` = a real **error**
   (e.g. `ErrorNumber: "CS1002"`, `ErrorText: "; expected"`, `FileName`, `Line`, `Column`);
   `IsWarning: true` = a **warning** (non-blocking, but still a real problem). A real build on this kind of
   project can easily carry **20-30+ generated-code warnings** (`CS0108`/`CS0114` on OAuth/Sso/event-process
   code is a common, completely benign pattern here) **before the first real error even appears in the
   array.** A row with `Result = false` is logically guaranteed to contain at least one `IsWarning = false`
   entry — that is what makes it failed; this is a hard fact, not a probability.
   **Never let signature-recognition override this filter.** `compilation-catalog-cases.md`/
   `compilation-catalog-reference.md` (opened later, at `compilation.md`'s Verify step 7) name some
   error/warning codes explicitly (e.g. `CS0108`/`CS0114`
   "member hides inherited member" is a documented, commonly-seen warning signature) — recognizing that
   signature is not evidence that this entry is the blocking error, and a well-documented, easy-to-explain
   warning is not more relevant than an error you haven't found yet. Before naming *any* entry as "the
   blocking error" or matching it against a catalog signature, first state the partition for this row:
   total entries, how many `IsWarning: true`, how many `IsWarning: false`. Only an `IsWarning: false` entry
   is eligible to be reported as the cause of a failed build (`Result: false`).
   - **If every entry you've read so far is `IsWarning = true`, that means you have not reached the error
     yet — it is not evidence the build's real problem is a warning.** Use step 2's narrow re-fetch and try
     again. Needing **4, 6, or more rounds** of this before finding the first error is normal and expected
     for a build with a long warnings preamble — it is not a signal to stop, and it is not itself
     noteworthy enough to mention as a limitation.
   - Never write "the payload was too large to cleanly extract" as a closing caveat while still naming a
     warning as your answer, and never substitute a recognized `IsWarning: true` entry for the real error
     just because it is easier to explain — an unreached error is a reason to keep narrowing and re-reading
     (step 2), not a reason to give up or guess.
4. Feed the entries into the compilation domain (the `rca-knowledge-base` skill's `references/compilation.md`) for interpretation.
   This structured detail is **the only evidence you need** for a compilation. **Do not fetch the log
   record's `Description` field for this** — it is large HTML that repeats the same diagnostics you
   already have in `ErrorsWarnings`, just far more verbosely; pulling it adds a large, redundant block to
   context for zero new information. **This exemption is specific to compilations**, and only because
   `CompilationHistory` already carries the same detail in structured form. For other logged operations —
   a configuration `Update` above all — `Description` is not redundant, it is where the change detail
   lives; see `rca-cal-read`'s "Reading the Description".

To also assess warnings, reuse the same rows from step 1 (drop the `Result = false` filter only if you
didn't already fetch the unfiltered set) and collect the `IsWarning: true` entries (they can span many
projects, e.g. generated code) — don't issue a second full listing if the first one already had what you
need.

### Follow-up turns — confirm the run is still the latest before reusing its rows

Everything above assumes you are analyzing **the compilation the user is actually asking about right now**.
The environment is shared and moves between turns: another user can compile, or **install an application,
which runs a compilation of its own**, without the person talking to you knowing about it.

So on the **second and later** message of a conversation, before you reuse any `CompilationHistory` row
from context, first re-run `rca-cal-read`'s **currency re-check** (latest `Operation = Compilation`, *any*
status, narrow columns) and compare it to the record those rows belong to. **Do this before deciding what
the follow-up is asking for** — "they only want the warning explained, so the rows I have are enough" is
exactly the reasoning that produces a stale answer, because the explanation and the fix you attach to it
are about an environment that may have moved. Run the check first, then decide:

- **Same record** → reuse what you already have; the anti-repetition guidance above applies in full.
- **A newer compilation exists** → the rows in context describe a **superseded** run. Notify the user
  about the newer run(s) first — count, timestamp, status, and `CreatedBy`/`Parent` (a `Parent` of
  `Install application` means an app installation triggered it) — per the follow-up-turn rule (`rca-orchestration`; on the AI Platform, the system prompt), then answer the question they asked, stating plainly which run your answer covers.

Re-running that one narrow currency query on a follow-up turn is **required, not redundant** — it is the
only thing standing between a reused row and a confidently stale answer.

## Build state checks (verified via `creatio_describe_object`, not assumed)

### `VwCompilationErrors` — current, run-independent compilation-error state

Verified columns: `Id`, `ProjectName` (LongText), `ErrorsWarnings` (MaxSizeText — **same JSON shape as
`CompilationHistory`**: `[{Line,Column,ErrorNumber,ErrorText,IsWarning,FileName}]`). **No FK to
`ConfActivityLog`** — this view is a global snapshot, not tied to one run (it's what a compile-error
indicator/badge typically queries, independent of any specific log record).

Use this whenever a stored compile-error state seems to contradict a fresh compile result — a classic "is
this actually still broken, or just a stale flag" question (e.g. an install blocked by a stale
"compilation errors on site" message, or a UI transport error where the build itself actually finished).
Read `columns: ['ProjectName','ErrorsWarnings']` and compare against the **latest** `CompilationHistory` row
for the same `ProjectName` — if this view still lists errors for a project whose most recent actual compile
succeeded, that is direct, strong proof the stored state is **stale**, not a live failure (see
`rca-root-cause-vs-consequence` "current or already recovered"). Never pull this view unfiltered yourself —
a small, limited read (e.g. `limit: 5`) is enough to know whether it's empty; an unfiltered pull against
this view is a known source of heavy DB load.

**Timestamp comparison alone is not enough** — a package that nothing has touched since the recorded
failure will never get a newer `CompilationHistory` row, so "no newer row exists" does not mean the error
is still live. This view can hold a failure for a schema/file that has since been **deleted or renamed**
without ever being cleared, because nothing forced a recompile of that project afterward. Before treating
an entry here as current, extract the schema name from its `FileName`/`ErrorText` and check `SysSchema` by
that `Name` — if no such schema exists any more, the stored error is unconditionally stale regardless of
timestamps, and you should say so rather than presenting it as the live cause.

**This check has no exceptions for incidental mentions.** It applies every time you cite this view for
anything — including a passing remark, a "the only other confirmed issue is..." aside, or supporting
context for an unrelated finding — not only when the row is the central hypothesis you set out to verify.
Citing an unchecked row as "confirmed" or "the only current build error" is the same mistake as leading
your whole diagnosis with it; check first, in every case, or don't cite it as current at all.

### `SysPackageReferenceAssembly` — is a reference assembly published?

Verified columns: `Name` (MediumText), `FullName`, `SysPackage` (Lookup → `SysPackage`, bare name — no
`Id` suffix; the scalar FK alias `SysPackageId` projects but is not filterable via dotted navigation),
`IsPublic` (Boolean, caption "Assembly is public"), `LoadOnAppStart`, `IsNetStandard`.

Use this when a foundational/vendor package fails to compile on every environment of a given build with no
apparent custom change — check whether one of its reference assemblies is published. Read filtered by
`Name` (or `FullName`) using the assembly file name from the error text and report the `IsPublic` value as
evidence; do not change it — recommend the flag flip
(`UPDATE SysPackageReferenceAssembly SET IsPublic = 1 WHERE Name = '<assembly>.dll'`) as a manual
admin/SQL step.

### `PackageCompilationState` — is a specific package flagged as needing compilation?

Verified columns: `PackageUId` (Guid — **not a lookup**, so resolve it via `SysPackage.UId` first, not by
package name directly), `NeedCompile`, `NeedCompileDependentPackages`, `NeedDownloadPackageSourceCode`,
`NeedRegeneratePackagesCsproj`, `NeedCompileOData`, `RequiresRestore` (all Boolean).

Use this when a package's own autogenerated schemas show errors that look like the package itself was
never compiled, rather than a genuine code defect. Two-step read: (1) `SysPackage` filtered by
`Name eq '<package>'`, `columns: ['UId']`; (2) `PackageCompilationState` filtered by
`PackageUId eq <that UId>`. A `true` on `NeedCompile`/`NeedCompileOData` persisting after an otherwise
clean full compile corroborates "this package still needs its own explicit compile" — treat it as
corroborating evidence, not the only proof; the `CompilationHistory` error naming that package's
autogenerated schema is the primary evidence.

### Post-install build state

Reuse **`VwCompilationErrors`** (current, run-independent error state — the right read for "is the
environment broken *now*") and **`CompilationHistory`** filtered by the `ConfActivityLog` Id of the
compilation record, exactly as described earlier in this file. Nothing changes when that compilation ran
as part of a delivery: the partition mechanics are the same.
