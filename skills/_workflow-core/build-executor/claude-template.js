export const meta = {
  // Namespaced because the installer mirrors this script into user scope
  // (~/.claude/workflows/<name>.js), which is shared across every project and
  // plugin. Keep `name` and that mirrored basename identical: named-workflow
  // resolution may key on either.
  name: 'creatio-freedom-build-executor',
  description:
    'Build an APPROVED Classic→Freedom migration plan on a live stand until the engine gate is green. Reconcile reads the queue file and runs `--units` + `--verify --verify-json` to learn what the stand already has, Preflight resolves the ⚠ worklist in parallel (read-only), Build runs SEQUENTIALLY leaf-first with one fresh-context agent per page, a SEPARATE read-only verifier assembles `--built` from get-page, a THIRD agent writes only `judge`, and repair rounds run until every unit closes or is parked. Every verdict is arithmetic over the engine\'s own numbers, never an agent\'s assertion.',
  phases: [
    { title: 'Reconcile', detail: 'one read-only agent: queue file + `--units` + a get-page sweep + `--verify --verify-json` — the baseline, and the round counters, written BEFORE the round runs' },
    { title: 'Refs', detail: 'one read-only agent, once per run: caches the guidance/contracts/component docs every fresh-context builder would refetch, and writes the per-page spec slice' },
    { title: 'Preflight', detail: 'parallel read-only agents: resolve the ⚠ Confirm worklist into evidence records (no stand writes)' },
    { title: 'Build', detail: 'SEQUENTIAL — one agent per page unit, leaf-first, fresh context; the stand is a shared mutable resource' },
    { title: 'Verify', detail: 'one read-only agent: get-page every built key → `pages` / `reachability` / `evidence` in the built file' },
    { title: 'Judge', detail: 'a THIRD agent: writes only `judge` — one { convincing, why } per evidence id' },
    { title: 'Close', detail: 'the final `--verify` table, the parked units with their reasons, the plan gaps and the proposals' },
  ],
}

// OPERATING MODES (`mode`) — FIVE, on TWO stop mechanisms, and there is NO DEFAULT (ENG-96204). A run launched
// without a `mode` and without a `defaultMode` returns `stopped: 'mode-not-chosen'`, lists the valid modes and
// writes nothing: `auto` used to be the default and it was the one answer an operator cannot un-choose.
//   UNIT-boundary stops (`stopped: 'paused-at-checkpoint'`): `checkpoints` stops after each unit named in
//   `checkpointAfter` so a human can open that page on the stand and exercise it · `guided` stops after every unit.
//   ROUND-boundary stops (`stopped: 'paused-at-round'`): `round1` runs ONE round per invocation and stops while
//   anything is open · `layout-first` builds LAYOUT only in round 1, stops, and ports the business logic on the
//   next invocation. Both report `built`, `openRanked` (correctness before fidelity), `parked` and `next`, and
//   write the same four facts to `<outDir>/run-status.md`.
//   `auto` stops at neither.
// A stop is always a BOUNDARY and never `complete`. Re-running with the same args continues from the queue file;
// in a round-boundary mode the re-run also needs `{ "kind": "run", "item": "round-<N>" }` in `resolutions.json`,
// or it returns `stopped: 'awaiting-round-decision'` and builds nothing. Adding `findings: [{ unit, problem }]`
// re-opens a unit the gate calls complete, which is the only route a defect in a ported handler has (those rows
// are not gated) — and it is NOT a channel for answering a question.

