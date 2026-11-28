---
type: llm
weight: 2
---

Each related list that users add to or edit (work packages, materials, change orders) gets BOTH layers: inline adding and editing in the list itself, turned on explicitly (for example `features.editable` with `enable` and `itemsCreation` set to true on the list's DataGrid, or plainly "inline add and edit on"), AND a mini page or full page for adding or editing a record. Inline is never presented as an alternative to the pages, and no list that users edit is left read-only. A very small list (site photos with two short columns) may use inline editing without pages. An answer that relies only on pages, only on inline editing for the larger lists, or does not say how records are added, fails.
