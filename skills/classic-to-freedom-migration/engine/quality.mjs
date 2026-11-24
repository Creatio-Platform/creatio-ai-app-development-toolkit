// CODE QUALITY of the built pages — the `--verify` rows that measure what a reviewer would otherwise count by hand:
// long functions, helpers nested in handlers or copied between them, catch blocks that swallow errors, bare numeric
// comparison types, loads that wait for each other for no reason, hard-coded record ids, plan codes left in
// comments, requests nobody sends and strings nobody shows.
//
// The per-page rules share their ids and thresholds with clio's page-body lint (`PageBodyAstLinter.Quality.cs`),
// which gives the same findings as save-time warnings in every flow. Here they BLOCK: a page that breaks one is not
// done. Both sides are kept in step by hand — a rule or threshold changed here is changed there too.
//
// Everything is read from get-page's bundle as the read-back filed it (`handlers`, `validators`, `converters` are
// SOURCE strings; `viewConfig`, `viewModelConfig`, `modelConfig`, `resources` are JSON). Nothing is evaluated.
import { parseJsExpression, staticPropKey, childNodesOf, isFnNode } from "./engine.mjs";
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
});

// The manifest's `qualityThresholds` override these, key by key.
export const DEFAULT_QUALITY_THRESHOLDS = Object.freeze({
  maxFunctionLines: 60,
  maxNestedFunctionsPerHandler: 3,
  maxSequentialIndependentAwaits: 2,
});

// What each rule's row says it checks, in the order the rows are shown. A finding marked `advisory` is noted, never
// blocking; every unused-string finding is one.
export const QUALITY_ROW_RULES = Object.freeze([
  { rule: QUALITY_RULES.functionTooLong, label: (t) => `no function longer than ${t.maxFunctionLines} lines` },
  { rule: QUALITY_RULES.nestedFunctions, label: (t) => `no handler declaring more than ${t.maxNestedFunctionsPerHandler} functions in its body` },
  { rule: QUALITY_RULES.duplicateInPage, label: () => "no helper declared twice on the page" },
  { rule: QUALITY_RULES.duplicateAcrossPages, label: () => "no helper copied from another page of the run" },
  { rule: QUALITY_RULES.catchLogOnly, label: () => "no catch block that only logs the error" },
  { rule: QUALITY_RULES.numericComparisonType, label: () => "no bare numeric `comparisonType`" },
  { rule: QUALITY_RULES.sequentialAwaits, label: (t) => `no more than ${t.maxSequentialIndependentAwaits} independent model loads awaited one after another` },
  { rule: QUALITY_RULES.guidLiteral, label: () => "no hard-coded record id a project constants module holds" },
  { rule: QUALITY_RULES.planCodeInComment, label: () => "no plan code (card, AC, decision id) in a comment" },
  { rule: QUALITY_RULES.requestWithoutSender, label: () => "every custom request the page handles has a sender" },
  { rule: QUALITY_RULES.unusedResourceString, label: () => "resource strings in use (advisory)" },
]);

// A named helper smaller than this many AST nodes (`v => v`) is not worth moving to a module, so copies of it are
// not reported.
const MIN_DUPLICATE_FUNCTION_NODES = 8;
const SECTIONS = ["handlers", "validators", "converters"];
// A card id (`C04`, `shared/C04`), an AC number (`AC-16`), a decision id (`D8`) or a card path (`card PIS/`).
const PLAN_CODE = /(?:\b[\w-]+\/)?\bC\d{2,}\b|\bAC-\d+\b|\bD\d+\b|\bcard [\w-]+\//g;
const RESOURCE_REF = /#ResourceString\(([^)#]+)\)#|\$?Resources\.Strings\.([A-Za-z0-9_]+)/g;

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

// ---- one page ----

