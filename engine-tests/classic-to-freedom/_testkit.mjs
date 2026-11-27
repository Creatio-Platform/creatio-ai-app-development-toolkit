import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Shared golden-test helpers: build normalized ParsedSchema records and diff ops in ONE place, so the
// schema/op shape lives here (both run.mjs and run-mapper.mjs import it) instead of two hand-kept copies
// that could drift and silently feed mergeHierarchy a malformed fixture.
// The properties that live inside a real classic diff op's `values` object. `makeOp` builds an ALREADY-normalized
// op (it bypasses `normalizeDiffOp`), so it has to reproduce every field the parser emits — including `valuesKeys`.
// `replayMerge` decides the identity properties by key PRESENCE, mirroring the runtime, so an op with no
// `valuesKeys` silently carries nothing: forgetting this made a merge golden fail while production was correct.
// Supplying a key here means "this layer's `values` carried it", which is exactly the distinction that matters —
// pass `itemType: null` to express "restated with a value the engine cannot resolve" (the runtime CLEARS the base).
const VALUE_KEYS = new Set(["bindTo", "itemType", "contentType", "dataValueType", "order",
  "layout", "tip", "hint", "generator", "visible", "caption"]);
export const makeOp = (o) => ({
  operation: o.operation || "insert", name: o.name,
  parentName: o.parentName ?? null, propertyName: o.propertyName ?? null,
  bindTo: o.bindTo ?? null, itemType: o.itemType ?? null, contentType: o.contentType ?? null,
  dataValueType: o.dataValueType ?? null,
  isTab: !!o.isTab, order: o.order ?? null,
  layout: o.layout ?? null, tip: o.tip ?? null, hint: o.hint ?? null, generator: o.generator ?? null, visible: o.visible ?? null,
  caption: o.caption ?? null,
  // IDEMPOTENT, and it has to be: tests call `makeOp` themselves (imported as `di`) and then hand the result to
  // `makeSchema`, which maps `makeOp` over the diff AGAIN. Every other field here survives that double pass because
  // `o.x ?? null` twice equals once — `valuesKeys` does NOT, because on the second pass `o` is a fully normalized op
  // with EVERY key present, so recomputing gave all eleven and a `merge` then cleared every property the base had.
  // Reusing an already-computed set is what keeps "the caller supplied this key" meaning what it says.
  valuesKeys: o.valuesKeys instanceof Set ? o.valuesKeys : new Set(Object.keys(o).filter((k) => VALUE_KEYS.has(k))),
  itemTypeUnresolved: !!o.itemTypeUnresolved,
});
export const makeSchema = (pkg, o = {}) => ({
  pkg, error: null, entitySchemaName: o.entity || "?", diff: (o.diff || []).map(makeOp),
  businessRules: o.businessRules || {}, rules: o.rules || {}, details: o.details || {},
  methods: o.methods || [], attributes: [], modules: o.modules || [], features: o.features || [], actionHints: o.actionHints || [],
  refModules: o.refModules || [],
});

// THE USER'S APPROVAL OF ONE PLAN VERSION, recorded the way orchestrate-build.md 7.1 step 1 records it: a `## `
// entry in `decisions.md` of the migration folder (the folder above the task folder `tasksDir`) holding both a
// `Plan version:` field and a non-empty `Approved by:` field. `--tasks`, `--start` and `--route` write nothing
// without it, so a fixture that slices or routes records it first. Appended to whatever decisions.md already holds,
// and once per version. Refused for a task folder directly under the OS temp directory: its decisions.md would be
// one file every fixture on the machine shares.
export const approvalEntry = (planVersion) =>
  `## Plan approved\n- Approved by: test\n- Plan version: \`${planVersion}\`\n`;
// The browser answer step 7.0b records: a `Browser:` line in `worklog.md` of the migration folder above
// `tasksDir`. `--start` of a task that writes a page refuses without one. Appended once, after whatever
// worklog.md already holds, so a fixture that writes its own worklog keeps its lines.
export function recordBrowserAnswer(tasksDir, answer = "page-smoke") {
  return appendOnceBeside(tasksDir, "worklog.md", `Browser: ${answer}\n`, "recordBrowserAnswer", "\n");
}
export function approvePlan(tasksDir, planVersion) {
  if (!planVersion) throw new Error("approvePlan: no plan version to approve");
  return appendOnceBeside(tasksDir, "decisions.md", approvalEntry(planVersion), "approvePlan", "\n\n");
}
// Appends `entry` once to `fileName` in the migration folder above `tasksDir`, separated from what the file already
// holds by `gap` (a file ending in a newline needs one newline fewer). Refused for a task folder directly under the
// OS temp directory, whose migration folder every fixture on the machine would share.
function appendOnceBeside(tasksDir, fileName, entry, who, gap) {
  const folder = path.dirname(path.resolve(tasksDir));
  if (folder === path.resolve(os.tmpdir())) {
    throw new Error(`${who}: ${tasksDir} sits directly in the temp directory; give it a migration folder of its own`);
  }
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, fileName);
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { /* no such file yet */ }
  if (!text.includes(entry)) {
    let sep = gap;
    if (text === "") sep = "";
    else if (text.endsWith("\n")) sep = gap.slice(1);
    fs.writeFileSync(file, text + sep + entry);
  }
  return file;
}

// A runner's assertions. `cond` and `detail` may be thunks: each is evaluated on its own, and a throw is recorded
// rather than raised, so one failing assertion never hides the checks after it. `detail` is printed on a failure
// only, so a red golden in CI shows what was computed without a local rerun.
const settle = (v) => {
  if (typeof v !== "function") return { value: v };
  try { return { value: v() }; } catch (error) { return { error }; }
};
export function checker() {
  const counts = { pass: 0, fail: 0 };
  const check = (name, cond, detail) => {
    const { value, error } = settle(cond);
    if (value && !error) { counts.pass++; console.log(`  ✅ ${name}`); return; }
    counts.fail++;
    const threw = error ? "  (threw: " + error.message + ")" : "";
    console.log(`  ❌ ${name}${threw}`);
    if (detail === undefined) return;
    const shown = settle(detail);
    const text = shown.error ? `<detail threw: ${shown.error.message}>` : shown.value;
    console.log(`      ↳ ${typeof text === "string" ? text : JSON.stringify(text)}`);
  };
  return { check, counts };
}

// The Outcome cell of the n-th deliverable row (1-based) of a rendered task file, set to `value` — the one cell of
// the table a sub-agent writes. Pipes escaped as `\|` inside a caption are not cell borders.
export function setOutcome(text, n, value) {
  let seen = 0;
  return text.split("\n").map((line) => {
    const cells = line.split(/(?<!\\)\|/);
    if (cells.length < 7 || !/^\s*\d+\s*$/.test(cells[1])) return line;
    seen++;
    if (seen !== n) return line;
    cells[5] = ` ${value} `;
    return cells.join("|");
  }).join("\n");
}
