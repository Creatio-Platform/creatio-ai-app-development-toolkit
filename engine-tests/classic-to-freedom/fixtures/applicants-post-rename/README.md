# `applicants-post-rename` — a recorded page whose elements are named for their columns

Not synthesized. `built-main.json` is the `main` page entry of the `built.json` a later
orchestrated Applicants migration recorded (run archive `session-artifacts-applicants-2026-09-22.zip`,
`01-migration-folder/built.json`). It is the same section and the same plan as
[`applicants-recorded`](../applicants-recorded/), so it is checked against that fixture's
`expected.json`: 19 field columns and 5 business-rule targets.

## What it checks

The shape the name-only matcher already handled — and so the shape a binding-aware change must
not break:

- **Elements are named for their column** (`Contact`, `Job`, `InternalRequest`) and **keep their
  `$PDS_` binding**, rather than dropping it.
- **Five bindings differ from the element name**, because the column is reached through a related
  record: `MobilePhone` → `$PDS_ContactMobilePhone`, `Email` → `$PDS_ContactEmail`,
  `Skype` → `$PDS_ContactSkype`, `Department` → `$PDS_RequestDepartment`,
  `StaffUnit` → `$PDS_RequestStaffUnit`. The name identifies the column and the binding does not,
  so the name leg is what closes these five.
- **Business rules target the column-named elements** (`items: ["RejectReason"]`).

Expected verdict: 19/19 fields, 5/5 rules.

## What was trimmed, and what was replaced

Kept verbatim: `viewConfig`, `entitySchemaName`, `parentSchemaName`. Dropped as unread by the
field and rule checks: `modelConfig`, `viewModelConfig`, `handlers`, `resources`, and the page and
package ids.

In `businessRules`, every GUID **value** is replaced with a numbered placeholder
(`00000000-0000-4000-8000-…`). Those are rule ids and the lookup-record ids a condition compares
against — data from the stand the run used. No resolver reads them: rule tokens are identifiers
starting with a letter or `_`, which a GUID never contributes as a column form. The remaining GUIDs
in `viewConfig` are grid-column `id`s the platform generates at random.
