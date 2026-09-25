# Building a page

Handed, with `./references/build-task-execution.md` and
`./references/classic-to-freedom-mapping.md`, to every page build and repair task. The five rules in
`build-task-execution.md` override every convenience in this file.

## Everything else about building a page

This file is the per-page build procedure, unchanged from when it was one monolithic step of
`SKILL.md`. Read the parts that apply to your task's rows — the preflight in
`build-task-execution.md` applies to every task, the `creatio-ui-guidelines` done-gate applies to
every task that touches a page's layout, and the clio-safety rules apply to every write.

1. Re-read the approved `plan.md`, your page's `--spec` slice and your own task file to recover
   state. You do NOT record the approval — the orchestrator did that in `decisions.md` before
   slicing, and a build that finds no approval entry is a stop for the orchestrator, not something
   you work around.
2. Section sequencing at whole-package scope is the orchestrator's (step 7.6,
   `./references/orchestrate-build.md`): one section is sliced, built and validated before the next
   one starts. Your task belongs to exactly one section — never reach into another.
3. **The page TREE is sliced across tasks, not walked by you.** Each page — the record page, each
   typed page, the mini page, each `Rebuild (child)` — is its own artifact with its own task (or its
   own chain of them), and the queue already orders them leaf-first, so a child page's form exists
   by the time the parent's related list is built. Your `writesTo:` names the one artifact you may
   write. Build the page YOUR task names and no other, even when its spec mentions a child: reaching
   into another page's task is how two sub-agents write the same schema. Your page's own spec is the
   one under `### Child page mappings` when your page key is a child.
