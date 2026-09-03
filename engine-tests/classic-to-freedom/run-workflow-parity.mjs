// DIFFERENTIAL goldens: the SHIPPED (generated) workflow scripts against the hand-written BASELINE they replace.
//
// This is the test that answers the one acceptance criterion no unit test can: "existing Claude Code behavior
// remains unchanged". Both scripts are evaluated exactly the way the Claude Workflow host evaluates them — as a
// function body with `args`, `log`, `phase`, `agent`, `parallel` injected — against the SAME scripted host, and the
// three things a caller can observe are compared:
//
//   · the PHASE sequence           (what the progress display shows)
//   · every AGENT dispatched       (phase + label + the schema's required keys, in order)
//   · every PROMPT, byte for byte  (the prompt IS the contract each phase is handed)
//   · the RETURN VALUE             (the run's whole answer)
//
// The PROMPT leg is not decoration. Refactoring the core into modules re-indented the source, which re-indented
// the multi-line template literals the prompts are built from — every rule bullet gained two leading spaces. The
// phases, the labels and the return value were all still identical, so nothing but a byte comparison of the prompt
// text could see it.
//
// The logs are compared too, but as a WARNING rather than a failure: wording is allowed to improve, and a log line
// is not a contract. Everything else is: a changed label breaks a caller reading progress, a changed dispatch order
// changes what the stand sees, and a changed return changes what the skill reports.
//
// The baselines are committed under `baseline/` for exactly this purpose. They are FROZEN — never regenerated from
// the working tree, because a baseline refreshed from the thing under test proves nothing. When a behaviour change
// is intended, the diff is reviewed and the baseline is replaced deliberately, in its own commit.
//
// Zero dependencies (node built-ins only); exits 1 on any failed check.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0, warn = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) { let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; } console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d))); }
};
const note = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ✅ " + name); return; }
  warn++; console.log("  ⚠️  " + name);
  if (detail !== undefined) console.log("      ↳ " + (typeof detail === "function" ? detail() : detail));
};

// A BOUNDED excerpt of a run's log lines, the same way every other diagnostic here is bounded. A run whose
// termination bound is broken emits hundreds of lines per side, and an unbounded dump both buries the difference and
// floods stdout — which is how the summary line came to be truncated at exit. The full count is always stated, so a
// reader knows an excerpt is what they are looking at.
const LOG_EXCERPT = 12;
function logExcerpt(logs) {
  if (logs.length <= LOG_EXCERPT * 2) return logs.join("\n        ");
  const head = logs.slice(0, LOG_EXCERPT), tail = logs.slice(-LOG_EXCERPT);
  return [...head, `… ${logs.length - LOG_EXCERPT * 2} line(s) elided …`, ...tail].join("\n        ");
}

// Evaluate a workflow script the way the host does. The body becomes a real ES module under the OS temp dir and is
// imported — no `new Function`, no eval, matching the sibling runners' decision to keep these files free of a
// dynamic-code construct a reviewer then has to reason about.
// A RUNAWAY CEILING on the dispatch count, so a script that does not TERMINATE fails as a divergence instead of
// hanging the suite. Every termination guarantee this workflow has — the round budget, the park arithmetic, the
// continuation cap — is a bound on how many agents a run may ask for, and the failure mode when one is removed is an
// infinite loop, not a wrong answer. A hang is the worst possible signal: it is indistinguishable from a slow machine
// and it names no scenario. Hitting the ceiling throws, the throw is reported as this run's `error`, and the
// comparison already requires the two sides' errors to match — so the correct baseline finishing normally against a
// mutated script that runs away is a NAMED failure on the scenario that provoked it.
// MEASURED, not guessed: the widest legitimate scenario in this file dispatches 30 work items, so this is 10x
// headroom. It is a backstop for a broken bound, never a limit a real run should approach — raise it only alongside
// a scenario that legitimately needs more, and never to make a runaway pass.
const MAX_DISPATCHES = 300;

