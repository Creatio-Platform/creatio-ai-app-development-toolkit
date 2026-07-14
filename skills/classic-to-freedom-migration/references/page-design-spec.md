# Per-Page Classic → Freedom Design Spec

For every page that will be **Rebuilt** (a new Freedom page) or changed as a **Delta** (additive on an
existing Freedom page), produce one design spec per page. The structure-analysis summary
(`references/analysis-summary.md`) tells the user *what* moves; this spec tells the agent *how to
build the page* — it is detailed enough that the build step is mechanical.

Produce it during step 5 (Map To Freedom UI) for each Rebuild/Delta page, attach it to that page's
sub-plan in `plan.md`, and follow it during step 7 (implement). Present it as plain Markdown — never
HTML or a rendered artifact.

## What makes a good spec

- **Populate it from the engine ChangeSet, not by hand.** When `engine/migrate.mjs` was run, its output
  IS the spec's data: every `viewConfigDiff` insert → a field row (its `parentName` is the container/tab,
  its `layoutConfig` is the placement + colSpan); every `details` / `standardFeatures` entry → a
  related-list / native-feature row; every `cardActions` entry → an action row; every `needsDecision`
  item is resolved in the row it affects. If the spec omits an element the ChangeSet emitted, it is wrong.
- **Region by region, not field-dumped.** Walk the Classic page top to bottom — header, side/profile
  area, tabs, field groups, details, files/notes/feed, actions — and give each a Freedom home.
- **Every Classic field gets one row** with its Freedom component, data-source attribute, and grid
  placement (container + colSpan on the 24-column grid). Nothing is left to "figure out later".
- **Behavior is mapped, not just layout.** Page rules, handlers, validators, and actions each get a
  line with their Freedom target (use the categories in `references/classic-to-freedom-mapping.md`).
- **End with a wireframe** of the finished Freedom page so the agent and the user can see the layout
  before a single tool call, and a build order so the implementation is deterministic.
- Separate confirmed Classic facts (read from runtime/repository) from inferred placement choices.

## Spec template

```
## Page: <Classic schema> → Freedom <page name>

- Entity: <entity schema>
- Classic parent template: <parent chain>
- Freedom template: <chosen template> — <one-line reason; rejected candidates if not obvious>
- Target package: <package>
- Page type: <list | form | detail | mini>

### Region map (Classic → Freedom)
| Classic region | Contents | Freedom home | Notes |
| --- | --- | --- | --- |
| Header / caption | <title field, status, stage> | Page header + <top area / status component> | |
| Side / profile area | <key fields> | <right area / profile container or "none"> | |
| Tab: <name> | <groups it holds> | TabPanel → tab "<name>" | |
| Field group: <name> | <fields> | <FlexContainer / GridContainer / ExpansionPanel> | |
| Detail: <name> | <child entity> | Related list (data source + list component) | |
| Files / Notes / Feed | <which are present> | Files component / Notes / Feed (or dropped) | |
| Action menu | <actions> | Page actions / buttons / handler commands | |

### Fields
| Classic field (caption) | Type | Freedom component | Data-source attribute | Container · colSpan | State rule |
| --- | --- | --- | --- | --- | --- |
| <caption> | <text/number/lookup/date/bool/money> | <crt.Input / dropdown / date / lookup / checkbox / number> | <PDS attribute> | <container · n/24> | <required / read-only / visible-when ...> |

### Page rules (business rules on this page)
| Rule | Trigger | Effect | Freedom target |
| --- | --- | --- | --- |
| <what it does> | <field/condition> | <visibility / required / value / filter> | Page business rule / handler / validator |

### Handlers / converters / validators
| Classic logic | Freedom target | Notes |
| --- | --- | --- |
| <method / subscription / save override> | <request handler / converter / validator> | |

### Freedom layout (wireframe)
<nested-list or boxed sketch of the final page: header, tabs, groups with fields and their colSpans,
details, files/feed. This is the picture the agent builds to.>

### Build order
1. Create the page from <template> (or get_page for a Delta target).
2. Add containers/tabs, then fields in grid order; validate_page before saving.
3. Add page business rules.
4. Add handlers / converters / validators.
5. Wire detail data sources and related lists (parent-column binding, add/edit/delete rules).
6. Localization/resources for custom captions only.
7. Read-back validation per references/migration-documentation.md Definition of Done.
```

