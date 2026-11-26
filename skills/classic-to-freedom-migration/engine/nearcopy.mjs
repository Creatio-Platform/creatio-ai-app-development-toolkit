// Near-copies between client modules: code that is the same code once the values it works on are set aside.
//
// An exact copy (the same text with other names) is found by the helper shape in quality.mjs. A near-copy is the
// same function, or the same run of statements, with a different value somewhere: a path made a parameter
// (`selectQuery(body)` and `sendDataServiceQuery(path, body)`), another entity in `Model.create`, another column in an
// `update`. Those belong in one function that takes the value as a parameter, kept in the shared module.
//
// The value shape keeps what the code DOES and drops what it works ON:
// - a parameter list is dropped, and a value read - a literal, a variable, a parameter, `a.b.c`, `x[k]`, `await v` -
//   becomes one token: `dataServiceUrl(SELECT_QUERY_PATH)` and `dataServiceUrl(relativePath)` are one call;
// - a call keeps the method it calls without the variable it is called on (`contractAmount.showMessage` and
//   `showMessage` are one call; `sdk.HandlerChainService.instance.process` keeps `HandlerChainService.instance.process`);
// - an object key that names a column or an attribute (PascalCase: `MbIsActive`, `PDS_MbDate`) is a value too; a
//   camelCase key is the API's (`type`, `schemaName`, `modelInitConfigs`) and is kept.
// Nothing is evaluated; the walk is bounded by depth like the other AST walks.
import { childNodesOf, isFnNode, staticPropKey } from "./engine.mjs";

// A run of statements this large is code worth one function. Smaller runs (a guard, one plain call) repeat in any
// two modules by nature.
export const MIN_NEAR_COPY_NODES = 18;
// The longest run of statements compared, counted in statements.
const MAX_WINDOW_STATEMENTS = 12;
const MAX_DEPTH = 1000;

const isFunction = (n) => isFnNode(n) || n?.type === "FunctionDeclaration";
const lineOf = (n) => n?.loc?.start?.line ?? 0;
const endLineOf = (n) => n?.loc?.end?.line ?? lineOf(n);

// A read of a value: nothing in it is called, so swapping it for another value keeps what the code does.
function isValueRead(n, depth = 0) {
  if (!n || depth > MAX_DEPTH) return false;
  switch (n.type) {
    case "Identifier": case "Literal": case "ThisExpression": return true;
    case "TemplateLiteral": return n.expressions.every((e) => isValueRead(e, depth + 1));
    case "MemberExpression": return isValueRead(n.object, depth + 1) && (!n.computed || isValueRead(n.property, depth + 1));
    case "ChainExpression": case "AwaitExpression": return isValueRead(n.expression ?? n.argument, depth + 1);
    default: return false;
  }
}

// `a.b.c` as the names after its root (`b.c`) and the root node; a bare identifier is its own name.
function calleeKey(callee) {
  const names = [];
  let n = callee?.type === "ChainExpression" ? callee.expression : callee;
  while (n?.type === "MemberExpression" && !n.computed && n.property.type === "Identifier") { names.unshift(n.property.name); n = n.object; }
  if (n?.type === "Identifier" || n?.type === "ThisExpression") return { key: names.length ? names.join(".") : (n.name ?? "this"), base: null };
  return { key: names.join("."), base: n };
}

const isDataKey = (name) => /^[A-Z]/.test(name);

// The value shape of one node, as tokens pushed on `out`; returns the number of nodes it counted.
export function valueShape(n, out, depth = 0) {
  if (!n) { out.push("_"); return 0; }
  if (depth > MAX_DEPTH) { out.push("?"); return 1; }
  if (isValueRead(n)) { out.push("V"); return 1; }
  const at = depth + 1;
  switch (n.type) {
    case "CallExpression": case "NewExpression": {
      const { key, base } = calleeKey(n.callee);
      out.push(`(${n.type === "NewExpression" ? "new" : "call"} ${key}`);
      let count = 1 + (base ? valueShape(base, out, at) : 0);
      for (const a of n.arguments) count += valueShape(a, out, at);
      out.push(")");
      return count;
    }
    case "Property": {
      const name = staticPropKey(n);
      out.push(`(key ${name == null ? "" : (isDataKey(name) ? "K" : name)}`);
      let count = 1 + (n.computed ? valueShape(n.key, out, at) : 0);
      count += n.shorthand ? (out.push("V"), 1) : valueShape(n.value, out, at);
      out.push(")");
      return count;
    }
    case "VariableDeclarator": {
      out.push("(decl B");
      const count = 1 + valueShape(n.init, out, at);
      out.push(")");
      return count;
    }
    case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": {
      out.push(`(fn${n.async ? " async" : ""}`);
      const count = 1 + valueShape(n.body, out, at);
      out.push(")");
      return count;
    }
    case "CatchClause": {
      out.push("(catch");
      const count = 1 + valueShape(n.body, out, at);
      out.push(")");
      return count;
    }
    default: {
      out.push("(" + n.type + (typeof n.operator === "string" ? " " + n.operator : "") + (n.type === "VariableDeclaration" ? " " + n.kind : ""));
      let count = 1;
      for (const child of childNodesOf(n)) count += valueShape(child, out, at);
      out.push(")");
      return count;
    }
  }
}

