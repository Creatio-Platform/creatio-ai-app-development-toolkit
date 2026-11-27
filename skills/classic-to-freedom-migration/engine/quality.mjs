// CODE QUALITY of the built pages — what would otherwise be counted by hand: long functions, helpers nested in
// handlers or copied between them, catch blocks that swallow errors, bare numeric comparison types, loads that wait
// for each other for no reason, hard-coded record ids, plan codes left in comments and strings nobody shows — and the
// runtime defects of a handler chain cut short, a read that pages through every row, a write whose failure nobody sees.
//
// Two `--verify` rows read it. The `Page code` row (codemap.mjs) holds a page's function length and its duplicated
// helpers, beside the requests it declares and never sends; the `Code quality` rows (QUALITY_ROW_RULES) hold the
// rest. One measurement, one limit (`manifest.qualityThresholds`), one decision closes a finding.
//
// The per-page rules share their ids and thresholds with clio's page-body lint (`PageBodyAstLinter.Quality.cs`),
// which gives the same findings as save-time warnings in every flow. Here they BLOCK: a page that breaks one is not
// done. Both sides are kept in step by hand — a rule or threshold changed here is changed there too. Three rules are
// checked here only: `paged-read-loop` and `unchecked-write-result`. `handler-without-next` shares its id with clio, and
// both require the handler to RETURN what `next.handle(…)` gives, not only to call it.
//
// Everything is read from get-page's bundle as the read-back filed it (`handlers`, `validators`, `converters` are
// SOURCE strings; `viewConfig`, `viewModelConfig`, `modelConfig`, `resources` are JSON). Nothing is evaluated.
//
// A page's logic lives in the client modules it imports (`<Prefix><Page>Module`, shared ones beside it), so the rules
// that hold outside a page section run over those too: the read-back files each module's source (`built.modules`),
// and a page carries the findings of every module it imports, directly or through another module.
import { parseJsExpression, parseDefineModule, staticPropKey, childNodesOf, isFnNode, isFunction, lineOf, walkAstBounded } from "./engine.mjs";
import { GUID_RE, bundleDeps } from "./conventions.mjs";
import { nearCopies, literalConstantsOf } from "./nearcopy.mjs";

export const QUALITY_RULES = Object.freeze({
  functionTooLong: "function-too-long",
  nestedFunctions: "handler-too-many-nested-functions",
  duplicateInPage: "duplicate-function-in-page",
  duplicateAcrossPages: "duplicate-function-across-pages",
  catchLogOnly: "catch-log-only",
  numericComparisonType: "numeric-comparison-type",
  sequentialAwaits: "sequential-independent-awaits",
  guidLiteral: "guid-literal-data-reference",
  planCodeInComment: "plan-code-in-comment",
  requestWithoutSender: "request-without-sender",
  unusedResourceString: "unused-resource-string",
  pageWithoutModule: "page-without-module",
  duplicateHandlerAcrossPages: "duplicate-handler-across-pages",
  duplicateAcrossModules: "duplicate-function-across-modules",
  sharedValueInTwoModules: "shared-value-in-two-modules",
  unusedModuleExport: "unused-module-export",
  wrappedCallInlined: "wrapped-call-inlined",
  handlerWithoutNext: "handler-without-next",
  pagedReadLoop: "paged-read-loop",
  uncheckedWriteResult: "unchecked-write-result",
});

// The manifest's `qualityThresholds` override these, key by key.
export const DEFAULT_QUALITY_THRESHOLDS = Object.freeze({
  maxFunctionLines: 60,
  maxNestedFunctionsPerHandler: 3,
  maxSequentialIndependentAwaits: 2,
});

// What each `Code quality` row says it checks, in the order the rows are shown — every rule except the ones the
// `Page code` row holds (function length, a helper declared twice on the page, a request nobody sends). The label
// names the threshold KEY, never its value: a row's label is its decision key, so a decision recorded on it survives a
// changed limit. A finding marked `advisory` is noted, never blocking; every unused-string finding is one.
export const QUALITY_ROW_RULES = Object.freeze([
  { rule: QUALITY_RULES.nestedFunctions, label: "no handler declaring more than `maxNestedFunctionsPerHandler` functions in its body" },
  { rule: QUALITY_RULES.duplicateAcrossPages, label: "no helper copied from another page of the run" },
  { rule: QUALITY_RULES.handlerWithoutNext, label: "every handler calls `next?.handle(request)` and returns its result" },
  { rule: QUALITY_RULES.catchLogOnly, label: "no catch block that only logs the error" },
  { rule: QUALITY_RULES.uncheckedWriteResult, label: "no write whose failure result the caller ignores" },
  { rule: QUALITY_RULES.pagedReadLoop, label: "no read that pages through every row (a total is one aggregate query)" },
  { rule: QUALITY_RULES.numericComparisonType, label: "no bare numeric `comparisonType`" },
  { rule: QUALITY_RULES.sequentialAwaits, label: "no more than `maxSequentialIndependentAwaits` independent model loads awaited one after another" },
  { rule: QUALITY_RULES.guidLiteral, label: "no hard-coded record id a project constants module holds" },
  { rule: QUALITY_RULES.planCodeInComment, label: "no plan code (card, AC, decision id) in a comment" },
  { rule: QUALITY_RULES.unusedResourceString, label: "resource strings in use (advisory)" },
  { rule: QUALITY_RULES.pageWithoutModule, label: "a page with handlers imports its own `<PageSchema>Module`" },
  { rule: QUALITY_RULES.duplicateHandlerAcrossPages, label: "no handler copied from another page of the run" },
  { rule: QUALITY_RULES.duplicateAcrossModules, label: "no function or run of statements in two modules of the run, also with other values, or in a page and a module" },
  { rule: QUALITY_RULES.sharedValueInTwoModules, label: "no record id or constant value declared in two modules, also under another name — a value the pages share lives in one module" },
  { rule: QUALITY_RULES.unusedModuleExport, label: "no export of a module the run built (a page's own module, or one a build task recorded as `Module created`) that no page or module uses" },
  { rule: QUALITY_RULES.wrappedCallInlined, label: "no call written out where a module export already wraps it" },
]);

// The rules that read the run's module bodies (`built.modules`); without them these rows say nothing was checked.
export const MODULE_BODY_RULES = Object.freeze([QUALITY_RULES.duplicateAcrossModules, QUALITY_RULES.sharedValueInTwoModules,
  QUALITY_RULES.unusedModuleExport, QUALITY_RULES.wrappedCallInlined]);

// A named helper smaller than this many AST nodes (`v => v`) is not worth moving to a module, so copies of it are
// not reported.
const MIN_DUPLICATE_FUNCTION_NODES = 8;
const SECTIONS = ["handlers", "validators", "converters"];
// A card id (`C04`, `shared/C04`), an AC number (`AC-16`), a decision id (`D8`) or a card path (`card PIS/`).
const PLAN_CODE = /(?:\b[\w-]+\/)?\bC\d{2,}\b|\bAC-\d+\b|\bD\d+\b|\bcard [\w-]+\//g;
// The keys that make an object a page element (a list column, a field) rather than data: its `id` is a generated
// local id, which only has to be unique on the page, not a record id.
const ELEMENT_KEYS = new Set(["code", "path", "caption", "title", "width"]);
const RESOURCE_REF = /#ResourceString\(([^)#]+)\)#|\$?Resources\.Strings\.(\w+)/g;

// The manifest's thresholds over the defaults; a value that is not a positive whole number is ignored.
export function qualityThresholdsOf(manifest) {
  const given = manifest?.qualityThresholds;
  const out = { ...DEFAULT_QUALITY_THRESHOLDS };
  if (!given || typeof given !== "object") return out;
  for (const key of Object.keys(DEFAULT_QUALITY_THRESHOLDS)) {
    if (Number.isInteger(given[key]) && given[key] > 0) out[key] = given[key];
  }
  return out;
}

// ---- walking ESTree nodes ----

const childNodes = childNodesOf;
const finding = (rule, section, line, text, extra = {}) => ({ rule, section, line, text, ...extra });

// ---- one page ----

// Lint one built page. Returns null when the bundle carries none of the code sections (the row then asks for the
// bundle, never passes silently); otherwise the page's findings and the helpers the run-wide check compares.
export function lintPageQuality(entry, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  if (!entry || typeof entry !== "object") return null;
  const sources = SECTIONS.filter((s) => typeof entry[s] === "string");
  if (!sources.length) return null;
  const page = emptyPageLint();
  // `fnNames` names a function by where it is defined: a handler by its request, a helper by its variable.
  const ctx = { page, t: thresholds, constantsGuids, fnNames: new WeakMap() };
  for (const section of sources) lintSection(entry[section], section, ctx);
  reportDuplicateHelpers(page);
  for (const key of unusedResourceStrings(entry, sources)) {
    page.findings.push(finding(QUALITY_RULES.unusedResourceString, "resources", 0, `\`${key}\``, { advisory: true }));
  }
  return page;
}

