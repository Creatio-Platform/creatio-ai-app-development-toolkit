# Domain: Feature flags & system settings

How to analyze an incident where the trigger is a **feature** being on/off or a **system setting**
holding a particular value — a missing or unexpected UI option, a section opening in the wrong mode, a
button that isn't there, or a direct "is X enabled" question. Unlike compilation, these incidents almost
never produce a compiler/SQL error or a `ConfActivityLog` record — the evidence is the *current state* of
the feature/setting itself, always a direct platform read.

Every case in the catalog below is fully diagnosable from a direct platform read — commit to the
diagnosis once you've run it. `compilation.md`'s catalogs tag cases by evidence tier (A/B/C) because their
cases split meaningfully across all three; that apparatus isn't reused here since it wouldn't
differentiate anything — every case but one is equally fully-confirmable, and the one exception
(`FS6`, see §4) is a single case with a partially-unverifiable half, better said in plain prose than
tagged with a letter.

Pattern: **signature → classify (feature? setting? both?) → discover candidates (when no code is named)
→ verify (read-only) → case catalog / fix → report.**

---

## 1. Signature — does this domain apply?

Open this file when the symptom is either:
- a UI option/section/button missing, greyed out, behaving unexpectedly, or opening in an unexpected
  mode/UI generation — **with no compiler/SQL error and usually no `ConfActivityLog` record**; or
- a **runtime/service exception surfaced by an App Hub/UI action** (install, export, deploy) that is
  **not actually a compiler diagnostic** — several real cases here (e.g. `FS2`, `FS4`) present as an
  exception/stack-trace-shaped message even though the root cause is a feature/setting gate, not a broken
  build. **Don't rule this domain out just because the pasted text looks like an error** — the
  disambiguator is whether it names a compiler code (`CS####`) or is tied to an actual `Compilation`
  operation (→ `compilation.md`), versus an App Hub/UI action with no compiler code attached (→ this
  file).

Also open this file when the user directly asks whether a named feature or system setting is enabled, or
what value it currently holds.

If the symptom instead comes with a **compiler diagnostic** (`CS####` or similar) or a
`ConfActivityLog`/`CompilationHistory` record tied to an actual `Compilation` operation, that is
`compilation.md`, not this file — a feature/setting can still be a *contributing* factor there, but route
by the error signature first.

## 2. Classify — feature, setting, or both?

Before verifying, decide which mechanism(s) are in play — several real cases involve **both at once**,
and they are not interchangeable:

- **Feature** — an on/off toggle, managed at `{site}/0/flags`, resolved per admin unit (org/role/user).
- **System setting** — a named value (text/boolean/number/date/lookup), managed via System Designer →
  System settings, also resolvable per admin unit.
- Do not guess which one applies from the name alone — e.g. `UseNewApplicationInstall` is a **feature**,
  while the very similarly-named `UseNewApplicationManagement` is a **system setting** (confirmed live,
  see §3) — check both mechanisms explicitly per §3 rather than assuming from naming convention.

## 3. Verify — gather evidence (read-only)

Use `rca-env-readonly-query`'s "Feature & system-setting state checks" section. Two entry points:

- the **user** named a code (or pasted one) → go straight to 3.2;
- the user described a **symptom** → 3.1 is **mandatory**, then 3.2 on the shortlist.

**A catalog match is not a substitute for the probe.** §4's entries name codes, so a symptom that
*resembles* a catalog case is tempting to route straight to 3.2 — do not. Resemblance is not identity:
the catalog covers a handful of causes out of everything a feature or setting can gate, so reading its
codes answers a question you were not asked while leaving the environment unsearched. Only a code the
**user** supplies skips 3.1. When the input is a symptom, probe first; the catalog then does what it is
for — it confirms a candidate the probe found, or adds a code the probe missed. It never replaces it.

### 3.1 Discovery — deriving candidates when no code is named

Most incidents arrive as a symptom, not a code. Feature and setting descriptions on the environment are
searchable, so derive candidates from the user's own words instead of guessing a code.

**Step 1 — pick the area tag(s).** Descriptions written for search begin with a `#tag` naming the
functional area. Map the user's topic onto at most two:

