# RCA Knowledge Base — Navigation

Entry point for the RCA agent's domain knowledge. Classify the incident, then open the matching domain file
(it sits next to this one in `references/`). Each domain file follows the pattern
**signature → hypothesis → verification (read-query) → fix**.

Read this at the start of every investigation (the agent's loop, step 1).

## How to classify

1. **If you have a `ConfActivityLog` record** (Id / Number / link): read it with the `rca-cal-read` skill and note
   its **Operation**, **Type**, and **Status** (the reliable classifiers). `Description` is a large HTML
   summary — you rarely need it just to classify.
2. **If the user pasted a specific error signature** (a server-log excerpt, a stack trace, a browser-console
   error, an installer message) **instead of, or alongside, a record**: match its text directly against a
   domain file's signature catalog — check more than the first domain that comes to mind. **A generic
   runtime/service exception (e.g. `FileNotFoundException`, `WebException`, an HTTP `0`/`502`/`413` popup)
   is not automatically a compilation signal just because it reads like an error.** Several
   `feature-flags-and-settings.md` cases are triggered by a disabled feature or unset setting but still surface as
   exactly this kind of exception (e.g. its `FS2`: `System.IO.FileNotFoundException: Could not find file
   'Package.zip'` from a zip install — caused by a feature gating the upload sequencing, not a broken
   build). Ask what operation actually failed: a build/compile in progress → check compilation's
   `compilation-catalog-cases.md`; an **App Hub/UI action** (install, export, deploy) with no compiler
   code (`CS####`) attached → check `feature-flags-and-settings.md`'s catalog too, even though the pasted text is
   shaped like a stack trace. Do **not** assume you first need a `ConfActivityLog` record. Many real
   incidents (server/SDK, file-system, browser-side) never produce an activity-log entry at all; the
   pasted text *is* the evidence. Still try to locate/corroborate with a `ConfActivityLog` record
   afterwards if one plausibly exists — pasted evidence and a platform record are complementary, not
   exclusive.
   **The same question settles the delivery case, and it is the one most often skipped.** A compiler code
   (`CS####`) or a database error (`23503`, `23505`, `42P01`, an `ALTER TABLE` conflict) raised **while a
   package or application was installing** is a stage of that installation — not a compilation and not a
   standalone database incident. Route it to `installation.md` (step 5), which owns the delivery context
   and hands the error to the right catalog from the stage the installation reached.
3. **If the symptom is a missing/unexpected UI option or behavior, with no error at all** (e.g. "there's
   no Export button," "it opens the old-style page," or a direct "is X feature/setting enabled" question):
   route **directly** to `feature-flags-and-settings.md` without first trying to fetch a `ConfActivityLog` record — a
   disabled feature or an unset setting never logs an error, so defaulting to an activity-log fetch here
   just wastes a round-trip on evidence that doesn't exist.
   **Exception — a delivery came first:** if a package or application was installed shortly before the
   symptom appeared, step 5 wins instead, even with no error in sight.
   **Exception — the subject is a package, not a UI option:** "why is this package read-only / greyed
   out", "where did a package with a generated name come from", "can we move the Custom package" are
   **delivery** questions and belong to step 5's non-incident route. No feature or setting produces those
   symptoms, so probing feature state answers nothing; the rule that does is the package maintainer
   against this environment's own maintainer value, which `installation.md` §1a routes to.
4. **If you only have a symptom and no specific signature, and it doesn't match step 3's pattern** (a
   plain sentence from the user, but plausibly error-driven): **read the sentence for the operation it
   names before you query anything.** If it names a delivery — install, update, reinstall, uninstall,
   "app", "package", "deployment" — **go to step 5 now**: the operation is already established and step 5
   owns it. Running a query first is how a delivery question gets answered about a compilation.
   **A question about how an operation runs is not a symptom to fetch a record for.** "My connection
   dropped / the progress bar vanished — did the install or compilation crash?" is answered completely by
   a platform rule: no — the work runs on the server, and the browser only displays it. Route it to
   `installation.md` §1a, whose consultation entry covers compilation as well as delivery, **without**
   fetching the latest compilation or delivery first.
   Otherwise fetch the most relevant activity-log record, then classify from it. **Filter by the operation
   the question names, not by the status you expect — and there is no default operation**: for a
   build/compile question that filter is the latest `Operation = Compilation` of *any* status,
   `orderBy CreatedOn desc`; for any other operation it is that operation's own captions. Adding `Status = Error`
   here is a trap: if the latest run actually succeeded, that filter skips it and hands you an **older,
   already-resolved** failure — or nothing at all — so a healthy environment reads as broken, or the
   record "isn't found". The status you read off the newest row **is** part of the answer; narrow to
   `Status = Error` only when the user has explicitly reported a failure *and* you specifically need the
   most recent erroring run (see the domain file's own Verify step).
5. **If the incident is a package/application delivery** (installed, updated, reinstalled or uninstalled
   — via Application Hub, a zip upload, WorkspaceConsole, clio or a CI/CD action): **this route takes
   precedence over step 3 whenever a delivery is mentioned, error or no error** — "we installed it and now
   the section behaves differently" and "install succeeded but prod still runs the old version" are
   delivery incidents, not feature-flag questions, and the spine's own outcome table owns them.
   **One exception to that example:** when the user quotes the log's `Modified` line as proof the schema
   was installed and asks what it means — "the log says Modified for our process, but prod runs the old
   version — are the logs lying?" — the question is what a log line means, and a consultation entry
   answers it completely. Route to `installation.md` and take its **§1a**, not the incident route. Route to
   `installation.md`, the installation **spine**, regardless of which mechanism turns out to be at fault.
   The spine establishes *which stage* of the installation failed and routes to the matching catalog from
   there — do not pick a mechanism-specific file yourself from the error text. **Do not hardcode the
   operation caption when looking for the record**: the captions differ between product versions,
   `installation.md` §2.1 carries the current set and the rule for resolving it against `ConfOperation`,
   and a caption this environment spells differently returns zero rows *silently*.
   **A delivery question with nothing broken routes here too.** "How do we move only part of a package to
   production", "can the Custom package be transferred", "why is this package read-only", "does binding a
   system setting protect its value" — nobody reported a failure, so there is no record to fetch and no
   stage to establish, but the answer is still the delivery domain's. Route to `installation.md` and take
   its **§1a**, which sends the question to the consultation half of
   `installation-catalog-reference.md` and defines what that answer may claim. Do **not** open a record
   first: a hunt for an incident that was never reported wastes a round-trip and reads to the user as a
   failure to understand the question.
6. Match the signals to a domain row below and open that file. When several could match, prefer the domain
   whose signature matches the **Operation**/**Status**, or the pasted error text, most specifically.

## Domains

| Domain | Route file | Typical signals | Status |
|---|---|---|---|
| **Compilation** | `compilation.md` | Operation = `Compilation`; Status = `Error`/`Warning`; linked `CompilationHistory` rows (a failing one has `Result = false` with `CS####` codes in `ErrorsWarnings`) — **or** a pasted compiler/server/browser error signature matching the file's case catalog (e.g. a .NET SDK error, a locked dll, a browser-console message). **A `Compilation` whose `Parent` is a delivery is not this row** — it is the installation spine's compilation stage, and the spine hands the signature back to this domain's catalog after its own gate | ✅ **Covered** |
| **Installation (delivery)** | `installation.md` — the **spine**, and the only entry point: it establishes the stage and routes on to its own catalogs (and, for a delivery question with no incident, takes §1a straight to the consultation half of `installation-catalog-reference.md`) | `Operation` is one of the delivery operations (**the captions differ between versions — the spine's §2.1 holds the set and resolves it against `ConfOperation`**); an `install_<yyyyMMdd_HHmmss>.txt` attachment; a `Compilation` record whose `Parent` is a delivery operation; **or** any delivery symptom — "the package installed with errors", "the app import failed", "install succeeded but prod still runs the old version", a CI/CD delivery action that failed. This covers data bindings, localization, dependencies, install order, schema conflicts, locking, environment drift **and a build that failed during the delivery** — do not route those to a file of their own from here. The compilation stage is the one the spine diagnoses with the **compilation domain's** material, after the gate in its §5.2 establishes whether the delivery broke the build or found it already broken. **Also covers delivery questions with no incident at all** — how to move only part of a package, package identity and install order, publisher/maintainer and read-only packages, transferring roles or email templates, the cloud package-size limit, what `Modified` means in an installer log — via the spine's §1a | ✅ **Covered (spine; its catalogs land one sub-domain at a time — see the spine's own table)** |
| Infrastructure & environment | — | DB timeout, locks, permissions/FS, disk, proxy/LB (`413`), web farm, cloud preparation | ✅ **Covered inside the installation domain, when it happened during a delivery** — route to the spine; its `installation-catalog-infrastructure.md` and `installation-catalog-infrastructure-files.md` hold `IE1`–`IE27`, reachable from any stage. An environment symptom with **no delivery** behind it is still uncovered |
| App Hub lifecycle | `app-hub-lifecycle.md` | install/update/delete/restore, `SysInstalledApp` integrity | ⛔ Not yet covered |
| Feature flags & system settings | `feature-flags-and-settings.md` | "no option in the UI," a section opening in the wrong mode, a direct "is X enabled" question, **or a runtime/service exception thrown by an App Hub/UI action (install, export, deploy) whose real cause is a disabled feature or setting, not a broken build** (e.g. a `FileNotFoundException` right after picking a file to install) — usually **no** `ConfActivityLog` record and no compiler code (`CS####`) attached → resolves to a feature (`AppFeature`/`Feature`) or system-setting (`SysSettings`/`SysSettingsValue`) state | ✅ **Covered (scoped — see the file's Boundaries)** |
| Command-line delivery (WorkspaceConsole, clio) | — | a delivery driven from a command line rather than the UI | ✅ **Covered inside the installation domain** — route to the spine as any other delivery; its mechanism files `installation-workspaceconsole-reference.md` and `installation-clio-reference.md` hold what each channel adds |
| Best practices | `best-practices.md` | consultation / prevention questions — **except delivery ones**, which the installation spine's §1a owns | ⛔ Not yet covered |

## If the incident is not covered

Only **compilation**, **feature flags & system settings** and **installation** are populated so far —
and two of those are scoped: feature flags & system settings has its own Boundaries section (not a
blanket cover for everything Application-Hub related), and installation ships as a **spine plus catalogs
that land one sub-domain at a time**, so a delivery can classify to a stage whose catalog does not exist
yet. **That is not a reason to stop:** the spine's §5.1 defines the order in which its catalogs are
searched, skips the ones that are absent, and — once all of them have been tried without a match — hands
the incident to the generic signature table in `installation-catalog-reference.md` and reports from the
spine, saying plainly that the answer is a class-level one. If the signals point elsewhere entirely:
- say plainly that the domain is **not yet covered** — this includes data bindings, dependencies, schema
  conflict & drift and localization **outside** a delivery: inside one they are the installation spine's
  business and have no row of their own here, but a standalone occurrence is a future domain,
- return the evidence you already gathered (record Id, operation, status),
- do **not** improvise a diagnosis outside a covered domain,
- and when the request is about something set up **outside Creatio's configuration** (a desktop add-in,
  a browser extension, a mobile app) or asks for a procedure no file here names, follow the not-covered
  answer with `rca-academy-lookup` once the log has been read — it says what the documentation says, tagged
  as documentation; a procedure written from general knowledge is the improvisation this list forbids.
