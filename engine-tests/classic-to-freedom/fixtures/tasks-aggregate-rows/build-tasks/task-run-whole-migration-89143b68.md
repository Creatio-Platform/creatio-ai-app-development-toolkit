---
id: 89143b68
status: todo
statusFrom: 602fae58
declared: 
origin: engine
pageKey: run
group: Whole migration
order: 1
planVersion: plan-89c6dc90bc79
rowsDigest: f2ba9a8f
writesTo: whole
dependsOn: 
stopGate: false
agentNonce: 
decisions: 36:D3
---

# 1. run · Whole migration

> One task of an APPROVED migration plan. Build ONLY what is listed here — a deliverable that looks wrong is a
> proposal to the user, never a silent change (record it under `## Notes` and build the plan as written).

- **Page key:** `run`
- **Build order:** 1 — leaf-first; a child page's form exists before the parent list that opens it
- **Rows:** 38 (38 machine-checked by `--verify`)
- **How you close this task:** fill the `Outcome` cell of EVERY row below.
- **Never write `status:`.** That field is the engine's, derived from the cells below. A closing word typed there is discarded and named on the index as an edit; `blocked` is honoured ONCE and then moved into `declared:` for you. Write it there yourself and it sticks. `declared:` takes exactly one word:
  - `declared: blocked` — halt the run. It stops the tasks that depend on this one, so it is the one word that must not be inferred from cells. Put the reason under `## Notes`. Leave `declared:` empty otherwise; nothing else belongs in it.
- **A whole-task scope decision is not yours to declare.** "This task does not apply" / "we will not build it" / "not this phase" are ANSWERS to a question the plan raised, and every one of them needs the person's authorisation (`D<N>`) recorded before it stands. Raise the question in your `## Notes` (`Decision needed (row N): …` — see below) and leave the row `not-built — needs-decision`. The developer then runs `--decide D<N> --wont-do` / `--postponed --to <destination>`, which fills the row's Outcome cell for you.
  - `built` — it is on the stand.
  - `not-built — <cause>`, cause being one of `blocked` · `needs-decision` (`blocked` = the stand or a service was unreachable and a re-run may clear it; `needs-decision` = anything only a person can settle — no Freedom equivalent, a scope question, a check you cannot run). Put the reason under `## Notes` against the row number — the cell takes the token only, because a reason with pipes in it breaks the table.
  - The plan may pre-fill a row's Outcome with `not-applicable — <reason>`. That is the plan's own boundary — a cross-section row nothing in your scope is meant to build. Leave the cell as it is; if you disagree, raise it under `## Notes`, do not edit the cell.
- **A cell left `—` is not a built row.** It is a row nobody accounted for, and it counts against this task exactly as `not-built` does. Every row `built` or `not-applicable` computes `done`; any row `not-built` or unaccounted computes `partial`; a row a person answered as `wont-do` / `postponed` through `--decide` feeds those same computed statuses. `partial` does NOT hold up the tasks that depend on this one — it holds up calling the RUN complete, and each unbuilt row is named to the user by the engine.
- **Two lines the final report quotes verbatim — write them under `## Notes`, one line each:**
  - for every `not-built — needs-decision` row: `Decision needed (row N): <the question, and the options a person can choose between — 1-3 sentences>`. Not why you stopped (that goes in the prose) — WHAT is being decided.
  - for every row `--verify` cannot read off the page (its `Closed by` cell says evidence + judge, or the plan marks it confirm-on-stand): `Check on stand (row N): <what to open → what is expected>`, one line a person can follow without reading the rest of your notes.
- **Writes:** `whole` — no other task may be running against this artifact. A task with a DIFFERENT `writesTo` (or an empty one) may run beside this one; one with the same must not. The NEXT task on this artifact goes to a DIFFERENT sub-agent — sequential is not permission to keep this one; finishing yours and picking up the next chunk of the same page is the violation.
- **One sub-agent, one task:** do not pick up another task file in this session. Before finishing, copy the **dispatch token** your orchestrator handed you when it started THIS task into `agentNonce:` above, verbatim. Do not invent one: the engine issued that token to this task alone, and a task closed carrying a different token — or none — is reported as closed by a context it was never handed to. If you were not given a token, you were not dispatched through the engine: stop and say so rather than minting a value.

## Deliverables

<!-- ENGINE-OWNED except the `Outcome` column, which is YOURS and is carried across re-runs. -->