4. Subtask order INSIDE your task, in the order the platform requires: template creation or
   existing-page selection → entity/data-source adjustments → layout → business rules →
   details/related lists/standard features → handlers/converters/validators → backend/service →
   localization/bindings. (App/package/section scaffolding and the switch-over are not yours: the
   scaffolding is its own task, ahead of every page, and a switch-over happens only when the user
   approved one.) **Re-check for an existing Freedom artifact before every create** — a second run
   over the same folder must not duplicate a page that is already there.
   - **Build every native feature UP FRONT as its native component — never build a generic
     Expanded-list/DataGrid first and "switch" it later.** A Visa = Approvals *because it is an
     Approval* — and Approvals is **TWO** components (`get-component-info` returns both): the
     approval **module** as a container **above the profile island** + the approval **list**
     (`crt.ApprovalList`, brings its own approve/reject actions). Add BOTH — list-only is
     incomplete. "The child has no edit page / it's view-only" does not reclassify a
     `standardFeatures` entry into a list. Confirm the components on-stand (`get-component-info`)
     before building. → the mapping reference's build recipes.
   - **Card widgets (`card-widget` decisions) are converted by the migrator, never hand-built.**
     Each `needsDecision` of `kind:"card-widget"` (also listed in `changeSet.cardWidgets[]`) carries
     `widgetKey`, `recordId`, and a target `region`. **Group the widgets by `recordId`** and make
     **ONE `ConvertCardWidgetsProcess` call per distinct `recordId`** — via the clio `run-process`
     MCP tool (the caller must hold the **`CanMigrateDashboard`** right), passing
     `SysWidgetDashboardId` = `recordId` and `WidgetKeys` = the group's keys as a **comma-separated
     string**, requesting the `["ConversionResult"]` output parameter. In the returned result,
     **place** the `freedomElementConfig` of every **`Success`** widget into its `region` (merge its
     view/viewModel/model diffs **and `localizableStrings`**; placement follows
     `creatio-ui-guidelines`, and you **build nothing by hand**). `region` is the plan-level
     **target zone** the widget occupied on the Classic page — a resolved Freedom container (a tab,
     or `SideAreaProfileContainer` = the side profile), or the top-area sentinel `Header / top` when
     its host did not resolve; choose the actual parent container from that zone per
     `creatio-ui-guidelines` — the returned config's own `layoutConfig`/`parentName` is a **stub**,
     not authoritative. A **`Failed`/`Skipped`** widget, a **whole-call failure** (`success:false` —
     e.g. access denied, bad record, no widgets), or a requested `widgetKey` **missing from the
     result** stays **`TODO`/`BLOCKED`** in `worklog.md` with the migrator's message — **never** a
     hand-built chart/list. Record each widget's evidence flag
     **`cardWidget:<recordId>:<widgetKey>`** (`true` placed / `false` blocked; keyed by BOTH
     coordinates so the same `widgetKey` under two records can't collide) in `built.json` so
     `--verify` gates it. If the migrator or `run-process` is not available on the stand, the whole
     `card-widget` set stays `TODO`/`BLOCKED`. **Full result-envelope contract + field breakdown →
     the mapping reference's Card widgets recipe** (`references/classic-to-freedom-mapping.md`) —
     the single canonical description.
   - Resolve any `detail-unresolved` (auto-named `SchemaNDetail`) by fetching the detail schema
     first. For every `detail-editpage` flag, confirm a Freedom form exists for the child entity or
     migrate it as a follow-on page.
   - **Nothing is silently skipped:** anything you cannot build is that row's `not-built — <cause>`
     in the `Outcome` column plus the specifics under `## Notes` — and, per the documentation
     standard, a `worklog.md` entry too. A page that migrated fields and rules but dropped its
     details, features or their edit pages is NOT done; recording the drop against its row is what
     carries it to the user, and leaving the cell blank is the same as claiming it.

## Porting a step-5.1 behaviour card

- **Port every condition the card states — a "stronger equivalent" is a DEVIATION you propose, never
  one you approve for yourself.** A card's conditions are conjunctive: dropping one because another
  "already covers it" is a behaviour change, however it reads in isolation. A substitution is
  equivalent only if it holds for **every** AC of the card, negative ones included — that is where a
  plausible one breaks. When the Freedom mechanism for a condition is uncertain, settle it
  (`get-guidance`, `get-request-info`, the component contract) or put the deviation to the user;
  never invent a workaround and self-certify it. Contract rule 7's "no simplifying" applies to
  logic, not just layout.

## What a builder owes the step-8 close report

**The Plan-vs-Done checklist (skeleton) — the human-readable control table.** The checklist is NOT
part of the `--plan` you present for approval (a control table there is premature). AFTER
implementing, generate it with `node engine/migrate.mjs <manifest> --checklist` (add `--out <file>`
to write it): a **`### ✅ Plan-vs-Done checklist`** the engine derives from the plan — one pre-seeded
`☐ pending` row per deliverable — each page **including the mini page**, each tab/region of the
form, each detail / standard feature (Approvals, Attachments, Activities, Communication options…),
each **handler** (one row each), each business-rule set (folded to a count), each card action (Run
process, Print) — and one row per ⚠ Confirm item. Copy it into your final report and `worklog.md`
and fill **Status** (`✅ Done` / `⚠ Partial` / `❌ Not done` / `N/A` — with reason) + **Evidence**
(schema saved · render checked · on-stand query) for EVERY row. **Never delete a row, and never
demote a deliverable into loose prose** — that is exactly how a built mini page and the whole
handlers section went missing from the control table (an un-migrated `init`/`onSaved` then hid in
prose beneath it). A row left `☐` or not-`Done` needs its reason. Do NOT summarise "all done" in
prose — and note the **`--verify` table above is the actual CLOSE report** (same grouped structure,
Status auto-filled from the built page + a hard ⛔ verdict); `--checklist` is the pre-build skeleton
of that same table. It also seeds **two Quality gates rows** ("a record was filed" and "an
independent judge found it convincing" are different facts, so each gets its own row off the SAME
`#quality-gates` id) for the **page-design** guideline — the `creatio-ui-guidelines` skill (how to
CREATE/lay out a Freedom page: components, colSpan/gaps, captions, islands, contrast). This is the
UI **page-creation** guideline specifically, NOT the clio build `get-guidance` contracts
(page-modification / field-contract / related-list …) you read to write the schema — that one is the
gate agents skip. Apply it WHILE designing the page, and if you didn't, run it as a review pass and
FIX the findings (style parity with the reference page) — fill BOTH rows, not just the one that
happens to be easier. Add any further evidence rows without removing generated ones.

**Every non-`mapped` Member-ledger member ALREADY has a generated row — find it, don't add it.** The
table covers the whole ledger, just under two different group headings, so do **not** append
duplicates: a **`method`** appears as a **`Handler — <name>`** row under *Form — Custom methods*; an
**`attribute`** (virtual, imperative lookup filter, dependency), a **`message`**, a **`mixin`**, a
**`referenced-module`** and the aggregated **`module-dep`** appear under
**`⚠ Other declared logic worklist`**, each tagged with its kind (`[attribute-lookup-filter] Owner`,
`[message] CalcTotal`, `[mixin] PrintUtils`). That checklist group is deliberately one kind BROADER
than the plan's `⚠ Other declared logic` table: `attribute-dependency` has no plan row (the handler
method it triggers carries it there) but keeps a checklist row, because the attribute is a member in
its own right and the method's row reports the method. **`⚠ Confirm worklist`** holds only the open
questions — the kinds with no card behind them. A member you closed with
`manifest.memberDispositions` keeps its row too — recording a disposition is not the same as
reporting it built. So the obligation is to FILL every one of those rows, never to re-list them: an
imperatively filtered lookup or a sandbox message left `☐ pending` is a visible unmet row, which is
exactly what stops it disappearing between the plan's ledger and the close report.

