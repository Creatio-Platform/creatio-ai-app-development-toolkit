# Domain: Compilation — generic fix reference & advisory topics

Open this file from `compilation.md` in three situations:
1. **Verify step 7, generic fallback** — you have a confirmed `IsWarning: false` error (or warning) that
   didn't match any of the 34 signature-based cases in `compilation-catalog-cases.md`. Use §1 below for a
   generic `CS####` → likely-cause → recommendation lookup.
2. **Pure advisory/consultation question, no error at all** (e.g. "why does compile freeze the system for
   everyone", "can we schedule compile to run at night", "what's the difference between Compile and
   Compile all", "why does full source generation take hours") — go straight to §2 below, skipping
   `compilation.md`'s whole Verify loop. There is no error to classify or partition for these; the
   "diagnosis" is an explanation of expected platform mechanics, not a root-cause investigation.
3. **Any follow-up turn** (the user's second or later message in a conversation) — §3 below carries the
   cross-turn currency rule: re-check whether a newer compilation ran since the one you analyzed, and
   notify the user if it did. This applies on top of whichever of the two paths above you're on.

This file is deliberately kept small (unlike `compilation-catalog-cases.md`) so it reads in full reliably
even on a single pass.

## 1. Generic compiler-error / warning signatures (fallback when no specific case matches)

### 1a. Generic compiler-error signatures

| Error | Likely cause | Recommendation |
|---|---|---|
| `CS1002`, `CS1513`, `CS1519`, `CS1022` | Syntax error (missing `;`, brace, stray token) in the edited source | Fix the syntax in the named schema at the reported line; if the edit was accidental, revert it. |
| `CS0246` (type/namespace not found) | Missing `using`, or the package/assembly that defines the type isn't referenced/installed | Add the `using`; ensure the defining package/dependency is installed and referenced. See also **C1** (stale generated code) or **C8** (genuinely missing) in `compilation-catalog-cases.md`, depending on which fits. |
| `CS0234` (type not in namespace) | Missing assembly reference or wrong namespace path | Add the reference / correct the namespace. See also **C1**/**C3**. |
| `CS0103` (name not in current context) | Renamed/removed member, or stale generated code referencing an old name | Fix the reference; if it points at generated metadata, regenerate/republish the schema. |
| `CS1061` (member not found on type) | A referenced member was removed/renamed on another schema | Restore/rename the member on the owning schema, or update the caller. |
| `CS0101` (the namespace already contains a definition for a type) | Two declarations of a class with the same full name. A class need not be named after its schema, so the other one can sit in a schema with a different name | Built inside a delivery → **C47**; the other declaration is a platform type → **C10**. Otherwise rename one of the two classes. |
| `CS0111`/`CS0102` (duplicate member) | Same member defined twice inside one type (often after a merge or copy) | Remove the duplicate definition. |
| `CS8370` and similar "feature not available" | C# language-version mismatch | See **C11**. |
| `_MetaInfo.json` / "invalid SCS" / stale generated code | Stale/corrupted generated metadata, not a real source bug | See **C1**/**C2**/**C5**. |

**Error resolution:** name the offending source-code schema + its `CS####` error explicitly, recommend
the concrete fix (correct the source, add the missing reference, restore the member, or revert the
change that introduced it), and note that dependent errors are downstream consequences that clear once
the root is fixed.

### 1b. Warnings — common signatures (only if the user opted in per the gate)

| Warning | Meaning | Recommendation |
|---|---|---|
| `CS0114` / `CS0108` (member hides inherited member) | Often **generated** code on replacing entity schemas hiding a base member without `new`/`override` | Usually benign platform noise (no runtime effect); if you want them gone, add `new`/`override` in schema generation. Flag as low-priority. |
| `CS0219` (variable assigned but never used) | Dead local variable | Remove the unused variable. |
| `CS0618` / `CS0612` (use of `[Obsolete]` API) | Calling a deprecated member, often from a partner solution | Migrate to the recommended replacement; if the code is a partner's, report it to the vendor to modernize the API usage. |
| `CS1030` (`#warning` directive) | A deliberate `#warning` pragma left in source | Remove the `#warning` line if no longer needed. |
| `MSB3106` (assembly-reference-path warning) | Known MSBuild path-resolution quirk | Fixed in platform **8.3.3**; safe to ignore below that version. |
| `Terrasoft.ML.Interfaces.dll is either a path ... or a full assembly name ...` | MSBuild path-interpretation warning | Safe to ignore — no functional effect. |

**Warning resolution:** group warnings by code, give the meaning + fix per group, and **distinguish
actionable warnings from benign generated-code/MSBuild noise**. Warnings are non-blocking but are real
issues (except the two known-benign platform quirks above) — the build succeeded either way, so never let
a warning-heavy log read as "the system is broken"; recommend addressing the actionable ones. *(This
table is case **C34**.)*

## 2. Advisory & consultation topics (not incidents — expected-behavior questions)

These aren't failures to root-cause; they're recurring questions where the right "diagnosis" is an
explanation of expected mechanics, sometimes backed by a read. Still close with `rca-diagnosis-report`'s
Summary/Recommendation shape, applied lightly (skip Evidence/Consequences if there's no error to point at).

**C35 — Compilation load & app restart during work hours**
- *Symptom:* users feel "the CRM is frozen" during/after a compile; sessions drop when it finishes.
- *Explain:* compilation is resource-heavy and **always** ends in an application restart (sessions
  reconnect) — this is expected mechanics, not a defect. This happens on **every** compile regardless of
  server load, time of day, or how busy the environment is — it is not an "operational load" symptom that
  scales with how often people compile; one single compile is enough to restart the app and drop sessions.
- *Recommend:* run compilations (especially "Rebuild") only in a maintenance window; never mass-compile
  several sites on one server at once; warn users beforehand. Corroborate with Compilation-history
  duration/initiator if the user wants specifics on a past run.

**C36 — Full source generation / script-task publish "hangs"**
- *Symptom:* "Generate source code for all" has been running for hours; saving a process with a script
  task takes 10–15 minutes.
- *Explain:* both are expected on large configurations — full generation scales with schema count, and a
  script task means publishing that process triggers a real compilation.
- *Recommend:* check progress via logs / Compilation history instead of restarting; plan full generations
  off-hours; minimize script tasks where a no-code element would do.

**C37 — `VwCompilationErrors` indicator causes heavy DB load**
- *Symptom:* a DBA reports a long-running `SELECT COUNT(*) FROM VwCompilationErrors` hammering the
  database — traced to the compilation-warning indicator in the top panel.
- *Explain:* a known platform-side issue on loaded servers / large stored-error sets. **Do not run this
  `COUNT` query yourself** — awareness of it is advisory, not something to reproduce.
- *Recommend:* a successful full compile clears the stored error state (mitigates the query cost);
  restricting the indicator via feature/rights is a possible mitigation if available. Frame as a known
  platform issue, not something on-site configuration can fully prevent.

**C38 — Consultation: Compile vs. Compile all, publish, and where to see history**
- *Explain:* "Compile" builds changed schemas only; "Compile all" rebuilds the entire configuration — use
  "Compile all" after installs, updates, deletions, or when errors look stale/inconsistent. Changing an
  object requires saving/publishing it before the metadata is picked up by a compile.
- *Recommend:* check the Compilation history object (`ConfActivityLog` filtered to `Operation =
  Compilation`) before restarting anything — the full run history (status, duration, initiator) is there.

**"My connection dropped during a compilation — did it crash?"** is not a compilation topic of its own:
`installation-catalog-reference.md` **IR7** owns it for installation, compilation and code generation
alike, since all three run on the server. Answer from that entry: no, it does not crash — and nothing to
read or check.

## 3. Cross-turn currency (conversation hygiene, not an error signature)

**C39 — A concurrent compilation by someone else makes your previous answer stale**
- *Situation:* the user asks about compilation state and gets an answer. Then — in the **same
  conversation** — they ask for details or a follow-up. Meanwhile another user compiled, or **installed an
  application, which runs a compilation of its own**. The person talking to you has no way of knowing this
  happened, and neither does your context: it still holds the record from the previous turn.
- *Why it's a trap:* the environment is **shared and changes between your turns**, but nothing in the
  conversation signals it. The record's `Id` stays valid forever; "this is the latest compilation" is a
  **perishable** fact that expires the moment your turn ends. Reusing rows from context feels efficient and
  is exactly how a superseded run gets reported as the current state. An **application installation** is
  the hardest source to guess: the compilation is not started by a person clicking Compile, and it doesn't
  look like a compilation from the UI the user is watching.
- *Verify:* from the user's second message onward, **as your first action and before deciding what the
  follow-up is asking for**, re-run `rca-cal-read`'s **currency re-check**. A request to explain the
  finding, break down a warning, or give a fix path is **not** an exemption — the recommendation you attach
  to it ("change this, then recompile and verify") is about the live environment, and a run that already
  happened can make it wrong. The query: latest
  `Operation = Compilation`, `orderBy CreatedOn desc`, narrow columns (`Id`, `Number`, `Status`,
  `CreatedOn`, `CreatedBy`, `Parent`), **no `Description`, and not filtered to `Status = Error`** — and
  compare `Number`/`CreatedOn` against the record you analyzed earlier. If it differs, read the new row's
  `CreatedBy`/`StartedBy` and follow its `Parent`: a parent whose `Operation` is `Install application`
  means an app installation triggered the compile.
- *Recommendation:* **notify the user first, before the answer they asked for** — how many newer
  compilations ran, when (at least the latest timestamp), each status, and who or what triggered them
  (naming the app-installation case explicitly when that's what it was). Treat this as information that may
  change what they want to investigate: surface it, don't absorb it. Then answer their actual question,
  stating which run the answer describes — a follow-up about the **incident already under discussion**
  stays on that record (offer to look at the newer run), while a follow-up about **current state** moves to
  the newer one. Never describe state in the present tense off a previous turn's read: say "as of my check
  at `<time>`", not "currently".

## Boundaries (this file's coverage)

**Covered:** generic `CS####` fallback (§1a), common warning signatures (§1b, case C34), the
advisory/consultation topics (§2, cases C35–C38) — the "performance/scheduling & consultation" and
"warnings" categories — plus **C39** (§3), a cross-turn currency rule.

**Not here:** the error-signature cases matched by specific pattern — see
`compilation-catalog-cases.md`.

**Not covered:** assembly packages/FSM development specifics, compilation on web farms (node sync, per-node
static content), .NET Framework vs. Core compile differences, clio compile commands, compilation
API/automation (CI/CD), a dedicated diagnostics guide ("how to read Build.log").
