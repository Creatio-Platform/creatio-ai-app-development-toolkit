// CODE QUALITY of the built pages. A customer counted by hand what the migration had built: a 391-line save handler
// with 20 functions inside, one helper pasted 8 times, record ids its constants module already held, catch blocks
// that only logged, plan codes in comments. These checks hold the `--verify` Code quality rows that measure it: each
// rule fires on a synthetic page that breaks it and stays silent on its clean counterpart, the thresholds come from
// the manifest, and the rows reach the verify table through the real payload path.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintPageQuality, lintRunQuality, qualityThresholdsOf, QUALITY_RULES, DEFAULT_QUALITY_THRESHOLDS }
  from "../../skills/classic-to-freedom-migration/engine/quality.mjs";
import { verifyRowKey, checklistGroups } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { assembleBuilt } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";

const R = QUALITY_RULES;
const handler = (request, body) => `{ request: "${request}", handler: async (request, next) => {\n${body}\nreturn next?.handle(request);\n} }`;
const lines = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join("\n");
const rulesOf = (page) => page.findings.filter((f) => !f.advisory).map((f) => f.rule);
const count = (page, rule) => page.findings.filter((f) => f.rule === rule).length;

// One synthetic page per rule: the defect, and the same page written the way the rule wants it.
const CASES = [
  { rule: R.functionTooLong, bad: handler("usr.Long", lines(61)), good: handler("usr.Long", lines(20)) },
  { rule: R.nestedFunctions,
    bad: handler("usr.Nested", "const a = () => 1; const b = () => 2; function c() { return 3; } const d = function() { return 4; };"),
    good: handler("usr.Nested", "const a = () => 1; const b = () => 2; const c = () => 3; [1].map((x) => x).filter(function(x) { return x; });") },
  { rule: R.duplicateInPage,
    bad: `${handler("usr.A", "const idOf = (v) => v && v.value ? v.value : v; idOf(1);")}, ${handler("usr.B", "const lookupId = (v) => v && v.value ? v.value : v; lookupId(2);")}`,
    good: `${handler("usr.A", "const idOf = (v) => v && v.value ? v.value : v; idOf(1);")}, ${handler("usr.B", "const nameOf = (v) => v && v.displayValue ? v.displayValue : v; nameOf(2);")}` },
  { rule: R.catchLogOnly, bad: handler("usr.Save", "try { await request.$context.save(); } catch (e) { console.error(e); }"),
    good: handler("usr.Save", "try { await request.$context.save(); } catch (e) { console.error(e); throw e; }") },
  { rule: R.numericComparisonType, bad: handler("usr.Filter", "const f = { comparisonType: 3 };"),
    good: handler("usr.Filter", "const f = { comparisonType: sdk.ComparisonType.Equal };") },
  { rule: R.sequentialAwaits, bad: handler("usr.Init", "const a = await m1.load(); const b = await m2.load(); const c = await m3.load();"),
    good: handler("usr.Init", "const [a, b, c] = await Promise.all([m1.load(), m2.load(), m3.load()]);") },
  { rule: R.planCodeInComment, bad: handler("usr.Commented", "// C04 AC-2: lock the fields (D8)\nconst x = 1;"),
    good: handler("usr.Commented", "// Lock the fields while the record is approved.\nconst x = 1;") },
];
const pageOf = (handlers) => ({ handlers: `[${handlers}]`, viewConfig: { items: [{ type: "crt.Button", name: "B", clicked: { request: "usr.Sent" } }] } });

