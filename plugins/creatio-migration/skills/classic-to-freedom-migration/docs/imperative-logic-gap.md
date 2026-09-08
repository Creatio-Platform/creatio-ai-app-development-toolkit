# Gap analysis: imperative logic (`methods` / `attributes`) in the migration skill

Maintainer note, not agent instructions — nothing in the skill's routing table points here, and
this file does not change skill behaviour.

Written 2026-08-04. Scope of the reading: `skills/classic-to-freedom-migration/SKILL.md`, all four
engine files (`engine.mjs`, `mapper.mjs`, `designspec.mjs`, `migrate.mjs`) and
`references/classic-to-freedom-mapping.md`. Question asked: which Classic behaviour does the skill
pass over, specifically the behaviour that lives inside `methods`.

> **Status: the findings below were fixed in the same change that added this file.** The analysis
> is kept because it is the rationale for the `coverage` gate and the `⚠ Imperative logic`
> worklist — a future reader needs to know what those exist to prevent, and the "Demonstrated"
> section is the before-state measurement. **Every `file:line` reference points at the code as it
> was BEFORE the fix**; see "What was implemented" at the end for the after-state.

Verified claims only — every statement below carries its `file:line`, and the central ones were
confirmed by an actual engine run (see "Demonstrated, not only read").

References to the sibling **`classic-ui-expert`** skill (its `docs/overlap-with-migration-skill.md`,
`references/03-member-ledger.md`, `references/04-units.md`) are by NAME, never by path — a
cross-skill file reference would add an install-layout coupling no test guards. That skill is being
added under **ENG-94529** and may not be in the tree yet; the references stand either way.

## The headline: imperative logic is the one category with neither a gate nor a worklist entry

The skill's whole reliability model is: the engine blocks the plan until the agent supplies the
input, and whatever the engine cannot decide lands in the `⚠ Confirm before I build` list that
Contract rule 7 forces the agent to resolve (`SKILL.md:20`).

Every structural category is wired into that model. Imperative logic is wired into neither half.

| Category | Blocking gate | Reaches `⚠ Confirm` |
|---|---|---|
| Parent-template `seed` | yes — `SKILL.md:133`, `engine.mjs:840-849` | n/a (gate) |
| `detailSchemas` | yes — `SKILL.md:139`, `SKILL.md:151` | n/a (gate) |
| `childPageSchemas` | yes — `SKILL.md:144-145` | via `detail-editpage` in the child table |
| `typedPages` / `typedPageSchemas` | yes — `SKILL.md:143` | n/a (gate) |
| `addRecordMiniPage` / `miniPageSchemas` | yes — `SKILL.md:141` | n/a (gate) |
| `signals` (every key in `SIGNAL_KEYS`) | yes — `SKILL.md` "on-stand signals", `migrate.mjs` `SIGNAL_KEYS` / `signalUnresolved` | rendered under `### On-stand signals` |
| `planMeta` | yes — `migrate.mjs` `REQUIRED_PLANMETA` | n/a (gate) |
| **`methods` (imperative logic)** | **no** | **no** — excluded at `designspec.mjs:382` |
| **`attributes`** | **no** | **no** — never reaches the effective model at all |
| **`messages` / `mixins`** | **no** | **no** — not modelled anywhere |

Two consequences follow, and they are the substance of this document.

### 1. Not one Classic method ever appears in the `⚠ Confirm` list

`mapper.mjs:890-891` emits one `needsDecision` per payload method:

```js
for (const m of payloadMethods)
  needsDecision.push({ kind: "method", item: m.name, reason: "imperative logic — implement as Freedom handler or set-values rule; review" });
```

`designspec.mjs:382` then filters that kind straight out of the worklist:

```js
const SHOWN_ELSEWHERE = new Set(["process-launch", "standard-feature", "widget", "card-action", "method", "detail-editpage"]);
```

