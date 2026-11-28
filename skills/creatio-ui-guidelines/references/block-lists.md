# Lists

Use this reference for a list on any page: its columns, a related list on a record page and a read-only list. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

### List columns

Applies to the section list and every related list. Check the rendered list with demo data (pass/fail).

- **Nothing is cut.** No value or header ends in an ellipsis; money shows the whole amount with its currency. Widen the column or shorten the caption (*Overdue*, not *Is overdue*).
- **The columns fill the list's width**; columns stopping at half the width are a defect. Spare width goes to names, descriptions, accounts.
- **Width follows the content.** Dates, checkboxes, counts and short codes take narrow columns.
- **Height follows the rows.** A related list grows until its rows fit without an inner scroll, with no fixed height leaving a blank band below a short list.

### Related lists

**Every 1:M child object of this record gets a related list on the record page, with a working add flow (default).** Do not omit a list because the app is simple. A list whose records cannot be created, or whose "+ Add" opens a page not registered for the object, is a defect (pass/fail). The default is two layers together:

- **Inline adding and editing, always on.** Set `features.editable` with `enable: true` and `itemsCreation: true` on the list's `crt.DataGrid` (shape from `get-component-info component-type='crt.DataGrid'`), so the user adds and edits rows in place with the master link pre-set. A grid without it renders read-only rows. Turn inline off only when the user names that restriction, and then follow *Read-only detail*.
- **Plus pages.** Wire "+ Add" to a mini page with the starter fields and register the full page for opening and editing, or a mini page alone when it holds the whole record. A child with no section of its own gets both registered for its object (mini page as add page, full page as default and edit page).
- **Only a tiny list skips the pages (heuristic):** rows of about three short values or fewer (a tag, a date, an amount) and no long text. Line items with more columns get both layers.

Record the choice for each list in the plan. Lookups are not related lists. Build the list through clio: `get-guidance related-list`, the "Expanded list" composite (`get-component-info composite='Expanded list'`), and `get-guidance related-page-binding` for the pages.

### Read-only detail

- **A read-only detail must be read-only on its rows too, not just have its add button hidden.** Making a detail (child list) non-editable takes THREE changes: (1) hide/remove the add (`+`) button; (2) clear the inline-editing flag on the List component itself; (3) remove the row **Copy** and **Delete** actions from the List's rows, while **keeping records opening from the list** (open-on-click) so users can still view them. Hiding only the add button still leaves existing rows editable in place (and often a new-row affordance), and a row that still offers Copy or Delete still creates and destroys records, so the detail is not actually read-only. Removing Copy/Delete is not a reason to stop rows opening: a read-only list is for looking records up. On a `crt.DataGrid` the recipe is: `features.editable` set to `{ enable: false, itemsCreation: false }`, and `rowToolbarItems` set to exactly one `crt.MenuItem` that mirrors the platform's own Open item: a localized `caption` (a page resource string such as `#ResourceString(<List>_OpenMenuItem_caption)#`, never a hard-coded English `"Open"` literal), `icon: "edit-row-action"`, and `clicked` set to `{ request: "crt.UpdateRecordRequest", params: { itemsAttributeName: "<Items>", recordId: "$<Items>.<DS>_Id" }, useRelativeContext: true }` (`<Items>` is the list's items attribute, `<DS>` its data source). Keep the platform item's two guards as well: it is hidden when the list's entity has no edit page, and disabled while the parent record is still in create mode (not saved yet) — so leave the item out for an entity with no edit page, and bind its `disabled` to the page's create-mode state. The platform adds its default row actions (Open, Copy, Delete) only while `rowToolbarItems` is unset, and any value you give replaces all three — so `rowToolbarItems: []` or `features.rows.toolbar: false` leaves the rows with no Open at all, and leaving it unset keeps Copy and Delete. Before building, confirm the shape on the target version with `get-component-info` for the list component, or copy it from an out-of-the-box page whose list rows offer Open alone.

## Traps

- A detail's add button is hidden but rows still edit inline → *Read-only detail*.

- A `crt.DataGrid` without `features.editable` renders read-only rows → *Related lists*.

- List columns keep default widths, cutting values while the right part stays empty → *List columns*.
