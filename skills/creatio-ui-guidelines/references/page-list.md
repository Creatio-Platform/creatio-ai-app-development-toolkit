# List page

Use this reference for a section list page: its slots, filters and dashboards. Columns of the list: *List columns* in `block-lists.md`. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

## List (section) page layout

A section page has its own container slots; put things in the right one.

- **Additional list actions** go in `ActionButtonsContainer` (top right).
- **Analytics and dashboards** go into the Dashboard component (`crt.Dashboards`), or `DashboardsTabContainer` when you are unsure how to configure it; never into the grid or filter areas.

### Filters and search

- **Additional filters go into the filter row before the search (pass/fail).** The row is `LeftFilterContainerInner` (inside `LeftFilterContainer`): folder actions, the filter menu, the quick filters, `SearchFilter` last. Insert ahead of `SearchFilter`, reading the row's children in the `get-page` bundle to set the `index`; anything after the search field jumps while the user searches. `RightFilterContainer` holds the list's own tools (summaries, refresh, view switch), not filters; no filter goes inline in the grid.
- **Each quick filter has its own icon (pass/fail)**, distinct and fitting its meaning; filters sharing an icon cannot be told apart.
