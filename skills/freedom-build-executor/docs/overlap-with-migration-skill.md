# Overlap analysis: freedom-build-executor vs classic-to-freedom-migration

Maintainer note, not agent instructions — nothing in the skill's routing table points here.
Written 2026-08-07, when this skill was added (ENG-94975). The comparison universe is the
migration skill (prose + `../../classic-to-freedom-migration/engine/`), `classic-ui-expert`, and `creatio-ui-guidelines`.

## The design split

The migration skill closed the PLAN side with three machine gates — `gate` (correctness),
`structure` (input completeness), `coverage` (member completeness) — and the plan itself is
engine-written. The BUILD side was prose: one step-7 agent resolving the whole `⚠` worklist,
building the page tree leaf-first, invoking `creatio-ui-guidelines` twice per page, re-binding
pages, routing per type, wiring the mini page, porting every method, and keeping the doc set
current. Hundreds of steps in one context, with the only gate at the very end.

So the boundary is by PHASE, not by subject matter:

- **The migration skill owns steps 0–6**: scope, discovery, package placement, the engine fold,
  the Freedom mapping, the behaviour analysis (step 5.1), the doc set, and the plan it presents
  for approval. It owns the manifest and it owns `../../classic-to-freedom-migration/engine/`.
- **This skill owns step 7 onward**: from an approved plan to a green `--verify`. It never
  changes the plan. A plan-level gap is returned to the caller, not built around.

Both skills call the same engine binary. Only one of them may change it: the engine lives in
`../../classic-to-freedom-migration/engine/`, and this skill is a CONSUMER of `--units`,
`--checklist` and `--verify`. A change to those three surfaces is a change to this skill's
contract and must be made with it in view.

## What is deliberately NOT duplicated

| Subject | Owner | This skill does |
|---|---|---|
| how a Classic construct maps to a Freedom one | `../../classic-to-freedom-migration/references/classic-to-freedom-mapping.md` | points into it by section name (`../references/04-per-page-build-recipe.md`) |
| the plan format and what `--plan` renders | migration skill | never renders or edits a plan |
| the doc set, status vocabulary, Definition of Done | `../../classic-to-freedom-migration/references/migration-documentation.md` | writes into that doc set as part of closing each unit |
| how to lay out a Freedom page | `../../creatio-ui-guidelines/SKILL.md` | makes invoking it a gated deliverable, twice per page |
| what a Classic method actually DOES | `../../classic-ui-expert/SKILL.md` (via step 5.1, at plan time) | ports against the card's acceptance criteria, never from a method name |

The one thing this skill states that the migration skill also states is the **build order**
(leaf-first) and the **re-bind obligation**. Both are enforced by the engine (`--units.buildOrder`,
the `placement` and `template` rows), so the two prose statements are descriptions of one gate
rather than two independent rules that can drift into disagreement.

## The consumer edge — WIRED

