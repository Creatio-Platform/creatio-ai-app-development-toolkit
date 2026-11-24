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
//     "requestPrefix": "dw",                  // the namespace custom requests use (`dw.SomethingRequest`)
//     "validatorPrefix": "dw",                // optional; defaults to requestPrefix
//     "converterPrefix": "dw",                // optional; defaults to requestPrefix
//     "helperModules": ["Dw8xClientHelperModule"],   // modules the team's Freedom pages import for shared logic
//     "constantsModules": ["WorkJsConstants"],       // modules that hold the ids of existing records
//     "source": "freedom-pages" | "schema-prefix" | "sys-setting" | "fallback",   // which detection step decided
//     "evidence": "dw. — 7 requests on Page_PackageDelivery",
//     "confirmedBy": "plan" | "user",         // "user" once the user answered a conflict or a change
//     "conflict": { "dw": 7, "usr": 2 },      // optional; request counts per namespace when detection disagreed
//     "previous": { "folder": "<earlier migration folder>", "requestPrefix": "dw", "helperModules": [...],
//                   "constantsModules": [...] }   // optional; what the latest earlier migration recorded
//   }
//   "constantsModules": { "WorkJsConstants": { "body": "<define(...) source>" } | "<define(...) source>" }
//
// Pure: no I/O. migrate.mjs resolves the facts once per run (`conventionFacts`) and gates `--plan` on their issues;
// designspec.mjs renders and verifies; tasks.mjs copies the block into every task file.
import { parseDefineModule, staticPropKey } from "./engine.mjs";

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
const blank = (v) => typeof v !== "string" || v.trim() === "";
// `dw`, `dw.` and ` dw ` are one namespace.
export const normalizePrefix = (v) => (typeof v === "string" ? v.trim().replace(/\.+$/, "") : "");
const nameList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))] : []);

