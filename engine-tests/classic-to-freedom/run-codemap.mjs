// Offline unit tests for `engine/codemap.mjs` — the page code map a page writer reads before it writes, and the
// analysis behind the blocking `Page code` row of `--verify`. The bodies are built inline in the shape clio
// `get-page` returns in `bundle.handlers`: a relay-shaped body (the same helper in three handlers, a handler over
// the length limit, a request nothing sends) and a clean one. Zero dependencies (node built-ins only).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzePageCode, renderCodeMap, findingCount, findingPhrases, codeMapRoot, runModuleFindings, readModuleDir }
  from "../../skills/classic-to-freedom-migration/engine/codemap.mjs";
import { QUALITY_RULES, DEFAULT_QUALITY_THRESHOLDS } from "../../skills/classic-to-freedom-migration/engine/quality.mjs";

const LIMIT = DEFAULT_QUALITY_THRESHOLDS.maxFunctionLines;
const ofRule = (a, rule) => a.findings.filter((f) => f.rule === rule);
import { renderVerify, esc } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../skills/classic-to-freedom-migration/engine/codemap.mjs");

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) {
    let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; }
    console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d)));
  }
};

// One handler entry. `extraLines` pads the body so a length check has something to measure.
const handler = (request, body, extraLines = 0) => `{
    request: "${request}",
    handler: async (request, next) => {
${body}
${Array.from({ length: extraLines }, (_, i) => `      const step${i} = ${i};`).join("\n")}
      return next?.handle(request);
    }
  }`;
const idOf = `      const idOf = (v) => (v && typeof v === "object" ? v.value : v);`;
const RELAY = `[
  ${handler("crt.HandleViewModelInitRequest", `${idOf}\n      await request.$context.executeRequest({ type: "usr.LoadSubscriptionState", $context: request.$context });`, 200)},
  ${handler("crt.SaveRecordRequest", idOf)},
  ${handler("usr.LoadSubscriptionState", `${idOf}\n      function readLookup(x) { return x; }`)},
  ${handler("usr.RefreshTotals", "      const total = 0;")}
]`;
const CLEAN = `[
  ${handler("crt.HandleViewModelInitRequest", `      await request.$context.executeRequest({ type: "usr.LoadSubscriptionState", $context: request.$context });`)},
  ${handler("usr.LoadSubscriptionState", idOf)},
  ${handler("usr.OpenHistory", "      const x = 1;")}
]`;
const VIEW_SENDS_OPEN_HISTORY = [{ type: "crt.Button", name: "HistoryButton", clicked: { request: "usr.OpenHistory" } }];

console.log("— analysis of a relay-shaped body");
const relay = analyzePageCode(RELAY, []);
const dupes = ofRule(relay, QUALITY_RULES.duplicateInPage);
check("finds the helper declared in three handlers: two copies of the first", () => dupes.length === 2
  && dupes.every((d) => d.name === "idOf" && d.original === "idOf" && d.count === 3), () => dupes);
check("does not report a helper defined once", () => !dupes.some((d) => d.name === "readLookup"));
const longs = ofRule(relay, QUALITY_RULES.functionTooLong);
check(`finds the handler over ${LIMIT} lines and only that one`, () => longs.length === 1
  && longs[0].where === "crt.HandleViewModelInitRequest" && longs[0].lines > LIMIT && longs[0].limit === LIMIT, () => longs);
const unsent = ofRule(relay, QUALITY_RULES.requestWithoutSender);
check("finds the request nothing sends, and not the one a handler sends", () => unsent.length === 1
  && unsent[0].request === "usr.RefreshTotals", () => unsent);
check("counts four findings", () => findingCount(relay) === 4, () => findingPhrases(relay));
check("the limit is the run's manifest.qualityThresholds.maxFunctionLines",
  () => ofRule(analyzePageCode(RELAY, [], new Set(), { ...DEFAULT_QUALITY_THRESHOLDS, maxFunctionLines: 500 }), QUALITY_RULES.functionTooLong).length === 0);
check("lists every handler with its line count and helpers", () => relay.handlers.length === 4
  && relay.handlers[2].helpers.join(",") === "idOf,readLookup", () => relay.handlers);

