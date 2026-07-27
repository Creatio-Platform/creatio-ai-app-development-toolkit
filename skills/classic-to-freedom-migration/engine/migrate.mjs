// engine/migrate.mjs — the CLI driver the SKILL invokes.
//
// Turns the raw Classic schema bodies (assembled by clio get-classic-page-sources, or the
// manual fallback) into one effective Classic page and a Freedom ChangeSet + needsDecision[]. This is the
// deterministic 80% the skill used to ask the agent to do by hand (enumerate chain → merge diff/details/
// businessRules by eye). A thin I/O wrapper over engine.mjs (mergeHierarchy) + mapper.mjs (mapToFreedom); the
// golden runners (repo-root engine-tests/classic-to-freedom/run.mjs + run-mapper.mjs) remain the regression gate for the logic itself.
//
// Manifest shape (JSON):
//   {
//     "entity": "Case",                       // optional; else inferred from the schemas
//     "entityColumns": { "Col": "Lookup", … },// optional; from get-entity-schema-properties — sharpens control choice
//     "schemas": [ { "pkg": "Case", "body": "<define(...) source>" } | { "pkg": "Case", "file": "..." }, … ],
//     "seed":   [ { "pkg": "BaseModulePageV2/CrtUIPlatform7x", "body"|"file": … }, … ],  // parent template chain
//     "clientEditableSchemas": ["WorkOverride", …], // optional; drives B6 removal confidence
//     "resources": { "SomeTabCaption": "Localized text", … }, // optional; localizable strings → tab/group/detail captions (#5/#13)
//     "columnTitles": { "MobilePhone": "Mobile phone", … }, // optional; entity column titles → field LABELS (#5/#13)
//     "detailSchemas": { "Schema1Detail": "<define(...) body>" | { "body"|"file", "title", "entity" }, … }, // optional; detail body → entity + list columns; title → detail display name (#11ii)
//     "section": [ { "pkg": "HRApplicant/…", "body"|"file": … }, … ], // optional; the *Section chain → add-record mini page, section actions (#8b), list columns (#2)
//     "childPageSchemas": { "<editPage or child entity>": { …a NESTED manifest (schemas/seed/…)… }, … }, // optional; each related list's child EDIT PAGE → the engine recursively maps it and nests its design spec in the plan
//     "planMeta": { scope, environment, package, approach, whatItDoes, sectionSchema, listTemplate, formTemplate } // optional; fills the plan's Overview/Main-scope so `--plan --out plan.md` writes a COMPLETE plan (no hand-paste)
//   }
// CLI: `--plan`/`--spec` print the artifact; add `--out <file>` to WRITE it (the agent presents the file, not stdout).
// Prefer inline "body" (get-classic-page-sources writes bodies inline into the manifest) over "file" to avoid path fragility.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSchema, mergeHierarchy } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";
import { renderDesignSpec, renderPlan } from "./designspec.mjs";

// The structure issue (if any) a single child page contributes to the STRUCTURE VALIDATOR: a real Classic
// edit page that was not mapped, or a not-yet-verified child, is a gap; a mapped / verified-none / view-only
// child is fine. Returns the issue string, or null when the child page raises no structure issue.
function childPageIssue(c) {
  if (c.spec) return c.childStructIncomplete
    ? `child page '${c.resolvedFrom || c.editPage}' (${c.entity}) was mapped but its OWN structure is incomplete — supply its nested detail/child-page schemas; there is no "out of scope"`
    : null;
  // A REAL Classic edit page must be mapped REGARDLESS of the add-record button — hiding Add stops NEW records,
  // not editing EXISTING ones, so the edit page still governs the record UI. Checked FIRST, so a hidden-Add
  // heuristic can never waive a real child page (Major).
  if (typeof c.editPage === "string" && c.editPage)
    return `child page '${c.editPage}' (${c.entity}, opened by detail "${c.via}"): a REAL Classic edit page is NOT mapped — add its schema to manifest.childPageSchemas. There is no "out of scope".`;
  if (c.editPage === false) return null;                       // agent verified: no Classic *Page exists
  if (c.editable === false && c.editableVerified) return null; // agent VERIFIED view/attach-only (not just the hidden-Add heuristic)
  // unverified — incl. a hidden-Add heuristic that did NOT confirm no edit page: resolve before the plan.
  return `child '${c.entity}' (opened by detail "${c.via}"): child page NOT verified — run list-pages by the CHILD entity, then either add its edit page to manifest.childPageSchemas, or record "editPage": false / "editable": false on this detail once confirmed. No self-declared "out of scope".`;
}