async function runScript(src, args, answer) {
  const body = src.replace(/^export const meta = \{[\s\S]*?\n\}\n/, "");
  const phases = [], calls = [], logs = [];
  const agent = async (prompt, opts = {}) => {
    const req = opts.schema?.required ? [...opts.schema.required].sort((a, b) => a.localeCompare(b)) : null;
    calls.push({ phase: opts.phase || null, label: opts.label || null, agentType: opts.agentType || null, required: req, prompt: String(prompt ?? "") });
    if (calls.length > MAX_DISPATCHES) {
      throw new Error(`runaway: more than ${MAX_DISPATCHES} work items dispatched (last: ${opts.phase}/${opts.label}) — a termination bound (round budget, park arithmetic or the continuation cap) is not holding`);
    }
    return answer({ phase: opts.phase, label: opts.label, prompt, schema: opts.schema, nth: calls.length });
  };
  // FAITHFUL to the documented `parallel()` contract, which is NOT `Promise.all`: a thunk that throws (or whose
  // agent errors) resolves to `null` in the result array, and the call itself never rejects. A bare `Promise.all`
  // rejects on the first throw, which made baseline and shipped propagate a rejection identically and left the
  // rejection axis — the one axis where the three-outcome protocol is observable — structurally untested.
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wf-parity-"));
  try {
    const modPath = path.join(tmp, "script.mjs");
    writeFileSync(modPath, `export default async function (args, log, phase, agent, parallel) {\n${body}\n}\n`);
    const mod = await import(pathToFileURL(modPath).href);
    const result = await mod.default(args, (m) => logs.push(m), (p) => phases.push(p), agent, parallel);
    return { phases, calls, logs, result, error: null };
  } catch (e) {
    return { phases, calls, logs, result: null, error: `${e?.name || "Error"}: ${e?.message || String(e)}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const read = (p) => readFileSync(p, "utf8");

// ---------------------------------------------------------------------------
// The two pairs under comparison.
// ---------------------------------------------------------------------------
// DECLARED, REVIEWED DIVERGENCES. A prompt change that is INTENDED is named here, with the reason, and nothing
// else is tolerated: an unlisted byte of prompt drift fails the gate. The list is deliberately per-pair and
// per-substring so it cannot quietly widen — "the prompts differ somewhere" is exactly the answer this runner
// exists to refuse.
const ALLOWED_PROMPT_DIVERGENCES = {
  "classic-behaviour-analysis": [
    {
      // The Context prompt told the agent to write its cards to a literal `<outDir>/…` — a PLACEHOLDER, in a
      // prompt, that no agent can expand. That is the same defect this skill set already fixed for the engine
      // path and the reference docs (`REF_BLOCK`: "a relative path resolves against nothing and the agent either
      // goes hunting or quietly builds without the recipe"). The shipped script interpolates the real folder.
      baseline: "Write these cards to `<outDir>/customizations-shared-core.md`",
      shipped: "Write these cards to `out/customizations-shared-core.md`",
      why: "a literal `<outDir>` placeholder in a prompt is unexpandable; the run's actual migration folder is interpolated instead",
    },
  ],
}

const PAIRS = [
  {
    name: "classic-behaviour-analysis",
    baseline: path.join(HERE, "baseline/classic-behaviour-analysis.baseline.js"),
    shipped: path.join(ROOT, "skills/classic-to-freedom-migration/classic-behaviour-analysis.workflow.js"),
    scenarios: () => behaviourScenarios(),
  },
  {
    name: "freedom-build-executor",
    baseline: path.join(HERE, "baseline/freedom-build-executor.baseline.js"),
    shipped: path.join(ROOT, "skills/freedom-build-executor/freedom-build-executor.workflow.js"),
    scenarios: () => buildScenarios(),
  },
];

// ---------------------------------------------------------------------------
// Behaviour-analysis scenarios.
// ---------------------------------------------------------------------------
function behaviourScenarios() {
  const ARGS = { manifest: "m.json", digest: "d.json", environment: "env", outDir: "out", sectionSchema: "DealSection" };
  const CTX = {
    scopes: [
      { role: "main page", schema: null, methodKeys: ["onSaved", "reload"], memberKeys: ["mixin:LeadMixin"], unresolvedCount: 0 },
      { role: "mini page", schema: "DealMini", methodKeys: ["initMini"], memberKeys: [], unresolvedCount: 0 },
      { role: "typed page", schema: "DealTyped", methodKeys: [], memberKeys: [], unresolvedCount: 0 },
    ],
    sharedCore: { path: "out/customizations-shared-core.md", cards: [{ id: "shared/C01", title: "LeadMixin body" }], messageRegister: [{ message: "Refresh", publishers: ["A"], subscribers: ["B"] }] },
    censusNote: "census proven via ExtendParent query",
    refusals: ["could not read DealTyped layer"],
  };
  const FULL = {
    reportPart: "out/part.md",
    indexEntries: [
      { key: "onSaved", card: "main/C01", ac: ["AC-1"] }, { key: "reload", card: "main/C02" },
      { key: "mixin:LeadMixin", card: "main/C03", bodyCard: "shared/C01" }, { key: "initMini", card: "DealMini/C01" },
    ],
    gaps: [], refusals: [],
  };
  const PARTIAL = { ...FULL, indexEntries: FULL.indexEntries.slice(0, 2), gaps: [{ key: "initMini", why: "no source", settlingQuery: "get-schema" }] };
  const CRIT = { uncovered: [], conflicts: [], settledElsewhere: [], notes: "" };
  const MERGED = { reportPath: "out/customizations.md", indexPath: "out/behaviour-index.json", cardCount: 4, acCount: 6, droppedDuplicates: [] };
  const byPhase = (map) => () => ({ phase }) => (phase in map ? map[phase] : null);
  // A Critique that answers with something that is NOT a critique: schema-valid to the host, unusable to the core.
  // A lookup rather than a ternary chain, so the shape of the answer is data.
  const UNUSABLE_CRITIQUE = { Context: CTX, Describe: FULL, Critique: 7 };
  return [
    { name: "happy path — one describe agent, complete", args: ARGS, answer: byPhase({ Context: CTX, Describe: FULL, Critique: CRIT, Merge: MERGED }) },
    { name: "declared zero rows — exits before any agent", args: { ...ARGS, totals: { stubs: 0, members: 0 } }, answer: byPhase({}) },
    { name: "dead Context — a failed run, not an empty surface", args: ARGS, answer: byPhase({ Context: null }) },
    { name: "empty scope inventory — nothing to describe", args: ARGS, answer: byPhase({ Context: { ...CTX, scopes: [{ role: "main page", schema: null, methodKeys: [], memberKeys: [] }] } }) },
    {
      name: "uncovered rows — repair round runs and the verdict reads the repaired counts",
      args: ARGS,
      answer: () => { let d = 0; return ({ phase }) => {
        if (phase === "Context") return CTX;
        if (phase === "Describe") { d++; return d === 1 ? PARTIAL : FULL }
        if (phase === "Critique") return CRIT;
        if (phase === "Merge") return MERGED;
        return null;
      } },
    },
    // A REJECTING Describe agent, not a nullish one. The existing scenarios all cover death (`Context: null`,
    // `Critique: null`, `Merge: null`); none covered a rejection, which is a DIFFERENT outcome in the
    // three-outcome protocol and the only one that can reach the core as a thrown error. Describe is a
    // `parallel: true` step that carries ONE item on this small surface, so this is the axis on which keying
    // the throw path on `items.length` instead of `step.parallel` diverged from the baseline: the baseline
    // absorbed the rejection as a `null` hole and still produced its honest `complete: false` verdict, while
    // the shipped script threw out of the workflow with no return value at all.
    {
      name: "REJECTING Describe agent in a single-item parallel batch — absorbed as a null hole, run still returns a verdict",
      args: ARGS,
      answer: () => ({ phase }) => {
        if (phase === "Context") return CTX;
        if (phase === "Describe") throw new Error("agent overloaded");
        if (phase === "Critique") return CRIT;
        if (phase === "Merge") return MERGED;
        return null;
      },
    },
    { name: "dead Critique, retried once — critiqueRan false", args: ARGS, answer: byPhase({ Context: CTX, Describe: FULL, Critique: null, Merge: MERGED }) },
    { name: "unusable Critique return — treated as dead", args: ARGS, answer: () => ({ phase }) => UNUSABLE_CRITIQUE[phase] ?? MERGED },
    { name: "dead Merge — coverage stands, run not complete", args: ARGS, answer: byPhase({ Context: CTX, Describe: FULL, Critique: CRIT, Merge: null }) },
    {
      name: "fan-out — a wide surface packs into several describe agents",
      args: { ...ARGS, rowsPerAgent: 2, maxDescribeAgents: 3 },
      answer: byPhase({ Context: CTX, Describe: FULL, Critique: CRIT, Merge: MERGED }),
    },
    { name: "missing required args — fails loudly before any agent", args: { manifest: "m.json" }, expectError: true, answer: byPhase({}) },
  ];
}

// ---------------------------------------------------------------------------
// Build-executor scenarios. Each one drives a different decision path: the hard
// stops, the zero-work exit, dry run, a full build round, a checkpoint pause, a
// park, and the two mid-run failures (verifier / reconcile).
// ---------------------------------------------------------------------------
function buildScenarios() {
  const ARGS = {
    manifest: "/mig/manifest.json", environment: "dev", outDir: "/mig", planFile: "/mig/plan.md",
    engine: "/plug/skills/classic-to-freedom-migration/engine/migrate.mjs", sectionSchema: "DealSection",
  };
  const APPROVED = { found: true, version: "plan-abc123", date: "2026-08-01", who: "alex", recordedIn: "decisions.md", quote: "approved plan-abc123" };
  // ENG-95930 — the per-page `buildComplete` is REQUIRED by `RECONCILE_SHAPE.verify` and checked on arrival, so a
  // fixture omitting it is refused before it can be compared. Top-level `builderOpen` is NOT required (the shape's
  // `required` is complete/missing/unverified/pages) — it is carried here because the engine's summary publishes it
  // and a realistic fixture should look like the real answer, not because the checker demands it.
  const verify = (pages, extra = {}) => ({ complete: false, missing: 1, unverified: 0, builderOpen: 1, planGaps: [], pages, ...extra });
  const openRow = (d) => ({ n: 1, deliverable: d, status: "❌ MISSING", evidence: "missing: Amount" });
  const RECONCILE = (over = {}) => ({
    approval: APPROVED, planVersion: "plan-abc123",
    unitKeys: ["child:Documents", "list", "main"],
    buildOrder: ["child:Documents", "list", "main"],
    targetPackage: "DealPkg", packageState: "exists", mainEntity: "Deal",
    sectionHost: "existing-app", applicationCode: "DealApp",
    componentTypes: ["crt.ComboBox"], componentResolution: [{ type: "crt.ComboBox", resolved: true, note: "" }],
    pageSchemas: { "child:Documents": "DocsFormPage", list: "DealListPage", main: "DealFormPage" },
    parents: { "child:Documents": "main", list: "main" },
    reachability: [{ key: "sectionRegistered", appliesWhen: true, pages: ["main"], what: "the section is in the app menu", miss: "pages stay unreachable" }],
    reachabilityState: { sectionRegistered: "unset" },
    preflightItems: [], resolutionsUnmatched: [], resolutionsConflicts: [],
    schemaNamePrefixEmpty: false,
    evidenceIds: ["main#quality-gates"], unjudgedEvidenceIds: [], evidenceFiled: [], evidenceRejected: [],
    parkedUnits: [], proposals: [], blocked: [], discrepancies: [],
    staleQueueKeys: [], newKeys: [],
    verify: verify({ "child:Documents": { complete: false, buildComplete: false, missing: 1, unverified: 0, openRows: [openRow("Field Amount")] }, list: { complete: true, buildComplete: true }, main: { complete: false, buildComplete: false, missing: 1, unverified: 0, openRows: [openRow("Field Stage")] } }),
    exitCode: 2, planGaps: [], roundOf: {}, verifyTablePath: "/mig/verify.md", notes: "",
    ...over,
  });
  const GREEN = RECONCILE({
    verify: { complete: true, missing: 0, unverified: 0, builderOpen: 0, planGaps: [], pages: { "child:Documents": { complete: true, buildComplete: true }, list: { complete: true, buildComplete: true }, main: { complete: true, buildComplete: true } } },
    reachabilityState: { sectionRegistered: "true" },
  });
  const BUILT = (unit) => ({
    unit, claimedBuilt: ["crt.Input"], schemaName: `${unit}Page`, packageName: "DealPkg", template: "FormPage",
    guidelines: { evidenceId: `${unit}#quality-gates`, ran: true, referencePage: "ShippedPage", componentsDiffed: ["crt.Input"] },
    blocked: [], proposals: [], checkFirst: [{ what: "saving recalculates", how: "open, save, watch Amount", row: "onSaved" }],
  });
  const VERIFIED = { builtFile: "/mig/built.json", pagesWritten: ["main"], pagesRecordedFalse: [], unknownSchema: [], schemasConfirmed: {}, reachabilityWritten: { sectionRegistered: "true" }, evidenceWritten: ["main#quality-gates"], discrepancies: [], notes: "" };
  const JUDGED = { verdicts: [{ id: "main#quality-gates", convincing: true, why: "diffed" }], notes: "" };
  const PERSISTED = { written: true, queueFile: "/mig/build-queue.json", parkedKeys: [], notes: "" };
  const REFS = { written: true, files: ["/mig/refs/index.md"], slices: ["child:Documents", "list", "main"], notes: "" };

  // One scripted host per scenario. `seq` lets a scenario answer the Nth reconcile differently.
  const host = (cfg) => () => makeHost(cfg);
  const makeHost = ({ reconciles, build = BUILT, verifyRes = VERIFIED, judge = JUDGED, refs = REFS, persist = PERSISTED, preflight }) => {
    let r = 0;
    return ({ phase, label, prompt }) => {
      if (phase === "Reconcile") { const a = reconciles[Math.min(r, reconciles.length - 1)]; r++; return typeof a === "function" ? a() : a }
      if (phase === "Refs") return refs;
      // Preflight is now the FAN-OUT and nothing else: the dedicated `preflight:merge` writer is gone (ENG-95474) —
      // agents return structured records and the existing Judge/Reconcile sequence performs the single write.
      if (phase === "Preflight") return preflight ?? { resolved: [], unresolved: [] };
      if (phase === "Build") {
        const unit = /^build:(.*)$/.exec(label || "")?.[1] || "";
        return typeof build === "function" ? build(unit, prompt) : build;
      }
      if (phase === "Verify") return verifyRes;
      if (phase === "Judge") return judge;
      if (phase === "Close") return label === "persist:carry" ? persist : { written: true, files: [], notes: "" };
      return null;
    };
  };

  return [
    { name: "no approval recorded — hard stop 1", args: ARGS, answer: host({ reconciles: [RECONCILE({ approval: { found: false } })] }) },
    { name: "approval names no version — hard stop 1", args: ARGS, answer: host({ reconciles: [RECONCILE({ approval: { found: true, version: "" } })] }) },
    { name: "approval version mismatch — hard stop 1", args: ARGS, answer: host({ reconciles: [RECONCILE({ approval: { ...APPROVED, version: "plan-old" } })] }) },
    { name: "plan-level gap — hard stop 2", args: ARGS, answer: host({ reconciles: [RECONCILE({ planGaps: ["COVERAGE INCOMPLETE"] })] }) },
    { name: "package state unknown — hard stop 3", args: ARGS, answer: host({ reconciles: [RECONCILE({ packageState: "unknown" })] }) },
    { name: "new-app over an existing package — hard stop 3, carrying component mismatches", args: ARGS, answer: host({ reconciles: [RECONCILE({ sectionHost: "new-app", componentResolution: [{ type: "crt.ComboBox", resolved: false, note: "not a component type" }] })] }) },
    { name: "unresolved component type — hard stop 3.5", args: ARGS, answer: host({ reconciles: [RECONCILE({ componentResolution: [{ type: "crt.ComboBox", resolved: false, note: "install CrtCustomer360App" }] })] }) },
    { name: "an un-swept published type is logged, not gated", args: ARGS, answer: host({ reconciles: [RECONCILE({ componentTypes: ["crt.ComboBox", "crt.Label"], componentResolution: [{ type: "crt.ComboBox", resolved: true }] })] }) },
    // Review (round 5) — the gate path had NO parity scenario, which is why the baseline's copy of the
    // pure-decision block silently kept the pre-hardening `isWellFormedGate` through a whole review round: the
    // two copies could differ on gated input and every parity check still passed. These three drive the
    // gated-composite branch through BOTH scripts, so the baseline is now pinned against the shipped block by
    // BEHAVIOUR, not just by the `GATE_COMPOSITE` literal `run-infra.mjs` greps for.
    // Each one MUST override `componentTypes` as well: `RECONCILE` defaults it to `["crt.ComboBox"]`, and
    // `componentTypeMismatches` drops any resolution the plan did not publish — so a scenario that overrides only
    // `componentResolution` never reaches the gate branch at all and passes vacuously against either predicate.
    { name: "a gated COMPOSITE stops to install, not to re-plan", args: ARGS, answer: host({ reconciles: [RECONCILE({ componentTypes: ["crt.CommunicationOptions"], componentResolution: [{ type: "crt.CommunicationOptions", resolved: false, note: "package missing", kind: "composite", id: "CrtCustomer360App", feature: "CommonCommunicationsBehavior" }] })] }) },
    { name: "a gate whose id is not a gate name falls back to the re-plan clause", args: ARGS, answer: host({ reconciles: [RECONCILE({ componentTypes: ["crt.CommunicationOptions"], componentResolution: [{ type: "crt.CommunicationOptions", resolved: false, note: "package missing", kind: "composite", id: "Crt Customer 360; rm -rf" }] })] }) },
    { name: "a gated COMPOSITE mixed with a fabricated type carries both clauses", args: ARGS, answer: host({ reconciles: [RECONCILE({ componentTypes: ["crt.CommunicationOptions", "crt.NotAComponent"], componentResolution: [{ type: "crt.CommunicationOptions", resolved: false, note: "package missing", kind: "composite", id: "CrtCustomer360App" }, { type: "crt.NotAComponent", resolved: false, note: "fabricated" }] })] }) },
    { name: "a checkpoint key that names no unit — hard stop 4", args: { ...ARGS, mode: "checkpoints", checkpointAfter: ["nope"] }, answer: host({ reconciles: [RECONCILE()] }) },
    { name: "a finding that names no unit — refused", args: { ...ARGS, findings: [{ unit: "ghost", problem: "wrong" }] }, answer: host({ reconciles: [RECONCILE()] }) },
    { name: "nothing published — no-units-published", args: ARGS, answer: host({ reconciles: [RECONCILE({ unitKeys: [], buildOrder: [], reachability: [] })] }) },
    { name: "the gate is already green — zero-work exit", args: ARGS, answer: host({ reconciles: [GREEN] }) },
    { name: "green gate + an operator finding — the run does NOT take the zero-work exit", args: { ...ARGS, findings: [{ unit: "main", problem: "the handler does nothing" }] }, answer: host({ reconciles: [GREEN, GREEN] }) },
    { name: "dry run — stops before the first stand write", args: { ...ARGS, dryRun: true }, answer: host({ reconciles: [RECONCILE()] }) },
    { name: "one full round to green", args: ARGS, answer: host({ reconciles: [RECONCILE(), GREEN] }) },
    { name: "preflight resolves the worklist, then judges before building", args: ARGS, answer: host({ reconciles: [RECONCILE({ preflightItems: [{ id: "#confirm:dcm:Deal", pageKey: "main", kind: "dcm", item: "DCM on Deal", resolution: null }] }), GREEN, GREEN], preflight: { resolved: [{ id: "#confirm:dcm:Deal", answer: "DCM present", referencePage: "P", components: ["crt.Label"] }], unresolved: [] } }) },
    { name: "an answered ⚠ Confirm item reaches the builder", args: ARGS, answer: host({ reconciles: [RECONCILE({ preflightItems: [{ id: "#confirm:list-columns:Deal", pageKey: "main", kind: "list-columns", item: "which columns", resolution: { answer: "Name, Amount", decidedBy: "alex", date: "2026-08-01" } }] }), GREEN, GREEN] }) },
    { name: "checkpoint pause after the first unit", args: { ...ARGS, mode: "checkpoints", checkpointAfter: ["child:Documents"] }, answer: host({ reconciles: [RECONCILE(), RECONCILE()] }) },
    { name: "guided mode pauses after every unit", args: { ...ARGS, mode: "guided" }, answer: host({ reconciles: [RECONCILE(), RECONCILE()] }) },
    { name: "an unknown mode throws before any agent", args: { ...ARGS, mode: "semi" }, expectError: true, answer: host({ reconciles: [RECONCILE()] }) },
    { name: "the verifier does not answer — stale verdict, stop", args: ARGS, answer: host({ reconciles: [RECONCILE()], verifyRes: null }) },
    { name: "the reconcile after a round does not answer — stop", args: ARGS, answer: host({ reconciles: [RECONCILE(), null] }) },
    { name: "the baseline reconcile returns nothing", args: ARGS, answer: host({ reconciles: [null] }) },
    { name: "a build agent returns nothing — the unit stays open and is recorded as absent", args: ARGS, answer: host({ reconciles: [RECONCILE(), GREEN], build: null }) },
    { name: "budget spent — units park and block their ancestors", args: { ...ARGS, maxRounds: 1 }, answer: host({ reconciles: [RECONCILE(), RECONCILE(), RECONCILE()] }) },
    { name: "a park already in the queue file is carried over", args: ARGS, answer: host({ reconciles: [RECONCILE({ parkedUnits: [{ key: "child:Documents", parkedWhy: "gave up last session", rounds: 3 }] }), GREEN] }) },
    { name: "the app unit builds the package the plan targets", args: ARGS, answer: host({ reconciles: [RECONCILE({ packageState: "absent" }), GREEN], build: (unit) => (unit === "app" ? { unit: "app", packageName: "DealPkg", appName: "Deals", starterFormPage: "DealFormPage", starterListPage: "DealListPage", claimedBuilt: [], blocked: [], proposals: [] } : BUILT(unit)) }) },
    { name: "the app unit produces a DIFFERENT package — it stays open", args: ARGS, answer: host({ reconciles: [RECONCILE({ packageState: "absent" }), RECONCILE({ packageState: "absent" })], build: (unit) => (unit === "app" ? { unit: "app", packageName: "OtherPkg", claimedBuilt: [], blocked: [], proposals: [] } : BUILT(unit)) }) },
    { name: "a plan gap that appears mid-run stops the run", args: ARGS, answer: host({ reconciles: [RECONCILE(), RECONCILE({ planGaps: ["GATE BLOCKED"] })] }) },
    { name: "a guidelines record that is not fileable is reported, not filed", args: ARGS, answer: host({ reconciles: [RECONCILE(), GREEN], build: (unit) => ({ ...BUILT(unit), guidelines: { evidenceId: `${unit}#quality-gates`, ran: true, referencePage: "", componentsDiffed: [] } }) }) },
    { name: "the persistence step does not confirm — warned, not fatal", args: ARGS, answer: host({ reconciles: [RECONCILE(), GREEN], persist: { written: false } }) },
    { name: "the refs step returns nothing — builders fetch their own", args: ARGS, answer: host({ reconciles: [RECONCILE(), GREEN], refs: null }) },
    { name: "missing required args — fails loudly before any agent", args: { manifest: "/mig/manifest.json" }, expectError: true, answer: host({ reconciles: [RECONCILE()] }) },
    // --- three branches whose PROMPT TEXT no scenario above reaches -----------------------------------------
    // `pages-only-no-menu`: the app unit is told NOT to create a section, which is the OTHER arm of the step-4
    // text. Every scenario above carries `existing-app`, so that arm had never been compared against the baseline.
    {
      name: "the app unit under `pages-only-no-menu` — the step-4 text that says create NO section",
      args: ARGS,
      answer: host({
        // `app` is in `unitKeys` here as a historical fixture shape: naming a file for a scheduled unit the key
        // list does not carry used to throw in `unitNo`, so this was once the only way to compare the prompt at
        // all. ENG-95543 named non-page units by KIND + KEY instead, so the workaround is no longer needed — it
        // is kept because it changes nothing (a non-page unit never asks for a position) and removing it would
        // move a fixture this suite's other assertions read.
        reconciles: [RECONCILE({ packageState: "absent", sectionHost: "pages-only-no-menu", applicationCode: null, unitKeys: ["child:Documents", "list", "main", "app"] }), GREEN],
        build: (unit) => (unit === "app"
          ? { unit: "app", packageName: "DealPkg", appName: "Deals", claimedBuilt: [], blocked: [], proposals: [] }
          : BUILT(unit)),
      }),
    },
    // A PARTIAL app unit: the planned package exists, and nothing else finished. That composes the `shortfall`
    // clause, which is a text no other scenario produces.
    {
      name: "the app unit produced the package and NOTHING else — the partial-deliverable blocker text",
      args: ARGS,
      answer: host({
        // Same fixture shape, same history as above: `app` in `unitKeys`, which ENG-95543 made unnecessary.
        reconciles: [RECONCILE({ packageState: "absent", unitKeys: ["child:Documents", "list", "main", "app"] }),
                     RECONCILE({ packageState: "absent", unitKeys: ["child:Documents", "list", "main", "app"] })],
        build: (unit) => (unit === "app"
          ? { unit: "app", packageName: "DealPkg", starterFormPage: "", claimedBuilt: [], proposals: [],
              blocked: [{ what: "create-app-section failed", why: "the entity was not bindable" }] }
          : BUILT(unit)),
      }),
    },
    // The REACH unit's whole prompt, including the app-menu note in both its arms. `sectionRegistered` is normally
    // absent from `unitKeys`, so no per-unit file can be named for it and the prompt throws before it is dispatched
    // — pre-existing behaviour, reproduced identically, and asserted by the scenario above it. This fixture puts
    // the key in `unitKeys` (giving it a unit number) but NOT in `buildOrder` (so it is still scheduled as a reach
    // unit, not a page), which is the smallest shape that lets the reach prompt be COMPARED at all.
    {
      name: "the reachability unit's prompt, with the approved application code",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE({ unitKeys: ["child:Documents", "list", "main", "sectionRegistered"] }), GREEN],
      }),
    },
    {
      name: "the reachability unit's prompt when NO applicationCode is published",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE({ unitKeys: ["child:Documents", "list", "main", "sectionRegistered"], applicationCode: null }), GREEN],
      }),
    },
    // --- the branches ENG-95469 / ENG-95474 / ENG-95543 / ENG-95850 added -----------------------------------
    // Each of these drives a builder answer NO scenario above produces, so the new decision paths are compared
    // against the baseline rather than merely present in both. Without them a green parity run says nothing about
    // them: every fixture above returns a builder result that takes the old path through every one.
    //
    // A NON-PAGE unit whose key is NOT in `unitKeys` (ENG-95543). This used to throw in `unitNo` while naming the
    // unit's worklog file — after the pages had already been built — which is why the two fixtures above put the
    // key in `unitKeys` to be comparable at all. Named by its KIND + KEY now, so it needs no position.
    {
      name: "a reachability unit absent from `unitKeys` is dispatchable — its files are named by key, not by position",
      args: ARGS,
      answer: host({ reconciles: [RECONCILE(), GREEN] }),
    },
    // A CONTINUATION (ENG-95474): the builder stops at a safe boundary and the SAME unit comes back next round with
    // no repair round charged. This fixture covers the ACCOUNTING — the continuation counter moves, the round counter
    // does not — and it continues `main`, the LAST unit in the schedule.
    {
      name: "a builder asks for a continuation — the round carries on and no repair round is charged",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE(), RECONCILE(), GREEN],
        build: (unit) => (unit === "main"
          ? { ...BUILT(unit), continuationRequested: true, continuationReason: "the Logic tab is half ported", safeContinuationPoint: "after the Fields group was saved" }
          : BUILT(unit)),
      }),
    },
    // …AND THE OTHER HALF OF THAT GUARANTEE, which the fixture above cannot observe. "A continuation does not
    // terminate the round" is only VISIBLE when there is something left to terminate, and only when a pause is
    // possible at all:
    //   · `mode: auto` makes `shouldPauseAfter` return false for every unit, so dropping the `!continuation` guard
    //     changes nothing an agent or a return value can show — the whole branch is inert;
    //   · continuing the LAST unit in the schedule leaves no later unit to defer.
    // So this fixture continues the FIRST scheduled unit (`child:Documents`) under `checkpoints` naming that same
    // unit, with `main` and `sectionRegistered` still open behind it. On the correct core the continuation SUPPRESSES
    // the checkpoint — the round builds all three and carries on. Reintroduce the defect (`!continuation` dropped
    // from the pause decision) and the run pauses after the first unit, defers the other two and returns
    // `paused-at-checkpoint`: a different agent sequence AND a different return value. Verified by mutation, not by
    // reading the source — this is the behavioural counterpart of the two source-level pins in `run-infra.mjs`.
    {
      name: "a continuation on the FIRST unit does not terminate the round — the two units behind it still build, and the checkpoint is suppressed",
      args: { ...ARGS, mode: "checkpoints", checkpointAfter: ["child:Documents"] },
      answer: host({
        reconciles: [RECONCILE(), RECONCILE()],
        build: (unit) => (unit === "child:Documents"
          ? { ...BUILT(unit), continuationRequested: true, continuationReason: "the Coverage group is half ported", safeContinuationPoint: "after the first field group was saved" }
          : BUILT(unit)),
      }),
    },
    // The continuation CEILING: a unit that asks every round is refused past the cap and charged as an ordinary
    // repair round instead, so `MAX_ROUNDS` parks it. `maxContinuations: 1` reaches the refusal in two rounds.
    {
      name: "a unit that asks to continue every round is refused past the cap and parks on its round budget",
      args: { ...ARGS, maxRounds: 2, maxContinuations: 1 },
      answer: host({
        reconciles: [RECONCILE(), RECONCILE(), RECONCILE(), RECONCILE()],
        build: (unit) => ({ ...BUILT(unit), continuationRequested: true, continuationReason: "still going" }),
      }),
    },
    // The BUILD TURN BUDGET at 0 disables the mechanism, which changes the build prompt: an agent never told to
    // stop cannot ask to, so the continuation block is absent from the text.
    {
      name: "buildTurnBudget 0 removes the continuation block from every build prompt",
      args: { ...ARGS, buildTurnBudget: 0 },
      answer: host({ reconciles: [RECONCILE(), GREEN] }),
    },
    // THE IN-CONTEXT COMPLETENESS GATE, still short after its ONE bounded fix (ENG-95469) — the unit parks after
    // ONE round with its own gate's open rows as the reason, confirmed against the post-hoc verifier.
    {
      name: "the in-context gate is still short after its one bounded fix — the unit parks after ONE round",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE(), RECONCILE()],
        build: (unit) => ({ ...BUILT(unit), selfCheck: { ran: true, complete: false, missing: 2, unverified: 0, fixAttempted: true,
          stillShortRows: [{ deliverable: "Fields — 7 expected", status: "❌ MISSING", evidence: "missing: Amount, Stage" }] } }),
      }),
    },
    // The THREE ways a self-report and the independent verifier can disagree, in one round: a claimed-green gate on
    // an open unit, a gate that RAN but returned no verdict, and a gate that did not run. Each gets its own text.
    {
      name: "every self-report the independent verifier contradicts is named as its own kind of discrepancy",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE(), RECONCILE()],
        build: (unit) => {
          const sc = { main: { ran: true, complete: true }, list: { ran: true }, "child:Documents": { ran: false, notRunWhy: "get-page timed out" } }[unit];
          return { ...BUILT(unit), ...(sc ? { selfCheck: sc } : {}) };
        },
      }),
    },
    // A RE-BIND that leaves a page behind (ENG-95850 B4/C3): the orphan is recorded, named to the verifier in its
    // own prompt block, reported as a blocker, and NEVER deleted.
    {
      name: "a re-bind leaves an orphan — it is recorded, named to the verifier and reported, never deleted",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE(), GREEN],
        build: (unit) => ({ ...BUILT(unit), reboundFrom: unit === "main" ? "DealPkg_FormPage" : "" }),
      }),
    },
    // An orphan an EARLIER session recorded, read back off the queue file at the BASELINE — the resumed run is
    // exactly when a dead page is about to be read as a live one.
    {
      name: "an orphan recorded by an earlier session is carried over at the baseline",
      args: ARGS,
      answer: host({ reconciles: [RECONCILE({ orphanedPagesOnFile: [{ schema: "DealPkg_FormPage", orphanedBy: "main", at: "plan-old" }] }), GREEN] }),
    },
    // THE WORKPLACE BINDING COUNT (ENG-95850 B2): a registration only ADDS, so two bindings look correct in the
    // one an operator opened. Reported as a blocker naming every workplace; never unbound.
    {
      name: "the sectionRegistered unit reports TWO workplace bindings — surfaced as a blocker, never unbound",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE(), GREEN],
        build: (unit) => (unit === "sectionRegistered"
          ? { unit, claimedBuilt: [], blocked: [], proposals: [], workplaceBindings: { count: 2, names: ["Recruiting", "My applications"] } }
          : BUILT(unit)),
      }),
    },
    // THE PACKAGE PROVENANCE RESUME (ENG-95850 A2). `new-app` + `packageState: 'exists'` is a hard stop unless the
    // state file records THIS migration creating it and finishing the app unit — then it is a resume.
    {
      name: "new-app over a package THIS migration created and finished — a resume, not a stop",
      args: ARGS,
      answer: host({ reconciles: [RECONCILE({ sectionHost: "new-app", packageCreatedByRun: { package: "DealPkg", appUnitComplete: true, planVersion: "plan-abc123", sectionPage: "DealFormPage" } }), GREEN] }),
    },
    {
      name: "new-app over a package this migration created but did NOT finish — still a stop, naming the hand-finish",
      args: ARGS,
      answer: host({ reconciles: [RECONCILE({ sectionHost: "new-app", packageCreatedByRun: { package: "DealPkg", appUnitComplete: false, planVersion: "plan-abc123", sectionPage: null } })] }),
    },
    // The app unit's stand write is persisted MID-ROUND, and the record makes the very next Reconcile's `new-app`
    // gate read the package as ours instead of stopping the run on its own success.
    {
      name: "the app unit creates the package under `new-app` — the run survives its own success",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE({ packageState: "absent", sectionHost: "new-app" }), GREEN],
        build: (unit) => (unit === "app"
          ? { unit: "app", packageName: "DealPkg", appName: "Deals", starterFormPage: "DealFormPage", starterListPage: "DealListPage", claimedBuilt: [], blocked: [], proposals: [] }
          : BUILT(unit)),
      }),
    },
    // VERIFY IS THE QUEUE WRITER NOW (ENG-95474). Every fixture above leaves `queueWritten` unset, which is the
    // FALLBACK path — this one confirms the write, so the dedicated persistence agent is not dispatched at all.
    {
      name: "Verify confirms the queue carry write — no fallback persistence agent is dispatched",
      args: ARGS,
      answer: host({ reconciles: [RECONCILE(), GREEN], verifyRes: { ...VERIFIED, queueWritten: true } }),
    },
    // THE RECONCILE RETRY (ENG-95850 A3). The first attempt returns nothing and the SAME call is re-issued once;
    // exhausting both attempts is still the honest `reconcile-failed` stop.
    {
      name: "the baseline Reconcile flakes once and the retry succeeds",
      args: ARGS,
      answer: host({ reconciles: [null, RECONCILE(), GREEN] }),
    },
    // PREFLIGHT RETURNS RECORDS, and the Judge is the sequential writer that files them (ENG-95474) — the
    // `preflight:merge` agent is gone, and the evidence travels through the Judge's own prompt.
    {
      name: "preflight evidence is filed by the Judge, not by a merge agent",
      args: ARGS,
      answer: host({
        reconciles: [RECONCILE({ preflightItems: [
          { id: "#confirm:dcm:Deal", pageKey: "main", kind: "dcm", item: "DCM on Deal", resolution: null },
          { id: "#confirm:printables:Deal", pageKey: "main", kind: "printables", item: "printables on Deal", resolution: null },
        ] }), GREEN, GREEN],
        preflight: { resolved: [
          { id: "#confirm:dcm:Deal", answer: "DCM present", referencePage: "P", components: ["crt.Label"] },
          { id: "#confirm:printables:Deal", answer: "none", filedAsFalse: true },
        ], unresolved: [] },
        judge: { verdicts: [{ id: "#confirm:dcm:Deal", convincing: true, why: "queried" }], evidenceWritten: ["#confirm:dcm:Deal"], notes: "" },
      }),
    },
  ];
}

