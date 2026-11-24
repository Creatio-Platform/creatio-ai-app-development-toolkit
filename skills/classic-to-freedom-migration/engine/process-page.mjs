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

// What a Classic process button does to the step. UNKNOWN: a button the template does not route (a customer handler
// that may end the step) — the plan asks for a decision instead of guessing.
export const PROCESS_BEHAVIOUR = Object.freeze({
  COMPLETE_SAVE: "complete-save",       // validate, save the parameters, complete the step
  COMPLETE_NO_SAVE: "complete-no-save", // complete the step without saving; the tag is the result
  CLOSE_OPEN: "close-open",             // close the page; the step keeps waiting
  UNKNOWN: "unknown",
});
const PROCESS_HANDLERS = new Set(["onSaveButtonClick", "onCancelProcessElementClick", "onProcessActionButtonClick"]);
// The template's process API: a customer click handler that calls one of these may end the step.
const PROCESS_API = ["cancelProcessElement", "completeExecution", "acceptProcessElement", "completeProcessElementWithVerification",
  "onProcessActionButtonClick", "onCancelProcessElementClick", "onSaveButtonClick"];
const PROCESS_BUTTONS_CONTAINER = "ProcessActionButtons";
// The requests the process designer accepts on a completing button, besides declaring none.
const COMPLETING_REQUESTS = Object.freeze(["crt.SaveRecordRequest", "crt.ClosePageRequest", "crt.CancelRecordChangesRequest"]);
export const CLOSE_PAGE_REQUEST = "crt.ClosePageRequest";
// The Freedom form templates' own save button: the runtime shows it on every page opened from a process step.
const FREEDOM_SAVE_BUTTON = "SaveButton";
// The Classic template's own save button: template-owned with the `SaveData` tag; its element id is the fallback.
const CLASSIC_TEMPLATE_SAVE_BUTTON = "Button-be6148b819154a0791eaee8f1635d859";

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const code = (s) => "`" + s + "`";

// The process template a page's seed chain defines, or null. `names` are the seed layers' define() names. An empty
// `entitySchemaName` is not evidence on its own: hundreds of Classic pages with no object are not process pages.
export const processTemplateOf = (names) => (names || []).find((n) => PROCESS_TEMPLATES.includes(n)) || null;

// One answer per manifest: `runMigration` records what it read off the parsed seed, and every later caller
// (`checklistOpts` on the same manifest) reads that answer. Without a recorded answer the inline seed bodies are read
// — the shape every real manifest has (`migrate.mjs` `readSchemaBody`). A `file` entry, which only test fixtures use,
// is read by `runMigration` against its base directory; this reader has none, so such a layer names no template.
const TEMPLATE_BY_MANIFEST = new WeakMap();
export function recordProcessTemplate(manifest, template) {
  if (manifest && typeof manifest === "object") TEMPLATE_BY_MANIFEST.set(manifest, template);
}
export function processTemplateOfManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  if (TEMPLATE_BY_MANIFEST.has(manifest)) return TEMPLATE_BY_MANIFEST.get(manifest);
  const seed = (Array.isArray(manifest.seed) ? manifest.seed : []).filter(Boolean);
  return processTemplateOf(seed.map((e) => (typeof e.body === "string" ? parseDefineModule(e.body).name : null)));
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
    buttons: Array.isArray(s.buttons) ? s.buttons.filter((b) => isStr(b?.tag)) : null,
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

