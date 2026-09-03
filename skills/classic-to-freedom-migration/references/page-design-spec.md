# Per-Page Classic → Freedom Design Spec

For every page that will be **Rebuilt** (a new Freedom page) or changed as a **Delta** (additive on an
existing Freedom page), produce one design spec per page. The structure-analysis summary
(`references/analysis-summary.md`) tells the user *what* moves; this spec tells the agent *how to
build the page* — detailed enough that the build step is mechanical.

Produce it during step 5 (Map To Freedom UI) for each Rebuild/Delta page, attach it to that page's
sub-plan in `plan.md`, and follow it during step 7 (implement). Present it as plain Markdown — never
HTML or a rendered artifact.

## What makes a good spec

- **GENERATE it — do not hand-write it.** When `engine/migrate.mjs` was run, `node engine/migrate.mjs
  <manifest> --spec` prints this whole spec as Markdown straight from the ChangeSet. Present that output
  verbatim; your only edits RESOLVE the ⚠ items and append discovery risks to `⚠ Confirm`. Hand-writing
  it is the recurring failure — loose prose, no per-field placement, features mislabelled. The format
  below is what the generator emits (and the fallback template when Node was not run).
- **One `Layout` table = structure + contents.** The `Region` column is the page structure (side-profile
  islands, tabs, card actions) and REPEATS down its rows (Markdown can't merge cells). Every field,
  related list, native component and card action is ONE row — nothing is listed twice.
- **`Business rules` is where they live** — the declarative page rules (required / read-only /
  visible-when, each with its condition) render here, together with entity/lookup filters and
  process launch. The Layout `Rule` column carries only intrinsic field state
  (e.g. a read-only mirror), never a business rule — a reader finds all the rules in ONE place.
- **Custom METHODS are not in `Business rules`** — each is a row in `⚠ Custom methods`, with its trigger traced
  from the data (a declaration, a control binding, the call graph, a lifecycle hook). `Business rules` = what the
  engine MAPPED; `⚠ Custom methods` = the methods it could not, each carrying a ported/dropped/blocked
  obligation.
- **`⚠ Other declared logic`** = the non-method imperative members (`mixin`, `message`, `attribute-*`,
  `module-dep`, `referenced-module`) — declared on this page, defined elsewhere. Same contract as
  `⚠ Custom methods`: one row each, ported/dropped/blocked, with plain-language **What the item does** /
  **Use case** columns and a **Described in** cell. What each KIND is, is stated once above the table.
- **`⚠ Confirm before I build`** collects only what needs a human ON-STAND answer (plus any discovery
  risks/gaps you append). A member explained by a step-5.1 card is NOT a confirm item — it is work, and it
  lives in `⚠ Other declared logic`.
- Feed the resolution inputs so names are real, not codes: `resources` (captions), `columnTitles` (field
  labels), `detailSchemas` (detail entity/columns/title). Separate confirmed facts from inferences.

## Spec template

```
## Design spec — <entity> (generated)

- Entity: <entity> · Template: <chosen Freedom template> · Package: <target package>
- Size: <F> fields · <D> details/features · <R> rules · <A> actions

### List page
- **Add record:** via mini page `<MiniPage>` (folded under `### Add mini-page mapping`) / full edit page — verified / ⚠ NOT verified (resolve from `list-entity-client-schemas` `miniPageSchema`; the engine never assumes "none")
- **List columns:** <col> · <col> · … — the wording follows the resolved PROVENANCE: a `schema-default` set narrows the question ("the Classic list shows these columns; confirm this set is kept in Freedom"), an `entity-default` set is prefixed ⚠ and qualified as a single fallback column the Classic section never declared (with the resolver's own note in parentheses), and an empty set keeps the ⚠ question, distinguishing "the resolver ran and found nothing" (`none`) from "no resolver ran at all" (⚠ NOT resolved — which also names the remedy)
- **Section process:** ⚠ launches <process> — wire as a list-page run-process action (omitted when the section launches none)

The list page's CONTENTS then follow as their own tables, from `listChangeSet` — the list page is a
build artifact on the same footing as the form page. Deliberately NOT the form's `Region | Element | …` table: a
grid has no regions to fill, so its structure is an ordered column set, one filter container and one command bar.

These are BUILD deliverables, verified off the built page like the form's: `--verify` matches each column by its
`PDS_*` code inside the `DataTable` node's own `columns` array (never from another grid on the page) and each quick
filter by element name AND `crt.QuickFilter` — an element with the right name built as a plain field is reported as a
wrong-type failure, not as absent — from
`--built.pages.list` (clio `get-page`'s `bundle.viewConfig` for the list schema). The command-bar action and row-action
rows are the ones closed by a filed evidence record: a command-bar action's Freedom container cannot be resolved while
the section view `diff` goes unfolded, and a row action's Freedom element name is not resolved here at all, so neither
has an identity to match on the built page.

#### List columns (in order)
| # | Column | Grid column | Source | Type |
| --- | --- | --- | --- | --- |
| 1 | <classic column> | `PDS_<col>` | PDS.<col> (from `<col>.<display>` when the classic column was a display path) | <classic type> (`dataValueType` <n>) → <ref> / ⚠ <type> — `dataValueType` unresolved |

#### Quick filters
| Classic filter | Freedom element | Container | Column | Control |
| --- | --- | --- | --- | --- |
| `<FilterName>` | `QuickFilterBy<Column>` | `LeftFilterContainerInner` · index <n> | <column> | `crt.QuickFilter` · date/lookup / ⚠ <TYPE> — no known `quickFilterType` |

#### Row actions
| Action | Condition | Source package | Freedom target |
| --- | --- | --- | --- |
| `<DataGridActiveRow…>` | `<condition>` — carry as Freedom state / ⚠ none declared | <package> | ⚠ row action on `DataTable` — control and placement NOT resolved here |

> ⚠ **A row action carries no op in this ChangeSet.** Every other op here reproduces a shape measured on a built
> Freedom page; no such measurement exists for a row action, so the control and its placement are read off a built
> page rather than guessed. The name, the condition and the grid it belongs to are the resolved facts.

#### Command-bar actions
| Action | Caption | Icon | Condition | Menu position | Source package | Source | Freedom target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<action>` | `<caption resource>` | `<icon>` | `<Enabled condition>` — carry as Freedom state | group `<n>` · under `<submenu parent>` | `<package>` | `getSectionActions` | list-page command bar — ⚠ container NOT resolved here |

> **Build note — column ids:** each grid column also needs a GUID `id`; the engine mints none, so the builder assigns it.

> **Build note — a quick-filter op is placement, not a finished component:** it carries the element name, its
> container and index, the filtered column and the control. `crt.QuickFilter` also needs its own nested filter config
> and value binding, and it is `compositeOnly`, so complete it from that component's documentation.

Build notes are the two places this ChangeSet is deliberately PARTIAL — a fact with no answer to resolve. A hazard
that DOES have an answer is not a note: it is a ⚠ Confirm item, gated on the `list` page key like a form page's, so
it reaches `--units.preflight` and cannot be read past. The list page raises its own:

#### ⚠ Confirm before I build (<n>)
All eight kinds the list page can raise — the set is closed, so a kind absent from a run's plan means the run had
nothing to ask, never that the question went unasked. Nine bullets, eight kinds: `list-columns` is listed twice
because it asks about an EMPTY set and about a FALLBACK one, and the two are answered separately:
- **[list-columns]** no list columns resolved — the grid would be built empty …
- **[list-columns]** fallback list column set — the Classic section declares no list columns, so the grid would
  ship with a single fallback column … (the SAME kind, second item: a fallback set is an unanswered question
  too, and it carries an id so the operator's answer has somewhere to be recorded)
- **[list-column-type]** `<column>` — classic type `<T>` has no confirmed Freedom `dataValueType` …
- **[list-column-path]** `<column>.<display>` — a display path, bound as the lookup column `<column>` …
- **[list-filter-type]** `<FilterName>` — its Classic `dataValueType` maps to no known `quickFilterType` …
- **[list-filter-attributes]** `<Items>.filterAttributes` — a `merge` REPLACES the array, so re-list every entry the
  starter list page already registers alongside this ChangeSet's contribution …
- **[list-command-bar]** command-bar buttons: `<set>` — only `getSectionActions()` items are read; a button the
  section adds through its view `diff` is not folded at all …
- **[list-row-action]** row action: `<DataGridActiveRow…>` — its enablement condition must become Freedom state …
- **[list-process]** section process: `<names>` — the Classic section launches it; wire it as a list-page
  run-process action …

### <entity> form page
#### Layout
| Region | Element | Type | Source | Rule | Additional |
| --- | --- | --- | --- | --- | --- |
| Side profile › <island> | <field label> | Lookup (<ref>) / Text (250) / Email / Phone / Date / Number / Boolean | PDS.<col> | read-only (only if intrinsic) / — | Value from a linked record … / tip: … |
| Tab · <name> | <field label> | … | PDS.<col> | … | … |
| Tab · <name> | <detail title> | Related list | <child entity> · by <FK> | — | cols: … |
| Tab · <name> | <feature> | Approvals / Attachments / Feed (component) | template-provided / native — confirm component on-stand | — | — |
| Tab · <name> | Activities / Emails | Related list | Activity · native | — | — |
| Card actions | <action> | Action | — | — | ⚠ which process / verify print reports |

#### Business rules
| Behaviour | Trigger | Effect | Freedom target |
| --- | --- | --- | --- |
| <field> | when <attr> | required (else optional) / visible (else hidden) / read-only | page business rule |
| Filter · <attr> | <attr> lookup | static filter / ⚠ dynamic — resolve value | entity business rule / lookup filter |

#### ⚠ Custom methods — account for EVERY row (<N>)
| Method | Source | What the item does | Use case | Freedom target | Described in |
| --- | --- | --- | --- | --- | --- |
| <method> | L<from>-<to> | <plain-language what it does> / ⚠ not described | <plain-language step-by-step use case> / ⚠ not described | <Freedom construct> | <card> <AC…> / ⚠ not described |
| ↳ <helper> | L<from>-<to> | … | … | port with `<caller>` | <card> <AC…> |

#### ⚠ Other declared logic — account for EVERY row (<N>)
> what each KIND is, one line per kind present — stated here, not repeated on every row
| Member | Kind | What the item does | Use case | Described in |
| --- | --- | --- | --- | --- |
| <name> | mixin / message / attribute-* / module-dep / referenced-module | <plain-language what it does> / ⚠ not described | <plain-language step-by-step use case> / ⚠ not described | <card> <AC…> / ⚠ not described |

#### ⚠ Confirm before I build
- **[<kind>]** <item> — <what to confirm / resolve>
- **risk/gap:** <cross-cutting discovery risk or missing source>
```

Reading order follows the plan's **Main scope** table: list page first, then the form page (Layout → Business rules → ⚠ Custom methods → ⚠ Other declared logic → ⚠ Confirm), then each child page under **Child page mappings**.

## Worked example (single-section, abbreviated)

```
## Design spec — Applicant (generated)

- Entity: Applicant · Template: PageWithTabsFreedomTemplate · Package: UsrApplicantFreedom
- Size: 19 fields · 8 details/features · 6 rules · 2 actions

### List page
- **Add record:** via mini page `ApplicantMiniPage` — migrate as a Freedom mini page / quick-add
- **List columns:** Name · Stage · Created on — the Classic list shows these columns; confirm this set is kept in Freedom

#### List columns (in order)
| # | Column | Grid column | Source | Type |
| --- | --- | --- | --- | --- |
| 1 | Name | `PDS_Name` | PDS.Name | Text (`dataValueType` 1) |
| 2 | Stage | `PDS_Stage` | PDS.Stage | Lookup (`dataValueType` 10) → RecruitmentStage |
| 3 | Created on | `PDS_CreatedOn` | PDS.CreatedOn | DateTime (`dataValueType` 7) |

#### Command-bar actions
| Action | Caption | Icon | Condition | Menu position | Source package | Source | Freedom target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runBulkAssign` | ⚠ none read — confirm on-stand | — | ⚠ none declared — confirm on-stand | group 0 | HRApplicant | `getSectionActions` | list-page command bar — ⚠ container NOT resolved here |

> **Build note — column ids:** each grid column also needs a GUID `id`. The engine does not mint one (it has no stable source), so the builder assigns it per column.

#### ⚠ Confirm before I build (1)
- **[list-command-bar]** command-bar buttons: runBulkAssign — only `getSectionActions()` items are read; a button the section adds through its view `diff` (and a `DataGridActiveRow…` row action) is not folded at all, so neither reaches this ChangeSet — confirm the full button set against the Classic section on-stand, and where each one belongs on the Freedom command bar

### Applicant form page
#### Layout
| Region | Element | Type | Source | Rule | Additional |
| --- | --- | --- | --- | --- | --- |
| Side profile › Contact | Contact | Lookup (Contact) | PDS.Contact | — | — |
| Side profile › Contact | Mobile phone | Phone | PDS.MobilePhone | read-only | Value from linked Contact |
| Side profile › Contact | Specialist expertise level | Lookup (ExpertiseLevel) | PDS.ExpertiseLevel | — | — |
| Side profile › Request | Request | Lookup (InternalRequest) | PDS.InternalRequest | — | — |
| Side profile › Request | Department | Lookup (OrgStructureUnit) | PDS.Department | read-only | Value from linked Request |
| Tab · Basic information | Reject reason | Lookup (RejectReason) | PDS.RejectReason | — | — |
| Tab · Basic information | Contact comms | Communication options | native — confirm component on-stand | — | — |
| Tab · Basic information | Attachments | Attachments | template-provided | — | — |
| Tab · Current vacancies | Applicant requests | Related list | InternalRequest · by EmployeeJob | — | cols: Number · Status · Job |
| Tab · History | Stage history | Related list | RecruitmentInStage · by RootEntity | — | — |
| Tab · History | Activities | Related list | Activity · native | — | — |
| Tab · Approvals | Visas | Approvals | native — confirm component on-stand | — | — |
| Card actions | Run process | Action | — | — | ⚠ which process — resolve via connected processes on-stand |

#### Business rules
| Behaviour | Trigger | Effect | Freedom target |
| --- | --- | --- | --- |
| Specialist expertise level | when Stage | required (else optional) | page business rule |
| Request | when Stage | required (else optional) | page business rule |
| Reject reason | when Stage | required (else optional) | page business rule |
| Filter · Request | Request lookup | ⚠ dynamic — Type = … , Status ∈ {In progress, On distribution} | entity rule / lookup filter |

#### ⚠ Custom methods — account for EVERY row (2)
| Method | Source | What the item does | Use case | Freedom target | Described in |
| --- | --- | --- | --- | --- | --- |
| onContactChange | L247-250 | When the selected contact changes, the page reloads its related data so the form shows that contact's details. | 1) the user picks a different Contact; 2) the page notices the change; 3) it re-fetches and refreshes the related fields. | `crt.LoadDataRequest` / data-source reload from a handler | Applicant1Page/C02 AC-3, AC-4 |
| ↳ setContactInfo | L429-433 | Fills the chosen contact's email, mobile phone and Skype into the form. | 1) runs as part of the contact-change handler; 2) copies the contact's Email, Mobile phone and Skype into the matching fields. | port with `onContactChange` | Applicant1Page/C01 AC-5, AC-7 |

#### ⚠ Confirm before I build
- **[profile-island]** ContactContainer, InternalRequestContainer — two side-profile islands rebuilt as separate containers; confirm the left-area representation.
- **risk/gap:** created Freedom pages can't yet be re-opened in the visual designer — edits go via the agent.
```
