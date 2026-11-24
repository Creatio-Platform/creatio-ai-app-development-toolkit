// The Classic PRE-CONFIGURED PROCESS PAGE profile.
//
// A business process opens such a page as one of its steps and waits for the user. The page has no object of its own
// (`entitySchemaName: ""`): its fields bind to PAGE PARAMETERS the process element fills and reads back, and its
// buttons end the step or leave it open. The Classic template chain (`BasePageProcessTemplate` and the three templates
// built on it) decides what a button does:
//
//   - `onSaveButtonClick` validates and saves the parameters, then completes the step;
//   - `onCancelProcessElementClick` completes the step WITHOUT saving, the button tag becoming the step's result;
//   - `onProcessActionButtonClick` reads the process element's `Buttons` parameter for the button's tag: with
//     `PerformClosePage` it completes the step (saving first when `PerformSaveData` is also set); without it the page
//     only closes and the step keeps waiting. With no entry for the tag, `SaveData` saves and completes, every other
//     tag (`ClosePage` included) only closes the page.
//
// In Freedom UI the page code does not decide this. The Pre-configured page process element names the buttons that
// complete the step, and the runtime appends `crt.CompleteProcessElementRequest` to exactly those buttons — after the
// button's own requests, with the element's `validate` flag. So the migration maps each Classic button to a Freedom
// button and states how the element must select it; the element itself is re-pointed to the Freedom page as a
// separate, consented step of the process.
//
// Pure functions: no I/O. `migrate.mjs` supplies the parsed layers and the merged items.

import { parseDefineModule, resourceKey } from "./engine.mjs";

export const PROCESS_TEMPLATES = Object.freeze(["BasePageProcessTemplate", "BasePageSimpleProcessTemplate",
  "BasePageLeftContainerProcessTemplate", "BasePageRightContainerProcessTemplate"]);

// What a Classic process button does to the step.
export const PROCESS_BEHAVIOUR = Object.freeze({
  COMPLETE_SAVE: "complete-save",       // validate, save the parameters, complete the step
  COMPLETE_NO_SAVE: "complete-no-save", // complete the step without saving; the tag is the result
  CLOSE_OPEN: "close-open",             // close the page; the step keeps waiting
});
const PROCESS_HANDLERS = new Set(["onSaveButtonClick", "onCancelProcessElementClick", "onProcessActionButtonClick"]);
// The requests the process designer accepts on a completing button, besides declaring none.
const COMPLETING_REQUESTS = Object.freeze(["crt.SaveRecordRequest", "crt.ClosePageRequest", "crt.CancelRecordChangesRequest"]);
export const CLOSE_PAGE_REQUEST = "crt.ClosePageRequest";
// The Freedom form templates' own save button: the runtime shows it on every page opened from a process step.
const FREEDOM_SAVE_BUTTON = "SaveButton";
// The Classic template's own save button (alias `SaveButton`): it maps onto the Freedom template's save button.
const CLASSIC_TEMPLATE_SAVE_BUTTON = "Button-be6148b819154a0791eaee8f1635d859";

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// The process template a page's seed chain defines, or null. `names` are the seed layers' define() names. An empty
// `entitySchemaName` is not evidence on its own: hundreds of Classic pages with no object are not process pages.
export const processTemplateOf = (names) => (names || []).find((n) => PROCESS_TEMPLATES.includes(n)) || null;

// One answer per manifest: `runMigration` records what it read off the parsed seed, and every later caller
// (`checklistOpts` on the same manifest) reads that answer instead of deciding again. A caller that never ran the
// migration reads the inline seed bodies' define() names.
const TEMPLATE_BY_MANIFEST = new WeakMap();
export function recordProcessTemplate(manifest, template) {
  if (manifest && typeof manifest === "object") TEMPLATE_BY_MANIFEST.set(manifest, template);
}
export function processTemplateOfManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  if (TEMPLATE_BY_MANIFEST.has(manifest)) return TEMPLATE_BY_MANIFEST.get(manifest);
  const seed = Array.isArray(manifest.seed) ? manifest.seed : [];
  return processTemplateOf(seed.map((e) => (e && typeof e.body === "string" ? parseDefineModule(e.body).name : null)));
}