// `onProcessActionButtonClick` under one step's `Buttons` entry for the tag; with no entry, the template default.
function actionBehaviour(config, tag) {
  if (!config) return tag === "SaveData" ? PROCESS_BEHAVIOUR.COMPLETE_SAVE : PROCESS_BEHAVIOUR.CLOSE_OPEN;
  if (config.performClosePage !== true) return PROCESS_BEHAVIOUR.CLOSE_OPEN;
  return config.performSaveData === true ? PROCESS_BEHAVIOUR.COMPLETE_SAVE : PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE;
}
// A button's behaviour, where it was read and — for `onProcessActionButtonClick` — the behaviour in EACH recorded
// step: Freedom keeps `validate` per process element, so two processes may legitimately treat one tag differently,
// and each re-pointed step is checked against its own element.
function behaviourOf(handler, tag, steps) {
  if (handler === "onSaveButtonClick") return { behaviour: PROCESS_BEHAVIOUR.COMPLETE_SAVE, source: "page", perStep: [] };
  if (handler === "onCancelProcessElementClick") return { behaviour: PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE, source: "page", perStep: [] };
  const declared = steps.map((s) => ({ s, config: (s.buttons || []).find((b) => b.tag === tag) || null })).filter((x) => x.config);
  if (!declared.length) return { behaviour: actionBehaviour(null, tag), source: "page-default", perStep: [] };
  const perStep = steps.map((s) => ({ process: s.process, element: s.element,
    behaviour: actionBehaviour((s.buttons || []).find((b) => b.tag === tag) || null, tag) }));
  const differs = new Set(perStep.map((p) => p.behaviour)).size > 1;
  return { behaviour: actionBehaviour(declared[0].config, tag), source: differs ? "element-per-step" : "element", perStep };
}

// The Freedom element a Classic process button becomes: the template save button for the Classic template's save
// button, otherwise the button itself under its Classic name.
const isTemplateSave = (item) => (item.templateOwned && item.tag === "SaveData") || item.name === CLASSIC_TEMPLATE_SAVE_BUTTON;
const freedomNameOf = (item) => (isTemplateSave(item) ? FREEDOM_SAVE_BUTTON : item.name);

// A button whose click the template does not route but which may still end the step: it sits among the template's
// process buttons, or its handler calls the template's process API.
function mayEndStep(item, methodCalls) {
  if (item.parent === PROCESS_BUTTONS_CONTAINER) return true;
  const calls = methodCalls.get(item.handlers?.click) || [];
  return calls.some((c) => PROCESS_API.some((api) => c === api || c.endsWith("." + api)));
}

// The page's live process buttons (the merged items; a removed button is gone; one hidden by default stays, a rule or
// binding may show it), each with its Classic behaviour, where that behaviour was read, and its Freedom button.
export function processButtonsOf(items, steps = [], resources = {}, methods = []) {
  const captionOf = (raw) => (raw && typeof resources[resourceKey(raw)] === "string" && resources[resourceKey(raw)]) || raw || null;
  const methodCalls = new Map((methods || []).map((m) => [m.name, m.facts?.calls || []]));
  const isButton = (i) => i?.itemType === 5 && !i.engineOnlyStub && typeof i.handlers?.click === "string";
  return (items || []).filter(isButton).flatMap((i) => {
    const base = { classic: i.name, freedom: freedomNameOf(i), caption: captionOf(i.caption), tag: i.tag || null, handler: i.handlers.click };
    if (PROCESS_HANDLERS.has(i.handlers.click)) return [{ ...base, ...behaviourOf(i.handlers.click, i.tag || null, steps) }];
    if (mayEndStep(i, methodCalls)) return [{ ...base, behaviour: PROCESS_BEHAVIOUR.UNKNOWN, source: "custom-handler", perStep: [] }];
    return [];
  });
}
// Every behaviour a button has across the page and the steps.
const behavioursOf = (b) => new Set([b.behaviour, ...(b.perStep || []).map((p) => p.behaviour)]);
const isCompleting = (b) => [...behavioursOf(b)].some((x) => x === PROCESS_BEHAVIOUR.COMPLETE_SAVE || x === PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE);

// The whole profile, or null for any other page.
export function processPageInfo({ template, pageName, items, methods, manifest }) {
  if (!template) return null;
  const stepFacts = processStepsOf(manifest);
  const buttons = processButtonsOf(items, stepFacts.steps, plainObject(manifest?.resources), methods);
  return {
    template, pageName: pageName || null,
    // the page parameters its fields bind to (the bound names of the page's own fields)
    parameters: [...new Set((items || []).filter((i) => i.bindTo && !i.templateOwned).map((i) => i.bindTo))],
    buttons,
    completing: buttons.filter(isCompleting).length,
    stepsResolved: stepFacts.resolved, evidence: stepFacts.evidence, steps: stepFacts.steps,
    issues: stepsIssuesOf(stepFacts),
  };
}