**A ported behaviour's Evidence lists every AC of its card, one line each.** For a `Handler` /
`⚠ Other declared logic` row that came from a step-5.1 card, the **Evidence** cell carries one line
per acceptance criterion — the AC and what you did that shows it holds:
`✅ Done — AC-1 new record → 1 lead (on-stand); AC-2 mapped fields read back; AC-3 edit-save → 0 leads (on-stand)`.
An AC with no line means the row is `⚠ Partial`, naming that AC. **Test each AC, don't argue it.**
An AC is already a test case; the ones saying a behaviour must NOT happen are the ones that break
silently, so go and try that case. "Wired, saves cleanly" verifies the schema, not the behaviour. A
page handler is client-side: it fires on a UI save in the browser, not on an OData insert. Where a
behaviour writes data, read the record back and check the mapped values.

**Gate-toggle safety (shared stand).** If a **system setting** gates the behaviour, name the exact
`SysSettingsValue` row you are testing — its culture/user/role — since a per-role override beats the
All-Users default. Hold that row's pre-toggle value in session, and log its identity and **resolved
effective state** (`gate <code>/<row> — on`) in `worklog.md` — never the literal value. **Only a
Boolean row is toggled:** any other type may hold a secret that no metadata flags as encrypted, and
overwriting it leaves the only copy in a context window that can be compacted — name the row and
leave it `⚠ Partial — unexercised`. **A row you CREATE restores by deletion:** if no override row
exists for the named culture/user/role and the AC needs one, creating it is its own logged step —
restore means deleting that row (there is no held value to write back), and the confirming re-read
checks the row is gone, not that a value matches. A `getIsFeatureEnabled` gate has no
`SysSettingsValue` row, and on a customized stand it is the *more* common gate — so it gets the same
four steps with its own tools, never a blanket refusal: capture the flag's current state, toggle it
and `refresh-feature-cache`, restore unconditionally, re-read to confirm. Whichever kind it is, if
you cannot toggle it at all, name it and leave the row `⚠ Partial — unexercised`. Every AC behind
the same row shares **one** toggle window — toggle once, run them all, restore once — kept as short
as those tests allow and never held open across unrelated work. **Announce the window before opening
it:** state it in the run output — which gate, which row — because a flipped gate changes behaviour
for every concurrent user of the stand while it is open. Within it,
`toggle → test → restore → re-read`, and **restore runs unconditionally**: a test that fails, errors
or times out does not exempt you from restoring and re-reading — treat it as try/finally, with the
restore in the `finally`. **Confirm the restore, don't assume it:** compare the re-read of that same
named row against the pre-toggle value you held; if it doesn't match, or the run is interrupted
before that comparison is made, the shared stand may be left altered for every other user of it —
surface that as a blocking risk in your report rather than moving on silently.

**Where the evidence goes.** You do not assemble the AC list by hand: with `manifest.behaviourIndex`
supplied (step 5.1), the plan's own **Described in** cell already names the card + AC list to walk
for each row — walk that list, and treat a row still reading `⚠ not described` as one step 5.1 has
not covered yet. The Evidence column carries your per-AC result lines, never the **Described in**
citation copied across; a hand-authored summary table in its place is the rule-1 violation.

