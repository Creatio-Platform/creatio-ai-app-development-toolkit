// engine/conventions.mjs — PROJECT CONVENTIONS: the request namespace, helper modules and constants modules a
// customer team already uses, carried from discovery into the plan, every build/fix task and `--verify`.
//
// Without a carrier for them the engine hard-coded `usr.` request names, builders never saw the team's helper
// module, and lookup ids were pasted as raw GUIDs although the project's constants modules held every one of them.
// The analysis had found all three; nothing it found could reach a builder.
//
// The block is AGENT-SUPPLIED and GATED like `manifest.placement`: `--plan` is not approvable until it is recorded
// as `{ "resolved": true, … }`. A verified fallback to `usr.` is a valid answer; "never checked" is not.
//
//   "projectConventions": {
//     "resolved": true,
//     "requestPrefix": "ab",                  // the namespace custom requests use (`ab.SomethingRequest`)
//     "validatorPrefix": "ab",                // optional; defaults to requestPrefix
//     "converterPrefix": "ab",                // optional; defaults to requestPrefix
//     "helperModules": ["AbClientHelperModule"],   // modules the team's Freedom pages import for shared logic
//     "constantsModules": ["AbConstants"],       // modules that hold the ids of existing records
//     "source": "freedom-pages" | "schema-prefix" | "sys-setting" | "fallback",   // which detection step decided
//     "evidence": "ab. — 7 requests on Page_OrderDelivery",
//     "confirmedBy": "plan" | "user",         // "user" once the user answered a conflict or a change
//     "conflict": { "ab": 7, "usr": 2 },      // optional; request counts per namespace when detection disagreed
//     "previous": { "folder": "<earlier migration folder>", "requestPrefix": "ab", "helperModules": [...],
//                   "constantsModules": [...] }   // optional; what the latest earlier migration recorded
//   }
//   "constantsModules": { "AbConstants": { "body": "<define(...) source>" } | "<define(...) source>" }
//
// Pure: no I/O. migrate.mjs resolves the facts once per run (`conventionFacts`) and gates `--plan` on their issues;
// designspec.mjs renders and verifies; tasks.mjs copies the block into every task file.
import { parseDefineModule, parseJsExpression, staticPropKey, stringSlots, walkAstBounded } from "./engine.mjs";

// The namespace every Creatio page defaulted to before a project said otherwise.
export const DEFAULT_REQUEST_PREFIX = "usr";
// The platform's own namespace: reserved, never a project's.
const PLATFORM_NAMESPACE = "crt";
const CONVENTION_SOURCES = Object.freeze(["freedom-pages", "schema-prefix", "sys-setting", "fallback"]);
const CONFIRMED_BY = Object.freeze(["plan", "user"]);
// The three kinds of custom name a page declares, each with its own prefix key.
export const NAME_KINDS = Object.freeze(["request", "validator", "converter"]);
const PREFIX_KEY = Object.freeze({ request: "requestPrefix", validator: "validatorPrefix", converter: "converterPrefix" });
const NAMESPACE_RX = /^[A-Za-z][A-Za-z0-9]*$/;
// A whole-string record id. The engine's one copy: assemble.mjs re-exports it.
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// Local, not imported: migrate.mjs and reads.mjs keep their own, and both sit above this module in the imports.
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// `ab`, `ab.`, ` Ab ` and `AB` are one namespace: recorded lower-case, as the reference tells the agent to write it
// (a `SchemaNamePrefix` of `Usr` is the namespace `usr`), so the mapper emits and `--verify` reads the same spelling.
export const normalizePrefix = (v) => (typeof v === "string" ? stripTrailingDots(v.trim()).toLowerCase() : "");
function stripTrailingDots(s) {
  let end = s.length;
  while (end > 0 && s[end - 1] === ".") end--;
  return s.slice(0, end);
}
const nameList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))] : []);