| # | From | Deliverable | Closed by | Outcome |
| --- | --- | --- | --- | --- |
| 1 | ⚠ Confirm worklist | [field-control] (1 fields) | `--verify` (`evidence`) | — |
| 2 | ⚠ Confirm worklist | [field-labels] (all fields) | `--verify` (`evidence`) | — |
| 3 | ⚠ Confirm worklist | [dedup-on-save] on-save duplicate check (child entity) | `--verify` (`evidence`) | — |
| 4 | ⚠ Confirm worklist | [field-control] (1 fields) | `--verify` (`evidence`) | — |
| 5 | ⚠ Confirm worklist | [field-labels] (all fields) | `--verify` (`evidence`) | — |
| 6 | ⚠ Confirm worklist | [dedup-on-save] on-save duplicate check (child entity) | `--verify` (`evidence`) | — |
| 7 | ⚠ Confirm worklist | [field-control] (1 fields) | `--verify` (`evidence`) | — |
| 8 | ⚠ Confirm worklist | [field-labels] (all fields) | `--verify` (`evidence`) | — |
| 9 | ⚠ Confirm worklist | [dedup-on-save] on-save duplicate check (child entity) | `--verify` (`evidence`) | — |
| 10 | ⚠ Confirm worklist | [field-control] (2 fields) | `--verify` (`evidence`) | — |
| 11 | ⚠ Confirm worklist | [field-labels] (all fields) | `--verify` (`evidence`) | — |
| 12 | ⚠ Confirm worklist | [list-column-type] Name | `--verify` (`evidence`) | — |
| 13 | ⚠ Confirm worklist | [list-command-bar] command-bar buttons: none declared through ˋgetSectionActions()ˋ | `--verify` (`evidence`) | — |
| 14 | Pages | Bound to the EXISTING object `M` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind | `--verify` (`entity`) | — |
| 15 | Pages | Form page → FormPageTemplate | `--verify` (`formpage`) | — |
| 16 | Pages | Navigable section registered in exactly ONE workplace — the Freedom section appears in the app menu (`create-app-section`) and is bound to a single workplace; the pages above are not reachable without it, and a registration only ADDS, so a section "moved" between workplaces stays in both until the old binding is removed | `--verify` (`onstand`) | — |
| 17 | Pages | Bound to the EXISTING object `C2` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind | `--verify` (`entity`) | — |
| 18 | Pages | Form page → BaseMiniPageTemplate | `--verify` (`formpage`) | — |
| 19 | Pages | Bound to the EXISTING object `G1` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind | `--verify` (`entity`) | — |
| 20 | Pages | Form page → BaseMiniPageTemplate | `--verify` (`formpage`) | — |
| 21 | Pages | Bound to the EXISTING object `C1` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind | `--verify` (`entity`) | — |
| 22 | Pages | Form page → PageWithAreaFreedomTemplate | `--verify` (`formpage`) | — |
| 23 | Form — Layout (by tab/region) | Side profile — 1 field | `--verify` (`layout`) | — |
| 24 | Form — Layout (by tab/region) | Side profile — 1 field | `--verify` (`layout`) | — |
| 25 | Form — Layout (by tab/region) | Side profile — 1 field · GD — related list | `--verify` (`layout`) | — |
| 26 | Form — Layout (by tab/region) | Side profile — 2 fields · R1D — related list · R2D — related list | `--verify` (`layout`) | — |
| 27 | Form — Coverage (verified) | Form template → `BaseMiniPageTemplate` | `--verify` (`template`) | — |
| 28 | Form — Coverage (verified) | Fields — 1 expected | `--verify` (`fields`) — name the element for its column (`Contact` or `ContactField`) and bind it to that column (`$PDS_Contact`) — either one closes the row, so an element whose name drops the column (`RoleInCompanyField`) closes on its binding | — |
| 29 | Form — Coverage (verified) | Form template → `BaseMiniPageTemplate` | `--verify` (`template`) | — |
| 30 | Form — Coverage (verified) | Fields — 1 expected | `--verify` (`fields`) — name the element for its column (`Contact` or `ContactField`) and bind it to that column (`$PDS_Contact`) — either one closes the row, so an element whose name drops the column (`RoleInCompanyField`) closes on its binding | — |
| 31 | Form — Coverage (verified) | Form template → `PageWithAreaFreedomTemplate` | `--verify` (`template`) | — |
| 32 | Form — Coverage (verified) | Fields — 1 expected | `--verify` (`fields`) — name the element for its column (`Contact` or `ContactField`) and bind it to that column (`$PDS_Contact`) — either one closes the row, so an element whose name drops the column (`RoleInCompanyField`) closes on its binding | — |
| 33 | Form — Coverage (verified) | Related lists — 1 expected | `--verify` (`details`) | — |
| 34 | Form — Coverage (verified) | Form template → `FormPageTemplate` | `--verify` (`template`) | — |
| 35 | Form — Coverage (verified) | Fields — 2 expected | `--verify` (`fields`) — name the element for its column (`Contact` or `ContactField`) and bind it to that column (`$PDS_Contact`) — either one closes the row, so an element whose name drops the column (`RoleInCompanyField`) closes on its binding | built |
| 36 | Form — Coverage (verified) | Related lists — 2 expected | `--verify` (`details`) | wont-do — not carried over (D3) |
| 37 | List page | List template → `ListPageV3` — ⚠ that is not a Freedom template schema name (they end in `Template`, e.g. `ListPageV3Template`); fix `planMeta` and re-plan, or this row can never be confirmed against a built page | `--verify` (`template`) | — |
| 38 | List page | List columns — 1 expected (Name) | `--verify` (`listcolumns`) — each grid column carries EXACTLY the `PDS_<Column>` code the plan names — only the code is matched, never an element name or a `$` binding, and a missing code is ❌ MISSING | — |

## Notes

<!-- YOURS. Never rewritten: what you built, the evidence you filed, what blocked you, what you propose. -->