// `manifest.processPage` — what the discovery step recorded about the process steps that open this page:
//   { stepsResolved: true, evidence, steps: [{ process, element, caption?, buttons?: [{ tag, performClosePage,
//     performSaveData }], resultBranches: bool, consent: "approved" | "declined" | "pending" }] }
// `stepsResolved: true` with `steps: []` is a valid answer ("the user named no process"); never asked is not.
function processStepsOf(manifest) {
  const pp = plainObject(manifest?.processPage);
  const steps = (Array.isArray(pp.steps) ? pp.steps : []).filter((s) => s && typeof s === "object").map((s) => ({
    process: isStr(s.process) ? s.process : null,
    element: isStr(s.element) ? s.element : null,
    caption: isStr(s.caption) ? s.caption : null,
    buttons: Array.isArray(s.buttons) ? s.buttons.filter((b) => b && isStr(b.tag)) : null,
    resultBranches: s.resultBranches === true,
    consent: ["approved", "declined"].includes(s.consent) ? s.consent : "pending",
  }));
  return { resolved: pp.stepsResolved === true, evidence: isStr(pp.evidence) ? pp.evidence : null, steps };
}
function stepsIssuesOf({ resolved, steps }) {
  if (!resolved)
    return ["processPage.stepsResolved not recorded — ask the user which business processes and which of their steps open this page, record them in manifest.processPage.steps (an empty list when they name none) with stepsResolved: true"];
  return steps.filter((s) => !s.process || !s.element)
    .map((s) => `processPage.steps entry ${JSON.stringify(s.caption || s.process || s.element || "?")} names no ${s.process ? "element" : "process"} — record both the process code and the Pre-configured page element name`);
}
export const processStepsIssues = (manifest) => stepsIssuesOf(processStepsOf(manifest));

// The `Buttons` entry the process element declares for a tag, read across every recorded step. Steps that disagree
// are reported, the first declared entry is used.
function elementButtonConfig(steps, tag) {
  const found = steps.map((s) => (s.buttons || []).find((b) => b.tag === tag)).filter(Boolean);
  if (!found.length) return { config: null, conflict: false };
  const same = (a, b) => !!a.performClosePage === !!b.performClosePage && !!a.performSaveData === !!b.performSaveData;
  return { config: found[0], conflict: found.some((b) => !same(b, found[0])) };
}
function behaviourOf(handler, tag, steps) {
  if (handler === "onSaveButtonClick") return { behaviour: PROCESS_BEHAVIOUR.COMPLETE_SAVE, source: "page" };
  if (handler === "onCancelProcessElementClick") return { behaviour: PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE, source: "page" };
  const { config, conflict } = elementButtonConfig(steps, tag);
  if (config) {
    let behaviour = PROCESS_BEHAVIOUR.CLOSE_OPEN;
    if (config.performClosePage === true) behaviour = config.performSaveData === true ? PROCESS_BEHAVIOUR.COMPLETE_SAVE : PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE;
    return { behaviour, source: conflict ? "element-conflict" : "element" };
  }
  return { behaviour: tag === "SaveData" ? PROCESS_BEHAVIOUR.COMPLETE_SAVE : PROCESS_BEHAVIOUR.CLOSE_OPEN, source: "page-default" };
}

// The Freedom element a Classic process button becomes: the template save button for the Classic template's save
// button, otherwise the button itself under its Classic name.
const freedomNameOf = (item) => (item.name === CLASSIC_TEMPLATE_SAVE_BUTTON ? FREEDOM_SAVE_BUTTON : item.name);

// The page's live process buttons (the merged items; a removed button is gone), each with its Classic behaviour,
// where that behaviour was read, and the Freedom button it maps to.
export function processButtonsOf(items, steps = [], resources = {}) {
  const captionOf = (raw) => (raw && typeof resources[resourceKey(raw)] === "string" && resources[resourceKey(raw)]) || raw || null;
  return (items || [])
    .filter((i) => i && i.itemType === 5 && PROCESS_HANDLERS.has(i.handlers?.click) && !i.engineOnlyStub && i.visible !== false)
    .map((i) => ({ classic: i.name, freedom: freedomNameOf(i), caption: captionOf(i.caption), tag: i.tag || null,
      ...behaviourOf(i.handlers.click, i.tag || null, steps) }));
}