// ---------------------------------------------------------------------------
// Inputs (Workflow `args`):
//   { manifest:    string,   // REQUIRED: path to the engine manifest the approved plan was rendered from
//     environment: string,   // REQUIRED: registered clio environment name (this run WRITES to it)
//     outDir:      string,   // REQUIRED: the migration folder — queue file, built file, verify table land here
//     planFile:    string,   // REQUIRED: the approved plan.md — its version must match the recorded approval
//     engine:      string,   // REQUIRED unless derivable: `migrate.mjs`, or the `engine/` directory holding it
//     customizations?: string,  // step 5.1's customizations.md — the behaviour cards an imperative row is ported from
//     behaviourIndex?: string,  // step 5.1's behaviour-index.json, as merged into the manifest
//     sectionSchema?: string,   // surface label for the prompts
//     verificationSurface?: string, // 'automatic:2' | 'automatic:3' | 'manual' — the migration skill's
//                            // verification-surface preflight answer for this section (ENG-95855); absent -> null,
//                            // never guessed. Threaded into each page unit's render-check instruction.
//     dryRun?:     boolean,  // PREVIEW: stop before the first stand WRITE and report what would be built
//     mode?:       string,   // 'auto' | 'checkpoints' | 'guided' | 'round1' | 'layout-first' — how much of the
//                            // build the operator watches. NO DEFAULT (ENG-96204): with no `mode`, no
//                            // `defaultMode` and no run-scoped `control-mode` answer the run stops
//                            // `mode-not-chosen` before any stand write. An unknown value THROWS.
//     defaultMode?: string,  // the SAME vocabulary, as the declared fallback for a NON-INTERACTIVE run: nobody is
//                            // there to be asked, so a run that carries one proceeds and reports
//                            // `modeSource: 'default'`. Validated at launch, so a typo fails before the run starts.
//     checkpointAfter?: string[], // mode 'checkpoints': the PUBLISHED unit keys to stop after (unknown key ⇒ refuse)
//     findings?:   Array<{ unit: string, problem: string }>, // what the operator saw wrong at a checkpoint;
//                            // re-opens that unit even when the gate calls it complete, and is handed to its builder
//     maxRounds?:  number,   // repair rounds per unit before it is PARKED (default 3)
//     resolutionsFile?: string, // the operator's ANSWERS (default `<outDir>/resolutions.json`; absent = none yet) —
//                            // both the ⚠ Confirm answers and, under the reserved kind `run`, the RUN-level ones:
//                            // `{ kind: 'run', item: 'control-mode' }` and `{ kind: 'run', item: 'round-<N>' }`.
//                            // ONE channel: there is no second state file for either decision.
//     maxPreflightAgents?: number } // cap on the read-only preflight fan-out (default 6)
//
// A bare string is taken as `manifest`; every other required input then has to
// come from the object form and the script fails loudly rather than guessing.
//
// WHY THE SHAPE IS THIS WAY. A workflow script has no filesystem and no shell:
// it cannot read the queue file, cannot run `migrate.mjs`, cannot call clio. An
// AGENT does each of those and returns STRUCTURED numbers; every decision here —
// which units are open, whether a unit is parked, whether the run stops on a plan
// gap, whether the whole thing is complete — is then arithmetic in this script.
// That is the point. `--verify --verify-json <file>` PUBLISHES that verdict as
// JSON — `{ complete, missing, unverified, builderOpen, planGaps, pages: { "<key>":
// { complete, buildComplete, builderOpen, missing, unverified, openRows } } }` — and
// `RECONCILE_SHAPE.verify` below mirrors the COUNTS-ONLY `--verify-summary` cut of it
// (ENG-95930): same per-page fields, no `openRows`, no TOP-LEVEL `builderOpen` —
// that one is `--verify-json`'s alone — and, since ENG-95857, no `planGaps` either:
// the plan-level verdict has ONE home, `--units.planGaps`, and this channel is the
// BUILD verdict. The rest of the table is field for field (the host schema
// declares the properties; their insides live in that table). The reconcile agent copies the file; it does not read the
// Markdown table and it does not re-derive a number. Before that file existed the
// only per-page counts were in a table an agent had to transcribe, which put a
// paraphrase between the engine's arithmetic and this script's.
//
// The engine CLI cannot be talked out of its answer either: `--built` is rejected
// at exit 1 unless every page entry carries a real `viewConfig` from get-page, so
// an agent cannot hand-author the payload it is being gated on. It also demands
// `schemaUId` VERBATIM from `get-page` (`page.schemaUId`), unique per key, with one
// `packageUId` per `packageName`: `--units` publishes no GUID of any kind, so those
// identities cannot be derived from the plan — only copied out of a real read. That
// proves internal consistency, not origin (the engine is offline and cannot ask
// Creatio whether a GUID exists), but a payload assembled from the plan alone no
// longer passes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT BY HAND.
//
// The orchestration below is the HOST-NEUTRAL workflow core in
// `skills/_workflow-core/`, inlined here because a Claude Workflow script cannot
// `import`: the host evaluates it as a function body with only `args`, `log`,
// `phase`, `agent` and `parallel` injected. The same core is what the Codex and
// generic-CLI adapters run through `_workflow-core/cli.mjs`, which is what makes
// a build's decisions and its verdict identical across hosts.
//
// To change behaviour, edit the core module and re-generate:
//     node scripts/build-workflows.mjs           # write
//     node scripts/build-workflows.mjs --check   # CI: fail on drift
//
// `engine-tests/classic-to-freedom/run-workflow-parity.mjs` drives THIS file and
// the hand-written original it replaced against the same scripted host and
// requires an identical phase sequence, agent dispatch order and return value.
// ---------------------------------------------------------------------------

// ---8<--- PURE DECISION HELPERS ---8<---
/*@INLINE@*/
// ---8<--- END PURE DECISION HELPERS ---8<---

// --- the Claude Code host, and nothing else ---------------------------------
// Everything above this line is host-neutral and shared. Below is the entire
// Claude-specific surface of this workflow: the injected globals go in, the
// core's own return value comes out. `__filename` is how the engine and the
// reference docs are located — the host exposes it because it wraps this body in
// a function, where `import.meta` would be a parse error.
const state$ = newRun({ workflow: WORKFLOW, input: normalizeInput(args), host: CLAUDE_HOST })
return await driveOnClaude({
  core: run(state$.input, { log, phase }, { selfPath: typeof __filename === 'string' ? __filename : '' }),
  run: state$,
  io: { log, phase },
  agent,
  parallel,
  requires: WORKFLOW_REQUIRES,
})