| Tag | Area |
|---|---|
| `#application-hub` | Application Hub as a whole: UI, install, download, update of apps, Marketplace |
| `#configuration` | Configuration section, packages and dependencies, schema and page designers |
| `#rights` | access rights of every kind: object, record-level, operations |
| `#licensing` | licenses, License Manager |
| `#logs` | Change log, Configuration Activity Log |
| `#timeline` | Feed, Timeline pages |
| `#panels` | side panels (left/right), navigation panel, App Toolbar |
| `#alm` | ALM portal, environments, deploy — usually alongside `#application-hub` |
| `#performance` | caches, parallelism, static content |

Tags appear only in descriptions that were written for search, and coverage differs from environment to
environment — plenty carry none at all. Treat a tag hit as a bonus on top of the keyword probe, never as
the only probe, and never assume a tag is absent because the area is irrelevant.

**Step 2 — pick 2–4 keywords.** The UI object ("button", "badge", "panel", "section"), the action
("export", "install", "deploy", "open"), the area name. Use the user's term *and* the likely internal
term when they differ — the UI says "Export" where the code says `Download`. Skip generic words ("error",
"page", "doesn't work"): they match everything or nothing.

**Probe in English, whatever language the user writes in.** Descriptions and codes on the environment are
English, and `contains` is a literal substring match — a probe built from Russian, Ukrainian or Polish
words returns nothing no matter how precisely it describes the symptom. Translate the symptom into the
**English UI vocabulary** first: «нет кнопки экспорта» → `export`, «журнал изменений» → `change log`,
«бічна панель» → `side panel`, «uprawnienia do obiektu» → `rights`. Map onto the term Creatio's English UI
actually uses, not a dictionary-literal translation. After a non-English prompt an empty probe is more
often a translation miss than a real absence — retry with a different English term before reporting that
nothing was found. Answer the user in their own language; only the probe terms are English.

**Step 3 — probe BOTH mechanisms, every time.** One read against `AppFeature` **and** one against
`SysSettings`, in the same pass. Combine the tag and all keywords into a single `any` filter per read so
each costs one round-trip, and select the state columns in the same read — then no follow-up call is
needed for the shortlist. Exact read shapes are in `rca-env-readonly-query`.

Probing features and stopping there is a recurring, invisible failure: the two live in different objects
with different fill rates, nothing in a feature probe hints that a setting exists, and a symptom about
installs, URLs, limits, timeouts, logos, or anything with a *value* rather than an on/off is more likely
to be a setting than a flag. **Skipping the settings read is only allowed when the user named a feature
code outright** — never because the feature probe already returned something plausible.

**Resolving codes you already know is not the settings probe.** Reading the values of codes you
recalled from §4 satisfies the letter of "I checked the settings" while doing none of the work: it can
only return codes you had already thought of, so a setting nobody in this file has ever named stays
invisible — and the trace still shows a settings call, so nothing looks skipped. **The probe is a
`SysSettings` read filtered by the symptom’s keywords.** The `SysSettingsValue` read comes *after*, to read the values of what the probe found.

**Read the shortlist's `Description`, not only its value.** A setting's description often states the
failure outright — naming what stops working when the value is blank, or wrong, or below some threshold —
and that sentence is what turns a value you read into a cause you can defend. The probe already selects the
column; use it.

**Step 4 — pick candidates by meaning, not by match.** Keep the codes whose description actually
describes the reported symptom (the "When off …" half). A code that merely contains the keyword
somewhere is not a candidate.

**Step 5 — account for every match you could not judge.** Step 4 filters *for* candidates; it is not a
licence to drop the rest silently. Two rules:

- **One standard for all matches.** If you accept a code as a candidate on the strength of its **name**
  because its description is empty, then name-matching is the standard you are using in this
  investigation — apply it to every other code the probe returned on the same footing. Crediting one
  empty-description match while quietly dropping another is an arbitrary split, not a judgement.
- **A negative conclusion names its loose ends.** If the answer is going to be "this isn't a
  feature/setting problem" or "the relevant flag is already on", list every probe row you could not judge
  on meaning, with its `State` and `StateForCurrentUser`, and say plainly: "matched on the code, no
  description on this environment, state is X — I can't rule it out."

**Do not reason from the direction of the flag.** On/off tells you nothing about whether a flag causes
the symptom: that depends entirely on the logic built around it. An enabled flag can switch on a new,
broken, or unfinished path exactly as a disabled one can withhold a working feature — and either can be
the cause. State is a fact to report, never grounds to dismiss a match.

