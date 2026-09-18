# Decision: CAADT holds the guidance-item ID, clio-knowledge owns the values

**Status:** accepted · **Scope:** `skills/classic-to-freedom-migration/engine/mapping-table.mjs`,
`skills/classic-to-freedom-migration/engine/designspec.mjs` ·
**Raised in review of** ENG-94756 (PR #182)

## The contract

A Classic→Freedom migration plan tells a builder that a page carries a Feed or an Attachments
component. Making those components *work* takes a set of property values — the ones the platform's
own section/app creation flow produces. Those values were measured read-only from a page the
creation flow built, and published as a **clio-knowledge guidance item**:

| | |
| --- | --- |
| Item id | `page-modification-standard-components` |
| Owning repo | `clio-knowledge` |
| Declared in | `bundle-source.json` → `requirements.itemIds[]` |
| Read at build time by | `get-guidance name=page-modification-standard-components` |
| Held in CAADT as | `STANDARD_COMPONENTS_GUIDANCE_ID` (`engine/mapping-table.mjs`) |

CAADT carries **the id and nothing behind it**. The plan says *which* component is owed and *where*
its settings are defined; the values themselves live on the other side of the call. The companion
deliverable is named the same way: `ATTACHMENTS_DATA_SOURCE` = `AttachmentListDS` is the artifact a
`crt.FileList` reads its records from, so the plan can say the page owes it and `--verify` can gate
its presence — while its *shape* (the entity it binds, its scope, its attribute) stays in the
guidance item with everything else the builder configures.

## Why the values are not copied here

This is approved requirement **R7**, and the engine could not honour a copy even if R7 allowed one.

**`migrate.mjs` renders the plan offline.** Plain `node`, no clio, no stand. A value table in this
repo could never be checked against the item it claims to mirror, so the first upstream edit would
leave CAADT confidently printing stale values — with no mechanism able to notice.

**Two sources of truth for one set of values is the defect this ticket exists to end.** The reported
failure was a page whose Feed queried nothing because the plan said "template-provided" and stopped.
Replacing one incomplete answer with a second, drifting copy of the right answer is not a fix.

**`get-component-info` stays authoritative for the property vocabulary.** A table here would compete
with it.

## Why the route is unconditional

The pointer is appended wherever a guided component appears, with no branch on which Freedom form
template the page is built on. That is deliberate. On a basic template
(`PageWithTabsFreedomTemplate`) the components are **merged** onto containers the template already
ships; on a richer template they may be **inserted** outright. Both paths owe the same property set —
the template supplies the container, never the configuration — and the guidance item covers merge and
insert alike.

This is not inference. The end-to-end run of 2026-09-17 migrated `UsrToMigrate2App_FormPage` on
`PageWithTabsFreedomTemplate`, and the route is what sent the builder to fetch the guidance article
before producing a working Feed, working Attachments and a correctly bound `crt.TagSelect`. Gating
the route on template family would have broken that run.

### The acceptance criterion this contradicts, said plainly

ENG-94756's fourth acceptance criterion reads *"When a basic template is used, existing migration
behavior is not affected"*, and the approved requirement derived from it (**R8**) says basic-template
migrations behave exactly as before. **That is not what ships.** Basic-template plans gain the route,
deliberately, for the reason measured above.

The criterion was written from the ticket's framing — the reported defect was about *non-basic*
templates, so leaving the basic path alone read as the safe default. The 2026-09-17 run shows the
safe default would have been the regression: the basic template is exactly where the components are
merged, and a merge is precisely the case that needs the property set it cannot derive from the
container. **The criterion should be amended to "the basic-template path gains the same route, and
nothing else about it changes"** — which is what the tests assert.

`engine-tests/classic-to-freedom/run-mapper.mjs` pins both halves: the route is present on the basic
template, and the basic-template plan is byte-identical to the top-area one once the template name is
substituted, so nothing *else* varies by template family.

## What enforces this, and what it proves

| Check | Where | What it catches |
| --- | --- | --- |
| R7 GUARD (output) | `run-mapper.mjs` | a canonical value reaching the rendered plan or a gated row |
| R7 GUARD (source) | `run-mapper.mjs` | a canonical value typed into any engine `*.mjs` |
| R7 GUARD (paste detection) | `run-mapper.mjs` | the value table pasted in as JSONC, a table, or `const` assignments |
| One-spelling scan | `run-mapper.mjs` | a second hardcoded spelling of a guided feature name |
| Decision-record check | `run-mapper.mjs` | this document drifting from the constants it describes |

The guard splits **values** from **names** on purpose: a property *name* is a route to the catalog,
not a copy of its contents, so naming one is green and *assigning* one is red.

The id literal is spelled out in the tests rather than imported from the engine. A test that imported
`STANDARD_COMPONENTS_GUIDANCE_ID` would follow a rename straight past the break — the plan would keep
pointing at "whatever the engine calls it" while `get-guidance` served nothing under that name.

### What this does not prove

**Nothing here checks the upstream half.** If the item is renamed or removed in clio-knowledge,
migrated plans point at a dead id and every check above stays green.

The obvious precedent does not transfer. `verify-vendor-upstream.mjs` anchors the vendored parser by
independently fetching the pinned package from the **public npm registry** — an unauthenticated
fetch any CI job can make. clio-knowledge is not reachable that way from this repository's CI, so the
equivalent job would need cross-org credentials in a public OSS repo's workflow to assert a string
exists in a file. That trade is not worth making for this failure mode, which is loud rather than
silent: a builder calling `get-guidance` on a dead id gets an error naming the id, at the moment it
matters, in the run that needed it.

What is enforced instead is the **CAADT side**: the id has exactly one definition, the tests pin the
literal independently of it, and this document names the owning repo and file so a clio-knowledge
rename has a place to look. Renaming the item upstream means renaming it here, in the same change.
