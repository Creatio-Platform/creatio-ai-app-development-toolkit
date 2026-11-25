// CODE QUALITY of the built pages. A customer counted by hand what the migration had built: a 391-line save handler
// with 20 functions inside, one helper pasted 8 times, record ids its constants module already held, catch blocks
// that only logged, plan codes in comments. These checks hold the `--verify` Code quality rows that measure it: each
// rule fires on a synthetic page that breaks it and stays silent on its clean counterpart, the thresholds come from
// the manifest, and the rows reach the verify table through the real payload path.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintPageQuality, lintRunQuality, qualityThresholdsOf, QUALITY_RULES, QUALITY_ROW_RULES, DEFAULT_QUALITY_THRESHOLDS, MODULE_BODY_RULES }
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
  // each rule fires on its defect and stays silent on the clean counterpart.
  for (const { rule, bad, good } of CASES) {
    const badPage = lintPageQuality(pageOf(bad));
    const goodPage = lintPageQuality(pageOf(good));
    check(`quality: ${rule} fires on the defect and stays silent on the clean page`,
      () => rulesOf(badPage).includes(rule) && !rulesOf(goodPage).includes(rule),
      () => ({ bad: badPage.findings, good: goodPage.findings }));
  }
  // The same rules read the validators and converters sections, and say which section a finding is in.
  const sections = lintPageQuality({ handlers: "[]",
    validators: `{ "usr.Positive": { validator: (config) => { return function(control) {\n${lines(61)}\nreturn null; }; }, params: [] } }`,
    converters: `{ "usr.ToStatus": function(value) {\n// C04 AC-2: map the status\ntry { return value === "aaaaaaaa-0000-4000-8000-000000000001"; } catch (e) { console.error(e); }\n} }` });
  const inSection = (rule, section) => sections.findings.some((f) => f.rule === rule && f.section === section && f.line > 0);
  check("quality: validators and converters are linted too, each finding naming its section and line",
    () => inSection(R.functionTooLong, "validators") && inSection(R.planCodeInComment, "converters")
      && inSection(R.catchLogOnly, "converters") && inSection(R.guidLiteral, "converters"),
    () => sections.findings);
  const cleanSections = lintPageQuality({ handlers: "[]", validators: '{ "usr.Positive": { validator: () => () => null, params: [] } }',
    converters: '{ "usr.ToStatus": function(value) { return value === Constants.Status.Active; } }' });
  check("quality: clean validators and converters raise nothing", () => cleanSections.findings.length === 0, () => cleanSections.findings);
  const prose = lintPageQuality(pageOf(handler("usr.Commented", "// Uses ISO-8601 dates, HTTP/2 and the v2 API; step 3 of the wizard.\nconst x = 1;")));
  check("quality: ordinary technical tokens in a comment are not plan codes", () => count(prose, R.planCodeInComment) === 0, () => prose.findings);

  const measured = lintPageQuality(pageOf(handler("usr.Long", lines(61))));
  check("quality: a long function's finding states the measured length and the limit",
    () => measured.findings.some((f) => f.rule === R.functionTooLong && f.value === 64 && f.limit === 60 && /64 lines \(limit 60\)/.test(f.text)),
    () => measured.findings);

  const keyNamed = lintPageQuality(pageOf(handler("usr.Init", "const data = await a.load(); const b1 = await b.load({ data: 1 }); const c1 = await c.load();")));
  check("quality: an object key that shares a load result's name is not a read of it — the loads stay independent",
    () => count(keyNamed, R.sequentialAwaits) === 1, () => keyNamed.findings);

  const inHelper = lintPageQuality(pageOf(handler("usr.Init", "const loadAll = async () => { const a = await m1.load(); const b = await m2.load(); const c = await m3.load(); return [a, b, c]; }; await loadAll();")));
  check("quality: loads inside a helper declared in a handler are checked as their own sequence",
    () => count(inHelper, R.sequentialAwaits) === 1, () => inHelper.findings);
  const reassigned = lintPageQuality(pageOf(handler("usr.Init", "let data = await a.load(); data = await b.load(); const c1 = await c.load();")));
  check("quality: assigning a new load result to an earlier load's variable is a write, not a read — the loads stay independent",
    () => count(reassigned, R.sequentialAwaits) === 1, () => reassigned.findings);
  const dataIds = ["await request.$context.executeRequest({ type: \"usr.Open\", id: \"8dc41780-1234-4000-8000-000000000001\" });",
    "const owner = { id: \"8dc41780-1234-4000-8000-000000000001\", displayValue: \"Supervisor\" };",
    "const filter = { recordId: \"8dc41780-1234-4000-8000-000000000001\" };"];
  check("quality: a record id passed as data — a request id, a lookup value, a recordId — is a GUID finding whatever its key",
    () => dataIds.every((code) => count(lintPageQuality(pageOf(handler("usr.Data", code))), R.guidLiteral) === 1));
  const nestedCopies = lintPageQuality(pageOf(`${handler("usr.A", "const outer = (cfg) => { const inner = (v) => v && v.value ? v.value : v; return inner(cfg); }; outer(1);")}, `
    + handler("usr.B", "const other = (x) => { const inner = (v) => v && v.value ? v.value : v; return inner(x) + 1; }; other(2);")));
  check("quality: a helper nested in another helper is part of it — its copies are not reported on their own",
    () => count(nestedCopies, R.duplicateInPage) === 0, () => nestedCopies.findings);

  const declared = lintPageQuality(pageOf(`${handler("usr.A", "function fmt(v) { return v && v.value ? v.value : v; } fmt(1);")}, `
    + handler("usr.B", "function fmt2(v) { return v && v.value ? v.value : v; } fmt2(2);")));
  check("quality: two `function name() {}` helpers with one body in two handlers are a duplicate",
    () => count(declared, R.duplicateInPage) === 1, () => declared.findings);
  // Operators, declaration kinds and template text are properties, not child nodes: helpers that differ only there
  // have different logic, and merging them would change what the page does.
  const tick = String.fromCodePoint(96);
  const operatorPairs = [
    ['v && v.status && v.status.value === "a"', 'v && v.status && v.status.value !== "a"'],
    ["v && v.status && v.status.value", "v || v.status || v.status.value"],
    ["v.count + v.extra + v.base", "v.count - v.extra - v.base"],
    ["{ let n = v.count; n += v.extra; return n; }", "{ let n = v.count; n -= v.extra; return n; }"],
    ["{ const n = v.count; return n + v.extra; }", "{ let n = v.count; return n + v.extra; }"],
    ["!v.status && !v.status.value && v.x", "-v.status && -v.status.value && v.x"],
    ["{ let n = v.count; n++; return n; }", "{ let n = v.count; n--; return n; }"],
    ["{ let n = v.count; n++; return n; }", "{ let n = v.count; ++n; return n; }"],
    [tick + "${v.status.value} open ${v.x}" + tick, tick + "${v.status.value} closed ${v.x}" + tick],
  ];
  const differing = operatorPairs.map(([a, b]) => lintPageQuality(pageOf(`${handler("usr.A", "const isOpen = (v) => " + a + "; isOpen(1);")}, `
    + handler("usr.B", "const isClosed = (v) => " + b + "; isClosed(2);"))));
  check("quality: helpers that differ only in an operator, a declaration kind or template text are not duplicates",
    () => differing.every((r) => count(r, R.duplicateInPage) === 0),
    () => differing.map((r, i) => [operatorPairs[i][0], count(r, R.duplicateInPage)]).filter(([, c]) => c));
  const sameOps = lintPageQuality(pageOf(`${handler("usr.A", 'const isOpen = (v) => v && v.status && v.status.value !== "a"; isOpen(1);')}, `
    + handler("usr.B", 'const notA = (v) => v && v.status && v.status.value !== "a"; notA(2);')));
  check("quality: helpers with one body, operators included, are still a duplicate",
    () => count(sameOps, R.duplicateInPage) === 1, () => sameOps.findings);
  // A helper closing over its handler's own variables is a binding of that handler, not a copy of a helper.
  const wrapper = "const { $context, scopes } = request; const process = (config) => sdk.HandlerChainService.instance.process({ ...config, $context, scopes: [...scopes] }); await process({ type: \"usr.Sent\" });";
  check("quality: a helper reading its handler's $context/scopes is not a duplicate in another handler",
    () => count(lintPageQuality(pageOf(`${handler("usr.A", wrapper)}, ${handler("usr.B", wrapper)}`)), R.duplicateInPage) === 0);

  // a local element id is never a finding; a record id used as data is.
  const ids = lintPageQuality({ handlers: `[${handler("usr.Cols", "const column = { id: \"8dc41780-0000-4000-8000-000000000002\", code: \"Name\" }; if (s === \"8dc41780-1234-4000-8000-000000000001\") { return; }")}]`,
    viewConfig: { items: [{ type: "crt.ListWidget", columns: [{ id: "8dc41780-0000-4000-8000-000000000001" }] }] } });
  check("quality: an element's own `id` (an element-shaped handler object or viewConfig columns[].id) is never a GUID finding; a compared record id is",
    () => ids.findings.filter((f) => f.rule === R.guidLiteral).map((f) => f.text).join() === "`8dc41780-1234-4000-8000-000000000001`",
    () => ids.findings);
  const held = "1b7e3a3c-0000-4c5d-8e9f-0a1b2c3d4e5f";
  const comparesHeld = 'if (s === "' + held + '" || t === "aaaaaaaa-0000-4000-8000-000000000001") { return; }';
  const guidPage = { handlers: `[${handler("usr.G", comparesHeld)}]` };
  const withModule = lintPageQuality(guidPage, DEFAULT_QUALITY_THRESHOLDS, new Set([held]));
  check("quality: a record id a constants module holds blocks; any other data GUID is advisory",
    () => withModule.findings.filter((f) => f.rule === R.guidLiteral && !f.advisory).length === 1
      && withModule.findings.filter((f) => f.rule === R.guidLiteral && f.advisory).length === 1,
    () => withModule.findings);

  // The run-wide checks: a helper copied from another page, a request no page sends.
  const helper = "const idOf = (v) => v && v.value ? v.value : v; idOf(1);";
  const run = lintRunQuality({ main: pageOf(handler("usr.Sent", helper)), "child:Other": { handlers: `[${handler("usr.Other", helper)}]` } });
  check("quality: a helper copied from another page of the run is reported on the copying page only",
    () => count(run.get("child:Other"), R.duplicateAcrossPages) === 1 && count(run.get("main"), R.duplicateAcrossPages) === 0,
    () => Object.fromEntries([...run].map(([k, p]) => [k, p.findings])));
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

  // the verify rows, through the plan the engine renders.
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
  const pageCodeLine = (md) => (md.split("\n").find((l) => l.includes("| Page code — ")) || "").replaceAll("ˋ", "`");
  const ROW_RULES = QUALITY_ROW_RULES.map((r) => r.rule);
  const longHandler = `[${handler("usr.ApplyButtonClicked", lines(70))}]`;
  const failing = renderVerify(result, opts, built(longHandler));
  check("verify: a function over the limit makes the Page code row a blocking ⚠ (the limit comes from quality.mjs) that keeps the page from complete",
    () => /⚠ verify/.test(pageCodeLine(failing.markdown)) && /`usr\.ApplyButtonClicked` is 73 lines \(limit 60\)/.test(pageCodeLine(failing.markdown)) && !failing.complete,
    () => pageCodeLine(failing.markdown));
  check("verify: function length is held by the Page code row only — Code quality has no row for it, nor for duplicates or unsent requests",
    () => [R.functionTooLong, R.duplicateInPage, R.requestWithoutSender].every((rule) => !rowLine(failing.markdown, rule)));
  const longBody = Array.from({ length: 70 }, (_, i) => `const s${i} = ${i};`).join("\n");
  const builtWith = (extra) => { const b = built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`); Object.assign(b.pages.main, extra); return b; };
  const longValidator = renderVerify(result, opts, builtWith({ validators: `{ "usr.Positive": { validator: (config) => { return function(control) {\n${longBody}\nreturn null; }; }, params: [] } }` }));
  check("verify: a validator function over the limit holds the Page code row ⚠, named by its section",
    () => /⚠ verify/.test(pageCodeLine(longValidator.markdown)) && /`validators › line \d+` is \d+ lines \(limit 60\)/.test(pageCodeLine(longValidator.markdown)),
    () => pageCodeLine(longValidator.markdown));
  const longConverter = renderVerify(result, opts, builtWith({ converters: `{ "usr.ToUpper": function(value) {\n${longBody}\nreturn value; } }` }));
  check("verify: a converter function over the limit holds the Page code row ⚠, named by its section",
    () => /⚠ verify/.test(pageCodeLine(longConverter.markdown)) && /`converters › usr\.ToUpper` is \d+ lines \(limit 60\)/.test(pageCodeLine(longConverter.markdown)),
    () => pageCodeLine(longConverter.markdown));
  const raised = renderVerify(result, checklistOpts(manifest({ qualityThresholds: { maxFunctionLines: 100 } })), built(longHandler));
  check("verify: raising manifest.qualityThresholds.maxFunctionLines over the length clears the Page code row, under the same label",
    () => /✅ Done/.test(pageCodeLine(raised.markdown)) && pageCodeLine(raised.markdown).includes("no function longer than `maxFunctionLines`"),
    () => pageCodeLine(raised.markdown));
  const failingLabel = "Page code — no function longer than `maxFunctionLines`, no helper declared twice on the page, no request declared but never sent";
  const decided = renderVerify(result, opts, built(longHandler), new Set([verifyRowKey("main", failingLabel)]));
  check("verify: a D<N> decision recorded on the Page code row closes it, and nothing else holds the same finding",
    () => !/⚠ verify/.test(pageCodeLine(decided.markdown)) && (decided.decided || []).some((d) => /Page code/.test(d.label || JSON.stringify(d)))
      && ROW_RULES.every((rule) => !/⚠ verify/.test(rowLine(decided.markdown, rule))),
    () => ({ row: pageCodeLine(decided.markdown), decided: decided.decided }));
  const decidedRaised = renderVerify(result, checklistOpts(manifest({ qualityThresholds: { maxFunctionLines: 65 } })), built(longHandler),
    new Set([verifyRowKey("main", failingLabel)]));
  check("verify: a decision recorded on the Page code row still holds after the threshold changes (the label names no value)",
    () => !/⚠ verify/.test(pageCodeLine(decidedRaised.markdown)), () => pageCodeLine(decidedRaised.markdown));
  // `modules: {}` is the read-back's answer for a run whose pages import no module of the run: the module rows close.
  const clean = renderVerify(result, opts, Object.assign(built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`), { modules: {} }));
  check("verify: a clean page closes every Code quality row ✅ (the advisory one never reads ⚠)",
    () => ROW_RULES.every((rule) => rule === R.unusedResourceString
      ? !/⚠ verify/.test(rowLine(clean.markdown, rule)) : /✅ Done/.test(rowLine(clean.markdown, rule))),
    () => clean.markdown.split("\n").filter((l) => l.includes("[code-quality]")));
  const unread = renderVerify(result, opts, built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`));
  check("verify: without the module bodies the four module rows say they were NOT checked — never a ✅ nobody earned",
    () => MODULE_BODY_RULES.every((rule) => /confirm on-stand/.test(rowLine(unread.markdown, rule)) && /reads\/modules/.test(rowLine(unread.markdown, rule))),
    () => unread.markdown.split("\n").filter((l) => l.includes("[code-quality]")));
  const usesHeld = `[${handler("usr.ApplyButtonClicked", 'if (s === "' + held + '") { return; }')}]`;
  const heldId = renderVerify(result, opts, built(usesHeld));
  check("verify: a record id the declared constants module holds blocks the GUID row",
    () => /⚠ verify/.test(rowLine(heldId.markdown, R.guidLiteral)), () => rowLine(heldId.markdown, R.guidLiteral));
  const noConventions = renderVerify(result, { ...opts, projectConventions: null, constantsGuids: [] }, built(usesHeld));
  const kindOf = (v, rule) => v.rows.find((r) => r.deliverable.includes(`[code-quality] ${rule} —`))?.kind;
  check("verify: without recorded projectConventions the GUID row says the constants-module check was skipped, does not block, and is a note (not a hand-confirm item)",
    () => /ℹ noted/.test(rowLine(noConventions.markdown, R.guidLiteral)) && /check was skipped/.test(rowLine(noConventions.markdown, R.guidLiteral))
      && kindOf(noConventions, R.guidLiteral) === "info",
    () => rowLine(noConventions.markdown, R.guidLiteral));
  check("verify: the Code quality rows are verify-only — the plan's groups (and so the task cut, a split and every digest) carry none",
    () => !checklistGroups(result, opts).some((g) => /Code quality/.test(g.title)) && /\*\*Code quality/.test(clean.markdown));
  const notBuilt = renderVerify(result, opts, { pages: { main: false } });
  check("verify: a page reported not built gets non-gating Code quality rows — its own rows already block",
    () => /☐ confirm on-stand/.test(rowLine(notBuilt.markdown, R.catchLogOnly)) && /no code to check/.test(rowLine(notBuilt.markdown, R.catchLogOnly))
      && kindOf(notBuilt, R.catchLogOnly) === "info",
    () => rowLine(notBuilt.markdown, R.catchLogOnly));
  // The Evidence cell goes through esc(), which renders a backtick as U+02CB; the pattern accepts either.
  const unparsable = renderVerify(result, opts, built("[ {"));
  check("verify: an unparsable handlers section blocks every Code quality row and names the section",
    () => /⚠ verify/.test(rowLine(unparsable.markdown, R.catchLogOnly)) && /[`ˋ]handlers[`ˋ] could not be parsed/.test(rowLine(unparsable.markdown, R.catchLogOnly)) && !unparsable.complete,
    () => rowLine(unparsable.markdown, R.catchLogOnly));
  const noBundle = renderVerify(result, opts, { pages: { main: { parentSchemaName: "PageWithTabsFreedomTemplate", viewConfig: { items: [] } } } });
  check("verify: a bundle without code sections cannot be checked — the rows are confirm-on-stand, never a silent ✅",
    () => /confirm on-stand/.test(rowLine(noBundle.markdown, R.catchLogOnly)), () => rowLine(noBundle.markdown, R.catchLogOnly));

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

  // the engine stays zero-dependency: quality.mjs imports only its siblings.
  // THE RUN'S MODULES. A benchmark run built the page modules the contract asks for and still left: two note pages
  // with no module of their own and four handlers copied between them, the same status id and the same selection
  // helpers declared in two modules, a wrapper the code bypassed five times, and exports nobody imports. Each is a
  // run-wide check, fed by the module bodies the read-back files under `built.modules`.
  {
    const GUID = "3a8b2f10-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    const thin = (arg) => handler("crt.HandleViewModelInitRequest", `await ${arg}.init(request.$context);`);
    const copied = handler("crt.HandleViewModelAttributeChangeRequest",
      "if (request.attributeName === \"Amount\") { const total = request.$context.Amount * 2; request.$context.Total = total; }");
    const page = (schemaName, deps, handlers) => ({ schemaName, deps: JSON.stringify(deps), handlers: `[${handlers}]` });
    const selected = "function selectedIds(list) { const out = []; for (const row of list || []) { if (row && row.selected) out.push(row.id); } return out; }";
    const mod = (name, deps, args, body, exportsSrc) =>
      `define("${name}", ${JSON.stringify(deps)}, function(${args}) {\n${body}\nreturn ${exportsSrc};\n});`;
    const totals = mod("UsrTotals", ["@creatio-devkit/common"], "sdk",
      "function processRequest(r) { return sdk.HandlerChainService.instance.process(r); }\nfunction sum(rows) { return rows.length; }",
      "{ processRequest, sum }");
    const badModules = {
      UsrApp_FormPageModule: mod("UsrApp_FormPageModule", ["@creatio-devkit/common", "UsrTotals"], "sdk, totals",
        `const CLOSED = "${GUID}";\n${selected}\nasync function init($context) { await sdk.HandlerChainService.instance.process({ type: "crt.LoadDataRequest", $context }); return totals.sum([CLOSED]); }`,
        "{ init, selectedIds }"),
      UsrApp_ListPageModule: mod("UsrApp_ListPageModule", [], "",
        `const CLOSED_STATUS = "${GUID}";\n${selected}\nfunction init($context) { return selectedIds($context.Items).length && CLOSED_STATUS; }`,
        "{ init }"),
      UsrTotals: totals,
    };
    const goodModules = {
      UsrApp_FormPageModule: mod("UsrApp_FormPageModule", ["UsrTotals"], "totals",
        "async function init($context) { await totals.processRequest({ type: \"crt.LoadDataRequest\", $context }); return totals.sum([totals.CLOSED]); }",
        "{ init }"),
      UsrApp_ListPageModule: mod("UsrApp_ListPageModule", ["UsrTotals"], "totals",
        "function init($context) { return totals.selectedIds($context.Items).length && totals.CLOSED; }", "{ init }"),
      UsrTotals: mod("UsrTotals", ["@creatio-devkit/common"], "sdk",
        `const CLOSED = "${GUID}";\n${selected}\nfunction processRequest(r) { return sdk.HandlerChainService.instance.process(r); }\nfunction sum(rows) { return rows.length; }`,
        "{ CLOSED, selectedIds, processRequest, sum }"),
    };
    const pages = (noteDeps, noteHandlers) => ({
      main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage")),
      list: page("UsrApp_ListPage", ["UsrApp_ListPageModule"], thin("listPage")),
      "child:Delivery": page("UsrApp_DeliveryPage", noteDeps("UsrApp_DeliveryPageModule"), noteHandlers("deliveryPage")),
      "child:Return": page("UsrApp_ReturnPage", noteDeps("UsrApp_ReturnPageModule"), noteHandlers("returnPage")),
    });
    const bad = lintRunQuality(pages(() => ["@creatio-devkit/common", "UsrTotals"], () => copied), DEFAULT_QUALITY_THRESHOLDS, new Set(), badModules);
    const goodNoteModule = (n, k = 2) => mod(n, ["UsrTotals"], "totals", `function onAmount($context) { $context.Total = $context.Amount * ${k}; }`, "{ onAmount }");
    const good = lintRunQuality(pages((m) => [m],
      (arg) => handler("crt.HandleViewModelAttributeChangeRequest", `if (request.attributeName === "Amount") ${arg}.onAmount(request.$context);`)),
    DEFAULT_QUALITY_THRESHOLDS, new Set(), { ...goodModules,
      UsrApp_DeliveryPageModule: goodNoteModule("UsrApp_DeliveryPageModule"), UsrApp_ReturnPageModule: goodNoteModule("UsrApp_ReturnPageModule", 3) });
    const at = (run) => Object.fromEntries([...run].map(([k, p]) => [k, (p?.findings || []).map((f) => f.rule + " " + f.text)]));
    const MODULE_RULES = [R.pageWithoutModule, R.duplicateHandlerAcrossPages, R.duplicateAcrossModules, R.sharedValueInTwoModules,
      R.unusedModuleExport, R.wrappedCallInlined];

    check("modules: a page with handlers and no `<PageSchema>Module` of its own is reported, each one — a shared module alone is not its module",
      () => count(bad.get("child:Delivery"), R.pageWithoutModule) === 1 && count(bad.get("child:Return"), R.pageWithoutModule) === 1
        && count(bad.get("main"), R.pageWithoutModule) === 0 && count(bad.get("list"), R.pageWithoutModule) === 0,
      () => at(bad));
    check("modules: a handler copied verbatim from another page is reported on the copying page only",
      () => count(bad.get("child:Return"), R.duplicateHandlerAcrossPages) === 1 && count(bad.get("child:Delivery"), R.duplicateHandlerAcrossPages) === 0,
      () => at(bad));
    check("modules: a function declared in two modules is reported once, on the page whose own module holds the copy, naming the original",
      () => { const f = bad.get("list").findings.filter((x) => x.rule === R.duplicateAcrossModules);
        return f.length === 1 && /UsrApp_FormPageModule/.test(f[0].text) && count(bad.get("main"), R.duplicateAcrossModules) === 0; },
      () => at(bad));
    check("modules: a record id declared in two modules is reported once — a value the run's pages share lives in one module",
      () => { const f = [...bad.values()].flatMap((p) => p.findings.filter((x) => x.rule === R.sharedValueInTwoModules));
        return f.length === 1 && f[0].text.includes(GUID) && /UsrApp_FormPageModule/.test(f[0].text) && /UsrApp_ListPageModule/.test(f[0].text); },
      () => at(bad));
    check("modules: an export no page or other module uses is reported on the module's page; an export a page calls is not",
      () => { const f = bad.get("main").findings.filter((x) => x.rule === R.unusedModuleExport);
        return f.length === 1 && /selectedIds/.test(f[0].text) && !/\binit\b/.test(f[0].text); },
      () => at(bad));
    check("modules: a call written out although a module export wraps exactly it is reported, naming the wrapper",
      () => { const f = bad.get("main").findings.filter((x) => x.rule === R.wrappedCallInlined);
        return f.length === 1 && /UsrTotals\.processRequest/.test(f[0].text) && /HandlerChainService\.instance\.process/.test(f[0].text); },
      () => at(bad));
    check("modules: the same run written the way the contract asks — own modules, one shared module, every export used — has none of the module findings",
      () => [...good.values()].every((p) => MODULE_RULES.every((r) => count(p, r) === 0)),
      () => at(good));
    check("modules: without module bodies only the page-side checks run, and nothing claims a module was checked",
      () => { const r = lintRunQuality(pages(() => ["@creatio-devkit/common", "UsrTotals"], () => copied));
        return count(r.get("child:Delivery"), R.pageWithoutModule) === 1
          && [...r.values()].every((p) => [R.duplicateAcrossModules, R.sharedValueInTwoModules, R.unusedModuleExport, R.wrappedCallInlined].every((x) => count(p, x) === 0)); });
    check("modules: an unreadable module body is named, never silently skipped",
      () => { const r = lintRunQuality(pages((m) => [m], (a) => thin(a)), DEFAULT_QUALITY_THRESHOLDS, new Set(),
        { ...goodModules, UsrApp_DeliveryPageModule: "define(\"UsrApp_DeliveryPageModule\", [], function() { return {", UsrApp_ReturnPageModule: goodNoteModule("UsrApp_ReturnPageModule", 3) });
        return r.get("child:Delivery").unreadable.some((u) => /UsrApp_DeliveryPageModule/.test(u)); },
      () => null);
    check("modules: every module rule has its Code quality row",
      () => MODULE_RULES.every((r) => QUALITY_ROW_RULES.some((row) => row.rule === r)));
  }

  const src = fs.readFileSync(new URL("../../skills/classic-to-freedom-migration/engine/quality.mjs", import.meta.url), "utf8");
  check("quality: quality.mjs imports only engine siblings (no package)",
    () => { const from = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      return from.length >= 2 && from.every((m) => m.startsWith("./")) && !/\bimport\s*\(/.test(src) && !/\brequire\s*\(/.test(src); });
}