**An empty probe is not proof.** Descriptions are filled unevenly: on any environment most features have
none at all, and a feature with an empty description can still be the cause. Say plainly "the search
found nothing, and descriptions on this environment are incomplete, so this does not rule a feature
out" — never "no feature relates to this".

### 3.2 Direct check — reading the state of a known code

1. **Feature:** read `AppFeature` filtered by `Code`, columns `Name`, `Code`, `State`,
   `StateForCurrentUser`, `Source`.
   - Report `State` (org-level) and `StateForCurrentUser` **separately** when they differ — that
     disagreement (a role/user override masking the org-level state) is itself a finding, not something
     to average away.
   - **`StateForCurrentUser` is YOUR state, not the reporting user's.** "Current user" means the account
     this integration is connected as — not the person in the incident. Presenting it as theirs is a
     factual error, and a tempting one: it reads like the answer to "why does this user see something
     different". It is not. Say whose state it is every time you quote it, and when the incident is about
     a specific person ("one user sees X, others don't", "the customer has no button"), state plainly
     that their effective state was **not** established unless they told you their account or roles —
     then ask for it, or give the admin the check to run.
   - **Then read the per-admin-unit overrides — this is not an optional deepening.** For a
     `DbFeatureProvider` feature, `AdminUnitFeatureState` is the table the Feature-toggling UI shows next
     to the flag, and **an admin-unit row takes priority over the feature's own state**. Two outcomes,
     both worth reporting:
     - **rows exist** → the flag resolves per role. Name each admin unit (resolve the reference to its
       **name**, never leave a GUID) and its `FeatureState`. Only now can you say who sees what — and only
       for roles you can actually enumerate.
     - **no rows** → there is no per-role exception, so `State` governs everyone. That is a *stronger*
       result than a hedge: it lets you say the org-level value is what every user gets, and it removes
       "maybe they have an override" from the list of open questions.
   - **An override that does not apply to YOU is still a live candidate.** The one trap left after the two
     rules above: you find a role with the flag turned off, notice your own effective state is unaffected,
     and write the feature off as "not the explanation". That is backwards. You are not the person with the
     problem. An override switching something off for a named role, on an incident where a user cannot do
     that exact thing, is the single most promising lead you can find — the fact that *your* account
     escapes it is what makes it invisible, not what makes it irrelevant. Report it as a candidate and ask
     one question: **is the affected user in that role?** Only their answer, or an admin's check, closes it.
   - `AppFeature` covers **every** provider, so one read answers any feature question. Values seen live:
     `DbFeatureProvider`, `Metadata`, `GlobalAppSettings`, `web.config` — **the set is not closed**, so
     report `Source` verbatim rather than mapping it to a place you assume. It decides where the fix is
     applied, and only `DbFeatureProvider` features are database-backed (togglable per admin unit, and the
     only ones whose per-role overrides can be read via `Feature` + `AdminUnitFeatureState`).
   - Empty result → **not** a reason to fall back to `Feature`; that object holds only the database-backed
     subset, so a code missing from `AppFeature` is missing from it too. Re-check the exact code spelling
     (prefixes matter — see `FS6`) and try a `contains` match before concluding the code doesn't exist on
     this environment at all.
2. **System setting:** two reads for all the codes at once — `SysSettings` for the definition,
   `SysSettingsValue` for the values (`rca-env-readonly-query`'s `references/feature-and-setting-reads.md`,
   "System settings", holds both reads and the column of each value type).
   - A code with **no `SysSettings` row** **doesn't exist** on this environment — a missing
     data-binding/package-install gap, a different fix (install it) from "it exists but holds the wrong
     value." Never report a not-found code as if it held an empty or default value.
   - **The site-wide value is the row of *All employees*, whatever its `IsDef`** — `IsDef` does not mark
     the default. A row for another user or role is an exception for them, the setting-side equivalent of a
     feature's per-role dig: report whose it is.
   - A definition with **no value row** is "defined, no value" — neither absent nor empty.
   - A `SecureText` value is never quoted: report only whether it is set.
3. **Match the signature against the case catalog (§4).** Several real cases need *both* a feature and a
   setting checked together (e.g. §4.1, §4.5) — verify every mechanism the matched entry names, not just
   the first one that confirms your hypothesis.
4. **Confirm, don't infer.** Every reported state must be backed by a read you actually ran. If a code
   comes back empty/not-found on both feature paths and the setting path, say so plainly rather than
   presenting a guessed cause.