function lintSection(src, section, ctx) {
  const comments = [];
  const ast = parseJsExpression(src, { locations: true, onComment: comments });
  if (!ast) { ctx.page.unreadable.push(section); return; }
  ctx.page.asts.push(ast);
  if (section === "handlers" && ast.type === "ArrayExpression") lintHandlers(ast, ctx);
  lintTree(ast, comments, section, ctx);
}

// The rules every source gets: the per-node ones, the unchecked writes and the plan codes in comments.
function lintTree(ast, comments, section, ctx) {
  walkSection(ast, section, false, ctx);
  checkUncheckedWrites(ast, section, ctx.page);
  checkPagedReads(ast, section, ctx.page);
  for (const c of comments) checkComment(c, section, ctx.page);
}

function checkComment(comment, section, page) {
  const codes = [...comment.value.matchAll(PLAN_CODE)].map((m) => m[0]);
  if (!codes.length) return;
  const named = [...new Set(codes)].map((code) => "`" + code + "`").join(", ");
  page.findings.push(finding(QUALITY_RULES.planCodeInComment, section, comment.loc.start.line,
    `${codes.length} plan code(s) in a comment: ${named}`, { value: codes.length }));
}

function reportDuplicateHelpers(page) {
  for (const copies of groupBy(page.helpers, (h) => h.shape).values()) {
    for (const copy of copies.slice(1)) {
      page.findings.push(finding(QUALITY_RULES.duplicateInPage, copy.section, copy.line,
        `\`${copy.name}\` repeats \`${copies[0].name}\` (line ${copies[0].line}); declared ${copies.length} times`,
        { name: copy.name, original: copies[0].name, originalLine: copies[0].line, count: copies.length }));
    }
  }
}

// One walk over a section for the rules that look at single nodes. `isElementId` marks the value of an element-shaped
// object's `id`, so a generated local id is told apart from a record id used as data; an `id` beside `displayValue`
// or `type` is data and is reported.
function walkSection(node, section, isElementId, ctx, depth = 0) {
  if (!node || depth > 1000) return;
  nameChildFunction(node, ctx.fnNames);
  const found = checkNode(node, section, isElementId, ctx);
  if (found) ctx.page.findings.push(found);
  const elementObject = node.type === "ObjectExpression" && isElementObject(node);
  for (const child of childNodes(node)) {
    const elementId = (elementObject && child.type === "Property" && staticPropKey(child) === "id")
      || (isElementId && node.type === "Property" && child === node.value);
    walkSection(child, section, elementId, ctx, depth + 1);
  }
}

// `const name = () => {}` and `name: function () {}` name the function they hold.
function nameChildFunction(node, fnNames) {
  if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && isFunction(node.init)) fnNames.set(node.init, node.id.name);
  else if (node.type === "Property" && isFunction(node.value) && !fnNames.has(node.value)) fnNames.set(node.value, staticPropKey(node));
}

const isElementObject = (obj) => obj.properties.some((p) => p.type === "Property" && ELEMENT_KEYS.has(staticPropKey(p)));

// The finding one node raises, if any.
function checkNode(node, section, isElementId, ctx) {
  if (isFunction(node)) return checkFunctionLength(node, section, ctx);
  if (node.type === "CatchClause") {
    return node.body.body.every(isConsoleCall) ? finding(QUALITY_RULES.catchLogOnly, section, lineOf(node), "the catch block only logs the error") : null;
  }
  if (node.type === "Property") return checkComparisonType(node, section);
  if (node.type === "Literal" && typeof node.value === "string") return checkStringLiteral(node, section, isElementId, ctx);
  return null;
}

function checkFunctionLength(node, section, { t, fnNames }) {
  const lines = node.loc.end.line - node.loc.start.line + 1;
  if (lines <= t.maxFunctionLines) return null;
  const name = node.id?.name || fnNames.get(node) || null;
  return finding(QUALITY_RULES.functionTooLong, section, lineOf(node), `${name ? "`" + name + "` is " : ""}${lines} lines (limit ${t.maxFunctionLines})`,
    { name, value: lines, limit: t.maxFunctionLines });
}

function checkComparisonType(node, section) {
  if (staticPropKey(node) !== "comparisonType" || node.value?.type !== "Literal" || typeof node.value.value !== "number") return null;
  return finding(QUALITY_RULES.numericComparisonType, section, lineOf(node), `\`comparisonType: ${node.value.raw}\``);
}

function checkStringLiteral(node, section, isElementId, ctx) {
  if (isElementId || !GUID_RE.test(node.value)) return null;
  return finding(QUALITY_RULES.guidLiteral, section, lineOf(node), `\`${node.value}\``,
    { advisory: !ctx.constantsGuids.has(node.value.toLowerCase()) });
}

const isConsoleCall = (s) => s.type === "ExpressionStatement" && s.expression.type === "CallExpression"
  && s.expression.callee.type === "MemberExpression" && s.expression.callee.object.type === "Identifier" && s.expression.callee.object.name === "console";

// ---- handlers ----

function lintHandlers(array, ctx) {
  for (const entry of array.elements) {
    if (entry?.type !== "ObjectExpression") continue;
    const { request, handler } = readHandlerEntry(entry);
    if (!handler) continue;
    if (request) ctx.fnNames.set(handler, request);
    ctx.page.handlerShapes.push(describeHelper(request || "handler", handler, handler, false));
    checkPassesOn(handler, request, ctx.page);
    lintHandler(handler, ctx);
  }
}

// The request a handler entry answers (null when it is not a literal) and its handler function (null when none).
function readHandlerEntry(entry) {
  let request = null, handler = null;
  for (const p of entry.properties) {
    const key = p.type === "Property" ? staticPropKey(p) : null;
    if (key === "request" && p.value.type === "Literal" && typeof p.value.value === "string") request = p.value.value;
    else if (key === "handler" && isFunction(p.value)) handler = p.value;
  }
  return { request, handler };
}

function lintHandler(handler, { page, t }) {
  const helpers = [];
  collectNamedFunctions(handler.body, helpers);
  // The handler's own variables: its parameters and what its body declares outside the functions in it. A sibling
  // helper is not one of them — a helper calling another moves to the module with it.
  const helperNames = new Set(helpers.map((h) => h.name));
  const handlerNames = new Set([...handler.params.flatMap((p) => [...bindingNames(p)]), ...declaredNamesIn(handler.body, { intoFunctions: false })]
    .filter((n) => !helperNames.has(n)));
  for (const h of helpers) {
    // A helper nested in another helper is part of that helper: it moves (or is copied) with it.
    if (!h.nested && h.nodeCount >= MIN_DUPLICATE_FUNCTION_NODES && !usesHandlerVariables(h, handlerNames)) page.helpers.push(h);
  }
  if (helpers.length > t.maxNestedFunctionsPerHandler) {
    page.findings.push(finding(QUALITY_RULES.nestedFunctions, "handlers", lineOf(handler),
      `${helpers.length} functions in one handler (limit ${t.maxNestedFunctionsPerHandler}): ${helpers.map((h) => h.name).join(", ")}`,
      { value: helpers.length, limit: t.maxNestedFunctionsPerHandler }));
  }
  checkSequentialAwaits(handler.body, page, t, "handlers");
}

// ---- the handler chain ----

// `await x`, `x?.y()` and `(x)` read as `x`.
function unwrap(node) {
  let n = node;
  while (n && (n.type === "AwaitExpression" || n.type === "ChainExpression" || n.type === "ParenthesizedExpression")) {
    n = n.type === "AwaitExpression" ? n.argument : n.expression;
  }
  return n;
}

// `next.handle(…)` / `next?.handle(…)` for the handler's own `next` parameter.
function isNextCall(node, nextName) {
  const call = unwrap(node);
  return call?.type === "CallExpression" && call.callee.type === "MemberExpression" && !call.callee.computed
    && call.callee.object.type === "Identifier" && call.callee.object.name === nextName && call.callee.property.name === "handle";
}

// The nodes of a function body that belong to it, not to the functions declared or passed inside it.
function ownNodes(node, out = [], depth = 0) {
  if (!node || depth > 1000) return out;
  out.push(node);
  for (const child of childNodes(node)) if (!isFunction(child)) ownNodes(child, out, depth + 1);
  return out;
}

// The variables a body assigns a `next.handle(…)` call to.
function namesFromNext(own, nextName) {
  const names = new Set();
  for (const n of own) {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && isNextCall(n.init, nextName)) names.add(n.id.name);
    else if (n.type === "AssignmentExpression" && n.left.type === "Identifier" && isNextCall(n.right, nextName)) names.add(n.left.name);
  }
  return names;
}