function shapeOf(node) {
  const out = [];
  const count = valueShape(node, out);
  return { shape: out.join(" "), count };
}

// The statement lists of one module worth comparing: the body of each function (an expression body is one
// statement) and every block inside it, each with the function it belongs to. The module's own top level is a list
// of declarations, not code that runs, so it is not one of them; the functions declared there are.
function statementLists(factoryBody) {
  const lists = [];
  const visit = (node, fnName, depth) => {
    if (!node || depth > MAX_DEPTH) return;
    if (isFunction(node)) {
      const name = node.id?.name ?? fnName;
      const block = node.body.type === "BlockStatement";
      lists.push({ fn: node, fnName: name, statements: block ? node.body.body : [node.body] });
      for (const child of block ? node.body.body : [node.body]) visit(child, name, depth + 1);
      return;
    }
    if (node.type === "BlockStatement") lists.push({ fn: null, fnName, statements: node.body });
    for (const child of childNodesOf(node)) visit(child, nameOfFunctionAt(node) ?? fnName, depth + 1);
  };
  for (const st of factoryBody.body) visit(st, null, 1);
  return lists;
}

// The name a declaration gives the function it holds: `function f`, `const f = () => {}`, `{ f() {} }`.
function nameOfFunctionAt(node) {
  if (node?.type === "FunctionDeclaration") return node.id?.name ?? null;
  if (node?.type === "VariableDeclaration") {
    const d = node.declarations.find((x) => x.id?.type === "Identifier" && isFunction(x.init));
    return d ? d.id.name : null;
  }
  if (node?.type === "VariableDeclarator" && node.id?.type === "Identifier" && isFunction(node.init)) return node.id.name;
  if (node?.type === "Property" && isFunction(node.value)) return staticPropKey(node);
  return null;
}

// Every run of statements of at least MIN_NEAR_COPY_NODES, keyed by its value shape.
function windowsOf(m) {
  const out = [];
  for (const list of statementLists(m.factory.body)) {
    const shaped = list.statements.map((st) => ({ st, ...shapeOf(st) }));
    for (let i = 0; i < shaped.length; i++) {
      let count = 0;
      const parts = [];
      for (let j = i; j < shaped.length && j - i < MAX_WINDOW_STATEMENTS; j++) {
        count += shaped[j].count;
        parts.push(shaped[j].shape);
        if (count < MIN_NEAR_COPY_NODES) continue;
        out.push({ module: m.name, fnName: list.fnName, fn: list.fn, whole: !!list.fn && i === 0 && j === shaped.length - 1,
          from: lineOf(shaped[i].st), to: endLineOf(shaped[j].st), count, key: parts.join(" ; ") });
      }
    }
  }
  return out;
}

const within = (inner, outer) => inner.from >= outer.from && inner.to <= outer.to;

// The near-copies between modules, largest first: `{ copy, original }`, each a run of statements with its module,
// function and lines. A smaller run inside a reported one is not reported again, and a function whose exact copy
// `isExactCopy(fnA, fnB)` already reports is left to that check.
export function nearCopies(modules, isExactCopy = () => false) {
  const byKey = new Map();
  for (const m of modules) {
    for (const w of windowsOf(m)) {
      if (!byKey.has(w.key)) byKey.set(w.key, []);
      byKey.get(w.key).push(w);
    }
  }
  const matches = [];
  for (const group of byKey.values()) {
    const original = group[0];
    for (const w of group.slice(1)) if (w.module !== original.module) matches.push({ copy: w, original });
  }
  matches.sort((a, b) => b.copy.count - a.copy.count || a.copy.from - b.copy.from);
  const reported = [];
  const out = [];
  for (const match of matches) {
    const { copy, original } = match;
    if (copy.whole && original.whole && isExactCopy(copy.fn, original.fn)) continue;
    const covered = reported.some((r) => r.copy.module === copy.module && r.original.module === original.module
      && within(copy, r.copy) && within(original, r.original));
    if (covered) continue;
    reported.push(match);
    out.push(match);
  }
  return out;
}

// One module-level constant per name: `const NAME = <literal>` at the top of the module factory.
export function literalConstantsOf(factoryBody) {
  const out = [];
  for (const st of factoryBody.body) {
    if (st.type !== "VariableDeclaration" || st.kind !== "const") continue;
    for (const d of st.declarations) {
      if (d.id?.type === "Identifier" && d.init?.type === "Literal" && d.init.value !== null && typeof d.init.value !== "object") {
        out.push({ name: d.id.name, raw: d.init.raw, value: d.init.value, line: lineOf(d) });
      }
    }
  }
  return out;
}
