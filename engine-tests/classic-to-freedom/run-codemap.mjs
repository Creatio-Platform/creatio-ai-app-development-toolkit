// Offline unit tests for `engine/codemap.mjs` — the page code map a page writer reads before it writes, and the
// analysis behind the blocking `Page code` row of `--verify`. The bodies are built inline in the shape clio
// `get-page` returns in `bundle.handlers`: a relay-shaped body (the same helper in three handlers, a handler over
// the length limit, a request nothing sends) and a clean one. Zero dependencies (node built-ins only).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzePageCode, renderCodeMap, findingCount, findingPhrases, codeMapRoot, MAX_FUNCTION_LINES }
  from "../../skills/classic-to-freedom-migration/engine/codemap.mjs";
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
check("finds the helper defined in three handlers", () => relay.duplicates.length === 1
  && relay.duplicates[0].name === "idOf" && relay.duplicates[0].handlers.length === 3, () => relay.duplicates);
check("does not report a helper defined once", () => !relay.duplicates.some((d) => d.name === "readLookup"));
check(`finds the handler over ${MAX_FUNCTION_LINES} lines and only that one`, () => relay.longFunctions.length === 1
  && relay.longFunctions[0].name === "crt.HandleViewModelInitRequest" && relay.longFunctions[0].lines > MAX_FUNCTION_LINES,
  () => relay.longFunctions);
check("finds the request nothing sends, and not the one a handler sends", () => relay.unsent.length === 1
  && relay.unsent[0] === "usr.RefreshTotals", () => relay.unsent);
check("counts three findings", () => findingCount(relay) === 3, () => findingPhrases(relay));
check("lists every handler with its line count and helpers", () => relay.handlers.length === 4
  && relay.handlers[2].helpers.join(",") === "idOf,readLookup", () => relay.handlers);

console.log("— analysis of a clean body");
const clean = analyzePageCode(CLEAN, VIEW_SENDS_OPEN_HISTORY);
check("a clean body has no findings", () => findingCount(clean) === 0, () => findingPhrases(clean));
check("a request a button sends is not reported", () => !clean.unsent.includes("usr.OpenHistory"));
check("the same request with a view that has no button for it is reported", () => analyzePageCode(CLEAN, []).unsent.join() === "usr.OpenHistory");
check("a handler that names its OWN request (a type check, a log line) does not count as sending it",
  () => analyzePageCode(`[{ request: "usr.Self", handler: async (request, next) => { if (request.type === "usr.Self") { return 1; } return next?.handle(request); } }]`, []).unsent.join() === "usr.Self");
check("without a viewConfig nobody knows what the buttons send: the unsent check is skipped and the map says so",
  () => { const a = analyzePageCode(CLEAN); return a.sendsChecked === false && a.unsent.length === 0 && findingCount(a) === 0
    && renderCodeMap(a, "P").includes("Requests sent from the view were not checked"); });
check("a platform request is never reported as unsent", () => !relay.unsent.some((r) => r.startsWith("crt.")));
check("an empty body has no handlers and no findings", () => { const a = analyzePageCode("", []); return a.handlers.length === 0 && findingCount(a) === 0; });

console.log("— input that cannot be read");
check("a body that does not parse gives an error, not a throw", () => /does not parse/.test(analyzePageCode("[ { request: ").error || ""));
check("a body that is not an array gives an error", () => /not an array/.test(analyzePageCode("{ a: 1 }").error || ""));
check("a handler body past the engine's walk budget is an error, never a half-analysed map",
  () => /too large or too deeply nested/.test(analyzePageCode(`[{ request: "usr.Deep", handler: () => { const deep = ${"[".repeat(500)}1${"]".repeat(500)}; } }]`).error || ""));
check("a computed `[request]` key is not read as the request", () => analyzePageCode(`[{ ["request"]: "usr.X", handler: () => {} }]`).unsent.length === 0);

console.log("— the map");
const map = renderCodeMap(relay, "PIS_FormPage");
check("the map names the page and the finding count", () => map.startsWith("# PIS_FormPage — code map") && map.includes("3 finding(s)"));
check("the map lists the duplicate helper with its handlers", () => /\| `idOf` \| `crt\.HandleViewModelInitRequest`, `crt\.SaveRecordRequest`, `usr\.LoadSubscriptionState` \|/.test(map), () => map);
check("the map flags the long handler", () => /\| `crt\.HandleViewModelInitRequest` \| \d+ ⚠ \|/.test(map), () => map);
check("a clean map says the verify row will pass", () => renderCodeMap(clean, "P").includes("No findings"));
check("names from the page body are escaped in the map — a backtick or a pipe cannot break the table", () => {
  const odd = renderCodeMap({ handlers: [{ request: "usr.A|B`C", lines: 3, helpers: [] }], duplicates: [], longFunctions: [], unsent: [] }, "P", esc);
  return odd.includes(String.raw`usr.A\|BˋC`) && !odd.includes("A|B");
}, () => renderCodeMap({ handlers: [{ request: "usr.A|B`C", lines: 3, helpers: [] }], duplicates: [], longFunctions: [], unsent: [] }, "P", esc));

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
    && line(open).includes("`idOf` is defined in 3 handlers") && line(open).includes("`usr.RefreshTotals` is declared but nothing sends it")
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
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n=================\nCODE-MAP GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
