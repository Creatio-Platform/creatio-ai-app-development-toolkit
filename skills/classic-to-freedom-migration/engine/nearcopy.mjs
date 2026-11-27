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
//   camelCase key is the API's (`type`, `schemaName`, `modelInitConfigs`) and is kept, and so is the literal a `type`
//   key holds: a `crt.OpenPageRequest` and a `crt.LoadDataRequest` are different requests whatever their keys;
// - a test of whether a value is set is that value, however it is written: `Boolean(x)`, `!!x`, `x || 0`, `x ?? 0`
//   and `x > 0` are all `x`. `x !== 0` and `x != 0` are not: they are true for an unset value (`undefined`, `null`,
//   `""`), where the others are false, so code using them behaves differently and is not the same code.
// Nothing is evaluated; the walk is bounded by depth like the other AST walks.
import { childNodesOf, staticPropKey, isFunction, lineOf, endLineOf } from "./engine.mjs";

// A run of statements this large is code worth one function. Smaller runs (a guard, one plain call) repeat in any
// two modules by nature.
const MIN_NEAR_COPY_NODES = 18;
// A whole function is compared from a smaller size: one that is all of another function, with other values, is the
// same function even when it is a short one (an open-page request, a button's availability).
const MIN_WHOLE_FUNCTION_NODES = 12;
// The longest run of statements compared, counted in statements.
const MAX_WINDOW_STATEMENTS = 12;
const MAX_DEPTH = 1000;

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

// The token of an object key: a column or attribute name (PascalCase) is a value; an API key is kept, and a `type`
// key keeps the request it names.
function keyToken(p) {
  const name = staticPropKey(p);
  if (name == null) return "";
  if (/^[A-Z]/.test(name)) return "K";
  return name === "type" && p.value?.type === "Literal" ? `type=${p.value.value}` : name;
}

const isZero = (n) => n?.type === "Literal" && n.value === 0;
const isPrimitiveLiteral = (n) => n?.type === "Literal" && n.value !== null && typeof n.value !== "object";

// The value a test of whether it is set reads (`Boolean(x)`, `!!x`, `x || 0`, `x ?? 0`, `x > 0`), else null.
function truthTestOf(n) {
  switch (n.type) {
    case "CallExpression":
      return n.callee.type === "Identifier" && n.callee.name === "Boolean" && n.arguments.length === 1 ? n.arguments[0] : null;
    case "UnaryExpression": return n.operator === "!" && n.argument.type === "UnaryExpression" && n.argument.operator === "!" ? n.argument.argument : null;
    case "LogicalExpression": return n.operator !== "&&" && isZero(n.right) ? n.left : null;
    case "BinaryExpression": return n.operator === ">" && isZero(n.right) ? n.left : null;
    default: return null;
  }
}

// The tag of a node that is not a value read, and the children its shape goes on with.
function tagOf(n) {
  switch (n.type) {
    case "CallExpression": case "NewExpression": {
      const { key, base } = calleeKey(n.callee);
      return [`${n.type === "NewExpression" ? "new" : "call"} ${key}`, base ? [base, ...n.arguments] : n.arguments];
    }
    case "Property": {
      const value = n.shorthand ? { type: "Identifier" } : n.value;
      return ["key " + keyToken(n), n.computed ? [n.key, value] : [value]];
    }
    case "VariableDeclarator": return ["decl B", [n.init]];
    case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": return [n.async ? "fn async" : "fn", [n.body]];
    case "CatchClause": return ["catch", [n.body]];
    default:
      return [n.type + (typeof n.operator === "string" ? " " + n.operator : "") + (n.type === "VariableDeclaration" ? " " + n.kind : ""),
        childNodesOf(n)];
  }
}

