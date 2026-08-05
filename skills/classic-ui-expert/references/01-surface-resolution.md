# 01 — Surface resolution: what pages and details exist

Goal: a complete, query-derived list of the schemas that make up the surface. Never a
name-guessed one.

## Why not name-guessing

A registry search for names containing the entity word sweeps in unrelated schemas (a
"sorting order" mixin, a "reorderable container", another product line's modal page) and
*misses* schemas whose name does not contain the word at all — including details, mixins and
utility modules that hold the real logic. Guessing produces both false positives and silent
gaps, and the enumeration count is then wrong in an unknowable direction.

## Order of operations

0. **Run the customization census first.** One ESQ over `SysSchema ⋈ SysPackage`
   (`ManagerName = 'ClientUnitSchemaManager'`, `ExtendParent = true`) lists every extension
   layer on the stand with its package — the complete set of *customized schema names*,
   cheap and exhaustive: a Classic client customization that is not an extension layer of
   some schema does not exist. The census is not the answer (it has no section scoping) —
   it is the **completeness check**: after building the surface (steps 1–5), intersect it
   with the census; any census row related to your entity that your surface walk did not
   reach is a missed edge, not an ignorable leftover. Caveat: net-new *base* schemas added
   by an extension package (a utilities module, a net-new detail) have `ExtendParent =
   false` and do not appear in the census — they enter the surface only through the walk,
   as references from counted extension layers.
1. **Ask the platform for the surface, not the filesystem.**
   `list-entity-client-schemas` (arg: `entity-name`) returns `sections` + `editPages`, each
   with `kind: classic|freedom`, its per-type `typeColumnValue`, and `miniPageSchema`. This
   is the authoritative answer to "which pages does this entity have, and is a given one
   Classic or Freedom".
2. **Assemble each page's chain in one call.**
   `get-classic-page-sources` (arg: `schema-name`, optional `entity`, `output-file`) returns
   the full replacing-schema chain (`schemas[]` with `pkg` + `body`), the parent-template
   `seed[]`, merged `resources`, `entityColumns` / `columnTitles`, and `detailSchemas`. Run it
   for the section page, every record page, every mini page.
3. **Take the wired details from the page manifest**, not from names. `detailSchemas` /
   the page's `details` block name what is actually attached. A detail whose name does not
   resemble the entity is still in scope; a similarly-named schema that no page wires is not.
4. **Confirm each layer's owning package from the registry** — see `02-layer-model.md`.
5. **Record what you did not cover.** If typed pages, mini pages or details exist and you
   chose not to enumerate them, that is a decision to state explicitly with its reason.
   Discovering a gap afterwards is an accident; declaring a bounded scope is a decision.

## Registry queries when the helpers are not enough

Client-side UI schemas are rows in `SysSchema` with `ManagerName = 'ClientUnitSchemaManager'`.
Useful columns: `Name`, `Caption`, `ManagerName`, `ExtendParent`, `UId`, `ModifiedOn`, and via
join `SysPackage.Name`, `SysPackage.Maintainer`.

Read them with the environment-aware clio ESQ executor. Two habits:

- Filter by `ManagerName` as well as name — otherwise process schemas, source-code schemas
  and mobile schemas land in the same result set.
- A 0-row result proves nothing until you have confirmed the filter is right. Re-check the
  column names against the real schema before concluding "it does not exist".

Source-code schemas (C#) use `ManagerName = 'SourceCodeSchemaManager'`; process schemas use
`ProcessSchemaManager`. You will need these when a client member calls out — see
`07-boundaries.md`.

## Three edge types build the reachable set

A surface walk that only follows what page bodies mention is incomplete. Three distinct
edge kinds attach schemas to a section:

1. **Body references** — `details[].schemaName`, `mixins`, module `define` dependencies.
   Found by reading the fetched layers.
2. **Registry edges** — schemas attached by data, not code: edit pages and mini pages of
   the section's *child entities* (`SysModuleEdit` rows for the entities its details show).
   A detail's edit page is never named in the master page's body.
3. **Convention edges** — schemas the platform resolves at runtime by *name convention or
   registration*, invisible to any static read of the page. Known case:
   `<Entity>ActionsDashboard` (the DCM/actions panel on the record page). When the census
   shows a customized schema "related" to your entity that no fetched body names, suspect
   this class — and record how it attaches as a settling query, not an assumption.

## Global vs section-scoped customizations

Some customized schemas are platform components rendered on *every* section
(e.g. the actions-dashboard host, message publisher panels). Their extension layers are
real customizations, but counting them once per section multiplies one fact by the number
of sections. Tag them **global**, count them once, and state in the run's scope note that
they were classified as global rather than enumerated per section.

## What "the surface" includes

- the section (list) page and its layer chain;
- every record page variant and its chain, plus the parent-template chain when the reading
  needs it (a page's inherited actions and containers live there);
- mini page(s), if any exist for the entity — verify by query rather than assuming;
- the details wired onto those pages, and their own layer chains;
- any client schema the above *reference*: mixins, utility modules, constants modules.
  These are discovered while reading (see `05-reference-following.md`), not up front;
- schemas reached through registry and convention edges (above) — checked against the
  census before the scope is declared complete.
