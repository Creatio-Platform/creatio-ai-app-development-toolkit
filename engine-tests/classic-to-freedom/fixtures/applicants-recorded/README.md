# `applicants-recorded` — the payload a real run recorded, and the identity match failed on

Not synthesized. `built-main.json` is the **`main` page entry of the `built.json` an
orchestrated Applicants migration actually recorded** (`migration-applicants/built.json`
inside the run archive `14-sept-migration.zip`, captured by r.ivanov on 2026-09-14), trimmed
to what a
`--verify` field/rule check reads: `viewConfig` verbatim, `businessRules` verbatim, the
page's identity keys, and `modelConfig` cut down to its page-scope `PDS` data source. No
node, name, binding or rule was edited — the whole point of the fixture is that the payload
is the one the gate got wrong.

`expected.json` is the **plan side** of the same run: the 19 expected field columns and the
5 distinct expected business-rule target attributes, read off `migration-applicants/plan.md`
(the element table's `PDS.<Column>` source column, and the Logic table's behaviour column —
`Employee` appears on two rows and is one identity).

`rows-digests.base.json` is unrelated to the payload: it pins `<task id>:<rowsDigest>` for the
ten tasks of `run-tasks.mjs`'s standard run, captured on the base branch, so the `Closed by`
wording change can be proven not to reach the digest. See RISK1 in `run-tasks.mjs`.

## Why this fixture still earns its place

The migration-result-report work already closed most of this. Its matcher accepts an element
named `<Col>`
**or** `<Col>Field`, and resolves a binding through `boundAttributeOf`, which unwraps the
Designer-minted `PDS_<Col>_<hash>`. Against this recorded payload that gets **14 of 19 fields
and 3 of 5 rules** — a large improvement on the `0/19` and `2/5` the run itself reported, and
still not a pass on a page where every one of the 19 was built.

The five that remain are the ones where **both** identity legs miss:

| built element | binding | column | why each earlier leg misses |
| --- | --- | --- | --- |
| `RoleInCompanyField` | `$PDS_Job` | `Job` | name drops the column; `PDS_Job` has no `_<hash>`, so the unwrap leaves `PDS_Job` |
| `ManagerMarketField` | `$PDS_Market` | `Market` | same |
| `ManagerSegmentField` | `$PDS_Segment` | `Segment` | same |
| `RequestField` | `$PDS_InternalRequest` | `InternalRequest` | same |
| `ResponsibleField` | `$PDS_Owner` | `Owner` | same |

Two facts about this payload make that gap structural rather than incidental, and neither is
visible in a synthesized fixture:

1. **Not one of its 19 bindings carries a hash.** `$PDS_Contact`, `$PDS_Job`, `$PDS_Owner` —
   the hashed `PDS_<Col>_<hash>` shape is what the *Interface Designer* mints, and this page
   was built by an **agent**, which writes the bare prefix. So the hash-only unwrap reached
   none of them; the 14 that passed did so on the `<Col>Field` name leg alone.
2. **Bindings are not uniformly prefixed.** `$PDS_Contact` sits beside `$Email`, `$Skype`,
   `$Department` and `$StaffUnit`, so the prefix has to be *optional* — stripping it cannot be
   a precondition for resolving a binding at all.

`JobTitleField` → `$StaffUnit` is the instructive near-miss: its name drops the column too,
but its binding carries no `PDS_` prefix, so it already resolved. It is why the fix strips a
bare `PDS_` rather than doing anything cleverer with names.

## The rules row needs the page, not a string rule

`columnFormsOf` indexes a rule token under its column forms (`<Col>Field` → `<Col>`,
`PDS_<Col>_<hash>` → `<Col>`). That is a *string* transform, and it cannot know that the
element named `RequestField` governs `InternalRequest` — nothing in the token spells it. A
page rule names the **element** it acts on (`actions[].items: ["RejectReasonField"]`), so the
only thing that closes those two is resolving that element through the page's own
element → bound-column map. Hence the `elementColumn` argument to `builtRuleTokens`.

## `viewModelConfig` is NOT in this payload

The recorded entry carries `modelConfig` and **no `viewModelConfig`**, and its page-scope
`PDS` data source declares `entitySchemaName: "Applicant"` with **no `attributes` map**. That
matters for anyone extending this: there is nothing in this payload to resolve a binding
*through*, so every identity leg exercised here reads the node's own binding. A payload that
does carry `viewModelConfig` — it is an optional `--built` key, and the engine will assemble
it once it builds the payload itself — takes the richer path; this fixture proves the poorer
one still works.

## Derived variants

The post-rename (AC 3) and wrong-column / wrong-target (AC 4) payloads are **derived from
this file in `run-mapper.mjs`** rather than committed as near-duplicate 30 KB copies: a
second recorded copy that drifts from this one would be worse evidence than a transform whose
one edit is visible in the test.