// The recorded block, normalized; null when there is none to read. Missing validator/converter prefixes take the
// request prefix, because a project that names its requests `ab.` names its validators the same way unless it
// shows otherwise.
export function conventionsOf(manifest) {
  const raw = manifest?.projectConventions;
  if (!isObj(raw) || raw.resolved !== true) return null;
  const requestPrefix = normalizePrefix(raw.requestPrefix);
  return {
    requestPrefix,
    validatorPrefix: normalizePrefix(raw.validatorPrefix) || requestPrefix,
    converterPrefix: normalizePrefix(raw.converterPrefix) || requestPrefix,
    helperModules: nameList(raw.helperModules),
    constantsModules: nameList(raw.constantsModules),
    source: typeof raw.source === "string" ? raw.source : null,
    evidence: typeof raw.evidence === "string" ? raw.evidence.trim() : "",
    confirmedBy: typeof raw.confirmedBy === "string" ? raw.confirmedBy : null,
    conflict: conflictOf(raw.conflict),
    previous: previousOf(raw.previous),
  };
}
// The prefix per kind of name, `{ request, validator, converter }` — the shape `--verify` checks against.
export const prefixesOf = (c) => Object.fromEntries(NAME_KINDS.map((k) => [k, c[PREFIX_KEY[k]]]));
// `{ ns: count }`, kept only when it names at least two namespaces — one namespace is no conflict.
function conflictOf(v) {
  if (!isObj(v)) return null;
  // Keys that are one namespace (`ab`, `Ab.`) are summed; a key with no namespace left (`.`) is dropped.
  const sums = new Map();
  for (const [k, n] of Object.entries(v)) {
    const ns = normalizePrefix(k);
    if (ns && Number.isFinite(n) && n > 0) sums.set(ns, (sums.get(ns) || 0) + n);
  }
  const counts = [...sums].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return counts.length >= 2 ? counts : null;
}
function previousOf(v) {
  if (!isObj(v)) return null;
  return {
    folder: typeof v.folder === "string" ? v.folder : "",
    requestPrefix: normalizePrefix(v.requestPrefix),
    // Empty when the earlier record did not name them — then they took its request prefix, as this run's do.
    validatorPrefix: normalizePrefix(v.validatorPrefix) || normalizePrefix(v.requestPrefix),
    converterPrefix: normalizePrefix(v.converterPrefix) || normalizePrefix(v.requestPrefix),
    helperModules: nameList(v.helperModules),
    constantsModules: nameList(v.constantsModules),
  };
}
// What differs between the earlier migration's record and this run's, as readable phrases (empty = same).
function previousDifferences(c) {
  const p = c?.previous;
  if (!p) return [];
  const out = [];
  for (const kind of NAME_KINDS) {
    const key = PREFIX_KEY[kind];
    if (p[key] && p[key] !== c[key]) out.push(`${kind} prefix ${p[key]}. → ${c[key]}.`);
  }
  for (const key of ["helperModules", "constantsModules"]) {
    const was = new Set(p[key]);
    const now = new Set(c[key]);
    const added = c[key].filter((m) => !was.has(m));
    const dropped = p[key].filter((m) => !now.has(m));
    if (added.length) out.push(`${key} added: ${added.join(", ")}`);
    if (dropped.length) out.push(`${key} dropped: ${dropped.join(", ")}`);
  }
  return out;
}

// ---- the run's facts: the block, its blockers and the GUID index, resolved ONCE per manifest ----
//
// One object, so the three can never come from two different sources: the root run resolves it and every fold
// inherits it whole (a fold's child bundle carries neither the block nor the module bodies). Memoized on the
// manifest object, because `checklistOpts` is rebuilt several times per CLI command and each constants module is
// a full parse.
const FACTS = new WeakMap();
export function conventionFacts(manifest) {
  if (!isObj(manifest)) return { conventions: null, issues: [NOT_RESOLVED], guidIndex: new Map() };
  if (!FACTS.has(manifest)) FACTS.set(manifest, resolveFacts(manifest));
  return FACTS.get(manifest);
}
function resolveFacts(manifest) {
  const c = conventionsOf(manifest);
  if (!c) return { conventions: null, issues: [NOT_RESOLVED], guidIndex: new Map() };
  const modules = c.constantsModules.map((name) => readModule(manifest.constantsModules, name));
  return {
    conventions: c,
    issues: [...prefixIssues(c), ...recordIssues(c, manifest.projectConventions), ...questionIssues(c), ...modules.flatMap(moduleIssue)],
    guidIndex: guidIndexOf(modules),
  };
}
// The gate's blockers and the GUID index, by manifest — the facts above, for a caller holding a manifest.
export const projectConventionsIssues = (manifest) => conventionFacts(manifest).issues;
export const constantsGuidIndex = (manifest) => conventionFacts(manifest).guidIndex;