// The mapper's view: Classic button name → its behaviour, so a process button gets no generated request handler. A
// customer handler of unknown effect keeps the ordinary path (its body is ported) until a decision says otherwise.
export function processButtonMap(info) {
  const pageBehaviour = (b) => (behavioursOf(b).has(PROCESS_BEHAVIOUR.CLOSE_OPEN) ? PROCESS_BEHAVIOUR.CLOSE_OPEN : b.behaviour);
  return new Map((info?.buttons || []).filter((b) => b.behaviour !== PROCESS_BEHAVIOUR.UNKNOWN).map((b) => [b.classic, pageBehaviour(b)]));
}

const BEHAVIOUR_TEXT = {
  [PROCESS_BEHAVIOUR.COMPLETE_SAVE]: "validates, saves the parameters, completes the step",
  [PROCESS_BEHAVIOUR.COMPLETE_NO_SAVE]: "completes the step WITHOUT saving; the tag is the result",
  [PROCESS_BEHAVIOUR.CLOSE_OPEN]: "closes the page; the step keeps waiting",
  [PROCESS_BEHAVIOUR.UNKNOWN]: "⚠ a customer handler the profile cannot read",
};
const SOURCE_TEXT = {
  page: "page handler",
  element: "process element `Buttons`",
  "element-per-step": "⚠ process element `Buttons` — differs by step; each re-pointed step is checked against its own entry",
  "page-default": "⚠ template default — the process element was not read",
  "custom-handler": "⚠ a customer handler among the process buttons, or one that calls the template's process API",
};
const behaviourText = (b) => BEHAVIOUR_TEXT[b] || b;
const buttonSourceText = (s) => SOURCE_TEXT[s] || s;
const expectedValidate = (behaviour) => behaviour === PROCESS_BEHAVIOUR.COMPLETE_SAVE;
function freedomMappingText(b) {
  const name = code(b.freedom);
  if (b.behaviour === PROCESS_BEHAVIOUR.UNKNOWN)
    return `decide from ${code(b.handler)}'s body whether it completes the step (with or without saving) or only closes the page, and record the decision`;
  if (b.source === "element-per-step")
    return `${name} with ${code(CLOSE_PAGE_REQUEST)}; selected as completing only in the steps whose \`Buttons\` complete it, each with its own \`validate\``;
  if (b.behaviour === PROCESS_BEHAVIOUR.CLOSE_OPEN)
    return `${name} with ${code(CLOSE_PAGE_REQUEST)}; NOT selected as completing in the process element`;
  const validate = expectedValidate(b.behaviour) ? "true" : "false";
  const shape = b.freedom === FREEDOM_SAVE_BUTTON ? "the template's `SaveButton`" : `${name} with no \`clicked\` request`;
  return `${shape}; selected as completing in the process element, \`validate: ${validate}\``;
}
// A step's re-point verdict for the plan: what the build does with it.
function stepCall(s) {
  if (s.resultBranches) return "⚠ manual — the process branches on this step's result; the result gives the steps to map each Classic tag to its Freedom button";
  if (s.consent === "approved") return "re-point in a NEW process version, then activate it (rollback: activate the previous version)";
  if (s.consent === "declined") return "not re-pointed (declined) — the result gives the manual steps";
  return "⚠ awaiting the user's consent";
}
function buttonRow(b, esc) {
  const tag = b.tag ? code(esc(b.tag)) : "—";
  return `| ${esc(b.caption || b.classic)} (${code(esc(b.classic))}) | ${tag} | ${behaviourText(b.behaviour)} | ${buttonSourceText(b.source)} | ${freedomMappingText(b)} |`;
}
function stepsPlanLines(info, esc) {
  if (!info.stepsResolved) return ["- ⚠ not recorded — ask the user which processes and steps open this page (see the ⛔ banner)", ""];
  if (!info.steps.length) {
    const evidence = info.evidence ? " (" + esc(info.evidence) + ")" : "";
    return [`- none named by the user${evidence} — the result gives the manual re-pointing steps`, ""];
  }
  return ["One consent covers the listed steps; the user may untick any of them.", "", "| Process | Step | Re-point |", "| --- | --- | --- |",
    ...info.steps.map((s) => `| ${code(esc(s.process || "?"))} | ${esc(s.caption || s.element || "?")} (${code(esc(s.element || "?"))}) | ${stepCall(s)} |`), ""];
}

