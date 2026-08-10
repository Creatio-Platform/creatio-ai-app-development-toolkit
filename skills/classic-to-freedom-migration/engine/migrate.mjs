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
//     "resources": { "SomeTabCaption": "Localized text", … }, // optional; localizable strings → tab/group/detail captions (#5/#13)
//     "columnTitles": { "MobilePhone": "Mobile phone", … }, // optional; entity column titles → field LABELS (#5/#13)
//     "detailSchemas": { "Schema1Detail": "<define(...) body>" | { "body"|"file", "title", "entity" }, … }, // optional; detail body → entity + list columns; title → detail display name (#11ii)
//     "profileSchemas": { "AccountProfileSchema": "<define(...) body>" | { "body"|"file", "entity" }, … }, // REQUIRED once the page embeds a profile card: the embedded profile schema → profiled entity + the columns the card displayed (ENG-93928). Fetch with `get-client-unit-schema --schema-name <SchemaName>`; the structure gate blocks until each recognised card's schema is supplied.
//     "section": [ { "pkg": "HRApplicant/…", "body"|"file": … }, … ], // optional; the *Section chain → add-record mini page, section actions (#8b), list columns (#2)
//     "childPageSchemas": { "<editPage or child entity>": { …a NESTED manifest (schemas/seed/…)… }, … }, // optional; each related list's child EDIT PAGE → the engine recursively maps it and nests its design spec in the plan
//     "planMeta": { scope, environment, package, approach, whatItDoes, sectionSchema, listTemplate, formTemplate }, // optional; fills the plan's Overview/Main-scope so `--plan --out plan.md` writes a COMPLETE plan (no hand-paste)
//     "behaviourIndex": { "<method>" | "<schema>::<method>" | "<kind>:<name>": { trigger?, from?, card?, ac?: […], note? }, … } // optional; the step-5.1 behaviour-analysis answers, folded back into the ⚠ Imperative logic / ⚠ Confirm rows (see applyBehaviourIndex)
//   }
// CLI: `--plan`/`--spec`/`--checklist` print the artifact; add `--out <file>` to WRITE it (the agent presents the
// file, not stdout). `--checklist` = the Plan-vs-Done control table, produced AFTER implementation (not in `--plan`).
// THE PLAN VERSION: `--plan` prints `**Plan version:** \`plan-<hash>\`` in its Overview and `--units` publishes the
// SAME string as `planVersion` — a deterministic hash over `entity` + the `schemas` bodies + `planMeta` and nothing
// else (never wall-clock, never random, never a filesystem path; see computePlanVersion for what is NOT covered),
// so the same manifest always yields the same version. It is what the
// approval entry in decisions.md names and what the delegated build compares that entry against.
// `--stubs` = the step-5.1 handoff digest: the ⚠ Imperative logic rows per scope (method, traced trigger, externalRef,
// line span) plus the standard-method names the worklist excluded — the payload a behaviour-analysis run indexes
// its cards against. Pair it with `manifest.behaviourIndex` to fold that run's answers back into the plan.
// `--units` = the per-page BUILD QUEUE (JSON, honours `--out`): one entry per page key (`main` · `child:<Entity>`
// · `typed:<Schema>` · `mini:<Schema>`, plus a `@<Via>`/`@<Schema>`/`#n` disambiguator whenever two DISTINCT
// physical pages would otherwise share a key — read them, never construct one) with its role, source schema,
// `expectedTemplate`, target package
// and `expect` counts (including `expect.fieldNames`, the element names the fields check matches on), plus the five
// reachability keys with `appliesWhen` already decided, the evidence-record ids, the ⚠ Confirm preflight items and a
// leaf-first `buildOrder`. Run it BEFORE building: it is the only source of the keys `--built` must use — an
// invented key is silently "not checked", never an error.
// `--verify --built <file>` = the VERIFIED done-gate: diff the ACTUALLY BUILT pages against expected deliverables.
// `--built` is a JSON keyed BY PAGE — `{ pages: { "<key from --units>": { viewConfig, packageName,
// parentSchemaName } | false }, reachability, evidence, judge }` — where `viewConfig` is clio `get-page`'s
// `bundle.viewConfig` VERBATIM (the MERGED page; the page's own body/ownBodySummary cannot show a
// template-provided component such as Feed or the DCM bar, so a check fed that source reads ❌ on a correct page).
// Exit 2 if any deliverable is MISSING or unverified; a payload that is not keyed by page is exit 1.
// `--verify-json <file>` (with `--verify`) ALSO writes the MACHINE-READABLE verdict — `{ complete, missing,
// unverified, planGaps, pages: { "<key>": { missing, unverified, complete, openRows: [ { n, deliverable, status,
// evidence, outcome, id? } ] } } }`. Additive: stdout/`--out` still carry the Markdown table for the human. Read
// it instead of parsing the table — the table has no per-page counts, and the stderr line shows at most six pages.
// `planGaps` is D12's other leg: non-empty ⇒ the PLAN is short (not buildable-out-of), independent of `complete`.
// Prefer inline "body" (get-classic-page-sources writes bodies inline into the manifest) over "file" to avoid path fragility.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseSchema, mergeHierarchy } from "./engine.mjs";
import { mapToFreedom, STANDARD_CLASSIC_METHODS } from "./mapper.mjs";
import { renderDesignSpec, renderPlan, renderChecklist, renderVerify, countFormFields, HANDOFF_MEMBER_KINDS,
  checklistGroups, childTemplateChoice, CHILD_TEMPLATE_SCHEMA, reuseChildGroups, unresolvedChildGroups,
  planGaps, pageUnits, verifyReport, isTabOp } from "./designspec.mjs";

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
  // The child entity ALREADY has a shipped Freedom form page (e.g. a related Contact list opens
  // `Contacts_FormPage`). Nothing is rebuilt — the Freedom related list opens the page that exists — so this is a
  // RESOLVED "Reuse", not a gap. Without it the only escapes were `editPage:false` ("no Classic page exists") and
  // `editable:false` ("view/attach-only"), both FALSE for such a child, so the honest answer could not be recorded
  // and the gate forced folding the child's whole Classic tree (on a base entity: effectively the whole product).
  // Positive evidence required: the agent supplies the Freedom page NAME, verified with list-entity-client-schemas
  // (a `kind: "freedom"` section/edit page for the CHILD entity) — the absence of a working fold is NOT a reason.
  if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) return null;
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
  // Derive the memo key from ALL render flags as sorted key=VALUE pairs (not just names): any future render-affecting
  // flag in `extra` participates automatically AND two truthy VALUES of the same flag (e.g. `{mode:"mini"}` vs
  // `{mode:"full"}`) get DISTINCT keys — a name-only key collided them onto one cache entry and could serve the
  // wrong-flavor spec. (The sub-run receives the full `...extra`, so the key must reflect all of it.)
  const flagKey = Object.entries(extra).filter(([, v]) => v !== undefined && v !== false && v !== null)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(",");
  const memoKey = flagKey ? `${key}::${flagKey}` : key;
  if (ctx.memo.has(memoKey)) { ctx.memoStats.hits++; return { status: "ok", res: ctx.memo.get(memoKey) }; }
  try {
    ctx.memoStats.misses++;
    // `inheritedBehaviourIndex` + `scopeSchema`: one behaviour report covers the whole surface, so its answers are
    // supplied ONCE on the root manifest and must reach every folded scope. The sub-run's own
    // `manifest.behaviourIndex` still wins, and `scopeSchema` is what lets a `"<schema>::<method>"` key address
    // this scope specifically. Neither needs a memo-key entry: `scopeSchema` IS the memo key's `key`, and the
    // inherited map is one per run, so two folds of the same key always see the same answers.
    // `runTargetPackage` is the RUN-level target package (D5 `placement`), threaded explicitly and separately from
    // the fold's `checklistOpts`: a nested run rebuilds `checklistOpts` from the CHILD bundle's manifest, which
    // carries no `targetPackage`, so at depth >= 2 the placement row silently vanished and `--units` published
    // `targetPackage: null` for every grandchild. Deliberately NOT part of `extra` (it must not enter the memo key:
    // one run has exactly one target package, so it cannot vary between two folds of the same key).
    const res = runMigration(schemasMap[key], { baseDir: ctx.baseDir, visited: new Set([...ctx.visited, key]), memo: ctx.memo, memoStats: ctx.memoStats, inheritedBehaviourIndex: ctx.behaviourIndexInput, scopeSchema: key, runTargetPackage: ctx.targetPackage, ...extra });
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

// ENG-93928 — parse each supplied EMBEDDED PROFILE schema (the little declarative page a profile card renders,
// e.g. `AccountProfileSchema`) so the mapper knows the PROFILED entity and which columns the classic card
// displayed. Same shape as a detail record, minus the detail-only concerns (no child edit page / FK).
function parseProfileSchemas(manifest, bodyOf) {
  const out = {};
  for (const [name, e] of Object.entries(manifest.profileSchemas || {})) {
    out[name] = profileSchemaRecord(name, e, bodyOf);
  }
  return out;
}

// ONE profile-schema entry → its record (always the same shape, so callers never type-check the return).
// A manifest value of `false` becomes `verifiedNone: true`: the agent VERIFIED there is no separate profile
// schema to read (the card's config names none, or it is unreadable) — a resolved answer, exactly like
// `addRecordMiniPage: false` / `editPage: false`, so the gate can tell "verified none" from "never checked"
// and the mapper falls back to the by-hand recipe cleanly.
// Deliberately NOT carried over from detailSchemaRecord: `title`, `editPage`, `editable`, `editableVerified`.
// Those are detail-only concerns — a detail governs a child edit page and an add-record workflow, so it needs a
// resolved title and an edit-page answer. A profile card renders a compact view of an ALREADY-linked record; it
// opens the record itself, never a child edit page. Do not mirror the detail template here without that changing.
function profileSchemaRecord(name, e, bodyOf) {
  const verifiedNone = e === false;
  const eObj = (!verifiedNone && e && typeof e === "object") ? e : {};
  const hasBody = !verifiedNone && (typeof e === "string" || e?.body != null || !!e?.file);
  let p = { entitySchemaName: "?", diff: [] };
  if (hasBody) p = parseSchema(typeof e === "string" ? e : bodyOf(e), name);
  const parsedEntity = p.entitySchemaName && p.entitySchemaName !== "?" ? p.entitySchemaName : null;
  return {
    verifiedNone,
    entity: eObj.entity || parsedEntity,
    columns: [...new Set((p.diff || []).filter((d) => d?.bindTo).map((d) => d.bindTo))],
    error: p.error || null,
    astDiagnostics: p.astDiagnostics || [],
  };
}

// A recognised profile card whose profile schema was NOT supplied is an INPUT gap: without that body the engine
// cannot say which entity the card profiled or which values it showed, so the plan would ship a card with no
// contents. Same doctrine as detail/child-page schemas — fetch it, do not defer. A card is RESOLVED when the
// manifest declares its profile schema under the schema name OR under the module key (the only available key when
// the config names no schemaName) — either with a body, or as `false`. Anything else is "never checked", and blocks.
function profileSchemaIssues(manifest, changeSet) {
  const declared = manifest.profileSchemas && typeof manifest.profileSchemas === "object" ? manifest.profileSchemas : {};
  const has = (k) => k != null && Object.hasOwn(declared, k);
  return (changeSet.profileCards || [])
    .filter((pc) => !has(pc.schemaName) && !has(pc.classic))
    .map((pc) => {
      const key = pc.schemaName || pc.classic;
      const schemaNote = pc.schemaName
        ? `its profile schema '${pc.schemaName}'`
        : `its profile schema (the classic config names no schemaName — key the entry by the module name '${pc.classic}')`;
      return `embedded profile card '${pc.classic}': ${schemaNote} is NOT supplied — fetch it (\`get-client-unit-schema --schema-name ${key}\`) into manifest.profileSchemas["${key}"] so the profiled entity and the columns the card displayed are resolved, or record \`manifest.profileSchemas["${key}"]: false\` once you have VERIFIED there is no separate profile schema to read (then rebuild the card by hand per the mapping reference). Without one of the two the Freedom side profile would be built empty; "recreate it at build" is not a resolution.`;
    });
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
  const mainFields = countFormFields(changeSet.viewConfigDiff);
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
  const issues = [...detailSchemaIssues(changeSet, suppliedDetailKeys), ...profileSchemaIssues(manifest, changeSet)];
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
      // agent-verified: the child entity already has a shipped Freedom form page → Reuse, nothing to rebuild
      reuseFreedomPage: ds ? (ds.reuseFreedomPage ?? null) : null,
    };
  }).filter((c) => c.entity);
}

