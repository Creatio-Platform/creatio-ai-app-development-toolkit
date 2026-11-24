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
// Pure: no I/O. migrate.mjs gates on `projectConventionsIssues`, designspec.mjs renders and verifies.
import { parseDefineModule } from "./engine.mjs";

// The namespace every Creatio page defaulted to before a project said otherwise.
export const DEFAULT_REQUEST_PREFIX = "usr";
// The platform's own namespace: reserved, never a project's.
export const PLATFORM_NAMESPACE = "crt";
export const CONVENTION_SOURCES = Object.freeze(["freedom-pages", "schema-prefix", "sys-setting", "fallback"]);
export const CONFIRMED_BY = Object.freeze(["plan", "user"]);
// The three kinds of custom name a page declares, each with its own prefix key.
export const NAME_KINDS = Object.freeze(["request", "validator", "converter"]);
const PREFIX_KEY = Object.freeze({ request: "requestPrefix", validator: "validatorPrefix", converter: "converterPrefix" });
const NAMESPACE_RX = /^[A-Za-z][A-Za-z0-9]*$/;
// A whole-string record id (assemble.mjs keeps the same shape; not imported, to keep this module free of the
// reads/assemble import chain that leads back into designspec.mjs).
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
export function previousDifferences(c) {
  const p = c?.previous;
  if (!p) return [];
  const out = [];
  if (p.requestPrefix && p.requestPrefix !== c.requestPrefix) out.push(`request prefix \`${p.requestPrefix}.\` → \`${c.requestPrefix}.\``);
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

const NOT_RESOLVED = "projectConventions not resolved — record it in manifest.projectConventions as { \"resolved\": true, \"requestPrefix\", \"helperModules\", \"constantsModules\", \"source\", \"evidence\", \"confirmedBy\" } (a verified fallback to `usr` is a valid answer; \"never checked\" is not)";

// The gate. Pure in `manifest`; returns the human-readable blockers (empty = clear), so the CLI gates `--plan` on
// it exactly like placement. An unresolved block is reported alone: a rule evaluated over a missing fact would
// only invent a verdict.
export function projectConventionsIssues(manifest) {
  const c = conventionsOf(manifest);
  if (!c) return [NOT_RESOLVED];
  const raw = manifest.projectConventions;
  return [
    ...prefixIssues(c),
    ...recordIssues(c, raw),
    ...questionIssues(c),
    ...moduleBodyIssues(c, manifest.constantsModules),
  ];
}
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
function moduleBodyIssues(c, bodies) {
  const issues = [];
  for (const name of c.constantsModules) {
    const src = moduleBody(bodies, name);
    if (src == null) {
      issues.push(`constants module '${name}' has no body in manifest.constantsModules — fetch it with get-client-unit-schema and add it as { "${name}": { "body": "<source>" } }, so the plan can map its ids`);
      continue;
    }
    const parsed = parseDefineModule(src);
    if (parsed.error) issues.push(`constants module '${name}' cannot be read: ${parsed.error}`);
  }
  return issues;
}
function moduleBody(bodies, name) {
  if (!isObj(bodies) || !Object.hasOwn(bodies, name)) return null;
  const v = bodies[name];
  if (typeof v === "string") return v;
  return isObj(v) && typeof v.body === "string" ? v.body : null;
}

// ---- the GUID index: every id a constants module holds, by its `Module.Path` ----
//
// A constants module returns (directly or through a local variable) a tree of objects whose leaves are record
// ids. The path is the chain of property names from the module's return value: `WorkJsConstants.Status.New`.
// A variable the return value does not reach is still read, under its own name, so an id held only there is not
// lost. Nothing is evaluated; only literals count.
export function constantsGuidIndex(manifest) {
  const c = conventionsOf(manifest);
  const index = new Map();
  if (!c) return index;
  for (const name of c.constantsModules) {
    const src = moduleBody(manifest.constantsModules, name);
    if (src == null) continue;
    const parsed = parseDefineModule(src);
    if (parsed.error) continue;
    for (const { guid, path } of moduleGuids(name, parsed)) {
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
function propertyKey(p) {
  if (p.computed) return p.key?.type === "Literal" ? String(p.key.value) : null;
  if (p.key?.type === "Identifier") return p.key.name;
  return p.key?.type === "Literal" ? String(p.key.value) : null;
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
      const key = p.type === "Property" ? propertyKey(p) : null;
      if (key != null) walkValue(p.value, [...path, key], st);
    }
  } else if (node.type === "ArrayExpression") {
    node.elements.forEach((el, i) => walkValue(el, [...path, String(i)], st));
  }
}

// Every GUID in a text, lower-cased, in first-seen order. The plan's GUID table is built from the plan itself, so
// "every GUID the plan uses" is literally what the reader sees.
const GUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
export function guidsInText(text) {
  return [...new Set((String(text ?? "").match(GUID_IN_TEXT) || []).map((g) => g.toLowerCase()))];
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
export function bundleCustomNames(entry, ops = []) {
  if (!entry || (entry.handlers == null && entry.validators == null && entry.converters == null)) return null;
  const names = { request: new Set(), validator: new Set(), converter: new Set() };
  for (const r of handlerRequests(entry.handlers)) names.request.add(r);
  for (const o of ops) if (typeof o.request === "string") names.request.add(o.request);
  for (const n of registeredNames(entry.validators)) names.validator.add(n);
  for (const n of registeredNames(entry.converters)) names.converter.add(n);
  return names;
}
function handlerRequests(h) {
  if (h == null) return [];
  if (Array.isArray(h)) return h.map((x) => x?.request).filter((r) => typeof r === "string");
  return [...String(h).matchAll(/\brequest\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
}
// The keys of a validators/converters registration object: `{ "dw.Positive": { … } }`.
function registeredNames(v) {
  if (v == null) return [];
  if (isObj(v)) return Object.keys(v);
  return [...String(v).matchAll(/["']([A-Za-z][A-Za-z0-9]*\.[A-Za-z_$][\w$]*)["']\s*:/g)].map((m) => m[1]);
}
// The names outside the confirmed namespace, `[{ kind, name }]`. `crt.` is the platform's and always allowed.
export function foreignNames(names, c) {
  const out = [];
  for (const kind of NAME_KINDS) {
    const allowed = c[PREFIX_KEY[kind]];
    for (const name of names[kind]) {
      const m = QUALIFIED_NAME.exec(name);
      if (!m) continue;
      const ns = m[1];
      if (ns.toLowerCase() === PLATFORM_NAMESPACE || ns === allowed) continue;
      out.push({ kind, name });
    }
  }
  return out;
}
