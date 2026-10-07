# `applicants-recorded` — a recorded page whose element names drop their columns

Not synthesized. `built-main.json` is the `main` page entry of the `built.json` an orchestrated
Applicants migration recorded (run archive `14-sept-migration.zip`,
`migration-applicants/built.json`), trimmed to what a `--verify` field or rule check reads:
`viewConfig` and `businessRules` verbatim, the page's identity keys, and `modelConfig` cut down
to its page-scope `PDS` data source. No node, name, binding or rule is edited.

`expected.json` is the plan side of the same run: the 19 expected field columns and the 5
distinct business-rule target attributes, read off its `plan.md` (the element table's
`PDS.<Column>` source column, and the Logic table's behaviour column — `Employee` appears on two
rows and is one identity). [`applicants-post-rename`](../applicants-post-rename/) is checked
against the same file.

`rows-digests.base.json` is unrelated to the payload: it pins `<task id>:<rowsDigest>` for the
ten tasks of `run-tasks.mjs`'s standard run, so rendering a `Closed by` cell is proven not to
reach the digest.

## What it checks

Every expected column is built and bound on this page, and **five of the elements carry a name
that does not contain their column**, so their binding is their only identity:

| built element | binding | column |
| --- | --- | --- |
| `RoleInCompanyField` | `$PDS_Job` | `Job` |
| `ManagerMarketField` | `$PDS_Market` | `Market` |
| `ManagerSegmentField` | `$PDS_Segment` | `Segment` |
| `RequestField` | `$PDS_InternalRequest` | `InternalRequest` |
| `ResponsibleField` | `$PDS_Owner` | `Owner` |

Two properties of the payload make that binding the deciding leg:

1. **No binding carries a hash.** An agent writes the bare `$PDS_<Column>`; the hashed
   `PDS_<Column>_<hash>` is what the Interface Designer mints. So an unwrap that recognises only
   the hashed form resolves none of these five.
2. **Bindings are not uniformly prefixed.** `$PDS_Contact` sits beside `$Email`, `$Skype`,
   `$Department` and `$StaffUnit`, so the prefix is optional — a binding without it is compared as
   written. `JobTitleField` → `$StaffUnit` is the case that shows it: the name drops the column
   and the unprefixed binding resolves on its own.

The business rules target those same element names (`actions[].items: ["RequestField"]`). A string
rule over the token cannot know `RequestField` governs `InternalRequest`; only the page's
element → bound-column map can, which is what `elementColumnsOf` supplies to the rules check.

Expected verdict: 19/19 fields, 5/5 rules.

## What it does not carry

No `viewModelConfig`: the page-scope `PDS` data source declares `entitySchemaName: "Applicant"`
with no `attributes` map. Every identity leg exercised here therefore reads the node's own
binding. A payload that carries `viewModelConfig` takes the richer path.

## Derived variants

The unbound post-rename shape and the wrong-column / wrong-target shapes are derived from this file
in `run-mapper.mjs`, each by one visible edit, rather than committed as near-duplicate copies.
