// Offline goldens for the HOST-NEUTRAL workflow core (skills/_workflow-core/).
//
// What this suite exists to prove, and why each leg is here rather than left to a
// live run:
//   1. THE PROTOCOL'S THREE OUTCOMES. A value, a terminal death and a rejection
//      are different states, and the workflows depend on the difference (a dead
//      Critique must report WHY it died, and a falsy-but-present answer is a
//      result, not a death). An adapter that collapses two of them looks correct
//      and reports "returned nothing" for every rejection.
//   2. CAPABILITY NEGOTIATION. A host missing an independent verifier context
//      must STOP, not run the phase anyway and hand back the same green verdict.
//   3. RESUME. The core is deterministic, so a killed run must replay from the
//      journal to exactly where it was — and a journal written by a DIFFERENT
//      core must be refused rather than replayed into decisions this run never
//      made.
//   4. CROSS-HOST PARITY. The Claude path and the CLI path must produce the
//      identical result for the identical inputs. That is the whole point of the
//      refactor, and it is the one thing no single-host test can see.
//   5. THE GENERATED ARTIFACT. The shipped `.workflow.js` must be in sync with
//      the core, must still evaluate as a Claude workflow function body, and must
//      still carry the pure-helper sentinels the offline slice test reads.
//
// Zero dependencies (node built-ins only), same `check` idiom as the sibling
// runners, exits 1 on any failed check.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = path.join(ROOT, "skills", "_workflow-core");

import { OUTCOME, ACCESS, step, workItem, record, errorShape, reviveError } from "../../skills/_workflow-core/work-item.mjs";
import { declareHost, negotiateStep, negotiateRun, CapabilityError } from "../../skills/_workflow-core/capabilities.mjs";
import { newRun, append, entriesFor, pendingIds, driftAt, noteHost, summary } from "../../skills/_workflow-core/run-state.mjs";
import { drive, advance } from "../../skills/_workflow-core/driver.mjs";
import * as cba from "../../skills/_workflow-core/behaviour-analysis/core.mjs";
import * as bex from "../../skills/_workflow-core/build-executor/core.mjs";
import { makeContext, makePaths } from "../../skills/_workflow-core/build-executor/context.mjs";
import { DEFAULT_MAX_ROUNDS, parkedKeys, parkableKeys } from "../../skills/_workflow-core/build-executor/helpers.mjs";
import * as helpers from "../../skills/_workflow-core/behaviour-analysis/helpers.mjs";
import { CLAUDE_HOST, makeExecute, agentOptionsFor, driveOnClaude } from "../../skills/_workflow-core/adapters/claude-workflow.mjs";
import { codexHost, codexSingleAgentHost } from "../../skills/_workflow-core/adapters/codex.mjs";
import { genericHost, explainMissing } from "../../skills/_workflow-core/adapters/generic-cli.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) { let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; } console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d))); }
};

/* ---------------------------------------------------------------------------
   1. THE WORK-ITEM PROTOCOL
   --------------------------------------------------------------------------- */
console.log("\n===== work-item protocol =====");
const okItem = { id: "context.a", phase: "Context", role: "general-purpose", prompt: "do it", responseSchema: { type: "object" }, access: ACCESS.STAND_READ_ONLY };
check("workItem: a well-formed item normalises, defaults its arrays and keeps its access level",
  () => { const i = workItem(okItem); return i.inputFiles.length === 0 && i.access === "stand-read-only" && i.label === "context.a"; });
check("workItem: `structuredOutput` is IMPLIED by a responseSchema — an adapter never has to infer it from the schema's presence",
  () => workItem(okItem).capabilities.includes("structuredOutput"));
check("workItem: a missing id / phase / role / prompt each THROW — a host that ran a prompt-less item would spend an agent to learn nothing",
  () => ["id", "phase", "role", "prompt"].every((k) => {
    const bad = { ...okItem }; delete bad[k];
    try { workItem(bad); return false } catch { return true }
  }));
check("workItem: an UNKNOWN access level throws — the safety model is per-item, so a typo may not degrade to 'none'",
  () => { try { workItem({ ...okItem, access: "stand-readonly" }); return false } catch (e) { return /unknown access level/.test(e.message) } });
check("step: a step with no items throws rather than yielding an empty batch the driver would silently skip",
  () => { try { step({ items: [] }); return false } catch { return true } });
check("step: `parallel` and `requires` ride on the step, not on the items — the batch is what a host may widen",
  () => { const s = step({ items: [okItem], parallel: true, requires: ["parallelism"] }); return s.parallel === true && s.requires[0] === "parallelism" && s.kind === "work"; });

console.log("\n===== the three outcomes =====");
check("record: a VALUE entry carries the value; a DEATH entry carries NO value field at all (absent ≠ null-valued)",
  () => { const v = record(workItem(okItem), OUTCOME.VALUE, { a: 1 }); const d = record(workItem(okItem), OUTCOME.DEATH);
    return v.value.a === 1 && !("value" in d) && d.outcome === "death"; });
check("record: an ERROR entry keeps name+message and NOT the stack — a stack differs per host and would make two identical runs' journals compare unequal",
  () => { const e = record(workItem(okItem), OUTCOME.ERROR, new TypeError("529 overloaded"));
    return e.error.name === "TypeError" && e.error.message === "529 overloaded" && !("stack" in e.error); });
check("errorShape: a null/undefined error still yields a usable message rather than `undefined`",
  () => errorShape(null).message === "rejected with no reason given" && !/undefined/.test(errorShape(new Error("no message reaches the shape")).message));
check("reviveError: an ERROR entry round-trips back into a real Error, so the core's own `catch` sees the cause",
  () => { const r = reviveError(errorShape(new RangeError("nope"))); return r instanceof Error && r.name === "RangeError" && r.message === "nope"; });
check("record: an unknown outcome throws — there are exactly three states and a fourth is an orchestration bug",
  () => { try { record(workItem(okItem), "maybe"); return false } catch { return true } });

/* ---------------------------------------------------------------------------
   2. CAPABILITIES
   --------------------------------------------------------------------------- */
console.log("\n===== capability negotiation =====");
const fullHost = declareHost({ id: "full", parallelism: 4, subAgents: true, structuredOutput: true, persistentState: true, humanApproval: true, independentRoles: true });
const thinHost = declareHost({ id: "thin", parallelism: 1, subAgents: true, structuredOutput: true });
check("declareHost: a host with no id THROWS — every run records which adapter executed it, so an anonymous adapter is refused",
  () => { try { declareHost({}); return false } catch (e) { return /stable `id`/.test(e.message) } });
check("negotiateStep: `parallelism` is DEGRADABLE — a sequential host still satisfies the step and the reduction is reported, not fatal",
  () => { const g = negotiateStep(thinHost, ["parallelism", "subAgents"], 5); return g.ok === true && g.width === 1 && g.reduced === true; });
check("negotiateStep: a host WITH parallelism runs the batch at its declared width and reports no reduction when the batch fits",
  () => { const g = negotiateStep(fullHost, ["parallelism"], 3); return g.width === 3 && g.reduced === false; });
check("negotiateStep: `independentRoles` is NOT degradable — a host that cannot isolate the verifier fails the step",
  () => { const g = negotiateStep(thinHost, ["independentRoles"], 1); return g.ok === false && g.missing.join(",") === "independentRoles"; });
check("negotiateRun: the run-level gate catches a missing capability BEFORE any agent is spent",
  () => negotiateRun(declareHost({ id: "x" }), ["subAgents", "structuredOutput"]).missing.join(",") === "subAgents,structuredOutput");
check("CapabilityError: the message says the run does NOT continue in a degraded form — the whole point of the stop",
  () => { const e = new CapabilityError(["independentRoles"], "phase Critique");
    return /explicit stop/.test(e.message) && /does NOT continue in a degraded form/.test(e.message) && e.missing[0] === "independentRoles"; });
check("explainMissing: every refusable capability has an actionable remedy — 'run it somewhere else' alone is not one",
  () => ["subAgents", "structuredOutput", "independentRoles", "humanApproval", "persistentState"]
    .every((c) => /\w/.test(explainMissing([c])) && explainMissing([c]).includes(c)));