const isTrueLiteral = (n) => n?.type === "Literal" && n.value === true;
// A `while (true)`, `do … while (true)` or `for (;;)` loop: it goes on past itself only through `break`.
function isEndlessLoop(st) {
  if (st.type === "ForStatement") return !st.test || isTrueLiteral(st.test);
  return (st.type === "WhileStatement" || st.type === "DoWhileStatement") && isTrueLiteral(st.test);
}
// What a loop runs before its first pass calls next: a `for` initializer or test, a `for-in/of` source, a `while` test.
function loopHeadCallsNext(st, callsNext) {
  if (st.type === "ForStatement") return callsNext(st.init) || callsNext(st.test);
  if (st.type === "ForInStatement" || st.type === "ForOfStatement") return callsNext(st.right);
  return st.type === "WhileStatement" && callsNext(st.test);
}

// Follows a handler body path by path, so a `return` is judged by whether `next.handle(…)` may have run before it on
// its own path, not by where it is written. Each step returns `{ normal, called, brk }`: `normal` — some path completes
// the statement and goes on, with `called` saying whether the call may have run on it; `brk` — the state of the paths
// that leave through `break` / `continue` (null when none does), which the enclosing switch or loop takes over. A path
// ending in a `return` or a `throw` is in neither. A switch case starts from the switch's entry and from the case that
// falls into it; a loop body counts as run after itself. The first wrong `return` is kept in `walk.problem`.
function nextPathWalk(callsNext, givesNext) {
  const walk = { problem: null };
  // Two optional states joined: null when neither path exists, else whether the call may have run on either.
  const or = (a, b) => {
    if (a === null) return b;
    if (b === null) return a;
    return a || b;
  };
  const join = (a, b) => ({ normal: a.normal || b.normal, called: (a.normal && a.called) || (b.normal && b.called), brk: or(a.brk, b.brk) });
  const all = (list, called, depth) => {
    let brk = null;
    for (const st of list) {
      const r = step(st, called, depth);
      brk = or(brk, r.brk);
      if (!r.normal) return { normal: false, called, brk };
      called = r.called;
    }
    return { normal: true, called, brk };
  };
  const tryStep = (st, called, depth) => {
    const body = step(st.block, called, depth + 1);
    const mayHaveRun = called || callsNext(st.block);
    const handled = st.handler ? join(body, step(st.handler.body, mayHaveRun, depth + 1)) : body;
    if (!st.finalizer) return handled;
    const fin = step(st.finalizer, mayHaveRun || callsNext(st.handler?.body), depth + 1);
    return fin.normal ? { normal: handled.normal, called: handled.called || fin.called, brk: or(handled.brk, fin.brk) } : fin;
  };
  // Cases in order: each starts from the switch's entry, or from the case before it when that one falls through. A
  // `break`, the last case running off its end and, without a `default`, a value no case matches all leave the switch.
  const switchStep = (st, called, depth) => {
    const entry = called || callsNext(st.discriminant);
    let leaving = st.cases.some((c) => c.test === null) ? null : entry;
    let fallsThrough = null;
    for (const c of st.cases) {
      const r = all(c.consequent, entry || fallsThrough === true, depth + 1);
      leaving = or(leaving, r.brk);
      fallsThrough = r.normal ? r.called : null;
    }
    leaving = or(leaving, fallsThrough);
    return leaving === null ? { normal: false, called: entry, brk: null } : { normal: true, called: leaving, brk: null };
  };
  // The body is walked from the loop's entry, and once more as if the call had already run when a pass through it can call
  // next and go round again, so a `return` a later pass reaches after the call is judged as such. The loop goes on
  // past itself when its test can fail (an endless `while (true)` / `for (;;)` only through `break`; a `do` loop only
  // after a pass that completes), with the call run on any path that completed a pass.
  const loopStep = (st, called, depth) => {
    const entry = called || loopHeadCallsNext(st, callsNext);
    let pass = step(st.body, entry, depth + 1);
    if (!entry && ((pass.normal && pass.called) || pass.brk === true)) pass = step(st.body, true, depth + 1);
    const calledOnward = (pass.normal && pass.called) || pass.brk === true;
    if (isEndlessLoop(st)) return pass.brk === null ? { normal: false, called: entry, brk: null } : { normal: true, called: pass.brk, brk: null };
    if (st.type === "DoWhileStatement") {
      return pass.normal || pass.brk !== null ? { normal: true, called: calledOnward, brk: null } : { normal: false, called: entry, brk: null };
    }
    return { normal: true, called: entry || calledOnward, brk: null };
  };
  const step = (st, called, depth) => {
    if (walk.problem) return { normal: false, called, brk: null };
    if (!st) return { normal: true, called, brk: null };
    if (depth > 1000) { walk.problem = END_AFTER_NEXT; return { normal: false, called, brk: null }; }
    switch (st.type) {
      case "ReturnStatement":
        if (!(st.argument && givesNext(st.argument)) && (called || callsNext(st.argument))) walk.problem = RETURN_AFTER_NEXT;
        return { normal: false, called, brk: null };
      case "ThrowStatement": return { normal: false, called, brk: null };
      case "BreakStatement":
      case "ContinueStatement": return { normal: false, called, brk: called };
      case "BlockStatement": return all(st.body, called, depth + 1);
      case "LabeledStatement": {
        const inner = step(st.body, called, depth + 1);
        return inner.brk === null ? inner : join({ ...inner, brk: null }, { normal: true, called: inner.brk, brk: null });
      }
      case "IfStatement": {
        const afterTest = called || callsNext(st.test);
        return join(step(st.consequent, afterTest, depth + 1), step(st.alternate, afterTest, depth + 1));
      }
      case "TryStatement": return tryStep(st, called, depth);
      case "SwitchStatement": return switchStep(st, called, depth);
      default:
        if (LOOPS.has(st.type)) return loopStep(st, called, depth);
        return { normal: true, called: called || callsNext(st), brk: null };
    }
  };
  walk.run = (body) => step(body, false, 0);
  return walk;
}

// The name of a handler's `next` parameter (`next` or `next = null`), or null when it takes none.
function nextParamName(handler) {
  const p = handler.params[1];
  const id = p?.type === "AssignmentPattern" ? p.left : p;
  return id?.type === "Identifier" ? id.name : null;
}

const NO_RETURN_OF_NEXT = "calls `next.handle(request)` but no `return` gives its result";
const RETURN_AFTER_NEXT = "calls `next.handle(request)` but a `return` reached after that call does not give its result";
const END_WITHOUT_RETURN = "can reach its end without a `return`, which ends the chain on that path without handing the request on";
const END_AFTER_NEXT = "calls `next.handle(request)` but can reach its end after that call without a `return`, which drops the result";

// A handler passes the request on: it takes `next`, calls `next.handle(…)` and returns what that call gives (directly,
// or through a variable it assigned the call to; an arrow's expression body is what it returns), never runs off its
// end, and on every path where the call may already have run every `return` gives it. A `return` (or `throw`) reached
// before the call runs is a deliberate stop (`if (child) { return openChild(request, child); }
// return next?.handle(request);`), whichever branch it is written in; running off the end is not. Anything else ends the chain or drops its
// result; a handler meant to end it is accepted by a plan decision on the row.
function checkPassesOn(handler, request, page) {
  const fail = (why) => page.findings.push(finding(QUALITY_RULES.handlerWithoutNext, "handlers", lineOf(handler),
    `${request ? "`" + request + "`" : "a handler"} ${why}`, { request: request || null }));
  const nextName = nextParamName(handler);
  if (!nextName) return fail("takes no `next`, so the handlers after it never run");
  const own = ownNodes(handler.body);
  if (!own.some((n) => n.type === "CallExpression" && isNextCall(n, nextName))) {
    return fail("never calls `next.handle(request)`, so the handlers after it never run");
  }
  const fromNext = namesFromNext(own, nextName);
  // The result itself, a variable holding it, or a call chained on it (`next.handle(request).then(…)`).
  const givesNext = (value, depth = 0) => {
    const v = unwrap(value);
    if (isNextCall(v, nextName) || (v?.type === "Identifier" && fromNext.has(v.name))) return true;
    return depth < 50 && v?.type === "CallExpression" && v.callee.type === "MemberExpression" && !v.callee.computed
      && givesNext(v.callee.object, depth + 1);
  };
  if (handler.body.type !== "BlockStatement") return givesNext(handler.body) ? undefined : fail(NO_RETURN_OF_NEXT);
  if (!own.some((n) => n.type === "ReturnStatement" && n.argument && givesNext(n.argument))) return fail(NO_RETURN_OF_NEXT);
  const callsNext = (node) => Boolean(node) && ownNodes(node).some((n) => n.type === "CallExpression" && isNextCall(n, nextName));
  const walk = nextPathWalk(callsNext, givesNext);
  const end = walk.run(handler.body);
  if (walk.problem) return fail(walk.problem);
  if (!end.normal) return;
  fail(end.called ? END_AFTER_NEXT : END_WITHOUT_RETURN);
}

