# 04 — Building one page (the unit of work)

One unit = one page. The builder that owns it gets a fresh context, so everything it needs is
named here or in the artifacts this file points at. It does not carry the previous page's
context, and it must not need to.

**This file does not restate the component mapping.** How to map a Classic construct to a
Freedom one lives in exactly one place — read it there:
`../../classic-to-freedom-migration/references/classic-to-freedom-mapping.md`.

| You are building | Read that file's section |
|---|---|
| Approvals, Attachments, Activities/Emails, Communication options, DCM, Run process, Print | *Standard features, widgets & actions* |
| a component agents habitually get wrong | *Build recipes for the components agents get wrong (verified on-stand)* |
| an embedded profile card of a linked record | *Embedded profile cards (linked-record blocks) → the Freedom side profile* |
| picking the form template from Classic signals | *Template Mapping* |
| a control type from a column type | *Control Mapping* |
| a declarative rule vs an imperative handler | *Distinguish declarative business rules from imperative logic* |

## The unit's inputs

| Input | Where it comes from |
|---|---|
| the design spec for THIS page | `refs/spec-<name>-<n>.md`, pre-cut for this key by the run (`--spec --page <key>`) and carrying the plan's `Adjustments` list in full. A page the engine did not fold has no slice — work from its row under `### Child page mappings` / `### Typed page mappings` / `### Add mini-page mapping` in the approved plan. |
| the acceptance criteria | `--checklist --page <key>` — THIS page's rows only. A SUB-page's group titles are prefixed with its page key (`child:Education · Form — Coverage`); **`main`'s groups carry no prefix at all**, so for `main` the rows are exactly the unprefixed groups |
| the expected element NAMES | `slices/queue-<n>.json` → `page.expect.fieldNames` — the fields row matches by element NAME, so build each element under the name this array gives |
| the expected template schema | `slices/queue-<n>.json` → `page.expectedTemplate` (omitted ⇒ no template row is gated for this page) |
| the target package | `slices/queue-<n>.json` → `page.targetPackage` (`null` ⇒ no placement row for this page) |
| the counts to satisfy | `slices/queue-<n>.json` → `page.expect` — `fields`, `tabs`, `details`, `images` |
| what the verifier last saw, and how the judge ruled | `slices/built-<n>.json` → this page's `pages` entry, plus the `evidence` records and `judge` verdicts for THIS page's ids and no other's |

**Every row above names the file this unit is HANDED** — `<n>` is this page's position in the queue, and the run
gives you the exact path. Before you build from a slice, check TWO fields in it: `pageKey` must be your own key,
and `planVersion` must be the same string in both slices. The first says the file is the right page, the second
that it is the right round. Either one wrong is a `blocked` report. Read that file. Do not open the whole build queue or
the whole built file, and do not cut a row out of one with `grep` / `jq` / `sed` / python: the slice is the same
bytes, and a hand-cut row is how a build agent reads another page's. A slice that is missing is reported in
`blocked`, not worked around.

`page.expect.fieldNames` is the single most load-bearing input. Each name is the **bound column name**
— but when several Classic items bind the SAME column the engine emits `col`, `col_2`, `col_3`,
because the element name, not the column, is the distinct identity it matches on. Copy the array;
do not re-derive names from the columns, or the suffixed duplicates match nothing and the row
reports each missing name individually.

**The Freedom schema name is yours to report.** `--units` publishes the Classic SOURCE schema
(`null` for `main` and for an unfolded child), so nothing else in the run knows which page a key
names. Return `schemaName` — the Freedom schema this key resolves to — whether you created the page
or found it already on the stand. It is persisted in the queue file under `units["<key>"].schemaName`
and is the only thing that lets the verifier `get-page` your work, in this session or a later one.
Omit it and the unit is stuck at "cannot verify, unknown schema".

## Resolving a page key to an already-existing Freedom schema

Half the time the page is already there — the plan's target was created in an earlier session, or the
stand shipped with it. A key is a ROLE (`main`, `child:Education`), never a schema name, so the mapping
has to be looked up. **`list-pages` is the tool.** It takes a package or an app code and returns, per
page, `schema-name` + `packageName` + `parentSchemaName`. Run it once, keep the list, and match against
what this unit's queue slice already told you about this key:

1. **Run `list-pages` for the target package first** (`slices/queue-<n>.json` → `page.targetPackage`), then for the
   application code if that returns nothing useful. This is a read; it changes nothing.
2. **Filter by `parentSchemaName` against `expectedTemplate`.** The template a key expects is published,
   and a page on a different template is a different deliverable — that is exactly what the `template`
   row gates.