**What the generated `Quality gates` rows must contain (the `creatio-ui-guidelines` done-gate —
`./references/build-task-execution.md`, run inside the build task that touches the page).** They are
TWO of the pre-seeded rows above — not extra rows you add — sharing ONE evidence id: file ONE record
in `<built-file>.evidence[<id>]` naming the shipped reference page you diffed against AND the
components you checked via `get-component-info` (e.g. `referencePage: "AccountPage"`,
`components: ["crt.ExpansionPanel", "crt.GridContainer"]`), and have it reviewed for `judge[<id>]`
by a SEPARATE context wherever the host allows a sub-agent — a record reviewed by its own author is
a weaker verdict, so say in `worklog.md` which it was. The first row closes when that record is
complete; the second closes only when the judge entry marks it convincing — a record nobody reviewed
leaves the second row open even if the first reads ✅. Either row left `☐`/not-`Done`, or the first
marked `Done` with no reference-page + component evidence (a surface review), means **that page is
NOT done** — mark the page's own row `⚠ Partial` and do not report the task complete.

**Two platform residues a run can leave on the stand, and neither is yours to remove silently (C1,
C2).** Both are defects on the platform side: REPORT them and stop there — deleting records on a
customer's stand is the operator's decision. Know they exist, because the Applicant run had to clear
both by hand on top of a green build:

## Known Traps — the build-time half

Real failures from prior builds, each enforced by a gate or a reference — a memory aid, not new
rules. The plan-phase half stays in `SKILL.md`.

- **Feature downgraded to a list.** Rebuilding a Visa (Approvals) as a plain `ApplicantVisa`
  DataGrid, or Activities/Emails as a `crt.Timeline`. → the mapping reference's standard-features
  table.