### 3.3 Change history — mandatory once a state IS the cause

**This applies to both entry points above.** Whether the code came from the user, the catalog, or the §3.1
probe, the moment you are ready to name a feature/setting state as the root cause you owe one more read.
"It is off" is half an answer: it leaves open whether it shipped off and never worked here, or someone
turned it off last week and broke a working environment. Those are different incidents with different
recommendations and different people who need telling.

Check both sides:

- **the record's own stamps** — `ModifiedOn` / `ModifiedBy` on the `Feature` row, on the
  `AdminUnitFeatureState` override row, or on the `SysSettingsValue` row that actually applies;
- **the configuration log** — `rca-cal-read` for entries around that timestamp, which can name the
  operation and the person behind it.

**The log names the element.** `ConfActivityLog` carries an `Element` column holding the code that was
changed — verified live. So this is a targeted read, not a trawl: filter or scan on `Element` for the code
you just confirmed instead of paging recent operations and guessing which one is yours.

**Read the log record's `Description` — when it is filled, the before-value lives there.** The row's
stamps tell you *when* and *who*; a filled `Description` tells you *what changed*, often as an explicit
previous-value / current-value pair. That turns "the value is X" into "someone changed it from Y to X" —
the difference between describing a state and naming a regression, and it hands you the value to restore.
So whenever you correlate a log entry with a state you are diagnosing, open its `Description` and fold
what it says into the finding. **If it comes back empty, ignore it and move on** — the field is only
populated for some element types, so its emptiness carries no information and does not belong in the
report.

**One honesty limit that remains.** A `ModifiedOn` proves the **row** was touched, not that the **state**
changed — editing a description moves the same stamp too. So a fresh timestamp alone is not evidence that
someone toggled anything; a filled `Description` is what settles which of the two happened, and without
one the timestamp stays exactly that — a timestamp.

**Say what you found either way.** "Last modified <when> by <who>, and the log shows <operation>" and "no
change recorded — this looks like the shipped state" are both useful answers. Silence is not: leaving the
question unasked is what makes a report look complete while omitting the one fact that decides whether
this is a regression or a never-configured environment.

## 4. Case catalog

**FS1 — App Hub opens in Classic UI instead of Freedom UI**
- *Signature:* the Application Hub (or its package-import window) opens the legacy/classic-style page
  instead of the modern Freedom UI experience.
- *Verify:* read `AppFeature` for `Code = 'UseNewApplicationInstall'` (a **feature**); separately read the
  system setting `UseNewApplicationManagement` (`SysSettings` + `SysSettingsValue` — confirmed live to be a
  setting, not a feature, despite the similar name). Check whether the setting exists at all — no
  `SysSettings` row means it is missing entirely rather than just off, and that's a different fix.
- *Recommendation:* enable the `UseNewApplicationInstall` feature at `{site}/0/flags`, and turn on the
  `UseNewApplicationManagement` system setting. If the setting doesn't exist on the environment at all,
  the underlying data bindings from the `CrtUIv2` package need installing (`SysSettings_UseNewApplicationManagement`
  first, then `SysSettingsValue_UseNewApplicationManagement`) — a manual admin step. Recommend verifying
  in an incognito session afterward (cached UI state can mask the fix).

**FS2 — Zip install fails instantly with "Could not find file 'Package.zip'"**
- *Signature:* `System.IO.FileNotFoundException: Could not find file 'Package.zip'` the moment a zip
  install is attempted from the App Hub, even though the file was just selected. **Despite the .NET
  exception text, this is not a compiler/build error** — don't route it to the compilation domain or
  spend a round-trip searching `ConfActivityLog` for a matching Compilation/Install failure record before
  checking the feature below; no compiler code is involved and this symptom typically never reaches the
  activity log at all.
- *Verify:* read `AppFeature` for `Code = 'UseConfirmInstallAppFromZip'`.
- *Recommendation:* if off, enabling it changes the upload sequencing (the UI no longer calls package
  validation before the file finishes uploading) — enable the feature at `{site}/0/flags`, clear the
  browser cache, and retry.

**FS3 — Export/Download option missing from the App Hub**
- *Signature:* no Export/Download action is visible anywhere in the App Hub for a given app.
- *Verify:* read `AppFeature` for `Code = 'CanDownloadApp'`.
- *Recommendation:* enable the feature — the export option appears in the App Hub afterward.

