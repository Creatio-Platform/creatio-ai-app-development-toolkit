# App Structure Analysis Summary (user-facing response)

After analyzing the Classic structure (Workflow steps 0–5), give the user a short, readable summary
of what the app is made of and how it will move to Freedom UI. This is the human-readable companion
to `plan.md`: it orients the user *before* the approval gate, while `plan.md` and the documentation
set hold the dense, table-driven detail.

## Format Rules

- **Plain Markdown in chat. Never HTML, never an artifact, never a rendered page.** Use headings,
  short paragraphs, and lists only. Tables are allowed but keep them narrow; prefer the grouped list
  below for the inventory.
- Match the user's language.
- Lead with the rollup, then the detail. The reader should understand the shape of the work from the
  first screen, before scrolling into the per-section breakdown.
- Keep it scannable: one item per line, short descriptions, no long prose.
- Separate confirmed facts from inferences. Mark anything not verified against runtime/repository as
  an assumption, and surface discovery gaps in "Good to know" rather than hiding them.
- Scale to scope. Single-section: drop the rollup and phases, keep "What it does", the one section's
  breakdown, and "Good to know". Whole-package: use the full structure.

## Inventory Grouping (the important part)

Group the inventory **by section**, not by component type. One block per section. This scales: five
sections read as five coherent blocks, and the reader always sees which page, rule, process, and bit
of code belong together. Do **not** collect all pages into one bucket and all rules into another —
that breaks the page→section relationship the reader needs.

Render the inventory as **one Markdown table**, with rows grouped by section (the `Section` column
repeats the section name down its rows). A nested bullet list does not stay readable past a few
items; a table does. Within each section, order rows as: pages first, then the section's process(es),
then its code logic.

- **A page's business rule goes in that page's row** (the `Rule / notes` column), because a Creatio
  business rule is client-side logic attached to a specific page — it is not a section-level item and
  never gets its own row or bucket.
- **Process and code logic are section-level rows** (one each), not attached to a page.

Use these columns:

| Section | Component | Classic schema | Freedom target | Call | Rule / notes |
| --- | --- | --- | --- | --- | --- |

Each row carries a **migration call** (what we will do with it):

| Call | Meaning | Maps to |
| --- | --- | --- |
| **Rebuild** | Gets a new parallel Freedom page. | own section/page → new Freedom list/form page |
| **Delta** | Additive change on an existing Freedom page. | replacing/extension schema → delta on a base Freedom page |
| **Reuse** | Server-side, no UI work; re-tested and left in place. | backend/service/process/code dependency |
| **Manual** | Needs a product or architecture decision first. | unsupported / no safe Freedom analog |
| **Drop** | Intentionally not migrated (record the reason). | dropped with reason |

When the summary is re-presented *during or after* implementation, append the live status from
`references/migration-documentation.md` (`TODO / WIP / BLOCKED / DONE / VALIDATED / DROPPED`) and tag
the phase, so the same block doubles as a progress view.

## Structure

```
## <App / section name> — Classic → Freedom UI

Scope: <single-section | whole-package> · Environment: <name or "repository only"> · Package: <owning package → target package>

### What it does
<1–2 sentences in business language: what the app is for and who uses it.>

### At a glance
- <N> sections, <P> pages, <R> page rules, <Pr> processes, <C> code units.
- Rebuild <a> · Delta <b> · Reuse <c> · Manual <d> · Drop <e>.
- <one sentence on the headline decision, e.g. parallel rebuild, vendor package locked, switch-over deferred>

### What we're migrating
| Section | Component | Classic schema | Freedom target | Call | Rule / notes |
| --- | --- | --- | --- | --- | --- |
| <Section> | <page / detail> | <Classic schema> | <Freedom page/list/delta> | <call> | <page rule, if any> |
| <Section> | Process | <process> | reuse as-is | Reuse | |
| <Section> | Code logic | <C# unit> | reuse as-is | Reuse | |
| <next section> | ... | | | | |

### How we'll stage it
- **Phase 1 — <name>**: <which sections/pages>, and why first (highest traffic, fewest dependencies).
- **Phase 2 — <name>**: <which sections>, each gated by <prerequisite or decision>.
- Order rule: entities/data sources first, then own sections, then replacing/extension deltas, then backend.

### Good to know
- <risks, missing-source gaps, platform limitations, decisions needed — each one line.>

### Next
This summary is orientation only. Immediately after it, present the per-page design spec
(`references/page-design-spec.md`) for each Rebuild/Delta page — the concrete "what goes where",
populated from the engine ChangeSet — then stop and ask for explicit approval. Do not stop on the
summary alone; the user approves the design spec, not the rollup.
```

## Worked Example (abbreviated)

```
## Field Service Management — Classic → Freedom UI

Scope: whole-package · Environment: fieldservice (repository confirmed) · Package: UsrFieldService (Classic, editable) → same package

### What it does
Runs the field service operation — work orders, technicians, equipment, contracts, and parts. Each area is its own Classic section with its own screens, rules, and automation.

### At a glance
- 5 sections, 25 pages, 12 page rules, 5 processes, 5 code units.
- Rebuild 25 · Delta 0 · Reuse 10 · Manual 0 · Drop 0.
- Parallel rebuild, section by section; processes and code stay server-side; switch-over deferred until you approve it.

### What we're migrating
| Section | Component | Classic schema | Freedom target | Call | Rule / notes |
| --- | --- | --- | --- | --- | --- |
| Work Orders | Work Orders list | UsrWorkOrderSection | Freedom list page | Rebuild | |
| Work Orders | Work Order card | UsrWorkOrderPage | Tabs/top-area form page | Rebuild | emergency jobs require a priority + on-call tech; cost hidden until Completed |
| Work Orders | Completion report | UsrWorkOrderCompletePage | Form page | Rebuild | time logged and a photo required to close |
| Work Orders | Process | work-order lifecycle & SLA escalation | reuse as-is | Reuse | |
| Work Orders | Code logic | SLA deadline recompute (C#) | reuse as-is | Reuse | |
| Service Contracts | Contract card | UsrContractPage | Form page | Rebuild | cannot activate without coverage terms |
| Service Contracts | Process | renewal workflow | repoint to Freedom page | Manual | currently opens the Classic contract page |
| Service Contracts | Code logic | contract value roll-up (C#) | reuse as-is | Reuse | |
| ... | | | | | |

### How we'll stage it
- Phase 1 — Work Orders & Technicians: the two highest-traffic sections, fewest dependencies.
- Phase 2 — Equipment, Contracts, Parts: independent, any order; Contracts also needs the renewal process repointed.

### Good to know
- A process that opens a Classic page (contract renewal) has no automatic Freedom equivalent — repointing is a manual decision.
- Pages can't yet be re-opened in the visual designer after creation (platform tooling limitation) — changes are made by the agent until fixed.
- Nothing in the Classic app is changed; each section stays live until switch-over is approved.

### Next
Approve to proceed, or tell me what to adjust.
```