// ---- writes ----

const WRITE_METHODS = new Set(["insert", "update", "delete"]);
function memberName(n) {
  if (n?.type === "Identifier") return n.name;
  if (n?.type === "MemberExpression" && !n.computed) return n.property.name;
  return null;
}
// `await sdk.Model.create(…)` / `Model.create(…)` (a data model) or `new sdk.SysSettingsService()` (system settings).
const isDataWriter = (init) => (init?.type === "CallExpression" && init.callee.type === "MemberExpression" && !init.callee.computed
  && init.callee.property.name === "create" && isModelReference(init.callee.object))
  || (init?.type === "NewExpression" && memberName(init.callee) === "SysSettingsService");

// The variables of a source bound to a data model or the system settings service: only their insert/update/delete
// write data (a `Set`'s or a `Map`'s `.delete` does not).
function dataWriterNames(ast) {
  const names = new Set();
  walkAstBounded(ast, (n) => {
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && isDataWriter(unwrap(n.init))) names.add(n.id.name);
  });
  return names;
}
const isWriteCall = (n, writerNames) => n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed
  && WRITE_METHODS.has(n.callee.property.name) && n.callee.object.type === "Identifier" && writerNames.has(n.callee.object.name);
// `return null;`, `return false;`, `return undefined;`: the value a write function gives back when it failed.
const isFailureReturn = (n) => n.type === "ReturnStatement" && n.argument != null
  && ((n.argument.type === "Literal" && (n.argument.value === null || n.argument.value === false))
    || (n.argument.type === "Identifier" && n.argument.name === "undefined"));

// A function's body writes data and, after its first write, can give back a failure value. A `return false` before
// any write is a guard on the input, not a failed write.
function failsAfterWrite(fn, writerNames) {
  const body = ownNodes(fn.body);
  const writes = body.filter((n) => isWriteCall(n, writerNames));
  if (!writes.length) return false;
  const firstWrite = Math.min(...writes.map((n) => n.start));
  return body.some((n) => isFailureReturn(n) && n.start > firstWrite);
}

// `function name() {}` / `const name = () => {}` as `[name, function]`.
function namedFunctionOf(n) {
  if (n.type === "FunctionDeclaration" && n.id) return [n.id.name, n];
  if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && isFunction(n.init)) return [n.id.name, n.init];
  return null;
}

// A named function that writes data and gives back a failure value on some path has a result its caller must check.
// A call to it as a bare statement (`await recalculate(…);`) drops that result: the write may have failed and nobody
// is told. Within one source only: a function of another module is not seen.
function checkUncheckedWrites(ast, section, page) {
  const writerNames = dataWriterNames(ast);
  if (!writerNames.size) return;
  const writers = new Set();
  const bareCalls = [];
  walkAstBounded(ast, (node) => {
    const named = namedFunctionOf(node);
    if (named && failsAfterWrite(named[1], writerNames)) writers.add(named[0]);
    const call = node.type === "ExpressionStatement" ? unwrap(node.expression) : null;
    if (call?.type === "CallExpression" && call.callee.type === "Identifier") bareCalls.push([node, call.callee.name]);
  });
  for (const [node, name] of bareCalls.sort((x, y) => lineOf(x[0]) - lineOf(y[0]))) {
    if (!writers.has(name)) continue;
    page.findings.push(finding(QUALITY_RULES.uncheckedWriteResult, section, lineOf(node),
      `\`${name}(…)\` writes data and returns a failure value, but this call ignores it — check it and tell the user`, { name }));
  }
}

// ---- paged reads ----

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

// Every `rowsOffset` with a computed value, with the named function it sits in and whether a loop of that function
// holds it, and the functions a loop calls. A named function starts outside any loop; an inline callback belongs to
// the code around it.
function collectPaging(node, fnName, inLoop, acc, depth = 0) {
  if (!node || depth > 1000) return acc;
  if (node.type === "Property" && staticPropKey(node) === "rowsOffset" && node.value?.type !== "Literal") acc.offsets.push({ node, fnName, inLoop });
  if (inLoop && node.type === "CallExpression" && node.callee.type === "Identifier") acc.calledInLoop.add(node.callee.name);
  const named = namedFunctionOf(node);
  if (named) return collectPaging(named[1].body, named[0], false, acc, depth + 1);
  const loop = inLoop || LOOPS.has(node.type);
  for (const child of childNodes(node)) collectPaging(isFnNode(child) ? child.body : child, fnName, loop, acc, depth + 1);
  return acc;
}

// A computed `rowsOffset` inside a loop — or in a function a loop calls — reads page after page of rows: the way a
// client adds up a total it should ask the server for. A computed offset outside a loop reads the one page asked for.
function checkPagedReads(ast, section, page) {
  const { offsets, calledInLoop } = collectPaging(ast, null, false, { offsets: [], calledInLoop: new Set() });
  for (const { node, fnName, inLoop } of offsets) {
    if (!inLoop && !(fnName && calledInLoop.has(fnName))) continue;
    page.findings.push(finding(QUALITY_RULES.pagedReadLoop, section, lineOf(node),
      "a loop reads page after page of rows (`rowsOffset` computed in it) — ask for the total with one aggregate query"));
  }
}

// Named functions only (`function name() {}`, `const name = () => {}`): an inline callback is not a helper.
function collectNamedFunctions(node, out, insideHelper = false, depth = 0) {
  if (!node || depth > 1000) return;
  if (node.type === "FunctionDeclaration" && node.id) out.push(describeHelper(node.id.name, node, node, insideHelper));
  else if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && isFunction(node.init)) out.push(describeHelper(node.id.name, node, node.init, insideHelper));
  // A function's own children are inside it; the function itself is at the level it was found on.
  const inner = insideHelper || isFunction(node);
  for (const child of childNodes(node)) collectNamedFunctions(child, out, inner, depth + 1);
}

// The part of a node its shape keeps besides its type: an identifier's name, a literal's source text, an operator
// (with prefix/postfix for `++`/`--`), a declaration kind, a template's text. Operators are node properties, not
// children, so without them `===` and `!==` helpers would read as copies.
function shapeToken(n) {
  if (n.type === "Identifier") return " " + n.name;
  if (n.type === "Literal") return " " + n.raw;
  if (n.type === "UpdateExpression") return (n.prefix ? " prefix " : " postfix ") + n.operator;
  if (typeof n.operator === "string") return " " + n.operator;
  if (n.type === "VariableDeclaration") return " " + n.kind;
  if (n.type === "TemplateElement") return " " + n.value.raw;
  return "";
}

function describeHelper(name, anchor, fn, nested) {
  const parts = [];
  let nodeCount = 0;
  const shape = (n, depth = 0) => {
    if (!n || depth > 1000) return;
    nodeCount++;
    parts.push("(" + n.type + shapeToken(n));
    for (const child of childNodes(n)) shape(child, depth + 1);
    parts.push(")");
  };
  for (const p of fn.params) shape(p);
  shape(fn.body);
  const own = new Set([name, ...fn.params.flatMap((p) => [...bindingNames(p)]), ...declaredNamesIn(fn.body, { intoFunctions: true })]);
  const free = [...referencedNames(fn.body)].filter((n) => !own.has(n));
  return { name, line: lineOf(anchor), section: "handlers", shape: parts.join(""), nodeCount, free, nested, fn };
}

// A helper that reads a variable of its own handler (`$context`, `scopes`, a local) is a binding of that handler: it
// cannot be declared once in a module without changing its signature, so its copies are not reported as copies.
const usesHandlerVariables = (helper, handlerNames) => helper.free.some((n) => handlerNames.has(n));

// The names a binding pattern binds: `a`, `{ a, b: c }`, `[a, ...b]`, `a = 1`.
function bindingNames(pattern, out = new Set()) {
  if (!pattern) return out;
  if (pattern.type === "Identifier") out.add(pattern.name);
  else if (pattern.type === "ObjectPattern") pattern.properties.forEach((p) => bindingNames(p.type === "RestElement" ? p.argument : p.value, out));
  else if (pattern.type === "ArrayPattern") pattern.elements.forEach((e) => bindingNames(e, out));
  else if (pattern.type === "RestElement") bindingNames(pattern.argument, out);
  else if (pattern.type === "AssignmentPattern") bindingNames(pattern.left, out);
  return out;
}

