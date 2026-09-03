# Classic → Freedom migration engine

Deterministic, offline Node module. It reconstructs the *effective* Classic page from N `ClientUnitSchema`
layers (base → top) and maps it to a Freedom **ChangeSet** + plan/design-spec. No Creatio/stand dependency:
the skill fetches the schema bodies (via clio) and passes them in a manifest; the engine only transforms.

## Usage

Invoked by the skill as a CLI — see `../SKILL.md` step 4:

```
node migrate.mjs <manifest.json>          # full JSON: effective page + ChangeSet + needsDecision[] + gates
node migrate.mjs <manifest.json> --plan   # render the migration plan (Markdown)
node migrate.mjs <manifest.json> --spec   # render just the per-page design spec (Markdown)
node migrate.mjs <manifest.json> --stubs  # the step-5.1 behaviour-analysis handoff digest (JSON)
node migrate.mjs <manifest.json> --units  # the per-page BUILD QUEUE + the exact keys --built must use (JSON)
node migrate.mjs <manifest.json> --units --resolutions r.json # …with the operator's ⚠ Confirm ANSWERS attached
node migrate.mjs <manifest.json> --plan --resolutions r.json  # re-render the PLAN with those answers shown in it
node migrate.mjs <manifest.json> --checklist            # the Plan-vs-Done control table, AFTER implementing (Markdown)
node migrate.mjs <manifest.json> --verify --built b.json # the VERIFIED done-gate: expected vs actually built (Markdown)
node migrate.mjs <manifest.json> --verify --built b.json --verify-json v.json # …plus the MACHINE-READABLE verdict (JSON)
node migrate.mjs <manifest.json> --plan --out plan.md   # WRITE the artifact to a file (present that file, not stdout)
node migrate.mjs <manifest.json> --plan --resolved-gates rg.json # …and WRITE this run's resolved component-gate set (JSON)
node migrate.mjs <manifest.json> --units --page main    # ONE page's slice of the build queue (also --spec / --checklist)
node migrate.mjs <manifest.json> --units --slices s/    # …and one `queue-<n>.json` per published key, into `s/`
node migrate.mjs <manifest.json> --verify --built b.json --slices s/ # one `built-<n>.json` per published key
node migrate.mjs <manifest.json> --verify --built b.json --page main # ONE page's row of the built file (JSON)
node migrate.mjs <manifest.json> --verify --built b.json --page main --verify-json v.json # the IN-CONTEXT single-unit GATE (per-page done-gate: exit 2 if THIS page is short)
```

Mode flags take no value and only ONE is honoured per run (the CLI picks the first it matches, so a second mode
flag is silently ignored) — pass exactly one. `--out <file>` works with all of them.

`--page <key>` narrows `--spec`, `--checklist`, `--units` and `--verify` to one published page key; an unknown key
is exit 1, never the whole artifact. `--slices <dir>` (with `--units` or `--verify`) writes that same slice as one
FILE per published key, so a caller with one agent per page hands each its own row instead of the whole file. Both
are additive — stdout and `--out` are unchanged — and `--slices` writes on exit 2 too, which is when a build agent
needs its row.

`--resolved-gates <file>` (with `--plan` or `--units`) writes THAT run's resolved component-gate set — the durable,
machine-readable copy of every gated composite the run emits, as `[{ componentType, kind, id, feature?, source }]`
(`source` is the registry provenance). `--plan` also mirrors the same fact as one compact provenance line in the
plan's Overview; the JSON is the full record. A run that gates no type writes `[]`. Like `--out`, the path must be a
real file path, not another flag.