// The whole profile, or null for any other page.
export function processPageInfo({ template, pageName, items, manifest }) {
  if (!template) return null;
  const stepFacts = processStepsOf(manifest);
  const buttons = processButtonsOf(items, stepFacts.steps, plainObject(manifest?.resources));
  return {
    template, pageName: pageName || null,
    // the page parameters its fields bind to (the bound names of the page's own fields)
    parameters: [...new Set((items || []).filter((i) => i.bindTo && !i.templateOwned).map((i) => i.bindTo))],
    buttons,
    completing: buttons.filter((b) => b.behaviour !== PROCESS_BEHAVIOUR.CLOSE_OPEN).length,
    stepsResolved: stepFacts.resolved, evidence: stepFacts.evidence, steps: stepFacts.steps,
    issues: stepsIssuesOf(stepFacts),
  };
}

// The mapper's view: Classic button name → its behaviour, so a process button gets no generated request handler.
export function processButtonMap(info) {
  return new Map((info?.buttons || []).map((b) => [b.classic, b.behaviour]));
}

const BEHAVIOUR_TEXT = {
  [PROCESS_BEHAVIOUR.COMPLETE_SAVE]: "validates, saves the parameters, completes the step",
  [PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE]: "completes the step WITHOUT saving; the tag is the result",
  [PROCESS_BEHAVIOUR.CLOSE_OPEN]: "closes the page; the step keeps waiting",
};
const SOURCE_TEXT = {
  page: "page handler",
  element: "process element `Buttons`",
  "element-conflict": "⚠ process element `Buttons` — the steps disagree, the first is used",
  "page-default": "⚠ template default — the process element was not read",
};
const behaviourText = (b) => BEHAVIOUR_TEXT[b] || b;
const buttonSourceText = (s) => SOURCE_TEXT[s] || s;
const expectedValidate = (behaviour) => behaviour === PROCESS_BEHAVIOUR.COMPLETE_SAVE;
function freedomMappingText(b) {
  if (b.behaviour === PROCESS_BEHAVIOUR.CLOSE_OPEN)
    return `\`${b.freedom}\` with \`${CLOSE_PAGE_REQUEST}\`; NOT selected as completing in the process element`;
  const validate = b.behaviour === PROCESS_BEHAVIOUR.COMPLETE_SAVE ? "true" : "false";
  const shape = b.freedom === FREEDOM_SAVE_BUTTON ? "the template's `SaveButton`" : `\`${b.freedom}\` with no \`clicked\` request`;
  return `${shape}; selected as completing in the process element, \`validate: ${validate}\``;
}
// A step's re-point verdict for the plan: what the build does with it.
function stepCall(s) {
  if (s.resultBranches) return "⚠ manual — the process branches on this step's result; the result gives the steps to map each Classic tag to its Freedom button";
  if (s.consent === "approved") return "re-point in a NEW process version, then activate it (rollback: activate the previous version)";
  if (s.consent === "declined") return "not re-pointed (declined) — the result gives the manual steps";
  return "⚠ awaiting the user's consent";
}

// The plan's `### Process page` section: the buttons, their Classic behaviour and Freedom mapping, the rule that
// keeps a way out, and the process steps the page must be re-pointed in.
export function processPagePlanLines(info, esc) {
  if (!info) return [];
  const L = ["### Process page",
    `\`${esc(info.pageName || "?")}\` extends \`${esc(info.template)}\`: a business process opens it as a step and waits. It has no object, no list page and no add mini page; its fields bind to page parameters, kept under their Classic names because the process maps them${info.parameters.length ? ` (${info.parameters.map((p) => "`" + esc(p) + "`").join(", ")})` : ""}.`,
    "",
    "#### Process buttons",
    "| Classic button | Tag | Classic behaviour | Read from | Freedom |",
    "| --- | --- | --- | --- | --- |",
    ...info.buttons.map((b) => `| ${esc(b.caption || b.classic)} (\`${esc(b.classic)}\`) | ${b.tag ? "`" + esc(b.tag) + "`" : "—"} | ${behaviourText(b.behaviour)} | ${buttonSourceText(b.source)} | ${freedomMappingText(b)} |`),
  ];
  if (!info.buttons.length) L.push("| — | — | ⚠ the page has no process button left | — | add a completing button: a step nothing completes waits forever |");
  L.push("", `The built page keeps at least one completing button and one exit that leaves the step open (the template's \`BackButton\` / \`CloseButton\` with \`${CLOSE_PAGE_REQUEST}\`), even where the Classic page removed its own Close.`, "");
  L.push("#### Process steps to re-point");
  if (!info.stepsResolved) L.push("- ⚠ not recorded — ask the user which processes and steps open this page (see the ⛔ banner)", "");
  else if (!info.steps.length) L.push(`- none named by the user${info.evidence ? ` (${esc(info.evidence)})` : ""} — the result gives the manual re-pointing steps`, "");
  else {
    L.push("One consent covers the listed steps; the user may untick any of them.", "", "| Process | Step | Re-point |", "| --- | --- | --- |",
      ...info.steps.map((s) => `| \`${esc(s.process || "?")}\` | ${esc(s.caption || s.element || "?")} (\`${esc(s.element || "?")}\`) | ${stepCall(s)} |`), "");
  }
  return L;
}

