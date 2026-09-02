# `_workflow-core` — the host-neutral migration workflow core

The Classic→Freedom migration's orchestration used to be written directly against
the Claude Code Workflow runtime: `agent()`, `parallel()`, `phase()` and `args`
injected as globals into a `.workflow.js` file. That made the migration *logic*
portable — `migrate.mjs`, the manifests, the plans, the artifacts are all plain
files — while the *orchestration* ran on exactly one host. Codex and other coding
agents could perform individual operations but could not reproduce the workflow's
guarantees without hand-rebuilding them, and a hand-rebuilt run is not the same
run.

This directory is the fix. The deterministic part of the orchestration lives here
as ordinary ES modules with no vendor API in them; each host gets a thin adapter.

**This directory is not a skill.** It carries no `SKILL.md` on purpose — the
installer enumerates skills by `skills/*/SKILL.md`, so this tree ships with the
plugin (it is inside `skills/`, which `.release-manifest.json` publishes whole)
without being offered as one.

## Layout

```
_workflow-core/
  work-item.mjs        the work-item protocol + the THREE outcomes
  capabilities.mjs     what a host can do, and what it may not silently do without
  run-state.mjs        the run + its journal, as pure data (no I/O)
  driver.mjs           drive() — execute now;  advance() — replay-only, stop at pending
  cli.mjs              migration-workflow start | next | submit | status | resume
  behaviour-analysis/  step 5.1: the Classic-behaviour analysis run
    core.mjs           function* run(input, io) — the state machine
    helpers.mjs        the decisions: batching, coverage arithmetic, the retry
    schemas.mjs        the response contracts
    prompts.mjs        the prompt text, as pure builders
    claude-template.js the shell the generated .workflow.js is built from
  build-executor/      step 7: build the approved plan on a live stand
    core.mjs           function* run(input, io, { selfPath }) — the round loop
    helpers.mjs        the decisions: schedule, parks, approval + package gates,
                       and the walker that checks an answer against a shape table
    schemas.mjs        the response contracts: the host schemas AND `RECONCILE_SHAPE`,
                       the inner shape of the fields the schema declares loosely to
                       stay under the host's 4096-byte cap
    context.mjs        paths, engine command lines, the shared prompt preamble
    claude-template.js the shell the generated .workflow.js is built from
  adapters/
    claude-workflow.mjs  work item → agent();  outcome → the protocol
    codex.mjs            capability declaration for a Codex session
    generic-cli.mjs      the safe floor for an unknown host, + remedies
```

## The shape: a generator that yields work

A workflow core is a **generator**. It yields *work steps* and receives their
outcomes back; everything between two yields is arithmetic over what the previous
phase returned.

```js
export function* run(input, io) {
  io.phase('Context')
  const [ctx] = yield step({ items: [ /* one work item */ ], requires: ['subAgents'] })
  // …decide the fan-out from ctx, in code…
  const described = yield step({ items: batches.map(describeItem), parallel: true })
  // …compute coverage from `described`, never ask an agent whether it is complete…
  return verdict
}
```

Two consequences make the whole thing work:

- **No host API in the core.** `log` and `phase` arrive as `io`, so there is
  nothing to stub and nothing to shadow. The suite drives the real core with a
  scripted host and asserts the decisions.
- **Determinism ⇒ resume by replay.** The core never reads the clock, never uses
  randomness and never touches the filesystem, so replaying the recorded outcomes
  reconstructs the state exactly. That is the entire resume mechanism; a killed
  run comes back by re-running `next`.

## The work item

```json
{
  "id": "describe.1.main-page",
  "phase": "Describe",
  "role": "classic-ui-expert",
  "prompt": "…",
  "promptFile": "prompts/describe.1.main-page.prompt.md",
  "inputFiles": ["d.json", "out/customizations-shared-core.md"],
  "responseSchema": { "type": "object", "required": ["reportPart", "indexEntries"] },
  "access": "stand-read-only",
  "capabilities": ["structuredOutput"],
  "label": "describe:main page"
}
```

`role` names the *contract* the item must be performed under, not an agent type —
`classic-ui-expert` means the analysis contract (member ledger, counted zeros,
refusals, numbered acceptance criteria). `access` is the per-item safety level:
an analysis phase says `stand-read-only` and a host that cannot honour that must
not run it.

### The three outcomes — the part an adapter most easily gets wrong

| outcome | how it reaches the core | what it means |
|---|---|---|
| `value` | `it.next([value])` | the item answered |
| `death` | `it.next([null])` | terminal death — the host already exhausted its own retries |
| `error` | `it.throw(err)` on a single-item step | the attempt REJECTED: host refused, schema threw, prompt malformed |

A rejection **inside a parallel batch** becomes a `null` hole rather than a throw,
because that is what Claude Code's `parallel()` itself does — it never rejects —
and a core written against that contract must see the same shape everywhere.

Collapsing `death` and `error` was a real defect: the retry loop reports *why* a
phase died, and one generic line left "the host refused" indistinguishable from
"it returned nothing". `driver.mjs` is the only place that maps outcomes, so a
second adapter cannot invent a different convention.

## Capability negotiation

An adapter declares what it has; the core declares what each step needs.

