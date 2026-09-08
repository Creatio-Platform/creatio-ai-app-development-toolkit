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
import { featureVerifyType, featureVerifyExtraTypes, analogsOf } from "./mapping-table.mjs"; // ENG-95543: the feature -> crt.* gate types, from the ONE shared table; ENG-95859: a feature's OTHER required halves
import { LIST_GRID, LIST_FILTER_TYPE } from "./mapper.mjs"; // the grid + filter control the ChangeSet targets — the gate must require the same
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
// A form's "content field" count for STRUCTURE gates (hollow-form / typed / child folds). A bound INPUT is either
// control-bound (every normal field) OR a `crt.ImageInput` — which binds through `value`, NOT `control`. Counting
// only `values.control` (as the fold gates did) made an image-only quick-add form (photo / signature — squarely in
// ENG-93926's mini-page domain) read as 0 fields → a false "EMPTY Layout, do not proceed" hard-block / mis-template.
// This is the ONE shared field-count, aligned with renderVerify (which likewise expects fields + image inputs).
// NB deliberately NOT folded into `isField`: that predicate feeds the Layout fields TABLE (which strips
// `values.control`) and images render via their own rowsForImages path — merging them would break the table.
export const countFormFields = (diff) =>
  (diff || []).filter((o) => o?.values && (o.values.control != null || o.values.type === "crt.ImageInput")).length;
const DASH = "—";