## Worked example (abbreviated)

```
## Page: UsrWorkOrderPage → Freedom "Work Order"

- Entity: UsrWorkOrder
- Classic parent template: BaseModulePageV2 (tabs + details + files)
- Freedom template: PageWithTopAreaAndTabsFreedomTemplate — status/stage is central to the workflow; top area carries it. (Rejected PageWithTabs: no first-class status region.)
- Target package: UsrFieldServiceFreedom
- Page type: form

### Region map (Classic → Freedom)
| Classic region | Contents | Freedom home | Notes |
| --- | --- | --- | --- |
| Header | Number, Status | Top area: title = Number, status indicator = Status | Status drives field visibility |
| Tab "General" | Customer/asset/schedule groups | TabPanel → "General" | |
| Tab "Labour & Parts" | Time, parts detail | TabPanel → "Labour & Parts" | |
| Detail "Parts used" | UsrWorkOrderPart | Related list on "Labour & Parts" | parent = UsrWorkOrder |
| Files / Feed | both present | Files + Feed components | |
| Actions | "Complete", "Reassign" | Page buttons → handler commands | |

### Fields (General tab — abbreviated)
| Classic field | Type | Freedom component | Attribute | Container · colSpan | State rule |
| --- | --- | --- | --- | --- | --- |
| Number | text | crt.Input (read-only) | UsrNumber | Top area · — | read-only |
| Customer | lookup | Lookup | UsrCustomer | "Customer" group · 12/24 | required |
| Asset | lookup | Lookup | UsrAsset | "Customer" group · 12/24 | filtered by Customer |
| Priority | lookup | Dropdown | UsrPriority | "Schedule" group · 8/24 | required when Type = Emergency |
| Planned start | datetime | Date/Time | UsrPlannedStart | "Schedule" group · 8/24 | |
| Total cost | money | Number (currency) | UsrTotalCost | "Schedule" group · 8/24 | visible when Status = Completed |

### Page rules
| Rule | Trigger | Effect | Freedom target |
| --- | --- | --- | --- |
| Emergency needs priority + on-call tech | Type = Emergency | Priority + Technician required | Page business rule |
| Hide cost until done | Status ≠ Completed | Total cost hidden | Page business rule |

### Handlers
| Classic logic | Freedom target | Notes |
| --- | --- | --- |
| onSaved → recompute SLA | reuse backend; handler calls existing process | SLA logic stays server-side (C#) |
| "Complete" button method | button → request handler | runs completion validator first |

### Freedom layout (wireframe)
[ Top area ]  Number (title)        [Status ●]      [ Complete ] [ Reassign ]
[ Tabs ]  General | Labour & Parts | Files | Feed
  General
    ▸ Customer group      Customer (12) · Asset (12)
    ▸ Schedule group      Priority (8) · Planned start (8) · Total cost (8, when Completed)
  Labour & Parts
    ▸ Parts used (related list: Part · Qty · Cost)

### Build order
1. create_page from PageWithTopAreaAndTabsFreedomTemplate in UsrFieldServiceFreedom.
2. Add tabs, then General-tab containers and fields in the order above; validate_page.
3. Add the two page business rules.
4. Add the Complete/Reassign button handlers; reuse the SLA process call.
5. Wire the "Parts used" related list to UsrWorkOrderPart (parent = UsrWorkOrder).
6. Read-back: confirm schema UId, package, merged view items, rules, validation.
```
