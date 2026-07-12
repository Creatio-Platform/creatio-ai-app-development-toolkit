// engine/migrate.mjs — the CLI driver the SKILL invokes.
//
// Turns the raw Classic layer bodies (fetched via clio: list-schema-layers → get-classic-schema, or the
// manual fallback) into one effective Classic page and a Freedom ChangeSet + needsDecision[]. This is the
// deterministic 80% the skill used to ask the agent to do by hand (enumerate chain → merge diff/details/
// businessRules by eye). A thin I/O wrapper over engine.mjs (mergeLayers) + mapper.mjs (mapToFreedom); the
// golden runners (run.mjs / run-mapper.mjs) remain the regression gate for the logic itself.
//
// Manifest shape (JSON):
//   {
//     "entity": "Case",                       // optional; else inferred from the layers
//     "entityColumns": { "Col": "Lookup", … },// optional; from describe-entity — sharpens control choice
//     "layers": [ { "pkg": "Case", "body": "<define(...) source>" } | { "pkg": "Case", "file": "..." }, … ],
//     "seed":   [ { "pkg": "BaseModulePageV2/CrtUIPlatform7x", "body"|"file": … }, … ],  // parent template chain
//     "clientEditableLayers": ["WorkOverride", …]   // optional; drives B6 removal confidence
//   }
// Prefer inline "body" (paste the clio get-classic-schema output) over "file" to avoid path fragility.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseLayer, mergeLayers } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";

// Pure core — no process/argv, so it is unit-testable and the golden runner can call it directly.
export function runMigration(manifest, opts = {}) {
  const baseDir = opts.baseDir || ".";
  const bodyOf = (e) => (e.body != null ? String(e.body) : fs.readFileSync(path.resolve(baseDir, e.file), "utf8"));
  const parse = (list) => (Array.isArray(list) ? list : []).map((e) => parseLayer(bodyOf(e), e.pkg));
  const layers = parse(manifest.layers);
  const seedLayers = parse(manifest.seed);
  const eff = mergeLayers(layers, { seedLayers });
  const changeSet = mapToFreedom(eff, {
    entityColumns: manifest.entityColumns || {},
    clientEditableLayers: manifest.clientEditableLayers || [],
  });
  const parseErrors = [...layers, ...seedLayers].filter((l) => l.error).map((l) => ({ pkg: l.pkg, error: l.error }));
  const decisionSummary = {};
  for (const d of changeSet.needsDecision) decisionSummary[d.kind] = (decisionSummary[d.kind] || 0) + 1;
  return {
    entity: manifest.entity && manifest.entity !== "?" ? manifest.entity : eff.entity,
    parseErrors, // non-empty ⇒ a layer body failed to parse: FIX before trusting the ChangeSet
    // effective Classic page (the merged 80%) — headline counts + the diagnostics that gate correctness
    effective: {
      fields: eff.fields.length, tabs: eff.tabs.length, details: eff.details.length,
      rules: eff.rules.length, removed: eff.removed.length,
      warnings: eff.warnings,                 // op hit a missing item ⇒ layer order (F1) / seed (F2) wrong
      unresolvedParents: eff.unresolvedParents, // non-empty ⇒ base template not fully seeded (F2)
      features: eff.features,                 // feature toggles gating runtime visibility (union, not one state)
      referencedModules: eff.referencedModules, // UI-rendering deps outside the page-schema migration unit
    },
    decisionSummary, // needsDecision counts by kind — the agent's 20% worklist, at a glance
    changeSet,       // full Freedom ChangeSet: viewConfigDiff / *ConfigDiff / rules / details / needsDecision / …
  };
}

// CLI: node migrate.mjs <manifest.json>   (or `-` / no arg to read the manifest from stdin)
// stdout = the result JSON (parseable); nothing else is written to stdout.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  const fromFile = arg && arg !== "-";
  const raw = fromFile ? fs.readFileSync(arg, "utf8") : fs.readFileSync(0, "utf8");
  const manifest = JSON.parse(raw);
  const baseDir = fromFile ? path.dirname(path.resolve(arg)) : process.cwd();
  process.stdout.write(JSON.stringify(runMigration(manifest, { baseDir }), null, 2) + "\n");
}