// ---- the plan-vs-built rows -----------------------------------------------------------------------------------
// `--built.processSteps` is what `describe-business-process` returned for each re-pointed step, one entry per step:
//   { process, element, page, active, buttons: [{ name, validate }] }   (`buttons` = the element's completing buttons)
// `--built.processStandCheck` records the stand check: { pressed: [{ button, outcome: "completed" | "open" }] }.

export function processPageRows(info, esc) {
  if (!info) return [];
  const buttonRows = info.buttons.map((b) => ({ deliverableId: `process-button:${b.classic}`,
    label: `[process button] ${esc(b.caption || b.classic)} — ${behaviourText(b.behaviour)} → \`${esc(b.freedom)}\``,
    vk: { type: "processbutton", freedom: b.freedom, behaviour: b.behaviour } }));
  const stepRows = info.steps.map((s) => ({ deliverableId: `process-step:${s.process}:${s.element}`,
    label: `[process step] \`${esc(s.process || "?")}\` / \`${esc(s.element || "?")}\` — re-point the Pre-configured page element to the Freedom page`,
    vk: { type: "processstep", process: s.process, element: s.element, consent: s.consent, resultBranches: s.resultBranches } }));
  return [...buttonRows,
    { deliverableId: "process-exit", label: "The page keeps a completing button and an exit that leaves the process step open",
      vk: { type: "processexit", completing: info.completing } },
    ...stepRows,
    { deliverableId: "process-stand-check", label: "Stand check: open the page from its process step and press each button",
      vk: { type: "processstand", buttons: info.buttons.map((b) => ({ freedom: b.freedom, behaviour: b.behaviour })) } }];
}

const MISSING = "❌ MISSING", VERIFY = "⚠ verify", DONE = "✅ Done";
const builtSteps = (ctx) => (Array.isArray(ctx.root?.processSteps) ? ctx.root.processSteps.filter((s) => s && typeof s === "object") : []);
const selectedIn = (step, name) => (Array.isArray(step.buttons) ? step.buttons : []).find((b) => b && b.name === name) || null;
const buttonOps = (ctx) => (ctx.ops || []).filter((o) => o && typeof o.name === "string");
// The walked op list carries each node's request flat (designspec `pushWalkNode`).
const requestOf = (o) => (typeof o.request === "string" ? o.request : null);
// `absentEntry` is designspec's answer for a page nobody fetched, so these rows block like every other one.
function pageUnreadable(ctx, what, absentEntry) {
  if (ctx.entryAbsent) return absentEntry(ctx, what);
  if (ctx.page === false) return [MISSING, "the page is reported as NOT BUILT", "missing"];
  return null;
}

