// engine/designspec.mjs — render the per-page design spec (references/page-design-spec.md format) as a
// ready-to-present Markdown artifact, DETERMINISTICALLY, from the Freedom ChangeSet.
//
// Why this exists: telling the agent (in prose) to "produce a per-page design spec" repeatedly produced a
// loose PARAPHRASE — no per-field table, features mislabelled. The agent cannot paraphrase a table it did
// not write, so the engine emits it and the skill presents it verbatim.
//
// The spec is ONE layout table (structure + contents, no repetition) + a Logic table (behaviour that is
// not layout) + a Confirm list (the ⚠ worklist). Input = the runMigration() result. Output = Markdown.
// Markdown tables cannot merge cells, so the Region column REPEATS per row (grouped, first-seen order).

// UNTRUSTED-INPUT HARDENING. Captions, titles, entity/column/detail/process/page names and notes are
// STAND-DERIVED — they end up in the Markdown plan the agent presents "verbatim" and acts on. A raw
// newline, control char, heading (`#`), blockquote (`>`) or table pipe in one of them can break the table
// OR inject a line that reads as an instruction (indirect prompt injection into a doc the agent executes).
// `strip` normalizes EVERY value to a single inert line (control chars / CR / LF / tabs -> space) before it
// enters the Markdown — this alone kills all line-based injection (headings/quotes/fences/new table rows),
// since an injected char can no longer start a new line. Safe for engine-authored text too (single-line).
import { resourceKey } from "./engine.mjs"; // ONE canonical resource-key normalization, shared with the mapper (strips $/prefix/#anchor)
const strip = (s) => (s == null ? "" : String(s)
  .replace(/^\$/, "")                        // drop the binding `$` sigil (display, not a value)
  .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g, "") // bidi/zero-width controls (Trojan-Source CVE-2021-42574) -> REMOVE (they reorder/hide rendered text)
  .replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, " ") // control/CR/LF/tab + Unicode line/para separators -> space
  .trim());