3. **Filter by `packageName` against `targetPackage`.** A same-named page in another package is not your
   page; building into it is the "shipped nothing to the customer's app" failure the placement row exists
   to catch.
4. **Confirm with `get-page`** on the surviving candidate before you touch it: the entity it binds and
   the components it carries must match the plan's block for this key.

Then, exactly two outcomes are irregular, and neither is a judgement call:

- **No match.** The page does not exist yet: create it (step 1 of "Order inside the page" below,
  including the re-bind), and report the schema name you created as `schemaName`. "Nothing matched" is
  never a reason to guess a name, and never a reason to report the unit done.
- **Several matches survive all four steps.** Do NOT pick one. Say so in `blocked[]`, naming every
  candidate with its `packageName` and `parentSchemaName`, and report no `schemaName`. The unit stays
  open as "cannot verify, unknown schema" — which is honest — and the caller disambiguates. Silently
  choosing one and building into it is how a run rewrites a page nobody meant to touch.

A name you guessed matches nothing downstream: `get-page` fails or, worse, succeeds on the wrong page and
the verifier files that page's contents as this unit's evidence.

## Order inside the page

1. **Create the page on the right template** — `expectedTemplate`, confirmed against
   `list-page-templates`. Scaffolding tools register a DEFAULT page; when the template differs
   you create a new page and **re-bind the object to it, dropping the old binding**. A page built
   but not re-bound is not migrated: the object keeps opening the old default and your page is an
   orphan.
2. **Invoke `creatio-ui-guidelines` BEFORE authoring the body.** Not after. The layout defects it
   catches (lone-field islands, selection-window lookups, Title-case captions, colSpan/gap
   mistakes, missing tooltips) are cheap to avoid and expensive to retrofit.
3. **Layout** — every island the plan shows is its own container; every tab and group exists.
   Collapsing them is a proposal, never a silent change.
4. **Fields**, named to match `expect.fieldNames`. A field whose column is not on the entity
   (loaded by an on-change handler from a linked record) is a read-only field on a view-model
   attribute plus its handler — not a dropped field.
5. **Related lists and standard features**, each in its native shape. Both halves of a two-part
   component: Approvals is the approval MODULE above the profile island **and** `crt.ApprovalList`;
   DCM is the progress bar in `MainContainer` **and** the Next steps tab.
6. **Business rules**, then handlers/converters/validators for the imperative rows. Port every
   imperative row against the **acceptance criteria on its card** in step 5.1's `customizations.md`
   (the `behaviourIndex` maps the row to its card); both are handed to the run as inputs. Never port
   from a method NAME — that is the trap the migration skill's list calls "imperative logic left as
   review". A row whose card you cannot find is a `blocked[]` entry, not a guess. Cite criteria
   card-qualified everywhere outside their own card — `shared/C04·AC-16`, never a bare `AC-16` —
   numbering restarts per card, so a bare number in a code comment or worklog is ambiguous.
7. **Localizable bindings** for every user-visible string. `$Resources.Strings.<key>` normally;
   a tab / card-toggle-panel caption needs `#ResourceString(<Key>)#` instead — a
   `$Resources.Strings.*` caption there does not render.
8. **Render check.** A `success` from `validate-page` / `update-page` is not proof the page works;
   clio returns `success` for bodies that fail at runtime. Open it, or run a runtime render check,
   **before** anything depends on it.
9. **Run the `creatio-ui-guidelines` review** as a done-gate, tool-based: open a shipped reference
   page on the same template, run `get-component-info` on each component you added, diff the
   concrete props. Then return `guidelines` — **required, and this unit does not close without it**
   (`./01-evidence-records.md` for the record it becomes).
10. **Append to the worklog and update the roadmap** — as part of closing THIS unit, not as a step
    at the end of the run. An interrupted run must not lose the history of what was built.

## Tool safety — always the narrowest operation that does the job

- **Read through the shell CLI, by default.** Exactly these five reads go through
  `clio <command> -e <env>`: `get-page`, `list-pages`, `list-app-sections`, `get-schema`,
  `get-related-page-addon`. All five take identifier-shaped arguments, which is what makes routing
  them to a command line bounded. **SQL and OData reads stay on MCP**, where the query travels as a
  JSON field — composing free-form query text into a shell command line would make an execution sink
  out of text the RULES preamble classifies as untrusted.
  Everything else is unchanged: resident tools (`resident=true` in the `get-tool-contract` index —
  `get-guidance` and `get-tool-contract` among them) are called NATIVELY by their own tool name and
  never wrapped in `clio-run`; non-resident tools and writes go through `clio-run` as always, and
  writes have no CLI escape at all — an MCP write that fails is parked as an environment fault
  (`./03-failure-and-park-policy.md`), never re-issued over the shell.
  Measured: the same `get-page` is 2.3 s on the CLI and 90 s
  (11 timeouts) through `clio-run`. The two take DIFFERENT argument shapes — `get-tool-contract`
  documents the MCP one, `clio help <command>` the CLI one — so read the right source before
  invoking, and never hand-roll an MCP client to work around a slow call
  (`./03-failure-and-park-policy.md`).