// One process button: on the page with the right request, and selected in every re-pointed step as the plan says.
function resolveProcessButtonVk(vk, ctx, absentEntry) {
  const unreadable = pageUnreadable(ctx, `\`${vk.freedom}\``, absentEntry);
  if (unreadable) return unreadable;
  const op = buttonOps(ctx).find((o) => o.name === vk.freedom);
  if (!op) return [MISSING, `button \`${vk.freedom}\` is not on the built page`, "missing"];
  const request = requestOf(op);
  const closes = vk.behaviour === PROCESS_BEHAVIOUR.CLOSE_OPEN;
  if (closes && request !== CLOSE_PAGE_REQUEST)
    return [VERIFY, `\`${vk.freedom}\` must close the page with \`${CLOSE_PAGE_REQUEST}\` (it declares ${request ? `\`${request}\`` : "no request"})`, "unverified"];
  if (!closes && request && !COMPLETING_REQUESTS.includes(request))
    return [VERIFY, `\`${vk.freedom}\` declares \`${request}\`, which the process designer does not accept on a completing button — declare no request`, "unverified"];
  const steps = builtSteps(ctx);
  const wrong = steps.flatMap((s) => {
    const sel = selectedIn(s, vk.freedom);
    const where = `\`${s.process}\` / \`${s.element}\``;
    if (closes) return sel ? [`${where} selects it as completing — the step would end where Classic kept it open`] : [];
    if (!sel) return [`${where} does not select it as completing — the step never ends from this button`];
    return sel.validate === expectedValidate(vk.behaviour) ? [] : [`${where} selects it with \`validate: ${sel.validate}\`, Classic ${expectedValidate(vk.behaviour) ? "validated" : "did not validate"}`];
  });
  if (wrong.length) return [MISSING, wrong.join("; "), "missing"];
  const stepNote = steps.length ? `, selected as the plan says in ${steps.length} re-pointed step(s)` : "";
  return [DONE, `\`${vk.freedom}\` on the page${request ? ` with \`${request}\`` : " with no request"}${stepNote}`, "ok"];
}
// The way out: a completing button, and a button that closes the page without any re-pointed step selecting it.
function resolveProcessExitVk(vk, ctx, absentEntry) {
  if (!vk.completing) return [MISSING, "no Classic button completes the step — add a completing button, or the step waits forever", "missing"];
  const unreadable = pageUnreadable(ctx, "the exit button", absentEntry);
  if (unreadable) return unreadable;
  const steps = builtSteps(ctx);
  const exits = buttonOps(ctx).filter((o) => requestOf(o) === CLOSE_PAGE_REQUEST && o.visible !== false
    && !steps.some((s) => selectedIn(s, o.name)));
  if (!exits.length) return [MISSING, `no visible button closes the page with \`${CLOSE_PAGE_REQUEST}\` while leaving the step open — keep the template's BackButton or CloseButton`, "missing"];
  return [DONE, `exit: ${exits.map((o) => "`" + o.name + "`").join(", ")}`, "ok"];
}
// One process step: re-pointed to the Freedom page in an active version, or left to the user with manual steps.
function resolveProcessStepVk(vk, ctx) {
  if (vk.resultBranches) return [VERIFY, "manual — the process branches on this step's result: map each Classic tag to its Freedom button by hand, then record a decision (`--decide D<N>`)", "unverified"];
  if (vk.consent !== "approved") return [VERIFY, `not re-pointed (${vk.consent === "declined" ? "declined" : "no consent"}) — the page cannot complete the step until the user re-points it; record a decision (\`--decide D<N>\`) once the manual steps are handed over`, "unverified"];
  const step = builtSteps(ctx).find((s) => s.process === vk.process && s.element === vk.element);
  if (!step) return [VERIFY, "pass `describe-business-process` of the re-pointed step as `--built.processSteps` to check it", "unverified"];
  if (typeof step.page !== "string" || !step.page) return [MISSING, "the step names no Freedom page", "missing"];
  if (step.active === false) return [VERIFY, `re-pointed to \`${step.page}\` in a version that is not active — activate it`, "unverified"];
  return [DONE, `re-pointed to \`${step.page}\` in the active version`, "ok"];
}
// The stand check: every button pressed from the process step, with the outcome Classic had.
function resolveProcessStandVk(vk, ctx) {
  const pressed = Array.isArray(ctx.root?.processStandCheck?.pressed) ? ctx.root.processStandCheck.pressed : [];
  const expected = (b) => (b.behaviour === PROCESS_BEHAVIOUR.CLOSE_OPEN ? "open" : "completed");
  const notPressed = vk.buttons.filter((b) => !pressed.some((p) => p?.button === b.freedom));
  if (notPressed.length) return [VERIFY, `built, not exercised — open the page from its process step and press ${notPressed.map((b) => "`" + b.freedom + "`").join(", ")}; record each outcome in \`--built.processStandCheck\``, "unverified"];
  const wrong = vk.buttons.filter((b) => pressed.find((p) => p.button === b.freedom).outcome !== expected(b));
  if (wrong.length) return [MISSING, wrong.map((b) => `\`${b.freedom}\` should leave the step ${expected(b)}`).join("; "), "missing"];
  return [DONE, `${vk.buttons.length} button(s) pressed from the process step, each with its Classic outcome`, "ok"];
}
// `[type, (vk, ctx, absentEntry) => verdict]` — designspec registers them and hands in its `absentEntry`.
export const PROCESS_VK_RESOLVERS = Object.freeze([["processbutton", resolveProcessButtonVk], ["processexit", resolveProcessExitVk],
  ["processstep", resolveProcessStepVk], ["processstand", resolveProcessStandVk]]);
