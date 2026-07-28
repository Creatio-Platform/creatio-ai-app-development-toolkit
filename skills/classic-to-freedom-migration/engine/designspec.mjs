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
  const capResolved = (raw) => resources[resourceKey(raw)] != null; // did the caption resolve to REAL text (vs the raw key)?
  const label = (o) => esc(o.values?.caption ? capText(o.values.caption) : o.name);
  // a profile island container often has NO caption (it is a visual grouping, e.g. `ContactContainer`) but is
  // a DISTINCT `crt.GridContainer` — keep the islands apart in the Region by falling back to its own name
  // (minus the `Container` suffix) when no captioned group is found, so the 2 islands don't collapse to one flat
  // "Side profile" (which dropped the island distinction from the Layout table).
  const islandLabel = (name) => esc(String(name).replace(/Container$/, ""));
  return (parentName) => {
    // `group` = the nearest CAPTIONED ancestor container (a real field group like "Sender" / "Additional
    // delivery info") between the field and its tab/profile. Surfacing it keeps the Region column showing the
    // GROUP, not just the flat tab — grouping was being lost (fields read as one flat list under the tab).
    // `prev` tracks the container we came FROM (the child of the profile/tab we resolve into) so an uncaptioned
    // island still resolves to its own container identity.
    let p = parentName, hops = 0, group = null, prev = null;
    while (p && hops++ < 64) {
      if (p === "SideAreaProfileContainer") {
        const island = group || (prev ? islandLabel(prev) : null);
        return island ? `Side profile › ${island}` : "Side profile";
      }
      if (p === "HeaderContainer") return "Header";
      // (removed a legacy hardcode that mapped `GeneralInfoTabContainer` → "⚠ fallback (unresolved)" — it dates
      // from when that container was a catch-all with no real tab. The mapper now emits it as a proper `crt.Tab`
      // (isTab, caption "General information"), so the normal crt.Tab climb below resolves it to "Tab · General
      // information". The hardcode short-circuited BEFORE that check and falsely flagged ~20 real General-info
      // fields as unresolved on every page that has this tab.)
      const o = byName.get(p);
      if (!o) return esc(p);
      if (o.values?.type === "crt.Tab") return group ? `Tab · ${label(o)} › ${group}` : `Tab · ${label(o)}`;
      // nearest captioned group wins — show it when the caption RESOLVES to real text OR is still a human-readable
      // key; drop only an auto-generated NOISE key (a hex-hash run, e.g. `Tab67ea6463TabLabelGroupc1bf3d46GroupCaption`),
      // which is the ugly leak the Region should not carry (still surfaced as a [group-caption] ⚠ to resolve).
      if (group == null && o.values?.caption) {
        const t = capText(o.values.caption);
        if (capResolved(o.values.caption) || !/[0-9a-f]{6}/i.test(t)) group = esc(t);
      }
      prev = p;
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
// A detail's custom ADD/EDIT mechanism (from migrate.mjs detection) → a short ⚠ suffix so the rebuild reproduces
// the real add flow (lookup / service / inline grid) rather than a plain related list.
const addModeText = (am) => {
  if (!am) return "";
  const p = [];
  if (am.lookup) p.push("add via lookup (pick existing)");
  if (am.service) p.push(`service \`${esc(am.service)}${am.method ? "." + esc(am.method) : ""}\``);
  if (am.editableGrid) { const cols = (am.editableColumns || []).length ? ` (${am.editableColumns.map(esc).join("/")})` : ""; p.push(`inline-editable${cols}`); }
  if (!p.length && am.openCardOverridden) p.push("custom add flow");
  return p.length ? ` — ⚠ ${p.join(", ")}; reproduce with a custom Freedom add handler (verify any service is deployed)` : "";
};

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
    // ENG-93929 — an editable-grid detail renders as an EDITABLE list: flag the enable directive + which
    // columns are inline-editable, so the build reproduces the inline edit instead of a read-only list.
    const cols = d.columns?.length ? `cols: ${d.columns.map(esc).join(" · ")}` : "";
    let editNote = "";
    if (d.editable) {
      const editCols = (d.editable.columns || []).length ? ` — editable: ${d.editable.columns.map(esc).join(" · ")}` : "";
      editNote = `⚠ INLINE-EDITABLE (${esc(d.editable.enableVia)})${editCols}`;
    }
    const add = [cols, editNote].filter(Boolean).join(" · ") || DASH;
    rows.push({ region: d.tab ? tabRegion(d.tab) : "⚠ unplaced", sort: 1, cells: [esc(d.caption || d.detailSchema || d.entity), d.editable ? "Editable list" : "Related list", src, DASH, add] });
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
    // The case progress bar is SHIPPED by `PageWithTabsAndProgressBarTemplate` (the template the plan recommends
    // for a DCM page) — so it is template-PROVIDED + re-bound, NOT "ADD — not in the default template" (that
    // stale wording contradicted the recommended template). Next steps IS genuinely added (a new tab). Keep the
    // generic ADD wording for any other placed widget.
    if (w.placement === "page-top") source = "provided by `PageWithTabsAndProgressBarTemplate` (ships the bar placed) — build the form on that template + RE-BIND to the case; hand-adding to `MainContainer` is the fallback";
    else if (w.placement === "tab-next-to-feed") source = "⚠ ADD — a new tab (Next steps) beside Feed/Attachments (not template-provided)";
    else if (w.placement) source = "⚠ ADD — not in the default Freedom template";
    else if (w.note) source = "⚠ confirm on-stand — see note"; // specific guidance (e.g. NBO) — do NOT assert template-provided
    else if (w.base) source = "template context — provided by the Freedom template";
    else source = "native — confirm on-stand";
    rows.push({ region, sort: 2, cells: [esc(w.widget), "Component", source, DASH, w.note ? esc(w.note) : DASH] });
  }
  // Print / Run-process card actions are CONDITIONAL on stand data (are there reports? is a process connected?).
  // The engine no longer hands the agent a wall of "go check on-stand" SQL on every plan: the SKILL resolves
  // these signals at plan time (the signals gate blocks the top-level plan until they are), so when the answer
  // is KNOWN the row states it CONCRETELY (present → wire these; none → NOT migrated). The full how-to-check
  // instruction is kept ONLY as the fallback for the still-unresolved case (e.g. a child page not gated on it).
  const sigOf = (k) => result.signals?.[k];
  const sigList = (s) => (s?.cases || s?.items || s?.names || []).map((x) => esc(typeof x === "string" ? x : (x && (x.name || x.caption)) || "")).filter(Boolean).join(", ");
  const PROCESS_HOWTO = "⚠ Migrate ONLY if a process is connected to this section. Check on-stand with `odata-read` (the param is `filters`, NOT `filter`): `ProcessInModules` `filters {all:[{field:\"SysModule/Id\",op:\"eq\",value:<sysModuleId>}]}` (a lookup → filter via the `SysModule/Id` nav, never a `SysModuleId` field), select `[\"SysSchemaUId\",\"Position\"]` — that is the section's \"Run process\" menu (Section Wizard → Business Processes). ProcessInModules has NO name column: resolve each `SysSchemaUId` to the process name via `odata-read VwSysProcess` `filters {all:[{field:\"Id\",op:\"eq\",value:<SysSchemaUId>}]}`, select `[\"Caption\",\"Name\"]` (Caption = the human menu label; a process's `Id` == its `UId`, so filter by `Id` — `UId eq <guid>` FAILS with an Edm.Guid-vs-String error; no `IsMaxVersion` filter needed, `Id` is unique). None connected ⇒ the button is NOT migrated; if some are, name each in the plan. (No `SysProcessId`/`Caption` exists on ProcessInModules; `SysProcessEntity`/`VwSysProcessEntity` = runtime process-instance↔record links, NOT this.)";
  const PRINT_HOWTO = "⚠ Migrate ONLY if printables/reports exist for this section. Check on-stand: read `SysModuleReport` filtered by the section's `SysModule` (nav `SysModule/Id eq <id>`) + `ShowInSection eq true` (section Print menu) or `ShowInCard eq true` (record card); each row's `Caption`/`Type`/`SysReportSchemaUId`|`FileName` is the printable. None ⇒ the button is NOT migrated; if some exist, wire them as the Freedom print action.";
  for (const a of cs.cardActions || []) {
    const name = a.replace(/Button$/, "");
    let type = "Action", note = DASH;
    if (/process/i.test(name)) {
      const sp = sigOf("processes");
      if (opts.isChildPage) note = "Child edit page — no section-level Run-process menu; migrate only if THIS child page's own ACTIONS had a run-process (confirm), else not applicable.";
      else if (sp?.resolved === true) {
        if (sp.present) { const namePart = sigList(sp) ? `: ${sigList(sp)}` : " (name unresolved — resolve via `VwSysProcess` by Id)"; note = `Connected process${namePart} → wire as a Freedom **Run process** card action.`; }
        else note = "**Not migrated** — no process connected to this section (checked `ProcessInModules` on-stand).";
      }
      else note = PROCESS_HOWTO;
    } else if (/print/i.test(name)) {
      const spr = sigOf("printables");
      if (opts.isChildPage) note = "Child edit page — no section-level Print menu; migrate only if THIS child page's own ACTIONS had a printable (confirm), else not applicable.";
      else if (spr?.resolved === true) {
        if (spr.present) { const namePart = sigList(spr) ? `: ${sigList(spr)}` : "s present"; note = `Printable${namePart} → wire as the Freedom **print** action.`; }
        else note = "**Not migrated** — no printables/reports for this section (checked `SysModuleReport` on-stand).";
      }
      else note = PRINT_HOWTO;
    } else if (name === "ViewOptions") {
      type = "—"; note = "Not migrated — standard page view-options control (native Freedom capability), not a bespoke action.";
    } else if (name === "Tag") {
      type = "—"; note = "Provided by the default Freedom template (tags) — nothing to migrate.";
    }
    rows.push({ region: "Card actions", sort: 3, cells: [esc(name), type, DASH, DASH, note] });
  }
  // RV12 — image/photo components (mapper emits them in cs.images) render as a NORMAL Layout row, placed in the
  // region their parent resolves to. A Freedom image field binds to the image column declaratively — it is a
  // plain mapping, not custom imperative wiring, so the row carries no "⚠ wire getSrc/onChange" scare (that was
  // classic-generator vocabulary that read as an assumption on every migration). The classic generator is kept
  // in Source only as provenance.
  for (const im of cs.images || []) {
    const src = im.generator ? `generator ${esc(im.generator)}` : "image column";
    rows.push({ region: im.parent ? regionOf(im.parent) : "⚠ unplaced", sort: 0, cells: [esc(im.classic), "Image", src, DASH, "→ Freedom image component (bind to the image column)"] });
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
  // `formOnly` skips this List-page block (renderPlan renders the List page via a separate listPageOnly call
  // so the add-mini-page mapping can sit RIGHT AFTER it, then renders the form via formOnly).
  // This is a SECTION migration when the section chain was folded, OR a mini page / section schema is named even
  // though the chain wasn't gathered (e.g. the bundle returned `sectionLayerCount: 0` because it derives the
  // section name from the entity, not the page prefix — clio PR #937). In that gathered-nothing case the List
  // page block must still render (with a ⚠) rather than silently vanish — a section migration ALWAYS has a list
  // page, and dropping the whole block hides that the columns/filters/actions were never analyzed.
  // A MINI page is NOT a section — it has no list page. When rendering the mini page's OWN spec (isMiniPage),
  // suppress the List-page block entirely (rendering one gave the mini fold a spurious "##### List page" with a
  // misleading "no add-record mini page" line — a mini page inside a mini page).
  const isSectionMigration = (section || result.miniPage || opts.planMeta?.sectionSchema) && !opts.isMiniPage;
  if (isSectionMigration && !opts.formOnly) {
    L.push("### List page");
    if (!section) {
      L.push("- ⚠ **Section schema not gathered** — the classic `*Section` chain is not in `manifest.section`, so the list page's **list columns / quick filters / section actions were NOT analyzed**. `get-classic-page-sources` derives the section name from the entity (`<entity>Section[V2]`); if the real section is named off the page prefix (e.g. `Applicant1Page` → `Applicant1Section`) it returns `sectionLayerCount: 0`. Bundle the section schema by name into `manifest.section` and re-run.");
    }
    // Add-record mini page — resolved from list-entity-client-schemas (result.miniPage), NOT assumed from the
    // section body (which registered none even when a per-type mini page existed → a false "no mini page").
    const mp = result.miniPage;
    let addRecordDesc;
    if (mp?.spec) addRecordDesc = `via mini page \`${esc(mp.schema)}\` — quick-add form; its full layout is under **Add mini-page mapping** below`;
    else if (mp?.cyclic) addRecordDesc = `via mini page \`${esc(mp.schema)}\` — ↩ already mapped above (cycle); its spec appears higher in this plan`;
    else if (mp && (mp.unfolded || mp.specError)) addRecordDesc = `⚠ via mini page \`${esc(mp.schema)}\` — NOT folded; supply its bundle in \`manifest.miniPageSchemas\` so its layout is mapped here`;
    else if (result.miniPageNone) addRecordDesc = "full edit page — verified on-stand: no add-record mini page";
    else if (!result.miniPageVerified) addRecordDesc = "⚠ NOT verified — check `list-entity-client-schemas` (`miniPageSchema` with `miniPageModes` = add) and record `manifest.addRecordMiniPage` ({schema} or false); do NOT assume there is none";
    else addRecordDesc = "full edit page (no add-record mini page)";
    L.push(`- **Add record:** ${addRecordDesc}`);
    // list columns / filters / actions come from the section fold — only render them when the section was gathered
    // (guarded so an empty section doesn't throw and doesn't print a misleading "no filters").
    if (section) {
      const listCols = (section.listColumns || []).length ? section.listColumns.map(esc).join(" · ") : "⚠ not in the schema (profile data) — read the section's saved columns or confirm the list-page columns";
      L.push(`- **List columns:** ${listCols}`);
      if ((section.quickFilters || []).length) {
        const f = section.quickFilters
          .map((q) => {
            let s = `\`${esc(q.name)}\``;
            if (q.column) { const typePart = q.type ? `, ${esc(q.type)}` : ""; s += ` (${esc(q.column)}${typePart})`; }
            return s;
          })
          .join(" · ");
        L.push(`- **Quick filters:** ${f} — rebuild as the Freedom list-page filter / quick-filter controls (do NOT drop the registry filter bar)`);
      }
      if ((section.sectionActions || []).length) {
        const acts = section.sectionActions.map((a) => `\`${esc(a)}\``).join(" · ");
        L.push(`- **Section actions:** ${acts} — migrate as Freedom list-page actions`);
      }
      if (section.processLaunch) L.push(`- **Section process:** ⚠ launches ${(section.processNames || []).map(esc).join(", ") || "a process"} — wire as a list-page run-process action`);
    }
    L.push("");
  }

  // TYPED entity: the base fold is NOT a deliverable — it only supplies the List page (section concerns) and
  // shared context. Its own form Layout/Logic/Confirm must NOT render (it's empty/misleading: 0 rules etc.,
  // while the real fields+rules live on the per-type forms). Stop here; the per-type forms render under
  // `### Typed page mappings` in renderPlan. (Only the top-level base render passes listPageOnly; the typed
  // folds themselves render their FULL spec.)
  if (opts.listPageOnly) return L.join("\n");

  // ---- Form page — its Layout / Logic / Confirm nested under one page heading (the Main-scope form row) ----
  // A mini page's form section is titled "Mini page (quick-add)" — NOT "<entity> form page" — so it can't be
  // mistaken for the record page's form section (the two rendered under the SAME "<entity> form page" heading,
  // which read as a duplicated block for the same page).
  L.push(
    opts.isMiniPage ? `### Mini page (quick-add) — \`${entity}\`` : `### ${entity} form page`,
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

  // ---- Base-field overrides — base fields the Freedom template already provides, that a CLIENT schema
  // reconfigured (hid / moved). The parallel-analog build does NOT re-create base fields, so these are CONCRETE
  // changes to APPLY onto the template's existing field — a build instruction, not a ⚠ decision to confirm.
  const bfo = cs.baseFieldOverrides || [];
  if (bfo.length) {
    L.push(
      "#### Base-field overrides (apply onto the template's fields)",
      `> These base fields ship with the Freedom template; the client schema reconfigured them. APPLY each change onto the existing base field — do NOT re-create the field, and do NOT ship the bare template default.`,
      "| Base field | Apply |",
      "| --- | --- |",
    );
    for (const o of bfo) L.push(`| ${esc(o.field)} | ${esc(o.change)} |`);
    L.push("");
  }

  // ---- Child page with FEW fields → recommend a lighter shell. A related-list child that is a small, flat
  // edit form (a handful of fields, no tabs, no nested details) is better opened as an edit MINI PAGE / modal
  // than rebuilt as a full record page — less chrome, faster add/edit inline from the parent list. Surface it as
  // a recommendation on the child's own spec (only for child pages, so the top-level record page is untouched).
  if (opts.isChildPage) {
    const hasTabs = (cs.viewConfigDiff || []).some((o) => o.values?.type === "crt.Tab");
    const nDetails = (cs.details || []).length + (cs.standardFeatures || []).filter((s) => s.uiShape === "list").length;
    if (fields.length && fields.length <= 5 && !hasTabs && !nDetails) {
      L.push(`> **Recommendation — small child form (${fields.length} field${fields.length === 1 ? "" : "s"}, no tabs/details):** consider opening this related-list child as an **edit mini page / modal** (a lightweight add/edit shell) rather than a full record page, or pick a lighter form template. Confirm the desired shell before building.`, "");
    }
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
  // Removals are NOT a worklist item — a removed element is simply out of the final effective scope (the mapper
  // no longer emits `removal` decisions; a fresh Freedom rebuild builds the alive set, so there is nothing to
  // "remove"). Every remaining decision is a genuine open item.
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
    P.push(`> ⛔ **PLAN INCOMPLETE — on-stand signals not resolved:** ${signalsMissing.map((k) => "`" + k + "`").join(", ")}. Run the checks and add answers to \`manifest.signals\` (each \`{ "resolved": true, "present": <bool>, … }\`), then re-run \`migrate.mjs --plan\`. **FIRST resolve the section's \`SysModule.Id\`** (the prerequisite for processes+printables — without it those checks CANNOT run, and a failed check is NOT a "none" answer): \`odata-read SysModule\` \`filters {any:[{field:"Code",op:"contains",value:"<Name>"},{field:"Caption",op:"contains",value:"<Name>"}]}\`, select \`["Id","Caption","Code"]\` — match your section (do NOT filter \`SectionSchemaUId eq <guid>\`: a UId column, it FAILS with Edm.Guid-vs-String; the module \`Code\` is usually the base entity name, e.g. section \`Applicant1Section\` → module Code \`Applicant\`). Then: **dcm** = \`SysSchema ManagerName='DcmSchemaManager'\` for the entity/family; **processes** = \`odata-read ProcessInModules\` with **\`filters\`** (NOT \`filter\`) \`{all:[{field:"SysModule/Id",op:"eq",value:<sysModuleId>}]}\` (a lookup → filter via the \`SysModule/Id\` nav, never a \`SysModuleId\` field), select \`["SysSchemaUId","Position"]\` — then resolve each \`SysSchemaUId\` to the process name via \`odata-read VwSysProcess\` \`filters {all:[{field:"Id",op:"eq",value:<SysSchemaUId>}]}\`, select \`["Caption","Name"]\` (a process's \`Id\` == its \`UId\`, so filter by **\`Id\`** — \`UId eq <guid>\` FAILS with an Edm.Guid-vs-String error, and \`Id\` is the field the helper auto-unquotes; NO \`IsMaxVersion\` filter — \`Id\` is unique and returns the one row; ProcessInModules itself has NO name/Caption column); **printables** = \`SysModuleReport\` by \`SysModule\` (\`ShowInSection\`/\`ShowInCard\`). "Checked, none found" is \`present:false\` — a valid resolved answer, NOT a skip.`, "");
  }
  // A TYPED entity has NO single form deliverable — each per-type page is its own form (fields/rules/details
  // live THERE, in the mappings below). The base fold's counts (often 8 fields · 0 rules) describe only the
  // shared parent, so reporting them as "Size" mis-describes the job. Summarize by typed-form count instead.
  const typed = result.typedPages || [];
  // A BIND-ONLY typed entry ("layout identical to the base") REUSES the shared base form — so that base form IS a
  // real deliverable and MUST render (else the plan says "bind the shared form" but no shared-form spec exists,
  // which is exactly how a real Lead migration lost its whole 43-field main form). The base is suppressed ONLY
  // when EVERY type has its OWN fold. `someBindOnly` gates that below.
  const someBindOnly = typed.some((t) => t.bindOnly);
  let sizeLine;
  if (typed.length) {
    const plural = typed.length === 1 ? "" : "s";
    sizeLine = `- **Size:** ${typed.length} typed form${plural} (per-type fields, rules and details are in **Typed page mappings** below) · ${(cs.details || []).length + (cs.standardFeatures || []).length} shared details/features · ${(cs.cardActions || []).length} actions`;
  } else sizeLine = `- **Size:** ${fields.length} fields · ${(cs.details || []).length + (cs.standardFeatures || []).length} details/features · ${(cs.pageBusinessRules || []).length} rules · ${(cs.cardActions || []).length} actions`;
  P.push(
    "### Overview",
    `**Scope:** ${fill(pm.scope, "<FILL: single-section | whole-package>")} ·`,
    `**Environment:** ${fill(pm.environment, "<FILL: environment name>")} ·`,
    `**Package:** ${fill(pm.package, "<FILL: owning package(s) + lock state → target package>")}`,
    "",
    sizeLine,
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
    if (s?.resolved !== true) return `- **${label}:** ⚠ not resolved — run the on-stand check`;
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
  // a separate form). A non-typed entity keeps its one form-page row. (`typed` computed above for the Size line.)
  // The Freedom form template every per-type form uses (from planMeta.formTemplate / manifest.template). Shown
  // on each typed row so the template mandate is not lost (it used to live only on the suppressed base row).
  const formTpl = pm.formTemplate || opts.template || null;
  const scopeRows = [`| ${fill(pm.sectionSchema, "<FILL: section schema>")} (list page) | ${fill(pm.listTemplate, "<FILL: Freedom list template>")} | ${mainCall} |`];
  if (!typed.length) scopeRows.push(`| ${esc(entity)} form page | ${fill(pm.formTemplate || opts.template, "<FILL: Freedom form template>")} | ${mainCall} |`);
  else if (someBindOnly) scopeRows.push(`| ${esc(entity)} shared form (base) | ${fill(pm.formTemplate || opts.template, "<FILL: Freedom form template>")} | ${mainCall} |`);
  for (const t of typed) {
    const typeSuffix = t.type ? ` — type "${esc(t.type)}"` : "";
    const cls = `${esc(t.schema)}${typeSuffix} (typed form)`;
    let tgt;
    if (t.bindOnly) tgt = "bind shared form by Type";
    else tgt = formTpl ? esc(formTpl) : "<FILL: Freedom form template>";
    scopeRows.push(`| ${cls} | ${tgt} | ${t.bindOnly ? "Bind (per-type)" : "Rebuild (per-type)"} |`);
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
  // DCM case present (resolved on-stand) → the form page MUST ship a stage progress bar. The progress bar is NOT
  // in the plain Freedom templates, so the template choice is steered to `PageWithTabsAndProgressBarTemplate`
  // (ships the bar + top island); hand-adding `crt.EntityStageProgressBar` into a plain template's MainContainer
  // is the FALLBACK. This steer applies to BOTH typed and NON-typed pages (it used to be typed-only, so a
  // non-typed DCM page silently kept whatever plain form template the agent picked).
  const dcmPresent = result.signals?.dcm?.resolved === true && !!result.signals.dcm.present;
  const usesProgressBar = formTpl && /ProgressBar/i.test(formTpl);
  if (typed.length) {
    const tplBase = formTpl ? "`" + esc(formTpl) + "`" : "the chosen form template";
    const dcmBit = dcmPresent ? " — a DCM case is present, so use **`PageWithTabsAndProgressBarTemplate`** (it ships the progress bar + the top profile island) and RE-BIND the page to the entity by Type" : "";
    let sharedBit;
    if (someBindOnly) sharedBit = `The **shared base \`${esc(entity)}\` form IS rendered below** ("Shared form (base)") because ${typed.filter((t) => t.bindOnly).length} type(s) are bind-only and reuse it; own-fold types (if any) render under Typed page mappings.`;
    else sharedBit = `The base \`${esc(entity)}\` form layout is NOT shown as a separate mapping (fields are per-type below); the SHARED details/tabs are listed once under **Shared across all typed forms**.`;
    P.push(
      `> ⚠ **Typed entity — ${typed.length} per-type Classic edit page(s):** ${typed.map((t) => "`" + esc(t.schema) + "`").join(", ")}. Each record **Type** opens its OWN Classic page, which takes PRECEDENCE over a general Freedom RelatedPage binding — so "+ New" and open-record route to Classic unless you bind a Freedom form **per Type** (by the Type column). The per-type forms below are the deliverables; source them from \`list-entity-client-schemas\` and fold each via \`manifest.typedPageSchemas\`.`,
      `> **Template:** build every per-type form on ${tplBase}${dcmBit}. ${sharedBit}`,
    );
  } else if (dcmPresent) {
    const tplWarn = formTpl && !usesProgressBar ? ` ⚠ The selected form template \`${esc(formTpl)}\` has no progress bar — reconsider it against the DCM case (or plan the MainContainer fallback explicitly).` : "";
    P.push(`> **Template — DCM case present:** the form page must ship a stage **progress bar**. Build it on **\`PageWithTabsAndProgressBarTemplate\`** (it ships the progress bar + the top profile island) and RE-BIND the page to the entity; hand-adding \`crt.EntityStageProgressBar\` into a plain template's MainContainer is the FALLBACK.${tplWarn}`);
  }
  // LIST PAGE — always rendered list-page-only, so the Add mini-page mapping can sit RIGHT AFTER it (the mini
  // page is the list's quick-add). The form spec (non-typed) / per-type mappings (typed) come afterwards.
  P.push("", renderDesignSpec(result, { ...opts, embedded: true, listPageOnly: true }), "");
  // ADD MINI-PAGE MAPPING — immediately after the List page block (its natural place: the list's quick-add).
  if (result.miniPage && (result.miniPage.spec || result.miniPage.specError)) {
    P.push("### Add mini-page mapping", "", `#### Mini page: ${esc(result.miniPage.schema)}`);
    if (result.miniPage.spec) P.push("", demoteHeadings(result.miniPage.spec, 2));
    else P.push(`> ⚠ mini-page bundle supplied but failed to parse: ${esc(result.miniPage.specError)} — fix and re-run.`);
    P.push("");
  }
  if (!typed.length) {
    // NON-TYPED — the single form spec (Layout/Logic/Confirm); the List page was already rendered above.
    P.push("", renderDesignSpec(result, { ...opts, embedded: true, formOnly: true }), "");
  } else {
    if (someBindOnly) {
      // ≥1 BIND-ONLY type reuses the shared base form → render its FULL spec (Layout/Logic/Confirm). Its Layout
      // already carries the shared details/features, so the separate "Shared across all typed forms" list is NOT
      // repeated. (Without this the base form was suppressed and bind-only types pointed at a non-existent form.)
      P.push("### Shared form (base) — bind-only type(s) bind to this by Type", "",
        renderDesignSpec(result, { ...opts, embedded: true, formOnly: true }), "");
    } else {
      // ALL types own-fold — the base is NOT a deliverable; its details/features are inherited by EVERY per-type
      // form (History tab lists, Approvals, Attachments, …). List them ONCE here — not per type, not as a base
      // field mapping. Each per-type section below adds only that type's OWN content.
      const shFeatures = cs.standardFeatures || [], shDetails = cs.details || [];
      if (shFeatures.length || shDetails.length) {
        P.push("### Shared across all typed forms (inherited from the base form)", "",
          `> On the base \`${esc(entity)}\` form and therefore on EVERY per-type form — build these ONCE on the shared base (the per-type sections below add only each type's own fields/groups/details):`);
        for (const f of shFeatures) P.push(`- **${esc(f.feature || f.caption || f.name || String(f))}** — standard feature`);
        for (const d of shDetails) { const ent = d.entity ? ` (${esc(d.entity)})` : ""; P.push(`- **${esc(d.caption || d.detailSchema || d.entity || "detail")}** — related list${ent}${addModeText(d.addMode)}`); }
        P.push("");
      }
    }
    // Typed page mappings — the FULL per-type form spec for each typed page (folded from manifest.typedPageSchemas).
    P.push("### Typed page mappings", "");
    for (const t of typed) {
      const typeNote = t.type ? ` — type "${esc(t.type)}"` : "";
      P.push(`#### Typed form: ${esc(t.schema)}${typeNote}`);
      if (t.bindOnly) {
        P.push(`> **Bind-only** — layout identical to the base; no separate form. Bind the **Shared form (base) above** for this Type (by the Type column).`);
      } else if (t.cyclic) {
        P.push(`> ↩ **Already mapped above (cycle)** — this typed form references back into an ancestor page on this branch; its spec appears higher in this plan. Not re-embedded (would recurse forever); the structure gate treats it as resolved.`);
      } else if (t.spec) {
        P.push("", demoteHeadings(t.spec, 2));
      } else if (t.specError) {
        P.push(`> ⚠ typed-page bundle supplied but failed to parse: ${esc(t.specError)} — fix the bundle and re-run.`);
      } else {
        P.push(`> ⚠ **NOT resolved — this typed form has no design spec.** Assemble its bundle (\`get-classic-page-sources --schema-name ${esc(t.schema)}\`) into \`manifest.typedPageSchemas["${esc(t.schema)}"]\` so the engine folds its FULL per-type layout here, OR mark the \`typedPages\` entry \`{ "bindOnly": true }\` if its layout is identical to the base. **"Map at build" is not allowed** — the structure gate blocks the plan until every typed form is resolved.`);
      }
      P.push("");
    }
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
      if (c.cyclic) {
        // a cycle: this page is mapped higher on the same branch — do NOT re-embed (infinite recursion) and do
        // NOT flag it as unmapped; point the reader up. The structure gate treats it as resolved (see childPageIssue).
        P.push(`> ↩ **Already mapped above (cycle)** — this page references back into an ancestor page on this branch (\`${esc(c.resolvedFrom || c.editPage || c.entity)}\`); its full spec appears higher in this plan and is not repeated here.`);
      } else if (c.spec) {
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
  // NB: the Plan-vs-Done checklist is NOT emitted here — the plan is what the user approves BEFORE building, and
  // a control table there is premature. It is produced separately by `renderChecklist` (CLI `--checklist`) and
  // presented AFTER implementation. See renderChecklist below.
  P.push("> **Supply the plan values via `manifest.planMeta` and re-run (that fills the `<FILL: …>` above), then present this VERBATIM** — ideally the file written by `--out`, not a hand-paste. Any remaining `<FILL: …>` means that planMeta value is still missing. Corrections/enrichments go in an *Adjustments* list at the very end — do NOT edit, reorder, or drop the generated tables/sections (Main scope · List page · form-page Layout/Logic/Confirm · Child page mappings).");
  return P.join("\n");
}

// Shared grouped Plan-vs-Done structure. BOTH `--checklist` (pre, all `☐ pending`) and `--verify` (post, Status
// AUTO-FILLED from the built page) render THIS same structure, so the close-gate looks EXACTLY like the grouped
// checklist Kateryna refined — not a second flat table. Each row carries an optional `vk` (verify-kind): the
// machine check against the built page (get-page). Rows WITHOUT a vk are agent-confirmed (logic / confirm / child
// / quality / placement) — surfaced so nothing is silently dropped, but NOT part of the hard machine gate.
// Grouped at tab/region granularity; business rules folded to a count; handlers + ⚠ Confirm one row each.
function checklistGroups(result, opts = {}) {
  const cs = result.changeSet || {};
  const pm = opts.planMeta || {};
  const typed = result.typedPages || [];
  const childs = result.childPages || [];
  const fill = (v, ph) => (v != null && String(v).trim() !== "" ? esc(String(v)) : ph);
  const groups = [];
  const G = (title, rows) => { const r = rows.filter(Boolean); if (r.length) groups.push({ title, rows: r }); };
  // Pages — every page this migration creates (the mini page is a page, not a footnote)
  const pages = [{ label: `List page → ${fill(pm.listTemplate, "<FILL: list template>")}` }];
  if (!typed.length) pages.push({ label: `Form page → ${fill(pm.formTemplate || opts.template, "<FILL: form template>")}`, vk: { type: "formpage" } });
  for (const t of typed) { const ts = t.type ? ` — type "${esc(t.type)}"` : ""; const bo = t.bindOnly ? " (bind by Type)" : ""; pages.push({ label: `Typed form \`${esc(t.schema)}\`${ts}${bo}` }); }
  if (result.miniPage?.schema) pages.push({ label: `Mini page \`${esc(result.miniPage.schema)}\``, vk: { type: "mini" } });
  // Navigable SECTION registration — a section migration's pages are unreachable until the Freedom section is
  // registered in an app (`create-app-section`) and appears in the menu. This is a DELIVERABLE in its own right:
  // one real run created the list + form pages but never registered the section, and — because a hand-built
  // summary had no row for it — it was silently dropped until the user caught it. Surface it so it can't vanish.
  if (pm.sectionSchema || result.section) pages.push({ label: "Navigable section registered — the Freedom section appears in the app menu (`create-app-section`); the pages above are not reachable without it" });
  G("Pages", pages);
  // List page contents
  const section = result.section || null;
  const listItems = [];
  if (pm.sectionSchema || section || result.miniPage) {
    listItems.push({ label: "List columns" });
    if ((section?.quickFilters || []).length) listItems.push({ label: `Quick filters (${section.quickFilters.length})` });
    if ((section?.sectionActions || []).length) listItems.push({ label: `Section actions (${section.sectionActions.length})` });
  }
  G("List page", listItems);
  // Form — Layout, grouped at TOP-LEVEL tab/region (islands + field-groups collapse to their tab). PLACEMENT rows
  // (agent-confirmed: get-page cannot say which Freedom tab a field landed in); the machine COVERAGE rows follow.
  const regionOf = regionResolver(cs.viewConfigDiff || [], cs.resources || {});
  const top = (r) => { const s = String(r).split(" › ")[0]; return s === "Header / top" ? "Header" : s; };
  const order = [];
  const byRegion = new Map();
  const add = (region, label) => {
    const k = top(region);
    if (!byRegion.has(k)) { byRegion.set(k, { fields: 0, items: [] }); order.push(k); }
    const e = byRegion.get(k);
    if (label) e.items.push(label); else e.fields++;
  };
  for (const f of (cs.viewConfigDiff || []).filter(isField)) add(regionOf(f.parentName), null);
  for (const d of cs.details || []) add(d.tab ? regionOf(d.tab) : "⚠ unplaced", `${esc(d.caption || d.detailSchema || d.entity || "detail")}${d.editable ? " (editable)" : ""} — related list`);
  for (const w of cs.widgets || []) add(w.placement === "tab-next-to-feed" ? "Tab · Next steps (new)" : "Header / top", esc(w.widget));
  const layout = order.map((k) => {
    const e = byRegion.get(k);
    const parts = [];
    if (e.fields) parts.push(`${e.fields} field${e.fields === 1 ? "" : "s"}`);
    parts.push(...e.items);
    return { label: `${k} — ${parts.join(" · ")}` };
  });
  G("Form — Layout (by tab/region)", layout);
  // Form — Coverage: the MACHINE-verifiable rows (counts + component types from get-page). This is where the hard
  // gate lives; `--verify` fills these ✅/❌/⚠ from the built page, `--checklist` shows them ☐ pending.
  const cover = [];
  // Form TEMPLATE — the built page's parent template must be the one the plan recommends (e.g. an island-top /
  // progress-bar template). A real run's plan said "use the top-island template" but built on the plain default,
  // losing the top profile island; get-page's `parentSchemaName` makes that machine-checkable.
  if (pm.formTemplate) cover.push({ label: `Form template → \`${esc(pm.formTemplate)}\``, vk: { type: "template", exp: pm.formTemplate } });
  const expFields = (cs.viewConfigDiff || []).filter(isField).length;
  const expTabs = new Set((cs.viewConfigDiff || []).filter((o) => o.values?.type === "crt.Tab").map((o) => o.name)).size;
  const expDetails = (cs.details || []).length + (cs.standardFeatures || []).filter((s) => s.uiShape === "list").length;
  if (expFields) cover.push({ label: `Fields — ${expFields} expected`, vk: { type: "fields", n: expFields } });
  if (expTabs) cover.push({ label: `Tabs — ${expTabs} expected`, vk: { type: "tabs", n: expTabs } });
  if (expDetails) cover.push({ label: `Related lists — ${expDetails} expected`, vk: { type: "details", n: expDetails } });
  const FEATURE_TYPE = { Approvals: "crt.ApprovalList", "Communication options": "crt.ContactCommunication", Attachments: "crt.FileList", Feed: "crt.Feed" };
  for (const s of cs.standardFeatures || []) {
    const f = s.feature || s.caption || ""; const t = FEATURE_TYPE[f];
    if (!t || s.uiShape === "list") continue; // list-shaped features are covered by "Related lists"
    cover.push({ label: `${esc(f)} (\`${t}\`)`, vk: { type: "feature", ftype: t } });
  }
  if (result.signals?.dcm?.resolved === true && !!result.signals.dcm.present) {
    cover.push(
      { label: "DCM case progress bar", vk: { type: "dcm-bar" } },
      { label: "DCM Next steps", vk: { type: "dcm-next" } },
    );
  }
  G("Form — Coverage (verified)", cover);
  // Form — Logic: business rules folded to a count; ONE row per handler (the dropped-in-prose case). Agent-confirmed.
  const logicItems = [];
  const ruleN = (cs.pageBusinessRules || []).length + new Set((cs.entityBusinessRules || []).map((r) => r.targetAttribute)).size;
  if (ruleN) logicItems.push({ label: `Business rules × ${ruleN}` });
  for (const h of cs.handlerStubs || []) logicItems.push({ label: `Handler — \`${esc(h.sourceMethod)}\`` });
  G("Form — Logic", logicItems);
  // Card actions — Process/Print each their own row (machine: a crt.Button must exist); native view controls folded.
  const acts = cs.cardActions || [];
  const actItems = acts.filter((a) => /process|print/i.test(a)).map((a) => ({ label: `Card action — ${esc(a.replace(/Button$/, ""))}`, vk: { type: "card" } }));
  const natives = acts.filter((a) => !/process|print/i.test(a));
  if (natives.length) actItems.push({ label: `Card actions — native (${natives.map((a) => esc(a.replace(/Button$/, ""))).join("/")})` });
  G("Card actions", actItems);
  // ⚠ Confirm worklist — same items as the Confirm section (kinds not shown elsewhere). Removals are not decisions.
  const SHOWN_ELSEWHERE_CK = new Set(["process-launch", "standard-feature", "widget", "card-action", "method", "detail-editpage"]);
  G("⚠ Confirm worklist", (cs.needsDecision || []).filter((nn) => !SHOWN_ELSEWHERE_CK.has(nn.kind)).map((d) => ({ label: `[${esc(d.kind)}] ${esc(d.item)}` })));
  // Child pages
  G("Child pages", childs.map((c) => ({ label: `${esc(c.entity)} — separate page?` })));
  // Quality gates — ALWAYS present. Named after the skill and worded so it CANNOT be waved through: the row is
  // DONE only if the `creatio-ui-guidelines` skill was actually invoked on EVERY built page. Sessions gamed the
  // old wording by asserting "native components used → style parity is inherent" (a false equivalence — native
  // components are necessary, not sufficient; a 950-field wall is still native) and demoting real layout problems
  // to "refine if desired". So acceptance is now a single, checkable fact — did you run the skill on all pages —
  // and the escape phrases are explicitly rejected.
  G("Quality gates", [{ label: "`creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** \"native components / native containers used\", \"style parity is inherent\", \"looks fine\", \"template handles it\", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never \"refine if desired\". NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema. Leave it `☐` until the skill has run on ALL of the pages above." }]);
  return groups;
}

// `--checklist` — the grouped Plan-vs-Done skeleton (all rows `☐ pending`), presented AFTER implementing. Not part
// of `--plan`. The verified version is `--verify` below (SAME structure, Status auto-filled from the built page).
export function renderChecklist(result, opts = {}) {
  const groups = checklistGroups(result, opts);
  if (!groups.length) return "";
  const L = ["### ✅ Plan-vs-Done checklist", "",
    "> Present this **AFTER implementing** (not part of the approval plan). One row per deliverable / handler / ⚠ Confirm item. Fill **Status** (`✅ Done` / `⚠ Partial` / `❌ Not done` / `N/A` — with reason) and **Evidence** for EVERY row. A row left `☐ pending` = not verified. **Do not delete rows.** (Prefer `--verify --built <get-page>` — it auto-fills Status from the built page and hard-blocks on any ❌.)"];
  let n = 0;
  for (const g of groups) {
    L.push("", `**${g.title}**`, "", "| # | Deliverable | Status | Evidence |", "| --- | --- | --- | --- |");
    for (const r of g.rows) L.push(`| ${++n} | ${r.label} | ☐ pending | — |`);
  }
  return L.join("\n");
}

// VERIFIED done-gate — the SAME grouped structure as `--checklist`, but Status AUTO-FILLED from the ACTUALLY BUILT
// Freedom page (clio `get-page`: { ops:[{name,type,parentName}], parentSchemaName, miniPageBuilt }), so "done" is
// checked against reality, not the agent's prose. STRUCTURAL rows (a `vk`) are machine-checked ✅/❌/⚠ and drive the
// HARD verdict (any ❌ ⇒ INCOMPLETE, non-zero exit). Rows with no `vk` (placement / logic / confirm / child /
// quality) are surfaced as `☐ confirm on-stand` (agent evidence) — visible so nothing drops, but not machine-gated
// (get-page shows structure, not business-rule logic or which Freedom tab a field landed in). Driven by get-page,
// so a broken browser/SSO on the stand is NOT an excuse to skip this gate.
export function renderVerify(result, opts = {}, built = {}) {
  const ops = Array.isArray(built.ops) ? built.ops : [];
  const parentTpl = built.parentSchemaName || opts.planMeta?.formTemplate || "";
  const typeCount = (t) => ops.filter((o) => (o.type || "") === t).length;
  const hasType = (t) => typeCount(t) > 0;
  const FIELD_RE = /^crt\.(Input|ComboBox|DateTimePicker|Checkbox|NumberInput|MoneyInput|ColorEdit|TextArea|MultilineInput)$/;
  let missing = 0, unverified = 0;
  // Resolve a row's machine Status from the built page. vk-less rows → agent-confirmed (not part of the gate).
  const resolve = (vk) => {
    if (!vk) return ["☐ confirm on-stand", "not derivable from get-page — confirm (render / on-stand query)"];
    if (vk.type === "formpage") return ops.length ? ["✅ Done", "form page built (get-page returned its components)"] : (missing++, ["❌ MISSING", "get-page returned no components for the form page"]);
    if (vk.type === "template") {
      if (!built.parentSchemaName) { unverified++; return ["⚠ verify", "get-page `parentSchemaName` not provided — confirm the built page's template"]; }
      if (built.parentSchemaName === vk.exp) return ["✅ Done", `built on \`${esc(vk.exp)}\``];
      unverified++; return ["⚠ verify", `built on \`${esc(built.parentSchemaName)}\` but the plan recommended \`${esc(vk.exp)}\` — confirm the template (top profile island / progress bar)`];
    }
    if (vk.type === "mini") {
      if (built.miniPageBuilt === true) return ["✅ Done", "created on-stand"];
      if (built.miniPageBuilt === false) { missing++; return ["❌ MISSING", "NOT created — '+ New' still opens the full form"]; }
      unverified++; return ["⚠ verify", "get-page the mini schema / pass built.miniPageBuilt"];
    }
    if (vk.type === "fields") { const b = ops.filter((o) => FIELD_RE.test(o.type || "")).length; return b >= vk.n ? ["✅ Done", `${b} field components on the built page`] : (unverified++, ["⚠ verify", `${b} built — fewer than ${vk.n} expected; check which fields were dropped`]); }
    if (vk.type === "tabs") { const b = typeCount("crt.Tab"); if (b >= vk.n) { return ["✅ Done", `${b} crt.Tab built`]; } if (b > 0) { unverified++; return ["⚠ verify", `${b}/${vk.n} crt.Tab built`]; } missing++; return ["❌ MISSING", "no crt.Tab built"]; }
    if (vk.type === "details") { const b = typeCount("crt.DataGrid"); if (b >= vk.n) { return ["✅ Done", `${b} crt.DataGrid built`]; } if (b > 0) { unverified++; return ["⚠ verify", `${b}/${vk.n} crt.DataGrid built`]; } missing++; return ["❌ MISSING", "no crt.DataGrid built"]; }
    if (vk.type === "feature") return hasType(vk.ftype) ? ["✅ Done", `found ${vk.ftype}`] : (missing++, [`❌ MISSING`, `NO ${vk.ftype} on the built page`]);
    if (vk.type === "dcm-bar") { const ok = hasType("crt.EntityStageProgressBar") || /ProgressBar/i.test(parentTpl); return ok ? ["✅ Done", hasType("crt.EntityStageProgressBar") ? "crt.EntityStageProgressBar built" : `provided by ${esc(parentTpl)}`] : (missing++, ["❌ MISSING", `no crt.EntityStageProgressBar and template is \`${esc(parentTpl)}\``]); }
    if (vk.type === "dcm-next") return hasType("crt.NextSteps") ? ["✅ Done", "crt.NextSteps built"] : (missing++, ["❌ MISSING", "no crt.NextSteps tab on the built page"]);
    if (vk.type === "card") return hasType("crt.Button") ? ["✅ Done", "a crt.Button is present — confirm it triggers the action"] : (unverified++, ["⚠ verify", "no crt.Button found — confirm the action"]);
    unverified++; return ["⚠ verify", "confirm on-stand"];
  };
  const groups = checklistGroups(result, opts);
  const L = []; let n = 0;
  for (const g of groups) {
    L.push("", `**${g.title}**`, "", "| # | Deliverable | Status | Evidence (built page) |", "| --- | --- | --- | --- |");
    for (const r of g.rows) { const [mark, ev] = resolve(r.vk); L.push(`| ${++n} | ${r.label} | ${mark} | ${esc(ev)} |`); }
  }
  let verdict;
  if (missing > 0) verdict = `⛔ **INCOMPLETE — ${missing} machine-checked deliverable(s) MISSING** (fix and re-verify)`;
  else if (unverified > 0) verdict = `⚠ **${unverified} machine row(s) not confirmed** — resolve before calling it done`;
  else verdict = `✅ **All machine-checkable deliverables present on the built page** (still confirm the ☐ agent rows)`;
  const md = ["### ✅ Plan-vs-Done — VERIFIED against the built page", "",
    `> SAME grouped control table as \`--checklist\`, Status AUTO-FILLED from the built page (\`get-page\`). Structural rows are machine-checked and drive the verdict; \`☐ confirm on-stand\` rows (logic / confirm / child / quality / placement) are surfaced for the agent — not machine-gated. ${verdict}`,
    ...L, "", `**Verdict:** ${verdict}`].join("\n");
  return { markdown: md, missing, unverified, complete: missing === 0 && unverified === 0 };
}