// The names a function body declares: variables, functions and catch parameters, and - with `intoFunctions` - the
// declarations and parameters of the functions inside it too.
function declaredNamesIn(node, { intoFunctions }, out = new Set(), depth = 0) {
  if (!node || depth > 1000) return out;
  if (node.type === "VariableDeclarator") bindingNames(node.id, out);
  else if (node.type === "FunctionDeclaration" && node.id) out.add(node.id.name);
  else if (node.type === "CatchClause") bindingNames(node.param, out);
  for (const child of childNodes(node)) {
    if (isFunction(child)) {
      if (!intoFunctions) continue;
      child.params.forEach((p) => bindingNames(p, out));
    }
    declaredNamesIn(child, { intoFunctions }, out, depth + 1);
  }
  return out;
}

// The variable names an expression reads: identifiers, except a property name (`a.name`, `{ name: v }`).
function referencedNames(node, out = new Set(), depth = 0) {
  if (!node || depth > 1000) return out;
  if (node.type === "Identifier") { out.add(node.name); return out; }
  if (node.type === "MemberExpression") {
    referencedNames(node.object, out, depth + 1);
    if (node.computed) referencedNames(node.property, out, depth + 1);
    return out;
  }
  if (node.type === "Property") {
    if (node.computed) referencedNames(node.key, out, depth + 1);
    referencedNames(node.value, out, depth + 1);
    return out;
  }
  // The target is written, not read: `data = await other.load()` does not depend on the old `data`.
  if (node.type === "AssignmentExpression" && node.left.type === "Identifier") return referencedNames(node.right, out, depth + 1);
  for (const child of childNodes(node)) referencedNames(child, out, depth + 1);
  return out;
}

// ---- sequential awaits ----

// Within each block: the awaited model loads (`await x.load(…)`, `await sdk.Model.create(…)`) that use no earlier
// load's result, followed through the variables assigned from it. A nested function is its own sequence: its body is
// checked on its own (each block keeps its own count).
function checkSequentialAwaits(node, page, t, section, depth = 0) {
  if (!node || depth > 1000) return;
  if (node.type === "BlockStatement") checkBlockAwaits(node, page, t, section);
  for (const child of childNodes(node)) checkSequentialAwaits(isFunction(child) ? child.body : child, page, t, section, depth + 1);
}

function checkBlockAwaits(block, page, t, section) {
  const fromLoads = new Set();
  let independent = 0;
  let first = null;
  for (const statement of block.body) {
    // Nothing can depend on a load before the first one, so the statement is only read once there is one.
    const usesLoad = fromLoads.size > 0 && [...referencedNames(statement)].some((n) => fromLoads.has(n));
    const isLoad = isAwaitedLoad(statement);
    if (isLoad && !usesLoad) { independent++; first ??= statement; }
    if (isLoad || usesLoad) statementBindings(statement).forEach((n) => fromLoads.add(n));
  }
  if (independent <= t.maxSequentialIndependentAwaits) return;
  page.findings.push(finding(QUALITY_RULES.sequentialAwaits, section, lineOf(first),
    `${independent} independent model loads awaited one after another (limit ${t.maxSequentialIndependentAwaits})`,
    { value: independent, limit: t.maxSequentialIndependentAwaits }));
}

// The expression a statement awaits, if it is `await …;`, `x = await …;` or `const x = await …;`.
function awaitedCall(statement) {
  let expr = null;
  if (statement.type === "ExpressionStatement") {
    expr = statement.expression.type === "AssignmentExpression" ? statement.expression.right : statement.expression;
  } else if (statement.type === "VariableDeclaration" && statement.declarations.length === 1) {
    expr = statement.declarations[0].init;
  }
  const call = expr?.type === "AwaitExpression" ? expr.argument : null;
  return call?.type === "CallExpression" ? call : null;
}

function isAwaitedLoad(statement) {
  const callee = awaitedCall(statement)?.callee;
  if (callee?.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return false;
  if (callee.property.name === "load") return true;
  return callee.property.name === "create" && isModelReference(callee.object);
}

const isModelReference = (obj) => (obj.type === "Identifier" && obj.name === "Model")
  || (obj.type === "MemberExpression" && !obj.computed && obj.property.name === "Model");

// The names a statement binds: the declared variables of a declaration, or the assigned identifier of an assignment.
function statementBindings(statement) {
  if (statement.type === "VariableDeclaration") return statement.declarations.flatMap((d) => [...bindingNames(d.id)]);
  if (statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression" && statement.expression.left.type === "Identifier") {
    return [statement.expression.left.name];
  }
  return [];
}

// ---- client modules ----

// A module the platform ships (`@creatio-devkit/common`, `css!...`, a path) is not the project's code.
const isPlatformModule = (name) => /[@!/]/.test(name);
export const moduleSection = (name) => `module ${name}`;

// Lint one client module (`define("Name", [deps], function (...) { ... })`) with the rules that hold outside a page
// section: function length, log-only catch blocks, bare numeric comparison types, sequential independent loads, record
// ids a constants module holds, plan codes in comments, a write whose failure result a caller ignores and a read that
// pages through every row. The handler rules do not apply: a module holds no handlers. The factory is the module
// itself, so it is not measured as one function. `deps` are the modules it imports in turn.
export function lintModuleQuality(name, src, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  const section = moduleSection(name);
  const comments = [];
  const mod = parseDefineModule(src, { locations: true, onComment: comments });
  const page = { findings: [], helpers: [], unreadable: [], deps: mod.deps || [] };
  if (mod.error) { page.unreadable.push(section); return page; }
  const ctx = { page, t: thresholds, constantsGuids, fnNames: new WeakMap() };
  lintTree(mod.factory.body, comments, section, ctx);
  checkSequentialAwaits(mod.factory.body, page, thresholds, section);
  for (const f of page.findings) f.module = name;
  return page;
}

// The project modules a page imports, directly or through a module it imports, in import order: `read` when the
// payload carries the module's source, `unread` when it does not. Platform modules and `external` ones (the project's
// declared helper and constants modules: existing code the run did not write) are not followed.
function importedModulesOf(deps, modules, external, depsOf) {
  const read = [], unread = [], seen = new Set();
  const queue = [...(deps || [])];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || isPlatformModule(name) || external.has(name)) continue;
    seen.add(name);
    if (typeof modules[name] === "string") { read.push(name); queue.push(...depsOf(name)); }
    else unread.push(name);
  }
  return { read, unread };
}

// The run's modules linted once each, and each page given the findings of the modules it imports.
function addModuleFindings(byPage, pages, modules, external, thresholds, constantsGuids) {
  const linted = new Map();
  const lintOf = (name) => {
    if (!linted.has(name)) linted.set(name, lintModuleQuality(name, modules[name], thresholds, constantsGuids));
    return linted.get(name);
  };
  for (const [key, page] of byPage) {
    if (!page) continue;
    const { read, unread } = importedModulesOf(bundleDeps(pages[key]), modules, external, (name) => lintOf(name).deps);
    for (const name of read) page.findings.push(...lintOf(name).findings);
    page.modules = read;
    page.unreadModules = unread;
    // A filed module that does not parse was not measured, and the modules it imports are not known.
    page.unparsedModules = read.filter((name) => lintOf(name).unreadable.length);
  }
}

// ---- strings and resources ----

// The page's resource strings, from get-page's `{ strings: {…} }` or a flat map; null when the bundle has none.
function resourceStringsOf(res) {
  if (!res || typeof res !== "object") return null;
  return res.strings && typeof res.strings === "object" ? res.strings : res;
}

// Resource strings no binding, caption or code on the page names. The bundle merges the template's strings with
// the page's own, so a template string the template's code uses is reported too — the row is advisory for that.
function unusedResourceStrings(entry, sources) {
  const strings = resourceStringsOf(entry.resources);
  if (!strings) return [];
  const text = JSON.stringify([entry.viewConfig, entry.viewModelConfig, entry.modelConfig]) + sources.map((s) => entry[s]).join("\n");
  const used = new Set();
  for (const m of text.matchAll(RESOURCE_REF)) used.add(m[1] || m[2]);
  return Object.keys(strings).filter((k) => !used.has(k));
}

