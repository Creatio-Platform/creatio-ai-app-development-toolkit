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
know to run, which is what naming a subset here would cause.

Individual runners (from this directory) while iterating on one area:

```
node run.mjs            # merge-engine goldens
node run-mapper.mjs     # mapper / design-spec / plan / migrate.mjs goldens
node run-infra.mjs      # infra parsers + the shipped pure-decision block
```

## Lint and coverage

Both use contributor-only tooling declared in the repo-root `package.json` (ESLint, c8). None of it ships: that
file is outside `.release-manifest.json` `plugin_runtime`, nothing under `skills/` or `hooks/` imports it, and the
engine's own `package.json` above keeps zero dependencies. Install it once from the repo root:

```
npm ci --ignore-scripts
```

**Lint.** From the repo root, `npm run lint`. The config is `eslint.config.mjs`: the
recommended rule set over `skills/**/*.mjs`, `hooks/**/*.mjs` and `scripts/*.mjs`, ignoring the vendored parser,
the generated component registry, the generated `*.workflow.js` files and these goldens (fixtures and baselines
included). The CI job **ESLint (skills, hooks, scripts)** runs the same command and fails on any finding.

**Coverage.** Node writes raw V8 coverage for every process started while `NODE_V8_COVERAGE` points at a
directory, so the gate is measured without changing how any runner is invoked. From the repo root, in bash:

```
rm -rf coverage
export NODE_V8_COVERAGE="$PWD/coverage/tmp"
(cd skills/classic-to-freedom-migration/engine && npm test)
unset NODE_V8_COVERAGE
npm run coverage:report
```

`coverage:report` prints the per-file table (statements, branches, functions, lines; `All files` is the overall
total) and writes `coverage/lcov.info`, `coverage/index.html` and `coverage/coverage-summary.json`. It reports
every `.mjs` file in the lint scope, including ones no runner loads, which therefore show 0%. No threshold is
enforced. In CI the ubuntu leg of **Classic→Freedom engine goldens** collects coverage across all of its steps,
publishes the table in the job summary and uploads the report as the `engine-coverage` artifact; the windows leg
runs without coverage.

**Baseline.** The first CI measurement, taken before any threshold existed
([run 36423655995](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/actions/runs/36423655995),
ubuntu leg, commit `0a79fda`):

| Scope | Statements / lines | Branches | Functions |
|---|---|---|---|
| All files | 90.64% | 87.94% | 97.87% |
| `skills/classic-to-freedom-migration/engine` | 98.58% | 88.53% | 98.85% |
| `skills/_workflow-core` | 98.54% | 80.14% | 100% |
| `skills/_workflow-core/adapters` | 100% | 80.64% | 100% |
| `skills/_workflow-core/behaviour-analysis` | 98.97% | 84.50% | 98.11% |
| `scripts` | 52.62% | 71.42% | 77.77% |
| `hooks` | 0% | 0% | 0% |

Per engine module (lines / branches): `tasks.mjs` 99.40 / 87.37, `assemble.mjs` 100 / 95.21, `report.mjs`
99.28 / 82.83, `split.mjs` 100 / 90.47, `designspec.mjs` 98.56 / 90.26, `engine.mjs` 98.72 / 87.51, `mapper.mjs`
99.80 / 89.10, `migrate.mjs` 97.60 / 87.92, `reads.mjs` 90.36 / 78.87, `verify-vendor-upstream.mjs` 61.68 / 76.00
(its network path runs only in the separate upstream-authenticity job). `hooks/` reads 0% because its tests are
the pytest suite, which runs in its own job without coverage; `scripts/` is low because two of its four `.mjs`
scripts are never started by this job. V8 line coverage over-counts slightly, so branches are the stricter number.
