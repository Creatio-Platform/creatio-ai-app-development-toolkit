// engine/migrate.mjs — the CLI driver the SKILL invokes.
//
// Turns the raw Classic schema bodies (fetched via clio: list-schema-hierarchy → get-classic-schema-by-uid, or the
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
// Prefer inline "body" (paste the clio get-classic-schema-by-uid output) over "file" to avoid path fragility.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSchema, mergeHierarchy } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";
import { renderDesignSpec, renderPlan } from "./designspec.mjs";

// Pure core — no process/argv, so it is unit-testable and the golden runner can call it directly.
export function runMigration(manifest, opts = {}) {
  const baseDir = opts.baseDir || ".";
  const bodyOf = (e) => (e.body != null ? String(e.body) : fs.readFileSync(path.resolve(baseDir, e.file), "utf8"));
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
    detailSchemas[name] = {
      entity: eObj.entity || (p.entitySchemaName && p.entitySchemaName !== "?" ? p.entitySchemaName : null),
      columns: [...new Set((p.diff || []).filter((d) => d.bindTo).map((d) => d.bindTo))],
      title: eObj.title || null, // human detail title (from its resources)
      // editPage: explicit manifest value WINS — a string names the child edit page; `false` = the agent verified
      // on-stand that NO Classic *Page exists. Else the name from getEditPageName; else null = unverified.
      editPage: ("editPage" in eObj) ? eObj.editPage : (epM ? epM[1] : null),
      // editable: explicit manifest value WINS (false = verified view/attach-only); else the body heuristic; else null.
      editable: ("editable" in eObj) ? eObj.editable : (viewOnly ? false : null),
      error: p.error || null,
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
    ...[...schemas, ...seedTemplate, ...sectionSchemas].filter((l) => l.error).map((l) => ({ pkg: l.pkg, error: l.error })),
    // Major 3: a detail-schema body that FAILED to parse must reach the gate too — otherwise its columns/child
    // page silently resolve to null while the plan stays green. Its error was captured per-detail above.
    ...Object.entries(detailSchemas).filter(([, d]) => d.error).map(([name, d]) => ({ pkg: `detail:${name}`, error: d.error })),
  ];
  // fail-loud parse diagnostics: constructs the AST parser could not statically resolve (dynamic call /
  // conditional / spread / unresolved identifier). Advisory, NOT blocking — surfaced so battle-testing can
  // spot bodies the static evaluator does not yet cover. Tagged with the owning schema pkg.
  const parseDiagnostics = [...schemas, ...seedTemplate, ...sectionSchemas]
    .flatMap((l) => (l.astDiagnostics || []).map((d) => ({ pkg: l.pkg, ...d })));
  // section analysis — union the signals across the section schema chain (last-wins for the mini page).
  const section = sectionSchemas.length ? {
    addRecordMiniPage: sectionSchemas.map((l) => l.addRecordMiniPage).filter((v) => v != null).pop() ?? null,
    sectionActions: [...new Set(sectionSchemas.flatMap((l) => l.sectionActions || []))],
    listColumns: [...new Set(sectionSchemas.flatMap((l) => l.listColumns || []))],
    processLaunch: sectionSchemas.some((l) => l.processLaunch),
    processNames: [...new Set(sectionSchemas.flatMap((l) => l.processLaunch?.names || []))],
  } : null;
  // child pages (recursion): each CUSTOM detail's related list opens the child entity's edit form on
  // add/edit — a separate migration. Enumerate them so the plan is a tree (parent + one sub-plan each).
  const childPages = (changeSet.details || []).map((d) => ({
    entity: d.entity || null,
    via: d.caption || d.detailSchema || d.entity,
    // preserve an explicit `false` (agent verified: no page) — `|| null` would swallow it into "unverified".
    editPage: detailSchemas[d.detailSchema] ? (detailSchemas[d.detailSchema].editPage ?? null) : null,
    editable: detailSchemas[d.detailSchema] ? detailSchemas[d.detailSchema].editable : null,
  })).filter((c) => c.entity);
  // RECURSION — if the agent supplied a child edit-page's own schema (keyed by its editPage name or child
  // entity), map it here so its FULL design spec is nested in the plan, not just listed. This is the tree:
  // parent page + one real sub-mapping per related list. Depth-capped (parent 0 → child 1 → grandchild 2)
  // so a self/cyclic reference can't run away; deeper levels stay listed rows to be resolved by the agent.
  const depth = opts.depth || 0;
  const childSchemas = manifest.childPageSchemas || {};
  for (const c of childPages) {
    if (depth >= 2) break;
    const key = [c.editPage, c.entity, c.entity && c.entity + "Page"].find((k) => k && childSchemas[k]);
    if (!key) continue;
    try {
      const childRes = runMigration(childSchemas[key], { baseDir, depth: depth + 1 });
      c.spec = childRes.designSpec;              // the child page's Layout/Section/Logic/Confirm — the mapping
      c.mappedEntity = childRes.entity;
      c.resolvedFrom = key;
      c.grandChildren = (childRes.childPages || []).length;
      // Major 3: a nested child's spec is a VALID mapping only if the child cleared its OWN gates. Carry the
      // child's verdict up so a blocked/incomplete child can't be embedded into a green parent plan at exit 0.
      c.childBlocked = !!(childRes.gate && childRes.gate.blocked);
      c.childReasons = (childRes.gate && childRes.gate.reasons) || [];
      c.childStructIncomplete = !!(childRes.structure && !childRes.structure.complete);
    } catch (e) { c.specError = e.message; }     // malformed child manifest ⇒ note it, keep the listed row
  }
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
    if (eff.seedQuality && eff.seedQuality.looksSkeletal) reasons.push("seedQuality.looksSkeletal — the seed is a hand-typed skeleton, not a real fetched parent-template body (#19)");
    // Blocker 1: an unresolved construct AT a structural key (the WHOLE diff/details/… couldn't be statically
    // resolved — e.g. built via an unresolved variable or a call) yields an EMPTY effective page that would
    // otherwise pass clean. Block it. Deep leaves (a dynamic caption at `diff.N.values.caption`) stay advisory
    // — the field itself resolved; only a diagnostic ON the structural key blocks.
    const STRUCTURAL_KEYS = new Set(["diff", "details", "businessRules", "rules", "modules", "entitySchemaName"]);
    const structDiag = parseDiagnostics.filter((d) => STRUCTURAL_KEYS.has(d.path));
    if (structDiag.length) reasons.push(`parse could not statically resolve structural field(s): ${[...new Set(structDiag.map((d) => `${d.path} (${d.kind})`))].join(", ")} — the effective page may be INCOMPLETE (diff/details built via an unresolved variable or call). Fix the body/seed so it resolves; do NOT build from a possibly-empty page`);
    // Major 3: aggregate child gates — a nested child that failed its OWN correctness gate blocks the parent.
    const blockedChildren = childPages.filter((c) => c.childBlocked);
    if (blockedChildren.length) reasons.push(`nested child page(s) failed their own gate: ${blockedChildren.map((c) => `${c.resolvedFrom || c.editPage} [${(c.childReasons || []).join("; ").slice(0, 90)}]`).join(" | ")} — a blocked child's spec is not a valid mapping; fix the child before the parent plan is approvable`);
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
      if (d.detailSchema && !suppliedDetailKeys.has(d.detailSchema))
        issues.push(`detail '${d.detailSchema}'${d.entity ? ` (${d.entity})` : ""}: fetch its schema into manifest.detailSchemas — columns and child edit page unresolved`);
    }
    for (const c of childPages) {
      // Major 3: a child that WAS mapped but whose own structure is incomplete (its nested detail/child
      // schemas were not supplied) is not "done" — the tree is incomplete. Surface it (recursive aggregation).
      if (c.spec) { if (c.childStructIncomplete) issues.push(`child page '${c.resolvedFrom || c.editPage}' (${c.entity}) was mapped but its OWN structure is incomplete — supply its nested detail/child-page schemas; there is no "out of scope"`); continue; }
      if (c.editPage === false || c.editable === false) continue; // verified no page, or view/attach-only from this detail -> fine
      if (typeof c.editPage === "string" && c.editPage)
        // a child whose detail names a REAL Classic edit page, but no childPageSchemas mapping was supplied
        issues.push(`child page '${c.editPage}' (${c.entity}, opened by detail "${c.via}"): a REAL Classic edit page is NOT mapped — add its schema to manifest.childPageSchemas. There is no "out of scope".`);
      else
        // unverified: we do not yet know whether the child entity has a Classic *Page — resolve before the plan.
        issues.push(`child '${c.entity}' (opened by detail "${c.via}"): child page NOT verified — run list-pages by the CHILD entity, then either add its edit page to manifest.childPageSchemas, or record "editPage": false on this detail if no *Page exists. No self-declared "out of scope".`);
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
      fields: (changeSet.viewConfigDiff || []).filter((o) => o.values && o.values.control).length,
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
    section,         // section-schema analysis (list page): add-record mini page, section actions, columns
    childPages,      // custom-detail child entities whose edit page is a recursive sub-migration
  };
  // Generated artifacts the agent presents VERBATIM (it only ever paraphrased when left to author them):
  //   designSpec = the design spec alone (## Design spec — Layout/Section/Logic/Confirm)
  //   plan       = the WHOLE plan skeleton (Overview/Pages placeholders + the design spec + child pages)
  const specOpts = { template: manifest.template, targetPackage: manifest.targetPackage, planMeta: manifest.planMeta };
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
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;
  const arg = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out"); // positional manifest arg ('-' = stdin)
  const fromFile = !!arg && arg !== "-";
  let raw;
  try { raw = fromFile ? fs.readFileSync(arg, "utf8") : fs.readFileSync(0, "utf8"); }
  catch (e) { fail(`cannot read manifest ${fromFile ? `'${arg}'` : "from stdin"}: ${e.message}`); }
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
  const gateBad = result.gate && result.gate.blocked;
  const structBad = result.structure && !result.structure.complete;
  const label = planMode ? "plan" : specMode ? "design spec" : "result";
  if (outFile) {
    // engine WRITES the artifact (Smell #2): the agent presents this file verbatim instead of hand-pasting stdout.
    try { fs.writeFileSync(outFile, output); }
    catch (e) { fail(`cannot write --out '${outFile}': ${e.message}`); }
    // do NOT say "present verbatim" on a blocked/incomplete run (L3): the file carries a ⛔ banner and is not approvable.
    process.stdout.write(gateBad || structBad
      ? `migrate.mjs: wrote ${label} to ${outFile}, but ⛔ this run is BLOCKED/INCOMPLETE — do NOT build or present it; fix the ⛔ items at the top of the file and re-run.\n`
      : `migrate.mjs: wrote ${label} to ${outFile} — present that file verbatim.\n`);
  } else {
    process.stdout.write(output);
  }
  if (gateBad) process.stderr.write("migrate.mjs: ⛔ GATE BLOCKED — do NOT build. " + result.gate.reasons.join(" | ") + "\n");
  if (structBad) process.stderr.write("migrate.mjs: ⛔ STRUCTURE INCOMPLETE — plan not ready. " + result.structure.issues.join(" | ") + "\n");
  if (result.parseDiagnostics && result.parseDiagnostics.length)
    process.stderr.write(`migrate.mjs: ℹ ${result.parseDiagnostics.length} parse diagnostic(s) — constructs not statically resolved (advisory, see result.parseDiagnostics)\n`);
  if (gateBad || structBad) process.exit(2);
}