// Climb the emitted insert tree from a container to the region that holds it: crt.Tab → that tab,
// SideAreaProfileContainer → the side profile (with the island container appended, #9b), Header → header,
// else the raw container name (a base-template container not re-emitted here).
// The nearest CAPTIONED group label for a container, or null — resolved real text OR a human-readable key, but
// NOT an auto-generated hex-hash noise key. Extracted so the region resolver stays under Sonar CC 15.
export function captionGroupLabel(o, resources) {
  const raw = o.values?.caption;
  if (!raw) return null;
  const t = resources[resourceKey(raw)] ?? resourceKey(raw);
  const resolved = resources[resourceKey(raw)] != null;
  // Auto-generated designer keys carry a hash chunk (e.g. `Tab67ea6463TabLabelGroupc1bf3d46…`) — a hex run that
  // always contains DIGITS. A bare `/[0-9a-f]{6}/` also matched ordinary hex-LETTERED words (facade, decade, beaded),
  // wrongly suppressing a real unresolved caption. Anchor to the auto-key shape: a hex run of >=6 that contains a
  // digit (a GUID's first segment qualifies too) — pure-letter hex words no longer trip it.
  const hexRun = t.match(/[0-9a-f]{6,}/i);
  const looksNoise = !!hexRun && /\d/.test(hexRun[0]);
  return (resolved || !looksNoise) ? esc(t) : null;
}
function regionResolver(viewConfigDiff, resources = {}) {
  const byName = new Map(viewConfigDiff.map((o) => [o.name, o]));
  // Major 4 — a caption is a `$Resources.Strings.<key>` binding; show its human text from the resource map
  // (the plan stays readable) — fall back to the key when the text is not resolved.
  // A caption reaches here in ONE of two localizable forms and they normalize differently:
  //   group / field : `$Resources.Strings.<key>`      -> resourceKey() (which also strips a `#en-US` culture anchor)
  //   TAB           : `#ResourceString(<key>)#`       -> the key is INSIDE the delimiters
  // `resourceKey` strips everything from the first `#`, so a tab caption would normalize to "" and every tab
  // Region would render as a bare `Tab · `. Match the tab form FIRST and leave `resourceKey` alone — its
  // `#`-strip is the culture-anchor rule a live golden pins (`$Resources.Strings.Foo#en-US` -> `Foo`).
  const RESOURCE_STRING_CALL = /^#ResourceString\(([^)]+)\)#$/;
  const captionKeyOf = (raw) => {
    const m = RESOURCE_STRING_CALL.exec(String(raw ?? "").trim());
    return m ? m[1].trim() : resourceKey(raw);
  };
  const capText = (raw) => { const k = captionKeyOf(raw); return resources[k] ?? k; };
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
      // from when that container was a catch-all with no real tab. The mapper now emits it as a proper `crt.TabContainer`
      // (isTab, caption "General information"), so the normal tab climb below resolves it to "Tab · General
      // information". The hardcode short-circuited BEFORE that check and falsely flagged ~20 real General-info
      // fields as unresolved on every page that has this tab.)
      const o = byName.get(p);
      if (!o) return esc(p);
      if (o.values?.type === "crt.TabContainer") return tabRegionLabel(o, group);
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
    // COMPACT per-field marker — the full cross-datasource recipe is printed ONCE under the Layout table (see
    // `linkedFieldsNote`), not repeated verbatim on every linked field (it was ~5× the same paragraph on a page).
    const nearestNote = Array.isArray(v.linkedNearest) && v.linkedNearest.length ? ` · if renamed, nearest: ${v.linkedNearest.map(esc).join(", ")}` : "";
    const linked = v.linkedValue ? "↳ linked (read-only) — bind via the lookup (recipe below)" + nearestNote : null;
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
  // Same `Array.isArray` guard as `sigLine`: a bare-string answer must degrade to "no list", not throw mid-render.
  const sigList = (s) => { const raw = s?.cases || s?.items || s?.names; return (Array.isArray(raw) ? raw : []).map((x) => esc(typeof x === "string" ? x : (x && (x.name || x.caption)) || "")).filter(Boolean).join(", "); };
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
// ENG-95543 — one Layout row per element the shared mapping table emitted (`crt.Label` / `crt.Button` /
// `crt.Link`). These carry no `values.control`, so `isField` cannot see them and without this builder they would be
// built and invisible in every table the reader looks at. A tier-B element says so in its note: the view is built,
// the classic click still has to be ported into the named request.
function rowsForTableElements(elements, regionOf) {
  return (elements || []).map((el) => {
    const src = `classic ${esc(String(el.classicKind || "element"))}`;
    // Built in two statements rather than one nested template: the inner backtick-quoting of each folded name is
    // its own expression, so the note below reads as prose instead of as three levels of interpolation.
    const foldedNames = (el.folded || []).map((f) => "`" + esc(f) + "`").join(", ");
    const foldNote = foldedNames ? ` (folds ${foldedNames})` : "";
    const note = el.request
      ? `→ \`${esc(el.componentType)}\`${foldNote} — view built; its classic click is NOT ported: wire the \`${esc(el.request)}\` request handler`
      : `→ \`${esc(el.componentType)}\`${foldNote} — built from the classic element's own config`;
    return { region: el.parent ? regionOf(el.parent) : "⚠ unplaced", sort: 0,
      cells: [esc(el.classic), esc(el.componentType), src, el.tier === "B" ? "behaviour stub" : DASH, note] };
  });
}

function rowsForImages(images, regionOf) {
  return (images || []).map((im) => {
    // Source = the resolved IMAGELOOKUP column when known; a related-object photo shows its lookup path; a FILL
    // slot when the column could not be resolved. The mapper emits a real crt.ImageInput either way.
    const colLabel = im.crossDs ? `\`${esc(im.column)}\` (related object — via lookup)` : `\`${esc(im.column)}\``;
    const src = im.column ? colLabel : "`<FILL: image column>`";
    let note;
    if (im.crossDs) note = "→ `crt.ImageInput`, `value` bound through the lookup READ-ONLY (related-object photo); must be an IMAGELOOKUP column";
    else if (im.column) note = "→ `crt.ImageInput` bound via `value` to this IMAGELOOKUP column";
    else note = "→ `crt.ImageInput` — bind `value` to the entity's IMAGELOOKUP (16) column (add it to `entityColumns`); if the photo is from a related object bind through its lookup read-only; if none exists, create an ImageLookup column";
    return { region: im.parent ? regionOf(im.parent) : "⚠ unplaced", sort: 0, cells: [esc(im.classic), "crt.ImageInput", src, im.crossDs ? "read-only" : DASH, note] };
  });
}

// ENG-93928 — an embedded profile card (a compact card of a LINKED record). It is real page CONTENT, so it gets
// its own Layout row in the region it sat in (the side profile on every real page), with the Freedom component
// and its `referenceColumn` wiring in Source — the full instructions stay in the ⚠ Confirm item.
function rowsForProfileCards(profileCards, regionOf) {
  return (profileCards || []).map((pc) => {
    // Known limitation, shared with every other row builder that calls regionOf: when the card sat in a tab the
    // template declares (e.g. `ESNTab`), regionOf has no human label for it and returns the raw schema identifier.
    // Not specific to profile cards, so it is left consistent rather than special-cased here.
    const region = pc.region === "SideAreaProfileContainer" ? "Side profile" : regionOf(pc.region);
    const label = esc(pc.schemaName || pc.classic);
    const src = pc.freedom
      ? `${esc(pc.freedom)} · referenceColumn \`$${esc(pc.masterColumn)}\``
      : `⚠ no native compact profile for ${esc(pc.entity || "the profiled entity")} — read-only fields via \`${esc(pc.masterColumn)}.<column>\``;
    const parts = [];
    if (pc.package) parts.push(`needs \`${esc(pc.package)}\``);
    if (pc.fields?.length) parts.push(`classic showed: ${pc.fields.map(esc).join(" · ")}`);
    else if (pc.schemaVerifiedNone) parts.push("no separate profile schema (verified) — rebuild the card per the mapping recipe");
    else if (!pc.schemaSupplied) parts.push("⚠ profile schema not supplied — contents unresolved");
    return { region, sort: 0, cells: [label, "Profile card", src, "read-only", parts.join(" · ") || DASH] };
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
// Build the Logic-table rows (declarative page rules → entity/lookup filters → process launch).
// Logic carries what the engine MAPPED. Methods belong to `⚠ Imperative logic` only — one method, one row, in the
// table that carries the port obligation and traces the trigger from the data.
// Own fn so renderDesignSpec stays under Sonar CC 15. Returns an array of [behaviour, trigger, effect, target].
function buildLogicRows(cs) {
  const logic = [...pageRuleRows(cs), ...entityFilterRows(cs)];
  if ((cs.needsDecision || []).some((n) => n.kind === "process-launch")) {
    const pn = cs.needsDecision.find((n) => n.kind === "process-launch")?.item;
    logic.push(["Run process", "Run process action", `launch ${esc(pn || "process")}`, pn ? "⚠ verify process name/binding" : "⚠ which process — resolve on-stand via `ProcessInModules` (section SysModule) → `VwSysProcess` by Id"]);
  }
  return logic;
}

// The `#### Logic` section. Rendered whenever the page has rules OR methods: a missing section reads as "the engine
// dropped the rules", not as "there are none", so an all-imperative page states the absence and points at the method
// worklist instead. Own fn so renderDesignSpec stays under Sonar CC 15. Returns the lines to push.
function renderLogicSection(cs) {
  const logic = buildLogicRows(cs);
  const stubCount = (cs.handlerStubs || []).length;
  if (!logic.length && !stubCount) return [];
  const table = logic.length
    ? ["| Behaviour | Trigger | Effect | Freedom target |", "| --- | --- | --- | --- |",
      ...logic.map((row) => `| ${row.join(" | ")} |`)]
    : ["> No declarative business rules or lookup filters on this page."];
  const pointer = stubCount ? ["", `> ${stubCount} custom method(s) — see **⚠ Imperative logic** below.`] : [];
  return ["#### Logic", ...table, ...pointer, ""];
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
// The `- **List columns:**` line. PROVENANCE decides the wording, and it is load-bearing: `schema-default` is what
// the Classic list actually declares, so the open question NARROWS to "keep this set in Freedom?"; `entity-default`
// is a single-column fallback (the entity's primary display column) that the Classic section never declared, so
// rendering it bare would present a fallback as the analyzed Classic list; `none` keeps the question open. The
// explanation itself comes from `listColumnNotes` (the resolver's own wording) rather than being re-invented here.
// The text is USER-FACING (`plan.md` is presented verbatim), so it names only what the user can see in the
// product. Tool/storage details stay in the discovery instructions and must not reach the rendered plan.
// Strip a note's trailing sentence punctuation / whitespace. A single-pass scan rather than `/[.;\s]+$/` — an
// anchored one-or-more character class backtracks super-linearly on a long non-matching tail (Sonar S8786), and
// these notes come from clio's response, not from us.
function stripNoteTail(note) {
  let end = note.length;
  while (end > 0 && (note[end - 1] === "." || note[end - 1] === ";" || /\s/.test(note[end - 1]))) end--;
  return note.slice(0, end);
}
function listColumnLine(section) {
  // Notes arrive from several producers (the on-stand resolver, the disagreement note), so their trailing
  // punctuation is not ours to assume — strip it before joining, or a note ending in `.` renders as `.; `.
  const notes = (section.listColumnNotes || [])
    .filter((n) => typeof n === "string" && n)
    .map(stripNoteTail)
    .filter(Boolean);
  const why = notes.length ? ` (${notes.map(esc).join("; ")})` : "";
  const cols = section.listColumns || [];
  // An empty set has TWO distinct causes and the data already tells them apart: `null` means no resolver ever ran
  // (nothing was parsed and no on-stand read was supplied), `"none"` means the resolver ran and found nothing.
  // Rendering the second wording for the first asserts a resolution that never happened and names no remedy.
  // A REJECTED on-stand read also leaves `listColumnSource == null`, and the branch below would then print the one
  // remedy that is already done — record a response / bundle the chain — costing the reader a wasted round. The
  // rejection is the cause, it is already named as a structure issue, and re-supplying the same response fixes
  // nothing; point at that issue instead. Must precede the `listColumnSource == null` branch.
  if (!cols.length && section.listColumnReadRejected) {
    return `- **List columns:** ⚠ NOT resolved — an on-stand list-column read was supplied but could not be used, and the section chain declares none${why}, so the Classic column set is unknown (Classic also keeps each user's visible set as per-user list/profile data). Fix the cause named in the list-column issue above and re-run — re-recording the same response will not resolve it`;
  }
  if (!cols.length && section.listColumnSource == null) {
    return `- **List columns:** ⚠ NOT resolved — the section chain declared none and no on-stand read was supplied${why}, so the Classic column set is unknown (Classic also keeps each user's visible set as per-user list/profile data). Record a \`get-classic-list-columns\` response under \`manifest.section.listColumns\`, or bundle the \`*Section\` chain into \`manifest.section\`, then confirm which columns the Freedom list should show`;
  }
  if (!cols.length) return `- **List columns:** ⚠ no default column set was resolved${why} — confirm which columns the Freedom list should show`;
  const rendered = cols.map(esc).join(" · ");
  if (section.listColumnSource === "entity-default") {
    return `- **List columns:** ⚠ ${rendered} — the Classic section declares NO list columns, so this is a single fallback column${why}, NOT the column set the Classic list was configured with — confirm which columns the Freedom list should show`;
  }
  // ENG-95850 (D) — say WHERE a profile-sourced set came from. It is the set the list actually renders (which is why
  // the engine takes it over the static declaration), and it is also profile data that can be scoped — the reader
  // has to know which of the two they are confirming.
  if (section.listColumnSource === "profile") {
    return `- **List columns:** ${rendered}${why} — read from the saved grid PROFILE the Classic list actually renders (Classic keeps each user's visible set as per-user list/profile data), NOT from the section's static declaration, which usually names fewer columns; a profile can be scoped, so confirm this is the set every user should get in Freedom`;
  }
  return `- **List columns:** ${rendered}${why} — the Classic list shows these columns; confirm this set is kept in Freedom`;
}
// The list page's own LAYOUT tables — the positioned contents of `result.listChangeSet`. Same STATUS as the form's
// Layout table (a machine artifact, presented verbatim), different SHAPE: a grid has no regions to fill, so it
// renders as an ordered column set plus one filter container plus one command bar, never as the form's
// `Region | Element | Type | Source | Rule | Additional` table.
// ONE table per function: each surface reads as its own shape, and no single function carries every branch.
// The TYPE cell states the resolved `dataValueType` or says it is unresolved — never a guessed enum.
function listColumnsTable(columns) {
  if (!columns.length) return [];
  const L = ["", "#### List columns (in order)", "| # | Column | Grid column | Source | Type |", "| --- | --- | --- | --- | --- |"];
  columns.forEach((c, i) => {
    const ref = c.ref ? ` → ${esc(c.ref)}` : "";
    const type = c.dataValueType == null
      ? `⚠ ${esc(c.classicType || "UNKNOWN")} — \`dataValueType\` unresolved`
      : `${esc(c.classicType || "?")} (\`dataValueType\` ${c.dataValueType})${ref}`;
    const src = c.isPath ? `PDS.${esc(c.root)} (from \`${esc(c.name)}\`)` : `PDS.${esc(c.root)}`;
    L.push(`| ${i + 1} | ${esc(c.name)} | \`${esc(c.code)}\` | ${src} | ${type} |`);
  });
  return L;
}
// A filter's row is its PLACEMENT: which element, which container, at which index, on which column, as which control.
function listFiltersTable(filters) {
  if (!filters.length) return [];
  const L = ["", "#### Quick filters", "| Classic filter | Freedom element | Container | Column | Control |", "| --- | --- | --- | --- | --- |"];
  for (const f of filters) {
    const ctrl = f.quickFilterType == null
      ? `⚠ ${esc(f.classicType || "UNKNOWN")} — no known \`quickFilterType\``
      : `\`${LIST_FILTER_TYPE}\` · ${esc(f.quickFilterType)}`;
    L.push(`| \`${esc(f.classicName || "—")}\` | \`${esc(f.name)}\` | \`${esc(f.parentName)}\` · index ${f.index} | ${esc(f.column || "—")} | ${ctrl} |`);
  }
  return L;
}
// Row actions carry no op — see the note this appends. The condition is the deliverable: an always-enabled port of a
// conditionally-enabled Classic action is a behaviour change.
function listRowActionsTable(rowActions) {
  if (!rowActions?.length) return [];
  const L = ["", "#### Row actions", "| Action | Condition | Source package | Freedom target |", "| --- | --- | --- | --- |"];
  for (const ra of rowActions) {
    const cond = ra.condition ? `\`${esc(ra.condition)}\` — carry as Freedom state` : "⚠ none declared — confirm on-stand";
    const pkg = ra.sourcePackage ? esc(ra.sourcePackage) : "—";
    L.push(`| \`${esc(ra.name || "—")}\` | ${cond} | ${pkg} | ⚠ row action on \`${esc(ra.grid)}\` — control and placement NOT resolved here |`);
  }
  L.push("", "> ⚠ **A row action carries no op in this ChangeSet.** Every other op here reproduces a shape measured on a built Freedom page; no such measurement exists for a row action, so the control and its placement are read off a built page rather than guessed. The name, the condition and the grid it belongs to are the resolved facts.");
  return L;
}
// The command bar states its SOURCE, because that source is known to be incomplete until the section view `diff` is
// folded — the ⚠ Confirm item carries the question.
function listCommandBarTable(actions) {
  if (!actions.length) return [];
  const L = ["", "#### Command-bar actions",
    "| Action | Caption | Icon | Condition | Menu position | Source package | Source | Freedom target |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const a of actions) {
    // Same columns the Row actions table publishes: a name alone cannot build a button, and an action ported
    // without its `Enabled` condition ships always-enabled. `Menu position` carries the separator-delimited
    // group and the submenu container, which are the only record of the classic menu's shape.
    const cap = a.caption ? `\`${esc(a.caption)}\`` : "⚠ none read — confirm on-stand";
    const cond = a.condition ? `\`${esc(a.condition)}\` — carry as Freedom state` : "⚠ none declared — confirm on-stand";
    const place = [`group ${a.group ?? 0}`, a.parent ? `under \`${esc(a.parent)}\`` : null].filter(Boolean).join(" · ");
    L.push(`| \`${esc(a.name)}\` | ${cap} | ${a.icon ? "`" + esc(a.icon) + "`" : "—"} | ${cond} | ${place}`
      + ` | ${a.package ? esc(a.package) : "—"} | \`${esc(a.source)}\` | list-page command bar — ⚠ container NOT resolved here |`);
  }
  return L;
}
function renderListLayoutTables(lcs) {
  return [
    ...listColumnsTable(lcs.columns),
    ...listFiltersTable(lcs.quickFilters),
    ...listRowActionsTable(lcs.rowActions),
    ...listCommandBarTable(lcs.commandBarActions),
  ];
}
// The build instructions the ops cannot carry themselves — each names a place this ChangeSet is deliberately PARTIAL,
// so a builder cannot mistake it for a finished page body: a Freedom grid column requires a GUID `id`, for which the
// engine has no stable source, and a quick-filter op carries placement facts only, not the component's nested config.
// (The `filterAttributes` merge hazard is NOT here — it is a real question with a real answer, so it rides the
// `list-filter-attributes` ⚠ Confirm item, where it is gated rather than merely printed.)
function renderListBuildNotes(lcs) {
  const L = [];
  if (lcs.columnIdsAssignedByBuilder) {
    L.push("", "> **Build note — column ids:** each grid column also needs a GUID `id`. The engine does not mint one (it has no stable source), so the builder assigns it per column.");
  }
  if (lcs.quickFilterConfigCompletedByBuilder) {
    L.push("", "> **Build note — a quick-filter op is placement, not a finished component:** it carries the element name, its container and index, the filtered column and the control — the engine's resolvable facts. `crt.QuickFilter` also needs its own nested filter config and value binding, and it is `compositeOnly` with no published composite recipe, so complete it from that component's documentation (`get-component-info crt.QuickFilter`) rather than treating these `values` as the whole body.");
  }
  return L;
}
// The `### List page` block (section concerns: add-record, columns, quick filters, section actions, process).
// Own fn so renderDesignSpec stays under Sonar CC 15. Returns the lines to push.
function renderListPageBlock(result, section, opts = {}) {
  const L = ["### List page"];
  // The plan is the document an operator APPROVES, so it must not present a full build spec for a page the run
  // deliberately does not build. Same treatment as the `Navigable section registered` row: state the decision, then
  // keep the contents as a record of what a later run — the one that adds the menu entry — would build.
  if (opts.sectionHostMode === "pages-only-no-menu") {
    L.push("", "> ⚠ **NOT built in this run** (`placement.sectionHost.mode = pages-only-no-menu`): no section is registered, so no list page is minted. Everything below records what a list page WOULD carry, for the run that adds the menu entry.", "");
  }
  if (!section?.schemaGathered) L.push("- ⚠ **Section schema not gathered** — the classic `*Section` chain is not in `manifest.section`, so the list page's **quick filters / section actions were NOT analyzed** (resolved list-column evidence, when shown below, does not replace the schema chain). `get-classic-page-sources` derives the section name from the entity (`<entity>Section[V2]`); if the real section is named off the page prefix (e.g. `Applicant1Page` → `Applicant1Section`) it returns `sectionLayerCount: 0`. Bundle the section schema by name into `manifest.section` and re-run.");
  L.push(`- **Add record:** ${addRecordDescription(result)}`);
  if (section) {
    L.push(listColumnLine(section));
    if (section.processLaunch) L.push(`- **Section process:** ⚠ launches ${(section.processNames || []).map(esc).join(", ") || "a process"} — wire as a list-page run-process action`);
  }
  // The tables replace the former `Quick filters:` / `Section actions:` bullets — same facts, but positioned and
  // traceable to the ops a builder applies. The bullets stated them as prose no build step could consume.
  const lcs = result.listChangeSet;
  // …and its own ⚠ Confirm section, from the SAME `needsDecision` mechanism the form page uses: a list-page decision
  // is an open question with an owner, not a note in prose.
  if (lcs) L.push(...renderListLayoutTables(lcs), ...renderListBuildNotes(lcs), ...renderConfirmWorklist(lcs));
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
    L.push("> ⛔ **STRUCTURE INCOMPLETE.** Required detail / profile / child-page schemas are not supplied — the plan cannot be complete; fetch them and re-run:");
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

// The ONE child-page template rule (vanislemarina review), shared by the recommendation banner and the Main-scope
// row so they can't drift: a related-list child with FEWER THAN 15 inputs AND flat (no tabs, no related lists) →
// "mini"; otherwise (>= 15 inputs, OR it has tabs/related lists) → "grid". `n === 0` → null (nothing to recommend).
// Single cut at 15, no gap.
export function childTemplateChoice(n, hasTabs, nDetails) {
  if (!n) return null;
  return (n < 15 && !hasTabs && !nDetails) ? "mini" : "grid";
}
// The template SCHEMA NAME each choice resolves to. Exported (and used by the banner below) so the recommendation
// prose, the Main-scope row and the sub-page checklist's `template` vk cannot drift: a child page folded as "mini"
// is verified against the very schema name the plan told the agent to build on. A `null` choice has no entry here
// — such a page emits NO template row at all rather than one nobody can satisfy.
export const CHILD_TEMPLATE_SCHEMA = { mini: "BaseMiniPageTemplate", grid: "PageWithAreaFreedomTemplate" };
// The `values.type` spellings that denote ONE TAB. Exported so every tab predicate reads the SAME list — the
// child-template banner here, `expTabs`, the BUILT_TYPES gate below, and migrate.mjs's fold-time `hasTabs` — and a
// platform rename stays a one-line change. `crt.TabContainer` is what the mapper emits and what a real stand
// builds; `crt.Tab` is kept only as a legacy spelling (see the BUILT_TYPES note).
export const TAB_TYPES = ["crt.TabContainer", "crt.Tab"];
export const isTabOp = (o) => TAB_TYPES.includes(o?.values?.type);
// Child-page template recommendation banner. Applies to related-list child pages only.
function childFormRecommendation(cs, fields, opts) {
  if (!opts.isChildPage) return [];
  const hasTabs = (cs.viewConfigDiff || []).some(isTabOp);
  const nDetails = (cs.details || []).length + (cs.standardFeatures || []).filter((s) => s.uiShape === "list").length;
  const n = fields.length;
  const choice = childTemplateChoice(n, hasTabs, nDetails);
  if (!choice) return [];
  if (choice === "mini")
    return [`> **Recommendation — small child form (${n} field${n === 1 ? "" : "s"}, < 15, flat):** open this related-list child as an **edit mini page (\`${CHILD_TEMPLATE_SCHEMA.mini}\` — "Mini page") / modal** — a lightweight quick-add shell — rather than a full record page. Confirm the desired shell before building.`, ""];
  const why = hasTabs || nDetails ? "it has tabs / related lists" : `${n} inputs (>= 15)`;
  return [`> **Recommendation — child form (${n} field${n === 1 ? "" : "s"}):** build this related-list child on the **Grid page template (\`${CHILD_TEMPLATE_SCHEMA.grid}\`)** — ${why}, so a full-width grid suits it better than the narrow left-profile default or a mini page. Confirm before building.`, ""];
}

// Header-template recommendation: a WIDE/populated Classic Header block (the mapper's `headerLayout === "wide"`
// signal) means the Freedom target should be the top-area template so the header elements land in
// TopAreaProfileContainer, not the narrow left profile. Applies to the base record page and each TYPED per-type
// page. NOT to a mini page (no such choice) and NOT to a CHILD edit page: a child's template is decided by the
// field-count rule (childFormRecommendation → Mini vs Grid), and a top-area-template steer there both conflicts
// with that (a mini page has no header area) and mis-fires on a flat child whose fields merely sit in a Header
// container. This is the engine surfacing the header→template rule the same way `signals.dcm` surfaces the bar.
function headerTemplateRecommendation(cs, opts) {
  if (opts.isMiniPage || opts.isChildPage || cs.headerLayout !== "wide") return [];
  return [`> **Template recommendation — header elements present:** the Classic page has a populated Header block, so build this form on the **top-area template \`PageWithTopAreaAndTabsFreedomTemplate\`** ("Tabbed page with area on top") and place the header elements in **\`TopAreaProfileContainer\`** — not the narrow left profile. If the object ALSO has a DCM case, prefer the progress-bar template and place the header elements per \`creatio-ui-guidelines\`.`, ""];
}

// Decision kinds that ALREADY have a section of their own — Layout, Child pages, or, for `method`, the
// ⚠ Imperative logic worklist — so re-listing them in the "⚠ Confirm" worklist (spec) or the "⚠ Confirm worklist"
// checklist group (below) would double-report them. `method` belongs here for the WORKLIST, not because a method
// appears in the Logic table: it does not. Removing it from this Set puts every method in two worklists at once.
// ONE const for both readers: they were two identical literals that had to be edited in lockstep to stay honest.
// The ⚠ Imperative members worklist — declared on this page, behaviour living OUTSIDE the page body. Same standing as
// methods: each is a port unit that must end up ported / dropped / blocked, not a question with an on-stand answer.
// `attribute-dependency` is deliberately absent — it is the trigger of a method that already has its own row.
// What each kind IS, stated ONCE above the table instead of repeated verbatim on every row of that kind.
const MEMBER_KIND_NOTE = {
  mixin: "**mixin** — members defined in ANOTHER schema, so none of the behaviour is in this page body. Port what it contributes (an entity-parameterized mixin can also carry actions and messages); check whether the Freedom template already provides an equivalent.",
  message: "**message** — sandbox wiring whose counterpart lives in another schema. Find the counterpart, then rebuild it as a handler-mediated request, a shared service or an explicit event. A subscribe with no publisher found is an unresolved thread, not \"no behaviour\".",
  "attribute-virtual": "**attribute-virtual** — page UI state with NO entity column behind it, so no field insert carries it. Create it as a Freedom view-model attribute (with its default) and re-wire whatever read it.",
  "attribute-imperative": "**attribute-imperative** — a sub-key defined as a FUNCTION: a computed value the engine reads as present but cannot evaluate. Implement as a converter, virtual attribute or handler.",
  "attribute-lookup-filter": "**attribute-lookup-filter** — the lookup is filtered IMPERATIVELY via `lookupListConfig.filters`, which does NOT come across as a declarative FILTRATION rule. Rebuild as a Freedom lookup-filter handler (or an entity business rule when the filter is static).",
  "module-dep": "**module-dep** — `define()` dependencies with no row of their own: constants/enum modules hold the lookup GUIDs the rules compare against, utility modules hold logic the page calls.",
  "referenced-module": "**referenced-module** — renders UI OUTSIDE this page's diff, so its controls are not in the ChangeSet. Port it manually, or confirm the target template provides it.",
};
// Exported so the golden can pin the set relation against HANDOFF_MEMBER_KINDS: a kind that renders in the table
// but is missing from the digest prints a `⚠ not described` cell no step-5.1 run can fill.
export const IMPERATIVE_MEMBER_KINDS = Object.keys(MEMBER_KIND_NOTE);
const ATTRIBUTE_DEPENDENCY_NOTE = "**attribute-dependency** — column-change trigger whose handler row was not found in this schema. Rebuild the on-change behaviour, or resolve the missing/external handler before marking it done.";
// The CHECKLIST group is broader than the plan table: it also carries `attribute-dependency`, whose row the plan
// omits (the handler method carries it there). The checklist proves completeness member by member, and the
// attribute is its own member — dropping its row would report the method while the attribute went untracked.
const MEMBER_WORKLIST_KINDS = new Set([...IMPERATIVE_MEMBER_KINDS, "attribute-dependency"]);
const SHOWN_ELSEWHERE = new Set(["process-launch", "standard-feature", "widget", "card-action", "method", "detail-editpage",
  // Imperative MEMBERS have their own worklist (⚠ Imperative members), for the same reason methods do: they are work
  // to port, not questions to answer, and a flat bullet list cannot grade an aspect the way a table cell can.
  ...IMPERATIVE_MEMBER_KINDS,
  // `attribute-dependency` is normally the trigger of a handler method, and that method already has an ⚠ Imperative
  // logic row carrying it. Orphan dependencies whose handler row is missing are injected into ⚠ Imperative members
  // by renderImperativeMembers(), so they stay visible without double-listing normal method triggers.
  "attribute-dependency"]);
// The "⚠ Confirm before I build" worklist — the GENUINE open decisions only (kinds carried by Layout, Child-pages
// or the ⚠ Imperative logic worklist are not re-listed), plus the C2 lookup-GUID prompt. Returns the lines.
function renderConfirmWorklist(cs) {
  // `reason` is escaped with `esc` (not `strip`): the mapper interpolates raw stand-derived tokens into it
  // (container/field names, captions, bound hints), all attacker-chosen on a hostile stand. `strip` alone leaves
  // `<`/`>`/backtick/`](` live; `esc` neutralizes those. Whole-string `esc` is omission-proof and the
  // engine-authored parts of every reason are plain prose (audited). Keep new reasons that way (put any code
  // identifier or angle-bracketed token in `item`, which is likewise `esc`d). Removals are NOT a worklist item.
  // Every card-carrying kind is in SHOWN_ELSEWHERE, so what reaches here needs an ON-STAND answer, not a 5.1 card:
  // no `described in` and no card tally — those belong to the ⚠ Imperative members / ⚠ Imperative logic worklists.
  const nd = (cs.needsDecision || []).filter((n) => !SHOWN_ELSEWHERE.has(n.kind));
  const confirm = nd.map((d) => `- **[${esc(d.kind)}]** ${esc(d.item)} — ${esc(d.reason)}` +
    (d.describedIn ? ` · **described in** ${describedInText(d)}` : ""));
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
  // Overview; the ⛔ gate/structure banners are shown ONLY in standalone mode — in embedded mode renderPlan itself
  // owns and prints the banner, so the spec skips it (both banners gate on `!opts.embedded` in renderSpecHeader) to
  // avoid a double print. Do NOT "fix" the embedded skip to also print here — that would duplicate renderPlan's banner.
  const L = renderSpecHeader(result, opts, entity, fields, cs);

  // ---- ONE Layout table (structure + contents) — one row-builder per element category (see helpers above) ----
  // A value-bound crt.ImageInput emitted through the FIELD path (an entity IMAGELOOKUP column laid out as a normal
  // field) is neither `isField` (it binds via `value`, not `control`) nor in `cs.images` (that is the mapImages
  // generator/name-detected set) — so it would be INVISIBLE in the Layout table though its ChangeSet insert lands.
  // Fold those crt.ImageInput elements into the images sink so EVERY emitted control gets exactly one Layout row.
  const imgNames = new Set((cs.images || []).map((im) => im.classic));
  const fieldImages = (cs.viewConfigDiff || [])
    .filter((o) => o.values?.type === "crt.ImageInput" && o.name && !imgNames.has(o.name))
    .map((o) => { const v = o.values.value || ""; const filled = v.endsWith("_value"); return { classic: o.name, generator: null, parent: o.parentName, column: filled ? null : strip(v), crossDs: !!o.values.readOnly, filled }; });
  const rows = [
    ...rowsForFields(fields, regionOf),
    ...rowsForDetails(cs.details, tabRegion),
    ...rowsForFeatures(cs.standardFeatures, tabRegion),
    ...rowsForWidgets(cs.widgets),
    ...rowsForCardActions(cs.cardActions, result, opts),
    ...rowsForImages([...(cs.images || []), ...fieldImages], regionOf),
    ...rowsForTableElements(cs.tableElements, regionOf),
    ...rowsForProfileCards(cs.profileCards, regionOf),
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
  if (isSectionMigration && !opts.formOnly) L.push(...renderListPageBlock(result, section, opts));

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
  // Cross-datasource recipe — printed ONCE for all fields marked `↳ linked` above, instead of repeating the same
  // paragraph in every linked field's Additional cell.
  if ((cs.viewConfigDiff || []).some((o) => isField(o) && o.values?.linkedValue)) {
    L.push("> **`↳ linked` fields (read-only, cross-datasource):** the bound column is on a RELATED object, not this entity. In Freedom show each natively — add the related object's column through the lookup on this page and bind the input to `<Lookup>.<column>` READ-ONLY. Do NOT rebuild it as a plain entity field; wire a manual on-change handler ONLY if the value must be STORED; do NOT drop it (dropping collapses an island to a lone field).", "");
  }

  L.push(...renderLogicSection(cs));

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

  // ---- The rest of the page, in render order, in ONE push (S7778) ----
  //  • ⚠ Imperative logic — the METHOD worklist, and a BINDING one. Directly under Logic: the two are one subject
  //    split in two, what the engine mapped and then what it could not. Methods stay out of the ⚠ Confirm list
  //    (that one holds open questions needing an on-stand answer); this is where each method gets its ported /
  //    dropped / blocked mark, with the evidence the engine read from the body.
  //  • ⚠ Imperative members — the same worklist contract for the NON-method imperative members. Beside the method
  //    worklist because they are the same kind of thing: declared here, defined elsewhere, each a port unit.
  //    These three worklists together are "the ⚠ worklist" the SKILL's rules refer to.
  //  • child-page lighter-shell recommendation (child pages only), then the ⚠ Confirm worklist — GENUINE open
  //    decisions only; kinds already surfaced in Layout / Logic / Child-pages are not re-listed.
  //  • the member ledger, which is the completeness proof.
  L.push(
    ...renderImperativeLogic(cs),
    ...renderImperativeMembers(cs),
    ...headerTemplateRecommendation(cs, opts), ...childFormRecommendation(cs, fields, opts), ...renderConfirmWorklist(cs),
    ...renderMemberLedger(result.coverage),
  );


  return L.join("\n");
}

// One row per client-authored method: what calls it, what its body does, and where it lives in the classic body.
// A passthrough override is listed too (never silently filtered) but marked as carrying no behaviour of its own,
// so the reader can tell "nothing to port" from "not looked at".
// ONE trigger, rendered from its traced origin. `attribute-dependency` names the attribute and the columns whose
// The `internal` grade of `triggerText`, extracted so that function stays under Sonar's cognitive-complexity
// budget. Three grades of answer, most specific first: the chain reaches a declaration (name it), it reaches a
// platform lifecycle method, or only the immediate caller is known.
function internalTriggerText(t) {
  const via = t.via?.length ? ` via ${t.via.map(esc).join(" → ")}` : "";
  // Called from more than one place — the reader needs that before choosing a target: a helper with two call sites
  // is not the same port as one with a single caller.
  const callerPlural = t.callers?.length > 2 ? "s" : "";
  const more = t.callers?.length > 1 ? ` (+${t.callers.length - 1} more caller${callerPlural})` : "";
  if (t.rootTrigger) return `${triggerText(t.rootTrigger)} → ${esc(t.root)}${via} (internal call)${more}`;
  if (t.lifecycle) return `${esc(t.lifecycle)} (platform lifecycle) → internal call${more}`;
  return `internal call from ${esc(t.from)}${via}${more}`;
}

// change fires it; a control trigger names the element and the bound property.
function triggerText(t) {
  // A trigger the step-5.1 behaviour analysis established, not the AST. Marked as such: the engine traced nothing
  // here, so a reader must know the answer is a described one (and which run described it).
  if (t.kind === "reported") {
    const from = t.from ? ` (from ${esc(t.from)})` : "";
    return `${esc(t.reportedKind || "resolved")}${from} — reported`;
  }
  // Recovered from the inverse call graph: this method is invoked from another method's BODY. Deliberately NOT
  // dressed up as a declarative trigger — the reader has to see the difference, because the Freedom target follows
  // from what STARTS the chain, not from the call itself. Three grades of answer, most specific first: the chain
  // reaches a declaration (name it), it reaches a platform lifecycle method, or only the immediate caller is known.
  if (t.kind === "internal") return internalTriggerText(t);
  if (t.kind !== "attribute-dependency") return `${esc(t.element)}.${esc(t.property)}`;
  const cols = t.columns?.length ? ` (${t.columns.map(esc).join(", ")})` : "";
  return `${esc(t.attribute)} changes${cols}`;
}

// The ⚠ Confirm rows a behaviour-analysis run (SKILL.md step 5.1) must describe, alongside the methods. That step
// names four unanswerable row types and only two of them are method-shaped: a `message`'s counterpart lives in
// ANOTHER schema by definition, a `mixin`'s members are defined outside this page body entirely. A handoff that
// carried only the method rows would leave these silently out of scope — which is how a prompt ends up naming a row
// type from prose instead of from the engine's own output. `attribute-*` joins them for the same reason: the
// declaration is here, the behaviour it drives is not. Lives here (not in migrate.mjs) because both the renderer and
// the handoff digest key off it, and migrate.mjs already imports this module.
// DERIVED, not re-spelled: every kind the ⚠ Imperative members worklist renders must also be requested in the
// step-5.1 handoff digest. Hand-keeping a second identical list means a kind added to `MEMBER_KIND_NOTE` reaches the
// table and prints a `⚠ not described` cell that no run can ever fill, because the digest never asked for it.
export const HANDOFF_MEMBER_KINDS = MEMBER_WORKLIST_KINDS;


// The behaviour card + acceptance criteria that DESCRIBE this row, once a step-5.1 run has indexed it. This is what
// makes *ported* checkable against a described behaviour instead of against the method's name (Contract rule 7);
// with no card it stays a ⚠ so the blank cannot read as "nothing to describe".
// When the analysis recorded two cards both print — the owning scope's (how this surface uses it) and the body's
// own (what it does): the criteria that gate a behaviour usually live in the body card.
function describedInText(h) {
  const d = h.describedIn;
  // PR #147 review — bare acceptance criteria are NOT a description. An ac-only entry used to reach `cite(null,
  // ac)` and render `? AC-1`, a citation naming no card the operator can open, while the ⚠ that exists for that
  // row went quiet. `describedInOf` (migrate.mjs) no longer produces one; this leg refuses it too, so a plan
  // rendered from an older `behaviour-index.json` reads honestly rather than citing a question mark.
  if (!d || (!d.card && !d.bodyCard)) return "⚠ not described";
  const cite = (card, ac) => {
    const acText = (ac || []).length ? ` ${ac.map(esc).join(", ")}` : "";
    return esc(card || "?") + acText;
  };
  const parts = [];
  if (d.card) parts.push(cite(d.card, d.ac));
  if (d.bodyCard) parts.push(`body ${cite(d.bodyCard, d.bodyAc)}`);
  return parts.join(" · ");
}

const attrDependencyItemFromTrigger = (t) =>
  t?.kind === "attribute-dependency"
    ? `${t.attribute} ← ${(t.columns || []).join(", ") || "?"}`
    : null;

function coveredAttributeDependencyItems(stubs) {
  const covered = new Set();
  const visit = (t) => {
    const item = attrDependencyItemFromTrigger(t);
    if (item) covered.add(item);
    if (t?.rootTrigger) visit(t.rootTrigger);
  };
  for (const h of stubs || []) for (const t of h.triggers || []) visit(t);
  return covered;
}

function imperativeMemberRows(cs) {
  const order = new Map(IMPERATIVE_MEMBER_KINDS.map((k, i) => [k, i]));
  const orphanOrder = IMPERATIVE_MEMBER_KINDS.length;
  const coveredDependencies = coveredAttributeDependencyItems(cs.handlerStubs || []);
  const rows = (cs.needsDecision || []).filter((n) =>
    order.has(n.kind) || (n.kind === "attribute-dependency" && !coveredDependencies.has(n.item)));
  return { order: new Map([...order, ["attribute-dependency", orphanOrder]]), rows };
}

// Where the method's body lives. An externally-assigned method has none HERE — naming the module beats leaving a
// blank the reader mistakes for "nothing to port".
function sourceText(h) {
  if (h.externalRef) return `⚠ from ${esc(h.externalRef)}`;
  return h.lines ? `L${h.lines.start}-${h.lines.end}` : DASH;
}

// Calls that say nothing about what a body DOES: the base call, attribute access (already rendered in
// `Reads → writes`), and plain JS/utility helpers. Listing them as "unclassified" would bury the one call that
// actually matters under noise. A Set rather than one alternation — exact names, and no regex complexity to carry.
// Both namespaces carry the same predicates, so an entry added on one side needs its twin on the other — filtering
// `Ext.isEmpty` but not `Terrasoft.isEmpty` (which real bodies use) leaves a warning pointing at nothing.
// A call that says something about the RECORD or the USER is not noise: `Terrasoft.isCurrentUserSsp` is a real
// condition and stays visible.
const BODY_CALL_NOISE = new Set([
  "callParent", "get", "set", "log",
  ...["isEmpty", "isObject", "isFunction", "isString", "isNumber", "isArray", "isDate"]
    .flatMap((p) => [`Ext.${p}`, `Terrasoft.${p}`]),
  "Ext.String.format", "Terrasoft.each", "Terrasoft.findItem", "Terrasoft.chain",
  "Terrasoft.clearTime", "Terrasoft.dateDiffDays", "Terrasoft.getFormattedNumberValue",
  "Boolean", "Number", "String", "Date", "Array", "Object",
]);
// whole namespaces that are computation, whatever member is called on them
const BODY_CALL_NOISE_NS = new Set(["JSON", "Math"]);
const bareCall = (c) => c.replace(/^this\./, "");

// The framework calls a body makes that the classifier did NOT recognise, minus noise and minus calls to sibling
// rows (an internal call is the call graph's business, not this cell's). Named rather than counted, so the cell
// says WHICH call it could not read — an actionable gap instead of a dead end.
// Rendered as WRITTEN in the body (`this.` kept), so a reader can search the source for it; the tests below are
// on the bare name.
const UNCLASSIFIED_SHOWN = 4;
function unclassifiedCalls(h, siblings) {
  const drop = (c) => {
    const b = bareCall(c);
    return BODY_CALL_NOISE.has(b) || BODY_CALL_NOISE_NS.has(b.split(".")[0])
      || siblings.has(b) || siblings.has(b.split(".")[0]);
  };
  const kept = h.evidence?.calls || [];
  const open = kept.filter((c) => !drop(c));
  // The cap keeps the cell readable, but a silent truncation is the failure this column exists to prevent — the
  // reader would take four names for the whole list. Same `…and N more` overflow the CLI's gap lines use.
  const shown = open.slice(0, UNCLASSIFIED_SHOWN).map(esc);
  const over = Math.max(0, open.length - UNCLASSIFIED_SHOWN);
  if (over) shown.push(`…and ${over} more`);
  // TWO things can be hidden and they are DIFFERENT hidings, so they are reported apart. The parser keeps only the
  // first N callee paths in locale order, and every noise namespace (`Boolean`, `Ext.`, `Math.`, `Terrasoft.`) sorts
  // ahead of `this.`, so a call-dense body can arrive here as nothing but noise. Those calls never passed the noise
  // and sibling filters above, so adding them to `…and N more` claims unclassified calls nobody established — a
  // method whose only forwarded call was a SIBLING then rendered `⚠ unclassified: …and 4 more`, a warning naming
  // nothing. Counted on its own as "not read", which is what it is.
  return { shown, unread: Math.max(0, (h.evidence?.callsTotal ?? kept.length) - kept.length) };
}

// What the body does, from evidence. Distinct states, kept apart on purpose: body elsewhere · nothing of its own ·
// recognised calls · writes but no recognised call · nothing recognised (a ⚠, and it names what it could not read).
// `callParent` is NOT recognition — it is the base call, present in most overrides, and counting it would report a
// method whose real work went unread as "it just calls the base".
function bodyDoesText(h, siblings = new Set()) {
  if (h.externalRef) return "defined in another module";
  if (h.trivial) return "passthrough (base only)";
  const kinds = (h.evidence?.kinds || []).filter((k) => k !== "callParent");
  if (kinds.length) return kinds.map(esc).join(", ");
  const { shown, unread } = unclassifiedCalls(h, siblings);   // already escaped at the sink, plus an overflow marker
  // What the PARSER never forwarded is stated wherever this cell enumerates calls, so the list cannot read as the
  // whole one. Kept out of the unclassified names themselves — see `unclassifiedCalls`.
  const hidden = unread ? ` (+${unread} call(s) the parser did not forward)` : "";
  // Attribute writes ARE evidence — the same evidence `categorize` promotes to `set-values`, so this row is not a ⚠.
  // But writing an attribute does not make an unread call read. BOTH signals are true at once, and returning only
  // the first hid the second whenever a method happened to do both — the unread call is exactly what a step-5.1
  // resolver needs before marking the row resolved (SKILL.md rule 7), so it is composed in, not swallowed.
  // The cell is the ONLY place this is reported: `categorize` still answers `set-values` (the writes are real, and
  // so is the handler target that follows from them) — what the unread call changes is how much of the row is read.
  if ((h.evidence?.writesAttrs || []).length)
    return (shown.length ? `sets values; ⚠ also calls: ${shown.join(", ")}` : "sets values") + hidden;
  return (shown.length ? `⚠ unclassified: ${shown.join(", ")}` : "⚠ nothing recognised") + hidden;
}

function readsWritesText(ev) {
  if (!ev || (!ev.readsAttrs.length && !ev.writesAttrs.length)) return DASH;
  const reads = ev.readsAttrs.map(esc).join(", ") || DASH;
  const writes = ev.writesAttrs.map(esc).join(", ") || DASH;
  return `${reads} → ${writes}`;
}

function targetText(h) {
  if (h.externalRef) return "read that module, then port its behaviour";
  if (h.trivial) return "confirm template provides it";
  return freedomTargetFor(h.category);
}

const IMPERATIVE_LOGIC_PREAMBLE = [
  "> Each row is a method the classic page defines, and each must end up **ported** (naming the Freedom handler /",
  "> converter / virtual attribute you built), **dropped** (with the reason) or **blocked** — recorded on this page's",
  "> Plan-vs-Done checklist row, to the same standard as an ⚠ Confirm item.",
  "> `⚠ unresolved` means the engine found nothing in this schema that calls it and no declaration that binds it.",
  "> Resolve it from the control / hook / message — never from the method's name; a row still unresolved after the",
  "> static pass is what the step-5.1 `classic-ui-expert` run answers, and its reported trigger replaces this cell on",
  "> the next `--plan`. An `internal call` trigger means the engine",
  "> found the CALLING method, and where the chain reaches one, the declaration or platform lifecycle hook that starts",
  "> it. A row marked **`↳`** is a helper the engine traced to the single row above it: port it WITH that caller as one",
  "> unit — it still needs its own ported / dropped / blocked mark, but not a Freedom artifact of its own. A helper with",
  "> SEVERAL callers is deliberately NOT folded: it is usually the row that becomes a shared converter.",
  "> **Described in** names the behaviour card and the",
  "> acceptance criteria a step-5.1 `classic-ui-expert` run established for the row — port against those criteria,",
  "> not against the method's name; `⚠ not described` means no run has covered it yet.", "",
  "| Method | Source | Trigger | Body does | Reads → writes | Freedom target | Described in |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];

// Fold a helper under the row that calls it. A method the inverse call graph traced to ONE caller present in this
// same table is part of that caller's implementation, not a handler of its own — so it is ordered directly beneath it
// and marked `↳`, and its Freedom target becomes "port with <caller>" instead of a generic handler suggestion that
// would invite building a second Freedom artifact for half a behaviour.
//
// Nothing is HIDDEN. Collapsing a helper into its caller's cell is how imperative rows got lost before (a method
// reached the plan only as prose beneath another and was never marked), and Contract rule 7 requires every row to
// carry its own ported / dropped / blocked mark. The fold is therefore ordering + a marker, never a deletion.
//
// Two deliberate non-folds:
//   · MORE THAN ONE caller — it cannot travel with "its" caller, and it is usually the row that becomes a shared
//     converter, so it stays a unit of its own;
//   · a caller that is NOT in this table (a standard lifecycle method, filtered out of the worklist) — there is no
//     parent row to fold under, and the trigger cell already names the hook.
// The child→parent links `foldByCaller` walks: a stub folds under the single body caller that is itself a row.
// Own fn so `foldByCaller` stays under Sonar's cognitive-complexity budget.
function foldParents(stubs, byName) {
  const parentOf = new Map();
  for (const h of stubs) {
    const t = (h.triggers || [])[0];
    if (t?.kind !== "internal" || t.callers?.length > 1) continue;
    if (!t.from || t.from === h.sourceMethod || !byName.has(t.from)) continue;
    parentOf.set(h.sourceMethod, t.from);
  }
  // Break any parent chain that loops back on itself: mutual recursion would otherwise make both rows children and
  // neither would ever be emitted by the walk below.
  for (const name of parentOf.keys()) {
    const seen = new Set([name]);
    for (let p = parentOf.get(name); p; p = parentOf.get(p)) {
      if (seen.has(p)) { parentOf.delete(name); break; }
      seen.add(p);
    }
  }
  return parentOf;
}

function foldByCaller(stubs) {
  const byName = new Map(stubs.map((h) => [h.sourceMethod, h]));
  const parentOf = foldParents(stubs, byName);
  const childrenOf = new Map();
  for (const [child, parent] of parentOf) {
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(child);
  }
  const ordered = [], emitted = new Set();
  const walk = (h, depth) => {
    if (emitted.has(h.sourceMethod)) return;
    emitted.add(h.sourceMethod);
    ordered.push({ stub: h, depth, parent: parentOf.get(h.sourceMethod) || null });
    for (const c of childrenOf.get(h.sourceMethod) || []) walk(byName.get(c), depth + 1);
  };
  for (const h of stubs) if (!parentOf.has(h.sourceMethod)) walk(h, 0);
  for (const h of stubs) walk(h, 0); // safety net: a row no walk reached is still emitted, never dropped
  return { ordered, folded: parentOf.size };
}

// The ⚠ Imperative members worklist. Mirrors ⚠ Imperative logic: a table of port units, with each row's unresolved
// aspect stated IN ITS OWN CELL rather than escalated to ⚠ Confirm — a bullet list can only say "this row is open",
// it cannot say "we know what it is, we do not know whether the template already provides it".
function renderImperativeMembers(cs) {
  const { order, rows: rawRows } = imperativeMemberRows(cs);
  const rows = rawRows
    .sort((a, b) => order.get(a.kind) - order.get(b.kind) || String(a.item).localeCompare(String(b.item)));
  if (!rows.length) return [];
  const described = rows.filter((d) => d.describedIn).length;
  const L = [`#### ⚠ Imperative members — account for EVERY row (${rows.length})`, "",
    `> ${described} of ${rows.length} carry a behaviour card` +
    (described < rows.length ? " — run step 5.1 for the rest before this plan is approvable." : "."), "",
    "> Each row is declared on this page, but its behaviour lives OUTSIDE the page body. Mark each **ported** (naming",
    "> the Freedom artifact you built), **dropped** (with the reason) or **blocked** — the same standard as a method row.",
    "> **Described in** names the behaviour card and acceptance criteria a step-5.1 run established: port against those,",
    "> not against the member's name. `⚠ not described` means no run has covered it yet.", ""];
  // One explanation per kind PRESENT, above the table — a per-row reason repeats the same paragraph on every row.
  for (const k of order.keys()) if (rows.some((r) => r.kind === k)) L.push("> " + (MEMBER_KIND_NOTE[k] || ATTRIBUTE_DEPENDENCY_NOTE));
  L.push("", "| Member | Kind | Detail | Described in |", "| --- | --- | --- | --- |");
  for (const d of rows)
    L.push(`| ${esc(d.item)} | ${esc(d.kind)} | ${d.detail ? esc(d.detail) : "—"} | ${describedInText(d)} |`);
  L.push("");
  return L;
}

function renderImperativeLogic(cs) {
  const stubs = cs.handlerStubs || [];
  if (!stubs.length) return [];
  // Counted, not just listed: how many rows still have no trigger, and how many carry a behaviour card. The
  // pair is the honest state of the worklist — "51 unresolved, 0 described" and "51 unresolved, 51 described" are
  // very different plans, and the row-by-row table alone made them look identical.
  // The count is of EMPTY cells, so it must not claim "no TRACED trigger": a row the behaviour run answered leaves
  // this count while nothing was traced for it. Those are counted on their own, next to it.
  const unresolved = stubs.filter((h) => !(h.triggers || []).length).length;
  const reported = stubs.filter((h) => (h.triggers || []).some((t) => t.kind === "reported")).length;
  // A row whose only trigger came from the inverse call graph is NOT the same as one bound to a declaration: we know
  // what calls it, not what starts it. Counted apart so the inversion cannot read as work that no longer needs doing.
  const internalOnly = stubs.filter((h) => (h.triggers || []).length && h.triggers.every((t) => t.kind === "internal" && !t.rootTrigger && !t.lifecycle)).length;
  const described = stubs.filter((h) => h.describedIn && (h.describedIn.card || h.describedIn.bodyCard || (h.describedIn.ac || []).length)).length;
  const { ordered, folded } = foldByCaller(stubs);
  // Rows and PORT UNITS are different numbers once helpers are folded, and the difference is the useful one: 63 rows
  // that are really 39 things to build reads very differently from 63 independent handlers.
  const units = stubs.length - folded;
  const L = [`#### ⚠ Imperative logic — account for EVERY row (${stubs.length})`, "",
    `> ${unresolved} row(s) have no trigger yet` +
    (reported ? ` · ${reported} answered by the behaviour run` : "") +
    (internalOnly ? ` · ${internalOnly} know only their calling method (what starts the chain is still open)` : "") +
    (folded ? ` · ${folded} are helpers folded under their caller (\`↳\`) → **${units} port unit(s)**` : "") +
    ` · ${described} of ${stubs.length} carry a behaviour card` +
    (described < stubs.length ? " — run step 5.1 for the rest before this plan is approvable." : "."), ""];
  L.push(...IMPERATIVE_LOGIC_PREAMBLE);
  // A call to another row of this table is an INTERNAL call — the fold column already carries it, so it must not
  // also print as an unclassified framework call.
  const siblings = new Set(stubs.map((h) => h.sourceMethod));
  for (const { stub: h, depth, parent } of ordered) {
    const triggers = h.triggers || [];
    const trigger = triggers.length ? triggers.map(triggerText).join(" / ") : "⚠ unresolved";
    // The marker carries the nesting; the name stays intact so a search for the method still finds its row.
    const name = parent ? `${"↳".repeat(Math.min(depth, 3))} ${esc(h.sourceMethod)}` : esc(h.sourceMethod);
    const target = parent ? `port with \`${esc(parent)}\`` : targetText(h);
    const cells = [name, sourceText(h), trigger, bodyDoesText(h, siblings), readsWritesText(h.evidence),
      target, describedInText(h)];
    L.push(`| ${cells.join(" | ")} |`);
  }
  L.push("");
  return L;
}

// The Freedom construct a method's (evidence-backed) category maps onto. A category the table does not know
// falls back to the generic handler wording rather than asserting a target the engine cannot justify.
const FREEDOM_TARGET = {
  validator: "validator (or backend validation if it must block persistence)",
  "query/filter": "handler issuing the data query / a data-source filter",
  "service-call": "handler calling the service",
  "process-launch": "`crt.RunBusinessProcessRequest` from a handler",
  "message-publish": "handler-mediated request (replaces the sandbox publish)",
  "message-subscribe": "handler on the corresponding request (replaces the sandbox subscribe)",
  dialog: "handler showing the dialog",
  lookup: "lookup handler / business rule filter",
  save: "`crt.SaveRecordRequest` handler",
  "feature-gate": "feature check in a handler — confirm the feature exists on the target stand",
  "mixin-call": "port the mixin's contribution, then call it from a handler",
  "set-values": "handler setting the view-model attribute(s)",
  "filter-build": "data-source filter (built in a handler when it is dynamic)",
  "sys-setting": "read the system setting on the Freedom side — do not inline its current value",
  refresh: "`crt.LoadDataRequest` / data-source reload from a handler",
  passthrough: "confirm template provides it",
};
// Every key above is a category `categorize` can actually return, i.e. one backed by body evidence. Do NOT add an
// entry for a category only a method's NAME could produce — the map would then need a name-based producer, which is
// the guessing this table exists without.
const freedomTargetFor = (cat) => FREEDOM_TARGET[cat] || "request handler / converter / virtual attribute";

// The member ledger — the completeness proof, per `03-member-ledger.md`: every member of every layer is
// attributed, or it is a gap. Rendered as counts per kind plus the full list of anything still unaccounted,
// because a ledger the reader cannot check is not a proof.
const LEDGER_PREAMBLE = [
  "> Every member of every merged schema layer, and what happened to it. **mapped** = the ChangeSet carries a",
  "> Freedom artifact · **decision** = it is on a ⚠ worklist above · **resolved** = you recorded a disposition in",
  "> `manifest.memberDispositions` · **context** = inherited base-template content, excluded by design ·",
  "> **decoration** = pure UI furniture (a menu separator — and only that) — identified by its classic kind, and",
  "> carrying no migration answer to give. A tooltip, a control's own label and the grid-settings editor were",
  "> provisionally counted here and are NOT decoration: each carries author-written text or its own child items,",
  "> so each gets a normal ⚠ row instead of being auto-accounted ·",
  "> **unaccounted** = a gap, and the coverage gate blocks on it.", "",
  "| Member kind | Mapped | Decision | Resolved | Context | Decoration | Unaccounted |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];
// Column order = the header above, and nothing else — this list is a RENDERING order, not a rank. It deliberately
// does NOT mirror `disposition()` (migrate.mjs), which returns `chrome` ahead of `context`: the table reads better
// with the two auto-accounted columns in template-then-decoration order, and the header is the only contract a
// reader can check. Claiming the two orders coincide would be a claim a reader can falsify in thirty seconds.
const LEDGER_DISPOSITIONS = ["mapped", "decision", "resolved", "context", "chrome", "unaccounted"];
// explicit locale-aware comparator (Array#sort's default coerces to string and orders by code unit) — the same
// determinism discipline engine.mjs applies to its own diagnostic lists, and a golden test asserts byte-identical
// output across two runs of the same manifest.
const alphabetical = (a, b) => String(a).localeCompare(String(b));

// disposition counts per member kind, as `{ <kind>: { mapped, decision, … } }`
function ledgerCounts(rows) {
  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] = byKind[r.kind] || Object.fromEntries(LEDGER_DISPOSITIONS.map((d) => [d, 0]));
    byKind[r.kind][r.disposition] = (byKind[r.kind][r.disposition] || 0) + 1;
  }
  return byKind;
}

function renderMemberLedger(coverage) {
  if (!coverage || !Array.isArray(coverage.rows)) return [];
  const byKind = ledgerCounts(coverage.rows);
  const L = [`#### Member ledger (${coverage.total} members)`, "", ...LEDGER_PREAMBLE];
  // alphabetical, not Array#sort's default: an explicit comparator keeps the rendered order deterministic —
  // deterministic and locale-aware, and a golden test asserts byte-identical output across runs.
  for (const kind of Object.keys(byKind).sort(alphabetical)) {
    const c = byKind[kind];
    L.push(`| ${esc(kind)} | ${LEDGER_DISPOSITIONS.map((d) => c[d] || 0).join(" | ")} |`);
  }
  // counted zeros: a kind with no members is RECORDED as verified-empty, never omitted — otherwise "the plan
  // says nothing about messages" is indistinguishable from "nobody looked at messages".
  if ((coverage.zeros || []).length)
    L.push("", `**Verified empty** (no members of this kind in the merged chain): ${coverage.zeros.map(esc).join(", ")}.`);
  if (!coverage.complete) {
    L.push("", `> ⛔ **${coverage.issues.length} member(s) UNACCOUNTED — this plan is NOT approvable.**`);
    for (const it of coverage.issues) L.push(`> - ${esc(it)}`);
  }
  L.push("");
  return L;
}

// renderPlan — the WHOLE plan skeleton the agent presents at the gate: an Overview/What-it-does/Pages
// header with `<FILL: …>` placeholders for the few AGENT decisions (scope, environment, package, approach,
// business sentence, template choices) + the GENERATED design spec. Child edit pages are folded into the
// Pages table as `Rebuild (child)` rows (recursive sub-migrations), not a separate section.
// The agent fills the placeholders and pastes VERBATIM — it cannot drop or restructure the generated
// sections (which is what happened when it hand-authored the plan). Corrections go in an Adjustments note.
// The top-of-plan ⛔ banners (correctness gate, structure completeness, planMeta / on-stand-signals gaps). Own fn
// so renderPlan stays under Sonar CC 15. Returns the lines to push.
// The three ADVISORY `behaviourIndex` banners (unmatched · wiringOnly · sectionOnly). Own fn for the same reason
// `renderPlanBanners` itself is one — Sonar CC 15. Two branches independently grew this function past the limit
// (the sectionOnly banner and the placement blockers below), and neither crossed it alone; splitting the three
// related advisories out is the natural seam. Returns the lines to push — empty when the index reports nothing.
function renderBehaviourIndexBanners(result) {
  const P = [];
  // A step-5.1 answer whose method matches NO worklist row. Advisory, not a block — but never silent: it means the
  // report and this manifest describe different surfaces (a renamed method, a stale report, a wrong scope), and a
  // dropped key would let the plan look fully described while a row it named was never covered.
  const rt = result.behaviourIndex || { unmatched: [] };
  if ((rt.unmatched || []).length) P.push(
    `> ⚠ **${rt.unmatched.length} \`manifest.behaviourIndex\` key(s) matched no imperative row:** ` +
    rt.unmatched.map((k) => "`" + esc(k) + "`").join(", ") +
    ". The behaviour report and this manifest disagree about the surface — check for a renamed method, a stale report, or a report run against a different scope.", "");
  // A row whose body PROVABLY lives in another schema (a `mixin:` member, an `externalRef` method) described by a
  // wiring card alone. Advisory like `unmatched`, never silent: the criteria that gate the behaviour live in the
  // body's own card, and a plan that never names that card reads as fully described while the guards are missing.
  if ((rt.wiringOnly || []).length) P.push(
    `> ⚠ **${rt.wiringOnly.length} \`manifest.behaviourIndex\` key(s) name only a wiring card for a row whose body lives in another schema:** ` +
    rt.wiringOnly.map((k) => "`" + esc(k) + "`").join(", ") +
    ". Add the body's own card as `bodyCard`/`bodyAc` — the behaviour report's attribution table names it (`body <scope>/Cnn`, usually a shared-core card).", "");
  // A step-5.1 answer addressing ONLY the section scope. Matched in the digest, but applyBehaviourIndex folds
  // cards into PAGE rows only, so no worklist row cites it — advisory like its siblings, never silent: without
  // the banner the merge-index → re-run --plan loop reads as complete while the section answer rendered nowhere.
  if ((rt.sectionOnly || []).length) P.push(
    `> ⚠ **${rt.sectionOnly.length} \`manifest.behaviourIndex\` key(s) address only the SECTION scope:** ` +
    rt.sectionOnly.map((k) => "`" + esc(k) + "`").join(", ") +
    ". The plan's worklist carries page rows only, so these answers render in no table — carry each behaviour (and its card) into the List-page part of the plan by hand, and verify it at the list-page checkpoint.", "");
  return P;
}
// FIDELITY warnings (ENG-95862) — the half of `eff.warnings` that says "the mapping is RIGHT, an effect of the op
// is not represented in the item model". They no longer block the gate, so they must be RENDERED: a demotion with
// no advisory is a warning deleted, not a warning downgraded. Same standing and same voice as the `possiblyPartial`
// seed advisory below. An `accepted` one (a recorded `manifest.warningDispositions` answer) is listed as CLOSED
// rather than dropped — a cleared warning stays auditable, exactly like a `memberDispositions` row.
function renderFidelityWarnings(result) {
  const warnings = result.effective?.warnings || [];
  const all = warnings.filter((w) => w.severity === "fidelity");
  // A REFUSED disposition sits on a CORRECTNESS warning by definition (that is why it was refused), so it is read
  // off the whole array — filtering it out of the fidelity subset would make it unrenderable anywhere.
  const refused = warnings.filter((w) => w.dispositionRefused);
  if (!all.length && !refused.length) return [];
  const P = [];
  const open = all.filter((w) => !w.accepted);
  if (open.length) {
    P.push(`> ⚠ **${open.length} fidelity note(s) — the mapping is correct; an effect of the op is NOT represented.** Read each and decide whether the build must reproduce that effect by hand. This does NOT block the gate. To close one, record \`manifest.warningDispositions["<op>:<name>:<schema>"] = { "resolved": true, "disposition": "accepted"|"reproduced-manually"|"n/a", "note": "<why>" }\`:`);
    for (const w of open) P.push(`> - \`${esc(w.op)}\` **${esc(w.name)}** @\`${esc(w.schema)}\` — ${esc(w.hint || w.message || "(no hint)")}`);
    P.push("");
  }
  const closed = all.filter((w) => w.accepted);
  if (closed.length) {
    const closedList = closed.map((w) => {
      const note = w.note ? ` (${esc(w.note)})` : "";
      return `\`${esc(w.op)}:${esc(w.name)}\` → **${esc(w.disposition)}**${note}`;
    }).join(" · ");
    P.push(`> ℹ ${closed.length} fidelity note(s) CLOSED by a recorded disposition: ${closedList}`, "");
  }
  if (refused.length) {
    const refusedList = refused.map((w) => `\`${esc(w.op)}:${esc(w.name)}\``).join(", ");
    P.push(`> ⛔ ${refused.length} disposition(s) were REFUSED — ${refusedList}: ${esc(refused[0].dispositionRefused)}`, "");
  }
  return P;
}

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
    P.push("> ⛔ **STRUCTURE INCOMPLETE — this plan is NOT ready.** The engine detected required inputs you have not supplied (detail schemas / embedded-profile schemas / child-page mappings). Fetch them, add to the manifest, and re-run `migrate.mjs --plan`:");
    for (const it of structure.issues) P.push(`> - ${esc(it)}`);
    P.push("");
  }
  // COVERAGE banner — a schema member with no Freedom artifact and no decision. Same standing as the two above:
  // a plan that leaves a member unaccounted asserts a completeness it does not have.
  const coverage = result.coverage || { complete: true, issues: [] };
  if (!coverage.complete) {
    P.push(`> ⛔ **COVERAGE INCOMPLETE — this plan is NOT ready.** ${coverage.issues.length} schema member(s) are unaccounted: the engine produced no Freedom artifact and no decision for them. Map each, or record its disposition in \`manifest.memberDispositions\`, and re-run \`migrate.mjs --plan\`:`);
    for (const it of coverage.issues) P.push(`> - ${esc(it)}`);
    P.push("");
  }
  P.push(...renderBehaviourIndexBanners(result));
  const planMetaMissing = opts.planMetaMissing || [];
  if (planMetaMissing.length) P.push(`> ⛔ **PLAN INCOMPLETE — required plan values are unfilled:** ${planMetaMissing.map((k) => "`" + k + "`").join(", ")}. Add them to \`manifest.planMeta\` and re-run \`migrate.mjs --plan\` (each shows as a \`<FILL: …>\` below until supplied).`, "");
  const placementBlockers = opts.placementBlockers || [];
  if (placementBlockers.length) P.push(`> ⛔ **PLAN INCOMPLETE — placement not settled:** the target app cannot be shown to host this section yet. ${placementBlockers.map((b) => "\n> - " + b).join("")}\n>\n> Record the answers in \`manifest.placement\` (\`targetPackageEditable\` · \`application\` · \`primaryPackage\` · \`targetPackageInApplication\` · \`sectionHost\`), then re-run \`migrate.mjs --plan\`. Collect them read-only: package editability from \`list-packages\` + \`SysPackage.InstallType\` + per-layer \`isClientEditable\`; the app from \`get-app-info\` / \`find-app\`; the primary package from \`get-app-info\` (an app that errors with *"Primary package not found in response."* HAS none — that is a resolved \`null\`, not a failed check); composition from \`odata-read SysPackageInInstalledApp\` filtered by \`SysPackage/Id\`. **\`create-app-section\` takes no package parameter** — it writes to the app's primary package, so \`existing-app\` is legal only when that primary IS the target package and is editable.`, "");
  const signalsMissing = opts.signalsMissing || [];
  if (signalsMissing.length) P.push(`> ⛔ **PLAN INCOMPLETE — on-stand signals not resolved:** ${signalsMissing.map((k) => "`" + k + "`").join(", ")}. Run the checks and add answers to \`manifest.signals\` (each \`{ "resolved": true, "present": <bool>, … }\`), then re-run \`migrate.mjs --plan\`. **FIRST resolve the section's \`SysModule.Id\`** (the prerequisite for processes+printables — without it those checks CANNOT run, and a failed check is NOT a "none" answer): \`odata-read SysModule\` \`filters {any:[{field:"Code",op:"contains",value:"<Name>"},{field:"Caption",op:"contains",value:"<Name>"}]}\`, select \`["Id","Caption","Code"]\` — match your section (do NOT filter \`SectionSchemaUId eq <guid>\`: a UId column, it FAILS with Edm.Guid-vs-String; the module \`Code\` is usually the base entity name, e.g. section \`Applicant1Section\` → module Code \`Applicant\`). Then: **dcm** = \`SysSchema ManagerName='DcmSchemaManager'\` for the entity/family; **processes** = \`odata-read ProcessInModules\` with **\`filters\`** (NOT \`filter\`) \`{all:[{field:"SysModule/Id",op:"eq",value:<sysModuleId>}]}\` (a lookup → filter via the \`SysModule/Id\` nav, never a \`SysModuleId\` field), select \`["SysSchemaUId","Position"]\` — then resolve each \`SysSchemaUId\` to the process name via \`odata-read VwSysProcess\` \`filters {all:[{field:"Id",op:"eq",value:<SysSchemaUId>}]}\`, select \`["Caption","Name"]\` (a process's \`Id\` == its \`UId\`, so filter by **\`Id\`** — \`UId eq <guid>\` FAILS with an Edm.Guid-vs-String error, and \`Id\` is the field the helper auto-unquotes; NO \`IsMaxVersion\` filter — \`Id\` is unique and returns the one row; ProcessInModules itself has NO name/Caption column); **printables** = \`SysModuleReport\` by \`SysModule\` (\`ShowInSection\`/\`ShowInCard\`); **deduplication** = the on-save duplicate check, which needs TWO answers because they fail differently. (a) \`present\` — does THIS entity have an active use-on-save rule: \`odata-read DuplicatesRule\` (a \`BaseLookup\` in \`CrtDeduplication\`), select \`["Name","IsActive","UseAtSave","ProcedureName"]\`, keep the rows whose \`Object\` is this entity with \`IsActive\` AND \`UseAtSave\` both true, and list their names in \`names\`. (b) \`serviceConfigured\` — can the TARGET stand actually run the Freedom flow: \`get-sys-setting DeduplicationWebApiUrl\` must be non-empty AND features \`ESDeduplication\` + \`BulkESDeduplication\` must be on (read \`AdminUnitFeatureState\` with \`execute-esq\`, columns \`Feature.Code\` / \`FeatureState\` — **no state row means OFF**). Why both are required: no rule ⇒ nothing to lose; a rule with NO service ⇒ the check silently stops at migration. Measured on a stand newer than 8.3.4 — Classic posted \`DeduplicationService/FindDuplicatesOnSave\` and showed its duplicates screen, while the Freedom form page issued only \`InsertQuery\` and saved the duplicate without a word. "Checked, none found" is \`present:false\` — a valid resolved answer, NOT a skip.`, "");
  // ADVISORY (not a hard block, review #5): a seed with 5..149 methods is likely a TRUNCATED base-template fetch (a
  // real chain has 150+). Surface it so a partial fetch isn't silently folded onto — the agent confirms the full chain.
  P.push(...renderFidelityWarnings(result));
  const sq = result.effective?.seedQuality || result.seedQuality;
  if (sq?.possiblyPartial) P.push(`> ⚠ **Seed may be a PARTIAL fetch — confirm before relying on the base layout.** The parent-template \`seed\` defines only ${sq.seedMethods} method(s); a FULL base-template chain has 150+ (mini 152, record ≈347, section 428). Re-check that \`get-classic-page-sources\` captured the WHOLE parent-template chain (not a truncated grab) — building on a partial base silently produces a hollow fold. (Advisory only: it does not block the gate.)`, "");
  return P;
}
// Child page mappings — one design spec per related-list child, recursively embedding grandchildren. Own fn for
// Sonar CC 15. Returns the lines to push (empty when there are no child pages).
// EVERY agent-suppliable answer to "what page opens behind this related list?", written ONCE and shared by the
// three surfaces that state it: the structure gate's blocking message (migrate.mjs imports this), the unresolved
// `<FILL>` note and the read-only note. An answer missing from any one of them is an answer nobody records there.
// Lives here, not in migrate.mjs, because designspec cannot import from its importer. (`cyclic` is engine-detected.)
// The reconcile procedure's path, stated once: four rendered sentences point at it (main page + three reuse
// sites) and they differ too much to share a sentence, but a rename must not have to find them all.
export const RECONCILE_REFERENCE = "./references/existing-freedom-reconcile.md";

// The status a boundary row carries in `--checklist` and `--verify`. One constant, because the two renderers must
// print the SAME words: a row that reads N/A in one artifact and `☐` in the other is a row someone goes and works.
export const BOUNDARY_NA_REASON = "cross-section boundary (approved)";
// One boundary child, as it appears in that row: entity, the detail it opens from, and the Classic page when a name
// was recorded. Own fn for Sonar CC 15.
function boundaryRowItem(c) {
  const pg = boundaryClassicPage(c);
  return "`" + esc(c.entity) + '` (detail "' + esc(c.via) + '"' + (pg ? ", opens `" + esc(pg) + "`" : "") + ")";
}
function boundaryRowLabel(boundaries) {
  return `Cross-section boundaries (${boundaries.length}) — ${boundaries.map(boundaryRowItem).join(" · ")}. Each of these children belongs to another section: its Classic card stays Classic and the related list keeps opening it. **Nothing to build and nothing to verify here** — recorded so the boundary is visible, not so it is worked.`;
}

// ENG-95861 — THE SECTION BOUNDARY: the FOURTH child resolution. Migrating "this section" means this section's own
// pages; a related list whose child entity OWNS ANOTHER SECTION is that other section's work. On Freedom that list
// keeps opening the child's CLASSIC page and the platform handles it, so this is a deliberate, supported end state —
// not a gap, and not the self-declared skip Contract rule 4 forbids (the USER draws that line, the agent records it).
// Recorded on the detail's `detailSchemas` entry as `"opensClassicPage": "<ClassicPage>"` (the page the list keeps
// opening) or `true` (the boundary is declared; the page name is whatever `editPage` read). Returns the recorded
// value — a trimmed page name, `true`, or `null` when this child is not a boundary.
// Defensive about shape on purpose: `childPages` records are built by hand too (goldens, direct API callers).
export function boundaryChild(c) {
  const v = c?.opensClassicPage;
  if (typeof v === "string" && v.trim()) return v.trim();
  return v === true ? true : null;
}
// The Classic page a boundary child keeps opening, or `null` when nobody recorded a name. NEVER derived from the
// entity: `<Entity>Page` is a guess, and the rule `reuseClassicChildSentence` already states applies here too — a
// name nobody read is not a name, least of all inside a claim about it. A recorded `opensClassicPage` string wins;
// otherwise the detail body's own `getEditPageName` read (`editPage`).
export function boundaryClassicPage(c) {
  const v = boundaryChild(c);
  if (typeof v === "string") return v;
  return (typeof c?.editPage === "string" && c.editPage) ? c.editPage : null;
}
// How the plan names the section a boundary child belongs to. `ownSection` on the detail entry is OPTIONAL: when it
// is not recorded the sentence says "another section" rather than inventing a section name.
export function boundarySectionPhrase(c) {
  const own = c?.ownSection;
  return (typeof own === "string" && own.trim()) ? "the `" + esc(own.trim()) + "` section" : "another section";
}

// ENG-95850 (D) — `list-pages` ALONE cannot answer this for a TYPED entity. An entity whose records are typed
// registers a per-type edit card in `SysModuleEdit` instead of one `<Entity>Page`, so a search for a single `*Page`
// legitimately finds nothing while the entity has many. A real run recorded `editPage: false` for `InternalRequest`,
// which has ~18 typed edit pages, and the plan then asserted there was nothing to migrate; it was caught only by a
// hand-written Adjustments entry. So the answer list names the second call that settles it.
export const CHILD_PAGE_ANSWERS = 'a Classic `*Page` exists → add its schema to `manifest.childPageSchemas` '
  + '(rebuild it here); none exists → record `"editPage": false`, and check `list-entity-client-schemas` by that '
  + 'entity FIRST: a TYPED entity registers per-type edit cards instead of one `<Entity>Page`, so `list-pages` '
  + 'finding no `*Page` is not the same as the entity having no Classic card; the CHILD entity already ships a `kind: freedom` '
  + 'form page (`list-entity-client-schemas`) → record `"reuseFreedomPage": "<Freedom form page>"` (the related '
  + 'list opens THAT page and nothing is rebuilt here); the child entity OWNS ANOTHER SECTION and the user drew that '
  + 'boundary → record `"opensClassicPage": "<Classic page>"` (+ optional `"ownSection": "<Section>"`) — its Classic '
  + 'card stays Classic, this related list keeps opening it, nothing here is folded or built. '
  + '`"editable": false` records that the list is read-only, '
  + 'which is NOT an answer to whether a page exists — pair it with one of the four above. '
  + 'No self-declared "out of scope" — a SECTION BOUNDARY is the user\'s scope decision, not a skip you declare.';

// What a REUSE says about the Classic child page, by what the manifest actually recorded — THREE states, tested
// distinctly, because a truthiness test merges the last two and then asserts both that a page exists and that
// nothing was recorded. Never derive `<Entity>PageV2`: a name nobody read is not a name, least of all inside a
// claim about it. Own fn for Sonar CC 15.
function reuseClassicChildSentence(c) {
  if (typeof c.editPage === "string" && c.editPage) return `The Classic \`${esc(c.editPage)}\` is NOT migrated — it is superseded, not skipped.`;
  if (c.editPage === false) return "There is no Classic child page to supersede — `list-pages` by this entity found none (recorded in the manifest), so the list simply opens the Freedom form. (A TYPED entity registers per-type cards rather than one `*Page`, so confirm `list-entity-client-schemas` reports no `editPages` either before reading this as none.)";
  return "The Classic child page is NOT migrated — it is superseded, not skipped. Its schema name was not recorded in the manifest, so this plan does not name it.";
}

// ENG-95861 — the boundary child's own block in `### Child page mappings`. Own fn for Sonar CC 15: `renderChild`
// already carries a seven-arm chain, and this arm is the only one that is a SCOPE statement rather than a mapping.
// It says three things, because a reader who takes any one of them wrong re-opens a settled decision: what stays
// Classic, that nothing here is a deliverable (so nothing about it can ever read MISSING), and how to reverse it.
function boundaryChildLines(c) {
  const pg = boundaryClassicPage(c);
  const opens = pg ? "`" + esc(pg) + "`" : "the Classic page the detail already opens";
  return [
    `> **Reuse (Classic) — cross-section boundary (approved).** \`${esc(c.entity)}\` belongs to ${boundarySectionPhrase(c)}, so its Classic card stays Classic and this related list keeps opening it: ${opens}. **Nothing here is folded, rebuilt or built** — the platform opens a Classic page from a Freedom related list, and that is the intended end state, not a gap. This resolution publishes NO deliverable: no \`--checklist\`/\`--verify\` row, so nothing about ${esc(c.entity)} can be reported MISSING.`,
    ">",
    `> **Migrating ${esc(c.entity)} is that section's own job.** If the user later widens the scope, drop \`opensClassicPage\` from this detail's manifest entry, supply the child page's schema in \`childPageSchemas\`, and re-run — the boundary is a scope decision recorded in \`decisions.md\`, reversible by re-planning, never a defect of this plan.`,
  ];
}

function renderChildMappings(childs) {
  if (!childs.length) return [];
  const P = ["### Child page mappings", ""];
  const renderChild = (c, lvl) => {
    const h = "#".repeat(Math.min(6, lvl));
    P.push(`${h} Child page: ${esc(c.entity)} — opened by detail "${esc(c.via)}"${c.editable === false ? " · view/attach-only" : ""}`);
    if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) {
      P.push(`> **Reuse — a Freedom form page already exists for this child.** \`list-entity-client-schemas\` by entity \`${esc(c.entity)}\` returned \`${esc(c.reuseFreedomPage)}\` (\`kind: freedom\`), so the Freedom related list opens THAT page: nothing is rebuilt here. ${reuseClassicChildSentence(c)} Bind the related list to \`${esc(c.reuseFreedomPage)}\` and verify on-stand that add/open from this list lands on it.`,
        ">",
        `> ⚠ **Reconcile the client's Classic customizations onto \`${esc(c.reuseFreedomPage)}\`.** "Superseded" covers the BASE page only — whatever the client added to the Classic child page in their OWN packages is not on the shipped Freedom form, and reuse does not carry it over. Isolate that delta and apply it, the same obligation a main page carries when a Freedom counterpart exists: \`${RECONCILE_REFERENCE}\`. If the client authored nothing on this child, record the packages you checked — "we did not look" is not "there was nothing".`);
    } else if (boundaryChild(c)) {
      P.push(...boundaryChildLines(c));
    } else if (c.cyclic) {
      P.push(`> ↩ **Already mapped above (cycle)** — this page references back into an ancestor page on this branch (\`${esc(c.resolvedFrom || c.editPage || c.entity)}\`); its full spec appears higher in this plan and is not repeated here.`);
    } else if (c.spec) {
      P.push("", demoteHeadings(c.spec, lvl - 2)); // nest the child's own headings under this level
      for (const g of (c.childPages || [])) renderChild(g, lvl + 1); // EMBED grandchildren recursively
    } else if (c.specError) {
      P.push(`> ⚠ child schema supplied but failed to parse: ${esc(c.specError)} — fix the child manifest and re-run.`);
    } else if (typeof c.editPage === "string" && c.editPage) {
      P.push(`> ⚠ **\`${esc(c.editPage)}\` is a REAL Classic edit page — you MUST fetch it and map it here** (add it to \`childPageSchemas\` / run \`migrate.mjs --plan\` on it, then paste its design spec). NOT optional: **"view-only", "native", and "out of scope" are NOT skip reasons when the page exists.** There is no "out of scope" in this migration — limiting scope is the USER's decision to request, never yours to self-declare.`);
    } else if (c.editPage === false) {
      P.push(`> **Recorded: no separate child page.** \`list-pages\` by entity \`${esc(c.entity)}\` found no Classic \`*Page\` (recorded in the manifest) → a read-only / attach-only related list, nothing to migrate here. ⚠ ONE CHECK BEFORE ACCEPTING THAT: a TYPED entity registers a per-type edit card in \`SysModuleEdit\` instead of a single \`<Entity>Page\`, so this recorded answer is only as strong as the call that produced it — confirm \`list-entity-client-schemas\` by entity \`${esc(c.entity)}\` also returns no \`editPages\`. A real run recorded this for an entity with ~18 typed edit pages, and the plan asserted there was nothing to migrate.`);
    } else if (c.editable === false) {
      // Read-only is a fact about add-record, not about page existence, so this row stays OPEN and the wording
      // says so — the gate blocks on it, and a reassuring note over a blocking gate is how a plan contradicts itself.
      P.push(`> ⚠ **Read/attach-only — the child page question is still OPEN.** The classic detail hides add-record, which stops NEW records; it does not stop opening EXISTING ones, so a page may still exist and still govern the record UI. Run \`list-pages\` **by entity \`${esc(c.entity)}\`** and record the answer: ${CHILD_PAGE_ANSWERS} Read-only ALONE does not resolve this child — the structure gate blocks until the page answer is recorded.`);
    } else {
      P.push(`> **\`<FILL: verify child page>\`** — NOT yet verified. Run \`list-pages\` **by entity \`${esc(c.entity)}\`** and record the answer: ${CHILD_PAGE_ANSWERS} Then re-run.`);
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

// The `Rebuild (child)` row's target: the template the SHARED rule picks, so this AGREES with the per-child
// recommendation banner. Unknown count (an unmapped real page) → generic. Own fn for Sonar CC 15.
function rebuildChildTarget(c) {
  const choice = c.fieldCount == null ? null : childTemplateChoice(c.fieldCount, c.hasTabs, c.nDetails);
  if (choice === "mini") return `Mini page (\`${CHILD_TEMPLATE_SCHEMA.mini}\`)`;
  if (choice === "grid") return `Grid page (\`${CHILD_TEMPLATE_SCHEMA.grid}\`)`;
  return "Freedom child page";
}
// The `Reuse (Classic)` row's target (ENG-95861). Names the page only when one was actually recorded — a target
// cell is the one place a reader looks for "what opens instead", so a guessed name there is worse than none.
function boundaryScopeTarget(c) {
  const pg = boundaryClassicPage(c);
  return `Classic ${pg ? "`" + esc(pg) + "`" : "card"} stays Classic — ${esc(c.entity)} belongs to ${boundarySectionPhrase(c)}`;
}

// Child edit pages belong in Main scope too — each related list's child entity opens its OWN form on add/edit.
// Honest label by resolution state (mapped/real page → Rebuild; verified-none → Reuse; shipped Freedom form →
// Reuse (Freedom); an approved cross-section boundary → Reuse (Classic); ancestor on this branch → Mapped above;
// else ⚠ resolve, view/attach-only ALONE included — read-only tags the row, it does not answer whether a page
// exists).
function buildChildScopeRows(childs) {
  return childs.map((c) => {
    let target, call, label;
    if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) {
      target = `existing Freedom form \`${esc(c.reuseFreedomPage)}\``;
      call = "Reuse (Freedom)"; label = esc(c.entity);
    } else if (boundaryChild(c)) {
      // ENG-95861 — the section boundary. Resolved exactly as the other three are (the structure gate agrees), and
      // rendered as its OWN call: `Reuse` would read as "no page exists" and `Reuse (Freedom)` as "a Freedom form
      // took over", and both are false here — the Classic card stays, and this list keeps opening it.
      target = boundaryScopeTarget(c); call = "Reuse (Classic)"; label = esc(c.entity);
    } else if (c.cyclic) {
      // Resolved-elsewhere: the same page is already mapped higher on this branch. The structure gate treats it as
      // resolved, so the scope table must say so too — it used to fall through to "⚠ resolve" and contradict the gate.
      target = "↩ already mapped above (cycle) — same page, mapped higher in this plan";
      call = "Mapped above"; label = esc(c.resolvedFrom || c.editPage || c.entity);
    } else if (c.spec || (typeof c.editPage === "string" && c.editPage)) {
      // template by field count via the SHARED rule (childTemplateChoice) so this AGREES with the per-child
      // recommendation banner. Unknown count (unmapped real page) → generic.
      target = rebuildChildTarget(c);
      call = "Rebuild (child)"; label = esc(c.editPage || (c.entity + " form page"));
    } else if (c.editPage === false) {
      // Only a recorded "no *Page exists" is a Reuse — `editable:false` does NOT reach this arm. The scope table
      // must never claim a row is settled while the gate blocks on it, nor the reverse (same rule as `cyclic`).
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
  // THE PLAN VERSION, printed into the artifact the operator approves. `plan.md` is engine-WRITTEN and presented
  // verbatim, so a version hand-typed into it would be erased by the next `--plan` run; the approval entry in
  // `decisions.md` records this string, and step 7 builds only against a plan whose version matches it. Rendered
  // only when the engine actually computed one, so a hand-built `result` (the golden runners construct several)
  // does not get a `Plan version: undefined` line.
  const planVersion = typeof result.planVersion === "string" && result.planVersion.trim() ? esc(result.planVersion.trim()) : "";
  P.push(
    "### Overview",
    ...(planVersion ? [`**Plan version:** \`${planVersion}\` — record THIS string in the \`decisions.md\` approval entry; build only against the plan it names.`, ""] : []),
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
    // `Array.isArray` guard: a hand-authored single answer is plausibly written as a bare string
    // (`"names": "Contact duplicates. Contact name"`), and `.map` on a string threw — aborting the whole
    // `--plan` run over a typo in one signal. Degrade to "no list" instead. (`cases` first is correct here: a
    // DCM answer is a case list. `names` is the canonical key for `deduplication`.)
    const raw = s.cases || s.items || s.names;
    const items = Array.isArray(raw) ? raw : [];
    const list = items.map((x) => esc(typeof x === "string" ? x : (x?.name || x?.caption) || "")).filter(Boolean).join(", ");
    const presentNote = list ? ` — ${list}` : "";
    // A DCM object often has SEVERAL case versions (active + previous, e.g. Recruiting_v11 / Recruiting_v1). Only the
    // ACTIVE/published one drives the progress bar + Next steps at runtime, and both widgets auto-populate from it —
    // don't hand-author stages/steps or wire a specific version.
    const multiDcm = k === "dcm" && items.length > 1 ? " (multiple case versions — use the ACTIVE/published one; the progress bar + Next steps auto-populate from it, do not hand-author stages)" : "";
    // `deduplication` is the one signal whose "present" is NOT an instruction to build something: the rules live on
    // the ENTITY and the handler is the platform's, so nothing here is authored. What present means is that this
    // entity HAS an on-save check today — and whether it survives depends on the second fact, the target stand's
    // deduplication service. Say which of the two states applies instead of the generic "→ build it".
    if (k === "deduplication") {
      let verdict;
      if (s.serviceConfigured === true) verdict = "deduplication service configured → the platform's Freedom handler should run; verify on the built page";
      // SELF-CONTAINED on purpose: this used to say "(see the ⚠ Confirm row)", but for a TYPED entity the plan
      // renders the base page with `listPageOnly` (which returns before `renderConfirmWorklist`), so the row the
      // cross-reference pointed at appeared nowhere in the document the operator approves — the alarm arrived with
      // no remedy. The four decisions are stated inline here, so this line stands alone at any typed-ness.
      else if (s.serviceConfigured === false) verdict = "⚠ deduplication service NOT configured (`DeduplicationWebApiUrl` empty and/or `ESDeduplication`/`BulkESDeduplication` off) → after the migration the check STOPS HAPPENING, silently, with duplicates saved as if clean. Decide one **now**: configure the deduplication service on the target stand · keep the Classic page for this entity · install the `Deduplication Freedom UI enhancements` marketplace app · accept the loss and say so";
      else verdict = "⚠ `serviceConfigured` not recorded → cannot say whether the check survives migration";
      return `- **${label}:** active${presentNote} — ${verdict}`;
    }
    return `- **${label}:** present${presentNote} → build it${multiDcm}`;
  };
  P.push("### On-stand signals", sigLine("dcm", "DCM case"), sigLine("processes", "Connected processes"), sigLine("printables", "Printables"), sigLine("deduplication", "On-save duplicate check"), "");
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
  if (pm.freedomExists) P.push("> **Reconcile:** a Freedom page for this entity already exists — do NOT create a duplicate. Read it with `get-page`, apply the design below as a customization delta (added/modified/removed-hidden), and save with `update-page`. Procedure: `" + RECONCILE_REFERENCE + "`.");
  // child edit pages belong in Main scope too — each related list's child entity opens its OWN form on
  // add/edit, so it is a page in the migration TREE (a recursive sub-migration), not a side note. The
  // target is a fixed clean value (NOT a free-text FILL — that invited inconsistent status prose); the
  // "does a Freedom form already exist / follow-on" nuance lives in the Child page mappings section below.
  P.push(...buildChildScopeRows(childs), "");
  if (childs.length) P.push("> **`Rebuild (child)`** = recursive sub-migration (mapping under **Child page mappings** below). **`Reuse`** = read/attach-only related list, no separate child page. **`Reuse (Freedom)`** = the child entity already has a shipped Freedom form page, so the related list opens that one and nothing is rebuilt (the Classic child page is superseded, not skipped). **`Reuse (Classic)`** = a cross-section boundary the user approved: that child entity owns another section, so its Classic card stays Classic and this related list keeps opening it — nothing is folded and nothing is built, so this row publishes no deliverable. **`⚠ resolve`** = not yet verified — check `list-pages` by the CHILD entity before approval (the structure gate blocks until every child is resolved).");
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
  P.push(...renderChildMappings(childs), "> **Supply the plan values via `manifest.planMeta` and re-run (that fills the `<FILL: …>` above), then present this VERBATIM** — ideally the file written by `--out`, not a hand-paste. Any remaining `<FILL: …>` means that planMeta value is still missing. Corrections/enrichments go in an *Adjustments* list at the very end — do NOT edit, reorder, or drop the generated tables/sections (Main scope · List page · form-page Layout/Logic/⚠ Imperative logic/⚠ Imperative members/⚠ Confirm · Child page mappings).");
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
// The ENG-95543 table-emitted elements, grouped by componentType so the gate reads "2 crt.Button expected" rather
// than one row per element. Own fn so `buildCoverageRows` stays under Sonar's cognitive-complexity budget.
function tableElementRows(cs) {
  const byType = new Map();
  for (const el of cs.tableElements || []) {
    const e = byType.get(el.componentType) || { n: 0, kinds: new Set() };
    e.n++; e.kinds.add(String(el.classicKind || "element"));
    byType.set(el.componentType, e);
  }
  return [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ctype, e]) => ({
    label: `${[...e.kinds].sort((a, b) => a.localeCompare(b)).map(esc).join(" / ")} — ${e.n} expected (\`${ctype}\`)`,
    vk: { type: "element", ctype, n: e.n },
  }));
}

// One gated row per standard feature, plus a second one for the two-part features. Own fn for the same reason.
function standardFeatureRows(cs) {
  const rows = [];
  for (const s of cs.standardFeatures || []) {
    const f = s.feature || s.caption || ""; const t = featureVerifyType(f);
    if (!t || s.uiShape === "list") continue; // list-shaped features are covered by "Related lists"
    rows.push({ label: `${esc(f)} (\`${t}\`)`, vk: { type: "feature", ftype: t } });
    // ENG-95859 — a two-part feature (Approvals: the module ABOVE the profile island + the list) publishes ONE
    // gated row PER HALF, same as the DCM case-progress-bar/next-steps split in `buildCoverageRows`. Before this,
    // the second half lived only in `notes` prose, and a build that added just the list read identically to one
    // that added both — twice, on the same feature, in real runs (see FEATURE_SECOND_HALF in mapping-table.mjs).
    for (const extra of featureVerifyExtraTypes(f))
      rows.push({ label: `${esc(f)} — second required component (\`${extra}\`)`, vk: { type: "feature", ftype: extra } });
  }
  return rows;
}

function buildCoverageRows(cs, pm, result) {
  const cover = [];
  if (pm.formTemplate) cover.push({ label: `Form template → \`${esc(pm.formTemplate)}\``, vk: { type: "template", exp: pm.formTemplate } });
  const fieldOps = (cs.viewConfigDiff || []).filter(isField);
  const expFields = fieldOps.length;
  const expTabs = new Set((cs.viewConfigDiff || []).filter(isTabOp).map((o) => o.name)).size;
  const expDetails = (cs.details || []).length + (cs.standardFeatures || []).filter((s) => s.uiShape === "list").length;
  // carry the expected field NAMES (element names, not the stripped control) so the built count can match by
  // identity — a control-bound field whose built component type is outside FIELD_RE (rich-text / a lookup or
  // color variant / a future type) must still count, not spuriously undercount. NB the element name is the
  // distinct identity: several classic items can bind the SAME column (`col`, `col_2`, `col_3` — mapper emits
  // them deliberately) all sharing `control: "$col"`, so keying on the stripped control would collapse the
  // Set below and the gate could never reach ✅ for such a page. `o.name` is `col` / `col_2` — distinct and
  // identical to the built element names.
  if (expFields) cover.push({ label: `Fields — ${expFields} expected`, vk: { type: "fields", n: expFields, names: fieldOps.map((o) => o.name) } });
  // A value-bound crt.ImageInput emitted through the FIELD path (an entity IMAGELOOKUP column laid out as a normal
  // field) binds via `values.value`, so `isField` (control) misses it AND it is not in `cs.images` (the generator/
  // name-detected set). Count it here too — the SAME fieldImages fold the Layout builder uses — else a page whose
  // only image is an IMAGELOOKUP-column field gets NO image vk row, `renderVerify` never runs the crt.ImageInput
  // MISSING check, and a dropped image field passes `--verify` with exit 0 (the AC2 gap two reviewers flagged).
  const imgNames = new Set((cs.images || []).map((im) => im.classic));
  const fieldImageCount = (cs.viewConfigDiff || [])
    .filter((o) => o.values?.type === "crt.ImageInput" && o.name && !imgNames.has(o.name)).length;
  const expImages = (cs.images || []).length + fieldImageCount;
  if (expImages) cover.push({ label: `Image field${expImages === 1 ? "" : "s"} — ${expImages} expected (\`crt.ImageInput\`)`, vk: { type: "image", n: expImages } });
  // ENG-95543 — the table-emitted elements, grouped by componentType so the gate reads "2 crt.Button expected"
  // rather than one row per element. Without a vk row here they are built but ungated: `--verify` would exit 0 on a
  // page that dropped every one of them, and a builder would never fetch their documentation.
  cover.push(...tableElementRows(cs));
  if (expTabs) cover.push({ label: `Tabs — ${expTabs} expected`, vk: { type: "tabs", n: expTabs } });
  if (expDetails) cover.push({ label: `Related lists — ${expDetails} expected`, vk: { type: "details", n: expDetails } });
  // The Freedom component type each standard feature is GATED on — read by `hasType(vk.ftype)` in renderVerify AND
  // published as the row's verify type, so it must be a type the built page really
  // carries and the stand really resolves. It comes from the SHARED MAPPING TABLE (ENG-95543): this used to be a
  // local `FEATURE_TYPE` map — a SECOND home for the same knowledge the mapper asserted in prose, so the gate and
  // the plan could disagree about which component a feature means. The table's types are checked against the
  // component registry, which is what replaced "confirm the exact crt.* on-stand" for these rows.
  cover.push(...standardFeatureRows(cs));
  if (result.signals?.dcm?.resolved === true && !!result.signals.dcm.present) {
    cover.push({ label: "DCM case progress bar", vk: { type: "dcm-bar" } }, { label: "DCM Next steps", vk: { type: "dcm-next" } });
  }
  return cover;
}
// Pages checklist group — every page this migration creates (mini page is a page, not a footnote) plus the
// navigable-SECTION registration deliverable (one real run created pages but never registered the section, and a
// hand-built summary silently dropped it). Returns the rows. Extracted for Sonar CC 15.
// The `List page →` row, which ONLY the main page owns: a SUB-page (child / typed / mini) has no list page, and
// this row is unconditional (clearing `planMeta.sectionSchema` gates the `Navigable section registered` row and
// the whole `List page` group, not this one), so without the split every sub-page inherited a `<FILL: list
// template>` row it can never satisfy. Its own fn so `buildPageRows` gains no branch (Sonar CC 15).
function listPageRows(pm, fill, isMain) {
  return isMain ? [{ label: `List page → ${fill(pm.listTemplate, "<FILL: list template>")}` }] : [];
}
// The `Form page` label. A SUB-page whose template is not a plan choice (`childTemplateChoice` returned `null`, so
// D2 emits no `template` vk and publishes no `expectedTemplate`) used to render `Form page → <FILL: form template>`
// — a placeholder demanding a decision the engine had already decided there is none of, and one nothing in the run
// can ever fill. Only the MAIN page keeps the `<FILL: …>` prompt, where an unnamed template IS a real plan gap
// (and `planMetaMissing` gates it). Own fn so `buildPageRows` gains no branch (Sonar CC 15).
function formPageLabel(pm, opts, fill, isMain) {
  const tpl = pm.formTemplate || opts.template;
  if (isMain || (tpl != null && String(tpl).trim() !== "")) return `Form page → ${fill(tpl, "<FILL: form template>")}`;
  return "Form page built — no template is pinned for this sub-page (the plan derived no template choice for it, so there is nothing to match against)";
}
function buildPageRows(result, opts, pm, typed, fill, isMain) {
  const pages = [...listPageRows(pm, fill, isMain), ...entityRows(result), ...placementRows(opts)];
  if (!typed.length) pages.push({ label: formPageLabel(pm, opts, fill, isMain), vk: { type: "formpage" } });
  // Typed forms EXIST as a gated deliverable: the per-type pages must actually be built. Not derivable from the
  // parent page's get-page → gated via on-stand evidence `built.typedFormsBuilt` (absent → unverified, not skip).
  for (const t of typed) { const ts = t.type ? ` — type "${esc(t.type)}"` : ""; const bo = t.bindOnly ? " (bind by Type)" : ""; pages.push({ label: `Typed form \`${esc(t.schema)}\`${ts}${bo}`, vk: { type: "onstand", evidence: "typedFormsBuilt", what: "per-type edit-page existence check", miss: "a per-type form was not built" } }); }
  // A built typed form opens NOTHING until each Type is routed to it (Classic keeps this in per-type `SysModuleEdit`
  // rows; Freedom needs the equivalent RelatedPage binding PER Type). Without it, only one Type's form is ever
  // reached and the rest are dead schemas — a mechanical completeness deliverable, not a per-form one, so it is ONE
  // gated row for the whole typed entity (mirrors the section-registration row: built ≠ reachable). GATED via
  // on-stand evidence so an unrouted typed entity can't exit --verify with 0 (deep-review #1).
  if (typed.length) pages.push({ label: `Per-type page routing — bind EACH Type's form by the Type column (the Freedom equivalent of Classic's per-type \`SysModuleEdit\` rows). Without it only one Type ever opens its form; the other ${typed.length - 1} are built but unreachable.`, vk: { type: "onstand", evidence: "typedRouting", what: "per-Type RelatedPage binding check", miss: "Types route to Classic / only one form opens" } });
  if (result.miniPage?.schema) {
    // The mini page is a build deliverable (vk mini) AND a WIRING deliverable: a built mini page is an orphan schema
    // until the section's "+ New" is bound to it (an ADD-purpose RelatedPage binding — a config record, NOT part of
    // the page body). GATED via on-stand evidence `built.miniPageWired` so an unwired mini page can't pass --verify.
    // The BUILD leg carries the mini page's OWN published key (`mini:<Schema>`, whatever `assignPageKeys` finally
    // claimed): the row resolves from `--built.pages[key]` exactly like every other page. It used to read the
    // root-level `miniPageBuilt` boolean, which the keyed payload every document prescribes does not carry — so a
    // correctly built mini page stayed ⚠ forever and the ONLY shape that closed it was the flat legacy field.
    // `null` when the plan never folded the mini page (no key is published for it, and none is invented here).
    pages.push(
      { label: `Mini page \`${esc(result.miniPage.schema)}\``, vk: { type: "mini", key: result.miniPage.pageKey || null } },
      { label: `Mini page wired to "+ New" — create the ADD-purpose RelatedPage binding so the section's "+ New" opens \`${esc(result.miniPage.schema)}\`; until then it is a built schema that nothing opens ("+ New" still shows the full form).`, vk: { type: "onstand", evidence: "miniPageWired", what: "add-purpose RelatedPage binding check", miss: "'+ New' still opens the full form" } },
    );
  }
  // A `Reuse (Freedom)` child is NOT a no-op deliverable: which page a related list opens is a RelatedPage binding —
  // a config record, exactly like the mini-page "+ New" wiring — so without it the list falls back to whatever the
  // platform picks and the reuse decision is silently lost. ONE gated row for the whole set (as with typed routing),
  // so `reuseFreedomPage` cannot trade a false-red gate for a false-green close report.
  const reused = (result.childPages || []).filter((c) => typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage);
  if (reused.length) pages.push(
    { label: `Reused Freedom child pages bound (${reused.length}) — create the RelatedPage binding for each related list whose child already has a Freedom form (${reused.map((c) => "`" + esc(c.reuseFreedomPage) + "`").join(" · ")}); nothing is rebuilt, but an unbound list does not open the reused page.`, vk: { type: "onstand", evidence: "reuseBindings", what: "RelatedPage binding check per reused child list", miss: "a related list does not open the existing Freedom form" } },
    // Binding is only HALF of what reuse owes: the shipped Freedom form carries the base layout, so the client's
    // own Classic additions to that child page are absent unless reconciled. A set-level row so the aggregate
    // cannot read as "a bound list is a finished list". NO `vk` — deliberately, and for two reasons. A gated
    // `onstand` row needs a reachability evidence key or `--verify` can
    // never clear it; and the MAIN page's reconcile is ungated prose, so gating the child harder than the page it
    // is modelled on breaks the symmetry that justifies it. A vk-less row still renders "☐ confirm on-stand".
    { label: `Reused child pages reconciled (${reused.length}) — for each, apply the client's Classic customization delta to the reused Freedom form (or record the packages checked as carrying none), per \`${RECONCILE_REFERENCE}\`.` });
  // ENG-95861 — the approved section boundaries, stated ONCE for the whole set. A boundary child publishes NO page
  // key (see `publishUnfoldedChild`), so `--verify` can never call it
  // MISSING — which is exactly the point: it is not a deliverable of this plan. But "publishes nothing" must not
  // mean "says nothing": the reader has to see WHICH related lists deliberately keep opening a Classic card, or the
  // plan reads as if those children were forgotten. `na` (not a `vk`) so the row renders `N/A — …` in BOTH
  // `--checklist` and `--verify` instead of a `☐` that invites someone to go and close it. There is nothing to close.
  const boundaries = (result.childPages || []).filter((c) => boundaryChild(c));
  if (boundaries.length) pages.push({ na: BOUNDARY_NA_REASON, label: boundaryRowLabel(boundaries) });
  // The navigable-section deliverable, gated on the DECIDED host mode. An approved `pages-only-no-menu` run
  // ships pages without a menu entry ON PURPOSE, so emitting the row there would demand evidence for something
  // the plan decided not to do — a permanent false red. It is replaced by an explicit dropped row rather than
  // dropped silently: the reader must still see that the section is unreachable from the menu, and that this
  // was chosen. Any other mode (including a plan that recorded no placement at all) keeps the gated row.
  if (pm.sectionSchema || result.section) {
    pages.push(opts.sectionHostMode === "pages-only-no-menu"
      ? { label: "Navigable section registered — **deliberately NOT built** (`placement.sectionHost.mode = pages-only-no-menu`): the pages ship, but the section does not appear in the app menu, so they are reachable only by URL and through the object's page bindings" }
      : { label: "Navigable section registered in exactly ONE workplace — the Freedom section appears in the app menu (`create-app-section`) and is bound to a single workplace; the pages above are not reachable without it, and a registration only ADDS, so a section \"moved\" between workplaces stays in both until the old binding is removed", vk: { type: "onstand", evidence: "sectionRegistered", expectCount: 1, what: "app-menu section-registration check, counting the workplace bindings", miss: "the section is not in the menu — its pages are unreachable" } });
  }
  return pages;
}
// List-page contents checklist rows (columns / quick filters / section actions). Returns the rows. Extracted for CC.
// `result.miniPage` is gated on the SAME `isMain` flag the Form/List split already threads: D3 clears a sub-page's
// `planMeta.sectionSchema`/`listTemplate`, but that only covers the first disjunct — a sub-page that folds its OWN
// mini page still satisfied the third one and emitted a whole `List page` group (List columns / quick filters /
// section actions) for a page that has no list page at all.
// The list page's OWN published key. It is no node in the page tree — the section's list page is minted by
// `create-app-section`, not folded from a classic edit-page bundle — so the key is reserved here rather than claimed
// by `assignPageKeys`. It is a page key ONLY when the run emits gated list rows.
export const LIST_PAGE_KEY = "list";
// ONE list-page row. Every list-page deliverable carries a `vk`: a row with none renders `☐ confirm on-stand` and
// can never be closed, which is what makes a page's contents unverifiable.
//
// WHICH mechanism a row gets is decided by whether the built page can answer it, never by convenience:
//   · columns and quick filters are IN the page body, so they are MEASURED off it (`listcolumns` / `listfilter`),
//     exactly like a form-page field row — see `resolveListColumnsVk` / `resolveListFilterVk`;
//   · a command-bar action and a ROW action are NOT: a command-bar action's Freedom container stays unresolved while
//     the section view `diff` goes unfolded, and a row action's Freedom element name is not predictable here at all,
//     so neither has an identity to match and BOTH keep an EVIDENCE row (D7) — a filed record plus a judge verdict,
//     the mechanism for claims a page body genuinely cannot settle.
// The split is mechanical, not editorial: a kind listed in `LIST_ROW_VK` is measured and EVERY other kind falls
// through to an evidence row, so this comment must be read as naming the table below, never as a second opinion
// about it. Closing a body-answerable row on a filed record would let a build agent's own claim stand in for the page.
const LIST_ROW_VK = {
  columns: (n, names, columns) => ({ type: "listcolumns", n, names, columns }),
  filter: (n, names) => ({ type: "listfilter", n, names }),
};
// The measured kinds, published so a test can DERIVE which kinds are evidence rows. Prose that restates the split
// instead of reading it from here is a second copy, and a copy is what drifts.
export const LIST_MEASURED_KINDS = Object.keys(LIST_ROW_VK);
function listRow(label, kind, item, n, names, columns) {
  const make = LIST_ROW_VK[kind];
  return {
    label,
    vk: make ? make(n, names, columns) : { type: "evidence", id: `${LIST_PAGE_KEY}#listpage:${kind}:${item}`, requires: [...EVIDENCE_REQUIRES] },
    list: { kind, item, n, names },
  };
}
// One command-bar action's checklist row. The label carries the metadata; the item stays the bare name because it
// keys the evidence id.
function listActionRow(a) {
  const bits = [a.caption ? `caption \`${esc(a.caption)}\`` : null,
    a.condition ? `conditional: \`${esc(a.condition)}\`` : null,
    a.icon ? `icon \`${esc(a.icon)}\`` : null,
    a.parent ? `under \`${esc(a.parent)}\`` : null,
    a.package ? `from \`${esc(a.package)}\`` : null].filter(Boolean);
  const detail = bits.length ? ` (${bits.join(" · ")})` : "";
  return listRow(`Command-bar action — \`${esc(a.name)}\`${detail}`, "action", a.name, 1, [a.name]);
}
function buildListItems(pm, section, result, isMain) {
  if (!(pm.sectionSchema || section || (isMain && result.miniPage))) return [];
  const lcs = result.listChangeSet;
  const cols = lcs?.columns || [];
  const filters = lcs?.quickFilters || [];
  const actions = lcs?.commandBarActions || [];
  // One row per ACTUAL element, not one row per concern: a single "List columns" row could be closed while half the
  // columns were missing, and it named none of them, so nothing said WHICH columns the built page must carry.
  const items = cols.length
    ? [listRow(`List columns — ${cols.length} expected (${cols.map((c) => esc(c.name)).join(" · ")})`, "columns", "set",
        cols.length, cols.map((c) => c.name), cols.map((c) => ({ name: c.name, code: c.code })))]
    : [{ label: "List columns" }];   // unresolved ⇒ nothing to gate; the spec's ⚠ line carries the question
  for (const f of filters) items.push(listRow(`Quick filter — \`${esc(f.name)}\` on ${esc(f.column || "?")}`, "filter", f.name, 1, [f.name]));
  for (const a of actions) items.push(listActionRow(a));
  // A row action is an EVIDENCE row for the same reason a command-bar action is, and more strongly: its Freedom
  // element name is not predictable here, so there is no identity to match against the built page.
  for (const ra of lcs?.rowActions || []) {
    const cond = ra.condition ? ` (conditional: \`${esc(ra.condition)}\`)` : "";
    items.push(listRow(`Row action — \`${esc(ra.name)}\`${cond}`, "rowaction", ra.name, 1, [ra.name]));
  }
  // ENG-95470 (defect 3) — the list page's OWN template, mirroring the Form-template row above (`vk: { type:
  // "template", ... }`, resolved by the shared `resolveTemplateVk`). Before this row a plan/built mismatch (e.g.
  // `ListPageV2FreedomTemplate` planned, `ListPageV3Template` actually built) surfaced only as free-text inside a
  // judge rejection — nothing machine-checked it. Added ONLY when the list page is ALREADY gated by another row
  // (`items.some((r) => r.vk)`, computed above `--` never on `pm.listTemplate` alone): a plan with nothing else
  // resolved for the list page must stay UNGATED (ENG-95218 — withholding a page nobody builds must not publish an
  // unclosable `list` unit), and adding a template-only vk here would flip that decision by itself. This row lives
  // in `listRows`, gated on `LIST_PAGE_KEY`, so `ctx.page` resolves to `built.pages["list"]`, never `main`'s.
  if (pm.listTemplate && items.some((r) => r.vk)) {
    items.unshift({ label: `List template → \`${esc(pm.listTemplate)}\``, vk: { type: "template", exp: pm.listTemplate } });
  }
  return items;
}
// ONE checklist group, stamped with the page it belongs to. `pageKey` stays RAW on the group and on every row —
// it is the machine identity (it keys the built-page map and the evidence ids), and an `esc`d id would be
// unreproducible for the caller that has to supply the evidence under it. Only the RENDERED title is escaped:
// that is where a stand-derived entity/schema name reaches the Markdown. The main page is NOT prefixed, so the
// existing single-page tables read exactly as before.
// ONE page's groups, or all of them when no scope is asked for.
export function scopeGroups(groups, pageKey) {
  if (pageKey == null || pageKey === "") return groups;
  return (groups || []).filter((g) => g.pageKey === pageKey);
}
function pageGroup(pageKey, title, rows) {
  return {
    title: pageKey === "main" ? title : `${esc(pageKey)} · ${title}`,
    pageKey,
    rows: rows.map((r) => ({ ...r, pageKey })),
  };
}
// EVIDENCE ROWS (D7). A deliverable that no page body can prove — the page-DESIGN pass, an imperative member, a
// ⚠ Confirm item — is closed by an evidence RECORD plus an independent judge verdict, not by prose in the Evidence
// cell. The record is looked up by an id the ENGINE derives and publishes; the agent never invents one. Keep this
// list complete — an id missing here reads to a builder as an id that does not exist, so it never gets filed.
// FOUR shapes:
//   `<pageKey>#quality-gates`            — the singleton per-page row (one per published page key)
//   `<pageKey>#confirm:<kind>:<item>`    — one per ⚠ Confirm worklist item
//   `<pageKey>#childpage`                — an unfolded child page (see `unresolvedChildGroups` below)
//   `list#listpage:<kind>:<item>`        — one per list-page deliverable: `columns:set`, `filter:<name>`,
//                                          `action:<name>` (see `listRow`; `<pageKey>` is always `list`)
// Built from the RAW `pageKey` / `d.kind` / `d.item`, never from the rendered label: labels pass through `esc`, so
// a caption carrying a backtick or a pipe would yield an id the caller could not reproduce to file its evidence
// under. `requires` is the UI gate for "this record is complete" and rides on the row so the checklist can carry it.
export const EVIDENCE_REQUIRES = ["referencePage", "components"];
// `vkExtra` rides straight onto `vk` (never onto the outer row) — ENG-95859 needs a `part` discriminator there so
// two DIFFERENT rows can share the SAME evidence id (see `qualityGateRows`) without the resolver losing which half
// it is answering for. ENG-95471 rides `allowNoDiff` the same way, so a row that accepts "diffed and found already
// compliant" can say so without spreading the concession onto `EVIDENCE_REQUIRES` generally.
function evidenceRow(id, label, extra = {}, vkExtra = {}) {
  return { label, id, ...extra, vk: { type: "evidence", id, requires: EVIDENCE_REQUIRES, ...vkExtra } };
}
// The ⚠ Confirm worklist — the same items as the Confirm section (kinds without a section of their own). Removals are not
// decisions. Own fn so `checklistGroups` gains no branch of its own (Sonar CC 15).
// The RAW `kind`/`item` ride on the ROW (not on the `vk`, which is the resolvers' input): the checklist
// row carries them next to the id so a builder reads the decision it must resolve without re-parsing an id —
// and without `esc`, which is a rendering transform and would not round-trip.
function confirmWorklistRows(pageKey, cs) {
  return (cs.needsDecision || [])
    .filter((nn) => !SHOWN_ELSEWHERE.has(nn.kind))
    .map((d) => evidenceRow(`${pageKey}#confirm:${d.kind}:${d.item}`, `[${esc(d.kind)}] ${esc(d.item)}`,
      { confirm: { kind: d.kind, item: d.item } }));
}
// Quality gates — ALWAYS present, one per page. See the label for what it demands. It used to be a vk-less `skip`
// row: visible, tallied in nothing, closable by asserting it in prose — which is exactly how "native components →
// style parity is inherent" waved it through. It is now an EVIDENCE row: it closes only on a filed record naming
// the reference page + the components checked AND a judge that found that record convincing.
//
// ENG-95859 — TWO rows, ONE id. "A record was filed naming the reference page + components" and "an independent
// judge found that record convincing" are different facts (a run that did the design work and a run that skipped
// it must not read identically), so each gets its OWN row/status via the `part` discriminator on `vk` — but they
// still file under the SAME `${pageKey}#quality-gates` id: the filing contract
// (the migration skill's steps 7/8) names ONE id
// per page, and splitting the id itself would be a build-agent-facing contract change this ticket does not need.
// `evidenceRows`/`evidenceIds` below dedupe by id so exactly one id is published per page.
function qualityGateRows(pageKey) {
  const id = `${pageKey}#quality-gates`;
  // `allowNoDiff` (ENG-95471): the ONLY evidence kind where "diffed and found nothing to fix" is a real outcome —
  // a `#confirm`/`#childpage`/list-page record proves something was BUILT, which an empty answer never can, so
  // the concession stays scoped to this row and is not spread onto `EVIDENCE_REQUIRES` generally. It applies to
  // BOTH halves below: the FILED half is what accepts the empty `components` + `noChangesReason` shape, and the
  // JUDGED half needs it too — not to close on it (that row closes on the judge verdict), but so its "not judged
  // yet" wording doesn't call a valid no-diff record incomplete while it waits for a judge to look at it.
  const base = "`creatio-ui-guidelines` skill invoked on EVERY built page — the mandatory UI page-DESIGN pass. **DONE only if you actually invoked the `creatio-ui-guidelines` skill on EACH page this migration creates** (list page · form page · mini page · every typed page · every child page) AND fixed its findings. Evidence MUST name the skill and list the exact pages it ran on. **NOT acceptance — do NOT mark this done with any of:** \"native components / native containers used\", \"style parity is inherent\", \"looks fine\", \"template handles it\", or running it on only some pages; a dense/overloaded layout is a REQUIRED fix (or a decision to raise), never \"refine if desired\". A page diffed and found ALREADY compliant is a valid pass too — file it with an empty `components` list and a `noChangesReason` naming what was compared, never with a vague `components` list padded to look non-empty. NB: this is the UI **page-creation** guideline specifically — not the clio build `get-guidance` contracts you read to write the schema.";
  return [
    evidenceRow(id, `${base} **This row: the design pass RAN** — a record naming the reference page and the components checked was filed under \`${esc(id)}\`.`, {}, { part: "filed", allowNoDiff: true }),
    evidenceRow(id, `${base} **This row: the design pass was INDEPENDENTLY JUDGED** — a separate reviewer found the filed record convincing. A record nobody reviewed does not close this row, even when the row above is ✅.`, {}, { part: "judged", allowNoDiff: true }),
  ];
}
// PACKAGE PLACEMENT (D5). Emitted ONLY when the expected package is known: with no `targetPackage` there is nothing
// to compare against, and a row that can never resolve would turn every `renderVerify(res, {}, …)` call into a
// permanently-unverified run. Own fn so `buildPageRows` gains no branch of its own (Sonar CC 15).
// THE OBJECT THE PAGE SITS ON (the migration's whole point). A Classic→Freedom migration is a new PRESENTATION of
// data that already exists: the Freedom page must be bound to the SAME entity the Classic page was, so the
// customer's records stay where they are. A page built on a fresh object is not a migration — it is an empty new
// section that happens to look right.
//
// This row exists because that invariant had NO machine check at all, and the omission was measured: `create-app`
// mints its own stub entity for a new application and binds its starter pages to THAT, and a real run got 13 units
// deep with `main`'s pages sitting on a one-column stub. Every other gate was satisfied, because nothing anywhere
// compared the built page's entity against the Classic one — `--built` did not even record it. The failure was
// caught only because a build agent volunteered a proposal about it, which is exactly the kind of luck a machine
// gate exists to replace.
//
// `result.entity` is THIS page's own Classic entity: each sub-page is its own `runMigration` result, so a child's
// row gets the child's entity rather than the parent's. `"?"` means the merged chain never named one — nothing to
// compare against, so no row (the same rule `placementRows` follows for a missing target package).
function entityRows(result) {
  const ent = typeof result?.entity === "string" ? result.entity.trim() : "";
  if (!ent || ent === "?") return [];
  return [{
    label: `Bound to the EXISTING object \`${esc(ent)}\` — a migration re-presents data that already exists; a page on a new object migrates nothing and the customer's records stay behind`,
    vk: { type: "entity", exp: ent },
  }];
}
function placementRows(opts) {
  const pkg = opts.targetPackage;
  if (typeof pkg !== "string" || pkg.trim() === "") return [];
  return [{
    label: `Package placement → \`${esc(pkg)}\` — the built page must live in the target package (a page saved into the wrong package ships nothing to the customer's app)`,
    vk: { type: "placement", exp: pkg },
  }];
}
// A child the fold did NOT rebuild because the child entity ALREADY has a shipped Freedom page. There is no page
// to build, but WHICH page the related list opens is a RelatedPage binding — a config record — so the key is
// published with that one gated row rather than dropped: a published page key with no gated row is a hole by
// construction (the whole point of this ticket is that a child page could be absent and `--verify` still exit 0).
// TWO rows, because reuse owes two different things: WHICH page the list opens (a RelatedPage binding), and
// whether that page carries what the client had (the shipped Freedom form has the BASE layout, never the client's
// own Classic additions). Reuse skips the fold, so neither is machine-derivable from this plan.
export function reuseChildGroups(pageKey, c) {
  return [pageGroup(pageKey, "Pages", [{
    label: `Reused Freedom page \`${esc(c.reuseFreedomPage)}\` for \`${esc(c.entity)}\` — opened by detail "${esc(c.via)}". Nothing is rebuilt here, but the related list does not open it until the RelatedPage binding exists.`,
    vk: { type: "onstand", evidence: "reuseBindings", what: "RelatedPage binding check for this reused child list", miss: "the related list does not open the existing Freedom form" },
  }, {
    // Ungated on purpose — see the set-level row in checklistGroups for why (no registered reachability key, and
    // the MAIN-page reconcile it mirrors is ungated too). Renders "☐ confirm on-stand"; does not block `--verify`.
    label: `Client's Classic customizations on the \`${esc(c.entity)}\` child page reconciled onto \`${esc(c.reuseFreedomPage)}\` (or the packages checked recorded as carrying none) — per \`${RECONCILE_REFERENCE}\`.`,
  }])];
}
// A child page that is a REAL deliverable (a Classic edit page exists, or its existence was never verified) but
// whose Classic source was not folded, so not one of its deliverables can be derived from the plan. It still
// publishes its key — with TWO gated rows, because one is not enough here.
// The `childpage` vk is the STRUCTURAL half: it asks only "does this key yield any component at all", and
// `walkViewConfig` counts a node as a component when it carries a `name` OR a `type` — so a one-key JSON object
// (`{"viewConfig":{"name":"x"}}`) closes it. Every OTHER published key also carries the `#quality-gates` evidence
// row, which needs a filed record AND an independent judge verdict; this key had no evidence row at all, so it was
// the one published key a builder could close by typing a literal. It gets its own evidence id in the same
// namespace (D3: every published key carries a row that cannot be closed by nothing).
export function unresolvedChildGroups(pageKey, c) {
  return [pageGroup(pageKey, "Pages", [
    {
      label: `Child page for \`${esc(c.entity)}\` — opened by detail "${esc(c.via)}". Its Classic source was NOT folded into this plan, so no deliverable of it is machine-derivable: confirm on-stand what was built for it.`,
      vk: { type: "childpage" },
    },
    evidenceRow(`${pageKey}#childpage`, `Child page \`${esc(c.entity)}\` — evidence of what was actually built. Nothing about this page is derivable from the plan, so the structural row above can only ask whether the key returned ANY component. File the record naming the reference page and the components you built (\`${EVIDENCE_REQUIRES.join("` + `")}\`), and have the judge review it — a page nobody described is not a built page.`),
  ])];
}
// Splice in the rows every sub-page attached at fold time. Child pages RECURSIVELY — a grandchild is a
// first-class page, and the depth-1 `.map` this replaces gave it no row at all — then typed pages and the mini
// page. DEDUPE by resolved page identity: the run-global memo hands the SAME `res` to every parent referencing
// one page (diamond sharing), so a shared child reached along two paths would otherwise be spliced, and tallied,
// twice. Recursion only descends into a page taken for the FIRST time, so a diamond cannot re-walk its subtree.
// The WALK is over NODES, and the row splice is a projection of it — one traversal, so the key set the checklist
// publishes and the keys stamped on the spliced rows cannot drift apart (they are the same nodes, in the same
// order, deduped by the same `pageDedupeId`).
// THE PARENT EDGE, from the tree the engine itself folded. It is not published, so a builder
// reconstructed it by parsing the nested `### Child page mappings` out of `plan.md` — a machine fact recovered from
// prose the same engine had printed. When that parse came back partial the park arithmetic degraded to
// "approximated" and a parked page blocked `main` instead of only its own ancestors.
//
// MIRRORS `subPageNodes` deliberately: same order, same first-seen dedupe, so every key that walk publishes gets an
// entry here and the map is never partial (a partial map is worse than none —
// unmapped keys would read as roots).
function parentEdge(result) {
  const parents = { main: null };
  const seen = new Set();
  function claim(node, parentKey) {
    const key = node?.pageKey;
    if (!key || !node.pageRows || seen.has(key)) return false;
    seen.add(key);
    parents[key] = parentKey;
    return true;
  }
  function walk(node, parentKey) {
    for (const c of node.childPages || []) if (claim(c, parentKey)) walk(c, c.pageKey);
    for (const t of node.typedPages || []) claim(t, parentKey);
    claim(node.miniPage, parentKey);
  }
  walk(result, "main");
  return parents;
}
// Exported so `--spec --page <key>` resolves a key through the SAME walk that publishes it. It used to look only
// at `result.childPages` / `typedPages` / `miniPage` — one level — while this walk recurses, so every GRANDCHILD
// was a published, scheduled build unit whose slice the CLI said did not exist. Two traversals, two answers about
// the same tree; now there is one.
export function subPageNodes(result, seen = new Set(), out = []) {
  for (const c of result.childPages || []) if (takeSubPage(c, seen, out)) subPageNodes(c, seen, out);
  for (const t of result.typedPages || []) takeSubPage(t, seen, out);
  takeSubPage(result.miniPage, seen, out);
  return out;
}
// Dedupe on the FINAL `pageKey` (D1), not on `pageDedupeId`. The two agree only because `assignPageKeys` has
// already guaranteed one key per physical page; keying the splice on the KEY is what makes that guarantee load-
// bearing — two nodes that ever ended up sharing a key would otherwise be spliced twice, inflating the tallies and
// emitting a duplicate `buildOrder` entry against a truncated expectation.
function takeSubPage(node, seen, out) {
  const key = node?.pageKey;
  if (!key || !node.pageRows || seen.has(key)) return false;
  seen.add(key);
  out.push(node);
  return true;
}
// GLOBAL page-key assignment (D1) — run over the WHOLE tree from the root, in the same order and with the same
// dedupe as the row splice. The fold can only see ONE sibling list, but a page key is a GLOBAL identifier: it keys
// `--built.pages`, the evidence ids, the checklist groups and the verify ctx cache. Two DIFFERENT physical child pages
// under DIFFERENT parents that share an entity name both produced `child:<Entity>`, so ONE supplied viewConfig
// closed BOTH pages' rows and a page that was never built reached exit 0.
// So: the first claimant of a base key keeps it; any later node with a DIFFERENT `pageDedupeId` gets its
// disambiguator appended (the resolved schema / reused page / detail), then a numeric suffix if that still
// collides. The SAME physical page reached twice (a diamond) is NOT a collision — it is aliased onto the key
// already assigned and its subtree is not re-walked. Idempotent across repeated calls: every claim is re-derived
// from the immutable `pageKeyBase`, never from the mutated `pageKey`.
function claimPageKey(claimed, base, alt) {
  if (!claimed.has(base)) return base;
  const withAlt = alt ? `${base}@${alt}` : base;
  if (withAlt !== base && !claimed.has(withAlt)) return withAlt;
  let n = 2;
  while (claimed.has(`${withAlt}#${n}`)) n++;
  return `${withAlt}#${n}`;
}
// Re-render this node's rows under its final key. The factory rebuilds a fresh array of fresh row objects, so the
// re-render cannot alias anything the previous render handed out.
function setPageKey(node, key) {
  if (node.pageKey === key) return;
  node.pageKey = key;
  if (typeof node.pageRowsFor === "function") node.pageRows = node.pageRowsFor(key);
}
function assignOnePageKey(node, claimed, byDedupe) {
  const id = node?.pageDedupeId;
  const base = node?.pageKeyBase || node?.pageKey;
  if (!id || !base) return false;
  if (byDedupe.has(id)) { setPageKey(node, byDedupe.get(id)); return false; }
  const key = claimPageKey(claimed, base, node.pageKeyAlt);
  claimed.set(key, id);
  byDedupe.set(id, key);
  setPageKey(node, key);
  return true;
}
function assignPageKeys(result, claimed = new Map(), byDedupe = new Map()) {
  for (const c of result.childPages || []) if (assignOnePageKey(c, claimed, byDedupe)) assignPageKeys(c, claimed, byDedupe);
  for (const t of result.typedPages || []) assignOnePageKey(t, claimed, byDedupe);
  assignOnePageKey(result.miniPage, claimed, byDedupe);
  return result;
}
function subPageGroups(result) {
  const out = [];
  for (const node of subPageNodes(result)) out.push(...(node.pageRows || []));
  return out;
}
// The page these rows belong to, and the ROOT-only tree splice. Both are own fns so `checklistGroups` gains no
// branch of its own (Sonar CC 15 — this file's rule is that new behaviour arrives as helpers, never as an `if`
// inside the two row assemblers).
function pageKeyOf(opts) { return opts.pageKey || "main"; }
function rootSubPageGroups(result, isMain) { return isMain ? subPageGroups(result) : []; }
// Page keys are claimed by the ROOT run only — a sub-page render sees one branch and would claim keys against a
// half-empty map. Its own fn so `checklistGroups` gains no branch of its own (Sonar CC 15).
function rootAssignPageKeys(result, isMain) { if (isMain) assignPageKeys(result); }
// `opts.pageKey` (default `"main"`) is the page these rows belong to — every group and every row carries it, so a
// count derived from THIS page's ChangeSet can never be closed by another page's components. Each per-page helper
// is handed this page's own `cs`; in particular `regionResolver` is rebuilt per call (it closes over the diff it
// was built from, so the main page's instance would return garbage region labels for a child's fields).
export function checklistGroups(result, opts = {}) {
  const cs = result.changeSet || {};
  const pm = opts.planMeta || {};
  const typed = result.typedPages || [];
  const childs = result.childPages || [];
  const pageKey = pageKeyOf(opts);
  const isMain = pageKey === "main";
  rootAssignPageKeys(result, isMain);
  const fill = (v, ph) => (v != null && String(v).trim() !== "" ? esc(String(v)) : ph);
  const groups = [];
  const G = (title, rows) => { const r = rows.filter(Boolean); if (r.length) groups.push(pageGroup(pageKey, title, r)); };
  G("Pages", buildPageRows(result, opts, pm, typed, fill, isMain));
  const section = result.section || null;
  // The List page group belongs to the LIST page's key, not the form page's: its rows are the list page's own
  // deliverables, so `--verify` gates them under their own page key. Only the main
  // scope emits it — a sub-page has no list page, and two pages must never write rows under one global key.
  //
  // Emit the key ONLY when at least one of those rows is GATED. A published key whose rows all resolve
  // `☐ confirm on-stand` is a hole by construction: it adds a build unit nothing can ever close. With nothing
  // resolved (no columns, no filters, no actions), the single unresolved-columns row stays on the form page's key and
  // the ⚠ line in the spec carries the question.
  const listRows = isMain ? buildListItems(pm, section, result, isMain).filter(Boolean) : [];
  // An approved `pages-only-no-menu` run registers NO section, so `create-app-section` never runs and no list page is
  // minted: queueing one would gate rows on a page the plan deliberately does not build. Its deliverables degrade to
  // ungated prose on the form page's key — the same treatment the `Navigable section registered` row gets — and the
  // `list` marker goes with the `vk`, or the FORM page would be handed the list vocabulary.
  // A list-page DECISION is gated whichever key ends up owning the deliverables. Withholding the `list` key withholds
  // a page nobody builds — it must never withhold the questions, or the run that has no gated list row (an empty
  // section, or `pages-only-no-menu`) is exactly the run whose questions go unanswered. When the key is withheld the
  // items ride on `main` (`main#confirm:list-*`); when it is published they ride on `list`.
  // MAIN SCOPE ONLY, like every other list-page deliverable. A sub-bundle that carries its own `section` gets its own
  // `listChangeSet`, and without this guard that node's questions ride onto the SUB-PAGE's key — a per-type form page
  // carrying mandatory list-column questions for a grid it does not have.
  let listConfirmOnMain = isMain ? confirmWorklistRows(pageKey, result.listChangeSet || {}) : [];
  if (opts.sectionHostMode === "pages-only-no-menu" && listRows.length) {
    G("List page (NOT built — `pages-only-no-menu`)", [
      { label: "**Deliberately NOT built** (`placement.sectionHost.mode = pages-only-no-menu`): no section is registered, so no list page is minted. The rows below record what a list page WOULD carry, for the run that adds the menu entry later." },
      ...listRows.map((r) => ({ label: r.label })),
    ]);
  } else if (listRows.some((r) => r.vk)) {
    // The quality gate is "one per published page key" (see the evidence-id shapes above) and the list page is now
    // one of them — the `creatio-ui-guidelines` pass genuinely applies to a list page's layout, so omitting it here
    // would let the one page the skill was NOT run on be the one page nothing asks about.
    groups.push(pageGroup(LIST_PAGE_KEY, "List page", listRows));
    // The list page's ⚠ Confirm items are gated like the form's — same evidence-id namespace, so a builder
    // resolves them before the build round.
    const listConfirm = confirmWorklistRows(LIST_PAGE_KEY, result.listChangeSet || {});
    if (listConfirm.length) groups.push(pageGroup(LIST_PAGE_KEY, "⚠ Confirm worklist", listConfirm));
    groups.push(pageGroup(LIST_PAGE_KEY, "Quality gates", qualityGateRows(LIST_PAGE_KEY)));
    listConfirmOnMain = [];   // gated on `list`; never in two places
  } else G("List page", listRows);
  // Form — Layout (top-level tab/region placement) + Coverage (machine-verifiable counts/components) — see helpers.
  const regionOf = regionResolver(cs.viewConfigDiff || [], cs.resources || {});
  G("Form — Layout (by tab/region)", buildLayoutGroupRows(cs, regionOf));
  G("Form — Coverage (verified)", buildCoverageRows(cs, pm, result));
  // Form — Logic: business rules folded to a count; ONE row per handler (the dropped-in-prose case). Agent-confirmed.
  const logicItems = [];
  const ruleN = (cs.pageBusinessRules || []).length + new Set((cs.entityBusinessRules || []).map((r) => r.targetAttribute)).size;
  // The rule IDENTITIES — each rule's target element/attribute, the column its logic governs (a page rule's
  // `element`, an entity rule's `targetAttribute`). Published in the vk so `--verify` and `--checklist` have the same
  // expected set to match a built page's rules against, exactly as `fields` publishes its expected element names.
  // Business rules used to be a vk-LESS row: it rendered `☐ confirm on-stand` (a `skip`), tallied in nothing, and
  // closed by asserting it in prose — the false MISSING/skip this ticket removes. It now carries a `rule` vk and is
  // gated against `--built.pages[<key>].businessRules` (the read-page-business-rules result), because a page's
  // rules persist as separate BusinessRule_* schemas INVISIBLE to a page-body grep.
  const ruleIds = [...new Set([
    ...(cs.pageBusinessRules || []).map((r) => r.element),
    ...(cs.entityBusinessRules || []).map((r) => r.targetAttribute),
  ].filter(Boolean))];
  if (ruleN) logicItems.push({ label: `Business rules × ${ruleN}`, vk: { type: "rule", n: ruleN, names: ruleIds } });
  // Every handler keeps its OWN checklist row (nothing folded away — this table exists so nothing is lost), but a
  // helper the plan folded under a caller says so, or the checklist would read as a demand for its own Freedom
  // artifact and the two documents would disagree about what "done" means for it.
  const foldedUnder = new Map(foldByCaller(cs.handlerStubs || []).ordered
    .filter((o) => o.parent).map((o) => [o.stub.sourceMethod, o.parent]));
  for (const h of cs.handlerStubs || []) {
    const parent = foldedUnder.get(h.sourceMethod);
    logicItems.push({ label: `Handler — \`${esc(h.sourceMethod)}\`` + (parent ? ` (ported with \`${esc(parent)}\`)` : "") });
  }
  G("Form — Logic", logicItems);
  // Card actions — Process/Print each their own row (machine: a crt.Button must exist); native view controls folded.
  const acts = cs.cardActions || [];
  const actItems = acts.filter((a) => /process|print/i.test(a)).map((a) => ({ label: `Card action — ${esc(a.replace(/Button$/, ""))}`, vk: { type: "card" } }));
  const natives = acts.filter((a) => !/process|print/i.test(a));
  if (natives.length) actItems.push({ label: `Card actions — native (${natives.map((a) => esc(a.replace(/Button$/, ""))).join("/")})` });
  G("Card actions", actItems);
  // ⚠ Imperative members worklist — one row per member, marked ported / dropped / blocked like a method. PLAIN rows,
  // like the `Handler — …` rows above and unlike the evidence rows below: work to record, not open questions closed
  // by a filed record. Without this group these members have no row anywhere in the control table.
  // One kind BROADER than the plan table: `attribute-dependency` is kept out of the plan (the method it triggers
  // carries it there) but kept here, because the attribute is its own member and the method's row reports the method.
  G("⚠ Imperative members worklist", (cs.needsDecision || [])
    .filter((n) => MEMBER_WORKLIST_KINDS.has(n.kind))
    .map((d) => ({ label: `[${esc(d.kind)}] ${esc(d.item)}` })));
  // ⚠ Confirm worklist — same items as the Confirm section (kinds not shown elsewhere). Removals are not decisions.
  // Each one is an EVIDENCE row (D7): a confirm item is closed by a filed record + a judge verdict, not by prose.
  G("⚠ Confirm worklist", [...confirmWorklistRows(pageKey, cs), ...listConfirmOnMain]);
  // Child pages that publish NO page key of their own — a cycle (mapped higher on this branch, and gated there),
  // a child verified to have no separate page / to be view-only (no deliverable to gate), or a malformed child
  // bundle (a PLAN-completeness failure the structure gate already blocks on). They keep an identity row so
  // nothing is silently dropped, but they must NOT carry a machine row: it could never be closed. Every OTHER
  // child publishes a key and its rows are spliced in below.
  G("Child pages", childs.filter((c) => !c.pageRows).map((c) => ({ label: `${esc(c.entity)} — separate page?` })));
  // Quality gates — ALWAYS present. Named after the skill and worded so it CANNOT be waved through: the row is
  // DONE only if the `creatio-ui-guidelines` skill was actually invoked on EVERY built page. Sessions gamed the
  // old wording by asserting "native components used → style parity is inherent" (a false equivalence — native
  // components are necessary, not sufficient; a 950-field wall is still native) and demoting real layout problems
  // to "refine if desired". So acceptance is now a single, checkable fact — did you run the skill on all pages —
  // and the escape phrases are explicitly rejected. See `qualityGateRows`: it is now an EVIDENCE-gated row.
  G("Quality gates", qualityGateRows(pageKey));
  // ROOT SPLICE — only the page that owns the key `main` folds the tree, so a sub-page's own groups stay its own
  // (its grandchildren are reached by the recursive walk, not by nesting rows inside rows).
  groups.push(...rootSubPageGroups(result, isMain));
  return groups;
}

// `--checklist` — the grouped Plan-vs-Done skeleton (all rows `☐ pending`), presented AFTER implementing. Not part
// of `--plan`. The verified version is `--verify` below (SAME structure, Status auto-filled from the built page).
export function renderChecklist(result, opts = {}) {
  // `opts.scopePageKey` scopes the render to ONE page (`--checklist --page <key>`). Filtered on the RAW `pageKey`
  // every group already carries — never on the rendered title, which passes through `esc` and is prefixed for
  // sub-pages only. Deliberately NOT called `pageKey`: that name is already taken in these opts — `subPageOpts`
  // sets it to stamp a sub-page's rows — so reusing it silently changed what got RENDERED instead of filtering it.
  const groups = scopeGroups(checklistGroups(result, opts), opts.scopePageKey);
  if (!groups.length) return "";
  const L = ["### ✅ Plan-vs-Done checklist", "",
    "> Present this **AFTER implementing** (not part of the approval plan). One row per deliverable / handler / ⚠ Confirm item. Fill **Status** (`✅ Done` / `⚠ Partial` / `❌ Not done` / `N/A` — with reason) and **Evidence** for EVERY row. A row left `☐ pending` = not verified. **Do not delete rows.** (Prefer `--verify --built <get-page>` — it auto-fills Status from the built page and hard-blocks on any ❌.)"];
  let n = 0;
  for (const g of groups) {
    L.push("", `**${g.title}**`, "", "| # | Deliverable | Status | Evidence |", "| --- | --- | --- | --- |");
    // `na` rows are NOT pending work (ENG-95861: an approved cross-section boundary). A `☐ pending` there reads as
    // "someone still owes this", and the whole point of the resolution is that nobody does.
    for (const r of g.rows) {
      const status = r.na ? `N/A — ${esc(r.na)}` : "☐ pending";
      L.push(`| ${++n} | ${r.label} | ${status} | ${r.na ? "not a deliverable of this plan" : "—"} |`);
    }
  }
  return L.join("\n");
}

// VERIFIED done-gate — the SAME grouped structure as `--checklist`, but Status AUTO-FILLED from the ACTUALLY BUILT
// Freedom pages, so "done" is checked against reality, not the agent's prose. `--built` is a KEYED MAP over the
// page tree — `{ pages: { "<pageKey>": { viewConfig, packageName, parentSchemaName } | false }, reachability,
// evidence, judge }` — where `viewConfig` is clio `get-page`'s `bundle.viewConfig` verbatim (the MERGED page, so
// template-provided components are visible). `--checklist` groups by the exact keys. A payload with no `pages` is the
// legacy single-page shape and is read as the `main` page alone; the CLI rejects it, direct callers may use it.
// STRUCTURAL rows (a `vk`) are machine-checked ✅/❌/⚠ and drive the
// HARD verdict (any ❌ ⇒ INCOMPLETE, non-zero exit). Rows with no `vk` (placement / logic / confirm / child /
// quality) are surfaced as `☐ confirm on-stand` (agent evidence) — visible so nothing drops, but not machine-gated
// (get-page shows structure, not business-rule logic or which Freedom tab a field landed in). Driven by get-page,
// so a broken browser/SSO on the stand is NOT an excuse to skip this gate.
// The verify-kind resolvers, split by category so each (and the dispatcher) stays under Sonar CC 15. Each returns
// [mark, evidence, outcome] where outcome ∈ "ok" | "missing" | "unverified" | "skip" — the caller tallies counts.
// A resolver MAY append a fourth element, `owner` ∈ "builder" | "verifier", naming WHOSE work closes the row.
// Omitted means "builder": the overwhelming majority of open rows name a shortfall the builder can act on in its
// own context. Only the rows a read-only verifier/judge files — the evidence record, the judge verdict, and the
// two reachability rows — are `"verifier"`, and those are the ONLY ones `buildComplete` is allowed to ignore.
// ENG-95901 first keyed that axis on the `missing`/`unverified` LABEL, which is the wrong proxy: `unverified` is
// also what a PARTIAL or unreadable build resolves to (`0/N expected fields`, `k/N components`, "no `--built.pages`
// entry", "re-run get-page and pass viewConfig VERBATIM"), all of them named, actionable, builder-owned.
// D6's tri-state, for the rows that read this page's COMPONENTS: `false` = checked and genuinely absent (❌
// MISSING) · a present-but-empty entry = checked and empty (❌ MISSING) · NO entry at all = nobody looked
// (⚠ unverified). Only `resolveChildPageVk` implemented it; for a FOLDED sub-page an absent entry fell through
// `pageOpsOf` → `[]` and was indistinguishable from an empty one, so every one of its rows read ❌ MISSING —
// "you built it wrong" for a page the verifier simply never fetched. Both outcomes still block exit 0; what
// changes is which of the two repairs the builder is sent to do. Own fn so no resolver gains a nested branch.
function absentEntry(ctx, what) {
  return ["⚠ verify", `no \`--built.pages["${esc(ctx.pageKey)}"]\` entry — ${what} not checked; get-page this page (or record \`false\` if it was deliberately not built)`, "unverified"];
}
function resolveFormPageVk(ctx) {
  if (ctx.ops.length) return ["✅ Done", "form page built (get-page returned its components)", "ok"];
  if (ctx.entryAbsent) return absentEntry(ctx, "the form page");
  return ["❌ MISSING", "get-page returned no components for the form page", "missing"];
}
function resolveTemplateVk(vk, ctx) {
  const tpl = entryObject(ctx.page)?.parentSchemaName;
  if (!tpl) return ["⚠ verify", "get-page `parentSchemaName` not provided for this page — confirm the built page's template", "unverified"];
  if (tpl === vk.exp) return ["✅ Done", `built on \`${esc(vk.exp)}\``, "ok"];
  return ["⚠ verify", `built on \`${esc(tpl)}\` but the plan recommended \`${esc(vk.exp)}\` — confirm the template (top profile island / progress bar)`, "unverified"];
}
// THE MINI PAGE, resolved like every other page: from `--built.pages["mini:<Schema>"]`, the key the engine itself
// published. It is a page, so the SAME D6 tri-state applies — entry with components = built · `false` = reported
// absent (hard MISSING) · no entry = nobody looked (unverified). Emphatically NOT `miniPageBuilt`: that legacy
// boolean is a hand-authored assertion, it is the one field the keyed payload every document prescribes does not
// carry, and while it was the only path, a correctly built mini page could never close its row.
function resolveMiniFromPages(vk, ctx) {
  if (!vk.key) return ["⚠ verify",
    "no page key is published for this mini page — the plan did not FOLD it (assemble its bundle into `manifest.miniPageSchemas`, which the structure gate already demands, and re-plan); until then there is no `--built.pages` key to check it against, and none is invented here", "unverified"];
  return resolveBuiltPageEntry(ctx.root?.pages?.[vk.key], vk.key, "the mini page");
}
// The LEGACY flat payload only (`--built` with no `pages` map — the shape the CLI hard-rejects, kept for the
// direct `renderVerify(result, opts, built)` callers). Once a `pages` map exists, `miniPageBuilt` is NEVER read:
// a keyed payload that also carried the stale boolean would otherwise close the row by assertion, which is the
// defect this split closes. It is an alias for the legacy shape, never a second path out of the keyed one.
function resolveMiniLegacy(ctx) {
  const miniBuilt = entryObject(ctx.page)?.miniPageBuilt ?? ctx.root?.miniPageBuilt;
  if (miniBuilt === true) return ["✅ Done", "created on-stand (legacy flat `--built.miniPageBuilt`)", "ok"];
  if (miniBuilt === false) return ["❌ MISSING", "NOT created — '+ New' still opens the full form", "missing"];
  return ["⚠ verify", "supply `--built.pages` keyed by page (the mini page has its own `mini:<Schema>` key) — this payload carries no page map at all", "unverified"];
}
function resolveMiniVk(vk, ctx) {
  return entryObject(ctx.root?.pages) ? resolveMiniFromPages(vk, ctx) : resolveMiniLegacy(ctx);
}
function resolveStructuralVk(vk, ctx) {
  if (vk.type === "formpage") return resolveFormPageVk(ctx);
  if (vk.type === "template") return resolveTemplateVk(vk, ctx);
  if (vk.type === "mini") return resolveMiniVk(vk, ctx);
  return unknownVk(); // every branch is type-tested: no resolver in this file is reached by fallthrough
}
// IDENTITY leg of the fields row: the plan published the expected element NAMES, so the ONLY acceptable evidence is
// that those names are on the built page. Type-AGNOSTIC (a rich-text / lookup / color / future field still counts,
// matched by name) AND it does not over-count (an unrelated input of the right TYPE but a different NAME cannot
// compensate for a dropped business field). Own fn so `resolveFieldsVk` keeps one level of nesting (Sonar CC 15).
//
// The no-names case is the defect this split closes. A built page whose components carry no `name` at all used to
// FALL BACK to counting components whose `type` matches FIELD_RE — so the right NUMBER of the right TYPE printed
// "N of N expected fields present on the built page" and exited 0, while not one expected field name had been
// shown to exist. Identity was never checked, yet the status text read as though it had been. When names are
// expected, a nameless built set is NOT weaker evidence, it is NO evidence: return `unverified` and say so.
//
// NB the guard is `ops.length && !builtNames.size`, not `!builtNames.size`. A page whose entry IS present and
// yielded NO components at all was checked and is genuinely empty — the honest report there is "0/N present,
// missing: …", which names the shortfall. Only a page that returned components while NONE of them carries a
// `name` is the uncheckable case.
function resolveFieldsByIdentity(vk, names, ops) {
  const builtNames = new Set(ops.filter((o) => o.name).map((o) => o.name));
  if (ops.length && !builtNames.size) return ["⚠ verify",
    `identity NOT checked — the built page returned ${ops.length} component(s) but NOT ONE carries an element name, so none of the ${vk.n} expected field(s) could be matched by name (a matching count of field-typed components is not evidence they are the expected fields); re-run get-page and pass \`bundle.viewConfig\` VERBATIM, where every component keeps its \`name\``, "unverified"];
  const missing = names.filter((n) => !builtNames.has(n));
  const b = names.length - missing.length;
  if (b >= vk.n) return ["✅ Done", `${b} of ${vk.n} expected fields matched BY NAME on the built page`, "ok"];
  const overflow = missing.length > 8 ? "…" : "";
  const miss = missing.length ? ` — missing: ${missing.slice(0, 8).map((n) => esc(String(n))).join(", ")}${overflow}` : "";
  return ["⚠ verify", `${b}/${vk.n} expected fields present${miss}`, "unverified"];
}
// The FIELDS row. Three inputs, three different answers, and the status text must name which one was used:
//   · no `--built.pages[<key>]` entry  ⇒ D6 tri-state — nobody fetched this page, so ⚠ unverified (not ❌, and not
//     the "carried no element names" wording either, which would be a false statement about a page never read);
//   · the vk publishes expected NAMES  ⇒ identity is the only acceptable evidence (`resolveFieldsByIdentity`);
//   · the vk publishes NO names        ⇒ and only then, count components of a field TYPE, saying so in the text.
// Extracted from resolveCountVk for Sonar CC 15.
function resolveFieldsVk(vk, ctx) {
  if (ctx.entryAbsent) return absentEntry(ctx, `the ${vk.n} expected field(s)`);
  const names = [...new Set(vk.names || [])];
  if (names.length) return resolveFieldsByIdentity(vk, names, ctx.ops);
  const b = ctx.ops.filter((o) => ctx.FIELD_RE.test(o.type || "")).length;
  if (b >= vk.n) return ["✅ Done", `${b} of ${vk.n} expected fields present by TYPE — this deliverable published no expected field names, so identity was not checkable`, "ok"];
  return ["⚠ verify", `${b}/${vk.n} components of a field type present — this deliverable published no expected field names, so identity was not checkable`, "unverified"];
}
// Own fn so `resolveCountVk` gains no nested branch when the D6 tri-state arrives (Sonar CC 15).
function resolveImageVk(vk, ctx) {
  const b = ctx.typeCount("crt.ImageInput");
  if (b >= vk.n) return ["✅ Done", `${b} crt.ImageInput built`, "ok"];
  if (b > 0) return ["⚠ verify", `${b}/${vk.n} crt.ImageInput built`, "unverified"];
  if (ctx.entryAbsent) return absentEntry(ctx, "the crt.ImageInput count");
  return ["❌ MISSING", "no crt.ImageInput on the built page — the image field was not added", "missing"];
}
// The component types a built page may legitimately use for a checked deliverable, in ONE place so a platform
// rename is a one-line change here rather than a hunt through the resolvers.
//
// TABS: measured on a live stand (2026-08-08) — `crt.Tab` does NOT exist. `get-component-info` for the target
// environment lists `crt.TabContainer` ("Single tab within a TabPanel") and `crt.TabPanel`, and NO `crt.Tab`;
// eight real Freedom pages across two stands carry 0 `crt.Tab` nodes and 2-7 `crt.TabContainer` each. The gate
// counted `crt.Tab`, so the "Tabs — N expected" row could never read ✅ on a correctly built page. Both spellings
// are accepted rather than swapped: if any older platform version does emit `crt.Tab`, accepting it costs
// nothing, while rejecting `crt.TabContainer` mis-reports every current page.
// NOTE: the mapper now emits `crt.TabContainer` (the type the platform actually builds); `crt.Tab` stays
// accepted here only as a legacy spelling, for a page built before that fix.
const BUILT_TYPES = {
  tabs: TAB_TYPES,
  details: ["crt.DataGrid"],
};
// ENG-95543 — a table-emitted componentType, with the SAME tri-state every other count row applies: an absent
// `--built.pages` entry means nobody looked (⚠), a partial count is ⚠, zero built is ❌. Reusing the tri-state
// rather than a bare `hasType` check is what keeps "the verifier never fetched this page" from reading as
// "you failed to build it".
function resolveElementVk(vk, ctx) {
  const b = ctx.typeCount(vk.ctype);
  if (b >= vk.n) return ["✅ Done", `${b} ${vk.ctype} built`, "ok"];
  if (b > 0) return ["⚠ verify", `${b}/${vk.n} ${vk.ctype} built`, "unverified"];
  if (ctx.entryAbsent) return absentEntry(ctx, `the ${vk.ctype} element(s)`);
  return ["❌ MISSING", `no ${vk.ctype} built (${vk.n} expected)`, "missing"];
}
function resolveCountVk(vk, ctx) {
  if (vk.type === "fields") return resolveFieldsVk(vk, ctx);
  if (vk.type === "image") return resolveImageVk(vk, ctx);
  if (vk.type === "element") return resolveElementVk(vk, ctx);
  const accepted = BUILT_TYPES[vk.type === "tabs" ? "tabs" : "details"];
  const noun = accepted[0]; // what the message names: the spelling a current platform actually builds
  const b = accepted.reduce((n, t) => n + ctx.typeCount(t), 0);
  if (b >= vk.n) return ["✅ Done", `${b} ${noun} built`, "ok"];
  if (b > 0) return ["⚠ verify", `${b}/${vk.n} ${noun} built`, "unverified"];
  if (ctx.entryAbsent) return absentEntry(ctx, `the ${noun} count`);
  return ["❌ MISSING", `no ${noun} built`, "missing"];
}
// The noun the absent-entry message names, per component kind. Own fn so `resolveComponentVk` gains exactly one
// branch for the D6 tri-state and stays under Sonar CC 15.
const COMPONENT_NOUN = { "dcm-bar": "the DCM case progress bar", "dcm-next": "the crt.NextSteps tab", card: "the card-action button" };
function componentNoun(vk) {
  if (vk.type === "feature") return esc(String(vk.ftype || "the standard feature"));
  return COMPONENT_NOUN[vk.type] || "this page's components";
}
// ROLE/ANALOG matching (ENG-95470), now sourced from the SHARED MAPPING TABLE (ENG-95543) — the repoint that
// ticket's own comment asked for. A planned Classic-derived component type is SATISFIED by the real Freedom
// component whose row declares it: a plan that expected `crt.ContactCommunication` (the ContactCommunication
// ENTITY with a `crt.` prefix, a name no stand resolves) is Done when the built page carries
// `crt.CommunicationOptions`. Without this the analog read ❌ MISSING on a correctly built page. Still matched
// STRICTLY against declared pairs, never a fuzzy family, so a wrong component cannot falsely satisfy a row — and
// the pairs now sit beside the mapping they belong to, with the registry check asserting that a legacy name is one
// the registry does NOT carry.
// The Freedom analog types accepted for a planned component type — the curated pair, or `[]` when none. Own fn so
// both `resolveComponentVk` (matching) and `componentTypesOf` (publishing the expected set) read ONE table.
export function componentAnalogsOf(ftype) {
  return analogsOf(ftype);
}
// ROLE/ANALOG match (ENG-95470): the expected component type first, then its curated Freedom analog — a migration
// builds the NATIVE Freedom component, so `crt.CommunicationOptions` satisfies a planned `crt.ContactCommunication`
// row. Own fn so `resolveComponentVk` keeps one level of nesting (Sonar CC 15). The not-checkable (⚠ unverified)
// case is `ctx.entryAbsent`, handled by the caller before this runs — a page the payload cannot see is never ❌.
function resolveFeatureVk(vk, ctx) {
  if (ctx.hasType(vk.ftype)) return ["✅ Done", `found ${vk.ftype}`, "ok"];
  const alts = componentAnalogsOf(vk.ftype);
  const analog = alts.find((t) => ctx.hasType(t));
  if (analog) return ["✅ Done", `found ${analog} — the Freedom analog of ${vk.ftype}`, "ok"];
  const also = alts.length ? ` (nor its analog ${alts.map((t) => esc(t)).join("/")})` : "";
  return ["❌ MISSING", `NO ${vk.ftype}${also} on the built page`, "missing"];
}
export function resolveComponentVk(vk, ctx) {
  const { hasType, parentTpl } = ctx;
  // D6 tri-state, the same one `resolveFormPageVk` / `resolveImageVk` / `resolveCountVk` apply: NO
  // `--built.pages[<key>]` entry means nobody fetched this page, which is NOT the same as fetching it and finding
  // the component absent. Without this branch every COMPONENT row read ❌ MISSING — "you built it wrong" — for a
  // page the verifier simply never looked at, and the builder was sent to rebuild instead of to re-read. This IS
  // R5's not-checkable for an analog component: a page the payload cannot see resolves ⚠ unverified, never MISSING.
  // `false` (reported absent) and a present-but-empty entry still fall through to the hard ❌ below.
  if (ctx.entryAbsent) return absentEntry(ctx, componentNoun(vk));
  if (vk.type === "feature") return resolveFeatureVk(vk, ctx);
  if (vk.type === "dcm-bar") { const ok = hasType("crt.EntityStageProgressBar") || /ProgressBar/i.test(parentTpl); return ok ? ["✅ Done", hasType("crt.EntityStageProgressBar") ? "crt.EntityStageProgressBar built" : `provided by ${esc(parentTpl)}`, "ok"] : ["❌ MISSING", `no crt.EntityStageProgressBar and template is \`${esc(parentTpl)}\``, "missing"]; }
  if (vk.type === "dcm-next") return hasType("crt.NextSteps") ? ["✅ Done", "crt.NextSteps built", "ok"] : ["❌ MISSING", "no crt.NextSteps tab on the built page", "missing"];
  return hasType("crt.Button") ? ["✅ Done", "a crt.Button is present — confirm it triggers the action", "ok"] : ["⚠ verify", "no crt.Button found — confirm the action", "unverified"]; // card
}
// BUSINESS RULES (ENG-95470). A page's declarative rules do NOT live in its body: each persists as a separate
// BusinessRule_* schema, invisible to `viewConfig`, so the row's evidence is `--built.pages[<key>].businessRules` —
// the read-page-business-rules result (`{ count, rules }`, or a bare `rules` array), NOT a page-body walk. Match is
// by IDENTITY the same way fields match by name: an expected target attribute (a page rule's `element` / an entity
// rule's `targetAttribute`, published in `vk.names`) is SATISFIED when a built rule GOVERNS that column — its
// serialized form carries the attribute as a whole token (a name in its condition/actions), never a loose substring
// (so `Contact` does not match `ContactName`). Shape-agnostic on purpose: the tool contract fixes `name` / `caption`
// / `condition` / `actions` but not their inner shape, so tokenizing the whole rule survives a shape change.
// The rule's tokens, or `null` when the slot was never populated (nobody read the rules). Own fn so `resolveRuleVk`
// stays under Sonar CC 15.
function builtRuleTokens(built) {
  let rules = null;
  if (Array.isArray(built)) rules = built;
  else if (Array.isArray(built?.rules)) rules = built.rules;
  if (rules == null) return null;
  return rules.map((r) => new Set(String(JSON.stringify(r)).match(/[A-Za-z_]\w*/g) || []));
}
export function resolveRuleVk(vk, ctx) {
  const want = [...new Set(vk.names || [])];
  if (!want.length) return ["⚠ verify", "no expected business-rule identity was published — nothing to match against", "unverified"];
  // D6 tri-state + R5's not-checkable, in this order: no page entry = nobody fetched the page (⚠ unverified);
  // `false` = the page is reported NOT BUILT, so its rules cannot exist (❌ MISSING); an entry with NO
  // `businessRules` slot = the page was fetched but its rules were never READ — NOT-CHECKABLE (⚠ unverified, and
  // said so, distinct from MISSING), the case this ticket adds so a rule the payload cannot see is never a false ❌.
  if (ctx.entryAbsent) return absentEntry(ctx, `the ${want.length} expected business rule(s)`);
  if (ctx.page === false) return ["❌ MISSING", `the page is reported as NOT BUILT, so none of the ${want.length} expected business rule(s) exist`, "missing"];
  const tokenSets = builtRuleTokens(entryObject(ctx.page)?.businessRules);
  if (tokenSets == null) return ["⚠ verify",
    `business rules NOT checkable — this page entry carries no \`businessRules\` slot; run \`read-page-business-rules\` for the page (or record \`businessRules: []\` once you have confirmed it genuinely has none), so the ${want.length} expected rule(s) can be matched`, "unverified"];
  const missing = want.filter((name) => !tokenSets.some((toks) => toks.has(name)));
  const b = want.length - missing.length;
  // A shortfall is ⚠ unverified, not ❌ MISSING — the same conservative choice `resolveFieldsByIdentity` makes for a
  // by-identity match: this ticket's whole point is to STOP built work reading as MISSING, and a rule matched by a
  // whole-token heuristic must not cry ❌ on a rule the builder named so the column token does not literally appear.
  if (!missing.length) return ["✅ Done", `${b} of ${want.length} business rule(s) present — each expected target attribute is governed by a built page rule`, "ok"];
  const overflow = missing.length > 8 ? "…" : "";
  const miss = ` — missing: ${missing.slice(0, 8).map((n) => esc(String(n))).join(", ")}${overflow}`;
  return ["⚠ verify", `${b}/${want.length} business rule(s) matched by target attribute${miss}`, "unverified"];
}
const VK_STRUCTURAL = new Set(["formpage", "template", "mini"]);
const VK_COUNT = new Set(["fields", "tabs", "details", "image", "element"]);
const VK_COMPONENT = new Set(["feature", "dcm-bar", "dcm-next", "card"]);
const VK_RULE = new Set(["rule"]);
// A REACHABILITY / wiring deliverable (per-type routing, mini-page "+ New" binding, section registration, typed-form
// existence) is a configuration record NOT derivable from a single page's get-page ownBodySummary — but it MUST still
// gate: an unproven one may leave built pages unreachable. So it reads an explicit on-stand EVIDENCE boolean the agent
// supplies in `--built` (e.g. `built.typedRouting`): true → Done; false → MISSING (exit 2); ABSENT → unverified
// (exit 2, NOT "skip") — so `--verify` cannot exit 0 until the wiring is confirmed. (deep-review #1.)
// ENG-95850 (B2) — A WORKPLACE "MOVE" ONLY ADDS. Registering a section into a workplace does not unbind the one it
// was in: on the Applicant run the section sat in "Recruiting" AND still in "My applications" (2 SysModuleInWorkplace
// rows), and a boolean deliverable could not see it, because `true` is the same answer for one binding and for two.
// So a row can declare `expectCount`, and then the payload must carry a COUNT rather than a flag. The count IS the
// deliverable: "bound to exactly one workplace" is checkable, "registered" is not.
// Reported as a number the agent counted on the stand — `{ workplaces: <n>, names: [...] }`; `names` is optional and
// is only ever quoted back to the reader.
// STRICT about the type, like every other acceptance in this engine: a NUMBER, integer, not negative. A string "1"
// is not coerced — an agent that quoted the number has not reported a count this row can gate on, and silently
// accepting the quoted form is how a shape nobody documented becomes load-bearing. Anything else reads ⚠ and the
// row says which object to supply.
function onstandCount(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const n = v.workplaces ?? v.count;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}
const onstandNames = (v) => {
  const names = Array.isArray(v?.names) ? v.names.filter((x) => typeof x === "string" && x.trim()) : [];
  return names.length ? ` (${names.map((x) => esc(x)).join(", ")})` : "";
};
// ENG-95470 (defect 4 review) — WHERE THE COUNT CAME FROM, as structure rather than prose. Verify may carry a
// build unit's OWN claimed count forward into this field on a round where its own independent on-stand check is
// skipped or missed — necessary so the row does not stay stuck at `reachability: {}` forever, but it means the
// count in `n` is sometimes a self-report rather than something Verify itself confirmed. Absent `source` on an
// older payload defaults to `"verified"` (this field did not exist before this ticket, and every payload written
// before it came only from Verify's own count).
function onstandSource(v) {
  return v && typeof v === "object" && v.source === "carried-forward" ? "carried-forward" : "verified";
}
// The count-gated form of an `onstand` row. Its own fn so `resolveOnstandVk` stays under Sonar CC 15 and the boolean
// path below is provably untouched for every row that declares no `expectCount`.
// A bare `true` is NOT acceptance here, deliberately: it is exactly the answer that hid the second binding, so it
// reads ⚠ unverified and names the number to supply. That does re-open a row an earlier run closed with `true` —
// which is what adding a gate means, and the row asks for a specific number rather than failing mutely.
function resolveOnstandCountVk(vk, v) {
  const want = vk.expectCount;
  if (v === false) return ["❌ MISSING", `NOT wired (built.${vk.evidence} = false)${vk.miss ? " — " + vk.miss : ""}`, "missing"];
  const n = onstandCount(v);
  if (n === null) {
    return ["⚠ verify", v === true
      ? `registered, but the BINDING COUNT was not reported — a move only ADDS, so \`true\` cannot tell one binding from two; supply \`built.reachability.${vk.evidence} = { "workplaces": <n>, "names": [...] }\` with the rows you actually counted`
      : `not confirmed — supply \`built.reachability.${vk.evidence} = { "workplaces": <n>, "names": [...] }\`, the number of workplace bindings this section actually has`, "unverified", "verifier"];
  }
  if (n === want) return resolveOnstandExactMatch(want, v);
  if (n === 0) return ["❌ MISSING", `bound to NO workplace${vk.miss ? " — " + vk.miss : ""}`, "missing"];
  return ["❌ MISSING", `bound to ${n} workplaces${onstandNames(v)}, expected exactly ${want} — a registration only ADDS, so the previous binding is still there; unbind all but the intended one (this row REPORTS it, the build does not undo it on its own)`, "missing"];
}
// ENG-95470 (defect 4 review) — split out of `resolveOnstandCountVk` so that function stays under Sonar CC 15.
// The count matches what the row wants; whether that closes the row depends on WHERE the count came from.
function resolveOnstandExactMatch(want, v) {
  if (onstandSource(v) === "carried-forward") {
    return ["⚠ verify", `bound to exactly ${want} workplace${want === 1 ? "" : "s"}${onstandNames(v)} — but this count is CARRIED FORWARD from the build unit's own claim, not independently confirmed by Verify this round; re-run the on-stand check to close this row for real`, "unverified"];
  }
  return ["✅ Done", `bound to exactly ${want} workplace${want === 1 ? "" : "s"}${onstandNames(v)}`, "ok"];
}
function resolveOnstandVk(vk, ctx) {
  const v = reachabilityValue(ctx.root, vk.evidence);
  const what = vk.what ? ` — run the on-stand ${vk.what}` : "";
  if (vk.expectCount) return resolveOnstandCountVk(vk, v);
  if (v === true) return ["✅ Done", `${vk.evidence} confirmed on-stand`, "ok"];
  if (v === false) return ["❌ MISSING", `NOT wired (built.${vk.evidence} = false)${vk.miss ? " — " + vk.miss : ""}`, "missing"];
  return ["⚠ verify", `not confirmed — supply built.${vk.evidence} (true/false)${what}`, "unverified", "verifier"];
}
const VK_ONSTAND = new Set(["onstand"]);
// PACKAGE PLACEMENT — the built page's own package, read off THIS page's entry. A page saved into the wrong
// package is built and invisible to the customer's app; nothing in its body shows that, so `get-page`'s page
// metadata (`packageName`) is the source. The row only exists when the plan named a target package.
function resolvePlacementVk(vk, ctx) {
  if (vk.type !== "placement") return unknownVk();
  const pkg = entryObject(ctx.page)?.packageName;
  if (pkg == null || pkg === "") return ["⚠ verify", `built-page package not reported — confirm the page lives in \`${esc(vk.exp)}\``, "unverified"];
  if (pkg === vk.exp) return ["✅ Done", `built in \`${esc(vk.exp)}\``, "ok"];
  return ["❌ MISSING", `built in \`${esc(String(pkg))}\` but the plan targets \`${esc(vk.exp)}\``, "missing"];
}
// THE ENTITY BINDING — read off THIS page's entry, exactly like the package. The two failures it separates are
// different facts and must read differently: a page bound to the WRONG object is a built page that migrates
// nothing (❌ MISSING, and the message names both objects so the repair is obvious), while an entry that does not
// report an entity at all is nobody-looked (⚠ unverified). Never `!value`: an absent field is not a wrong binding.
function resolveEntityVk(vk, ctx) {
  if (vk.type !== "entity") return unknownVk();
  const ent = entryObject(ctx.page)?.entitySchemaName;
  if (ent == null || ent === "") return ["⚠ verify", `built-page entity not reported — record \`entitySchemaName\` (the entity the page's PRIMARY data source is bound to) and confirm it is \`${esc(vk.exp)}\``, "unverified"];
  if (ent === vk.exp) return ["✅ Done", `bound to \`${esc(vk.exp)}\``, "ok"];
  return ["❌ MISSING", `bound to \`${esc(String(ent))}\` but the Classic page's object is \`${esc(vk.exp)}\` — the customer's records live on \`${esc(vk.exp)}\`, so this page migrates nothing`, "missing"];
}
// A CHILD PAGE whose Classic source was never folded: nothing about it is derivable from the plan, so the only
// machine question left is "does a page exist for this key, and does it have any content". Resolved from the
// EXTRACTED CONTENT, never from key presence — `"child:X": {}` (or `{ viewConfig: {} }`) is an empty page, and
// treating the key's existence as proof let an unbuilt child close the gate at exit 0.
// It has its OWN set and an explicit type test. `VK_STRUCTURAL` used to end in a FALLTHROUGH branch with no type
// test — adding `childpage` to that set would have made a stray `miniPageBuilt: true` mark every child page Done.
// That branch is gone (`resolveStructuralVk` now type-tests all three and falls back to `unknownVk`), but the
// rule stands: never add a type to a set whose last branch is reached without testing the type.
// "Does a page exist under this key, and does it have any content" — D6's tri-state over ONE `--built.pages`
// entry, shared by the two rows that ask exactly that question about a whole page: an unfolded CHILD page (below)
// and the MINI page (`resolveMiniFromPages`). One implementation so the two can never drift into answering the
// same question differently — and so the mini row cannot quietly keep a second, assertion-shaped path.
function resolveBuiltPageEntry(entry, key, noun) {
  if (entry === false) return ["❌ MISSING", `no page built for \`${esc(key)}\` (--built reported it absent)`, "missing"];
  if (entry == null) return ["⚠ verify", `no \`--built.pages["${esc(key)}"]\` entry — get-page ${noun} (or record \`false\` if it was deliberately not built)`, "unverified"];
  const ops = pageOpsOf(entry);
  if (ops.length) return ["✅ Done", `page built — ${ops.length} component(s) returned by get-page`, "ok"];
  return ["⚠ verify", `the \`${esc(key)}\` entry yielded NO components — confirm the page was really built (an empty viewConfig proves nothing)`, "unverified"];
}
function resolveChildPageVk(vk, ctx) {
  if (vk.type !== "childpage") return unknownVk();
  return resolveBuiltPageEntry(ctx.page, ctx.pageKey, "this child page");
}
// EVIDENCE — a deliverable no page body can prove (the page-DESIGN pass, a ⚠ Confirm item). Two independent
// writers must agree before it closes: the read-only verifier files the record under the engine-derived id, and a
// SEPARATE judge marks it convincing. Silence is NOT consent — an absent judge leaves the row unverified, so a
// self-asserted "done" can no longer close it; `convincing: false` (or a `false` record) is a hard MISSING.
function resolveEvidenceVk(vk, ctx) {
  if (vk.type !== "evidence") return unknownVk();
  // ENG-95859 — `part` routes to the split verdict (see `qualityGateRows`). Every OTHER evidence row (a ⚠ Confirm
  // item, an unfolded child page) carries no `part` and keeps the original combined behavior unchanged below.
  if (vk.part === "filed") return resolveEvidenceFiledPart(vk, ctx);
  if (vk.part === "judged") return resolveEvidenceJudgedPart(vk, ctx);
  return resolveEvidenceCombinedVk(vk, ctx);
}
function resolveEvidenceCombinedVk(vk, ctx) {
  const rec = ctx.root?.evidence?.[vk.id];
  const judged = ctx.root?.judge?.[vk.id]?.convincing;
  const need = `\`${esc(vk.id)}\` (needs ${(vk.requires || EVIDENCE_REQUIRES).join(" + ")}${vk.allowNoDiff ? " (or components: [] + noChangesReason)" : ""}) + an independent judge verdict`;
  // A record filed as `false` is the VERIFIER stating the deliverable is genuinely absent, so it is a hard
  // MISSING — the judge never overrides it, because a judge rules on records and does not create them.
  // But it must not be reported as the JUDGE's doing. A live run filed `false` here while the judge, having
  // read the built page, wrote `convincing: true` and named the replacement elements it found by name; the
  // row said "judge verdict filed as `false`" — blaming the judge for a verdict it did not write, and hiding
  // the one signal that actually mattered: the two roles DISAGREE, so one of them is wrong about the page.
  // Surface both, and say which way to resolve it.
  if (rec === false) {
    const why = ctx.root?.judge?.[vk.id]?.why;
    let contradiction = "";
    if (judged === true) {
      const whyText = why ? ` ("${esc(String(why)).slice(0, 240)}")` : "";
      contradiction = ` — NOTE: the judge reviewed it and DISAGREES${whyText}. One of the two is wrong about the built page: re-file the record with what is actually there, or confirm the deliverable really is absent.`;
    }
    return ["❌ MISSING", `evidence record ${need} was FILED AS \`false\` by the verifier — reported genuinely absent${contradiction}`, "missing"];
  }
  if (judged === false) return ["❌ MISSING", `the judge REJECTED the evidence for ${need}${ctx.root.judge[vk.id].why ? " — " + esc(String(ctx.root.judge[vk.id].why)) : ""}`, "missing"];
  if (evidenceComplete(rec, vk.requires, vk.allowNoDiff) && judged === true) return ["✅ Done", `evidence filed under \`${esc(vk.id)}\` and judged convincing`, "ok"];
  if (!evidenceComplete(rec, vk.requires, vk.allowNoDiff)) return ["⚠ verify", `no complete evidence record under ${need}`, "unverified", "verifier"];
  return ["⚠ verify", `evidence filed under \`${esc(vk.id)}\` but NOT judged — a record nobody reviewed is not a closed row`, "unverified", "verifier"];
}
// ENG-95859 — the FILED half in isolation: did the verifier file a complete record? Deliberately silent about the
// judge (that is the other row's question) — reusing `resolveEvidenceCombinedVk`'s wording would have this row's
// status swing on a fact it does not claim to check.
function resolveEvidenceFiledPart(vk, ctx) {
  const rec = ctx.root?.evidence?.[vk.id];
  const need = `\`${esc(vk.id)}\` (needs ${(vk.requires || EVIDENCE_REQUIRES).join(" + ")}${vk.allowNoDiff ? " (or components: [] + noChangesReason)" : ""})`;
  if (rec === false) return ["❌ MISSING", `evidence record ${need} was FILED AS \`false\` by the verifier — reported genuinely absent`, "missing"];
  if (evidenceComplete(rec, vk.requires, vk.allowNoDiff)) return ["✅ Done", `evidence filed under \`${esc(vk.id)}\``, "ok"];
  return ["⚠ verify", `no complete evidence record under ${need}`, "unverified", "verifier"];
}
// ENG-95859 — the JUDGED half in isolation: did an independent reviewer find the filed record convincing? A run
// that filed a complete record but was never reviewed reads ⚠ HERE (not ✅, the way the old combined row could
// look identical to a run that skipped the design pass) — distinct from "not judged because there is nothing yet
// to judge", which points the reader at the row above instead of at the judge.
function resolveEvidenceJudgedPart(vk, ctx) {
  const rec = ctx.root?.evidence?.[vk.id];
  const judged = ctx.root?.judge?.[vk.id]?.convincing;
  const why = ctx.root?.judge?.[vk.id]?.why;
  const need = `\`${esc(vk.id)}\``;
  if (rec === false) {
    let contradiction = "";
    if (judged === true) {
      const whyText = why ? ` ("${esc(String(why)).slice(0, 240)}")` : "";
      contradiction = ` — NOTE: the judge reviewed it and DISAGREES${whyText}. One of the two is wrong about the built page.`;
    }
    return ["❌ MISSING", `evidence record ${need} was FILED AS \`false\` — there is nothing for a judge to confirm${contradiction}`, "missing"];
  }
  if (judged === false) return ["❌ MISSING", `the judge REJECTED the evidence for ${need}${why ? " — " + esc(String(why)) : ""}`, "missing"];
  if (judged === true) return ["✅ Done", `judged convincing for ${need}`, "ok"];
  if (!evidenceComplete(rec, vk.requires, vk.allowNoDiff)) return ["⚠ verify", `not judged yet — no complete evidence record has been filed under ${need} for a judge to review`, "unverified", "verifier"];
  return ["⚠ verify", `evidence filed under ${need} but NOT judged — a record nobody reviewed is not a closed row`, "unverified", "verifier"];
}
// Is an evidence record complete? Every required field must carry a value of the RIGHT SHAPE, not merely a value.
// The earlier predicate ended in `v != null`, so `components: false`, `components: {}` and `referencePage: 0` all
// counted as a complete record and closed the row — a record that names no page and lists no component proves
// nothing, and the judge is handed junk to bless. Each required field is typed; anything else is incomplete
// (⇒ ⚠ unverified, never a silent pass). Extracted so `resolveEvidenceVk` stays under Sonar CC 15.
const nonBlankString = (v) => typeof v === "string" && v.trim() !== "";
const nonEmptyStringList = (v) => Array.isArray(v) && v.length > 0 && v.every(nonBlankString);
// ENG-95471 — an evidence row that allows it (today, only `#quality-gates`) accepts an EMPTY `components` list
// as complete, but ONLY paired with a non-blank `noChangesReason` on the same record: the empty list alone still
// proves nothing (that is exactly the silence this shape used to let through), the reason is what earns the pass.
// A row that does NOT set `allowNoDiff` never reaches this branch — `nonEmptyStringList` still gates it alone.
const componentsFieldOk = (v, rec, allowNoDiff) =>
  nonEmptyStringList(v) || (allowNoDiff === true && Array.isArray(v) && v.length === 0 && nonBlankString(rec?.noChangesReason));
// Per-field shape for the fields the engine itself requires. A `requires` entry with no entry here falls back to
// the STRICT generic shape (a non-blank string, or a non-empty list of non-blank strings) — deliberately not an
// "unknown field ⇒ accept" escape, which would reintroduce the same hole under another name.
const EVIDENCE_FIELD_SHAPE = { referencePage: nonBlankString, components: componentsFieldOk };
const evidenceFieldOk = (k, v, rec, allowNoDiff) =>
  (EVIDENCE_FIELD_SHAPE[k] || ((x) => nonBlankString(x) || nonEmptyStringList(x)))(v, rec, allowNoDiff);
function evidenceComplete(rec, requires, allowNoDiff) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return false;
  return (requires || EVIDENCE_REQUIRES).every((k) => evidenceFieldOk(k, rec[k], rec, allowNoDiff));
}
// LIST-PAGE deliverables, MEASURED off the built page. A column set and a filter bar are IN the page body, so they
// are the same class of check as a form field and get the same treatment: match the expected identities against what
// the page actually carries. Never close a body-answerable row on a filed record — that lets a build agent's own
// claim stand in for the page.
//
// Columns match by their `PDS_*` CODE, which is the grid's own identity for a column (`walkGridColumnCodes`); a
// filter matches by ELEMENT NAME off the ordinary flattened ops, because a quick filter IS a named page item and
// was always visible there. Both keep D6's tri-state: no entry for the page is `⚠ unverified` (nobody looked), a
// page reported absent or built short is `❌ MISSING`, and the message NAMES what is missing so the repair is
// mechanical rather than a re-derivation.
// `vk.columns` pairs each classic column with the `PDS_*` code the ChangeSet emitted for it, so the gate matches the
// EXACT string the builder was told to write — the mapping is never re-derived here, where it could drift from the
// emission side and fail a correctly built page.
function resolveListColumnsVk(vk, ctx) {
  const want = (vk.columns || []).filter((c) => c?.code);
  if (!want.length) return ["⚠ verify", "no expected column set was published — nothing to match against", "unverified"];
  if (ctx.entryAbsent) return absentEntry(ctx, `the ${want.length} expected list column(s)`);
  // D6's third state: the entry is `false`, i.e. the verifier looked and reports the page as NOT BUILT. Still a hard
  // MISSING, but never described as an empty grid — the repair is to build the page, not to add columns to one.
  if (ctx.page === false) return ["❌ MISSING", `the list page is reported as NOT BUILT, so none of the ${want.length} expected column(s) exist`, "missing"];
  const { codes: built, anchored } = ctx.gridColumns;
  // A page that was fetched but carries NO grid columns at all is a different failure from one missing a few: the
  // grid was never configured, so say that instead of listing every column as individually absent. The two ways of
  // arriving there read differently, because the repair differs: an EMPTY grid is a build defect, whereas a page with
  // no grid node at all is either the wrong page or a payload taken from the wrong source.
  const where = anchored ? ` (\`${LIST_GRID}\` carries no \`columns\`)` : ` (no \`${LIST_GRID}\` node on the page, and no columns anywhere on it — check that this payload is the LIST page)`;
  if (!built.size) return ["❌ MISSING", `NO grid columns on the built list page — the ${want.length} expected column(s) were not configured${where}`, "missing"];
  const missing = want.filter((c) => !built.has(c.code));
  const from = anchored ? "" : ` — NB: matched outside \`${LIST_GRID}\` (no such node on the page), so confirm the grid itself carries them`;
  // Anchored ⇒ a real ✅. Unanchored means the grid was not found at all, which is nearer "wrong payload" than "done",
  // so it reads ⚠ verify — status and outcome agree, as they do for every other row in this file.
  if (!missing.length && anchored) return ["✅ Done", `${want.length} of ${want.length} expected columns matched BY CODE on the built list page`, "ok"];
  if (!missing.length) return ["⚠ verify", `${want.length} of ${want.length} expected columns matched BY CODE${from}`, "unverified"];
  const overflow = missing.length > 8 ? "…" : "";
  const named = missing.slice(0, 8).map((c) => `${esc(String(c.name))} (\`${esc(String(c.code))}\`)`).join(", ");
  return ["❌ MISSING", `${want.length - missing.length}/${want.length} expected columns present — missing: ${named}${overflow}`, "missing"];
}
// A filter row needs BOTH halves: the element name AND `crt.QuickFilter`. Name alone closed on any component that
// happened to carry the name — and the control IS the deliverable here, which is why the unit publishes the type.
function resolveListFilterVk(vk, ctx) {
  const want = [...new Set(vk.names || [])];
  if (!want.length) return ["⚠ verify", "no expected filter element was published — nothing to match against", "unverified"];
  if (ctx.entryAbsent) return absentEntry(ctx, `the quick filter ${want.join(", ")}`);
  if (ctx.page === false) return ["❌ MISSING", `the list page is reported as NOT BUILT, so ${want.join(", ")} does not exist`, "missing"];
  const byName = new Map(ctx.ops.filter((o) => o.name).map((o) => [o.name, o.type || ""]));
  const missing = want.filter((n) => !byName.has(n));
  // Present under the right name but the WRONG type is its own failure, and it must not read as absent: the element
  // is there, so the repair is to change its type rather than to add a filter.
  const wrongType = want.filter((n) => byName.has(n) && byName.get(n) !== LIST_FILTER_TYPE);
  if (!missing.length && !wrongType.length) return ["✅ Done", `${want.join(", ")} present on the built list page as \`${LIST_FILTER_TYPE}\` (matched BY NAME + TYPE)`, "ok"];
  // An op list with no names at all cannot answer identity — that is a payload problem, not a build defect.
  if (ctx.ops.length && !byName.size) return ["⚠ verify", `identity NOT checked — the built list page returned ${ctx.ops.length} component(s) but NOT ONE carries an element name; re-run get-page and pass \`bundle.viewConfig\` VERBATIM`, "unverified"];
  if (wrongType.length) {
    const built = wrongType.map((n) => esc(String(n)) + " is built as `" + esc(byName.get(n) || "an untyped component") + "`").join(", ");
    return ["❌ MISSING", `${built}, not \`${LIST_FILTER_TYPE}\` — the filter bar needs the quick-filter control, not a field with the same name`, "missing"];
  }
  return ["❌ MISSING", `NO ${missing.map((n) => esc(String(n))).join(", ")} on the built list page — the registry filter bar is short this filter`, "missing"];
}
const VK_LIST = new Set(["listcolumns", "listfilter"]);
const VK_PLACEMENT = new Set(["placement"]);
const VK_ENTITY = new Set(["entity"]);
const VK_CHILDPAGE = new Set(["childpage"]);
const VK_EVIDENCE = new Set(["evidence"]);
const unknownVk = () => ["⚠ verify", "confirm on-stand", "unverified"];
// A row that is deliberately NOT a deliverable (ENG-95861: an approved cross-section boundary). Resolved BEFORE any
// `vk` lookup and tallied as `skip`, so it can never become MISSING or unverified — there is nothing to build. It
// stays a visible row: a boundary the reader cannot see is a boundary the next round re-litigates.
const naRow = (r) => [`N/A — ${esc(r.na)}`, "not a deliverable of this plan — nothing to build, nothing to check", "skip"];
export function resolveVk(vk, ctx) {
  if (!vk) return ["☐ confirm on-stand", "not derivable from get-page — confirm (render / on-stand query)", "skip"];
  if (VK_STRUCTURAL.has(vk.type)) return resolveStructuralVk(vk, ctx);
  if (VK_COUNT.has(vk.type)) return resolveCountVk(vk, ctx);
  if (VK_LIST.has(vk.type)) return vk.type === "listcolumns" ? resolveListColumnsVk(vk, ctx) : resolveListFilterVk(vk, ctx);
  if (VK_COMPONENT.has(vk.type)) return resolveComponentVk(vk, ctx);
  if (VK_RULE.has(vk.type)) return resolveRuleVk(vk, ctx);
  if (VK_ONSTAND.has(vk.type)) return resolveOnstandVk(vk, ctx);
  if (VK_PLACEMENT.has(vk.type)) return resolvePlacementVk(vk, ctx);
  if (VK_ENTITY.has(vk.type)) return resolveEntityVk(vk, ctx);
  if (VK_CHILDPAGE.has(vk.type)) return resolveChildPageVk(vk, ctx);
  if (VK_EVIDENCE.has(vk.type)) return resolveEvidenceVk(vk, ctx);
  return unknownVk();
}

// --- the `--built` payload, read per page ------------------------------------------------------------------
// `--built.pages[<key>]` is what clio `get-page` returned for ONE page: `{ viewConfig, packageName,
// parentSchemaName }`, or `false` when the page is genuinely absent. `viewConfig` comes VERBATIM from the
// response `bundle` — the MERGED page, template included. Deliberately not the page's own body: an element the
// TEMPLATE provides is touched with `operation: "merge"` and carries NO type (see
// `tests/fixtures/test1_form_page_live.js`), so a check fed the own body could never confirm Feed, FileList,
// ApprovalList, ContactCommunication or the DCM bar — they would read ❌ MISSING on a correctly built page.
const entryObject = (e) => (e && typeof e === "object" ? e : null);
// `bundle.viewConfig` is a JSON TREE (`items` nesting) — plain JSON, no parser involved. Walk it into the flat
// `{name, type}` op list every resolver already counts. Nodes carry no `parentName`; that is safe, because no
// resolver reads one (fields match on `name`, everything else counts `type`).
function walkViewConfig(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) { walkViewConfig(n, out); } return out; }
  if (!node || typeof node !== "object") return out;
  if (node.name != null || node.type != null) out.push({ name: node.name, type: node.type });
  return walkViewConfig(node.items, out);
}
// GRID COLUMNS are the one deliverable a `{name, type}` flattening cannot see: a Freedom list page keeps them as
// DATA inside the grid's own op (`DataTable` carries `values.columns: [{ code: "PDS_<Col>", … }]`), not as page
// items with a name and a type, so `walkViewConfig` walks past them.
//
// Read them from the NODE THE CHANGESET TARGETS (`LIST_GRID`), never from wherever a `columns` array turns up: a
// stock list page ships `DataTable_Summaries` beside the grid, and a detail on the page can carry its own columns, so
// a page-wide search closes this deliverable on another node's data — including on a grid whose own `columns` is
// empty. Fall back to the page-wide read ONLY when no such node exists, and tell the caller which read it got, so the
// verdict can say so instead of implying the grid was found.
function collectColumnCodes(cols, out) {
  for (const c of cols || []) { const code = c?.code ?? c?.name; if (typeof code === "string" && code.trim()) out.add(code.trim()); }
  return out;
}
// A node's own columns, under either shape: `values.columns` on a diff op, `columns` on a rendered node.
function columnsOf(node) {
  if (Array.isArray(node?.columns)) return node.columns;
  if (Array.isArray(node?.values?.columns)) return node.values.columns;
  return null;
}
// Every node named `LIST_GRID`, under either shape (a diff op's `values.columns`, a rendered node's `columns`).
function findGridNodes(node, out = []) {
  if (Array.isArray(node)) {
    for (const n of node) { findGridNodes(n, out); }
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (node.name === LIST_GRID && columnsOf(node)) out.push(node);
  for (const v of Object.values(node)) if (v && typeof v === "object") findGridNodes(v, out);
  return out;
}
function walkGridColumnCodes(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const n of node) { walkGridColumnCodes(n, out); }
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const cols = columnsOf(node);
  collectColumnCodes(cols, out);
  for (const v of Object.values(node)) if (v && typeof v === "object") walkGridColumnCodes(v, out);
  return out;
}
// `{ codes, anchored }` — `anchored` is true when the codes came from the grid node itself.
function pageGridColumnsOf(entry) {
  const e = entryObject(entry);
  if (!e) return { codes: new Set(), anchored: false };
  const root = e.viewConfig != null ? e.viewConfig : e.ops;
  const grids = findGridNodes(root);
  if (grids.length) {
    const codes = new Set();
    for (const g of grids) collectColumnCodes(columnsOf(g), codes);
    return { codes, anchored: true };
  }
  return { codes: walkGridColumnCodes(root), anchored: false };
}
// This page's record. `pages` ABSENT ⇒ the single-page payload shape: the whole object IS the main page (what the
// direct `renderVerify(result, opts, built)` callers supply). The fallback is keyed on `pages` being absent and
// NEVER on the ENTRY being absent: once a map is supplied, an omitted key stays "not checked" (unverified) —
// falling back to the root there would resolve a CHILD's counts against the MAIN page's components, which is the
// exact false green this gate exists to close.
function pageEntryOf(root, pageKey) {
  if (!entryObject(root.pages)) return pageKey === "main" ? root : undefined;
  return root.pages[pageKey];
}
function pageOpsOf(entry) {
  const e = entryObject(entry);
  if (!e) return [];
  if (e.viewConfig != null) return walkViewConfig(e.viewConfig);
  return Array.isArray(e.ops) ? e.ops : [];
}
// REACHABILITY is ROOT-level data (a RelatedPage binding / the app menu — a config record, not a page body), so
// it is read off the payload itself, never off a page entry. Canonical home is `reachability`; a payload that
// carries the boolean at the top level still resolves, but ONLY where `reachability` says nothing about that key
// — `reachability.<k> === false` is a hard MISSING and must never be overturned by a stale root-level `true`.
function reachabilityValue(root, key) {
  const v = root?.reachability?.[key];
  return v === undefined ? root?.[key] : v;
}
const VERIFY_FIELD_RE = /^crt\.(Input|ComboBox|DateTimePicker|Checkbox|NumberInput|MoneyInput|ColorEdit|TextArea|MultilineInput)$/;
// ONE ctx per page (D8). It carries BOTH this page's record and the payload ROOT: `placement` and every
// count/structural check read the PAGE (so a child's field count can never be closed by the parent's
// components), while `onstand` / `evidence` / `childpage` read the ROOT (reachability, evidence and judge
// records are run-level, not page-level). `parentTpl` has NO plan fallback — reading the PLANNED template here
// let `dcm-bar` show ✅ Done off a template nobody built while the `template` row went ⚠ on the same input.
export function verifyCtx(root, pageKey) {
  const page = pageEntryOf(root, pageKey);
  const ops = pageOpsOf(page);
  const typeCount = (t) => ops.filter((o) => (o.type || "") === t).length;
  return {
    pageKey, page, root, ops, typeCount,
    // The built page's GRID COLUMN codes — read once per page, like `ops`, so the list-column resolver measures the
    // page instead of trusting a report about it. `.anchored` says whether they came from the grid node itself.
    gridColumns: pageGridColumnsOf(page),
    // D6 tri-state, decided ONCE here where `pageEntryOf`'s three outcomes are still distinguishable: `undefined`
    // = no entry (nobody looked) · `false` = reported absent · an object = looked at, whatever it contained. Past
    // `pageOpsOf` the first two are both `[]` and no resolver can tell them apart any more.
    entryAbsent: page === undefined,
    hasType: (t) => typeCount(t) > 0,
    FIELD_RE: VERIFY_FIELD_RE,
    parentTpl: entryObject(page)?.parentSchemaName || "",
  };
}
function verifyCtxFactory(root) {
  const cache = new Map();
  return (pageKey) => {
    if (!cache.has(pageKey)) cache.set(pageKey, verifyCtx(root, pageKey));
    return cache.get(pageKey);
  };
}
// Per-page AND total tallies. Per-page matters because the table now spans a whole page TREE: "3 missing" with no
// page attribution tells a builder to re-check everything, when only one child page is short.
// Each page also keeps its OPEN ROWS — the rows that are not ✅, with the very Deliverable / Status / Evidence
// text the table shows. That text is the repair instruction ("missing: Amount", "built in `X` but the plan targets
// `Y`", "filed but NOT judged"), and until now the only way to get it was to read the Markdown: the machine return
// carried three integers per page and the stderr line carried at most six pages. A caller scheduling repair rounds
// had to transcribe a table — the "verdict asserted, not computed" failure this gate exists to remove.
// ENG-95901 — `complete` conflates two states that need opposite responses: a shortfall THIS BUILDER can close in
// its own context, and a row only a separate read-only verifier/judge can file. `buildComplete` is the build-only
// axis, so a page whose sole open rows are unfiled evidence reports its BUILD as done while those rows stay visible
// on their own. `complete` is kept exactly as before (missing||unverified) for the post-hoc `--verify` CLI verdict
// (AC7/AC8), which still treats an unconfirmed row as a reason not to call the page done.
//
// PR review: the axis is keyed on the row's OWNER, not on its `missing`/`unverified` label. Keying it on the label
// was wrong in the dangerous direction — `resolveFieldsByIdentity` returns `unverified` for ANY field count below
// expected including `0/N`, `resolveCountVk` returns it for any partial component count, and "no `--built.pages`
// entry" / "re-run get-page and pass viewConfig VERBATIM" are `unverified` too. All of those are the builder's own,
// named, actionable work, and a page with none of its expected fields reported `buildComplete: true`.
function verifyTally() {
  const t = { missing: 0, unverified: 0, builderOpen: 0, pages: {} };
  t.add = (pageKey, outcome, row, owner) => {
    const p = t.pages[pageKey] || (t.pages[pageKey] = { missing: 0, unverified: 0, builderOpen: 0, complete: true, buildComplete: true, openRows: [] });
    if (outcome !== "missing" && outcome !== "unverified") return;
    t[outcome]++; p[outcome]++; p.complete = false;
    // `builderOpen` is the count that matches the axis — how many open rows this builder can actually act on. The
    // scoped exit-2 diagnostic reports THIS, not `missing`: a `0/N expected fields` page has `missing: 0` and would
    // otherwise announce "0 MISSING deliverable(s)" while exiting 2, which reads as a broken gate.
    if (owner !== "verifier") { p.buildComplete = false; p.builderOpen++; t.builderOpen++; }
    p.openRows.push(row);
  };
  return t;
}
// D12 — exit 2 is NOT one condition, and the two it conflates need opposite responses. `verifyIncomplete` says MY
// BUILD is short: build the missing pieces, file the evidence, re-verify. `gate` / `structure` / `coverage` say
// the PLAN is incomplete — they fire in every mode, describe the MANIFEST, and no amount of building clears them;
// re-running `--verify` in a loop against them costs time and never converges. Name which one this run hit.
export function planGaps(result) {
  const g = [];
  if (result?.gate?.blocked) g.push(`gate BLOCKED (${(result.gate.reasons || []).length} correctness signal(s))`);
  if (result?.structure?.complete === false) g.push(`structure INCOMPLETE (${(result.structure.issues || []).length} missing input(s))`);
  if (result?.coverage?.complete === false) g.push(`coverage INCOMPLETE (${(result.coverage.issues || []).length} unaccounted member(s))`);
  return g;
}
function verifyVerdict(missing, unverified) {
  if (missing > 0) return `⛔ **INCOMPLETE — ${missing} machine-checked deliverable(s) MISSING from YOUR BUILD** (build them / file the evidence, then re-verify)`;
  if (unverified > 0) return `⚠ **${unverified} machine row(s) not confirmed** — resolve before calling it done`;
  return `✅ **All machine-checkable deliverables present on the built page** (still confirm the ☐ agent rows)`;
}
// The PLAN-gap banner (D12), stated separately from the build verdict so the two are never read as one condition.
function planGapBanner(result) {
  const gaps = planGaps(result);
  if (!gaps.length) return [];
  return ["", `> ⛔ **PLAN-level gap — NOT buildable-out-of:** ${gaps.join(" · ")}. This describes the plan/manifest, not your build: the CLI exits 2 for it in EVERY mode, and re-running \`--verify\` can never clear it. Return it to the caller; fix the manifest and re-plan.`];
}

export function renderVerify(result, opts = {}, built = {}) {
  const root = entryObject(built) || {};
  const ctxFor = verifyCtxFactory(root);
  const tally = verifyTally();
  // `opts.scopePageKey` narrows the table AND the verdict to ONE page — the in-context single-unit gate's view
  // (ENG-95469), the same scoping `renderChecklist` already applies. The UNSCOPED sweep is the post-hoc gate and is
  // the same row set the full table renders, so the two never disagree about a page; scoping only drops OTHER pages'
  // rows, leaving the kept page's rows (and thus its tally) identical.
  const groups = opts.scopePageKey ? scopeGroups(checklistGroups(result, opts), opts.scopePageKey) : checklistGroups(result, opts);
  const L = []; let n = 0;
  for (const g of groups) {
    L.push("", `**${g.title}**`, "", "| # | Deliverable | Status | Evidence (built page) |", "| --- | --- | --- | --- |");
    for (const r of g.rows) {
      const key = r.pageKey || g.pageKey || "main";
      const [mark, ev, outcome, owner] = r.na ? naRow(r) : resolveVk(r.vk, ctxFor(key));
      // The open-row record carries the SAME three cells the reader sees, plus the row number and the evidence id
      // when the row has one — so a caller repairing from the JSON and a human reading the table are looking at
      // one text, not a paraphrase of it.
      const rowNo = ++n;
      // `owner` rides along on the open row too: a caller repairing from the JSON needs to know which rows are
      // its own without re-deriving the classification the engine already made.
      tally.add(key, outcome, { n: rowNo, deliverable: r.label, status: mark, evidence: ev, outcome,
        owner: owner === "verifier" ? "verifier" : "builder", ...(r.id ? { id: r.id } : {}) }, owner);
      L.push(`| ${rowNo} | ${r.label} | ${mark} | ${esc(ev)} |`);
    }
  }
  const { missing, unverified, builderOpen, pages } = tally;
  const verdict = verifyVerdict(missing, unverified);
  const md = ["### ✅ Plan-vs-Done — VERIFIED against the built page", "",
    `> SAME grouped control table as \`--checklist\`, Status AUTO-FILLED from the built page(s) (\`get-page\` → \`bundle.viewConfig\`, keyed per page in \`--built.pages\`). Structural rows are machine-checked and drive the verdict; \`☐ confirm on-stand\` rows are surfaced for the agent — not machine-gated. ${verdict}`,
    ...planGapBanner(result),
    ...L, "", `**Verdict:** ${verdict}`, ...planGapBanner(result)].join("\n");
  return { markdown: md, missing, unverified, builderOpen, complete: missing === 0 && unverified === 0, pages };
}
