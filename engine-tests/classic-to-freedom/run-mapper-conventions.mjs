// PROJECT CONVENTIONS. A customer team named its requests `ab.`, imported its own helper module and
// kept every record id in constants modules; the migration wrote `usr.` requests and pasted raw GUIDs, because
// nothing the analysis found could reach a builder. These checks hold the carrier end to end: the `--plan` gate,
// the mapper's request names, the plan section and its record-id table, every task file, and the `--verify` rows.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectConventionsIssues, constantsGuidIndex, conventionsOf, bundleDeps, bundleCustomNames, foreignNames,
  DEFAULT_REQUEST_PREFIX } from "../../skills/classic-to-freedom-migration/engine/conventions.mjs";
import { verifyRowKey } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { syncTaskDir, renderTaskFile } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";

export function runConventionsChecks({ check, runMigration, runMigrate, renderVerify, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS,
  FULL_PLACEMENT, FULL_CONVENTIONS, FIX, ENGINE_DIR }) {
  const dir = path.join(FIX, "conventions");
  const body = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const DW = { resolved: true, requestPrefix: "ab", helperModules: ["AbClientHelperModule"], constantsModules: ["AbConstants", "AbCommonConstants"],
    source: "freedom-pages", evidence: "ab. — 7 requests on Page_OrderDelivery", confirmedBy: "plan" };
  const manifest = (conventions, extra = {}) => ({
    entity: "UsrOrder", seed: CLEAN_SEED, targetPackage: "UsrSU", planMeta: FULL_PLANMETA, signals: FULL_SIGNALS, placement: FULL_PLACEMENT,
    schemas: [{ pkg: "UsrOrders", body: body("UsrOrderPage.js") }], resources: { ApplyButtonCaption: "Apply" },
    ...(conventions ? { projectConventions: conventions } : {}),
    constantsModules: { AbConstants: { body: body("AbConstants.js") }, AbCommonConstants: body("AbCommonConstants.js") },
    ...extra,
  });
  const ab = runMigration(manifest(DW), { baseDir: dir });
  const section = (plan) => {
    const lines = plan.split("\n");
    const at = lines.indexOf("### Project conventions");
    const end = lines.findIndex((l, i) => i > at && /^### /.test(l));
    return at < 0 ? "" : lines.slice(at, end < 0 ? undefined : end).join("\n");
  };
  const dwSection = section(ab.plan);

  // AC 1 — the ab. project: the plan shows the prefix and the modules with evidence, the engine's requests use it.
  const requests = [...(ab.changeSet.requestHandlers || []).map((h) => h.request),
    ...(ab.changeSet.viewConfigDiff || []).map((o) => o.values?.clicked?.request).filter(Boolean)];
  check("conventions: a ab. project — every custom request the engine emits (button `clicked` + its published handler) uses `ab.`, none `usr.`",
    () => requests.length >= 2 && requests.every((r) => r === "ab.ApplyButtonClicked"), () => requests);
  check("conventions: the plan's Project conventions section shows the request prefix, the helper and constants modules and the evidence",
    () => ab.conventionsBlockers.length === 0 && /\| Request prefix \| `ab\.` \|/.test(dwSection) && /\| Helper modules \| `AbClientHelperModule` \|/.test(dwSection)
      && /`AbConstants`, `AbCommonConstants`/.test(dwSection) && /7 requests on Page_OrderDelivery/.test(dwSection)
      && /request handler/.test(ab.plan) && /ab\.ApplyButtonClicked/.test(ab.plan) && !/usr\.ApplyButtonClicked/.test(ab.plan),
    () => dwSection);
  check("conventions: without a recorded block the mapper keeps the engine default namespace",
    () => DEFAULT_REQUEST_PREFIX === "usr"
      && runMigration(manifest(null), { baseDir: dir }).changeSet.requestHandlers.every((h) => h.request === "usr.ApplyButtonClicked"));

  // AC 8 — record ids: every id the plan uses is shown with the constants path that holds it, every candidate listed.
  check("conventions: a record id a business rule compares against is listed with BOTH constants paths that hold it (a variable alias resolves to its return key; case is ignored)",
    () => /\| `3e7f3a3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f` \| `AbConstants\.OrderStatus\.Approved` · `AbCommonConstants\.Statuses\.OrderApproved` \|/.test(dwSection),
    () => dwSection);
  const idx = constantsGuidIndex(manifest(DW));
  check("conventions: the GUID index reads nested return keys, variables the return reaches, and a variable it does not reach under its own name",
    () => idx.get("5c5c5c5c-0000-4000-8000-000000000005")?.[0] === "AbConstants.OrderType.Retail"
      && idx.get("1b7e3a3c-0000-4c5d-8e9f-0a1b2c3d4e5f")?.[0] === "AbConstants.OrderStatus.New"
      && idx.get("9a9a9a9a-0000-4000-8000-000000000009")?.[0] === "AbConstants.unreferenced.Legacy",
    () => Object.fromEntries(idx));
  check("conventions: an id only a constants module holds and nothing in the plan uses is NOT listed (no table of the whole module)",
    () => !/5c5c5c5c-0000/.test(dwSection));

  // module rows: one CHECKED row per declared module the Classic page imports; the rest stays informational.
  const groups = ab.checklist;
  check("conventions: the module-dep aggregate splits — one checked row per declared helper/constants module, platform deps stay one informational row",
    () => /\[module-dep\] AbConstants — project constants module/.test(groups) && /\[module-dep\] AbClientHelperModule — project helper module/.test(groups)
      && /\[module-dep\] BusinessRuleModule \|/.test(groups) && !/\[module-dep\] AbConstants, AbClientHelperModule/.test(groups),
    () => groups.split("\n").filter((l) => /module-dep/.test(l)));

  // AC 2 — no custom requests and SchemaNamePrefix = Usr: the verified fallback is a valid, approvable answer.
  const fallback = runMigration(manifest({ resolved: true, requestPrefix: "usr", source: "fallback", evidence: "no custom requests; SchemaNamePrefix = Usr", confirmedBy: "plan" }), { baseDir: dir });
  check("conventions: the verified fallback to `usr.` clears the gate and the plan says it is the fallback",
    () => fallback.conventionsBlockers.length === 0 && /verified fallback — no project namespace found — no custom requests; SchemaNamePrefix = Usr/.test(section(fallback.plan)),
    () => [fallback.conventionsBlockers, section(fallback.plan)]);
  check("conventions: a 'fallback' that names another prefix is refused — the fallback IS `usr`",
    () => projectConventionsIssues({ projectConventions: { ...FULL_CONVENTIONS, requestPrefix: "ab" } }).some((x) => /source is 'fallback' but requestPrefix is 'ab'/.test(x)));
  check("conventions: `crt` is the platform's namespace and never a project prefix; a dotted value is not a namespace",
    () => projectConventionsIssues({ projectConventions: { ...DW, validatorPrefix: "crt", constantsModules: [] } }).some((x) => /validatorPrefix is 'crt'/.test(x))
      && projectConventionsIssues({ projectConventions: { ...DW, requestPrefix: "ab.X", constantsModules: [] } }).some((x) => /is not a namespace/.test(x))
      && conventionsOf({ projectConventions: { ...DW, requestPrefix: "ab." } }).requestPrefix === "ab");

  // AC 3 — two namespaces: one question with counts; the user's answer clears it.
  const conflict = { ...DW, conflict: { ab: 7, usr: 2 } };
  const asked = runMigration(manifest(conflict), { baseDir: dir });
  const answered = runMigration(manifest({ ...conflict, confirmedBy: "user" }), { baseDir: dir });
  check("conventions: a namespace conflict blocks the plan until the user answers, and the plan asks ONE question with counts per namespace",
    () => asked.conventionsBlockers.length === 1 && /`ab\.` × 7, `usr\.` × 2\. Which one does this migration use\?/.test(section(asked.plan))
      && answered.conventionsBlockers.length === 0 && /answered by the user/.test(section(answered.plan)),
    () => ({ asked: asked.conventionsBlockers, answered: answered.conventionsBlockers }));

  // AC 4 — an earlier migration's record: shown side by side, a question only when it differs.
  const same = runMigration(manifest({ ...DW, previous: { folder: "migrations/orders-1", requestPrefix: "ab", helperModules: ["AbClientHelperModule"], constantsModules: ["AbConstants", "AbCommonConstants"] } }), { baseDir: dir });
  const differs = { ...DW, previous: { folder: "migrations/orders-1", requestPrefix: "usr", helperModules: [], constantsModules: ["AbConstants"] } };
  const diffAsked = runMigration(manifest(differs), { baseDir: dir });
  const diffAnswered = runMigration(manifest({ ...differs, confirmedBy: "user" }), { baseDir: dir });
  check("conventions: the same conventions as the earlier migration are reused without a question",
    () => same.conventionsBlockers.length === 0 && /Earlier migration \(`migrations\/orders-1`\):\*\* the same conventions — reused without a question/.test(section(same.plan)),
    () => section(same.plan));
  check("conventions: conventions that differ from the earlier migration show both and block until the user chooses",
    () => diffAsked.conventionsBlockers.length === 1 && /differ from the earlier migration in 'migrations\/orders-1'/.test(diffAsked.conventionsBlockers[0])
      && /`usr\.`, helpers none, constants `AbConstants` — differs \(request prefix usr\. → ab\./.test(section(diffAsked.plan))
      && /Question for the user:\*\* keep the earlier values/.test(section(diffAsked.plan))
      && diffAnswered.conventionsBlockers.length === 0 && /the user chose the values in the table above/.test(section(diffAnswered.plan)),
    () => ({ blockers: diffAsked.conventionsBlockers, section: section(diffAsked.plan) }));

  // AC 5 — no resolved block: `--plan` exits non-zero with the gate message, in the plan and on stderr.
  const noBlock = runMigrate(["-", "--plan"], { input: JSON.stringify({ ...manifest(null), schemas: [{ pkg: "UsrOrders", body: body("UsrOrderPage.js") }] }) });
  check("conventions gate: a --plan run with NO manifest.projectConventions is INCOMPLETE (exit 2), the banner and stderr name it",
    () => noBlock.status === 2 && /PLAN INCOMPLETE — project conventions not settled/.test(noBlock.stdout || "")
      && /project conventions not settled: projectConventions not resolved/.test(noBlock.stderr || ""),
    () => ({ status: noBlock.status, stderr: (noBlock.stderr || "").slice(0, 300) }));
  const withBlock = runMigrate(["-", "--plan"], { input: JSON.stringify(manifest(DW)), cwd: dir });
  check("conventions gate: the same run with a resolved block exits 0",
    () => withBlock.status === 0 && !/PLAN INCOMPLETE/.test(withBlock.stdout || ""), () => ({ status: withBlock.status, stderr: (withBlock.stderr || "").slice(0, 300) }));
  check("conventions gate: a declared constants module with no body is a blocker — the plan cannot map its ids",
    () => projectConventionsIssues({ projectConventions: DW, constantsModules: {} }).filter((x) => /has no body in manifest\.constantsModules/.test(x)).length === 2);
  check("conventions gate: an unresolved block is reported alone — no rule is evaluated over a missing fact",
    () => projectConventionsIssues({ projectConventions: { ...DW, resolved: false } }).length === 1);

  // AC 6 — every build and fix task file carries the block.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-tasks-"));
  try {
    const set = syncTaskDir(tmp, ab, {});
    const files = (set.tasks || []).map((t) => fs.readFileSync(path.join(tmp, t.file), "utf8"));
    const repair = renderTaskFile({ ...set.tasks[0], kind: "repair", repairRound: 1, cause: "verify:main" }, { planVersion: ab.planVersion, projectConventions: ab.projectConventions });
    const blockOk = (t) => /## Project conventions/.test(t) && /`ab\.<Name>Request`/.test(t) && /`AbClientHelperModule`/.test(t)
      && /`AbConstants`, `AbCommonConstants` — reference existing record ids through them/.test(t) && /Freedom pages CAN import these client-unit modules/.test(t)
      && t.indexOf("## Project conventions") < t.indexOf("## Deliverables");
    check("conventions: every build task file `--tasks` writes carries the conventions block, before its deliverables",
      () => files.length > 0 && files.every(blockOk), () => ({ n: files.length, first: files[0]?.slice(0, 1500) }));
    check("conventions: a fix (repair) task file carries the same block",
      () => blockOk(repair), () => repair.slice(0, 1500));
    check("conventions: a run with no recorded conventions writes no block",
      () => !/## Project conventions/.test(renderTaskFile(set.tasks[0], { planVersion: ab.planVersion })));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // AC 7 + 8 — `--verify` reads the built bundle: foreign names block, declared modules are checked against SCHEMA_DEPS.
  const opts = checklistOpts(manifest(DW));
  const page = (extra) => ({ parentSchemaName: "PageWithTabsFreedomTemplate", packageName: "UsrSU", schemaUId: "11111111-1111-4111-8111-111111111111",
    viewConfig: { items: [{ type: "crt.Button", name: "ApplyButton", clicked: { request: "ab.ApplyButtonClicked" } }] }, ...extra });
  const NS_ROW = /Custom requests, validators and converters use the project namespace `ab\.`/;
  const rowLine = (md, re) => md.split("\n").find((l) => re.test(l)) || "";
  const foreign = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "usr.ApplyButtonClicked", handler: async (r, n) => n?.handle(r) }]',
    converters: '{ "usr.ToUpper": { converter: (v) => v } }', validators: "{}", deps: '["@creatio-devkit/common"]' }) } });
  check("verify: a request and a converter outside the project namespace make the namespace row a blocking ⚠ that keeps the page from complete",
    () => /⚠ verify/.test(rowLine(foreign.markdown, NS_ROW)) && /request .usr\.ApplyButtonClicked./.test(rowLine(foreign.markdown, NS_ROW))
      && /converter .usr\.ToUpper./.test(rowLine(foreign.markdown, NS_ROW)) && !foreign.complete,
    () => rowLine(foreign.markdown, NS_ROW));
  const nsLabel = "Custom requests, validators and converters use the project namespace `ab.`";
  const decided = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "usr.ApplyButtonClicked" }]', deps: "[]" }) } }, new Set([verifyRowKey("main", nsLabel)]));
  check("verify: a D<N> decision recorded on the namespace row closes it (it is not left open)",
    () => !/⚠ verify/.test(rowLine(decided.markdown, NS_ROW)) && (decided.decided || []).some((d) => NS_ROW.test(d.label || JSON.stringify(d))),
    () => ({ row: rowLine(decided.markdown, NS_ROW), decided: decided.decided }));
  const clean = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "crt.SaveRecordRequest" }, { request: "ab.ApplyButtonClicked" }]',
    validators: '{ "ab.Positive": { validator: () => null } }', converters: "{}", deps: '["@creatio-devkit/common","AbConstants","AbClientHelperModule"]' }) } });
  check("verify: `crt.` and the project namespace pass — the namespace row is ✅",
    () => /✅ Done/.test(rowLine(clean.markdown, NS_ROW)), () => rowLine(clean.markdown, NS_ROW));
  const MOD_ROW = /\[module-dep\] AbConstants — project constants module/;
  check("verify: a declared constants module in the built page's SCHEMA_DEPS closes its row ✅; missing from them it is a blocking ⚠",
    () => /✅ Done/.test(rowLine(clean.markdown, MOD_ROW)) && /⚠ verify/.test(rowLine(foreign.markdown, MOD_ROW))
      && /not in the built page's SCHEMA_DEPS/.test(rowLine(foreign.markdown, MOD_ROW)),
    () => [rowLine(clean.markdown, MOD_ROW), rowLine(foreign.markdown, MOD_ROW)]);
  const noBundle = renderVerify(ab, opts, { pages: { main: page({}) } });
  check("verify: a bundle without deps/handlers cannot be checked — the two rows are confirm-on-stand, never a silent ✅",
    () => /confirm on-stand/.test(rowLine(noBundle.markdown, NS_ROW)) && /confirm on-stand/.test(rowLine(noBundle.markdown, MOD_ROW)),
    () => [rowLine(noBundle.markdown, NS_ROW), rowLine(noBundle.markdown, MOD_ROW)]);

  // the bundle readers, on get-page's SOURCE strings and on parsed values
  check("bundle readers: deps from the source string or a list; requests, validators and converters from source or parsed shapes",
    () => bundleDeps({ deps: '["a", "B"]' }).join() === "a,B" && bundleDeps({ deps: ["x"] }).join() === "x" && bundleDeps({}) === null
      && bundleCustomNames({ validators: { "ab.V": {} }, converters: '{"ab.C": {}}' }, JSON.stringify([{ request: "ab.A" }])).request.has("ab.A")
      && bundleCustomNames({ validators: { "ab.V": {} } }, null).validator.has("ab.V") && bundleCustomNames({}, null) === null
      && foreignNames(bundleCustomNames({}, "[{request: 'zz.Q'}]"), { request: "ab", validator: "ab", converter: "ab" })[0]?.name === "zz.Q");

  // AC 9 — the hard-coded literal is gone from the mapper.
  check("conventions: no `usr.` literal remains in mapper.mjs",
    () => !/usr\./.test(fs.readFileSync(path.join(ENGINE_DIR, "mapper.mjs"), "utf8")));
}