`needsDecision` has exactly two consumers in the whole rendering layer — `designspec.mjs:291`
(picks out `process-launch` for a Logic row) and `designspec.mjs:383` (the filtered `⚠` list).
`renderPlan` does not read it independently, so the exclusion is absolute: there is no second path
by which a `method` decision can reach the agent's worklist.

The stated rationale (`designspec.mjs:379-381`) is that a `method` is "shown elsewhere" — in the
Logic table. It is, as a row reading `imperative (<category>) — review`
(`designspec.mjs:284`). But the two artifacts are not interchangeable in how the skill uses them:

- Contract rule 7 is scoped to the `⚠` list: "**Every `⚠` Confirm item is RESOLVED before you
  build**" (`SKILL.md:20`). A Logic row is not a `⚠` item, so rule 7 never reaches it.
- Contract rule 5 is scoped the same way: the agent's job is to "resolve its `needsDecision[]` /
  `⚠` worklist" (`SKILL.md:18`).
- Step 8's Plan-vs-Done table enumerates "each ⚠ Confirm item" (`SKILL.md:211`) — so a method
  never gets a Plan-vs-Done row either, and dropped imperative logic does not show up as
  `Not done`.

Net effect: the only per-method obligation the agent actually carries is a table row whose Effect
column already says "review", with no name resolved, no trigger traced, and no gate that notices
if it was never looked at. `SKILL.md:153` and `classic-to-freedom-mapping.md:209` both demand that
every Classic method affecting user-visible behaviour be marked mapped / dropped / blocked;
nothing in the pipeline produces or checks that marking.

Also relevant to how much the skill can enforce: `migrate.mjs:531-539` builds the JSON `effective`
block from ten keys, and `methods` is not one of them. Methods survive only inside
`changeSet.handlerStubs` / `changeSet.needsDecision` and as a `decisionSummary.method` count
(`migrate.mjs:437-438`) — so a reader of the JSON sees *how many* methods exist, never which.

### 2. The `attributes` block never reaches the effective model

This is a full drop, not a downgrade:

1. `engine.mjs:18` parses it, keys only: `attributes: safeKeys(s.attributes)` (`safeKeys` at
   `engine.mjs:515` returns `Object.keys`).
2. `mergeHierarchy` has no `mergeAttributes` counterpart to `mergeMethods` (`engine.mjs:749-753`),
   and its return object (`engine.mjs:851-880`) contains no `attributes` key.
3. `migrate.mjs` never references `attributes` — the identifier does not occur in the file.
4. The only `attributes` in `mapper.mjs` are *outputs*: the Freedom
   `viewModelConfigDiff` merge target (`mapper.mjs:317`) and a fresh object built from fields
   (`mapper.mjs:640`, `mapper.mjs:708`). Neither reads the Classic block.

So the per-schema attribute names are computed and then discarded between parse and merge. The
consequence is concrete because the mapping reference already assigns these constructs Freedom
targets:

- `classic-to-freedom-mapping.md:186` — Virtual attribute → view-model attribute / converter /
  handler-loaded value.
- `classic-to-freedom-mapping.md:187` — Lookup list config/filter → lookup attribute + business
  rule / filter handler.
- `classic-to-freedom-mapping.md:256-259` — imperative logic in `attributes`
  (`lookupListConfig.filters`, `dependencies`) → Freedom handlers / converters / virtual
  attributes, explicitly **not** business rules.

A `lookupListConfig.filters` filter and a declarative `businessRules` FILTRATION are the same
user-visible behaviour ("this lookup is filtered") reached two different ways. The declarative one
is mapped and gated (`mapper.mjs:961-972`); the imperative one produces nothing at all — no row,
no decision, no count. That is the exact failure `classic-to-freedom-mapping.md:261-262` says the
report must prevent ("so declarative rules are not silently converted into custom handlers (or
vice versa)") — with one side of the comparison missing, the check cannot be performed.

`attributes.dependencies` has the same shape of loss: a dependency declares "recompute Y when X
changes", which in Freedom is a handler or a converter. Nothing surfaces it.

### 3. `messages` and `mixins` are not modelled at all

