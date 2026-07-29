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
// The nearest CAPTIONED group label for a container, or null — resolved real text OR a human-readable key, but
// NOT an auto-generated hex-hash noise key. Extracted so the region resolver stays under Sonar CC 15.
function captionGroupLabel(o, resources) {
  const raw = o.values?.caption;
  if (!raw) return null;
  const t = resources[resourceKey(raw)] ?? resourceKey(raw);
  const resolved = resources[resourceKey(raw)] != null;
  return (resolved || !/[0-9a-f]{6}/i.test(t)) ? esc(t) : null;
}
function regionResolver(viewConfigDiff, resources = {}) {
  const byName = new Map(viewConfigDiff.map((o) => [o.name, o]));
  // Major 4 — a caption is a `$Resources.Strings.<key>` binding; show its human text from the resource map
  // (the plan stays readable) — fall back to the key when the text is not resolved.
  const capText = (raw) => { const k = resourceKey(raw); return resources[k] ?? k; }; // same key normalization the mapper used to STORE the string (incl. #anchor strip)
  const label = (o) => esc(o.values?.caption ? capText(o.values.caption) : o.name);
  // a profile island container often has NO caption (it is a visual grouping, e.g. `ContactContainer`) but is
  // a DISTINCT `crt.GridContainer` — keep the islands apart in the Region by falling back to its own name
  // (minus the `Container` suffix) when no captioned group is found, so the 2 islands don't collapse to one flat
  // "Side profile" (which dropped the island distinction from the Layout table).
  const islandLabel = (name) => esc(String(name).replace(/Container$/, ""));
  // Side profile Region label: keep the (possibly uncaptioned) island distinct so >1 island doesn't collapse.
  const profileRegionLabel = (group, prev) => {
    const island = group || (prev ? islandLabel(prev) : null);
    return island ? `Side profile › ${island}` : "Side profile";
  };
  // Tab Region label, with the nearest captioned group appended when present.
  const tabRegionLabel = (o, group) => group ? `Tab · ${label(o)} › ${group}` : `Tab · ${label(o)}`;
  return (parentName) => {
    // `group` = the nearest CAPTIONED ancestor container (a real field group like "Sender" / "Additional
    // delivery info") between the field and its tab/profile. Surfacing it keeps the Region column showing the
    // GROUP, not just the flat tab — grouping was being lost (fields read as one flat list under the tab).
    // `prev` tracks the container we came FROM (the child of the profile/tab we resolve into) so an uncaptioned
    // island still resolves to its own container identity.
    let p = parentName, hops = 0, group = null, prev = null;
    while (p && hops++ < 64) {
      if (p === "SideAreaProfileContainer") return profileRegionLabel(group, prev);
      if (p === "HeaderContainer") return "Header";
      // (removed a legacy hardcode that mapped `GeneralInfoTabContainer` → "⚠ fallback (unresolved)" — it dates
      // from when that container was a catch-all with no real tab. The mapper now emits it as a proper `crt.Tab`
      // (isTab, caption "General information"), so the normal crt.Tab climb below resolves it to "Tab · General
      // information". The hardcode short-circuited BEFORE that check and falsely flagged ~20 real General-info
      // fields as unresolved on every page that has this tab.)
      const o = byName.get(p);
      if (!o) return esc(p);
      if (o.values?.type === "crt.Tab") return tabRegionLabel(o, group);
      // nearest captioned group wins (a hex-hash noise key is dropped — still surfaced as a [group-caption] ⚠).
      if (group == null) group = captionGroupLabel(o, resources);
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

// ---- Layout-table row builders (one per element category) — each returns an array of { region, sort, cells }.
// Extracted from renderDesignSpec so it stays under Sonar CC 15 (S3776). ----
function rowsForFields(fields, regionOf) {
  return fields.map((f) => {
    const col = strip(f.values.control);
    const v = f.values || {};
    const type = esc(v.typeLabel || v.type) + (v.refSchema ? ` (${esc(v.refSchema)})` : "");
    const rule = v.readOnly ? "read-only" : DASH; // intrinsic state only; business rules live in the Logic table
    const linked = v.linkedValue
      ? "Linked value from a RELATED data source (column is not on this entity) — in Freedom show it natively: add the related object's column through the lookup on this page and bind this input to `<Lookup>.<column>` READ-ONLY (do NOT rebuild it as a plain entity field, wire a manual on-change handler only if it must be STORED, and do NOT drop it — dropping collapses an island to a lone field)"
        + (Array.isArray(v.linkedNearest) && v.linkedNearest.length ? ` · if instead a renamed/removed column, nearest existing: ${v.linkedNearest.map(esc).join(", ")}` : "")
      : null;
    const tip = v.tip?.content ? `tip: ${esc(v.tip.content)}` : null;
    const additional = [linked, tip].filter(Boolean).join(" · ") || DASH;
    return { region: regionOf(f.parentName), sort: 0, cells: [esc(dispLabel(f)), type, "PDS." + esc(col), rule, additional] };
  });
}
function rowsForDetails(details, tabRegion) {
  return (details || []).map((d) => {
    const depNote = d.dependency ? ` · by ${esc(d.dependency.attributePath)}` : " · ⚠ FK";
    const src = `${esc(d.entity || "?")}${depNote}`;
    const cols = d.columns?.length ? `cols: ${d.columns.map(esc).join(" · ")}` : "";
    let editNote = "";
    if (d.editable) {
      const editCols = (d.editable.columns || []).length ? ` — editable: ${d.editable.columns.map(esc).join(" · ")}` : "";
      editNote = `⚠ INLINE-EDITABLE (${esc(d.editable.enableVia)})${editCols}`;
    }
    const add = [cols, editNote].filter(Boolean).join(" · ") || DASH;
    return { region: d.tab ? tabRegion(d.tab) : "⚠ unplaced", sort: 1, cells: [esc(d.caption || d.detailSchema || d.entity), d.editable ? "Editable list" : "Related list", src, DASH, add] };
  });
}
function rowsForFeatures(standardFeatures, tabRegion) {
  return (standardFeatures || []).map((s) => {
    const isList = s.uiShape === "list";
    const type = isList ? "Related list" : esc(s.feature);
    const nativeSrc = s.templateProvided ? "template-provided" : "native — confirm component on-stand";
    const src = isList ? `${esc(s.entity || "Activity")} · native` : nativeSrc;
    const inferredNote = s.inferredFromEntity ? "⚠ inferred from entity — confirm" : DASH;
    const add = s.note ? `⚠ ${esc(s.note)}` : inferredNote;
    return { region: s.tab ? tabRegion(s.tab) : "⚠ unplaced", sort: isList ? 1 : 2, cells: [esc(s.feature), type, src, DASH, add] };
  });
}
function widgetSource(w) {
  // The DCM progress bar is SHIPPED by PageWithTabsAndProgressBarTemplate (template-PROVIDED + re-bound); Next
  // steps is genuinely ADDED as a new tab; other placed widgets keep the generic ADD wording.
  if (w.placement === "page-top") return "provided by `PageWithTabsAndProgressBarTemplate` (ships the bar placed) — build the form on that template + RE-BIND to the case; hand-adding to `MainContainer` is the fallback";
  if (w.placement === "tab-next-to-feed") return "⚠ ADD — a new tab (Next steps) beside Feed/Attachments (not template-provided)";
  if (w.placement) return "⚠ ADD — not in the default Freedom template";
  if (w.note) return "⚠ confirm on-stand — see note"; // specific guidance (e.g. NBO) — do NOT assert template-provided
  if (w.base) return "template context — provided by the Freedom template";
  return "native — confirm on-stand";
}
function rowsForWidgets(widgets) {
  return (widgets || []).map((w) => {
    const region = w.placement === "tab-next-to-feed" ? "Tab · Next steps (new)" : "Header / top";
    return { region, sort: 2, cells: [esc(w.widget), "Component", widgetSource(w), DASH, w.note ? esc(w.note) : DASH] };
  });
}
const PROCESS_HOWTO = "⚠ Migrate ONLY if a process is connected to this section. Check on-stand with `odata-read` (the param is `filters`, NOT `filter`): `ProcessInModules` `filters {all:[{field:\"SysModule/Id\",op:\"eq\",value:<sysModuleId>}]}` (a lookup → filter via the `SysModule/Id` nav, never a `SysModuleId` field), select `[\"SysSchemaUId\",\"Position\"]` — that is the section's \"Run process\" menu (Section Wizard → Business Processes). ProcessInModules has NO name column: resolve each `SysSchemaUId` to the process name via `odata-read VwSysProcess` `filters {all:[{field:\"Id\",op:\"eq\",value:<SysSchemaUId>}]}`, select `[\"Caption\",\"Name\"]` (Caption = the human menu label; a process's `Id` == its `UId`, so filter by `Id` — `UId eq <guid>` FAILS with an Edm.Guid-vs-String error; no `IsMaxVersion` filter needed, `Id` is unique). None connected ⇒ the button is NOT migrated; if some are, name each in the plan. (No `SysProcessId`/`Caption` exists on ProcessInModules; `SysProcessEntity`/`VwSysProcessEntity` = runtime process-instance↔record links, NOT this.)";
const PRINT_HOWTO = "⚠ Migrate ONLY if printables/reports exist for this section. Check on-stand: read `SysModuleReport` filtered by the section's `SysModule` (nav `SysModule/Id eq <id>`) + `ShowInSection eq true` (section Print menu) or `ShowInCard eq true` (record card); each row's `Caption`/`Type`/`SysReportSchemaUId`|`FileName` is the printable. None ⇒ the button is NOT migrated; if some exist, wire them as the Freedom print action.";
// The Additional-cell note for a Print / Run-process card action: concrete when the on-stand signal is resolved,
// the how-to fallback otherwise, a short "no section-level menu" on a child page. Own fn for Sonar CC 15.
// The Run-process card action note: not-applicable on a child page, else driven by the on-stand `processes`
// signal (connected+named / connected / none / unresolved how-to). Extracted for Sonar CC 15.
function processActionNote(result, opts, sigList) {
  if (opts.isChildPage) return { type: "Action", note: "Child edit page — no section-level Run-process menu; migrate only if THIS child page's own ACTIONS had a run-process (confirm), else not applicable." };
  const sp = result.signals?.processes;
  if (sp?.resolved !== true) return { type: "Action", note: PROCESS_HOWTO };
  if (!sp.present) return { type: "Action", note: "**Not migrated** — no process connected to this section (checked `ProcessInModules` on-stand)." };
  const namePart = sigList(sp) ? `: ${sigList(sp)}` : " (name unresolved — resolve via `VwSysProcess` by Id)";
  return { type: "Action", note: `Connected process${namePart} → wire as a Freedom **Run process** card action.` };
}
// The Print card action note: same shape as processActionNote, driven by the `printables` signal. Extracted for CC.
function printActionNote(result, opts, sigList) {
  if (opts.isChildPage) return { type: "Action", note: "Child edit page — no section-level Print menu; migrate only if THIS child page's own ACTIONS had a printable (confirm), else not applicable." };
  const spr = result.signals?.printables;
  if (spr?.resolved !== true) return { type: "Action", note: PRINT_HOWTO };
  if (!spr.present) return { type: "Action", note: "**Not migrated** — no printables/reports for this section (checked `SysModuleReport` on-stand)." };
  const namePart = sigList(spr) ? `: ${sigList(spr)}` : "s present";
  return { type: "Action", note: `Printable${namePart} → wire as the Freedom **print** action.` };
}
function cardActionNote(name, result, opts) {
  const sigList = (s) => (s?.cases || s?.items || s?.names || []).map((x) => esc(typeof x === "string" ? x : (x && (x.name || x.caption)) || "")).filter(Boolean).join(", ");
  if (/process/i.test(name)) return processActionNote(result, opts, sigList);
  if (/print/i.test(name)) return printActionNote(result, opts, sigList);
  if (name === "ViewOptions") return { type: "—", note: "Not migrated — standard page view-options control (native Freedom capability), not a bespoke action." };
  if (name === "Tag") return { type: "—", note: "Provided by the default Freedom template (tags) — nothing to migrate." };
  return { type: "Action", note: DASH };
}
function rowsForCardActions(cardActions, result, opts) {
  return (cardActions || []).map((a) => {
    const name = a.replace(/Button$/, "");
    const { type, note } = cardActionNote(name, result, opts);
    return { region: "Card actions", sort: 3, cells: [esc(name), type, DASH, DASH, note] };
  });
}
function rowsForImages(images, regionOf) {
  return (images || []).map((im) => {
    // Source = the resolved IMAGELOOKUP column when known; a related-object photo shows its lookup path; a FILL
    // slot when the column could not be resolved. The mapper emits a real crt.ImageInput either way.
    const src = im.column ? (im.crossDs ? `\`${esc(im.column)}\` (related object — via lookup)` : `\`${esc(im.column)}\``) : "`<FILL: image column>`";
    const note = im.crossDs
      ? "→ `crt.ImageInput`, `value` bound through the lookup READ-ONLY (related-object photo); must be an IMAGELOOKUP column"
      : im.column
        ? "→ `crt.ImageInput` bound via `value` to this IMAGELOOKUP column"
        : "→ `crt.ImageInput` — bind `value` to the entity's IMAGELOOKUP (16) column (add it to `entityColumns`); if the photo is from a related object bind through its lookup read-only; if none exists, create an ImageLookup column";
    return { region: im.parent ? regionOf(im.parent) : "⚠ unplaced", sort: 0, cells: [esc(im.classic), "crt.ImageInput", src, im.crossDs ? "read-only" : DASH, note] };
  });
}

// Declarative page business rules → Logic rows [behaviour, trigger, effect, target]. Extracted for Sonar CC 15.
function pageRuleRows(cs) {
  const condAttrs = (conds) => [...new Set((conds || []).map((c) => c?.left?.attribute || c?.left?.path || c?.leftExpression?.attribute || c?.attribute).filter(Boolean))];
  return (cs.pageBusinessRules || []).map((r) => {
    const attrs = condAttrs(r.conditions);
    const condTrigger = (r.conditions || []).length ? "conditional" : "always";
    const trigger = attrs.length ? `when ${attrs.map(esc).join(" / ")}` : condTrigger;
    const effect = humanizeAction(r.action) + (r.inverseAction ? ` (else ${humanizeAction(r.inverseAction)})` : "");
    return [esc(r.element), trigger, effect, "page business rule"];
  });
}
// entity/lookup filters — DEDUP by target attribute (a column can carry >1 FILTRATION rule); one row per attr.
function entityFilterRows(cs) {
  const filtBy = {};
  for (const r of cs.entityBusinessRules || []) { filtBy[r.targetAttribute] ||= []; filtBy[r.targetAttribute].push(r); }
  return Object.entries(filtBy).map(([attr, rs]) => {
    const unresolved = rs.filter((r) => !r.complete).length;
    const singleEffc = rs[0].complete ? "static filter" : "⚠ dynamic — resolve value";
    const unresolvedNote = unresolved ? ` (${unresolved} ⚠ dynamic — resolve value)` : "";
    const effc = rs.length === 1 ? singleEffc : `${rs.length} filters${unresolvedNote}`;
    return [`Filter · ${esc(attr)}`, `${esc(attr)} lookup`, effc, "entity business rule / lookup filter"];
  });
}
// handlers — fold set<X>Info / clear<X>Info helpers into their on<X>Change trigger row. Extracted for Sonar CC 15.
function handlerRows(cs) {
  const stubs = cs.handlerStubs || [];
  const helperBase = (m) => { const mt = /^(?:set|clear)(.+?)Info$/.exec(m); return mt ? mt[1] : null; };
  const triggerBase = (m) => { const mt = /^on(.+?)Chang/.exec(m); return mt ? mt[1] : null; };
  const helpersByBase = {};
  for (const h of stubs) { const b = helperBase(h.sourceMethod); if (b) { helpersByBase[b] ||= []; helpersByBase[b].push(h.sourceMethod); } }
  return stubs.filter((h) => !helperBase(h.sourceMethod)).map((h) => { // helpers shown folded into their trigger row
    const b = triggerBase(h.sourceMethod);
    const extra = b && helpersByBase[b] ? ` (+ ${helpersByBase[b].map(esc).join(", ")})` : ""; // esc each helper name at the sink (untrusted body)
    return [esc(h.sourceMethod), esc(triggerOf(h.sourceMethod)), `imperative (${esc(h.category)})${extra} — review`, "request handler / converter / virtual attr"];
  });
}

// Build the Logic-table rows (declarative page rules → entity/lookup filters → handlers → process launch).
// Own fn so renderDesignSpec stays under Sonar CC 15. Returns an array of [behaviour, trigger, effect, target].
function buildLogicRows(cs) {
  const logic = [...pageRuleRows(cs), ...entityFilterRows(cs), ...handlerRows(cs)];
  if ((cs.needsDecision || []).some((n) => n.kind === "process-launch")) {
    const pn = cs.needsDecision.find((n) => n.kind === "process-launch")?.item;
    logic.push(["Run process", "Run process action", `launch ${esc(pn || "process")}`, pn ? "⚠ verify process name/binding" : "⚠ which process — resolve on-stand via `ProcessInModules` (section SysModule) → `VwSysProcess` by Id"]);
  }
  return logic;
}

// The "Add record" line: which mini page (folded / cyclic / not-folded), a verified full edit page, or unverified.
function addRecordDescription(result) {
  const mp = result.miniPage;
  if (mp?.spec) return `via mini page \`${esc(mp.schema)}\` — quick-add form; its full layout is under **Add mini-page mapping** below`;
  if (mp?.cyclic) return `via mini page \`${esc(mp.schema)}\` — ↩ already mapped above (cycle); its spec appears higher in this plan`;
  if (mp && (mp.unfolded || mp.specError)) return `⚠ via mini page \`${esc(mp.schema)}\` — NOT folded; supply its bundle in \`manifest.miniPageSchemas\` so its layout is mapped here`;
  if (result.miniPageNone) return "full edit page — verified on-stand: no add-record mini page";
  if (!result.miniPageVerified) return "⚠ NOT verified — check `list-entity-client-schemas` (`miniPageSchema` with `miniPageModes` = add) and record `manifest.addRecordMiniPage` ({schema} or false); do NOT assume there is none";
  return "full edit page (no add-record mini page)";
}
// The `### List page` block (section concerns: add-record, columns, quick filters, section actions, process).
// Own fn so renderDesignSpec stays under Sonar CC 15. Returns the lines to push.
function renderListPageBlock(result, section) {
  const L = ["### List page"];
  if (!section) L.push("- ⚠ **Section schema not gathered** — the classic `*Section` chain is not in `manifest.section`, so the list page's **list columns / quick filters / section actions were NOT analyzed**. `get-classic-page-sources` derives the section name from the entity (`<entity>Section[V2]`); if the real section is named off the page prefix (e.g. `Applicant1Page` → `Applicant1Section`) it returns `sectionLayerCount: 0`. Bundle the section schema by name into `manifest.section` and re-run.");
  L.push(`- **Add record:** ${addRecordDescription(result)}`);
  if (section) {
    const listCols = (section.listColumns || []).length ? section.listColumns.map(esc).join(" · ") : "⚠ not in the schema (profile data) — read the section's saved columns or confirm the list-page columns";
    L.push(`- **List columns:** ${listCols}`);
    if ((section.quickFilters || []).length) {
      const f = section.quickFilters.map((q) => {
        let s = `\`${esc(q.name)}\``;
        if (q.column) { const typePart = q.type ? `, ${esc(q.type)}` : ""; s += ` (${esc(q.column)}${typePart})`; }
        return s;
      }).join(" · ");
      L.push(`- **Quick filters:** ${f} — rebuild as the Freedom list-page filter / quick-filter controls (do NOT drop the registry filter bar)`);
    }
    if ((section.sectionActions || []).length) { const acts = section.sectionActions.map((a) => "`" + esc(a) + "`").join(" · "); L.push(`- **Section actions:** ${acts} — migrate as Freedom list-page actions`); }
    if (section.processLaunch) L.push(`- **Section process:** ⚠ launches ${(section.processNames || []).map(esc).join(", ") || "a process"} — wire as a list-page run-process action`);
  }
  L.push("");
  return L;
}

// Standalone (non-embedded) spec header: title + Entity/Size preamble, plus the ⛔ HARD-GATE / STRUCTURE banners
// (shown here only when standalone; embedded-in-plan relies on renderPlan's banner). Extracted for Sonar CC 15.
function renderSpecHeader(result, opts, entity, fields, cs) {
  const L = [];
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
  return L;
}

// A SECTION migration when the section chain folded, OR a mini page / section schema is named even though the
// chain wasn't gathered (bundle returned sectionLayerCount:0). A MINI page is never a section. Extracted for CC.
function isSectionScope(result, section, opts) {
  return !!((section || result.miniPage || opts.planMeta?.sectionSchema) && !opts.isMiniPage);
}

// Group the Layout rows by region (first-seen order) then rank regions: side profile / header FIRST, then tabs,
// top widgets, card actions, and finally flagged/unresolved. Returns { order, byRegion }. Extracted for CC.
function orderRegions(rows) {
  const order = [];
  const byRegion = new Map();
  rows.forEach((r, i) => { if (!byRegion.has(r.region)) { byRegion.set(r.region, []); order.push(r.region); } byRegion.get(r.region).push({ ...r, i }); });
  const regionRank = (r) => {
    if (r.startsWith("Side profile") || r === "Header") return 0;
    if (r.startsWith("Tab ")) return 1;
    if (r === "Header / top") return 2;
    if (r === "Card actions") return 3;
    return 4;
  };
  const firstSeen = new Map(order.map((r, i) => [r, i]));
  order.sort((a, b) => regionRank(a) - regionRank(b) || firstSeen.get(a) - firstSeen.get(b));
  return { order, byRegion };
}

// Child-page template recommendation, keyed off input count (the vanislemarina-review rule): a SMALL flat child
// (≤5 fields, no tabs/details) → the Mini page template; a WIDE child (≥12 fields, no tabs) → the Grid page
// template. Between the two, the default form template stands. Applies to related-list child pages only.
function childFormRecommendation(cs, fields, opts) {
  if (!opts.isChildPage) return [];
  const hasTabs = (cs.viewConfigDiff || []).some((o) => o.values?.type === "crt.Tab");
  const nDetails = (cs.details || []).length + (cs.standardFeatures || []).filter((s) => s.uiShape === "list").length;
  const n = fields.length;
  if (!n) return [];
  // Threshold (vanislemarina rule): a related-list child with FEWER THAN 15 inputs — and flat (a mini page holds
  // neither tabs nor related lists) → open as an edit MINI PAGE. Otherwise (>= 15 inputs, OR it has tabs/related
  // lists) → the Grid page template. One cut at 15, no gap — every child gets a concrete template.
  if (n < 15 && !hasTabs && !nDetails)
    return [`> **Recommendation — small child form (${n} field${n === 1 ? "" : "s"}, < 15, flat):** open this related-list child as an **edit mini page (\`BaseMiniPageTemplate\` — "Mini page") / modal** — a lightweight quick-add shell — rather than a full record page. Confirm the desired shell before building.`, ""];
  const why = hasTabs || nDetails ? "it has tabs / related lists" : `${n} inputs (>= 15)`;
  return [`> **Recommendation — child form (${n} field${n === 1 ? "" : "s"}):** build this related-list child on the **Grid page template (\`PageWithAreaFreedomTemplate\`)** — ${why}, so a full-width grid suits it better than the narrow left-profile default or a mini page. Confirm before building.`, ""];
}

// Header-template recommendation: a WIDE/populated Classic Header block (the mapper's `headerLayout === "wide"`
// signal) means the Freedom target should be the top-area template so the header elements land in
// TopAreaProfileContainer, not the narrow left profile. Applies to ANY form — base record page, each TYPED
// per-type page, and each child page (a mini page has no such choice). This is the engine surfacing the
// header→template rule the same way `signals.dcm` surfaces the progress-bar template.
function headerTemplateRecommendation(cs, opts) {
  if (opts.isMiniPage || cs.headerLayout !== "wide") return [];
  return [`> **Template recommendation — header elements present:** the Classic page has a populated Header block, so build this form on the **top-area template \`PageWithTopAreaAndTabsFreedomTemplate\`** ("Tabbed page with area on top") and place the header elements in **\`TopAreaProfileContainer\`** — not the narrow left profile. If the object ALSO has a DCM case, prefer the progress-bar template and place the header elements per \`creatio-ui-guidelines\`.`, ""];
}

// The "⚠ Confirm before I build" worklist — the GENUINE open decisions only (kinds already surfaced in Layout /
// Logic / Child-pages are not re-listed), plus the C2 lookup-GUID prompt. Returns the lines. Extracted for CC.
function renderConfirmWorklist(cs) {
  // `reason` is escaped with `esc` (not `strip`): the mapper interpolates raw stand-derived tokens into it
  // (container/field names, captions, bound hints), all attacker-chosen on a hostile stand. `strip` alone leaves
  // `<`/`>`/backtick/`](` live; `esc` neutralizes those. Whole-string `esc` is omission-proof and the
  // engine-authored parts of every reason are plain prose (audited). Keep new reasons that way (put any code
  // identifier or angle-bracketed token in `item`, which is likewise `esc`d). Removals are NOT a worklist item.
  const SHOWN_ELSEWHERE = new Set(["process-launch", "standard-feature", "widget", "card-action", "method", "detail-editpage"]);
  const nd = (cs.needsDecision || []).filter((n) => !SHOWN_ELSEWHERE.has(n.kind));
  const confirm = nd.map((d) => `- **[${esc(d.kind)}]** ${esc(d.item)} — ${esc(d.reason)}`);
  // C2 — business-rule conditions often compare against lookup-record GUIDs (Stage/Source values); the spec
  // shows "required (conditional)" but the raw GUID is unreadable. Prompt resolving them to names on-stand.
  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (GUID.test(JSON.stringify(cs.pageBusinessRules || [])) || GUID.test(JSON.stringify(cs.entityBusinessRules || [])))
    confirm.push("- **[lookup-value]** business-rule conditions compare against lookup-record **GUIDs** (e.g. Stage/Source values) — resolve each GUID to its display name on-stand before building, so the rule reads correctly.");
  if (!confirm.length) return [];
  return [`#### ⚠ Confirm before I build (${confirm.length})`, ...confirm, ""];
}

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
  // `embedded` (rendered inside renderPlan) skips the standalone title/preamble to avoid duplicating renderPlan's
  // Overview; the ⛔ gate/structure banners are safety-critical and shown in BOTH modes (see renderSpecHeader).
  const L = renderSpecHeader(result, opts, entity, fields, cs);

  // ---- ONE Layout table (structure + contents) — one row-builder per element category (see helpers above) ----
  const rows = [
    ...rowsForFields(fields, regionOf),
    ...rowsForDetails(cs.details, tabRegion),
    ...rowsForFeatures(cs.standardFeatures, tabRegion),
    ...rowsForWidgets(cs.widgets),
    ...rowsForCardActions(cs.cardActions, result, opts),
    ...rowsForImages(cs.images, regionOf),
  ];
  // group by region (first-seen order), then reading order: side profile FIRST, tabs, widgets, actions, flagged.
  const { order, byRegion } = orderRegions(rows);

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
  // A MINI page is NOT a section (no list page). List page renders for a section migration only, not formOnly.
  const isSectionMigration = isSectionScope(result, section, opts);
  if (isSectionMigration && !opts.formOnly) L.push(...renderListPageBlock(result, section));

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
  const logic = buildLogicRows(cs);
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

  // ---- Child-page lighter-shell recommendation (child pages only), then the ⚠ Confirm worklist (GENUINE open
  // decisions only; kinds already surfaced in Layout / Logic / Child-pages are not re-listed) ----
  L.push(...headerTemplateRecommendation(cs, opts), ...childFormRecommendation(cs, fields, opts), ...renderConfirmWorklist(cs));

  return L.join("\n");
}

// renderPlan — the WHOLE plan skeleton the agent presents at the gate: an Overview/What-it-does/Pages
// header with `<FILL: …>` placeholders for the few AGENT decisions (scope, environment, package, approach,
// business sentence, template choices) + the GENERATED design spec. Child edit pages are folded into the
// Pages table as `Rebuild (child)` rows (recursive sub-migrations), not a separate section.
// The agent fills the placeholders and pastes VERBATIM — it cannot drop or restructure the generated
// sections (which is what happened when it hand-authored the plan). Corrections go in an Adjustments note.
// The top-of-plan ⛔ banners (correctness gate, structure completeness, planMeta / on-stand-signals gaps). Own fn
// so renderPlan stays under Sonar CC 15. Returns the lines to push.
function renderPlanBanners(result, opts) {
  const P = [];
  const gate = result.gate || { blocked: false, reasons: [] };
  if (gate.blocked) {
    P.push("> ⛔ **HARD GATE — BLOCKED. This plan is NOT ready to build or approve.** Fix these and re-run `migrate.mjs --plan`:");
    for (const r of gate.reasons) P.push(`> - ${esc(r)}`);
    P.push("");
  }
  const structure = result.structure || { complete: true, issues: [] };
  if (!structure.complete) {
    P.push("> ⛔ **STRUCTURE INCOMPLETE — this plan is NOT ready.** The engine detected required inputs you have not supplied (detail schemas / child-page mappings). Fetch them, add to the manifest, and re-run `migrate.mjs --plan`:");
    for (const it of structure.issues) P.push(`> - ${esc(it)}`);
    P.push("");
  }
  const planMetaMissing = opts.planMetaMissing || [];
  if (planMetaMissing.length) P.push(`> ⛔ **PLAN INCOMPLETE — required plan values are unfilled:** ${planMetaMissing.map((k) => "`" + k + "`").join(", ")}. Add them to \`manifest.planMeta\` and re-run \`migrate.mjs --plan\` (each shows as a \`<FILL: …>\` below until supplied).`, "");
  const signalsMissing = opts.signalsMissing || [];
  if (signalsMissing.length) P.push(`> ⛔ **PLAN INCOMPLETE — on-stand signals not resolved:** ${signalsMissing.map((k) => "`" + k + "`").join(", ")}. Run the checks and add answers to \`manifest.signals\` (each \`{ "resolved": true, "present": <bool>, … }\`), then re-run \`migrate.mjs --plan\`. **FIRST resolve the section's \`SysModule.Id\`** (the prerequisite for processes+printables — without it those checks CANNOT run, and a failed check is NOT a "none" answer): \`odata-read SysModule\` \`filters {any:[{field:"Code",op:"contains",value:"<Name>"},{field:"Caption",op:"contains",value:"<Name>"}]}\`, select \`["Id","Caption","Code"]\` — match your section (do NOT filter \`SectionSchemaUId eq <guid>\`: a UId column, it FAILS with Edm.Guid-vs-String; the module \`Code\` is usually the base entity name, e.g. section \`Applicant1Section\` → module Code \`Applicant\`). Then: **dcm** = \`SysSchema ManagerName='DcmSchemaManager'\` for the entity/family; **processes** = \`odata-read ProcessInModules\` with **\`filters\`** (NOT \`filter\`) \`{all:[{field:"SysModule/Id",op:"eq",value:<sysModuleId>}]}\` (a lookup → filter via the \`SysModule/Id\` nav, never a \`SysModuleId\` field), select \`["SysSchemaUId","Position"]\` — then resolve each \`SysSchemaUId\` to the process name via \`odata-read VwSysProcess\` \`filters {all:[{field:"Id",op:"eq",value:<SysSchemaUId>}]}\`, select \`["Caption","Name"]\` (a process's \`Id\` == its \`UId\`, so filter by **\`Id\`** — \`UId eq <guid>\` FAILS with an Edm.Guid-vs-String error, and \`Id\` is the field the helper auto-unquotes; NO \`IsMaxVersion\` filter — \`Id\` is unique and returns the one row; ProcessInModules itself has NO name/Caption column); **printables** = \`SysModuleReport\` by \`SysModule\` (\`ShowInSection\`/\`ShowInCard\`). "Checked, none found" is \`present:false\` — a valid resolved answer, NOT a skip.`, "");
  return P;
}
// Child page mappings — one design spec per related-list child, recursively embedding grandchildren. Own fn for
// Sonar CC 15. Returns the lines to push (empty when there are no child pages).
function renderChildMappings(childs) {
  if (!childs.length) return [];
  const P = ["### Child page mappings", ""];
  const renderChild = (c, lvl) => {
    const h = "#".repeat(Math.min(6, lvl));
    P.push(`${h} Child page: ${esc(c.entity)} — opened by detail "${esc(c.via)}"${c.editable === false ? " · view/attach-only" : ""}`);
    if (c.cyclic) {
      P.push(`> ↩ **Already mapped above (cycle)** — this page references back into an ancestor page on this branch (\`${esc(c.resolvedFrom || c.editPage || c.entity)}\`); its full spec appears higher in this plan and is not repeated here.`);
    } else if (c.spec) {
      P.push("", demoteHeadings(c.spec, lvl - 2)); // nest the child's own headings under this level
      for (const g of (c.childPages || [])) renderChild(g, lvl + 1); // EMBED grandchildren recursively
    } else if (c.specError) {
      P.push(`> ⚠ child schema supplied but failed to parse: ${esc(c.specError)} — fix the child manifest and re-run.`);
    } else if (typeof c.editPage === "string" && c.editPage) {
      P.push(`> ⚠ **\`${esc(c.editPage)}\` is a REAL Classic edit page — you MUST fetch it and map it here** (add it to \`childPageSchemas\` / run \`migrate.mjs --plan\` on it, then paste its design spec). NOT optional: **"view-only", "native", and "out of scope" are NOT skip reasons when the page exists.** There is no "out of scope" in this migration — limiting scope is the USER's decision to request, never yours to self-declare.`);
    } else if (c.editPage === false) {
      P.push(`> **Verified: no separate child page.** \`list-pages\` by entity \`${esc(c.entity)}\` found no Classic \`*Page\` (recorded in the manifest) → a read-only / attach-only related list; nothing to migrate here.`);
    } else if (c.editable === false) {
      P.push(`> **Read/attach-only** related list (the classic detail hides add-record) → no child edit page to map. Confirm no \`*Page\` exists for \`${esc(c.entity)}\`; if one does, add it and re-run.`);
    } else {
      P.push(`> **\`<FILL: verify child page>\`** — NOT yet verified. Run \`list-pages\` **by entity \`${esc(c.entity)}\`**: if a \`*Page\` exists, add it to \`childPageSchemas\` and re-run; if none exists, record \`"editPage": false\` on this detail and re-run. "out of scope" is never a valid self-declared skip.`);
    }
    P.push("");
  };
  for (const c of childs) renderChild(c, 4);
  return P;
}

// The template-choice banner: typed → per-type form template (+ DCM steer + shared-form note); non-typed DCM →
// progress-bar template steer. Own fn for Sonar CC 15. Returns the lines to push.
function renderTemplateBanner(result, entity, typed, someBindOnly, formTpl) {
  const dcmPresent = result.signals?.dcm?.resolved === true && !!result.signals.dcm.present;
  if (typed.length) {
    const tplBase = formTpl ? "`" + esc(formTpl) + "`" : "the chosen form template";
    const dcmBit = dcmPresent ? " — a DCM case is present, so use **`PageWithTabsAndProgressBarTemplate`** (it ships the progress bar + the top profile island) and RE-BIND the page to the entity by Type" : "";
    let sharedBit;
    if (someBindOnly) sharedBit = `The **shared base \`${esc(entity)}\` form IS rendered below** ("Shared form (base)") because ${typed.filter((t) => t.bindOnly).length} type(s) are bind-only and reuse it; own-fold types (if any) render under Typed page mappings.`;
    else sharedBit = `The base \`${esc(entity)}\` form layout is NOT shown as a separate mapping (fields are per-type below); the SHARED details/tabs are listed once under **Shared across all typed forms**.`;
    return [
      `> ⚠ **Typed entity — ${typed.length} per-type Classic edit page(s):** ${typed.map((t) => "`" + esc(t.schema) + "`").join(", ")}. Each record **Type** opens its OWN Classic page, which takes PRECEDENCE over a general Freedom RelatedPage binding — so "+ New" and open-record route to Classic unless you bind a Freedom form **per Type** (by the Type column). The per-type forms below are the deliverables; source them from \`list-entity-client-schemas\` and fold each via \`manifest.typedPageSchemas\`.`,
      `> **Template:** build every per-type form on ${tplBase}${dcmBit}. ${sharedBit}`,
    ];
  }
  if (dcmPresent) {
    const usesProgressBar = formTpl && /ProgressBar/i.test(formTpl);
    const tplWarn = formTpl && !usesProgressBar ? ` ⚠ The selected form template \`${esc(formTpl)}\` has no progress bar — reconsider it against the DCM case (or plan the MainContainer fallback explicitly).` : "";
    return [`> **Template — DCM case present:** the form page must ship a stage **progress bar**. Build it on **\`PageWithTabsAndProgressBarTemplate\`** (it ships the progress bar + the top profile island) and RE-BIND the page to the entity; hand-adding \`crt.EntityStageProgressBar\` into a plain template's MainContainer is the FALLBACK.${tplWarn}`];
  }
  return [];
}
// Typed-entity form section: the shared base form (bind-only) OR the shared details/features list (all own-fold),
// then the FULL per-type form spec for each typed page. Own fn for Sonar CC 15. Returns the lines to push.
// Typed-entity shared context: the shared base form (bind-only types reuse it) OR — when every type owns its fold
// — the shared details/features list built once on the base. Returns the lines. Extracted for Sonar CC 15.
function renderTypedSharedBlock(result, opts, entity, cs, someBindOnly) {
  if (someBindOnly) return ["### Shared form (base) — bind-only type(s) bind to this by Type", "",
    renderDesignSpec(result, { ...opts, embedded: true, formOnly: true }), ""];
  const shFeatures = cs.standardFeatures || [], shDetails = cs.details || [];
  if (!(shFeatures.length || shDetails.length)) return [];
  const P = ["### Shared across all typed forms (inherited from the base form)", "",
    `> On the base \`${esc(entity)}\` form and therefore on EVERY per-type form — build these ONCE on the shared base (the per-type sections below add only each type's own fields/groups/details):`];
  for (const f of shFeatures) P.push(`- **${esc(f.feature || f.caption || f.name || String(f))}** — standard feature`);
  for (const d of shDetails) { const ent = d.entity ? ` (${esc(d.entity)})` : ""; P.push(`- **${esc(d.caption || d.detailSchema || d.entity || "detail")}** — related list${ent}${addModeText(d.addMode)}`); }
  P.push("");
  return P;
}
// The FULL per-type form spec for each typed page (bind-only / cyclic / folded spec / parse-error / unresolved).
// Returns the lines. Extracted for Sonar CC 15.
function renderTypedPageRows(typed) {
  const P = ["### Typed page mappings", ""];
  for (const t of typed) {
    const typeNote = t.type ? ` — type "${esc(t.type)}"` : "";
    P.push(`#### Typed form: ${esc(t.schema)}${typeNote}`);
    if (t.bindOnly) P.push(`> **Bind-only** — layout identical to the base; no separate form. Bind the **Shared form (base) above** for this Type (by the Type column).`);
    else if (t.cyclic) P.push(`> ↩ **Already mapped above (cycle)** — this typed form references back into an ancestor page on this branch; its spec appears higher in this plan. Not re-embedded (would recurse forever); the structure gate treats it as resolved.`);
    else if (t.spec) P.push("", demoteHeadings(t.spec, 2));
    else if (t.specError) P.push(`> ⚠ typed-page bundle supplied but failed to parse: ${esc(t.specError)} — fix the bundle and re-run.`);
    else P.push(`> ⚠ **NOT resolved — this typed form has no design spec.** Assemble its bundle (\`get-classic-page-sources --schema-name ${esc(t.schema)}\`) into \`manifest.typedPageSchemas["${esc(t.schema)}"]\` so the engine folds its FULL per-type layout here, OR mark the \`typedPages\` entry \`{ "bindOnly": true }\` if its layout is identical to the base. **"Map at build" is not allowed** — the structure gate blocks the plan until every typed form is resolved.`);
    P.push("");
  }
  return P;
}
function renderTypedMappings(result, opts, entity, cs, typed, someBindOnly) {
  return [...renderTypedSharedBlock(result, opts, entity, cs, someBindOnly), ...renderTypedPageRows(typed)];
}

// The Overview **Size:** line. A TYPED entity has no single form deliverable (per-type fields/rules live in the
// mappings below), so it summarizes by typed-form count; a non-typed entity reports fields/details/rules/actions.
function buildSizeLine(typed, cs, fields) {
  const dcf = (cs.details || []).length + (cs.standardFeatures || []).length;
  if (typed.length) {
    const plural = typed.length === 1 ? "" : "s";
    return `- **Size:** ${typed.length} typed form${plural} (per-type fields, rules and details are in **Typed page mappings** below) · ${dcf} shared details/features · ${(cs.cardActions || []).length} actions`;
  }
  return `- **Size:** ${fields.length} fields · ${dcf} details/features · ${(cs.pageBusinessRules || []).length} rules · ${(cs.cardActions || []).length} actions`;
}

// Main-scope table rows: list page + (form page | shared base) + one row per typed form. Extracted for Sonar CC 15.
// mainCall / someBindOnly / formTpl are recomputed here (rather than passed) to stay under Sonar's parameter limit.
function buildScopeRows(pm, opts, entity, typed, fill) {
  const mainCall = pm.freedomExists ? "Update (reconcile)" : "Rebuild";
  const someBindOnly = typed.some((t) => t.bindOnly);
  const formTpl = pm.formTemplate || opts.template || null;
  const rows = [`| ${fill(pm.sectionSchema, "<FILL: section schema>")} (list page) | ${fill(pm.listTemplate, "<FILL: Freedom list template>")} | ${mainCall} |`];
  if (!typed.length) rows.push(`| ${esc(entity)} form page | ${fill(pm.formTemplate || opts.template, "<FILL: Freedom form template>")} | ${mainCall} |`);
  else if (someBindOnly) rows.push(`| ${esc(entity)} shared form (base) | ${fill(pm.formTemplate || opts.template, "<FILL: Freedom form template>")} | ${mainCall} |`);
  for (const t of typed) {
    const typeSuffix = t.type ? ` — type "${esc(t.type)}"` : "";
    const cls = `${esc(t.schema)}${typeSuffix} (typed form)`;
    let tgt;
    if (t.bindOnly) tgt = "bind shared form by Type";
    else if (formTpl) tgt = esc(formTpl);
    else tgt = "<FILL: Freedom form template>";
    rows.push(`| ${cls} | ${tgt} | ${t.bindOnly ? "Bind (per-type)" : "Rebuild (per-type)"} |`);
  }
  return rows;
}

// Child edit pages belong in Main scope too — each related list's child entity opens its OWN form on add/edit.
// Honest label by resolution state (mapped/real page → Rebuild; verified-none/view-only → Reuse; else ⚠ resolve).
function buildChildScopeRows(childs) {
  return childs.map((c) => {
    let target, call, label;
    if (c.spec || (typeof c.editPage === "string" && c.editPage)) {
      // template by field count (must AGREE with the per-child recommendation below): < 15 flat inputs → Mini page;
      // otherwise (>= 15, or tabs/related-lists) → the Grid page template. Unknown count (unmapped real page) → generic.
      const n = c.fieldCount;
      target = (n == null) ? "Freedom child page"
        : (n < 15 && !c.hasTabs && !c.nDetails) ? "Mini page (`BaseMiniPageTemplate`)"
        : "Grid page (`PageWithAreaFreedomTemplate`)";
      call = "Rebuild (child)"; label = esc(c.editPage || (c.entity + " form page"));
    } else if (c.editPage === false || c.editable === false) {
      target = "— no separate page (read/attach-only)"; call = "Reuse"; label = esc(c.entity);
    } else {
      target = "⚠ verify — does a Classic `*Page` exist for this child?"; call = "⚠ resolve"; label = esc(c.entity);
    }
    return `| ${label} — opened by detail "${esc(c.via)}"${c.editable === false ? " · view/attach-only" : ""} | ${target} | ${call} |`;
  });
}

// The "Add mini-page mapping" block (folded mini-page spec, or a ⚠ parse-error note). Empty when no mini page.
function renderMiniPageMapping(result) {
  const mp = result.miniPage;
  if (!mp || !(mp.spec || mp.specError)) return [];
  const lines = ["### Add mini-page mapping", "", `#### Mini page: ${esc(mp.schema)}`];
  if (mp.spec) lines.push("", demoteHeadings(mp.spec, 2));
  else lines.push(`> ⚠ mini-page bundle supplied but failed to parse: ${esc(mp.specError)} — fix and re-run.`);
  lines.push("");
  return lines;
}

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
  // Title, then the ⛔ top-of-plan gate/structure/planMeta/signals banners (first thing the reader sees — a
  // blocked plan is NOT approvable) — one combined push (Sonar S7778). Entity already esc'd above (esc ⊇ strip).
  const P = [];
  P.push(`## ${entity} — Classic → Freedom UI`, "", ...renderPlanBanners(result, opts));
  const signals = opts.signals || {}; // used by the On-stand signals section below
  // A TYPED entity has NO single form deliverable — each per-type page is its own form (fields/rules/details
  // live THERE, in the mappings below). The base fold's counts (often 8 fields · 0 rules) describe only the
  // shared parent, so reporting them as "Size" mis-describes the job. Summarize by typed-form count instead.
  const typed = result.typedPages || [];
  // A BIND-ONLY typed entry ("layout identical to the base") REUSES the shared base form — so that base form IS a
  // real deliverable and MUST render (else the plan says "bind the shared form" but no shared-form spec exists,
  // which is exactly how a real Lead migration lost its whole 43-field main form). The base is suppressed ONLY
  // when EVERY type has its OWN fold. `someBindOnly` gates that below.
  const someBindOnly = typed.some((t) => t.bindOnly);
  const sizeLine = buildSizeLine(typed, cs, fields);
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
  // (The Call value — Rebuild / Update (reconcile) — is derived inside buildScopeRows from `pm.freedomExists`.)
  // A TYPED entity has NO single form deliverable — every record opens a per-type page, so the per-type forms
  // (rows below) ARE the deliverables and the base `<entity> form page` is only their shared parent/seed (not
  // a separate form). A non-typed entity keeps its one form-page row. (`typed` computed above for the Size line.)
  // The Freedom form template every per-type form uses (from planMeta.formTemplate / manifest.template). Shown
  // on each typed row so the template mandate is not lost (it used to live only on the suppressed base row).
  const formTpl = pm.formTemplate || opts.template || null;
  const scopeRows = buildScopeRows(pm, opts, entity, typed, fill);
  P.push("### Main scope", "| Classic | Freedom target | Call |", "| --- | --- | --- |", ...scopeRows);
  if (pm.freedomExists) P.push("> **Reconcile:** a Freedom page for this entity already exists — do NOT create a duplicate. Read it with `get-page`, apply the design below as a customization delta (added/modified/removed-hidden), and save with `update-page`. Procedure: `./references/existing-freedom-reconcile.md`.");
  // child edit pages belong in Main scope too — each related list's child entity opens its OWN form on
  // add/edit, so it is a page in the migration TREE (a recursive sub-migration), not a side note. The
  // target is a fixed clean value (NOT a free-text FILL — that invited inconsistent status prose); the
  // "does a Freedom form already exist / follow-on" nuance lives in the Child page mappings section below.
  P.push(...buildChildScopeRows(childs), "");
  if (childs.length) P.push("> **`Rebuild (child)`** = recursive sub-migration (mapping under **Child page mappings** below). **`Reuse`** = read/attach-only related list, no separate child page. **`⚠ resolve`** = not yet verified — check `list-pages` by the CHILD entity before approval (the structure gate blocks until every child is resolved).");
  // DCM case present (resolved on-stand) → the form page MUST ship a stage progress bar. The progress bar is NOT
  // in the plain Freedom templates, so the template choice is steered to `PageWithTabsAndProgressBarTemplate`
  // (ships the bar + top island); hand-adding `crt.EntityStageProgressBar` into a plain template's MainContainer
  // is the FALLBACK. This steer applies to BOTH typed and NON-typed pages (it used to be typed-only, so a
  // non-typed DCM page silently kept whatever plain form template the agent picked).
  // Template banner, then the LIST PAGE first (so the Add mini-page mapping sits right after it), then the
  // add-mini-page mapping — one combined push (Sonar S7778); the form / per-type mappings follow below.
  P.push(
    ...renderTemplateBanner(result, entity, typed, someBindOnly, formTpl),
    "", renderDesignSpec(result, { ...opts, embedded: true, listPageOnly: true }), "",
    ...renderMiniPageMapping(result),
  );
  if (!typed.length) P.push("", renderDesignSpec(result, { ...opts, embedded: true, formOnly: true }), ""); // NON-TYPED single form
  else P.push(...renderTypedMappings(result, opts, entity, cs, typed, someBindOnly));
  // Child page mappings — one real design spec per related-list child page (the mapping the listing lacked).
  // Generated inline when the agent supplied the child's schema (childPageSchemas); otherwise a FILL slot
  // that keeps the mapping a REQUIRED, visible deliverable rather than a table row the agent treats as done.
  // NB: the Plan-vs-Done checklist is NOT emitted here — the plan is what the user approves BEFORE building, and
  // a control table there is premature. It is produced separately by `renderChecklist` (CLI `--checklist`) and
  // presented AFTER implementation. See renderChecklist below.
  P.push(...renderChildMappings(childs), "> **Supply the plan values via `manifest.planMeta` and re-run (that fills the `<FILL: …>` above), then present this VERBATIM** — ideally the file written by `--out`, not a hand-paste. Any remaining `<FILL: …>` means that planMeta value is still missing. Corrections/enrichments go in an *Adjustments* list at the very end — do NOT edit, reorder, or drop the generated tables/sections (Main scope · List page · form-page Layout/Logic/Confirm · Child page mappings).");
  return P.join("\n");
}

// Shared grouped Plan-vs-Done structure. BOTH `--checklist` (pre, all `☐ pending`) and `--verify` (post, Status
// AUTO-FILLED from the built page) render THIS same structure, so the close-gate looks EXACTLY like the grouped
// checklist Kateryna refined — not a second flat table. Each row carries an optional `vk` (verify-kind): the
// machine check against the built page (get-page). Rows WITHOUT a vk are agent-confirmed (logic / confirm / child
// / quality / placement) — surfaced so nothing is silently dropped, but NOT part of the hard machine gate.
// Grouped at tab/region granularity; business rules folded to a count; handlers + ⚠ Confirm one row each.
// Form — Layout checklist rows, grouped at top-level tab/region (fields counted, details/widgets listed).
// Own fn so checklistGroups stays under Sonar CC 15.
function buildLayoutGroupRows(cs, regionOf) {
  const top = (r) => { const s = String(r).split(" › ")[0]; return s === "Header / top" ? "Header" : s; };
  const order = [], byRegion = new Map();
  const add = (region, label) => {
    const k = top(region);
    if (!byRegion.has(k)) { byRegion.set(k, { fields: 0, items: [] }); order.push(k); }
    const e = byRegion.get(k);
    if (label) e.items.push(label); else e.fields++;
  };
  for (const f of (cs.viewConfigDiff || []).filter(isField)) add(regionOf(f.parentName), null);
  for (const d of cs.details || []) add(d.tab ? regionOf(d.tab) : "⚠ unplaced", `${esc(d.caption || d.detailSchema || d.entity || "detail")}${d.editable ? " (editable)" : ""} — related list`);
  for (const w of cs.widgets || []) add(w.placement === "tab-next-to-feed" ? "Tab · Next steps (new)" : "Header / top", esc(w.widget));
  return order.map((k) => {
    const e = byRegion.get(k);
    const parts = [];
    if (e.fields) parts.push(`${e.fields} field${e.fields === 1 ? "" : "s"}`);
    parts.push(...e.items);
    return { label: `${k} — ${parts.join(" · ")}` };
  });
}
// Form — Coverage checklist rows (the MACHINE-verifiable counts + component types, each carrying a `vk`).
// Own fn so checklistGroups stays under Sonar CC 15.
function buildCoverageRows(cs, pm, result) {
  const cover = [];
  if (pm.formTemplate) cover.push({ label: `Form template → \`${esc(pm.formTemplate)}\``, vk: { type: "template", exp: pm.formTemplate } });
  const expFields = (cs.viewConfigDiff || []).filter(isField).length;
  const expTabs = new Set((cs.viewConfigDiff || []).filter((o) => o.values?.type === "crt.Tab").map((o) => o.name)).size;
  const expDetails = (cs.details || []).length + (cs.standardFeatures || []).filter((s) => s.uiShape === "list").length;
  if (expFields) cover.push({ label: `Fields — ${expFields} expected`, vk: { type: "fields", n: expFields } });
  const expImages = (cs.images || []).length;
  if (expImages) cover.push({ label: `Image field${expImages === 1 ? "" : "s"} — ${expImages} expected (\`crt.ImageInput\`)`, vk: { type: "image", n: expImages } });
  if (expTabs) cover.push({ label: `Tabs — ${expTabs} expected`, vk: { type: "tabs", n: expTabs } });
  if (expDetails) cover.push({ label: `Related lists — ${expDetails} expected`, vk: { type: "details", n: expDetails } });
  const FEATURE_TYPE = { Approvals: "crt.ApprovalList", "Communication options": "crt.ContactCommunication", Attachments: "crt.FileList", Feed: "crt.Feed" };
  for (const s of cs.standardFeatures || []) {
    const f = s.feature || s.caption || ""; const t = FEATURE_TYPE[f];
    if (!t || s.uiShape === "list") continue; // list-shaped features are covered by "Related lists"
    cover.push({ label: `${esc(f)} (\`${t}\`)`, vk: { type: "feature", ftype: t } });
  }
  if (result.signals?.dcm?.resolved === true && !!result.signals.dcm.present) {
    cover.push({ label: "DCM case progress bar", vk: { type: "dcm-bar" } }, { label: "DCM Next steps", vk: { type: "dcm-next" } });
  }
  return cover;
}
// Pages checklist group — every page this migration creates (mini page is a page, not a footnote) plus the
// navigable-SECTION registration deliverable (one real run created pages but never registered the section, and a
// hand-built summary silently dropped it). Returns the rows. Extracted for Sonar CC 15.
function buildPageRows(result, opts, pm, typed, fill) {
  const pages = [{ label: `List page → ${fill(pm.listTemplate, "<FILL: list template>")}` }];
  if (!typed.length) pages.push({ label: `Form page → ${fill(pm.formTemplate || opts.template, "<FILL: form template>")}`, vk: { type: "formpage" } });
  for (const t of typed) { const ts = t.type ? ` — type "${esc(t.type)}"` : ""; const bo = t.bindOnly ? " (bind by Type)" : ""; pages.push({ label: `Typed form \`${esc(t.schema)}\`${ts}${bo}` }); }
  if (result.miniPage?.schema) pages.push({ label: `Mini page \`${esc(result.miniPage.schema)}\``, vk: { type: "mini" } });
  if (pm.sectionSchema || result.section) pages.push({ label: "Navigable section registered — the Freedom section appears in the app menu (`create-app-section`); the pages above are not reachable without it" });
  return pages;
}
// List-page contents checklist rows (columns / quick filters / section actions). Returns the rows. Extracted for CC.
function buildListItems(pm, section, result) {
  if (!(pm.sectionSchema || section || result.miniPage)) return [];
  const items = [{ label: "List columns" }];
  if ((section?.quickFilters || []).length) items.push({ label: `Quick filters (${section.quickFilters.length})` });
  if ((section?.sectionActions || []).length) items.push({ label: `Section actions (${section.sectionActions.length})` });
  return items;
}
function checklistGroups(result, opts = {}) {
  const cs = result.changeSet || {};
  const pm = opts.planMeta || {};
  const typed = result.typedPages || [];
  const childs = result.childPages || [];
  const fill = (v, ph) => (v != null && String(v).trim() !== "" ? esc(String(v)) : ph);
  const groups = [];
  const G = (title, rows) => { const r = rows.filter(Boolean); if (r.length) groups.push({ title, rows: r }); };
  G("Pages", buildPageRows(result, opts, pm, typed, fill));
  const section = result.section || null;
  G("List page", buildListItems(pm, section, result));
  // Form — Layout (top-level tab/region placement) + Coverage (machine-verifiable counts/components) — see helpers.
  const regionOf = regionResolver(cs.viewConfigDiff || [], cs.resources || {});
  G("Form — Layout (by tab/region)", buildLayoutGroupRows(cs, regionOf));
  G("Form — Coverage (verified)", buildCoverageRows(cs, pm, result));
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
// The verify-kind resolvers, split by category so each (and the dispatcher) stays under Sonar CC 15. Each returns
// [mark, evidence, outcome] where outcome ∈ "ok" | "missing" | "unverified" | "skip" — the caller tallies counts.
function resolveStructuralVk(vk, ctx) {
  const { ops, built } = ctx;
  if (vk.type === "formpage") return ops.length ? ["✅ Done", "form page built (get-page returned its components)", "ok"] : ["❌ MISSING", "get-page returned no components for the form page", "missing"];
  if (vk.type === "template") {
    if (!built.parentSchemaName) return ["⚠ verify", "get-page `parentSchemaName` not provided — confirm the built page's template", "unverified"];
    if (built.parentSchemaName === vk.exp) return ["✅ Done", `built on \`${esc(vk.exp)}\``, "ok"];
    return ["⚠ verify", `built on \`${esc(built.parentSchemaName)}\` but the plan recommended \`${esc(vk.exp)}\` — confirm the template (top profile island / progress bar)`, "unverified"];
  }
  if (built.miniPageBuilt === true) return ["✅ Done", "created on-stand", "ok"]; // vk.type === "mini"
  if (built.miniPageBuilt === false) return ["❌ MISSING", "NOT created — '+ New' still opens the full form", "missing"];
  return ["⚠ verify", "get-page the mini schema / pass built.miniPageBuilt", "unverified"];
}
function resolveCountVk(vk, ctx) {
  if (vk.type === "fields") { const b = ctx.ops.filter((o) => ctx.FIELD_RE.test(o.type || "")).length; return b >= vk.n ? ["✅ Done", `${b} field components on the built page`, "ok"] : ["⚠ verify", `${b} built — fewer than ${vk.n} expected; check which fields were dropped`, "unverified"]; }
  if (vk.type === "image") { const b = ctx.typeCount("crt.ImageInput"); return b >= vk.n ? ["✅ Done", `${b} crt.ImageInput built`, "ok"] : b > 0 ? ["⚠ verify", `${b}/${vk.n} crt.ImageInput built`, "unverified"] : ["❌ MISSING", "no crt.ImageInput on the built page — the image field was not added", "missing"]; }
  const noun = vk.type === "tabs" ? "crt.Tab" : "crt.DataGrid"; // tabs | details
  const b = ctx.typeCount(noun);
  if (b >= vk.n) return ["✅ Done", `${b} ${noun} built`, "ok"];
  if (b > 0) return ["⚠ verify", `${b}/${vk.n} ${noun} built`, "unverified"];
  return ["❌ MISSING", `no ${noun} built`, "missing"];
}
function resolveComponentVk(vk, ctx) {
  const { hasType, parentTpl } = ctx;
  if (vk.type === "feature") return hasType(vk.ftype) ? ["✅ Done", `found ${vk.ftype}`, "ok"] : ["❌ MISSING", `NO ${vk.ftype} on the built page`, "missing"];
  if (vk.type === "dcm-bar") { const ok = hasType("crt.EntityStageProgressBar") || /ProgressBar/i.test(parentTpl); return ok ? ["✅ Done", hasType("crt.EntityStageProgressBar") ? "crt.EntityStageProgressBar built" : `provided by ${esc(parentTpl)}`, "ok"] : ["❌ MISSING", `no crt.EntityStageProgressBar and template is \`${esc(parentTpl)}\``, "missing"]; }
  if (vk.type === "dcm-next") return hasType("crt.NextSteps") ? ["✅ Done", "crt.NextSteps built", "ok"] : ["❌ MISSING", "no crt.NextSteps tab on the built page", "missing"];
  return hasType("crt.Button") ? ["✅ Done", "a crt.Button is present — confirm it triggers the action", "ok"] : ["⚠ verify", "no crt.Button found — confirm the action", "unverified"]; // card
}
const VK_STRUCTURAL = new Set(["formpage", "template", "mini"]);
const VK_COUNT = new Set(["fields", "tabs", "details"]);
const VK_COMPONENT = new Set(["feature", "dcm-bar", "dcm-next", "card"]);
function resolveVk(vk, ctx) {
  if (!vk) return ["☐ confirm on-stand", "not derivable from get-page — confirm (render / on-stand query)", "skip"];
  if (VK_STRUCTURAL.has(vk.type)) return resolveStructuralVk(vk, ctx);
  if (VK_COUNT.has(vk.type)) return resolveCountVk(vk, ctx);
  if (VK_COMPONENT.has(vk.type)) return resolveComponentVk(vk, ctx);
  return ["⚠ verify", "confirm on-stand", "unverified"];
}

export function renderVerify(result, opts = {}, built = {}) {
  const ops = Array.isArray(built.ops) ? built.ops : [];
  const parentTpl = built.parentSchemaName || opts.planMeta?.formTemplate || "";
  const typeCount = (t) => ops.filter((o) => (o.type || "") === t).length;
  const hasType = (t) => typeCount(t) > 0;
  const FIELD_RE = /^crt\.(Input|ComboBox|DateTimePicker|Checkbox|NumberInput|MoneyInput|ColorEdit|TextArea|MultilineInput)$/;
  let missing = 0, unverified = 0;
  const ctx = { ops, built, typeCount, hasType, FIELD_RE, parentTpl };
  // Resolve a row's machine Status from the built page (via the split resolvers above); tally the counts here.
  // vk-less rows → agent-confirmed (outcome "skip", not part of the gate).
  const resolve = (vk) => {
    const [mark, ev, outcome] = resolveVk(vk, ctx);
    if (outcome === "missing") missing++;
    else if (outcome === "unverified") unverified++;
    return [mark, ev];
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
