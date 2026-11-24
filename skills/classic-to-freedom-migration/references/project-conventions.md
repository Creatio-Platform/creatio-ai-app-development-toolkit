# Project conventions (step 4.2)

A customer team names its custom requests in its own namespace (`ab.`, not `usr.`), keeps shared logic in
helper modules and keeps the ids of existing records (statuses, types) in constants modules. A migration that
ignores this produces pages that work and still do not belong to the project: `usr.` requests beside the team's
`ab.` ones, a helper re-implemented inline, record ids pasted as raw GUIDs. Record the conventions as facts in
`manifest.projectConventions`; the engine gates `--plan` on them exactly like `placement`, prints them in the
plan's `### Project conventions` section, copies them into every build and fix task file and checks them in
`--verify`.

**They override the generic guidance.** Where a guide says custom requests "MUST" be `usr.`, the project's
recorded prefix wins; `usr.` is the default only for a project that has no namespace of its own.

## 1. Detect the request prefix — read-only, first hit wins

Read only the target package and its **direct** customer-package dependencies (not `Crt*` / platform packages):
`get-page` per page is slow on a big package, and a namespace two dependencies away is not this team's.

1. **Existing Freedom pages.** For each Freedom page of those packages (`list-pages`), `get-page` and read
   `ownBodySummary.handlerRequests`. Every name outside `crt.` counts for its namespace (the part before the
   first dot). The majority namespace is the prefix; `source: "freedom-pages"`, evidence names the count and
   the page (`"ab. — 7 requests on Page_OrderDelivery"`).
2. **The team's schema name prefix.** No custom request found: the prefix the team's own schemas carry in those
   packages (`Ab*` → `ab`); `source: "schema-prefix"`.
3. **The `SchemaNamePrefix` system setting**, lower-cased (`get-sys-setting SchemaNamePrefix`, `Usr` → `usr`);
   `source: "sys-setting"`.
4. **Fallback** `usr`; `source: "fallback"`. A verified fallback is a valid answer — say in `evidence` what you
   checked (`"no custom requests in the target packages; SchemaNamePrefix = Usr"`).

Validators and converters take the same prefix unless those pages register them under another one
(`validatorPrefix` / `converterPrefix`).

**A conflict is the only case that asks the user a separate question:** step 1 finds more than one custom
namespace, or step 1 disagrees with step 2. Record the counts in `conflict` (`{ "ab": 7, "usr": 2 }`); the plan
prints one question with them and stays ⛔ until you record the user's answer as `confirmedBy: "user"`.
Otherwise the conventions are approved with the plan (`confirmedBy: "plan"`).

## 2. Find the modules

- **Helper modules** — the SCHEMA_DEPS of the existing Freedom pages read in 1.1 (the `define(…, [deps], …)`
  list of the page body `get-page` returns), plus the Classic page's own non-platform `define()` dependencies.
- Read each candidate with `get-client-unit-schema --schema-name <Module>` and classify it from its body: a
  module that returns ids and literal values is a **constants module**; one that returns functions is a
  **helper module**. Platform and utility modules (`BusinessRuleModule`, `ConfigurationEnums`, `css!…`) are
  neither — leave them out.
- Put every constants module's body under `manifest.constantsModules` (`{ "<Name>": { "body": "<source>" } }`).
  The engine reads them (nothing is executed), maps every record id the plan uses to its `Module.Path`, and
  lists all candidates when two modules hold the same id. A declared constants module without a body blocks
  `--plan`.

## 3. Compare with an earlier migration

Detect again on every run — there is no shared project file. When the project's migration folder has an
earlier migration, read the `### Project conventions` table of the newest earlier `plan.md` and record it as
`previous`, copying all three prefix rows (request, validator, converter) and both module lists. The plan shows both; it asks only when they differ, and stays ⛔ until the user chooses
(`confirmedBy: "user"`).

## 4. Record it

```json
"projectConventions": {
  "resolved": true,
  "requestPrefix": "ab",
  "helperModules": ["AbClientHelperModule"],
  "constantsModules": ["AbConstants"],
  "source": "freedom-pages",
  "evidence": "ab. — 7 requests on Page_OrderDelivery",
  "confirmedBy": "plan",
  "previous": { "folder": "<earlier migration folder>", "requestPrefix": "ab",
                "validatorPrefix": "ab", "converterPrefix": "ab",
                "helperModules": ["AbClientHelperModule"], "constantsModules": ["AbConstants"] }
},
"constantsModules": { "AbConstants": { "body": "<define(...) source>" } }
```

`validatorPrefix`, `converterPrefix`, `conflict` and `previous` are optional. A prefix is a bare namespace
(`ab`, not `ab.X`); `crt` is the platform's and is refused.

## What the engine does with it

- The engine names every request it emits in `requestPrefix` (a button's or menu item's `clicked`).
- The plan's `### Project conventions` section shows the values, the evidence and the record-id table, and is
  approved with the plan.
- Every build and fix task file carries a `## Project conventions` block before its deliverables: use the
  prefix, reuse the helpers, reference record ids through the constants modules. Freedom pages CAN import
  client-unit modules — list the module in SCHEMA_DEPS and take it as a factory argument.
- A declared helper or constants module the Classic page imported gets its own checked row: `--verify` closes
  it when the built page's SCHEMA_DEPS (`bundle.deps`) list it, or a decision (`--decide D<N>`) says why the page
  does not need it. A declared module the Classic page did not import gets an informational row on the form
  page, also when the Classic page has no other define() dependency.
- `--verify` reads the built page's `handlers`, `validators` and `converters`: a custom name the page declares
  (a handler entry's `request`, a validator or converter key) outside the confirmed namespace keeps the page
  from COMPLETE until it is renamed or a decision accepts it. A request a handler only dispatches is not read.
- Record the block on the root manifest only: a child bundle's own block is ignored and blocks the plan.
