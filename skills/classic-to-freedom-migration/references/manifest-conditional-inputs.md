# Conditional manifest inputs (step 4.2)

Each section is a step-4.2 manifest input that applies only when its surface signal exists. SKILL.md
step 4.2 names the signal and sends you here; the inputs every run needs stay there.

## profileSchemas — the page embeds a profile card

- **`profileSchemas` (required once the page embeds a profile CARD — the compact card of a LINKED
  record)** — a classic page can embed a small profile page of a linked record (a "requester" block
  on a request page; `AccountProfile` on `ContactPageV2`). The engine recognises it from the
  `modules` config (`config.schemaName` + `config.parameters.viewModelConfig.masterColumnName`) and
  emits it under `changeSet.profileCards` — but it needs the profile schema's OWN body to know the
  **profiled entity** and **which columns the card displayed**: fetch it with
  `get-client-unit-schema --schema-name <ProfileSchema>` and pass
  `{ "AccountProfileSchema": { "body": "<define(...)>" } }`. **The bundle (4.0) does NOT gather
  these** — add them yourself, exactly like `detailSchemas`. The only other resolved answer is
  `{ "<SchemaName|moduleName>": false }` — record it once you have VERIFIED there is no separate
  profile schema to read (the config names none, or it is unreadable), then rebuild the card by hand
  per the reference. **The structure gate BLOCKS** until each recognised card is resolved one way or
  the other (without it the Freedom side profile would be built empty). Build guidance:
  `./references/classic-to-freedom-mapping.md` → *Embedded profile cards*.

## addRecordMiniPage — the section's quick-add mini page