// ---------------------------------------------------------------------------
// Compare.
// ---------------------------------------------------------------------------
const fingerprint = (r) => ({
  phases: r.phases.join(" → "),
  calls: r.calls.map((c) => `${c.phase}/${c.label}/${c.agentType}/${(c.required || []).join("+")}`).join(" | "),
  result: JSON.stringify(r.result),
  error: r.error,
});

// Is this differing pair of lines a DECLARED divergence? Both halves must match their declared substrings — a
// one-sided match would let an unrelated change ride in on a listed one.
function declared(pairName, baselineLine, shippedLine) {
  return (ALLOWED_PROMPT_DIVERGENCES[pairName] || []).some((d) =>
    (baselineLine || "").includes(d.baseline) && (shippedLine || "").includes(d.shipped));
}

// The first prompt that differs, with the first differing LINE named — a prompt is thousands of characters and
// "they differ" is not actionable on one.
function promptDiff(a, b, pairName) {
  const n = Math.max(a.calls.length, b.calls.length);
  for (let i = 0; i < n; i++) {
    const pa = a.calls[i]?.prompt, pb = b.calls[i]?.prompt;
    if (pa === pb) continue;
    if (pa === undefined || pb === undefined) return { i, why: `call ${i + 1} exists on only one side (${a.calls[i]?.label || "—"} / ${b.calls[i]?.label || "—"})` };
    const la = pa.split("\n"), lb = pb.split("\n");
    if (la.length !== lb.length) return { i, why: `call ${i + 1} (${a.calls[i].label}) has ${la.length} prompt line(s) in the baseline and ${lb.length} in the shipped script` };
    for (let k = 0; k < la.length; k++) {
      if (la[k] === lb[k] || declared(pairName, la[k], lb[k])) continue;
      return { i, why: `call ${i + 1} (${a.calls[i].label}), prompt line ${k + 1}:\n        baseline: ${JSON.stringify(la[k] ?? "<eof>")}\n        shipped:  ${JSON.stringify(lb[k] ?? "<eof>")}` };
    }
  }
  return null;
}