**`--verify --page <key>` alone is a pure READ** (this page's row of the built file, exit 0, gates nothing). **Adding
`--verify-json <file>` turns it into the IN-CONTEXT SINGLE-UNIT GATE** (ENG-95469): it runs the SAME detector the
full sweep does, SCOPED to that one page, writes the per-unit verdict `{ pageKey, complete, buildComplete, missing,
unverified, openRows, planGaps }` to `<file>`, and drives the HARD done-gate on THIS page. ENG-95901 — the exit code
reads `buildComplete` (the OWNER axis — false while any open row is the builder's), NOT the combined `complete`: a page whose only open rows are
unfiled evidence (a separate read-only verifier/judge's to file, never the builder's) is **exit 0** here, even
though `complete` still reads `false` for it. A page with a genuine MISSING deliverable is **exit 2**, exactly like
the full `--verify`, so a build agent can gate its own unit in its own context before reporting it complete. A
`<key>` this plan does not publish fails LOUDLY (exit 1 with a distinct message), never a false-green complete
verdict.

**Slice files are numbered, not named after the key** — `queue-1.json` is the first entry in `pages[]`, and so on.
A page key is not a legal filename, and sanitising one is many-to-one: every non-Latin caption strips to the same
characters, so two keys would land on one file and a consumer would read the wrong page's row. A position cannot
collide. Each slice carries its own `pageKey` AND the run's `planVersion`, so a consumer can tell both that the
file is the right page and that it is the right round. A run whose plan publishes fewer pages deletes the
higher-numbered slices the previous run wrote, rather than leaving them to be read as current.

**The plan version.** `--plan` prints `**Plan version:** \`plan-<hash>\`` as the first line of the Overview, and
`--units` publishes the identical string as `planVersion`. It is a deterministic short hash over three manifest
inputs and only those three — `entity`, `schemas` (package + body CONTENT, in order) and `planMeta`. No
wall-clock, no random source, and no filesystem path (a `{ file: … }` schema entry contributes its CONTENT), so
the same manifest always yields the same version and re-planning is not a new version to approve. It does NOT
cover `seed`, `detailSchemas`, `childPageSchemas`, `profileSchemas`, `section`, `signals` or `behaviourIndex`:
those reach the rendered plan too, so the version confirms that the approved and built plans share their
MAIN-PAGE inputs — it is not a checksum of the whole artifact. It is the
string the `decisions.md` approval entry names, and the string the delegated build compares that entry against.
`plan.md` is engine-WRITTEN, so nothing else can put a version in it and survive the next `--plan --out`.

`--verify-json <file>` (only with `--verify`) writes the verdict a CALLER computes on:
`{ complete, missing, unverified, planGaps, pages: { "<key>": { missing, unverified, complete, buildComplete,
openRows: [ { n, deliverable, status, evidence, outcome, id? } ] } } }`. It is ADDITIVE — stdout and `--out` still
carry the Markdown table for the human. Read it instead of parsing the table: the table has no per-page counts at
all, and the `⛔ VERIFY INCOMPLETE` stderr line lists at most six pages (the JSON lists every one, with its open
rows). `planGaps` is the other half of exit 2 (D12): non-empty means the PLAN is short — not buildable-out-of —
and it is independent of `complete`, so a run can have nothing left to build and still exit 2. ENG-95901 —
`complete` here is the COMBINED axis (`missing === 0 && unverified === 0`), unchanged: the whole-tree `--verify`
still treats an unconfirmed evidence row as a reason not to call the run done. `buildComplete` (no open row the
BUILDER owns) is the axis the SCOPED `--verify --page <key> --verify-json` gate above reads for ITS exit code — the
two fields answer different questions on the SAME per-page object, and both are always present. The axis is keyed on
each row's `owner` (`"builder"` / `"verifier"`), NOT on its `missing`/`unverified` label: `unverified` is also what a
PARTIAL or unread build resolves to (`0/N expected fields`, `k/N components`, "no `--built.pages` entry"), all of
them the builder's own work. `builderOpen` counts exactly those rows and is what the scoped exit-2 line reports. **The build loop is `--units` → build → `--verify`.** `--units` publishes one entry per page the migration
creates — `main`, `child:<Entity>`, `typed:<Schema>`, `mini:<Schema>` — each with its expected template, target
package and `expect` counts (including
`expect.fieldNames`, the element names the fields check matches on, and `expect.fieldLayout`, each field's CELL as
`{ name, row, column, colSpan?, rowSpan? }` — ENG-96457, so a unit that owns one page can place the fields the way
the plan does), plus the five reachability keys with
`appliesWhen` already decided by the engine, the evidence-record ids, the ⚠ Confirm preflight items and a
leaf-first `buildOrder`. A key identifies exactly ONE physical page: when two distinct pages would land on the
same key (two related lists opening the same entity, or two same-entity child pages on different branches) the
engine appends a disambiguator — `@<Via>`, `@<Schema>`, `#2` — while one page reached along two paths keeps a
single key. The suffix is derived by the engine, so **read every key from `--units`; never construct one.**

`--resolutions <file>` (**`--units` and `--plan`**) attaches the operator's ANSWERS to that run's ⚠ Confirm questions,
publishing each on its own queue item as `preflight[].resolution = { answer, decidedBy?, date? }` — `null` when the
question is unanswered. **An answer is an INPUT to the build and closes no `--verify` row:** the row still needs a
filed evidence record and a judge verdict. Key each entry on `kind` + `item` (the published `id` also works, but its
`pageKey` half moves — a list-page question rides on `list` when that key is published and on `main` when it is
withheld, so `kind`+`item` is what survives). An absent file means "nobody has answered yet" and is not an error;
an unparseable file, or an entry without a non-blank `answer` and without either an `id` or both `kind` and `item`,
is exit 1. Matching trims both sides, and an entry carrying both key forms counts as matched if EITHER form matched.
Under `--plan` (ENG-96457, item 5) the same file is rendered INTO the document: each answered ⚠ row shows
`**✅ answered:** <answer>` after its question (the question is kept, so a recorded decision is auditable and
distinguishable from a guessed default), the worklist heading reads `(<n>, <k> answered)`, and an answered
`list-columns` question replaces the engine's unresolved column line instead of leaving it reading as a fallback.
It used to be `--units`-only, which is how an approved `plan.md` and the payload the builder acted on came to say
different things. Three reports keep a discarded answer from being silent, none of them fatal:
`resolutionsUnmatched` (answers matching no question this plan asks), `resolutionsConflicts` (one question answered
by BOTH an `id` entry and a `kind`+`item` entry — the pair is applied and the `id` one is discarded), and a stderr
warning for two entries under the SAME key form (the last wins). All three are named on stderr as well.

```jsonc
{ "resolutions": [ { "kind": "list-columns", "item": "no list columns resolved",
                     "answer": "Name, Status, Owner, DueDate", "decidedBy": "…", "date": "2026-08-19" } ] }
```

Those page keys are the ONLY valid keys of the `--built` payload:

```jsonc
{ "pages": { "main": { "viewConfig": <get-page bundle.viewConfig>, "packageName": "…", "parentSchemaName": "…", "schemaUId": "<page.schemaUId>" },
             "child:InternalRequest": false },      // false = genuinely not built; key omitted = not checked
  "reachability": { "sectionRegistered": { "workplaces": 1, "names": ["<Workplace>"] }, "reuseBindings": false },   // a COUNT, not a flag — a registration only ADDS, so the row closes at exactly 1
  "evidence": { "<id from --units>": { "referencePage": "…", "components": ["…"] } },
  "judge":    { "<id from --units>": { "convincing": true, "why": "…" } } }
```

`viewConfig` is clio `get-page`'s `bundle.viewConfig` **verbatim** — the MERGED page. Not the page's own body: an
element the template provides is touched with `operation: "merge"` and carries no type, so a check fed that source
could never confirm Feed, FileList, ApprovalList or the DCM bar. A payload that is not keyed by page is rejected
with exit 1, and an id or page key the engine did not publish is silently "not checked" — never invent one.

**The LIST page's OWN template is its own machine-checked row (ENG-95470), the same mechanism the form page's
`Form template` row uses.** `pages["list"]` carries `parentSchemaName` exactly like every other page key, and when
the plan resolved at least one other list-page deliverable (columns, a quick filter, a command-bar action) a
`List template → <planned template>` row is added alongside them, resolved against `pages["list"].parentSchemaName`.
Before this, a plan/built template mismatch on the list page (e.g. the plan recommends `ListPageV2FreedomTemplate`
but the section was built on `ListPageV3Template`) surfaced only as free text inside a judge's evidence rejection —
nothing machine-checked it, so a run could close green while quietly ignoring it. The row is deliberately added ONLY
when the list page is already gated by another row: a plan with nothing else resolved for the list page must stay
UNGATED (a `planMeta.listTemplate` value alone must never publish an otherwise-unclosable `list` build unit).

**`schemaUId` is the PROVENANCE field and the CLI rejects a payload without it (exit 1).** Copy it verbatim from `get-page` (`page.schemaUId`). `--units` publishes no GUID of any kind, so it cannot be derived from the plan — only from a real read. The identities must also agree: the same `schemaUId` may not appear under two keys, and one `packageName` may not carry two `packageUId` values. This proves the payload is internally CONSISTENT, not that it came from the stand (the engine is offline and cannot ask Creatio whether a GUID exists) — it stops a payload assembled from `--units` output alone, not a determined author.

**The mini page is a page, so it is checked like one.** Its `Mini page` row resolves from
`pages["mini:<Schema>"]` — present with components ⇒ built · `false` ⇒ MISSING · key omitted ⇒ not checked. There
is no boolean to assert instead: `--built.miniPageBuilt` is read ONLY in the legacy flat payload (a payload with
no `pages` map at all, which the CLI rejects), never once a `pages` map is supplied.

**The inverse call graph.** `triggers[]` is read off DECLARATIONS (an attribute dependency, a bound control
property), so a method invoked from another method's BODY had none and its row printed `⚠ unresolved` — which reads
as "nobody knows what runs this" even though the parser had already recorded the call in `facts.calls`. Those calls
are now inverted into a caller index and walked upward until something answers what starts the chain: a caller with a
declared trigger (the row reports that declaration, reached `via` the chain), or a standard lifecycle method (the
platform calls it, which is the answer). Neither found → `internal call from X`, the honest partial answer. The index
is built from ALL methods including the standard ones the worklist filters out — a helper is very often invoked from
`init` / `onEntityInitialized`. Cycles are guarded, callers are sorted so the result is order-independent, a declared
trigger is never replaced by an internal one, and every caller travels along when there is more than one. Rows left
knowing only their caller are counted apart (`internalCallOnly`) from true orphans (`unresolvedTrigger`): both are
still behaviour-analysis work, and collapsing them would make the recovery look like work that no longer needs doing.

The plan then **folds** each such helper under the row that calls it: ordered directly beneath it, marked `↳`, with
its Freedom target replaced by `port with <caller>` so nobody builds a second artifact for half a behaviour. The
worklist header reports rows AND port units (63 rows that are 44 things to build read very differently). Nothing is
hidden — every row keeps its place and its own ported / dropped / blocked mark (Contract rule 7), and the
`--checklist` row for a folded helper says `(ported with <caller>)` so the two documents agree. Two deliberate
non-folds: a helper with SEVERAL callers (it is usually the row that becomes a shared converter) and one whose caller
is a standard method filtered out of the worklist (no parent row exists to fold under).

**The behaviour-analysis handoff (`--stubs` out, `manifest.behaviourIndex` back).** Four of the plan's imperative
rows cannot be answered from the page bodies this engine reads — a method whose trigger it could not trace, a method
assigned from another module, a `message`, a `mixin` — so SKILL.md step 5.1 sends them to the `classic-ui-expert`
skill. `--stubs` writes the payload for that: per scope (main page · mini page · each child page) every row's method
name, traced trigger, `externalRef` and line span, the `<kind>:<name>` member rows, and the standard-method names the
worklist excluded (so "63 stubs vs 70 members" is a set difference, not a contradiction). It is a digest, not the
result JSON — `evidence` is dropped, because the analysis run reads bodies from the stand itself.

The answers come back as `manifest.behaviourIndex`: `{ "<method>" | "<schema>::<method>" | "<kind>:<name>":
{ trigger?, from?, card?, ac?: […], bodyCard?, bodyAc?: […], note? } }`. On the next run the engine folds each entry
into the GENERATED tables — a **Described in** cell naming the card + AC on the `⚠ Imperative logic` row, the same
reference on a described `⚠ Imperative members` row, and a reported trigger where the engine traced none (marked
`reported`; an engine-traced trigger is never overwritten).

**Two cards, when the body lives elsewhere.** Any row whose behaviour is defined outside the scope that owns it is
described twice — a `mixin:` member or the method wiring one in, a method assigned from another module
(`externalRef`), a `message:` whose counterpart is in another schema, an aggregated `module-dep`, an override
implemented in the base chain. The owning scope's card says how this surface uses it (`card`/`ac`); the body's own
card, typically in the shared core, says what it does (`bodyCard`/`bodyAc`). Both render, as
`<card> <ACs> · body <card> <ACs>` — the criteria that gate a behaviour usually live in the body card, so a plan
that names only the wiring card reads as described while the guards are missing. Where that omission is
mechanically provable — a `mixin:` row or an `externalRef` method carrying a wiring card alone — the plan gets a
⚠ banner (`behaviourIndex.wiringOnly`). A key that matches no row anywhere becomes a plan banner rather than a
silent drop. A key addressing only the SECTION scope gets its own ⚠ banner (`behaviourIndex.sectionOnly`): it is
matched in the digest, but the worklist carries page rows only, so the answer renders in no table and must be
carried into the List-page part of the plan by hand. This is why the reference belongs in the manifest and not in the plan's hand-written `Adjustments`
section: `--plan --out` rewrites the file, so an appended index is lost on every regenerate.

`--out <file>` writes the `--plan`/`--spec` output to a file so the agent presents the file verbatim instead
of hand-pasting stdout (its Overview/Main-scope values come from `manifest.planMeta`).

**Exit codes & gates.** Bad input (missing/invalid manifest, unreadable schema `file`) → exit **1**. Otherwise
the run computes three gates — `gate.blocked` (correctness: parse errors / unresolved parents / merge warnings /
skeletal seed), `structure.complete` (input completeness: unresolved detail / child-page schemas) and
`coverage.complete` (member coverage: every schema member accounted for) — plus, in
`--plan` mode only, a fourth **plan-completeness** check: required `manifest.planMeta` still `<FILL: …>`
(`planMetaMissing`) or unresolved on-stand `signals` (`signalsMissing`). If any of these is bad the CLI prints a
`⛔` banner to stderr and exits **2** (the artifact is still written/printed, with the banner at the top, so you
see *what* to fix). Exit **0** = all applicable gates clear = an approvable plan. (`--spec`/default runs need no
`planMeta`, so the plan check applies only to `--plan`.)

`--verify --built` applies the same exit-**2** done-gate whenever a deliverable is MISSING/unverified (or `planGaps`
is non-empty). `--verify --page <key> --verify-json <file>` narrows that gate to ONE page — the in-context
single-unit gate (ENG-95469): if THAT page is short it is exit **2**, so a build agent's bounded self-check fails
loudly rather than closing a short unit. A `<key>` the plan does not publish is exit **1** (a broken gate is a loud
diagnosis, never a complete verdict).

**The member ledger (`coverage`).** Every member of every merged layer — each `diff` operation, `methods` entry,
`attributes` entry, `messages` entry, `mixins` entry, `define()` dependency and `details` entry — carries a
disposition: `mapped` (the ChangeSet has a Freedom artifact for it), `decision` (it is on a `⚠` worklist),
`resolved` (the agent recorded one in `manifest.memberDispositions`), `chrome` (pure decoration — a **menu separator**, and only
that: recorded and COUNTED, never a `⚠` and never a block; a tooltip, a control's label and the grid-settings
editor each carry content or children and raise a normal ⚠ instead),
`context` (inherited base-template content, excluded by design but COUNTED) — or `unaccounted`, which blocks.
Precedence runs `mapped` > `decision` > `chrome` > `context`: a real artifact or a recorded answer is the stronger
statement, and base-template decoration counts as `chrome` rather than `context`. Kinds with no members are reported as counted
zeros, so "the plan says nothing about messages" cannot mean "nobody looked". Methods additionally carry body
evidence read from the AST (framework calls made, attributes read/written, messages published/subscribed, line
span, passthrough-vs-real, assigned-from-another-module) — the parser still never EXECUTES a body.

## Files

- `engine.mjs` — `parseSchema()` (AST parse of a classic `define(...)` body — reads the returned object, never executes it) + `mergeHierarchy()` (replay the layer chain into one effective page + provenance).
- `vendor/acorn.cjs` — vendored **acorn 8.17.0** (MIT, the CommonJS build `dist/acorn.js`), the JS parser `parseSchema` uses; keeps the engine self-contained (no `npm install`). It is the CJS build so a plain synchronous `require()` loads it after the integrity check on ANY supported Node (no `require(esm)` >= 22.12 floor). **Not in `package.json` by design** (zero runtime deps), so it is outside Dependabot — patching is still a manual re-vendor, but advisories are **surfaced automatically**: the weekly `vendor-audit.yml` runs an OSV query against the pinned version (see `scripts/audit-vendored-acorn.mjs`), and `verify-vendor-upstream.mjs` (PR CI) anchors the pin to the real npm release so the audited version can't be spoofed. `vendor/acorn-LICENSE.txt` holds its license.
  - **Integrity pin** — because this bundle is the one executable component that processes *untrusted* stand schema-body, its provenance is pinned in `vendor/provenance.json` (upstream package + version + SHA-256 of the LF-normalized bytes, which equals the published npm artifact's hash). `verify-vendor.mjs` recomputes the hash and exits non-zero on any mismatch; CI (`.github/workflows/pr.yml` → *Verify vendored parser integrity*) runs it on every PR, so a swapped or silently-drifted parser fails the build. **To re-vendor:** replace `vendor/acorn.cjs` with the upstream **`package/dist/acorn.js`** from `acorn-<version>.tgz` (the CommonJS build — NOT `dist/acorn.mjs`), confirm its LF-normalized SHA-256, then update `version` + `sha256` + `upstreamArtifact` (`… -> package/dist/acorn.js`) in `provenance.json` together (these must match what `verify-vendor-upstream.mjs` fetches, or the authenticity anchor fails).
- `mapping-table.mjs` — the **shared mapping table** (ENG-95543): one row per recognised Classic thing, carrying its role, its tier (A automatic / B view built + behaviour stubbed / C typed decision), its Freedom `target`/`verify` types and its notes. It absorbed the four hand catalogs that used to live in `mapper.mjs` (`FEATURE_CATALOG`, `WIDGET_BY_MODULE`/`WIDGET_BY_CONTAINER`, `PROFILE_CARD_BY_ENTITY`, `KNOWN_ACTION_ITEMS`) **and** `designspec.mjs`'s `FEATURE_TYPE`, which was a second home for the same feature → `crt.*` mapping. Rows are frozen; the mapper and the design spec read the same rows.
- `mapping-registry.mjs` — registry validation of that table: every `componentType` exists, every `propMap` key is a real `input`, every `events` key a real `output`, **per platform version**. Also `resolveRunIndex` (which registry a RUN validates against: the stand's export via `manifest.componentRegistry`, a version pinned by `manifest.platformVersion`, or the vendored union) and `rankCandidates` for a tier-C decision.
- `registry/component-index.json` — the **generated** component index (205 components × 7 platform versions; version membership as a bitmask). Regenerate with `node scripts/build-registry-index.mjs --src <static-files checkout>`; it is data, never hand-edited, and excluded from Sonar for that reason.
- `mapper.mjs` — `mapToFreedom()` (effective page → Freedom ChangeSet + `needsDecision[]`).
- `designspec.mjs` — render the plan / design spec as Markdown.
- `migrate.mjs` — CLI driver.

## Tests & internals

Golden runners, fixtures and the detailed engine-internals notes live **outside** the shipped skill, in
`engine-tests/classic-to-freedom/` (see its `README.md` and `engine-internals.md`), so this folder ships
runtime-only.
