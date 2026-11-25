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
// Parsed with the engine's integrity-checked acorn and walked with its bounded walker; never executed. Function length
// and a helper declared twice are measured by quality.mjs — the same rules, limit (`manifest.qualityThresholds`) and
// ids as clio's save-time page lint — so the map, this row and the save-time warning agree.
//
// CLI: `node engine/codemap.mjs <file> [--page <key>]` prints the map. `<file>` is a saved `get-page` response, a
// `built.json` (the page is `--page`, default `main`), or the raw handler source. The page is read the way
// `--verify` reads it. Exit 0 = no findings, 2 = findings, 1 = the input could not be read or parsed.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getAcornParse, walkAstBounded, staticPropKey, isFnNode, parseDefineModule } from "./engine.mjs";
import { bundleDeps } from "./conventions.mjs";
import { lintPageQuality, lintRunQuality, runModuleLint, QUALITY_RULES, DEFAULT_QUALITY_THRESHOLDS, MODULE_BODY_RULES } from "./quality.mjs";
import path from "node:path";
import { moduleNameOf } from "./reads.mjs";
// designspec.mjs imports this module for the verify row; neither module uses the other's exports while it loads,
// so the cycle is safe, and the CLI below reads the page exactly the way `--verify` does.
import { verifyCtx, esc } from "./designspec.mjs";

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

// One walk per handler: the helpers it defines and every string literal it mentions — a request is SENT when its
// name appears in a handler (`executeRequest({ type: "usr.X" })`) or in the view.
function handlerFacts(entry) {
  const helpers = new Set(), literals = new Set();
  const walk = entry.fn ? walkAstBounded(entry.fn.body, (n) => {
    if (n.type === "Literal" && typeof n.value === "string") literals.add(n.value);
    const named = namedFunctionOf(n);
    if (named) helpers.add(named.name);
  }) : { truncated: false };
  // A handler naming its OWN request (`request.type === "usr.X"`, a log line) does not send it.
  if (entry.declared) literals.delete(entry.request);
  return { request: entry.request, lines: linesOf(entry.fn), helpers: [...helpers].sort((x, y) => x.localeCompare(y)),
    literals, truncated: walk.truncated };
}

