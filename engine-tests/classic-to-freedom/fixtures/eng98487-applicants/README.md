# `eng98487-applicants` — the recorded payload the identity match failed on

Not synthesized. `built-main.json` is the **`main` page entry of the `built.json` the
ENG-98487 Applicants run actually recorded** (`migration-applicants/built.json` inside the
`14-sept-migration.zip` attached to ENG-98487 by r.ivanov on 2026-09-14), trimmed to what a
`--verify` field/rule check reads: `viewConfig` verbatim, `businessRules` verbatim, the
page's identity keys, and `modelConfig` cut down to its page-scope `PDS` data source. No
node, name, binding or rule was edited — the whole point of the fixture is that the payload
is the one the gate got wrong.

`expected.json` is the **plan side** of the same run: the 19 expected field columns and the
5 distinct expected business-rule target attributes, read off `migration-applicants/plan.md`
(the element table's `PDS.<Column>` source column, and the Logic table's behaviour column —
`Employee` appears on two rows and is one identity).

## What the run recorded, and why it is the fixture

`verify-final.md` of that run reports, against exactly this payload:

    | Fields — 19 expected | ⚠ verify | 0/19 expected fields present — missing: Contact, Owner, … |
    | Business rules × 7   | ⚠ verify | 2/5 business rule(s) matched by target attribute — missing: InternalRequest, Job, ExpertiseLevel |

on a page that was **built correctly**. Every expected column is on the page — bound, not
named: the builder named elements `<Something>Field` and bound them to the column
(`ContactField` → `$PDS_Contact`), and the business rules target those element names
(`items: ["RejectReasonField"]`). Element-name matching therefore saw nothing.

Four of the nineteen do not carry the column in the element name **at all**, so no naming
heuristic — not even stripping a `Field` suffix — could have recovered them. Only the binding
can:

| built element | binding | column |
| --- | --- | --- |
| `RoleInCompanyField` | `$PDS_Job` | `Job` |
| `RequestField` | `$PDS_InternalRequest` | `InternalRequest` |
| `JobTitleField` | `$StaffUnit` | `StaffUnit` |
| `ResponsibleField` | `$PDS_Owner` | `Owner` |

## `viewModelConfig` is NOT in this payload (ENG-98554 Q3, answered here)

The recorded entry carries `modelConfig` and **no `viewModelConfig`**, and its page-scope
`PDS` data source declares `entitySchemaName: "Applicant"` with **no `attributes` map** — so
there is nothing in it to resolve `$PDS_Contact` through. AC 2 on this artifact is therefore
closed by the **`$`/`PDS_` prefix-strip** leg of the resolution precedence, not by the
authoritative `viewModelConfig` leg. That leg still comes first when a payload does carry the
model; this fixture is the proof it is not the only one that can work.

Note also that the bindings are **not uniformly prefixed**: `$PDS_Contact` sits beside
`$Email`, `$Skype`, `$Department` and `$StaffUnit`, so the strip has to handle both spellings.

## Derived variants

The post-rename (AC 3) and wrong-column / wrong-target (AC 4) payloads are **derived from
this file in `run-mapper.mjs`** rather than committed as near-duplicate 30 KB copies: a
second recorded copy that drifts from this one would be worse evidence than a transform whose
one edit is visible in the test.