const NOT_RESOLVED = "projectConventions not resolved — record it in manifest.projectConventions as { \"resolved\": true, \"requestPrefix\", \"helperModules\", \"constantsModules\", \"source\", \"evidence\", \"confirmedBy\" } (a verified fallback to `usr` is a valid answer; \"never checked\" is not)";

function prefixIssues(c) {
  const issues = [];
  for (const kind of NAME_KINDS) {
    const key = PREFIX_KEY[kind];
    const v = c[key];
    if (!NAMESPACE_RX.test(v)) issues.push(`projectConventions.${key} '${v}' is not a namespace — letters and digits only, no dot (\`ab\`, not \`ab.X\`)`);
    else if (v.toLowerCase() === PLATFORM_NAMESPACE) issues.push(`projectConventions.${key} is '${PLATFORM_NAMESPACE}' — that namespace is the platform's own; a project's custom ${kind}s never use it`);
  }
  if (c.source === "fallback" && c.requestPrefix !== DEFAULT_REQUEST_PREFIX) {
    issues.push(`projectConventions.source is 'fallback' but requestPrefix is '${c.requestPrefix}' — the fallback is \`${DEFAULT_REQUEST_PREFIX}\`; a different prefix came from a detection step, so name that step`);
  }
  return issues;
}
function recordIssues(c, raw) {
  const issues = [];
  if (!CONVENTION_SOURCES.includes(c.source)) issues.push(`projectConventions.source '${c.source ?? "(unset)"}' is not one of ${CONVENTION_SOURCES.join(" / ")}`);
  if (!c.evidence) issues.push("projectConventions.evidence is empty — say what decided the prefix (e.g. \"ab. — 7 requests on Page_OrderDelivery\", or \"no custom requests; SchemaNamePrefix = Usr\")");
  if (!CONFIRMED_BY.includes(c.confirmedBy)) issues.push(`projectConventions.confirmedBy '${c.confirmedBy ?? "(unset)"}' is not one of ${CONFIRMED_BY.join(" / ")}`);
  for (const key of ["helperModules", "constantsModules"]) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) issues.push(`projectConventions.${key} is not a list of module names`);
  }
  return issues;
}
// The two cases that need the USER's answer, not the agent's: detection disagreed with itself, or this run's
// conventions differ from what the latest earlier migration recorded.
function questionIssues(c) {
  if (c.confirmedBy === "user") return [];
  const issues = [];
  if (c.conflict) {
    const counts = c.conflict.map(([ns, n]) => ns + ". × " + n).join(", ");
    issues.push(`projectConventions.conflict — the target packages use ${c.conflict.length} namespaces (${counts}); ask the user which one this migration uses and record the answer with confirmedBy: "user"`);
  }
  const diff = previousDifferences(c);
  if (diff.length) {
    const where = c.previous.folder ? " in '" + c.previous.folder + "'" : "";
    issues.push(`projectConventions differ from the earlier migration${where} (${diff.join("; ")}); ask the user which to keep and record the answer with confirmedBy: "user"`);
  }
  return issues;
}
// One declared constants module, read and parsed once: `{ name, parsed }`, or `{ name, missing: true }`.
function readModule(bodies, name) {
  const v = isObj(bodies) && Object.hasOwn(bodies, name) ? bodies[name] : null;
  let src = null;
  if (typeof v === "string") src = v;
  else if (isObj(v) && typeof v.body === "string") src = v.body;
  return src == null ? { name, missing: true } : { name, parsed: parseDefineModule(src) };
}
function moduleIssue(m) {
  if (m.missing) return [`constants module '${m.name}' has no body in manifest.constantsModules — fetch it with get-client-unit-schema and add it as { "${m.name}": { "body": "<source>" } }, so the plan can map its ids`];
  return m.parsed.error ? [`constants module '${m.name}' cannot be read: ${m.parsed.error}`] : [];
}