**FS4 — App Hub redirects to `alm.creatio.com` / `studio.creatio.com`**
- *Signature:* opening the Application Hub redirects to an external ALM/Studio portal address the user
  can't access (page shows as expired/unavailable); common after a demo site was created from a trial.
- *Verify:* read the system setting `AlmPortalEnvironmentManagementUrl` (`SysSettings` + `SysSettingsValue`);
  report the *All employees* value.
- *Recommendation:* if the environment is not managed via an ALM portal, clear the value. If it points to
  a stale trial portal (`studio.creatio.com`) after a trial→demo migration, replace it with the correct
  portal (`alm.creatio.com`) or clear it.

**FS5 — "Deploy application" option missing from the App Hub**
- *Signature:* the Deploy App action is absent on a dev/pre environment that should be able to push apps
  to another connected environment.
- *Verify:* **both** mechanisms — the system setting `AlmPortalEnvironmentManagementUrl` (must be
  non-empty and match the portal the working environment uses) **and** `AppFeature` for
  `Code = 'CanDeployApp'`.
- *Recommendation:* fill `AlmPortalEnvironmentManagementUrl` with the correct ALM portal URL (both
  environments must point to the same portal) and ensure `CanDeployApp` is enabled.

**FS6 — Update badge confusion (appears unexpectedly, or never appears)**
- *Signature:* an "Update" badge shows up on apps the user didn't expect right after a platform update,
  or never shows up at all even when a newer Marketplace version genuinely exists.
- *Verify:* read `AppFeature` for the update-check feature — confirmed live under the code
  `AppsFeatures.CheckApplicationUpdates` on the reference environment (the bare name
  `CheckApplicationUpdates` informally used in support notes did not resolve directly; search for it if a
  literal code lookup comes back empty, environments may differ). The feature state itself is directly
  confirmable this way. The **badge also depends on the scheduled process `CheckMarketplaceAppsNeedUpdateProcess`
  actually running**, which is only partially checkable read-only: reading the process schema (by name)
  confirms it exists and isn't locked/changed, but exposes no confirmed "is it actively scheduled/running
  right now" flag (a listener-count style column can read `0` even on a healthy environment, so don't
  treat that as evidence of inactivity) — **say plainly that this half of the diagnosis is signature
  recognition, not a verified read**, unlike the feature check above it.