// The value shape of one node, as tokens pushed on `out`; returns the number of nodes it counted.
function valueShape(n, out, depth = 0) {
  if (!n) { out.push("_"); return 0; }
  if (depth > MAX_DEPTH) { out.push("?"); return 1; }
  const tested = truthTestOf(n);
  if (tested) return valueShape(tested, out, depth + 1);
  if (isValueRead(n)) { out.push("V"); return 1; }
  const [tag, children] = tagOf(n);
  out.push("(" + tag);
  let count = 1;
  for (const c of children) count += valueShape(c, out, depth + 1);
  out.push(")");
  return count;
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
      const statements = node.body.type === "BlockStatement" ? node.body.body : [node.body];
      lists.push({ fn: node, fnName: name, statements });
      for (const child of statements) visit(child, name, depth + 1);
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

// Every run of statements of at least MIN_NEAR_COPY_NODES (a whole function: MIN_WHOLE_FUNCTION_NODES), keyed by
// the ids of its statements' value shapes (one id per distinct shape, shared by all modules through `ids`).
function windowsOf(m, ids) {
  const idOf = (shape) => {
    if (!ids.has(shape)) ids.set(shape, ids.size);
    return ids.get(shape);
  };
  const out = [];
  for (const list of statementLists(m.factory.body)) {
    const shaped = list.statements.map((st) => {
      const tokens = [];
      const count = valueShape(st, tokens);
      return { st, count, id: idOf(tokens.join(" ")) };
    });
    for (let i = 0; i < shaped.length; i++) out.push(...windowsFrom(m, list, shaped, i));
  }
  return out;
}

// The runs of one statement list that start at statement `i` and are large enough to compare.
function windowsFrom(m, list, shaped, i) {
  const out = [];
  let count = 0;
  const key = [];
  for (let j = i; j < shaped.length && j - i < MAX_WINDOW_STATEMENTS; j++) {
    count += shaped[j].count;
    key.push(shaped[j].id);
    const whole = !!list.fn && i === 0 && j === shaped.length - 1;
    if (count < (whole ? MIN_WHOLE_FUNCTION_NODES : MIN_NEAR_COPY_NODES)) continue;
    out.push({ module: m.name, fnName: list.fnName, fn: list.fn, whole,
      from: lineOf(shaped[i].st), to: endLineOf(shaped[j].st), count, key: key.join() });
  }
  return out;
}

// Every pair of runs with one value shape in two different modules, largest first: `{ copy, original }`, the
// original being the first run of that shape.
function matchesOf(modules) {
  const ids = new Map();
  const byKey = new Map();
  for (const m of modules) {
    for (const w of windowsOf(m, ids)) {
      if (!byKey.has(w.key)) byKey.set(w.key, []);
      byKey.get(w.key).push(w);
    }
  }
  const matches = [];
  for (const [original, ...rest] of byKey.values()) {
    for (const w of rest) if (w.module !== original.module) matches.push({ copy: w, original });
  }
  return matches.sort((a, b) => b.copy.count - a.copy.count || a.copy.from - b.copy.from);
}

const within = (inner, outer) => inner.from >= outer.from && inner.to <= outer.to;
const coveredBy = (match, r) => r.copy.module === match.copy.module && r.original.module === match.original.module
  && within(match.copy, r.copy) && within(match.original, r.original);

// The near-copies between modules, largest first: `{ copy, original }`, each a run of statements with its module,
// function and lines. A smaller run inside a reported one is not reported again, and a function whose exact copy
// `isExactCopy(fnA, fnB)` already reports is left to that check.
export function nearCopies(modules, isExactCopy) {
  const reported = [];
  for (const match of matchesOf(modules)) {
    const { copy, original } = match;
    if (copy.whole && original.whole && isExactCopy(copy.fn, original.fn)) continue;
    if (!reported.some((r) => coveredBy(match, r))) reported.push(match);
  }
  return reported;
}

// The literal values of a list: `["A", "B"]` or `new Set(["A", "B"])`, two literals or more; else null.
function literalListOf(init) {
  const array = init?.type === "NewExpression" && init.callee.type === "Identifier" && init.callee.name === "Set" ? init.arguments[0] : init;
  if (array?.type !== "ArrayExpression" || array.elements.length < 2) return null;
  if (!array.elements.every(isPrimitiveLiteral)) return null;
  const raw = "[" + array.elements.map((e) => e.raw).join(", ") + "]";
  return { values: array.elements.map((e) => e.value), raw: array === init ? raw : `new Set(${raw})` };
}

// One module-level constant per name: `const NAME = <literal>` at the top of the module factory, or a list of
// literals (`list`: its values).
export function literalConstantsOf(factoryBody) {
  const out = [];
  for (const st of factoryBody.body) {
    if (st.type !== "VariableDeclaration" || st.kind !== "const") continue;
    for (const d of st.declarations) {
      if (d.id?.type !== "Identifier") continue;
      const list = literalListOf(d.init);
      if (list) out.push({ name: d.id.name, raw: list.raw, list: list.values, line: lineOf(d) });
      else if (isPrimitiveLiteral(d.init)) {
        out.push({ name: d.id.name, raw: d.init.raw, value: d.init.value, line: lineOf(d) });
      }
    }
  }
  return out;
}