// Where a long function sits: a handler by its request, a function inside it as `request › name`, and a validator or
// converter function as `validators › name` (the section is a separate source, so its lines are its own).
function whereIs(finding, entries) {
  const own = finding.name || `line ${finding.line}`;
  if (finding.section !== "handlers") return `${finding.section} › ${own}`;
  const owner = entries.find((e) => e.fn && e.fn.loc.start.line <= finding.line && finding.line <= e.fn.loc.end.line)?.request;
  if (!owner || own === owner) return own;
  return `${owner} › ${own}`;
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
// and dispatched from there is sent, not dead. `thresholds` are the run's `manifest.qualityThresholds`. `sections`
// carries the page's `validators` / `converters` source: their functions are held to the same length limit.
export function analyzePageCode(handlersSrc, viewConfig = null, sentElsewhere = new Set(), thresholds = DEFAULT_QUALITY_THRESHOLDS, sections = {}) {
  const text = String(handlersSrc ?? "").trim();
  const sendsChecked = viewConfig != null;
  const maxFunctionLines = thresholds.maxFunctionLines;
  const others = Object.fromEntries(["validators", "converters"].filter((k) => typeof sections[k] === "string").map((k) => [k, sections[k]]));
  if (!text && !Object.keys(others).length) return { handlers: [], findings: [], sendsChecked, maxFunctionLines };
  const lint = lintPageQuality({ handlers: text || "[]", ...others }, thresholds);
  if (lint?.unreadable.length) return { error: `the page's ${lint.unreadable.map((s) => "`" + s + "`").join(", ")} does not parse` };
  if (!text) return { handlers: [], findings: lengthFindings(lint, []), sendsChecked, maxFunctionLines };
  let expr;
  try { expr = getAcornParse()(`(${text}\n)`, { ecmaVersion: "latest", sourceType: "script", locations: true }).body[0]?.expression; }
  catch (e) { return { error: `the handler source does not parse: ${String(e?.message || e)}` }; }
  if (expr?.type !== "ArrayExpression") return { error: "the handler source is not an array of `{ request, handler }` entries" };
  const entries = expr.elements.map(handlerEntryOf).filter(Boolean);
  const handlers = entries.map(handlerFacts);
  if (handlers.some((h) => h.truncated)) return { error: "a handler is too large or too deeply nested to analyse — split it" };
  const of = (rule) => (lint?.findings || []).filter((f) => f.rule === rule);
  const sent = new Set([...handlers.flatMap((h) => [...h.literals]), ...viewRequests(viewConfig), ...sentElsewhere]);
  const unsent = sendsChecked ? [...new Set(entries.filter((e) => e.declared).map((e) => e.request))]
    .filter((r) => !r.startsWith(PLATFORM_PREFIX) && !sent.has(r)) : [];
  return {
    handlers: handlers.map(({ request, lines, helpers }) => ({ request, lines, helpers })),
    findings: [
      ...lengthFindings(lint, entries),
      ...of(QUALITY_RULES.duplicateInPage).map((f) => ({ rule: f.rule, name: f.name, original: f.original, originalLine: f.originalLine, count: f.count })),
      ...unsent.map((request) => ({ rule: QUALITY_RULES.requestWithoutSender, request })),
    ],
    sendsChecked,
    maxFunctionLines,
  };
}

// Every function over the length limit, in handlers, validators and converters alike.
function lengthFindings(lint, entries) {
  return (lint?.findings || []).filter((f) => f.rule === QUALITY_RULES.functionTooLong)
    .map((f) => ({ rule: f.rule, where: whereIs(f, entries), lines: f.value, limit: f.limit }));
}

export const findingCount = (a) => a.findings.length;

// The findings as short phrases — the verify row's text and the map's summary say the same thing. `escape` is the
// caller's Markdown escaping for names taken from the page body (designspec.mjs `esc`).
export function findingPhrases(a, escape = String) {
  const code = (s) => `\`${escape(s)}\``;
  const phrase = {
    [QUALITY_RULES.functionTooLong]: (f) => `${code(f.where)} is ${f.lines} lines (limit ${f.limit})`,
    [QUALITY_RULES.duplicateInPage]: (f) => `${code(f.name)} repeats ${code(f.original)} (line ${f.originalLine}) — declared ${f.count} times`,
    [QUALITY_RULES.requestWithoutSender]: (f) => `${code(f.request)} is declared but nothing sends it`,
  };
  return a.findings.map((f) => phrase[f.rule](f));
}

// THE RUN'S MODULES, as the map shows them: the checks that look across pages and modules (a page with no module of
// its own, a handler copied between pages, a function or record id in two modules, an unused export, a call a module
// already wraps). `null` when the input has no module bodies, so the map says it did not look rather than "none".
export const RUN_MODULE_RULES = Object.freeze([QUALITY_RULES.pageWithoutModule, QUALITY_RULES.duplicateHandlerAcrossPages, ...MODULE_BODY_RULES]);
export function runModuleFindings(root, pageKey, modules, thresholds = DEFAULT_QUALITY_THRESHOLDS) {
  if (!modules || typeof modules !== "object") return null;
  const wholeRun = !!(root?.pages && typeof root.pages === "object");
  const pages = wholeRun ? root.pages : { [pageKey]: root };
  // One page in hand: a finding is the builder's only when it touches a module the page owns or imports, directly
  // or through those modules. Two unrelated modules elsewhere in the folder are not this page's to fix.
  const reach = wholeRun ? null : importClosure(root, modules);
  const out = [];
  const run = lintRunQuality(pages, thresholds, new Set(), modules, wholeRun);
  for (const key of new Set([...run.keys(), ...run.modules.keys()])) out.push(...pageModuleFindings(key, run.get(key), runModuleLint(run, key), reach));
  return { modules: Object.keys(modules).length, findings: out, wholeRun };
}

// One page's run-module findings and unreadable modules. With `reach` (one page in hand), a module finding counts
// only when it names a module the page reaches.
function pageModuleFindings(key, lint, moduleLint, reach) {
  const touches = (f) => !reach || !f.section?.startsWith("module ")
    || [...reach].some((n) => f.section === `module ${n}` || f.text.includes(`\`${n}\``));
  return [
    ...[...(lint?.findings || []), ...moduleLint.findings].filter((f) => RUN_MODULE_RULES.includes(f.rule) && touches(f)).map((f) => ({ page: key, ...f })),
    ...moduleLint.unreadable.map((u) => ({ page: key, rule: "unreadable", text: `${u} could not be parsed` })),
  ];
}

// The modules one page reaches: its own `<PageSchema>Module`, its imports, and theirs.
// A Set visits what is added to it during the loop, so one pass follows the imports to the end.
function importClosure(entry, modules) {
  const reach = new Set(bundleDeps(entry) || []);
  if (typeof entry?.schemaName === "string") reach.add(entry.schemaName + "Module");
  for (const name of reach) {
    if (typeof modules[name] === "string") for (const dep of parseDefineModule(modules[name]).deps) reach.add(dep);
  }
  return reach;
}

export function renderCodeMap(a, pageKey = "page", escape = String, run = null) {
  const code = (s) => `\`${escape(s)}\``;
  const n = findingCount(a);
  const L = [`# ${escape(pageKey)} — code map (derived from the page body; do not edit)`, "",
    n ? `**${n} finding(s) to clear before this task closes** — the \`Page code\` row of \`--verify\` checks the same:`
      : "**No findings** — the `Page code` row of `--verify` will pass on this body.",
    ...findingPhrases(a, escape).map((p) => `- ${p}`),
    ...(a.sendsChecked ? [] : ["- Requests sent from the view were not checked: the input has no `viewConfig` — pass the saved get-page response, not the handler source alone."]),
    "", "## Handlers", "", "| # | Request | Lines | Helpers it defines |", "|---|---|---|---|"];
  a.handlers.forEach((h, i) => L.push(`| ${i + 1} | ${code(h.request)} | ${h.lines}${h.lines > a.maxFunctionLines ? " ⚠" : ""} | ${h.helpers.map(code).join(", ") || "—"} |`));
  L.push("", "## The run's modules", "");
  if (!run) L.push("Not checked: the input carries no module bodies. Pass `--modules <dir>` (a folder of `<Module>.js` files, or `.clio-pages` with each module's `body.js`) or a `built.json` with `modules`.");
  else if (!run.findings.length) L.push(`**No findings** across ${run.modules} module(s): every page with handlers has its own module and nothing is declared twice${run.wholeRun ? ", every export is used" : ""}.`);
  else {
    L.push(`**${run.findings.length} finding(s)** across ${run.modules} module(s) — the \`Code quality\` rows of \`--verify\` hold the same:`);
    for (const f of run.findings) L.push(`- ${code(f.page)} · ${f.rule}: ${f.text}`);
  }
  if (run && !run.wholeRun) L.push("", "Unused exports are checked on the whole run only (`--verify`, or a `built.json` with every page): one page cannot see what the others import.");
  return L.join("\n") + "\n";
}

// What the CLI was handed, as the `--built` root `verifyCtx` reads: a saved `get-page` response is one page's
// bundle, a `built.json` is read as it is, and a file that is not JSON is the handler source itself.
export function codeMapRoot(raw) {
  let json;
  try { json = JSON.parse(raw); } catch { return { handlers: raw }; }
  if (!(json?.bundle && typeof json.bundle === "object")) return json;
  // The page's schema name lives beside the bundle; the module checks need it to find the page's own module.
  const schemaName = json.page?.schemaName;
  return typeof schemaName === "string" ? { ...json.bundle, schemaName } : json.bundle;
}

// The module bodies in a folder: `<Module>.js` files, or `<Module>/body.js` as get-page writes them under
// `.clio-pages`. A body with a `SCHEMA_HANDLERS` section is a page, not a module, and is left out.
export function readModuleDir(dir) {
  const out = Object.create(null);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const folder = entry.isDirectory();
    const name = moduleNameOf(entry.name, { requireJs: !folder });
    const file = folder ? path.join(dir, entry.name, "body.js") : path.join(dir, entry.name);
    if (!name || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("/**SCHEMA_HANDLERS*/")) out[name] = src;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stop = (msg) => { process.stderr.write(`codemap.mjs: ${msg}\n`); process.exit(1); };
  const argv = process.argv.slice(2);
  const pi = argv.indexOf("--page");
  if (pi >= 0 && (!argv[pi + 1] || argv[pi + 1].startsWith("--"))) stop("`--page` needs a page key, e.g. `--page main`");
  const pageKey = pi >= 0 ? argv[pi + 1] : "main";
  const mi = argv.indexOf("--modules");
  if (mi >= 0 && (!argv[mi + 1] || argv[mi + 1].startsWith("--"))) stop("`--modules` needs a folder, e.g. `--modules .clio-pages`");
  const file = argv.find((a, i) => !a.startsWith("--") && (pi < 0 || i !== pi + 1) && (mi < 0 || i !== mi + 1));
  if (!file) stop("usage: node engine/codemap.mjs <saved get-page response | built.json | handler source> [--page <key>] [--modules <dir>]");
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { stop(`cannot read '${file}': ${e.message}`); }
  // A built.json names its pages; anything else is ONE page, read the way verify reads a single-page payload.
  const root = codeMapRoot(raw);
  if (!root || typeof root !== "object") stop(`'${file}' holds no page: expected a get-page response, a built.json or handler source`);
  const ctx = verifyCtx(root, root.pages ? pageKey : "main");
  if (ctx.handlersSrc == null) stop(`no handler source for page \`${pageKey}\` in '${file}'`);
  const a = analyzePageCode(ctx.handlersSrc, ctx.page?.viewConfig);
  if (a.error) stop(a.error);
  let modules = root.modules && typeof root.modules === "object" ? root.modules : null;
  if (mi >= 0) {
    try { modules = { ...modules, ...readModuleDir(argv[mi + 1]) }; } catch (e) { stop(`cannot read '${argv[mi + 1]}': ${e.message}`); }
  }
  const run = runModuleFindings(root, pageKey, modules);
  process.stdout.write(renderCodeMap(a, pageKey, esc, run));
  process.exit(findingCount(a) || run?.findings.length ? 2 : 0);
}