// The recorded block, normalized; null when there is none to read. Missing validator/converter prefixes take the
// request prefix, because a project that names its requests `dw.` names its validators the same way unless it
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
  const counts = Object.entries(v).filter(([k, n]) => !blank(k) && Number.isFinite(n) && n > 0)
    .map(([k, n]) => [normalizePrefix(k), n]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return counts.length >= 2 ? counts : null;
}
function previousOf(v) {
  if (!isObj(v)) return null;
  return {
    folder: typeof v.folder === "string" ? v.folder : "",
    requestPrefix: normalizePrefix(v.requestPrefix),
    helperModules: nameList(v.helperModules),
    constantsModules: nameList(v.constantsModules),
  };
}
// What differs between the earlier migration's record and this run's, as readable phrases (empty = same).
function previousDifferences(c) {
  const p = c?.previous;
  if (!p) return [];
  const out = [];
  if (p.requestPrefix && p.requestPrefix !== c.requestPrefix) out.push(`request prefix ${p.requestPrefix}. → ${c.requestPrefix}.`);
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
    if (!NAMESPACE_RX.test(v)) issues.push(`projectConventions.${key} '${v}' is not a namespace — letters and digits only, no dot (\`dw\`, not \`dw.X\`)`);
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
  if (!c.evidence) issues.push("projectConventions.evidence is empty — say what decided the prefix (e.g. \"dw. — 7 requests on Page_PackageDelivery\", or \"no custom requests; SchemaNamePrefix = Usr\")");
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
    issues.push(`projectConventions.conflict — the target packages use ${c.conflict.length} namespaces (${c.conflict.map(([ns, n]) => `${ns}. × ${n}`).join(", ")}); ask the user which one this migration uses and record the answer with confirmedBy: "user"`);
  }
  const diff = previousDifferences(c);
  if (diff.length) {
    issues.push(`projectConventions differ from the earlier migration${c.previous.folder ? ` in '${c.previous.folder}'` : ""} (${diff.join("; ")}); ask the user which to keep and record the answer with confirmedBy: "user"`);
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
// ids. The path is the chain of property names from the module's return value: `WorkJsConstants.Status.New`.
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
  const vars = factoryVars(parsed.factory);
  const out = [];
  const seen = new Set();
  walkValue(parsed.returned, [name], { vars, out, seen });
  for (const [varName, node] of vars) if (!seen.has(node)) walkValue(node, [name, varName], { vars, out, seen });
  return out;
}
// The factory's top-level `var`/`let`/`const` declarators with an object or array initializer.
function factoryVars(factory) {
  const vars = new Map();
  const body = factory?.body?.type === "BlockStatement" ? factory.body.body : [];
  for (const st of body) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      if (d.id?.type === "Identifier" && (d.init?.type === "ObjectExpression" || d.init?.type === "ArrayExpression")) vars.set(d.id.name, d.init);
    }
  }
  return vars;
}
function walkValue(node, path, st) {
  if (!node || st.seen.has(node)) return;
  if (node.type === "Identifier") {
    if (st.vars.has(node.name)) walkValue(st.vars.get(node.name), path, st);
    return;
  }
  if (node.type === "Literal") {
    if (typeof node.value === "string" && GUID_RE.test(node.value)) st.out.push({ guid: node.value.toLowerCase(), path: path.join(".") });
    return;
  }
  st.seen.add(node);
  if (node.type === "ObjectExpression") {
    for (const p of node.properties) {
      const key = p.type === "Property" ? staticPropKey(p) : null;
      if (key != null) walkValue(p.value, [...path, key], st);
    }
  } else if (node.type === "ArrayExpression") {
    node.elements.forEach((el, i) => walkValue(el, [...path, String(i)], st));
  }
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
  try {
    const parsed = JSON.parse(String(v));
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
  } catch { /* not JSON — read the quoted names below */ }
  return [...String(v).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}
const QUALIFIED_NAME = /^([A-Za-z][A-Za-z0-9]*)\.[A-Za-z_$][\w$]*$/;
// The custom names a built page declares, per kind: handler requests (plus the `clicked` requests its elements
// fire), validator and converter registrations. null when the bundle carries none of the three sources.
// `handlersSrc` is verifyCtx's own normalization of `entry.handlers` (source text either way).
export function bundleCustomNames(entry, handlersSrc, ops = []) {
  if (!entry || (handlersSrc == null && entry.validators == null && entry.converters == null)) return null;
  const names = { request: new Set(), validator: new Set(), converter: new Set() };
  for (const m of String(handlersSrc ?? "").matchAll(/"?\brequest"?\s*:\s*["']([^"']+)["']/g)) names.request.add(m[1]);
  for (const o of ops) if (typeof o.request === "string") names.request.add(o.request);
  for (const n of registeredNames(entry.validators)) names.validator.add(n);
  for (const n of registeredNames(entry.converters)) names.converter.add(n);
  return names;
}
// The keys of a validators/converters registration object: `{ "dw.Positive": { … } }`.
function registeredNames(v) {
  if (v == null) return [];
  if (isObj(v)) return Object.keys(v);
  return [...String(v).matchAll(/["']([A-Za-z][A-Za-z0-9]*\.[A-Za-z_$][\w$]*)["']\s*:/g)].map((m) => m[1]);
}
// The names outside the confirmed namespace, `[{ kind, name }]`. `prefixes` is `prefixesOf(conventions)`; `crt.`
// is the platform's and always allowed.
export function foreignNames(names, prefixes) {
  const out = [];
  for (const kind of NAME_KINDS) {
    for (const name of names[kind]) {
      const ns = QUALIFIED_NAME.exec(name)?.[1];
      if (!ns || ns.toLowerCase() === PLATFORM_NAMESPACE || ns === prefixes[kind]) continue;
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
    `- **Custom requests:** name them \`${esc(c.requestPrefix)}.<Name>Request\` — never \`usr.\` unless that is the prefix here.`,
    `- **Validators / converters:** ${w.code(c.validatorPrefix + ".")} / ${w.code(c.converterPrefix + ".")}.`,
    `- **Helper modules:** ${w.list(c.helperModules)} — reuse what they already provide instead of writing it again.`,
    `- **Constants modules:** ${w.list(c.constantsModules)} — reference existing record ids through them: add the module to the page's SCHEMA_DEPS and use the named value; never paste a GUID. The plan's *Project conventions* section maps each id to its path.`,
    "- Freedom pages CAN import these client-unit modules: list the module in SCHEMA_DEPS and take it as a factory argument.",
    "",
  ];
}
