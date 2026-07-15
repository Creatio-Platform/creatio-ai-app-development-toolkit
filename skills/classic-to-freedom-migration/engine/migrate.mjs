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
//     "entityColumns": { "Col": "Lookup", … },// optional; from describe-entity — sharpens control choice
//     "schemas": [ { "pkg": "Case", "body": "<define(...) source>" } | { "pkg": "Case", "file": "..." }, … ],
//     "seed":   [ { "pkg": "BaseModulePageV2/CrtUIPlatform7x", "body"|"file": … }, … ],  // parent template chain
//     "clientEditableSchemas": ["WorkOverride", …], // optional; drives B6 removal confidence
//     "resources": { "SomeTabCaption": "Localized text", … }, // optional; localizable strings → tab/group/detail captions (#5/#13)
//     "columnTitles": { "MobilePhone": "Mobile phone", … }, // optional; entity column titles → field LABELS (#5/#13)
//     "detailSchemas": { "Schema1Detail": "<define(...) body>" | { "body"|"file", "title", "entity" }, … }, // optional; detail body → entity + list columns; title → detail display name (#11ii)
//     "section": [ { "pkg": "HRApplicant/…", "body"|"file": … }, … ], // optional; the *Section chain → add-record mini page, section actions (#8b), list columns (#2)
//     "childPageSchemas": { "<editPage or child entity>": { …a NESTED manifest (schemas/seed/…)… }, … } // optional; each related list's child EDIT PAGE → the engine recursively maps it and nests its design spec in the plan
//   }
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
    detailSchemas[name] = {
      entity: (e && typeof e === "object" && e.entity) || (p.entitySchemaName && p.entitySchemaName !== "?" ? p.entitySchemaName : null),
      columns: [...new Set((p.diff || []).filter((d) => d.bindTo).map((d) => d.bindTo))],
      title: (e && typeof e === "object" && e.title) || null, // human detail title (from its resources)
      editPage: (e && typeof e === "object" && e.editPage) || (epM ? epM[1] : null),
      editable: viewOnly ? false : null, // null = unknown (default add/edit/delete)
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
  const parseErrors = [...schemas, ...seedTemplate, ...sectionSchemas].filter((l) => l.error).map((l) => ({ pkg: l.pkg, error: l.error }));
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
    editPage: detailSchemas[d.detailSchema]?.editPage || null,
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
    } catch (e) { c.specError = e.message; }     // malformed child manifest ⇒ note it, keep the listed row
  }
  const decisionSummary = {};
  for (const d of changeSet.needsDecision) decisionSummary[d.kind] = (decisionSummary[d.kind] || 0) + 1;
  const out = {
    entity: manifest.entity && manifest.entity !== "?" ? manifest.entity : eff.entity,
    parseErrors, // non-empty ⇒ a schema body failed to parse: FIX before trusting the ChangeSet
    // effective Classic page (the merged 80%) — headline counts + the diagnostics that gate correctness
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
  const specOpts = { template: manifest.template, targetPackage: manifest.targetPackage };
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
  const arg = argv.find((a) => a !== "--spec" && a !== "--plan");
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
  process.stdout.write(output);
}
