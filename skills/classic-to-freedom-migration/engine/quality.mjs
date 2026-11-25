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
import { parseJsExpression, parseDefineModule, staticPropKey, childNodesOf, isFnNode, walkAstBounded } from "./engine.mjs";
import { GUID_RE } from "./conventions.mjs";

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
]);

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
const isFunction = (n) => isFnNode(n) || n?.type === "FunctionDeclaration";
const lineOf = (n) => n?.loc?.start?.line ?? 0;
const finding = (rule, section, line, text, extra = {}) => ({ rule, section, line, text, ...extra });

// ---- one page ----

// Lint one built page. Returns null when the bundle carries none of the code sections (the row then asks for the
// bundle, never passes silently); otherwise the page's findings and the helpers the run-wide check compares.
export function lintPageQuality(entry, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  if (!entry || typeof entry !== "object") return null;
  const sources = SECTIONS.filter((s) => typeof entry[s] === "string");
  if (!sources.length) return null;
  const page = { findings: [], helpers: [], unreadable: [] };
  // `fnNames` names a function by where it is defined: a handler by its request, a helper by its variable.
  const ctx = { page, t: thresholds, constantsGuids, fnNames: new WeakMap() };
  for (const section of sources) lintSection(entry[section], section, ctx);
  reportDuplicateHelpers(page);
  for (const key of unusedResourceStrings(entry, sources)) {
    page.findings.push(finding(QUALITY_RULES.unusedResourceString, "resources", 0, `\`${key}\``, { advisory: true }));
  }
  return page;
}

// Lint one client module (`define("Name", [deps], function (…) { … })`), the code a page's handlers call into. The
// per-node rules, the unchecked writes and the plan codes in comments apply; the handler rules do not, since a module
// holds no handlers. The findings name the section `module`; a source that is not a readable define() is reported in
// `unreadable`; `name` is the module's schema name, carried on the result.
export function lintModuleQuality(name, src, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  const page = { name, findings: [], helpers: [], unreadable: [] };
  const comments = [];
  const parsed = parseDefineModule(src, { locations: true, onComment: comments });
  if (parsed.error) { page.unreadable.push("module"); return page; }
  lintTree(parsed.factory.body, comments, "module", { page, t: thresholds, constantsGuids, fnNames: new WeakMap() });
  return page;
}

function lintSection(src, section, ctx) {
  const comments = [];
  const ast = parseJsExpression(src, { locations: true, onComment: comments });
  if (!ast) { ctx.page.unreadable.push(section); return; }
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
  checkSequentialAwaits(handler.body, page, t);
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

// True when every way out of a statement is a `return` or a `throw`: the body cannot run off its end.
function endsInReturn(s) {
  if (!s) return false;
  if (s.type === "ReturnStatement" || s.type === "ThrowStatement") return true;
  if (s.type === "BlockStatement") return endsInReturn(s.body.at(-1));
  if (s.type === "IfStatement") return endsInReturn(s.consequent) && endsInReturn(s.alternate);
  if (s.type === "TryStatement") {
    return endsInReturn(s.finalizer) || (endsInReturn(s.block) && (!s.handler || endsInReturn(s.handler.body)));
  }
  return false;
}

// The name of a handler's `next` parameter (`next` or `next = null`), or null when it takes none.
function nextParamName(handler) {
  const p = handler.params[1];
  const id = p?.type === "AssignmentPattern" ? p.left : p;
  return id?.type === "Identifier" ? id.name : null;
}

// A handler passes the request on: it takes `next`, calls `next.handle(…)` and returns what that call gives on EVERY
// path (directly, or through a variable it assigned the call to; an arrow's expression body is what it returns; a
// bare `return;` or running off the end returns nothing). Anything else ends the chain for the handlers after it on
// that path; a handler meant to end it is accepted by a plan decision on the row.
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
  const givesNext = (value) => {
    const v = unwrap(value);
    return isNextCall(v, nextName) || (v?.type === "Identifier" && fromNext.has(v.name));
  };
  const passesOn = handler.body.type === "BlockStatement"
    ? endsInReturn(handler.body) && own.every((n) => n.type !== "ReturnStatement" || (n.argument && givesNext(n.argument)))
    : givesNext(handler.body);
  if (!passesOn) fail("calls `next.handle(request)` but does not return its result");
}

// ---- writes ----

const WRITE_METHODS = new Set(["insert", "update", "delete"]);
const memberName = (n) => (n?.type === "Identifier" ? n.name : n?.type === "MemberExpression" && !n.computed ? n.property.name : null);
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
  return { name, line: lineOf(anchor), section: "handlers", shape: parts.join(""), nodeCount, free, nested };
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
function checkSequentialAwaits(node, page, t, depth = 0) {
  if (!node || depth > 1000) return;
  if (node.type === "BlockStatement") checkBlockAwaits(node, page, t);
  for (const child of childNodes(node)) checkSequentialAwaits(isFunction(child) ? child.body : child, page, t, depth + 1);
}

function checkBlockAwaits(block, page, t) {
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
  page.findings.push(finding(QUALITY_RULES.sequentialAwaits, "handlers", lineOf(first),
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
// page. `pages` is `{ pageKey: bundle entry }`.
export function lintRunQuality(pages, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  const byPage = new Map();
  for (const [key, entry] of Object.entries(pages || {})) byPage.set(key, lintPageQuality(entry, thresholds, constantsGuids));
  const helperOwners = new Map();
  for (const [key, page] of byPage) {
    for (const h of page?.helpers || []) if (!helperOwners.has(h.shape)) helperOwners.set(h.shape, { key, helper: h });
  }
  for (const [key, page] of byPage) if (page) reportCopiesFromOtherPages(key, page, helperOwners);
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
// The key of one thresholds + constants-module combination, built once per set of rows (see `codeQualityRows`).
export const qualityRunKey = (thresholds, constantsGuids) =>
  JSON.stringify(thresholds) + "|" + [...(constantsGuids || [])].sort((a, b) => a.localeCompare(b)).join();
export function runQualityOf(root, thresholds, constantsGuids, cacheKey = qualityRunKey(thresholds, constantsGuids)) {
  const pages = root?.pages && typeof root.pages === "object" ? root.pages : { main: root };
  let perRoot = RUN_CACHE.get(root);
  if (!perRoot) { perRoot = new Map(); RUN_CACHE.set(root, perRoot); }
  if (!perRoot.has(cacheKey)) perRoot.set(cacheKey, lintRunQuality(pages, thresholds, new Set(constantsGuids || [])));
  return perRoot.get(cacheKey);
}
