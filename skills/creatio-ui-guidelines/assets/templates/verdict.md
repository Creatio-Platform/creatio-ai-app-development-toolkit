<!-- Verdict file template: one per full audit or acceptance run, saved in the task's working directory. Rules: *Verdict file* in ../../references/review-checklists.md. Format from design-spec-framework (github.com/denysosadchyi/design-spec-framework, MIT). -->

# <page or app> · review verdict

Checked: <date> · Checklist: creatio-ui-guidelines `review-checklists.md` (<toolkit version>)
Result: **fail** — <n> pass · <n> fail · <n> human · <n> not applicable

| ID | Item | Verdict | Evidence |
|---|---|---|---|
| L-12 | Islands read as cards on the render | human | zoom `SideAreaProfileContainer` and the first tab's groups; each must read as a card on the page background |
| L-28 | Style parity | pass | `__vcCensus('ours')` → `0 only in ours (+), 0 only in the reference (-)` |
| F-04 | Small enum-like lookups are simple lookups | fail | `UsrStatus` column has no `simple-lookup`; the field opens a selection window |

Passed: R-01, R-02, R-04, L-01, L-15, L-16, L-17, L-18, …
Not applicable: L-13, L-27, L-31, …

## Open
- F-04: set `simple-lookup: true` on the `UsrStatus` entity column, re-open the page
