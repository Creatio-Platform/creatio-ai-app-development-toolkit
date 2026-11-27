## Notes

- Classic detail behaviour ported: list filters by process parameters; Set subscription; Set Limit per Year.
- Not ported here, for the D6 task: the Copy and Delete lock by order status on product lines.
- Not ported here, see D5: the Limit per Year cell rule.
- **Dropped:** a second column profile (one grid profile in Freedom); Edit selected records / Record rights menu
  items (no Freedom list equivalent).
- Row 7 keeps the platform Open/Copy/Delete; Freedom has no per-row lock for them.
- Nothing was dropped from the Products list.
- Tidied the page code and dropped the stale duplicate import.
- Decision needed (row 9): Build "Edit selected records" as a custom list action,
  or Won't do?
- Checked (row 9): `get-component-info crt.DataGrid` — no bulk-edit action in its tools menu settings.
- Row 9: no Freedom list equivalent of "Edit selected records".