`messages` (the sandbox publish/subscribe contract) and `mixins` (behaviour pulled in from a
separate schema) produce zero hits across `engine.mjs`, `mapper.mjs`, `designspec.mjs` and
`migrate.mjs` — neither parsed nor counted nor flagged. `classic-to-freedom-mapping.md:199` gives
sandbox messages a Freedom target ("handler-mediated communication, shared service, or explicit
event replacement design"), so this is a documented mapping with no producer.

Two practical shapes this loses:

- A mixin is where shared behaviour lives when the same customization is applied by both the
  section layer and the record-page layer. The sibling skill treats that as one multi-schema unit
  (the `classic-ui-expert` skill, `references/04-units.md` lines 25-26); the migration engine sees only the
  schema-local method names, so a mixin-implemented behaviour has no member at all in the page it
  affects.
- A message subscribed on the page with its publisher in a detail/module is a cross-surface wiring
  the page-schema unit cannot see. The engine has a precedent for surfacing exactly this class —
  `referenced-module` decisions for `define()` UI deps (`mapper.mjs:906-908`) — and messages get
  no equivalent.

## Demonstrated, not only read

A hand-written minimal manifest (one schema, `noParentTemplate: true`, two diff fields) whose body
carries `methods: { onFooChanged, setFooInfo, clearFooInfo, onProbeButtonClick }`,
`attributes: { Bar: { lookupListConfig: { filters: [...] }, dependencies: [...] } }`,
`messages: { ProbeMessage }` and `mixins: { ProbeMixin }`, run through
`node engine/migrate.mjs <manifest> --spec`:

- **Exit code 0. `gate.blocked: false`, `structure.complete: true`.** Both gates green — this is an
  approvable spec.
- **Logic table:** two rows — `onFooChanged` → `imperative (attribute-change) (+ setFooInfo,
  clearFooInfo) — review`, and `onProbeButtonClick` → `imperative (helper) — review`.
- **`⚠ Confirm before I build (2)`:** both items are `[container]` decisions about layout. **Zero
  method items**, matching the `SHOWN_ELSEWHERE` exclusion.
- **`decisionSummary: {"container":2,"method":4}`** — four method decisions exist in the JSON and
  none of them reach the list the agent is required to resolve.
- **`setFooInfo` / `clearFooInfo` have no rows of their own** — folded into the parenthetical, per
  `designspec.mjs:279-285`.
- **The strings `lookupListConfig`, `dependencies`, `ProbeMessage` and `ProbeMixin` do not occur
  anywhere in the full JSON output.** Not in the spec, not in the ChangeSet, not in
  `decisionSummary`. `Bar` appears only as a layout field, because it is also in the `diff`; its
  lookup filter is gone.
- **`effective` keys:** `fields, tabs, details, rules, removed, warnings, unresolvedParents,
  seedQuality, features, referencedModules` — confirming `migrate.mjs:531-539` carries neither
  `methods` nor `attributes`.
- `categorize()` assigned `clearFooInfo` → `helper` while `setFooInfo` → `set-values?`, on names
  alone, for two methods that are halves of the same behaviour.

So a page whose lookup is imperatively filtered, which publishes a sandbox message, which pulls
behaviour from a mixin, and which has four unreviewed methods, produces a **green, presentable,
approvable** design spec.

## Method-level accuracy problems in what *is* produced

### `categorize()` is name-substring guessing

`mapper.mjs:1052-1060` derives every handler stub's category from the method name:

```js
if (n.startsWith("on") && n.endsWith("changed")) return "attribute-change";
if (n.includes("init")) return "init";
if (n.includes("save")) return "save";
if (n.startsWith("validate")) return "validator?";
if (n.includes("esq") || n.includes("filter")) return "query/filter";
if (n.startsWith("set")) return "set-values?";
return "helper";
```

Three of seven outcomes carry a literal `?`, which is honest about the confidence. The categories
are also order-dependent on substrings, so a method named `initSaveFilters` categorizes as `init`
and a method named `setContactFromRequest` — which loads a value with an ESQ — categorizes as
`set-values?`. This is the "draft stubs, not behaviour units" already recorded at
the `classic-ui-expert` skill's `docs/overlap-with-migration-skill.md` (line 36); the code is
included here because it is the concrete instance.

### Companion-field helpers are folded out of the Logic table

`designspec.mjs:279-285` drops any `set<X>Info` / `clear<X>Info` row from the Logic table and
appends the names as a parenthetical on the matching `on<X>Change` row.

That is precisely the pattern Known Trap `SKILL.md:242` is about: fields loaded from a selected
lookup by an `on<Lookup>Change` / `set<Lookup>Info` handler must be built as read-only view-model
attributes, and dropping them is what leaves a one-field island. The trap is documented as prose
for the agent to remember, while the engine's rendering makes the helper *less* visible than an
ordinary method row. The `on<X>Change` row does remain, so this is a reduced-visibility issue, not
a full drop — but it works against the one Known Trap that names these methods.

### The extraction surface grows one hardcoded method name at a time

The engine does read method bodies — for five specific names, each via `extractFnBody`
(`engine.mjs:422-427`):

| Method | What is extracted | Where |
|---|---|---|
| `getActions` | navigate/goTo hints + action `Tag` values | `engine.mjs:28-35` |
| `getAddRecordMiniPage` | returned mini-page schema name | `engine.mjs:57-66` |
| `getSectionActions` | one item per menu entry — `{ name, caption, condition, icon, parent, order, group, package }`, helper-built items included (one hop) | `engine.mjs:894-1117` |
| `getGridDataColumns` / `initColumnsConfig` | list column paths | `engine.mjs:85-89` |
| `initFixedFiltersConfig` / `getFixedFiltersConfig` | quick-filter `{name, column, type}` | `engine.mjs:95-113` |

Plus two whole-body regex scans: `getIsFeatureEnabled('X')` feature names (`engine.mjs:22`) and
process-launch API detection (`engine.mjs:43-52`).

Each of these was added after a specific field failure — the comments say so (`engine.mjs:74-76`
"This is what the old Tag/navigate-only patterns missed … so real section actions were dropped";
`engine.mjs:92-94` "they were being dropped entirely (the whole registry filter bar vanished)").
The corresponding Known Traps are `SKILL.md:244` (registry filter bar / section actions) and
`SKILL.md:245` (mini page falsely reported "none").

The pattern predicts the next miss: any behaviour whose only trace is a method name outside those
five gets a generic `imperative — review` row that no gate and no Contract rule follows up on. The
un-extracted residue is currently carried as prose in Known Traps (`SKILL.md:242`), which is the
weakest enforcement layer the skill has.

## Why the current design is defensible, and what closing the gap would actually cost

The engine deliberately does not execute bodies. `engine.mjs:117-123` records the reason: the
previous implementation used `node:vm`, which is not a security boundary (a body can escape via
`define.constructor.constructor("return process")()`), and step 4 feeds bodies fetched from a live
customer stand. The replacement statically evaluates the returned object literal, with function
values collapsed to a placeholder — `AST_FN` at `engine.mjs:141`, returned for both
`FunctionExpression` and `ArrowFunctionExpression` at `engine.mjs:237-238`. Depth is capped
(`engine.mjs:138`) and the process-launch regex is explicitly bounded against ReDoS
(`engine.mjs:46-50`).

So "the engine does not read method bodies" is a security decision, not an oversight. Two facts
bound the cost of doing more:

- **No new clio call is needed.** `get-classic-page-sources` already writes every layer's whole
  body into the manifest's `schemas[].body` / `seed[].body` (`SKILL.md:125`, `SKILL.md:131`), and
  `parseSchema` already receives the full `src` — the five `extractFnBody` scans and both regex
  scans read it today. Anything added is engine-side extraction over data already on disk.
- **Static AST reading of a body is not the same as executing it.** The existing five extractions
  are regex-over-brace-matched-text, which is weaker than what acorn already parses. The AST for
  every method body is available at parse time and is currently discarded at `engine.mjs:238`.

## Already documented vs. new in this reading

Recorded before this analysis, in the `classic-ui-expert` skill's
`docs/overlap-with-migration-skill.md`:

- engine method "categories" are draft stubs, not behaviour units (line 36);
- member-level accounting ("no member silently ignored") does not exist in the engine, and that
  skill's `references/03-member-ledger.md` is named as its spec (line 35);
- the engine flags `define()` UI modules "port manually" where the sibling skill reads them
  (line 37).

Not documented anywhere before this file:

- `methods` are structurally excluded from `⚠ Confirm` (`designspec.mjs:382`), so Contract
  rules 5/7 and the step-8 Plan-vs-Done table never reach a single method — **the headline**;
- the `attributes` block is parsed and then dropped before the effective model
  (`engine.mjs:18` → `engine.mjs:851-880`), leaving `lookupListConfig.filters` and `dependencies`
  with documented Freedom targets and no producer;
- `messages` / `mixins` are absent from all four engine files;
- `designspec.mjs:279-285` reduces the visibility of exactly the `set<X>Info` helpers that Known
  Trap `SKILL.md:242` warns about.

## What was implemented

All of the above, in one change. The parser still **never executes a schema body** — every new fact
comes from the AST acorn already built, which the code previously discarded at the `AST_FN`
placeholder.

**Capture (`engine.mjs`).** `attributes` now reaches the effective page with its VALUES
(`lookupListConfig.filters` / `.columns`, `dependencies`, `value`, `dataValueType`, `isRequired`,
`caption`, collection and reference-schema flags), and `messages`, `mixins` and the full `define()`
dependency list are read for the first time. Each gets an override stack with `schemaTouched`,
mirroring `mergeMethods`, so a client override of a base member is payload rather than context.
Message `mode`/`direction` resolve to their symbolic names (`PTP`, `PUBLISH`) through a new
symbolic terminal in the existing enum automaton — no numeric constants are asserted.

**Method evidence (`engine.mjs`).** Every method carries its 1-based line span plus what its body
does: the framework calls it makes (classified into `esq`, `filter-build`, `service`,
`process-launch`, `publish`/`subscribe`, `validator`, `dialog`, `lookup`, `sys-setting`, `refresh`,
`save`, `feature-toggle`, `mixin-call`, `callParent`), the attributes it reads and writes, the
messages it moves, whether it is a passthrough override, and — new — whether it is *assigned from
another module* (`x: VisaHelper.Method`), which names where the behaviour actually lives instead of
showing an empty body. The walk is iterative with a node budget and depth cap, and reports
`truncated` rather than half-analysing a hostile body.

**Triggers from data, not names.** A method's trigger is resolved from
`attributes.<Col>.dependencies[].methodName` and from diff-item handler bindings
(`click: {bindTo:"onX"}`), never inferred from the method's name. Unresolved is reported as
`⚠ unresolved`, which is the honest answer `04-units.md` demands.

**Decisions (`mapper.mjs`).** New kinds: `attribute-lookup-filter` (the imperative twin of a
FILTRATION rule), `attribute-dependency`, `attribute-imperative`, `attribute-virtual` (page UI
state with no entity column behind it — the largest silent drop after the methods themselves),
`message`, `mixin`, `module-dep` (aggregated). `categorize()` classifies from body
evidence alone; a body it cannot classify is reported as unclassified rather than guessed from its name.

**The `coverage` gate (`migrate.mjs`).** `buildCoverage()` builds the member ledger — every `diff`
op, method, attribute, message, mixin, dependency and details entry gets a disposition (`mapped` /
`decision` / `resolved` / `context` / `unaccounted`), with counted zeros for kinds that have no
members. An `unaccounted` member blocks the plan (`⛔` banner, exit 2) exactly like `structure`.
The agent closes a member the engine can only flag by recording
`manifest.memberDispositions["<name>"] = { resolved: true, disposition: …, note: … }`. The `mapped`
evidence comes from the mapper's own `accountedFor` set rather than being re-derived, because
re-deriving it made the gate flag elements that ARE mapped — a gate that cries wolf teaches the
reader to ignore it.

Three ways the new gate could have silently PASSED a real gap, all closed and each with its own
test (hardening it against false positives is only half the job):

1. **A decision's comma list leaking onto unrelated members.** The split that lets one aggregated
   `module-dep` decision cover every module it names ran on every decision — and
   `attribute-dependency` items read `"Amount ← Quantity, Price"`, so a bare `Price` was marked
   decided. Splitting is now restricted to the one deliberately aggregated kind.
2. **Name collisions across kinds.** Members are keyed `<kind>:<name>`, because a Classic diff item
   is usually named for the column it binds — one bare-name disposition cleared both
   `attribute:Amount` and `diff-op:Amount`.
3. **Sub-page gaps never reaching the parent.** `gate` and `structure` both aggregate the page tree;
   coverage did not, so a `Rebuild (child)` page with entirely unaccounted members produced a parent
   run at `complete: true` and exit 0. Child, typed and mini pages now carry their ledger up.

**Rendering (`designspec.mjs`).** A `#### ⚠ Imperative logic` worklist (one row per method: source
span, trigger, what the body does, reads → writes, proposed Freedom target) and a
`#### Member ledger` section. `SKILL.md` Contract rule 3 now names three gates, rule 7 defines the
`⚠` worklist as **both** lists, and step 8's Plan-vs-Done requires a row per imperative-logic entry
and per non-`mapped` member. The `set<X>Info` fold stays in the Logic table (readability) and is
absent from the worklist (completeness) — the golden test that conflated the two is now scoped to
the Logic table, with a companion asserting every method appears in the worklist.

**Measured after.** On the 6-layer Contract fixture: 121 → 126 members, all accounted for (46
mapped, 74 decisions, 6 context, 0 unaccounted); 18 attributes, 4 messages, 3 mixins and 14
dependencies that previously produced nothing; 41 methods on a binding worklist, 9 with a trigger
resolved from data, 37 of 41 with body evidence. Test suite 393 → 426 checks, all green. Two real
bugs were caught by the new tests: `new Terrasoft.EntitySchemaQuery(…)` is a `NewExpression`, so
the commonest data-access idiom was invisible to the walker; and filter construction, system-setting
reads and data refreshes were being reported as "no call recognised".

**Deliberately NOT done: line-level coverage.** A gate over statement-bearing lines was considered
and dropped. It needs a hand-tuned exclusion list for wrapper lines, `return {`, closing braces and
comments, every exclusion is a judgment call the gate would then enforce as fact, and it blocks on
formatting. The member ledger is the completeness proof `03-member-ledger.md` specifies, and
member-level accounting already answers "is any logic missed"; line-level accounting would add a
precision the engine cannot defend.

**Left for `classic-ui-expert`.** The engine can now enumerate and evidence every member, but it
cannot say what a behaviour *is* when the trigger is unresolved, the message counterpart is in
another schema, or the logic lives in a mixin. Step 5 of `SKILL.md` routes those rows to that skill
(by name — no cross-skill file references).

*Updated 2026-08-05:* that skill now exists in the toolkit, so the hand-off is no longer prose with
a "until it is available, read it yourself" fallback — `SKILL.md` step **5.1** mandates a
`classic-ui-expert` **sub-agent run at plan time** whenever any of the four unanswerable row types is
present (`handlerStubs[].triggers` empty · `handlerStubs[].externalRef` · a `message` decision · a
`mixin` decision), one invocation per surface, its report written to the migration folder and indexed
into the plan's `Adjustments` list. Two boundaries the wiring deliberately keeps: the cards feed the
`⚠ Imperative logic` *ported / dropped / blocked* marking, **not** `manifest.memberDispositions`
(which stays scoped to `unaccounted` members); and the sub-agent is never asked for a Freedom target,
because its own contract forbids target-platform advice.