// ---- the GUID index: every id a constants module holds, by its `Module.Path` ----
//
// A constants module returns (directly or through a local variable) a tree of objects whose leaves are record
// ids. The path is the chain of property names from the module's return value: `AbConstants.Status.New`.
// A variable the return value does not reach is still read, under its own name, so an id held only there is not
// lost. Nothing is evaluated; only literals count.
function guidIndexOf(modules) {
  const index = new Map();
  for (const m of modules) {
    if (m.missing || m.parsed.error) continue;
    for (const { guid, path } of moduleGuids(m.name, m.parsed)) {
      const list = index.get(guid) || [];
      if (!list.includes(path)) list.push(path);
      index.set(guid, list);
    }
  }
  return index;
}
function moduleGuids(name, parsed) {
  const body = parsed.factory?.body?.type === "BlockStatement" ? parsed.factory.body.body : [];
  const vars = factoryVars(body);
  const st = { vars, assigned: factoryAssignments(body, vars), out: [], onPath: new Set(), reached: new Set() };
  walkValue(parsed.returned, [name], st);
  for (const [varName, node] of vars) if (!st.reached.has(node)) walkValue(node, [name, varName], st);
  return st.out;
}
// The factory's top-level `var`/`let`/`const` declarators with an object or array initializer.
function factoryVars(body) {
  const vars = new Map();
  for (const st of body) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      if (d.id?.type === "Identifier" && (d.init?.type === "ObjectExpression" || d.init?.type === "ArrayExpression")) vars.set(d.id.name, d.init);
    }
  }
  return vars;
}
// A tree filled by assignment rather than written as one literal: `var Ids = {}; Ids.Status = {}; Ids.Status.New =
// "…";`. Each top-level `Var.a.b = value` is kept against the variable's initializer as `[["a", "b"], value]`, so
// the walk reaches it under the same path a literal would give it.
function factoryAssignments(body, vars) {
  const assigned = new Map();
  for (const st of body) {
    const e = st.type === "ExpressionStatement" ? st.expression : null;
    if (e?.type !== "AssignmentExpression" || e.operator !== "=") continue;
    const chain = memberChain(e.left);
    if (!chain || chain.keys.length === 0 || !vars.has(chain.root)) continue;
    const init = vars.get(chain.root);
    assigned.set(init, [...(assigned.get(init) || []), [chain.keys, e.right]]);
  }
  return assigned;
}
// `Ids.Status["New"]` → `{ root: "Ids", keys: ["Status", "New"] }`; null for anything not statically keyed.
function memberChain(node) {
  const keys = [];
  let n = node;
  while (n?.type === "MemberExpression") {
    let key = null;
    if (!n.computed && n.property.type === "Identifier") key = n.property.name;
    else if (n.computed && n.property.type === "Literal") key = String(n.property.value);
    if (key == null) return null;
    keys.unshift(key);
    n = n.object;
  }
  return n?.type === "Identifier" ? { root: n.name, keys } : null;
}
// `onPath` holds the nodes on the CURRENT path only, so a self-reference terminates while one object exposed under
// two keys (`{ OrderStatus: s, Status: s }`) is indexed under both paths — every candidate the plan must list.
function walkValue(node, path, st) {
  if (!node || st.onPath.has(node)) return;
  if (node.type === "Identifier") {
    if (st.vars.has(node.name)) walkValue(st.vars.get(node.name), path, st);
  } else if (node.type === "Literal") {
    if (typeof node.value === "string" && GUID_RE.test(node.value)) st.out.push({ guid: node.value.toLowerCase(), path: path.join(".") });
  } else {
    st.onPath.add(node);
    st.reached.add(node);
    for (const [key, child] of childEntries(node)) walkValue(child, [...path, key], st);
    for (const [keys, child] of st.assigned.get(node) || []) walkValue(child, [...path, ...keys], st);
    st.onPath.delete(node);
  }
}
// An object's statically keyed properties or an array's elements, as `[key, node]`; nothing for any other node.
function childEntries(node) {
  if (node.type === "ObjectExpression") {
    return node.properties.map((p) => [p.type === "Property" ? staticPropKey(p) : null, p.value]).filter(([k]) => k != null);
  }
  if (node.type === "ArrayExpression") return node.elements.map((el, i) => [String(i), el]);
  return [];
}

