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
- **`Logic` is behaviour, not layout** — entity/lookup filters, handlers/converters, process launch. A
  field's own declarative state (required / read-only / visible-when) stays in the Layout `Rule` column;
  imperative multi-field logic goes here.
- **`⚠ Confirm before I build`** collects everything needing a human answer (the engine's ⚠ worklist plus
  any discovery risks/gaps you append).
- Feed the resolution inputs so names are real, not codes: `resources` (captions), `columnTitles` (field
  labels), `detailSchemas` (detail entity/columns/title). Separate confirmed facts from inferences.

## Spec template

```
## Design spec — <entity> (generated)

- Entity: <entity> · Template: <chosen Freedom template> · Package: <target package>
- Size: <F> fields · <D> details/features · <R> rules · <A> actions

### List page
- **Add record:** via mini page `<MiniPage>` / full edit page
- **List columns:** <col> · <col> · …
- **Section actions:** `<action>` · … — migrate as Freedom list-page actions

### <entity> form page
#### Layout
| Region | Element | Type | Source | Rule | Additional |
| --- | --- | --- | --- | --- | --- |
| Side profile › <island> | <field label> | Lookup (<ref>) / Text (250) / Email / Date / Number / Boolean | PDS.<col> | required / read-only / visible-when … | tip: … |
| Tab · <name> | <field label> | … | PDS.<col> | … | … |
| Tab · <name> | <detail title> | Related list | <child entity> · by <FK> | — | cols: … |
| Tab · <name> | <feature> | Approvals / Attachments / Feed (component) | template-provided / native — confirm component on-stand | — | — |
| Tab · <name> | Activities / Emails | Related list | Activity · native | — | — |
| Card actions | <action> | Action | — | — | ⚠ which process / verify print reports |

#### Logic
| Behaviour | Trigger | Effect | Freedom target |
| --- | --- | --- | --- |
| Filter · <attr> | <attr> lookup | static filter / ⚠ dynamic — resolve value | entity business rule / lookup filter |
| <handler method> | <trigger> | imperative (<category>) — review | request handler / converter / virtual attr |
| Run process | Run process action | launch <process> | ⚠ which process — resolve via connected processes on-stand |

#### ⚠ Confirm before I build
- **[<kind>]** <item> — <what to confirm / resolve>
- **risk/gap:** <cross-cutting discovery risk or missing source>
```

Reading order follows the plan's **Main scope** table: list page first, then the form page (Layout → Logic → Confirm), then each child page under **Child page mappings**.

## Worked example (single-section, abbreviated)

```
## Design spec — Applicant (generated)

- Entity: Applicant · Template: PageWithTabsFreedomTemplate · Package: UsrApplicantFreedom
- Size: 19 fields · 8 details/features · 6 rules · 2 actions

### List page
- **Add record:** via mini page `ApplicantMiniPage` — migrate as a Freedom mini page / quick-add
- **List columns:** ⚠ not in the schema (profile data) — read the section's saved columns
- **Section actions:** `runBulkAssign` — migrate as Freedom list-page actions

### Applicant form page
#### Layout
| Region | Element | Type | Source | Rule | Additional |
| --- | --- | --- | --- | --- | --- |
| Side profile › Contact | Contact | Lookup (Contact) | PDS.Contact | — | — |
| Side profile › Contact | Mobile phone | Phone | PDS.MobilePhone | read-only | — |
| Side profile › Contact | Specialist expertise level | Lookup (ExpertiseLevel) | PDS.ExpertiseLevel | required @ Stage = Job Offer | — |
| Side profile › Request | Request | Lookup (InternalRequest) | PDS.InternalRequest | required @ Stage ∈ {Job Offer, Attendance} | — |
| Side profile › Request | Department | Lookup (OrgStructureUnit) | PDS.Department | read-only | — |
| Tab · Basic information | Reject reason | Lookup (RejectReason) | PDS.RejectReason | required @ Stage ∈ {Rejected, Refusal} | — |
| Tab · Basic information | Contact comms | Related list | ContactCommunication · by Contact | — | — |
| Tab · Basic information | Attachments | Attachments | template-provided | — | — |
| Tab · Current vacancies | Applicant requests | Related list | InternalRequest · by EmployeeJob | — | cols: Number · Status · Job |
| Tab · History | Stage history | Related list | RecruitmentInStage · by RootEntity | — | — |
| Tab · History | Activities | Related list | Activity · native | — | — |
| Tab · Approvals | Visas | Approvals | native — confirm component on-stand | — | — |
| Card actions | Run process | Action | — | — | ⚠ which process — resolve via connected processes on-stand |

#### Logic
| Behaviour | Trigger | Effect | Freedom target |
| --- | --- | --- | --- |
| Filter · Request | Request lookup | ⚠ dynamic — Type = … , Status ∈ {In progress, On distribution} | entity rule / lookup filter |
| onContactChanged | Contact changes | imperative — fill Mobile phone / Email / Skype | request handler + virtual attrs |
| onInternalRequestChanged | Request changes | imperative — fill Department / Staff unit | request handler + virtual attrs |

#### ⚠ Confirm before I build
- **[profile-island]** ContactContainer, InternalRequestContainer — two side-profile islands rebuilt as separate containers; confirm the left-area representation.
- **[detail-editability]** ContactCommunication — view-only vs add/edit/delete not on the master; resolve from the detail schema.
- **[detail-editpage]** ContactCommunication — the related list opens the ContactCommunication form on add/edit; confirm a Freedom form (and mini page, if used) exists for it, or migrate it as a follow-on page.
- **risk/gap:** created Freedom pages can't yet be re-opened in the visual designer — edits go via the agent.
```