for (const pair of PAIRS) {
  console.log(`\n===== ${pair.name}: shipped vs baseline =====`);
  const baseSrc = read(pair.baseline);
  const shipSrc = read(pair.shipped);
  for (const sc of pair.scenarios()) {
    // A FRESH answerer per script run. A scenario is commonly stateful (answer the 2nd Reconcile differently), and
    // sharing one closure across the two runs feeds the second script the first one's continuation — which shows up
    // as a false diff, or worse as a false match. `answer` is therefore a FACTORY, not an answerer.
    const a = await runScript(baseSrc, sc.args, sc.answer());
    const b = await runScript(shipSrc, sc.args, sc.answer());
    const fa = fingerprint(a), fb = fingerprint(b);
    check(`${sc.name} — the PHASE sequence is identical`, fa.phases === fb.phases,
      () => `baseline: ${fa.phases}\n      shipped:  ${fb.phases}`);
    check(`${sc.name} — every AGENT dispatched is identical (phase / label / agentType / schema keys, in order)`,
      fa.calls === fb.calls, () => `baseline: ${fa.calls}\n      shipped:  ${fb.calls}`);
    const pd = promptDiff(a, b, pair.name);
    check(`${sc.name} — every PROMPT is identical byte for byte, apart from the declared divergences`, pd === null, () => pd?.why);
    check(`${sc.name} — the RETURN VALUE is identical`, fa.result === fb.result && fa.error === fb.error,
      () => firstJsonDiff(a.result, b.result) + (fa.error !== fb.error ? `\n      error: baseline=${fa.error} shipped=${fb.error}` : ""));
    // NON-VACUITY. Every check above compares the two runs against EACH OTHER, so two scripts that both throw at
    // the same line agree perfectly and prove nothing — which is exactly what a half-applied port looks like from
    // here. A scenario that does not declare `expectError` must therefore have RUN to a return value on both sides.
    check(`${sc.name} — both scripts actually ran to a return value (the comparison above is not two identical crashes)`,
      sc.expectError ? (a.error !== null && b.error !== null) : (a.error === null && b.error === null && a.result !== null && b.result !== null),
      () => `expectError=${!!sc.expectError} · baseline error=${a.error} result=${a.result === null ? "null" : "present"} · shipped error=${b.error} result=${b.result === null ? "null" : "present"}`);
    note(`${sc.name} — the log lines are identical (wording may improve; not a contract)`,
      a.logs.join("\n") === b.logs.join("\n"),
      () => `baseline (${a.logs.length}):\n        ${logExcerpt(a.logs)}\n      shipped (${b.logs.length}):\n        ${logExcerpt(b.logs)}`);
  }
}

