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
node migrate.mjs <manifest.json> --plan --out plan.md   # WRITE the artifact to a file (present that file, not stdout)
```

`--out <file>` writes the `--plan`/`--spec` output to a file so the agent presents the file verbatim instead
of hand-pasting stdout (its Overview/Main-scope values come from `manifest.planMeta`).

**Exit codes & gates.** Bad input (missing/invalid manifest, unreadable schema `file`) → exit **1**. Otherwise
the run computes two gates — `gate.blocked` (correctness: parse errors / unresolved parents / merge warnings /
skeletal seed) and `structure.complete` (input completeness: unresolved detail / child-page schemas). If either
is bad the CLI prints a `⛔` banner to stderr and exits **2** (the artifact is still written/printed, with the
banner at the top, so you see *what* to fix). Exit **0** = both gates clear = an approvable plan.

## Files

- `engine.mjs` — `parseSchema()` (AST parse of a classic `define(...)` body — reads the returned object, never executes it) + `mergeHierarchy()` (replay the layer chain into one effective page + provenance).
- `vendor/acorn.mjs` — vendored **acorn 8.17.0** (MIT), the JS parser `parseSchema` uses; keeps the engine self-contained (no `npm install`). **Not in `package.json` by design** (zero runtime deps) — so there is no automatic security patching: track acorn advisories manually and re-vendor the bundle (updating this version note) when a relevant fix ships. `vendor/acorn-LICENSE.txt` holds its license.
- `mapper.mjs` — `mapToFreedom()` (effective page → Freedom ChangeSet + `needsDecision[]`).
- `designspec.mjs` — render the plan / design spec as Markdown.
- `migrate.mjs` — CLI driver.

## Tests & internals

Golden runners, fixtures and the detailed engine-internals notes live **outside** the shipped skill, in
`engine-tests/classic-to-freedom/` (see its `README.md` and `engine-internals.md`), so this folder ships
runtime-only.