// Lint one built page. Returns null when the bundle carries none of the code sections (the row then asks for the
// bundle, never passes silently); otherwise the page's findings and what the run-wide checks need from it.
export function lintPageQuality(entry, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  if (!entry || typeof entry !== "object") return null;
  const sources = SECTIONS.filter((s) => typeof entry[s] === "string");
  if (!sources.length) return null;
  // `requestKeys` are the `request` literals of the handler entries: naming the request a handler answers is not
  // sending it, so they stay out of `strings` (the values a sender could be).
  const page = { findings: [], helpers: [], handled: [], requestKeys: new Set(), strings: new Set(), unreadable: [] };
  for (const section of sources) {
    const comments = [];
    const ast = parseJsExpression(entry[section], { locations: true, onComment: comments });
    if (!ast) { page.unreadable.push(section); continue; }
    if (section === "handlers" && ast.type === "ArrayExpression") lintHandlers(ast, page, thresholds);
    walkSection(ast, section, null, page, thresholds, constantsGuids);
    for (const c of comments) {
      const codes = [...c.value.matchAll(PLAN_CODE)].map((m) => m[0]);
      if (codes.length) {
        page.findings.push(finding(QUALITY_RULES.planCodeInComment, section, c.loc.start.line,
          `${codes.length} plan code(s) in a comment: ${[...new Set(codes)].map((code) => "`" + code + "`").join(", ")}`, { value: codes.length }));
      }
    }
  }
  const helpersByShape = groupBy(page.helpers, (h) => h.shape);
  for (const copies of helpersByShape.values()) {
    for (const copy of copies.slice(1)) {
      page.findings.push(finding(QUALITY_RULES.duplicateInPage, copy.section, copy.line,
        `\`${copy.name}\` repeats \`${copies[0].name}\` (line ${copies[0].line}); declared ${copies.length} times`));
    }
  }
  collectJsonStrings([entry.viewConfig, entry.viewModelConfig, entry.modelConfig], page.strings);
  for (const key of unusedResourceStrings(entry, sources)) {
    page.findings.push(finding(QUALITY_RULES.unusedResourceString, "resources", 0, `\`${key}\``, { advisory: true }));
  }
  return page;
}

const finding = (rule, section, line, text, extra = {}) => ({ rule, section, line, text, ...extra });

// The single-node rules, over one whole section. `ownerKey` is the key of the property whose value the node is, so
// an element's own `id` is told apart from a record id used as data.
function walkSection(node, section, ownerKey, page, t, constantsGuids, depth = 0) {
  if (!node || depth > 1000) return;
  if (isFunction(node)) {
    const lines = node.loc.end.line - node.loc.start.line + 1;
    if (lines > t.maxFunctionLines) {
      page.findings.push(finding(QUALITY_RULES.functionTooLong, section, lineOf(node),
        `${node.id?.name ? "`" + node.id.name + "` is " : ""}${lines} lines (limit ${t.maxFunctionLines})`, { value: lines, limit: t.maxFunctionLines }));
    }
  } else if (node.type === "CatchClause" && node.body.body.every(isConsoleCall)) {
    page.findings.push(finding(QUALITY_RULES.catchLogOnly, section, lineOf(node), "the catch block only logs the error"));
  } else if (node.type === "Property" && staticPropKey(node) === "comparisonType" && node.value?.type === "Literal" && typeof node.value.value === "number") {
    page.findings.push(finding(QUALITY_RULES.numericComparisonType, section, lineOf(node), `\`comparisonType: ${node.value.raw}\``));
  } else if (node.type === "Literal" && typeof node.value === "string") {
    if (ownerKey !== "id" && GUID_RE.test(node.value)) {
      const guid = node.value.toLowerCase();
      page.findings.push(finding(QUALITY_RULES.guidLiteral, section, lineOf(node), `\`${node.value}\``, { advisory: !constantsGuids.has(guid) }));
    }
    if (!page.requestKeys.has(node)) addSenderCandidate(page.strings, node.value);
  }
  for (const child of childNodes(node)) {
    const owner = node.type === "Property" && child === node.value ? staticPropKey(node) : null;
    walkSection(child, section, owner, page, t, constantsGuids, depth + 1);
  }
}

const isConsoleCall = (s) => s.type === "ExpressionStatement" && s.expression.type === "CallExpression"
  && s.expression.callee.type === "MemberExpression" && s.expression.callee.object.type === "Identifier" && s.expression.callee.object.name === "console";

// ---- handlers ----

