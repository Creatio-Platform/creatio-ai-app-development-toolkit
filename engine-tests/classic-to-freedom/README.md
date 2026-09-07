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

ONE command, and it is the module's own declaration of what verifying it means:

```
cd ../../skills/classic-to-freedom-migration/engine && npm test
```

`scripts.test` in that `package.json` is the single source of truth for the sequence — the vendored-parser
integrity gate, the four golden runners, the generated-workflow drift check and the parity runner, in that order.
The CI job **Classic→Freedom engine goldens** runs the same commands as separate steps, so that one runner's
failure does not hide another's, and `run-infra.mjs` asserts that the two lists match. Do NOT hand-maintain a
third list here: a contributor who ran a subset of the gate pushed a branch that failed checks they had no way to
know to run, which is what this section used to cause.

Individual runners (from this directory) while iterating on one area:

```
node run.mjs            # merge-engine goldens
node run-mapper.mjs     # mapper / design-spec / plan / migrate.mjs goldens
node run-infra.mjs      # infra parsers + the shipped pure-decision block
```
