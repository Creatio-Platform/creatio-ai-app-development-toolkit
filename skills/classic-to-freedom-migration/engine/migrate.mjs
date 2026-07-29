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
// CLI: `--plan`/`--spec`/`--checklist` print the artifact; add `--out <file>` to WRITE it (the agent presents the
// file, not stdout). `--checklist` = the Plan-vs-Done control table, produced AFTER implementation (not in `--plan`).
// `--verify --built <file>` = the VERIFIED done-gate: diff the actually-built page (clio get-page ownBodySummary)
// against expected deliverables; exit 2 if any deliverable is MISSING or unverified.
// Prefer inline "body" (get-classic-page-sources writes bodies inline into the manifest) over "file" to avoid path fragility.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSchema, mergeHierarchy } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";
import { renderDesignSpec, renderPlan, renderChecklist, renderVerify } from "./designspec.mjs";

// The structure issue (if any) a single child page contributes to the STRUCTURE VALIDATOR: a real Classic
// edit page that was not mapped, or a not-yet-verified child, is a gap; a mapped / verified-none / view-only
// child is fine. Returns the issue string, or null when the child page raises no structure issue.
function childPageIssue(c) {
  // A CYCLE (this page is reachable from itself — e.g. Contract→Order→Contract) is NOT a gap: the target page
  // is already being mapped higher on the SAME plan branch, so it is resolved-elsewhere. Without this a cyclic
  // child with a real `editPage` fell into the "REAL edit page NOT mapped" branch below and `structure.complete`
  // could never become true for a mutually-referencing graph — the only escape being a FALSE editPage/editable
  // assertion, exactly the dodge the contract forbids. (The renderer marks the row "already mapped above (cycle)".)
  if (c.cyclic) return null;
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

// ONE resolve → cycle-check → memo → recurse → cache sequence for folding a nested sub-page (child / typed /
// mini), so the three call sites can no longer drift on cycle or memo semantics (a fix to one used to be easy to
// miss in the other two). Callers pass the resolved `key` + its schema map + the shared fold context, and only
// differ in how they map the returned `res` (a runMigration result) onto their OWN record shape. Returns:
//   { status: "cycle" }        — key is an ancestor on THIS branch → resolved-elsewhere; do not recurse.
//   { status: "error", error } — the sub-page bundle threw (malformed manifest).
//   { status: "ok", res }      — mapped, fresh or reused from the run-global memo (diamond reuse).
// Ordering matters: the branch-local `visited` cycle check runs BEFORE the memo, so a cyclic node is never served
// a (context-independent) cache entry; only acyclic subtrees are memoized (a cyclic subtree is branch-dependent).
// `extra` = per-call-site render flags forwarded into the sub-run (isChildPage → few-fields modal nudge + no
// section-level Print/Process; isMiniPage → "Mini page (quick-add)" heading). Since these change the rendered
// designSpec, they are folded into the MEMO KEY so a page folded as a child is never served from a non-child (or
// mini) cache entry, and vice versa — the diamond memo stays correct per render flavor.
function foldSubPage(key, schemasMap, ctx, extra = {}) {
  if (ctx.visited.has(key)) return { status: "cycle" };
  const memoKey = key + (extra.isChildPage ? "::child" : "") + (extra.isMiniPage ? "::mini" : "");
  if (ctx.memo.has(memoKey)) { ctx.memoStats.hits++; return { status: "ok", res: ctx.memo.get(memoKey) }; }
  try {
    ctx.memoStats.misses++;
    const res = runMigration(schemasMap[key], { baseDir: ctx.baseDir, visited: new Set([...ctx.visited, key]), memo: ctx.memo, memoStats: ctx.memoStats, ...extra });
    if (!res.treeCyclic) ctx.memo.set(memoKey, res); // cache only context-independent (acyclic) subtrees
    return { status: "ok", res };
  } catch (e) { return { status: "error", error: e.message }; }
}

// Pure core — no process/argv, so it is unit-testable and the golden runner can call it directly.
// Does an AST diagnostic sit on a STRUCTURAL position (the whole diff/details/… built via an unresolved var/call
// → an empty effective page) rather than a resolved-leaf (a dynamic caption/tip/visible)? Structural ⇒ the gate
// blocks. Extracted so computeGate stays under Sonar CC 15.
function isStructuralDiag(p) {
  const STRUCTURAL_ROOTS = new Set(["diff", "details", "businessRules", "rules", "modules", "entitySchemaName"]);
  const IDENTITY_FIELDS = new Set(["operation", "name", "parentName", "propertyName", "bindTo", "itemType", "contentType", "isTab"]);
  if (p === "") return true;                         // a ROOT-level unresolved return / no-return → empty page → block
  const seg = String(p).split(".");
  if (!STRUCTURAL_ROOTS.has(seg[0])) return false;   // dynamic under a non-structural top key → advisory
  if (seg[0] !== "diff") return true;                // details/businessRules/rules/modules/entitySchemaName: any sub-path is structural
  if (seg.length <= 2) return true;                  // `diff` (whole array) or `diff.<n>` (whole item)
  if (seg.length === 3) return seg[2] === "values" || IDENTITY_FIELDS.has(seg[2]);
  if (seg[2] === "values") return IDENTITY_FIELDS.has(seg[3]);  // `diff.<n>.values.<field>`: identity → block; caption/tip/… → advisory
  return IDENTITY_FIELDS.has(seg[2]);
}

// ⛔ HARD GATE (RV1) — the correctness signals, computed ONCE so the CLI, renderer and callers share one verdict.
// Pure (no throw): returns { blocked, reasons }. Extracted from runMigration to keep it under Sonar CC 15 (S3776).
function computeGate({ parseErrors, eff, manifest, parseDiagnostics, childPages, typedPages, miniPage }) {
  const reasons = [];
  if (parseErrors.length) reasons.push(`parseErrors (${parseErrors.length}): ${parseErrors.map((e) => e.pkg).join(", ")} — a schema body failed to parse`);
  if ((eff.unresolvedParents || []).length) reasons.push(`unresolvedParents: ${eff.unresolvedParents.join(", ")} — base-template seed incomplete (F2) or schemas out of order (F1)`);
  if ((eff.warnings || []).length) reasons.push(`warnings (${eff.warnings.length}): ${[...new Set(eff.warnings.map((w) => w.name || w.op))].join(", ")} — op hit a missing item / skeletal seed`);
  if (eff.seedQuality?.looksSkeletal) reasons.push("seedQuality.looksSkeletal — the seed is a hand-typed skeleton, not a real fetched parent-template body (#19)");
  if (eff.seedQuality && !eff.seedQuality.seeded && !manifest.noParentTemplate)
    reasons.push("no parent-template seed — a Classic page extends a base template (BaseModulePageV2/BasePageV2/…); building without its fetched body drops inherited base actions + container layout (F2). Fetch the parent-template schemas and pass them as `seed`, or set `noParentTemplate: true` ONLY if you have VERIFIED on-stand that this page has no parent template.");
  const structDiag = parseDiagnostics.filter((d) => d.role !== "section" && isStructuralDiag(d.path));
  if (structDiag.length) {
    const structFields = [...new Set(structDiag.map((d) => `${d.pkg ? d.pkg + " " : ""}${d.path} (${d.kind})`))].join(", ");
    reasons.push(`parse could not statically resolve structural field(s): ${structFields} — the effective page may be INCOMPLETE (diff/details built via an unresolved variable or call). Fix the body/seed so it resolves; do NOT build from a possibly-empty page`);
  }
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
  if (miniPage?.blocked) reasons.push(`add mini page '${miniPage.schema}' failed its own gate: ${(miniPage.reasons || []).join("; ").slice(0, 90)} — fix it before the parent plan is approvable`);
  return { blocked: reasons.length > 0, reasons };
}

// The structure issue a single TYPED page contributes (folded / bindOnly / cycle / empty-layout / unread-rules /
// unresolved), or null. Extracted so validateStructure stays under Sonar CC 15.
function typedPageIssue(t) {
  const typeNote = t.type ? ` (type "${t.type}")` : "";
  if (t.resolved === "bind" || t.resolved === "cycle") return null; // bind = identical to base; cycle = mapped higher on this branch
  if (t.specError) return `typed page '${t.schema}': supplied bundle failed to parse (${t.specError}) — fix and re-run`;
  if (t.resolved === "fold") {
    if (t.structIncomplete) return `typed page '${t.schema}': its OWN structure is incomplete — resolve its details/child pages and re-run`;
    if (!t.fieldCount) return `typed page '${t.schema}'${typeNote}: folded to an EMPTY Layout (0 fields) — the per-type mapping table is not filled. Check its bundle/seed (a real edit page always has fields); do not proceed on an empty form spec.`;
    if (t.ruleSources > 0 && !t.ruleCount) return `typed page '${t.schema}'${typeNote}: its body DECLARES ${t.ruleSources} business-rule source(s) but NONE mapped into the Logic table — the rules were not read. Fix the rule extraction / confirm the shape before proceeding (do not build with an empty Logic table when rules exist).`;
    return null;
  }
  return `typed page '${t.schema}'${typeNote}: NOT resolved — assemble its bundle (\`get-classic-page-sources --schema-name ${t.schema}\`) into manifest.typedPageSchemas so the engine folds its full per-type form, OR mark { "bindOnly": true } if its layout is identical to the base. "Map at build" is not a valid resolution.`;
}

// The structure issue the add-record mini page contributes (only when this migration has a section), or null.
function miniPageIssue(miniPage, miniPageVerified) {
  if (miniPage) {
    if (miniPage.specError) return `add mini page '${miniPage.schema}': supplied bundle failed to parse (${miniPage.specError}) — fix and re-run`;
    if (miniPage.unfolded) return `add mini page '${miniPage.schema}': NOT folded — assemble its bundle (\`get-classic-page-sources --schema-name ${miniPage.schema}\`) into manifest.miniPageSchemas so the engine folds its layout here (or record manifest.addRecordMiniPage:false if there is genuinely none)`;
    if (miniPage.structIncomplete) return `add mini page '${miniPage.schema}': its OWN structure is incomplete — resolve and re-run`;
    return null;
  }
  if (!miniPageVerified) return `add-record mini page NOT verified — check \`list-entity-client-schemas\` (a per-type edit page with \`miniPageSchema\` + \`miniPageModes\` containing "add") and record manifest.addRecordMiniPage: { "schema": "<MiniPage>" } to fold it, or false if there is none. Do NOT assume "no mini page" — it is registered at the module/edit-page level, not always in the section body.`;
  return null;
}

// ⛔ STRUCTURE VALIDATOR — INPUT-completeness of the MANIFEST (distinct from the correctness `gate`). Pure:
// returns { complete, issues }. Extracted from runMigration to keep it under Sonar CC 15 (S3776).
// A NON-typed Rebuild form that folded to ZERO fields is a HOLLOW page (section / edit page didn't resolve) →
// hard BLOCK. TOP-LEVEL only (visited.size===0); nested folds have their own 0-field handling. Reconcile exempt.
// Returns the blocking issue string, or null. Extracted from validateStructure for Sonar CC 15.
function hollowFormIssue(changeSet, typedPages, manifest, visited) {
  if (typedPages.length || visited.size !== 0 || manifest.planMeta?.freedomExists) return null;
  const mainFields = (changeSet.viewConfigDiff || []).filter((o) => o?.values?.control).length;
  if (mainFields !== 0) return null;
  return `form fold produced 0 FIELDS — the section / its edit page did NOT resolve (wrong page schema, an under-captured layer chain [e.g. bundle \`layerCount:1\` missing the fields layer], or a diff built via an unresolved call). A hollow form and everything derived from it — the form spec, the on-stand signals, the whole plan — are INVALID. Re-resolve the section + its real edit page (verify the page schema name and that the bundle captured its full layer chain) and re-run BEFORE any downstream work. (If the page GENUINELY has no own fields — rare — confirm on-stand.)`;
}

// Each mapped detail whose schema wasn't fetched into manifest.detailSchemas is unresolved (columns + child edit
// page). Returns one issue string per such detail. Extracted from validateStructure for Sonar CC 15.
function detailSchemaIssues(changeSet, suppliedDetailKeys) {
  const out = [];
  for (const d of (changeSet.details || [])) {
    if (d.detailSchema && !suppliedDetailKeys.has(d.detailSchema)) {
      const entityNote = d.entity ? ` (${d.entity})` : "";
      out.push(`detail '${d.detailSchema}'${entityNote}: fetch its schema into manifest.detailSchemas — columns and child edit page unresolved`);
    }
  }
  return out;
}

function validateStructure({ manifest, changeSet, childPages, typedPages, section, miniPage, miniPageVerified, visited }) {
  const suppliedDetailKeys = new Set(Object.keys(manifest.detailSchemas || {}));
  const issues = [...detailSchemaIssues(changeSet, suppliedDetailKeys)];
  const hollow = hollowFormIssue(changeSet, typedPages, manifest, visited);
  if (hollow) issues.push(hollow);
  for (const c of childPages) { const issue = childPageIssue(c); if (issue) issues.push(issue); }
  for (const t of typedPages) { const issue = typedPageIssue(t); if (issue) issues.push(issue); }
  if (section) { const issue = miniPageIssue(miniPage, miniPageVerified); if (issue) issues.push(issue); }
  return { complete: issues.length === 0, issues };
}

// Normalize manifest.typedPages ([name | {schema,type,…}]) → [{schema,…}] and raise the typed-page decision.
// Extracted from runMigration to keep it under Sonar CC 15.
function normalizeTypedPages(manifest, changeSet) {
  const toTyped = (t) => {
    if (typeof t === "string") return { schema: t };
    return (t && typeof t === "object") ? t : null;
  };
  const typedPages = (manifest.typedPages || []).map(toTyped).filter((t) => t?.schema);
  if (typedPages.length) {
    changeSet.needsDecision.push({
      kind: "typed-page",
      item: typedPages.map((t) => t.schema).join(", "),
      reason: `Typed entity: ${typedPages.length} per-type Classic edit page(s). Each record Type routes to its OWN Classic page, which takes PRECEDENCE over a general Freedom RelatedPage binding (so "+ New" / open-record open Classic unless overridden). Bind — or rebuild — a Freedom form PER Type (by the Type column), not one form for all types; verify per-type routing on-stand after binding.`,
    });
  }
  return typedPages;
}

// Enumerate the child (related-list) pages from the mapped details — each opens the child entity's edit form on
// add/edit (a recursive sub-migration). Extracted to keep runMigration under Sonar CC 15.
function enumerateChildPages(changeSet, detailSchemas) {
  return (changeSet.details || []).map((d) => {
    const ds = detailSchemas[d.detailSchema];
    return {
      entity: d.entity || null,
      via: d.caption || d.detailSchema || d.entity,
      editPage: ds ? (ds.editPage ?? null) : null, // preserve an explicit `false` (agent verified: no page)
      editable: ds ? ds.editable : null,
      editableVerified: ds ? !!ds.editableVerified : false,
    };
  }).filter((c) => c.entity);
}

// Fold each child page (recursive sub-migration) via foldSubPage, writing the mapping onto each childPages entry.
// isChildPage → child-scoped rendering (few-fields modal nudge, no section-level Print/Process). Extracted for CC.
function foldChildPages(childPages, childSchemas, foldCtx) {
  for (const c of childPages) {
    const key = [c.editPage, c.entity, c.entity && c.entity + "Page"].find((k) => k && childSchemas[k]);
    if (!key) continue;
    const f = foldSubPage(key, childSchemas, foldCtx, { isChildPage: true });
    if (f.status === "cycle") { c.cyclic = true; continue; }   // mapped higher on this branch
    if (f.status === "error") { c.specError = f.error; continue; } // malformed child manifest — keep the listed row
    const res = f.res;
    c.spec = res.designSpec;
    c.mappedEntity = res.entity;
    c.resolvedFrom = key;
    c.childPages = res.childPages || [];     // carry resolved grandchildren up for recursive embedding
    c.grandChildren = c.childPages.length;
    c.childBlocked = !!res.gate?.blocked;    // Major 3: a nested child's spec is valid only if it cleared its OWN gates
    c.childReasons = res.gate?.reasons || [];
    c.childStructIncomplete = !!(res.structure && !res.structure.complete);
    c.treeCyclic = !!res.treeCyclic;
  }
}

// Fold each typed (per-type) page via foldSubPage. `bindOnly:true` is the only non-fold escape; a cycle is its OWN
// resolved state; on a fold, carry the "tables filled" signals for the completeness gate. Extracted for CC.
function foldTypedPages(typedPages, typedSchemas, foldCtx) {
  for (const t of typedPages) {
    if (t.bindOnly === true) { t.resolved = "bind"; continue; }
    const tkey = [t.schema, t.schema && t.schema + "Page"].find((k) => k && typedSchemas[k]);
    if (!tkey) { t.resolved = false; continue; }
    const f = foldSubPage(tkey, typedSchemas, foldCtx);
    if (f.status === "cycle") { t.cyclic = true; t.resolved = "cycle"; continue; }
    if (f.status === "error") { t.specError = f.error; t.resolved = false; continue; }
    const res = f.res;
    t.spec = res.designSpec; t.mappedEntity = res.entity; t.resolved = "fold";
    t.blocked = !!res.gate?.blocked; t.reasons = res.gate?.reasons || [];
    t.structIncomplete = !!(res.structure && !res.structure.complete); t.treeCyclic = !!res.treeCyclic;
    t.fieldCount = (res.changeSet?.viewConfigDiff || []).filter((o) => o?.values?.control).length;
    t.ruleCount = (res.changeSet?.pageBusinessRules || []).length + (res.changeSet?.entityBusinessRules || []).length;
    t.ruleSources = res.changeSet?.ruleSourceCount || 0;
  }
}

// Resolve the add-record mini-page name from the manifest declaration (wins) or the section body. Extracted for CC.
function resolveMiniPageName(mpDecl, secMpName) {
  if (mpDecl === false) return null;
  if (typeof mpDecl === "string" && mpDecl) return mpDecl;
  if (mpDecl && typeof mpDecl === "object" && mpDecl.schema) return mpDecl.schema;
  return secMpName || null;
}

// Fold the section's add-record mini page (isMiniPage → "Mini page (quick-add)" heading, no list-page sub-block).
// Returns the miniPage record, or null when there is none. Extracted to keep runMigration under Sonar CC 15.
function foldMiniPage(mpName, mpDecl, miniPageSchemas, foldCtx) {
  if (!mpName) return null;
  const miniPage = { schema: mpName, type: (mpDecl && typeof mpDecl === "object" && mpDecl.type) || null };
  const mkey = [miniPage.schema, miniPage.schema + "MiniPage"].find((k) => k && miniPageSchemas[k]);
  if (!mkey) { miniPage.unfolded = true; return miniPage; }
  const f = foldSubPage(mkey, miniPageSchemas, foldCtx, { isMiniPage: true });
  if (f.status === "cycle") miniPage.cyclic = true;
  else if (f.status === "error") miniPage.specError = f.error;
  else {
    const res = f.res;
    miniPage.spec = res.designSpec; miniPage.blocked = !!res.gate?.blocked;
    miniPage.reasons = res.gate?.reasons || [];
    miniPage.structIncomplete = !!(res.structure && !res.structure.complete); miniPage.treeCyclic = !!res.treeCyclic;
  }
  return miniPage;
}

// Attach each detail's ADD/EDIT MECHANISM (lookup / service / inline-editable grid) to the mapped detail and
// raise a `detail-add-mechanism` decision, so the Freedom rebuild reproduces the real add flow. Extracted from
// runMigration to keep it under Sonar CC 15 (S3776); mutates changeSet.
// Human-readable phrases for a detail's add/edit mechanism (lookup / service / inline-editable grid / custom
// add-card). Returns the phrases; extracted from attachDetailAddModes for Sonar CC 15.
function describeAddMode(am) {
  const parts = [];
  if (am.lookup) parts.push("ADDS via a lookup (pick existing record(s))");
  if (am.service) parts.push(`calls service \`${am.service}${am.method ? "." + am.method : ""}\` to link/insert`);
  if (am.editableGrid) {
    const colsNote = am.editableColumns?.length ? ` (editable columns: ${am.editableColumns.join(", ")})` : "";
    parts.push(`is an INLINE-EDITABLE grid${colsNote}`);
  }
  if (!parts.length && am.openCardOverridden) parts.push("overrides the default add-card open (custom add flow)");
  return parts;
}

function attachDetailAddModes(changeSet, detailSchemas) {
  for (const d of (changeSet.details || [])) {
    const am = detailSchemas[d.detailSchema]?.addMode;
    if (!am) continue;
    d.addMode = am;
    const parts = describeAddMode(am);
    changeSet.needsDecision.push({ kind: "detail-add-mechanism", item: d.caption || d.detailSchema || d.entity,
      reason: `Detail '${d.caption || d.detailSchema || d.entity}' is NOT a plain related list — it ${parts.join("; ")}. Reproduce this on Freedom with a CUSTOM add request-handler (open the lookup, then create the link records / call the service) — not a default add-new. If it calls a service, VERIFY that service is deployed on-stand (else port its logic to a process/service). If inline-editable, confirm the Freedom list supports inline edit for those columns via get-component-info.` });
  }
}

// A dynamic MAPPING-AFFECTING property (`visible: computeVisibility()`, a bound layout/hint/…) is not structural
// (it doesn't block the gate) but silently collapsed to a DEFAULT in the ChangeSet — surface each as a
// `dynamic-property` decision so the agent wires the real behaviour. Extracted to keep runMigration under CC 15.
function reportDynamicMappingProps(schemas, changeSet) {
  const MAPPING_PROPS = new Set(["visible", "enabled", "readonly", "readOnly", "layout", "hint", "tip", "caption", "required"]);
  for (const s of schemas) {
    for (const d of (s.astDiagnostics || [])) {
      const m = /^diff\.(\d+)\.values\.(\w+)$/.exec(d.path || "");
      if (!m || !MAPPING_PROPS.has(m[2])) continue;
      // match by the ORIGINAL AST index (carried as `astIndex`), not array position (normalizeDiff drops ops → E3).
      const el = (s.diff || []).find((o) => o.astIndex === +m[1]);
      const item = el?.name || el?.bindTo || `diff[${m[1]}]`;
      changeSet.needsDecision.push({ kind: "dynamic-property", item,
        reason: `'${item}' has a dynamic '${m[2]}' (${d.kind}) the parser could not resolve statically — the ChangeSet shows the DEFAULT (e.g. visible:true). Wire the real Freedom behavior (business rule / binding) instead of shipping the static default.` });
    }
  }
}

// Union the *Section chain's list-page signals (add-record mini page, section actions, list columns, quick
// filters, process launch) into one section object, or null when no section schema was supplied. Extracted to
// keep runMigration under CC 15.
function analyzeSectionChain(sectionSchemas) {
  if (!sectionSchemas.length) return null;
  const seen = new Set(), quickFilters = [];
  for (const l of sectionSchemas) for (const f of (l.quickFilters || [])) {
    if (f?.name && !seen.has(f.name)) { seen.add(f.name); quickFilters.push(f); }
  }
  return {
    addRecordMiniPage: sectionSchemas.findLast((l) => l.addRecordMiniPage != null)?.addRecordMiniPage ?? null,
    sectionActions: [...new Set(sectionSchemas.flatMap((l) => l.sectionActions || []))],
    listColumns: [...new Set(sectionSchemas.flatMap((l) => l.listColumns || []))],
    quickFilters,
    processLaunch: sectionSchemas.some((l) => l.processLaunch),
    processNames: [...new Set(sectionSchemas.flatMap((l) => l.processLaunch?.names || []))],
  };
}

// Parse each supplied detail-schema body (#11(ii)/B2) → { entity, columns, title, editPage, editable, addMode … }
// per detail, so the mapper can resolve auto-named (SchemaNDetail) details, show related-list columns, and
// reproduce the real add/edit mechanism. Extracted from runMigration to keep it under Sonar CC 15 (S3776).
// Resolve a detail-schema entry to its body text + parsed schema. A string entry IS the body; an object entry
// carries {body|file}. Missing body ⇒ empty text + a stub parse. Extracted from parseDetailSchemas for Sonar CC 15.
function resolveDetailBody(name, e, bodyOf) {
  const hasBody = typeof e === "string" || (e && (e.body != null || e.file));
  const body = hasBody ? (typeof e === "string" ? e : bodyOf(e)) : "";
  const p = hasBody ? parseSchema(body, name) : { entitySchemaName: "?", diff: [] };
  return { body, p };
}

// ADD/EDIT MECHANISM — a detail is often NOT a plain related list: it may ADD via a LOOKUP (pick existing), call a
// backend SERVICE to link/insert, and/or be an INLINE-EDITABLE grid. These are custom behaviours the Freedom
// rebuild must reproduce (a request handler that opens the lookup then creates links / calls the service — NOT a
// default add-new). DETECT them from the body's methods (text-scan — method bodies are imperative, not statically
// eval'd); returns the mechanism descriptor or null for a plain list. Extracted for Sonar CC 15.
function detectAddMode(body) {
  const svcM = /["']serviceName["']\s*:\s*["']([A-Za-z][\w.]*)["']/.exec(body);
  const methM = /["']methodName["']\s*:\s*["']([A-Za-z]\w+)["']/.exec(body);
  const lookup = /\bopenLookup\b|\baddFromLookup\b|\bgetLookupConfig\b/.test(body);
  const editableGrid = /\bConfigurationGrid\b|ConfigurationGridUtilities|getEditableGridRowViewModelClassName|getCellControlsConfig/.test(body);
  const ecM = /enabledColum\w*\s*=\s*\[([^\]]*)\]/.exec(body); // getCellControlsConfig's editable-column allow-list
  const editableColumns = ecM ? [...ecM[1].matchAll(/["']([A-Za-z]\w+)["']/g)].map((x) => x[1]) : [];
  const openCardOverridden = /openCardByMode\s*:/.test(body);
  if (!(lookup || svcM || editableGrid || openCardOverridden)) return null;
  return { lookup, editableGrid, editableColumns, service: svcM ? svcM[1] : null, method: methM ? methM[1] : null, openCardOverridden };
}

function parseDetailSchemas(manifest, bodyOf) {
  const detailSchemas = {};
  for (const [name, e] of Object.entries(manifest.detailSchemas || {})) {
    const { body, p } = resolveDetailBody(name, e, bodyOf);
    // child EDIT PAGE the detail opens on add/edit (for the recursive child-page migration) — from the
    // detail's getEditPageName / editPageName, else null (the agent resolves it via list-pages).
    const epM = /(?:getEditPageName|editPageName|EditPageSchemaName)[\s\S]{0,80}?["']([A-Za-z]\w+)["']/.exec(body);
    // editability best-effort: an explicit `false` on the add-record button = view-only; else unknown.
    const viewOnly = /getAddRecordButtonVisible[\s\S]{0,80}?return\s+false/.test(body) || /"?addRecordButtonVisible"?\s*:\s*false/.test(body);
    const eObj = (e && typeof e === "object") ? e : {};
    const editPageFromBody = epM ? epM[1] : null;      // getEditPageName match, else null
    const editableFromBody = viewOnly ? false : null;  // add-record hidden ⇒ view-only, else unknown
    const parsedEntity = (p.entitySchemaName && p.entitySchemaName !== "?") ? p.entitySchemaName : null;
    detailSchemas[name] = {
      entity: eObj.entity || parsedEntity,
      columns: [...new Set((p.diff || []).filter((d) => d?.bindTo).map((d) => d.bindTo))],
      title: eObj.title || null, // human detail title (from its resources)
      editPage: ("editPage" in eObj) ? eObj.editPage : editPageFromBody,
      editable: ("editable" in eObj) ? eObj.editable : editableFromBody,
      editableVerified: ("editable" in eObj),
      addMode: detectAddMode(body), // custom add/edit mechanism (lookup / service / inline-editable grid), or null
      error: p.error || null,
      astDiagnostics: p.astDiagnostics || [],
    };
  }
  return detailSchemas;
}

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
    // Containment guards a RELATIVE `file` against a `../` escape of the manifest base dir. An ABSOLUTE path is an
    // explicit caller choice (e.g. the golden fixtures pass `path.join(FIX, …)`), so it is honored regardless of
    // baseDir — the earlier blanket `startsWith(base)` check wrongly rejected legit absolute paths that resolve
    // outside the CWD (which broke `npm test` run from the engine dir, where CWD ≠ the fixtures' root).
    if (!path.isAbsolute(e.file) && resolved !== base && !resolved.startsWith(base + path.sep))
      throw new Error(`schema 'file' escapes the manifest base directory (path traversal): '${e.file}'`);
    return fs.readFileSync(resolved, "utf8");
  };
  const parse = (list) => (Array.isArray(list) ? list : []).map((e) => parseSchema(bodyOf(e), e.pkg));
  const schemas = parse(manifest.schemas);
  const seedTemplate = parse(manifest.seed);
  // section-schema schemas (optional) — the *Section chain. Analyzed for list-page concerns the page
  // migration does not cover: add-record mini page, section actions (#8b), list columns (#2).
  const sectionSchemas = parse(manifest.section);
  const eff = mergeHierarchy(schemas, { seedTemplate, isMiniPage: !!opts.isMiniPage });
  // #11(ii)/B2 — parse each supplied detail-schema body to recover its child entity + list columns + add mode.
  const detailSchemas = parseDetailSchemas(manifest, bodyOf);
  const changeSet = mapToFreedom(eff, {
    entityColumns: manifest.entityColumns || {},
    clientEditableSchemas: manifest.clientEditableSchemas || [],
    resources: manifest.resources || {},     // #5/#13 — localizable strings for tab/group/detail captions
    columnTitles: manifest.columnTitles || {}, // #5/#13 — entity column titles for field LABELS
    detailSchemas,                            // #11(ii)/B2 — parsed detail bodies (entity + columns + title)
    isMiniPage: !!opts.isMiniPage,            // mini-page fold → suppress add-mode visibility-rule noise
    signals: manifest.signals || {},          // on-stand signals (dcm/…) — gate DCM widget emission on the resolved case
  });
  attachDetailAddModes(changeSet, detailSchemas);
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
  reportDynamicMappingProps(schemas, changeSet);
  // section analysis — union the signals across the section schema chain (last-wins for the mini page).
  const section = analyzeSectionChain(sectionSchemas);
  // typed-entity page family — a TYPED entity opens a DIFFERENT Classic edit page per record Type
  // (e.g. Document → DocumentICPage / DocumentOCPage / DocumentRegistryPage / ActPageV2). These come from
  // `list-entity-client-schemas` (the page-role graph), NOT the folded page bundle, so the agent supplies them
  // as `manifest.typedPages` (array of names or {schema,type,template,kind}). They are first-class SCOPE and a
  // build TRAP: each Type routes to its OWN Classic page, which takes precedence over a general Freedom
  // RelatedPage binding — so they were collapsed to one form and never listed. Surface them as a decision so
  // they land in the ⚠ Confirm worklist + the Plan-vs-Done table (not just prose), and in the Main-scope table.
  const typedPages = normalizeTypedPages(manifest, changeSet);
  // child pages (recursion): each CUSTOM detail's related list opens the child entity's edit form on
  // add/edit — a separate migration. Enumerate them so the plan is a tree (parent + one sub-plan each).
  const childPages = enumerateChildPages(changeSet, detailSchemas);
  // RECURSION — if the agent supplied a child edit-page's own schema (keyed by its editPage name or child
  // entity), map it here so its FULL design spec is nested in the plan, not just listed. This is the tree:
  // parent page + one real sub-mapping per related list. A CYCLE (a page reachable from itself) is what must
  // be stopped — NOT depth: a legitimately deep tree (parent → child → grandchild → …) needs to map fully, so
  // a fixed `depth >= 2` cap wrongly left the deepest levels unmapped (structure.complete=false). We track the
  // set of schema/page keys already on the current branch and skip only a key we are ALREADY inside (cycle).
  const visited = opts.visited instanceof Set ? opts.visited : new Set();
  // Run-global memo (ORTHOGONAL to the branch-local `visited` cycle guard): a child/typed/mini page reached from
  // MULTIPLE parents — a diamond in the dependency graph, e.g. a shared Attachment/lookup edit page referenced by
  // several unrelated sections — is otherwise fully re-parsed (whole acorn AST parse of its layer chain) and
  // re-merged once PER reference, turning O(distinct pages) into O(references) on a whole-package migration.
  // Cache the fully-mapped result by resolved page key and reuse it. Cache ONLY acyclic subtrees (`!treeCyclic`):
  // a subtree containing a cycle is context-dependent (whether a node is "already mapped above" depends on which
  // branch reached it), so reusing it under a different parent could mislabel a node — recompute those (rare).
  const memo = opts.memo instanceof Map ? opts.memo : new Map();
  const memoStats = opts.memoStats || { hits: 0, misses: 0 };
  const foldCtx = { visited, memo, memoStats, baseDir }; // shared fold context for foldSubPage (child/typed/mini)
  foldChildPages(childPages, manifest.childPageSchemas || {}, foldCtx);
  // TYPED-PAGE RECURSION — fold each per-type edit page (bundle in manifest.typedPageSchemas); `bindOnly:true` is
  // the only non-fold escape. An unresolved typed page (no bundle, not bindOnly) is a STRUCTURE issue below.
  foldTypedPages(typedPages, manifest.typedPageSchemas || {}, foldCtx);
  // ADD-RECORD MINI PAGE — the section's quick-add form. Its registration lives at the module/edit-page level
  // (SysModuleEdit miniPageSchema + miniPageModes containing "add"), NOT always in the section body, so the
  // section-body extractor alone can FALSELY report "none". Authoritative source: list-entity-client-schemas
  // (miniPageSchema), supplied as manifest.addRecordMiniPage ({schema}|false). Fold it like a typed/child page
  // via manifest.miniPageSchemas so the plan carries its FULL layout. Only meaningful when there is a section.
  const secMpName = sectionSchemas.map((l) => l.addRecordMiniPage).find((v) => typeof v === "string");
  const secMpExists = !!secMpName || sectionSchemas.some((l) => l.addRecordMiniPage === true);
  const mpDecl = manifest.addRecordMiniPage; // {schema}|"name"|false|undefined
  const mpName = resolveMiniPageName(mpDecl, secMpName);
  const miniPageVerified = mpDecl !== undefined || secMpExists; // explicit {schema}/false, or the section body names one
  const miniPage = foldMiniPage(mpName, mpDecl, manifest.miniPageSchemas || {}, foldCtx);
  const miniPageNone = mpDecl === false; // agent verified on-stand: no add mini page
  const decisionSummary = {};
  for (const d of changeSet.needsDecision) decisionSummary[d.kind] = (decisionSummary[d.kind] || 0) + 1;
  // ⛔ HARD GATE (RV1) — the four correctness signals, computed ONCE here so the CLI, the renderer, and any
  // caller share one verdict instead of each re-deriving it (or, as before, never checking it at all). This
  // does NOT throw — runMigration stays pure so the golden runner can assert blocked/clean states; the CLI
  // turns `blocked` into a loud banner + non-zero exit, and the renderer prints the banner into the artifact.
  const gate = computeGate({ parseErrors, eff, manifest, parseDiagnostics, childPages, typedPages, miniPage });
  // ⛔ STRUCTURE VALIDATOR — a systemic completeness check on the MANIFEST INPUTS, so the plan cannot be
  // generated clean while the agent skips the parts it kept dodging (detail schemas, child-page mappings).
  // Unlike the SKILL rules this is enforced in code: the CLI turns `!complete` into a loud banner + non-zero
  // exit, and the renderer prints it into the plan — the agent literally can't present a clean plan without
  // supplying the schemas. This is INPUT completeness (distinct from the correctness `gate` above).
  const structure = validateStructure({ manifest, changeSet, childPages, typedPages, section, miniPage, miniPageVerified, visited });
  // treeCyclic — did THIS run (or any nested child/typed/mini in its subtree) hit a cycle? Only acyclic subtrees
  // are safe to memoize (a cyclic node's "already mapped above" status depends on the branch that reached it).
  const treeCyclic =
    childPages.some((c) => c.cyclic || c.treeCyclic) ||
    typedPages.some((t) => t.cyclic || t.treeCyclic) ||
    !!(miniPage && (miniPage.cyclic || miniPage.treeCyclic));
  const out = {
    entity: manifest.entity && manifest.entity !== "?" ? manifest.entity : eff.entity,
    treeCyclic,   // internal: drives the acyclic-only child-page memo (diamond reuse)
    memoStats,    // internal: { hits, misses } — child/typed/mini fold cache hits across the whole tree
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
  const specOpts = { template: manifest.template, targetPackage: manifest.targetPackage, planMeta: manifest.planMeta, planMetaMissing: out.planMetaMissing, signals: out.signals, signalsMissing: out.signalsMissing, isMiniPage: !!opts.isMiniPage, isChildPage: !!opts.isChildPage };
  out.designSpec = renderDesignSpec(out, specOpts);
  out.plan = renderPlan(out, specOpts);
  out.checklist = renderChecklist(out, specOpts); // the post-implementation Plan-vs-Done control table (CLI --checklist)
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
  const checklistMode = argv.includes("--checklist"); // print ONLY the Plan-vs-Done control table (AFTER implementation)
  const verifyMode = argv.includes("--verify"); // VERIFY the built page against expected deliverables (needs --built)
  const builtIdx = argv.indexOf("--built");     // --built <file>: the get-page ownBodySummary of the built page(s)
  if (verifyMode && (builtIdx < 0 || argv[builtIdx + 1] === undefined || argv[builtIdx + 1].startsWith("--")))
    fail("`--verify` needs `--built <file>` — a JSON with the built page(s): { \"ops\": [{name,type,parentName}], \"parentSchemaName\", \"miniPageBuilt\": true|false|null } (from clio `get-page` ownBodySummary).");
  const builtFile = builtIdx >= 0 ? argv[builtIdx + 1] : null;
  const outIdx = argv.indexOf("--out");        // --out <file>: WRITE the output to a file so the agent presents the file, not a hand-paste
  // `--out` must be followed by a real path. Without this guard a trailing `--out` silently fell back to
  // stdout (documented flag → no write), and `--out --plan` swallowed the next flag — both silent misfires.
  if (outIdx >= 0) {
    const next = argv[outIdx + 1];
    if (next === undefined || next.startsWith("--"))
      fail("`--out` needs a file path (e.g. `--out plan.md`) — got " + (next === undefined ? "no argument" : `the flag '${next}'`) + "; nothing was written");
  }
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;
  const arg = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out" && argv[i - 1] !== "--built"); // positional manifest arg ('-' = stdin)
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
  let output, verifyIncomplete = false;
  if (planMode) output = result.plan + "\n";
  else if (specMode) output = result.designSpec + "\n";
  else if (checklistMode) output = result.checklist + "\n";
  else if (verifyMode) {
    let built; try { built = JSON.parse(fs.readFileSync(builtFile, "utf8")); }
    catch (e) { fail(`cannot read --built '${builtFile}': ${e.message}`); }
    const specOpts2 = { template: manifest.template, planMeta: manifest.planMeta, signals: result.signals };
    const v = renderVerify(result, specOpts2, built);
    output = v.markdown + "\n";
    verifyIncomplete = v.missing > 0 || v.unverified > 0; // any MISSING or unverified deliverable ⇒ not done
  }
  else output = JSON.stringify(result, null, 2) + "\n";
  // ⛔ HARD GATE (RV1) + STRUCTURE VALIDATOR: the artifact carries the banners (renderer), but the CLI ALSO
  // fails loudly so a blocked/incomplete run can't be mistaken for a clean one — stderr note + non-zero exit
  // (2, distinct from the exit-1 bad-input path). The plan/spec is still printed so the agent sees WHAT to fix.
  const gateBad = result.gate?.blocked;
  const structBad = result.structure && !result.structure.complete;
  // finding 8 — an unfilled `--plan` (required planMeta still `<FILL: …>`) is not approvable. Only in --plan
  // mode: `--spec`/default runs legitimately need no planMeta.
  const planIncomplete = planMode && ((result.planMetaMissing?.length > 0) || (result.signalsMissing?.length > 0));
  const notReady = gateBad || structBad || planIncomplete || verifyIncomplete;
  let label = "result";
  if (planMode) label = "plan";
  else if (specMode) label = "design spec";
  else if (checklistMode) label = "checklist";
  else if (verifyMode) label = "verification";
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
