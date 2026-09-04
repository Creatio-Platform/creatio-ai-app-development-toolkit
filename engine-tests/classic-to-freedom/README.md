# Classic→Freedom engine goldens

Regression gate for the deterministic merge engine + mapper that ship in
`skills/classic-to-freedom-migration/engine/`. Kept **outside** the skill so the
shipped skill directory carries runtime code only (no test harness or fixtures).

- `run.mjs` — merge-engine goldens (`mergeLayers`): layer order (F1), base-template seed (F2), tombstones, provenance.
- `run-mapper.mjs` — mapper + design-spec/plan goldens (`mapToFreedom` / `renderDesignSpec` / `renderPlan` / `migrate.mjs`).
- `run-infra.mjs` — gate/CLI-infrastructure goldens (`validateStructure`, `bundleWarningState`, `buildCoverage`, `approvalsSignalOf`, `--stubs` totals, the `--plan --out` / `<plan>.notes.md` split).
- `run-workflow-core.mjs` — goldens over the shared workflow core in `skills/_workflow-core/` and the generator that emits the shipped `*.workflow.js` from it.
- `run-workflow-parity.mjs` — DIFFERENTIAL goldens: each shipped (generated) workflow script against the hand-written BASELINE it replaced, under `baseline/`. Read its header before touching anything there: the baselines are **FROZEN** and are never regenerated from the working tree, because a baseline refreshed from the thing under test proves nothing. When a behaviour change is intended, the diff is reviewed and the baseline is replaced deliberately, in its own commit.
- `_testkit.mjs` — tiny layer/op builders shared by both runners.
- `fixtures/` — Classic-schema layer bodies used as deterministic inputs. Mostly synthetic; `fixtures/applicantpage/` is the one **captured real** record page (`Applicant1Page`), a two-layer fold that pins how many handler rows the engine can TRACE a trigger for on a page whose declarations it had all already parsed and then thrown away. Its `README.md` states, per member, what is verbatim, what was moved between layers, what was trimmed and what was authored for the fixture — read that before changing a byte of it.
- `baseline/` — the frozen hand-written predecessors `run-workflow-parity.mjs` compares against. Not fixtures; see above.

The runners import the engine from `../../skills/classic-to-freedom-migration/engine/` by relative path.

## Run
```
node run.mjs && node run-mapper.mjs && node run-infra.mjs && node run-workflow-core.mjs   # from this directory
node run-workflow-parity.mjs                                                              # differential, reported separately
```
Each exits 1 on any failed check. This is exactly what the CI job **Classic→Freedom engine goldens** runs.
