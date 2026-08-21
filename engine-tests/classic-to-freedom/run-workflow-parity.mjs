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

// Evaluate a workflow script the way the host does. The body becomes a real ES module under the OS temp dir and is
// imported — no `new Function`, no eval, matching the sibling runners' decision to keep these files free of a
// dynamic-code construct a reviewer then has to reason about.
async function runScript(src, args, answer) {
  const body = src.replace(/^export const meta = \{[\s\S]*?\n\}\n/, "");
  const phases = [], calls = [], logs = [];
  const agent = async (prompt, opts = {}) => {
    const req = opts.schema?.required ? [...opts.schema.required].sort((a, b) => a.localeCompare(b)) : null;
    calls.push({ phase: opts.phase || null, label: opts.label || null, agentType: opts.agentType || null, required: req, prompt: String(prompt ?? "") });
    return answer({ phase: opts.phase, label: opts.label, prompt, schema: opts.schema, nth: calls.length });
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
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
      shipped: "Write these cards to `",
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
    { name: "dead Critique, retried once — critiqueRan false", args: ARGS, answer: byPhase({ Context: CTX, Describe: FULL, Critique: null, Merge: MERGED }) },
    { name: "unusable Critique return — treated as dead", args: ARGS, answer: () => ({ phase }) => UNUSABLE_CRITIQUE[phase] ?? MERGED },
    { name: "dead Merge — coverage stands, run not complete", args: ARGS, answer: byPhase({ Context: CTX, Describe: FULL, Critique: CRIT, Merge: null }) },
    {
      name: "fan-out — a wide surface packs into several describe agents",
      args: { ...ARGS, rowsPerAgent: 2, maxDescribeAgents: 3 },
      answer: byPhase({ Context: CTX, Describe: FULL, Critique: CRIT, Merge: MERGED }),
    },
    { name: "missing required args — fails loudly before any agent", args: { manifest: "m.json" }, answer: byPhase({}) },
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
  const verify = (pages, extra = {}) => ({ complete: false, missing: 1, unverified: 0, planGaps: [], pages, ...extra });
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
    evidenceIds: ["main#quality-gates"], unjudgedEvidenceIds: [], evidenceFiled: [], evidenceRejected: [],
    parkedUnits: [], proposals: [], blocked: [], discrepancies: [],
    staleQueueKeys: [], newKeys: [],
    verify: verify({ "child:Documents": { complete: false, missing: 1, unverified: 0, openRows: [openRow("Field Amount")] }, list: { complete: true }, main: { complete: false, missing: 1, unverified: 0, openRows: [openRow("Field Stage")] } }),
    exitCode: 2, planGaps: [], roundOf: {}, verifyTablePath: "/mig/verify.md", notes: "",
    ...over,
  });
  const GREEN = RECONCILE({
    verify: { complete: true, missing: 0, unverified: 0, planGaps: [], pages: { "child:Documents": { complete: true }, list: { complete: true }, main: { complete: true } } },
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
  const makeHost = ({ reconciles, build = BUILT, verifyRes = VERIFIED, judge = JUDGED, refs = REFS, persist = PERSISTED, preflight, merge }) => {
    let r = 0;
    return ({ phase, label, prompt }) => {
      if (phase === "Reconcile") { const a = reconciles[Math.min(r, reconciles.length - 1)]; r++; return typeof a === "function" ? a() : a }
      if (phase === "Refs") return refs;
      if (phase === "Preflight") return label === "preflight:merge" ? (merge ?? { written: true, evidenceWritten: [], filesMissing: [], notes: "" }) : (preflight ?? { resolved: [], unresolved: [] });
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
    { name: "an unknown mode throws before any agent", args: { ...ARGS, mode: "semi" }, answer: host({ reconciles: [RECONCILE()] }) },
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
    { name: "missing required args — fails loudly before any agent", args: { manifest: "/mig/manifest.json" }, answer: host({ reconciles: [RECONCILE()] }) },
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
    note(`${sc.name} — the log lines are identical (wording may improve; not a contract)`,
      a.logs.join("\n") === b.logs.join("\n"),
      () => `baseline (${a.logs.length}):\n        ${a.logs.join("\n        ")}\n      shipped (${b.logs.length}):\n        ${b.logs.join("\n        ")}`);
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
if (fail) process.exit(1);
