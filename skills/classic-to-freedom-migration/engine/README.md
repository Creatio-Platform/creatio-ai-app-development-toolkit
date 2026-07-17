# Classic → Freedom migration engine

Deterministic, offline Node module. It reconstructs the *effective* Classic page from N `ClientUnitSchema`
layers (base → top) and maps it to a Freedom **ChangeSet** + plan/design-spec. No Creatio/stand dependency:
the skill fetches the schema bodies (via clio) and passes them in a manifest; the engine only transforms.

## Usage

Invoked by the skill as a CLI — see `../SKILL.md` step 4:

```
node migrate.mjs <manifest.json>          # full JSON: effective page + ChangeSet + needsDecision[] + gates
node migrate.mjs <manifest.json> --plan   # render the migration plan (Markdown)
node migrate.mjs <manifest.json> --spec   # render just the per-page design spec (Markdown)
```

## Files

- `engine.mjs` — `parseSchema()` (sandboxed parse of a classic `define(...)` body) + `mergeHierarchy()` (replay the layer chain into one effective page + provenance).
- `mapper.mjs` — `mapToFreedom()` (effective page → Freedom ChangeSet + `needsDecision[]`).
- `designspec.mjs` — render the plan / design spec as Markdown.
- `migrate.mjs` — CLI driver.

## Tests & internals

Golden runners, fixtures and the detailed engine-internals notes live **outside** the shipped skill, in
`engine-tests/classic-to-freedom/` (see its `README.md` and `engine-internals.md`), so this folder ships
runtime-only.