function lintHandlers(array, page, t) {
  for (const entry of array.elements) {
    if (entry?.type !== "ObjectExpression") continue;
    let handler = null;
    for (const p of entry.properties) {
      const key = p.type === "Property" ? staticPropKey(p) : null;
      if (key === "request" && p.value.type === "Literal" && typeof p.value.value === "string") {
        page.handled.push({ request: p.value.value, line: lineOf(p) });
        page.requestKeys.add(p.value);
      }
      if (key === "handler" && isFunction(p.value)) handler = p.value;
    }
    if (!handler) continue;
    const helpers = [];
    collectNamedFunctions(handler.body, helpers);
    // The handler's own variables: its parameters and what its body declares outside the functions in it. A sibling
    // helper is not one of them — a helper calling another moves to the module with it.
    const helperNames = new Set(helpers.map((h) => h.name));
    const handlerNames = new Set([...handler.params.flatMap((p) => [...bindingNames(p)]), ...declaredNamesIn(handler.body, { intoFunctions: false })]
      .filter((n) => !helperNames.has(n)));
    for (const h of helpers) {
      if (h.nodeCount >= MIN_DUPLICATE_FUNCTION_NODES && !usesHandlerVariables(h, handlerNames)) page.helpers.push(h);
    }
    if (helpers.length > t.maxNestedFunctionsPerHandler) {
      page.findings.push(finding(QUALITY_RULES.nestedFunctions, "handlers", lineOf(handler),
        `${helpers.length} functions in one handler (limit ${t.maxNestedFunctionsPerHandler}): ${helpers.map((h) => h.name).join(", ")}`,
        { value: helpers.length, limit: t.maxNestedFunctionsPerHandler }));
    }
    checkSequentialAwaits(handler.body, page, t);
  }
}

// Named functions only (`function name() {}`, `const name = () => {}`): an inline callback is not a helper.
function collectNamedFunctions(node, out, depth = 0) {
  if (!node || depth > 1000) return;
  if (node.type === "FunctionDeclaration" && node.id) out.push(describeHelper(node.id.name, node, node));
  else if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && isFunction(node.init)) out.push(describeHelper(node.id.name, node, node.init));
  for (const child of childNodes(node)) collectNamedFunctions(child, out, depth + 1);
}

function describeHelper(name, anchor, fn) {
  const parts = [];
  let nodeCount = 0;
  const shape = (n, depth = 0) => {
    if (!n || depth > 1000) return;
    nodeCount++;
    parts.push("(" + n.type + (n.type === "Identifier" ? " " + n.name : n.type === "Literal" ? " " + n.raw : ""));
    for (const child of childNodes(n)) shape(child, depth + 1);
    parts.push(")");
  };
  for (const p of fn.params) shape(p);
  shape(fn.body);
  const own = new Set([name, ...fn.params.flatMap((p) => [...bindingNames(p)]), ...declaredNamesIn(fn.body, { intoFunctions: true })]);
  const free = [...referencedNames(fn.body)].filter((n) => !own.has(n));
  return { name, line: lineOf(anchor), section: "handlers", shape: parts.join(""), nodeCount, free };
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
  for (const child of childNodes(node)) referencedNames(child, out, depth + 1);
  return out;
}

// Within each block: the awaited model loads (`await x.load(…)`, `await sdk.Model.create(…)`) that use no earlier
// load's result, followed through the variables assigned from it.
function checkSequentialAwaits(node, page, t, depth = 0) {
  if (!node || depth > 1000) return;
  if (node.type === "BlockStatement") {
    const fromLoads = new Set();
    let independent = 0;
    let first = null;
    for (const statement of node.body) {
      // Nothing can depend on a load before the first one, so the statement is only read once there is one.
      const usesLoad = fromLoads.size > 0 && [...referencedNames(statement)].some((n) => fromLoads.has(n));
      const isLoad = isAwaitedLoad(statement);
      if (isLoad && !usesLoad) { independent++; first ??= statement; }
      if (isLoad || usesLoad) statementBindings(statement).forEach((n) => fromLoads.add(n));
    }
    if (independent > t.maxSequentialIndependentAwaits) {
      page.findings.push(finding(QUALITY_RULES.sequentialAwaits, "handlers", lineOf(first),
        `${independent} independent model loads awaited one after another (limit ${t.maxSequentialIndependentAwaits})`,
        { value: independent, limit: t.maxSequentialIndependentAwaits }));
    }
  }
  for (const child of childNodes(node)) if (!isFunction(child)) checkSequentialAwaits(child, page, t, depth + 1);
}