| capability | degradable? | absent ⇒ |
|---|---|---|
| `parallelism` | **yes** | run in waves, and LOG the reduction |
| `subAgents` | no | explicit stop |
| `structuredOutput` | no | explicit stop |
| `independentRoles` | no | explicit stop |
| `humanApproval` | no | explicit stop |
| `persistentState` | no | explicit stop (no resume) |

Only wall-clock is negotiable. A host that cannot give the Critique phase a
context that did not write the cards it is checking gets a `CapabilityError` —
not a run that quietly self-reviews and reports the same green verdict. Every run
records which adapter executed it (`run.host`, plus a `hostHistory` when a resume
changes hosts).

## Running it

### Claude Code

`Workflow({ name: 'creatio-classic-behaviour-analysis', args: { … } })` — unchanged.
The shipped `.workflow.js` is **generated**: the core is inlined into it because a
workflow script cannot `import` (the host evaluates it as a function body with
only `args`, `log`, `phase`, `agent`, `parallel` injected).

```bash
node scripts/build-workflows.mjs           # regenerate after editing the core
node scripts/build-workflows.mjs --check   # CI gate: fail on drift
```

The inlined block sits between the `---8<--- PURE DECISION HELPERS ---8<---`
sentinels, so the offline suite that slices that block out of the *shipped*
artifact and imports it keeps testing what actually ships.

### Codex, or any host with Node.js and a filesystem

```bash
CORE=skills/_workflow-core

# --workflow: classic-behaviour-analysis (step 5.1) | freedom-build-executor (step 7)
node $CORE/cli.mjs start run.json \
  --workflow classic-behaviour-analysis --input input.json --host codex

# 1. what to do next — phase, role, prompt, input files, response schema, access
node $CORE/cli.mjs next run.json --out prompts/

# 2. perform it (one agent per item keeps the roles independent), then:
node $CORE/cli.mjs submit run.json <item-id> result.json
#    …or record the failure honestly:
node $CORE/cli.mjs submit run.json <item-id> --death
node $CORE/cli.mjs submit run.json <item-id> --error "529 overloaded"

# 3. repeat until `next` reports {"status":"done", …}
node $CORE/cli.mjs status run.json     # where the run is, without advancing it
node $CORE/cli.mjs resume run.json     # = next, after an interruption
```

Declare the session honestly: `--parallelism N` if items can run concurrently,
`--no-independent-roles` / `--no-sub-agents` if they cannot. A missing guarantee
then stops the run with the remedy and exit code 3, which is the intended answer —
not something to work around.

`submit` refuses a result that misses a required key of the item's
`responseSchema`, and refuses a result for an item the core is not waiting for. A
result the core would misread must not enter the journal.

**The build executor writes to a live stand**, so its refusals matter more than
the analysis run's. `freedom-build-executor` declares `independentRoles` at the
RUN level: a host that cannot give the verifier and the judge contexts of their
own is stopped *before the first stand write*, not at the phase that needs it.
Its `Build` items are the only ones that carry `access: "stand-write"`, and they
are dispatched one unit at a time by construction — the stand is a shared mutable
resource, so a build step is never part of a parallel batch.

### Integrating a new host

1. `declareHost({ id, … })` in an adapter — the id is what the run records.
2. Either drive inline with `drive({ core, run, host, execute, io })`, where
   `execute(item)` resolves `{ outcome, value? , error? }`, or drive through the
   CLI's `next`/`submit` loop.
3. Do not reimplement a decision. Batching, coverage, the repair round, parking
   and the completion verdict belong to the core; an adapter that recomputes one
   of them is how two hosts start disagreeing.

## Adding a workflow

1. Write `<name>/core.mjs` exporting `WORKFLOW`, `WORKFLOW_REQUIRES`,
   `normalizeInput`, `assertInput` and `function* run(input, io)`.
2. Register it in `cli.mjs`'s `WORKFLOWS` map.
3. Add a `claude-template.js` and a `TARGETS` entry in
   `scripts/build-workflows.mjs` (module order is declared, not derived — the
   list is short enough to check by eye, and the generator fails loudly on a
   top-level name collision).
4. Extend `engine-tests/classic-to-freedom/run-workflow-core.mjs`: the protocol,
   the capability stops, resume, and **cross-host parity** — the Claude adapter
   and the CLI must return the identical result for identical inputs.
5. If the workflow REPLACES a hand-written script, commit that script under
   `engine-tests/classic-to-freedom/baseline/` and add the pair to
   `run-workflow-parity.mjs`. It drives both against one scripted host and
   requires an identical phase sequence, agent dispatch order, **prompt text byte
   for byte** and return value. The prompt leg is not decoration: the first port
   re-indented the source, which re-indented every prompt's rule bullets by two
   spaces — phases, labels and the return value were all still identical. An
   intended prompt change goes in that runner's `ALLOWED_PROMPT_DIVERGENCES` with
   its reason; nothing else is tolerated.

## Editing a core: the two traps

- **Never re-indent a body that builds prompts.** Almost every string in these
  cores is a multi-line template literal that becomes an agent's prompt, so
  indenting the source indents the prompt. Both cores keep their inner code flat
  inside the function that wraps it, and say so at the top.
- **Never write `import.meta` in a core module.** The generator inlines it into a
  script the host evaluates as a function body, where `import.meta` is a parse
  error. A core that needs its own location takes `selfPath` as a parameter; the
  adapter passes `__filename` (Claude) or its own resolved path (the CLI).