check("a helper over the limit is reported under its own name, beside the handler that holds it",
  () => { const big = `const big = () => {\n${"  1;\n".repeat(160)}};`;
    const a = analyzePageCode(`[{ request: "usr.Short", handler: async (request, next) => { ${big} return next?.handle(request); } }]`, []);
    return ofRule(a, QUALITY_RULES.functionTooLong).map((f) => f.where).join() === "usr.Short,usr.Short › big"; });

console.log("— analysis of a clean body");
const clean = analyzePageCode(CLEAN, VIEW_SENDS_OPEN_HISTORY);
check("a clean body has no findings", () => findingCount(clean) === 0, () => findingPhrases(clean));
const unsentOf = (a) => ofRule(a, QUALITY_RULES.requestWithoutSender).map((f) => f.request).join();
check("a request a button sends is not reported", () => !unsentOf(clean).includes("usr.OpenHistory"));
check("the same request with a view that has no button for it is reported", () => unsentOf(analyzePageCode(CLEAN, [])) === "usr.OpenHistory");
check("a handler that names its OWN request (a type check, a log line) does not count as sending it",
  () => unsentOf(analyzePageCode(`[{ request: "usr.Self", handler: async (request, next) => { if (request.type === "usr.Self") { return 1; } return next?.handle(request); } }]`, [])) === "usr.Self");
check("without a viewConfig nobody knows what the buttons send: the unsent check is skipped and the map says so",
  () => { const a = analyzePageCode(CLEAN); return a.sendsChecked === false && unsentOf(a) === "" && findingCount(a) === 0
    && renderCodeMap(a, "P").includes("Requests sent from the view were not checked"); });
check("a platform request is never reported as unsent", () => !unsent.some((f) => f.request.startsWith("crt.")));
check("an empty body has no handlers and no findings", () => { const a = analyzePageCode("", []); return a.handlers.length === 0 && findingCount(a) === 0; });

console.log("— input that cannot be read");
check("a body that does not parse gives an error, not a throw", () => /does not parse/.test(analyzePageCode("[ { request: ").error || ""));
check("a body that is not an array gives an error", () => /not an array/.test(analyzePageCode("{ a: 1 }").error || ""));
check("a handler body past the engine's walk budget is an error, never a half-analysed map",
  () => /too large or too deeply nested/.test(analyzePageCode(`[{ request: "usr.Deep", handler: () => { const deep = ${"[".repeat(500)}1${"]".repeat(500)}; } }]`).error || ""));
check("a computed `[request]` key is not read as the request", () => unsentOf(analyzePageCode(`[{ ["request"]: "usr.X", handler: () => {} }]`, [])) === "");

console.log("— the map");
const map = renderCodeMap(relay, "PIS_FormPage");
check("the map names the page and the finding count", () => map.startsWith("# PIS_FormPage — code map") && map.includes("4 finding(s)"));
check("the map lists each copy of the duplicate helper", () => (map.match(/- `idOf` repeats `idOf` \(line \d+\) — declared 3 times/g) || []).length === 2, () => map);
check("the map flags the long handler", () => /\| `crt\.HandleViewModelInitRequest` \| \d+ ⚠ \|/.test(map), () => map);
check("a clean map says the verify row will pass", () => renderCodeMap(clean, "P").includes("No findings"));
check("names from the page body are escaped in the map — a backtick or a pipe cannot break the table", () => {
  const odd = renderCodeMap({ handlers: [{ request: "usr.A|B`C", lines: 3, helpers: [] }], findings: [], sendsChecked: true, maxFunctionLines: LIMIT }, "P", esc);
  return odd.includes(String.raw`usr.A\|BˋC`) && !odd.includes("A|B");
}, () => renderCodeMap({ handlers: [{ request: "usr.A|B`C", lines: 3, helpers: [] }], findings: [], sendsChecked: true, maxFunctionLines: LIMIT }, "P", esc));

console.log("— input shapes");
check("a saved get-page response is its bundle", () => codeMapRoot(JSON.stringify({ bundle: { handlers: CLEAN } })).handlers === CLEAN);
check("a built.json is read as it is, pages and all", () => codeMapRoot(JSON.stringify({ pages: { a: { handlers: CLEAN } } })).pages.a.handlers === CLEAN);
check("a file that is not JSON is the handler source itself", () => codeMapRoot(CLEAN).handlers === CLEAN);

