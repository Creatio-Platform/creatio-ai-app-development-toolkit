// THE PAGE CODE MAP: what a built Freedom page's handler code looks like, measured instead of re-read.
//
// A page is built by one task after another, each in a fresh context. Without a map, the next writer either
// re-reads the whole page body or adds its code beside code it never saw: the measured run that motivated this
// module had 11–15 writers on one page, handlers of up to 390 lines and eight copies of the same helper, one per
// writer. The map gives the next writer the facts it needs to own the page — which handlers exist, how long they
// are, which helpers are already defined and where — in a few hundred tokens, and the same analysis feeds the
// blocking `Page code` row of `--verify` (designspec.mjs `resolvePageCodeVk`), so the writer and the gate measure
// the same thing.
//
// Input: the page's handler SOURCE as clio `get-page` returns it in `bundle.handlers` (a JS array literal of
// `{ request, handler }` entries), and optionally `bundle.viewConfig`, which is where a request is sent from a
// button. Parsed with the engine's integrity-checked acorn; never executed.
//
// CLI: `node engine/codemap.mjs <file> [--page <key>]` prints the map. `<file>` is a saved `get-page` response,
// a `built.json` page entry, a `built.json` (with `--page`), or the raw handler source. Exit 0 = no findings,
// 2 = findings, 1 = the input could not be read or parsed.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getAcornParse } from "./engine.mjs";

// The limits the `Page code` verify row applies. A handler longer than this is several behaviours in one place —
// the shape the relay produced — and a name defined in two handlers is a helper that should live once.
export const MAX_FUNCTION_LINES = 150;
// A request in this namespace is the platform's own: declaring a handler for it does not create a request that
// something on the page has to send.
const PLATFORM_PREFIX = "crt.";

const isFn = (n) => n && (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "FunctionDeclaration");
const linesOf = (n) => (n?.loc ? n.loc.end.line - n.loc.start.line + 1 : 0);
const propName = (p) => (p.key?.type === "Identifier" ? p.key.name : p.key?.value);

// Every child node of `node`, in source order. Generic on purpose: the walk must not miss a construct (a helper
// defined inside a `try`, a `switch`, a nested arrow) because a list of node types forgot it.
function childrenOf(node) {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === "loc" || k === "start" || k === "end") continue;
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === "string") out.push(x); }
    else if (v && typeof v.type === "string") out.push(v);
  }
  return out;
}
function walk(node, visit) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    visit(n);
    stack.push(...childrenOf(n).reverse());
  }
}

// A named function inside a handler: `function idOf() {}`, `const idOf = () => …`, `let idOf = function () {}`.
function namedFunctionOf(n) {
  if (n.type === "FunctionDeclaration" && n.id?.name) return { name: n.id.name, fn: n };
  if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && isFn(n.init)) return { name: n.id.name, fn: n.init };
  return null;
}

// One `{ request, handler }` entry of the handlers array.
function handlerEntryOf(el, i) {
  if (el?.type !== "ObjectExpression") return null;
  let request = null, requestNode = null, fn = null;
  for (const p of el.properties || []) {
    if (p.type !== "Property") continue;
    const name = propName(p);
    if (name === "request" && p.value?.type === "Literal" && typeof p.value.value === "string") { request = p.value.value; requestNode = p.value; }
    if (name === "handler" && isFn(p.value)) fn = p.value;
  }
  return { request: request ?? `#${i + 1}`, requestNode, fn, node: el };
}

function parseHandlers(src) {
  const acornParse = getAcornParse();
  const text = String(src ?? "").trim();
  if (!text) return { entries: [] };
  let ast;
  try { ast = acornParse(`(${text}\n)`, { ecmaVersion: "latest", sourceType: "script", locations: true }); }
  catch (e) { return { error: `the handler source does not parse: ${String(e?.message || e)}` }; }
  const expr = ast.body[0]?.expression;
  if (expr?.type !== "ArrayExpression") return { error: "the handler source is not an array of `{ request, handler }` entries" };
  return { entries: expr.elements.map(handlerEntryOf).filter(Boolean), ast };
}

// The string literals of the handler code, by value — a request is SENT when its name appears anywhere but in
// its own declaration (`executeRequest({ type: "usr.X" })`, `process({ type: "usr.X" })`, a nested request).
function literalUses(ast, skip) {
  const uses = new Map();
  walk(ast, (n) => {
    if (n.type === "Literal" && typeof n.value === "string" && !skip.has(n)) uses.set(n.value, (uses.get(n.value) || 0) + 1);
  });
  return uses;
}
// The request names the view sends: `clicked: { request: "usr.X" }` and every other `request` value in the tree.
function viewRequests(viewConfig) {
  const out = new Set();
  const visit = (v) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if ((k === "request" || k === "type") && typeof x === "string") out.add(x);
      else visit(x);
    }
  };
  visit(viewConfig);
  return out;
}

function handlerFacts(entry) {
  const helpers = [];
  const functions = [{ name: entry.request, handler: entry.request, lines: linesOf(entry.fn), top: true }];
  if (entry.fn) {
    walk(entry.fn.body, (n) => {
      const named = namedFunctionOf(n);
      if (!named) return;
      helpers.push(named.name);
      functions.push({ name: named.name, handler: entry.request, lines: linesOf(named.fn), top: false });
    });
  }
  return { request: entry.request, lines: linesOf(entry.fn), helpers: [...new Set(helpers)], functions };
}