// The BEHAVIOUR-ANALYSIS handoff (SKILL.md step 5.1). A step-5.1 run has to index its behaviour cards against the
// worklist rows this engine emitted, and it cannot derive that list from the stand: `⚠ unresolved` is this engine's
// verdict, not a property of the source. Absent the list the run publishes its own enumeration and the two counts
// have to be reconciled by hand (and a row type the engine counted ZERO — e.g. `externalRef` — gets asserted from
// prose). So the list travels as DATA, in a digest that carries the keys an index needs and drops `evidence`
// (bodies the analysis run reads from the stand itself) — the whole point is a payload small enough to hand over.
function stubDigestOf(changeSet) {
  return (changeSet?.handlerStubs || []).map((h) => ({
    method: h.sourceMethod,
    triggers: h.triggers || [],        // [] ⇒ the row reads `⚠ unresolved`: exactly the rows step 5.1 must describe
    externalRef: h.externalRef || null,// non-null ⇒ assigned from another module (a counted ZERO on most surfaces)
    lines: h.lines || null,
    trivial: !!h.trivial,              // passthrough/empty: a member, but not work to port
    category: h.category || null,
  }));
}

function memberDigestOf(changeSet) {
  return (changeSet?.needsDecision || []).filter((n) => HANDOFF_MEMBER_KINDS.has(n.kind))
    .map((n) => ({ kind: n.kind, item: n.item, key: `${n.kind}:${n.item}` }));
}

// One handoff scope = one schema whose imperative rows are worked as a unit. Kept as a FLAT list of scopes rather
// than one merged array so a caller can hand over (or stage) a single page — the staged-processing direction of
// ENG-94859 — without re-deriving which method belongs to which schema.
function stubScope(role, schema, changeSet, standardMethodsFiltered) {
  const stubs = stubDigestOf(changeSet);
  const members = memberDigestOf(changeSet);
  return {
    role, schema: schema || null,
    counts: {
      stubs: stubs.length,
      unresolvedTrigger: stubs.filter((s) => !s.triggers.length).length,
      // Rows the inverse call graph reached but could not trace to a declaration or a lifecycle hook: we know the
      // calling method, not what starts the chain. Still behaviour-analysis work — kept out of `unresolvedTrigger`
      // so the two states are distinguishable, and published so a handoff prompt cannot mistake one for the other.
      internalCallOnly: stubs.filter((s) => s.triggers.length &&
        s.triggers.every((t) => t.kind === "internal" && !t.rootTrigger && !t.lifecycle)).length,
      externalRef: stubs.filter((s) => s.externalRef).length,
      trivial: stubs.filter((s) => s.trivial).length,
      members: members.length,
    },
    // Names the engine excluded from the worklist as standard framework scaffolding. A behaviour-analysis run
    // enumerates EVERY member, so its method count is legitimately higher; publishing the excluded names turns
    // "63 vs 70" from a contradiction into a set difference.
    standardMethodsFiltered: standardMethodsFiltered || [],
    stubs,
    members, // the ⚠ Confirm rows of the same handoff — keyed `<kind>:<name>`, the form an answer comes back under
  };
}

// The RETURN leg of the step-5.1 handoff: answers the behaviour-analysis run established, folded back into the
// worklist rows. Two distinct things arrive per method and they are kept apart on purpose:
//
//   · a TRIGGER the engine could not trace. The engine reads `triggers[]` off DECLARATIONS (attribute dependency,
//     bound control property); a helper invoked from another method's body has none, so the row printed
//     `⚠ unresolved` even where the answer is plain — the engine builds no reverse call graph (`evidence.calls` is
//     outbound only). A reported trigger fills that blank and is marked `reported`, never merged into AST evidence:
//     an engine-traced trigger always wins, because it was proven from the body rather than described.
//   · the CARD + AC numbers that describe the behaviour. This is what makes *ported* checkable against a described
//     behaviour instead of a method name (Contract rule 7), so it attaches to EVERY matching row — including rows
//     whose trigger the engine already resolved.
//
// The card + acceptance criteria a behaviour-analysis run attached to one row, sanitized. Anything else in the
// entry (a note, a trigger) is read at its own call site.
function describedInOf(entry) {
  const card = typeof entry.card === "string" ? entry.card : null;
  const ac = Array.isArray(entry.ac) ? entry.ac.filter((a) => typeof a === "string") : [];
  return card || ac.length ? { card, ac } : null;
}

// A behaviour report covers a whole SURFACE, so its answers span several scopes (the record page, the mini page,
// each child edit page) while each engine run maps ONE of them — and they cover all FOUR unanswerable row types,
// not just methods. So one index, three key forms, tried in this order per row:
//
//   "<schema>::<method>"   the scoped method form — disambiguates a name two scopes both define (`init`)
//   "<method>"             the bare method form
//   "<kind>:<name>"        a ⚠ Confirm member: `message:RefreshDecisionMaker`, `mixin:CompletenessMixin`, …
//
// Accepting both a scoped and a bare form is the rule `memberDispositions` already uses; without the scoped one,
// a single answer would be folded onto two different bodies that happen to share a method name.
function applyBehaviourIndex(changeSet, index, scopeSchema) {
  const map = plainObject(index);
  if (!Object.keys(map).length) return { triggersFilled: [], described: [] };
  const triggersFilled = [], described = [];
  for (const h of changeSet?.handlerStubs || []) {
    const entry = (scopeSchema ? map[`${scopeSchema}::${h.sourceMethod}`] : undefined) ?? map[h.sourceMethod];
    if (!entry || typeof entry !== "object") continue;
    const d = describedInOf(entry);
    if (d) { h.describedIn = d; described.push(h.sourceMethod); }
    // Fill an EMPTY trigger only. A traced trigger is body-proven; a reported one is a description of it.
    if (!(h.triggers || []).length && (entry.trigger || entry.from)) {
      h.triggers = [{ kind: "reported", reportedKind: entry.trigger || null, from: entry.from || null,
        note: typeof entry.note === "string" ? entry.note : null }];
      triggersFilled.push(h.sourceMethod);
    }
  }
  // ⚠ Confirm members — a `message` whose counterpart lives in another schema, a `mixin` whose members are defined
  // outside this body, the aggregated `module-dep` row. These are the row types step 5.1 exists for just as much as
  // an unresolved method, and they carry no trigger — only the card that describes them.
  for (const n of changeSet?.needsDecision || []) {
    const entry = map[`${n.kind}:${n.item}`];
    if (!entry || typeof entry !== "object") continue;
    const d = describedInOf(entry);
    if (d) { n.describedIn = d; described.push(`${n.kind}:${n.item}`); }
  }
  return { triggersFilled, described };
}

// Which `behaviourIndex` keys reached no row, across EVERY scope of this run. Computed from the assembled index
// (not per scope) because a key that misses the record page legitimately belongs to the mini page or a child.
function unmatchedIndexKeys(index, stubIndex) {
  const keys = Object.keys(plainObject(index));
  if (!keys.length) return [];
  const seen = new Set();
  for (const s of stubIndex) {
    for (const st of s.stubs) { seen.add(st.method); if (s.schema) seen.add(`${s.schema}::${st.method}`); }
    for (const m of s.members) seen.add(m.key);
  }
  return keys.filter((k) => !seen.has(k));
}

