// THE PAGE CODE MAP: what a built Freedom page's handler code looks like, measured instead of re-read.
//
// A page is built by one task after another, each in a fresh context. Without a map, the next writer either
// re-reads the whole page body or adds its code beside code it never saw: a measured relay-built page had 11–15
// writers, handlers of up to 390 lines and eight copies of the same helper, one per writer. The map gives the next
// writer the facts it needs to own the page — which handlers exist, how long they are, which helpers are already
// defined and where — in a few hundred tokens, and the same analysis feeds the blocking `Page code` row of
// `--verify` (designspec.mjs `resolvePageCodeVk`), so the writer and the gate measure the same thing.
//
// Input: the page's handler SOURCE as clio `get-page` returns it in `bundle.handlers` (a JS array literal of
// `{ request, handler }` entries), and optionally `bundle.viewConfig`, which is where a button sends a request.
// Parsed with the engine's integrity-checked acorn and walked with its bounded walker; never executed.
//
// CLI: `node engine/codemap.mjs <file> [--page <key>]` prints the map. `<file>` is a saved `get-page` response, a
// `built.json` (the page is `--page`, default `main`), or the raw handler source. The page is read the way
// `--verify` reads it. Exit 0 = no findings, 2 = findings, 1 = the input could not be read or parsed.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getAcornParse, walkAstBounded, staticPropKey, isFnNode } from "./engine.mjs";
// designspec.mjs imports this module for the verify row; neither module uses the other's exports while it loads,
// so the cycle is safe, and the CLI below reads the page exactly the way `--verify` does.
import { verifyCtx, esc } from "./designspec.mjs";

// The limits the `Page code` verify row applies. A handler longer than this is several behaviours in one place —
// the shape the relay produced — and a name defined in two handlers is a helper that should live once.
export const MAX_FUNCTION_LINES = 150;
// A request in this namespace is the platform's own: declaring a handler for it does not create a request that
// something on the page has to send.
const PLATFORM_PREFIX = "crt.";

const linesOf = (n) => (n?.loc ? n.loc.end.line - n.loc.start.line + 1 : 0);

// A named function inside a handler: `function idOf() {}`, `const idOf = () => …`, `let idOf = function () {}`.
function namedFunctionOf(n) {
  if (n.type === "FunctionDeclaration" && n.id?.name) return { name: n.id.name, fn: n };
  if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && isFnNode(n.init)) return { name: n.id.name, fn: n.init };
  return null;
}

// One `{ request, handler }` entry of the handlers array; `declared` is false when the request is not a literal.
function handlerEntryOf(el, i) {
  if (el?.type !== "ObjectExpression") return null;
  let request = null, fn = null;
  for (const p of el.properties || []) {
    const key = p.type === "Property" ? staticPropKey(p) : null;
    if (key === "request" && p.value?.type === "Literal" && typeof p.value.value === "string") request = p.value.value;
    if (key === "handler" && isFnNode(p.value)) fn = p.value;
  }
  return { request: request ?? `#${i + 1}`, declared: request !== null, fn };
}

