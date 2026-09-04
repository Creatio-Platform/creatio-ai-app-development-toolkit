# `businessrule1` — the ENG-96445 plan-time defect fixture

The input the 2026-09-02 paired migration test ran on: the Classic section
`BusinessRule1Section` and its edit page `BusinessRule1Page` on the stand named in
ENG-96445. It exists so the four plan-time defects ENG-96457 fixes are asserted against
the page that actually produced them, not against a synthetic stand-in.

## Provenance

`schemas[0].body` and `section[0].body` are the VERBATIM classic bodies
`clio get-classic-page-sources` returned during that run, recovered from the run's own
session transcript (the run assembled its manifest under the OS temp directory, which is
gone). `entityColumns` is the `get-entity-schema-properties` response from the same run.
The trailing shell noise the transcript appended after each body's final `});` was
stripped; nothing else was edited.

`seed` is a MINIMAL base-template chain, not the real one (a full chain is ~350 methods
and is not what these checks are about). It carries exactly the base elements the
defects depend on: `ProfileContainer`, `Header`, `Tabs`, `ESNTab` →
`ESNFeedContainer`, `ChangesHistoryTab`. The classic page `merge`s `ESNTab`, so Feed
emits with classic evidence and a base source — which is the Feed claim ENG-96457 item 2
is about. `--plan` prints the partial-seed advisory for this reason; it does not block.

`planMeta`, `signals` and `placement` are the values that run approved, so `--plan` on
this manifest exits 0 and the assertions read a gate-clean plan. `planMeta.formTemplate`
is `PageWithTopAreaAndTabsFreedomTemplate` — the template that run chose, and the one
whose capabilities item 2 is about.

## What it reproduces (before ENG-96457)

- **Item 1** — the Header is a 2-column classic block whose last two rows are
  `City1 | City2` (row 6) and `Country1 | Country2` (row 7). The classic `diff` DECLARES
  them in the order City1, Country1, City2, Country2, and the Layout table emitted that
  declaration order with no coordinates, so a faithful 2-column build paired
  `City1 | Country1` / `City2 | Country2`.
- **Item 2** — the Layout table said Feed was
  `template context — provided by the Freedom template` for a template that ships none.
- **Item 3** — `placement.application.code` reached the plan unprefixed.
- **Item 4** — no `⚠ Confirm` row for the Classic `Add` routing side effect.
- **Item 6** — `plan.md` ended with the `manifest.planMeta` authoring instruction.

## Re-capture

```
clio get-classic-page-sources --schema-name BusinessRule1Page   # schemas[0].body
clio get-classic-page-sources --schema-name BusinessRule1Section # section[0].body
clio get-entity-schema-properties --schema-name BusinessRule     # entityColumns
```
on the stand ENG-96445 names, then strip the transcript noise and keep this file's `seed`.