// `esc` is for STAND-DERIVED VALUES placed in table cells / inline code spans. On top of strip it (a)
// escapes the table pipe and (b) neutralizes backticks to an inert look-alike (U+02CB) so a value can never
// break out of an inline `code` span — a real caption/identifier never legitimately contains a backtick.
// (Engine-authored reason/note text keeps `strip`, not `esc`, so its intentional `code` spans survive.)
// On top of strip: neutralize every construct that could be ACTIVE Markdown/HTML in a rendered plan — the
// table pipe, an inline code-span breakout (backtick), an HTML tag (`<img onerror=…>` → angle brackets are
// HTML-encoded so it can never be a tag), and a Markdown link/image (`[x](javascript:…)` / `![x](…)` → break
// the `](` so it renders literally). `&` is left as-is: a legitimate caption like "R&D" must read cleanly, and
// since `<`/`>` are encoded there is no tag for a bare `&` to complete.
const esc = (s) => strip(s)
  .replaceAll("`", "ˋ")
  .replaceAll("|", String.raw`\|`)
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("](", String.raw`]\(`);
// A value rendered on its OWN line (not after an inline label) must ALSO not START with a Markdown block
// marker — `#` `>` `-` `+` `*` or `N.` — else e.g. "## Boom" becomes a real heading. Escapes the leading
// marker. (Inline fills after a `**Label:**` prefix are already inert; only bare-line values need this.)
const escBareLine = (s) => String(s).replace(/^(\s*)([#>*+~=-]|\d+\.)/, String.raw`$1\$2`);
const isField = (o) => !!o?.values?.control;
const DASH = "—";

// Climb the emitted insert tree from a container to the region that holds it: crt.Tab → that tab,
// SideAreaProfileContainer → the side profile (with the island container appended, #9b), Header → header,
// else the raw container name (a base-template container not re-emitted here).
function regionResolver(viewConfigDiff, resources = {}) {
  const byName = new Map(viewConfigDiff.map((o) => [o.name, o]));
  // Major 4 — a caption is a `$Resources.Strings.<key>` binding; show its human text from the resource map
  // (the plan stays readable) — fall back to the key when the text is not resolved.
  const capText = (raw) => { const k = resourceKey(raw); return resources[k] ?? k; }; // same key normalization the mapper used to STORE the string (incl. #anchor strip)
  const label = (o) => esc(o.values?.caption ? capText(o.values.caption) : o.name);
  return (parentName) => {
    let p = parentName, hops = 0, first = null;
    while (p && hops++ < 64) {
      if (p === "SideAreaProfileContainer") return first ? `Side profile › ${first}` : "Side profile";
      if (p === "HeaderContainer") return "Header";
      if (p === "GeneralInfoTabContainer") return "⚠ fallback (unresolved)";
      const o = byName.get(p);
      if (!o) return esc(p);
      if (o.values?.type === "crt.Tab") return `Tab · ${label(o)}`;
      if (!first) first = label(o);
      p = o.parentName;
    }
    return esc(parentName);
  };
}

// field display name = its human title (PLAN-only `titleText` metadata; the page itself auto-labels from the
// entity column — Major 4), else the column code.
const dispLabel = (o) => o.values?.titleText || strip(o.values?.control);
const humanizeAction = (a) => ({ "make-required": "required", "make-optional": "optional", "make-read-only": "read-only", "make-editable": "editable", "show-element": "visible", "hide-element": "hidden" }[a] || a);
const triggerOf = (m) => {
  const mt = /^on(.+?)Chang/.exec(m);
  if (mt) return `${mt[1]} changes`;
  if (/init/i.test(m)) return "on load";
  if (/save/i.test(m)) return "on save";
  return "—";
};
// demote a nested design spec's Markdown headings two levels (## → ####, ### → #####, capped at ######)
// so a child page's spec reads as a subsection under the parent plan's `#### Child page:` heading.
const demoteHeadings = (md, shift = 2) => String(md).replace(/^(#{2,6}) /gm, (_m, h) => "#".repeat(Math.min(6, h.length + Math.max(0, shift))) + " ");

export function renderDesignSpec(result, opts = {}) {
  const cs = result.changeSet || {};
  const section = result.section || null;
  const entity = esc(result.entity || "?"); // stand-derived → esc (superset of strip): one line AND neutralize `<`/`>`/backtick/`](` so a hostile entitySchemaName can't inject into the title headings it feeds
  const vcd = cs.viewConfigDiff || [];
  const regionOf = regionResolver(vcd, cs.resources || {}); // pass the resource map so a resolved tab caption shows its text, not the $Resources key
  const tabRegion = (tab) => regionOf(tab);
  const fields = vcd.filter(isField);

  // Declarative page business rules render in the LOGIC table (below), NOT in the Layout Rule column — a reader
  // looks for the business rules in ONE place. The Layout Rule column carries only intrinsic field state
  // (read-only mirrors / column metadata), never rule-driven state.

  const L = [];
  // `embedded` (rendered inside renderPlan): the plan's Overview already carries entity/template/package/
  // size, so skip this preamble to avoid duplicating it — the `### List page` / `### <entity> form page`
  // headings are the divider. Standalone (`--spec`) keeps the full header. The unresolvedParents gate is
  // safety-critical, so it is shown in BOTH modes.
  if (!opts.embedded) {
    const templatePart = opts.template ? ` · **Template:** ${esc(opts.template)}` : "";       // stand/user-supplied → sanitize (Major 5)
    const packagePart = opts.targetPackage ? ` · **Package:** ${esc(opts.targetPackage)}` : "";
    L.push(
      `## Design spec — ${entity} (generated)`,
      "",
      "> Generated by `migrate.mjs --spec` from the merged Classic schemas — **present verbatim, do not",
      "> paraphrase**. Layout = structure + contents (one table). Logic = behaviour. ⚠ = confirm before build.",
      "",
      `- **Entity:** ${entity}${templatePart}${packagePart}`,
      `- **Size:** ${fields.length} fields · ${(cs.details || []).length + (cs.standardFeatures || []).length} details/features · ${(cs.pageBusinessRules || []).length} rules · ${(cs.cardActions || []).length} actions`,
    );
  }
  // ⛔ HARD GATE banner (RV1/RV2): surface EVERY non-empty correctness signal, not just unresolvedParents.
  // Standalone (--spec) prints it here; embedded-in-plan relies on renderPlan's top-of-plan banner (below).
  const gate = result.gate || { blocked: false, reasons: [] };
  if (!opts.embedded && gate.blocked) {
    L.push("> ⛔ **HARD GATE — BLOCKED. DO NOT BUILD.** The engine found unresolved correctness signals; fix them and re-run:");
    for (const r of gate.reasons) L.push(`> - ${esc(r)}`);
  }
  const structure = result.structure || { complete: true, issues: [] };
  if (!opts.embedded && !structure.complete) {
    L.push("> ⛔ **STRUCTURE INCOMPLETE.** Required detail/child-page schemas are not supplied — the plan cannot be complete; fetch them and re-run:");
    for (const it of structure.issues) L.push(`> - ${esc(it)}`);
  }
  L.push("");

  // ---- ONE Layout table (structure + contents) ----
  const rows = []; // { region, sort, cells:[element,type,source,rule,additional] }
  for (const f of fields) {
    const col = strip(f.values.control);
    const v = f.values || {};
    const type = esc(v.typeLabel || v.type) + (v.refSchema ? ` (${esc(v.refSchema)})` : "");
    const rule = v.readOnly ? "read-only" : DASH; // intrinsic state only; business rules live in the Logic table
    // linkedValue: a read-only value shown from a linked record — say it in PLAIN language in the Additional
    // cell (a human reading the plan should not have to decode "mirror" / "lookup-no-ref").
    const linked = v.linkedValue
      ? "Value from a linked record — bind a read-only field to the source object's column, or fill it on the source lookup's change if it must be stored"
      : null;
    const tip = v.tip?.content ? `tip: ${esc(v.tip.content)}` : null;
    const additional = [linked, tip].filter(Boolean).join(" · ") || DASH;
    rows.push({ region: regionOf(f.parentName), sort: 0, cells: [esc(dispLabel(f)), type, "PDS." + esc(col), rule, additional] });
  }
  for (const d of cs.details || []) {
    const depNote = d.dependency ? ` · by ${esc(d.dependency.attributePath)}` : " · ⚠ FK";
    const src = `${esc(d.entity || "?")}${depNote}`;
    const add = d.columns?.length ? `cols: ${d.columns.map(esc).join(" · ")}` : DASH;
    rows.push({ region: d.tab ? tabRegion(d.tab) : "⚠ unplaced", sort: 1, cells: [esc(d.caption || d.detailSchema || d.entity), "Related list", src, DASH, add] });
  }
  for (const s of cs.standardFeatures || []) {
    const isList = s.uiShape === "list";
    const type = isList ? "Related list" : esc(s.feature);
    const nativeSrc = s.templateProvided ? "template-provided" : "native — confirm component on-stand";
    const src = isList ? `${esc(s.entity || "Activity")} · native` : nativeSrc;
    // the feature's domain note (e.g. Visa = Approvals, don't downgrade) must be visible HERE — the
    // standard-feature decision is excluded from the ⚠ Confirm list, so the Layout row is where the agent sees it.
    const inferredNote = s.inferredFromEntity ? "⚠ inferred from entity — confirm" : DASH;
    const add = s.note ? `⚠ ${esc(s.note)}` : inferredNote;
    rows.push({ region: s.tab ? tabRegion(s.tab) : "⚠ unplaced", sort: isList ? 1 : 2, cells: [esc(s.feature), type, src, DASH, add] });
  }
  for (const w of cs.widgets || []) {
    // DCM components (placement set) are NOT in the default Freedom template — they must be ADDED, and Next
    // steps goes in a new tab next to Feed. Other widgets keep the base/native wording.
    const region = w.placement === "tab-next-to-feed" ? "Tab · Next steps (new)" : "Header / top";
    let source;
    if (w.placement) source = "⚠ ADD — not in the default Freedom template";
    else if (w.note) source = "⚠ confirm on-stand — see note"; // specific guidance (e.g. NBO) — do NOT assert template-provided
    else if (w.base) source = "template context — provided by the Freedom template";
    else source = "native — confirm on-stand";
    rows.push({ region, sort: 2, cells: [esc(w.widget), "Component", source, DASH, w.note ? esc(w.note) : DASH] });
  }
  for (const a of cs.cardActions || []) {
    const name = a.replace(/Button$/, "");
    let type = "Action", note = DASH;
    if (/process/i.test(name)) {
      // migrate the Run-process button ONLY if a process is actually connected to the entity; show HOW to check.
      note = "⚠ Migrate ONLY if a process is connected to this section. Check on-stand: read `ProcessInModules` filtered by the section's `SysModule` (nav `SysModule/Id eq <id>`) — that is what fills the \"Run process\" menu (Section Wizard → Business Processes); resolve each row's `SysSchemaUId` via `VwSysProcess` by `Id` for the process name. None connected ⇒ the button is NOT migrated; if some are, name each connected process in the plan. (`SysProcessEntity`/`VwSysProcessEntity` = runtime process-instance↔record links, NOT this.)";
    } else if (/print/i.test(name)) {
      // migrate Print ONLY if printables/reports exist for the section; show HOW to check.
      note = "⚠ Migrate ONLY if printables/reports exist for this section. Check on-stand: read `SysModuleReport` filtered by the section's `SysModule` (nav `SysModule/Id eq <id>`) + `ShowInSection eq true` (section Print menu) or `ShowInCard eq true` (record card); each row's `Caption`/`Type`/`SysReportSchemaUId`|`FileName` is the printable. None ⇒ the button is NOT migrated; if some exist, wire them as the Freedom print action.";
    } else if (name === "ViewOptions") {
      type = "—"; note = "Not migrated — standard page view-options control (native Freedom capability), not a bespoke action.";
    } else if (name === "Tag") {
      type = "—"; note = "Provided by the default Freedom template (tags) — nothing to migrate.";
    }
    rows.push({ region: "Card actions", sort: 3, cells: [esc(name), type, DASH, DASH, note] });
  }
  // RV12 — image/photo components (mapper emits them in cs.images, each with its own needsDecision) were the
  // only category with no Layout row. Give them one, placed in the region their parent resolves to.
  for (const im of cs.images || []) {
    const src = im.generator ? `generator ${esc(im.generator)}` : "native image — confirm";
    rows.push({ region: im.parent ? regionOf(im.parent) : "⚠ unplaced", sort: 0, cells: [esc(im.classic), "Image", src, DASH, "⚠ wire source/upload (getSrc/onChange)"] });
  }
  // group by region (first-seen order), stable by `sort` then insertion within region
  const order = [];
  const byRegion = new Map();
  rows.forEach((r, i) => { if (!byRegion.has(r.region)) { byRegion.set(r.region, []); order.push(r.region); } byRegion.get(r.region).push({ ...r, i }); });
  // region reading order: the side profile (all islands) FIRST, then tabs, then top widgets, card actions,
  // and finally any flagged/unresolved regions — so profile info is not interleaved with tabs.
  const regionRank = (r) => {
    if (r.startsWith("Side profile") || r === "Header") return 0;
    if (r.startsWith("Tab ")) return 1;
    if (r === "Header / top") return 2;
    if (r === "Card actions") return 3;
    return 4;
  };
  const firstSeen = new Map(order.map((r, i) => [r, i]));
  order.sort((a, b) => regionRank(a) - regionRank(b) || firstSeen.get(a) - firstSeen.get(b));

  // ---- List page (section concerns) comes FIRST — the Main-scope table lists the list page before the
  // form page, so the detailed expansions follow that same order: list page → form page → child pages. ----
  if (section) {
    L.push("### List page");
    // Add-record mini page — resolved from list-entity-client-schemas (result.miniPage), NOT assumed from the
    // section body (which registered none even when a per-type mini page existed → a false "no mini page").
    const mp = result.miniPage;
    let addRecordDesc;
    if (mp?.spec) addRecordDesc = `via mini page \`${esc(mp.schema)}\` — quick-add form; its full layout is under **Add mini-page mapping** below`;
    else if (mp && (mp.unfolded || mp.specError || mp.cyclic)) addRecordDesc = `⚠ via mini page \`${esc(mp.schema)}\` — NOT folded; supply its bundle in \`manifest.miniPageSchemas\` so its layout is mapped here`;
    else if (result.miniPageNone) addRecordDesc = "full edit page — verified on-stand: no add-record mini page";
    else if (!result.miniPageVerified) addRecordDesc = "⚠ NOT verified — check `list-entity-client-schemas` (`miniPageSchema` with `miniPageModes` = add) and record `manifest.addRecordMiniPage` ({schema} or false); do NOT assume there is none";
    else addRecordDesc = "full edit page (no add-record mini page)";
    const listCols = (section.listColumns || []).length ? section.listColumns.map(esc).join(" · ") : "⚠ not in the schema (profile data) — read the section's saved columns or confirm the list-page columns";
    L.push(
      `- **Add record:** ${addRecordDesc}`,
      `- **List columns:** ${listCols}`,
    );
    if ((section.quickFilters || []).length) {
      const f = section.quickFilters
        .map((q) => {
          const typePart = q.type ? `, ${esc(q.type)}` : "";
          const colPart = q.column ? ` (${esc(q.column)}${typePart})` : "";
          return `\`${esc(q.name)}\`${colPart}`;
        })
        .join(" · ");
      L.push(`- **Quick filters:** ${f} — rebuild as the Freedom list-page filter / quick-filter controls (do NOT drop the registry filter bar)`);
    }
    if ((section.sectionActions || []).length) {
      const acts = section.sectionActions.map((a) => `\`${esc(a)}\``).join(" · ");
      L.push(`- **Section actions:** ${acts} — migrate as Freedom list-page actions`);
    }
    if (section.processLaunch) L.push(`- **Section process:** ⚠ launches ${(section.processNames || []).map(esc).join(", ") || "a process"} — wire as a list-page run-process action`);
    L.push("");
  }

  // ---- Form page — its Layout / Logic / Confirm nested under one page heading (the Main-scope form row) ----
  L.push(
    `### ${entity} form page`,
    "#### Layout",
    "| Region | Element | Type | Source | Rule | Additional |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const region of order) {
    const items = byRegion.get(region).sort((a, b) => a.sort - b.sort || a.i - b.i);
    for (const it of items) L.push(`| ${region} | ${it.cells.join(" | ")} |`);
  }
  L.push("");

  // ---- Logic (behaviour): declarative business rules FIRST, then entity filters, handlers, process launch ----
  const logic = [];
  // Declarative page business rules — this is where a reader expects the business rules (not beside the fields).
  // One row each: field · condition · effect (+ inverse) · target. GUID conditions are flagged for on-stand
  // resolution in the ⚠ Confirm list (C2), so the condition here stays a readable attribute name.
  const condAttrs = (conds) => [...new Set((conds || []).map((c) => c?.left?.attribute || c?.left?.path || c?.leftExpression?.attribute || c?.attribute).filter(Boolean))];
  for (const r of cs.pageBusinessRules || []) {
    const attrs = condAttrs(r.conditions);
    const condTrigger = (r.conditions || []).length ? "conditional" : "always";
    const trigger = attrs.length ? `when ${attrs.map(esc).join(" / ")}` : condTrigger;
    const effect = humanizeAction(r.action) + (r.inverseAction ? ` (else ${humanizeAction(r.inverseAction)})` : "");
    logic.push([esc(r.element), trigger, effect, "page business rule"]);
  }
  // entity filters — DEDUP by target attribute (a column can carry >1 FILTRATION rule); one row per attr.
  const filtBy = {};
  for (const r of cs.entityBusinessRules || []) {
    filtBy[r.targetAttribute] = filtBy[r.targetAttribute] || [];
    filtBy[r.targetAttribute].push(r);
  }
  for (const [attr, rs] of Object.entries(filtBy)) {
    const unresolved = rs.filter((r) => !r.complete).length;
    const singleEffc = rs[0].complete ? "static filter" : "⚠ dynamic — resolve value";
    const unresolvedNote = unresolved ? ` (${unresolved} ⚠ dynamic — resolve value)` : "";
    const effc = rs.length === 1 ? singleEffc : `${rs.length} filters${unresolvedNote}`;
    logic.push([`Filter · ${esc(attr)}`, `${esc(attr)} lookup`, effc, "entity business rule / lookup filter"]);
  }
  // handlers — fold the set<X>Info / clear<X>Info helpers into their on<X>Change trigger row (not separate
  // rows), so the Logic table shows the meaningful behaviours, not every internal helper.
  const stubs = cs.handlerStubs || [];
  const helperBase = (m) => { const mt = /^(?:set|clear)(.+?)Info$/.exec(m); return mt ? mt[1] : null; };
  const triggerBase = (m) => { const mt = /^on(.+?)Chang/.exec(m); return mt ? mt[1] : null; };
  const helpersByBase = {};
  for (const h of stubs) {
    const b = helperBase(h.sourceMethod);
    if (b) { helpersByBase[b] = helpersByBase[b] || []; helpersByBase[b].push(h.sourceMethod); }
  }
  for (const h of stubs) {
    if (helperBase(h.sourceMethod)) continue; // shown folded into its trigger row
    const b = triggerBase(h.sourceMethod);
    const extra = b && helpersByBase[b] ? ` (+ ${helpersByBase[b].map(esc).join(", ")})` : ""; // esc each helper name at the sink — a method name from an untrusted body could carry a pipe/backtick (Major)
    logic.push([esc(h.sourceMethod), esc(triggerOf(h.sourceMethod)), `imperative (${esc(h.category)})${extra} — review`, "request handler / converter / virtual attr"]);
  }
  if ((cs.needsDecision || []).some((n) => n.kind === "process-launch")) {
    const pn = cs.needsDecision.find((n) => n.kind === "process-launch")?.item;
    logic.push(["Run process", "Run process action", `launch ${esc(pn || "process")}`, pn ? "⚠ verify process name/binding" : "⚠ which process — resolve on-stand via `ProcessInModules` (section SysModule) → `VwSysProcess` by Id"]);
  }
  if (logic.length) {
    L.push(
      "#### Logic",
      "| Behaviour | Trigger | Effect | Freedom target |",
      "| --- | --- | --- | --- |",
    );
    for (const row of logic) L.push(`| ${row.join(" | ")} |`);
    L.push("");
  }

  // ---- Confirm before I build (the ⚠ worklist) — the agent appends discovery risks/gaps here ----
  // Only the GENUINE open decisions. Kinds already surfaced in Layout (standard-feature / widget /
  // card-action), in Logic (method / process-launch) or in the Child-pages table (detail-editpage) are
  // NOT re-listed here — that duplication is exactly the noise the plan structure was meant to remove.
  const SHOWN_ELSEWHERE = new Set(["process-launch", "standard-feature", "widget", "card-action", "method", "detail-editpage"]);
  const nd = (cs.needsDecision || []).filter((n) => !SHOWN_ELSEWHERE.has(n.kind));
  // `reason` is escaped with `esc` (not `strip`): the mapper interpolates raw stand-derived tokens into it
  // (container/field names, captions, bound hints — e.g. `container '${parent}' holds …`), all attacker-chosen
  // on a hostile stand. `strip` alone collapses newlines but leaves `<`/`>`/backtick/`](` live, so a container
  // named `<img onerror=…>` or `[x](javascript:…)` would inject into the plan the agent presents verbatim.
  // `esc` also neutralizes those. Whole-string `esc` (rather than escaping each stand token at its mapper sink)
  // is deliberate: it is omission-proof — no interpolated token can be missed — and the engine-authored parts of
  // every `reason:` are plain prose (audited: none contain `<`/`>`/backtick/`|`/`](` as literal output), so `esc`
  // has nothing engine-authored to mangle. Keep new reasons that way (put any code identifier or angle-bracketed
  // token in `item`, which is likewise `esc`d) so this stays true.
  const confirm = nd.map((d) => `- **[${esc(d.kind)}]** ${esc(d.item)} — ${esc(d.reason)}`);
  // C2 — business-rule conditions often compare against lookup-record GUIDs (Stage/Source values); the spec
  // shows "required (conditional)" but the raw GUID is unreadable. Prompt resolving them to names on-stand.
  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (GUID.test(JSON.stringify(cs.pageBusinessRules || [])) || GUID.test(JSON.stringify(cs.entityBusinessRules || [])))
    confirm.push("- **[lookup-value]** business-rule conditions compare against lookup-record **GUIDs** (e.g. Stage/Source values) — resolve each GUID to its display name on-stand before building, so the rule reads correctly.");
  if (confirm.length) {
    L.push(`#### ⚠ Confirm before I build (${confirm.length})`);
    for (const line of confirm) L.push(line);
    L.push("");
  }

  return L.join("\n");
}

// renderPlan — the WHOLE plan skeleton the agent presents at the gate: an Overview/What-it-does/Pages
// header with `<FILL: …>` placeholders for the few AGENT decisions (scope, environment, package, approach,
// business sentence, template choices) + the GENERATED design spec. Child edit pages are folded into the
// Pages table as `Rebuild (child)` rows (recursive sub-migrations), not a separate section.
// The agent fills the placeholders and pastes VERBATIM — it cannot drop or restructure the generated
// sections (which is what happened when it hand-authored the plan). Corrections go in an Adjustments note.
export function renderPlan(result, opts = {}) {
  const cs = result.changeSet || {};
  const entity = esc(result.entity || "?"); // stand-derived → esc (superset of strip): one line AND neutralize inline HTML/link/backtick before it feeds the plan title headings
  const fields = (cs.viewConfigDiff || []).filter(isField);
  const childs = result.childPages || [];
  // planMeta (manifest.planMeta) supplies the few AGENT decisions so the engine can render a COMPLETE plan and
  // WRITE it (CLI --out) — the agent presents the written file instead of hand-pasting/editing the tables. Any
  // value not supplied falls back to its `<FILL: …>` placeholder (resolve by adding it to planMeta and re-running).
  const pm = opts.planMeta || {};
  // planMeta + entity are STAND/USER-derived and land in the plan the agent presents "verbatim". Sanitize every
  // filled value (esc → single inert line, pipe-escaped) so a value like `X\n## INJECTED` cannot inject a new
  // heading/row into the plan. The `<FILL: …>` placeholder is a literal and needs no escaping.
  const fill = (v, ph) => (v != null && String(v).trim() !== "" ? esc(String(v)) : ph);
  const P = [];
  P.push(`## ${entity} — Classic → Freedom UI`, ""); // entity already esc'd above (esc ⊇ strip)
  // ⛔ HARD GATE banner at the VERY TOP of the plan (RV1/RV2) — first thing the agent (and the user it pastes
  // to) sees, above Overview. A blocked plan is NOT an approvable plan: fix the signals and re-run `--plan`.
  const gate = result.gate || { blocked: false, reasons: [] };
  if (gate.blocked) {
    P.push("> ⛔ **HARD GATE — BLOCKED. This plan is NOT ready to build or approve.** Fix these and re-run `migrate.mjs --plan`:");
    for (const r of gate.reasons) P.push(`> - ${esc(r)}`);
    P.push("");
  }
  // STRUCTURE VALIDATOR banner — the plan is incomplete until every detail/child-page schema is supplied.
  const structure = result.structure || { complete: true, issues: [] };
  if (!structure.complete) {
    P.push("> ⛔ **STRUCTURE INCOMPLETE — this plan is NOT ready.** The engine detected required inputs you have not supplied (detail schemas / child-page mappings). Fetch them, add to the manifest, and re-run `migrate.mjs --plan`:");
    for (const it of structure.issues) P.push(`> - ${esc(it)}`);
    P.push("");
  }
  // planMeta completeness banner — an unfilled Overview/Main-scope value is not an approvable plan (finding 8).
  const planMetaMissing = opts.planMetaMissing || [];
  if (planMetaMissing.length) {
    P.push(`> ⛔ **PLAN INCOMPLETE — required plan values are unfilled:** ${planMetaMissing.map((k) => "`" + k + "`").join(", ")}. Add them to \`manifest.planMeta\` and re-run \`migrate.mjs --plan\` (each shows as a \`<FILL: …>\` below until supplied).`, "");
  }
  // on-stand SIGNALS gate — the ⚠ conditional checks (DCM case / connected processes / printables) must be
  // RESOLVED before approval, not deferred to build. Unresolved → the plan is INCOMPLETE (finding: recurring
  // "check later" miss). The agent runs the existing queries and records manifest.signals.
  const signals = opts.signals || {};
  const signalsMissing = opts.signalsMissing || [];
  if (signalsMissing.length) {
    P.push(`> ⛔ **PLAN INCOMPLETE — on-stand signals not resolved:** ${signalsMissing.map((k) => "`" + k + "`").join(", ")}. Run the checks and add answers to \`manifest.signals\` (each \`{ "resolved": true, "present": <bool>, … }\`), then re-run \`migrate.mjs --plan\`: **dcm** = \`SysSchema ManagerName='DcmSchemaManager'\` for the entity/family; **processes** = \`ProcessInModules\` by the section \`SysModule\` (names via \`VwSysProcess\`); **printables** = \`SysModuleReport\` by \`SysModule\` (\`ShowInSection\`/\`ShowInCard\`). "Checked, none found" is \`present:false\` — a valid resolved answer, NOT a skip.`, "");
  }
  P.push(
    "### Overview",
    `**Scope:** ${fill(pm.scope, "<FILL: single-section | whole-package>")} ·`,
    `**Environment:** ${fill(pm.environment, "<FILL: environment name>")} ·`,
    `**Package:** ${fill(pm.package, "<FILL: owning package(s) + lock state → target package>")}`,
    "",
    `- **Size:** ${fields.length} fields · ${(cs.details || []).length + (cs.standardFeatures || []).length} details/features · ${(cs.pageBusinessRules || []).length} rules · ${(cs.cardActions || []).length} actions`,
    `- **Approach:** ${fill(pm.approach, "<FILL: one sentence — parallel rebuild / reconcile / switch-over; NOT the package/scope>")}`,
    "",
    "### What it does",
    escBareLine(fill(pm.whatItDoes, "<FILL: 1–2 sentences, business language — what it is for and who uses it>")), // bare line → also escape a leading block marker (finding 5)
    "",
  );
  // On-stand signals — the resolved DCM/process/printable answers (or an ⚠ if unresolved). This is the RESULT
  // of the checks the SKILL mandates at plan time; rendering them here makes each a tracked plan item (built or
  // deliberately N/A), not a "check later" the build silently drops.
  const sigLine = (k, label) => {
    const s = signals[k];
    if (!s || s.resolved !== true) return `- **${label}:** ⚠ not resolved — run the on-stand check`;
    if (!s.present) return `- **${label}:** none (checked on-stand → not migrated)`;
    const list = (s.cases || s.items || s.names || []).map((x) => esc(typeof x === "string" ? x : (x?.name || x?.caption) || "")).filter(Boolean).join(", ");
    const presentNote = list ? ` — ${list}` : "";
    return `- **${label}:** present${presentNote} → build it`;
  };
  P.push("### On-stand signals", sigLine("dcm", "DCM case"), sigLine("processes", "Connected processes"), sigLine("printables", "Printables"), "");
  // Main scope = the index of the pages this migration covers; each row is expanded below IN THIS ORDER
  // (list page → form page → child pages) under its own `### … page` / `### Child page mappings` section.
  // Call = Rebuild (no Freedom counterpart — the fully-custom case) OR Update (reconcile) when a Freedom page
  // for this entity ALREADY exists (`planMeta.freedomExists`). Reconcile is an agent step — read the existing
  // page with clio `get-page`, diff the engine's design onto it, apply via `update-page` (never a duplicate);
  // see `./references/existing-freedom-reconcile.md`. Default is Rebuild (safe for the tested custom-section case).
  const mainCall = pm.freedomExists ? "Update (reconcile)" : "Rebuild";
  // A TYPED entity has NO single form deliverable — every record opens a per-type page, so the per-type forms
  // (rows below) ARE the deliverables and the base `<entity> form page` is only their shared parent/seed (not
  // a separate form). A non-typed entity keeps its one form-page row.
  const typed = result.typedPages || [];
  const scopeRows = [`| ${fill(pm.sectionSchema, "<FILL: section schema>")} (list page) | ${fill(pm.listTemplate, "<FILL: Freedom list template>")} | ${mainCall} |`];
  if (!typed.length) scopeRows.push(`| ${esc(entity)} form page | ${fill(pm.formTemplate || opts.template, "<FILL: Freedom form template>")} | ${mainCall} |`);
  for (const t of typed) {
    const typeNote = t.type ? ` — type "${esc(t.type)}"` : "";
    const cls = `${esc(t.schema)}${typeNote} (typed form)`;
    scopeRows.push(`| ${cls} | ${t.bindOnly ? "bind shared form by Type" : "per-type Freedom form"} | ${t.bindOnly ? "Bind (per-type)" : "Rebuild (per-type)"} |`);
  }
  P.push("### Main scope", "| Classic | Freedom target | Call |", "| --- | --- | --- |", ...scopeRows);
  if (pm.freedomExists) P.push("> **Reconcile:** a Freedom page for this entity already exists — do NOT create a duplicate. Read it with `get-page`, apply the design below as a customization delta (added/modified/removed-hidden), and save with `update-page`. Procedure: `./references/existing-freedom-reconcile.md`.");
  // child edit pages belong in Main scope too — each related list's child entity opens its OWN form on
  // add/edit, so it is a page in the migration TREE (a recursive sub-migration), not a side note. The
  // target is a fixed clean value (NOT a free-text FILL — that invited inconsistent status prose); the
  // "does a Freedom form already exist / follow-on" nuance lives in the Child page mappings section below.
  for (const c of childs) {
    // Honest label by resolution state — never assert "Rebuild (child)" for a child we have not resolved:
    //   mapped, or a real edit page is named -> Rebuild (child); verified-none / view-only -> Reuse; else -> ⚠ resolve.
    let target, call, label;
    if (c.spec || (typeof c.editPage === "string" && c.editPage)) {
      target = "Freedom record page"; call = "Rebuild (child)"; label = esc(c.editPage || (c.entity + " form page"));
    } else if (c.editPage === false || c.editable === false) {
      target = "— no separate page (read/attach-only)"; call = "Reuse"; label = esc(c.entity);
    } else {
      target = "⚠ verify — does a Classic `*Page` exist for this child?"; call = "⚠ resolve"; label = esc(c.entity);
    }
    P.push(`| ${label} — opened by detail "${esc(c.via)}"${c.editable === false ? " · view/attach-only" : ""} | ${target} | ${call} |`);
  }
  P.push("");
  if (childs.length) P.push("> **`Rebuild (child)`** = recursive sub-migration (mapping under **Child page mappings** below). **`Reuse`** = read/attach-only related list, no separate child page. **`⚠ resolve`** = not yet verified — check `list-pages` by the CHILD entity before approval (the structure gate blocks until every child is resolved).");
  if (typed.length) P.push(`> ⚠ **Typed entity — ${typed.length} per-type Classic edit page(s):** ${typed.map((t) => "`" + esc(t.schema) + "`").join(", ")}. Each record **Type** opens its OWN Classic page, which takes PRECEDENCE over a general Freedom RelatedPage binding — so "+ New" and open-record route to Classic unless you bind a Freedom form **per Type** (by the Type column). The per-type forms below are the deliverables; source them from \`list-entity-client-schemas\` and fold each via \`manifest.typedPageSchemas\`.`);
  if (typed.length) P.push("", `> The form spec immediately below is the **base \`${esc(entity)}\` layout** — the SHARED parent every per-type form inherits. It is NOT a separate deliverable; the actual forms to build are the per-type ones under **Typed page mappings**.`);
  P.push("", renderDesignSpec(result, { ...opts, embedded: true }), "");
  // Typed page mappings — the FULL per-type form spec for each typed page (folded from manifest.typedPageSchemas).
  // A typed entity's real form deliverables. Unresolved (no bundle, not bindOnly) → a ⚠ the structure gate blocks on.
  if (typed.length) {
    P.push("### Typed page mappings", "");
    for (const t of typed) {
      const typeNote = t.type ? ` — type "${esc(t.type)}"` : "";
      P.push(`#### Typed form: ${esc(t.schema)}${typeNote}`);
      if (t.bindOnly) {
        P.push(`> **Bind-only** — layout identical to the base; no separate form. Bind the shared Freedom form for this Type (by the Type column).`);
      } else if (t.spec) {
        P.push("", demoteHeadings(t.spec, 2));
      } else if (t.specError) {
        P.push(`> ⚠ typed-page bundle supplied but failed to parse: ${esc(t.specError)} — fix the bundle and re-run.`);
      } else {
        P.push(`> ⚠ **NOT resolved — this typed form has no design spec.** Assemble its bundle (\`get-classic-migration-bundle --schema-name ${esc(t.schema)}\`) into \`manifest.typedPageSchemas["${esc(t.schema)}"]\` so the engine folds its FULL per-type layout here, OR mark the \`typedPages\` entry \`{ "bindOnly": true }\` if its layout is identical to the base. **"Map at build" is not allowed** — the structure gate blocks the plan until every typed form is resolved.`);
      }
      P.push("");
    }
  }
  // Add mini-page mapping — the FULL layout of the section's quick-add mini page (folded from
  // manifest.miniPageSchemas). Rendered when resolved; an unfolded/unverified one is flagged in List page + gate.
  if (result.miniPage && (result.miniPage.spec || result.miniPage.specError)) {
    P.push("### Add mini-page mapping", "", `#### Mini page: ${esc(result.miniPage.schema)}`);
    if (result.miniPage.spec) P.push("", demoteHeadings(result.miniPage.spec, 2));
    else P.push(`> ⚠ mini-page bundle supplied but failed to parse: ${esc(result.miniPage.specError)} — fix and re-run.`);
    P.push("");
  }
  // Child page mappings — one real design spec per related-list child page (the mapping the listing lacked).
  // Generated inline when the agent supplied the child's schema (childPageSchemas); otherwise a FILL slot
  // that keeps the mapping a REQUIRED, visible deliverable rather than a table row the agent treats as done.
  if (childs.length) {
    P.push("### Child page mappings", "");
    // Recursive: embed each child's spec AND its own resolved children (grandchildren, …) nested one heading
    // level deeper. The engine writes the FULL tree — it does not stop at depth 1 and tell the agent to map
    // the rest by hand (that contradicted "the engine writes the whole plan"). An unresolved node at any depth
    // still renders its ⚠/FILL slot, so nothing is silently dropped. `lvl` = the `Child page:` heading level.
    const renderChild = (c, lvl) => {
      const h = "#".repeat(Math.min(6, lvl));
      const head = `${esc(c.entity)} — opened by detail "${esc(c.via)}"${c.editable === false ? " · view/attach-only" : ""}`;
      P.push(`${h} Child page: ${head}`);
      if (c.spec) {
        P.push("", demoteHeadings(c.spec, lvl - 2)); // nest the child's own headings under this level
        for (const g of (c.childPages || [])) renderChild(g, lvl + 1); // EMBED grandchildren recursively
      } else if (c.specError) {
        P.push(`> ⚠ child schema supplied but failed to parse: ${esc(c.specError)} — fix the child manifest and re-run.`);
      } else if (typeof c.editPage === "string" && c.editPage) {
        // a real Classic edit page is named (from getEditPageName) → mapping is MANDATORY.
        P.push(`> ⚠ **\`${esc(c.editPage)}\` is a REAL Classic edit page — you MUST fetch it and map it here** (add it to \`childPageSchemas\` / run \`migrate.mjs --plan\` on it, then paste its design spec). NOT optional: **"view-only", "native", and "out of scope" are NOT skip reasons when the page exists.** There is no "out of scope" in this migration — limiting scope is the USER's decision to request, never yours to self-declare.`);
      } else if (c.editPage === false) {
        // agent verified on-stand (recorded "editPage": false in the manifest): no separate Classic *Page.
        P.push(`> **Verified: no separate child page.** \`list-pages\` by entity \`${esc(c.entity)}\` found no Classic \`*Page\` (recorded in the manifest) → a read-only / attach-only related list; nothing to migrate here.`);
      } else if (c.editable === false) {
        // classic detail hides add-record → view/attach-only; no child edit page to map.
        P.push(`> **Read/attach-only** related list (the classic detail hides add-record) → no child edit page to map. Confirm no \`*Page\` exists for \`${esc(c.entity)}\`; if one does, add it and re-run.`);
      } else {
        // UNVERIFIED — the structure gate blocks the plan until this is resolved one way or the other.
        P.push(`> **\`<FILL: verify child page>\`** — NOT yet verified. Run \`list-pages\` **by entity \`${esc(c.entity)}\`**: if a \`*Page\` exists, add it to \`childPageSchemas\` and re-run; if none exists, record \`"editPage": false\` on this detail and re-run. "out of scope" is never a valid self-declared skip.`);
      }
      P.push("");
    };
    for (const c of childs) renderChild(c, 4);
  }
  P.push("> **Supply the plan values via `manifest.planMeta` and re-run (that fills the `<FILL: …>` above), then present this VERBATIM** — ideally the file written by `--out`, not a hand-paste. Any remaining `<FILL: …>` means that planMeta value is still missing. Corrections/enrichments go in an *Adjustments* list at the very end — do NOT edit, reorder, or drop the generated tables/sections (Main scope · List page · form-page Layout/Logic/Confirm · Child page mappings).");
  return P.join("\n");
}
