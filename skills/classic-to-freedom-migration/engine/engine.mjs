// Merge engine. Pure Node module, no Creatio/stand dependency.
// Parses classic ClientUnitSchema schema bodies and merges N schemas (base->top)
// into one effective page model + provenance.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkVendorIntegrity } from "./verify-vendor.mjs";

// Runtime supply-chain gate. parseSchema feeds UNTRUSTED classic bodies to the vendored acorn parser (the AST route
// is chosen over `vm` precisely to deny RCE from a hostile body). CRITICAL: the parser is NOT statically imported —
// a static top-level `import … from "./vendor/acorn…"` is HOISTED and EVALUATED before any module code, so a
// tampered file's module-level payload would run at import time, BEFORE the check. Instead `getAcornParse()` loads
// acorn LAZILY, via `createRequire`, and ONLY AFTER `ensureVendorIntegrity()` has passed — so a tampered/drifted
// bundle is caught and the throw happens BEFORE its bytes are ever evaluated. The parser is vendored as the
// CommonJS build (`vendor/acorn.cjs`), so a plain `require()` loads it SYNCHRONOUSLY on ANY supported Node (no
// `require(esm)` >= 22.12 floor; a dynamic `import()` would have forced parseSchema — and everything above it —
// to become async). This closes the import-time vector while keeping the whole parse pipeline synchronous.
//
// The check itself: verify vendor/ against the pinned provenance before the FIRST parse. Lazy + memoized at the
// PARSE surface — NOT a top-level throw (that fails closed but every importer — mapper, designspec, all goldens —
// would die at import on any integrity hiccup, e.g. a legitimate re-vendor before the pin is bumped). Memoize the
// CHECK RESULT and throw on EVERY call when it failed — never fail open (a prior version stored `false` and threw
// only on the first call, so a caller that caught parse #1 then parsed #2..N on the tampered parser silently).
let __vendorCheck = null;
function ensureVendorIntegrity() {
  if (__vendorCheck === null) __vendorCheck = checkVendorIntegrity(path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor"));
  if (!__vendorCheck.ok) throw new Error("classic-to-freedom engine: vendored parser integrity check FAILED — refusing to parse untrusted input:\n" + __vendorCheck.failures.join("\n"));
  return true;
}

// Test seam (AC1 fail-closed regression): force or reset the memoized vendor-integrity result so a golden can prove
// the PARSE surface throws on EVERY call when the check failed — not just the first (the fail-open a prior version
// had). Pass a `{ ok, failures, results }` object to force a state, or `null` to restore the real memoized check on
// the next parse. GATED behind `C2F_TEST_SEAM=1`: on the shipped runtime surface (no flag) it is an inert no-op, so
// this control ships NO usable integrity-gate bypass (defense-in-depth — a security gate must not carry its own
// disable switch). The golden runner sets the flag before using it.
export function __setVendorIntegrityForTest(result) {
  if (process.env.C2F_TEST_SEAM !== "1") return; // inert unless the test seam is explicitly enabled
  __vendorCheck = result;
  __acornParse = null;
}

// Lazily load the vendored acorn's `parse` — AFTER the integrity check, so a tampered module's top-level code never
// runs. The CommonJS build (`vendor/acorn.cjs`) loads via a plain synchronous `require()` on ANY supported Node
// (no `require(esm)` floor), keeping parseSchema sync. Memoized: the check + require run once per process.
let __acornParse = null;
function getAcornParse() {
  if (__acornParse) return __acornParse;
  ensureVendorIntegrity(); // MUST run before the require below — the whole point of the lazy load
  // Defense-in-depth: the gate above passes when every LISTED pin matches, but never asserts that the file we are
  // ABOUT to load (acorn.cjs) is itself one of the verified pins. A tampered provenance.json that DROPPED the
  // acorn.cjs entry would leave the gate green while an unverified parser loads. Require acorn.cjs to be a verified
  // ok-entry before require().
  if (!(__vendorCheck.results || []).some((r) => r.name === "acorn.cjs" && r.ok))
    throw new Error("classic-to-freedom engine: `acorn.cjs` is not a verified entry in vendor/provenance.json — refusing to load an unpinned parser (provenance may be tampered).");
  const acorn = createRequire(import.meta.url)("./vendor/acorn.cjs");
  if (typeof acorn.parse !== "function") throw new Error("classic-to-freedom engine: vendored acorn has no `parse` export");
  __acornParse = acorn.parse;
  return __acornParse;
}

// Build the parse RESULT from the extracted schema object `s` (+ text-scanned signals from `src`).
// Kept separate from the AST extraction so the "what fields the merge consumes" shape lives in one place.
function buildSchemaResult(pkg, src, parseError, s, amdDeps) {
  const methodKeys = safeKeys(s.methods); // reused for the name list AND the empty-body (stub) subset below
  return {
    pkg,
    error: parseError,
    entitySchemaName: typeof s.entitySchemaName === "string" ? s.entitySchemaName : "?",
    diff: normalizeDiff(s.diff),
    businessRules: plainObj(s.businessRules),
    rules: plainObj(s.rules),
    details: normalizeDetails(s.details),
    methods: methodKeys,
    emptyMethods: methodKeys.filter(k => s.methods[k] === AST_FN_EMPTY), // stub methods `(){}` — the seed gate's structural signal
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
      // The two `[\w.]*` runs around the literal alternation are BOUNDED ({0,128}) so this stays linear on a
      // hostile body: the previous unbounded form was polynomial (~O(n²)) ReDoS on `src` — a long unterminated
      // quoted run with many "Process" substrings drove per-schema parse time to seconds/tens-of-seconds (~32 s
      // at 700 KB, a size real Classic bodies reach), defeating the "must not hang on hostile input" guarantee
      // this file's MAX_AST_DEPTH / rowSpan clamps already defend. Real schema names are far under 128 chars.
      const names = [...new Set([...src.matchAll(/["']([A-Za-z][\w.]{0,128}(?:Process|SecurityCheck|Recruiting)[\w.]{0,128})["']/g)].map(mt => mt[1]))];
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
        // classic STANDARD shape: actionMenuItems.addItem(this.getButtonMenuItem({ "Click": {"bindTo": "handler"} }))
        // — the Click handler IS the action identity. Also the direct "Click": "handler" form. This is what the
        // old Tag/navigate-only patterns missed (e.g. `createRegistry`), so real section actions were dropped.
        ...[...body.matchAll(/"Click"\s*:\s*(?:\{\s*"?bindTo"?\s*:\s*)?["']([A-Za-z]\w+)["']/g)].map(mt => mt[1]),
        // alternative/older shapes: menu-item handler Tags and navigate/run hints
        ...[...body.matchAll(/"Tag"\s*:\s*"([^"]{2,})"/g)].map(mt => mt[1]),
        ...[...body.matchAll(/\b((?:navigateTo|goTo|run|open|process)[A-Z]\w+)/g)].map(mt => mt[1]),
      ])].filter((n) => n !== "callParent");
    })(),
    // section grid columns IF the schema hardcodes them (getGridDataColumns / initColumnsConfig). Most
    // sections keep columns in PROFILE DATA, not the schema → this is usually empty and the mapper flags
    // it as data-driven (#2).
    listColumns: (() => {
      const body = extractFnBody(src, "getGridDataColumns") || extractFnBody(src, "initColumnsConfig") || "";
      if (!body) return [];
      return [...new Set([...body.matchAll(/(?:"?(?:path|bindTo)"?)\s*:\s*["']([A-Za-z][\w.]*)["']/g)].map(mt => mt[1]))];
    })(),
    // section QUICK FILTERS — the classic fixed-filter bar (period / owner / …) declared in
    // initFixedFiltersConfig / getFixedFiltersConfig as a `filters: [{ name, columnName, dataValueType }]`
    // list. Each entry = { name, column, type }. In Freedom these are the list-page filter/quick-filter
    // controls, so they MUST reach the plan — they were being dropped entirely (the whole registry filter
    // bar vanished). A dynamic/column-less filter still surfaces by name (column null).
    quickFilters: (() => {
      const body = extractFnBody(src, "initFixedFiltersConfig") || extractFnBody(src, "getFixedFiltersConfig");
      if (!body) return [];
      // Extract each filter object as a UNIT (brace-matched), then read name/columnName/dataValueType
      // INDEPENDENTLY within it. The old single regex demanded `name` THEN `columnName` in order within 400
      // chars, which (a) dropped a column-less filter and stole its `name` into the next entry's gap, and (b)
      // failed on `{ columnName, name }` order. Per-entry parsing makes it order-independent and yields
      // column:null for a column-less filter (the documented contract) instead of borrowing a neighbour's name.
      const out = [];
      for (const obj of fixedFilterObjects(body)) {
        const name = /name\s*:\s*["']([^"']+)["']/.exec(obj);
        if (!name) continue;
        const col = /columnName\s*:\s*["']([^"']+)["']/.exec(obj);
        // accept the dominant `this.Terrasoft.DataValueType.*`, the bare `Terrasoft.*`, and unqualified forms.
        const dvt = /dataValueType\s*:\s*(?:this\.)?(?:Terrasoft\.)?DataValueType\.(\w+)/.exec(obj);
        out.push({ name: name[1], column: col ? col[1] : null, type: dvt ? dvt[1] : null });
      }
      return out;
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
// Canonical Classic resource-key normalization — strip the `$`-binding sigil, the `Resources.Strings.` prefix,
// and any `#<culture>` anchor. ONE source so the mapper (which STORES the key) and the design spec (which
// LOOKS IT UP) agree: they diverged before — the spec kept the `#anchor`, so `Resources.Strings.Foo#bar`
// stored as `Foo` was looked up as `Foo#bar` and the raw key leaked into the plan.
export const resourceKey = (raw) => String(raw ?? "").replace(/^\$?Resources\.Strings\./, "").replace(/#.*/, "");
// Depth cap for the static evaluator: the body is UNTRUSTED, so a pathologically deep-nested literal must
// not blow the call stack (DoS). `path.length` is the current nesting depth — bail to null + a diagnostic
// well before any real stack limit. Real page schemas nest only a handful of levels; 500 is unreachable by
// legitimate input yet far under Node's stack ceiling.
const MAX_AST_DEPTH = 500;
const AST_RULE_TYPE = { BINDPARAMETER: 0, FILTRATION: 1 };
const AST_PROPERTY = { VISIBLE: 0, ENABLED: 1, REQUIRED: 2, READONLY: 3 };
const AST_FN = Symbol("fn"); // placeholder for a function value with a NON-empty body (methods/attributes) — only its KEY matters downstream
const AST_FN_EMPTY = Symbol("fn-empty"); // a function whose body is an EMPTY block `(){}` — a stub. Distinguished so the
// seed-skeletal gate can tell a real fetched method (has a body) from a broken-fetch/hand stub (empty body), independent of count.

// resolveMemberValue models a small finite automaton over a member-access chain (mirroring the old vm proxy
// graph). TAG_TRANSITIONS[state][key] = the next state; any key absent from a state's map collapses to "proxy"
// (an opaque value → further access is null). TAG_ENUMS[state] marks a TERMINAL state whose next key indexes a
// concrete enum table (→ the resolved number, or null when the key is unknown).
const TAG_TRANSITIONS = {
  // `this.Terrasoft.*` is the DOMINANT enum idiom in real ViewModel bodies (a schema references the framework
  // namespace off `this`, not only the bare `Terrasoft` global) — route it into the `terrasoft` state so it
  // resolves identically to the bare form. Without this, `this.Terrasoft.ViewItemType.CONTROL_GROUP` collapsed
  // to null and a captioned group silently degraded to a plain container (clean-but-wrong page).
  this: { BusinessRuleModule: "brm", Terrasoft: "terrasoft" },
  brm: { enums: "brm.enums" },
  "brm.enums": { RuleType: "t:rule", Property: "t:prop" },
  terrasoft: { ViewItemType: "t:vit", ContentType: "t:ct", controls: "terrasoft.controls", core: "terrasoft.core" },
  "terrasoft.controls": { ViewItemType: "t:vit" },
  "terrasoft.core": { enums: "terrasoft.core.enums" },
  "terrasoft.core.enums": { ViewItemType: "t:vit", ContentType: "t:ct" },
};
// "t:ct" indexes ContentType. Only LOOKUP (5) drives behavior (the mapper renders it via a picker); every other
// ContentType key is a display hint the mapper does not switch on, so it intentionally stays null (unknown-key →
// null, exactly as before) rather than being pinned to a guessed numeric — resolving LOOKUP is the fix, and no
// other value can silently equal 5 and mis-flag a scalar as a lookup.
const TAG_ENUMS = { "t:vit": AST_VIEW_ITEM_TYPE, "t:rule": AST_RULE_TYPE, "t:prop": AST_PROPERTY, "t:ct": CONTENT_TYPE };

// Walk a member chain to the value it lands on, mirroring the vm proxy graph: a known enum member resolves
// to its number; everything else collapses to null (exactly what the proxies did). Never flags — vm→null too.
// Walk a member chain down to its base, collecting the property names (outermost last). Returns null when any
// link is unreadable statically: a computed index (`x[i]`) resolves to a proxy → null under the vm too.
function memberChain(node) {
  const path = [];
  let cur = node;
  while (cur?.type === "MemberExpression") {
    if (cur.computed) return null;                 // dynamic index -> proxy -> null under vm too
    const p = cur.property;
    const litName = p.type === "Literal" ? String(p.value) : null;
    const name = p.type === "Identifier" ? p.name : litName;
    if (name == null) return null;
    path.unshift(name);
    cur = cur.object;
  }
  return { path, base: cur };
}

// Which resolver state the chain's base identifier starts in: `this`, the framework root, or an opaque proxy.
function baseTag(cur, scope) {
  if (cur?.type === "ThisExpression") return "this";
  if (cur?.type !== "Identifier") return null;
  // param shadows global; the AMD `terrasoft` dep param resolves like the global
  if (scope.has(cur.name)) return { brm: "brm", terrasoft: "terrasoft" }[scope.get(cur.name).kind] || "proxy";
  return cur.name === "Terrasoft" ? "terrasoft" : "proxy";
}

function resolveMemberValue(node, scope) {
  const chain = memberChain(node);
  if (!chain) return null;
  const { path } = chain;
  let cur = chain.base;
  // If the base is an Identifier that ALIASES an enum member chain, splice the alias's own chain in front so
  // `vt.GridLayout` (where `var vt = Terrasoft.core.enums.ViewItemType`) resolves exactly like the full path.
  let guard = 0;
  while (cur?.type === "Identifier" && scope.get(cur.name)?.kind === "memberAlias" && guard++ < 20) {
    const aliased = memberChain(scope.get(cur.name).node);
    if (!aliased) return null;
    path.unshift(...aliased.path); cur = aliased.base;
  }
  let tag = baseTag(cur, scope);
  if (tag == null) return null;
  for (const k of path) {
    const enumTable = TAG_ENUMS[tag];
    if (enumTable) return k in enumTable ? enumTable[k] : null; // terminal: the next key indexes the enum table
    const next = TAG_TRANSITIONS[tag];
    if (!next) return null;                                     // proxy (or already a value) — further access is null
    tag = next[k] || "proxy";                                   // unknown key at this state collapses to proxy
  }
  return null; // ended on a resolver, not a concrete value
}

// The root identifier a member chain reads off (`cfg.items[0].x` → "cfg"), or null if the base isn't a plain
// identifier. Used to tell an unresolved LOCAL-object member access (flag it) from a framework-enum miss (fine).
function memberBase(node) { let cur = node; while (cur?.type === "MemberExpression") { cur = cur.object; } return cur?.type === "Identifier" ? cur.name : null; }

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
      case "ObjectExpression": return evalObject(node, path);
      case "ArrayExpression": return evalArray(node, path);
      case "MemberExpression": return evalMember(node, path);
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        // methods/attributes: only keys are read downstream — EXCEPT we note an EMPTY body `(){}` so the seed gate can
        // distinguish a real fetched method from a stub. An arrow with an expression body (`() => x`) is never empty.
        const b = node.body;
        return (b?.type === "BlockStatement" && b.body.length === 0) ? AST_FN_EMPTY : AST_FN;
      }
      case "Identifier": return evalIdentifier(node, path);
      case "UnaryExpression": return evalUnary(node, path);
      case "BinaryExpression": return evalBinary(node, path);
      case "ConditionalExpression": return evalConditional(node, path);
      case "CallExpression": flag("dynamic-call", node, path); return null;
      case "NewExpression": flag("dynamic-new", node, path); return null;
      case "ThisExpression": return null;
      default: flag("unhandled:" + node.type, node, path); return null;
    }
  }
  function evalObject(node, path) {
    const out = {};
    for (const p of node.properties) {
      if (p.type === "SpreadElement") { flag("spread-in-object", p, path); continue; }
      if (p.computed) { flag("computed-key", p, path); continue; }
      const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
      out[key] = evalNode(p.value, [...path, key]);
    }
    return out;
  }
  function evalArray(node, path) {
    return node.elements.map((el, i) => {
      // A sparse hole (`[ , {…}]`) previously returned null with NO diagnostic, then crashed downstream when
      // normalizeDiff read `.index` off it. Flag it (structural if it sits on `diff`/`details`) so the gate
      // blocks with a real reason instead of a raw TypeError, and the null slot is skipped by consumers.
      if (!el) { flag("sparse-hole", node, [...path, i]); return null; }
      if (el.type === "SpreadElement") { flag("spread-in-array", el, path); return null; }
      return evalNode(el, [...path, i]);
    });
  }
  function evalMember(node, path) {
    const v = resolveMemberValue(node, scope);
    // E2 fail-loud: a member access whose base is a LOCAL object/array alias (`var cfg={…}; return {diff: cfg.items}`)
    // is not something resolveMemberValue can descend (it only walks the framework-enum automaton), so it collapses
    // to null SILENTLY — an empty structural value that would otherwise pass the gate green. Flag it so it surfaces.
    if (v == null) { const b = memberBase(node); if (b && scope.get(b)?.kind === "node") flag("member-on-local-object", node, path); }
    return v;
  }
  function evalIdentifier(node, path) {
    if (node.name === "undefined") return undefined;
    if (!scope.has(node.name)) { flag("unresolved-identifier", node, path); return null; }
    const m = scope.get(node.name);
    if (m.kind === "value") return m.value;
    if (m.kind === "node") return evalNode(m.node, path); // lazy alias: evaluate at the REFERENCE path with the real sink
    return null; // proxy / BusinessRuleModule param — not a static value
  }
  function evalUnary(node, path) {
    const v = evalNode(node.argument, path);
    if (node.operator === "!") return !v;
    if (typeof v !== "number") return null;
    if (node.operator === "-") return -v;
    return node.operator === "+" ? +v : null;
  }
  const STATIC_TYPES = new Set(["string", "number", "boolean"]);
  function evalBinary(node, path) {
    const l = evalNode(node.left, path), r = evalNode(node.right, path);
    if (l != null && r != null && STATIC_TYPES.has(typeof l) && STATIC_TYPES.has(typeof r)) {
      switch (node.operator) { case "+": return l + r; case "-": return l - r; case "*": return l * r; case "/": return l / r; }
    }
    flag("dynamic-binary", node, path); return null;
  }
  function evalConditional(node, path) {
    const t = evalNode(node.test, path);
    if (typeof t === "boolean") return evalNode(t ? node.consequent : node.alternate, path);
    flag("dynamic-conditional", node, path); return null;
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

// Record ONE top-level `var`/`const` declarator into the scope: a literal → its value; an array/object
// initializer → a LAZY node (resolved at its reference site with the real diagnostics sink, so a dynamic
// construct inside is flagged there, not silently dropped); an enum-object member alias
// (`var vt = Terrasoft.core.enums.ViewItemType`) → its chain, so `vt.GridLayout` still resolves. Anything
// else is left unbound (→ proxy/null downstream).
function bindDeclaration(d, scope) {
  if (d.id.type !== "Identifier" || !d.init) return;
  if (d.init.type === "Literal") { if (!(d.init.value instanceof RegExp)) scope.set(d.id.name, { kind: "value", value: d.init.value }); }
  else if (d.init.type === "ArrayExpression" || d.init.type === "ObjectExpression") scope.set(d.id.name, { kind: "node", node: d.init });
  else if (d.init.type === "MemberExpression") scope.set(d.id.name, { kind: "memberAlias", node: d.init });
}

function buildAstScope(factory, amdDeps, src) {
  const scope = new Map();
  (factory.params || []).forEach((p, i) => {
    // Bind the AMD dependency to a resolver STATE, not just a proxy: the `terrasoft` dep (param usually named
    // `Terrasoft`) must resolve its `.ViewItemType`/`.ContentType` enums exactly like the bare global — the real
    // fixtures ALWAYS receive Terrasoft as a define() param, so treating it as an opaque proxy dropped every
    // enum access (`Terrasoft.ViewItemType.CONTROL_GROUP` → null → group degraded to a plain container).
    if (p.type === "Identifier") {
      const kind = { BusinessRuleModule: "brm", terrasoft: "terrasoft" }[amdDeps[i]] || "proxy";
      scope.set(p.name, { kind });
    }
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
  const body = factory.body?.type === "BlockStatement" ? factory.body.body : [];
  for (const st of body)
    if (st.type === "VariableDeclaration")
      for (const d of st.declarations) bindDeclaration(d, scope);
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
  const acornParse = getAcornParse(); // supply-chain gate — checks integrity, THEN loads the parser (never before)
  const astDiagnostics = [];
  let ast;
  try { ast = acornParse(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true }); }
  catch (e) { return { ...buildSchemaResult(pkg, src, "acorn parse failed: " + String(e?.message || e), {}, []), astDiagnostics }; }
  const call = findDefineCall(ast);
  if (!call) return { ...buildSchemaResult(pkg, src, "no define() call found", {}, []), astDiagnostics };
  const depsNode = call.arguments.find(a => a.type === "ArrayExpression");
  const amdDeps = depsNode ? depsNode.elements.filter(el => el?.type === "Literal" && typeof el.value === "string").map(el => el.value) : [];
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
    const why = e instanceof RangeError ? "schema too deeply nested (evaluation aborted)" : String(e?.message || e);
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
    return sliceBracedBody(src, m.index + m[0].length - 1); // from the index of the opening {
  }
  return "";
}

// The `{ … }` block starting at `open`, brace-counted but SKIPPING string literals and line/block comments so
// a `{`/`}` inside them is not counted (fixes mis-scoped getActions / section-action / column scans). Regex
// literals with braces stay a rare unhandled edge — acceptable for these hint-only text scans. A hand-advanced
// index (a while loop, not a for-counter) because comment/string spans jump `j` past whole regions in one step.
// An unbalanced source returns the remainder defensively rather than "".
function sliceBracedBody(src, open) {
  let depth = 0, j = open;
  while (j < src.length) {
    const c = src[j], c2 = src[j + 1];
    if (c === "/" && (c2 === "/" || c2 === "*")) {
      const skipped = skipComment(src, j);
      if (skipped == null) return src.slice(open + 1);   // unterminated line comment — nothing left to scan
      j = skipped; continue;
    }
    if (c === '"' || c === "'" || c === "`") { j = skipStringLiteral(src, j); continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(open + 1, j);
    j++;
  }
  return src.slice(open + 1); // unbalanced source — return the remainder defensively
}

// Index just past the comment starting at `j`. null when a line comment runs to EOF with no newline.
function skipComment(src, j) {
  if (src[j + 1] === "/") {                              // line comment → skip to the newline
    const nl = src.indexOf("\n", j);
    return nl < 0 ? null : nl + 1;
  }
  const e = src.indexOf("*/", j + 2);                    // block comment → skip past the closing */
  return e < 0 ? src.length : e + 2;
}

// The source text of each top-level entry object inside the first `filters: [ … ]` array of `body` (a
// fixed-filters method body). Entry boundaries are tracked by BRACE depth (so a nested `caption:{…}` /
// `startDate:{}` doesn't split an entry) and the array end by BRACKET depth; strings are skipped so a brace
// inside a literal is never counted. Lets quickFilters read each filter's fields independently (order-safe).
function fixedFilterObjects(body) {
  const m = /filters\s*:\s*\[/.exec(body);
  if (!m) return [];
  const objs = [];
  const depth = { bracket: 1, brace: 0, start: -1 };
  let i = m.index + m[0].length;
  while (i < body.length && depth.bracket > 0) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") { i = skipStringLiteral(body, i); continue; }
    trackFilterDepth(c, i, depth, body, objs);
    i++;
  }
  return objs;
}

// One character of the depth walk: brackets bound the `filters` array, braces bound each entry object, and a
// brace returning to depth 0 closes an entry — its source text is pushed to `objs`.
function trackFilterDepth(c, i, depth, body, objs) {
  if (c === "[") depth.bracket++;
  else if (c === "]") depth.bracket--;
  else if (c === "{") { if (depth.brace === 0) { depth.start = i; } depth.brace++; }
  else if (c === "}" && --depth.brace === 0 && depth.start >= 0) {
    objs.push(body.slice(depth.start, i + 1));
    depth.start = -1;
  }
}

// Index just past the string literal opening at `body[i]`, so a brace/bracket inside a literal is never
// counted by the depth walk above. Escapes consume two characters.
function skipStringLiteral(body, i) {
  const quote = body[i];
  let j = i + 1;
  while (j < body.length && body[j] !== quote) { j += body[j] === "\\" ? 2 : 1; }
  return j + 1;
}

const isNum = (v) => typeof v === "number";
const isStr = (v) => typeof v === "string";
// `x` when it is a string / number, else null — the normalizers below apply this to nearly every field, and
// as a named helper each application costs no cognitive complexity in the caller.
const strOrNull = (v) => (isStr(v) ? v : null);
const numOrNull = (v) => (isNum(v) ? v : null);
function safeKeys(o) { return o && typeof o === "object" ? Object.keys(o).filter(k => typeof k === "string") : []; }
function plainObj(o) { return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }

function normalizeDiff(diff) {
  if (!Array.isArray(diff)) return [];
  // pass the index explicitly rather than handing `normalizeDiffOp` straight to `.map` — the second parameter
  // it reads IS the AST index (carried as `astIndex`), and `.map` would also feed it a third `array` argument.
  return diff.map((op, i) => normalizeDiffOp(op, i)).filter(op => op && op.name !== "?");
}

// caption resource key: `caption.bindTo`, else a bare string, else null.
const captionKey = (v) => (v.caption && isStr(v.caption.bindTo) ? v.caption.bindTo : strOrNull(v.caption));

// field help/tooltip — accept `hint.bindTo`, `hint.content.bindTo`, or a bare string.
function hintKey(v) {
  if (isStr(v.hint?.bindTo)) return v.hint.bindTo;
  if (isStr(v.hint?.content?.bindTo)) return v.hint.content.bindTo;
  return strOrNull(v.hint);
}

// visibility: static false / a dynamic expression (bind/rule) / true; null = this op didn't set it.
function visibility(v) {
  if (typeof v.visible === "boolean") return v.visible;
  return v.visible && typeof v.visible === "object" ? "dynamic" : null;
}

// A null/non-object slot (a sparse hole `[ , {…}]` or the residue of an unresolved spread) previously fell
// straight through to `op.index`/`op.name` below and threw a raw TypeError. Return null here and let the
// null-safe filter in normalizeDiff drop it. `astIndex: i` (the ORIGINAL position in the AST diff) is carried
// on every surviving op so the dynamic-property reporter (migrate.mjs) can match a `diff.<i>.values.*`
// diagnostic to its element by that index instead of by array position — which drifts once any op is
// dropped here (null slot or nameless "?"), the label-desync the reporter otherwise hit.
function normalizeDiffOp(op, i) {
  if (op == null || typeof op !== "object") return null;
  const v = plainObj(op.values);
  const opIndex = numOrNull(op.index); // diff-op index fallback (RV5, used for `order` below)
  return {
    operation: isStr(op.operation) ? op.operation : "?",
    name: isStr(op.name) ? op.name : "?",
    parentName: strOrNull(op.parentName),
    propertyName: strOrNull(op.propertyName),
    index: opIndex,
    bindTo: strOrNull(v.bindTo),
    itemType: numOrNull(v.itemType),      // 0 grid,2 detail,15 group
    contentType: numOrNull(v.contentType),
    isTab: op.propertyName === "tabs",
    hasCaption: !!(v.caption),
    // caption resource key (tab/group/detail label) — carried so the real caption is shown for
    // cross-check instead of only a synthesized placeholder.
    caption: captionKey(v),
    // RV5 — real fixtures often set the diff-op `index` (position in the parent) WITHOUT `values.order`;
    // fall back to `index` so such items keep their intended position instead of collapsing to order:null.
    order: isNum(v.order) ? v.order : opIndex,
    // classic grid coordinates — preserved so the mapper reproduces the real multi-column layout
    // (e.g. a wide 3-column header) instead of inventing a single narrow column.
    layout: normalizeLayout(v.layout),
    // tooltip resource key (classic `tip.content.bindTo = "Resources.Strings.XTip"`) — carried to the
    // Freedom field so hints aren't lost; and the component `generator` (image/photo etc.) for
    // recognising non-field components the mapper otherwise drops.
    tip: v.tip?.content && isStr(v.tip.content.bindTo) ? v.tip.content.bindTo : null,
    hint: hintKey(v),
    generator: strOrNull(v.generator),
    visible: visibility(v),
    astIndex: i, // original AST diff position — for diagnostic→element matching after filtering (E3)
  };
}

function normalizeLayout(l) {
  if (!l || typeof l !== "object") return null;
  const n = (x) => (isNum(x) ? x : null);
  const out = { column: n(l.column), colSpan: n(l.colSpan), row: n(l.row), rowSpan: n(l.rowSpan) };
  return Object.values(out).some(v => v !== null) ? out : null;
}

function normalizeDetails(d) {
  const out = {};
  for (const k of safeKeys(d)) {
    const e = plainObj(d[k]);
    const f = plainObj(e.filter);
    out[k] = { schemaName: strOrNull(e.schemaName),
               entitySchemaName: strOrNull(e.entitySchemaName),
               detailColumn: strOrNull(f.detailColumn),
               masterColumn: strOrNull(f.masterColumn) };
  }
  return out;
}

// `modules` = the sub-modules a classic page composes INSIDE itself (widgets, dashboards, and the embedded
// profile CARD of a linked record). The identity lives in `config`, not in `moduleName`: real OOTB bodies
// (ContactPageV2/AccountPageV2, verified on-stand) carry NO `moduleName` at all and name the embedded schema
// in `config.schemaName`, with the wiring in `config.parameters.viewModelConfig`. Dropping `config` (as this
// did) is what left an embedded profile card unrecognisable — the mapper saw a nameless module and the page
// lost the card. Keep the whole wiring so mapProfileCards can recognise the pattern STRUCTURALLY.
function normalizeModules(m) {
  const out = [];
  if (m && typeof m === "object") for (const k of Object.keys(m)) {
    const e = m[k] || {};
    const cfg = plainObj(e.config);
    const vmc = plainObj(plainObj(cfg.parameters).viewModelConfig);
    out.push({
      key: k,
      moduleName: isStr(e.moduleName) ? e.moduleName : null,
      // the embedded schema this module renders (e.g. AccountProfileSchema, SectionActionsDashboard)
      schemaName: strOrNull(cfg.schemaName),
      // profile-card wiring: `masterColumnName` = the lookup ON THE MASTER page whose value IS the profiled
      // record's Id (BaseProfileSchema loads the profile entity from it); `profileColumnName` = the column on
      // the PROFILED entity pointing back at the master, used only to pre-fill a newly ADDED linked record
      // (BaseProfileSchema.getDefaultProfileColumnValues). Verified against the platform schema, not inferred.
      masterColumnName: strOrNull(vmc.masterColumnName),
      profileColumnName: strOrNull(vmc.profileColumnName),
      // the actions/DCM dashboard module carries `masterColumnName` TOO — but nested per entity under
      // `dashboardConfig`, never on `viewModelConfig` itself. Recording the key lets the mapper exclude that
      // shape instead of mistaking every dashboard for a profile card.
      hasDashboardConfig: vmc.dashboardConfig != null && typeof vmc.dashboardConfig === "object",
      // ENG-95806 — a record-scoped CARD WIDGET (a small indicator/chart stored in SysWidgetDashboard, e.g. the
      // KPI charts on a Campaign page) carries the two coordinates the migrator needs to convert it: `recordId`
      // (the SysWidgetDashboard record) and `widgetKey` (which widget in it). normalizeModules dropped both as
      // non-boolean values, leaving the widget an unconvertible generic `component`. Keep them so mapWidgets can
      // recognise the widget and emit a concrete card-widget decision; a module missing EITHER stays generic.
      widgetKey: strOrNull(vmc.widgetKey),
      recordId: strOrNull(vmc.recordId),
      // display flags the classic card toggled (IsPhoneVisible, …) — booleans on viewModelConfig. They say
      // WHICH extra values the card showed, which the Freedom native card may not cover.
      displayFlags: Object.fromEntries(Object.entries(vmc).filter(([, v]) => typeof v === "boolean")),
    });
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
  // Drop null/non-object entries (a sparse hole or unresolved spread inside a rule's `conditions`). Without this,
  // `c.comparisonType` below threw an UNCAUGHT TypeError here in mergeHierarchy — breaking the documented
  // `runMigration ... does NOT throw` contract (a hostile/malformed body would crash the CLI with a raw stack).
  return conds.filter((c) => c && typeof c === "object").map(c => {
    const l = c.leftExpression || {}, r = c.rightExpression || {};
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

// diff replay — one op against the accumulated item map. `warnings` collects the non-fatal diagnostics.
function replayDiffOp(op, items, { seed, pkg }, warnings) {
  const cur = items.get(op.name);
  if (op.operation === "insert") { items.set(op.name, makeItem(op, seed, pkg)); return; }
  if (op.operation === "merge") return replayMerge(op, cur, items, { seed, pkg }, warnings);
  if (op.operation === "move") return replayMove(op, cur, { seed, pkg }, warnings);
  if (op.operation === "remove") return replayRemove(op, cur, items, { seed, pkg }, warnings);
}

// patch in place; carry contentType/itemType too — a later schema can introduce a control hint
// (e.g. mark a text field as lookup, contentType 5); dropping it made control selection wrong.
function replayMerge(op, cur, items, { seed, pkg }, warnings) {
  if (!cur) {
    // merge onto an item no lower schema defined: record a stub with the SAME shape as an insert
    // (RV4 — carry layout/tip/hint/generator/visible/caption too, so a `visible:false`/tip/caption on
    // this first merge-definition isn't silently dropped). templateOwned marks the first def's origin.
    items.set(op.name, makeItem(op, seed, pkg));
    warnings.push({ op: "merge", name: op.name, schema: pkg, hint: "merge onto an item no lower schema defined — base-template element not seeded (F2) or schemas out of order (F1)" });
    return;
  }
  for (const k of ["order", "contentType", "itemType", "visible"]) { if (op[k] != null) cur[k] = op[k]; }
  for (const k of ["bindTo", "layout", "tip", "hint", "caption", "generator"]) { if (op[k]) cur[k] = op[k]; }
  cur.provenance.push(pkg);
  if (!seed) cur.schemaTouched = true; // a CLIENT schema reconfigured this (possibly base-owned) element
}

// classic idiom: `remove` then `move` = reposition — the element ends up PRESENT at the new
// spot. So a move onto a tombstoned item RESURRECTS it (else a displayed field silently vanishes,
// e.g. Product's IsArchive/"Inactive" checkbox).
function replayMove(op, cur, { seed, pkg }, warnings) {
  if (!cur) {
    warnings.push({ op: "move", name: op.name, schema: pkg, hint: `move to '${op.parentName}' but the item was never defined — move dropped; check base seed (F2) / schema order (F1)` });
    return;
  }
  if (op.parentName) { cur.parent = op.parentName; }
  // a reposition also carries the NEW order/index — apply it so tab/field ordering survives the move
  // (previously only the parent was updated, so a pure reorder silently kept the old position).
  if (op.order != null) { cur.order = op.order; }
  if (cur.removed) { cur.removed = false; cur.removedBy = null; cur.removedBySeed = false; }
  cur.provenance.push(pkg);
  if (!seed) cur.schemaTouched = true; // a CLIENT schema repositioned this (possibly base-owned) element
}

// removedBySeed: a template-internal remove (base template dropping a base element) is context,
// not a client B6 decision — the mapper filters it out like every other template-only element.
function replayRemove(op, cur, items, { seed, pkg }, warnings) {
  if (cur) { cur.removed = true; cur.removedBy = pkg; cur.removedBySeed = seed; return; }
  items.set(op.name, { name: op.name, removed: true, removedBy: pkg, removedBySeed: seed, provenance: [pkg] });
  warnings.push({ op: "remove", name: op.name, schema: pkg, hint: "remove of an item no lower schema defined — recorded as tombstone; check base seed / schema order" });
}

// businessRules + legacy rules (merge by attribute::ruleKey)
function mergeRuleBlocks(L, seed, rules) {
  for (const [sys, block] of [["businessRules", L.businessRules], ["rules", L.rules]]) {
    for (const attr of Object.keys(block || {})) {
      const ar = block[attr]; if (!ar || typeof ar !== "object") continue;
      for (const key of Object.keys(ar)) {
        const id = `${attr}::${key}`;
        const rec = normalizeRule(ar[key] || {}, { attr, key, sys, seed, pkg: L.pkg });
        if (rules.has(id)) { const p = rules.get(id); rec.provenance = [...p.provenance, L.pkg]; rec.schemaTouched = p.schemaTouched || !seed; }
        rules.set(id, rec);
      }
    }
  }
}

function normalizeRule(r, { attr, key, sys, seed, pkg }) {
  return {
    attr, key, system: sys,
    // guard: only decode when numeric (after enum seeding legacy rules are numbers too);
    // a still-non-numeric value is genuinely symbolic/unknown -> flagged, never silently "0".
    ruleType: isNum(r.ruleType) ? (RULE_TYPE[r.ruleType] ?? String(r.ruleType)) : "symbolic",
    property: isNum(r.property) ? (PROP[r.property] ?? String(r.property)) : null,
    conditions: sanitizeConditions(r.conditions),
    filterColumn: strOrNull(r.baseAttributePatch),
    comparison: numOrNull(r.comparisonType),
    value: ["number", "string", "boolean"].includes(typeof r.value) ? r.value : null,
    dataValueType: numOrNull(r.dataValueType),
    enabled: r.enabled !== false, removed: r.removed === true,
    provenance: [pkg], schemaTouched: !seed,
  };
}

function mergeDetails(L, seed, details) {
  for (const k of Object.keys(L.details)) {
    const prev = details.get(k);
    const rec = { key: k, ...L.details[k], provenance: [L.pkg], schemaTouched: !seed };
    if (prev) { rec.provenance = [...prev.provenance, L.pkg]; rec.schemaTouched = prev.schemaTouched || !seed; }
    details.set(k, rec);
  }
}

// methods (override stack) — track whether any schema schema contributed
function mergeMethods(L, seed, methods) {
  for (const m of L.methods) {
    const prev = methods.get(m);
    methods.set(m, { pkgs: [...(prev?.pkgs || []), L.pkg], schemaTouched: (prev?.schemaTouched || false) || !seed });
  }
}

// modules (widgets/charts) — merge by key
function mergeModules(L, seed, components) {
  for (const c of L.modules || []) {
    const prev = components.get(c.key);
    const rec = { ...c, provenance: [L.pkg], schemaTouched: (prev?.schemaTouched || false) || !seed };
    if (prev) rec.provenance = [...prev.provenance, L.pkg];
    components.set(c.key, rec);
  }
}

// Replay each tagged schema (seed-template first, then the page's own schemas) into the merge stores: diff ops
// into `items`, and the keyed rule/detail/method/module blocks into their maps. Extracted for Sonar CC 15.
function replayTagged(tagged, stores, warnings) {
  const { items, rules, details, methods, components } = stores;
  for (const { L, seed } of tagged) {
    for (const op of L.diff) {
      if (!op) continue; // null slot (sparse hole / unresolved spread) — already flagged at parse time
      replayDiffOp(op, items, { seed, pkg: L.pkg }, warnings);
    }
    mergeRuleBlocks(L, seed, rules);
    mergeDetails(L, seed, details);
    mergeMethods(L, seed, methods);
    mergeModules(L, seed, components);
  }
}

// CASCADE REMOVE (runtime parity): in Classic, removing a container removes its WHOLE SUBTREE. Propagate the
// removal DOWN — an item whose parent is a TOMBSTONED (transitively) item is itself removed. Sweep ONLY
// `templateOwned` (base) orphans through a parent that EXISTS and is `removed`; a genuinely-absent parent (seed
// gap F2) and CLIENT-authored orphans are left to surface as unresolvedParents. Fixpoint over the item set (a
// removed container's removed child can in turn orphan ITS children). Extracted from mergeHierarchy for Sonar CC 15.
function cascadeRemove(items) {
  for (let changed = true; changed; ) {
    changed = false;
    for (const it of items.values()) {
      if (it.removed || !it.parent || !it.templateOwned) continue;
      const p = items.get(it.parent);
      if (p?.removed) { it.removed = true; it.removedBy = it.removedBy || p.removedBy; it.removedBySeed = p.removedBySeed; it.cascadeRemoved = true; changed = true; }
    }
  }
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

  replayTagged(tagged, { items, rules, details, methods, components }, warnings);
  // Propagate container removals down the subtree (runtime parity) — see cascadeRemove. This clears the false
  // `unresolvedParents` that HARD-BLOCKED legitimate remove+re-layout pages (base children of a removed container).
  cascadeRemove(items);

  const alive = [...items.values()].filter(i => !i.removed);
  // cascade-removed items are structural cleanup (a removed container's subtree), NOT a client B6 decision — keep
  // them out of `removed` so they don't flood the removals worklist; excluding them from `alive` already cleared
  // the false unresolvedParents.
  const removed = [...items.values()].filter(i => i.removed && !i.cascadeRemoved);
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
  const processNames = [...new Set(schemas.flatMap(l => l.processLaunch?.names || []))].sort(byLocale);
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
  // INFORMATIONAL ONLY — surfaced in seedQuality for diagnostics; it NO LONGER gates `looksSkeletal` (that is now the
  // kind-agnostic method-COUNT test below). Kept because a record-page seed defining `getActions` is useful context
  // when reading a seedQuality dump; do NOT reintroduce it as a gate (keying on it false-blocked section/mini seeds).
  const hasGetActions = seedMethodNames.has("getActions");
  // #19 — the seed must be the REAL fetched base-template chain, not a broken/empty bundle fetch. Since the seed
  // ALWAYS comes from `get-classic-page-sources` (real schema bodies read off the stand) — never hand-authored
  // in the normal flow — the thing worth catching is a broken/near-empty FETCH, not a "hand skeleton". So the test
  // is KIND-AGNOSTIC: a real fetched base chain of ANY kind defines MANY methods (verified on-stand: record ≈347,
  // section `BaseSectionV2` = 428, mini `BaseMiniPage` = 152), while a broken/empty fetch has ≈0. Keying on the
  // method COUNT (not a specific method) fixes the false-block this used to hit: it keyed on `getActions`, which
  // ONLY record pages define — sections define `getSectionActions`, mini pages none — so real section/mini seeds
  // were wrongly flagged, which pushed the agent into a workaround (bundling the section as `schemas` + a thin
  // seed) that produced hollow folds. Count-based: 150–430 (real) all clear; ≈0 (broken fetch) blocks; a token
  // 1-method stub still blocks (< 5).
  const SEED_MIN_METHODS = 5;
  // Structural stub signal (round-10 Major 1): the seed method names that have a REAL (non-empty) body in SOME layer.
  // The PARSER sets `emptyMethods` from real body strings; L()-built test seeds carry none → treated as real-bodied.
  const seedNonEmptyMethods = new Set(seedTemplate.flatMap(l => (l.methods || []).filter(m => !(l.emptyMethods || []).includes(m))));
  // Skeletal if near-empty by COUNT (< 5) OR every seed method is an empty stub `(){}` (seedNonEmptyMethods empty) — the
  // latter catches a >=5-method skeleton the count test alone would clear. A seed with >=5 REAL-bodied methods but < 150
  // is NOT skeletal; it is the possiblyPartial advisory below (no false-block on a legitimately small real template).
  const looksSkeletal = seedTemplate.length > 0 && (seedMethodNames.size < SEED_MIN_METHODS || seedNonEmptyMethods.size === 0);
  // The mid-range partial-fetch blind spot the < 5 hard gate misses: a real base-template chain of ANY kind defines
  // 150+ methods (mini 152, record ≈347, section 428), so a seed with 5..149 methods is likely a TRUNCATED fetch that
  // silently folds onto an incomplete base. This is surfaced as an ADVISORY (`possiblyPartial`) — NOT a hard warning:
  // a numeric floor as a hard block would false-block, and the seed layers are named by PACKAGE (CrtNUI / …), not by a
  // recognizable "Base*" schema, so a name assertion is unreliable. The plan renders it so the agent confirms the full
  // parent-template chain was captured instead of building on a partial one silently.
  const SEED_PARTIAL_METHODS = 150;
  const possiblyPartial = seedTemplate.length > 0 && !looksSkeletal && seedMethodNames.size < SEED_PARTIAL_METHODS;
  const seedQuality = {
    seeded: seedTemplate.length > 0, seedTemplate: seedTemplate.length,
    seedMethods: seedMethodNames.size, seedRealMethods: seedNonEmptyMethods.size, hasGetActions,
    looksSkeletal, possiblyPartial,
  };
  if (looksSkeletal) {
    const allStub = seedMethodNames.size >= SEED_MIN_METHODS && seedNonEmptyMethods.size === 0;
    const detail = allStub ? "but ALL of them are EMPTY stubs (no bodies)" : `(below the ${SEED_MIN_METHODS}-method floor)`;
    warnings.push({
      op: "seed", name: "skeletal-seed", schema: "(seed)",
      message: `SEED LOOKS SKELETAL (#19): the ${seedTemplate.length} seed schema(s) define ${seedMethodNames.size} method(s) ${detail} — a REAL fetched base-template chain of any kind defines many methods WITH bodies (record ≈347, section 428, mini 152). This is almost certainly a broken/empty or hand-authored seed, not the real fetched template body. Re-assemble the manifest via get-classic-page-sources so it reads the real parent-template bodies into \`seed\` — do NOT build on a skeleton.`,
    });
  }

  return {
    entity,
    // Full alive layout tree (containers, groups, tabs, fields) with parent links — the input F3's
    // mapper walks to route each field to its owning tab/group. Diff-items carry `templateOwned`
    // (defining insert came from a seed schema): payload = client-authored items, structural identity =
    // template ownership. Keyed projections below carry `fromTemplate` (= no schema schema contributed).
    items: alive.map(i => ({ name: i.name, parent: i.parent, propertyName: i.propertyName,
      itemType: i.itemType, contentType: i.contentType, bindTo: i.bindTo || null,
      isTab: i.isTab, order: i.order, layout: i.layout || null, tip: i.tip || null, hint: i.hint || null, generator: i.generator || null,
      visible: i.visible ?? null, caption: i.caption || null, provenance: i.provenance, templateOwned: !!i.templateOwned, schemaTouched: !!i.schemaTouched })),
    fields: alive.filter(i => i.bindTo).map(i => ({ name: i.name, bindTo: i.bindTo, parent: i.parent, contentType: i.contentType, order: i.order ?? null, layout: i.layout || null, tip: i.tip || null, hint: i.hint || null, visible: i.visible ?? null, provenance: i.provenance, templateOwned: !!i.templateOwned, schemaTouched: !!i.schemaTouched })),
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