console.log("— the `Page code` row of --verify");
{
  const res = { changeSet: { viewConfigDiff: [{ name: "Notes", values: { control: "$Notes", type: "crt.Input" } }], images: [], standardFeatures: [], details: [], cardActions: [] }, signals: {} };
  const QG = {
    evidence: { "main#quality-gates": { referencePage: "an existing Freedom page reviewed for parity", components: ["crt.Input"] } },
    judge: { "main#quality-gates": { convincing: true, why: "the skill ran on every built page and its findings were fixed" } },
  };
  // The view carries the plan's one field, plus whatever sends a request; the table renders backticks as ˋ.
  const built = (handlers, extra = []) => ({ viewConfig: [{ name: "Notes", type: "crt.Input", control: "$Notes" }, ...extra], handlers, ...QG });
  const line = (v) => (v.markdown.split("\n").find((l) => l.includes("| Page code — ")) || "").replaceAll("ˋ", "`");
  const open = renderVerify(res, {}, built(RELAY));
  check("the relay body opens the row with every finding named, and the run is not complete", () => /⚠ verify/.test(line(open))
    && line(open).includes("`idOf` repeats `idOf`") && line(open).includes("`usr.RefreshTotals` is declared but nothing sends it")
    && /`crt\.HandleViewModelInitRequest` is \d+ lines/.test(line(open)) && open.complete === false, () => line(open));
  const fixed = renderVerify(res, {}, built(CLEAN, VIEW_SENDS_OPEN_HISTORY));
  check("the fixed body closes the row and the run completes", () => /✅ Done/.test(line(fixed)) && fixed.complete === true,
    () => ({ row: line(fixed), complete: fixed.complete, unverified: fixed.unverified, missing: fixed.missing }));
  const decided = renderVerify(res, { deliverableStatus: { "main#page-code": { status: "wont-do", decision: "D5" } } }, built(RELAY));
  check("a D<N> decision closes the row on the same relay body", () => /Won't do — D5/.test(line(decided)) && decided.complete === true,
    () => ({ row: line(decided), complete: decided.complete }));
  const broken = renderVerify(res, {}, built("[ { request: "));
  check("a body that does not parse holds the row with the reason", () => /⚠ verify/.test(line(broken)) && /does not parse/.test(line(broken)), () => line(broken));
  const noView = renderVerify(res, {}, { ops: [{ name: "Notes", type: "crt.Input" }], handlers: CLEAN, ...QG });
  check("handlers without a viewConfig close the row on what can be checked and say the view's requests were not",
    () => /✅ Done/.test(line(noView)) && /not checked \(no viewConfig/.test(line(noView)), () => line(noView));
  const mini = `[{ request: "crt.HandleViewModelInitRequest", handler: async (request, next) => { await request.$context.executeRequest({ type: "usr.RefreshTotals" }); return next?.handle(request); } }]`;
  const twoPages = renderVerify(res, {}, { pages: { main: built(RELAY), mini: { handlers: mini, viewConfig: [] } }, ...QG });
  check("a request declared here and sent from another built page (its mini page) is not reported as unsent",
    () => /⚠ verify/.test(line(twoPages)) && !line(twoPages).includes("usr.RefreshTotals") && line(twoPages).includes("`idOf`"), () => line(twoPages));
  const notBuilt = renderVerify(res, {}, { pages: { main: false }, ...QG });
  check("a page reported NOT BUILT leaves the row to confirm — it has no code to check", () => /☐ confirm on-stand/.test(line(notBuilt))
    && /NOT BUILT/.test(line(notBuilt)), () => line(notBuilt));
  const absent = renderVerify(res, {}, { pages: { other: { handlers: CLEAN, viewConfig: [] } }, ...QG });
  check("a payload with no entry for the page says the page was not read, never that its code is clean", () => !/✅ Done/.test(line(absent))
    && /handler code/.test(line(absent)), () => line(absent));
  const none = renderVerify(res, {}, { ops: [{ name: "Notes", type: "crt.Input" }], ...QG });
  check("no handler source in the payload leaves the row to confirm, never a failure", () => /☐ confirm on-stand/.test(line(none)) && none.complete === true,
    () => ({ row: line(none), complete: none.complete }));
}

console.log("— CLI");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-"));
const write = (name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
const r1 = run(write("relay.json", JSON.stringify({ bundle: { handlers: RELAY, viewConfig: [] } })), "--page", "PIS_FormPage");
check("findings exit 2 and print the map", () => r1.status === 2 && r1.stdout.includes("idOf"), () => ({ status: r1.status, err: r1.stderr }));
const r2 = run(write("clean.json", JSON.stringify({ bundle: { handlers: CLEAN, viewConfig: VIEW_SENDS_OPEN_HISTORY } })));
check("a clean body exits 0", () => r2.status === 0, () => ({ status: r2.status, out: r2.stdout, err: r2.stderr }));
const r3 = run(write("broken.js", "[ { request: "));
check("an unparsable body exits 1 with the reason", () => r3.status === 1 && /does not parse/.test(r3.stderr), () => ({ status: r3.status, err: r3.stderr }));
const r4 = run();
check("no file exits 1 with the usage", () => r4.status === 1 && /usage/.test(r4.stderr));
const built = write("built.json", JSON.stringify({ pages: { main: { handlers: CLEAN, viewConfig: VIEW_SENDS_OPEN_HISTORY }, child: { handlers: RELAY } } }));
const r5 = run(built, "--page", "child");
check("a built.json is read per page, the way --verify reads it", () => r5.status === 2 && run(built).status === 0, () => ({ status: r5.status, err: r5.stderr }));
const r6 = run(built, "--page");
check("`--page` without a key exits 1 instead of silently reading another page", () => r6.status === 1 && /needs a page key/.test(r6.stderr));
const r7 = run(built, "--page", "nope");
check("a page the file does not hold exits 1 naming it", () => r7.status === 1 && /`nope`/.test(r7.stderr), () => r7.stderr);

// THE RUN'S MODULES in the map. A benchmark run left two pages with no module of their own and a status id in two
// modules although the page map of every page was clean; the map now shows what the module checks find, and says
// when it could not look.
{
  const mdir = path.join(dir, "modules");
  fs.mkdirSync(path.join(mdir, "UsrShared"), { recursive: true });
  const GUID = "3a8b2f10-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  fs.writeFileSync(path.join(mdir, "UsrA_FormPageModule.js"), `define("UsrA_FormPageModule", [], function() { const S = "${GUID}"; function init(c) { return S && c; } function spare() { return 1; } return { init, spare }; });`);
  fs.writeFileSync(path.join(mdir, "UsrShared", "body.js"), `define("UsrShared", [], function() { const CLOSED = "${GUID}"; return { CLOSED }; });`);
  fs.writeFileSync(path.join(mdir, "UsrA_ListPage.js"), "define(\"UsrA_ListPage\", [], function() { return { handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/ }; });");
  const mods = readModuleDir(mdir);
  check("readModuleDir: reads `<Module>.js` and `<Module>/body.js` (the .clio-pages layout) and leaves page bodies out",
    () => Object.keys(mods).sort((a, b) => a.localeCompare(b)).join() === "UsrA_FormPageModule,UsrShared", () => Object.keys(mods));
  const notePage = { schemaName: "UsrA_NotePage", deps: "[\"UsrShared\"]", handlers: "[{ request: \"crt.HandleViewModelInitRequest\", handler: async (request, next) => { await shared.go(request.$context); return next?.handle(request); } }]" };
  check("codeMapRoot: a saved get-page response keeps the page's schema name beside the bundle — the own-module check needs it",
    () => codeMapRoot(JSON.stringify({ page: { schemaName: "UsrA_NotePage" }, bundle: { handlers: "[]" } })).schemaName === "UsrA_NotePage");
  const single = runModuleFindings(notePage, "main", mods);
  check("one page: the map reports the page's missing own module and the id in two modules, and leaves unused exports to the whole run",
    () => single.findings.some((f) => f.rule === QUALITY_RULES.pageWithoutModule) && single.findings.some((f) => f.rule === QUALITY_RULES.sharedValueInTwoModules)
      && !single.findings.some((f) => f.rule === QUALITY_RULES.unusedModuleExport) && single.wholeRun === false,
    () => single);
  const whole = runModuleFindings({ pages: { main: { schemaName: "UsrA_FormPage", deps: "[\"UsrA_FormPageModule\"]", handlers: "[{ request: \"crt.HandleViewModelInitRequest\", handler: async (request, next) => { await formPage.init(request.$context); return next?.handle(request); } }]" } } }, "main", mods);
  check("whole run (built.json): an export nobody uses is reported in a run page's own module, never in a shared module pages outside the run may import",
    () => whole.findings.filter((f) => f.rule === QUALITY_RULES.unusedModuleExport).map((f) => /spare|CLOSED/.exec(f.text)?.[0]).join() === "spare",
    () => whole.findings);
  // One page in hand: two modules the page neither owns nor imports are not the builder's to fix.
  fs.writeFileSync(path.join(mdir, "UsrOtherA.js"), `define("UsrOtherA", [], function() { const X = "7b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b"; return { X }; });`);
  fs.writeFileSync(path.join(mdir, "UsrOtherB.js"), `define("UsrOtherB", [], function() { const Y = "7b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b"; return { Y }; });`);
  const scoped = runModuleFindings(notePage, "main", readModuleDir(mdir));
  check("one page: a duplicate between two modules the page does not reach is left out of its map",
    () => !scoped.findings.some((f) => /UsrOther/.test(f.text)) && scoped.findings.some((f) => f.rule === QUALITY_RULES.sharedValueInTwoModules),
    () => scoped.findings);
  check("one page with no findings does not claim every export is used — it did not look",
    () => !/every export is used/.test(renderCodeMap(analyzePageCode(notePage.handlers), "main", esc, { modules: 1, findings: [], wholeRun: false }))
      && /every export is used/.test(renderCodeMap(analyzePageCode(notePage.handlers), "main", esc, { modules: 1, findings: [], wholeRun: true })));
  const noMods = renderCodeMap(analyzePageCode(notePage.handlers), "main", esc, null);
  check("without module bodies the map says the modules were NOT checked, never 'no findings'",
    () => /## The run's modules/.test(noMods) && /Not checked/.test(noMods), () => noMods);
  const pageFile = path.join(dir, "note.json");
  fs.writeFileSync(pageFile, JSON.stringify({ page: { schemaName: "UsrA_NotePage" }, bundle: notePage }));
  const rm = run(pageFile, "--modules", mdir);
  check("CLI `--modules <dir>`: the module findings are printed and make the exit 2",
    () => rm.status === 2 && /page-without-module/.test(rm.stdout) && /shared-value-in-two-modules/.test(rm.stdout), () => rm.stdout + rm.stderr);
  check("CLI `--modules` without a folder exits 1 and says what it needs",
    () => { const r = run(pageFile, "--modules"); return r.status === 1 && /--modules/.test(r.stderr); });

  // One page in hand, an imported module that does not parse: the map names it unreadable and exits 2.
  const bdir = path.join(dir, "broken-modules");
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, "UsrA_NotePageModule.js"), "define(\"UsrA_NotePageModule\", [\"UsrBroken\"], function(broken) { function init(c) { return c; } return { init }; });");
  fs.writeFileSync(path.join(bdir, "UsrBroken.js"), "define(\"UsrBroken\", [], function() { return { ; });");
  const brokenPage = { ...notePage, deps: "[\"UsrA_NotePageModule\"]", handlers: notePage.handlers.replace("shared.go", "notePage.init"), args: "(notePage)" };
  const broken = runModuleFindings(brokenPage, "main", readModuleDir(bdir));
  check("one page: an imported module that does not parse is reported unreadable, not a crash",
    () => broken.findings.some((f) => f.rule === "unreadable" && /UsrBroken/.test(f.text)), () => broken.findings);
  const brokenFile = path.join(dir, "broken.json");
  fs.writeFileSync(brokenFile, JSON.stringify({ page: { schemaName: "UsrA_NotePage" }, bundle: brokenPage }));
  const rb = run(brokenFile, "--modules", bdir);
  check("CLI `--modules`, one page: an unparseable imported module is printed as unreadable and makes the exit 2",
    () => rb.status === 2 && /UsrBroken/.test(rb.stdout) && !/TypeError/.test(rb.stderr), () => ({ status: rb.status, out: rb.stdout, err: rb.stderr }));
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n=================\nCODE-MAP GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
