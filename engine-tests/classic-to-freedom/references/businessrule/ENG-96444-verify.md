### ✅ Plan-vs-Done — VERIFIED against the built page

> SAME grouped control table as `--checklist`, Status AUTO-FILLED from the built page(s) (`get-page` → `bundle.viewConfig`, keyed per page in `--built.pages`). Structural rows are machine-checked and drive the verdict; `☐ confirm on-stand` rows are surfaced for the agent — not machine-gated. ⛔ **INCOMPLETE — 1 machine-checked deliverable(s) MISSING from YOUR BUILD** (build them / file the evidence, then re-verify)

**Pages**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 1 | List page → ListPageV3Template | ☐ confirm on-stand | not derivable from get-page — confirm (render / on-stand query) |
| 2 | Bound to the EXISTING object `BusinessRule` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind | ✅ Done | bound to ˋBusinessRuleˋ |
| 3 | Package placement → `UsrBusinessRuleFreedom` — the built page must live in the target package (a page saved into the wrong package ships nothing to the customer's app) | ✅ Done | built in ˋUsrBusinessRuleFreedomˋ |
| 4 | Form page → PageWithTopAreaAndTabsFreedomTemplate | ✅ Done | form page built (get-page returned its components) |
| 5 | Navigable section registered in exactly ONE workplace — the Freedom section appears in the app menu (`create-app-section`) and is bound to a single workplace; the pages above are not reachable without it, and a registration only ADDS, so a section "moved" between workplaces stays in both until the old binding is removed | ❌ MISSING | bound to 2 workplaces (UCworkplace, My applications), expected exactly 1 — a registration only ADDS, so the previous binding is still there; unbind all but the intended one (this row REPORTS it, the build does not undo it on its own) |

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
| 11 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass was INDEPENDENTLY JUDGED** — a separate reviewer found the filed record convincing. A record nobody reviewed does not close this row, even when the row above is ✅. | ✅ Done | judged convincing for ˋlist#quality-gatesˋ |

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
| 17 | Tabs — 1 expected | ✅ Done | 2 crt.TabContainer built |

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
| 22 | [tab-caption] Tab733e368eTabLabel | ✅ Done | evidence filed under ˋmain#confirm:tab-caption:Tab733e368eTabLabelˋ and judged convincing |

**Quality gates**

| # | Deliverable | Status | Evidence (built page) |
| --- | --- | --- | --- |
| 23 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass RAN** — a record naming the reference page and the components checked was filed under `main#quality-gates`. | ✅ Done | evidence filed under ˋmain#quality-gatesˋ |
| 24 | `creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** "native components / native containers used", "style parity is inherent", "looks fine", "template handles it", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never "refine if desired". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. **This row: the design pass was INDEPENDENTLY JUDGED** — a separate reviewer found the filed record convincing. A record nobody reviewed does not close this row, even when the row above is ✅. | ✅ Done | judged convincing for ˋmain#quality-gatesˋ |

**Verdict:** ⛔ **INCOMPLETE — 1 machine-checked deliverable(s) MISSING from YOUR BUILD** (build them / file the evidence, then re-verify)