- `create-page` **only** when the page does not exist; otherwise `get-page` first, then
  `update-page`. `validate-page` before saving.
- Use the business-rule creators for supported rules rather than writing rule JSON by hand.
- `update-client-unit-schema` is for non-page schemas, or when a raw update is genuinely
  required — never as a shortcut around the page tools.
- **Compile only** when C# / SQL / runtime-compiled artifacts changed, or Creatio reports a
  missing runtime schema. A compile is not a way to make a page load.
- Anything that cannot be built now is a loud `TODO` / `BLOCKED` in the worklog with its reason,
  and it goes in the builder's `blocked[]`. A page that migrated fields and rules but dropped its
  details, its standard features or their edit pages is not done — silence is the one report that
  is never acceptable.

## Leaf-first, and why

`--units.buildOrder` is authoritative and post-order: a page's sub-pages come before it, `main`
last. A related list's Add/Edit opens the child's own form, so the child form must exist before
the parent's related list can be wired to it. Building a parent first means coming back to
re-bind, and the re-bind is what gets skipped.

## What the builder must NOT do

- **Not write the evidence record.** The builder declares what it built in its structured return;
  a separate read-only verifier fetches the page and files `pages` / `reachability` / `evidence`.
  A builder filing its own evidence is grading its own work.
- **Not run `--verify`.** Its report is the machine table, produced from a payload it did not
  write.
- **Not touch another unit's page.** The stand is a shared mutable resource; units run one at a
  time for that reason, and a builder that "fixes something small" on a neighbouring page makes
  the neighbour's next verify unattributable.
- **Not simplify the plan.** Record a proposal and build what the plan says.

## The builder's return

Structured, and it is a CLAIM, not evidence:

```json
{ "unit": "child:VisaRequest",
  "schemaName": "UsrVisaRequestPage",
  "packageName": "UsrHrApp",
  "template": "PageWithAreaFreedomTemplate",
  "claimedBuilt": ["crt.ApprovalList", "crt.DataGrid", "crt.Input …"],
  "reboundFrom": "UsrVisaRequestPage_default",
  "guidelines": {
    "evidenceId": "child:VisaRequest#quality-gates",
    "ran": true,
    "referencePage": "AccountPage",
    "componentsDiffed": ["crt.ExpansionPanel", "crt.Input"] },
  "blocked": [],
  "proposals": [] }
```

`claimedBuilt` is the field name the schema requires, and the name says what it is: a claim. For a
**page** unit the required fields are `unit`, `claimedBuilt`, `schemaName` **and `guidelines`** — the
return schema enforces all four, because a page unit without a schema name can never be verified by
anyone, and one without `guidelines` closes on silence. For a **reachability** unit
(`sectionRegistered`, `miniPageWired`, …) there is no page and no schema, so only `unit` and
`claimedBuilt` are required.

`guidelines` is step 9's answer, and the verifier files the `#quality-gates` record from it verbatim:

- `evidenceId` — your page's id, **copied from `--units.evidenceRows`**. Never composed from your page
  key: an id nothing published matches no row and reads as silence.
- `ran: true` — then `referencePage` (the shipped page you diffed) and `componentsDiffed` (the ones you
  prop-diffed) are both required. `componentsDiffed` is **not** `claimedBuilt`: built is not diffed.
- `ran: false` — then `notRunWhy`. This is a valid ANSWER, not a pass: the record is filed as `false`,
  which is a hard `❌ MISSING`, and your unit stays open. Report it honestly anyway — a `false` says
  "checked, not done" and routes a different repair than silence does.

An omitted or half-filled `guidelines` is neither. Nothing downstream can file the record for you, and
a reference page you did not open is the one failure this field exists to prevent.

**A page key that publishes no `#quality-gates` id owes no record** — an unfolded or reuse child page.
The field is not required of it, and the obligation above is not in its prompt.

The verifier reads the stand and files what it actually finds. Where the two disagree, the
disagreement is logged — a builder that claims a component the page does not carry is a signal
worth keeping, not a discrepancy to smooth over.
