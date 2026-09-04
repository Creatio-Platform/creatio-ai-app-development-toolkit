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
// hanging the suite. Every termination guarantee this workflow has — the describe fan-out cap, the single repair
// round, the one Critique retry — is a bound on how many agents a run may ask for, and the failure mode when one is
// removed is an infinite loop, not a wrong answer. A hang is the worst possible signal: it is indistinguishable from a slow machine
// and it names no scenario. Hitting the ceiling throws, the throw is reported as this run's `error`, and the
// comparison already requires the two sides' errors to match — so the correct baseline finishing normally against a
// mutated script that runs away is a NAMED failure on the scenario that provoked it.
// The widest legitimate scenario in this file dispatches well under a tenth of this, so the ceiling is generous
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
      throw new Error(`runaway: more than ${MAX_DISPATCHES} work items dispatched (last: ${opts.phase}/${opts.label}) — a termination bound (describe fan-out cap, single repair round or the one Critique retry) is not holding`);
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
// The pair under comparison.
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
    {
      // The inventory now qualifies a bare method key with the scope that owns it (`qualifyKey`). The baseline
      // listed the bare name, so two scopes declaring the same method reduced to ONE key in `allKeys` and one
      // description closed both rows — measured at 24 rows collapsing to 10 on a real section. The prompt shows
      // the agent the same spelling the coverage arithmetic counts, which is the point of the change.
      baseline: "    methods: initMini",
      shipped: "    methods: DealMini::initMini",
      why: "method keys are qualified with their scope so two scopes declaring the same name are two rows, not one (ENG-96529)",
    },
    {
      // The SAME change, seen from the Critique prompt: it is handed `allKeys`, so the qualified spelling shows
      // up there too. Listed separately rather than as a looser pattern — the two prompts are different contracts
      // and a change to one must not be waved through by a rule written for the other.
      baseline: "onSaved, reload, mixin:LeadMixin, initMini",
      shipped: "onSaved, reload, mixin:LeadMixin, DealMini::initMini",
      why: "the critique's key list carries the same qualified inventory keys (ENG-96529)",
    },
    {
      // And once more in the critique's uncovered list, for the same reason as the two entries above.
      baseline: "ROWS THIS RUN COMPUTED AS UNCOVERED (no index entry): mixin:LeadMixin, initMini",
      shipped: "ROWS THIS RUN COMPUTED AS UNCOVERED (no index entry): mixin:LeadMixin, DealMini::initMini",
      why: "the uncovered list is the same qualified inventory keys (ENG-96529)",
    },
    {
      // And in the repair round's own row list — the last place the inventory keys are spelled out to an agent.
      baseline: "no `bodyCard`: mixin:LeadMixin, initMini",
      shipped: "no `bodyCard`: mixin:LeadMixin, DealMini::initMini",
      why: "the repair round targets the same qualified inventory keys (ENG-96529)",
    },
    {
      // The repair round now writes its OWN part file and numbers its cards in its own namespace. Both rounds
      // order scopes by rows descending, so the same lead scope led a batch in each round and the repair agent
      // was handed round 1's path and round 1's `C01…` sequence: a repair agent writing that file fresh dropped
      // round 1's cards from the deliverable while `coveredKeys` still counted those rows. One entry, spanning
      // BOTH halves of the line, so a change to only the path or only the ids does not ride in on the other.
      baseline: "written to `out/customizations-part-main-page.md` — the skill's card contract, each card closing with numbered acceptance criteria. Namespace every card id `<scope>/C01`, `<scope>/C02`",
      shipped: "written to `out/customizations-part-main-page-round2.md` — the skill's card contract, each card closing with numbered acceptance criteria. Namespace every card id `<scope>/R2-C01`, `<scope>/R2-C02`",
      why: "the repair round gets its own part file and card id namespace, so it cannot overwrite or collide with the first pass (PR #147 review)",
    },
    {
      // The other half of the same fix: nothing in the repair prompt mentioned the part file at all, so an agent
      // handed round 1's path had no reason to suspect it was overwriting a first pass. Saying the first pass is
      // KEPT is also what stops this round paying to restate cards already in the deliverable.
      baseline: "a second silent omission is worse than a stated gap.",
      shipped: "Your part file above is this round's own, empty file: the first pass's part is KEPT and merged alongside it",
      why: "the repair round is told its part file is its own and that the first pass is kept (PR #147 review)",
    },
  ],
}