- **`addRecordMiniPage` + `miniPageSchemas` (required for a section — the quick-add mini page,
  folded + gated)** — the section's **add-record mini page** is often registered at the
  module/edit-page level (`SysModuleEdit` → `miniPageSchema` with `miniPageModes` containing `add`),
  **NOT** in the section body — so the engine will NOT find it from the section body alone and must
  not assume "none". Resolve it from `list-entity-client-schemas` (a per-type `editPages` entry
  carrying `miniPageSchema` + an `add` mode) and record `manifest.addRecordMiniPage` =
  `{ "schema": "<MiniPage>" }`, then **fold it** by assembling its bundle
  (`get-classic-page-sources --schema-name <MiniPage>`) into
  `manifest.miniPageSchemas["<MiniPage>"]` so the engine emits its FULL layout under
  `### Add mini-page mapping`. If there is genuinely none, record
  `manifest.addRecordMiniPage: false`. **The structure gate BLOCKS** until the mini page is folded
  or explicitly `false` — leaving it unresolved makes the engine flag `⚠ NOT verified` (it will not
  silently claim "no mini page"). **Building the mini page is NOT enough — WIRE it to `+ New`:** in
  Freedom "this section adds records via this page" is a configuration record (a RelatedPage binding
  with the **add** purpose), NOT part of the page body — so `create-page` alone leaves the mini page
  an ORPHAN schema that nothing opens and `+ New` still shows the full form. Creating that
  add-binding is a gated deliverable (the Plan-vs-Done checklist carries a "Mini page wired to '+
  New'" row); verify on-stand that `+ New` opens the mini page, not the full form.

## Dashboard delivery mode — `signals.dashboards` found dashboards

Chain 2 of `signals.dashboards` (SKILL.md step 4.2): run it once chain 1 has returned the section's
dashboards.

**The delivery mode, PER dashboard** (a section can own a packaged and an unpackaged dashboard at
once, so the section's own package does NOT predict it — read the actual bindings).
`SysPackageSchemaData` where `SysSchema.Name = 'SysDashboard'`, select `Name`, `SysPackage.Name`,
`Data`. `Data` comes back as JSON — `{"PackageData":[{"Row":[{"SchemaColumnUId":…,"Value":…}]}]}`.
**Strip a leading BOM before parsing** — `Data` frequently starts with `﻿` and `JSON.parse` throws
on it. Do NOT catch that and skip the row: a skipped row reports its dashboard as stand-only. A
dashboard is **packaged** when its `Id` is the `Value` of the entry whose `SchemaColumnUId` is
`SysDashboard`'s `Id` column (`get-entity-schema-properties`) — an INHERITED base column, so that
UId recurs across schemas and identifies nothing by itself. The owning package is that binding's
`SysPackage.Name`; present in **no** binding ⇒ **stand-only**. Match on the dashboard's `Id` across
**every** binding that query returns. **Do NOT narrow the scan by package:** a dashboard's binding
is unrelated to where its section's schema lives, so that shortcut returns a *wrong* answer rather
than an empty one — a packaged dashboard reads as stand-only. Worked example:
`./references/classic-to-freedom-mapping.md` → *Section dashboards*.

## typedPages — the entity opens a different page per Type

- **`typedPages` + `typedPageSchemas` (required for a typed entity — each per-type form is a FULL
  deliverable, folded at PLAN time, gated)** — for a **typed entity** (records open a DIFFERENT edit
  page per Type — e.g. `Document` →
  `DocumentICPage`/`DocumentOCPage`/`DocumentRegistryPage`/`ActPageV2`), the per-type Classic edit
  pages ARE the form deliverables (the base `*PageV2` is only their shared parent/seed, **not** a
  separate form). Get the list from `list-entity-client-schemas` (`editPages` carry per-type
  `typeColumnValue` AND `typeColumnDisplayValue` — the Type's resolved display NAME) →
  `manifest.typedPages` (`[{ schema, type, typeName }]`): map `typeColumnValue` → `type` and
  **`typeColumnDisplayValue` → `typeName`**, so the plan names the Type (e.g. "Retirement plan")
  instead of a raw GUID — a bare GUID tells the approver nothing about which Type each form is for.
  If the tool could not resolve the name (`typeColumnDisplayValue` empty — no rights / no display
  column), the plan falls back to the GUID with a ⚠ to resolve it on-stand; the engine also accepts
  `typeColumnDisplayValue` verbatim on the entry. Then **fold EACH**: assemble its own bundle
  (`get-classic-page-sources --schema-name <TypedPage>`) into
  `manifest.typedPageSchemas["<TypedPage>"]` (a nested manifest, exactly like `childPageSchemas`) so
  the engine emits its FULL per-type design spec under `### Typed page mappings`. The ONLY escape is
  `{ "bindOnly": true }` on the entry — use it **strictly** when you have VERIFIED that type's
  layout is **identical to the base** (a type-specific binding, no separate form). **`bindOnly` is
  NEVER a way to get past a typed page that won't fold cleanly.** If its fold BLOCKS (its own gate:
  `unresolvedParents` / merge warnings / skeletal seed) or shows a real per-type delta, that is a
  **BLOCKER to RESOLVE** — re-assemble its bundle / fix the input and fold it as a full form — not a
  reason to mark it `bindOnly`. Marking a type `bindOnly` when it actually has its own layout delta
  **silently loses that delta** (the engine then renders only the shared base form for it). Rule of
  thumb: `bindOnly` requires positive evidence of "identical", not the absence of a working fold.
  **The structure gate BLOCKS the plan until every typed page is folded or `bindOnly`** — "per-type
  field mapping done at build" is not a valid resolution (it is exactly what shipped 1 of 4 typed
  forms). Fetching all N typed bodies is inherent: you cannot build a form whose body you never
  read. **The gate also checks the folded tables are actually FILLED:** a typed fold with an **empty
  Layout** (0 fields — bad bundle/seed), or one whose body **declares business rules but maps none
  into the Logic table** (rules dropped/unread), is INCOMPLETE and blocks — you do not proceed on an
  empty per-type table. (The base `*PageV2` is not rendered as a "general mapping"; only the List
  page + the per-type forms appear, and the Overview counts the typed forms, not the base's
  fields/0-rules.) **Building the per-type forms is NOT enough — ROUTE each Type to its form:**
  Classic keeps the type→page map in per-type `SysModuleEdit` rows; Freedom needs the equivalent
  RelatedPage binding **per Type** (by the Type column). Without the routing, only ONE Type ever
  opens its form and the other N−1 are built-but-unreachable dead schemas. The routing is a single
  gated deliverable for the whole typed entity (the Plan-vs-Done checklist carries a "Per-type page
  routing" row) — do not leave it to be noticed; verify on-stand that opening/`+ New` on each Type
  routes to its own form.

## opensClassicPage — a child entity owns another section

**`"opensClassicPage"` — the SECTION BOUNDARY, and it has to be asked BEFORE the fold.** The moment
`list-entity-client-schemas` / `list-pages` tells you the child entity has a section of its own (its
own `SysModule`), stop and ask ONE question: *"`<Entity>` is its own section — keep its Classic card
and just open it from this detail, or migrate it too?"* Asked here it costs one turn; asked after
the fold it costs the whole fold and everything downstream of it. **Recommend an answer instead of
asking blind, and let the SCOPE decide which.** A single-section run (`planMeta.scope` names one
section) → recommend keeping it Classic: the other section is not what the user asked to migrate,
and its card works unchanged. A whole-package run → today's behaviour, migrate it: there the other
section genuinely IS in scope. The recommendation is a recommendation — the user's answer settles it
either way, and the engine does not auto-default (it cannot: nothing in the manifest says
machine-readably which scope this run is, nor whether the child entity owns a `SysModule`). Answer
"keep it Classic" → record `"opensClassicPage": "<the Classic page it keeps opening>"` on that
detail's entry, `"ownSection": "<Section>"` when you know the section's name (never invent one).
What the engine then does: the child is RESOLVED for the structure gate, its page is **never
folded** (no `childPageSchemas` entry, no recursive mapping, no child gate — so that page's own
warnings cannot reach this plan), it **publishes no deliverable at all** (an
`N/A — cross-section boundary (approved)` row in `--checklist`/`--verify`, so nothing about it can
ever read MISSING), and the plan states the boundary in the user's terms in both the Main scope
(`Reuse (Classic)`) and the child section. Record the decision in `decisions.md` like every other
answer. Two guard-rails: this is the USER's line to draw, never yours to declare (Contract rule 4
stands — "big / shared / view-only / follow-on" are still not skip reasons), and if the child entity
already ships a Freedom form, `reuseFreedomPage` is the better answer and wins. Widening the scope
later is just dropping the key and supplying the schema — a re-plan, not a defect.
