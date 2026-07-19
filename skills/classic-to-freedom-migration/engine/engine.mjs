// Ф2 — Merge engine. Pure Node module, no Creatio/stand dependency.
// Parses classic ClientUnitSchema schema bodies and merges N schemas (base->top)
// into one effective page model + provenance.
import { parse as acornParse } from "./vendor/acorn.mjs";

// Build the parse RESULT from the extracted schema object `s` (+ text-scanned signals from `src`).
// Kept separate from the AST extraction so the "what fields the merge consumes" shape lives in one place.
function buildSchemaResult(pkg, src, parseError, s, amdDeps) {
  return {
    pkg,
    error: parseError,
    entitySchemaName: typeof s.entitySchemaName === "string" ? s.entitySchemaName : "?",
    diff: normalizeDiff(s.diff),
    businessRules: plainObj(s.businessRules),
    rules: plainObj(s.rules),
    details: normalizeDetails(s.details),
    methods: safeKeys(s.methods),
    attributes: safeKeys(s.attributes),
    modules: normalizeModules(s.modules),
    // feature toggles referenced in the body (getIsFeatureEnabled('X')) — which element each gates
    // lives in method bodies (imperative → judgment), so we surface the NAMES for a decision.
    features: [...new Set([...src.matchAll(/getIsFeatureEnabled\(\s*["']([\w.]+)["']/g)].map(mt => mt[1]))],
    // custom card-ACTION hints — the ACTIONS menu is built imperatively in getActions, so static parsing
    // can't fully reconstruct it. Scan ONLY the getActions body, not the whole file: `"Tag"` is a common
    // diff-item/button/config property elsewhere, and scanning globally over-captured non-action strings
    // into the decision worklist. Surface (a) navigate/goTo handlers and (b) action `Tag` values (menu-item
    // handler tags, e.g. runEscalation / runSearchForSimilarCases) from that body so real actions aren't lost.
    actionHints: (() => {
      const body = extractFnBody(src, "getActions");
      if (!body) return [];
      return [...new Set([
        ...[...body.matchAll(/\b((?:navigateTo|goTo|GoTo)[A-Z]\w+)/g)].map(mt => mt[1]),
        ...[...body.matchAll(/"Tag"\s*:\s*"([^"]{2,})"/g)].map(mt => mt[1]),
      ])];
    })(),
    // referenced UI modules from the define() dep list (Fix 3): custom modules that RENDER UI outside
    // this page's own diff (e.g. CasesEstimateLabel → the SLA timer + its START/END buttons). Surfaced
    // so the mapper flags them — the page-schema migration unit cannot see their rendered surface.
    refModules: referencedUiModules(amdDeps),
    // #8c — does this schema LAUNCH a business process imperatively (a "Run process" action / handler)?
    // Detected by the classic process-launch APIs. The process NAMES (when quoted) are captured so the
    // mapper can name them; a run-process action maps to a Freedom "Run process" card action / handler.
    processLaunch: (() => {
      if (!/ProcessModuleUtilities|executeProcess|RunProcessRequest|\brunProcess\b|showProcessPage|openProcessByRecord|ProcessSchemaManager/.test(src)) return null;
      const names = [...new Set([...src.matchAll(/["']([A-Za-z][\w.]*(?:Process|SecurityCheck|Recruiting)[\w.]*)["']/g)].map(mt => mt[1]))];
      return { names };
    })(),
    // ---- SECTION-schema signals (meaningful for *Section schemas; empty/null for pages) ----
    // add-record mini page: whether the section adds records via a quick-add MINI PAGE (and which one),
    // vs opening the full edit page. `getAddRecordMiniPage()` returning a quoted schema name = that mini
    // page; returning empty/null = none; a bare `useAddRecordMiniPage: true` = uses one (name unknown).
    addRecordMiniPage: (() => {
      const body = extractFnBody(src, "getAddRecordMiniPage");
      if (body) {
        const m = /return\s+["']([A-Za-z]\w+)["']/.exec(body);
        if (m) return m[1];
        if (/return\s+(?:null|""|'')/.test(body)) return null;
        return true;
      }
      return /useAddRecordMiniPage\s*[:=]\s*true/.test(src) ? true : null;
    })(),
    // section-level actions (bulk / section-toolbar) built in getSectionActions — a SEPARATE surface from
    // the record page's getActions. Surface the handler tags / navigate hints (#8b).
    sectionActions: (() => {
      const body = extractFnBody(src, "getSectionActions");
      if (!body) return [];
      return [...new Set([
        ...[...body.matchAll(/"Tag"\s*:\s*"([^"]{2,})"/g)].map(mt => mt[1]),
        ...[...body.matchAll(/\b((?:navigateTo|goTo|run|open|process)[A-Z]\w+)/g)].map(mt => mt[1]),
      ])];
    })(),
    // section grid columns IF the schema hardcodes them (getGridDataColumns / initColumnsConfig). Most
    // sections keep columns in PROFILE DATA, not the schema → this is usually empty and the mapper flags
    // it as data-driven (#2).
    listColumns: (() => {
      const body = extractFnBody(src, "getGridDataColumns") || extractFnBody(src, "initColumnsConfig") || "";
      if (!body) return [];
      return [...new Set([...body.matchAll(/(?:"?(?:path|bindTo)"?)\s*:\s*["']([A-Za-z][\w.]*)["']/g)].map(mt => mt[1]))];
    })(),
  };
}

// ---- Schema parser: reads the define() return object WITHOUT executing it. ----
// SECURITY: the previous implementation ran the body through vm.runInNewContext. node:vm is NOT a safe
// boundary (a body can escape via define.constructor.constructor("return process")()), an RCE risk once
// SKILL step 4 feeds bodies fetched from a live stand into the engine. This instead parses `src` to an AST
// and statically evaluates the returned object literal — no code runs, so a hostile body cannot reach
// process/fs/env. Anything it cannot resolve statically is left null AND recorded in `astDiagnostics`
// (fail-loud) rather than silently guessed.
const AST_VIEW_ITEM_TYPE = { GRID_LAYOUT: 0, DETAIL: 2, CONTROL_GROUP: 15 };
// The classic Terrasoft.core.enums vocabulary the mapper also switches on — one named source of truth so the
// two files never drift on a raw itemType/contentType literal (an off-by-value waiting to happen).
export const VIEW_ITEM_TYPE = AST_VIEW_ITEM_TYPE; // ViewItemType: GridLayout 0 · Detail 2 · ControlGroup 15
export const CONTENT_TYPE = { LOOKUP: 5 };        // ContentType.Lookup (a column rendered via a picker)
// Depth cap for the static evaluator: the body is UNTRUSTED, so a pathologically deep-nested literal must
// not blow the call stack (DoS). `path.length` is the current nesting depth — bail to null + a diagnostic
// well before any real stack limit. Real page schemas nest only a handful of levels; 500 is unreachable by
// legitimate input yet far under Node's stack ceiling.
const MAX_AST_DEPTH = 500;
const AST_RULE_TYPE = { BINDPARAMETER: 0, FILTRATION: 1 };
const AST_PROPERTY = { VISIBLE: 0, ENABLED: 1, REQUIRED: 2, READONLY: 3 };
const AST_FN = Symbol("fn"); // placeholder for function values (methods/attributes) — only their KEYS matter

// Walk a member chain to the value it lands on, mirroring the vm proxy graph: a known enum member resolves
// to its number; everything else collapses to null (exactly what the proxies did). Never flags — vm→null too.
function resolveMemberValue(node, scope) {
  const path = [];
  let cur = node;
  while (cur && cur.type === "MemberExpression") {
    if (cur.computed) return null;                 // dynamic index -> proxy -> null under vm too
    const p = cur.property;
    const name = p.type === "Identifier" ? p.name : (p.type === "Literal" ? String(p.value) : null);
    if (name == null) return null;
    path.unshift(name);
    cur = cur.object;
  }
  // If the base is an Identifier that ALIASES an enum member chain, splice the alias's own chain in front so
  // `vt.GridLayout` (where `var vt = Terrasoft.core.enums.ViewItemType`) resolves exactly like the full path.
  let guard = 0;
  while (cur && cur.type === "Identifier" && scope.has(cur.name) && scope.get(cur.name).kind === "memberAlias" && guard++ < 20) {
    let a = scope.get(cur.name).node, seg = [];
    while (a && a.type === "MemberExpression") {
      if (a.computed) return null;
      const nm = a.property.type === "Identifier" ? a.property.name : (a.property.type === "Literal" ? String(a.property.value) : null);
      if (nm == null) return null;
      seg.unshift(nm); a = a.object;
    }
    path.unshift(...seg); cur = a;
  }
  let tag;
  if (cur && cur.type === "ThisExpression") tag = "this";
  else if (cur && cur.type === "Identifier") {
    if (scope.has(cur.name)) tag = scope.get(cur.name).kind === "brm" ? "brm" : "proxy"; // param shadows global
    else if (cur.name === "Terrasoft") tag = "terrasoft";
    else tag = "proxy";
  } else return null;
  for (const k of path) {
    if (tag === "this") { tag = k === "BusinessRuleModule" ? "brm" : "proxy"; continue; }
    if (tag === "brm") { tag = k === "enums" ? "brm.enums" : "proxy"; continue; }
    if (tag === "brm.enums") { tag = k === "RuleType" ? "t:rule" : (k === "Property" ? "t:prop" : "proxy"); continue; }
    if (tag === "terrasoft") { tag = k === "ViewItemType" ? "t:vit" : (k === "controls" ? "terrasoft.controls" : (k === "core" ? "terrasoft.core" : "proxy")); continue; }
    if (tag === "terrasoft.controls") { tag = k === "ViewItemType" ? "t:vit" : "proxy"; continue; }
    if (tag === "terrasoft.core") { tag = k === "enums" ? "terrasoft.core.enums" : "proxy"; continue; }
    if (tag === "terrasoft.core.enums") { tag = k === "ViewItemType" ? "t:vit" : "proxy"; continue; }
    if (tag === "t:vit") return k in AST_VIEW_ITEM_TYPE ? AST_VIEW_ITEM_TYPE[k] : null;
    if (tag === "t:rule") return k in AST_RULE_TYPE ? AST_RULE_TYPE[k] : null;
    if (tag === "t:prop") return k in AST_PROPERTY ? AST_PROPERTY[k] : null;
    return null; // proxy (or already a value) — any further access is null
  }
  return null; // ended on a resolver, not a concrete value
}

function makeAstEvaluator(scope, diagnostics, src) {
  const snippet = (n) => { try { return src.slice(n.start, Math.min(n.end, n.start + 60)).replace(/\s+/g, " "); } catch { return "?"; } };
  const flag = (kind, node, path) => diagnostics.push({ kind, path: path.join("."), snippet: snippet(node) });
  function evalNode(node, path) {
    if (!node) return null;
    if (path.length > MAX_AST_DEPTH) { flag("max-nesting-depth", node, path); return null; }
    switch (node.type) {
      case "Literal": return node.value instanceof RegExp ? null : node.value;
      case "TemplateLiteral":
        if (node.expressions.length === 0) return node.quasis.map(q => q.value.cooked).join("");
        flag("dynamic-template", node, path); return null;
      case "ObjectExpression": {
        const out = {};
        for (const p of node.properties) {
          if (p.type === "SpreadElement") { flag("spread-in-object", p, path); continue; }
          if (p.computed) { flag("computed-key", p, path); continue; }
          const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          out[key] = evalNode(p.value, [...path, key]);
        }
        return out;
      }
      case "ArrayExpression":
        return node.elements.map((el, i) => {
          if (!el) return null;
          if (el.type === "SpreadElement") { flag("spread-in-array", el, path); return null; }
          return evalNode(el, [...path, i]);
        });
      case "MemberExpression": return resolveMemberValue(node, scope);
      case "FunctionExpression":
      case "ArrowFunctionExpression": return AST_FN; // methods/attributes: only keys are read downstream
      case "Identifier":
        if (node.name === "undefined") return undefined;
        if (scope.has(node.name)) {
          const m = scope.get(node.name);
          if (m.kind === "value") return m.value;
          if (m.kind === "node") return evalNode(m.node, path); // lazy alias: evaluate at the REFERENCE path with the real sink
          return null; // proxy / BusinessRuleModule param — not a static value
        }
        flag("unresolved-identifier", node, path); return null;
      case "UnaryExpression": {
        const v = evalNode(node.argument, path);
        if (node.operator === "-" && typeof v === "number") return -v;
        if (node.operator === "+" && typeof v === "number") return +v;
        if (node.operator === "!") return !v;
        return null;
      }
      case "BinaryExpression": {
        const l = evalNode(node.left, path), r = evalNode(node.right, path);
        if (l != null && r != null && ["string", "number", "boolean"].includes(typeof l) && ["string", "number", "boolean"].includes(typeof r)) {
          switch (node.operator) { case "+": return l + r; case "-": return l - r; case "*": return l * r; case "/": return l / r; }
        }
        flag("dynamic-binary", node, path); return null;
      }
      case "ConditionalExpression": {
        const t = evalNode(node.test, path);
        if (typeof t === "boolean") return evalNode(t ? node.consequent : node.alternate, path);
        flag("dynamic-conditional", node, path); return null;
      }
      case "CallExpression": flag("dynamic-call", node, path); return null;
      case "NewExpression": flag("dynamic-new", node, path); return null;
      case "ThisExpression": return null;
      default: flag("unhandled:" + node.type, node, path); return null;
    }
  }
  return evalNode;
}

function findDefineCall(ast) {
  for (const st of ast.body)
    if (st.type === "ExpressionStatement" && st.expression.type === "CallExpression"
        && st.expression.callee.type === "Identifier" && st.expression.callee.name === "define")
      return st.expression;
  return null;
}

function buildAstScope(factory, amdDeps, src) {
  const scope = new Map();
  (factory.params || []).forEach((p, i) => {
    if (p.type === "Identifier") scope.set(p.name, amdDeps[i] === "BusinessRuleModule" ? { kind: "brm" } : { kind: "proxy" });
  });
  // Top-level consts/vars in the factory body so BOTH `var x = "Foo"; return { name: x }` and
  // `var d = [ … ]; return { diff: d }` resolve. The AST parser (which replaced the vm) lost the array/object
  // alias case — the vm EXECUTED the body so the alias just worked (Blocker 1: an aliased diff silently
  // became []). Literals go straight in as values. Array/object initializers are stored as LAZY AST NODES,
  // not pre-computed values: pre-computing them with a throwaway diagnostics sink silently DROPPED any dynamic
  // construct inside (e.g. `var d=[{…, values: makeValues()}]`), so the aliased diff resolved to a hole with
  // NO diagnostic and the gate stayed green. Deferring to the reference site means the FINAL evaluator (with
  // the real diagnostics sink) descends the alias at its true path (`diff.0.values`), so an unresolved
  // structural value is flagged and the gate blocks — the alias case is now diagnosed exactly like an inline one.
  const body = factory.body && factory.body.type === "BlockStatement" ? factory.body.body : [];
  for (const st of body)
    if (st.type === "VariableDeclaration")
      for (const d of st.declarations) {
        if (d.id.type !== "Identifier" || !d.init) continue;
        if (d.init.type === "Literal") { if (!(d.init.value instanceof RegExp)) scope.set(d.id.name, { kind: "value", value: d.init.value }); }
        else if (d.init.type === "ArrayExpression" || d.init.type === "ObjectExpression") scope.set(d.id.name, { kind: "node", node: d.init });
        // an enum-object alias (`var vt = Terrasoft.core.enums.ViewItemType`) — remembered so `vt.GridLayout`
        // resolves via the alias chain instead of silently collapsing to null (a mis-classified container).
        else if (d.init.type === "MemberExpression") scope.set(d.id.name, { kind: "memberAlias", node: d.init });
      }
  return scope;
}

// The factory's return EXPRESSION — inline `return {…}`, an arrow implicit return, OR `return <expr>` where
// <expr> is an identifier alias / ternary / call. We return the argument NODE (any type) and let the static
// evaluator resolve it over the scope (so `var cfg={…}; return cfg;` resolves), instead of only accepting an
// inline object literal — the old behaviour silently produced an EMPTY page for an aliased/ternary return and
// the gate saw nothing to block (Major). Returns null only when the factory has no return value at all.
function findFactoryReturn(factory) {
  if (factory.body.type !== "BlockStatement") return factory.body;   // arrow implicit return (any expression)
  for (const st of factory.body.body)
    if (st.type === "ReturnStatement" && st.argument) return st.argument;
  return null;
}

// Parse a Classic schema body into the effective-page inputs, WITHOUT executing it (AST + static eval).
// Same output shape as the previous vm-based parser (via buildSchemaResult), plus `astDiagnostics`: every
// construct the static evaluator could not resolve (fail-loud — surfaced for review, never silently guessed).
export function parseSchema(src, pkg) {
  const astDiagnostics = [];
  let ast;
  try { ast = acornParse(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true }); }
  catch (e) { return { ...buildSchemaResult(pkg, src, "acorn parse failed: " + String(e && e.message || e), {}, []), astDiagnostics }; }
  const call = findDefineCall(ast);
  if (!call) return { ...buildSchemaResult(pkg, src, "no define() call found", {}, []), astDiagnostics };
  const depsNode = call.arguments.find(a => a.type === "ArrayExpression");
  const amdDeps = depsNode ? depsNode.elements.filter(el => el && el.type === "Literal" && typeof el.value === "string").map(el => el.value) : [];
  const factory = call.arguments.find(a => a.type === "FunctionExpression" || a.type === "ArrowFunctionExpression");
  if (!factory) return { ...buildSchemaResult(pkg, src, "define() has no factory function", {}, amdDeps), astDiagnostics };
  const retArg = findFactoryReturn(factory);
  // A missing return is a ROOT-level structural hole (path "" → gate blocks): the schema contributes nothing.
  if (!retArg) { astDiagnostics.push({ kind: "no-return", path: "", snippet: "" });
    return { ...buildSchemaResult(pkg, src, null, {}, amdDeps), astDiagnostics }; }
  // The static eval is depth-capped (MAX_AST_DEPTH), but keep a belt: any residual stack blow-up on a
  // hostile body degrades to a clean parseError (→ gate blocks), never an uncaught RangeError crash.
  try {
    const scope = buildAstScope(factory, amdDeps, src);
    const captured = makeAstEvaluator(scope, astDiagnostics, src)(retArg, []);
    // The return resolved to something that is NOT a plain object (an alias to a dynamic value, a ternary the
    // evaluator could not decide, a call) → the effective page is empty. Flag it at the ROOT (path "") so the
    // gate blocks, instead of a silent clean run on a hollow page.
    if (captured == null || typeof captured !== "object" || Array.isArray(captured)) {
      astDiagnostics.push({ kind: "unresolved-return", path: "", snippet: src.slice(retArg.start, Math.min(retArg.end, retArg.start + 60)).replace(/\s+/g, " ") });
      return { ...buildSchemaResult(pkg, src, null, {}, amdDeps), astDiagnostics };
    }
    return { ...buildSchemaResult(pkg, src, null, captured, amdDeps), astDiagnostics };
  } catch (e) {
    const why = e instanceof RangeError ? "schema too deeply nested (evaluation aborted)" : String(e && e.message || e);
    return { ...buildSchemaResult(pkg, src, "static evaluation failed: " + why, {}, amdDeps), astDiagnostics };
  }
}

// AMD define() dependency list → the CUSTOM modules that likely RENDER UI (ship their own CSS, or have a
// UI-ish name). A page composes such modules OUTSIDE its own diff, so their UI (buttons/labels/timers) is
// invisible to schema analysis. Framework utils (FormatUtils, BusinessRuleModule, ConfigurationEnums…) are
// excluded — only css-backed or UI-named deps qualify, keeping the signal high (E1: never flag noise).
// The UI-name test is ANCHORED to a trailing role suffix so a utility like `LabelHelper` / `GeneratorUtils`
// (contains a token but doesn't END in it) is NOT misflagged — only css-backed deps or true role names pass.
const UI_MODULE_RX = /(?:Label|Widget|Dashboard|Timeline|MiniPage|Generator|Gallery|Chart|Diagram)$/;
// stable, locale-aware string comparator for the deterministic diagnostic lists below (Array#sort's
// default coerces to string and sorts by code unit — explicit here so the ordering is intentional).
const byLocale = (a, b) => String(a).localeCompare(String(b));
function referencedUiModules(deps) {
  const names = (Array.isArray(deps) ? deps : []).filter(isStr);
  const css = new Set(names.filter(d => d.startsWith("css!")).map(d => d.slice(4).replace(/CSS$/, "")));
  return [...new Set(names.filter(d => !d.startsWith("css!"))
    .filter(m => css.has(m) || css.has(m.replace(/CSS$/, "")) || UI_MODULE_RX.test(m)))].sort(byLocale);
}

// Extract a named function/method BODY by brace-matching (a regex can't balance braces) — used to scope
// the getActions scan to that method only. Returns "" when the function isn't found (→ no hints, no noise).
function extractFnBody(src, name) {
  const openers = [
    new RegExp(name + String.raw`\s*[:=]\s*function\s*\([^)]*\)\s*\{`), // name: function(){  |  name = function(){
    new RegExp(name + String.raw`\s*\([^)]*\)\s*\{`),                    // name(){  (ES6 method shorthand)
  ];
  for (const re of openers) {
    const m = re.exec(src);
    if (!m) continue;
    const open = m.index + m[0].length - 1; // index of the opening {
    let depth = 0;
    // brace-count, but SKIP string literals and line/block comments so a `{`/`}` inside them is not counted
    // (fixes mis-scoped getActions / section-action / column scans). Regex literals with braces stay a rare
    // unhandled edge — acceptable for these hint-only text scans.
    for (let j = open; j < src.length; j++) {
      const c = src[j], c2 = src[j + 1];
      if (c === "/" && c2 === "/") { const nl = src.indexOf("\n", j); if (nl < 0) return src.slice(open + 1); j = nl; continue; }
      if (c === "/" && c2 === "*") { const e = src.indexOf("*/", j + 2); j = e < 0 ? src.length : e + 1; continue; }
      if (c === '"' || c === "'" || c === "`") { for (j++; j < src.length && src[j] !== c; j++) if (src[j] === "\\") j++; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return src.slice(open + 1, j);
    }
    return src.slice(open + 1); // unbalanced source — return the remainder defensively
  }
  return "";
}

const isNum = (v) => typeof v === "number";
const isStr = (v) => typeof v === "string";
function safeKeys(o) { return o && typeof o === "object" ? Object.keys(o).filter(k => typeof k === "string") : []; }
function plainObj(o) { return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }

function normalizeDiff(diff) {
  if (!Array.isArray(diff)) return [];
  return diff.map((op) => {
    const v = op?.values && typeof op.values === "object" ? op.values : {};
    // caption resource key: `caption.bindTo`, else a bare string, else null.
    const captionStr = isStr(v.caption) ? v.caption : null;
    const caption = v.caption && isStr(v.caption.bindTo) ? v.caption.bindTo : captionStr;
    // field help/tooltip — accept `hint.bindTo`, `hint.content.bindTo`, or a bare string.
    let hint = null;
    if (isStr(v.hint?.bindTo)) hint = v.hint.bindTo;
    else if (isStr(v.hint?.content?.bindTo)) hint = v.hint.content.bindTo;
    else if (isStr(v.hint)) hint = v.hint;
    // visibility: static false / a dynamic expression (bind/rule) / true; null = this op didn't set it.
    const visibleDynamic = v.visible && typeof v.visible === "object" ? "dynamic" : null;
    const visible = typeof v.visible === "boolean" ? v.visible : visibleDynamic;
    return {
      operation: isStr(op.operation) ? op.operation : "?",
      name: isStr(op.name) ? op.name : "?",
      parentName: isStr(op.parentName) ? op.parentName : null,
      propertyName: isStr(op.propertyName) ? op.propertyName : null,
      index: isNum(op.index) ? op.index : null,
      bindTo: isStr(v.bindTo) ? v.bindTo : null,
      itemType: isNum(v.itemType) ? v.itemType : null,      // 0 grid,2 detail,15 group
      contentType: isNum(v.contentType) ? v.contentType : null,
      isTab: op.propertyName === "tabs",
      hasCaption: !!(v.caption),
      // caption resource key (tab/group/detail label) — carried so the real caption is shown for
      // cross-check instead of only a synthesized placeholder.
      caption,
      // RV5 — real fixtures often set the diff-op `index` (position in the parent) WITHOUT `values.order`;
      // fall back to `index` so such items keep their intended position instead of collapsing to order:null.
      order: v && isNum(v.order) ? v.order : (isNum(op.index) ? op.index : null),
      // classic grid coordinates — preserved so the mapper reproduces the real multi-column layout
      // (e.g. a wide 3-column header) instead of inventing a single narrow column.
      layout: normalizeLayout(v.layout),
      // tooltip resource key (classic `tip.content.bindTo = "Resources.Strings.XTip"`) — carried to the
      // Freedom field so hints aren't lost; and the component `generator` (image/photo etc.) for
      // recognising non-field components the mapper otherwise drops.
      tip: v.tip?.content && isStr(v.tip.content.bindTo) ? v.tip.content.bindTo : null,
      hint,
      generator: isStr(v.generator) ? v.generator : null,
      visible,
    };
  }).filter(op => op.name !== "?");
}

function normalizeLayout(l) {
  if (!l || typeof l !== "object") return null;
  const n = (x) => (isNum(x) ? x : null);
  const out = { column: n(l.column), colSpan: n(l.colSpan), row: n(l.row), rowSpan: n(l.rowSpan) };
  return Object.values(out).some(v => v !== null) ? out : null;
}

function normalizeDetails(d) {
  const out = {};
  if (d && typeof d === "object") for (const k of Object.keys(d)) {
    const e = d[k] || {};
    const f = e.filter && typeof e.filter === "object" ? e.filter : {};
    out[k] = { schemaName: isStr(e.schemaName) ? e.schemaName : null,
               entitySchemaName: isStr(e.entitySchemaName) ? e.entitySchemaName : null,
               detailColumn: isStr(f.detailColumn) ? f.detailColumn : null,
               masterColumn: isStr(f.masterColumn) ? f.masterColumn : null };
  }
  return out;
}

function normalizeModules(m) {
  const out = [];
  if (m && typeof m === "object") for (const k of Object.keys(m)) {
    const e = m[k] || {};
    out.push({ key: k, moduleName: isStr(e.moduleName) ? e.moduleName : null });
  }
  return out;
}

// ruleType 0=BINDPARAMETER,1=FILTRATION ; property 0=Visible,1=Enabled,2=Required,3=Readonly
const RULE_TYPE = { 0: "BINDPARAMETER", 1: "FILTRATION" };
const PROP = { 0: "Visible", 1: "Enabled", 2: "Required", 3: "Readonly" };

// Extract a rule's condition tree (leftExpression attribute/path, comparison, rightExpression value)
// so the mapper can emit COMPLETE business rules (not just an action + prose note).
function sanitizeConditions(conds) {
  if (!Array.isArray(conds)) return [];
  return conds.map(c => {
    const l = c?.leftExpression || {}, r = c?.rightExpression || {};
    return {
      comparison: typeof c.comparisonType === "number" ? c.comparisonType : null,
      left: { attribute: isStr(l.attribute) ? l.attribute : null, path: isStr(l.attributePath) ? l.attributePath : null },
      right: { value: ["number", "string", "boolean"].includes(typeof r.value) ? r.value : null,
               dataValueType: typeof r.dataValueType === "number" ? r.dataValueType : null },
    };
  });
}

// mergeHierarchy(schemas, opts)
//   schemas    — the schema's own schemas, base->top in true dependency order (F1).
//   opts.seedTemplate — parsed parent-TEMPLATE schemas (e.g. the BaseModulePageV2→…→BaseEntityPage
//     chain) merged FIRST, so base containers (Header/ProfileContainer/Tabs) and base tabs (ESNTab…)
//     exist before the schema's own schemas patch them (F2). Seed packages define only LAYOUT context:
//     every produced element is tagged `fromTemplate` (F9) so the mapper migrates only the page's own
//     content (fields/rules/details/methods/components touched by a schema schema) and treats
//     template-only elements — e.g. the 300+ framework methods on BaseEntityPage — as context, not
//     payload. Without this, seeding the full chain floods the ChangeSet with base noise.
// Single source of truth for a freshly-DEFINED diff item's record shape. BOTH the `insert` branch and
// the `merge`-onto-absent stub produce this exact shape; keeping one factory means a new field is added
// in ONE place — the asymmetric-drift risk RV4 hit (a field added to one branch, missed in the other).
// `seed` = the defining op came from a parent-template schema (templateOwned); `pkg` = the defining schema.
function makeItem(op, seed, pkg) {
  return {
    name: op.name, parent: op.parentName, propertyName: op.propertyName,
    bindTo: op.bindTo, itemType: op.itemType, contentType: op.contentType,
    isTab: op.isTab, removed: false, provenance: [pkg], order: op.order, layout: op.layout,
    tip: op.tip, hint: op.hint, generator: op.generator, visible: op.visible, caption: op.caption,
    templateOwned: seed, // the DEFINING insert's origin — never overwritten by a later merge/move
  };
}

export function mergeHierarchy(schemas /* base->top */, opts = {}) {
  const items = new Map();     // name -> item record
  const rules = new Map();     // "attr::ruleKey" -> record
  const details = new Map();   // key -> record
  const methods = new Map();   // name -> [pkgs] (override stack)
  const components = new Map(); // module key -> {moduleName, provenance} (widgets/charts → B9/B10)
  // Non-fatal diagnostics. A merge/move/remove that targets an item NO lower schema defined means
  // either the schemas were passed out of dependency order (F1) or the base-template element it
  // patches was never seeded (F2). We surface these instead of silently dropping/orphaning them.
  const warnings = [];
  const seedTemplate = Array.isArray(opts.seedTemplate) ? opts.seedTemplate : [];
  // F9 origin: tag each schema by WHERE it came from — parent-template seed vs the page's own schema
  // schemas. This is the authoritative signal, known HERE from which list the schema is in; we do NOT
  // reconstruct it from package names later (names collide when one package is both a template schema
  // and a schema schema). Diff-items carry `templateOwned` = their DEFINING insert came from a seed
  // schema — used for STRUCTURAL identity: a base tab a client merely re-captions is still template-
  // owned, so we never re-synthesize it (the Freedom template still provides it). Keyed elements
  // (rules/methods/details/components) carry `schemaTouched` = ≥1 schema schema contributed — a client
  // override IS payload. Payload = items a schema schema authored; template-only = layout context.
  const tagged = [
    ...seedTemplate.map(L => ({ L, seed: true })),   // parent-template skeleton first
    ...schemas.map(L => ({ L, seed: false })),      // then the schema's own schemas
  ];
  const entity = schemas.find(l => l.entitySchemaName !== "?")?.entitySchemaName || "?";

  for (const { L, seed } of tagged) {
    // diff replay
    for (const op of L.diff) {
      const cur = items.get(op.name);
      if (op.operation === "insert") {
        items.set(op.name, makeItem(op, seed, L.pkg));
      } else if (op.operation === "merge") {
        // patch in place; carry contentType/itemType too — a later schema can introduce a control hint
        // (e.g. mark a text field as lookup, contentType 5); dropping it made control selection wrong.
        if (cur) {
          for (const k of ["order", "contentType", "itemType", "visible"]) { if (op[k] != null) cur[k] = op[k]; }
          for (const k of ["bindTo", "layout", "tip", "hint", "caption", "generator"]) { if (op[k]) cur[k] = op[k]; }
          cur.provenance.push(L.pkg);
        }
        else {
          // merge onto an item no lower schema defined: record a stub with the SAME shape as an insert
          // (RV4 — carry layout/tip/hint/generator/visible/caption too, so a `visible:false`/tip/caption on
          // this first merge-definition isn't silently dropped). templateOwned marks the first def's origin.
          items.set(op.name, makeItem(op, seed, L.pkg));
          warnings.push({ op: "merge", name: op.name, schema: L.pkg, hint: "merge onto an item no lower schema defined — base-template element not seeded (F2) or schemas out of order (F1)" });
        }
      } else if (op.operation === "move") {
        // classic idiom: `remove` then `move` = reposition — the element ends up PRESENT at the new
        // spot. So a move onto a tombstoned item RESURRECTS it (else a displayed field silently vanishes,
        // e.g. Product's IsArchive/"Inactive" checkbox).
        if (cur) {
          if (op.parentName) { cur.parent = op.parentName; }
          // a reposition also carries the NEW order/index — apply it so tab/field ordering survives the move
          // (previously only the parent was updated, so a pure reorder silently kept the old position).
          if (op.order != null) { cur.order = op.order; }
          if (cur.removed) { cur.removed = false; cur.removedBy = null; cur.removedBySeed = false; }
          cur.provenance.push(L.pkg);
        } else {
          warnings.push({ op: "move", name: op.name, schema: L.pkg, hint: `move to '${op.parentName}' but the item was never defined — move dropped; check base seed (F2) / schema order (F1)` });
        }
      } else if (op.operation === "remove") {
        // removedBySeed: a template-internal remove (base template dropping a base element) is context,
        // not a client B6 decision — the mapper filters it out like every other template-only element.
        if (cur) { cur.removed = true; cur.removedBy = L.pkg; cur.removedBySeed = seed; }
        else {
          items.set(op.name, { name: op.name, removed: true, removedBy: L.pkg, removedBySeed: seed, provenance: [L.pkg] });
          warnings.push({ op: "remove", name: op.name, schema: L.pkg, hint: "remove of an item no lower schema defined — recorded as tombstone; check base seed / schema order" });
        }
      }
    }
    // businessRules + legacy rules (merge by attribute::ruleKey)
    for (const [sys, block] of [["businessRules", L.businessRules], ["rules", L.rules]]) {
      for (const attr of Object.keys(block || {})) {
        const ar = block[attr]; if (!ar || typeof ar !== "object") continue;
        for (const key of Object.keys(ar)) {
          const r = ar[key] || {};
          const id = `${attr}::${key}`;
          const rec = {
            attr, key, system: sys,
            // guard: only decode when numeric (after enum seeding legacy rules are numbers too);
            // a still-non-numeric value is genuinely symbolic/unknown -> flagged, never silently "0".
            ruleType: typeof r.ruleType === "number" ? (RULE_TYPE[r.ruleType] ?? String(r.ruleType)) : "symbolic",
            property: typeof r.property === "number" ? (PROP[r.property] ?? String(r.property)) : null,
            conditions: sanitizeConditions(r.conditions),
            filterColumn: isStr(r.baseAttributePatch) ? r.baseAttributePatch : null,
            comparison: typeof r.comparisonType === "number" ? r.comparisonType : null,
            value: ["number", "string", "boolean"].includes(typeof r.value) ? r.value : null,
            dataValueType: typeof r.dataValueType === "number" ? r.dataValueType : null,
            enabled: r.enabled !== false, removed: r.removed === true,
            provenance: [L.pkg], schemaTouched: !seed,
          };
          if (rules.has(id)) { const p = rules.get(id); rec.provenance = [...p.provenance, L.pkg]; rec.schemaTouched = p.schemaTouched || !seed; }
          rules.set(id, rec);
        }
      }
    }
    // details
    for (const k of Object.keys(L.details)) {
      const prev = details.get(k);
      const rec = { key: k, ...L.details[k], provenance: [L.pkg], schemaTouched: !seed };
      if (prev) { rec.provenance = [...prev.provenance, L.pkg]; rec.schemaTouched = prev.schemaTouched || !seed; }
      details.set(k, rec);
    }
    // methods (override stack) — track whether any schema schema contributed
    for (const m of L.methods) { const prev = methods.get(m); methods.set(m, { pkgs: [...(prev?.pkgs || []), L.pkg], schemaTouched: (prev?.schemaTouched || false) || !seed }); }
    // modules (widgets/charts) — merge by key
    for (const c of L.modules || []) {
      const prev = components.get(c.key);
      const rec = { ...c, provenance: [L.pkg], schemaTouched: (prev?.schemaTouched || false) || !seed };
      if (prev) rec.provenance = [...prev.provenance, L.pkg];
      components.set(c.key, rec);
    }
  }

  const alive = [...items.values()].filter(i => !i.removed);
  const removed = [...items.values()].filter(i => i.removed);
  const activeRules = [...rules.values()].filter(r => r.enabled && !r.removed);

  // Parent containers referenced by an ALIVE item but never defined by an ALIVE item == base-template
  // elements the client's schemas sit inside (e.g. Header, GeneralInfoTab from BaseModulePageV2).
  // This is the precise seed list F2 must supply so layout targets resolve and base tabs survive.
  // Computed over the ALIVE set only (NOT items.keys(), which includes remove-tombstones): the mapper's
  // routing index is alive-only, so a parent that survives only as a tombstone must still count as
  // unresolved here — otherwise the diagnostic gives a false all-clear the mapper contradicts.
  const aliveNames = new Set(alive.map(i => i.name));
  const unresolvedParents = [...new Set(
    alive.map(i => i.parent).filter(p => p && !aliveNames.has(p))
  )].sort(byLocale);
  // feature toggles referenced by the SCHEMA schemas (not the base template) — they gate element
  // visibility at runtime; the rendered page shows one feature-state while this is the full union.
  const features = [...new Set(schemas.flatMap(l => l.features || []))].sort(byLocale);
  const cardActionHints = [...new Set(schemas.flatMap(l => l.actionHints || []))].sort(byLocale);
  // #8c — process launch detected in the SCHEMA's OWN schemas (not the seed: the base template's "Run
  // process by record" is template-provided; here we surface the CLIENT page's own process launch).
  const processLaunch = schemas.some(l => l.processLaunch);
  const processNames = [...new Set(schemas.flatMap(l => (l.processLaunch && l.processLaunch.names) || []))].sort(byLocale);
  // referenced UI modules the SCHEMA's own schemas pull in via define() (not the base template) — their
  // rendered UI is outside the page-schema migration unit; the mapper flags them (referenced-module).
  const referencedModules = [...new Set(schemas.flatMap(l => l.refModules || []))].sort(byLocale);

  // #19 — seed QUALITY validation. A real fetched base-template body (BaseModulePageV2 → BasePageV2 →
  // BaseEntityPage) always defines methods — hundreds of them, incl. `getActions` (which surfaces the
  // base ProcessButton / Run process). A hand-authored SKELETON seed (the recurring failure: the agent
  // types a few `{itemType:15}` container stubs to clear the parent gate) contributes ZERO methods. So
  // "seed present but no seed method" reliably means the seed is a skeleton, not the real template — and
  // building on it silently drops base actions + the true nesting. Surface it as a WARNING so the SKILL's
  // hard gate (warnings must be empty) blocks the build until the real base schemas are fetched.
  const seedMethodNames = new Set(seedTemplate.flatMap(l => l.methods || []));
  const looksSkeletal = seedTemplate.length > 0 && seedMethodNames.size === 0;
  const seedQuality = {
    seeded: seedTemplate.length > 0, seedTemplate: seedTemplate.length,
    seedMethods: seedMethodNames.size, hasGetActions: seedMethodNames.has("getActions"),
    looksSkeletal,
  };
  if (looksSkeletal) warnings.push({
    op: "seed", name: "skeletal-seed", schema: "(seed)",
    message: `SEED LOOKS SKELETAL (#19): the ${seedTemplate.length} seed schema(s) contribute 0 methods and no getActions — a real base-template body (BaseModulePageV2/BasePageV2/BaseEntityPage) always defines methods incl. getActions (→ ProcessButton/Run process). This seed is almost certainly a hand-authored skeleton, not the fetched template body. Re-fetch the parent-template schemas via get-classic-schema-by-uid and pass their real bodies as \`seed\` — do NOT build on a skeleton.`,
  });

  return {
    entity,
    // Full alive layout tree (containers, groups, tabs, fields) with parent links — the input F3's
    // mapper walks to route each field to its owning tab/group. Diff-items carry `templateOwned`
    // (defining insert came from a seed schema): payload = client-authored items, structural identity =
    // template ownership. Keyed projections below carry `fromTemplate` (= no schema schema contributed).
    items: alive.map(i => ({ name: i.name, parent: i.parent, propertyName: i.propertyName,
      itemType: i.itemType, contentType: i.contentType, bindTo: i.bindTo || null,
      isTab: i.isTab, order: i.order, layout: i.layout || null, tip: i.tip || null, hint: i.hint || null, generator: i.generator || null,
      visible: i.visible ?? null, caption: i.caption || null, provenance: i.provenance, templateOwned: !!i.templateOwned })),
    fields: alive.filter(i => i.bindTo).map(i => ({ name: i.name, bindTo: i.bindTo, parent: i.parent, contentType: i.contentType, layout: i.layout || null, tip: i.tip || null, hint: i.hint || null, visible: i.visible ?? null, provenance: i.provenance, templateOwned: !!i.templateOwned })),
    tabs: alive.filter(i => i.isTab).map(i => ({ name: i.name, order: i.order, caption: i.caption || null, provenance: i.provenance, templateOwned: !!i.templateOwned })),
    // each detail carries its PLACEMENT (parent container + order) from the matching diff-item, so the
    // mapper can put the Expanded list in the right tab, in order (Gap: detail→tab/order was dropped).
    details: [...details.values()].map(d => {
      const it = items.get(d.key);
      return { ...d, fromTemplate: !d.schemaTouched, parent: it?.parent ?? null, order: it?.order ?? null, caption: it?.caption ?? null };
    }),
    rules: activeRules.map(r => ({ ...r, fromTemplate: !r.schemaTouched })),
    removed: removed.map(i => ({ name: i.name, removedBy: i.removedBy, fromTemplate: !!i.removedBySeed })),
    methods: [...methods.entries()].map(([n, m]) => ({ name: n, stack: m.pkgs, fromTemplate: !m.schemaTouched })),
    components: [...components.values()].map(c => ({ ...c, fromTemplate: !c.schemaTouched })),
    warnings,
    unresolvedParents,
    seedQuality, // #19 — whether the seed is a real fetched template body vs a hand-authored skeleton
    features, // feature toggles gating runtime visibility (the rendered page shows one feature-state)
    cardActionHints, // custom card actions found in getActions bodies (imperative — surfaced for review)
    processLaunch, processNames, // #8c — the page launches a business process (a "Run process" action)
    referencedModules, // custom UI-rendering modules pulled via define() deps — outside the migration unit
  };
}