function isAwaitedLoad(statement) {
  let expr = null;
  if (statement.type === "ExpressionStatement") expr = statement.expression.type === "AssignmentExpression" ? statement.expression.right : statement.expression;
  else if (statement.type === "VariableDeclaration" && statement.declarations.length === 1) expr = statement.declarations[0].init;
  const call = expr?.type === "AwaitExpression" ? expr.argument : null;
  const callee = call?.type === "CallExpression" ? call.callee : null;
  if (callee?.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return false;
  if (callee.property.name === "load") return true;
  const obj = callee.object;
  return callee.property.name === "create" && ((obj.type === "Identifier" && obj.name === "Model")
    || (obj.type === "MemberExpression" && !obj.computed && obj.property.name === "Model"));
}

// The names a statement binds: the declared variables of a declaration, or the assigned identifier of an assignment.
function statementBindings(statement) {
  if (statement.type === "VariableDeclaration") return statement.declarations.flatMap((d) => [...bindingNames(d.id)]);
  if (statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression" && statement.expression.left.type === "Identifier") {
    return [statement.expression.left.name];
  }
  return [];
}

// ---- strings and resources ----

// Only a string that could name a custom request (`ns.Name`, not `crt.`) is kept: it is all the sender check reads.
function addSenderCandidate(out, s) {
  if (s.includes(".") && !/^crt\./i.test(s)) out.add(s);
}

function collectJsonStrings(values, out, depth = 0) {
  for (const v of values) {
    if (typeof v === "string") addSenderCandidate(out, v);
    else if (v && typeof v === "object" && depth < 200) collectJsonStrings(Array.isArray(v) ? v : Object.values(v), out, depth + 1);
  }
}

// Resource strings no binding, caption or code on the page names. The bundle merges the template's strings with
// the page's own, so a template string the template's code uses is reported too — the row is advisory for that.
function unusedResourceStrings(entry, sources) {
  const res = entry.resources;
  const strings = res && typeof res === "object" ? (res.strings && typeof res.strings === "object" ? res.strings : res) : null;
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

// Every built page of the run linted once, then the checks that need more than one page: a helper copied from
// another page, and a custom request no page sends. `pages` is `{ pageKey: bundle entry }`.
export function lintRunQuality(pages, thresholds = DEFAULT_QUALITY_THRESHOLDS, constantsGuids = new Set()) {
  const byPage = new Map();
  for (const [key, entry] of Object.entries(pages || {})) byPage.set(key, lintPageQuality(entry, thresholds, constantsGuids));
  const sent = new Set();
  for (const page of byPage.values()) page?.strings.forEach((s) => sent.add(s));
  const helperOwners = new Map();
  for (const [key, page] of byPage) {
    for (const h of page?.helpers || []) {
      if (!helperOwners.has(h.shape)) helperOwners.set(h.shape, { key, helper: h });
    }
  }
  for (const [key, page] of byPage) {
    if (!page) continue;
    const seen = new Set();
    for (const h of page.helpers) {
      const owner = helperOwners.get(h.shape);
      if (owner.key !== key && !seen.has(h.shape)) {
        seen.add(h.shape);
        page.findings.push(finding(QUALITY_RULES.duplicateAcrossPages, h.section, h.line, `\`${h.name}\` copies \`${owner.helper.name}\` of page \`${owner.key}\``));
      }
    }
    for (const { request, line } of page.handled) {
      if (!/^crt\./i.test(request) && !sent.has(request)) {
        page.findings.push(finding(QUALITY_RULES.requestWithoutSender, "handlers", line, `\`${request}\` is handled but no page of the run sends it`));
      }
    }
  }
  return byPage;
}

// The run's findings, built once per `--built` root: the verify rows of every page read the same result.
const RUN_CACHE = new WeakMap();
// The key of one thresholds + constants-module combination, built once per set of rows (see `codeQualityRows`).
export const qualityRunKey = (thresholds, constantsGuids) => JSON.stringify(thresholds) + "|" + [...(constantsGuids || [])].sort().join();
export function runQualityOf(root, thresholds, constantsGuids, cacheKey = qualityRunKey(thresholds, constantsGuids)) {
  const pages = root?.pages && typeof root.pages === "object" ? root.pages : { main: root };
  let perRoot = RUN_CACHE.get(root);
  if (!perRoot) { perRoot = new Map(); RUN_CACHE.set(root, perRoot); }
  if (!perRoot.has(cacheKey)) perRoot.set(cacheKey, lintRunQuality(pages, thresholds, new Set(constantsGuids || [])));
  return perRoot.get(cacheKey);
}

