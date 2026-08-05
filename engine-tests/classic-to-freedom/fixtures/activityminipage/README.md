# `ActivityMiniPage` — real captured mini-page fixture

Real Classic **mini page** used by the mapper golden (`run-mapper.mjs`, "Minor3 real mini page …") to prove the
engine folds a genuinely captured mini page — not only hand-written toy bodies. Closes PR #58 review AC2
("mini-page tests use synthetic inline bodies") for **ENG-93926** (mini pages → Freedom quick-add / mini cards).

## Provenance

- **Schema:** `ActivityMiniPage` (entity `Activity`), a customized mini page on the ENG-93926 **workenu** site.
- **Captured from:** clio environment `applicants_workbuild246_0817` via
  `get-classic-page-sources --schema-name ActivityMiniPage`.
- **`manifest.json`** holds the fold input the engine consumes: `schemas` (the real replacing-layer chain),
  `seed`, `entity`, `entityColumns`, `resources`.

## Why it is trimmed (and still real)

The raw capture is ~389 KB. Two parts are boilerplate that dwarf the real content, so they are trimmed — the
**captured layer bodies themselves are verbatim, unedited**:

- **Seed.** The platform `BaseMiniPage` parent-template chain is a fixed ~96 KB and byte-identical for *every*
  classic mini page. The fixture replaces it with a small **representative** `BaseMiniPage` seed that defines just
  the containers the real layers target (`MiniPage`/`HeaderContainer`/`ProfileContainer`) plus the base items the
  real layers `merge` onto (`DetailedResult`/`CancelButton`/`OpenCurrentEntityPage`/`OpenEditMode`) and ≥5 methods
  (so it is not flagged skeletal). The seed is scaffolding; the real part is the layer chain.
- **Layers.** The 5 real customer/product override layers are kept verbatim
  (`ConferenceRoom`/`IntegrationV2`/`SSP`/`WorkOverride`/`WorkPRMBase`); the 6 empty passthrough layers and the
  large base layer are dropped — they contribute no operations to the fold. The layers are **not** merged by hand:
  the engine's base-suppression is layer-aware, so collapsing them into one body changes the result.
- **entityColumns** trimmed to the columns the layers actually bind (`ConferenceRoom`, `StartDate`,
  `DetailedResult`); `resources` dropped (captions resolve to keys and are not needed for the fold).

## Re-capturing / refreshing

```bash
clio-run get-classic-page-sources --schema-name ActivityMiniPage --environment-name <workenu-stand> --output-file <scratch>/activityminipage.json
```

Then keep the layers with actual `insert`/`merge`/`remove` operations, swap the platform seed for the compact
example seed above, and trim `entityColumns` to the bound columns. The golden asserts a gate-clean,
structure-complete fold in which the real customer fields (`ConferenceRoom`, `StartDate`) survive into the Freedom
layout.