// ---- the run ----

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const k = keyOf(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

// Every built page of the run linted once, then the check that needs more than one page: a helper copied from another
// page. `pages` is `{ pageKey: bundle entry }`; `modules` is `{ moduleName: source }`, the client modules the read-back
// filed (null: none were read); `external` names the modules not followed (see `importedModulesOf`): the team's
// declared helper and constants modules.
// `wholeRun` says `pages` are ALL the run's pages (the verify payload): only then is an export nobody uses known to be
// unused — one page alone cannot see what the others import. Even then only a run page's own `<PageSchema>Module` is
// judged, never an external one. `created` names the modules the run's build tasks created (`Module created:`).
export function lintRunQuality(pages, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set(), modules = null, external = new Set(), wholeRun = true, created = new Set()) {
  const byPage = new Map();
  for (const [key, entry] of Object.entries(pages || {})) byPage.set(key, lintPageQuality(entry, thresholds, constantsGuids));
  addModuleFindings(byPage, pages || {}, modules || {}, external, thresholds, constantsGuids);
  const helperOwners = new Map();
  for (const [key, page] of byPage) {
    for (const h of page?.helpers || []) if (!helperOwners.has(h.shape)) helperOwners.set(h.shape, { key, helper: h });
  }
  for (const [key, page] of byPage) if (page) reportCopiesFromOtherPages(key, page, helperOwners);
  lintRunModules(byPage, pages || {}, modules, wholeRun, external, created);
  return byPage;
}

function reportCopiesFromOtherPages(key, page, helperOwners) {
  const seen = new Set();
  for (const h of page.helpers) {
    const owner = helperOwners.get(h.shape);
    if (owner.key === key || seen.has(h.shape)) continue;
    seen.add(h.shape);
    page.findings.push(finding(QUALITY_RULES.duplicateAcrossPages, h.section, h.line, `\`${h.name}\` copies \`${owner.helper.name}\` of page \`${owner.key}\``));
  }
}

// The run's findings, built once per `--built` root: the verify rows of every page read the same result.
const RUN_CACHE = new WeakMap();
// The key of one thresholds + constants-module + external-module combination, built once per set of rows (see
// `codeQualityRows`).
const sortedList = (xs) => [...(xs || [])].sort((a, b) => a.localeCompare(b)).join();
export const qualityRunKey = (thresholds, constantsGuids, externalModules = [], createdModules = []) =>
  JSON.stringify(thresholds) + "|" + sortedList(constantsGuids) + "|" + sortedList(externalModules) + "|" + sortedList(createdModules);
export function runQualityOf(root, thresholds, constantsGuids, externalModules = [], cacheKey = qualityRunKey(thresholds, constantsGuids, externalModules), createdModules = []) {
  const wholeRun = Boolean(root?.pages && typeof root.pages === "object");
  const pages = wholeRun ? root.pages : { main: root };
  const modules = root?.modules && typeof root.modules === "object" ? root.modules : null;
  let perRoot = RUN_CACHE.get(root);
  if (!perRoot) { perRoot = new Map(); RUN_CACHE.set(root, perRoot); }
  if (!perRoot.has(cacheKey)) {
    perRoot.set(cacheKey, lintRunQuality(pages, thresholds, new Set(constantsGuids || []), modules, new Set(externalModules), wholeRun,
      new Set(createdModules || [])));
  }
  return perRoot.get(cacheKey);
}

// ---- the run's modules ----
//
// The page-code contract puts each page's logic in its own client module and what pages share in one shared module.
// A benchmark run built the modules and still left: two pages with handlers and no module of their own, four
// handlers copied between them, one status id and one helper declared in two modules, a wrapper bypassed five times,
// and exports nobody imports. These checks read the module bodies the read-back files under `built.modules`
// (`{ <ModuleName>: <define() source> }`); without them only the page-side checks run.
//
// Two records, never mixed: what a check finds in a PAGE's code (a missing own module, a copied handler, a page
// helper copying a module function, a wrapped call written out in a handler) goes on the page's lint; what it finds
// in a MODULE goes on the run's module record (`run.modules`, keyed by the page the module belongs to: the page whose
// own module it is, else the first page that imports it, else the run's first page — once, so a shared module's
// defect is not counted per importer). A module finding or an unreadable module never changes a page-side verdict.
// Module bodies are input from the stand, so every walk over them starts with the engine's bounded walker.

// A handler smaller than this is no more than `next` (`return next?.handle(request)`).
const MIN_COPIED_HANDLER_NODES = 15;
// Without the page's `args` its names cannot be resolved to modules, and a thin router (`next` + one module call)
// looks the same on every page whatever module it calls: such handlers are not compared.
const MIN_UNBOUND_COPIED_HANDLER_NODES = 40;

function emptyPageLint() {
  return { findings: [], helpers: [], unreadable: [], handlerShapes: [], asts: [], notChecked: [] };
}

// The module record of one page: the module findings filed there, and the modules that could not be read.
export function runModuleLint(run, pageKey) {
  return run?.modules?.get(pageKey) || { findings: [], unreadable: [] };
}

function lintRunModules(byPage, pages, modules, wholeRun, external = new Set(), created = new Set()) {
  const keys = Object.keys(pages);
  const bindings = new Map(keys.map((k) => [k, pageBindings(pages[k])]));
  reportPagesWithoutModule(byPage, pages);
  reportCopiedHandlers(byPage, bindings);
  byPage.modules = new Map();
  if (!modules || !keys.length) return;
  const recordOf = (moduleName) => {
    const key = moduleOwner(moduleName, pages, keys);
    if (!byPage.modules.has(key)) byPage.modules.set(key, { findings: [], unreadable: [] });
    return byPage.modules.get(key);
  };
  const report = (moduleName, rule, line, text) => recordOf(moduleName).findings.push(finding(rule, `module ${moduleName}`, line, text));
  // By name, so which of two copies is the original does not depend on the order the caller listed the modules in.
  const parsed = Object.entries(modules).filter(([, src]) => typeof src === "string")
    .sort(([a], [b]) => a.localeCompare(b)).map(([name, src]) => moduleFacts(name, src));
  for (const m of parsed.filter((x) => x.error)) recordOf(m.name).unreadable.push(`module \`${m.name}\``);
  const read = parsed.filter((m) => !m.error);
  reportModuleCopies(read, byPage, report);
  reportNearCopies(read, report);
  reportSharedValues(read, report);
  const importers = importerFacts(pages, byPage, bindings, read);
  // Judged only where every user is a run page or a run module: a run page's own `<PageSchema>Module`, and a module a
  // build task of this run created (`created`). A module an earlier run created (a shared module a section migrated
  // before this one also imports), a project module or another app's can serve pages outside the run, whose imports
  // nothing here sees: its exports are never judged.
  if (wholeRun) {
    const own = new Set(keys.map((k) => pageSchemaOf(pages[k])).filter(Boolean).map((s) => s + "Module"));
    reportUnusedExports(read.filter((m) => (own.has(m.name) || created.has(m.name)) && !external.has(m.name)), importers, report);
  }
  reportInlinedWrappers(read, importers, report, ownModulesOf(pages, keys, read, wholeRun), byPage);
}

// The page a module's findings belong to: the page whose own module it is, else the first page importing it.
function moduleOwner(name, pages, keys) {
  const own = keys.find((k) => pageSchemaOf(pages[k]) && pageSchemaOf(pages[k]) + "Module" === name);
  return own ?? keys.find((k) => (bundleDeps(pages[k]) || []).includes(name)) ?? keys[0];
}

const pageSchemaOf = (entry) => (typeof entry?.schemaName === "string" && entry.schemaName ? entry.schemaName : null);

// A page's local names for its imports: get-page's `args` (`(sdk, formPage)`), in the order of its `deps`. Null when
// the bundle has no `args`, or they do not parse: then nothing on the page can be told apart by module.
function pageBindings(entry) {
  const deps = bundleDeps(entry) || [];
  const names = argNamesOf(entry?.args);
  return names ? new Map(names.map((n, i) => [n, deps[i]]).filter(([n, d]) => n && d)) : null;
}

function argNamesOf(args) {
  if (typeof args !== "string") return null;
  const names = args.replace(/^\s*\(|\)\s*$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return names.every((n) => /^[A-Za-z_$][\w$]*$/.test(n)) ? names : null;
}

// A page's own modules: `<PageSchema>Module` of every page known, and on the whole run every module exactly one page
// imports. With one page in hand the importers are unknown, so the contract's naming (`…PageModule`) stands in.
function ownModulesOf(pages, keys, read, wholeRun) {
  const own = new Set(keys.map((k) => pageSchemaOf(pages[k])).filter(Boolean).map((s) => s + "Module"));
  for (const m of read) {
    const importers = keys.filter((k) => (bundleDeps(pages[k]) || []).includes(m.name)).length;
    if (wholeRun ? importers === 1 : /Page\w*Module$/.test(m.name)) own.add(m.name);
  }
  return own;
}

// A page with at least one handler must import `<PageSchema>Module`. Unknown deps or schema name: not checked.
function reportPagesWithoutModule(byPage, pages) {
  for (const [key, entry] of Object.entries(pages)) {
    const page = byPage.get(key);
    const deps = bundleDeps(entry);
    const schema = pageSchemaOf(entry);
    if (!page?.handlerShapes.length) continue;
    if (!deps || !schema) { page.notChecked.push(QUALITY_RULES.pageWithoutModule); continue; }
    if (deps.includes(schema + "Module")) continue;
    page.findings.push(finding(QUALITY_RULES.pageWithoutModule, "handlers", 0,
      `${page.handlerShapes.length} handler(s) and no \`${schema}Module\` among the page's imports (${deps.length ? deps.map((d) => "`" + d + "`").join(", ") : "none"})`));
  }
}

// A handler's shape with each import name replaced by the module it names, so two pages calling their own module
// under the same local name differ, and two pages calling the same module under different names match.
function resolvedShape(shape, binding) {
  if (!binding) return shape;
  let out = shape;
  for (const [name, dep] of binding) out = out.split(`(Identifier ${name})`).join(`(Identifier @${dep})`);
  return out;
}

// A handler whose request and body match a handler of an earlier page, reported on the later page.
function reportCopiedHandlers(byPage, bindings) {
  const first = new Map();
  for (const [key, page] of byPage) {
    const binding = bindings.get(key);
    const min = binding ? MIN_COPIED_HANDLER_NODES : MIN_UNBOUND_COPIED_HANDLER_NODES;
    for (const h of page?.handlerShapes || []) {
      if (h.nodeCount < min) continue;
      const shape = resolvedShape(h.shape, binding);
      const owner = first.get(shape);
      if (!owner) first.set(shape, { key, h });
      else if (owner.key !== key) {
        page.findings.push(finding(QUALITY_RULES.duplicateHandlerAcrossPages, "handlers", h.line,
          `the \`${h.name}\` handler copies the one on page \`${owner.key}\` (line ${owner.h.line}) — move it into a module both pages import`));
      }
    }
  }
}

// What one module body declares: its imports (by factory argument), its named functions, its record ids, its
// exports, and the member reads and calls the other checks need.
function moduleFacts(name, src) {
  const mod = parseDefineModule(src, { locations: true });
  if (mod.error) return { name, error: mod.error };
  // The bounded walk first: a body it refuses is never handed to the recursive helper walk.
  const facts = treeFacts(mod.factory.body);
  if (facts.truncated) return { name, error: "the body is too large or too deeply nested to read" };
  const functions = [];
  collectNamedFunctions(mod.factory.body, functions);
  return { name, factory: mod.factory, argOf: argBindings(mod.factory.params, mod.deps), functions, ...facts,
    exports: exportedNames(mod.returned, functions) };
}

const argBindings = (params, deps) => new Map(params.map((p, i) => [p.type === "Identifier" ? p.name : null, deps[i]]).filter(([n, d]) => n && d));

// Where a name is handed on whole — an argument, a returned or assigned value, an alias, an array element or property
// value: a module object handed on may have any of its exports used where it lands.
const HANDED_ON = {
  CallExpression: (n) => n.arguments, NewExpression: (n) => n.arguments, ReturnStatement: (n) => [n.argument],
  AssignmentExpression: (n) => [n.right], ArrayExpression: (n) => n.elements, SpreadElement: (n) => [n.argument],
  Property: (n) => [n.value], VariableDeclarator: (n) => (n.id.type === "Identifier" ? [n.init] : []),
};

// One bounded walk: record ids, `obj.prop` reads and `const { prop } = obj` destructuring (as prop -> object names),
// names handed on whole, and calls (as callee path -> root name -> count).
function treeFacts(root) {
  const guids = [], members = new Map(), handedOn = new Set(), calls = new Map();
  const read = (prop, obj) => {
    if (!members.has(prop)) members.set(prop, new Set());
    members.get(prop).add(obj);
  };
  const { truncated } = walkAstBounded(root, (node) => {
    if (node.type === "Literal" && typeof node.value === "string" && GUID_RE.test(node.value)) guids.push({ value: node.value.toLowerCase(), line: lineOf(node) });
    for (const [prop, obj] of memberReadsOf(node)) read(prop, obj);
    for (const v of HANDED_ON[node.type]?.(node) || []) if (v?.type === "Identifier") handedOn.add(v.name);
    if (node.type === "CallExpression") countCall(calls, node.callee);
  });
  return { guids, members, handedOn, calls, truncated };
}

// The [prop, object] pairs one node reads: `obj.prop`, or each key of `const { a, b } = obj`.
function memberReadsOf(node) {
  if (node.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.property.type === "Identifier") {
    return [[node.property.name, node.object.name]];
  }
  if (node.type === "VariableDeclarator" && node.id.type === "ObjectPattern" && node.init?.type === "Identifier") {
    return node.id.properties.filter((p) => p.type === "Property" && staticPropKey(p)).map((p) => [staticPropKey(p), node.init.name]);
  }
  return [];
}

function countCall(calls, callee) {
  const c = calleeOf(callee);
  if (!c) return;
  if (!calls.has(c.path)) calls.set(c.path, new Map());
  calls.get(c.path).set(c.root, (calls.get(c.path).get(c.root) || 0) + 1);
}

// `a.b.c(...)` as its root name `a` and its path `.b.c`.
function calleeOf(callee) {
  const parts = [];
  let n = callee;
  while (n?.type === "MemberExpression" && !n.computed && n.property.type === "Identifier") { parts.unshift(n.property.name); n = n.object; }
  return n?.type === "Identifier" && parts.length >= 2 ? { root: n.name, path: "." + parts.join(".") } : null;
}

// `return { a, b: fn, c() {} }`: each exported name with the function it exports, when it is one.
function exportedNames(returned, functions) {
  if (returned?.type !== "ObjectExpression") return [];
  const byName = new Map(functions.map((f) => [f.name, f]));
  return returned.properties.filter((p) => p.type === "Property").map((p) => {
    const name = staticPropKey(p);
    return name ? { name, line: lineOf(p), fn: exportedFunction(p.value, byName) } : null;
  }).filter(Boolean);
}

// The function an export names: a function declared in the module (`{ init }`), or one written in place.
function exportedFunction(value, byName) {
  if (value.type === "Identifier") return byName.get(value.name)?.fn || null;
  return isFunction(value) ? value : null;
}

// A function in one module whose body is a copy of one declared earlier — in another module, or on a page.
function reportModuleCopies(read, byPage, report) {
  const first = new Map();
  for (const m of read) {
    for (const f of m.functions.filter((x) => !x.nested && x.nodeCount >= MIN_DUPLICATE_FUNCTION_NODES)) {
      const owner = first.get(f.shape);
      if (!owner) first.set(f.shape, { m, f });
      else if (owner.m !== m) {
        report(m.name, QUALITY_RULES.duplicateAcrossModules, f.line,
          `\`${f.name}\` of \`${m.name}\` copies \`${owner.f.name}\` of \`${owner.m.name}\` (line ${owner.f.line}) — keep one and import it`);
      }
    }
  }
  for (const page of byPage.values()) {
    for (const h of page?.helpers || []) {
      const owner = first.get(h.shape);
      if (owner) page.findings.push(finding(QUALITY_RULES.duplicateAcrossModules, h.section, h.line,
        `\`${h.name}\` copies \`${owner.f.name}\` of \`${owner.m.name}\` — call the module's function`));
    }
  }
}

// Code in one module that is code of another module with other values (nearcopy.mjs): a function, or a run of its
// statements. An exact copy is left to `reportModuleCopies`.
function reportNearCopies(read, report) {
  const shapeOf = new Map(read.flatMap((m) => m.functions.map((f) => [f.fn, f.shape])));
  const exact = (a, b) => shapeOf.has(a) && shapeOf.get(a) === shapeOf.get(b);
  for (const { copy, original } of nearCopies(read, exact)) {
    const what = copy.whole && original.whole
      ? wholeFunctionAt(copy) + " is " + wholeFunctionAt(original)
      : linesOfFunctionAt(copy) + " repeat " + linesOfFunctionAt(original);
    report(copy.module, QUALITY_RULES.duplicateAcrossModules, copy.from,
      `${what} with other values — keep one function in the shared module that takes those values as parameters, and call it from both`);
  }
}

const codeName = (s) => "`" + s + "`";
const fnLabel = (w) => codeName(w.fnName || "(anonymous)");
const wholeFunctionAt = (w) => `${fnLabel(w)} of ${codeName(w.module)} (lines ${w.from}-${w.to})`;
const linesOfFunctionAt = (w) => `lines ${w.from}-${w.to} of ${fnLabel(w)} in ${codeName(w.module)}`;

// What one module declares that another may declare again, keyed so that a copy under another name still matches:
// a record id by the id; a list of literals by its values, as a set (`["A", "B"]` and `new Set(["B", "A"])` are one
// value); a string by its value and the kind of thing its name says it is, the last word of the name
// (`HISTORY_DATA_SOURCE` and `NOTE_HISTORY_DATA_SOURCE` are one data source, while `CONTRACT_ENTITY` and
// `CHILD_CONTRACT_COLUMN` are an entity and a column that happen to share a name); a number or a boolean by its name
// and value, because a small number means nothing without its name (`AGGREGATION_COUNT = 1` and
// `COMPARISON_IS_NULL = 1` are two values).
function declaredValuesOf(m) {
  const constants = literalConstantsOf(m.factory.body)
    .filter((c) => c.value !== "" && ![c.value, ...(c.list || [])].some(isGuidString));
  return [...m.guids.map((g) => ({ key: g.value, text: g.value, line: g.line })),
    ...constants.map((c) => ({ key: constantValueKey(c), name: c.name, text: `${c.name} = ${c.raw}`, line: c.line }))];
}

const isGuidString = (v) => typeof v === "string" && GUID_RE.test(v);

// A list of strings is one value as a set; a list that holds a number or a boolean, like a single number, keeps its
// name. Each element keeps its type: `[1, 2]` and `["1", "2"]` are two values.
function constantValueKey(c) {
  if (c.list?.every((v) => typeof v === "string")) return "list:" + JSON.stringify(c.list.map((v) => JSON.stringify(v)).sort());
  return typeof c.value === "string" ? `string:${kindOf(c.name)}:${JSON.stringify(c.value)}` : `${c.name} = ${c.raw}`;
}

// The kind of value a constant's name says it holds, upper case: its last word (`NOTE_HISTORY_DATA_SOURCE` and
// `historyDataSource` are `SOURCE`), or its last two words when the last one says nothing about the kind
// (`ENTITY_NAME` is `ENTITY_NAME` and `PARENT_COLUMN_NAME` is `COLUMN_NAME`: an entity and a column, two values).
const GENERIC_NAME_WORDS = new Set(["NAME", "KEY", "CODE", "VALUE", "ID", "TEXT"]);
function kindOf(name) {
  const words = name.split(/_|(?=[A-Z][a-z])/).filter(Boolean).map((w) => w.toUpperCase());
  if (!words.length) return name.toUpperCase();
  const last = words.length - 1;
  return GENERIC_NAME_WORDS.has(words[last]) && last > 0 ? words[last - 1] + "_" + words[last] : words[last];
}

// A record id or a constant's value declared in two or more modules, also under another name: one finding, on the
// record of the second module, naming the first declaration and every other one with the name it has there.
function reportSharedValues(read, report) {
  const where = new Map();
  for (const m of read) {
    for (const d of declaredValuesOf(m)) {
      if (!where.has(d.key)) where.set(d.key, new Map());
      if (!where.get(d.key).has(m.name)) where.get(d.key).set(m.name, d);
    }
  }
  for (const mods of where.values()) {
    if (mods.size < 2) continue;
    const [first, second] = [...mods.values()];
    const [, secondModule] = [...mods.keys()];
    const renamed = (d) => (d.name && d.name !== first.name ? ", as " + codeName(d.name) : "");
    const list = [...mods].map(([n, d]) => `${codeName(n)} (line ${d.line}${renamed(d)})`).join(", ");
    report(secondModule, QUALITY_RULES.sharedValueInTwoModules, second.line,
      `${codeName(first.text)} is declared in ${list} — keep it in the shared module and import it`);
  }
}

// Every source that may use a module's exports or make a call: the page code sections (the ASTs the page lint already
// parsed) and the modules, each with its local names for its imports. A page without `args` has no names
// (`bound: null`): then any `x.<export>` counts as a use, which can only hide an unused export, never invent one.
function importerFacts(pages, byPage, bindings, read) {
  const out = [];
  for (const key of Object.keys(pages)) {
    for (const ast of byPage.get(key)?.asts || []) out.push({ name: null, page: key, bound: bindings.get(key), ...treeFacts(ast) });
  }
  for (const m of read) out.push({ name: m.name, bound: m.argOf, members: m.members, handedOn: m.handedOn, calls: m.calls });
  return out;
}

// Whether a source uses export `prop` of module `name`: reads it through a name bound to the module (or any name,
// when the source has no names), or hands a name bound to the module on whole.
function usesExport(s, name, prop) {
  if (!s.bound) return s.members.has(prop);
  const boundTo = (obj) => s.bound.get(obj) === name;
  return [...(s.members.get(prop) || [])].some(boundTo) || [...s.handedOn].some(boundTo);
}

function reportUnusedExports(read, importers, report) {
  for (const m of read) {
    for (const ex of m.exports) {
      if (importers.some((s) => s.name !== m.name && usesExport(s, m.name, ex.name))) continue;
      report(m.name, QUALITY_RULES.unusedModuleExport, ex.line, `\`${ex.name}\` of \`${m.name}\` is exported but no page or module uses it — remove it from the exports`);
    }
  }
}

// A module function that only FORWARDS one call: its body is that one call, and every argument is built from its
// own parameters with no literal in it (`(r) => sdk.X.process(r)`, `process(Object.assign(config, { … }))`). A
// one-call function with fixed arguments (`process({ type: "crt.LoadDataRequest" })`) does one specific thing, so it
// wraps nothing. The call's root is the module it names (`@creatio-devkit/common` for `sdk`); a root the function
// takes as a parameter can be any module, so that path must name the API precisely (three segments or more).
function wrappedCallOf(fn, argOf) {
  const call = singleCallOf(fn);
  const c = call && calleeOf(call.callee);
  if (!c) return null;
  const params = new Set(fn.params.flatMap((p) => [...bindingNames(p)]));
  const forwards = call.arguments.length > 0 && call.arguments.every((a) => !hasLiteral(a) && [...referencedNames(a)].some((n) => params.has(n)));
  if (!forwards) return null;
  if (params.has(c.root)) return c.path.split(".").length > 3 ? { path: c.path, root: "*" } : null;
  return { path: c.path, root: argOf.get(c.root) ?? `local:${c.root}` };
}

function singleCallOf(fn) {
  let expr = fn.body;
  if (fn.body.type === "BlockStatement") {
    if (fn.body.body.length !== 1) return null;
    const st = fn.body.body[0];
    if (st.type === "ReturnStatement") expr = st.argument;
    else if (st.type === "ExpressionStatement") expr = st.expression;
    else return null;
  }
  if (expr?.type === "AwaitExpression") expr = expr.argument;
  return expr?.type === "CallExpression" ? expr : null;
}

function hasLiteral(node) {
  let found = false;
  walkAstBounded(node, (n) => { if (n.type === "Literal" && n.value !== null && typeof n.value !== "boolean") found = true; });
  return found;
}

// One wrapper per call, the one to reuse: an exported one first, then one in a shared module.
function chosenWrappers(read, ownModules) {
  const all = read.flatMap((m) => m.functions.filter((f) => !f.nested).map((f) => ({ m, f, wrap: wrappedCallOf(f.fn, m.argOf),
    exported: m.exports.some((ex) => ex.fn === f.fn), shared: !ownModules.has(m.name) }))).filter((w) => w.wrap);
  const rank = (w) => (w.exported ? 0 : 2) + (w.shared ? 0 : 1);
  return [...groupBy(all, (w) => w.wrap.path + "|" + w.wrap.root).values()].map((group) => group.slice().sort((a, b) => rank(a) - rank(b))[0]);
}

// How many times a source makes the wrapped call itself: the same path on a root bound to the same module (any
// root, for a wrapper that takes its root as a parameter). A source without names cannot tell its roots apart, so
// only the any-root wrappers are matched there.
function directCalls(s, w) {
  let n = 0;
  for (const [root, count] of s.calls.get(w.wrap.path) || []) {
    if (w.wrap.root === "*" || s.bound?.get(root) === w.wrap.root) n += count;
  }
  return n - (s.name === w.m.name ? 1 : 0);
}

function reportInlinedWrappers(read, importers, report, ownModules, byPage) {
  for (const w of chosenWrappers(read, ownModules)) {
    for (const s of importers) {
      const n = directCalls(s, w);
      if (n >= 1) fileInlinedCall(w, s, n, report, byPage);
    }
  }
}

// A module's finding goes to the module record; a page's to the page itself.
function fileInlinedCall(w, s, n, report, byPage) {
  const how = w.exported || s.name === w.m.name ? "call it" : "export it and call it";
  const who = s.name ? `\`${s.name}\`` : "the page";
  const text = `${who} calls \`${w.wrap.path.slice(1)}\` ${n} time(s) directly although \`${w.m.name}.${w.f.name}\` wraps it — ${how}`;
  if (s.name) report(s.name, QUALITY_RULES.wrappedCallInlined, 0, text);
  else byPage.get(s.page)?.findings.push(finding(QUALITY_RULES.wrappedCallInlined, "handlers", 0, text));
}