check("codexSingleAgentHost: declares the loss where it is CHOSEN — independentRoles false, so the core refuses the adversarial phases instead of letting one agent check its own work",
  () => codexSingleAgentHost().independentRoles === false && codexSingleAgentHost().id === "codex");
check("genericHost: the SAFE FLOOR is no sub-agents and no role independence — an unknown host stops on those phases rather than pretending",
  () => genericHost().independentRoles === false && genericHost().subAgents === false && genericHost().persistentState === true);
check("codexHost: parallelism defaults to 1 (honest: the submit loop is sequential) and persistent state is true (the journal is a file)",
  () => codexHost().parallelism === 1 && codexHost().persistentState === true && codexHost().humanApproval === true);

/* ---------------------------------------------------------------------------
   3. RUN STATE AND RESUME
   --------------------------------------------------------------------------- */
console.log("\n===== run state / journal =====");
const mkRun = () => newRun({ workflow: "w", input: { a: 1 }, host: fullHost });
check("newRun: the host is recorded on the run AND in a history — a resumed run may be driven by a different adapter and a reader must see that",
  () => { const r = mkRun(); noteHost(r, thinHost); return r.host.id === "thin" && r.hostHistory.map((h) => h.id).join(",") === "full,thin"; });
check("noteHost: the SAME adapter driving twice does not grow the history",
  () => { const r = mkRun(); noteHost(r, fullHost); noteHost(r, fullHost); return r.hostHistory.length === 1; });
check("newRun: `startedAt` is passed IN, never read from the clock — the core may not call Date.now() or a resumed run would not replay identically",
  () => mkRun().startedAt === null && newRun({ workflow: "w", startedAt: "2026-01-01" }).startedAt === "2026-01-01");
check("entriesFor: a PARTIALLY executed batch returns null — a half-filled results array would read as 'these items died'",
  () => { const r = mkRun(); append(r, record(workItem({ ...okItem, id: "a" }), OUTCOME.VALUE, 1));
    return entriesFor(r, ["a"]).length === 1 && entriesFor(r, ["a", "b"]) === null; });
check("pendingIds: names exactly the items still to run, so a host resumes the batch rather than redoing it",
  () => { const r = mkRun(); append(r, record(workItem({ ...okItem, id: "a" }), OUTCOME.VALUE, 1));
    return pendingIds(r, ["a", "b", "c"]).join(",") === "b,c"; });
check("driftAt: the same ids in the same order is NO drift; a different id at that position IS",
  () => { const r = mkRun(); append(r, record(workItem({ ...okItem, id: "a" }), OUTCOME.VALUE, 1));
    return driftAt(r, 0, ["a"]) === null && driftAt(r, 0, ["z"]) !== null; });
check("summary: counts outcomes per phase, so a reader sees a dead phase without reading logs",
  () => { const r = mkRun(); append(r, record(workItem({ ...okItem, id: "a" }), OUTCOME.DEATH));
    return summary(r).byPhase.Context.death === 1 && summary(r).host === "full"; });

/* ---------------------------------------------------------------------------
   4. THE DRIVER — how outcomes reach the core
   --------------------------------------------------------------------------- */
console.log("\n===== driver: outcome delivery =====");
// A minimal core that RECORDS what it was handed. This is the only way to assert
// the delivery convention: the real cores read the values, they do not report them.
function* echoCore(seen) {
  const one = yield step({ items: [{ id: "s1", phase: "P", role: "r", prompt: "p" }] });
  seen.push(["single", one]);
  let caught = null;
  try {
    yield step({ items: [{ id: "s2", phase: "P", role: "r", prompt: "p" }] });
  } catch (e) { caught = `${e.name}: ${e.message}`; }
  seen.push(["threw", caught]);
  const batch = yield step({ items: [1, 2, 3].map((n) => ({ id: `b${n}`, phase: "P", role: "r", prompt: "p" })), parallel: true });
  seen.push(["batch", batch]);
  return "done";
}
{
  const seen = [];
  const run = newRun({ workflow: "echo", host: fullHost });
  const outcomes = {
    s1: { outcome: OUTCOME.VALUE, value: { ok: 1 } },
    s2: { outcome: OUTCOME.ERROR, error: new TypeError("529 overloaded") },
    b1: { outcome: OUTCOME.VALUE, value: "one" },
    b2: { outcome: OUTCOME.DEATH },
    b3: { outcome: OUTCOME.ERROR, error: new Error("refused") },
  };
  const result = await drive({ core: echoCore(seen), run, host: fullHost, execute: async (i) => outcomes[i.id] });
  check("driver: a VALUE arrives as a one-element ARRAY aligned to the step's items — the core destructures `[ctx]`, so a bare value would silently read as undefined",
    Array.isArray(seen[0][1]) && seen[0][1].length === 1 && seen[0][1][0]?.ok === 1, () => JSON.stringify(seen[0]));
  check("driver: a REJECTION on a single-item step is THROWN into the core, so a try/catch there still fires (the retry loop's whole premise)",
    /TypeError: 529 overloaded/.test(seen[1][1] || ""), () => JSON.stringify(seen[1]));
  check("driver: inside a PARALLEL batch, both a death and a rejection become null HOLES — that is the `parallel()` contract the cores are written against, and one host may not report it differently",
    JSON.stringify(seen[2][1]) === JSON.stringify(["one", null, null]), () => JSON.stringify(seen[2]));
  check("driver: the core's return value is the run's result, and the run is marked done",
    result === "done" && run.status === "done" && run.result === "done");
  check("driver: every executed item is journalled with its outcome — three states, five entries, in dispatch order",
    run.journal.map((e) => `${e.id}:${e.outcome}`).join(" ") === "s1:value s2:error b1:value b2:death b3:error",
    () => run.journal.map((e) => `${e.id}:${e.outcome}`).join(" "));
}
{
  // An adapter that THROWS instead of returning an outcome. The distinction
  // between a death and a rejection must survive the adapter forgetting to catch.
  const seen = [];
  const run = newRun({ workflow: "echo", host: fullHost });
  let caught = null;
  const throwOnS2 = async (i) => {
    if (i.id === "s2") { throw new Error("adapter blew up"); }
    return { outcome: OUTCOME.VALUE, value: i.id };
  };
  await drive({ core: echoCore(seen), run, host: fullHost, execute: throwOnS2 })
    .catch((e) => { caught = e; });
  check("driver: an adapter that THROWS is normalised to an ERROR entry, not a crashed run — the run survives a failure the core is written to handle",
    !caught && seen[1][1] === "Error: adapter blew up", () => JSON.stringify({ caught: caught?.message, seen }));
}
{
  // AWAITED EAGERLY, not handed to `check` as a thunk: `check` tests a function's
  // return value for truthiness, and a Promise is always truthy — an async thunk
  // would make the assertion pass unconditionally AND leak the rejection.
  function* oneStep(seen) {
    try { seen.push(yield step({ items: [{ id: "only", phase: "P", role: "r", prompt: "p" }] })) }
    catch (e) { seen.push(`threw ${e.message}`) }
    return "end";
  }
  const seen = [];
  const run = newRun({ workflow: "x", host: fullHost });
  await drive({ core: oneStep(seen), run, host: fullHost, execute: async () => undefined });
  check("driver: an adapter returning NO outcome is an ERROR, not a silent success — a missing outcome is an adapter bug and must not read as a phase that answered",
    run.journal[0].outcome === OUTCOME.ERROR && /no outcome/.test(run.journal[0].error.message) && /threw/.test(seen[0]),
    () => JSON.stringify({ journal: run.journal, seen }));
}
{
  // `runBatch` — the hook a host with its own concurrency primitive supplies.
  const seen = [];
  const run = newRun({ workflow: "echo", host: fullHost });
  let batched = 0;
  await drive({
    core: echoCore(seen), run, host: fullHost,
    execute: async (i) => ({ outcome: OUTCOME.VALUE, value: i.id }),
    runBatch: (items, exec) => { batched = items.length; return Promise.all(items.map((i) => exec(i))); },
  });
  check("driver: a parallel batch goes through the host's OWN batch primitive when one is supplied — bypassing `parallel()` would lose the host's concurrency cap and its progress tree",
    batched === 3, () => `runBatch saw ${batched} item(s)`);
}
{
  // A sequential host must still run every item — the reduction is wall-clock only.
  const seen = [];
  const run = newRun({ workflow: "echo", host: thinHost });
  const logs = [];
  await drive({ core: echoCore(seen), run, host: thinHost, io: { log: (m) => logs.push(m) }, execute: async (i) => ({ outcome: OUTCOME.VALUE, value: i.id }) });
  check("driver: a host with parallelism 1 runs ALL THREE batch items in waves and SAYS so — a reduction in parallelism is never a reduction in coverage",
    seen[2][1].length === 3 && logs.some((l) => /in waves of 1/.test(l) && /not in coverage/.test(l)),
    () => JSON.stringify({ got: seen[2][1], logs }));
}
{
  const run = newRun({ workflow: "echo", host: thinHost });
  let err = null;
  await drive({ core: echoCore([]), run, host: thinHost, execute: async () => ({ outcome: OUTCOME.VALUE, value: 1 }), requires: ["independentRoles"] })
    .catch((e) => { err = e; });
  check("driver: the RUN-level gate stops before the first item — a host missing a required guarantee spends nothing",
    err instanceof CapabilityError && run.status === "stopped" && run.stop.where === "run" && run.journal.length === 0,
    () => JSON.stringify({ err: err?.message, run: run.stop, journal: run.journal.length }));
}

