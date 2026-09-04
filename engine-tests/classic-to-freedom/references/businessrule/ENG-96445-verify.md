### ✅ Plan-vs-Done — VERIFIED against the built page

> SAME grouped control table as `--checklist`, Status AUTO-FILLED from the built page(s) (`get-page` → `bundle.viewConfig`, keyed per page in `--built.pages`). Structural rows are machine-checked and drive the verdict; `☐ confirm on-stand` rows are surfaced for the agent — not machine-gated. ⛔ **INCOMPLETE — 3 machine-checked deliverable(s) MISSING from YOUR BUILD** (build them / file the evidence, then re-verify)

**Pages**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 1 | List page → ListPageV3Template | ☐ confirm on-stand | not derivable from get-page — confirm (render / on-stand query) |
| 2 | Bound to the EXISTING object `BusinessRule` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind | ✅ Done | bound to ˋBusinessRuleˋ |
| 3 | Package placement → `UsrBusinessRuleFreedom` — the built page must live in the target package (a page saved into the wrong package ships nothing to the customer's app) | ✅ Done | built in ˋUsrBusinessRuleFreedomˋ |
| 4 | Form page → PageWithTopAreaAndTabsFreedomTemplate | ✅ Done | form page built (get-page returned its components) |
| 5 | Navigable section registered in exactly ONE workplace — the Freedom section appears in the app menu (`create-app-section`) and is bound to a single workplace; the pages above are not reachable without it, and a registration only ADDS, so a section "moved" between workplaces stays in both until the old binding is removed | ✅ Done | bound to exactly 1 workplace (My applications) |

**list · List page**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 6 | List template → `ListPageV3Template` | ✅ Done | built on ˋListPageV3Templateˋ |
| 7 | List columns — 1 expected (Name) | ✅ Done | 1 of 1 expected columns matched BY CODE on the built list page |

**list · ⚠ Confirm worklist**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 8 | [list-columns] fallback list column set | ✅ Done | evidence filed under ˋlist#confirm:list-columns:fallback list column setˋ and judged convincing |
| 9 | [list-command-bar] command-bar buttons: none declared through ˋgetSectionActions()ˋ | ✅ Done | evidence filed under ˋlist#confirm:list-command-bar:command-bar buttons: none declared through ˋgetSectionActions()ˋˋ and judged convincing |

**list · Quality gates**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 10 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass RAN** — a record naming the reference page and the components checked was filed under `list#quality-gates`. | ✅ Done | evidence filed under ˋlist#quality-gatesˋ |
| 11 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass was INDEPENDENTLY JUDGED** — a separate reviewer found the filed record convincing. A record nobody reviewed does not close this row, even when the row above is ✅. | ❌ MISSING | the judge REJECTED the evidence for ˋlist#quality-gatesˋ — The column-level claim checks out (lookup columns carry path + referenceSchemaName exactly as the reference's lookups do, non-lookups carry neither, matching PDS_Name), but a real prop-diff of crt.DataGrid against Contacts_ListPage would have surfaced that the built grid has no selectionState, _selectionOptions, bulkActions or layoutConfig, while Contacts_ListPage, DeliverySchedulePage and McpServer_FormPage all carry selectionState/_selectionOptions/layoutConfig on their grids - so the diff was column-scoped, not the component-scoped diff the record claims. |

**Form — Layout (by tab/region)**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 12 | Side profile — 2 fields | ☐ confirm on-stand | not derivable from get-page — confirm (render / on-stand query) |
| 13 | Header — 16 fields · Feed (ESN) | ☐ confirm on-stand | not derivable from get-page — confirm (render / on-stand query) |
| 14 | Tab · New Tab — 3 fields | ☐ confirm on-stand | not derivable from get-page — confirm (render / on-stand query) |

**Form — Coverage (verified)**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 15 | Form template → `PageWithTopAreaAndTabsFreedomTemplate` | ✅ Done | built on ˋPageWithTopAreaAndTabsFreedomTemplateˋ |
| 16 | Fields — 21 expected | ✅ Done | 21 of 21 expected fields matched BY NAME on the built page |
| 17 | Tabs — 1 expected | ✅ Done | 1 crt.TabContainer built |

**Card actions**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 18 | Card action — Print | ✅ Done | a crt.Button is present — confirm it triggers the action |
| 19 | Card action — Process | ✅ Done | a crt.Button is present — confirm it triggers the action |
| 20 | Card actions — native (ViewOptions/Tag) | ☐ confirm on-stand | not derivable from get-page — confirm (render / on-stand query) |

**⚠ Confirm worklist**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 21 | [layout-type] Header | ✅ Done | evidence filed under ˋmain#confirm:layout-type:Headerˋ and judged convincing |
| 22 | [tab-caption] Tab733e368eTabLabel | ❌ MISSING | the judge REJECTED the evidence for ˋmain#confirm:tab-caption:Tab733e368eTabLabelˋ (needs referencePage + components) + an independent judge verdict — The decision is about caption TEXT and its binding (keep 'New Tab' and group '12345' verbatim, authored as localizable strings with the tab caption bound via #ResourceString(...)#), but the record answers only with the containers crt.TabPanel/crt.TabContainer/crt.ExpansionPanel — neither caption string nor the localizable-string binding appears anywhere, so it names the neighborhood of the decision instead of answering it. |

**Quality gates**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 23 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass RAN** — a record naming the reference page and the components checked was filed under `main#quality-gates`. | ✅ Done | evidence filed under ˋmain#quality-gatesˋ |
| 24 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass was INDEPENDENTLY JUDGED** — a separate reviewer found the filed record convincing. A record nobody reviewed does not close this row, even when the row above is ✅. | ❌ MISSING | the judge REJECTED the evidence for ˋmain#quality-gatesˋ — All 7 named components ARE present on the built page and the props I could check do match the reference (TopAreaProfileContainer: gap large/none, padding large on all four sides, color primary, borderRadius medium; labelPosition auto on all 20 inputs; appearance unset everywhere) - but I read McpServer_FormPage and it carries only crt.GridContainer and crt.Input of the 7, so crt.ExpansionPanel, crt.ComboBox, crt.DateTimePicker, crt.Checkbox and crt.NumberInput cannot have been prop-diffed against it, and the record gives no props and no other source for those five. |

**Verdict:** ⛔ **INCOMPLETE — 3 machine-checked deliverable(s) MISSING from YOUR BUILD** (build them / file the evidence, then re-verify)