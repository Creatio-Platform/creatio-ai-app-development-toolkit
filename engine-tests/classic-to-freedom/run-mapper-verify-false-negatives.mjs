// VERIFY ROWS THAT MUST NOT STAY OPEN ON A CORRECT BUILD. Three shapes a finished run can carry while its pages are
// right: a target package planned as a name with a note, a caption kept under the key its element is built with,
// and a business rule the user accepted mid-build as built another way. Each is checked through the engine's
// public entry points; the run-level plan version is checked where the answer could otherwise move it. Imported
// and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import { packageNameOf } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { closedRuleAttributes } from "../../skills/classic-to-freedom-migration/engine/directives.mjs";

export function runVerifyFalseNegativeChecks({ check, runMigration, checklistOpts, checklistGroups, renderVerify, resolveVk,
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
  const related = (packageName) => resolveVk({ type: "relatedpage", entity: "Item", evidence: "relatedPage:Item", package: NOTED,
    childKey: "child:Item" }, verifyCtx({ pages: { main: { viewConfig: { items: [] } },
    "child:Item": { schemaName: "UsrOrdersApp_ItemPage", viewConfig: { items: [] } } },
  reachability: { "relatedPage:Item": addon(packageName) } }, "main"));
  check("related page: an add-on read from the package the noted plan names is matched on its pages, not reported as read from the wrong package",
    () => !/plan targets/.test(related("UsrOrdersApp")[1]) && /plan targets `UsrOrdersApp`/.test(related("UsrOther")[1]),
    () => [related("UsrOrdersApp"), related("UsrOther")]);

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
}

// A caption the plan keys one way and the page keeps under the key its element is built with is a built caption.
export function runCaptionKeyChecks({ check, runMigration, checklistOpts, renderVerify, coTextsManifest, FIX }) {
  const m = coTextsManifest();
  const run = runMigration(m, { baseDir: FIX });
  const strings = JSON.parse(JSON.stringify(run.changeSet.resourceCultures));
  const rowWith = (s) => renderVerify(run, checklistOpts(m), { pages: { main: { viewConfig: [{ name: "X", type: "crt.Input" }],
    resources: { strings: s } } } }).markdown.split("\n").find((l) => l.includes("Form page")) || "";
  const renamed = Object.fromEntries(Object.entries(strings).map(([k, v]) => [`${k}Renamed_title`, v]));
  check("texts (renamed keys): every caption kept under another key with the same text in each culture closes the row",
    () => Object.keys(strings).length > 0 && rowWith(renamed).includes("✅"), () => rowWith(renamed));
  const [first] = Object.keys(strings);
  const changed = { ...renamed, [`${first}Renamed_title`]: Object.fromEntries(Object.keys(strings[first]).map((c) => [c, "Something else"])) };
  check("texts (renamed keys): a caption no key carries stays open and names the plan's key; the same key with other words is still ❌",
    () => rowWith(changed).includes("⚠") && rowWith(changed).includes(`no text in ˋ${first}ˋ`)
      && rowWith({ ...strings, [first]: changed[`${first}Renamed_title`] }).includes("MISSING"),
    () => [rowWith(changed)]);
}