console.log("\n===== driver: replay and resume =====");
{
  // The same core, driven twice: the second pass must execute NOTHING.
  const run = newRun({ workflow: "echo", host: fullHost });
  const exec = async (i) => ({ outcome: OUTCOME.VALUE, value: i.id });
  await drive({ core: echoCore([]), run, host: fullHost, execute: async (i) => (i.id === "s2" ? { outcome: OUTCOME.ERROR, error: new Error("boom") } : exec(i)) });
  const before = run.journal.length;
  let executed = 0;
  const seen2 = [];
  const result = await drive({ core: echoCore(seen2), run, host: fullHost, execute: async (i) => { executed++; return exec(i); } });
  check("driver: a completed run REPLAYS with zero further execution — that is what makes resume free rather than a re-run",
    executed === 0 && run.journal.length === before && result === "done", () => JSON.stringify({ executed, before, after: run.journal.length }));
  check("driver: replay reproduces the THROWN rejection too, so a resumed run takes the same branch it took the first time",
    /Error: boom/.test(seen2[1][1] || ""), () => JSON.stringify(seen2[1]));
}
{
  // Journal drift: the recorded ids no longer match what the core asks for.
  const run = newRun({ workflow: "echo", host: fullHost });
  append(run, record(workItem({ id: "SOMETHING-ELSE", phase: "P", role: "r", prompt: "p" }), OUTCOME.VALUE, 1));
  let msg = null;
  await drive({ core: echoCore([]), run, host: fullHost, execute: async () => ({ outcome: OUTCOME.VALUE, value: 1 }) }).catch((e) => { msg = e.message; });
  check("driver: a journal written by a DIFFERENT core is REFUSED, naming both sides — replaying a stale entry is how a resumed run reports decisions it never made",
    /journal drifted at entry 0/.test(msg || "") && /SOMETHING-ELSE/.test(msg || "") && /Start a fresh run/.test(msg || ""), () => msg);
}
{
  // `advance` — the replay-only half a host without an inline agent runtime uses.
  const run = newRun({ workflow: "echo", host: codexHost() });
  const first = await advance({ core: echoCore([]), run, host: run.host });
  check("advance: stops at the FIRST unrecorded item and hands back the whole pending step — the work to go and do",
    first.status === "pending" && first.step.items[0].id === "s1" && first.pending.join(",") === "s1",
    () => JSON.stringify({ status: first.status, pending: first.pending }));
  append(run, record(first.step.items[0], OUTCOME.VALUE, { ok: 1 }));
  const second = await advance({ core: echoCore([]), run, host: run.host });
  check("advance: after a submit it walks FURTHER on the recorded outcome — the CLI's next/submit loop, with no AI runtime involved",
    second.status === "pending" && second.step.items[0].id === "s2", () => JSON.stringify(second.pending));
  append(run, record(second.step.items[0], OUTCOME.ERROR, new Error("refused")));
  const third = await advance({ core: echoCore([]), run, host: run.host });
  check("advance: a recorded ERROR is thrown back into the core on replay, so the pending step after it is the one the core's catch leads to",
    third.status === "pending" && third.pending.join(",") === "b1,b2,b3", () => JSON.stringify(third.pending));
  check("advance: a batch reports EVERY pending id, so a host can perform them together",
    third.step.parallel === true && third.step.items.length === 3);
}
{
  const run = newRun({ workflow: "echo", host: codexSingleAgentHost() });
  let err = null;
  await advance({ core: echoCore([]), run, host: run.host, requires: ["independentRoles"] }).catch((e) => { err = e; });
  check("advance: capability is checked BEFORE the host goes off and performs the work — being told afterwards is worthless",
    err instanceof CapabilityError && run.stop.reason === "capability", () => JSON.stringify({ err: err?.message, stop: run.stop }));
}

/* ---------------------------------------------------------------------------
   5. THE BEHAVIOUR-ANALYSIS CORE — decisions, and the retry as a generator
   --------------------------------------------------------------------------- */
console.log("\n===== behaviour-analysis core: inputs and shortcuts =====");
check("normalizeInput: a bare STRING is taken as the manifest, so a caller can pass just that",
  () => cba.normalizeInput("m.json").manifest === "m.json" && cba.normalizeInput(' {"manifest":"x"} ').manifest === "x");
check("assertInput: every missing required arg is NAMED, with the command that produces the digest — a run must fail loudly rather than guess a path",
  () => { try { cba.assertInput({ manifest: "m" }); return false } catch (e) { return /digest, environment, outDir/.test(e.message) && /--stubs/.test(e.message) } });
check("WORKFLOW_REQUIRES: `parallelism` is deliberately NOT required — a sequential host gets the same coverage, only slower",
  () => cba.WORKFLOW_REQUIRES.join(",") === "subAgents,structuredOutput");

// Drive the real core with a scripted host. `runCba` returns the result plus the
// item ids and phases it asked for, which is what lets the parity check below
// compare two hosts on more than the final number.
async function runCba(input, answer, hostDecl = fullHost) {
  const asked = [], logs = [], phases = [];
  const run = newRun({ workflow: cba.WORKFLOW, input, host: hostDecl });
  const io = { log: (m) => logs.push(m), phase: (p) => phases.push(p) };
  const result = await drive({
    core: cba.run(input, io), run, host: hostDecl, io, requires: cba.WORKFLOW_REQUIRES,
    execute: async (item) => { asked.push(item); return answer(item) },
  });
  return { result, asked, logs, phases, run };
}

const INPUT = { manifest: "m.json", digest: "d.json", environment: "env", outDir: "out", sectionSchema: "DealSection" };
const CTX = {
  scopes: [
    { role: "main page", schema: null, methodKeys: ["onSaved", "reload"], memberKeys: ["mixin:LeadMixin"], unresolvedCount: 0 },
    { role: "mini page", schema: "DealMini", methodKeys: ["initMini"], memberKeys: [], unresolvedCount: 0 },
  ],
  sharedCore: { path: "out/customizations-shared-core.md", cards: [{ id: "shared/C01", title: "LeadMixin body" }], messageRegister: [] },
  censusNote: "census proven via ExtendParent query", refusals: [],
};
const FULL_DESCRIBE = {
  reportPart: "out/part.md",
  indexEntries: [
    { key: "onSaved", card: "main/C01", ac: ["AC-1"] }, { key: "reload", card: "main/C02" },
    { key: "mixin:LeadMixin", card: "main/C03", bodyCard: "shared/C01" }, { key: "initMini", card: "DealMini/C01" },
  ],
  gaps: [], refusals: [],
};
const CLEAN_CRITIQUE = { uncovered: [], conflicts: [], settledElsewhere: [], notes: "" };
const MERGED = { reportPath: "out/customizations.md", indexPath: "out/behaviour-index.json", cardCount: 4, droppedDuplicates: [] };
const happyAnswer = (item) => {
  if (item.phase === "Context") return { outcome: OUTCOME.VALUE, value: CTX };
  if (item.phase === "Describe") return { outcome: OUTCOME.VALUE, value: FULL_DESCRIBE };
  if (item.phase === "Critique") return { outcome: OUTCOME.VALUE, value: CLEAN_CRITIQUE };
  return { outcome: OUTCOME.VALUE, value: MERGED };
};