// The plan's `### Process page` section: the buttons, their Classic behaviour and Freedom mapping, the rule that
// keeps a way out, and the process steps the page must be re-pointed in.
export function processPagePlanLines(info, esc) {
  if (!info) return [];
  const params = info.parameters.length ? " (" + info.parameters.map((p) => code(esc(p))).join(", ") + ")" : "";
  const L = ["### Process page",
    `${code(esc(info.pageName || "?"))} extends ${code(esc(info.template))}: a business process opens it as a step and waits. It has no object, no list page and no add mini page; its fields bind to page parameters, kept under their Classic names because the process maps them${params}.`,
    "",
    "#### Process buttons",
    "| Classic button | Tag | Classic behaviour | Read from | Freedom |",
    "| --- | --- | --- | --- | --- |",
    ...info.buttons.map((b) => buttonRow(b, esc)),
  ];
  if (!info.buttons.length) L.push("| — | — | ⚠ the page has no process button left | — | add a completing button: a step nothing completes waits forever |");
  L.push("", `The built page keeps at least one completing button and one exit that leaves the step open (the template's \`BackButton\` / \`CloseButton\` with ${code(CLOSE_PAGE_REQUEST)}), even where the Classic page removed its own Close.`, "",
    "#### Process steps to re-point", ...stepsPlanLines(info, esc));
  return L;
}

// ---- the plan-vs-built rows -----------------------------------------------------------------------------------
// `--built.processSteps` is what `describe-business-process` returned for each re-pointed step, one entry per step:
//   { process, element, page, active, buttons: [{ name, validate }] }   (`buttons` = the element's completing buttons)
// `--built.processStandCheck` records the stand check: { pressed: [{ button, outcome: "completed" | "open" }] }.

export function processPageRows(info, esc) {
  if (!info) return [];
  const buttonRows = info.buttons.map((b) => ({ deliverableId: `process-button:${b.classic}`,
    label: `[process button] ${esc(b.caption || b.classic)} — ${behaviourText(b.behaviour)} → ${code(esc(b.freedom))}`,
    vk: { type: "processbutton", freedom: b.freedom, behaviour: b.behaviour, perStep: b.perStep || [] } }));
  const stepRows = info.steps.map((s) => ({ deliverableId: `process-step:${s.process}:${s.element}`,
    label: `[process step] ${code(esc(s.process || "?"))} / ${code(esc(s.element || "?"))} — re-point the Pre-configured page element to the Freedom page`,
    vk: { type: "processstep", process: s.process, element: s.element, consent: s.consent, resultBranches: s.resultBranches } }));
  if (info.stepsResolved && !info.steps.length) stepRows.push({ deliverableId: "process-step:none",
    label: "[process step] none named — hand over the manual re-pointing steps", vk: { type: "processstep", consent: "none" } });
  return [...buttonRows,
    { deliverableId: "process-exit", label: "The page keeps a completing button and an exit that leaves the process step open",
      vk: { type: "processexit", completing: info.completing } },
    ...stepRows,
    { deliverableId: "process-stand-check", label: "Stand check: open the page from its process step and press each button",
      vk: { type: "processstand", buttons: info.buttons.map((b) => ({ freedom: b.freedom, behaviour: b.behaviour, perStep: b.perStep || [] })) } }];
}

