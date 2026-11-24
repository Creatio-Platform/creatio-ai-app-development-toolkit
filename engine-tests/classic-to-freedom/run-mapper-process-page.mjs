// PRE-CONFIGURED PROCESS PAGES. A business process opens such a page as a step; the Classic template chain decides
// which button completes the step and which only closes the page, while in Freedom UI the process element decides it.
// These checks hold the profile end to end: detection from the seed chain, a plan with no section, list page or
// primary data source, the button mapping (page handler, process element `Buttons`, template default), the mapper's
// requests, and the `--verify` rows for the buttons, the way out, the re-pointed steps and the stand check.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleBuilt, PROCESS_FILE } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";
import { processTemplateOfManifest, processButtonsOf, processStepsIssues, PROCESS_BEHAVIOUR, PROCESS_TEMPLATES }
  from "../../skills/classic-to-freedom-migration/engine/process-page.mjs";

export function runProcessPageChecks({ check, runMigration, renderVerify, checklistOpts, CLEAN_SEED, FIX }) {
  const dir = path.join(FIX, "process-page");
  const body = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const PAGE = body("UsrDeliveryCheckPage.js");
  const SAVE = "Button-be6148b819154a0791eaee8f1635d859";
  const CANCEL = "Button-340d4888d1c244b4b1096eb51e8072f2";
  const processSeed = [...CLEAN_SEED, { pkg: "CrtUIPlatform7x", body: body("BasePageV2_skeleton.js") },
    { pkg: "CrtWizards7x", body: body("BasePageProcessTemplate.js") }, { pkg: "UsrCustom", body: body("BasePageProcessTemplate_custom.js") }];
  const STEP = { process: "UsrDeliveryProcess", element: "CheckDelivery", caption: "Check the delivery", consent: "approved" };
  const manifest = (extra = {}, page = PAGE) => ({
    entity: "", seed: processSeed, schemas: [{ pkg: "UsrDelivery", body: page }],
    entityColumns: { UsrOrderParam: { type: "Lookup", ref: "Order", title: "Order" } },
    resources: { SaveDataButtonCaption: "Save", CancelButtonCaption: "Cancel" },
    processPage: { stepsResolved: true, evidence: "the user named one process", steps: [STEP] }, ...extra,
  });
  const run = runMigration(manifest());
  const opts = checklistOpts(manifest());

  // AC 1 — detection reads the seed chain; an empty entitySchemaName alone is not a process page.
  check("process page: a seed chain that defines BasePageProcessTemplate is a process page, named after its own schema",
    () => run.processPage?.template === "BasePageProcessTemplate" && run.processPage.pageName === "UsrDeliveryCheckPage" && opts.processPage === true,
    () => run.processPage);
  check("process page: each of the four process templates is recognised; a define() of another name is not",
    () => PROCESS_TEMPLATES.every((t) => processTemplateOfManifest({ seed: [{ body: `define("${t}", [], function() { return {}; });` }] }) === t)
      && processTemplateOfManifest({ seed: [{ body: 'define("BasePageProcessTemplateStructure", [], function() {});' },
        { body: '// define("BasePageProcessTemplate", [], function() {});\ndefine("BasePageV2", [], function() {});' }] }) === null);
  // A seed given as files: the migration reads it through the manifest's base directory, and the plan options
  // computed afterwards for the same manifest give the same answer.
  const fileManifest = { ...manifest(), seed: [...CLEAN_SEED, { pkg: "CrtUIPlatform7x", file: "BasePageV2_skeleton.js" },
    { pkg: "CrtWizards7x", file: "BasePageProcessTemplate.js" }] };
  const fileRun = runMigration(fileManifest, { baseDir: dir });
  check("process page: a file-based seed is a process page in the run and in the plan options alike",
    () => fileRun.processPage?.template === "BasePageProcessTemplate" && checklistOpts(fileManifest).processPage === true
      && !/\(list page\)/.test(fileRun.plan) && fileRun.signalsMissing.length === 0,
    () => [fileRun.processPage?.template, checklistOpts(fileManifest).processPage]);
  const plain = runMigration({ entity: "", seed: CLEAN_SEED, schemas: [{ pkg: "P", body: 'define("UsrNoObjectPage",[],function(){return{entitySchemaName:"",diff:[]};});' }] });
  check("process page: a page with an empty entitySchemaName and no process template keeps the record-page plan (list page row, section signals)",
    () => plain.processPage === null && /\(list page\)/.test(plain.plan) && plain.signalsMissing.length > 0);

  // AC 2 — no list page, no mini page, no primary data source; page parameters keep their Classic names.
  check("process page: the plan has no list-page row, no section-schema FILL and no section signals to resolve",
    () => !/\(list page\)/.test(run.plan) && !run.planMetaMissing.includes("sectionSchema") && run.signalsMissing.length === 0
      && /\| UsrDeliveryCheckPage \(process page\) \|/.test(run.plan) && /not applicable — a process page has no section/.test(run.plan),
    () => run.plan.split("\n").filter((l) => /Main scope|list page|process page/.test(l)));
  check("process page: the Plan-vs-Done Pages group has no list-page row",
    () => !/List page →/.test(run.checklist) && /Form page →/.test(run.checklist), () => run.checklist.split("\n").filter((l) => /page →/.test(l)));
  check("process page: placement asks only for an editable target package — nothing hosts a process page",
    () => opts.placementKeys.join() === "targetPackageEditable" && run.placementBlockers.length === 1
      && run.placementBlockers[0].includes("placement.targetPackageEditable not resolved"),
    () => run.placementBlockers);
  check("process page: a field binds a page parameter under its Classic name, never a primary data source column",
    () => /\| Order \| Lookup \(Order\) \| page parameter UsrOrderParam \|/.test(run.plan) && !/PDS\.UsrOrderParam/.test(run.plan));

  // AC 3 — each Classic process button: its behaviour, where it was read and its Freedom mapping.
  check("process page: Save and the custom Cancel are planned with their Classic behaviour, the page handler as source, and their Freedom mapping",
    () => /\| Save \(`Button-be6148b819154a0791eaee8f1635d859`\) \| `SaveData` \| validates, saves the parameters, completes the step \| page handler \| the template's `SaveButton`; selected as completing in the process element, `validate: true` \|/.test(run.plan)
      && /\| Cancel \(`Button-340d4888d1c244b4b1096eb51e8072f2`\) \| `Cancel` \| completes the step WITHOUT saving; the tag is the result \| page handler \| `Button-340d4888d1c244b4b1096eb51e8072f2` with no `clicked` request; selected as completing in the process element, `validate: false` \|/.test(run.plan),
    () => run.plan.split("\n").filter((l) => l.includes("Button-")));
  check("process page: the Classic Close the page removed is not planned as a button",
    () => !run.processPage.buttons.some((b) => b.classic === "Button-3a8ac667899d4aa68021a07eb1c7c49c"));
  const actionItem = (tag) => ({ name: "UsrAction", itemType: 5, handlers: { click: "onProcessActionButtonClick" }, tag, caption: "Act" });
  const [byElement] = processButtonsOf([actionItem("Approve")], [{ buttons: [{ tag: "Approve", performClosePage: true, performSaveData: true }] }]);
  const [noSave] = processButtonsOf([actionItem("Reject")], [{ buttons: [{ tag: "Reject", performClosePage: true }] }]);
  const [closeDefault] = processButtonsOf([actionItem("ClosePage")], []);
  const [saveDefault] = processButtonsOf([actionItem("SaveData")], []);
  const [conflict] = processButtonsOf([actionItem("Approve")], [{ buttons: [{ tag: "Approve", performClosePage: true }] }, { buttons: [{ tag: "Approve", performClosePage: false }] }]);
  check("process page: onProcessActionButtonClick follows the element's Buttons — close+save completes with save, close alone completes without",
    () => byElement.behaviour === PROCESS_BEHAVIOUR.COMPLETE_SAVE && byElement.source === "element"
      && noSave.behaviour === PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE && noSave.source === "element");
  check("process page: with no element read, SaveData completes and every other tag only closes the page — marked as the template default",
    () => saveDefault.behaviour === PROCESS_BEHAVIOUR.COMPLETE_SAVE && closeDefault.behaviour === PROCESS_BEHAVIOUR.CLOSE_OPEN
      && closeDefault.source === "page-default" && saveDefault.source === "page-default");
  check("process page: steps whose Buttons entries differ for a tag keep one behaviour per step",
    () => conflict.source === "element-per-step" && conflict.perStep.map((p) => p.behaviour).join() === "complete-no-save,close-open");

  // The mapper: a process button gets no generated request handler.
  check("process page: the custom Cancel is built with no request and no `usr.` handler on the worklist",
    () => !(run.changeSet.requestHandlers || []).some((h) => h.element === CANCEL)
      && run.changeSet.tableElements.some((e) => e.classic === CANCEL && e.request === null && e.process === PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE),
    () => [run.changeSet.requestHandlers, run.changeSet.tableElements]);
  const closePage = PAGE.replace('"tag": "Cancel"', '"tag": "ClosePage"').replace('"bindTo": "onCancelProcessElementClick"', '"bindTo": "onProcessActionButtonClick"');
  const closeRun = runMigration(manifest({}, closePage));
  check("process page: a button that only closes the page is built with crt.ClosePageRequest",
    () => closeRun.changeSet.tableElements.some((e) => e.classic === CANCEL && e.request === "crt.ClosePageRequest" && e.process === PROCESS_BEHAVIOUR.CLOSE_OPEN),
    () => closeRun.changeSet.tableElements);

  // AC 6 — the steps that open the page are part of the plan.
  const unasked = runMigration(manifest({ processPage: undefined }));
  check("process page: a plan without the recorded process steps is incomplete and says what to ask",
    () => unasked.processPageBlockers.length === 1 && /PLAN INCOMPLETE — process steps not recorded/.test(unasked.plan)
      && /describe-business-process/.test(unasked.plan),
    () => unasked.processPageBlockers);
  check("process page: a step without its element is refused; an empty list the user gave is a valid answer",
    () => processStepsIssues({ processPage: { stepsResolved: true, steps: [{ process: "P" }] } }).length === 1
      && processStepsIssues({ processPage: { stepsResolved: true, steps: [] } }).length === 0);
  const steps = runMigration(manifest({ processPage: { stepsResolved: true, steps: [STEP,
    { process: "UsrReturnProcess", element: "CheckReturn", consent: "declined" }, { process: "UsrAuditProcess", element: "Audit", consent: "approved", resultBranches: true }] } }));
  check("process page: the plan lists each step with its re-point call — new version + activation, declined, manual for result branches",
    () => /\| `UsrDeliveryProcess` \| Check the delivery \(`CheckDelivery`\) \| re-point in a NEW process version, then activate it/.test(steps.plan)
      && /\| `UsrReturnProcess` \| CheckReturn \(`CheckReturn`\) \| not re-pointed \(declined\)/.test(steps.plan)
      && /\| `UsrAuditProcess` \| Audit \(`Audit`\) \| ⚠ manual — the process branches on this step's result/.test(steps.plan),
    () => steps.plan.split("\n").filter((l) => l.startsWith("| `Usr")));

  // AC 4, 5, 7 — the `--verify` rows.
  const viewConfig = (cancelRequest, withExit = true) => [
    { name: "SaveButton", type: "crt.Button", clicked: { request: "crt.SaveRecordRequest" } },
    { name: CANCEL, type: "crt.Button", ...(cancelRequest ? { clicked: { request: cancelRequest } } : {}) },
    ...(withExit ? [{ name: "BackButton", type: "crt.Button", clicked: { request: "crt.ClosePageRequest" } }] : []),
  ];
  const repointed = (cancelValidate = false) => [{ ...STEP, page: "UsrDeliveryCheck_FormPage", active: true,
    buttons: [{ name: "SaveButton", validate: true }, { name: CANCEL, validate: cancelValidate }] }];
  const pressed = { pressed: [{ button: "SaveButton", outcome: "completed" }, { button: CANCEL, outcome: "completed" }] };
  const built = (over = {}) => ({ pages: { main: { viewConfig: viewConfig(over.cancelRequest, over.withExit !== false) } },
    processSteps: over.processSteps ?? repointed(), ...(over.stand === false ? {} : { processStandCheck: over.stand || pressed }) });
  const rowOf = (md, label) => md.split("\n").find((l) => l.includes(label)) || "";
  const verify = (b) => renderVerify(run, opts, b).markdown;
  const good = verify(built());
  check("process page: a page built and re-pointed as planned and pressed on the stand closes every process row",
    () => ["[process button] Save", "[process button] Cancel", "keeps a completing button and an exit", "[process step] `UsrDeliveryProcess`", "Stand check"]
      .every((l) => /✅ Done/.test(rowOf(good, l))),
    () => good.split("\n").filter((l) => /process|Stand check/.test(l)));
  check("process page: crt.CancelRecordChangesRequest on a completing button is a valid candidate, not a failure",
    () => /✅ Done/.test(rowOf(verify(built({ cancelRequest: "crt.CancelRecordChangesRequest" })), "[process button] Cancel")));
  check("process page: a completing button the re-pointed step selects with the wrong validate is ❌",
    () => /❌ MISSING.*validate: true., Classic did not validate/.test(rowOf(verify(built({ processSteps: repointed(true) })), "[process button] Cancel")),
    () => rowOf(verify(built({ processSteps: repointed(true) })), "[process button] Cancel"));
  check("process page: a completing button the re-pointed step does not select is ❌",
    () => /❌ MISSING.*does not select it as completing/.test(rowOf(verify(built({ processSteps: [{ ...repointed()[0], buttons: [{ name: "SaveButton", validate: true }] }] })), "[process button] Cancel")));
  check("process page: a page with no button that closes it and leaves the step open is ❌",
    () => /❌ MISSING.*no visible button closes the page/.test(rowOf(verify(built({ withExit: false })), "keeps a completing button and an exit")));
  check("process page: an exit the re-pointed step selects as completing does not count as a way out",
    () => /❌ MISSING/.test(rowOf(verify(built({ processSteps: [{ ...repointed()[0], buttons: [...repointed()[0].buttons, { name: "BackButton", validate: false }] }] })),
      "keeps a completing button and an exit")));
  check("process page: without the stand check the page is built, not exercised — a row that keeps the run from COMPLETE",
    () => /⚠ verify.*built, not exercised/.test(rowOf(verify(built({ stand: false })), "Stand check")));
  check("process page: a declined step, and a step that branches on its result, stay open until a decision records the manual steps",
    () => { const md = renderVerify(steps, checklistOpts(manifest({ processPage: { stepsResolved: true, steps: [STEP,
        { process: "UsrReturnProcess", element: "CheckReturn", consent: "declined" }, { process: "UsrAuditProcess", element: "Audit", consent: "approved", resultBranches: true }] } })), built()).markdown;
      return /⚠ verify.*not re-pointed \(declined\)/.test(rowOf(md, "`UsrReturnProcess`")) && /⚠ verify.*manual — the process branches/.test(rowOf(md, "`UsrAuditProcess`")); });
  check("process page: a completing button that declares a request the process designer does not accept is ❌",
    () => /❌ MISSING.*does not accept on a completing button/.test(rowOf(verify(built({ cancelRequest: "usr.CustomRequest" })), "[process button] Cancel")));
  check("process page: a hidden exit is not a way out",
    () => { const b = built(); b.pages.main.viewConfig[2].visible = false;
      return /❌ MISSING.*no visible button closes the page/.test(rowOf(verify(b), "keeps a completing button and an exit")); });
  check("process page: a button pressed on the stand with an outcome other than Classic's is ❌, and a malformed record is ignored",
    () => /❌ MISSING.*should leave the step completed/.test(rowOf(verify(built({ stand: { pressed: [null, { button: "SaveButton", outcome: "completed" }, { button: CANCEL, outcome: "open" }] } })), "Stand check")));
  const noSteps = { processPage: { stepsResolved: true, evidence: "the user named none", steps: [] } };
  check("process page: when no process step is named, an open step row keeps the page from COMPLETE",
    () => /⚠ verify.*no process step names this page/.test(rowOf(renderVerify(runMigration(manifest(noSteps)), checklistOpts(manifest(noSteps)), built({ processSteps: [] })).markdown, "[process step] none named")));
  const tplManifest = manifest({ planMeta: { formTemplate: "PageWithTabsFreedomTemplate" } });
  const tplVerify = renderVerify(runMigration(tplManifest), checklistOpts(tplManifest), { ...built(), pages: { main: { parentSchemaName: "PageWithTabsFreedomTemplate", modelConfig: {},
    viewConfig: [...viewConfig(), { name: "Order", type: "crt.ComboBox", control: "$UsrOrderParam" }] } } }).markdown;
  check("process page: verify does not demand a primary data source from a page that binds page parameters",
    () => { const row = rowOf(tplVerify, "Form template →"); return row !== "" && !/❌|primaryDataSourceName/.test(row); }, () => rowOf(tplVerify, "Form template →"));
  const hiddenCancel = PAGE.replace('"click": { "bindTo": "onCancelProcessElementClick" },', '"click": { "bindTo": "onCancelProcessElementClick" },\n\t\t\t\t\t"visible": false,');
  const hiddenRun = runMigration(manifest({}, hiddenCancel));
  check("process page: a process button hidden by default is still planned and gets no generated handler",
    () => hiddenCancel !== PAGE && hiddenRun.processPage.buttons.some((b) => b.classic === CANCEL)
      && !(hiddenRun.changeSet.requestHandlers || []).some((h) => h.element === CANCEL), () => hiddenRun.processPage.buttons);
  check("process page: the template's save button is found by its SaveData tag, not only by its element id",
    () => processButtonsOf([{ name: "Button-renamed", itemType: 5, templateOwned: true, tag: "SaveData", handlers: { click: "onProcessActionButtonClick" } }])[0]?.freedom === "SaveButton");
  check("process page: the Freedom template's own Back/Close, as get-page returns them (visibility bound to page state), count as the way out",
    () => /✅ Done/.test(rowOf(verify({ ...built(), pages: { main: { viewConfig: [...viewConfig(undefined, false),
      { name: "CloseButton", type: "crt.Button", clicked: { request: "crt.ClosePageRequest" }, visible: "$HasUnsavedData | crt.InvertBooleanValue" }] } } }), "keeps a completing button and an exit")));
  check("process page: without a recorded answer the plan options read the inline seed bodies",
    () => checklistOpts(structuredClone(manifest())).processPage === true && checklistOpts(structuredClone({ ...manifest(), seed: CLEAN_SEED })).processPage === false);
  check("process page: the Classic template's save button maps onto the Freedom template's SaveButton — no element, no handler",
    () => run.processPage.buttons.find((b) => b.classic === SAVE)?.freedom === "SaveButton"
      && !(run.changeSet.requestHandlers || []).some((h) => h.element === SAVE) && !run.changeSet.tableElements.some((e) => e.classic === SAVE));
  const onlyClose = closePage.replace('"operation": "merge",\n\t\t\t\t"name": "Button-be6148b819154a0791eaee8f1635d859"', '"operation": "remove",\n\t\t\t\t"name": "Button-be6148b819154a0791eaee8f1635d859"');
  const onlyCloseRun = runMigration(manifest({}, onlyClose));
  check("process page: a page whose buttons only close it has no completing button — the way-out row is ❌",
    () => onlyClose !== closePage && onlyCloseRun.processPage.completing === 0
      && /❌ MISSING.*no Classic button completes the step/.test(rowOf(renderVerify(onlyCloseRun, checklistOpts(manifest({}, onlyClose)), built()).markdown, "keeps a completing button and an exit")),
    () => onlyCloseRun.processPage.buttons);
  const ownHandler = onlyClose.replace('"bindTo": "onProcessActionButtonClick"', '"bindTo": "onUsrOwnClick"');
  const ownRun = runMigration(manifest({}, ownHandler));
  check("process page: a customer handler among the process buttons is planned as a ⚠ decision, keeps its ported handler, and its verify row stays open",
    () => { const b = ownRun.processPage.buttons.find((x) => x.classic === CANCEL);
      return b?.behaviour === PROCESS_BEHAVIOUR.UNKNOWN && b.source === "custom-handler" && /⚠ a customer handler the profile cannot read/.test(ownRun.plan)
        && (ownRun.changeSet.requestHandlers || []).some((h) => h.element === CANCEL)
        && /⚠ verify.*customer handler the profile cannot read/.test(rowOf(renderVerify(ownRun, checklistOpts(manifest({}, ownHandler)), built()).markdown, "[process button]")); },
    () => ownRun.processPage.buttons);
  const apiCaller = PAGE.replace('"parentName": "ProcessActionButtons"', '"parentName": "Header"')
    .replace('"bindTo": "onCancelProcessElementClick"', '"bindTo": "onUsrCancelClick"')
    .replace('methods: {},', 'methods: { onUsrCancelClick: function() { this.cancelProcessElement(this.get("Tag")); } },');
  check("process page: a button outside the process buttons whose handler calls the template's process API is a ⚠ decision too",
    () => apiCaller.includes("onUsrCancelClick: function") && runMigration(manifest({}, apiCaller)).processPage.buttons.some((b) => b.classic === CANCEL && b.source === "custom-handler"));
  const noButtons = runMigration(manifest({}, ownHandler.replace('"parentName": "ProcessActionButtons"', '"parentName": "Header"')));
  check("process page: a page with no process button left says so in the plan",
    () => noButtons.processPage.buttons.length === 0 && /⚠ the page has no process button left/.test(noButtons.plan), () => noButtons.processPage.buttons);
  // Two processes open the page and treat the same tag differently: each re-pointed step is held to its own element.
  const twoSteps = { processPage: { stepsResolved: true, steps: [
    { ...STEP, buttons: [{ tag: "ClosePage", performClosePage: true, performSaveData: true }] },
    { process: "UsrReturnProcess", element: "CheckReturn", consent: "approved", buttons: [{ tag: "ClosePage", performClosePage: true }] }] } };
  const twoRun = runMigration(manifest(twoSteps, closePage));
  const twoBuilt = (validates) => ({ pages: { main: { viewConfig: [{ name: "SaveButton", type: "crt.Button", clicked: { request: "crt.SaveRecordRequest" } },
    { name: CANCEL, type: "crt.Button", clicked: { request: "crt.ClosePageRequest" } }, { name: "BackButton", type: "crt.Button", clicked: { request: "crt.ClosePageRequest" } }] } },
    processSteps: [{ ...STEP, page: "P", active: true, buttons: [{ name: "SaveButton", validate: true }, { name: CANCEL, validate: validates[0] }] },
      { process: "UsrReturnProcess", element: "CheckReturn", page: "P", active: true, buttons: [{ name: "SaveButton", validate: true }, { name: CANCEL, validate: validates[1] }] }] });
  const twoRow = (v) => rowOf(renderVerify(twoRun, checklistOpts(manifest(twoSteps, closePage)), twoBuilt(v)).markdown, "[process button] Cancel");
  check("process page: two steps re-pointed each with its own validate both pass; holding both to one validate is ❌",
    () => /✅ Done/.test(twoRow([true, false])) && /❌ MISSING.*UsrReturnProcess.*validate: true/.test(twoRow([true, true])),
    () => [twoRow([true, false]), twoRow([true, true])]);

  // `--verify --from` composes the payload from the migration folder: the process side comes from process.json.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "process-page-"));
  try {
    fs.mkdirSync(path.join(folder, "reads"));
    fs.writeFileSync(path.join(folder, "reads", "index.json"), JSON.stringify({ reads: [] }));
    fs.writeFileSync(path.join(folder, PROCESS_FILE), JSON.stringify({ processSteps: repointed(), processStandCheck: pressed }));
    const composed = assembleBuilt(folder).built;
    check("process page: the composed --from payload carries the process steps and the stand check from process.json",
      () => composed.processSteps?.[0]?.element === "CheckDelivery" && composed.processStandCheck?.pressed?.length === 2, () => composed);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  check("process page: a re-pointed step whose new version is not active is not done",
    () => /⚠ verify.*not active/.test(rowOf(verify(built({ processSteps: [{ ...repointed()[0], active: false }] })), "[process step]")));
}
