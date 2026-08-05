# Overlap analysis: classic-ui-expert vs classic-to-freedom-migration

Maintainer note, not agent instructions — nothing in the skill's routing table points here.
Written 2026-08-04, when this skill was added to the toolkit; the comparison universe was the
whole repo (the migration skill's prose + engine, `context/`, `docs/`). Only the migration
skill overlaps: `context/` and `docs/` carry no Classic UI knowledge.

Both skills read the same Classic surfaces through the same clio commands, so some platform
facts inevitably appear in both. This file records which facts are duplicated (so a fix in
one place reaches the other), what stays separate by design, and where consolidation would
go if it is ever needed.

## The design split

- **clio owns mechanical retrieval** — `get-classic-page-sources` (chain assembly, apply
  order, per-layer `pkg`), `list-entity-client-schemas` (surface enumeration). Neither skill
  implements chain-walking; both call it.
- **The migration skill fetches the structural closure** (details, child pages, typed forms,
  mini page — machine-gated) to *fold* pages into a Freedom plan.
- **This skill fetches the logic closure** (mixins, referenced module bodies, message
  counterparts, entity C# + event process, values, census) to *describe* behaviour.

The remaining prose in each skill is policy about what matters — which is where they
legitimately differ. Skills are self-contained installable units; cross-skill file
references would add a hidden install-layout coupling no test guards, so nothing is shared
sideways.

## Per-file verdicts

| classic-ui-expert file | Overlap in the project | Verdict |
|---|---|---|
| `SKILL.md` | None textual; the migration contract (approval + engine gates) is a conceptual sibling of the refusal rules | separate |
| `references/01-surface-resolution.md` | Fact overlap: clio tool arg shapes; mini page registered in `SysModuleEdit`, not the section body; typed pages per `typeColumnValue`; child edit pages never named in the master body | separate; drift-watch |
| `references/02-layer-model.md` | The engine *implements* the fold (`engine.mjs` `mergeHierarchy`); migration prose warns about the thin top override; the reading discipline here (provenance trap, AMD layer naming, absence-is-a-customization, empty layers as zeros) exists nowhere else | separate; drift-watch |
| `references/03-member-ledger.md` | None. Migration's completeness is the structure gate (page-tree level); member-level accounting does not exist there | separate — and the planned "no member silently ignored" engine work should treat this file as its spec |
| `references/04-units.md` | None (engine method "categories" are draft stubs, not behaviour units) | separate |
| `references/05-reference-following.md` | Same facts, opposite policies: the engine detects `define()` UI modules and flags "port manually" (`mapper.mjs`), this skill fetches and reads them; migration defers lookup constants to the builder ("resolve via odata-read"), the retrieval floor here mandates the read | separate |
| `references/06-platform-patterns.md` | The largest genuine duplication: business-rule enums (`BINDPARAMETER`, property codes — `engine.mjs`, `classic-to-freedom-mapping.md`), the `SysModuleReport` print check (`designspec.mjs`, mapping doc), `ProcessInModules` resolution, `getIsFeatureEnabled` extraction, DCM dashboard mapping. Unique here: `onCardAction`+tag relay, `CombinedMode`/`SeparateMode` semantics, entity-parameterized mixin machinery, operation-permission pattern | separate now; the one real merge candidate later |
| `references/07-boundaries.md` | Partial: `SysModuleReport`-as-data repeats the mapping doc. Unique: hand-off-as-contract (full parameter enumeration), invisible implementations (assembly / file content), process start-condition caveat, orphaned resources | separate; drift-watch |
| `references/08-card-contract.md` | Related by design, not duplication: the engine's design-spec Logic table (Behaviour/Trigger/Effect) is the consumer-side rendering the cards feed. Shared convention: the `migrations/<slug>/` folder appears here (Packaging) and in `migration-documentation.md` | separate; drift-watch |
| `references/09-refusal.md` | Conceptual sibling of the engine's ⛔ gates (both refuse to present bad output); zero shared text | separate |
| `references/10-worked-example.md` | None (anonymized by design) | separate |

## Drift-watch list

Facts stated in both skills. A correction in one place must reach the other:

1. clio tool arg shapes — `list-entity-client-schemas` (`entity-name` → `sections`/`editPages`/`miniPageSchema`), `get-classic-page-sources` (`schema-name`, `entity`, `output-file`) — here in 01; migration SKILL.md step 4.0 and its Arg-facts note
2. Add mini page is registered in `SysModuleEdit` (`miniPageSchema` + `miniPageModes`), not in the section body — here in 01 (registry edges); migration SKILL.md `addRecordMiniPage`
3. Layer apply order + the thin-top-override phenomenon (empty `diff` in one schema proves nothing) — here in 02; migration SKILL.md step 4 and `classic-to-freedom-mapping.md`
4. Business-rule enums: `ruleType` 0=BINDPARAMETER / 1=FILTRATION; `property` 0=Visible / 1=Enabled / 2=Required / 3=Readonly — here in 06; `engine.mjs`, `classic-to-freedom-mapping.md`
5. `SysModuleReport` print check (`ShowInSection` / `ShowInCard`, filtered by the section's `SysModule`) — here in 06/07; `designspec.mjs`, `classic-to-freedom-mapping.md`
6. `ProcessInModules` → `VwSysProcess` resolution for section-connected processes — here in 06; `designspec.mjs`, `classic-to-freedom-mapping.md`
7. `migrations/<section-slug>/` output-folder convention — here in 08 (Packaging); `migration-documentation.md` (Location And Naming)

## Consolidation direction, if it is ever needed

Nothing merges between the two skills. If duplication starts to bite:

- **Tool-contract facts → clio.** Arg shapes and payload semantics are canonically owned by
  `get-tool-contract` / `docs://help/command/*`; both skills could cite instead of restate.
  Removes roughly half the drift list at the lowest cost.
- **Platform idioms (06) → a shared knowledge source, only when a third consumer appears.**
  Rule enums and on-stand checks are platform facts, not skill policy; their natural home is
  clio guidance (`docs://mcp/guides/*`) or `context/`, per the clio-owns-mechanics split.
- **03 is a spec, not a merge.** When the engine gains member-level accounting ("no member
  silently ignored"), the engine becomes the enforcement and 03 stays the human procedure.
