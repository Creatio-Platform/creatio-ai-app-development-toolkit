export const meta = {
  // Namespaced because the installer mirrors this script into user scope
  // (~/.claude/workflows/<name>.js), which is shared across every project and
  // plugin — an unprefixed `classic-behaviour-analysis` is generic enough to be
  // shadowed by a project-scope workflow of the same name. Keep `name` and that
  // mirrored basename identical: named-workflow resolution may key on either.
  name: 'creatio-classic-behaviour-analysis',
  description:
    'Step 5.1 of a Classic→Freedom migration: describe the imperative rows the engine can enumerate but not explain. One Context agent builds the stand-wide census and the shared core, a size-adaptive fan-out describes each surface scope through the classic-ui-expert skill, a Critique agent hunts UNCOVERED rows, and Merge emits one report plus the behaviourIndex the plan folds in. Coverage is computed in the script, never asserted by an agent.',
  phases: [
    { title: 'Context', detail: 'one agent: census + shared core (base chain, mixins, message register) + the row inventory' },
    { title: 'Describe', detail: 'one agent per scope batch — count decided from the inventory, not fixed' },
    { title: 'Critique', detail: 'one agent: which rows carry no card, which cards conflict, which refusal a sibling settles' },
    { title: 'Merge', detail: 'one agent: dedupe the cards, emit customizations.md + behaviour-index.json' },
  ],
}

// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT BY HAND.
//
// The orchestration below is the HOST-NEUTRAL workflow core in
// `skills/_workflow-core/`, inlined here because a Claude Workflow script cannot
// `import`: the host evaluates it as a function body with only `args`, `log`,
// `phase`, `agent` and `parallel` injected. The same core is what the Codex and
// generic-CLI adapters run through `_workflow-core/cli.mjs`, which is what makes
// a run's decisions and its coverage verdict identical across hosts.
//
// To change behaviour, edit the core module and re-generate:
//     node scripts/build-workflows.mjs           # write
//     node scripts/build-workflows.mjs --check   # CI: fail on drift
//
// Inputs (Workflow `args`):
//   { manifest:    string,   // REQUIRED: path to the engine manifest (the one --plan runs on)
//     digest:      string,   // REQUIRED: path written by `migrate.mjs <manifest> --stubs --out <file>`
//     environment: string,   // REQUIRED: registered clio environment name (read-only against it)
//     outDir:      string,   // REQUIRED: the migration folder — report + index land here
//     sectionSchema?: string, // surface label for the prompts (e.g. 'OpportunitySectionV2')
//     totals?: object,        // the digest's own `totals` — lets the run exit before spending any agent when the
//                             //   surface has no imperative rows at all (measured: a real custom section reported 0)
//     rowsPerAgent?: number,  // override the Describe batch target
//     maxDescribeAgents?: number } // hard cap on the fan-out
//
// A bare string is taken as `manifest` so a caller can pass just that; every
// other required input then has to come from the object form, and the script
// fails loudly rather than guessing a path.
// ---------------------------------------------------------------------------

// ---8<--- PURE DECISION HELPERS ---8<---
/*@INLINE@*/
// ---8<--- END PURE DECISION HELPERS ---8<---

// --- the Claude Code host, and nothing else ---------------------------------
// Everything above this line is host-neutral and shared. The five lines below are
// the entire Claude-specific surface of this workflow: the injected globals go in,
// the core's own return value comes out.
const state = newRun({ workflow: WORKFLOW, input: normalizeInput(args), host: CLAUDE_HOST })
return await driveOnClaude({
  core: run(state.input, { log, phase }),
  run: state,
  io: { log, phase },
  agent,
  parallel,
  requires: WORKFLOW_REQUIRES,
})