// DECLARED, REVIEWED DIVERGENCES IN THE FINGERPRINT — the dispatch list and the return value. Same rule as the
// prompt list and deliberately stricter in form: a divergence is a REWRITE of the baseline's own text, applied to
// the named scenario and field only, and the rewritten baseline must then match the shipped side EXACTLY. So an
// intended change is stated as what it turns into, not as permission for the two sides to differ — a second,
// unrelated change to the same field still fails.
const ALLOWED_FINGERPRINT_DIVERGENCES = {
  "classic-behaviour-analysis": [
    {
      scenario: "REJECTING Describe agent in a single-item parallel batch — absorbed as a null hole, run still returns a verdict",
      field: "result",
      from: '"initMini"',
      to: '"DealMini::initMini"',
      why: "the uncovered row is reported under the qualified key the inventory now carries (ENG-96529)",
    },
    {
      scenario: "dead Merge — coverage stands, run not complete",
      field: "calls",
      from: "Merge/merge:report+index/general-purpose/cardCount+indexPath+reportPath",
      to: "Merge/merge:report+index/general-purpose/cardCount+indexPath+reportPath | Merge/merge:report+index-retry/general-purpose/cardCount+indexPath+reportPath",
      why: "Merge is retried once on death: it is the only phase whose failure leaves the run with full coverage and no deliverable (ENG-96529)",
    },
    {
      scenario: "dead Merge — coverage stands, run not complete",
      field: "result",
      from: "merge indexPath into manifest.behaviourIndex, then re-run `node engine/migrate.mjs <manifest> --plan --out <plan-file>`",
      to: "NOTHING to fold in: the Merge phase died and wrote neither indexPath nor reportPath. Re-run this analysis — the coverage numbers above stand, but there is no deliverable.",
      why: "`next` is conditional on `mergeOk`: an unconditional instruction told the operator to fold in an index file a dead Merge never wrote (PR #147 review)",
    },
  ],
}

// PR #147 review — EVERY entry is accounted for, and each rewrites EXACTLY the occurrences it declares.
// `split(from).join(to)` rewrote every occurrence of `from` in the field, not the one the rule describes, so a
// genuine regression at a second site carrying the same token was normalised in lockstep and passed the gate — and
// a key-qualification change is precisely what makes a repeated token likely. An entry may declare `count` when it
// deliberately covers more than one occurrence; the default is 1, and a mismatch fails with the scenario and field
// named. Firing is recorded so an entry whose `from` string stopped occurring cannot sit there as a permanent
// no-op advertising a scenario and field as excused — that is how an allow-list rots into a gate that asserts
// nothing, and this file holds the gate itself to the opposite standard a few lines below (NON-VACUITY).
const FINGERPRINT_DIVERGENCE_FIRINGS = new Map();
const FINGERPRINT_DIVERGENCE_ERRORS = [];

function divergenceId(pairName, d) {
  return `${pairName} · ${d.scenario} · ${d.field} · ${d.from}`;
}

// The baseline's fingerprint field, with every divergence declared for THIS scenario and field applied. Unlisted
// scenarios come back untouched, so the comparison stays byte-for-byte everywhere it is not explicitly relaxed.
function rewriteBaseline(pairName, scenario, field, value) {
  return (ALLOWED_FINGERPRINT_DIVERGENCES[pairName] || [])
    .filter((d) => d.scenario === scenario && d.field === field)
    .reduce((acc, d) => {
      const id = divergenceId(pairName, d);
      const occurrences = acc.split(d.from).length - 1;
      const expected = d.count ?? 1;
      if (occurrences !== expected) {
        FINGERPRINT_DIVERGENCE_ERRORS.push(
          `${id} — declares ${expected} occurrence(s) of \`${d.from}\` but the baseline field carries ${occurrences}. ` +
          `A rule may only rewrite what it names: re-freeze the baseline, or set an explicit \`count\`.`);
        return acc;
      }
      FINGERPRINT_DIVERGENCE_FIRINGS.set(id, (FINGERPRINT_DIVERGENCE_FIRINGS.get(id) || 0) + occurrences);
      // Replace only the declared occurrences — never a blanket `split().join()`.
      let out = acc;
      for (let n = 0; n < expected; n++) out = out.replace(d.from, d.to);
      return out;
    }, value)
}