export function runQualityChecks({ check, runMigration, renderVerify, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS, FULL_PLACEMENT, FIX }) {
  // AC 3 — each rule fires on its defect and stays silent on the clean counterpart.
  for (const { rule, bad, good } of CASES) {
    const badPage = lintPageQuality(pageOf(bad));
    const goodPage = lintPageQuality(pageOf(good));
    check(`quality: ${rule} fires on the defect and stays silent on the clean page`,
      () => rulesOf(badPage).includes(rule) && !rulesOf(goodPage).includes(rule),
      () => ({ bad: badPage.findings, good: goodPage.findings }));
  }
  const measured = lintPageQuality(pageOf(handler("usr.Long", lines(61))));
  check("quality: a long function's finding states the measured length and the limit",
    () => measured.findings.some((f) => f.rule === R.functionTooLong && f.value === 64 && f.limit === 60 && /64 lines \(limit 60\)/.test(f.text)),
    () => measured.findings);

  const keyNamed = lintPageQuality(pageOf(handler("usr.Init", "const data = await a.load(); const b1 = await b.load({ data: 1 }); const c1 = await c.load();")));
  check("quality: an object key that shares a load result's name is not a read of it — the loads stay independent",
    () => count(keyNamed, R.sequentialAwaits) === 1, () => keyNamed.findings);

  // A helper closing over its handler's own variables is a binding of that handler, not a copy of a helper.
  const wrapper = "const { $context, scopes } = request; const process = (config) => sdk.HandlerChainService.instance.process({ ...config, $context, scopes: [...scopes] }); await process({ type: \"usr.Sent\" });";
  check("quality: a helper reading its handler's $context/scopes is not a duplicate in another handler",
    () => count(lintPageQuality(pageOf(`${handler("usr.A", wrapper)}, ${handler("usr.B", wrapper)}`)), R.duplicateInPage) === 0);

  // AC 2 — a local element id is never a finding; a record id used as data is.
  const ids = lintPageQuality({ handlers: `[${handler("usr.Cols", "const column = { id: \"8dc41780-0000-4000-8000-000000000002\" }; if (s === \"8dc41780-1234-4000-8000-000000000001\") { return; }")}]`,
    viewConfig: { items: [{ type: "crt.ListWidget", columns: [{ id: "8dc41780-0000-4000-8000-000000000001" }] }] } });
  check("quality: an element's own `id` (handler object or viewConfig columns[].id) is never a GUID finding; a compared record id is",
    () => ids.findings.filter((f) => f.rule === R.guidLiteral).map((f) => f.text).join() === "`8dc41780-1234-4000-8000-000000000001`",
    () => ids.findings);
  const held = "1b7e3a3c-0000-4c5d-8e9f-0a1b2c3d4e5f";
  const guidPage = { handlers: `[${handler("usr.G", `if (s === "${held}" || t === "aaaaaaaa-0000-4000-8000-000000000001") { return; }`)}]` };
  const withModule = lintPageQuality(guidPage, DEFAULT_QUALITY_THRESHOLDS, new Set([held]));
  check("quality: a record id a constants module holds blocks; any other data GUID is advisory",
    () => withModule.findings.filter((f) => f.rule === R.guidLiteral && !f.advisory).length === 1
      && withModule.findings.filter((f) => f.rule === R.guidLiteral && f.advisory).length === 1,
    () => withModule.findings);

  // The run-wide checks: a helper copied from another page, a request no page sends.
  const helper = "const idOf = (v) => v && v.value ? v.value : v; idOf(1);";
  const run = lintRunQuality({ main: pageOf(handler("usr.Sent", helper)), "child:Other": { handlers: `[${handler("usr.Orphan", helper)}]` } });
  check("quality: a helper copied from another page of the run is reported on the copying page only",
    () => count(run.get("child:Other"), R.duplicateAcrossPages) === 1 && count(run.get("main"), R.duplicateAcrossPages) === 0,
    () => Object.fromEntries([...run].map(([k, p]) => [k, p.findings])));
  check("quality: a custom request no page of the run sends is reported; one a button sends, and crt.* requests, are not",
    () => run.get("child:Other").findings.some((f) => f.rule === R.requestWithoutSender && /usr\.Orphan/.test(f.text))
      && count(run.get("main"), R.requestWithoutSender) === 0
      && count(lintRunQuality({ main: { handlers: `[${handler("crt.SaveRecordRequest", "const x = 1;")}]` } }).get("main"), R.requestWithoutSender) === 0);
  const strings = lintRunQuality({ main: { handlers: "[]", resources: { strings: { Used: {}, Unused: {} } },
    viewConfig: { items: [{ caption: "#ResourceString(Used)#" }] } } }).get("main");
  check("quality: a resource string nothing on the page names is an advisory finding",
    () => strings.findings.filter((f) => f.rule === R.unusedResourceString).map((f) => [f.text, f.advisory].join()).join("|") === "`Unused`,true",
    () => strings.findings);
  check("quality: a bundle without handlers/validators/converters is not linted (null), an unparsable section is named",
    () => lintPageQuality({ viewConfig: {} }) === null && lintPageQuality({ handlers: "[ {" }).unreadable.join() === "handlers");

  // Thresholds — the manifest overrides them key by key; anything but a positive whole number is ignored.
  check("quality: manifest.qualityThresholds overrides the defaults key by key and ignores invalid values",
    () => JSON.stringify(qualityThresholdsOf({ qualityThresholds: { maxFunctionLines: 100, maxNestedFunctionsPerHandler: -1, maxSequentialIndependentAwaits: "4" } }))
      === JSON.stringify({ maxFunctionLines: 100, maxNestedFunctionsPerHandler: 3, maxSequentialIndependentAwaits: 2 })
      && JSON.stringify(qualityThresholdsOf({})) === JSON.stringify(DEFAULT_QUALITY_THRESHOLDS));

  // AC 5 / AC 6 — the verify rows, through the plan the engine renders.
  const dir = path.join(FIX, "conventions");
  const body = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const AB = { resolved: true, requestPrefix: "usr", helperModules: [], constantsModules: ["AbConstants"], source: "fallback",
    evidence: "no custom requests found", confirmedBy: "plan" };
  const manifest = (extra = {}) => ({ entity: "UsrOrder", seed: CLEAN_SEED, targetPackage: "UsrSU", planMeta: FULL_PLANMETA, signals: FULL_SIGNALS,
    placement: FULL_PLACEMENT, schemas: [{ pkg: "UsrOrders", body: body("UsrOrderPage.js") }], resources: { ApplyButtonCaption: "Apply" },
    projectConventions: AB, constantsModules: { AbConstants: { body: body("AbConstants.js") } }, ...extra });
  const result = runMigration(manifest(), { baseDir: dir });
  const opts = checklistOpts(manifest());
  const built = (handlers) => ({ pages: { main: { parentSchemaName: "PageWithTabsFreedomTemplate", packageName: "UsrSU",
    schemaUId: "11111111-1111-4111-8111-111111111111", viewConfig: { items: [{ type: "crt.Button", name: "ApplyButton", clicked: { request: "usr.ApplyButtonClicked" } }] },
    handlers, validators: "{}", converters: "{}", deps: '["AbConstants"]' } } });
  const rowLine = (md, rule) => md.split("\n").find((l) => l.includes(`[code-quality] ${rule} —`)) || "";
  const longHandler = `[${handler("usr.ApplyButtonClicked", lines(70))}]`;
  const failing = renderVerify(result, opts, built(longHandler));
  check("verify: a function over the limit makes its Code quality row a blocking ⚠ that keeps the page from complete",
    () => /⚠ verify/.test(rowLine(failing.markdown, R.functionTooLong)) && /73 lines \(limit 60\)/.test(rowLine(failing.markdown, R.functionTooLong)) && !failing.complete,
    () => rowLine(failing.markdown, R.functionTooLong));
  const raised = renderVerify(result, checklistOpts(manifest({ qualityThresholds: { maxFunctionLines: 100 } })), built(longHandler));
  check("verify: raising manifest.qualityThresholds.maxFunctionLines over the length clears that row",
    () => /✅ Done/.test(rowLine(raised.markdown, R.functionTooLong)) && /no function longer than 100 lines/.test(raised.markdown),
    () => rowLine(raised.markdown, R.functionTooLong));
  const failingLabel = `[code-quality] ${R.functionTooLong} — no function longer than 60 lines`;
  const decided = renderVerify(result, opts, built(longHandler), new Set([verifyRowKey("main", failingLabel)]));
  check("verify: a D<N> decision recorded on a Code quality row closes it",
    () => !/⚠ verify/.test(rowLine(decided.markdown, R.functionTooLong)), () => rowLine(decided.markdown, R.functionTooLong));
  const clean = renderVerify(result, opts, built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`));
  check("verify: a clean page closes every blocking Code quality row ✅",
    () => [R.functionTooLong, R.nestedFunctions, R.catchLogOnly, R.planCodeInComment, R.requestWithoutSender, R.guidLiteral]
      .every((rule) => /✅ Done/.test(rowLine(clean.markdown, rule))),
    () => clean.markdown.split("\n").filter((l) => l.includes("[code-quality]")));
  const heldId = renderVerify(result, opts, built(`[${handler("usr.ApplyButtonClicked", `if (s === "${held}") { return; }`)}]`));
  check("verify: a record id the declared constants module holds blocks the GUID row",
    () => /⚠ verify/.test(rowLine(heldId.markdown, R.guidLiteral)), () => rowLine(heldId.markdown, R.guidLiteral));
  const noConventions = renderVerify(result, { ...opts, projectConventions: null, constantsGuids: [] }, built(`[${handler("usr.ApplyButtonClicked", `if (s === "${held}") { return; }`)}]`));
  check("verify: without recorded projectConventions the GUID row says the constants-module check was skipped and does not block",
    () => /ℹ noted/.test(rowLine(noConventions.markdown, R.guidLiteral)) && /check was skipped/.test(rowLine(noConventions.markdown, R.guidLiteral)),
    () => rowLine(noConventions.markdown, R.guidLiteral));
  check("verify: the Code quality rows are verify-only — the plan's groups (and so the task cut, a split and every digest) carry none",
    () => !checklistGroups(result, opts).some((g) => /Code quality/.test(g.title)) && /\*\*Code quality/.test(clean.markdown));
  const notBuilt = renderVerify(result, opts, { pages: { main: false } });
  check("verify: a page reported not built gets non-gating Code quality rows — its own rows already block",
    () => /☐ confirm on-stand/.test(rowLine(notBuilt.markdown, R.functionTooLong)) && /no code to check/.test(rowLine(notBuilt.markdown, R.functionTooLong)),
    () => rowLine(notBuilt.markdown, R.functionTooLong));
  const noBundle = renderVerify(result, opts, { pages: { main: { parentSchemaName: "PageWithTabsFreedomTemplate", viewConfig: { items: [] } } } });
  check("verify: a bundle without code sections cannot be checked — the rows are confirm-on-stand, never a silent ✅",
    () => /confirm on-stand/.test(rowLine(noBundle.markdown, R.functionTooLong)), () => rowLine(noBundle.markdown, R.functionTooLong));

  // Through the REAL payload path: get-page's bundle.json → assembleBuilt → built.json → --verify.
  const asDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-assemble-"));
  try {
    const w = (f, v) => fs.writeFileSync(path.join(asDir, f), typeof v === "string" ? v : JSON.stringify(v));
    fs.mkdirSync(path.join(asDir, "reads"));
    w("reads/index.json", { version: 1, reads: [{ kind: "pageMeta", file: "reads/01-meta-main.json", pageKey: "main", what: "m" },
      { kind: "pageBundle", file: "reads/02-bundle-main.json", pageKey: "main", what: "b" }] });
    w("reads/01-meta-main.json", { page: { schemaName: "UsrOrder_FormPage", schemaUId: "11111111-1111-4111-8111-111111111111", packageName: "UsrSU", parentSchemaName: "PageWithTabsFreedomTemplate" } });
    w("reads/02-bundle-main.json", { name: "UsrOrder_FormPage", viewConfig: [], deps: '["AbConstants"]', validators: "{}", converters: "{}",
      handlers: `[${handler("usr.ApplyButtonClicked", "try { await request.$context.save(); } catch (e) { console.error(e); }")}]` });
    const { built: assembled } = assembleBuilt(asDir);
    const viaFile = renderVerify(result, opts, assembled);
    check("verify via assembleBuilt: a log-only catch block in get-page's bundle reaches the Code quality row and blocks it",
      () => /⚠ verify/.test(rowLine(viaFile.markdown, R.catchLogOnly)), () => rowLine(viaFile.markdown, R.catchLogOnly));
  } finally { fs.rmSync(asDir, { recursive: true, force: true }); }

  // AC 7 — the engine stays zero-dependency: quality.mjs imports only its siblings.
  const src = fs.readFileSync(new URL("../../skills/classic-to-freedom-migration/engine/quality.mjs", import.meta.url), "utf8");
  check("quality: quality.mjs imports only engine siblings (no package)",
    () => [...src.matchAll(/^import .* from "([^"]+)";$/gm)].every((m) => m[1].startsWith("./")));
}