const MISSING = "❌ MISSING", VERIFY = "⚠ verify", DONE = "✅ Done";
const builtSteps = (ctx) => (Array.isArray(ctx.root?.processSteps) ? ctx.root.processSteps.filter((s) => s && typeof s === "object") : []);
const selectedIn = (step, name) => (Array.isArray(step.buttons) ? step.buttons : []).find((b) => b && b.name === name) || null;
const buttonOps = (ctx) => (ctx.ops || []).filter((o) => o && typeof o.name === "string");
// The walked op list carries each node's request flat (designspec `pushWalkNode`).
const requestOf = (o) => (typeof o.request === "string" ? o.request : null);
// The behaviour a re-pointed step holds the button to: its own `Buttons` entry when one was recorded, else the page's.
const stepBehaviour = (vk, s) => (vk.perStep || []).find((p) => p.process === s.process && p.element === s.element)?.behaviour || vk.behaviour;
// `absentEntry` is designspec's answer for a page nobody fetched, so these rows block like every other one; `esc`
// neutralises the stand-derived names the notes quote.
function pageUnreadable(ctx, what, { absentEntry }) {
  if (ctx.entryAbsent) return absentEntry(ctx, what);
  if (ctx.page === false) return [MISSING, "the page is reported as NOT BUILT", "missing"];
  return null;
}
// The page side of one button: a button that closes the page in any step needs `crt.ClosePageRequest` (also a valid
// completing request); one that only completes may declare no request or a request the process designer accepts.
function buttonRequestVerdict(vk, request, name, esc) {
  const closes = behavioursOf(vk).has(PROCESS_BEHAVIOUR.CLOSE_OPEN);
  const declared = request ? code(esc(request)) : "no request";
  if (closes && request !== CLOSE_PAGE_REQUEST) return [VERIFY, `${name} must close the page with ${code(CLOSE_PAGE_REQUEST)} (it declares ${declared})`, "unverified"];
  // A request the process designer does not accept leaves the step with no completing candidate for this button.
  if (!closes && request && !COMPLETING_REQUESTS.includes(request))
    return [MISSING, `${name} declares ${declared}, which the process designer does not accept on a completing button — declare no request`, "missing"];
  return null;
}
// One re-pointed step's selection of the button, against the behaviour that step holds it to.
function stepSelectionProblem(vk, s, esc) {
  const sel = selectedIn(s, vk.freedom);
  const behaviour = stepBehaviour(vk, s);
  const where = `${code(esc(s.process))} / ${code(esc(s.element))}`;
  if (behaviour === PROCESS_BEHAVIOUR.CLOSE_OPEN) return sel ? `${where} selects it as completing — the step would end where Classic kept it open` : null;
  if (!sel) return `${where} does not select it as completing — the step never ends from this button`;
  const want = expectedValidate(behaviour);
  return sel.validate === want ? null : `${where} selects it with \`validate: ${sel.validate}\`, Classic ${want ? "validated" : "did not validate"}`;
}