// ---------------------------------------------------------------------------
// THE POPULATED CARRY, which no scenario above can reach (PR #128 review, round 18).
//
// The scenario loop compares two RUNS. The baseline deliberately does not model the answers channel — matching
// answers to questions, spending a repair grant, blocking `complete` on an unconsumed row all live in the shipped
// core and are covered by run-infra/run-mapper — so `unconsumed` is `[]` on every scenario, on both sides. Which
// means the whole populated-carry RENDERING, the wording this ticket actually adds, was compared on the empty path
// only: two functions that both return `''` agree perfectly and prove nothing about the sentence they produce when
// there IS something to say. A later edit to the shipped wording (a cap, a count, a re-phrasing) would drift silently
// away from this frozen reference, which is the one thing the reference exists to prevent.
//
// So the RENDER is compared directly instead of through a run: the function source is sliced out of both files and
// both are called with the same populated input. This keeps the baseline a frozen mirror of the OUTPUT rather than a
// second implementation of the CHANNEL — the distinction the baseline's own note draws, and the reason a
// scenario-driven populated carry is not the right instrument here.
console.log(`\n===== freedom-build-executor: the populated answers-carry render =====`);

// A top-level `function <name>(…) {` through the next line that is a bare `}` at column 0. Both files are generated
// or written with that shape, and the slice is asserted non-empty below so a formatting change fails LOUDLY here
// rather than silently comparing two empty strings.
// The arrow-const twin of `sliceFunction`: `const NAME = (...) => {` through its closing brace at column 0.
function sliceArrowConst(src, name) {
  const start = src.indexOf(`\nconst ${name} = `);
  if (start === -1) return null;
  const end = src.indexOf("\n}\n", start);
  if (end === -1) return null;
  return src.slice(start + 1, end + 3);
}