- *Recommendation:* explain the mechanism plainly — Marketplace apps version independently of the
  platform, so a build ships with app versions frozen at release time and later Marketplace releases
  light the badge afterward; updating is optional, installed versions keep working. If the badge should
  be showing and isn't, enable `AppsFeatures.CheckApplicationUpdates` and confirm with an admin that the
  scheduled process is active/running (this platform's read-only tools cannot fully confirm that part).

## 5. Report

Follow `rca-diagnosis-report`'s existing format and its "never expose internal reasoning scaffolding"
rule as written — it already applies to this domain without changes (no `FS#` id, no file path or line
number in the user-facing output; translate the finding into the underlying technical fact, e.g. "a
role-level override is turning this off for you specifically even though it's enabled for the
organization" rather than "StateForCurrentUser disagrees with State").

- **Root cause:** name the feature and/or setting, its current effective state, and — when relevant —
  whether that state differs between the org level and the specific user/role affected.
- **Evidence:** the exact code(s) read and the values returned (`State`/`StateForCurrentUser`, or the
  setting's resolved value / whether it exists at all).
- **When and by whom it changed — required whenever you report a confirmed cause** (§3.3). Either name the
  timestamp and the actor, or state that no change is recorded and the value looks like the shipped one.
  A confirmed root cause with no word on its history is an incomplete report: the reader cannot tell
  whether something regressed or was never set up.
- **Recommendation:** the concrete manual toggle (feature at `{site}/0/flags`, setting via System
  Designer → System settings, or — if entirely missing — the data-binding install step). The agent never performs the toggle itself, per the read-only rules (`rca-safety-and-access`; on the AI Platform, the system prompt).
- **Confidence & gaps:** for FS6-style cases, say plainly which half of the diagnosis is a confirmed read
  and which half is recognized-but-unverifiable from this platform.
- **A discovered candidate is a hypothesis, not a diagnosis.** Keep the two apart in the wording:
  - matched a catalog case (§4) → report it as the cause, with the recommendation that case carries;
  - found only by the §3.1 probe → report it as *possibly related*, give its confirmed current state, and
    explain **why** you think it relates (quote the symptom half of its description).
  The UI warns that changing feature state can break the application — an unfounded "just enable this"
  costs more than an honest "this looks related, here is what it does".

- **A recommendation you may give is not a diagnosis you may claim.** When a probe candidate's
  "When off …" text genuinely matches the reported symptom, you *may* recommend flipping it as the fix —
  that much is licensed. **The confidence label is a separate decision and does not come along with it.**
  What you read is the flag's state; what the user reported is a sentence. Matching the two is still an
  inference until you know what actually happens on their screen.

  So: recommend the toggle, and still label the finding *possibly related* — unless you have **also**
  confirmed the symptom itself (the user described the concrete behaviour, or you read a record showing
  it). "Confirmed" is reserved for a cause you verified, not for a state you read next to a story you
  were told. A one-line symptom ("I can't do X") is not a verified symptom: ask what they actually see —
  an error, a missing option, a failure partway — before committing.
- **Where to toggle depends on `Source`.** `DbFeatureProvider` → `{site}/0/flags`. Any other value
  (`Metadata`, `GlobalAppSettings`, `web.config`, or one not listed here) means the state comes from
  outside the database: quote the `Source` as returned and have an admin confirm the place instead of
  pointing at the flags UI.

## 6. Boundaries (current scope)

**Covered:** the cases below — Application Hub incidents where the
confirmed root cause is a feature or system-setting state readable through `AppFeature`/`Feature`+
`AdminUnitFeatureState` or `SysSettings`/`SysSettingsValue` (§4, FS1–FS6). The verify mechanism itself
(§3) is domain-general — it applies to any feature/setting question, not only Application Hub symptoms.

**How to use the two lists below — read this first, it is the part that gets misused.** They record cases
whose root cause was **established, elsewhere, to be something other than a feature/setting**. They are
**not a keyword filter on incoming symptoms**, and matching one by wording is never grounds to skip §3.
Run the probe first. If the relevant state comes back clean, *then* an exclusion applies and you route out
**with the evidence you gathered**; if the state is not clean, the exclusion simply did not describe this
incident. Deciding scope from the phrasing of the complaint is exactly the inference this domain exists to
prevent. Two complaints can be worded almost identically and have causes on opposite sides of this
boundary — the wording cannot separate them, only the state can.

Same for §4: **a symptom the catalog does not name is not out of scope.** §4 lists cases with a canonical
fix; §3.1 exists precisely for symptoms it does not name. Absence from the catalog limits how confidently
you can name a *known case* — never whether you probe.

**Explicitly out of scope for this file** (a feature or setting is involved but is
**not** the root cause — do not force these into this domain if they come up):
- Parallel install/compile blocking each other — no toggle exists for this; it's a platform limitation.
- `0 Unknown Error` / broken client-server connection during an install — a network/gateway symptom;
  `EnableReflectionCompilationNecessityDetection` is at most a secondary check, not the cause.
- "Unable to retrieve app files from the Marketplace" (AIS unreachable) — a connectivity problem;
  `AppsFeatures.UseAutoInstallDependencies` is a workaround, not the cause.
- A `413 Request Entity Too Large` from a front-end proxy — an infrastructure (nginx/LB) body-size limit;
  the `ApplicationInstallationMaxFileSize` system setting never even gets reached.
- A package install failing because a system setting it depends on is created only later, at data-install
  time — an install-sequencing defect, not a state-diagnosis question.
- A per-app "minimum platform version" value — stored differently from `SysSettings`/`Feature`, out of
  scope here.

**Not yet covered at all:** the rest of the Application Hub domain — Marketplace/installation mechanics,
ALM deploy permissions, application update/versioning consultation, apps & packages management, restore &
backup — a separate, larger domain not yet built. If an incident classifies there instead, say plainly
that it is not yet covered, per `NAVIGATION.md`.

**Two of those questions do have an owner, and it is not this file.** "Why is this package read-only /
greyed out" and "where did a package with a generated name come from" are the publisher-and-maintainer
rule, which `installation-catalog-reference.md` owns (its consultation half, reached through
`installation.md` §1a). Route there rather than probing a feature state: no toggle produces that
symptom, and the maintainer comparison that does is a two-value read. The same file owns the delivery
package-size limit — the 300 MB Application Hub refusal, which is a different thing from the
`413`-from-a-proxy exclusion above.
