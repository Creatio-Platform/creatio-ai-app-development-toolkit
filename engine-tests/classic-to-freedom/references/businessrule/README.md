# `BusinessRule1Section` — the two runs ENG-96458 was written from

**These files are REFERENCE, not fixtures.** Nothing loads them; they are the human-readable evidence behind
the ENG-96458 assertions in `run-mapper.mjs`, which reconstruct their inputs inline. They sit under
`references/` rather than `fixtures/` so no reader mistakes them for a regression input.

`ENG-96444-verify.md` and `ENG-96445-verify.md` are the `verify.md` tables the two paired test runs of
2026-09-02 actually produced on `BusinessRule1Section` — ENG-96444 without the build workflow, ENG-96445
with it. They are the evidence behind every defect in ENG-96458, and they are here because they are the
only surviving artefact of those runs.

## Provenance — read this before treating anything here as a replay

- **Where they came from:** extracted from the two Claude Code session transcripts
  (`~/Downloads/-Users-a-kravchuk-Projects-test-migration-{2,3}`), which is where the tables were
  captured as tool output. They are the engine's own rendering, byte for byte as the run printed it.
- **What is NOT here:** the migration folders themselves (`/Users/a-kravchuk/Projects/test-migration-{2,3}`)
  no longer exist. The `--built` payloads, `manifest.json`, `plan.md`, `resolutions.json` and
  `verify.json` of those runs are **not recoverable**.
- **What that means for the tests:** the ENG-96458 regression fixtures in `run-mapper.mjs` are
  **reconstructed**, not replayed. They are hand-built to reproduce the exact rows these two tables show
  — the false ✅ on rows 18/19, the `2 crt.TabContainer built` on ENG-96444's row 17, the five
  `☐ confirm on-stand` rows, and the `sectionRegistered` ❌ — and each assertion cites the row it comes
  from. A test that passes here proves the engine now renders those rows correctly; it does not prove the
  engine would render the original payloads identically, because the original payloads are gone.

## The rows the acceptance criteria name

| Row | ENG-96444 (inline) | ENG-96445 (workflow) | ENG-96458 |
| --- | --- | --- | --- |
| 17 Tabs — 1 expected | `✅ Done · 2 crt.TabContainer built` | `✅ Done · 1 crt.TabContainer built` | D2 — a surplus is ⚠, named |
| 18 Card action — Print | `✅ Done · a crt.Button is present` | same | D1 — the plan says Not migrated: no row |
| 19 Card action — Process | `✅ Done · a crt.Button is present` | same | D1 — same |
| Section registered | `❌` (two workplaces, kept by D6) | `✅` | D3 — an `accepted` resolution closes it |
| 12 / 13 / 14 (Layout) | `☐ confirm on-stand` | `☐ confirm on-stand` | D4 — a counted worklist, not a footnote |
| 1 (`List page → …`) / 20 (`Card actions — native`) | `☐ confirm on-stand` | `☐ confirm on-stand` | still `☐`, still tallied in nothing — informational notes, not human checks (PR #157 review, Blocker 2) |

Row 13 (`Header — 16 fields · Feed (ESN)`) is the one row that actually failed a human check on
ENG-96445 — the Feed tab was lost — while every machine-checked row on that page was green. That is the
whole reason D4 exists.