// planMeta completeness — the `--plan` artifact is INCOMPLETE while any required Overview/Main-scope value is
// still a `<FILL: …>` placeholder. planMeta is declared optional (so `--spec`/default runs don't need it), so
// its absence was never gated: an unfilled plan passed exit 0 with "present verbatim". Surface the missing
// keys so the CLI turns an unfilled `--plan` into a non-zero exit, like the other incompleteness gates.
const REQUIRED_PLANMETA = ["scope", "environment", "package", "approach", "whatItDoes", "sectionSchema", "listTemplate", "formTemplate"];
// on-stand SIGNALS completeness — the ⚠ conditional checks (DCM case / connected processes / printables)
// must be RESOLVED before the plan, not deferred to build (the recurring "faithful to the classic body,
// check later" miss). No new tool is needed — the agent runs the existing ESQ/odata queries and records the
// answers in `manifest.signals`, each key `{ resolved:true, present:<bool>, cases|items|names?:[…] }`. An
// absent/unresolved key makes --plan INCOMPLETE (like planMeta). `present:false` (checked, none) is a VALID
// resolved state — the distinction is "verified none" vs "never checked", exactly like child-page editPage.
const SIGNAL_KEYS = ["dcm", "processes", "printables"];
// ONE opts object for every row-rendering entry point (`--checklist`, `--verify`, the plan/spec renderers) and
// for the sub-page folds. `--checklist` and `--verify` used to build their own, and the verify one was thinner
// (no targetPackage / planMetaMissing / signalsMissing / isMiniPage / isChildPage): they agreed only for as long
// as no row helper read the gap, and the first helper that did would silently render two different row sets.
// Pure in `manifest` + the run flags, so it can be built BEFORE the fold and shared with every sub-page.
export function checklistOpts(manifest, opts = {}) {
  const pm = manifest.planMeta || {};
  const blank = (v) => v == null || String(v).trim() === "";
  const signals = manifest.signals && typeof manifest.signals === "object" ? manifest.signals : {};
  return {
    template: manifest.template,
    targetPackage: manifest.targetPackage,
    planMeta: manifest.planMeta,
    planMetaMissing: REQUIRED_PLANMETA.filter((k) => k === "formTemplate" ? (blank(pm.formTemplate) && blank(manifest.template)) : blank(pm[k])),
    signals,
    signalsMissing: SIGNAL_KEYS.filter((k) => !signals[k] || typeof signals[k] !== "object" || signals[k].resolved !== true),
    isMiniPage: !!opts.isMiniPage,
    isChildPage: !!opts.isChildPage,
  };
}
// A SUB-page's checklist opts. Deliberately NOT the parent's threaded through: with the parent's planMeta the
// child's `Form template` row expects the PARENT's template (a mismatch nobody can ever fix), and a truthy
// `sectionSchema` gives every sub-page its own `Navigable section registered` row and a whole `List page` group.
// So planMeta is REPLACED, not extended: `formTemplate` is this page's OWN target and a null one emits NO
// template row at all, `sectionSchema`/`listTemplate` are gone.
// `targetPackage` comes from the FOLD CONTEXT, not from the spread: at depth >= 2 the spread's copy came from the
// child bundle's own manifest (which declares none), so the `placement` row simply stopped being emitted for every
// grandchild — the gate did not fail, it ceased to exist, and `--units` published `targetPackage: null`.
function subPageOpts(foldCtx, pageKey, formTemplate, flags = {}) {
  return {
    ...foldCtx.checklistOpts,
    targetPackage: foldCtx.targetPackage,
    pageKey,
    template: formTemplate || null,
    planMeta: formTemplate ? { formTemplate } : {},
    isChildPage: !!flags.isChildPage,
    isMiniPage: !!flags.isMiniPage,
  };
}
// `child:<Entity>` — a ROLE key, not a schema name: a root form page has no schema name in the result and a
// `reuseFreedomPage` child has none at all. Two related lists opening the SAME entity get `@<Via>` so their keys
// stay distinct in the table; the root splice still collapses them when they resolve to one physical page.
// This is only the PROVISIONAL (base) key: it can see one sibling list, while the key it produces is a GLOBAL
// identifier (it keys `--built.pages`, the evidence ids, `--units.pages` and the verify ctx cache). Two DIFFERENT
// physical child pages under DIFFERENT parents that share an entity name would both land on `child:<Entity>` and
// one built page would close both pages' rows. The FINAL key is claimed in the root-level walk that also dedupes
// (`assignPageKeys`, designspec.mjs), where every node in the tree is visible.
function childPageKeys(childPages) {
  const seen = new Set(), dup = new Set();
  for (const c of childPages) { if (seen.has(c.entity)) { dup.add(c.entity); } seen.add(c.entity); }
  return (c) => `child:${c.entity}` + (dup.has(c.entity) ? `@${c.via}` : "");
}
// Publish a page node. `pageKeyBase` is the provisional key, `pageKeyAlt` the disambiguator the root walk appends
// when a DIFFERENT physical page already claimed that base, `pageDedupeId` the physical identity (the same page
// reached twice — a diamond — must collapse to ONE key), and `pageRowsFor` the row factory the root walk re-runs
// under the final key. Rows are also rendered EAGERLY under the base key, so `!node.pageRows` keeps meaning
// "this node publishes no page key at all" for the callers that test it.
function publishPage(node, baseKey, alt, dedupeId, rowsFor) {
  node.pageKeyBase = baseKey;
  node.pageKeyAlt = alt || null;
  node.pageDedupeId = dedupeId;
  node.pageRowsFor = rowsFor;
  node.pageKey = baseKey;
  node.pageRows = rowsFor(baseKey);
}
// Fold each child page (recursive sub-migration) via foldSubPage, writing the mapping onto each childPages entry.
// isChildPage → child-scoped rendering (few-fields modal nudge, no section-level Print/Process). Extracted for CC.
function foldChildPages(childPages, childSchemas, foldCtx) {
  const keyOf = childPageKeys(childPages);
  for (const c of childPages) foldOneChildPage(c, keyOf(c), childSchemas, foldCtx);
}
// A child that is NOT rebuilt here still publishes its page key when it owes a deliverable — with a GATED row.
// A reuse child owes the RelatedPage binding; a child whose Classic page exists (or was never verified) owes the
// whole page. A child verified to have NO separate page, one already mapped higher on this branch (cycle) and one
// whose bundle failed to parse owe nothing that a built-page check could close, so they publish no key at all and
// keep only the parent's identity row — a gated row there would be a permanent false red, and the two latter are
// PLAN-completeness failures the structure gate already blocks on (a different class from "my build is missing").
function publishUnfoldedChild(c, pageKey) {
  if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) {
    publishPage(c, pageKey, c.reuseFreedomPage, `reuse::${c.reuseFreedomPage}`, (k) => reuseChildGroups(k, c));
    return;
  }
  if (!childPageIssue(c)) return;
  // Nothing was folded, so the only physical identity available is the base key itself — two unresolved children
  // that reach the SAME base key stay one entry, exactly as before. The disambiguator is the detail it opens from.
  publishPage(c, pageKey, c.via, `unresolved::${pageKey}`, (k) => unresolvedChildGroups(k, c));
}
function foldOneChildPage(c, pageKey, childSchemas, foldCtx) {
  // Reuse of an existing Freedom form page: there is no rebuild, so do NOT fold the Classic child tree even if a
  // bundle happens to be supplied — folding it would re-introduce the recursion the disposition exists to close.
  if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) return publishUnfoldedChild(c, pageKey);
  const key = [c.editPage, c.entity, c.entity && c.entity + "Page"].find((k) => k && childSchemas[k]);
  if (!key) return publishUnfoldedChild(c, pageKey);
  const f = foldSubPage(key, childSchemas, foldCtx, { isChildPage: true });
  if (f.status === "cycle") { c.cyclic = true; return; }   // mapped higher on this branch
  if (f.status === "error") { c.specError = f.error; return; } // malformed child manifest — keep the listed row
  const res = f.res;
  c.spec = res.designSpec;
  c.mappedEntity = res.entity;
  c.resolvedFrom = key;
  // field count / tabs / details drive the child's template choice (Main scope + the child recommendation must
  // agree): < 15 flat inputs → Mini page; otherwise (>= 15, or tabs/related-lists) → the Grid page template.
  c.fieldCount = countFormFields(res.changeSet?.viewConfigDiff);
  // `isTabOp` (the SHARED tab-type list), not a local `crt.Tab` literal: the mapper emits `crt.TabContainer`, so a
  // `crt.Tab` test here was dead — every tabbed child folded as tab-less and `childTemplateChoice` gated it as the
  // mini template while its OWN design spec recommended the grid one.
  c.hasTabs = (res.changeSet?.viewConfigDiff || []).some(isTabOp);
  c.nDetails = (res.changeSet?.details || []).length + (res.changeSet?.standardFeatures || []).filter((s) => s.uiShape === "list").length;
  c.childPages = res.childPages || [];     // carry resolved grandchildren up for recursive embedding
  c.grandChildren = c.childPages.length;
  c.childBlocked = !!res.gate?.blocked;    // Major 3: a nested child's spec is valid only if it cleared its OWN gates
  c.childReasons = res.gate?.reasons || [];
  c.childStructIncomplete = !!(res.structure && !res.structure.complete);
  c.childCoverage = res.coverage || null;   // the child's own member ledger — aggregated into the parent's gate
  c.treeCyclic = !!res.treeCyclic;
  c.stubScope = stubScope("child page", key, res.changeSet, res.changeSet?.standardMethodsFiltered);
  // Grandchildren only. The nested run's own index opens with ITS main-page scope — the very rows just captured
  // above as `c.stubScope` — so carrying the whole array would list every child page twice.
  c.childStubScopes = (res.stubIndex || []).slice(1);
  // This child's OWN checklist rows, derived from ITS ChangeSet — the whole point of the page-scoped gate: the
  // parent's row set never sees this page's counts, and this page's counts can never be closed by the parent's
  // components. Its expected template comes from the SHARED child-template rule, so the row the agent must
  // satisfy names the very schema the recommendation banner told it to build on. Dedupe on the RESOLVED schema
  // key: the memo hands the same `res` to every parent referencing this page.
  const childTpl = CHILD_TEMPLATE_SCHEMA[childTemplateChoice(c.fieldCount, c.hasTabs, c.nDetails)] || null;
  publishPage(c, pageKey, key, `child::${key}`,
    (k) => checklistGroups(res, subPageOpts(foldCtx, k, childTpl, { isChildPage: true })));
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
    t.coverage = res.coverage || null;        // aggregated into the parent's coverage gate
    t.fieldCount = countFormFields(res.changeSet?.viewConfigDiff);
    t.ruleCount = (res.changeSet?.pageBusinessRules || []).length + (res.changeSet?.entityBusinessRules || []).length;
    t.ruleSources = res.changeSet?.ruleSourceCount || 0;
    // A typed page is a FIRST-CLASS scope of the surface (step 5.1: "every record page including typed variants"): it
    // renders its own ⚠ Imperative logic table, so its rows must ride the handoff like a child page's.
    t.stubScope = stubScope("typed page", tkey, res.changeSet, res.changeSet?.standardMethodsFiltered);
    t.childStubScopes = (res.stubIndex || []).slice(1); // drop the nested run's own main-page scope (captured above)
    // …and its own page-scoped checklist rows. The expected template is whatever the manifest declared for THIS
    // typed page (there is no per-type template rule to derive one from); with none declared the page emits no
    // template row rather than one pinned to the parent's template, which a per-type form need not share.
    publishPage(t, `typed:${t.schema}`, tkey, `typed::${tkey}`,
      (k) => checklistGroups(res, subPageOpts(foldCtx, k, t.template || null)));
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
    miniPage.coverage = res.coverage || null;   // aggregated into the parent's coverage gate
    miniPage.stubScope = stubScope("mini page", mkey, res.changeSet, res.changeSet?.standardMethodsFiltered);
    // The mini page's own rows. Its template is not a choice — a quick-add shell IS the mini-page template — so it
    // comes from the same shared mapping the child rule uses, and its layout stops being a single boolean row.
    publishPage(miniPage, `mini:${miniPage.schema}`, mkey, `mini::${mkey}`,
      (k) => checklistGroups(res, subPageOpts(foldCtx, k, CHILD_TEMPLATE_SCHEMA.mini, { isMiniPage: true })));
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
  // Inner conditionals lifted to locals: keeps the template literals flat (no nested templates, S4624) and the
  // function under the cognitive-complexity budget (S3776).
  const actionMethod = am.actionMethod ? ` (\`${am.actionMethod}\`)` : "";
  const serviceMethod = am.method ? "." + am.method : "";
  const editableCols = am.editableColumns?.length ? ` (editable columns: ${am.editableColumns.join(", ")})` : "";
  const filterOnCols = am.filterCols?.length ? ` on ${am.filterCols.join(", ")}` : "";
  if (am.addDisabled) parts.push("has add-new DISABLED (read-only / attach-only — no default add button)");
  if (am.customAction) parts.push(`exposes a CUSTOM grid action${actionMethod} — reproduce it as a custom detail action (e.g. attach an existing record), NOT a default add-new`);
  if (am.lookup) parts.push("ADDS via a lookup (pick existing record(s))");
  if (am.service) parts.push(`calls service \`${am.service}${serviceMethod}\` to link/insert`);
  if (am.editableGrid) parts.push(`is an INLINE-EDITABLE grid${editableCols}`);
  if (am.fixedFilters) parts.push(`applies FIXED list filters${filterOnCols} — reproduce as a Freedom data-source / business-rule filter`);
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
  // A detail may be supplied as a SINGLE body (a string, or {body|file}) OR as its full Classic REPLACING CHAIN
  // ({bodies:[base…top]}, each a string or {body|file}). Classic replacing schemas are NOT merged server-side
  // (unlike Freedom's full-hierarchy fold), so a signal declared in a BASE layer — e.g. `getAddRecordButtonVisible:
  // return false` in the HRApplicant base of a stage-history detail — is invisible in the top override the client
  // authored. Text-scans (view-only / add-mechanism) therefore run over the UNION of all layers; structure
  // (entity/columns/diff) parses the TOP (most-derived) layer.
  const layerText = (x) => {
    if (typeof x === "string") return x;
    return x && (x.body != null || x.file) ? bodyOf(x) : "";
  };
  const layers = (e && Array.isArray(e.bodies)) ? e.bodies.map(layerText).filter(Boolean) : [layerText(e)].filter(Boolean);
  const body = layers.length ? layers[layers.length - 1] : ""; // TOP = last (bodies are base→top)
  const scanText = layers.join("\n");                            // UNION of all layers, for the text-scans
  const p = layers.length ? parseSchema(body, name) : { entitySchemaName: "?", diff: [] };
  return { body, scanText, p };
}