- **DCM widgets mis-placed / mis-built — and the wrong form template.** When a DCM case is present
  the form page needs a stage **progress bar**, so PREFER building the form on
  **`PageWithTabsAndProgressBarTemplate`** (it ships the bar placed + the top profile island) and
  re-bind the page to the entity; hand-adding `crt.EntityStageProgressBar` into a plain template's
  `MainContainer` is the FALLBACK. This steer applies to NON-typed pages too, not only typed ones —
  the engine emits a `Template — DCM case present` note and flags a chosen template that has no
  progress bar (e.g. `FormPageTemplate`). If you do hand-add: the **progress bar** goes in
  `MainContainer` (top of content, below the header) — NOT `MainHeader`, not a bare child of `Main`.
  **Next steps** is a tab BESIDE Feed/Attachments, built like them (caption via `#ResourceString#`,
  icon = `flag-icon`, header in the tab's `tools` slot, widget in `items`) — not a bare widget and
  not an ExpansionPanel. Both auto-populate from the case; don't hand-author stages/steps. → the
  mapping reference's build recipes.
- **Added container doesn't match the template's.** An island/container you ADD (e.g. a second
  profile island) must copy the template island's `color`/`padding`/`borderRadius`/card settings —
  not a bare, differently-styled box. → the mapping reference's build recipes.
- **Run-process button mis-placed / missing on a surface.** Read the process BINDING
  (`ProcessInModules` by SysModule): it may be bound to the **list**, the **form/record card**, or
  **both** — add it as a menu item in the existing `Actions` button on EACH bound surface (list →
  run for selected rows; form → run for the current record via `$Id`), labelled with the process
  **Caption** (not its code). Never a standalone button; don't assume list-only or form-only. → the
  mapping reference's build recipes.
- **Plan layout simplified at build.** Collapsing the plan's profile islands (or groups/tabs) into
  one "for simplicity" is an unannounced plan deviation — build EVERY island the plan shows (each is
  its own `crt.GridContainer` in the side profile) and every group/tab. A genuinely better
  simplification is a proposal to raise, not a change to apply silently. → the mapping reference's
  build recipes.
- **UI-guidelines gate deferred or run shallow.** Two failure shapes, both = page NOT done: (1)
  marking the gate `PENDING` and reporting the page done anyway; (2) running `creatio-ui-guidelines`
  only as a surface review (screenshot + schema) and skipping the
  **style-parity-with-the-reference-page** step — so `toggleType`, `title`-instead-of-`caption`, and
  island card settings get caught only after the user asks about styles on other pages. The gate
  runs when the page is saved, its core is the tool-based style diff (reference page +
  `get-component-info` per added component), and its evidence is a mandatory row in the step-8
  Plan-vs-Done table. → step 7 / step 8 / the guidelines skill's "Style parity" checklist item.
- **Means-of-communication downgraded to a grid.** A `ContactCommunication` detail is the native
  **Communication-options** component (`crt.CommunicationOptions`, the compositeOnly component the
  "Communication options" composite assembles — NOT `crt.ContactCommunication`, which is the ENTITY
  name, not a component type), not a plain Expanded-list — if its component/`CrtCustomer360App`
  package is missing on-stand, RAISE it, don't silently build a grid. → the mapping reference's
  standard-features table.
- **Auto-filled companion fields dropped → lone-field island.** An island/group field whose column
  is NOT on the entity (e.g. `Department`/`Job title` loaded from the selected `Request` by an
  `on<Lookup>Change`/`set<Lookup>Info` handler) must be built as a **read-only field on a view-model
  attribute** + the on-change handler — not dropped because it has no real column. Dropping them is
  what leaves a one-field island. → the mapping reference's build recipes.
- **`success` mistaken for "works".** clio returns `success` for bodies that fail at runtime —
  render in the browser. → step 7 / step 8.
- **Browser capability assumed instead of checked.** A run that promises automatic render
  verification without ever calling `list_connected_browsers` finds out at the END that it had no
  surface — and the built-in pane is no substitute, because its per-action approval gate survives a
  bypass-permissions session. Establish the surface BEFORE the first stand write and say so when
  there is none. A stored preference that later proves unachievable is RE-ASKED, never silently
  downgraded while still reporting itself as automatic. → step 7 / step 8.
- **Registry filter bar / section actions dropped.** The Classic section body carries **quick
  filters** (`initFixedFiltersConfig`) and **custom section actions** (`getSectionActions`) — the
  engine now surfaces both in the plan's `### List page` block. They are page-CENTRIC blind spots
  (the folded form page has neither), so build them on the Freedom LIST page: the quick filters as
  the list's filter controls, the section actions as list-page actions. A list page that migrated
  columns but dropped the filter bar / its `createRegistry`-style actions is NOT done. → step 4.2
  (`section`) / the mapping reference.
- **A card's condition replaced by a "stronger equivalent", and the row still marked ported.** One
  of three conjunctive gates (the new-record check) was swapped for a guard the agent judged
  strictly stronger. It inverted the card's negative AC — editing any pre-existing record now
  created a record Classic never created — and the row passed as *ported* because its Evidence cited
  the card without walking its criteria. Closed by two rules: a condition substitution is a
  deviation to propose, equivalent only if it holds for every AC (step 5.1); and Evidence carries
  one entry per AC with negative ACs exercised on-stand, else `⚠ Partial` (Plan-vs-Done). → step 5.1
  / Plan-vs-Done evidence / Contract rule 7.
- **Imperative lookup filter read as "no filter".** A lookup filtered in
  `attributes.<Col>.lookupListConfig.filters` is the SAME user-visible behaviour as a declarative
  `businessRules` FILTRATION, but it is not a business rule and does not come across as one — it
  needs a Freedom filter handler. Same for `attributes.<Col>.dependencies` (the classic "recompute
  when these columns change" wiring → an on-change handler) and for a **virtual** attribute with no
  entity column behind it (page UI state — an editability/mode flag, a collection backing a menu —
  which no field insert carries). All three are now members with their own decisions; none of them
  may be reported as absent. → step 4.2 / the mapping reference.
- **Detail add flow ≠ plain related list.** Many details are NOT a default add-new list: they ADD
  via a **lookup** (pick existing), call a backend **service** to link/insert, and/or are an
  **inline-editable grid**. The engine detects this from the detail body
  (`openLookup`/`addFromLookup`, `serviceName`/`callService`,
  `ConfigurationGrid`/`getCellControlsConfig`) and raises a `detail-add-mechanism` ⚠ naming the
  lookup/service/editable-columns. An **editable-grid** detail is emitted as an **`Editable list`**
  (target `crt.DataGrid` + `features.editable.enable`, carrying the editable columns) — not a
  read-only Expanded list; build the inline edit, resolving the exact `features.editable.*` keys via
  `get-component-info` on the target version. For the lookup/service add flow, reproduce with a
  **custom add request-handler** (open the lookup → create the link records / call the service), NOT
  a naive add-new — and if a service is named, **verify it is deployed on-stand** (else port its
  logic). Do not ship a plain read-only related list for such a detail. → step 4.2
  (`detailSchemas`).