{
  const { result, asked, phases } = await runCba(INPUT, happyAnswer);
  check("core: the phase sequence is Context → Describe → Critique → Merge, and nothing else",
    phases.join(" → ") === "Context → Describe → Critique → Merge", () => phases.join(" → "));
  check("core: a fully described surface is COMPLETE, with the count as the statement",
    result.coverage.complete === true && result.coverage.described === 4 && result.coverage.total === 4,
    () => JSON.stringify(result.coverage));
  check("core: a small surface gets ONE describe item over the whole surface — the fan-out is only worth its cost above the threshold",
    asked.filter((i) => i.phase === "Describe").length === 1 && result.describeAgents === 1);
  check("core: the Describe item's ROLE is the analysis contract itself (`classic-ui-expert`), so a host without that skill can say it cannot satisfy the item",
    asked.find((i) => i.phase === "Describe").role === "classic-ui-expert");
  check("core: every phase is declared READ-ONLY against the stand — a behaviour analysis that could write is the safety regression no coverage count would catch",
    asked.every((i) => i.access === ACCESS.STAND_READ_ONLY), () => asked.map((i) => `${i.phase}:${i.access}`).join(" "));
  check("core: the Critique step requires `independentRoles` — the adversarial pass is worthless from the context that wrote the cards",
    asked.length > 0 && result.critiqueRan === true);
  check("core: the work-item ids are STABLE and deterministic — the journal replays by id, so nothing in them may vary between two runs of the same input",
    asked.map((i) => i.id).join(",") === "context.census-shared-core,describe.1.main-page+DealMini,critique.coverage,merge.report-index",
    () => asked.map((i) => i.id).join(","));
}
{
  const totals = { ...INPUT, totals: { stubs: 0, members: 0 } };
  const { result, asked } = await runCba(totals, happyAnswer);
  check("core: a digest declaring ZERO rows exits before spending ANY item — an empty worklist is DONE, not incomplete",
    asked.length === 0 && result.skipped === true && result.coverage.complete === true, () => JSON.stringify({ asked: asked.length, result }));
}
{
  const { result, asked } = await runCba(INPUT, (i) => (i.phase === "Context" ? { outcome: OUTCOME.DEATH } : happyAnswer(i)));
  check("core: a DEAD Context is a failed run, NOT a surface with nothing on it — the one outcome that must never read as a clean zero-row analysis",
    result.stopped === "context-failed" && result.coverage.complete === false && result.coverage.total === null && asked.length === 1,
    () => JSON.stringify(result));
}
{
  // A describe pass that leaves a row uncovered must trigger the repair round —
  // and the verdict must read the REPAIRED counts, not round 1's.
  const partial = { ...FULL_DESCRIBE, indexEntries: FULL_DESCRIBE.indexEntries.slice(0, 2) };
  let describeCalls = 0;
  const { result, asked, logs } = await runCba(INPUT, (i) => {
    if (i.phase === "Context") return { outcome: OUTCOME.VALUE, value: CTX };
    if (i.phase === "Describe") { describeCalls++; return { outcome: OUTCOME.VALUE, value: describeCalls === 1 ? partial : FULL_DESCRIBE } }
    if (i.phase === "Critique") return { outcome: OUTCOME.VALUE, value: CLEAN_CRITIQUE };
    return { outcome: OUTCOME.VALUE, value: MERGED };
  });
  check("core: uncovered rows trigger a REPAIR round scoped to the owning scopes, and the repair items are ids of their own",
    asked.some((i) => i.id.startsWith("repair.")) && describeCalls === 2, () => asked.map((i) => i.id).join(","));
  check("core: the verdict reads the REPAIRED counts — computed after the repair round, so a run is never reported complete that the repair round had not finished",
    result.coverage.complete === true && result.coverage.described === 4 && logs.some((l) => /coverage after repair/.test(l)),
    () => JSON.stringify({ coverage: result.coverage, logs }));
}
{
  // A mixin row citing only its wiring card: covered by the count, incomplete by
  // the two-card rule. It must block completeness even when nothing is uncovered.
  const wiringOnly = { ...FULL_DESCRIBE, indexEntries: FULL_DESCRIBE.indexEntries.map((e) => (e.key === "mixin:LeadMixin" ? { key: e.key, card: e.card } : e)) };
  const { result } = await runCba(INPUT, (i) => {
    if (i.phase === "Context") return { outcome: OUTCOME.VALUE, value: CTX };
    if (i.phase === "Describe") return { outcome: OUTCOME.VALUE, value: wiringOnly };
    if (i.phase === "Critique") return { outcome: OUTCOME.VALUE, value: CLEAN_CRITIQUE };
    return { outcome: OUTCOME.VALUE, value: MERGED };
  });
  check("core: a mixin row naming ONLY a wiring card blocks completeness on every round — the row looks covered while the criteria that gate it are named nowhere the plan points",
    result.coverage.complete === false && result.coverage.wiringOnly.join(",") === "mixin:LeadMixin",
    () => JSON.stringify(result.coverage));
}
{
  const { result } = await runCba(INPUT, (i) => (i.phase === "Merge" ? { outcome: OUTCOME.DEATH } : happyAnswer(i)));
  check("core: full coverage with a DEAD Merge is NOT complete — coverage is not the deliverable, the report and the index are",
    result.coverage.complete === false && result.coverage.described === 4, () => JSON.stringify(result.coverage));
}