// The record ids the builders will meet that a declared constants module holds, `[{ guid, paths }]` in first-seen
// order. `sources` are what they port from: the mapped change sets (walked as values — the rule conditions and
// filters compare against ids the plan tables never print) and the Classic bodies (scanned as text). A source may
// be a thunk, so an expensive one (reading the bodies) runs only when needed. Empty, and no source is touched, when
// the index is empty.
export function recordIdsUsed(guidIndex, sources) {
  const found = new Set();
  if (!guidIndex?.size) return [];
  const take = (s) => { for (const m of s.matchAll(GUID_IN_TEXT)) { const g = m[0].toLowerCase(); if (guidIndex.has(g)) found.add(g); } };
  const walk = (v) => {
    if (typeof v === "function") walk(v());
    else if (typeof v === "string") take(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  sources.forEach(walk);
  return [...found].map((guid) => ({ guid, paths: guidIndex.get(guid) }));
}

// ---- reading a BUILT page (the `--built` entry: get-page's merged bundle) ----
//
// get-page's `bundle.json` carries `deps`, `handlers`, `validators` and `converters` as SOURCE strings (a hand-built
// payload may carry them parsed). Each reader accepts both and returns null when the bundle did not say, so a row
// can tell "not provided" from "provided and empty".
export function bundleDeps(entry) {
  const v = entry?.deps;
  if (v == null) return null;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  // The source of an array literal: its string elements. Anything else is read as text, from its first `[…]` only,
  // so a name quoted elsewhere in the payload cannot pass for an import.
  const node = parseJsExpression(v);
  if (node?.type === "ArrayExpression") return node.elements.filter(isStringLiteral).map((el) => el.value);
  const text = String(v);
  const open = text.indexOf("[");
  const close = open < 0 ? -1 : text.indexOf("]", open);
  if (close < 0) return [];
  return [...text.slice(open + 1, close).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}
const isStringLiteral = (n) => n?.type === "Literal" && typeof n.value === "string";
// get-page's `bundle.args`: the page's `define()` factory parameters in deps order, as source (`(contractPage)`,
// `(sdk, mbDocumentTotals)`) or an array. Source is PARSED as a parameter list, so a destructured or defaulted
// parameter (`({ sdk, http }, xPage)`, `(sdk = { a: 1, b: 2 }, xPage)`) is still one slot. A slot that names no
// plain identifier stays null, so the positions still line up with the deps. null when the bundle did not carry them
// or the source is not a parameter list.
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const paramName = (p) => {
  if (p?.type === "Identifier") return p.name;
  return p?.type === "AssignmentPattern" && p.left?.type === "Identifier" ? p.left.name : null;
};
export function bundleArgs(entry) {
  const v = entry?.args;
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((a) => (IDENT_RE.test(String(a).trim()) ? String(a).trim() : null));
  const text = String(v).trim();
  const params = text.startsWith("(") ? text : "(" + text + ")";
  const fn = parseJsExpression(`function ${params} {}`);
  return fn?.type === "FunctionExpression" ? fn.params.map(paramName) : null;
}
// A dependency a `reads/modules/<schema>.js` file can exist for: a schema name. An npm-scoped package
// (`@creatio-devkit/common`) is the platform's, never a module the build wrote.
export const MODULE_SCHEMA_NAME = /^[A-Za-z_]\w*$/;
// The local name each `define()` dependency goes by on the page: `deps[i]` -> `args[i]`, null where the page gave it
// none (or the bundle carried no `args`). Paired by POSITION: a deps slot that is no string literal keeps its place
// and is left out of the map, so it cannot shift a later dependency onto the parameter before it. null when the
// bundle carried no `deps`.
export function moduleAliases(entry) {
  const slots = depSlots(entry?.deps);
  return slots && pairSlots(slots, bundleArgs(entry) || []);
}
// `slots[i]` -> `names[i]` (null where there is no name), a null slot left out without shifting the rest.
const pairSlots = (slots, names) => new Map(slots.map((d, i) => [d, names[i] ?? null]).filter(([d]) => d != null));
// The `deps` slots in order, a slot that is no string null; null when the bundle carried no `deps` or its source is
// not an array literal (then no position can be trusted).
function depSlots(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : null));
  const node = parseJsExpression(v);
  return node?.type === "ArrayExpression" ? stringSlots(node) : null;
}
// WHAT A CLIENT MODULE DEFINES AND IMPORTS. `functions`: by name, each `function name(…)`, `const name = function /
// arrow`, and `name: function / arrow` property, with its source. A name that only REFERS to a function is kept as a
// call of what it refers to, so an export reaches the function behind it: a property whose value is another name
// (`startApproval: start`, or the shorthand `{ startApproval }`) or a member of an import (`applyNewNoteDate:
// shared.applyNewNoteDate`, a re-export), and the same as `const name = …` or `const { name } = shared`. `imports`:
// each `define()` dependency -> the local name the module's factory gives it (null where it gives none), paired by
// position like a page's. null when the source is not a `define()` module.
const isFunctionNode = (n) => n?.type === "FunctionExpression" || n?.type === "ArrowFunctionExpression";
// `name` -> `name()`, `obj.name` -> `obj.name()`: the call a reference stands for; null for any other expression.
// Only a member of one of the module's imports (`importNames`, the factory's parameters) is a re-export: a member of
// a config object or a constant is not a function the walk should follow.
function referenceCall(n, importNames) {
  if (n?.type === "Identifier") return `${n.name}()`;
  const chain = memberChain(n);
  return chain?.keys.length === 1 && importNames.has(chain.root) ? `${chain.root}.${chain.keys[0]}()` : null;
}
// `const { a, b: c } = shared` -> [["a", "shared.a()"], ["c", "shared.b()"]]: each name the pattern takes off an import.
function destructuredReferences(decl, importNames) {
  if (decl.id?.type !== "ObjectPattern" || !importNames.has(decl.init?.name)) return [];
  return decl.id.properties.filter((p) => p.type === "Property" && !p.computed && p.value?.type === "Identifier")
    .map((p) => [p.value.name, `${decl.init.name}.${staticPropKey(p)}()`]);
}
export function moduleShape(src) {
  const text = String(src ?? "");
  const mod = parseDefineModule(text);
  if (mod.error) return null;
  const params = mod.factory.params.map(paramName);
  const imports = pairSlots(mod.depSlots, params);
  const importNames = new Set(params.filter(Boolean));
  const fns = new Map();
  const add = (name, body) => { if (name && body) fns.set(name, [...(fns.get(name) || []), body]); };
  const addDeclarator = (d) => {
    for (const [name, call] of destructuredReferences(d, importNames)) add(name, call);
    if (d.id?.type !== "Identifier") return;
    if (isFunctionNode(d.init)) add(d.id.name, text.slice(d.init.start, d.init.end));
    else if (d.init?.type === "MemberExpression") add(d.id.name, referenceCall(d.init, importNames));
  };
  walkAstBounded(mod.factory, (n) => {
    if (n.type === "FunctionDeclaration") add(n.id?.name, text.slice(n.start, n.end));
    else if (n.type === "VariableDeclarator") addDeclarator(n);
    else if (n.type === "Property" && !n.computed && isFunctionNode(n.value)) add(staticPropKey(n), text.slice(n.value.start, n.value.end));
    else if (n.type === "Property" && !n.computed) add(staticPropKey(n), referenceCall(n.value, importNames));
  });
  return { functions: fns, imports };
}
// The request a parsed handler entry answers (`{ request: "<name>", handler: … }`), or null.
function entryRequest(el) {
  if (el?.type !== "ObjectExpression") return null;
  const req = el.properties.find((p) => p.type === "Property" && staticPropKey(p) === "request")?.value;
  return isStringLiteral(req) ? req.value : null;
}
// Each request the page's handlers answer -> the source of every top-level entry that answers it, in order. null
// when the handlers are not source that parses as an array: a text over-read here would credit a request some other
// handler sends.
export function handlerEntriesByRequest(src) {
  if (typeof src !== "string") return null;
  const node = parseJsExpression(src);
  if (node?.type !== "ArrayExpression") return null;
  const out = new Map();
  for (const el of node.elements) {
    const request = entryRequest(el);
    // `parseJsExpression` reads the text wrapped in `(`, so every node offset is one past the source's own.
    if (request != null) out.set(request, [...(out.get(request) || []), src.slice(el.start - 1, el.end - 1)]);
  }
  return out;
}
// The custom names a built page DECLARES, per kind: the request of each handler entry, validator and converter
// registrations. A request a handler body only dispatches (`next?.handle({ request: "pkg.X" })`) or a button only
// fires belongs to whoever declares its handler, so it is not read. The whole result is null when the bundle carries
// none of the three ("not provided"). When it carries at least one, a missing one is EMPTY: get-page leaves an empty
// `validators` / `converters` out, and a page that has none must still be able to close its namespace row.
// `handlersSrc` is verifyCtx's own normalization of `entry.handlers` (source text either way).
export function bundleCustomNames(entry, handlersSrc) {
  if (!entry || (handlersSrc == null && entry.validators == null && entry.converters == null)) return null;
  const handlers = Array.isArray(entry.handlers) ? entry.handlers : handlersSrc;
  return {
    request: new Set(handlers == null ? [] : handlerRequests(handlers)),
    validator: new Set(registeredNames(entry.validators)),
    converter: new Set(registeredNames(entry.converters)),
  };
}
// The `request` of each top-level entry of a handlers array — parsed, or its source. Source that does not parse
// is read as text, every `request:` in it: over-reading only asks for a decision, under-reading hides a name.
function handlerRequests(v) {
  if (Array.isArray(v)) return v.map((h) => (isObj(h) && typeof h.request === "string" ? h.request : null)).filter(Boolean);
  const node = parseJsExpression(v);
  if (node?.type !== "ArrayExpression") return [...String(v).matchAll(/"?\brequest"?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return node.elements.map(entryRequest).filter((r) => r != null);
}
// The keys of a validators/converters registration object: `{ "ab.Positive": { … } }`, a name of any number of
// segments (`ab.Order.Approve`). Source that does not parse is read as text, every quoted dotted key in it.
function registeredNames(v) {
  if (v == null) return [];
  if (isObj(v)) return Object.keys(v);
  const node = parseJsExpression(v);
  if (node?.type === "ObjectExpression") {
    return node.properties.filter((p) => p.type === "Property").map(staticPropKey).filter((k) => typeof k === "string");
  }
  return [...String(v).matchAll(/["']([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z_$][\w$]*)+)["']\s*:/g)].map((m) => m[1]);
}
// The names outside the confirmed namespace, `[{ kind, name }]`. `prefixes` is `prefixesOf(conventions)`. The
// namespace is the text before the FIRST dot (`ab.Order.Approve` is in `ab`), compared without case; a name with no
// namespace at all is outside it. `crt.` is the platform's and always allowed. A kind not provided is skipped.
export function foreignNames(names, prefixes) {
  const out = [];
  for (const kind of NAME_KINDS) {
    for (const name of names[kind] || []) {
      const dot = name.indexOf(".");
      const ns = dot > 0 ? name.slice(0, dot).toLowerCase() : "";
      if (ns === PLATFORM_NAMESPACE || (ns && ns === String(prefixes[kind] ?? "").toLowerCase())) continue;
      out.push({ kind, name });
    }
  }
  return out;
}

// ---- rendering: the plan section and the block every build/fix task carries ----
//
// `esc` is the caller's own cell escaper (designspec's `esc` for the plan, tasks' `cell` for a task file), so
// agent- and stand-supplied text gets exactly the protection every other cell of that document gets.
const SOURCE_TEXT = Object.freeze({
  "freedom-pages": "custom requests in the existing Freedom pages of the target packages",
  "schema-prefix": "the name prefix of the team's own schemas",
  "sys-setting": "the `SchemaNamePrefix` system setting",
  "fallback": "verified fallback — no project namespace found",
});
const CONFIRMED_TEXT = Object.freeze({ plan: "the plan approval", user: "the user's answer" });
const writer = (esc) => {
  const code = (v) => `\`${esc(v)}\``;
  return { code, list: (l) => (l.length ? l.map(code).join(", ") : "none") };
};

// The plan's `### Project conventions` section. `recordIds` is `recordIdsUsed(…)`.
export function conventionsPlanLines(c, recordIds, esc) {
  if (!c) return ["### Project conventions", "- ⚠ not resolved — see the ⛔ banner at the top of this plan", ""];
  const w = writer(esc);
  return [
    "### Project conventions",
    "Approved with this plan. Every build and fix task carries this block, and it overrides any generic guidance that names `usr.` as the namespace.",
    "",
    "| Convention | Value |",
    "|---|---|",
    `| Request prefix | ${w.code(c.requestPrefix + ".")} |`,
    `| Validator prefix | ${w.code(c.validatorPrefix + ".")} |`,
    `| Converter prefix | ${w.code(c.converterPrefix + ".")} |`,
    `| Helper modules | ${w.list(c.helperModules)} |`,
    `| Constants modules | ${w.list(c.constantsModules)} |`,
    `| Decided by | ${SOURCE_TEXT[c.source] || esc(c.source)} — ${esc(c.evidence)} |`,
    `| Confirmed by | ${CONFIRMED_TEXT[c.confirmedBy] || esc(c.confirmedBy)} |`,
    "",
    ...conflictLines(c, w),
    ...previousLines(c, w, esc),
    ...recordIdLines(recordIds, w),
  ];
}
function conflictLines(c, w) {
  if (!c.conflict) return [];
  const counts = c.conflict.map(([ns, n]) => `${w.code(ns + ".")} × ${n}`).join(", ");
  return c.confirmedBy === "user"
    ? [`> **Namespace conflict, answered by the user:** the target packages use ${counts}; this migration uses ${w.code(c.requestPrefix + ".")}.`, ""]
    : [`> ⚠ **Question for the user — namespace conflict:** the target packages use ${counts}. Which one does this migration use? Record the answer with \`confirmedBy: "user"\` and re-run \`--plan\`.`, ""];
}
function previousLines(c, w, esc) {
  if (!c.previous) return [];
  const where = c.previous.folder ? ` (${w.code(c.previous.folder)})` : "";
  const diff = previousDifferences(c);
  if (!diff.length) return [`- **Earlier migration${where}:** the same conventions — reused without a question.`, ""];
  const was = `${w.code(c.previous.requestPrefix + ".")}, helpers ${w.list(c.previous.helperModules)}, constants ${w.list(c.previous.constantsModules)}`;
  const verdict = c.confirmedBy === "user"
    ? "the user chose the values in the table above."
    : "⚠ **Question for the user:** keep the earlier values or take this run's? Record the answer with `confirmedBy: \"user\"` and re-run `--plan`.";
  return [`- **Earlier migration${where}:** ${was} — differs (${esc(diff.join("; "))}); ${verdict}`, ""];
}
function recordIdLines(recordIds, w) {
  if (!recordIds.length) return ["No record id from a declared constants module appears in this plan's sources.", ""];
  return ["#### Record ids in this plan", "", "Reference each through its constants module (add the module to the page's SCHEMA_DEPS and use the named value) — never paste the GUID.", "",
    "| Record id | Constants path |", "|---|---|",
    ...recordIds.map(({ guid, paths }) => `| ${w.code(guid)} | ${paths.map(w.code).join(" · ")} |`), ""];
}

// The block every build and fix task file carries, so a builder that reads only its task still follows the
// project. Empty when the run recorded no conventions.
export function conventionsTaskLines(c, esc) {
  if (!c) return [];
  const w = writer(esc);
  return [
    "## Project conventions",
    "",
    "<!-- ENGINE-OWNED: the conventions approved with the plan. They override any generic guidance that names `usr.`. -->",
    "",
    `- **Custom requests:** in the ${w.code(c.requestPrefix + ".")} namespace — never \`usr.\` unless that is the prefix here. Keep the request names the plan gives (a button's or menu item's is ${w.code(c.requestPrefix + ".<Element>Clicked")}); name a new one in the same namespace.`,
    `- **Validators / converters:** ${w.code(c.validatorPrefix + ".")} / ${w.code(c.converterPrefix + ".")}.`,
    `- **Helper modules:** ${w.list(c.helperModules)} — reuse what they already provide instead of writing it again.`,
    `- **Constants modules:** ${w.list(c.constantsModules)} — reference existing record ids through them: add the module to the page's SCHEMA_DEPS and use the named value; never paste a GUID. The plan's *Project conventions* section maps each id to its path.`,
    "- Freedom pages CAN import these client-unit modules: list the module in SCHEMA_DEPS and take it as a factory argument.",
    "",
  ];
}
