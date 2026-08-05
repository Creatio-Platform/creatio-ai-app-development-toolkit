# Classic→Freedom engine goldens

Regression gate for the deterministic merge engine + mapper that ship in
`skills/classic-to-freedom-migration/engine/`. Kept **outside** the skill so the
shipped skill directory carries runtime code only (no test harness or fixtures).

- `run.mjs` — merge-engine goldens (`mergeLayers`): layer order (F1), base-template seed (F2), tombstones, provenance.
- `run-mapper.mjs` — mapper + design-spec/plan goldens (`mapToFreedom` / `renderDesignSpec` / `renderPlan` / `migrate.mjs`).
- `_testkit.mjs` — tiny layer/op builders shared by both runners.
- `fixtures/` — synthetic Classic-schema layer bodies used as deterministic inputs.

The runners import the engine from `../../skills/classic-to-freedom-migration/engine/` by relative path.

## Run
```
node run.mjs && node run-mapper.mjs   # from this directory; exit 1 on any failed check
```
This is exactly what the CI job **Classic→Freedom engine goldens** runs.