// One process button: on the page with the right request, and selected in every re-pointed step as that step's
// Classic element said.
function resolveProcessButtonVk(vk, ctx, helpers) {
  const { esc } = helpers;
  const name = code(esc(vk.freedom));
  if (vk.behaviour === PROCESS_BEHAVIOUR.UNKNOWN)
    return [VERIFY, `${name} runs a customer handler the profile cannot read — decide what it does to the process step and record the decision (\`--decide D<N>\`)`, "unverified"];
  const unreadable = pageUnreadable(ctx, name, helpers);
  if (unreadable) return unreadable;
  const op = buttonOps(ctx).find((o) => o.name === vk.freedom);
  if (!op) return [MISSING, `button ${name} is not on the built page`, "missing"];
  const request = requestOf(op);
  const pageVerdict = buttonRequestVerdict(vk, request, name, esc);
  if (pageVerdict) return pageVerdict;
  const steps = builtSteps(ctx);
  const wrong = steps.map((s) => stepSelectionProblem(vk, s, esc)).filter(Boolean);
  if (wrong.length) return [MISSING, wrong.join("; "), "missing"];
  const stepNote = steps.length ? `, selected as each step's element says in ${steps.length} re-pointed step(s)` : "";
  const declared = request ? " with " + code(esc(request)) : " with no request";
  return [DONE, `${name} on the page${declared}${stepNote}`, "ok"];
}
// The way out: a completing button, and a button that closes the page without any re-pointed step selecting it.
function resolveProcessExitVk(vk, ctx, helpers) {
  if (!vk.completing) return [MISSING, "no Classic button completes the step — add a completing button, or the step waits forever", "missing"];
  const unreadable = pageUnreadable(ctx, "the exit button", helpers);
  if (unreadable) return unreadable;
  const steps = builtSteps(ctx);
  const exits = buttonOps(ctx).filter((o) => requestOf(o) === CLOSE_PAGE_REQUEST && o.visible !== false
    && !steps.some((s) => selectedIn(s, o.name)));
  if (!exits.length) return [MISSING, `no visible button closes the page with ${code(CLOSE_PAGE_REQUEST)} while leaving the step open — keep the template's BackButton or CloseButton`, "missing"];
  return [DONE, `exit: ${exits.map((o) => code(helpers.esc(o.name))).join(", ")}`, "ok"];
}
// One process step: re-pointed to the Freedom page in an active version, or left to the user with manual steps.
function resolveProcessStepVk(vk, ctx, { esc }) {
  if (vk.consent === "none") return [VERIFY, "no process step names this page — the page cannot complete a step until the user re-points one; record a decision (`--decide D<N>`) once the manual steps are handed over", "unverified"];
  if (vk.resultBranches) return [VERIFY, "manual — the process branches on this step's result: map each Classic tag to its Freedom button by hand, then record a decision (`--decide D<N>`)", "unverified"];
  if (vk.consent !== "approved") return [VERIFY, `not re-pointed (${vk.consent === "declined" ? "declined" : "no consent"}) — the page cannot complete the step until the user re-points it; record a decision (\`--decide D<N>\`) once the manual steps are handed over`, "unverified"];
  const step = builtSteps(ctx).find((s) => s.process === vk.process && s.element === vk.element);
  if (!step) return [VERIFY, "pass `describe-business-process` of the re-pointed step as `--built.processSteps` to check it", "unverified"];
  if (typeof step.page !== "string" || !step.page) return [MISSING, "the step names no Freedom page", "missing"];
  if (step.active === false) return [VERIFY, `re-pointed to ${code(esc(step.page))} in a version that is not active — activate it`, "unverified"];
  return [DONE, `re-pointed to ${code(esc(step.page))} in the active version`, "ok"];
}
// The outcome the stand check expects from a button: null when its steps differ (the outcome depends on the step
// the instance ran in) or when its behaviour is undecided.
function expectedOutcome(b) {
  const all = behavioursOf(b);
  if (all.size > 1 || all.has(PROCESS_BEHAVIOUR.UNKNOWN)) return null;
  return all.has(PROCESS_BEHAVIOUR.CLOSE_OPEN) ? "open" : "completed";
}
// The stand check: every button pressed from the process step, with the outcome Classic had.
function resolveProcessStandVk(vk, ctx, { esc }) {
  const recorded = Array.isArray(ctx.root?.processStandCheck?.pressed) ? ctx.root.processStandCheck.pressed : [];
  const pressed = recorded.filter((p) => p && typeof p === "object");
  const outcomeOf = (b) => pressed.find((p) => p.button === b.freedom)?.outcome;
  const notPressed = vk.buttons.filter((b) => outcomeOf(b) === undefined);
  if (notPressed.length) return [VERIFY, `built, not exercised — open the page from its process step and press ${notPressed.map((b) => code(esc(b.freedom))).join(", ")}; record each outcome in \`--built.processStandCheck\``, "unverified"];
  const wrong = vk.buttons.filter((b) => expectedOutcome(b) !== null && outcomeOf(b) !== expectedOutcome(b));
  if (wrong.length) return [MISSING, wrong.map((b) => `${code(esc(b.freedom))} should leave the step ${expectedOutcome(b)}`).join("; "), "missing"];
  return [DONE, `${vk.buttons.length} button(s) pressed from the process step, each with its Classic outcome`, "ok"];
}
// `[type, (vk, ctx, { absentEntry, esc }) => verdict]` — designspec registers them and hands in its own helpers.
export const PROCESS_VK_RESOLVERS = Object.freeze([["processbutton", resolveProcessButtonVk], ["processexit", resolveProcessExitVk],
  ["processstep", resolveProcessStepVk], ["processstand", resolveProcessStandVk]]);