// The analysis. `{ error }` when the source cannot be read as a handlers array; otherwise every fact the map and
// the verify row report. Pure: no file system, no stand.
export function analyzePageCode(handlersSrc, viewConfig = null) {
  const parsed = parseHandlers(handlersSrc);
  if (parsed.error) return { error: parsed.error };
  const handlers = parsed.entries.map(handlerFacts);
  const definedIn = new Map();
  for (const h of handlers) for (const name of h.helpers) definedIn.set(name, [...(definedIn.get(name) || []), h.request]);
  const duplicates = [...definedIn].filter(([, where]) => where.length > 1).map(([name, where]) => ({ name, handlers: where }));
  const longFunctions = handlers.flatMap((h) => h.functions).filter((f) => f.lines > MAX_FUNCTION_LINES)
    .map((f) => ({ name: f.top ? f.handler : `${f.handler} › ${f.name}`, lines: f.lines }));
  const declarations = new Set(parsed.entries.map((e) => e.requestNode).filter(Boolean));
  const uses = parsed.ast ? literalUses(parsed.ast, declarations) : new Map();
  const sentByView = viewRequests(viewConfig);
  const unsent = [...new Set(parsed.entries.map((e) => e.requestNode && e.request).filter(Boolean))]
    .filter((r) => !r.startsWith(PLATFORM_PREFIX) && !uses.get(r) && !sentByView.has(r));
  return { handlers, duplicates, longFunctions, unsent };
}

export const findingCount = (a) => (a.error ? 0 : a.duplicates.length + a.longFunctions.length + a.unsent.length);

// The findings as short phrases — the verify row's text and the map's summary line say the same thing.
export function findingPhrases(a) {
  return [
    ...a.longFunctions.map((f) => `\`${f.name}\` is ${f.lines} lines (limit ${MAX_FUNCTION_LINES})`),
    ...a.duplicates.map((d) => `\`${d.name}\` is defined in ${d.handlers.length} handlers (${d.handlers.map((h) => `\`${h}\``).join(", ")})`),
    ...a.unsent.map((r) => `\`${r}\` is declared but nothing sends it`),
  ];
}

const cell = (s) => String(s).replace(/\|/g, "\\|");
export function renderCodeMap(a, pageKey = "page") {
  if (a.error) return `# ${pageKey} — code map\n\n⛔ ${a.error}\n`;
  const L = [`# ${pageKey} — code map (derived from the page body; do not edit)`, ""];
  const n = findingCount(a);
  L.push(n ? `**${n} finding(s) to clear before this task closes** — the \`Page code\` row of \`--verify\` checks the same:` : "**No findings** — the `Page code` row of `--verify` will pass on this body.");
  for (const p of findingPhrases(a)) L.push(`- ${p}`);
  L.push("", "## Handlers", "", "| # | Request | Lines | Helpers it defines |", "|---|---|---|---|");
  a.handlers.forEach((h, i) => L.push(`| ${i + 1} | \`${cell(h.request)}\` | ${h.lines}${h.lines > MAX_FUNCTION_LINES ? " ⚠" : ""} | ${h.helpers.map((x) => `\`${cell(x)}\``).join(", ") || "—"} |`));
  if (a.duplicates.length) {
    L.push("", "## Helpers defined in more than one handler", "", "Define each once (a shared module, or one place on the page) and call it.", "", "| Helper | Handlers |", "|---|---|");
    for (const d of a.duplicates) L.push(`| \`${cell(d.name)}\` | ${d.handlers.map((h) => `\`${cell(h)}\``).join(", ")} |`);
  }
  return L.join("\n") + "\n";
}

// The handler source and view config out of whatever the writer saved.
export function pageCodeInput(raw, pageKey = null) {
  let json;
  try { json = JSON.parse(raw); } catch { return { handlers: raw, viewConfig: null }; }
  if (typeof json === "string") return { handlers: json, viewConfig: null };
  let entry = json?.bundle || json;
  if (entry?.pages && pageKey) entry = entry.pages[pageKey]?.bundle || entry.pages[pageKey];
  if (entry?.handlers == null) return { error: pageKey ? `no handlers for page \`${pageKey}\` in the file` : "the file has no `handlers` (pass `--page <key>` for a built.json with several pages)" };
  return { handlers: typeof entry.handlers === "string" ? entry.handlers : null, viewConfig: entry.viewConfig ?? null,
    error: typeof entry.handlers === "string" ? undefined : "`handlers` is not the handler source string get-page returns" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--page");
  const pageKey = pi >= 0 ? argv[pi + 1] : null;
  const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--page");
  const stop = (msg) => { process.stderr.write(`codemap.mjs: ${msg}\n`); process.exit(1); };
  if (!file) stop("usage: node engine/codemap.mjs <saved get-page response | built.json> [--page <key>]");
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { stop(`cannot read '${file}': ${e.message}`); }
  const input = pageCodeInput(raw, pageKey);
  if (input.error) stop(input.error);
  const a = analyzePageCode(input.handlers, input.viewConfig);
  if (a.error) stop(a.error);
  process.stdout.write(renderCodeMap(a, pageKey || "page"));
  process.exit(findingCount(a) ? 2 : 0);
}
