# Running the step-5.1 behaviour analysis

Read this only when SKILL.md step 5.1's condition holds — the `--stubs` digest counts at least one
row that needs a behaviour card. It is how to run the `classic-ui-expert` analysis and what to hand
it; what you take back and where it lands in the plan stay in SKILL.md step 5.1.

**How to run it — the route, in order of preference.** The deliverable is the same two files
whichever route you take (a persisted report + its index), so pick by what the host actually allows,
and say in `worklog.md` which route ran.

> **ROUTE GATE — resolve it in ONE turn, before you spend any context on the run.** Some sessions
> carry a host instruction ("do not use workflows / do not call the Agent tool unless the user
> requested it") that sits ABOVE this file: it is in the session's system prompt, and no sentence
> here can grant a permission it withholds. Asserting that the skill invocation is opt-in does not
> clear it — that assertion is already in route 1 below and a real run still read the host rule as
> binding. So when you judge routes 1 and 2 unavailable, do **not** slide into route 3 and start
> working. Issue exactly ONE `AskUserQuestion` — *"Workflow/Agent are blocked by this session's
> settings. Grant `Workflow` for this skill (each phase in its own fresh context, with an
> independent Critique pass), or run inline in this session (weaker: one large read that costs this
> session's context)?"* — and stop until it is answered. A grant in chat is an explicit user request
> and satisfies the host rule; that is the whole cost, one question. **Never mention the option in
> passing and keep going** — an aside is not a question, and the user reads continued work as "the
> route is fine".
> **While the gate is open, do NOTHING a workflow phase already owns.** A blocked route is not a
> reason to start "preparing" — the phases are the catalog of what you must not do inline: **Context
> · Describe · Critique · Merge**. Each runs in its own fresh context, once per run, and re-does its
> own reads by design, so hand-doing one costs the context the gate is protecting and is thrown away
> minutes later. Ask the question and stop; the run picks all of it up itself. Reading THIS file and
> resolving the plan's own `⚠` items is yours and stays fine — the phases are not.
> **What the inline route actually costs, measured:** a real session took route 3 for step 5.1 and
> spent most of one context window on the read before the plan was regenerated. Route 3 is
> legitimate for step 5.1 (one large read, one file out), but state that cost when the user chooses
> it.

1. **The `Workflow` tool (preferred on Claude Code).** Invoking THIS skill is the user's opt-in to
   the orchestration its own steps call for, so a workflow needs no separate permission — and,
   unlike the Agent tool, it is not subject to the host rule some sessions carry that forbids
   launching a sub-agent unless the user asked for one in that turn. That rule is why a previous run
   stopped mid-step to ask instead of just running: do not repeat it, and do not treat the ask as
   the only lawful option. Call it **by script path** —
   `Workflow({ scriptPath: "./classic-behaviour-analysis.workflow.js", args: { manifest, digest, environment, outDir, sectionSchema, totals } })`,
   resolved to its absolute path in the plugin dir. That script ships beside this file, so it is
   always present and always version-matched; `name: "creatio-classic-behaviour-analysis"` resolves
   only where the installer has mirrored it, which on Claude Code is usually nowhere (see
   "Named-workflow availability" below — do not spend a call probing the name first). Pass the
   digest's `totals` so a surface with no imperative rows exits before spending a single agent, and
   produce `digest` with `--stubs` FIRST (the workflow needs it and fails loudly without it). It
   returns
   `{ reportPath, indexPath, coverage: { described, total, complete, uncovered }, critiqueRan, conflicts, settledElsewhere, gaps, refusals }`;
   `coverage` is computed from the digest's own keys, so `complete: false` means rows are genuinely
   undescribed no matter what any agent reported. `critiqueRan: false` means the adversarial pass
   died even after its retry — `conflicts`/`settledElsewhere` are then UNCHECKED (not
   verified-empty) and `coverage.complete` is arithmetic-only (no pass verified that cited cards
   actually describe their rows): say so when presenting the plan.
2. **The `Agent` tool with the `classic-ui-expert` skill.** The single-sub-agent route. Correct
   where it is permitted; if the host refuses it without an explicit user request, do not stall — go
   to 1, or to 3 and say so.
3. **Inline via the `Skill` tool.** The fallback for a host with no sub-agents at all — and it is
   only reachable **through the route gate above**, never as a co-equal choice you make silently. It
   costs this session's context (the run is a large read), but the report is a FILE, so nothing is
   lost when the context is later compacted.
4. **The `migration-workflow` CLI — the route for a host with NO Workflow runtime (Codex, and any
   other coding agent).** The orchestration is not Claude-only any more: the deterministic part of
   it lives in `skills/_workflow-core/` as ordinary Node modules, and the shipped `.workflow.js` is
   GENERATED from it. A host that cannot evaluate a workflow script drives the identical decision
   sequence through the CLI instead:

   ```bash
   node <plugin>/skills/_workflow-core/cli.mjs start run.json \
     --workflow classic-behaviour-analysis --input input.json --host codex
   node <plugin>/skills/_workflow-core/cli.mjs next run.json --out prompts/   # phase, role, prompt, input files, schema, access
   node <plugin>/skills/_workflow-core/cli.mjs submit run.json <item-id> result.json
   #   …or record the failure honestly: --death (terminal) / --error "<message>" (rejected)
   ```

   `next`/`submit` until it reports `{"status":"done"}`; `status` shows where the run is and
   `resume` picks it up after an interruption (the journal on disk IS the resume — the core is
   deterministic, so it replays to exactly where it was). **This is not the weaker inline route.**
   Every decision — the batch count, the coverage arithmetic, the repair round, the completion
   verdict — is still the core's, so a Codex run and a Claude Code run over the same input return
   the identical result and the identical artifacts; a golden asserts that parity. What the host
   must do is declare itself honestly: `--parallelism N` if it can run items concurrently,
   `--no-independent-roles` / `--no-sub-agents` if it cannot. A guarantee the host cannot honour
   then produces an EXPLICIT STOP with the remedy and exit code 3 — the Critique phase will not run
   from the context that wrote the cards it is checking — instead of a quietly weaker run reporting
   the same green verdict. Say in the worklog which host adapter ran; the run state records it too.

   **The shipped `.workflow.js` files are generated — never hand-edit them.** Edit the core and run
   `node scripts/build-workflows.mjs`; CI's `--check` fails the PR on drift.
   `skills/_workflow-core/README.md` is the work-item protocol contract for integrating a host that
   is neither of these.

**Named-workflow availability (applies to the workflow this skill ships) — `scriptPath` is the
primary call, `name:` is the exception.** A named workflow resolves ONLY from `~/.claude/workflows/`
(user scope) or a project's `.claude/workflows/`; the plugin cache is never scanned. The marketplace
ships skills, agents and MCP servers and cannot register a name, and — this is the part that decides
the order — **a Claude Code plugin install/update cannot run the toolkit's installer either**,
because neither plugin declares a hook. `installer/install.py` mirrors every bundled `*.workflow.js`
to `~/.claude/workflows/<meta.name>.js` and `update.py` re-mirrors from the updated cache, but on
Claude Code nothing invokes them: on a marketplace-installed host the mirror simply never exists.
Observed: with the plugin cache at `1.7.0`,
`Workflow({ name: "creatio-classic-behaviour-analysis" })` returned `not found` and listed only the
two built-ins plus another plugin's mirrors. So calling the name first buys a guaranteed failed call
on the host this skill runs on most.

Use `name:` only where you already know the installer ran against this host
(`python installer/install.py`, i.e. the Cursor/Codex/manual targets) **and** the mirror predates
this session — user-scope workflows are discovered at **session start**, so a name provisioned
mid-session does not resolve until the next one. Prefer `scriptPath` even then: the in-tree script
is version-matched by construction, while a mirror left over from another version — the normal state
after a plugin-branch switch, which repoints the cache and never re-mirrors — resolves the right
NAME to the wrong SCRIPT, silently. A resolution error is the better failure. **Neither form changes
permission** — a named workflow is not pre-authorized, so the route gate above applies identically
to both.

**The phases, when you run a workflow.** Not a suggestion to parallelize by row — a fan-out per
surface SCOPE only holds together with a Context phase in front of it, because the completeness
proof is a whole-surface census that no single scope can produce:

- **Context (1 agent)** — the stand-wide census plus the shared core every scope depends on: the
  base-page chain, every mixin body, the referenced modules and constants, and the message
  publish/subscribe register. It returns the scope list and OWNS the cards for everything shared.
  Without it each scope re-reads the same base layers and mixins, and two scopes write two different
  cards for one mixin.
- **Describe (count decided from the inventory, not fixed)** — the script packs the `--stubs` scopes
  into batches by row count: a surface under the row target gets ONE agent over everything (the
  whole-surface run the analysis skill was written for), a larger one gets several, and a scope is
  never split in half because half a scope cannot carry a member ledger. Each agent is handed only
  its own slice of the digest, describes what its scopes add, and REFERENCES the Context cards for
  anything shared. Over the agent cap the smallest batches are MERGED, never dropped — a dropped
  scope is a silent coverage hole.
- **Critique (1 agent)** — the completeness pass, and the one that matters most here: which
  handed-over rows carry no card, which two cards contradict, which refusal is actually settled by a
  sibling scope's data. In review workflows the equivalent stage hunts false positives; here the
  expensive failure is the opposite — a row nobody described — so aim it at coverage.
- **Merge (1 agent)** — deduplicate the cards, then emit ONE `behaviour-index.json`. Card ids are
  numbered per report, so a multi-scope run MUST namespace them (`<scope>/C03`) or the plan's
  `Described in` cell points at two different cards. **A row whose behaviour is defined outside the
  scope that owns it carries BOTH cards** — `card`/`ac` for how this surface uses it,
  `bodyCard`/`bodyAc` for the body's own card (usually shared-core). That covers every such row: a
  `mixin:` member or the method wiring one in, an externally-assigned method (`externalRef`), a
  `message:` counterpart in another schema, `module-dep` / `referenced-module`, an override
  implemented in the base chain. A wiring card alone reads as described while the criteria that gate
  the behaviour sit in a card the plan never names. Two kinds are checked mechanically, and they are
  checked to DIFFERENT strengths: a `mixin:` row missing its `bodyCard` is counted against the
  workflow's coverage and sent back through the repair round, so it blocks step 5.1; an
  `externalRef` method is reported only — the engine lists both kinds in `behaviourIndex.wiringOnly`
  and prints a ⚠ plan banner, but that banner is advisory, so a wiring-only `externalRef` row still
  leaves `coverage.complete` and the `M of M` header green. For every other kind the rule is carried
  by the prompts alone. Read the banner before approving: outside the mixin leg it is the only thing
  that says a body card is missing.

**Coverage is computed, never asserted.** The workflow computes it against the digest's own keys and
runs ONE repair round on the scopes that own any uncovered row; then, after merging the index into
the manifest, `--plan` reports the same thing from the engine's side in each worklist header
(`N of M carry a behaviour card`). Those two counts — not a sub-agent's closing summary — are what
say the step is done. `coverage.complete: false` or a header short of `M of M` means rows are still
undescribed, and the plan is not approvable yet (Contract rule 7).

**The thresholds are theoretical until measured.** `rowsPerAgent` (default 40) and
`maxDescribeAgents` (default 8) are reasoned defaults, not profiled ones — the only observed run was
a product section, which this skill will rarely see, since product sections are already Freedom.
Both are `args` overrides; revisit them once several real CUSTOM sections have been profiled with
`--stubs` (that digest is the cheap way to collect the profile: no agents, no second stand pass).

## What to hand the run

- **One invocation per SURFACE, never per row.** That skill's completeness proof is a whole-surface
  member ledger, so a run scoped to five method names breaks its own contract. Hand it the surface
  (the section, every record page including typed variants, mini pages, details) and the
  environment. The four row types are what you **index its cards against afterwards** — they are not
  the analysis scope. A per-SCOPE fan-out is the one permitted split, and only inside the phased
  workflow above, where Context holds the surface-level census and the shared core.
- **HAND OVER THE ENGINE'S ROWS — never describe them from prose.**
  `node engine/migrate.mjs <manifest> --stubs --out <handoff-file>` (point `--out` at your migration
  folder's `handoff-rows.json`) writes the digest: one entry per scope (main page · mini page · each
  child page · the section, when `manifest.section` is supplied) with every imperative row's method
  name, its traced trigger (`triggers: []` ⇒ the row reads `⚠ unresolved`), `externalRef`, line span
  — plus the `<kind>:<name>` member rows (`message` / `mixin` / `module-dep` / `attribute-*`) and
  the standard-method names the worklist excluded. Pass that FILE PATH in the prompt. Two failures
  this prevents, both observed: (a) the run cannot key its index to your rows, so row-to-card
  matching degrades to matching by method NAME and lands in the report as a refusal; (b) you name a
  row type the engine counted ZERO (`externalRef: 0` is common) because the prompt was written from
  this skill's prose instead of the engine's output. Read the digest's `totals` before you write the
  prompt — that is where the real row counts are.
- **Pass the output path explicitly** — your migration folder's `customizations.md` (whole-package
  scope → one report per surface, `customizations-<section-slug>.md`, since the folder is named
  after the app). Its own default is the same folder convention, but naming the path is what keeps
  the two from diverging.
- **Do NOT ask it for Freedom targets, mapping advice, or a plan.** Its report carries Classic-side
  behaviour facts only — behaviour cards (trigger → effect, business purpose, verbatim source
  evidence, **acceptance criteria**), a member ledger, counted zeros, refusals. Asking for a target
  either gets a refusal or breaks its contract; target selection stays here, on the migration side.
- **This is NOT the `memberDispositions` mechanism.** That key (step 4.2) exists only for a member
  the coverage gate reports `unaccounted`. A `decision` member is already accounted for and needs no
  disposition — what the cards feed is the *ported / dropped / blocked* marking Contract rule 7
  forces on the worklist rows. Do not turn one report into a bulk list of dispositions.
- **A refusal is a recorded outcome, not a drop.** A unit the report refuses — or a card whose
  Assumption is unsettled — leaves its row **blocked** with the settling query and becomes a risk in
  the plan. Never `ported`, never silently gone.