// Every declared entry must have rewritten something. An entry that fired nowhere is stale: either the divergence
// it excused is gone (delete it) or the baseline moved under it (re-freeze), and until one of those happens it
// advertises a relaxation that is not being applied while hiding whatever else changed at that site.
function checkDivergenceLedger() {
  for (const err of FINGERPRINT_DIVERGENCE_ERRORS) {
    check(`declared fingerprint divergence rewrites exactly what it names — ${err.split(" — ")[0]}`, false, () => err);
  }
  for (const [pairName, list] of Object.entries(ALLOWED_FINGERPRINT_DIVERGENCES)) {
    for (const d of list) {
      const id = divergenceId(pairName, d);
      check(`declared fingerprint divergence actually fired — ${id}`,
        (FINGERPRINT_DIVERGENCE_FIRINGS.get(id) || 0) > 0,
        () => `no occurrence of \`${d.from}\` was found in the baseline's \`${d.field}\` for scenario "${d.scenario}". ` +
          `A no-op entry must be deleted or re-frozen — it cannot stay as a standing excuse.`);
    }
  }
}

const PAIRS = [
  {
    name: "classic-behaviour-analysis",
    baseline: path.join(HERE, "baseline/classic-behaviour-analysis.baseline.js"),
    shipped: path.join(ROOT, "skills/classic-to-freedom-migration/classic-behaviour-analysis.workflow.js"),
    scenarios: () => behaviourScenarios(),
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
// A dispatch the shipped script makes and the baseline does not is a declared `calls` divergence (a retry). Its
// prompt is not exempt: a retry re-sends the SAME work, so it must equal the prompt of the last call the baseline
// made in that phase. An added dispatch carrying a different prompt is a different agent wearing a retry's label,
// and still fails.
function repeatsPhase(baselineCalls, shippedCall) {
  const prior = baselineCalls.findLast((c) => c.phase === shippedCall.phase);
  return !!prior && prior.prompt === shippedCall.prompt;
}

function promptDiff(a, b, pairName, scenario) {
  const extraAllowed = (ALLOWED_FINGERPRINT_DIVERGENCES[pairName] || [])
    .some((d) => d.scenario === scenario && d.field === "calls");
  const n = Math.max(a.calls.length, b.calls.length);
  for (let i = 0; i < n; i++) {
    const pa = a.calls[i]?.prompt, pb = b.calls[i]?.prompt;
    if (pa === pb) continue;
    // PR #147 review — the extra dispatch is CONSUMED, not skipped in place: `continue` left the two sides
    // one index apart for the rest of the loop, and that was inert only because today's retry dispatch happens
    // to be last in its phase. Splicing it out of the shipped side keeps the remaining calls aligned whatever
    // position the extra one takes.
    if (pa === undefined && extraAllowed && repeatsPhase(a.calls, b.calls[i])) {
      b.calls.splice(i, 1);
      i--;
      continue;
    }
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
    // A FRESH answerer per script run. A scenario is commonly stateful (answer the 2nd Describe differently), and
    // sharing one closure across the two runs feeds the second script the first one's continuation — which shows up
    // as a false diff, or worse as a false match. `answer` is therefore a FACTORY, not an answerer.
    const a = await runScript(baseSrc, sc.args, sc.answer());
    const b = await runScript(shipSrc, sc.args, sc.answer());
    const fa = fingerprint(a), fb = fingerprint(b);
    check(`${sc.name} — the PHASE sequence is identical`, fa.phases === fb.phases,
      () => `baseline: ${fa.phases}\n      shipped:  ${fb.phases}`);
    const expectedCalls = rewriteBaseline(pair.name, sc.name, "calls", fa.calls);
    check(`${sc.name} — every AGENT dispatched is identical (phase / label / agentType / schema keys, in order)`,
      expectedCalls === fb.calls, () => `baseline: ${expectedCalls}\n      shipped:  ${fb.calls}`);
    const pd = promptDiff(a, b, pair.name, sc.name);
    check(`${sc.name} — every PROMPT is identical byte for byte, apart from the declared divergences`, pd === null, () => pd?.why);
    const expectedResult = rewriteBaseline(pair.name, sc.name, "result", fa.result);
    check(`${sc.name} — the RETURN VALUE is identical`, expectedResult === fb.result && fa.error === fb.error,
      () => firstJsonDiff(JSON.parse(expectedResult), b.result) + (fa.error !== fb.error ? `\n      error: baseline=${fa.error} shipped=${fb.error}` : ""));
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

checkDivergenceLedger();

const warnNote = warn ? `, ${warn} log-only warning(s)` : "";
console.log(`\nPARITY GOLDEN: ${pass} passed, ${fail} failed${warnNote}`);
// `process.exitCode`, NOT `process.exit()`: stdout to a pipe is asynchronous, so exiting immediately DISCARDS
// whatever is still buffered — and on a big failing run that is the summary line itself, which is exactly what a CI
// log or a reader looks for first. Setting the code lets Node flush and exit on its own.
if (fail) process.exitCode = 1;
