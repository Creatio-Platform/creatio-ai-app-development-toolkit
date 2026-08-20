# Merge Engine + Mapper — internals

Deterministic merge engine: N layers of a Classic ClientUnitSchema (base→top) → one **effective page** + provenance. A pure Node module, **with no Creatio/stand dependency** — tested offline against golden fixtures.

## Files (runtime — everything shipped to the client)
- `engine.mjs` — `parseSchema(src,pkg)` (**AST parsing** of the `define(...)` body via vendored `acorn`: reads the returned object literal statically, **without executing** the body — RCE-safe for stand-sourced input; anything not statically resolvable → `astDiagnostics`, fail-loud) and `mergeHierarchy(schemas)` (replay diff · merge businessRules/rules/details by key · method override stack · provenance).
- `mapper.mjs` / `designspec.mjs` / `migrate.mjs` — the mapper, the design-spec/plan renderer, and the CLI driver.

There is **deliberately no test code here**: the golden runners (`run.mjs`, `run-mapper.mjs`), their `_testkit.mjs`, and `fixtures/` live **outside the skill** — at the repo root, `engine-tests/classic-to-freedom/` — so the client-facing skill folder holds runtime only. The runners import the engine from here by relative path.

## Running the goldens
```
cd engine-tests/classic-to-freedom   # from the repo root
node run.mjs && node run-mapper.mjs  # merge + mapper, exit 1 on failure
```
(this is also what the CI job `Classic→Freedom engine goldens` does.)

## Golden result (merge — all checks green; `run.mjs` prints the live count)
- **SupportUnit** (SupportCalendar + SupportService): entity=SupportUnit; 8 fields; 3 tabs; 3 details (incl. `SupportScheduleEmployeeDetail`); 4 rules (ParentSupportUnit/SupportWorkingDayType FILTRATION, Contact/Calendar Required); method `setName`.
- **Contract** (9 layers): entity=Contract; 25 fields; 5 tabs; 14 details; 19 active rules; **removed** `State`(WorkContractsProcess), `Contact`+`ContractSumGroup`(WorkOverride); `Owner` FILTRATION + `Parent` Required (WorkContractsProcess); 71 methods.
- **F1 (order):** layers are supplied in true dependency order (`HierarchyLevel` from the stand: 299<320<…<607). `mergeHierarchy` returns `warnings` (an op hit a missing item) and `unresolvedParents` (order/seed diagnostics).
- **F2 (base seed):** `mergeHierarchy(schemas, {seedTemplate})` + the `_base/BaseModulePageV2_skeleton.js` fixture → base containers resolve (`unresolvedParents→0`), the base `ESNTab` tab appears, and the client tabs remain.

## What it proves
Reconstructing the effective page from 9 layers — which an LLM subagent previously estimated at ~142k tokens — is done here **deterministically and instantly in code**, confirming the thesis "merge = code, not LLM".

## Mapper (`mapper.mjs`, `run-mapper.mjs`)
`mapToFreedom(effective, {entityColumns})` → a Freedom ChangeSet: `viewConfigDiff` (a field = 3-part binding, control chosen by column type), `viewModelConfigDiff`/`modelConfigDiff`, `pageBusinessRules`/`entityBusinessRules` (FILTRATION→entity apply-static-filter; BINDPARAMETER→page make-* + the **inverse**), `details` (the "Expanded list" composite + dependency), `handlerStubs`, `needsDecision[]` (the judgment 20%: custom components/charts, methods, removals, unknown types).
- **container-role mapping** (lesson #6): `ProfileContainer`/`Header`→`SideAreaProfileContainer`.
- **F3 — the tab/container tree:** every field is routed by **climbing its ancestry** (`resolveOwner`): a tab ancestor→that tab (we emit `crt.Tab`+`…Grid` once, and only when the tab holds ≥1 field), Header/Profile→the side profile, otherwise→fallback+`needsDecision`. The flat "GeneralInfoTabContainer" dump is gone.
- **F9 — payload vs context (by origin):** an element is payload only if a schema layer defined it — diff-items by `templateOwned` (insert origin), keyed categories by `schemaTouched`. Base framework methods/details/components + base tabs the client merely re-arranged stay layout context (we do not synthesize a `crt.Tab` for them). `baseContextExcluded` reports what was excluded. (On the real SupportUnit: 348 methods→1, 4 details→3, 12 components→9.)
- Run: `node run-mapper.mjs` from `engine-tests/classic-to-freedom/` (together with `run.mjs` — both runners, `exit 1` on failure).
- **"Be loud" (Case check):** `unmapped-component` (the root of each dropped non-field subtree — an SLA timer, custom buttons), `referenced-module` (UI modules from `define()` dependencies outside the page unit), `field-hint` (a dynamic `hint`) — no non-standard element disappears silently; everything → `needsDecision`. See "The non-BaseModulePageV2 boundary" in the internal self-review (dev notes, outside the repo).
- For SupportUnit the code generates a ChangeSet **structurally equivalent to the slice** assembled by hand (the POC slice `body_full6.js`, outside the repo) for fields/controls/profile/detail/rules. It is **not byte-for-byte**: the base seed is supplied separately (F2 — we do not yet fetch the real parent template from the stand, hence no `Name` field), and a detail is emitted as a composite spec, not a full Expanded-list body with a toolbar. These are known gaps — see below.

## Known limitations (to finish → product)
- Symbolic enums (ENG-95412): `ViewItemType` (29), `ContentType` (7) and `DataValueType` (49) are now pinned **complete**, transcribed from core `Terrasoft.Nui/…/enums/sysenums.js`, so every member resolves to its numeric value — a schema may write `itemType` as a raw number, so the values must be exact. `BusinessRuleModule` (RuleType/Property) stays seeded as before. Lesson E1 ("never guess") is unchanged; what replaced hand-seeding is `enumDriftIssues` (engine.mjs), which diffs the pinned tables against the stand's own echo (`manifest.enumVocabulary`): a **value mismatch blocks** the gate, a member only the **stand** carries raises the non-blocking `enum-drift-advisory`, and a member only the engine carries is not a finding. A member the tables lack still surfaces per element as the `unknown-enum-member` advisory. Note the echo is produced by a clio-side `get-classic-page-sources` change that has **not shipped yet** — until it does, the guard sees nothing, so a wrong pinned value has no detector and the transcription is the single point of truth.
- Layer order (F1): supplied in `HierarchyLevel` order from the stand (the authoritative topological depth). `SysPackageInDependency` is **not** ESQ-readable, so the raw DAG edges are unavailable — same-level ambiguity is flagged via `warnings`, not topo-sorted.
- Base seed (F2): the mechanism exists (`seedTemplate`), but the offline fixture is a skeleton; the real parent template is not yet fetched from the stand (hence no `Name`, for example).
- Functions in `attributes`/`methods` are captured by presence (provenance); their bodies are not analyzed (that is the input for the mapper / handler stubs).