function sliceFunction(src, name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start === -1) return null;
  const end = src.indexOf("\n}\n", start);
  if (end === -1) return null;
  return src.slice(start + 1, end + 3);
}

async function loadRenderers(src, label) {
  const parts = ["CARRY_TEXT_CAP", "CARRY_TEXT_TRUNCATED"].map((k) => {
    const m = new RegExp(`^const ${k} = (.+)$`, "m").exec(src);
    return m ? `const ${k} = ${m[1]}\n` : null;
  });
  // `encodedAsciiBytes` joined this surface when the carry cap moved to wire bytes (round 19): `capCarryText`
  // now calls it, so a slice without it throws instead of rendering. It is an arrow const in the generated
  // artifact and in the baseline, which `sliceFunction` (declaration form only) cannot take -- hence the pair.
  const fns = [
    sliceArrowConst(src, "encodedAsciiBytes"),
    ...["capCarryText", "unconsumedNextClause", "unconsumedLogLine"].map((n) => sliceFunction(src, n)),
  ];
  if (parts.includes(null) || fns.includes(null)) {
    return { error: `${label}: could not slice the render surface (constants: ${parts.map((p) => p !== null).join()}, functions: ${fns.map((f) => f !== null).join()})` };
  }
  const body = `${parts.join("")}${fns.join("\n")}\nexport { capCarryText, unconsumedNextClause, unconsumedLogLine }\n`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "carry-render-"));
  const file = path.join(dir, "render.mjs");
  writeFileSync(file, body, "utf8");
  try { return { mod: await import(pathToFileURL(file).href), body }; }
  catch (e) { return { error: `${label}: the sliced render surface does not evaluate — ${e.message}` }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

{
  const pair = PAIRS.find((p) => p.name === "freedom-build-executor");
  const baseSrc = read(pair.baseline), shipSrc = read(pair.shipped);
  const base = await loadRenderers(baseSrc, "baseline"), ship = await loadRenderers(shipSrc, "shipped");
  check("the render surface slices out of BOTH files", !base.error && !ship.error,
    () => [base.error, ship.error].filter(Boolean).join("\n      "));

  if (base.mod && ship.mod) {
    // ONE entry, MANY entries, and a list long enough to cross the cap — the three shapes the wording distinguishes.
    const ONE = [{ unit: "main", id: "#confirm:dcm:Deal", why: "the builder reported nothing" }];
    const TWO = [...ONE, { unit: "list", id: "#confirm:list-columns:Deal", why: "declined" }];
    const MANY = Array.from({ length: 40 }, (_, i) => ({ unit: `child:Entity${i}`, id: `#confirm:field:AVeryLongQuestionText${i}`, why: "x" }));
    // NAMED FIELDS, not a mixed tuple (S6551): as `[["one entry", ONE], …]` the array's element type is
    // `string | object[]`, so `label` reads as possibly-an-object at the interpolation below — a real
    // stringification hazard in general, and here just noise. One shape per case says what each half is.
    const CASES = [
      { label: "one entry", entries: ONE },
      { label: "two entries", entries: TWO },
      { label: "forty entries (crosses the carry cap)", entries: MANY },
      { label: "empty (the path the scenarios already cover)", entries: [] },
    ];

    for (const { label, entries } of CASES) {
      for (const fn of ["unconsumedNextClause", "unconsumedLogLine"]) {
        const a = base.mod[fn](entries), b = ship.mod[fn](entries);
        check(`${fn} — ${label}: baseline and shipped render byte-identical text`, a === b,
          () => `baseline (${a.length}): ${JSON.stringify(a.slice(0, 300))}\n      shipped  (${b.length}): ${JSON.stringify(b.slice(0, 300))}`);
      }
    }

    // ANTI-VACUITY: every comparison above would also pass if both sides returned `''` for everything.
    check("ANTI-VACUITY: the populated render actually produces text, and names the count and the ids",
      () => {
        const s = ship.mod.unconsumedNextClause(TWO);
        return s.length > 0 && s.includes("2 operator answer(s)") && s.includes('"main"/"#confirm:dcm:Deal"');
      },
      () => JSON.stringify(ship.mod.unconsumedNextClause(TWO)));
    check("ANTI-VACUITY: the cap is REACHED by the forty-entry case, so the capped path is the one compared",
      () => {
        const s = ship.mod.unconsumedNextClause(MANY);
        return s.includes("…[truncated]") && s.includes("40 operator answer(s)");
      },
      () => JSON.stringify(ship.mod.unconsumedNextClause(MANY).slice(0, 300)));
    check("ANTI-VACUITY: the two sides are not trivially equal — a deliberately altered baseline render DIVERGES",
      () => base.mod.unconsumedNextClause(ONE) !== ship.mod.unconsumedNextClause(ONE).replace("ALSO:", "ALSO :"));
  }
}

// The first differing key path between two results — a bare "they differ" on a 40-key return is not actionable.
function firstJsonDiff(a, b, at = "result") {
  if (JSON.stringify(a) === JSON.stringify(b)) return "identical";
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return `${at}: baseline=${JSON.stringify(a)?.slice(0, 200)} shipped=${JSON.stringify(b)?.slice(0, 200)}`;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return firstJsonDiff(a[k], b[k], `${at}.${k}`);
  }
  return `${at}: key sets differ`;
}

const warnNote = warn ? `, ${warn} log-only warning(s)` : "";
console.log(`\nPARITY GOLDEN: ${pass} passed, ${fail} failed${warnNote}`);
// `process.exitCode`, NOT `process.exit()`: stdout to a pipe is asynchronous, so exiting immediately DISCARDS
// whatever is still buffered — and on a big failing run that is the summary line itself, which is exactly what a CI
// log or a reader looks for first. Setting the code lets Node flush and exit on its own.
if (fail) process.exitCode = 1;