// One walk per handler: the helpers it defines (and their length) and every string literal it mentions — a request
// is SENT when its name appears in a handler (`executeRequest({ type: "usr.X" })`) or in the view.
function handlerFacts(entry) {
  const helpers = new Set(), functions = [], literals = new Set();
  const walk = entry.fn ? walkAstBounded(entry.fn.body, (n) => {
    if (n.type === "Literal" && typeof n.value === "string") literals.add(n.value);
    const named = namedFunctionOf(n);
    if (!named) return;
    helpers.add(named.name);
    functions.push({ name: `${entry.request} › ${named.name}`, lines: linesOf(named.fn) });
  }) : { truncated: false };
  const lines = linesOf(entry.fn);
  // A handler naming its OWN request (`request.type === "usr.X"`, a log line) does not send it.
  if (entry.declared) literals.delete(entry.request);
  return { request: entry.request, lines, helpers: [...helpers].sort((x, y) => x.localeCompare(y)),
    functions: [{ name: entry.request, lines }, ...functions], literals, truncated: walk.truncated };
}
// The request names the view sends: `clicked: { request: "usr.X" }` and every other `request` value in the tree.
export function viewRequests(viewConfig) {
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

// The analysis. `{ error }` when the source cannot be read as a handlers array; otherwise every fact the map and
// the verify row report. Pure: no file system, no stand. Without a `viewConfig` nobody knows what the buttons send,
// so the unsent-request check is skipped (`sendsChecked: false`) rather than reporting every button's request.
// `sentElsewhere` names requests another built page sends (its mini page, a child page): a request declared here
// and dispatched from there is sent, not dead.
export function analyzePageCode(handlersSrc, viewConfig = null, sentElsewhere = new Set()) {
  const text = String(handlersSrc ?? "").trim();
  const sendsChecked = viewConfig != null;
  if (!text) return { handlers: [], duplicates: [], longFunctions: [], unsent: [], sendsChecked };
  let expr;
  try { expr = getAcornParse()(`(${text}\n)`, { ecmaVersion: "latest", sourceType: "script", locations: true }).body[0]?.expression; }
  catch (e) { return { error: `the handler source does not parse: ${String(e?.message || e)}` }; }
  if (expr?.type !== "ArrayExpression") return { error: "the handler source is not an array of `{ request, handler }` entries" };
  const entries = expr.elements.map(handlerEntryOf).filter(Boolean);
  const handlers = entries.map(handlerFacts);
  if (handlers.some((h) => h.truncated)) return { error: "a handler is too large or too deeply nested to analyse — split it" };
  const definedIn = new Map();
  for (const h of handlers) for (const name of h.helpers) definedIn.set(name, [...(definedIn.get(name) || []), h.request]);
  const sent = new Set([...handlers.flatMap((h) => [...h.literals]), ...viewRequests(viewConfig), ...sentElsewhere]);
  return {
    handlers: handlers.map(({ request, lines, helpers }) => ({ request, lines, helpers })),
    duplicates: [...definedIn].filter(([, where]) => where.length > 1).map(([name, where]) => ({ name, handlers: where })),
    longFunctions: handlers.flatMap((h) => h.functions).filter((f) => f.lines > MAX_FUNCTION_LINES),
    unsent: sendsChecked ? [...new Set(entries.filter((e) => e.declared).map((e) => e.request))]
      .filter((r) => !r.startsWith(PLATFORM_PREFIX) && !sent.has(r)) : [],
    sendsChecked,
  };
}

export const findingCount = (a) => a.duplicates.length + a.longFunctions.length + a.unsent.length;

// The findings as short phrases — the verify row's text and the map's summary say the same thing. `escape` is the
// caller's Markdown escaping for names taken from the page body (designspec.mjs `esc`).
export function findingPhrases(a, escape = String) {
  const code = (s) => `\`${escape(s)}\``;
  return [
    ...a.longFunctions.map((f) => `${code(f.name)} is ${f.lines} lines (limit ${MAX_FUNCTION_LINES})`),
    ...a.duplicates.map((d) => `${code(d.name)} is defined in ${d.handlers.length} handlers (${d.handlers.map(code).join(", ")})`),
    ...a.unsent.map((r) => `${code(r)} is declared but nothing sends it`),
  ];
}

export function renderCodeMap(a, pageKey = "page", escape = String) {
  const code = (s) => `\`${escape(s)}\``;
  const n = findingCount(a);
  const L = [`# ${escape(pageKey)} — code map (derived from the page body; do not edit)`, "",
    n ? `**${n} finding(s) to clear before this task closes** — the \`Page code\` row of \`--verify\` checks the same:`
      : "**No findings** — the `Page code` row of `--verify` will pass on this body.",
    ...findingPhrases(a, escape).map((p) => `- ${p}`),
    ...(a.sendsChecked ? [] : ["- Requests sent from the view were not checked: the input has no `viewConfig` — pass the saved get-page response, not the handler source alone."]),
    "", "## Handlers", "", "| # | Request | Lines | Helpers it defines |", "|---|---|---|---|"];
  a.handlers.forEach((h, i) => L.push(`| ${i + 1} | ${code(h.request)} | ${h.lines}${h.lines > MAX_FUNCTION_LINES ? " ⚠" : ""} | ${h.helpers.map(code).join(", ") || "—"} |`));
  if (a.duplicates.length) {
    L.push("", "## Helpers defined in more than one handler", "", "Define each once (a shared module, or one place on the page) and call it.", "", "| Helper | Handlers |", "|---|---|");
    for (const d of a.duplicates) L.push(`| ${code(d.name)} | ${d.handlers.map(code).join(", ")} |`);
  }
  return L.join("\n") + "\n";
}

// What the CLI was handed, as the `--built` root `verifyCtx` reads: a saved `get-page` response is one page's
// bundle, a `built.json` is read as it is, and a file that is not JSON is the handler source itself.
export function codeMapRoot(raw) {
  let json;
  try { json = JSON.parse(raw); } catch { return { handlers: raw }; }
  return json?.bundle && typeof json.bundle === "object" ? json.bundle : json;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stop = (msg) => { process.stderr.write(`codemap.mjs: ${msg}\n`); process.exit(1); };
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--page");
  if (pi >= 0 && (!argv[pi + 1] || argv[pi + 1].startsWith("--"))) stop("`--page` needs a page key, e.g. `--page main`");
  const pageKey = pi >= 0 ? argv[pi + 1] : "main";
  const file = argv.find((a, i) => !a.startsWith("--") && (pi < 0 || i !== pi + 1));
  if (!file) stop("usage: node engine/codemap.mjs <saved get-page response | built.json | handler source> [--page <key>]");
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { stop(`cannot read '${file}': ${e.message}`); }
  // A built.json names its pages; anything else is ONE page, read the way verify reads a single-page payload.
  const root = codeMapRoot(raw);
  if (!root || typeof root !== "object") stop(`'${file}' holds no page: expected a get-page response, a built.json or handler source`);
  const ctx = verifyCtx(root, root.pages ? pageKey : "main");
  if (ctx.handlersSrc == null) stop(`no handler source for page \`${pageKey}\` in '${file}'`);
  const a = analyzePageCode(ctx.handlersSrc, ctx.page?.viewConfig);
  if (a.error) stop(a.error);
  process.stdout.write(renderCodeMap(a, pageKey, esc));
  process.exit(findingCount(a) ? 2 : 0);
}
