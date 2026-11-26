// VERIFY ROWS THAT MUST NOT STAY OPEN ON A CORRECT BUILD. Three shapes a finished run can carry while its pages are
// right: a target package planned as a name with a note, a caption kept under the key its element is built with,
// and a business rule the user accepted mid-build as built another way. Each is checked through the engine's
// public entry points; the run-level plan version is checked where the answer could otherwise move it. Imported
// and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageNameOf, textMismatches } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { closedRuleAttributes } from "../../skills/classic-to-freedom-migration/engine/directives.mjs";

export function runVerifyFalseNegativeChecks({ check, runMigration, runMigrate, checklistOpts, checklistGroups, renderVerify, resolveVk,
  resolveRuleVk, verifyCtx, parseDecisionRecords, verifyManifest, DIR }) {
  // ---- the target package as a name ----
  const NOTED = "UsrOrdersApp (primary package of the new app; created by create-app)";
  check("package name: a planned name followed by a note reads as the name — `Name (note)` and `Name — note`",
    () => packageNameOf(NOTED) === "UsrOrdersApp" && packageNameOf("UsrOrdersApp — made by create-app") === "UsrOrdersApp"
      && packageNameOf("`UsrOrdersApp`") === "UsrOrdersApp" && packageNameOf("UsrOrdersApp") === "UsrOrdersApp",
    () => [NOTED, "UsrOrdersApp — made by create-app"].map((p) => packageNameOf(p)));
  check("package name: the package create-app made wins over the planned value, and a planned value that opens with no name is kept as written",
    () => packageNameOf(NOTED, "UsrOrdersApp2") === "UsrOrdersApp2" && packageNameOf(NOTED, "not a name") === "UsrOrdersApp"
      && packageNameOf("the primary package of the new app") === "the primary package of the new app"
      && packageNameOf(undefined) === undefined,
    () => [packageNameOf(NOTED, "UsrOrdersApp2"), packageNameOf("the primary package of the new app")]);

  const pageIn = (packageName) => ({ pages: { main: { packageName, viewConfig: { items: [] } } } });
  const placed = (packageName, created = null) => resolveVk({ type: "placement", exp: NOTED },
    { ...verifyCtx(pageIn(packageName), "main"), createdPackage: created });
  check("placement: a page built in the package the noted plan names is ✅, the verdict names the package, not the note",
    () => placed("UsrOrdersApp")[2] === "ok" && !/primary package/.test(placed("UsrOrdersApp")[1]),
    () => placed("UsrOrdersApp"));
  check("placement: a page in another package is still ❌ MISSING, and the recorded create-app package is the one compared",
    () => placed("UsrOther")[2] === "missing" && /plan targets `UsrOrdersApp`/.test(placed("UsrOther")[1])
      && placed("UsrOrdersApp2", "UsrOrdersApp2")[2] === "ok" && placed("UsrOrdersApp", "UsrOrdersApp2")[2] === "missing",
    () => [placed("UsrOther"), placed("UsrOrdersApp", "UsrOrdersApp2")]);

  const addon = (packageName) => ({ success: true, packageName, pages: [{ pageSchemaName: "UsrOrdersApp_ItemPage" }] });
  const related = (packageName, created = null) => resolveVk({ type: "relatedpage", entity: "Item", evidence: "relatedPage:Item", package: NOTED,
    childKey: "child:Item" }, { ...verifyCtx({ pages: { main: { viewConfig: { items: [] } },
    "child:Item": { schemaName: "UsrOrdersApp_ItemPage", viewConfig: { items: [] } } },
  reachability: { "relatedPage:Item": addon(packageName) } }, "main"), createdPackage: created });
  check("related page: an add-on read from the package the noted plan names is matched on its pages, not reported as read from the wrong package",
    () => !/plan targets/.test(related("UsrOrdersApp")[1]) && /plan targets `UsrOrdersApp`/.test(related("UsrOther")[1]),
    () => [related("UsrOrdersApp"), related("UsrOther")]);
  check("related page: once create-app's package is recorded, the add-on is compared against it",
    () => !/plan targets/.test(related("UsrOrdersApp2", "UsrOrdersApp2")[1])
      && /plan targets `UsrOrdersApp2`/.test(related("UsrOrdersApp", "UsrOrdersApp2")[1]),
    () => [related("UsrOrdersApp2", "UsrOrdersApp2"), related("UsrOrdersApp", "UsrOrdersApp2")]);

  const noPkgRead = resolveVk({ type: "relatedpage", entity: "Item", evidence: "relatedPage:Item", package: NOTED, childKey: "child:Item" },
    verifyCtx({ pages: { main: { viewConfig: { items: [] } }, "child:Item": { schemaName: "UsrOrdersApp_ItemPage", viewConfig: { items: [] } } },
      reachability: { "relatedPage:Item": { success: true, pages: [{ pageSchemaName: "UsrOrdersApp_ItemPage" }] } } }, "main"));
  check("related page: a read with no `packageName` names the package by its name, not the plan's note",
    () => /cannot confirm the add-on is in `UsrOrdersApp`/.test(noPkgRead[1]) && !/primary package/.test(noPkgRead[1]), () => noPkgRead);

  // A packaged dashboard lands in the same package as the pages; a stand-only one has none to resolve.
  const dashExpect = [{ id: "d1", caption: "Sales", pkg: NOTED }, { id: "d2", caption: "Mine", pkg: "" }];
  const delivered = (pkg, created = null) => resolveVk({ type: "dashboards", check: "delivery", expect: dashExpect },
    { ...verifyCtx({ pages: { main: { viewConfig: { items: [] } } }, dashboards: [
      { id: "d1", status: "Success", schemaName: "S1", package: pkg }, { id: "d2", status: "Success", schemaName: "S2" }] }, "main"),
    createdPackage: created });
  check("dashboards: a packaged dashboard delivered into the package the noted plan names is ✅, the stand-only one stays user-level",
    () => delivered("UsrOrdersApp")[2] === "ok" && delivered("UsrOrdersApp2", "UsrOrdersApp2")[2] === "ok",
    () => [delivered("UsrOrdersApp"), delivered("UsrOrdersApp2", "UsrOrdersApp2")]);
  check("dashboards: one delivered elsewhere is ❌ and names the package by its name",
    () => delivered("UsrOther")[2] === "missing" && /planned UsrOrdersApp(?!\s*\()/.test(delivered("UsrOther")[1]),
    () => delivered("UsrOther"));

  // The noted value is the plan's own: the rows keep it, so a task cut before create-app ran does not drift.
  const su = JSON.parse(verifyManifest);
  const noted = { ...su, targetPackage: NOTED };
  const createdM = { ...noted, createdApp: { primaryPackage: "UsrOrdersApp" } };
  const otherM = { ...noted, createdApp: { primaryPackage: "UsrOrdersApp2" } };
  const runs = new Map([noted, createdM, otherM].map((m) => [m, runMigration(m, { baseDir: DIR })]));
  const placementLabel = (m) => checklistGroups(runs.get(m), checklistOpts(m)).flatMap((g) => g.rows)
    .find((r) => r.vk?.type === "placement")?.label || "";
  check("package name: recording `createdApp` changes neither the plan version nor the placement row a task was cut from",
    () => runs.get(noted).planVersion === runs.get(createdM).planVersion
      && placementLabel(noted) === placementLabel(createdM) && placementLabel(noted).includes(NOTED),
    () => [placementLabel(noted), placementLabel(createdM)]);
  const placementVerdict = (m) => renderVerify(runs.get(m), checklistOpts(m),
    { pages: { main: { packageName: "UsrOrdersApp", viewConfig: { items: [] } } } }).markdown.split("\n").find((l) => l.includes("Package placement")) || "";
  check("package name: `--verify` closes the placement row of a noted plan for a page in the named package, and compares against `createdApp` once it is recorded",
    () => placementVerdict(noted).includes("✅") && placementVerdict(createdM).includes("✅") && placementVerdict(otherM).includes("MISSING"),
    () => [placementVerdict(noted), placementVerdict(createdM), placementVerdict(otherM)]);

  // ---- a filed record waiting for its verdict names itself, so its repair can go to a judge ----
  const filed = { referencePage: "X_FormPage", components: ["crt.Input"], findings: [], findingsRaised: [] };
  const judged = (verdict) => resolveVk({ type: "evidence", id: "main#quality-gates" }, verifyCtx({ pages: { main: { viewConfig: { items: [] } } },
    evidence: { "main#quality-gates": filed }, judge: { "main#quality-gates": verdict } }, "main"));
  check("unjudged: a complete record with no verdict is ⚠ and names its record id beside the verdict; a judged one carries no id",
    () => judged({ convincing: null })[4]?.unjudged === "main#quality-gates" && judged({ convincing: true, why: "x" })[2] === "ok"
      && judged({ convincing: true, why: "x" })[4] === undefined,
    () => [judged({ convincing: null }), judged({ convincing: true, why: "x" })]);
  const suRun = runMigration(su, { baseDir: DIR });
  const openRows = Object.values(renderVerify(suRun, checklistOpts(su), { pages: { main: { viewConfig: { items: [] } } },
    evidence: { "main#quality-gates": filed }, judge: { "main#quality-gates": { convincing: null } } }).pages || {})
    .flatMap((p) => p.openRows || []);
  check("unjudged: `--verify`'s open row for that record carries `unjudgedRecord`, the field a repair round routes by",
    () => openRows.some((r) => r.unjudgedRecord === "main#quality-gates"), () => openRows.filter((r) => /NOT judged/.test(r.evidence)));
  const judgedHalf = (verdict) => resolveVk({ type: "evidence", id: "main#quality-gates", part: "judged" }, verifyCtx({ pages: { main: { viewConfig: { items: [] } } },
    evidence: { "main#quality-gates": filed }, judge: { "main#quality-gates": verdict } }, "main"));
  check("unjudged: the judged half of a split evidence pair names its record the same way, and carries no id once judged",
    () => judgedHalf({ convincing: null })[4]?.unjudged === "main#quality-gates"
      && judgedHalf({ convincing: true, why: "x" })[2] === "ok" && judgedHalf({ convincing: true, why: "x" })[4] === undefined,
    () => [judgedHalf({ convincing: null }), judgedHalf({ convincing: true, why: "x" })]);

  // ---- a rule attribute the user's later answer closes ----
  const DECISIONS_MD = [
    "## D4 — Lock kept in code",
    "- Kind: answer", "- Decided by: user", "- Quote: \"keep the lock in the handler\"",
    "- Closes: `main#business-rule:Calendar`, `main#business-rules`",
    "## D5 — Orchestrator closes a rule",
    "- Kind: answer", "- Decided by: orchestrator", "- Closes: `main#business-rule:ParentSupportUnit`",
  ].join("\n");
  const records = parseDecisionRecords(DECISIONS_MD);
  check("closes: a user's answer closes only the business-rule attributes it names; another address and an orchestrator's answer close nothing",
    () => JSON.stringify(closedRuleAttributes(records)) === JSON.stringify([{ key: "main#business-rule:Calendar", decision: "D4" }]),
    () => closedRuleAttributes(records));
  const decisions = new Map(records.map((r) => [r.id, r.title]));
  const answered = runMigration(su, { baseDir: DIR, decisions, decisionRecords: records });
  const unanswered = runMigration(su, { baseDir: DIR, decisions, decisionRecords: [] });
  const ruleRow = (res, opts) => checklistGroups(res, checklistOpts(su, opts)).flatMap((g) => g.rows)
    .find((r) => r.vk?.type === "rule" && r.vk.names.includes("Calendar"));
  const row = ruleRow(answered, { decisionRecords: records });
  check("closes: the answered attribute rides on the rule row with the user's quote, the plan version stays the approved one, and the answer raises no status issue",
    () => row?.vk.decided?.Calendar?.decision === "D4" && row.vk.decided.Calendar.quote === "keep the lock in the handler"
      && answered.planVersion === unanswered.planVersion && !(answered.statusIssues || []).length
      && !ruleRow(unanswered, { decisionRecords: [] })?.vk.decided,
    () => ({ vk: row?.vk, issues: answered.statusIssues }));
  const governs = (attr) => ({ name: `BusinessRule_${attr}`, condition: {}, actions: [{ type: "make-required", items: [`${attr}Field`] }] });
  const others = row.vk.names.filter((n) => n !== "Calendar");
  const verdict = resolveRuleVk(row.vk, verifyCtx({ pages: { main: { viewConfig: { items: [] },
    businessRules: { count: others.length, rules: others.map(governs) } } } }, "main"));
  check("closes: the rule row is ✅ with the other rules built, and names the attribute the answer closed",
    () => verdict[2] === "ok" && /built another way on the user's decision: Calendar \(D4/.test(verdict[1]), () => verdict);
  const typo = parseDecisionRecords(DECISIONS_MD.replace("business-rule:Calendar", "business-rule:Nope"));
  const typoRun = runMigration(su, { baseDir: DIR, decisions, decisionRecords: typo });
  check("closes: an answer naming an attribute the page's rules do not list is a named status issue, not a silent close",
    () => (typoRun.statusIssues || []).some((x) => x.key === "main#business-rule:Nope" && x.kind === "unknown-id"),
    () => typoRun.statusIssues);
  const named = (id, re) => (answered.provenanceIssues || []).some((x) => x.key === id && re.test(x.problem));
  check("closes: an address that is not a rule attribute, and a `Closes:` line on an orchestrator's entry, are each named — nothing is dropped silently",
    () => named("D4", /names `main#business-rules`, which is not a business-rule attribute/) && named("D5", /only on the user's own answer/),
    () => answered.provenanceIssues);
  const several = parseDecisionRecords("## D7 — Two locks\n- Kind: answer\n- Decided by: user\n- Quote: \"both in code\"\n"
    + "- Closes: `main#business-rule:A`, `main#business-rule:B`");
  check("closes: a line naming several attributes closes each of them — the keys after the first keep no stray backtick",
    () => closedRuleAttributes(several).map((c) => c.key).join() === "main#business-rule:A,main#business-rule:B",
    () => closedRuleAttributes(several));

  const unquoted = parseDecisionRecords("## D8 — No words\n- Kind: answer\n- Decided by: user\n- Closes: `main#business-rule:A`");
  check("closes: a user answer with no `Quote:` closes nothing — the closure stands on the user's own words",
    () => closedRuleAttributes(unquoted).length === 0, () => closedRuleAttributes(unquoted));
  // The approved plan's own status wins over a later answer naming the same attribute.
  const planned = { ...su, deliverableStatus: { "main#business-rule:Calendar": { status: "built-elsewhere", decision: "D4" } } };
  const precedence = checklistOpts(planned, { decisionRecords: parseDecisionRecords(DECISIONS_MD.replace("## D4", "## D9")) }).deliverableStatus;
  check("closes: a manifest `deliverableStatus` entry for the same attribute wins over the answer",
    () => precedence["main#business-rule:Calendar"]?.decision === "D4", () => precedence);

  // ---- the same answer and the recorded package through the CLI's own `--verify` ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c2f-verify-fn-"));
  try {
    fs.writeFileSync(path.join(tmp, "decisions.md"), DECISIONS_MD.split("## D5")[0].replace("- Closes:", "- Asked: Keep the lock in code?\n- Closes:")
      .replace(", `main#business-rules`", ""));
    fs.writeFileSync(path.join(tmp, "built.json"), JSON.stringify({ pages: { main: { packageName: "UsrOrdersApp2", viewConfig: { items: [] },
      parentSchemaName: "SupportUnitPage", schemaUId: "11111111-1111-4111-8111-111111111111",
      businessRules: { count: others.length, rules: others.map(governs) } } } }));
    const cliManifest = { ...noted, createdApp: { primaryPackage: "UsrOrdersApp2" } };
    const res = runMigrate(["-", "--verify", "--built", path.join(tmp, "built.json")], { input: JSON.stringify(cliManifest) });
    const out = res.stdout || "";
    const line = (re) => out.split("\n").find((l) => re.test(l)) || "";
    check("closes + createdApp (CLI): `--verify` reads decisions.md beside the payload and the manifest's `createdApp` — the answered rule row and the placement row are ✅",
      () => line(/Business rules ×/).includes("✅") && /Calendar \(D4/.test(line(/Business rules ×/))
        && line(/Package placement/).includes("✅"),
      () => [res.status, line(/Business rules ×/), line(/Package placement/), (res.stderr || "").slice(0, 400)]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// A caption the plan keys one way and the page keeps under the key its element is built with is a built caption.
export function runCaptionKeyChecks({ check, runMigration, checklistOpts, renderVerify, verifyCtx, coTextsManifest, FIX }) {
  const m = coTextsManifest();
  const run = runMigration(m, { baseDir: FIX });
  const strings = structuredClone(run.changeSet.resourceCultures);
  const rowWith = (s) => renderVerify(run, checklistOpts(m), { pages: { main: { viewConfig: [{ name: "X", type: "crt.Input" }],
    resources: { strings: s } } } }).markdown.split("\n").find((l) => l.includes("Form page")) || "";
  const renamed = Object.fromEntries(Object.entries(strings).map(([k, v]) => [`${k}Renamed_title`, v]));
  check("texts (renamed keys): every caption kept under another key with the same text in each culture closes the row",
    () => Object.keys(strings).length > 0 && rowWith(renamed).includes("✅"), () => rowWith(renamed));
  const [first] = Object.keys(strings);
  const changed = { ...renamed, [`${first}Renamed_title`]: Object.fromEntries(Object.keys(strings[first]).map((c) => [c, "Something else"])) };
  const open = rowWith(changed);
  check("texts (renamed keys): a caption no key carries stays open and names the plan's key; the same key with other words is still ❌",
    () => open.includes("⚠") && open.includes(`no text in ˋ${first}ˋ`)
      && rowWith({ ...strings, [first]: changed[`${first}Renamed_title`] }).includes("MISSING"),
    () => [open]);
  check("texts (renamed keys): the verdict names the key each caption was found under",
    () => rowWith(renamed).includes(`ˋ${first}ˋ as ˋ${first}Renamed_titleˋ`), () => rowWith(renamed));
  // Only a key carrying the text in EVERY culture the plan lists stands in; a culture-by-culture patchwork of
  // unrelated strings is not the caption.
  const cultures = Object.keys(strings[first]);
  const split = Object.fromEntries(Object.entries(renamed).filter(([k]) => k !== `${first}Renamed_title`));
  cultures.forEach((c, i) => { split[`Unrelated${i}_caption`] = { [c]: strings[first][c] }; });
  check("texts (renamed keys, anti-vacuity): the plan lists the caption in more than one culture",
    () => cultures.length > 1, () => cultures);
  check("texts (renamed keys): a caption matched only culture by culture across unrelated keys stays open",
    () => rowWith(split).includes(`no text in ˋ${first}ˋ`), () => rowWith(split));
  // Two plan keys with the same text cannot both be closed by one built string, and a key the plan expects for
  // another text never stands in.
  const page = (s) => verifyCtx({ pages: { main: { viewConfig: { items: [] }, resources: { strings: s } } } }, "main");
  const notes = { "en-US": "Notes", "fr-FR": "Notes (fr)" };
  const twins = [{ key: "NotesTabCaption", cultures: notes }, { key: "NotesFieldCaption", cultures: notes }];
  const one = textMismatches(twins, page({ NotesTab_caption: notes }));
  const both = textMismatches(twins, page({ NotesTab_caption: notes, Notes_label: notes }));
  const planned = textMismatches(twins, page({ NotesTabCaption: { "en-US": "Notes", "fr-FR": "Notes (fr)" } }));
  check("texts (renamed keys): one built key stands in for one plan key only, and two keys close two",
    () => one.substituted.length === 1 && one.absent.length === 2 && both.substituted.length === 2 && !both.absent.length,
    () => [one, both]);
  check("texts (renamed keys): a key the plan expects for one caption is never taken as the stand-in for another",
    () => planned.substituted.length === 0 && planned.absent.length === 2 && planned.absent.every((a) => a.includes("NotesFieldCaption")),
    () => planned);
}

// ENTITY RULES ARE READ OFF THE OBJECT. A rule the migration adds to the object persists on the entity, so neither the
// page body nor the page's own rules read holds it: its row is matched against `read-entity-business-rules`, which
// the read plan asks for, the read-back files under `entityBusinessRules`, and nothing else satisfies.
export function runEntityRuleChecks({ check, runMigration, checklistOpts, checklistGroups, resolveRuleVk, verifyCtx, readPlan,
  assembleBuilt, verifyManifest, DIR }) {
  const su = { ...JSON.parse(verifyManifest), targetPackage: "UsrSU" };
  const run = runMigration(su, { baseDir: DIR });
  const opts = checklistOpts(su);
  const rows = checklistGroups(run, opts).flatMap((g) => g.rows.map((r) => ({ ...r, pageKey: r.pageKey || g.pageKey })));
  const entityRow = rows.find((r) => r.deliverableId === "entity-rules");
  const pageRow = rows.find((r) => r.deliverableId === "business-rules");
  check("entity rules (anti-vacuity): the fixture has an entity-rules row and a page-rules row on the same page",
    () => !!entityRow && !!pageRow && entityRow.pageKey === pageRow.pageKey, () => rows.filter((r) => r.vk?.type === "rule").map((r) => r.vk));
  check("entity rules: the entity-rules row reads its rules from the object's slot and names the object; the page-rules row keeps the page's",
    () => entityRow.vk.slot === "entityBusinessRules" && entityRow.vk.entity === "SupportUnit" && !pageRow.vk.slot,
    () => [entityRow.vk, pageRow.vk]);

  const plan = readPlan(run, opts);
  const entityRead = plan.reads.find((r) => r.kind === "entityBusinessRules");
  check("entity rules: the read plan asks for `read-entity-business-rules` on the object in the target package, after every other read",
    () => !!entityRead && entityRead.pageKey === "main" && plan.reads.at(-1) === entityRead
      && /read-entity-business-rules.*`SupportUnit`.*`UsrSU`/.test(entityRead.what) && entityRead.file.endsWith("-entity-rules-main.json"),
    () => plan.reads.map((r) => r.file));

  const attr = entityRow.vk.names[0];
  const ruleOn = (a) => ({ name: `BusinessRule_${a}`, condition: {}, actions: [{ type: "apply-filter", target: a, targetFilterPath: "Account", source: "Other" }] });
  const page = (extra) => verifyCtx({ pages: { main: { viewConfig: { items: [] }, businessRules: { count: 0, rules: [] }, ...extra } } }, "main");
  const allOn = { count: entityRow.vk.names.length, rules: entityRow.vk.names.map(ruleOn) };
  const fromObject = resolveRuleVk(entityRow.vk, page({ entityBusinessRules: allOn }));
  const onPageOnly = resolveRuleVk(entityRow.vk, page({ businessRules: { count: 1, rules: [ruleOn(attr)] } }));
  check("entity rules: the row closes from the object's rules read ✅, and saying so names the object",
    () => fromObject[2] === "ok" && /built entity rule.*on the object/.test(fromObject[1]), () => fromObject);
  const [firstAttr, ...restAttrs] = entityRow.vk.names;
  const partial = resolveRuleVk(entityRow.vk, page({ entityBusinessRules: { count: 1, rules: [ruleOn(firstAttr)] } }));
  check("entity rules: an object read holding only some expected attributes is ⚠, counted on the object and naming the attributes still owed",
    () => restAttrs.length > 0 && partial[2] === "unverified" && /1 rule\(s\) on the object/.test(partial[1])
      && restAttrs.every((a) => new RegExp(`missing:.*${a}`).test(partial[1])) && !/on the built page/.test(partial[1]),
    () => partial);
  const created = { ...su, targetPackage: "UsrSUApp (primary package of the new app; created by create-app)", createdApp: { primaryPackage: "UsrSUApp2" } };
  const createdRead = readPlan(runMigration(created, { baseDir: DIR }), checklistOpts(created)).reads.find((r) => r.kind === "entityBusinessRules");
  const noPkg = { ...su, targetPackage: undefined };
  const noPkgRead = readPlan(runMigration(noPkg, { baseDir: DIR }), checklistOpts(noPkg)).reads.find((r) => r.kind === "entityBusinessRules");
  check("entity rules: the read names the package create-app made over the planned note, and says `the run's target package` when the plan names none",
    () => /in `UsrSUApp2`/.test(createdRead?.what || "") && !/primary package/.test(createdRead?.what || "")
      && /in the run's target package/.test(noPkgRead?.what || ""),
    () => [createdRead?.what, noPkgRead?.what]);
  check("entity rules: without the object's read the row is NOT checkable and names `read-entity-business-rules` — a page rule on the same attribute never closes it",
    () => onPageOnly[2] === "unverified" && /read-entity-business-rules/.test(onPageOnly[1]) && /`SupportUnit`/.test(onPageOnly[1]),
    () => onPageOnly);

  // The read-back composes the file into the page's own slot, from the file the read plan names.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c2f-entity-rules-"));
  try {
    fs.mkdirSync(path.join(tmp, "reads"));
    const pageReads = plan.reads.filter((r) => r.pageKey === "main" && (r.kind === "pageMeta" || r.kind === "pageBundle"));
    fs.writeFileSync(path.join(tmp, "reads", "index.json"), JSON.stringify({ ...plan, reads: [...pageReads, entityRead] }));
    for (const r of pageReads) {
      fs.writeFileSync(path.join(tmp, r.file), JSON.stringify(r.kind === "pageMeta"
        ? { page: { schemaUId: "11111111-1111-4111-8111-111111111111", schemaName: "UsrSU_FormPage" }, packageName: "UsrSU" }
        : { name: "UsrSU_FormPage", viewConfig: [] }));
    }
    fs.writeFileSync(path.join(tmp, entityRead.file), JSON.stringify({ count: 1, rules: [ruleOn(attr)] }));
    const { built, problems } = assembleBuilt(tmp);
    check("entity rules: `--from` composes the entity-rules read into `pages.main.entityBusinessRules`",
      () => built?.pages?.main?.entityBusinessRules?.rules?.[0]?.name === `BusinessRule_${attr}`, () => ({ main: built?.pages?.main, problems }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