// ADD/EDIT MECHANISM — a detail is often NOT a plain related list: it may ADD via a LOOKUP (pick existing), call a
// backend SERVICE to link/insert, and/or be an INLINE-EDITABLE grid. These are custom behaviours the Freedom
// rebuild must reproduce (a request handler that opens the lookup then creates links / calls the service — NOT a
// default add-new). DETECT them from the body's methods (text-scan — method bodies are imperative, not statically
// eval'd); returns the mechanism descriptor or null for a plain list. Extracted for Sonar CC 15.
// Exported for a direct perf/ReDoS golden: every text-scan below uses BOUNDED quantifiers ([\s\S]{0,80}? etc.) or a
// linear global match — no nested/ambiguous quantifier — so a large adversarial body stays linear (no catastrophic
// backtracking). engine.mjs documents a prior ~32s/700KB regression fixed exactly this way. GUARDED by two goldens in
// engine-tests/classic-to-freedom/run-mapper.mjs — a wall-clock timing bound on a ~700KB adversarial body
// ("Minor4 ReDoS: detectAddMode …") and a timing-independent structural assert that every `[\s\S]` run stays bounded
// ({0,N}) ("Minor4 structural …") — so a future edit reintroducing exponential backtracking fails a test, not prose.
export function detectAddMode(body) {
  const svcM = /["']serviceName["']\s*:\s*["']([A-Za-z][\w.]*)["']/.exec(body);
  const methM = /["']methodName["']\s*:\s*["']([A-Za-z]\w+)["']/.exec(body);
  const lookup = /\bopenLookup\b|\baddFromLookup\b|\bgetLookupConfig\b/.test(body);
  const editableGrid = /\bConfigurationGrid\b|ConfigurationGridUtilities|getEditableGridRowViewModelClassName|getCellControlsConfig/.test(body);
  const ecM = /enabledColum\w*\s*=\s*\[([^\]]*)\]/.exec(body); // getCellControlsConfig's editable-column allow-list
  const editableColumns = ecM ? [...ecM[1].matchAll(/["']([A-Za-z]\w+)["']/g)].map((x) => x[1]) : [];
  const openCardOverridden = /openCardByMode\s*:/.test(body);
  // Add-new DISABLED — a read-only / attach-only related list. Classic idioms: the add button forced invisible
  // (`getAddRecordButtonVisible … return false` / `addRecordButtonVisible: false` — the system-maintained
  // stage-history pattern, declared in the BASE replacing layer), the add-record menu emptied
  // (`addRecordOperationsMenuItems: Terrasoft.emptyFn`), or the add button removed in the diff (`remove … AddTypedRecordButton`).
  const addDisabled = /getAddRecordButtonVisible[\s\S]{0,80}?return\s+false/.test(body)
    || /["']?addRecordButtonVisible["']?\s*:\s*false/.test(body)
    || /addRecordOperationsMenuItems\s*:\s*(?:Terrasoft\.)?emptyFn/.test(body)
    || /["']operation["']\s*:\s*["']remove["'][\s\S]{0,120}?AddTypedRecordButton/.test(body);
  // A CUSTOM grid action (e.g. "attach existing") added via addGridOperationsMenuItems → getButtonMenuItem. Capture
  // the Click handler name — that's the custom add/attach flow the Freedom rebuild must reproduce.
  const customAction = /addGridOperationsMenuItems\s*:/.test(body) && /getButtonMenuItem\s*\(/.test(body);
  const clickM = customAction ? /getButtonMenuItem\s*\(\s*\{[\s\S]{0,200}?Click\s*:\s*\{[^}]*bindTo["']\s*:\s*["'](\w+)["']/.exec(body) : null;
  // FIXED list filters — a getFilters override adding column filters. Capture the directly-filtered columns
  // (ComparisonType.<X>, "Col" and createColumnInFilterWithParameters("Col", …)).
  const fixedFilters = /\bgetFilters\s*:/.test(body) && /createColumn(?:In)?Filter\w*/.test(body);
  const filterCols = fixedFilters ? [...new Set([
    ...[...body.matchAll(/ComparisonType\.\w+\s*,\s*["']([A-Za-z]\w+)["']/g)].map((x) => x[1]),
    ...[...body.matchAll(/createColumnInFilterWithParameters\s*\(\s*["']([A-Za-z]\w+)["']/g)].map((x) => x[1]),
  ])] : [];
  if (!(lookup || svcM || editableGrid || openCardOverridden || addDisabled || customAction || fixedFilters)) return null;
  return { lookup, editableGrid, editableColumns, service: svcM ? svcM[1] : null, method: methM ? methM[1] : null,
    openCardOverridden, addDisabled, customAction, actionMethod: clickM ? clickM[1] : null, fixedFilters, filterCols };
}

function parseDetailSchemas(manifest, bodyOf) {
  const detailSchemas = {};
  for (const [name, e] of Object.entries(manifest.detailSchemas || {})) {
    const { scanText, p } = resolveDetailBody(name, e, bodyOf);
    // child EDIT PAGE the detail opens on add/edit (for the recursive child-page migration) — from the
    // detail's getEditPageName / editPageName, else null (the agent resolves it via list-pages). Scan the UNION of
    // layers (it may be declared in a base replacing layer, not the top).
    const epM = /(?:getEditPageName|editPageName|EditPageSchemaName)[\s\S]{0,80}?["']([A-Za-z]\w+)["']/.exec(scanText);
    // editability best-effort: an explicit `false` on the add-record button = view-only; else unknown. This is the
    // read-only signal for system-maintained details (stage history) — and it lives in the BASE layer, so scan the union.
    const viewOnly = /getAddRecordButtonVisible[\s\S]{0,80}?return\s+false/.test(scanText) || /"?addRecordButtonVisible"?\s*:\s*false/.test(scanText);
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
      // agent-verified Reuse: the child entity already has a shipped Freedom form page (name supplied here), so
      // the Freedom related list opens that page and the Classic child page is superseded, not rebuilt.
      reuseFreedomPage: (typeof eObj.reuseFreedomPage === "string" && eObj.reuseFreedomPage) ? eObj.reuseFreedomPage : null,
      addMode: detectAddMode(scanText), // custom add/edit mechanism (lookup / service / grid / add-disabled) across ALL layers, or null
      error: p.error || null,
      astDiagnostics: p.astDiagnostics || [],
    };
  }
  return detailSchemas;
}

// ---- MEMBER LEDGER + ⛔ COVERAGE GATE --------------------------------------------------------------------
// Implements the completeness test the sibling classic-ui-expert skill specifies in `03-member-ledger.md`:
// "every member is attributed to exactly one unit, or to a recorded zero — any member without a unit is a unit
// you have not found". Here a "unit" is a DISPOSITION:
//
//   mapped      — the ChangeSet carries a concrete Freedom artifact for it (field, rule, detail, feature, widget)
//   decision    — it reached needsDecision[], so it is on the agent's worklist
//   context     — inherited base-template content, excluded from the payload BY DESIGN (counted, never dropped)
//   unaccounted — nothing produced it. This is what the gate blocks on.
//
// The point of `context` being a real disposition rather than an omission: a template-owned member a CLIENT
// schema touched is NOT context (that is the `base-field-override` distinction), so the ledger keys on
// `fromTemplate`, which the engine derives from `schemaTouched`, not on template ownership alone.
const MEMBER_KINDS = ["diff-op", "method", "attribute", "message", "mixin", "module-dep", "resource", "detail"];
// modules that carry no page behaviour of their own (framework root / pure styling) — mirrors the mapper's own
// list; a module wrongly called inert is a silently dropped member, so it stays deliberately short.
const INERT_MODULE_RX = /^(?:terrasoft|ext-base|Ext|sandbox|css!)/;
// what a method contributes to its ledger row — kept out of the source table so the table stays scannable
const methodLedgerDetail = (m) =>
  m.facts ? { lines: m.facts.lines, kinds: m.facts.kinds, trivial: m.facts.callParentOnly || m.facts.isEmpty } : null;

// A member's disposition, decided by what the pipeline actually produced for it.
function disposition(name, { fromTemplate, mapped, decided }) {
  if (mapped) return "mapped";
  if (decided) return "decision";
  if (fromTemplate) return "context";
  return "unaccounted";
}

// The nearest ANCESTOR of a layout item that the pipeline accounted for, or null.
// A unit is often multi-member (04-units.md): the mapper deliberately emits ONE `unmapped-component` decision per
// dropped SUBTREE ROOT — its text says "and its sub-items" — so a child of an accounted block is attributed to
// that block's unit, not a gap of its own. Without this the ledger reports a block's leaves as unaccounted while
// the worklist has already covered the whole block: on a real Opportunity page that was the radio options inside
// a client `IsPrimary` control, flagged as gaps although their parent carried the decision.
function accountedAncestor(name, parentOf, isAccounted) {
  const seen = new Set([name]);
  let cur = parentOf.get(name);
  while (cur && !seen.has(cur)) {          // `seen` guards a malformed parent cycle in an untrusted body
    if (isAccounted(cur)) return cur;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return null;
}

// Everything the ChangeSet demonstrably produced an artifact for, as a name set — the `mapped` evidence.
// The primary source is the mapper's OWN `accountedFor` list (it is what `mapUnmappedDrop` already trusts to
// decide what silently vanished). The extra sweeps below cover names the mapper keys differently from the diff
// item — a rule's target column, a detail's schema name, a resource key.
function mappedNames(changeSet) {
  const s = new Set(changeSet.accountedFor || []);
  const addAll = (list, ...keys) => {
    for (const entry of list || []) for (const k of keys) { const v = entry?.[k]; if (v) s.add(String(v)); }
  };
  for (const op of changeSet.viewConfigDiff || []) {
    if (op?.name) s.add(op.name);
    if (op?.values?.bindTo) s.add(String(op.values.bindTo).replace(/^\$/, ""));
  }
  addAll(changeSet.pageBusinessRules, "element");
  addAll(changeSet.entityBusinessRules, "targetAttribute");
  addAll(changeSet.details, "detailSchema", "classic");
  addAll(changeSet.standardFeatures, "classic", "detailSchema");
  addAll(changeSet.widgets, "classic");
  addAll(changeSet.chromeWidgets, "classic");
  for (const k of Object.keys(changeSet.resources || {})) s.add(k);
  return s;
}

// Kinds whose `item` is a deliberately AGGREGATED comma list, so each name in it really is decided. Splitting
// EVERY item on commas over-clears badly: `attribute-dependency` items read `"Amount ← Quantity, Price"`, and
// `process-launch`/`feature-toggle` items are joined name lists — so a bare `Price` (or any member whose name
// happens to match a leaked token) would be marked decided without anyone deciding it. On a real page, dependency
// column names and field names overlap heavily, so this silently cleared genuine gaps.
const AGGREGATED_DECISION_KINDS = new Set(["module-dep"]);

// The set of member names a decision covers. Plain `split(",")` + trim rather than a `\s*,\s*` pattern: the
// whitespace-padded separator backtracks super-linearly on a long run of spaces, and `item` carries stand-derived
// text — the same ReDoS discipline the process-launch scan already follows.
function decidedNames(needsDecision) {
  const decided = new Set();
  for (const d of needsDecision || []) {
    if (d.item == null) continue;
    const item = String(d.item);
    if (!AGGREGATED_DECISION_KINDS.has(d.kind)) { decided.add(item.trim()); continue; }
    for (const part of item.split(",")) {
      const name = part.trim();
      if (name) decided.add(name);
    }
  }
  return decided;
}

export function buildCoverage({ eff, changeSet, manifest, childCoverage = [] }) {
  const decided = decidedNames(changeSet.needsDecision);
  const mapped = mappedNames(changeSet);
  // The agent's own dispositions, supplied like `manifest.signals`: `{ "<member>": { "resolved": true,
  // "disposition": "ported"|"dropped"|"blocked"|"n/a", "note": "…" } }`. This is how a member that the engine
  // can only flag gets CLOSED — the same "verified answer beats a guess" contract the signals gate uses.
  const declared = plainObject(manifest.memberDispositions);
  const rows = [];
  // Members are keyed `<kind>:<name>`, not by bare name: a Classic diff item is usually named for the column it
  // binds, so attribute `Amount` and diff-op `Amount` coexist in one ledger. A bare-name key would let ONE
  // disposition entry clear both — over-clearing across kinds is the same silent pass the gate exists to stop.
  // A bare-name key is still accepted as a fallback so a disposition can be written either way.
  // parent links + "did the pipeline account for this name at all", for the ancestor walk below
  const parentOf = new Map((eff.items || []).filter((i) => i.parent).map((i) => [i.name, i.parent]));
  const isAccounted = (n) => mapped.has(n) || decided.has(n);
  const add = (kind, name, opts) => {
    const id = `${kind}:${name}`;
    const dec = plainObject(declared[id] ?? declared[name]);
    const agentResolved = dec.resolved === true && typeof dec.disposition === "string";
    let disp = agentResolved ? "resolved" : disposition(name, opts);
    // Only a LAYOUT member can inherit its attribution — a method/attribute/message has no parent chain.
    let via = null;
    if (disp === "unaccounted" && kind === "diff-op") {
      via = accountedAncestor(name, parentOf, isAccounted);
      if (via) disp = "decision";
    }
    rows.push({
      kind, name, id,
      disposition: disp,
      agentDisposition: agentResolved ? dec.disposition : null,
      // recorded, never silent: the ledger says WHICH unit absorbed this member, so the attribution is auditable
      viaAncestor: via,
      note: typeof dec.note === "string" ? dec.note : null,
      provenance: opts.provenance || null,
      fromTemplate: !!opts.fromTemplate,
      detail: opts.detail || null,
    });
  };

  // One declarative row per member KIND: where its members come from, how each is named, and what counts as
  // `mapped` for it. A table rather than eight near-identical loops so adding a kind is one entry — and so the
  // "did anyone account for this?" logic stays in ONE readable place.
  const SOURCES = [
    { kind: "diff-op", list: eff.items, name: (i) => i.name, prov: (i) => i.provenance,
      tpl: (i) => i.templateOwned, mapped: (i) => mapped.has(i.name) || (!!i.bindTo && mapped.has(i.bindTo)) },
    // a STANDARD framework/scaffolding method (init / onSaved / validator config) is deliberately kept off the
    // worklist by the mapper, so it would otherwise land `unaccounted` and block every page. It is a recorded
    // `context` member — excluded by design and COUNTED — exactly like an inert module dep below.
    { kind: "method", list: eff.methods, name: (m) => m.name, prov: (m) => m.stack,
      tpl: (m) => m.fromTemplate || STANDARD_CLASSIC_METHODS.has(m.name), mapped: () => false, detail: methodLedgerDetail },
    { kind: "attribute", list: eff.attributes, name: (a) => a.name, prov: (a) => a.provenance,
      tpl: (a) => a.fromTemplate, mapped: (a) => mapped.has(a.name),
      // an `attribute-dependency` decision is keyed "<attr> ← <cols>", so match on that prefix too
      extraDecided: (a) => [...decided].some((d) => d.startsWith(a.name + " ")),
      detail: (a) => ({ lookupFilters: a.lookupFilters, dependencies: a.dependencies.length, fnKeys: a.fnKeys }) },
    { kind: "message", list: eff.messages, name: (m) => m.name, prov: (m) => m.provenance,
      tpl: (m) => m.fromTemplate, mapped: () => false, detail: (m) => ({ mode: m.mode, direction: m.direction }) },
    { kind: "mixin", list: eff.mixins, name: (m) => m.name, prov: (m) => m.provenance,
      tpl: (m) => m.fromTemplate, mapped: () => false, detail: (m) => ({ module: m.module }) },
    // the framework root / pure styling carries no page behaviour — a recorded `context` zero, not a gap
    { kind: "module-dep", list: eff.moduleDeps, name: (d) => d.name, prov: (d) => d.provenance,
      tpl: (d) => d.fromTemplate || INERT_MODULE_RX.test(d.name), mapped: () => false },
    { kind: "detail", list: eff.details, name: (d) => d.key, prov: (d) => d.provenance,
      tpl: (d) => d.fromTemplate, mapped: (d) => mapped.has(d.key) || mapped.has(d.schemaName) },
  ];
  for (const src of SOURCES) {
    for (const entry of src.list || []) {
      const name = src.name(entry);
      add(src.kind, name, {
        fromTemplate: src.tpl(entry),
        mapped: src.mapped(entry),
        decided: decided.has(name) || (src.extraDecided ? src.extraDecided(entry) : false),
        provenance: src.prov(entry),
        detail: src.detail ? src.detail(entry) : null,
      });
    }
  }

  const byDisposition = {};
  for (const r of rows) byDisposition[r.disposition] = (byDisposition[r.disposition] || 0) + 1;
  const unaccounted = rows.filter((r) => r.disposition === "unaccounted");
  // Counted zeros are ledger entries too (03-member-ledger.md): a kind with no members is recorded as verified
  // empty rather than omitted, so "the plan says nothing about messages" can never mean "nobody looked".
  const zeros = MEMBER_KINDS.filter((k) => !rows.some((r) => r.kind === k));
  const issues = unaccounted.map((r) =>
    `${r.kind} '${r.name}' is UNACCOUNTED — the engine produced no Freedom artifact and no decision for it. Either it maps (then the mapping must appear in the ChangeSet) or it needs a recorded answer: add manifest.memberDispositions["${r.id}"] = { "resolved": true, "disposition": "ported"|"dropped"|"blocked"|"n/a", "note": "<why>" }. Do NOT leave it silent.`);
  // SUBTREE AGGREGATION — the migration is a page TREE (Contract rule 4, step 7.3), and every other gate
  // aggregates it: `gate` blocks on `childBlocked`/`blockedTyped`/`miniPage.blocked`, `structure` on each
  // sub-page's own structure issues. Without the same here, a `Rebuild (child)` page whose methods and attributes
  // are entirely unaccounted produced a parent run with coverage.complete:true and exit 0 — the parent asserting
  // a coverage its own children do not have, which is precisely the inconsistency this change exists to remove.
  for (const sub of childCoverage) {
    if (!sub?.coverage || sub.coverage.complete) continue;
    issues.push(`${sub.role} '${sub.label}': ${sub.coverage.issues.length} of its OWN member(s) are unaccounted — a sub-page's spec is not a valid mapping while its members are unaccounted; fix it, then re-run the parent. First: ${sub.coverage.issues[0]}`);
  }
  return { complete: issues.length === 0, issues, rows, byDisposition, zeros, total: rows.length };
}

const plainObject = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});

// THE PLAN VERSION — the string an operator records in the decisions.md approval entry, and the string the
// delegated build compares that entry against. The engine has to publish it, because nothing else can: `plan.md`
// is ENGINE-WRITTEN (`--plan --out plan.md`, presented verbatim), so a version an agent hand-typed into it would
// be erased by the next `--plan` run — and an approval gate that demands a version nothing produces stops every
// run before it builds.
//
// It is a short hash over THREE manifest inputs, and only those three: `entity`, `schemas` (each entry's `pkg`
// plus its body CONTENT, in manifest order) and `planMeta`. Same manifest ⇒ same version, always, so a re-run is
// not a new version to re-approve; a changed `planMeta` or a changed main-page body ⇒ a different one, so an
// approval cannot silently carry over to a plan the user never saw.
//
// EXCLUDED because including them would make the value non-reproducible: wall-clock time; any random source; and
// every filesystem PATH — a `{ file: … }` schema entry contributes its CONTENT, never its location, so planning
// the same manifest from a fresh temporary directory yields the same version instead of inventing one.
//
// ALSO NOT COVERED, and this is a real limit rather than a safety measure: `seed`, `detailSchemas`,
// `childPageSchemas`, `profileSchemas`, `section`, `signals`, `behaviourIndex`, `targetPackage`. Each of those
// reaches the rendered plan, so a plan CAN change without the version moving — a re-mapped child page is the
// realistic case. The version is therefore a check that the approved plan and the built plan came from the same
// MAIN-PAGE inputs, not a checksum of the whole artifact. Widening the hash to those sections is the obvious
// next step and needs its own decision, because it also makes every child-schema refetch a re-approval.
// Canonicalizes EVERY manifest key that changes what the plan says — not just the main page's. An earlier
// version hashed only {entity, schemas, planMeta}, which left the plan's child pages, details, typed forms,
// mini page, section and signals OUTSIDE the version: the unit set could change materially (a detail marked
// `editPage:false` drops a whole child page) while the approved version stayed identical, so the approval gate
// authorised a plan nobody approved. Everything the manifest carries is covered here instead of an allowlist,
// because the allowlist is exactly what went stale.
const SCHEMA_BODY_ARRAYS = new Set(["schemas", "seed"]);
// Two ceilings, both learned from the suite's deep-nest DoS golden. A manifest is stand-sourced data, so it can
// be adversarially or accidentally deep AND wide. A first attempt built a canonical structure and stringified it:
// it died with a RangeError. A depth cap alone still exhausted the heap, because 24 levels of an N-element array
// is N^24 nodes. So the walk STREAMS into the hash — constant memory — and stops at whichever ceiling comes
// first. Past a ceiling the rest of that subtree collapses to one sentinel: the version stops DISTINGUISHING
// changes beyond that point, a bounded loss of resolution, never a crash and never a different value for the
// same input. Real bundles nest a handful of levels and a few thousand nodes.
const PLAN_VERSION_MAX_DEPTH = 24;
const PLAN_VERSION_MAX_NODES = 200000;
// An entry whose `file` cannot be read contributes this FIXED sentinel — never the path, never the error text, both
// of which are machine-specific and would break reproducibility. Two distinct unreadable entries therefore hash
// alike; that is the same bounded loss of resolution the depth/node ceilings already accept.
const PLAN_VERSION_UNREADABLE = "unreadable";
// The body CONTENT one `schemas`/`seed` entry contributes. The walk reaches entries the RUN never needed — a
// `reuseFreedomPage` child that `foldOneChildPage` returns early on, an unreferenced `childPageSchemas` bundle — so
// an entry with neither `body` nor `file`, AND one whose `file` does not resolve, both contribute a sentinel rather
// than throwing ENOENT out of `runMigration` and failing (exit 1) a manifest that planned fine. Same reasoning as
// the missing-both case: an unreadable entry is the gate's problem, not the version's.
function schemaBodyFor(e, readBody) {
  if (!e || (e.body == null && !e.file)) return "";
  try {
    return String(readBody(e));
  } catch {
    return PLAN_VERSION_UNREADABLE;
  }
}
// The `schemas`/`seed` leg, extracted so `feedPlanVersion` carries one branch per shape rather than three
// (the repo pins Sonar cognitive complexity 15, and this is the hottest walk in the file).
function feedSchemaArray(h, value, readBody) {
  h.update("\u0001S");
  for (const e of value) {
    h.update(String(e?.pkg ?? ""));
    h.update("\u0001");
    h.update(schemaBodyFor(e, readBody));
    h.update("\u0001");
  }
}
function feedPlanVersion(h, value, key, readBody, state, depth) {
  if (depth > PLAN_VERSION_MAX_DEPTH || ++state.nodes > PLAN_VERSION_MAX_NODES) { h.update("\u0001cap"); return; }
  if (Array.isArray(value)) {
    // A `schemas`/`seed` entry reduces to pkg + BODY CONTENT wherever it appears — including inside a nested
    // bundle (childPageSchemas / typedPageSchemas / miniPageSchemas) — so a `{file:…}` entry contributes what it
    // CONTAINS, and re-planning the same bodies from a fresh temp dir keeps one version. An entry with neither
    // `body` nor `file`, or a `file` that does not resolve, contributes a sentinel instead of aborting the run —
    // see `schemaBodyFor`.
    if (SCHEMA_BODY_ARRAYS.has(key)) return feedSchemaArray(h, value, readBody);
    // Array order IS a plan input (it is the override chain), so it is never sorted.
    h.update("\u0001A");
    for (const v of value) feedPlanVersion(h, v, null, readBody, state, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    // Object key order is NOT a plan input, so keys are sorted — two manifests differing only in key order must
    // not read as two different plans.
    h.update("\u0001O");
    // Code-unit order (matches the default `.sort()`), NOT `localeCompare` — the key order here canonicalizes a
    // hash and must be byte-for-byte reproducible across machines/locales, which locale collation is not.
    for (const k of Object.keys(value).sort((a, b) => {
      if (a < b) { return -1; }
      if (a > b) { return 1; }
      return 0;
    })) {
      h.update(k);
      h.update("\u0001");
      feedPlanVersion(h, value[k], k, readBody, state, depth + 1);
    }
    return;
  }
  h.update("\u0001P");
  h.update(value === undefined ? "null" : (JSON.stringify(value) ?? "null"));
}
// Covers EVERY manifest key that changes what the plan says. An earlier version hashed only
// {entity, schemas, planMeta}, which left the plan's child pages, details, typed forms, mini page, section and
// signals OUTSIDE it: the unit set could change materially (a detail marked `editPage:false` drops a whole child
// page) while the approved version stayed identical, so the approval gate authorised a plan nobody approved.
// Everything the manifest carries is covered here rather than an allowlist — the allowlist is what went stale.
function computePlanVersion(manifest, readBody) {
  const h = createHash("sha256");
  feedPlanVersion(h, manifest, null, readBody, { nodes: 0 }, 0);
  return "plan-" + h.digest("hex").slice(0, 12);
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
  const eff = mergeHierarchy(schemas, { seedTemplate }); // isMiniPage is consumed downstream (mapToFreedom / renderDesignSpec), NOT by mergeHierarchy — don't pass an inert arg here
  // #11(ii)/B2 — parse each supplied detail-schema body to recover its child entity + list columns + add mode.
  const detailSchemas = parseDetailSchemas(manifest, bodyOf);
  // ENG-93928 — the embedded profile schemas a profile card renders (profiled entity + displayed columns).
  const profileSchemas = parseProfileSchemas(manifest, bodyOf);
  const changeSet = mapToFreedom(eff, {
    entityColumns: manifest.entityColumns || {},
    resources: manifest.resources || {},     // #5/#13 — localizable strings for tab/group/detail captions
    columnTitles: manifest.columnTitles || {}, // #5/#13 — entity column titles for field LABELS
    detailSchemas,                            // #11(ii)/B2 — parsed detail bodies (entity + columns + title)
    profileSchemas,                           // ENG-93928 — parsed embedded-profile bodies (entity + displayed columns)
    isMiniPage: !!opts.isMiniPage,            // mini-page fold → suppress add-mode visibility-rule noise
    isChildPage: !!opts.isChildPage,          // child edit page → build its base-page (entity-bound) fields too, don't suppress as template context
    signals: manifest.signals || {},          // on-stand signals (dcm/…) — gate DCM widget emission on the resolved case
  });
  attachDetailAddModes(changeSet, detailSchemas);
  // Fold the step-5.1 answers into the rows BEFORE anything renders, so the generated `⚠ Imperative logic` table
  // carries them. Hand-appending them to the plan's `Adjustments` did not survive a re-run: `--plan --out` rewrites
  // the file, so the only link from a worklist row to the behaviour that describes it was lost on every regenerate.
  // A sub-run inherits the root manifest's answers (one report covers the whole surface) and may override them.
  const behaviourIndexInput = { ...plainObject(opts.inheritedBehaviourIndex), ...plainObject(manifest.behaviourIndex) };
  const behaviourIndex = applyBehaviourIndex(changeSet, behaviourIndexInput, opts.scopeSchema);
  const parseErrors = [
    ...[...schemas, ...seedTemplate].filter((l) => l.error).map((l) => ({ pkg: l.pkg, error: l.error })),
    // Major 3: a detail-schema body that FAILED to parse must reach the gate too — otherwise its columns/child
    // page silently resolve to null while the plan stays green. Its error was captured per-detail above.
    ...Object.entries(detailSchemas).filter(([, d]) => d.error).map(([name, d]) => ({ pkg: `detail:${name}`, error: d.error })),
    // ENG-93928 — same rule for a profile-schema body: if it failed to parse, the card's entity/columns are
    // silently null while the plan stays green. Gate it.
    ...Object.entries(profileSchemas).filter(([, p]) => p.error).map(([name, p]) => ({ pkg: `profile:${name}`, error: p.error })),
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
    // profile-schema diagnostics join the pool tagged `profile:<name>` — a structural one (its `diff` built via
    // an unresolved construct) blocks the gate, instead of emptying the card's column list unnoticed.
    ...Object.entries(profileSchemas).flatMap(([name, p]) => (p.astDiagnostics || []).map((x) => ({ pkg: `profile:${name}`, ...x }))),
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
  // THIS page's own identity must be on the branch before its children are folded, or a detail pointing back at the
  // page itself (e.g. "related opportunities" on the Opportunity page) is never recognised as a cycle: `visited` is
  // seeded by the CALLER, so at the ROOT it is empty and the page has no key of its own in it. The child keys are
  // resolved as [editPage, entity, entity+"Page"], so the entity name is the identity a self-referencing child
  // matches on. Seeded into the FOLD context only — `visited` itself stays as the caller passed it, because
  // hollowFormIssue uses `visited.size === 0` to mean "this is the top-level page".
  const selfKeys = [manifest.entity, manifest.entity && manifest.entity + "Page"].filter(Boolean);
  // The ONE row-rendering opts object (see checklistOpts) — built here, BEFORE the fold, because each sub-page
  // derives its own from it and the renderers below reuse it verbatim. Pure in manifest + the run flags, so
  // building it early changes nothing about its value.
  const specOpts = checklistOpts(manifest, opts);
  // `targetPackage` rides on the fold context SEPARATELY from `checklistOpts` (D5/F3): `checklistOpts` is rebuilt
  // from THIS run's manifest, and a nested run's manifest is the child bundle — which carries no `targetPackage`.
  // Taking the run-level value from `opts.runTargetPackage` first makes the package gate exist at every depth.
  const runTargetPackage = opts.runTargetPackage != null ? opts.runTargetPackage : manifest.targetPackage;
  const foldCtx = { visited: new Set([...visited, ...selfKeys]), memo, memoStats, baseDir, behaviourIndexInput, checklistOpts: specOpts, targetPackage: runTargetPackage }; // shared fold context for foldSubPage (child/typed/mini)
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
  // The step-5.1 handoff index — assembled once every scope has folded, so a `behaviourIndex` key can be checked
  // against the WHOLE surface before it is reported as matching nothing.
  const stubIndex = [
    // No schema NAME for this scope on purpose: the engine parses layer BODIES (keyed by package), so the record
    // page's own schema name is not something it knows. `planMeta.sectionSchema` names the SECTION, a different
    // schema — putting it here would label record-page rows with the list page's name.
    stubScope("main page", opts.scopeSchema || null, changeSet, changeSet.standardMethodsFiltered),
    ...(miniPage?.stubScope ? [miniPage.stubScope] : []),
    ...typedPages.flatMap((t) => [...(t.stubScope ? [t.stubScope] : []), ...(t.childStubScopes || [])]),
    ...childPages.flatMap((c) => [...(c.stubScope ? [c.stubScope] : []), ...(c.childStubScopes || [])]),
  ];
  // Only the ROOT run can judge this. A folded scope sees one page's rows, so every answer belonging to a sibling
  // page would look unmatched there — reporting it per sub-run would turn a correct handoff into a wall of noise.
  behaviourIndex.unmatched = opts.scopeSchema ? [] : unmatchedIndexKeys(behaviourIndexInput, stubIndex);
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
  // ⛔ COVERAGE — the MEMBER LEDGER and its gate. Every other category in this engine is gated (seed,
  // detailSchemas, childPageSchemas, typedPages, addRecordMiniPage, signals, planMeta); imperative logic was the
  // one category with neither a gate nor a worklist entry, so a page could ship with its methods, its
  // imperatively filtered lookups, its sandbox contract and its mixins entirely unaccounted for — and both gates
  // stayed green. This makes "no member silently ignored" a machine check instead of a rule in prose.
  const coverage = buildCoverage({ eff, changeSet, manifest, childCoverage: [
    ...childPages.map((c) => ({ role: "child page", label: c.resolvedFrom || c.editPage || c.entity, coverage: c.childCoverage })),
    ...typedPages.map((t) => ({ role: "typed page", label: t.schema, coverage: t.coverage })),
    ...(miniPage ? [{ role: "add mini page", label: miniPage.schema, coverage: miniPage.coverage }] : []),
  ] });
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
    coverage,    // ⛔ complete:false ⇒ a schema MEMBER is unaccounted (no artifact, no decision); rows[] = the ledger
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
      // Imperative members, now reported alongside the structural ones. `methods` and `attributes` were both
      // absent from this block, so a reader of the JSON could not even see HOW MANY there were — which is why
      // "the plan mentions no attributes" and "the page has no attributes" were indistinguishable.
      methods: eff.methods.length, attributes: (eff.attributes || []).length,
      messages: (eff.messages || []).length, mixins: (eff.mixins || []).length,
      moduleDeps: (eff.moduleDeps || []).length,
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
    // The step-5.1 handoff, both legs. `stubIndex` is what goes OUT to the behaviour-analysis run (`--stubs`);
    // `behaviourIndex` records what came BACK and was folded in — including keys that matched no row.
    stubIndex,
    behaviourIndex,
  };
  // Generated artifacts the agent presents VERBATIM (it only ever paraphrased when left to author them):
  //   designSpec = the design spec alone (## Design spec — Layout/Section/Logic/Confirm)
  //   plan       = the WHOLE plan skeleton (Overview/Pages placeholders + the design spec + child pages)
  // planMeta / on-stand SIGNALS completeness — both computed by `checklistOpts` (above the fold, since every
  // sub-page needs the same object) and mirrored onto the result here, where the CLI gates read them.
  out.planMetaMissing = specOpts.planMetaMissing;
  out.signals = specOpts.signals;
  out.signalsMissing = specOpts.signalsMissing;
  // The PLAN VERSION. Set BEFORE `renderPlan`/`pageUnits` can read it — both take it off the result.
  out.planVersion = computePlanVersion(manifest, bodyOf);
  out.designSpec = renderDesignSpec(out, specOpts);
  out.plan = renderPlan(out, specOpts);
  out.checklist = renderChecklist(out, specOpts); // the post-implementation Plan-vs-Done control table (CLI --checklist)
  return out;
}

// ⛔ THE `--built` PAYLOAD GUARD (D6) — this is what makes the verify gate real. `--verify` now reads a KEYED MAP
// over the page tree, each entry carrying clio `get-page`'s `bundle.viewConfig` verbatim; the engine walks that
// tree itself. Without this guard a hand-authored `{ "ops": [...] }` (or a hand-written count) reached
// `complete: true` having built nothing — the executor would author the very evidence it is being gated on. The
// shape is REJECTED at exit 1, not silently degraded, and the message points at `--units` because that is where
// the exact page keys come from. `false` = genuinely absent (a hard MISSING); an OMITTED key = not checked
// (unverified) — so this only checks the entries that ARE present.
const BUILT_SHAPE = '{ "pages": { "main": { "viewConfig": <get-page bundle.viewConfig>, "packageName": "…", "parentSchemaName": "…" }, "child:<Entity>": false }, "reachability": { "sectionRegistered": true, … }, "evidence": { "<id>": {…} }, "judge": { "<id>": { "convincing": true } } }';
function validBuiltPageEntry(e) {
  if (e === false) return true; // genuinely absent — a hard MISSING, not a malformed entry
  return !!e && typeof e === "object" && !Array.isArray(e) && e.viewConfig != null;
}
function builtPayloadIssue(built) {
  if (!built || typeof built !== "object" || Array.isArray(built)) return "is not a JSON object";
  if (!built.pages || typeof built.pages !== "object" || Array.isArray(built.pages)) return "has no `pages` object — the flat single-page shape is no longer accepted";
  const bad = Object.keys(built.pages).filter((k) => !validBuiltPageEntry(built.pages[k]));
  if (bad.length) {
    const more = bad.length > 5 ? `, …and ${bad.length - 5} more` : "";
    return `has ${bad.length} page entr${bad.length === 1 ? "y" : "ies"} that ${bad.length === 1 ? "is" : "are"} neither \`false\` nor an object carrying \`viewConfig\`: ${bad.slice(0, 5).join(", ")}${more}`;
  }
  return provenanceIssue(built.pages);
}

// PROVENANCE. The shape check above proves the payload is well-formed; it does not prove it came from the stand.
// A payload synthesised from `--units` output alone used to reach exit 0 with no Creatio contact at all, because
// everything it needed was published in the plan. These identifiers are NOT: `--units` publishes no GUID of any
// kind, so `schemaUId` / `packageUId` can only come from a real `get-page` — and they have to agree with each
// other across the whole payload, which a fabricated set will not do by accident:
//   - one page is one schema  -> `schemaUId` is UNIQUE across keys (the same page pasted under two keys is the
//     cheapest way to fake a second built page, and this is what catches it);
//   - one package is one UId  -> every entry claiming the same `packageName` must carry the same `packageUId`.
// BE HONEST ABOUT WHAT THIS IS: it proves INTERNAL CONSISTENCY, not origin. The engine runs offline and cannot
// ask Creatio whether a GUID exists. It raises the cost of a fabricated report from "copy the numbers the plan
// already told you" to "invent a coherent identity graph", and it makes a careless copy-paste fail outright.
// It is not a defence against a determined author, and nothing here should be described as one.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function missingUidIssue(entries) {
  const noUid = entries.filter(([, e]) => !GUID_RE.test(String(e.schemaUId ?? "")));
  if (!noUid.length) return null;
  return `has ${noUid.length} page entr${noUid.length === 1 ? "y" : "ies"} with no valid \`schemaUId\`: ${noUid.map(([k]) => k).slice(0, 5).join(", ")}. Copy it VERBATIM from clio \`get-page\` (\`page.schemaUId\`) — \`--units\` publishes no GUIDs, so this is what shows the page was actually read off the stand`;
}
function duplicateUidIssue(entries) {
  const byUid = new Map();
  for (const [k, e] of entries) {
    const u = String(e.schemaUId).toLowerCase();
    if (byUid.has(u)) return `claims the SAME \`schemaUId\` ${u} for two different page keys (\`${byUid.get(u)}\` and \`${k}\`) — one schema cannot be two pages; re-read each page with \`get-page\``;
    byUid.set(u, k);
  }
  return null;
}
function packageUidIssue(entries) {
  const byPkg = new Map();
  for (const [k, e] of entries) {
    if (!e.packageName || !e.packageUId) continue;   // packageUId stays optional; when present it must agree
    const prev = byPkg.get(e.packageName);
    if (prev && prev.uid.toLowerCase() !== String(e.packageUId).toLowerCase())
      return `gives package \`${e.packageName}\` two different \`packageUId\` values (\`${k}\` vs \`${prev.key}\`) — one package has one UId; re-read both pages with \`get-page\``;
    if (!prev) byPkg.set(e.packageName, { uid: String(e.packageUId), key: k });
  }
  return null;
}
// Three independent checks, each its own function so this one stays a flat sequence (Sonar CC 15).
function provenanceIssue(pages) {
  const entries = Object.entries(pages).filter(([, e]) => e && e !== false && typeof e === "object");
  return missingUidIssue(entries) || duplicateUidIssue(entries) || packageUidIssue(entries);
}

// The flags that take a VALUE, in ONE list — because each of them has TWO obligations and forgetting either is a
// silent misfire: the value must be a real path (a trailing `--out` fell back to stdout on a documented write, and
// `--out --plan` swallowed the next flag), and the value must be excluded from the positional-manifest search
// (otherwise the OUTPUT path is read as the manifest and the run dies on a misleading JSON error). MODE flags
// (`--plan`, `--units`, `--verify`, …) take no value and belong in NEITHER list.
const VALUE_FLAGS = new Set(["--out", "--built", "--verify-json"]);
// The value of a value-taking flag, or `null` when the flag is absent. `onBad` (the CLI's `fail`) is called with a
// diagnosable message when the flag is there but its value is missing or is itself a flag. Own fn so each new
// value flag reuses the guard instead of re-implementing it (and so the CLI block does not grow another branch).
function valueFlagArg(argv, flag, example, onBad) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    const got = next === undefined ? "no argument" : `the flag '${next}'`;
    onBad(`\`${flag}\` needs a file path (e.g. \`${example}\`) — got ${got}; nothing was written`);
  }
  return next;
}

// The stdout note that goes with `--out`. MODE-AWARE, because "incomplete" means two opposite things.
//
// For `--plan` (and `--spec`/`--checklist`/`--units`) an incomplete run produces an artifact that is NOT
// approvable — it carries a ⛔ banner and describes a plan that is not ready — so the instruction is: do not
// present it, fix the ⛔ items, re-run. That was the only wording this note had.
//
// For `--verify` it is the opposite. The table IS the report of what is still short: it names every unmet row,
// it is the only sanctioned close report, and the executor skill tells the agent to present it precisely when
// the run is incomplete. Telling the agent not to present it left the CLI and the skill contradicting each
// other on the same file, with the agent free to pick either. Own fn (not another inline branch) for the same
// reason `valueFlagArg` is one: the CLI block does not grow a branch every time a case is added.
function outFileNote(label, outFile, notReady, verifyMode) {
  if (!notReady) return `migrate.mjs: wrote ${label} to ${outFile} — present that file verbatim.\n`;
  if (verifyMode) {
    return `migrate.mjs: wrote ${label} to ${outFile} — this run is INCOMPLETE, and that is what the table reports: PRESENT IT VERBATIM (it names every ❌ MISSING and ⚠ unverified row). Do not hand-write a status summary of your own, and do not treat the file as an approvable plan — read the ⛔ stderr line(s) below to tell a repairable build gap from a PLAN-level one.\n`;
  }
  return `migrate.mjs: wrote ${label} to ${outFile}, but ⛔ this run is BLOCKED/INCOMPLETE — do NOT build or present it; fix the ⛔ items at the top of the file and re-run.\n`;
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
  const stubsMode = argv.includes("--stubs"); // print ONLY the step-5.1 handoff digest (imperative rows per scope)
  const unitsMode = argv.includes("--units"); // print the per-page BUILD QUEUE + the exact keys `--built` must use
  const verifyMode = argv.includes("--verify"); // VERIFY the built page against expected deliverables (needs --built)
  // `--built <file>`: the per-page map of clio `get-page`'s `bundle.viewConfig` (the MERGED page). NOT
  // `ownBodySummary` — an element the TEMPLATE provides carries no `type` there, so that source reads ❌ MISSING
  // on a correctly built page. The fail string three lines below says the same thing; this comment used to say
  // the opposite, which is exactly the kind of drift that gets a payload hand-built from the wrong source.
  const builtIdx = argv.indexOf("--built");
  if (verifyMode && (builtIdx < 0 || argv[builtIdx + 1] === undefined || argv[builtIdx + 1].startsWith("--")))
    fail("`--verify` needs `--built <file>` — a JSON KEYED BY PAGE: " + BUILT_SHAPE + ". Run `--units` on this manifest for the exact page keys, and give each one clio `get-page`'s `bundle.viewConfig` VERBATIM (the merged page — not the page's own body, which cannot show template-provided components).");
  const builtFile = builtIdx >= 0 ? argv[builtIdx + 1] : null;
  // `--out <file>`: WRITE the output to a file so the agent presents the file, not a hand-paste.
  const outFile = valueFlagArg(argv, "--out", "--out plan.md", fail);
  // `--verify-json <file>` — the MACHINE-READABLE verdict, alongside (never instead of) the Markdown table. The
  // executor's whole open/closed scheduling used to rest on an agent transcribing that table: it carries no
  // per-page counts, and the only per-page numbers anywhere were on the stderr line, truncated at six pages.
  // It REQUIRES `--verify`: in any other mode there is no verdict to write, and silently ignoring the flag would
  // leave a caller believing it had a verdict file it never got.
  const verifyJsonFile = valueFlagArg(argv, "--verify-json", "--verify-json verify.json", fail);
  if (verifyJsonFile && !verifyMode)
    fail("`--verify-json <file>` only applies to `--verify` — it writes THAT run's machine-readable verdict. Add `--verify --built <file>`, or drop `--verify-json`.");
  const arg = argv.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1])); // positional manifest arg ('-' = stdin)
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
  let output, verifyIncomplete = false, verifyRes = null;
  if (planMode) output = result.plan + "\n";
  else if (specMode) output = result.designSpec + "\n";
  else if (checklistMode) output = result.checklist + "\n";
  // `--stubs` ⇒ ONLY the handoff digest. Deliberately a separate artifact from the full result JSON: this is the
  // payload a behaviour-analysis run receives, and the full JSON carries megabytes of schema bodies and rendered
  // Markdown it has no use for. The correctness gates still apply — a broken merge produces unreliable rows, so a
  // digest taken from a blocked run must not read as a clean handoff.
  else if (stubsMode) {
    output = JSON.stringify({
      entity: result.entity,
      // The SECTION schema, when the agent supplied it — the surface label a handoff prompt needs. It is not the
      // record page's name (see stubIndex): it identifies which surface these scopes belong to.
      sectionSchema: manifest.planMeta?.sectionSchema || null,
      totals: {
        scopes: result.stubIndex.length,
        stubs: result.stubIndex.reduce((n, s) => n + s.counts.stubs, 0),
        unresolvedTrigger: result.stubIndex.reduce((n, s) => n + s.counts.unresolvedTrigger, 0),
        externalRef: result.stubIndex.reduce((n, s) => n + s.counts.externalRef, 0),
      },
      scopes: result.stubIndex,
    }, null, 2) + "\n";
  }
  // `--units` ⇒ the BUILD QUEUE (JSON): one entry per page key with what that page expects, the reachability keys
  // with their applicability already decided, the evidence ids, and a leaf-first build order. It is the executor's
  // input AND the only place the keys of `--built.pages` / `.evidence` / `.judge` come from — an invented key is
  // silently "not checked", so nothing here may be guessed. Takes NO value (a MODE flag, like `--plan`), and is
  // therefore deliberately absent from the positional-argument exclusion above: adding it there would make
  // `--units <manifest>` lose its manifest and die with a misleading JSON error.
  else if (unitsMode) output = JSON.stringify(pageUnits(result, checklistOpts(manifest)), null, 2) + "\n";
  else if (verifyMode) {
    let built; try { built = JSON.parse(fs.readFileSync(builtFile, "utf8")); }
    catch (e) { fail(`cannot read --built '${builtFile}': ${e.message}`); }
    // VALIDATE BEFORE RENDERING: `renderVerify` is called outside the try above, so a throw inside it surfaces as a
    // raw Node stack instead of a diagnosable message — and a malformed payload must be a loud exit 1, never a
    // table full of ⚠ rows that reads like a half-built page.
    const issue = builtPayloadIssue(built);
    if (issue) fail(`--built '${builtFile}' ${issue}. Expected ` + BUILT_SHAPE + ". Run `--units` on this manifest for the exact page keys.");
    // The SAME opts object `--checklist` renders with (checklistOpts): the two must produce the same row set, and
    // a thinner verify-only literal made that a coincidence rather than a guarantee.
    verifyRes = renderVerify(result, checklistOpts(manifest), built);
    output = verifyRes.markdown + "\n";
    verifyIncomplete = !verifyRes.complete; // any MISSING or unverified deliverable ⇒ not done (ONE source of truth)
    // The machine-readable verdict, written from the SAME object the table was rendered from — so the numbers a
    // caller schedules on and the numbers a human reads cannot disagree. Uncapped: every open page is in `pages`.
    if (verifyJsonFile) {
      try { fs.writeFileSync(verifyJsonFile, JSON.stringify(verifyReport(result, verifyRes), null, 2) + "\n"); }
      catch (e) { fail(`cannot write --verify-json '${verifyJsonFile}': ${e.message}`); }
      // stderr, not stdout: stdout is the artifact itself when there is no `--out`, and a note there would end up
      // inside the table the agent presents verbatim.
      process.stderr.write(`migrate.mjs: wrote the machine-readable verdict to ${verifyJsonFile} — schedule from THAT file (complete / missing / unverified / planGaps / pages[key].openRows), not from the table.\n`);
    }
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
  // ⛔ COVERAGE — a schema member with no artifact and no decision. Gated exactly like the other completeness
  // checks: an unaccounted member means the plan claims a coverage it does not have.
  const coverageBad = result.coverage && !result.coverage.complete;
  const notReady = gateBad || structBad || planIncomplete || coverageBad || verifyIncomplete;
  let label = "result";
  if (planMode) label = "plan";
  else if (specMode) label = "design spec";
  else if (checklistMode) label = "checklist";
  else if (stubsMode) label = "imperative-row handoff digest";
  else if (unitsMode) label = "per-page build queue";
  else if (verifyMode) label = "verification";
  if (outFile) {
    // engine WRITES the artifact (Smell #2): the agent presents this file verbatim instead of hand-pasting stdout.
    try { fs.writeFileSync(outFile, output); }
    catch (e) { fail(`cannot write --out '${outFile}': ${e.message}`); }
    process.stdout.write(outFileNote(label, outFile, notReady, verifyMode));
  } else {
    process.stdout.write(output);
  }
  if (gateBad) process.stderr.write("migrate.mjs: ⛔ GATE BLOCKED — do NOT build. " + result.gate.reasons.join(" | ") + "\n");
  if (structBad) process.stderr.write("migrate.mjs: ⛔ STRUCTURE INCOMPLETE — plan not ready. " + result.structure.issues.join(" | ") + "\n");
  if (coverageBad) process.stderr.write(`migrate.mjs: ⛔ COVERAGE INCOMPLETE — ${result.coverage.issues.length} schema member(s) unaccounted (no Freedom artifact, no decision). ` + result.coverage.issues.slice(0, 5).join(" | ") + (result.coverage.issues.length > 5 ? ` | …and ${result.coverage.issues.length - 5} more (see result.coverage.issues)` : "") + "\n");
  // D12 — the `--verify` leg of exit 2, stated apart from the three above. `gate`/`structure`/`coverage` fire in
  // EVERY mode and describe the PLAN: an executor cannot build its way out of them, so "loop until --verify is
  // green" against one of those never converges. THIS line is the other condition — MY BUILD is short — and it IS
  // repairable on-stand. Until now `--verify` exited 2 with no stderr line at all, so the two were indistinguishable.
  if (verifyIncomplete) {
    const pageGaps = Object.entries(verifyRes.pages).filter(([, p]) => !p.complete)
      .map(([k, p]) => `${k}: ${p.missing} missing / ${p.unverified} unconfirmed`);
    // The six-page truncation is a READABILITY limit on this human line only. The full, uncapped per-page verdict
    // — every open page, with its open rows — is what `--verify-json` writes; nothing machine-readable is capped.
    let overflow = "";
    if (pageGaps.length > 6) {
      const where = verifyJsonFile ? `all of them in ${verifyJsonFile}` : "re-run with `--verify-json <file>` for the full, uncapped per-page verdict";
      overflow = ` | …and ${pageGaps.length - 6} more (${where})`;
    }
    process.stderr.write(`migrate.mjs: ⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete: ${verifyRes.missing} MISSING + ${verifyRes.unverified} unconfirmed deliverable(s) across ${pageGaps.length} page(s). ${pageGaps.slice(0, 6).join(" | ")}${overflow}. This is repairable: build the missing pieces / file the on-stand evidence, then re-verify.\n`);
    const gaps = planGaps(result);
    if (gaps.length) process.stderr.write(`migrate.mjs: ℹ this run ALSO has PLAN-level gaps (${gaps.join(" · ")}) — those are NOT buildable-out-of; return them to the caller instead of re-verifying against them.\n`);
  }
  if (planMode && result.planMetaMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — required planMeta unfilled: " + result.planMetaMissing.join(", ") + ". Add to manifest.planMeta and re-run.\n");
  if (planMode && result.signalsMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — on-stand signals not resolved: " + result.signalsMissing.join(", ") + ". Run the DCM/process/printable checks and add manifest.signals (each { resolved:true, present:<bool> }), then re-run.\n");
  if (result.parseDiagnostics?.length)
    process.stderr.write(`migrate.mjs: ℹ ${result.parseDiagnostics.length} parse diagnostic(s) — constructs not statically resolved (advisory, see result.parseDiagnostics)\n`);
  if (notReady) process.exit(2);
}