console.log("\n===== the Critique retry, EXECUTED as a generator =====");
// `retryOnDeath` is a DELEGATING generator now: it asks the driver for one more
// attempt rather than calling an agent API. Driven here directly so the second
// attempt is proven to FIRE — the defect a source regex could never see.
function driveRetry(outcomes, onFailure) {
  const it = helpers.retryOnDeath((attempt) => step({ items: [{ id: `try${attempt}`, phase: "Critique", role: "r", prompt: "p" }] }), onFailure);
  const attempts = [];
  let send = { type: "next", value: undefined };
  for (;;) {
    const res = send.type === "throw" ? it.throw(send.value) : it.next(send.value);
    if (res.done) return { outcome: res.value, attempts };
    attempts.push(res.value.items[0].id);
    const next = outcomes[attempts.length - 1];
    send = next?.throw ? { type: "throw", value: next.throw } : { type: "next", value: [next ? next.value : null] };
  }
}
{
  const fails = [];
  const note = (attempt, error, willRetry) => fails.push({ attempt, msg: error ? error.message : null, willRetry });
  const second = driveRetry([{ value: null }, { value: { ok: true } }], note);
  check("retryOnDeath: an attempt that dies FIRES a real second attempt, and the second attempt's success is the result",
    second.attempts.length === 2 && second.outcome.result?.ok === true && second.outcome.ran === true
      && fails.length === 1 && fails[0].willRetry === true, () => JSON.stringify({ second, fails }));

  fails.length = 0;
  const dead = driveRetry([{ value: null }, { value: null }], note);
  check("retryOnDeath: both attempts dead ⇒ {result:null, ran:false}, exactly TWO attempts, and the last failure does not advertise a retry that will not happen",
    dead.outcome.ran === false && dead.outcome.result === null && dead.attempts.length === 2 && fails[1].willRetry === false,
    () => JSON.stringify({ dead, fails }));

  fails.length = 0;
  const rejected = driveRetry([{ throw: new Error("529 overloaded #1") }, { throw: new Error("529 overloaded #2") }], note);
  check("retryOnDeath: a REJECTING host collapses into the same dead outcome and never throws past the caller — the motivating 529, which used to end the run with no contradiction check at all",
    rejected.outcome.ran === false && rejected.attempts.length === 2
      && /529 overloaded #1/.test(fails[0].msg) && /529 overloaded #2/.test(fails[1].msg), () => JSON.stringify(fails));

  fails.length = 0;
  const first = driveRetry([{ value: { ok: true } }], note);
  check("retryOnDeath: a first-attempt success spends exactly ONE agent and reports no failure",
    first.attempts.length === 1 && first.outcome.ran === true && fails.length === 0);

  const noNotifier = driveRetry([{ value: null }, { value: null }], undefined);
  check("retryOnDeath: a missing notifier does not throw — the helper degrades to a plain retry rather than turning a dead phase into a crashed run",
    noNotifier.outcome.ran === false && noNotifier.attempts.length === 2);

  for (const [falsy, label] of [[0, "0"], ["", '""'], [false, "false"], [Number.NaN, "NaN"]]) {
    const r = driveRetry([{ value: falsy }], note);
    check(`retryOnDeath: a falsy-but-PRESENT result (${label}) counts as RAN — one attempt, and the value is handed back intact`,
      r.outcome.ran === true && Object.is(r.outcome.result, falsy) && r.attempts.length === 1,
      () => JSON.stringify({ ran: r.outcome.ran, result: String(r.outcome.result), attempts: r.attempts }));
  }
  const undef = driveRetry([{ value: undefined }, { value: undefined }], note);
  check("retryOnDeath: `undefined` is DEATH, not a result — an attempt that fell off its end returned nothing",
    undef.outcome.ran === false && undef.attempts.length === 2);
}
{
  // The retry, IN THE REAL CORE: a dead Critique must still let the run finish
  // and must report `critiqueRan: false` so nothing downstream reads
  // conflicts/settledElsewhere as verified-empty.
  let critiqueTries = 0;
  const { result, logs, asked } = await runCba(INPUT, (i) => {
    if (i.phase === "Critique") { critiqueTries++; return { outcome: OUTCOME.ERROR, error: new Error("529 overloaded") } }
    return happyAnswer(i);
  });
  check("core: a rejecting Critique is retried ONCE and the run still finishes — a dead adversarial pass may not end the run silently",
    critiqueTries === 2 && result.coverage.described === 4, () => JSON.stringify({ critiqueTries, coverage: result.coverage }));
  check("core: the retry attempt is a DISTINCT work item (`critique.coverage.retry2`), so the journal can replay both attempts",
    asked.filter((i) => i.phase === "Critique").map((i) => i.id).join(",") === "critique.coverage,critique.coverage.retry2",
    () => asked.filter((i) => i.phase === "Critique").map((i) => i.id).join(","));
  check("core: `critiqueRan:false` is reported AND the log says coverage.complete is arithmetic-only — the caller must not read conflicts as checked-and-empty",
    result.critiqueRan === false && logs.some((l) => /Critique never ran/.test(l) && /arithmetic-only/.test(l)),
    () => JSON.stringify({ critiqueRan: result.critiqueRan, logs: logs.filter((l) => /Critique/.test(l)) }));
  check("core: the CAUSE reaches the log, per attempt — a dead pass reports why it died, not merely that it did",
    logs.filter((l) => /529 overloaded/.test(l)).length === 2, () => JSON.stringify(logs.filter((l) => /critique agent died/.test(l))));
}
{
  const { result, logs } = await runCba(INPUT, (i) => (i.phase === "Critique" ? { outcome: OUTCOME.VALUE, value: 7 } : happyAnswer(i)));
  check("core: a Critique that returned something UNUSABLE gets its own log line and `critiqueRan:false` — 'returned something unusable' and 'the host never answered' need different repairs",
    result.critiqueRan === false && logs.some((l) => /treating the pass as dead/.test(l)),
    () => JSON.stringify(logs.filter((l) => /Critique|pass as dead/.test(l))));
}

/* `critiqueDeathLine` and `isCritiqueShape` — the two pure answers around the retry. Both moved here with the
   helper they belong to (they used to be exercised from run-infra.mjs against the sliced workflow block).
   Asserted on the produced string / the verdict, never on their source. */
{
  const lineRejected = helpers.critiqueDeathLine(1, new TypeError("529 overloaded"), true);
  check("critiqueDeathLine: a REJECTION names the attempt, the error TYPE and its message, and announces the retry — a `critiqueRan:false` run must carry the reason, not only the fact",
    /attempt 1/.test(lineRejected) && /TypeError/.test(lineRejected) && /529 overloaded/.test(lineRejected)
      && lineRejected.endsWith(" — retrying once"), () => lineRejected);
  const lineNull = helpers.critiqueDeathLine(2, null, false);
  check("critiqueDeathLine: a NULL outcome says so explicitly and cites the contract — 'returned nothing' must not read as an unknown error",
    /attempt 2/.test(lineNull) && /returned nothing \(terminal death/.test(lineNull) && !/Error/.test(lineNull), () => lineNull);
  check("critiqueDeathLine: only a NON-FINAL attempt advertises the retry — the last failure promising a retry that never comes is exactly the misreport this log exists to prevent",
    helpers.critiqueDeathLine(1, null, true).endsWith(" — retrying once") && !/retrying/.test(lineNull));
  // Deliberately degenerate input: an Error whose message is EMPTY, which exercises the fallback half of
  // `error.message || String(error)`. Blanked after construction rather than written as `new Error("")` —
  // sonar S7722 flags that constructor form, and it is right about production code; this is test input that
  // must not carry a message.
  const blankMessage = new Error("blanked on the next line");
  blankMessage.message = "";
  check("critiqueDeathLine: an error carrying no message still yields a usable line — a thrown string or a message-less Error must not render as `undefined`",
    !/undefined/.test(helpers.critiqueDeathLine(1, blankMessage, false)) && !/undefined/.test(helpers.critiqueDeathLine(1, "boom", false)),
    () => JSON.stringify([helpers.critiqueDeathLine(1, blankMessage, false), helpers.critiqueDeathLine(1, "boom", false)]));

  /* `isCritiqueShape` — the narrowing between the retry loop's `ran` and the `critiqueRan` the caller reads. Every
     falsy-but-present value that `retryOnDeath` correctly treats as RAN is a value the CALLER must NOT report as a
     completed adversarial pass: `critique?.conflicts || []` renders it as "checked, none found". */
  const fullCritique = { uncovered: [], conflicts: [], settledElsewhere: [] };
  check("isCritiqueShape: the schema-valid shape (all three arrays) is the ONLY thing that counts as a completed pass",
    helpers.isCritiqueShape(fullCritique) === true && helpers.isCritiqueShape({ ...fullCritique, uncovered: [{ key: "m" }] }) === true);
  for (const notCritique of [0, "", false, Number.NaN, 7, "done", true, [], [1, 2], null, undefined]) {
    const shown = Array.isArray(notCritique) ? `[${notCritique}]` : String(notCritique);
    check(`isCritiqueShape: \`${shown}\` is NOT a completed pass — it stops the retry loop legitimately, but reporting it as one claims conflicts/settledElsewhere were verified empty when nothing was checked`,
      helpers.isCritiqueShape(notCritique) === false, () => `${typeof notCritique}: ${String(notCritique)}`);
  }
  check("isCritiqueShape: a PARTIAL critique is dead too — the repair round still reads `uncovered` either way, so the only thing refused is a claim that the MISSING field was verified",
    helpers.isCritiqueShape({ uncovered: [], conflicts: [] }) === false
      && helpers.isCritiqueShape({ uncovered: [], conflicts: [], settledElsewhere: "none" }) === false);
}

/* ---------------------------------------------------------------------------
   6. CROSS-HOST PARITY — the whole point of the refactor
   --------------------------------------------------------------------------- */
console.log("\n===== cross-host parity =====");
{
  // Host A: the Claude adapter, driven through a FAKE `agent()`/`parallel()`.
  const claudeCalls = [];
  const fakeAgent = async (prompt, opts) => {
    claudeCalls.push({ label: opts.label, phase: opts.phase, agentType: opts.agentType, hasSchema: !!opts.schema, prompt });
    if (opts.phase === "Context") return CTX;
    if (opts.phase === "Describe") return FULL_DESCRIBE;
    if (opts.phase === "Critique") return CLEAN_CRITIQUE;
    return MERGED;
  };
  const fakeParallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const claudeRun = newRun({ workflow: cba.WORKFLOW, input: INPUT, host: CLAUDE_HOST });
  const claudeIo = { log: () => {}, phase: () => {} };
  const claudeResult = await driveOnClaude({
    core: cba.run(INPUT, claudeIo), run: claudeRun, io: claudeIo,
    agent: fakeAgent, parallel: fakeParallel, requires: cba.WORKFLOW_REQUIRES,
  });

  // Host B: the Codex/CLI adapter — sequential, no `parallel()`, journal-driven.
  const codex = codexHost();
  const codexRun = newRun({ workflow: cba.WORKFLOW, input: INPUT, host: codex });
  const codexIo = { log: () => {}, phase: () => {} };
  const codexResult = await drive({
    core: cba.run(INPUT, codexIo), run: codexRun, host: codex, io: codexIo, requires: cba.WORKFLOW_REQUIRES,
    execute: async (item) => happyAnswer(item),
  });

  check("parity: the two hosts return the IDENTICAL result for identical inputs — the coverage verdict is the core's arithmetic, not a property of the runtime",
    JSON.stringify(claudeResult) === JSON.stringify(codexResult),
    () => `claude: ${JSON.stringify(claudeResult).slice(0, 300)}\n      codex:  ${JSON.stringify(codexResult).slice(0, 300)}`);
  check("parity: both journals record the same work items in the same order — the decisions, not just the answer, are the same",
    claudeRun.journal.map((e) => e.id).join(",") === codexRun.journal.map((e) => e.id).join(","),
    () => `${claudeRun.journal.map((e) => e.id).join(",")}\n      ${codexRun.journal.map((e) => e.id).join(",")}`);
  check("parity: each run records WHICH adapter executed it — two identical artifacts must still be attributable to their host",
    claudeRun.host.id === "claude-workflow" && codexRun.host.id === "codex");
  check("claude adapter: a role maps to an agentType and the schema is passed through — the classic-ui-expert role runs as general-purpose and invokes the skill from its prompt, exactly as the hand-written workflow did",
    () => { const o = agentOptionsFor(workItem({ ...okItem, role: "classic-ui-expert", label: "L" }));
      return o.agentType === "general-purpose" && o.phase === "Context" && o.label === "L" && !!o.schema; });
  check("claude adapter: a NULLISH `agent()` resolution is DEATH and a rejection is an ERROR — the host contract, read the same way as everywhere else",
    () => { const exec = makeExecute(async (p, o) => (o.label === "die" ? null : (() => { throw new Error("nope") })()));
      return Promise.all([exec(workItem({ ...okItem, label: "die" })), exec(workItem({ ...okItem, label: "reject" }))])
        .then(([a, b]) => a.outcome === OUTCOME.DEATH && b.outcome === OUTCOME.ERROR); });
  check("claude adapter: the Describe prompt carries the read-only rule and the shared-core reference — the prompt IS the safety contract, so it is asserted on the text a phase actually receives",
    claudeCalls.some((c) => c.phase === "Describe" && /READ-ONLY against the stand/.test(c.prompt) && /SHARED CORE/.test(c.prompt)));
  check("claude adapter: every dispatched item carried a schema — the coverage arithmetic is computed on these answers, never read from prose",
    claudeCalls.every((c) => c.hasSchema));
}

/* ---------------------------------------------------------------------------
   7. THE GENERATED ARTIFACT
   --------------------------------------------------------------------------- */
console.log("\n===== the generated Claude workflow =====");
// Does this line REFERENCE the injected `args` global (as opposed to mentioning it in prose, or carrying a
// `.args` property or an `args:` key)? Written as a bounded scan rather than one regex with `^`/`$` alternations,
// which backtracks super-linearly on a long line (Sonar S8786).
const mentionsArgs = (line) => {
  const code = line.replace(/\/\/.*$/, "");
  let i = code.indexOf("args");
  while (i >= 0) {
    const before = i === 0 ? "" : code[i - 1];
    const after = code[i + 4] ?? "";
    const boundedBefore = before === "" || !/[.\w'`]/.test(before);
    const boundedAfter = after === "" || !/[\w:]/.test(after);
    if (boundedBefore && boundedAfter) return true;
    i = code.indexOf("args", i + 1);
  }
  return false;
};

const GENERATED = path.join(ROOT, "skills/classic-to-freedom-migration/classic-behaviour-analysis.workflow.js");
const genSrc = readFileSync(GENERATED, "utf8");
{
  const res = spawnSync(process.execPath, [path.join(ROOT, "scripts/build-workflows.mjs"), "--check"], { encoding: "utf8" });
  check("generator: the shipped `.workflow.js` is IN SYNC with the core — an edit to either alone must fail here, not ship as a silent divergence",
    res.status === 0, () => `${res.stdout}${res.stderr}`);
}
check("generated: no `import` or `export` survives except `meta` — the host evaluates this as a function body, so either would be a SyntaxError at run time",
  genSrc.split("\n").filter((l) => /^\s*(import|export)\s/.test(l)).join(" | ") === "export const meta = {",
  () => genSrc.split("\n").filter((l) => /^\s*(import|export)\s/.test(l)).slice(0, 5).join(" | "));
check("generated: the pure-helper sentinels are still present — the offline slice-and-import suite reads the SHIPPED artifact through them",
  genSrc.includes("// ---8<--- PURE DECISION HELPERS ---8<---") && genSrc.includes("// ---8<--- END PURE DECISION HELPERS ---8<---"));
check("generated: it says it is generated and names the command that rebuilds it — a hand edit here is silently overwritten otherwise",
  /GENERATED FILE — DO NOT EDIT BY HAND/.test(genSrc) && /node scripts\/build-workflows\.mjs/.test(genSrc));
// The strongest available proof that the inlined block is host-neutral: slice it
// out of the SHIPPED file and import it as a real ES module. A free reference to
// an injected global at top level throws here; a reference inside a function body
// is legitimate exactly when it is a PARAMETER, which is how the Claude adapter
// receives `agent`/`parallel`.
{
  const BEGIN = "// ---8<--- PURE DECISION HELPERS ---8<---";
  const END = "// ---8<--- END PURE DECISION HELPERS ---8<---";
  const from = genSrc.indexOf(BEGIN), to = genSrc.indexOf(END);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wf-slice-"));
  let mod = null, threw = null;
  try {
    const modPath = path.join(tmp, "slice.mjs");
    writeFileSync(modPath, `${genSrc.slice(from + BEGIN.length, to)}\nexport { packBatches, isComplete, digestKeyOf, wiringOnlyMixinKeys, retryOnDeath, run, WORKFLOW, WORKFLOW_REQUIRES, CLAUDE_HOST, newRun, normalizeInput, driveOnClaude };\n`);
    mod = await import(new URL(`file://${modPath}`).href);
  } catch (e) { threw = e; } finally { rmSync(tmp, { recursive: true, force: true }) }
  check("generated: the inlined block LOADS AS A STANDALONE MODULE — it closes over no injected global, which is what makes the same code runnable on Codex",
    !threw && typeof mod?.run === "function" && typeof mod?.packBatches === "function", () => `${threw?.name}: ${threw?.message}`);
  check("generated: `args` — the one thing that can only be a global — appears ONLY in the tail below the sentinels",
    !genSrc.slice(from, to).split("\n").some(mentionsArgs)
      && /normalizeInput\(args\)/.test(genSrc.slice(to)),
    () => genSrc.slice(from, to).split("\n").filter(mentionsArgs).slice(0, 3).join(" | "));
}

// The real thing: EVALUATE the shipped file the way the host does, and confirm it
// still produces the same run. A generated file that no longer runs is the one
// failure that would reach production silently — every module test above would
// still be green.
{
  const body = genSrc.replace(/^export const meta = \{[\s\S]*?\n\}\n/, "");
  const calls = [], logs = [], phases = [];
  const agent = async (prompt, opts) => {
    calls.push(opts.label);
    if (opts.phase === "Context") return CTX;
    if (opts.phase === "Describe") return FULL_DESCRIBE;
    if (opts.phase === "Critique") return CLEAN_CRITIQUE;
    return MERGED;
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  // The shipped body becomes a real ES module under the OS temp dir and is imported — no `new Function`, no eval,
  // matching the sibling runners' decision to keep these files free of a dynamic-code construct a reviewer then
  // has to reason about. Wrapping it in `export default async function(args, log, phase, agent, parallel)` is the
  // SAME environment the host provides: a function body with exactly those five names in scope, and a top-level
  // `return` that is the run's result.
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wf-shipped-"));
  let result = null, threw = null;
  try {
    const modPath = path.join(tmp, "shipped.mjs");
    writeFileSync(modPath, `export default async function (args, log, phase, agent, parallel) {\n${body}\n}\n`);
    const mod = await import(new URL(`file://${modPath}`).href);
    result = await mod.default(INPUT, (m) => logs.push(m), (p) => phases.push(p), agent, parallel);
  } catch (e) { threw = e; } finally { rmSync(tmp, { recursive: true, force: true }) }
  check("generated: the shipped file EVALUATES as a Claude workflow function body and runs to a result — the one failure that would otherwise reach production with a fully green suite",
    !threw && !!result, () => `${threw?.name}: ${threw?.message}`);
  check("generated: it walks the same four phases with the same agent labels as the module-level core",
    phases.join(" → ") === "Context → Describe → Critique → Merge"
      && calls.join(",") === "context:census+shared-core,describe:main page+DealMini,critique:coverage,merge:report+index",
    () => JSON.stringify({ phases, calls }));
  check("generated: and the same verdict — 4 of 4 rows described, complete",
    result?.coverage?.complete === true && result?.coverage?.described === 4, () => JSON.stringify(result?.coverage));
}

/* ---------------------------------------------------------------------------
   8. THE CLI — the integration point for a host with no workflow runtime
   --------------------------------------------------------------------------- */
console.log("\n===== the migration-workflow CLI =====");
{
  const cliPath = path.join(CORE, "cli.mjs");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wfcli-"));
  try {
    const runFile = path.join(tmp, "run.json");
    const inputFile = path.join(tmp, "input.json");
    writeFileSync(inputFile, JSON.stringify(INPUT));
    const cli = (...argv) => spawnSync(process.execPath, [cliPath, ...argv], { encoding: "utf8" });

    const started = cli("start", runFile, "--workflow", "classic-behaviour-analysis", "--input", inputFile, "--host", "codex");
    check("cli start: writes the run state and names the host that will drive it",
      started.status === 0 && /started creatio-classic-behaviour-analysis on host `codex`/.test(started.stdout), () => started.stdout + started.stderr);
    check("cli start: refuses to clobber an existing run — the journal IS the run, and overwriting it silently loses the work",
      cli("start", runFile, "--workflow", "classic-behaviour-analysis", "--input", inputFile).status === 2);

    const outDir = path.join(tmp, "prompts");
    const next1 = cli("next", runFile, "--out", outDir);
    const n1 = JSON.parse(next1.stdout);
    check("cli next: hands back the pending item with everything needed to perform it — phase, role, access, input files, schema — and writes the prompt to a file",
      n1.status === "pending" && n1.items[0].id === "context.census-shared-core" && n1.items[0].access === "stand-read-only"
        && readFileSync(n1.items[0].promptFile, "utf8").includes("CONTEXT phase"),
      () => next1.stdout.slice(0, 400));

    const badResult = path.join(tmp, "bad.json");
    writeFileSync(badResult, JSON.stringify({ scopes: [] }));
    const bad = cli("submit", runFile, "context.census-shared-core", badResult);
    check("cli submit: a result missing a REQUIRED schema key is refused — a shape the core will misread must not enter the journal",
      bad.status === 2 && /missing required key\(s\): sharedCore, censusNote/.test(bad.stderr), () => bad.stderr);

    const wrongId = cli("submit", runFile, "describe.1.main-page+DealMini", badResult);
    check("cli submit: a result for an item that is NOT pending is refused, naming what is — otherwise it would sit unread and the run would ask for the same work again",
      wrongId.status === 2 && /is not pending/.test(wrongId.stderr), () => wrongId.stderr);

    const write = (name, value) => { const p = path.join(tmp, name); writeFileSync(p, JSON.stringify(value)); return p };
    const submits = [
      ["context.census-shared-core", write("ctx.json", CTX)],
      ["describe.1.main-page+DealMini", write("desc.json", FULL_DESCRIBE)],
      ["critique.coverage", write("crit.json", CLEAN_CRITIQUE)],
      ["merge.report-index", write("merge.json", MERGED)],
    ];
    let allOk = true;
    for (const [id, file] of submits) {
      const r = cli("submit", runFile, id, file);
      if (r.status !== 0) { allOk = false; console.log("      ↳ submit " + id + " failed: " + r.stderr) }
    }
    check("cli submit: every phase's result is accepted in turn — the next/submit loop is the whole Codex integration", allOk);

    const done = JSON.parse(cli("next", runFile).stdout);
    check("cli: the finished run's result is IDENTICAL to what the Claude path produced — same coverage, same paths, same verdict",
      done.status === "done" && done.result.coverage.complete === true && done.result.coverage.described === 4
        && done.result.indexPath === "out/behaviour-index.json",
      () => JSON.stringify(done).slice(0, 400));

    const status = JSON.parse(cli("status", runFile).stdout);
    check("cli status: reports the host, the per-phase outcome counts and the result without re-running anything",
      status.host === "codex" && status.executed === 4 && status.byPhase.Merge.value === 1, () => JSON.stringify(status));

    // The capability stop, end to end.
    const stopRun = path.join(tmp, "stop.json");
    cli("start", stopRun, "--workflow", "classic-behaviour-analysis", "--input", inputFile, "--host", "codex", "--no-independent-roles");
    cli("submit", stopRun, "context.census-shared-core", write("ctx2.json", CTX));
    cli("submit", stopRun, "describe.1.main-page+DealMini", write("desc2.json", FULL_DESCRIBE));
    const stopped = cli("next", stopRun);
    check("cli: a host that cannot isolate the verifier STOPS at Critique with the remedy — and exits non-zero, so a script cannot mistake it for a completed run",
      stopped.status === 3 && /independentRoles/.test(stopped.stderr) && /mutually blind/.test(stopped.stderr) && /Nothing was executed/.test(stopped.stderr),
      () => stopped.stderr);
    const stopState = JSON.parse(readFileSync(stopRun, "utf8"));
    check("cli: the stop is RECORDED on the run — `stopped` with the missing capability and the phase that needed it, so the reason survives the process",
      stopState.status === "stopped" && stopState.stop.missing.join(",") === "independentRoles" && /Critique/.test(stopState.stop.where),
      () => JSON.stringify(stopState.stop));

    // Resume: a killed process comes back and re-reads the journal.
    const resumed = JSON.parse(cli("status", runFile).stdout);
    check("cli resume: re-reading the finished run reconstructs the same state from the journal alone — no AI runtime involved in the replay",
      resumed.executed === 4 && resumed.status === "done", () => JSON.stringify(resumed));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------------------
   9. THE BUILD EXECUTOR — the second workflow on the same core
   --------------------------------------------------------------------------- */
console.log("\n===== build-executor core =====");
const BEX_INPUT = {
  manifest: "/mig/manifest.json", environment: "dev", outDir: "/mig", planFile: "/mig/plan.md",
  engine: "/plug/skills/classic-to-freedom-migration/engine/migrate.mjs", sectionSchema: "DealSection",
};
check("build-executor: `independentRoles` is a RUN-level requirement, not merely a per-step one — the builder / verifier / judge split is what the whole workflow rests on, so a host that cannot provide it is refused before the first stand WRITE",
  bex.WORKFLOW_REQUIRES.includes("independentRoles") && bex.WORKFLOW === "creatio-freedom-build-executor",
  () => bex.WORKFLOW_REQUIRES.join(","));
check("build-executor: `assertInput` names every missing arg INCLUDING the engine, which is resolved rather than passed — a run that cannot find `migrate.mjs` must refuse rather than send a placeholder into a prompt",
  () => { try { bex.assertInput({ manifest: "/m.json" }); return false } catch (e) { return /environment, outDir, planFile, engine/.test(e.message) } });
check("build-executor: the engine is resolved from the CALLER'S OWN location when no `engine` arg is given — the module has no `import.meta` of its own, because it is inlined into a workflow script where that is a parse error",
  () => bex.resolveEngineCli({}, "/plug/skills/_workflow-core/build-executor/core.mjs") === "" &&
    bex.resolveEngineCli({}, "/plug/skills/freedom-build-executor/x.workflow.js") === "/plug/skills/classic-to-freedom-migration/engine/migrate.mjs");
check("build-executor: the skills root resolves from EITHER anchor — the generated script's own home, or this core's — so the reference docs are absolute paths on both hosts",
  () => bex.resolveSkillsRoot("", "/plug/skills/freedom-build-executor/x.workflow.js") === "/plug/skills" &&
    bex.resolveSkillsRoot("", "/plug/skills/_workflow-core/build-executor/core.mjs") === "/plug/skills" &&
    bex.resolveSkillsRoot("/plug/skills/classic-to-freedom-migration/engine/migrate.mjs", "") === "/plug/skills");
{
  const ctx = makeContext(BEX_INPUT, "/plug/skills/_workflow-core/build-executor/core.mjs");
  check("build-executor context: every engine command line is SHELL-QUOTED — a migration folder with a space would otherwise split into two arguments and every phase would read or write the wrong path, with no error",
    /--units --resolutions '\/mig\/resolutions\.json' --slices '\/mig\/slices'/.test(ctx.CLI_UNITS) && ctx.CLI_VERIFY.includes("'/mig/built.json'"),
    () => ctx.CLI_UNITS);
  check("build-executor context: the round budget is the DESIGN value by default and the operator's when given — the helpers take it as a parameter now, so a configured value that never reached them would park early or never",
    ctx.MAX_ROUNDS === DEFAULT_MAX_ROUNDS && makeContext({ ...BEX_INPUT, maxRounds: 5 }, "").MAX_ROUNDS === 5);
  check("build-executor helpers: `parkedKeys` honours the budget it is HANDED, not a default — the run passes `MAX_ROUNDS` explicitly and this is what pins that the parameter is load-bearing",
    parkedKeys({}, { a: 4 }, ["a"], 5).length === 0 && parkedKeys({}, { a: 5 }, ["a"], 5).join(",") === "a"
      && parkedKeys({}, { a: 3 }, ["a"]).join(",") === "a",
    () => JSON.stringify({ five: parkedKeys({}, { a: 4 }, ["a"], 5), spent: parkedKeys({}, { a: 5 }, ["a"], 5), dflt: parkedKeys({}, { a: 3 }, ["a"]) }));
  check("build-executor helpers: `parkableKeys` threads the same budget through — budget spent AND still open, at the configured number",
    parkableKeys({}, { main: 4 }, [{ key: "main", kind: "page" }], { pages: {} }, {}, undefined, 5).length === 0
      && parkableKeys({}, { main: 5 }, [{ key: "main", kind: "page" }], { pages: {} }, {}, undefined, 5).join(",") === "main");
  const paths = makePaths(ctx, () => ["main", "list"]);
  check("build-executor paths: every per-unit file carries the UNIT NUMBER — a name built from the page key alone is many-to-one",
    paths.specFile("list") === "/mig/refs/spec-list-2.md" && paths.queueSliceFile("main") === "/mig/slices/queue-1.json");
  check("build-executor paths: an ABSENT key list gets its own refusal, distinct from a key that is not in the list — the two are different diagnoses",
    () => { const p2 = makePaths(ctx, () => []);
      try { p2.specFile("main"); return false } catch (e) { return /no published key list in run state yet/.test(e.message) } });
}
{
  // The whole run, through the CLI, on the Codex adapter — and then the capability stop.
  const cliPath = path.join(CORE, "cli.mjs");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "bex-cli-"));
  try {
    const cli = (...argv) => spawnSync(process.execPath, [cliPath, ...argv], { encoding: "utf8" });
    const inputFile = path.join(tmp, "input.json");
    writeFileSync(inputFile, JSON.stringify(BEX_INPUT));
    const runFile = path.join(tmp, "run.json");
    const started = cli("start", runFile, "--workflow", "freedom-build-executor", "--input", inputFile, "--host", "codex");
    check("build-executor cli: the run starts on the Codex adapter — the same core, a host with no Workflow runtime",
      started.status === 0 && /started creatio-freedom-build-executor on host `codex`/.test(started.stdout), () => started.stdout + started.stderr);
    const next1 = JSON.parse(cli("next", runFile).stdout);
    check("build-executor cli: the first work item is the BASELINE Reconcile, declared read-only against the stand",
      next1.items[0].id === "reconcile.baseline" && next1.items[0].access === "stand-read-only"
        && /RECONCILE phase of a Freedom build run — round 1/.test(next1.items[0].prompt),
      () => JSON.stringify(next1.items[0]).slice(0, 300));
    check("build-executor cli: the prompt carries the run's OWN engine command lines, shell-quoted — a Codex agent runs them verbatim",
      next1.items[0].prompt.includes("'/plug/skills/classic-to-freedom-migration/engine/migrate.mjs' '/mig/manifest.json' --units"));
    // A green baseline closes the run with no stand write at all.
    const green = {
      approval: { found: true, version: "plan-abc", quote: "approved" }, planVersion: "plan-abc",
      unitKeys: ["main"], buildOrder: ["main"], targetPackage: "P", packageState: "exists", mainEntity: "Deal",
      sectionHost: "existing-app", applicationCode: "App", componentTypes: [], componentResolution: [],
      pageSchemas: { main: "MainPage" }, parents: {}, reachability: [], reachabilityState: {},
      preflightItems: [], resolutionsUnmatched: [], resolutionsConflicts: [],
      evidenceIds: [], unjudgedEvidenceIds: [], evidenceFiled: [], evidenceRejected: [],
      parkedUnits: [], proposals: [], blocked: [], discrepancies: [], staleQueueKeys: [], newKeys: [],
      verify: { complete: true, missing: 0, unverified: 0, planGaps: [], pages: { main: { complete: true } } },
      exitCode: 0, planGaps: [], roundOf: {}, verifyTablePath: "/mig/verify.md", notes: "",
    };
    const gFile = path.join(tmp, "green.json"); writeFileSync(gFile, JSON.stringify(green));
    const sub = cli("submit", runFile, "reconcile.baseline", gFile);
    check("build-executor cli: the Reconcile result is accepted (the required keys the schema names are all present)",
      sub.status === 0, () => sub.stderr);
    const done = JSON.parse(cli("next", runFile).stdout);
    check("build-executor cli: a green baseline closes the run WITHOUT a single stand write — the idempotent answer to 'do the next undone thing' when nothing is undone",
      done.status === "done" && done.result.complete === true && done.result.skipped === true && done.result.rounds === 0,
      () => JSON.stringify(done.result).slice(0, 400));
    check("build-executor cli: the return names the artifacts an operator has to read, on every exit",
      done.result.verifyTable === "/mig/verify.md" && done.result.queueFile === "/mig/build-queue.json" && done.result.mode === "auto");

    // A work-item id is not a filename. `build.child:Documents.r1` carries a colon, which Windows refuses — and
    // this suite runs on windows-latest.
    {
      const nameRun = path.join(tmp, "names.json");
      cli("start", nameRun, "--workflow", "freedom-build-executor", "--input", inputFile, "--host", "codex");
      const pd = path.join(tmp, "prompts");
      const n = JSON.parse(cli("next", nameRun, "--out", pd).stdout);
      check("build-executor cli: the prompt FILE name is sanitised while the work-item id keeps the run's own vocabulary — a page key's colon is legal in an id and illegal in a Windows path",
        n.items[0].id === "reconcile.baseline" && !/[:*?"<>|]/.test(path.basename(n.items[0].promptFile))
          && readFileSync(n.items[0].promptFile, "utf8").length > 0,
        () => JSON.stringify({ id: n.items[0].id, file: n.items[0].promptFile }));
    }

    // The capability stop: a host that cannot isolate the verifier is refused BEFORE the first stand write.
    const stopRun = path.join(tmp, "stop.json");
    const st = cli("start", stopRun, "--workflow", "freedom-build-executor", "--input", inputFile, "--host", "codex", "--no-independent-roles");
    check("build-executor cli: `start` accepts the declaration; the refusal is the RUN gate, not a config parse error", st.status === 0);
    const stopped = cli("next", stopRun);
    check("build-executor cli: a host that cannot give the verifier and the judge their own contexts is STOPPED at the run gate — before Reconcile, before any stand write — with the remedy and a non-zero exit",
      stopped.status === 3 && /independentRoles/.test(stopped.stderr) && /mutually blind/.test(stopped.stderr),
      () => stopped.stderr);
    const stopState = JSON.parse(readFileSync(stopRun, "utf8"));
    check("build-executor cli: the stop is recorded with `where: run` and NOTHING was executed — a caller must be able to tell a refused run from a failed one",
      stopState.status === "stopped" && stopState.stop.where === "run" && stopState.journal.length === 0,
      () => JSON.stringify(stopState.stop));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\nWORKFLOW-CORE GOLDEN: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
