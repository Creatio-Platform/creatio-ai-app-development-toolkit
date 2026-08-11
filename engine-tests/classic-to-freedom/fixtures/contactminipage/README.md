# `ContactMiniPage` — real captured mini-page fixture (base-layer-driven)

A second real Classic **mini page** for the mapper golden (`run-mapper.mjs`, "Minor4 real mini page …"), added
alongside `activityminipage/` to widen the AC3 regression net (PR #58 review Minor 4 — "only one real mini-page
fixture pins AC3 in CI"). It exercises a **different fold path** from `ActivityMiniPage`: there the real fields come
from *customer* override layers that `insert` them; here the fields live in the **base layout layer** (`CrtUIv2`)
and a customer/product layer (`WorkLeadBase`) `merge`s onto them.

## Provenance

- **Schema:** `ContactMiniPage` (entity `Contact`) — the platform contact quick-add mini page.
- **Captured from:** clio environment `applicants_workbuild246_0817` via
  `get-classic-page-sources --schema-name ContactMiniPage` (same site as `activityminipage/`).
- **`manifest.json`** holds the fold input the engine consumes: `schemas` (the kept replacing-layer chain), `seed`,
  `entity`, `entityColumns`, `resources`.

## Why it is trimmed (and still real)

The raw capture is ~130 KB. The trimming drops only boilerplate; the **kept layer bodies are verbatim, unedited**:

- **Seed.** The platform `BaseMiniPage` parent-template chain is a fixed ~96 KB and byte-identical for *every*
  classic mini page. The fixture replaces it with a small **representative** `BaseMiniPage` seed that defines just
  the root containers the kept layers target (`MiniPage`/`HeaderContainer`) plus the base items the kept layers
  `merge` onto (`RequiredColumnsContainer`/`CloseMiniPageButton` from the base layer; `EditButtonsContainer`/`Phone`
  from the customer layer — all real base items supplied by the dropped boilerplate on the full page) plus ≥5
  methods (so it is not flagged skeletal). The seed is scaffolding; the real part is the layer chain.
- **Layers.** Two replacing layers carry the real diff and are kept verbatim: **`CrtUIv2`** (base layout — 19
  inserts / 3 merges: the actual `Name`/`Account`/`JobTitle`/`Owner`/photo/job-info fields) and **`WorkLeadBase`**
  (customer/product overrides — 1 insert / 11 merges). The two empty passthrough layers (`CrtDeduplication`,
  `WorkOverride` — 0 diff ops) are dropped, exactly like `activityminipage/` drops its empty passthroughs. The
  layers are **not** merged by hand: the engine's base-suppression is layer-aware, so collapsing them into one body
  changes the result.
- **entityColumns** trimmed to the columns the kept layers bind (real types, verbatim from the capture);
  `resources` dropped (captions resolve to keys and are not needed for the fold).

## Re-capturing / refreshing

```bash
clio-run get-classic-page-sources --schema-name ContactMiniPage --environment-name <workenu-stand> --output-file <scratch>/contactminipage.json
```

Then keep the layers with actual `insert`/`merge`/`remove` operations, swap the platform seed for the compact
example seed above (defining every container/item the kept layers `parentName`/`merge`-target), and trim
`entityColumns` to the bound columns. The golden asserts a gate-clean, structure-complete fold in which the real
contact fields (`Name`, `Account`) survive into the Freedom layout.