The migration skill's **step 7** is now a delegation step (`### 7. Implement The Approved Plan —
DELEGATE The Build`). It names this skill by path, hands over the manifest path, the approved plan
file and version, the environment, the migration folder, the resolved path to `../../classic-to-freedom-migration/engine/migrate.mjs`
(every phase of the build runs it, and a workflow script cannot go looking for a file) and the
step-5.1 behaviour artifacts (`customizations.md` + `behaviourIndex`, which reach the build agents
as the source an imperative row is ported from), and offers the same three routes as this skill's
"How to run it" — Workflow, Agent, inline Skill — in the same preference order. Its build prose was not
copied here; it was deleted there, and the second-person build obligations that used to sit in the
PLANNING step (complex-component shapes, the template choice, the re-bind, the `--spec`
generation) were re-pointed rather than duplicated: what the plan side still owes is a NAMED
template per page and a generated spec, and the build side owns everything that touches the stand.

Three things the rewire settled, and that must move together with this file if they change again:

- **The approval home is `decisions.md` at BOTH scopes.** The migration skill's documentation
  standard used to forbid `decisions.md` at single-section scope while still requiring the
  approval to be recorded there — so this skill's Contract rule 1, a script hard-stop, had nothing
  to read at exactly the scope where a delegated build is most likely. `decisions.md` is now
  required at both scopes, the approval entry names the plan VERSION, and `worklog.md` is a
  fallback for pre-existing folders only.
- **The relay clause.** "The `--verify` table is the ONLY sanctioned completion report" would have
  forbidden the planner from passing on this skill's output. It now reads: this skill produces the
  table, the planner presents it unchanged, and NEITHER hand-authors a status table. Parked units,
  plan-level gaps and proposals are not in the table, so the planner surfaces them alongside it.
- **The gates stay on this side.** Step 8 says the executor runs `--checklist` and `--verify`
  (both need the manifest) and that the temp manifest directory is deleted only after the LAST
  verify — by the caller, never by this skill.

## Drift-watch list

Facts stated here and elsewhere. A correction in one place must reach the other:

1. The `--built` payload shape (keyed by page, `viewConfig` from `bundle` verbatim, `false` vs an
   omitted key) — here in `../references/02-queue-and-built-files.md`; `migrate.mjs`'s
   `BUILT_SHAPE` const and its header comment; the migration skill's step 8.
2. The evidence-record required fields (`referencePage` + non-empty `components`) and the judge
   tri-state — here in `../references/01-evidence-records.md`; `designspec.mjs`
   (`EVIDENCE_REQUIRES`, `EVIDENCE_FIELD_SHAPE`, `resolveEvidenceVk`).
3. The five reachability keys and their tri-state — here in 01; `designspec.mjs`
   (`REACHABILITY_KEYS`); the migration skill's step 8. `reuseBindings` was gated by the engine
   and documented nowhere before `--units` published it; keep it in every list.
4. The D12 split — which exit-2 lines are plan gaps and which is the repairable build gap — here
   in `../references/03-failure-and-park-policy.md`; the CLI's stderr lines in `migrate.mjs`.
5. Page-key grammar (`main` · `mini:<Schema>` · `typed:<Schema>` · `child:<Entity>` ·
   `child:<Entity>@<Via>`, plus the disambiguators) — here in SKILL.md; `migrate.mjs`'s header;
   `designspec.mjs`'s key assignment. There is deliberately **no `list` key**: the list page's
   deliverables are rows of `main` and `--built.pages` has no entry for it, so publishing one would
   create a key with no gated row of its own. Earlier drafts of these files listed it; they were
   describing a key the engine never emitted.
6. The FREEDOM schema per page key — `--units` cannot publish it (`pages[].schema` is the CLASSIC
   source and is `null` for `main` and for an unfolded child), so the queue file's
   `units[<key>].schemaName` is its only home: written by the reconcile step from the builder's
   return, read by the verifier, and the reason a build started in an earlier session can be
   verified in this one. Stated here, in `../references/02-queue-and-built-files.md`, in
   `../references/04-per-page-build-recipe.md` and in the workflow's Build and Verify prompts.
7. The `creatio-ui-guidelines` done-gate evidence (a shipped reference page + the components
   diffed with `get-component-info`) — here in 01 and 04; the migration skill's steps 7 and 8.
8. **The approval home** (`decisions.md`, both scopes, entry names the plan VERSION) — this
   skill's Contract rule 1, `../references/02-queue-and-built-files.md` ("Recovery"), the
   workflow script's Reconcile prompt and its approval-missing `next` string, the migration
   skill's step 7 and its `../../classic-to-freedom-migration/references/migration-documentation.md` (scope table, the
   `decisions.md` section, cardinal rule 7). Six places; rule 1 is a hard stop, so a stale one
   refuses to build an approved plan.

## Consolidation direction, if it is ever needed

Nothing merges. If duplication starts to bite:

- **Engine-shape facts → the engine.** The `--built` shape, the evidence `requires` and the
  reachability key list are already published by `--units` at runtime; both skills could read
  them instead of restating them, which removes items 1–3 of the drift list at the lowest cost.
- **Build recipes stay in the migration skill.** They are mapping knowledge, not build-loop
  policy, and a second copy here is exactly what `../references/04-per-page-build-recipe.md`
  refuses to create.
- **The loop policy stays here.** Rounds, parking, the role split and the queue file are about
  executing safely under interruption; they have nothing to say about Classic or Freedom, and
  putting them back into the migration skill would recreate the single-context step 7 this skill
  exists to replace.