// Pure core — no process/argv, so it is unit-testable and the golden runner can call it directly.
export function runMigration(manifest, opts = {}) {
  const baseDir = opts.baseDir || ".";
  const bodyOf = (e) => {
    if (e?.body != null) return String(e.body);
    // E5: a clear error (not a cryptic `path.resolve(baseDir, undefined)` TypeError) when an entry has neither
    // an inline body nor a string `file`; and contain the path so a `file: "../…"` can't read outside baseDir.
    if (!e || typeof e.file !== "string" || !e.file)
      throw new Error(`schema entry for pkg '${e?.pkg ?? "?"}' has neither an inline 'body' nor a string 'file'`);
    const base = path.resolve(baseDir);
    const resolved = path.resolve(base, e.file);
    if (resolved !== base && !resolved.startsWith(base + path.sep))
      throw new Error(`schema 'file' escapes the manifest base directory (path traversal): '${e.file}'`);
    return fs.readFileSync(resolved, "utf8");
  };
  const parse = (list) => (Array.isArray(list) ? list : []).map((e) => parseSchema(bodyOf(e), e.pkg));
  const schemas = parse(manifest.schemas);
  const seedTemplate = parse(manifest.seed);
  // section-schema schemas (optional) — the *Section chain. Analyzed for list-page concerns the page
  // migration does not cover: add-record mini page, section actions (#8b), list columns (#2).
  const sectionSchemas = parse(manifest.section);
  const eff = mergeHierarchy(schemas, { seedTemplate });
  // #11(ii)/B2 — parse each supplied detail-schema body to recover its child entity + list columns, so the
  // mapper can resolve auto-named (SchemaNDetail) details and show the related-list columns in the spec.
  const detailSchemas = {};
  for (const [name, e] of Object.entries(manifest.detailSchemas || {})) {
    const hasBody = typeof e === "string" || (e && (e.body != null || e.file));
    let body = "";
    if (hasBody) body = typeof e === "string" ? e : bodyOf(e);
    const p = hasBody ? parseSchema(body, name) : { entitySchemaName: "?", diff: [] };
    // child EDIT PAGE the detail opens on add/edit (for the recursive child-page migration) — from the
    // detail's getEditPageName / editPageName, else null (the agent resolves it via list-pages).
    const epM = /(?:getEditPageName|editPageName|EditPageSchemaName)[\s\S]{0,80}?["']([A-Za-z]\w+)["']/.exec(body);
    // editability best-effort: an explicit `false` on the add-record button = view-only; else unknown.
    const viewOnly = /getAddRecordButtonVisible[\s\S]{0,80}?return\s+false/.test(body) || /"?addRecordButtonVisible"?\s*:\s*false/.test(body);
    const eObj = (e && typeof e === "object") ? e : {};
    const editPageFromBody = epM ? epM[1] : null;      // getEditPageName match, else null
    const editableFromBody = viewOnly ? false : null;  // add-record hidden ⇒ view-only, else unknown
    detailSchemas[name] = {
      entity: eObj.entity || (p.entitySchemaName && p.entitySchemaName !== "?" ? p.entitySchemaName : null),
      columns: [...new Set((p.diff || []).filter((d) => d?.bindTo).map((d) => d.bindTo))],
      title: eObj.title || null, // human detail title (from its resources)
      // editPage: explicit manifest value WINS — a string names the child edit page; `false` = the agent verified
      // on-stand that NO Classic *Page exists. Else the name from getEditPageName; else null = unverified.
      editPage: ("editPage" in eObj) ? eObj.editPage : editPageFromBody,
      // editable: explicit manifest value WINS (false = verified view/attach-only); else the body heuristic; else null.
      editable: ("editable" in eObj) ? eObj.editable : editableFromBody,
      // editableVerified: was `editable:false` an EXPLICIT agent assertion (view/attach-only confirmed), or only
      // the add-record-hidden heuristic? Hiding Add stops NEW records, not editing EXISTING ones, so the heuristic
      // alone must NOT waive a child page — only a verified false does (Major).
      editableVerified: ("editable" in eObj),
      error: p.error || null,
      // Major 4 — a detail body's AST diagnostics must reach the gate too: a detail whose `diff` is built by
      // an unresolved call parses WITHOUT an error but yields columns:null. Keeping them here lets the gate
      // block on an unresolved STRUCTURAL detail field (below), instead of a silent green with empty columns.
      astDiagnostics: p.astDiagnostics || [],
    };
  }
  const changeSet = mapToFreedom(eff, {
    entityColumns: manifest.entityColumns || {},
    clientEditableSchemas: manifest.clientEditableSchemas || [],
    resources: manifest.resources || {},     // #5/#13 — localizable strings for tab/group/detail captions
    columnTitles: manifest.columnTitles || {}, // #5/#13 — entity column titles for field LABELS
    detailSchemas,                            // #11(ii)/B2 — parsed detail bodies (entity + columns + title)
  });
  const parseErrors = [
    ...[...schemas, ...seedTemplate].filter((l) => l.error).map((l) => ({ pkg: l.pkg, error: l.error })),
    // Major 3: a detail-schema body that FAILED to parse must reach the gate too — otherwise its columns/child
    // page silently resolve to null while the plan stays green. Its error was captured per-detail above.
    ...Object.entries(detailSchemas).filter(([, d]) => d.error).map(([name, d]) => ({ pkg: `detail:${name}`, error: d.error })),
  ];
  // Section schemas are NOT part of the effective page — `mergeHierarchy` never receives them; only their
  // regex-derived list-page signals (addRecordMiniPage / sectionActions / listColumns / processLaunch) are used,
  // and those are extracted from the source text independently of AST parse success. So a section body that
  // fails to parse (or builds its `diff` via a dynamic construct) must NOT hard-block the form-page plan — that
  // was a spurious gate BLOCK with a misleading "effective page may be INCOMPLETE" reason about a diff the page
  // never consumes. Keep section parse errors/diagnostics as ADVISORY (surfaced, not gating).
  const sectionParseErrors = sectionSchemas.filter((l) => l.error).map((l) => ({ pkg: l.pkg, role: "section", error: l.error }));
  // fail-loud parse diagnostics: constructs the AST parser could not statically resolve (dynamic call /
  // conditional / spread / unresolved identifier). Advisory, NOT blocking — surfaced so battle-testing can
  // spot bodies the static evaluator does not yet cover. Tagged with the owning schema pkg.
  const parseDiagnostics = [
    ...[...schemas, ...seedTemplate].flatMap((l) => (l.astDiagnostics || []).map((d) => ({ pkg: l.pkg, ...d }))),
    // Major 4 — detail-schema diagnostics join the pool tagged `detail:<name>`; a structural one (an unresolved
    // detail `diff`) then blocks the gate just like a main-schema one, instead of silently emptying its columns.
    ...Object.entries(detailSchemas).flatMap(([name, d]) => (d.astDiagnostics || []).map((x) => ({ pkg: `detail:${name}`, ...x }))),
    // Section diagnostics are tagged `role:"section"` and are EXCLUDED from the structural gate below (their
    // `diff` is never merged) — advisory only, so they surface without hard-blocking a valid form-page plan.
    ...sectionSchemas.flatMap((l) => (l.astDiagnostics || []).map((d) => ({ pkg: l.pkg, role: "section", ...d }))),
    ...sectionParseErrors.map((e) => ({ pkg: e.pkg, role: "section", path: "", kind: `section parse error: ${e.error}` })),
  ];
  // Major 3 — a dynamic MAPPING-AFFECTING property (`visible: computeVisibility()`, a bound layout/hint/…) is
  // NOT structural, so it doesn't block the gate — but it silently collapsed to a DEFAULT in the ChangeSet
  // (e.g. visible:true) with no trace in the plan. Surface each as an explicit needsDecision so it lands in
  // the plan's ⚠ Confirm: the agent must wire the real dynamic behavior, not ship the static default.
  const MAPPING_PROPS = new Set(["visible", "enabled", "readonly", "readOnly", "layout", "hint", "tip", "caption", "required"]);
  for (const s of schemas) {
    for (const d of (s.astDiagnostics || [])) {
      const m = /^diff\.(\d+)\.values\.(\w+)$/.exec(d.path || "");
      if (!m || !MAPPING_PROPS.has(m[2])) continue;
      // match by the ORIGINAL AST index (carried as `astIndex`), not array position: normalizeDiff drops
      // null/nameless ops, so positional indexing drifted and mislabeled the decision (E3).
      const el = (s.diff || []).find((o) => o.astIndex === +m[1]);
      const item = el?.name || el?.bindTo || `diff[${m[1]}]`;
      changeSet.needsDecision.push({ kind: "dynamic-property", item,
        reason: `'${item}' has a dynamic '${m[2]}' (${d.kind}) the parser could not resolve statically — the ChangeSet shows the DEFAULT (e.g. visible:true). Wire the real Freedom behavior (business rule / binding) instead of shipping the static default.` });
    }
  }
  // section analysis — union the signals across the section schema chain (last-wins for the mini page).
  const section = sectionSchemas.length ? {
    addRecordMiniPage: sectionSchemas.findLast((l) => l.addRecordMiniPage != null)?.addRecordMiniPage ?? null,
    sectionActions: [...new Set(sectionSchemas.flatMap((l) => l.sectionActions || []))],
    listColumns: [...new Set(sectionSchemas.flatMap((l) => l.listColumns || []))],
    quickFilters: (() => {
      const seen = new Set(), out = [];
      for (const l of sectionSchemas) for (const f of (l.quickFilters || [])) {
        if (f?.name && !seen.has(f.name)) { seen.add(f.name); out.push(f); }
      }
      return out;
    })(),
    processLaunch: sectionSchemas.some((l) => l.processLaunch),
    processNames: [...new Set(sectionSchemas.flatMap((l) => l.processLaunch?.names || []))],
  } : null;
  // typed-entity page family — a TYPED entity opens a DIFFERENT Classic edit page per record Type
  // (e.g. Document → DocumentICPage / DocumentOCPage / DocumentRegistryPage / ActPageV2). These come from
  // `list-entity-client-schemas` (the page-role graph), NOT the folded page bundle, so the agent supplies them
  // as `manifest.typedPages` (array of names or {schema,type,template,kind}). They are first-class SCOPE and a
  // build TRAP: each Type routes to its OWN Classic page, which takes precedence over a general Freedom
  // RelatedPage binding — so they were collapsed to one form and never listed. Surface them as a decision so
  // they land in the ⚠ Confirm worklist + the Plan-vs-Done table (not just prose), and in the Main-scope table.
  const typedPages = (manifest.typedPages || [])
    .map((t) => {
      if (typeof t === "string") return { schema: t };
      return (t && typeof t === "object") ? t : null;
    })
    .filter((t) => t?.schema);
  if (typedPages.length) {
    changeSet.needsDecision.push({
      kind: "typed-page",
      item: typedPages.map((t) => t.schema).join(", "),
      reason: `Typed entity: ${typedPages.length} per-type Classic edit page(s). Each record Type routes to its OWN Classic page, which takes PRECEDENCE over a general Freedom RelatedPage binding (so "+ New" / open-record open Classic unless overridden). Bind — or rebuild — a Freedom form PER Type (by the Type column), not one form for all types; verify per-type routing on-stand after binding.`,
    });
  }
  // child pages (recursion): each CUSTOM detail's related list opens the child entity's edit form on
  // add/edit — a separate migration. Enumerate them so the plan is a tree (parent + one sub-plan each).
  const childPages = (changeSet.details || []).map((d) => ({
    entity: d.entity || null,
    via: d.caption || d.detailSchema || d.entity,
    // preserve an explicit `false` (agent verified: no page) — `|| null` would swallow it into "unverified".
    editPage: detailSchemas[d.detailSchema] ? (detailSchemas[d.detailSchema].editPage ?? null) : null,
    editable: detailSchemas[d.detailSchema] ? detailSchemas[d.detailSchema].editable : null,
    editableVerified: detailSchemas[d.detailSchema] ? !!detailSchemas[d.detailSchema].editableVerified : false,
  })).filter((c) => c.entity);
  // RECURSION — if the agent supplied a child edit-page's own schema (keyed by its editPage name or child
  // entity), map it here so its FULL design spec is nested in the plan, not just listed. This is the tree:
  // parent page + one real sub-mapping per related list. A CYCLE (a page reachable from itself) is what must
  // be stopped — NOT depth: a legitimately deep tree (parent → child → grandchild → …) needs to map fully, so
  // a fixed `depth >= 2` cap wrongly left the deepest levels unmapped (structure.complete=false). We track the
  // set of schema/page keys already on the current branch and skip only a key we are ALREADY inside (cycle).
  const visited = opts.visited instanceof Set ? opts.visited : new Set();
  const childSchemas = manifest.childPageSchemas || {};
  for (const c of childPages) {
    const key = [c.editPage, c.entity, c.entity && c.entity + "Page"].find((k) => k && childSchemas[k]);
    if (!key) continue;
    if (visited.has(key)) { c.cyclic = true; continue; } // already on this branch — a cycle; stop (don't recurse forever)
    try {
      const childRes = runMigration(childSchemas[key], { baseDir, visited: new Set([...visited, key]) });
      c.spec = childRes.designSpec;              // the child page's Layout/Section/Logic/Confirm — the mapping
      c.mappedEntity = childRes.entity;
      c.resolvedFrom = key;
      // carry the child's OWN resolved child pages up so renderPlan can EMBED grandchildren recursively,
      // instead of only counting them and telling the agent to map them by hand (the engine writes the FULL
      // tree). Each entry already carries its .spec (or an unresolved marker) from the recursion above.
      c.childPages = childRes.childPages || [];
      c.grandChildren = c.childPages.length;
      // Major 3: a nested child's spec is a VALID mapping only if the child cleared its OWN gates. Carry the
      // child's verdict up so a blocked/incomplete child can't be embedded into a green parent plan at exit 0.
      c.childBlocked = !!childRes.gate?.blocked;
      c.childReasons = childRes.gate?.reasons || [];
      c.childStructIncomplete = !!(childRes.structure && !childRes.structure.complete);
    } catch (e) { c.specError = e.message; }     // malformed child manifest ⇒ note it, keep the listed row
  }
  // TYPED-PAGE RECURSION — a typed entity's per-type edit pages are FORM deliverables, not a "map at build"
  // promise. Fold each like a child page (its own bundle supplied via manifest.typedPageSchemas, keyed by the
  // typed page schema name) so the plan carries a FULL per-type design spec. `bindOnly:true` on the typedPages
  // entry is the ONLY escape (layout identical to the base → a type-specific binding, no separate form). An
  // unresolved typed page (no bundle, not bindOnly) is a STRUCTURE issue below — the gate blocks it.
  const typedSchemas = manifest.typedPageSchemas || {};
  for (const t of typedPages) {
    if (t.bindOnly === true) { t.resolved = "bind"; continue; }
    const tkey = [t.schema, t.schema && t.schema + "Page"].find((k) => k && typedSchemas[k]);
    if (!tkey) { t.resolved = false; continue; }
    if (visited.has(tkey)) { t.cyclic = true; t.resolved = "fold"; continue; }
    try {
      const tRes = runMigration(typedSchemas[tkey], { baseDir, visited: new Set([...visited, tkey]) });
      t.spec = tRes.designSpec;
      t.mappedEntity = tRes.entity;
      t.resolved = "fold";
      t.blocked = !!tRes.gate?.blocked;
      t.reasons = tRes.gate?.reasons || [];
      t.structIncomplete = !!(tRes.structure && !tRes.structure.complete);
    } catch (e) { t.specError = e.message; t.resolved = false; }
  }
  // ADD-RECORD MINI PAGE — the section's quick-add form. Its registration lives at the module/edit-page level
  // (SysModuleEdit miniPageSchema + miniPageModes containing "add"), NOT always in the section body, so the
  // section-body extractor alone can FALSELY report "none". Authoritative source: list-entity-client-schemas
  // (miniPageSchema), supplied as manifest.addRecordMiniPage ({schema}|false). Fold it like a typed/child page
  // via manifest.miniPageSchemas so the plan carries its FULL layout. Only meaningful when there is a section.
  const miniPageSchemas = manifest.miniPageSchemas || {};
  const secMpName = sectionSchemas.map((l) => l.addRecordMiniPage).find((v) => typeof v === "string");
  const secMpExists = !!secMpName || sectionSchemas.some((l) => l.addRecordMiniPage === true);
  const mpDecl = manifest.addRecordMiniPage; // {schema}|"name"|false|undefined
  let mpName;
  if (mpDecl === false) mpName = null;
  else if (typeof mpDecl === "string" && mpDecl) mpName = mpDecl;
  else if (mpDecl && typeof mpDecl === "object" && mpDecl.schema) mpName = mpDecl.schema;
  else mpName = secMpName || null;
  const miniPageVerified = mpDecl !== undefined || secMpExists; // explicit {schema}/false, or the section body names one
  let miniPage = null;
  if (mpName) {
    miniPage = { schema: mpName, type: (mpDecl && typeof mpDecl === "object" && mpDecl.type) || null };
    const mkey = [miniPage.schema, miniPage.schema + "MiniPage"].find((k) => k && miniPageSchemas[k]);
    if (mkey && visited.has(mkey)) { miniPage.cyclic = true; }
    else if (mkey) {
      try {
        const mRes = runMigration(miniPageSchemas[mkey], { baseDir, visited: new Set([...visited, mkey]) });
        miniPage.spec = mRes.designSpec;
        miniPage.blocked = !!mRes.gate?.blocked;
        miniPage.reasons = mRes.gate?.reasons || [];
        miniPage.structIncomplete = !!(mRes.structure && !mRes.structure.complete);
      } catch (e) { miniPage.specError = e.message; }
    } else { miniPage.unfolded = true; }
  }
  const miniPageNone = mpDecl === false; // agent verified on-stand: no add mini page
  const decisionSummary = {};
  for (const d of changeSet.needsDecision) decisionSummary[d.kind] = (decisionSummary[d.kind] || 0) + 1;
  // ⛔ HARD GATE (RV1) — the four correctness signals, computed ONCE here so the CLI, the renderer, and any
  // caller share one verdict instead of each re-deriving it (or, as before, never checking it at all). This
  // does NOT throw — runMigration stays pure so the golden runner can assert blocked/clean states; the CLI
  // turns `blocked` into a loud banner + non-zero exit, and the renderer prints the banner into the artifact.
  const gate = (() => {
    const reasons = [];
    if (parseErrors.length) reasons.push(`parseErrors (${parseErrors.length}): ${parseErrors.map((e) => e.pkg).join(", ")} — a schema body failed to parse`);
    if ((eff.unresolvedParents || []).length) reasons.push(`unresolvedParents: ${eff.unresolvedParents.join(", ")} — base-template seed incomplete (F2) or schemas out of order (F1)`);
    if ((eff.warnings || []).length) reasons.push(`warnings (${eff.warnings.length}): ${[...new Set(eff.warnings.map((w) => w.name || w.op))].join(", ")} — op hit a missing item / skeletal seed`);
    if (eff.seedQuality?.looksSkeletal) reasons.push("seedQuality.looksSkeletal — the seed is a hand-typed skeleton, not a real fetched parent-template body (#19)");
    // Major 3 (this round) — the seed being SKELETAL was gated, but its ABSENCE was not. A Classic page always
    // extends a base template (BaseModulePageV2/BasePageV2/BaseEntityPage); building with no seed silently drops
    // inherited base actions + container layout. This normally trips `unresolvedParents`, but a body that defines
    // its own containers (the skeleton-dodge) slips through green. Require a real seed, OR an explicit VERIFIED
    // opt-out (`manifest.noParentTemplate: true`) for the rare page that genuinely has no parent template.
    if (eff.seedQuality && !eff.seedQuality.seeded && !manifest.noParentTemplate)
      reasons.push("no parent-template seed — a Classic page extends a base template (BaseModulePageV2/BasePageV2/…); building without its fetched body drops inherited base actions + container layout (F2). Fetch the parent-template schemas and pass them as `seed`, or set `noParentTemplate: true` ONLY if you have VERIFIED on-stand that this page has no parent template.");
    // Blocker 1: an unresolved construct AT a structural key (the WHOLE diff/details/… couldn't be statically
    // resolved — e.g. built via an unresolved variable or a call) yields an EMPTY effective page that would
    // otherwise pass clean. Block it. Deep leaves (a dynamic caption at `diff.N.values.caption`) stay advisory
    // — the field itself resolved; only a diagnostic ON the structural key blocks.
    // A diagnostic BLOCKS when it sits on a structural position — not only the exact root key, but a whole
    // diff item or its identity fields (built via an unresolved var/call). Deep leaves (a dynamic caption /
    // tip / hint / visible) stay advisory: the field itself resolved. This is what makes the aliased-diff
    // Blocker visible — `var d=[{…, values: makeValues()}]` now flags `diff.0.values` and blocks.
    const STRUCTURAL_ROOTS = new Set(["diff", "details", "businessRules", "rules", "modules", "entitySchemaName"]);
    const IDENTITY_FIELDS = new Set(["operation", "name", "parentName", "propertyName", "bindTo", "itemType", "contentType", "isTab"]);
    const isStructural = (p) => {
      if (p === "") return true;                         // a ROOT-level unresolved return / no-return → empty page → block
      const seg = String(p).split(".");
      if (!STRUCTURAL_ROOTS.has(seg[0])) return false;   // dynamic under a non-structural top key → advisory
      if (seg[0] !== "diff") return true;                // details/businessRules/rules/modules/entitySchemaName: any unresolved sub-path is structural
      if (seg.length <= 2) return true;                  // `diff` (whole array) or `diff.<n>` (whole item)
      if (seg.length === 3) return seg[2] === "values" || IDENTITY_FIELDS.has(seg[2]); // `diff.<n>.values` (whole values obj) or a top-level identity field
      if (seg[2] === "values") return IDENTITY_FIELDS.has(seg[3]);  // `diff.<n>.values.<field>`: identity → block; caption/tip/hint/visible → advisory
      return IDENTITY_FIELDS.has(seg[2]);
    };
    // role:"section" diagnostics never gate — the section `diff` is not part of the effective page (see above).
    const structDiag = parseDiagnostics.filter((d) => d.role !== "section" && isStructural(d.path));
    if (structDiag.length) {
      const structFields = [...new Set(structDiag.map((d) => `${d.pkg ? d.pkg + " " : ""}${d.path} (${d.kind})`))].join(", ");
      reasons.push(`parse could not statically resolve structural field(s): ${structFields} — the effective page may be INCOMPLETE (diff/details built via an unresolved variable or call). Fix the body/seed so it resolves; do NOT build from a possibly-empty page`);
    }
    // Major 3: aggregate child gates — a nested child that failed its OWN correctness gate blocks the parent.
    const blockedChildren = childPages.filter((c) => c.childBlocked);
    if (blockedChildren.length) {
      const blockedList = blockedChildren.map((c) => `${c.resolvedFrom || c.editPage} [${(c.childReasons || []).join("; ").slice(0, 90)}]`).join(" | ");
      reasons.push(`nested child page(s) failed their own gate: ${blockedList} — a blocked child's spec is not a valid mapping; fix the child before the parent plan is approvable`);
    }
    const blockedTyped = typedPages.filter((t) => t.blocked);
    if (blockedTyped.length) {
      const blockedTypedList = blockedTyped.map((t) => `${t.schema} [${(t.reasons || []).join("; ").slice(0, 90)}]`).join(" | ");
      reasons.push(`typed page(s) failed their own gate: ${blockedTypedList} — fix each typed form before the parent plan is approvable`);
    }
    if (miniPage?.blocked) {
      reasons.push(`add mini page '${miniPage.schema}' failed its own gate: ${(miniPage.reasons || []).join("; ").slice(0, 90)} — fix it before the parent plan is approvable`);
    }
    return { blocked: reasons.length > 0, reasons };
  })();
  // ⛔ STRUCTURE VALIDATOR — a systemic completeness check on the MANIFEST INPUTS, so the plan cannot be
  // generated clean while the agent skips the parts it kept dodging (detail schemas, child-page mappings).
  // Unlike the SKILL rules this is enforced in code: the CLI turns `!complete` into a loud banner + non-zero
  // exit, and the renderer prints it into the plan — the agent literally can't present a clean plan without
  // supplying the schemas. This is INPUT completeness (distinct from the correctness `gate` above).
  const structure = (() => {
    const suppliedDetailKeys = new Set(Object.keys(manifest.detailSchemas || {}));
    const issues = [];
    for (const d of (changeSet.details || [])) {
      // a generic related list whose own schema was NOT supplied → its columns and child edit page are unknown
      if (d.detailSchema && !suppliedDetailKeys.has(d.detailSchema)) {
        const entityNote = d.entity ? ` (${d.entity})` : "";
        issues.push(`detail '${d.detailSchema}'${entityNote}: fetch its schema into manifest.detailSchemas — columns and child edit page unresolved`);
      }
    }
    // Major 3: a mapped child whose OWN structure is incomplete, a real-but-unmapped edit page, or an
    // unverified child each contribute a structure issue (recursive aggregation) — see childPageIssue.
    for (const c of childPages) { const issue = childPageIssue(c); if (issue) issues.push(issue); }
    // typed pages: each must be RESOLVED before the plan — folded (its bundle supplied) or explicitly bindOnly.
    // An unresolved typed form (or one whose own structure is incomplete) blocks, exactly like a child page —
    // this is what stops the "per-type field mapping done at build" deferral.
    for (const t of typedPages) {
      if (t.resolved === "bind") continue;
      if (t.specError) { issues.push(`typed page '${t.schema}': supplied bundle failed to parse (${t.specError}) — fix and re-run`); continue; }
      if (t.resolved === "fold") {
        if (t.structIncomplete) issues.push(`typed page '${t.schema}': its OWN structure is incomplete — resolve its details/child pages and re-run`);
        continue;
      }
      const typeNote = t.type ? ` (type "${t.type}")` : "";
      issues.push(`typed page '${t.schema}'${typeNote}: NOT resolved — assemble its bundle (\`get-classic-page-sources --schema-name ${t.schema}\`) into manifest.typedPageSchemas so the engine folds its full per-type form, OR mark { "bindOnly": true } if its layout is identical to the base. "Map at build" is not a valid resolution.`);
    }
    // add-record mini page (a section/list concern — only gated when this migration has a section). It must be
    // RESOLVED: folded (bundle in manifest.miniPageSchemas), or verified-none (manifest.addRecordMiniPage:false).
    // Not asserting absence from the section body alone — that FALSELY reported "none" when the mini page was
    // registered per edit-page (list-entity-client-schemas.miniPageSchema).
    if (section) {
      if (miniPage) {
        if (miniPage.specError) issues.push(`add mini page '${miniPage.schema}': supplied bundle failed to parse (${miniPage.specError}) — fix and re-run`);
        else if (miniPage.unfolded) issues.push(`add mini page '${miniPage.schema}': NOT folded — assemble its bundle (\`get-classic-page-sources --schema-name ${miniPage.schema}\`) into manifest.miniPageSchemas so the engine folds its layout here (or record manifest.addRecordMiniPage:false if there is genuinely none)`);
        else if (miniPage.structIncomplete) issues.push(`add mini page '${miniPage.schema}': its OWN structure is incomplete — resolve and re-run`);
      } else if (!miniPageVerified) {
        issues.push(`add-record mini page NOT verified — check \`list-entity-client-schemas\` (a per-type edit page with \`miniPageSchema\` + \`miniPageModes\` containing "add") and record manifest.addRecordMiniPage: { "schema": "<MiniPage>" } to fold it, or false if there is none. Do NOT assume "no mini page" — it is registered at the module/edit-page level, not always in the section body.`);
      }
    }
    return { complete: issues.length === 0, issues };
  })();
  const out = {
    entity: manifest.entity && manifest.entity !== "?" ? manifest.entity : eff.entity,
    gate,        // ⛔ blocked:true ⇒ do NOT build; reasons[] lists every non-empty correctness signal
    structure,   // ⛔ complete:false ⇒ plan is structurally incomplete (missing detail/child schemas); issues[]
    parseErrors, // non-empty ⇒ a schema body failed to parse: FIX before trusting the ChangeSet
    parseDiagnostics, // AST constructs not statically resolved (advisory; review during battle-testing)
    // RV10 — the Freedom PAYLOAD actually emitted into the ChangeSet/design-spec (F9-filtered: template-owned
    // content is layout context, excluded). Report this ALONGSIDE `effective.*` so a reader doesn't mistake the
    // merged totals (which include base-template context, always larger once a real seed is supplied) for
    // "silently dropped" content. The design spec/plan already count the payload — this exposes it in the JSON too.
    payload: {
      fields: (changeSet.viewConfigDiff || []).filter((o) => o.values?.control).length,
      details: (changeSet.details || []).length,
      standardFeatures: (changeSet.standardFeatures || []).length,
      pageRules: (changeSet.pageBusinessRules || []).length,
      entityRules: (changeSet.entityBusinessRules || []).length,
      cardActions: (changeSet.cardActions || []).length,
    },
    // effective Classic page (the merged 80% — INCLUDES base-template context; larger than `payload` by design)
    effective: {
      fields: eff.fields.length, tabs: eff.tabs.length, details: eff.details.length,
      rules: eff.rules.length, removed: eff.removed.length,
      warnings: eff.warnings,                 // op hit a missing item ⇒ schema order (F1) / seed (F2) wrong
      unresolvedParents: eff.unresolvedParents, // non-empty ⇒ base template not fully seeded (F2)
      seedQuality: eff.seedQuality,           // whether the seed looks like a real fetched body vs a skeleton (#19)
      features: eff.features,                 // feature toggles gating runtime visibility (union, not one state)
      referencedModules: eff.referencedModules, // UI-rendering deps outside the page-schema migration unit
    },
    decisionSummary, // needsDecision counts by kind — the agent's 20% worklist, at a glance
    changeSet,       // full Freedom ChangeSet: viewConfigDiff / *ConfigDiff / rules / details / needsDecision / …
    section,         // section-schema analysis (list page): add-record mini page, section actions, columns, quick filters
    childPages,      // custom-detail child entities whose edit page is a recursive sub-migration
    typedPages,      // per-type Classic edit-page family (typed entity) — first-class scope + precedence trap
    miniPage,        // add-record mini page (quick-add form) folded from manifest.miniPageSchemas, or null
    miniPageVerified,// whether the mini page presence/absence was actually resolved (vs assumed)
    miniPageNone,    // agent verified on-stand there is NO add mini page (manifest.addRecordMiniPage:false)
  };
  // Generated artifacts the agent presents VERBATIM (it only ever paraphrased when left to author them):
  //   designSpec = the design spec alone (## Design spec — Layout/Section/Logic/Confirm)
  //   plan       = the WHOLE plan skeleton (Overview/Pages placeholders + the design spec + child pages)
  // planMeta completeness — the `--plan` artifact is INCOMPLETE while any required Overview/Main-scope value is
  // still a `<FILL: …>` placeholder. planMeta is declared optional (so `--spec`/default runs don't need it), so
  // its absence was never gated: an unfilled plan passed exit 0 with "present verbatim". Surface the missing
  // keys so the CLI turns an unfilled `--plan` into a non-zero exit (below), like the other incompleteness gates.
  const pm = manifest.planMeta || {};
  const blank = (v) => v == null || String(v).trim() === "";
  const REQUIRED_PLANMETA = ["scope", "environment", "package", "approach", "whatItDoes", "sectionSchema", "listTemplate", "formTemplate"];
  out.planMetaMissing = REQUIRED_PLANMETA.filter((k) => k === "formTemplate" ? (blank(pm.formTemplate) && blank(manifest.template)) : blank(pm[k]));
  // on-stand SIGNALS completeness — the ⚠ conditional checks (DCM case / connected processes / printables)
  // must be RESOLVED before the plan, not deferred to build (the recurring "faithful to the classic body,
  // check later" miss). No new tool is needed — the agent runs the existing ESQ/odata queries and records the
  // answers in `manifest.signals`, each key `{ resolved:true, present:<bool>, cases|items|names?:[…] }`. An
  // absent/unresolved key makes --plan INCOMPLETE (like planMeta). `present:false` (checked, none) is a VALID
  // resolved state — the distinction is "verified none" vs "never checked", exactly like child-page editPage.
  const SIGNAL_KEYS = ["dcm", "processes", "printables"];
  const signals = manifest.signals && typeof manifest.signals === "object" ? manifest.signals : {};
  out.signals = signals;
  out.signalsMissing = SIGNAL_KEYS.filter((k) => !signals[k] || typeof signals[k] !== "object" || signals[k].resolved !== true);
  const specOpts = { template: manifest.template, targetPackage: manifest.targetPackage, planMeta: manifest.planMeta, planMetaMissing: out.planMetaMissing, signals: out.signals, signalsMissing: out.signalsMissing };
  out.designSpec = renderDesignSpec(out, specOpts);
  out.plan = renderPlan(out, specOpts);
  return out;
}

// CLI: node migrate.mjs <manifest.json>   (or `-` / no arg to read the manifest from stdin)
// stdout = the result JSON (parseable); diagnostics go to stderr. Bad input exits 1 with a clear message
// (a plain `node` script would otherwise dump a raw stack to the agent) — never a half-written stdout.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fail = (msg) => { process.stderr.write("migrate.mjs: " + msg + "\n"); process.exit(1); };
  const argv = process.argv.slice(2);
  const planMode = argv.includes("--plan");   // print the WHOLE plan skeleton (fill placeholders, paste verbatim)
  const specMode = argv.includes("--spec");   // print ONLY the design-spec Markdown
  const outIdx = argv.indexOf("--out");        // --out <file>: WRITE the output to a file so the agent presents the file, not a hand-paste
  // `--out` must be followed by a real path. Without this guard a trailing `--out` silently fell back to
  // stdout (documented flag → no write), and `--out --plan` swallowed the next flag — both silent misfires.
  if (outIdx >= 0) {
    const next = argv[outIdx + 1];
    if (next === undefined || next.startsWith("--"))
      fail("`--out` needs a file path (e.g. `--out plan.md`) — got " + (next === undefined ? "no argument" : `the flag '${next}'`) + "; nothing was written");
  }
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;
  const arg = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out"); // positional manifest arg ('-' = stdin)
  const fromFile = !!arg && arg !== "-";
  // No manifest path and stdin is an interactive terminal → reading fd 0 would BLOCK forever. Fail loudly
  // instead (also the `--out manifest.json` typo, where the only path was consumed by --out, lands here).
  if (!fromFile && process.stdin.isTTY)
    fail("no manifest: pass a manifest path, or pipe JSON to stdin. (`--out <file>` names the OUTPUT — the manifest is a separate argument.)");
  let raw;
  const manifestLabel = fromFile ? `'${arg}'` : "from stdin";
  try { raw = fromFile ? fs.readFileSync(arg, "utf8") : fs.readFileSync(0, "utf8"); }
  catch (e) { fail(`cannot read manifest ${manifestLabel}: ${e.message}`); }
  let manifest;
  try { manifest = JSON.parse(raw); }
  catch (e) { fail(`manifest is not valid JSON: ${e.message}`); }
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.schemas) || manifest.schemas.length === 0) {
    fail("manifest must be an object with a non-empty `schemas` array (see the header of this file for the shape)");
  }
  let result;
  try { result = runMigration(manifest, { baseDir: fromFile ? path.dirname(path.resolve(arg)) : process.cwd() }); }
  catch (e) { fail(e.message); } // e.g. a schema `file` that does not exist
  // `--plan` ⇒ the whole plan skeleton; `--spec` ⇒ the design spec alone; default ⇒ full JSON.
  let output;
  if (planMode) output = result.plan + "\n";
  else if (specMode) output = result.designSpec + "\n";
  else output = JSON.stringify(result, null, 2) + "\n";
  // ⛔ HARD GATE (RV1) + STRUCTURE VALIDATOR: the artifact carries the banners (renderer), but the CLI ALSO
  // fails loudly so a blocked/incomplete run can't be mistaken for a clean one — stderr note + non-zero exit
  // (2, distinct from the exit-1 bad-input path). The plan/spec is still printed so the agent sees WHAT to fix.
  const gateBad = result.gate?.blocked;
  const structBad = result.structure && !result.structure.complete;
  // finding 8 — an unfilled `--plan` (required planMeta still `<FILL: …>`) is not approvable. Only in --plan
  // mode: `--spec`/default runs legitimately need no planMeta.
  const planIncomplete = planMode && ((result.planMetaMissing?.length > 0) || (result.signalsMissing?.length > 0));
  const notReady = gateBad || structBad || planIncomplete;
  let label = "result";
  if (planMode) label = "plan";
  else if (specMode) label = "design spec";
  if (outFile) {
    // engine WRITES the artifact (Smell #2): the agent presents this file verbatim instead of hand-pasting stdout.
    try { fs.writeFileSync(outFile, output); }
    catch (e) { fail(`cannot write --out '${outFile}': ${e.message}`); }
    // do NOT say "present verbatim" on a blocked/incomplete run (L3): the file carries a ⛔ banner and is not approvable.
    process.stdout.write(notReady
      ? `migrate.mjs: wrote ${label} to ${outFile}, but ⛔ this run is BLOCKED/INCOMPLETE — do NOT build or present it; fix the ⛔ items at the top of the file and re-run.\n`
      : `migrate.mjs: wrote ${label} to ${outFile} — present that file verbatim.\n`);
  } else {
    process.stdout.write(output);
  }
  if (gateBad) process.stderr.write("migrate.mjs: ⛔ GATE BLOCKED — do NOT build. " + result.gate.reasons.join(" | ") + "\n");
  if (structBad) process.stderr.write("migrate.mjs: ⛔ STRUCTURE INCOMPLETE — plan not ready. " + result.structure.issues.join(" | ") + "\n");
  if (planMode && result.planMetaMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — required planMeta unfilled: " + result.planMetaMissing.join(", ") + ". Add to manifest.planMeta and re-run.\n");
  if (planMode && result.signalsMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — on-stand signals not resolved: " + result.signalsMissing.join(", ") + ". Run the DCM/process/printable checks and add manifest.signals (each { resolved:true, present:<bool> }), then re-run.\n");
  if (result.parseDiagnostics?.length)
    process.stderr.write(`migrate.mjs: ℹ ${result.parseDiagnostics.length} parse diagnostic(s) — constructs not statically resolved (advisory, see result.parseDiagnostics)\n`);
  if (notReady) process.exit(2);
}
