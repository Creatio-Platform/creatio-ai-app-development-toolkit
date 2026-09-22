// engine/migrate.mjs — the CLI driver the SKILL invokes.
//
// Turns the raw Classic schema bodies (assembled by clio get-classic-page-sources, or the
// manual fallback) into one effective Classic page and a Freedom ChangeSet + needsDecision[]. This is the
// deterministic 80% of the work the skill would otherwise ask the agent to do by hand (enumerate chain → merge diff/details/
// businessRules by eye). A thin I/O wrapper over engine.mjs (mergeHierarchy) + mapper.mjs (mapToFreedom); the
// golden runners (repo-root engine-tests/classic-to-freedom/run.mjs + run-mapper.mjs) are the gate for the logic itself.
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
//        // per-detail CHILD-PAGE resolution (the structure gate accepts exactly these): `"editPage": false` (no Classic *Page exists) ·
//        // `"reuseFreedomPage": "<Freedom form page>"` (the child already ships one) · `"opensClassicPage": "<Classic page>" | true`
//        // + optional `"ownSection": "<Section>"` (the child entity owns ANOTHER SECTION: its Classic card stays
//        // Classic, this related list keeps opening it, the page is NEVER folded and publishes no deliverable)
//     "profileSchemas": { "AccountProfileSchema": "<define(...) body>" | { "body"|"file", "entity" }, … }, // REQUIRED once the page embeds a profile card: the embedded profile schema → profiled entity + the columns the card displayed. Fetch with `get-client-unit-schema --schema-name <SchemaName>`; the structure gate blocks until each recognised card's schema is supplied.
//     "section": [ { "pkg": "HRApplicant/…", "body"|"file": … }, … ], // optional; the *Section chain → add-record mini page, section actions (#8b), list columns (#2)
//     "childPageSchemas": { "<editPage or child entity>": { …a NESTED manifest (schemas/seed/…)… }, … }, // optional; each related list's child EDIT PAGE → the engine recursively maps it and nests its design spec in the plan
//     "planMeta": { scope, environment, package, approach, whatItDoes, sectionSchema, formTemplate }, // optional; fills the plan's Overview/Main-scope so `--plan --out plan.md` writes a COMPLETE plan (no hand-paste). `listTemplate` is NOT supplied — the engine fixes it to ListPageV3Template (see checklistOpts); pass one only to override.
//     "placement": { targetPackageEditable, application, primaryPackage, targetPackageInApplication, sectionHost }, // REQUIRED for `--plan`: can the target APP host the section? See PLACEMENT_KEYS / placementIssues — a writable package is not the same question as a registrable section

//     "behaviourIndex": { "<method>" | "<schema>::<method>" | "<kind>:<name>": { trigger?, from?, card?, ac?: […], bodyCard?, bodyAc?: […], note? }, … } // optional; the step-5.1 behaviour-analysis answers, folded back into the ⚠ Imperative logic / ⚠ Imperative members rows (see applyBehaviourIndex). `bodyCard`/`bodyAc` = the body's own card when it lives in another scope; both are rendered
//   }
// CLI: `--plan`/`--spec`/`--checklist` print the artifact; add `--out <file>` to WRITE it (the agent presents the
// file, not stdout). `--checklist` = the Plan-vs-Done control table, produced AFTER implementation (not in `--plan`).
// THE PLAN VERSION: `--plan` prints `**Plan version:** \`plan-<hash>\`` in its Overview — a deterministic hash over
// `entity` + the `schemas` bodies + `planMeta` and nothing else (never wall-clock, never random, never a filesystem
// path; see computePlanVersion for what is NOT covered), so the same manifest always yields the same version. It is
// what the approval entry in decisions.md names.
// `--stubs` = the step-5.1 handoff digest: the ⚠ Imperative logic rows per scope (method, traced trigger, externalRef,
// line span) plus the standard-method names the worklist excluded — the payload a behaviour-analysis run indexes
// its cards against. Pair it with `manifest.behaviourIndex` to fold that run's answers back into the plan.
// `--verify --built <file>` = the VERIFIED done-gate: diff the ACTUALLY BUILT pages against expected deliverables.
// `--built` is a JSON keyed BY PAGE — `{ pages: { "<page key>": { viewConfig, packageName,
// parentSchemaName } | false }, reachability, evidence, judge }` — where `viewConfig` is clio `get-page`'s
// `bundle.viewConfig` VERBATIM (the MERGED page; the page's own body/ownBodySummary cannot show a
// template-provided component such as Feed or the DCM bar, so a check fed that source reads ❌ on a correct page).
// Exit 2 if any deliverable is MISSING or unverified; a payload that is not keyed by page is exit 1.
// Prefer inline "body" (get-classic-page-sources writes bodies inline into the manifest) over "file" to avoid path fragility.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseSchema, mergeHierarchy, enumDriftIssues } from "./engine.mjs";
import { mapToFreedom, isScaffoldingMethod, buildListChangeSet, isDecorationItem, mapSectionView,
  SECTION_VIEW_METHODS } from "./mapper.mjs";
import { resolveRunIndex, validateRun } from "./mapping-registry.mjs";
import { GATE_KIND, featureVerifyType } from "./mapping-table.mjs";
import { renderDesignSpec, renderPlan, renderChecklist, renderVerify, countFormFields, HANDOFF_MEMBER_KINDS,
  checklistGroups, childTemplateChoice, CHILD_TEMPLATE_SCHEMA, CHILD_PAGE_ANSWERS, reuseChildGroups, unresolvedChildGroups,
  planGaps, isTabOp, IMPERATIVE_MEMBER_KINDS,
  boundaryChild, MEMBER_WORKLIST_KINDS } from "./designspec.mjs";
import { syncTaskDir, syncRepairDir, freezeSplit, startTask, addTasks, DECL_SHAPE, renderProgress,
  REPAIR_ROUND_CAP, TASK_INDEX_FILE, TASK_STATUSES, dispatchAudit, readTaskDir, notBuiltOpenItems,
  readMergedTaskDir, startableTasks, HOLD_DEPS, HOLD_OVERLAP, HOLD_SEQUENCED, HOLD_LEDGER,
  NEXT_LEDGER, NEXT_FINISHED, NEXT_WAITING, NEXT_STUCK,
  applyDecision, revokeDecision, decidedRowKeys,
  REFUSED_UNREADABLE, REFUSED_UNRESOLVED, REFUSED_COVERAGE, REFUSED_CUT, SPLIT_HANDED } from "./tasks.mjs";
import { parseSplit, SPLIT_FILE, SPLIT_SHAPE } from "./split.mjs";
import { readPlan, renderReadPlan, writeReadIndex, writeEvidenceSkeletons, READS_DIR as READS_DIR_NAME } from "./reads.mjs";
import { assembleBuilt, writeBuilt, problemLines, problemBanner, BUILT_FILE, VERIFY_FILE, REPORT_FILE, GUID_RE } from "./assemble.mjs";
import { renderFinalReport, readDecisions } from "./report.mjs";

// The structure issue (if any) a single child page contributes to the STRUCTURE VALIDATOR: a real Classic
// edit page that was not mapped, or a not-yet-verified child, is a gap; a mapped / verified-none / reuse
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
  // THE SECTION BOUNDARY. The child entity owns ANOTHER SECTION, and the user drew that line: on Freedom
  // this related list keeps opening the child's CLASSIC card, which the platform handles, so the child is RESOLVED —
  // not a gap, and not the self-declared skip the rule above forbids (that rule stops an AGENT dropping a child
  // because it looks big or shared; a boundary is the USER's scope decision, recorded in the manifest).
  // This is the resolution that keeps the fold from happening at all (`foldOneChildPage` returns early), so a warning
  // inside a page NOBODY IS MIGRATING must not block the parent's gate — the whole cost of the run this prevents.
  if (boundaryChild(c)) return null;
  if (c.spec) return c.childStructIncomplete
    ? `child page '${c.resolvedFrom || c.editPage}' (${c.entity}) was mapped but its OWN structure is incomplete — supply its nested detail/child-page schemas; there is no "out of scope"`
    : null;
  // A REAL Classic edit page must be mapped REGARDLESS of the add-record button — hiding Add stops NEW records,
  // not editing EXISTING ones, so the edit page still governs the record UI. Checked FIRST, so a hidden-Add
  // heuristic can never waive a real child page.
  if (typeof c.editPage === "string" && c.editPage)
    return `child page '${c.editPage}' (${c.entity}, opened by detail "${c.via}"): a REAL Classic edit page is NOT mapped — add its schema to manifest.childPageSchemas. There is no "out of scope".`;
  if (c.editPage === false) return null;                       // agent verified: no Classic *Page exists
  // `editable: false` is NOT an answer here — it says Add is hidden, not that no page exists, and the rule above
  // only fires once `editPage` is a string, so accepting it would waive an unnamed page. Read-only TAGS the row
  // view/attach-only; the page-existence answer is still owed.
  return `child '${c.entity}' (opened by detail "${c.via}"): child page NOT verified — run \`list-pages\` by the CHILD entity, then ${CHILD_PAGE_ANSWERS}`;
}

// ONE resolve → cycle-check → memo → recurse → cache sequence for folding a nested sub-page (child / typed /
// mini), so the three call sites cannot drift on cycle or memo semantics (a change to one is easy to
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
    // carries no `targetPackage`, so at depth >= 2 the placement row silently vanished and the checklist published
    // `targetPackage: null` for every grandchild. Deliberately NOT part of `extra` (it must not enter the memo key:
    // one run has exactly one target package, so it cannot vary between two folds of the same key).
    // `inheritedSignals` rides along for the same reason and with the same memo rule: the on-stand answers are
    // recorded ONCE on the ROOT manifest, so a child bundle (which has none) would see `{}` and every
    // signal-driven row — the DCM widget gate, and the on-save duplicate check — would silently vanish
    // below the root. Deliberately NOT part of `extra`: a run has exactly ONE signals object, so it cannot vary
    // between two folds of the same key and must not enter the memo key.
    const res = runMigration(schemasMap[key], { baseDir: ctx.baseDir, visited: new Set([...ctx.visited, key]), memo: ctx.memo, memoStats: ctx.memoStats, inheritedBehaviourIndex: ctx.behaviourIndexInput, scopeSchema: key, runTargetPackage: ctx.targetPackage, inheritedSignals: ctx.signals, ...extra });
    if (!res.treeCyclic) ctx.memo.set(memoKey, res); // cache only context-independent (acyclic) subtrees
    return { status: "ok", res };
  } catch (e) { return { status: "error", error: e.message }; }
}

// Pure core — no process/argv, so it is unit-testable and the golden runner can call it directly.
// Does an AST diagnostic sit on a STRUCTURAL position (the whole diff/details/… built via an unresolved var/call
// → an empty effective page) rather than a resolved-leaf (a dynamic caption/tip/visible)? Structural ⇒ the gate
// blocks. Extracted so computeGate stays under Sonar CC 15.
function isStructuralDiag(d) {
  const p = typeof d === "string" ? d : d?.path;
  const kind = typeof d === "string" ? null : d?.kind;
  const STRUCTURAL_ROOTS = new Set(["diff", "details", "businessRules", "rules", "modules", "entitySchemaName"]);
  const IDENTITY_FIELDS = new Set(["operation", "name", "parentName", "propertyName", "bindTo", "itemType", "contentType", "isTab"]);
  // An `unknown-enum-member` miss is ADVISORY wherever it lands, including on an identity field: the body is
  // correct and the ENGINE's pinned table is short a member, so the gate's remedy ("fix the body/seed so it
  // resolves") would be an instruction nobody can act on. The element's kind is known by name and the typed ⚠
  // reports it, so the member is on the plan either way. The hard gate is for structure that is truly unreadable.
  if (kind === "unknown-enum-member") return false;
  if (p === "") return true;                         // a ROOT-level unresolved return / no-return → empty page → block
  const seg = String(p).split(".");
  if (!STRUCTURAL_ROOTS.has(seg[0])) return false;   // dynamic under a non-structural top key → advisory
  if (seg[0] !== "diff") return true;                // details/businessRules/rules/modules/entitySchemaName: any sub-path is structural
  if (seg.length <= 2) return true;                  // `diff` (whole array) or `diff.<n>` (whole item)
  if (seg.length === 3) return seg[2] === "values" || IDENTITY_FIELDS.has(seg[2]);
  if (seg[2] === "values") return IDENTITY_FIELDS.has(seg[3]);  // `diff.<n>.values.<field>`: identity → block; caption/tip/… → advisory
  return IDENTITY_FIELDS.has(seg[2]);
}

// the SEVERITY axis on `eff.warnings`, and the operator's escape hatch for the advisory half.
//
// `engine.mjs` now tags every warning `correctness` (the op targeted an item no lower schema defined, or the seed is
// not a real body) or `fidelity` (the mapping is RIGHT; an effect of the op is not represented in the item model).
// Only the first kind can block: a fidelity note's remedy lives in this engine, not in the body or the seed, so
// blocking on it produced a ⛔ nobody could clear — measured once as 12 h on one `remove properties:
// ["labelConfig"]`. Exactly the reasoning `isStructuralDiag` already applies to `unknown-enum-member`.
//
// A warning with NO severity is treated as `correctness`: a producer that forgot to declare one must fail loud,
// never quietly demote itself to an advisory.
const isCorrectnessWarning = (w) => (w?.severity ?? "correctness") === "correctness";

// The only dispositions `manifest.warningDispositions` may carry — same validated-enum rule as
// `MEMBER_DISPOSITIONS`, and for the same reason: a truthy `resolved` with a typo'd disposition would clear a
// warning with no valid answer behind it.
//   accepted            — read, understood, and the unrepresented effect does not change the Freedom mapping
//   reproduced-manually — it DOES change it, and the build reproduces that effect by hand (the note says how)
//   n/a                 — the element this warning is about is not being migrated
const WARNING_DISPOSITIONS = new Set(["accepted", "reproduced-manually", "n/a"]);

// The key a disposition is written under: `"<op>:<name>:<schema>"`, with `"<op>:<name>"` accepted as a bare
// fallback — the same scoped-or-bare rule `memberDispositions` uses. The schema is part of the primary key because
// the same op on the same element in a DIFFERENT layer is a different fact and must be answered separately.
const warningKeys = (w) => [`${w.op}:${w.name}:${w.schema}`, `${w.op}:${w.name}`];

// Annotate each warning with the operator's recorded answer, in place of nothing. Returns a NEW array (the engine's
// own array is not mutated) where a dispositioned FIDELITY warning carries `{ accepted: true, disposition, note }`.
// A disposition aimed at a CORRECTNESS warning is REFUSED and reported as `dispositionRefused`: those name a real
// missing item, and an operator cannot decide a page readable that the engine could not read.
function applyWarningDispositions(warnings, manifest) {
  const declared = plainObject(manifest?.warningDispositions);
  if (!Object.keys(declared).length) return (warnings || []).map((w) => ({ ...w }));
  return (warnings || []).map((w) => {
    const dec = plainObject(warningKeys(w).map((k) => declared[k]).find((v) => v != null));
    const valid = dec.resolved === true && WARNING_DISPOSITIONS.has(dec.disposition);
    if (!valid) return { ...w };
    if (isCorrectnessWarning(w)) return { ...w, dispositionRefused: "a correctness warning cannot be dispositioned — it names an item no lower schema defined; fix the schema order (F1) or the base seed (F2)" };
    return { ...w, accepted: true, disposition: dec.disposition, note: typeof dec.note === "string" ? dec.note : null };
  });
}

// The gate's warning reason, or null. Quotes each blocking warning's OWN hint: the single summary string this line
// would otherwise append to all eight producers ("op hit a missing item / skeletal seed") describes a condition that can be
// provably absent on the run it blocks, and sends the remedy search to the wrong file.
function warningsReason(warnings) {
  const blocking = (warnings || []).filter(isCorrectnessWarning);
  if (!blocking.length) return null;
  const quoted = blocking.slice(0, 6).map((w) => `${w.op} '${w.name}' @${w.schema}: ${w.hint || w.message || "(no hint)"}`);
  const more = blocking.length > quoted.length ? ` (+${blocking.length - quoted.length} more — see \`effective.warnings\`)` : "";
  return `warnings (${blocking.length}, correctness): ${quoted.join(" | ")}${more}`;
}

// ⛔ HARD GATE (RV1) — the correctness signals, computed ONCE so the CLI, renderer and callers share one verdict.
// Pure (no throw): returns { blocked, reasons }. Extracted from runMigration to keep it under Sonar CC 15 (S3776).
function computeGate({ parseErrors, eff, manifest, parseDiagnostics, childPages, typedPages, miniPage }) {
  const reasons = [];
  if (parseErrors.length) reasons.push(`parseErrors (${parseErrors.length}): ${parseErrors.map((e) => e.pkg).join(", ")} — a schema body failed to parse`);
  if ((eff.unresolvedParents || []).length) reasons.push(`unresolvedParents: ${eff.unresolvedParents.join(", ")} — base-template seed incomplete (F2) or schemas out of order (F1)`);
  const warnReason = warningsReason(eff.warnings);
  if (warnReason) reasons.push(warnReason);
  if (eff.seedQuality?.looksSkeletal) reasons.push("seedQuality.looksSkeletal — the seed is a hand-typed skeleton, not a real fetched parent-template body (#19)");
  if (eff.seedQuality && !eff.seedQuality.seeded && !manifest.noParentTemplate)
    reasons.push("no parent-template seed — a Classic page extends a base template (BaseModulePageV2/BasePageV2/…); building without its fetched body drops inherited base actions + container layout (F2). Fetch the parent-template schemas and pass them as `seed`, or set `noParentTemplate: true` ONLY if you have VERIFIED on-stand that this page has no parent template.");
  const structDiag = parseDiagnostics.filter((d) => d.role !== "section" && isStructuralDiag(d));
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
  // ENUM DRIFT (see engine.mjs `enumDriftIssues`): only a VALUE MISMATCH blocks — it mis-identifies every element
  // of that kind, with no partially-correct reading to fall back to. A member only the stand carries is advisory.
  const drift = enumDriftIssues(manifest.enumVocabulary);
  if (drift.mismatches.length)
    reasons.push(`enum drift — the stand's own enum values DISAGREE with the engine's pinned table: ${drift.mismatches.join("; ")}. Every element of an affected kind is mis-identified; update the pinned table in engine.mjs from this platform version's \`sysenums.js\` before planning.`);
  return { blocked: reasons.length > 0, reasons };
}

// THE LIST GATE. `computeGate` above answers for the RECORD page and deliberately excludes everything
// tagged `role: "section"` — a filter that exists because a section body that will not parse must not block a form-page
// plan that never consumed its `diff` (the spurious block recorded further down at the `sectionParseErrors` note).
// That exclusion is right for HALF its scope: since the section `diff` IS folded and mapped,
// a structural gap in it means the LIST page is built from an incomplete reading — while the form page is still
// perfectly fine.
//
// So the answer is scoped, not moved: this gate blocks the LIST deliverable and leaves `gate.blocked` alone. The
// form-page plan stays approvable, the list page says it is not, and neither statement is made on the other's
// evidence. `blocked: false` with no section at all is the normal case for a mini/child fold.
function computeListGate({ sectionParseErrors, parseDiagnostics, sectionEff }) {
  const reasons = [];
  if (sectionParseErrors.length) {
    reasons.push(`the section schema body failed to parse (${sectionParseErrors.map((e) => e.pkg).join(", ")}) — every element the section declares in its view \`diff\` is unreadable, so the list page below is built from the method-body signals alone. Fix the body (or re-collect the section bundle) and re-run`);
  }
  const sectionStruct = parseDiagnostics.filter((d) => d.role === "section" && isStructuralDiag(d));
  if (sectionStruct.length) {
    const fields = [...new Set(sectionStruct.map((d) => `${d.pkg ? d.pkg + " " : ""}${d.path} (${d.kind})`))].join(", ");
    reasons.push(`the section's parse could not statically resolve structural field(s): ${fields} — its \`diff\` may be INCOMPLETE, so an element the Classic list shows can be missing from the ChangeSet below with nothing to name it`);
  }
  // The fold's own correctness warnings — a section op that hit a missing item, or a seed that is not a real
  // fetched body. Both mean the reading of the section is wrong, not merely unrepresented, which is exactly the
  // `correctness` severity's own definition.
  const foldBad = (sectionEff?.warnings || []).filter((w) => w.severity === "correctness");
  if (foldBad.length) {
    reasons.push(`the section fold reported ${foldBad.length} correctness warning(s): ${[...new Set(foldBad.map((w) => w.hint))].join(" | ").slice(0, 400)}`);
  }
  if ((sectionEff?.unresolvedParents || []).length) {
    reasons.push(`the section fold could not resolve parent(s): ${sectionEff.unresolvedParents.join(", ")} — supply the section's own template chain as \`section.seed\` (a second \`get-classic-page-sources\` rooted at the *Section schema), or its elements cannot be placed on a list region`);
  }
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

// parse each supplied EMBEDDED PROFILE schema (the little declarative page a profile card renders,
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
// Deliberately NOT carried over from detailSchemaRecord: `title`, `editPage`, `editable`.
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

function validateStructure({ manifest, changeSet, childPages, typedPages, section, miniPage, miniPageVerified, visited, listColumnIssue }) {
  const suppliedDetailKeys = new Set(Object.keys(manifest.detailSchemas || {}));
  const issues = [...detailSchemaIssues(changeSet, suppliedDetailKeys), ...profileSchemaIssues(manifest, changeSet)];
  // A recoverable list-column read failure (see `normalizeResolvedListColumns`) is INPUT incompleteness, not a
  // crash: the plan still renders, with the cause and the remedy named here instead of on stderr.
  if (listColumnIssue) issues.push(listColumnIssue);
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
      // agent-verified: the child entity already has a shipped Freedom form page → Reuse, nothing to rebuild
      reuseFreedomPage: ds ? (ds.reuseFreedomPage ?? null) : null,
      // USER-approved section boundary: the child entity owns another section, so its Classic card stays
      // Classic and this list keeps opening it. Carried here as well as parsed on the detail record — a key present
      // in only one of the two places reaches no gate and no renderer, and fails silently.
      opensClassicPage: ds ? (ds.opensClassicPage ?? null) : null,
      ownSection: ds ? (ds.ownSection ?? null) : null,
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

// A MEMBER key carries its SCOPE, for the same reason a method key does. `<kind>:<item>` alone collides across the
// pages of one surface: two child pages each declaring `attribute-virtual:IsEditable` produced the identical key, so
// the behaviour run's coverage `Set` counted two distinct rows as one described row, and `applyBehaviourIndex`
// applied ONE card to BOTH pages — two different behaviours closing the gate on a single answer.
// `kind` and `item` stay on the entry: the prompts render them, and only the KEY needed disambiguating.
function memberDigestOf(changeSet, scopeSchema) {
  return (changeSet?.needsDecision || []).filter((n) => HANDOFF_MEMBER_KINDS.has(n.kind))
    .map((n) => ({ kind: n.kind, item: n.item,
      key: scopeSchema ? `${scopeSchema}::${n.kind}:${n.item}` : `${n.kind}:${n.item}` }));
}

// The *Section chain as its OWN stub scope — 0 or 1 of them, so the caller spreads the result with no branch of
// its own. Extracted from `runMigration` rather than written inline there because the two ternaries and their
// `||` fallbacks pushed that function to cognitive complexity 16; the repo pins Sonar's 15, which is the same
// reason `feedSchemaArray` below is its own function.
//
// The section chain is mapped only to digest its imperative rows (methods / mixins / messages) into a step-5.1
// scope — `analyzeSectionChain`'s fixed-field extraction stays the source for the plan's List-page block. Local
// to the stub digest: gates, coverage and the member ledger are unaffected.
//
// ROOT-ONLY (`opts.scopeSchema` unset): a nested child/typed/mini fold gets the raw child bundle as its manifest,
// so a child bundle carrying `section` would otherwise inject a mid-array section entry into the parent's
// `childStubScopes` (`slice(1)`) and break the section-is-LAST position contract at the call site.
//
// Schema label NEVER null: the main-page scope already owns the null-schema key form (bare `method` / `kind:item`),
// so a second null-schema scope would collapse both scopes' digest keys into one coverage row. When
// `planMeta.sectionSchema` is absent the deterministic literal `Section` keeps the keys distinct.
// The section scope's label, used by the step-5.1 digest AND by the fold that applies the answers back. One
// source: two fallbacks that disagree make the handoff ask for `<label>::<method>` and the apply pass resolve a
// different spelling, so the answer comes back matched and lands on nothing.
const sectionScopeLabel = (manifest) => manifest.planMeta?.sectionSchema || "Section";
// What the list page takes from the section body: its imperative MEMBERS only, and its methods marked where the
// list analyzer already read them. `mapToFreedom` maps a RECORD page, so its view-shaped decisions (containers,
// field controls, field labels) describe regions a list page does not have — `mapSectionView` owns those facts.
function sectionCodeForList(sectionChangeSet) {
  if (!sectionChangeSet) return null;
  return {
    // COPY every stub, not only the marked ones: the list fold applies cards onto what it is handed, and a
    // half-copied array leaves the digest's own objects carrying some of them and not others.
    handlerStubs: (sectionChangeSet.handlerStubs || []).map((h) =>
      (SECTION_VIEW_METHODS.has(h.sourceMethod) ? { ...h, listMapped: true } : { ...h })),
    needsDecision: (sectionChangeSet.needsDecision || []).filter((d) => MEMBER_WORKLIST_KINDS.has(d.kind)),
  };
}
function sectionChangeSetOf(manifest, opts, sectionEff) {
  if (opts.scopeSchema || !sectionEff) return null;
  return mapToFreedom(sectionEff, {
    entityColumns: manifest.entityColumns || {},
    resources: manifest.resources || {},
  });
}
// ONE section ChangeSet, TWO consumers, for the reason `foldSectionView` states above: this digest, and the list
// page's own method / imperative-member rows. Discarding it leaves a section's methods in the handoff and in no row.
function sectionStubScopes(manifest, opts, sectionChangeSet) {
  if (!sectionChangeSet) return [];
  const schema = sectionScopeLabel(manifest);
  return [stubScope("section", schema, sectionChangeSet, sectionChangeSet.standardMethodsFiltered)];
}

// THE SECTION VIEW. The *Section chain folded over its OWN parent-template seed — the same
// `mergeHierarchy` the record page uses, given the section's own `BaseDataView` chain instead of the page's
// `BaseModulePageV2` one. `null` when no section chain was supplied, so every consumer has one thing to test.
//
// ONE fold, TWO consumers, on purpose. Computing it inside `sectionStubScopes` throws it away with
// that function's ChangeSet, leaving the list page unable to see it, which drops every element a section declares in its
// `diff`. Folding it twice would be the other way to share it, and would let the two readings of the
// same chain drift apart — the exact failure `mapping-table.mjs` was created to end.
//
// SEEDED, unlike the call this replaces. Without `seedTemplate` the fold has no `DataGrid`, no
// `CombinedModeActionButtonsCardLeftContainer` and no `activeRowActions` to merge onto, so `templateOwned` is
// false for the entire tree and base chrome is indistinguishable from what the section itself declares. The seed
// is not polish here: it is what makes the section-owned/inherited split (and therefore a readable ⚠ worklist)
// possible at all. A run whose manifest carries no `section.seed` still folds — it just reports the missing base
// through the fold's own merge-onto-nothing warnings, which name the cause precisely.
function foldSectionView(sectionSchemas, sectionSeed) {
  if (!sectionSchemas.length) return null;
  return mergeHierarchy(sectionSchemas, { seedTemplate: sectionSeed });
}

// One handoff scope = one schema whose imperative rows are worked as a unit. Kept as a FLAT list of scopes rather
// than one merged array so a caller can hand over (or stage) a single page — the staged-processing direction of
// without re-deriving which method belongs to which schema.
function stubScope(role, schema, changeSet, standardMethodsFiltered) {
  const stubs = stubDigestOf(changeSet);
  const members = memberDigestOf(changeSet, schema);
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

// SCOPE FAN-IN. One page reachable from several parents is folded once (the memo hands the same `res` to every
// parent that references it) and then appended once per parent, so `stubIndex` carried the identical scope two or
// three times: measured on a real section, 18 entries where one child page appeared three times and four more
// twice. Nothing downstream in the engine noticed — `scopeDigestKeys` and the three index checks all reduce to a
// Set — but `--stubs` publishes `totals.scopes` / `totals.stubs` as the surface's size, and a behaviour-analysis
// run compares its own census against those numbers. Double-counted rows there mean the handoff overstates the
// work and the census can never agree with it.
//
// Identity is the ROW SET, not the label: same role, same schema, same methods, same member keys. Two scopes that
// merely share a name still differ in rows and both survive. First occurrence wins, so the two position contracts
// this array carries hold — `stubIndex[0]` is the record page, the section scope stays last.
export function dedupeStubScopes(scopes) {
  const seen = new Set();
  return scopes.filter((s) => {
    const key = [
      s.role, s.schema || "",
      (s.stubs || []).map((st) => st.method).sort().join(","),
      (s.members || []).map((m) => m.key).sort().join(","),
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
// A card reference is PRESENT only when it NAMES something. A blank or whitespace-only string is what a merge
// agent emits when it had nowhere to put one — `INDEX_ENTRY` sets no `minLength`, so `""` is schema-valid — and
// reading that as present is the silent failure: a `typeof … === "string"` test says the body card is there, the
// row drops out of `wiringOnly`, and nothing renders in its place. The ⚠ banner then goes quiet on exactly the
// row it exists for. Every leg reads a card the same way — here, in `wiringOnlyKeys`, and in the workflow's
// `wiringOnlyMixinKeys` — so one entry cannot be described on one leg and wiring-only on the other.
const cardRef = (v) => (typeof v === "string" && v.trim().length ? v : null);

// The card + acceptance criteria a behaviour-analysis run attached to one row, sanitized. Anything else in the
// entry (a note, a trigger) is read at its own call site. `bodyCard`/`bodyAc` name the body's OWN card when the
// behaviour is defined outside the owning scope — the criteria that gate a behaviour usually live there, not in
// the wiring card (see wiringOnlyKeys below for the computed check).
function describedInOf(entry) {
  const card = cardRef(entry.card);
  const ac = Array.isArray(entry.ac) ? entry.ac.filter((a) => typeof a === "string") : [];
  const bodyCard = cardRef(entry.bodyCard);
  const bodyAc = Array.isArray(entry.bodyAc) ? entry.bodyAc.filter((a) => typeof a === "string") : [];
  // the plain-language plan columns (What the item does / Use case). Free prose the step-5.1 analyst
  // authored on the behaviour card (`whatItDoes` from the card's "What it is"; `useCase` a non-technical step-by-step
  // it writes). Sanitized to a trimmed non-empty string; the renderer escapes it into the cell. Either alone counts
  // as a description, so a row carrying only these still sets `describedIn`.
  const prose = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const whatItDoes = prose(entry.whatItDoes);
  const useCase = prose(entry.useCase);
  // a CARD is what makes a row described; bare acceptance criteria are not. `INDEX_ENTRY` sets
  // no `minLength`, so `{ key, card: "", ac: ["AC-1"] }` is schema-valid and is exactly what a merge agent emits
  // for "nowhere to put one". Accepting it on `ac.length` made the two legs disagree about the same entry: the
  // engine counted the row as carrying a behaviour card while the workflow's `hasCard` (helpers.mjs) counted it
  // as uncovered, and the plan then cited `? AC-1` — a citation the operator cannot follow. The comment on
  // `cardRef` above states the invariant every leg reads a card by; this is the leg that broke it.
  return card || bodyCard || whatItDoes || useCase ? { card, ac, bodyCard, bodyAc, whatItDoes, useCase } : null;
}

// A behaviour report covers a whole SURFACE, so its answers span several scopes (the record page, the mini page,
// each child edit page) while each engine run maps ONE of them — and they cover all FOUR unanswerable row types,
// not just methods. So one index, three key forms, tried in this order per row:
//
//   "<schema>::<method>"   the scoped method form — disambiguates a name two scopes both define (`init`)
//   "<method>"             the bare method form
//   "<schema>::<kind>:<name>"  the scoped member form — disambiguates a member two pages both declare
//   "<kind>:<name>"        a ⚠ Confirm member: `message:RefreshDecisionMaker`, `mixin:CompletenessMixin`, …
//
// Accepting both a scoped and a bare form is the rule `memberDispositions` already uses; without the scoped one,
// a single answer would be folded onto two different bodies that happen to share a method name.
// One index entry applied to one handler stub. Own fn so `applyBehaviourIndex` stays under Sonar's
// cognitive-complexity budget; it records what it filled into the caller's two lists.
function applyBehaviourToStub(h, entry, out) {
  const d = describedInOf(entry);
  if (d) { h.describedIn = d; out.described.push(h.sourceMethod); }
  // Fill an EMPTY trigger only. A traced trigger is body-proven; a reported one is a description of it.
  if (!(h.triggers || []).length && (entry.trigger || entry.from)) {
    h.triggers = [{ kind: "reported", reportedKind: entry.trigger || null, from: entry.from || null,
      note: typeof entry.note === "string" ? entry.note : null }];
    out.triggersFilled.push(h.sourceMethod);
  }
}
// The entry for a key, scoped first and bare second — the bare fallback is what keeps a `behaviour-index.json`
// written before keys carried a scope still resolving. `null` when the index has nothing usable for it.
function behaviourEntry(map, scopeSchema, key) {
  const entry = (scopeSchema ? map[`${scopeSchema}::${key}`] : undefined) ?? map[key];
  return entry && typeof entry === "object" ? entry : null;
}
function applyBehaviourIndex(changeSet, index, scopeSchema) {
  const map = plainObject(index);
  if (!Object.keys(map).length) return { triggersFilled: [], described: [] };
  const out = { triggersFilled: [], described: [] };
  const { triggersFilled, described } = out;
  for (const h of changeSet?.handlerStubs || []) {
    const entry = behaviourEntry(map, scopeSchema, h.sourceMethod);
    if (entry) applyBehaviourToStub(h, entry, out);
  }
  // ⚠ Confirm members — a `message` whose counterpart lives in another schema, a `mixin` whose members are defined
  // outside this body, the aggregated `module-dep` row. These are the row types step 5.1 exists for just as much as
  // an unresolved method, and they carry no trigger — only the card that describes them.
  for (const n of changeSet?.needsDecision || []) {
    const key = `${n.kind}:${n.item}`;
    const d = describedInOf(behaviourEntry(map, scopeSchema, key) || {});
    if (d) { n.describedIn = d; described.push(key); }
  }
  // Called from HERE, so it runs only when an index was supplied — which is exactly when it can pay off: without a
  // reported trigger every chain was already resolved (or left open) by resolveInternalTrigger during mapping.
  propagateChainRoots(changeSet);
  return { triggersFilled, described };
}

// A helper resolved only to its CALLER (`internal call from X`, no root, no lifecycle) is the weakest trigger the
// engine emits, and the header counts it as still open. The chain resolution runs during mapping, off the TRACED
// triggers, so a caller answered by the behaviour index never reaches the rows below it — this walks the chain
// again after the fill. It only ADDS a root to a row that has none, so a traced root is never overwritten, and
// `triggerText` renders the root recursively, so a described origin still prints `— reported` in the composed cell.
function propagateChainRoots(changeSet) {
  const stubs = changeSet?.handlerStubs || [];
  // SNAPSHOT the triggers this pass starts from. Walking the live stubs would let a row this same pass already
  // rewrote answer for the one below it, so a helper's root would be the nearest REWRITTEN ancestor rather than the
  // chain's origin — which of the two you get depends on stub order alone. The snapshot makes the result the same
  // whatever order the schema declares its methods in, and keeps `rootTrigger` a real origin instead of another
  // composed `internal` trigger nested inside itself.
  const before = new Map(stubs.map((h) => [h.sourceMethod, (h.triggers || [])[0]]));
  const weak = (t) => t?.kind === "internal" && !t.rootTrigger && !t.lifecycle;
  // Walk up from one caller until something answers. `seen` breaks the mutual-recursion cycles classic helpers are
  // full of, exactly as resolveInternalTrigger does.
  const originFrom = (start, seen) => {
    let cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const up = before.get(cur);
      if (!up) return null;                 // that caller is unresolved — this branch of the chain is still open
      if (!weak(up)) return { root: cur, rootTrigger: up };
      cur = up.from;
    }
    return null;
  };
  for (const h of stubs) {
    const t = (h.triggers || [])[0];
    if (!weak(t) || (h.triggers || []).length !== 1) continue;
    // EVERY caller is tried, sorted, first ANSWER wins. Deliberately stricter than resolveInternalTrigger, which
    // returns on the first caller yielding anything at all, a weak partial included: here a weak ancestor is not an
    // answer, so the walk moves on to the next caller. Following `from` alone left a helper unanswered whenever its
    // first caller happened to be the open one.
    // Sorted with an explicit comparator so the pick is stable and never depends on the default's coercion.
    const callers = t.callers?.length ? [...t.callers].sort((a, b) => a.localeCompare(b)) : [t.from];
    let found = null;
    for (const c of callers) { found = originFrom(c, new Set([h.sourceMethod])); if (found) break; }
    if (!found) continue;
    // `root` + `rootTrigger` only: a `via` carried over from the unresolved walk lists hops this trigger now
    // names itself, and rendered as "→ X via X".
    const { via, ...rest } = t;             // eslint-disable-line no-unused-vars -- dropped on purpose
    h.triggers = [{ ...rest, ...found }];
  }
}

// Which `behaviourIndex` keys reached no row, across EVERY scope of this run. Computed from the assembled index
// (not per scope) because a key that misses the record page legitimately belongs to the mini page or a child.
function scopeDigestKeys(scopes) {
  const seen = new Set();
  for (const s of scopes) {
    for (const st of s.stubs) { seen.add(st.method); if (s.schema) seen.add(`${s.schema}::${st.method}`); }
    // Both spellings, mirroring the stub leg above: `applyBehaviourIndex` resolves a member through
    // `behaviourEntry` with a scoped-first-then-bare fallback, so a bare `<kind>:<item>` index key is
    // genuinely applied to a scoped row. Indexing only `m.key` (the scoped form in any scoped scope)
    // would make `unmatchedIndexKeys` report such a key as matching nothing
    // while the row itself shows the card applied.
    for (const m of s.members) { seen.add(m.key); seen.add(`${m.kind}:${m.item}`); }
  }
  return seen;
}
function unmatchedIndexKeys(index, stubIndex) {
  const keys = Object.keys(plainObject(index));
  if (!keys.length) return [];
  const seen = scopeDigestKeys(stubIndex);
  return keys.filter((k) => !seen.has(k));
}
// Rows whose body PROVABLY lives in another schema, described by a wiring card alone (`card`, no `bodyCard`).
// Only the mechanically provable kinds are flagged: a `mixin:` member (one row, one external body, and the
// analysis contract cards every mixin body) and an `externalRef` method (assigned from exactly one other module).
// `message:` is left out — the counterpart may sit on this same surface, covered by the same card — and so are the
// aggregated `module-dep`/`referenced-module` rows, where many bodies hide behind one key so a single missing
// `bodyCard` proves nothing. For those kinds the two-card rule stays in the analysis prompts; this list is the
// computed floor under it, surfaced as a ⚠ plan banner (renderPlanBanners).
//
// TWO LEGS, DIFFERENT STRENGTHS — edit one, look at the other. This function is the ADVISORY leg: it reads the
// merged index against the parsed surface, covers `mixin:` + `externalRef`, and only prints a banner, so a
// wiring-only row still leaves `coverage.complete` and the `M of M` header green. The BLOCKING leg is
// `wiringOnlyMixinKeys` in `classic-behaviour-analysis.workflow.js`: it reads the analysis run's own entries
// against the digest keys, covers `mixin:` alone, and counts against `coverage.complete` so the row goes back
// through the repair round. They are separate functions on purpose — the workflow script is evaluated as a
// function body and may not `import`, which is pinned by the `workflow sandbox: … imports nothing` test — so a
// change to the membership or the strength of either leg has to be applied to both by hand.
function wiringOnlyKeys(index, stubIndex) {
  const map = plainObject(index);
  if (!Object.keys(map).length) return [];
  const isWiringOnly = (key) => {
    const e = map[key];
    return !!e && typeof e === "object" && !!cardRef(e.card) && !cardRef(e.bodyCard);
  };
  // Same scoped-key-first lookup applyBehaviourIndex uses, so both read the same entry for one row.
  const stubKey = (s, st) => (s.schema && map[`${s.schema}::${st.method}`] ? `${s.schema}::${st.method}` : st.method);
  // Members get the SAME scoped-first-then-bare resolution. `m.key` is now scoped (two pages may declare the same
  // member), so reading it alone stopped matching an index written with the bare `<kind>:<name>` form — and this leg
  // is what prints the wiring-only banner, so it went quiet on exactly the rows it exists for.
  const memberKey = (m) => (map[m.key] ? m.key : `${m.kind}:${m.item}`);
  const candidates = stubIndex.flatMap((s) => [
    ...s.stubs.filter((st) => st.externalRef).map((st) => stubKey(s, st)),
    ...s.members.filter((m) => m.kind === "mixin").map((m) => memberKey(m)),
  ]);
  return [...new Set(candidates.filter(isWiringOnly))];
}

// planMeta completeness — the `--plan` artifact is INCOMPLETE while any required Overview/Main-scope value is
// still a `<FILL: …>` placeholder. planMeta is declared optional (so `--spec`/default runs don't need it), so
// its absence was never gated: an unfilled plan passed exit 0 with "present verbatim". Surface the missing
// keys so the CLI turns an unfilled `--plan` into a non-zero exit, like the other incompleteness gates.
// Freedom has ONE list-page template, so `listTemplate` is NOT a required `<FILL:>` planMeta value: it
// DEFAULTS to this (see `checklistOpts`), an explicit `planMeta.listTemplate` still overrides. `formTemplate` stays
// required — a genuine multi-way choice (top-area / progress-bar / mini / …).
const DEFAULT_LIST_TEMPLATE = "ListPageV3Template";
const REQUIRED_PLANMETA = ["scope", "environment", "package", "approach", "whatItDoes", "sectionSchema", "formTemplate"];
// on-stand SIGNALS completeness — the ⚠ conditional checks (DCM case / connected processes / printables)
// must be RESOLVED before the plan, not deferred to build (the recurring "faithful to the classic body,
// check later" miss). No new tool is needed — the agent runs the existing ESQ/odata queries and records the
// answers in `manifest.signals`, each key `{ resolved:true, present:<bool>, cases|items|names?:[…] }`. An
// absent/unresolved key makes --plan INCOMPLETE (like planMeta). `present:false` (checked, none) is a VALID
// resolved state — the distinction is "verified none" vs "never checked", exactly like child-page editPage.
// `deduplication` joins them for exactly the same reason: the on-save duplicate check is an
// `asyncValidate` override on `CrtDeduplication.BaseEntityPage`, so it arrives via the base seed chain, counts as
// `fromTemplate`, and is classified as ledger `context` — the page body NEVER shows it, and a migration therefore
// dropped it in total silence. Its answer carries one extra field beyond present/absent:
//   "deduplication": { "resolved": true, "present": true, "names": ["Contact duplicates. Contact name"],
//                      "serviceConfigured": false }
// `present` = this entity HAS an active rule marked use-on-save; `serviceConfigured` = the target stand can
// actually run the Freedom flow. Both are needed because they fail differently: no rule means nothing to lose,
// while a rule + no service means the check silently stops at migration (measured — see mapDedupOnSave).
// `dashboards` items carry `{ id, caption, sourcePackage?, saveInPackage?, migrate? }`. `sourcePackage` is the
// on-stand READ: the package that ships the 7x dashboard today, absent = it is stand data only. The other two
// are DECISIONS with derived defaults - `migrate` true, `saveInPackage` = `!!sourcePackage` - and `true` there
// means the run's own `manifest.targetPackage`, the one package `placement` proved writable.
const SIGNAL_KEYS = ["dcm", "processes", "printables", "dashboards", "deduplication"];
// Is signal `k` still UNRESOLVED? The generic rule is "absent, not an object, or resolved !== true". `deduplication`
// adds ONE field-aware clause, because the key carries two facts and the gate must not pass on half of them: a rule
// IS present but `serviceConfigured` was never recorded is precisely the likely real-world half-answer (an operator
// who ran only the DuplicatesRule query), and letting it exit 0 would ship an approvable plan whose own text says
// "cannot say whether the check survives migration". `present:false` needs no service answer — nothing to lose —
// so the nine `{resolved:true, present:false}` answers stay valid. Own fn so the filter stays a one-liner (Sonar CC).
function signalUnresolved(k, signals) {
  const s = signals[k];
  if (!s || typeof s !== "object" || s.resolved !== true) return true;
  // `s.present` by TRUTHINESS, not `=== true`: a hand-authored `"present": "yes"` must not slip past the
  // service requirement into the mapper's "serviceConfigured unrecorded" branch — that is the same half-answered
  // plan this clause exists to block. The mapper reads `present` the same way.
  if (k === "deduplication" && s.present && typeof s.serviceConfigured !== "boolean") return true;
  // `dashboards` present with an EMPTY list is a half answer, not a resolved one: "this section has 7x
  // dashboards" and "here are none of them" cannot both be true. Left through, the plan reads "0 to migrate"
  // under a signal that says there are some, and the checklist emits no dashboards rows at all - so the run
  // silently drops exactly what the signal was added to catch. "Checked, none found" is `present: false`.
  if (k === "dashboards" && s.present && !(Array.isArray(s.items) && s.items.length)) return true;
  return false;
}
// PLACEMENT completeness — can the target app actually HOST the section? A run once cleared every gate above,
// built five pages, and only then discovered that `create-app-section` cannot run at all: the owning app was an
// install-time wrapper with NO primary package, its one package was locked, and the editable target package was
// not in the app's composition. None of the three is derivable from the page bodies, and `targetPackage` alone
// proves only that SOME package is writable — not that the APP can register a menu section into it.
// `create-app-section` takes NO package parameter: it writes to the app's PRIMARY package. So a menu-registered
// Freedom section is possible only when the app's primary package IS the target package AND that package is
// writable. Everything else is a decision, not a fallback — recorded here so it is made at plan time.
//   "placement": {
//     "targetPackageEditable":     { "resolved": true, "value": true,  "evidence": "InstallType 0; every layer isClientEditable:true" },
//     "application":               { "resolved": true, "code": "UsrTasksApp" | null },
//     "primaryPackage":            { "resolved": true, "name": "UsrTasks" | null, "editable": true },
//     "targetPackageInApplication":{ "resolved": true, "value": true },
//     "sectionHost":               { "resolved": true, "mode": "existing-app" | "new-app" | "pages-only-no-menu" } }
const PLACEMENT_KEYS = ["targetPackageEditable", "application", "primaryPackage", "targetPackageInApplication", "sectionHost"];
// `existing-app` — register into the app that already owns the entity (the only mode that needs the primary ==
// target match). `new-app` — the build creates its own Freedom app first (the answer when the owning app is a
// vendor/install wrapper). `pages-only-no-menu` — pages ship, the section is deliberately NOT registered; a
// legitimate outcome, but an APPROVED one, never a silent fallback: the whole point of this gate is that the
// missing menu entry is a plan decision, not a surprise found two hours into a build.
const SECTION_HOST_MODES = ["existing-app", "new-app", "pages-only-no-menu"];
// The placement facts, checked. Pure in `manifest`; returns the human-readable blockers (empty = clear), so the
// CLI can gate `--plan` on it exactly like planMeta/signals. Order matters: unresolved keys are reported first
// and stop there, because a rule evaluated over a missing fact would just invent a verdict.
export function placementIssues(manifest) {
  const p = manifest.placement && typeof manifest.placement === "object" ? manifest.placement : {};
  const has = (k) => p[k] && typeof p[k] === "object" && p[k].resolved === true;
  const unresolved = PLACEMENT_KEYS.filter((k) => !has(k));
  if (unresolved.length) {
    return unresolved.map((k) => `placement.${k} not resolved — record it in manifest.placement as { "resolved": true, … } (a verified "no"/null is a valid answer; "never checked" is not)`);
  }
  const issues = [];
  const target = typeof manifest.targetPackage === "string" ? manifest.targetPackage.trim() : "";
  // (1) Nothing can be built into a locked package — this one holds in EVERY mode, so it is checked first and
  // independently of the section-host decision.
  if (p.targetPackageEditable.value !== true) {
    issues.push(`placement.targetPackageEditable is not true — target package '${target || "(unset)"}' cannot receive design-time writes, so NO page can be built there. Pick an editable package (or create one) before this plan is approvable.`);
  }
  const mode = p.sectionHost.mode;
  if (!SECTION_HOST_MODES.includes(mode)) {
    issues.push(`placement.sectionHost.mode '${mode}' is not one of ${SECTION_HOST_MODES.join(" / ")}`);
    return issues;
  }
  // (2) The `existing-app` contract, stated as the three things `create-app-section` actually needs.
  if (mode === "existing-app") issues.push(...existingAppIssues(p, target));
  return issues;
}
// The `existing-app` half of `placementIssues`, extracted so that function stays under Sonar's
// cognitive-complexity budget. Each failure names the alternative modes, because "this app cannot host it" is not
// a dead end — it is the fork.
function existingAppIssues(p, target) {
  const issues = [];
  const alt = "Either switch placement.sectionHost.mode to 'new-app' (the build creates its own Freedom app), or to 'pages-only-no-menu' (ship the pages without a menu entry) — or fix the app's package composition on-stand FIRST and re-record these facts.";
  if (!p.application.code) {
    issues.push(`placement.sectionHost.mode is 'existing-app' but placement.application.code is null — there is no app to register the section into. ${alt}`);
  }
  if (!p.primaryPackage.name) {
    issues.push(`placement.sectionHost.mode is 'existing-app' but app '${p.application.code || "(none)"}' has NO primary package — create-app-section writes to the app's primary package, so it cannot run at all. ${alt}`);
  } else if (target && p.primaryPackage.name !== target) {
    issues.push(`placement.sectionHost.mode is 'existing-app' but the app's primary package is '${p.primaryPackage.name}', not the target package '${target}' — create-app-section takes no package parameter, so the section would land in the WRONG package. ${alt}`);
  }
  if (p.primaryPackage.name && p.primaryPackage.editable !== true) {
    issues.push(`placement.sectionHost.mode is 'existing-app' but the app's primary package '${p.primaryPackage.name}' is not editable — the section cannot be written into it. ${alt}`);
  }
  return issues;
}
// ONE opts object for every row-rendering entry point (`--checklist`, `--verify`, the plan/spec renderers) and
// for the sub-page folds. `--checklist` and `--verify` building their own risks a thinner verify one
// (no targetPackage / planMetaMissing / signalsMissing / isMiniPage / isChildPage): they agree only for as long
// as no row helper reads the gap, and the first helper that did would silently render two different row sets.
// Pure in `manifest` + the run flags, so it can be built BEFORE the fold and shared with every sub-page.
export function checklistOpts(manifest, opts = {}) {
  const blank = (v) => v == null || String(v).trim() === "";
  // default the single-valued `listTemplate` (see DEFAULT_LIST_TEMPLATE) so the plan never shows a
  // `<FILL: list template>` for it; an explicit `planMeta.listTemplate` still wins. Both `planMetaMissing` and the
  // renderers read this normalized `pm`, so the Main-scope/Overview row and the missing-key gate see the default.
  const pm0 = manifest.planMeta || {};
  const pm = blank(pm0.listTemplate) ? { ...pm0, listTemplate: DEFAULT_LIST_TEMPLATE } : pm0;
  // A nested run's manifest is the CHILD bundle, which carries no `signals` of its own — the on-stand answers are
  // supplied ONCE on the root manifest (one stand check covers the whole surface), exactly like `behaviourIndex`
  // and `targetPackage`. So the RUN-level answers are inherited via `opts.inheritedSignals` and a sub-bundle's own
  // key still wins. Without this every fold saw `{}` and every signal-driven row silently vanished below the root.
  const signals = { ...plainObject(opts.inheritedSignals), ...plainObject(manifest.signals) };
  return {
    template: manifest.template,
    targetPackage: manifest.targetPackage,
    planMeta: pm,
    planMetaMissing: REQUIRED_PLANMETA.filter((k) => k === "formTemplate" ? (blank(pm.formTemplate) && blank(manifest.template)) : blank(pm[k])),
    signals,
    signalsMissing: SIGNAL_KEYS.filter((k) => signalUnresolved(k, signals)),
    placementBlockers: placementIssues(manifest),
    // The DECIDED host mode, or null when placement was never recorded. Read by the renderer so the
    // `Navigable section registered` deliverable is emitted only when a menu entry is actually planned — an
    // approved `pages-only-no-menu` run must not carry a row it deliberately will never satisfy.
    sectionHostMode: manifest.placement?.sectionHost?.mode ?? null,
    // The app the section is registered INTO, published so the build side never has to guess one. In the run this
    // exists for, the agent doing the registration had no application code in front of it and invented one off the
    // stand — against an app that could not host a section at all.
    applicationCode: manifest.placement?.application?.code ?? null,
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
// grandchild — the gate did not fail, it ceased to exist, and the `placement` row published `targetPackage: null`.
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
// identifier (it keys `--built.pages`, the evidence ids, the checklist groups and the verify ctx cache). Two DIFFERENT
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
// whole page. A child verified to have NO separate page, one behind an approved SECTION BOUNDARY (its
// Classic card stays Classic, so this plan builds nothing for it), one already mapped higher on this branch (cycle)
// and one whose bundle failed to parse owe nothing that a built-page check could close, so they publish no key at
// all and keep only the parent's identity row — a gated row there would be a permanent false red, and the last two
// are PLAN-completeness failures the structure gate already blocks on (a different class from "my build is missing").
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
// The needsDecision kinds that represent REAL ported logic (as opposed to widget / registry / cosmetic / placement
// advisories) — tells a formless INLINE-GRID child (0 fields but real logic to port) from an EMPTY one.
const LOGIC_BEARING_KINDS = new Set([...IMPERATIVE_MEMBER_KINDS, "attribute-dependency", "rule", "entity-filter", "method"]);
function foldOneChildPage(c, pageKey, childSchemas, foldCtx) {
  // Reuse of an existing Freedom form page: there is no rebuild, so do NOT fold the Classic child tree even if a
  // bundle happens to be supplied — folding it would re-introduce the recursion the disposition exists to close.
  if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) return publishUnfoldedChild(c, pageKey);
  // THE SECTION BOUNDARY, and the reason this ticket exists: the child's page is NOT FOLDED. No recursive
  // sub-migration, so no sub-run gate, so no `c.childBlocked` — and `migrate.mjs`'s `filter(c => c.childBlocked)`
  // cannot see a page this plan is not migrating. A 3.3 MB fold of another section's card would otherwise be mandatory, and
  // ONE of that card's own merge warnings was enough to ⛔ the parent plan for work nobody had asked for.
  // Checked AFTER `reuseFreedomPage` on purpose: if the child already ships a Freedom form, reuse is the better
  // answer (the related list opens Freedom rather than staying on Classic), and it owes a binding row this does not.
  // Routed through `publishUnfoldedChild`, which publishes NOTHING here — `childPageIssue` resolves the boundary, so
  // it falls out with no page key, exactly like a verified `editPage: false`. No units, no checklist gate, no verify
  // row: nothing about this child can be reported MISSING, because nothing about it is a deliverable.
  if (boundaryChild(c)) return publishUnfoldedChild(c, pageKey);
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
  // a cleanly-folded child with NO form fields, tabs or sub-details is NOT a form page: it is an
  // inline-editable grid / logic-only schema (a ConfigurationGrid detail — editing is inline in the related-list
  // rows; the body is only an attribute lookup-filter + column-render methods). Distinguished from a skeletal / bad
  // bundle by whether it carries behaviour. Marked so the plan does not mislabel it `Rebuild (child) → form page`
  // with an EMPTY Layout; the unit still publishes below — its checklist rows ARE the logic to port.
  if (c.fieldCount === 0 && !c.hasTabs && c.nDetails === 0) {
    // "Behaviour" here means REAL ported logic (methods, imperative members, business rules) — NOT any needsDecision:
    // `needsDecision` is a catch-all that also carries widget / registry / cosmetic / placement advisories, and a
    // 0-field child whose only decision is such noise is a bad/empty bundle (`empty` → ⚠ verify), not an inline grid.
    const hasBehaviour = (res.changeSet?.handlerStubs?.length || 0) > 0
      || (res.changeSet?.needsDecision || []).some((d) => LOGIC_BEARING_KINDS.has(d.kind));
    c.formless = hasBehaviour ? "inline-grid" : "empty";
    // Inline grid → no form page, so the plan shows only its LOGIC (Business rules / ⚠ Custom methods / ⚠ Other
    // declared logic), not a form-page mapping. Render that logic-only spec here (renderChild prefers c.logicSpec).
    if (c.formless === "inline-grid") c.logicSpec = renderDesignSpec(res, { embedded: true, logicOnly: true });
  }
  c.childPages = res.childPages || [];     // carry resolved grandchildren up for recursive embedding
  c.grandChildren = c.childPages.length;
  c.childBlocked = !!res.gate?.blocked;    // a nested child's spec is valid only if it cleared its OWN gates
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
    // `formOnly` so the per-type spec renders EMBEDDED (no header/Size/Member-ledger) and skips
    // the List-page block: a typed page is NOT its own section; the ONE list page is rendered once by the base fold.
    const f = foldSubPage(tkey, typedSchemas, foldCtx, { formOnly: true });
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
  if (openCardIsTheWholeStory(am)) parts.push("overrides the default add-card open (custom add flow)");
  return parts;
}

// `openCardByMode` is a FALLBACK signal: it is described only when no other mode was, because on a detail that also
// disables add-new (the stage-history shape) the override is not the thing to build. ONE predicate for the
// description and the guidance — split across two conditions they drift, and the guidance then cites a mode the
// description suppressed while telling the reader to build an add flow the same row forbids.
const openCardIsTheWholeStory = (am) => !!am.openCardOverridden
  && !(am.addDisabled || am.customAction || am.lookup || am.service || am.editableGrid || am.fixedFilters);

// What to BUILD for this add mode, as opposed to what it IS (`describeAddMode`). Conditional: one unconditional
// instruction contradicts the modes it does not fit — "build a CUSTOM add request-handler" on a detail whose own
// text says "add-new DISABLED" asks for an add flow that must not exist. Modes whose `describeAddMode` phrase
// already carries its instruction (customAction, fixedFilters) add nothing here, or it is stated twice.
function addModeGuidance(am) {
  const g = [];
  if (am.lookup || am.service) g.push("Reproduce the add flow with a CUSTOM add request-handler (open the lookup, then create the link records / call the service) — not a default add-new.");
  else if (openCardIsTheWholeStory(am)) g.push("Reproduce the overridden add-card flow with a CUSTOM add request-handler that performs the same open-card logic; do not fall back to the default related-list add.");
  else if (am.addDisabled && !am.customAction) g.push("There is no add flow to reproduce: build it as a read-only / attach-only related list, with no add button.");
  if (am.service) g.push("VERIFY that service is deployed on-stand (else port its logic to a process/service).");
  // no crt.DataGrid inline-edit build recipe here: HOW to enable inline edit (the component
  // property, resolved via get-component-info) is builder mechanics, not plan content. The human fact (this detail
  // is inline-editable, and WHICH columns) is already stated by `describeAddMode`.
  return g;
}

// A detail's label for the worklist. The caption alone is NOT an identity — the stock related-list caption is shared
// by every detail built on that base schema, so several rows on one page would be indistinguishable. Qualify with
// the child entity, the same pair the Layout table identifies it by.
function detailLabel(d) {
  const base = d.caption || d.detailSchema || d.entity || "detail";
  return d.caption && d.entity ? `${base} · ${d.entity}` : base;
}

// Exported for the golden suite. The rendered plan proves the end-to-end path (a real `runMigration` covers the
// openCard branch), but each add-mode combination needs its own assertion and driving them through a full run
// would need one fixture schema per branch. Same reason `detectAddMode` is exported: the unit is the contract
// being pinned, not a shortcut around the renderer.
export function attachDetailAddModes(changeSet, detailSchemas) {
  for (const d of (changeSet.details || [])) {
    const am = detailSchemas[d.detailSchema]?.addMode;
    if (!am) continue;
    d.addMode = am;
    const parts = describeAddMode(am);
    const guidance = addModeGuidance(am);
    const label = detailLabel(d);
    // an INLINE-EDITABLE grid is ALL this detail is (no lookup/service/custom-action/add-disabled/
    // fixed-filters/open-card override) → the row only restates the Layout table's `⚠ INLINE-EDITABLE` note (which
    // even lists the editable columns), with no extra guidance. Flag it so the ⚠ Confirm renderer can drop it as
    // shown-in-table noise, while a detail with a real add mechanism (its guidance has no other home) stays.
    const editableGridOnly = !!am.editableGrid && !(am.lookup || am.service || am.customAction || am.addDisabled || am.fixedFilters || openCardIsTheWholeStory(am));
    changeSet.needsDecision.push({ kind: "detail-add-mechanism", item: label, editableGridOnly,
      reason: `Detail '${label}' is NOT a plain related list — it ${parts.join("; ")}.${guidance.length ? " " + guidance.join(" ") : ""}` });
  }
}

// The mapping-affecting property names, in ONE place. `reportedElsewhere` suppresses a diagnostic on the grounds
// that `reportDynamicMappingProps` already reported it, so the two readers must be the same set: a property dropped
// from one copy and not the other would be reported by NEITHER and vanish from plan.md entirely. Same reason
// `ITEM_KIND_NAME`/`DATAVALUETYPE_CODE` are derived rather than hand-listed — a second literal is drift waiting.
const MAPPING_PROPS = new Set(["visible", "enabled", "readonly", "readOnly", "layout", "hint", "tip", "caption", "required"]);
// A dynamic MAPPING-AFFECTING property (`visible: computeVisibility()`, a bound layout/hint/…) is not structural
// (it doesn't block the gate) but silently collapsed to a DEFAULT in the ChangeSet — surface each as a
// `dynamic-property` decision so the agent wires the real behaviour. Extracted to keep runMigration under CC 15.
function reportDynamicMappingProps(schemas, changeSet) {
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

// EVERY OTHER recorded diagnostic, routed to the member that OWNS it, by path prefix: `attributes.<name>.…` → that
// attribute, `details.<key>.…` → that detail, and so on. A diagnostic with no resolvable owner surfaces as its own
// item — an unrouted gap is still a gap. Without this the reporter above is an allowlist of 9 property names
// deciding what the reader may see, and anything outside it is visible only on the console.
const DIAG_OWNER_ROOTS = { attributes: "attribute", details: "detail", modules: "module", messages: "message",
  businessRules: "business rule", rules: "business rule", mixins: "mixin" };
// Which member a diagnostic path belongs to, as `{ item, ownerNote }`. `schema` may be undefined — a pooled
// diagnostic from a layer whose body is not on hand still routes, it just names `diff[<n>]` instead of the element.
function diagnosticOwner(p, schema) {
  const seg = String(p).split(".");
  if (seg[0] === "diff" && seg[1] !== undefined) {
    const el = (schema?.diff || []).find((o) => o.astIndex === +seg[1]);
    const item = el?.name || el?.bindTo || `diff[${seg[1]}]`;
    return { item, ownerNote: `element '${item}'` };
  }
  if (DIAG_OWNER_ROOTS[seg[0]] && seg[1])
    return { item: seg[1], ownerNote: `${DIAG_OWNER_ROOTS[seg[0]]} '${seg[1]}'`, ownerKind: DIAG_OWNER_ROOTS[seg[0]] };
  return { item: p || "(root)", ownerNote: `\`${p || "(root)"}\`` };
}
// Member kinds whose ledger disposition already tracks `fromTemplate` AND whose diagnostics can actually REACH
// this escalation. Each key reads the `eff.<kind>s` array of the same name.
// Deliberately NOT listed: `detail` and `module` — unreachable, `isStructuralDiag` routes every `details.*` /
// `modules.*` path through `reportedElsewhere` (they sit in `STRUCTURAL_ROOTS` and `seg[0] !== "diff"`
// short-circuits to `true`), the same reason `businessRules`/`rules` are absent. Listing them would suggest a
// generalization this code does not have. Partial mirror of `buildCoverage`'s SOURCES table, which additionally
// counts an inert module (`INERT_MODULE_RX`) and a scaffolding method as template-owned.
const TEMPLATE_OWNED_LIST_KEY = { attribute: "attributes", message: "messages", mixin: "mixins" };
// The set of member NAMES, per ownerKind, that no CLIENT schema touched (`fromTemplate`) — built once per run
// from `eff`, the same source `buildCoverage` reads. A name in this set already gets ledger disposition `context`
// (`disposition()` ranks `decision` above `context`, so escalating a parse gap on one of
// these to `needsDecision` would silently promote it out of `context` — asking a human to resolve a value that
// belongs to the platform's own template, not to anything the client wrote).
function templateOwnedNames(eff) {
  const out = {};
  for (const [kind, listKey] of Object.entries(TEMPLATE_OWNED_LIST_KEY)) {
    out[kind] = new Set((eff[listKey] || []).filter((m) => m.fromTemplate).map((m) => m.name));
  }
  return out;
}
// Already reported in full by another surface: the mapping-property reporter above, or a named gate reason.
// The structural arm MIRRORS the gate's own filter (`computeGate`: `d.role !== "section" && isStructuralDiag(d)`).
// Without the role test this function suppresses every SECTION diagnostic as "the gate reports it" while the gate
// has already excluded sections by design — so a structural section gap would be reported by nobody.
function reportedElsewhere(d, p) {
  const mapped = /^diff\.(\d+)\.values\.(\w+)$/.exec(p);
  return (mapped && MAPPING_PROPS.has(mapped[2])) || (d.role !== "section" && isStructuralDiag(d));
}
// The enum-member case names the member it identified (the actionable part); every other kind names the construct.
function diagnosticGapText(d, p) {
  if (d.detail) return `names \`${d.detail}\`, a member this engine's pinned enum table does not carry — the KIND is known and only its numeric value is missing, so the element is identified but unmapped`;
  const at = p ? " at `" + p + "`" : "";
  return `carries a construct the parser could not read statically (${d.kind}${at})`;
}
// The pool tag for a schema, matching how `parseDiagnostics` tags its entries. Sections are namespaced because a
// section schema and a main schema can legitimately carry the same `pkg`, and they are different bodies to open.
const diagTag = (pkg, role) => (role === "section" ? `section::${pkg}` : String(pkg ?? ""));
// Routes the pkg-tagged diagnostic POOL (not just the main-page chain): main + seed, `detail:<name>`,
// `profile:<name>` and section layers all reach the plan. Taking `schemas` alone would leave four of the five
// layer kinds console-only — the exact failure the block above exists to fix. `schemaByTag` resolves a
// `diff.<n>` path back to its element name; a layer that is not in the map still routes by `diff[<n>]`.
// AC22: the owning member's OWN row must say the value could not be read. The `⚠ Imperative members` table prints
// `needsDecision[].detail` (designspec `imperativeMemberRows` filters `needsDecision`, so the ledger's `SOURCES`
// detail closures are NOT what feeds that cell — worth stating, because it is the obvious wrong place to look).
// Without this the reader saw an EMPTY Detail cell, which reads as "no default", while the correction sat in a
// different section of the plan as a separate `parse-gap` line. Both surfaces now carry it: the worklist line stays
// (it names the body and position to open), and the member's row stops asserting something false about itself.
// Derived from the ownership `reportRemainingDiagnostics` has already computed — ownership is not re-derived here.
const IMPERATIVE_KINDS = new Set(IMPERATIVE_MEMBER_KINDS);
const GAP_PROP_LABEL = { value: "default" };
// The member KIND a diagnostic path belongs to. Matching on the bare owner NAME is not enough and the trap is real,
// not theoretical: a classic diff item is usually named for the column or attribute it binds, so on
// ContentSmartHtmlEditPage a gap at `diff.19.values.itemType` (a diff ITEM) landed on the same-named virtual
// ATTRIBUTE and rendered "⚠ itemType unreadable" on a member that has no itemType at all. A path with no entry
// here (`diff.…`, `properties.…`) marks NOTHING: diff items carry no imperative-member row, and inventing one
// would be worse than the empty cell this is fixing.
const GAP_OWNER_SCOPE = [
  [/^attributes\./, (k) => k.startsWith("attribute")],
  [/^messages\./, (k) => k === "message"],
  [/^mixins\./, (k) => k === "mixin"],
];
function markOwnerRowWithGap(changeSet, owner, gapPath) {
  const path = String(gapPath || "");
  const scope = GAP_OWNER_SCOPE.find(([rx]) => rx.test(path))?.[1];
  if (!scope) return;
  const seg = path.split(".").findLast(Boolean) || "value";
  const marker = `⚠ ${GAP_PROP_LABEL[seg] || seg} unreadable`;
  for (const n of (changeSet.needsDecision || [])) {
    if (n.item !== owner || !IMPERATIVE_KINDS.has(n.kind) || !scope(n.kind)) continue;
    const cur = n.detail ? String(n.detail) : "";
    if (cur.includes(marker)) continue;           // two gaps on one property must not double the same marker
    n.detail = cur ? `${cur} · ${marker}` : marker;
  }
}

function reportRemainingDiagnostics(parseDiagnostics, schemaByTag, changeSet, templateOwned, templateOwnedTags) {
  const seen = new Set();                                        // one row per owner+kind+path+LAYER
  for (const d of parseDiagnostics) {
    const p = String(d.path || "");
    if (reportedElsewhere(d, p)) continue;
    const tag = diagTag(d.pkg, d.role);
    const { item, ownerNote, ownerKind } = diagnosticOwner(p, schemaByTag.get(tag));
    // A member no CLIENT schema touched is inherited base-template content — the coverage ledger already counts
    // it `context` (excluded by design, never a gap). Escalating its parse ambiguity to `needsDecision` would rank
    // it `decision` instead (disposition() ranks decision above context) and hand a human a platform-owned value
    // that isn't theirs to resolve and carries no new information.
    // `templateOwned` is built from `eff` (main + seed chain ONLY, see call site) and keyed by NAME alone — a
    // detail/profile/section schema can declare its own member under a name that collides with an unrelated
    // template-owned main-page member. `templateOwnedTags` gates the lookup to diagnostics that actually came
    // from the main/seed chain `eff` was merged from, so a same-named member from a different layer never
    // borrows another layer's disposition.
    if (ownerKind && templateOwnedTags?.has(tag) && templateOwned?.[ownerKind]?.has(item)) continue;
    // The layer is part of the key, not just the text: two genuinely different occurrences at the same path in
    // different packages are two gaps, and collapsing them hides the base-layer one behind the client layer.
    const key = `${item}|${d.kind}|${p}|${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Named rather than nested inside `where`: the section note is a second, independent condition, and reading two
    // ternaries in one template made the package arm look like it depended on the role.
    const sectionNote = d.role === "section" ? " (section schema)" : "";
    const where = d.pkg ? ` in \`${d.pkg}\`${sectionNote}` : "";
    changeSet.needsDecision.push({ kind: "parse-gap", item,
      reason: `${ownerNote}${where} ${diagnosticGapText(d, p)}. Read the classic body at that position and record the real value/behaviour — this is NOT a resolved default, and nothing downstream can see it unless it is answered here.` });
    markOwnerRowWithGap(changeSet, item, p);
  }
}

// A column path as clio's `IsSchemaPath` accepts it: a LETTER, then letters/digits/`_`/`.`. clio validates with
// `char.IsLetter`/`char.IsLetterOrDigit`, which are Unicode-aware — an ASCII-only `[A-Za-z][\w.]*` rejects output
// clio legitimately returns, so the class is spelled with Unicode properties to match the producing contract.
const RESOLVED_COLUMN_PATH = /^\p{L}[\p{L}\p{N}_.]*$/u;
// `profile` BELONGS HERE. `get-classic-list-columns` returns `source: "profile"` for the saved grid
// profile the section ACTUALLY renders, and its own contract says a product section usually resolves to exactly that
// ("A product section usually resolves to profile: its code declares far fewer columns than the list shows").
// Leaving it out of this list rejected the tool's most common and most accurate answer as MALFORMED, and the run then
// had to re-read with `ignore-profile=true` — which returns the STATICALLY declared set, i.e. deliberately fewer
// columns than the list shows. Measured on the Applicant run: one wasted round-trip and a worse column set.
// Accepting it is not the same as trusting it blindly: a profile can be scoped, so a profile-sourced set RAISES a
// ⚠ Confirm decision (see `listColumnsDecision`) instead of being silently adopted as the section's default.
const RESOLVED_COLUMN_SOURCES = ["profile", "schema-default", "entity-default", "none"];

// Validate + normalize a `get-classic-list-columns` response supplied as `manifest.section.listColumns`.
// RECOVERABLE failures return `{ error }` — the caller routes them into the STRUCTURE gate so the run still
// produces a `plan.md` that names the cause and the remedy. This is deliberate: clio's resolver returns
// `success:false` for schema-not-found, incomplete metadata, an empty hierarchy, and any application-client
// exception (network / auth / unreachable stand), i.e. environment and staleness conditions — exactly what a gate
// is for. Throwing here would abort before any gate is computed and yield no plan at all. Only a manifest
// AUTHORING error (a missing `listColumns` key in `sectionInput`) stays loud — a missing PROVENANCE anchor does
// not, because `planMeta` is declared optional in the manifest header and SKILL.md's Known-Traps entry tells the
// agent to add `section.listColumns` without mentioning `planMeta`, so following the docs must still yield a plan.
// SHAPE + PROVENANCE: is this a well-formed response, and is it evidence for the section we are migrating?
// Returns the gate reason, or null. Own fn so `normalizeResolvedListColumns` stays under Sonar CC 15 (S3776) and
// each rejection is a separately named check rather than one condition guarding several distinct cases.
function resolvedColumnProvenanceIssue(value, expectedEntity, expectedSectionSchema) {
  if (!RESOLVED_COLUMN_SOURCES.includes(value.source) || !Array.isArray(value.columns)) {
    const shape = Array.isArray(value.columns) ? `${value.columns.length} column(s)` : "a non-array `columns` field";
    return `list-column evidence is malformed: source ${JSON.stringify(value.source ?? null)} (expected one of ${RESOLVED_COLUMN_SOURCES.join(" | ")}) with ${shape} — re-run \`get-classic-list-columns\``;
  }
  // clio echoes `sectionSchema` back as the CALLER's own spelling (`sectionSchemaName.Trim()`) while resolving the
  // hierarchy case-insensitively (`OrdinalIgnoreCase`), so `--schema-name applicant1section` legitimately returns
  // lowercase. Compare the way the producer resolves, or a casing difference reads as evidence for another section.
  const sameName = (a, b) => typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
  // `manifest.entity` is the SECOND half of the anchor and is skipped when it is the parser's `"?"` stub: comparing
  // good evidence against a stub would gate it as "belongs to another section". `sectionSchema` is what clio was
  // actually asked for, so it always carries the comparison.
  const anchoredEntity = typeof expectedEntity === "string" && expectedEntity.trim() && expectedEntity.trim() !== "?"
    ? expectedEntity : null;
  if ((anchoredEntity && !sameName(value.entity, anchoredEntity)) || !sameName(value.sectionSchema, expectedSectionSchema)) {
    return `list-column evidence belongs to another section — expected ${expectedSectionSchema}/${anchoredEntity ?? "any entity"}, got ${value.sectionSchema ?? "?"}/${value.entity ?? "?"}; re-run \`get-classic-list-columns\` for ${expectedSectionSchema}`;
  }
  return null;
}

// The COLUMN SET itself: every entry usable, and the count consistent with the DECLARED source (`none` ⇒ empty,
// anything else ⇒ non-empty). Returns `{ error }` or the deduped `{ columns }`.
// Entries are validated in the RESPONSE's OWN order and reported with the RESPONSE's OWN index, because the message
// is a gate reason rendered into `plan.md` that tells the user to re-read `columns` — an index into a deduped,
// name-mapped array would point at a different entry. A SHAPE defect (neither a string nor an object carrying
// `name`) gets its own message: reporting it as an unusable *path* describes the wrong defect.
function resolvedColumnSet(source, entries) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const name = typeof entry === "string" ? entry : entry?.name;
    if (typeof name !== "string") {
      return { error: `list-column evidence carries a malformed entry at index ${i}: ${JSON.stringify(entry ?? null)} — every entry must be a column-path string or an object carrying \`name\` — re-run \`get-classic-list-columns\`` };
    }
    if (!RESOLVED_COLUMN_PATH.test(name)) {
      return { error: `list-column evidence carries an unusable column path at index ${i}: ${JSON.stringify(name)} — re-run \`get-classic-list-columns\`` };
    }
  }
  // Dedupe AFTER the per-entry checks, so repeats never read as rejected entries and never shift a reported index.
  const columns = [...new Set(entries.map((entry) => typeof entry === "string" ? entry : entry.name))];
  if (source !== "none" && !columns.length) {
    return { error: `list-column evidence declares source '${source}' but carries no columns — re-run \`get-classic-list-columns\`` };
  }
  if (source === "none" && columns.length) {
    return { error: `list-column evidence declares source 'none' but carries ${columns.length} column(s): ${columns.join(", ")} — re-run \`get-classic-list-columns\`` };
  }
  return { columns };
}

function normalizeResolvedListColumns(value, expectedEntity, expectedSectionSchema) {
  // The ANCHOR is checked FIRST, before `success`, so how the failure is classified never depends on whether the
  // stand happened to be reachable.
  if (typeof expectedSectionSchema !== "string" || !expectedSectionSchema.trim()) {
    return { error: "list-column evidence cannot be verified: `planMeta.sectionSchema` is not set, so there is nothing to check its provenance against — set `planMeta.sectionSchema` to the section schema the evidence was read for, or drop `section.listColumns` to fall back to the section-chain parse" };
  }
  if (value?.success !== true) {
    return { error: `list-column read failed: ${value?.error || "get-classic-list-columns did not return success:true"} — fix the cause and re-run \`get-classic-list-columns\`, or drop \`section.listColumns\` to fall back to the section-chain parse` };
  }
  const provenance = resolvedColumnProvenanceIssue(value, expectedEntity, expectedSectionSchema);
  if (provenance) return { error: provenance };
  const set = resolvedColumnSet(value.source, value.columns);
  if (set.error) return { error: set.error };
  const columns = set.columns;
  return {
    source: value.source,
    columns,
    notes: Array.isArray(value.notes) ? value.notes.filter((note) => typeof note === "string") : [],
  };
}

// Split `manifest.section` into the *Section replacing chain and the resolved list-column evidence.
// A bare array is the LEGACY shape (chain only). On the object shape a missing `listColumns` key is a manifest
// AUTHORING error → fail loud (same precedent as the manifest guards at 1377/1385): the author chose the enriched
// shape, so the evidence must be there or absent by design, never forgotten. A non-array `schemas` is coerced
// instead, because "no section chain" is already a first-class STRUCTURE issue that designspec renders with its
// own cause + remedy — a gate reason, not an abort.
// `rowActions` — one entry per `DataGridActiveRow…` item the section declares, `{ name, caption?, condition?, package? }`.
// Accepted alongside the fold's own production of these: a run that collected no section bundle
// (no `section.schemas`/`section.seed`) has no fold to read them from, and a row action read by hand off a stand must
// still reach the plan. Unioned with the fold's own entries, and the FOLD wins — see `mergeRowActions`.
function suppliedRowActions(section) {
  const list = Array.isArray(section?.rowActions) ? section.rowActions : [];
  return list.filter((ra) => ra && typeof ra === "object" && typeof ra.name === "string" && ra.name.trim());
}
// `seed` — the section's OWN parent-template chain, the same shape as the top-level `manifest.seed`
// and collected the same way: a SECOND `get-classic-page-sources` call rooted at the *Section schema, whose
// `seed` block is copied here. It is what defines `CombinedModeActionButtonsCardLeftContainer`, `DataGrid` and
// `activeRowActions` (`BaseDataView` [`CrtUIPlatform7x`]), so without it every section element merges onto
// nothing and `templateOwned` is false for the whole tree — base chrome then reads as section-declared, which is
// exactly the distinction the acceptance criteria turn on. OPTIONAL, and deliberately not a fail-loud key like
// `listColumns`: a manifest authored before this existed must keep producing a plan (the fold then reports the
// missing seed through its own `unresolvedParents` / merge-onto-nothing warnings, which say far more than an
// abort would).
const sectionSeedEntries = (section) => (Array.isArray(section?.seed) ? section.seed : []);
function sectionInput(section, manifest) {
  const empty = { schemas: [], seed: [], resolvedListColumns: null, listColumnIssue: null, rowActions: [] };
  if (Array.isArray(section)) return { ...empty, schemas: section };
  if (!section || typeof section !== "object") return empty;
  if (!Object.hasOwn(section, "listColumns")) {
    throw new Error("object-shaped section requires listColumns evidence; use a bare array only for the legacy manifest shape");
  }
  const schemas = Array.isArray(section.schemas) ? section.schemas : [];
  const seed = sectionSeedEntries(section);
  const rowActions = suppliedRowActions(section);
  const resolved = normalizeResolvedListColumns(section.listColumns, manifest.entity, manifest.planMeta?.sectionSchema);
  if (resolved.error) return { schemas, seed, resolvedListColumns: null, listColumnIssue: resolved.error, rowActions };
  return { schemas, seed, resolvedListColumns: resolved, listColumnIssue: null, rowActions };
}

// Provenance of the columns the plan will actually RENDER: the resolver's own `source` when its set is the one
// shown, `schema-default` when the rendered set came from the section-chain parse, and otherwise the resolver's
// verdict (`none`) or nothing at all. Own fn rather than a nested ternary inline (Sonar S3358).
function resolvedColumnSource(useResolved, resolvedListColumns, chainColumns) {
  if (useResolved) return resolvedListColumns.source;
  if (chainColumns.length) return "schema-default";
  return resolvedListColumns?.source ?? null;
}

// Union the *Section chain's list-page signals (add-record mini page, section actions, list columns, quick
// filters, process launch) into one section object — null only when NEITHER section schemas nor resolved list
// columns were supplied AND no on-stand read was rejected. A REJECTED read is evidence too: it is the difference
// between "nobody ever asked" and "we asked and the answer was unusable", and dropping it here is what let the
// rendered line ask for a recording that had already been supplied. Extracted to keep runMigration under CC 15.
// Union the chain's quick filters, first-wins by name. Own fn so analyzeSectionChain stays under Sonar CC 15.
function unionQuickFilters(sectionSchemas) {
  const seen = new Set(), quickFilters = [];
  for (const l of sectionSchemas) for (const f of (l.quickFilters || [])) {
    if (f?.name && !seen.has(f.name)) { seen.add(f.name); quickFilters.push(f); }
  }
  return quickFilters;
}

// The `- **List columns:**` parenthetical: the resolver's own notes (attributed when its set is NOT the one shown),
// the symmetric disagreement note, and the rejected-read disclosure. Own fn so analyzeSectionChain stays under
// Sonar CC 15 (S3776) — the wording rules live together here rather than inline in the union.
function listColumnNotesFor({ resolvedListColumns, resolvedColumns, chainColumns, useResolved, listColumnReadRejected }) {
  // The resolver's notes explain ITS answer. Carrying them unconditionally means that when the resolved set
  // loses, the losing side's justification ("the section declares no static list columns…") lands in the same
  // parenthetical as the winning side's confident clause, with nothing saying which side produced it. Seed them
  // plainly only when the resolved set is what we show; otherwise attribute them to the on-stand read.
  const resolverNotes = resolvedListColumns?.notes || [];
  const notes = useResolved
    ? [...resolverNotes]
    : resolverNotes.map((note) => `the on-stand read reported: ${note}`);
  // The disagreement note is SYMMETRIC — whichever side ends up shown, the other side's finding is reported rather
  // than dropped, so the plan never asserts one reading while the run holds contrary evidence.
  const sameColumns = resolvedColumns.length === chainColumns.length
    && resolvedColumns.every((column, i) => column === chainColumns[i]);
  if (resolvedListColumns && chainColumns.length && !sameColumns) {
    const onStand = resolvedColumns.length
      ? `${resolvedColumns.join(", ")} (source: ${resolvedListColumns.source})`
      : `no default column set (source: ${resolvedListColumns.source})`;
    notes.push(`the on-stand read resolved ${onStand} while the section schema chain declares ${chainColumns.join(", ")} — ${useResolved ? "the on-stand" : "the parsed"} set is shown; confirm on-stand which columns the list really shows`);
  }
  // A rejected read never reaches `resolvedListColumns`, so without this the chain parse would be rendered with the
  // same confident wording as an UNCONTESTED one — the supplied read silently discarded. It is not a disagreement
  // (there is no usable other set to name), just a disclosure pointing at the structure issue that holds the cause.
  if (listColumnReadRejected && chainColumns.length) {
    notes.push("an on-stand list-column read was supplied but could not be used, so this set comes from the section schema chain alone — the cause is named in the list-column issue above");
  }
  return notes;
}

// `sectionActions` folded across the chain, deduped by name. Layers arrive base->top; the TOP declaration wins,
// matching `addRecordMiniPage` below. First-seen position is kept. `group` is renumbered across the merged list,
// because every layer numbers its own groups from 0. Exported as the seam those three rules are asserted through.
// The condition PAIRS one entry contributes, in the `{property, method}` shape the renderers read. An entry that
// carries only the scalar pair contributes that pair: `getSectionActions` reads its condition off the menu node's
// `Enabled` property, so an imperative entry with no `conditionProperty` binds `enabled` — naming that default is
// what makes the two surfaces' conditions comparable at all.
function conditionPairsOf(a) {
  if (a?.conditions?.length) return a.conditions.filter((c) => c?.method);
  if (a?.condition) return [{ property: a.conditionProperty || "enabled", method: a.condition }];
  return [];
}
// Two entries under one name are usually two LAYERS of the same surface (the top one wins), but they can also be
// the SAME button seen on BOTH surfaces: `getSectionActions` knows its `Enabled` binding, the view `diff` knows its
// `visible` one. A plain field-by-field merge overwrote one list with the other, so the losing surface's condition
// existed nowhere — a button Classic enables only on a selection shipped always-enabled. Merge per PROPERTY
// instead: the later entry wins on a property it binds, and a property only the earlier entry binds survives.
function mergeConditionPairs(prev, next) {
  const byProp = new Map();
  for (const c of [...conditionPairsOf(prev), ...conditionPairsOf(next)]) {
    const property = c.property || "enabled";
    byProp.set(property, { ...c, property });
  }
  return [...byProp.values()];
}
export function mergeSectionActions(fromLayers = []) {
  const byName = new Map();
  for (const a of fromLayers) {
    // The name keys the ChangeSet row, the checklist row and the evidence id, so a blank one is not a deliverable.
    const name = typeof a?.name === "string" ? a.name.trim() : "";
    if (!name) continue;
    const prev = byName.get(name);
    // Merge FIELD BY FIELD. A top layer need not repeat every field, and an item carries every key with `null`
    // when absent, so replacing the object (or a plain spread) blanks a value only the base layer declared.
    // `conditions` is merged per property rather than overwritten (see `mergeConditionPairs`); the scalar
    // `condition`/`conditionProperty` pair keeps the existing later-wins precedence, so every renderer and golden
    // that reads it is unchanged — the condition the other surface owns is now also in `conditions`, which is what
    // the command-bar condition cell and the `list-command-bar` decision actually render.
    byName.set(name, prev
      ? { ...prev, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v != null)), name, order: prev.order, conditions: mergeConditionPairs(prev, a) }
      : { ...a, name, order: byName.size });
  }
  const merged = [...byName.values()].sort((x, y) => x.order - y.order);
  const groups = new Map();
  return merged.map((a, i) => {
    const key = `${a.package ?? ""}#${a.group ?? 0}`;
    if (!groups.has(key)) groups.set(key, groups.size);
    return { ...a, order: i, group: groups.get(key) };
  });
}

// Row actions from BOTH sources, deduped by name, the LAYER entry winning: the automated fold is derived from the
// section itself, so a manifest entry supplied while that fold does not exist yet must never mask it once it does.
// EXPORTED as the seam this precedence rule is asserted through. The fold arm is live (it carries
// the `activeRowActions` items `mapSectionView` read), so the rule now decides a real collision rather than a
// hypothetical one.
export function mergeRowActions(fromLayers = [], fromManifest = []) {
  const byName = new Map();
  for (const ra of [...fromLayers, ...fromManifest]) {
    // A name is the element's identity, so a blank or non-string one is not a deliverable: it would reach the
    // plan and the gate as an unnamed row nothing can match. Guarded HERE, not only at the manifest edge,
    // because this is the exported seam both sources go through.
    const name = typeof ra?.name === "string" ? ra.name.trim() : "";
    // Store the TRIMMED name, not just key on it: the stored object's `name` is what reaches the Row actions table
    // and `expect.rowActionNames`, and the gate matches element names EXACTLY — so a padded `" Foo "` deduped under
    // `Foo` would still be published padded and fail against a built `Foo`, the very mismatch this guard exists for.
    if (name && !byName.has(name)) byName.set(name, { ...ra, name });
  }
  return [...byName.values()];
}
// A diff-declared command-bar button in the shape `mergeSectionActions` and the command-bar table already speak.
// `condition` stays a single method name because that is the field every existing renderer and golden reads;
// `conditionProperty` and the full `conditions` list ride alongside it, because WHICH property a condition binds
// (`visible` vs `enabled`) is the difference between a faithful port and an always-enabled button. The real
// Opportunity section carries a button with BOTH, so a single-field shape cannot represent it.
function diffActionAsSectionAction(a) {
  const primary = a.conditions?.[0] || null;
  return {
    name: a.name, caption: a.caption ?? null, icon: null,
    condition: primary?.method ?? null, conditionProperty: primary?.property ?? null,
    conditions: a.conditions || [],
    group: null, parent: a.parent ?? null, package: a.package ?? null,
    // Static literals and the folded menu ride along too. Dropping them here would have put them back exactly
    // where the review found them: computed by `mapSectionView`, and gone by the time the ChangeSet is built.
    staticVisible: a.staticVisible ?? null, staticEnabled: a.staticEnabled ?? null,
    menuItems: a.menuItems || [],
    source: a.source || "sectionDiff",
  };
}
// `sectionView` — what the section declares in its OWN `diff`, read off the folded section view by
// `mapSectionView`. Unioned with the method-body signals below rather than replacing them: the two sources see
// different halves of the same list. `getSectionActions` reads the menu the section builds imperatively; the
// `diff` declares the buttons it inserts into the command bar, and until now only the first half reached the plan.
function analyzeSectionChain(sectionSchemas, resolvedListColumns = null, listColumnReadRejected = false, suppliedRows = [], sectionView = null) {
  if (!sectionSchemas.length && !resolvedListColumns && !listColumnReadRejected) return null;
  const quickFilters = unionQuickFilters(sectionSchemas);
  const chainColumns = [...new Set(sectionSchemas.flatMap((l) => l.listColumns || []))];
  // `[]` is not nullish, so `??` would let an EMPTY resolved set silently discard a chain parse that did find
  // columns. Prefer the resolved set only when it actually carries columns — AND only when it is not the
  // `entity-default` fallback while the chain found something. clio returns `entity-default` (the entity's primary
  // display column, exactly one) precisely BECAUSE the section schema declared none; when our own parse of that
  // chain did find columns, the fallback is the weaker evidence, and preferring it would make the rendered line
  // state the Classic section declares no list columns while this run holds a parse that says otherwise.
  const resolvedColumns = resolvedListColumns?.columns || [];
  const useResolved = resolvedColumns.length > 0
    && !(resolvedListColumns.source === "entity-default" && chainColumns.length > 0);
  const notes = listColumnNotesFor({ resolvedListColumns, resolvedColumns, chainColumns, useResolved, listColumnReadRejected });
  return {
    schemaGathered: sectionSchemas.length > 0,
    listColumnReadRejected,
    addRecordMiniPage: sectionSchemas.findLast((l) => l.addRecordMiniPage != null)?.addRecordMiniPage ?? null,
    // Diff-declared buttons come LAST so that, when one name arrives from both surfaces, the `diff` wins field by
    // field: it is the section's own structural declaration (parent container, index, the property each condition
    // binds), while `getSectionActions` is read out of a method body. Neither entry is dropped — `mergeSectionActions`
    // merges rather than replaces, so a caption only the imperative surface knows still survives.
    sectionActions: mergeSectionActions([
      ...sectionSchemas.flatMap((l) => l.sectionActions || []),
      ...(sectionView?.commandBarActions || []).map(diffActionAsSectionAction),
    ]),
    // Menu helpers no layer in the chain defines. Collected across layers, then cleared by any layer that resolved
    // one: a layer's parse sees only its own src, so the chain resolves what a single src cannot. What survives is a
    // completeness gap and rides into the command-bar decision.
    sectionActionUnresolved: (() => {
      const resolved = new Set(sectionSchemas.flatMap((l) => l.sectionActionHelpers || []));
      return [...new Set(sectionSchemas.flatMap((l) => l.sectionActionUnresolved || []))].filter((n) => !resolved.has(n));
    })(),
    // Helpers and nesting the parser saw but did not read. Not cleared by another layer defining the method: the
    // limit is this parser's one-hop/depth rule, so the items behind it stay missing however the chain resolves.
    sectionActionNotFollowed: [...new Set(sectionSchemas.flatMap((l) => l.sectionActionNotFollowed || []))],
    listColumns: useResolved ? resolvedListColumns.columns : chainColumns,
    listColumnSource: resolvedColumnSource(useResolved, resolvedListColumns, chainColumns),
    listColumnNotes: notes,
    quickFilters,
    // The fold's own row actions now exist (they are the `activeRowActions` items the section declares), and they
    // are passed as the LAYER arm — the arm `mergeRowActions` already documents as winning over a manifest entry,
    // for exactly this moment: a hand-supplied row action must not mask the real one once the engine can read it.
    rowActions: mergeRowActions([
      ...sectionSchemas.flatMap((l) => l.rowActions || []),
      ...(sectionView?.rowActions || []),
    ], suppliedRows),
    // The whole folded reading, carried so the ChangeSet can raise what the surfaces above do not absorb: the
    // declared-but-unmodelled configuration (`controlColumnName` and its family) and any section-declared element
    // the list vocabulary has no reading for. `null` when no section chain was folded.
    sectionView,
    processLaunch: sectionSchemas.some((l) => l.processLaunch),
    processNames: [...new Set(sectionSchemas.flatMap((l) => l.processLaunch?.names || []))],
  };
}

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
// backtracking). engine.mjs documents why the quantifiers are bounded: an unbounded one costs ~32s on 700KB. GUARDED by two goldens in
// engine-tests/classic-to-freedom/run-mapper.mjs — a wall-clock timing bound on a ~700KB adversarial body
// ("ReDoS (timing): detectAddMode …") and a timing-independent structural assert that every `[\s\S]` run stays bounded
// ({0,N}) ("ReDoS (structural) …") — so a future edit reintroducing exponential backtracking fails a test, not prose.
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

// What the detail's own BODY yields. Scan the UNION of layers: a declaration may live in a base replacing layer,
// not the top. All heuristics, but only three are overridable: `detailSchemaRecord` lets the manifest replace
// `editPage` / `editable` / `entity`; `columns` is body-derived only. Own fn for Sonar CC 15.
function detailBodySignals(scanText, p) {
  // the child edit page the detail opens on add/edit; null ⇒ the agent resolves it via list-pages
  const epM = /(?:getEditPageName|editPageName|EditPageSchemaName)[\s\S]{0,80}?["']([A-Za-z]\w+)["']/.exec(scanText);
  // an explicit `false` on the add-record button = view-only; else unknown (the read-only signal for
  // system-maintained details such as stage history)
  const viewOnly = /getAddRecordButtonVisible[\s\S]{0,80}?return\s+false/.test(scanText) || /"?addRecordButtonVisible"?\s*:\s*false/.test(scanText);
  return {
    editPage: epM ? epM[1] : null,                    // getEditPageName match, else null
    editable: viewOnly ? false : null,                // add-record hidden ⇒ view-only, else unknown
    entity: (p.entitySchemaName && p.entitySchemaName !== "?") ? p.entitySchemaName : null,
    columns: [...new Set((p.diff || []).filter((d) => d?.bindTo).map((d) => d.bindTo))],
  };
}

// `opensClassicPage` → `string | true | null`. Anything else (a number, `false`, an empty string) is NOT a recorded
// boundary and must not read as one: `false` in particular means "no, this is not a boundary", so it has to fall to
// `null` rather than to a truthy sentinel. Own fn so both readers share one normalization.
function normalizeBoundary(v) {
  if (typeof v === "string" && v.trim()) return v.trim();
  return v === true ? true : null;
}

// ONE detail-schema entry → its record, always the same shape so callers never type-check the return (the
// counterpart to `profileSchemaRecord`). Per field, a SUPPLIED answer beats a body-derived one: the manifest
// entry is what the agent verified, the scan is only a heuristic.
function detailSchemaRecord(e, scanText, p) {
  const eObj = (e && typeof e === "object") ? e : {};
  const body = detailBodySignals(scanText, p);
  return {
    entity: eObj.entity || body.entity,
    columns: body.columns,
    title: eObj.title || null, // human detail title (from its resources)
    editPage: ("editPage" in eObj) ? eObj.editPage : body.editPage,
    editable: ("editable" in eObj) ? eObj.editable : body.editable, // tags view/attach-only; never a gate answer
    // agent-verified Reuse: the child entity already has a shipped Freedom form page (name supplied here), so
    // the Freedom related list opens that page and the Classic child page is superseded, not rebuilt.
    reuseFreedomPage: (typeof eObj.reuseFreedomPage === "string" && eObj.reuseFreedomPage) ? eObj.reuseFreedomPage : null,
    // USER-approved SECTION BOUNDARY: this child entity owns another section, so its Classic edit page
    // stays Classic and the Freedom related list keeps opening it. A STRING names that page (the honest form — the
    // plan can then print it); `true` declares the boundary and leaves the name to the body's own `editPage` read.
    // Normalized to `string | true | null` here so every reader tests one shape. NOT body-derivable: no detail body
    // states which section its child entity belongs to — that is a stand fact plus a user decision.
    opensClassicPage: normalizeBoundary(eObj.opensClassicPage),
    // Optional, and only ever supplied: the section that child entity belongs to, for the plan's wording. Never
    // inferred — an invented section name in a sentence the user is asked to approve is worse than no name.
    ownSection: (typeof eObj.ownSection === "string" && eObj.ownSection.trim()) ? eObj.ownSection.trim() : null,
    addMode: detectAddMode(scanText), // custom add/edit mechanism (lookup / service / grid / add-disabled) across ALL layers, or null
    error: p.error || null,
    astDiagnostics: p.astDiagnostics || [],
  };
}

// Parse each supplied detail-schema body (#11(ii)/B2) → { entity, columns, title, editPage, editable, addMode … }
// per detail, so the mapper can resolve auto-named (SchemaNDetail) details, show related-list columns, and
// reproduce the real add/edit mechanism. Extracted from runMigration to keep it under Sonar CC 15 (S3776).
function parseDetailSchemas(manifest, bodyOf) {
  const detailSchemas = {};
  for (const [name, e] of Object.entries(manifest.detailSchemas || {})) {
    const { scanText, p } = resolveDetailBody(name, e, bodyOf);
    detailSchemas[name] = detailSchemaRecord(e, scanText, p);
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
// The only dispositions `manifest.memberDispositions` may carry — the same four the gate's remediation line tells an
// agent to use. Kept beside the ledger that reads them so the message and the check cannot drift apart.
const MEMBER_DISPOSITIONS = new Set(["ported", "dropped", "blocked", "n/a"]);
const INERT_MODULE_RX = /^(?:terrasoft|ext-base|Ext|sandbox|css!)/;
// what a method contributes to its ledger row — kept out of the source table so the table stays scannable
const methodLedgerDetail = (m) =>
  m.facts ? { lines: m.facts.lines, kinds: m.facts.kinds, trivial: m.facts.callParentOnly || m.facts.isEmpty } : null;

// A member's disposition, decided by what the pipeline actually produced for it.
function disposition(name, { fromTemplate, mapped, decided, chrome }) {
  if (mapped) return "mapped";
  if (decided) return "decision";
  // Pure decoration carries no migration answer, so `unaccounted` (which blocks the plan) would be wrong and
  // `mapped` (which claims a Freedom artifact) would be false. Ranked BELOW mapped/decision: a real artifact or a
  // recorded answer is the stronger statement and wins. Recorded, never suppressed — the member keeps its ledger
  // row and its place in the totals, so what the engine treated as decoration stays auditable.
  if (chrome) return "chrome";
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
    // `covers` — member ids this decision accounts for besides its own `item` (a mixin's `define()` dependency is a
    // second member of the same declaration). Without it, removing a name from an aggregated row silently drops
    // that member to `unaccounted` and the coverage gate blocks on a member that IS decided, just under another row.
    for (const c of d.covers || []) decided.add(String(c).trim());
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
    // The disposition must be one the CONTRACT names. Any string counted as resolved, so a typo — `"droppped"` —
    // cleared an otherwise unaccounted member and could carry `coverage.complete` to green with no valid answer
    // behind it. The gate's own remediation text emits exactly these four, so this is the same set, not a new rule.
    const agentResolved = dec.resolved === true && MEMBER_DISPOSITIONS.has(dec.disposition);
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
      tpl: (i) => i.templateOwned, mapped: (i) => mapped.has(i.name) || (!!i.bindTo && mapped.has(i.bindTo)),
      // the only kind that can be decoration: it is a property of a view element, not of a method or a message
      chrome: isDecorationItem },
    // a STANDARD framework/scaffolding method (init / onSaved / validator config) is deliberately kept off the
    // worklist by the mapper, so it would otherwise land `unaccounted` and block every page. It is a recorded
    // `context` member — excluded by design and COUNTED — exactly like an inert module dep below.
    { kind: "method", list: eff.methods, name: (m) => m.name, prov: (m) => m.stack,
      // `isScaffoldingMethod`, not the NAME: an overridden `init` carrying real logic is a member to account for,
      // not context. Reading the name alone let it be excluded here at the same time the mapper dropped it from the
      // worklist — accounted for as context on both sides, and absent from the plan.
      tpl: (m) => m.fromTemplate || isScaffoldingMethod(m), mapped: () => false, detail: methodLedgerDetail },
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
        // `?.()` rather than a ternary: only one source row supplies `chrome`, and a conditional here sits two
        // loops deep, where it costs more complexity than the fact it carries.
        chrome: !!src.chrome?.(entry),
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
  if (value && typeof value === "object") return feedPlanObject(h, value, readBody, state, depth);
  h.update("\u0001P");
  h.update(value === undefined ? "null" : (JSON.stringify(value) ?? "null"));
}
// The OBJECT leg of `feedPlanVersion`, extracted so that function stays under Sonar's cognitive-complexity budget.
function feedPlanObject(h, value, readBody, state, depth) {
  // A `{ file: … }` / `{ body: … }` reference contributes its CONTENT, wherever in the manifest it sits — not
  // only inside a `schemas`/`seed` array. Before this, `section` entries and file-backed `detailSchemas` /
  // `profileSchemas` were walked generically, which hashed the PATH STRING: editing one of those files changed
  // the rendered plan and left `planVersion` identical, so an old approval authorised a plan the user never saw.
  // Reproduced on a two-file manifest: same version before and after rewriting the detail body.
  // The remaining keys (`title`, `entity`, …) are still hashed below; only `body`/`file` are replaced by content.
  if (typeof value.file === "string" || typeof value.body === "string") {
    h.update("\u0001B");
    h.update(schemaBodyFor(value, readBody));
    h.update("\u0001");
  }
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
    // `body`/`file` were already replaced by CONTENT above; hashing the raw path here as well would put the
    // temp-directory name back into the version and break re-planning the same bodies from a fresh folder.
    if ((k === "file" || k === "body") && (typeof value.file === "string" || typeof value.body === "string")) continue;
    h.update(k);
    h.update("\u0001");
    feedPlanVersion(h, value[k], k, readBody, state, depth + 1);
  }
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

// The SETTLE clause of a `registry-target` ⚠, branched BY CAUSE. A missing component must not get one
// blanket "settle the target before building" whether it was a real component an install could recover or a name no
// action short of a re-plan can fix. The finding carries the row's structured `{kind,id}` gate, so the guidance
// can say the actionable thing:
//   • a VERSION-scoped miss (`component-absent-in-version`) — the component IS registered, just not carried by the
//     target platform version, so no package install can add it; target a version that carries it (or re-plan). This
//     branch is checked FIRST, by KIND: a gate-only branch would wrongly tell an operator to install a package for a
//     gated composite that is absent in a version, when the plan/version is the real lever.
//   • a gated COMPOSITE (a `gate.id` package, sometimes a `gate.feature`) — install/enable it and re-run the BUILD;
//     the plan is correct, so this is explicitly NOT a re-plan.
//   • anything else (no row gates the type — a fabricated `crt.*`, or a real component simply absent on the target)
//     — fix the mapping or the plan and re-run `--plan --out`, because no package install makes it appear.
// Pure and exported so the branch is unit-testable without driving a whole migration (mirrors placementIssues).
export function registrySettleGuidance(finding) {
  if (finding?.kind === "component-absent-in-version") {
    return "this is not a package-install away — the component is registered but absent in this platform version; target a version that carries it, or re-plan, before building.";
  }
  const g = finding?.gate;
  // Branch on the gate's KIND, not on `id` truthiness: `composite` is what selects the install/enable text, and an
  // unrecognized kind must NOT (a gate whose taxonomy the guidance does not read cannot be turned into an
  // instruction). `id` is still required because it IS the instruction — `gateShapeIssues` makes both a hard table
  // error, so a malformed gate fails the table check instead of silently degrading to the re-plan branch here.
  if (g?.kind === GATE_KIND.COMPOSITE && typeof g.id === "string" && g.id) {
    const feat = g.feature ? ` and enable the \`${g.feature}\` feature` : "";
    return `install the \`${g.id}\` package${feat} on the stand, then re-run the BUILD — the plan is correct, so no re-plan is needed.`;
  }
  return "this is not a package-install away — fix the mapping or the plan and re-run `--plan --out` before building.";
}
// The compositeOnly ADVISORY, computed by `validateRun` and otherwise discarded. A
// compositeOnly type deliberately carries NO gate: the platform assembles it as part of a composite and it has no
// Designer toolbar entry, so it cannot be inserted directly. Surface each as a `registry-composite-only`
// needsDecision item with GENERIC guidance — reach it through its composite host/recipe — NOT install/enable text:
// on the failing run the package WAS installed and the feature enabled, so an install/enable instruction would
// have been wrong. (Absent a gate, `registrySettleGuidance` is not called here.)
//
// SCOPE — only a compositeOnly type the BUILD AGENT must place STANDALONE (a standard-feature / profile-card
// deliverable). A compositeOnly type the ENGINE already positioned in the view (`viewConfigDiff` / `tableElements`
// — every container and field, e.g. `crt.TabContainer` / `crt.HeaderContainer`, most of which are compositeOnly)
// needs no "reach it via its host" advice: the engine placed it, the agent never drags it from a toolbar. Surfacing
// those would flood the worklist (the majority of registry types are compositeOnly) and blame the operator for a
// type the engine chose — the same rule the registry-target check already honours. Extracted from
// reportRegistryFindings (Sonar S3776) alongside `collectResolvedGates`.
export function buildCompositeOnlyDecisions(changeSet, regRun, sourceNote) {
  const enginePositioned = new Set();
  for (const op of changeSet.viewConfigDiff || []) if (op?.values?.type) enginePositioned.add(op.values.type);
  for (const el of changeSet.tableElements || []) if (el?.componentType) enginePositioned.add(el.componentType);
  // a STANDARD FEATURE's gate type (crt.FileList = Attachments, crt.ApprovalList = Approvals, …) is
  // ALREADY a row in the Layout table ("template-provided" / "native"), and that these features are composite
  // (built via their recipe, not dragged from a toolbar) is general Creatio knowledge the skill already carries.
  // Re-stating it as a per-plan ⚠ Confirm just duplicates the Layout, so skip a composite-only advisory whose type
  // is a standard feature present on this page. A NON-standard composite-only type the agent must place standalone
  // has no Layout row and keeps its advisory.
  const featureTypes = new Set();
  for (const f of changeSet.standardFeatures || []) { const t = featureVerifyType(f.feature); if (t) featureTypes.add(t); }
  for (const a of regRun.advisories || []) {
    if (a.kind !== "composite-only" || enginePositioned.has(a.componentType) || featureTypes.has(a.componentType)) continue;
    changeSet.needsDecision.push({ kind: "registry-composite-only", item: a.componentType,
      reason: `this run emits \`${a.componentType}\` — ${a.why} — but it is a COMPOSITE-ONLY component: the platform assembles it as part of a composite and it has no Designer toolbar entry, so it cannot be inserted directly. Reach it through its composite host/recipe (the page/recipe that owns it) rather than adding it as a standalone element. ${sourceNote}.` });
  }
}
// REGISTRY CHECK, at RUN time, lifted out of `runMigration` (Sonar CC 15): it is a self-contained pass that
// reads the manifest and appends to `changeSet.needsDecision`, and inside the driver its guards also carried
// that function's nesting weight.
//
// TEST-ONLY EXPORT — no production caller outside this module. `runMigration` is the public surface; this is
// exported (like `buildCoverage` / `registrySettleGuidance`, the same convention) so a test can drive it against a
// hand-built changeSet. The decision to KEEP it is taken explicitly rather than left implicit.
// The reason it cannot be replaced by an end-to-end fixture is a property of the mapper, not a gap in the tests:
// `resolveProps` ALWAYS also writes `values.type` for a table element, so in any changeSet a real run can produce,
// the `viewConfigDiff` source of `enginePositioned` already covers every type the `tableElements` source would —
// a "realistic fixture that naturally emits a table element" therefore cannot isolate the `tableElements` branch,
// because the other branch would satisfy the assertion first. Deleting that line would leave the e2e test green.
// The branch's OUTCOME is covered end-to-end regardless (`run-mapper.mjs` asserts the `registry-composite-only`
// items `runMigration` does and does not push); this export exists solely so the tableElements SOURCE has a
// non-vacuous test of its own. Do not call it from production code.
export function reportRegistryFindings(changeSet, manifest, baseDir) {
  // REGISTRY CHECK, at RUN time. The CI check proves the TABLE is sound; this one judges what THIS run emits
  // against the registry it could resolve — the stand's own export when the manifest carries one, else the
  // vendored index. Same severity rule as the CI check, so a finding cannot mean two things.
  //
  // A missing component is a needsDecision item, not a gate block, and the reason is that the source can be
  // WEAKER than the run: with no `componentRegistry` and no `platformVersion` the check runs against a UNION of
  // seven versions, and blocking a plan on a union check would stop a migration whose stand is simply newer than
  // the vendored index. The item states which source answered, so an operator can tell "your stand does not carry
  // this" from "nobody asked your stand".
  // The reader is CONTAINED the same way `bodyOf` contains a schema entry's `file`: a RELATIVE path must resolve
  // under the manifest's base dir, an ABSOLUTE one is an explicit caller choice (the harvested manifests live in a
  // temp dir outside the repo, so absolute paths are the normal case). A manifest is operator-supplied, not the
  // untrusted stand input the parser pin guards — but the repo already treats manifest paths this way and one
  // surface behaving differently is how the next reader learns the wrong rule.
  const readRegistryFile = (f) => {
    if (!path.isAbsolute(f)) {
      const base = path.resolve(baseDir);
      const resolved = path.resolve(base, f);
      if (resolved !== base && !resolved.startsWith(base + path.sep))
        throw new Error(`relative path '${f}' escapes the manifest base directory`);
      return fs.readFileSync(resolved, "utf8");
    }
    return fs.readFileSync(f, "utf8");
  };
  const reg = resolveRunIndex(manifest, { readFile: readRegistryFile });
  const regRun = validateRun(changeSet, { index: reg.index, version: reg.version });
  const REG_SOURCE_NOTE = {
    "stand-export": `checked against the TARGET STAND's own component registry (version ${reg.version})`,
    "vendored-pinned": `checked against the engine's vendored component index, pinned to ${reg.version}`,
    "vendored-union": `checked against the engine's vendored component index, over the UNION of ${reg.index.meta.versions.length} platform versions — a type present in ANY of them passes, so this does NOT prove the target stand carries it; supply \`manifest.componentRegistry\` (the stand's registry export) or \`manifest.platformVersion\` to make it a real per-version check`,
    "unreadable-export": `the manifest NAMED a component registry (\`${reg.file || "?"}\`) but the engine could not read it (${reg.error || "unknown error"}) — this run fell back to the vendored index, so nothing here reflects your stand`,
  };
  if (reg.source === "unreadable-export")
    changeSet.needsDecision.push({ kind: "registry-source", item: "componentRegistry", reason: REG_SOURCE_NOTE["unreadable-export"] });
  for (const f of regRun.findings) {
    const where = f.presentIn ? ` (the registry carries it in ${f.presentIn.join(", ")})` : "";
    // The verdict clause is its own statement: the two arms differ (one names no version at all), and nesting the
    // version arm inside the sentence made the reason a three-deep template nobody could read at the call site.
    const verdict = f.kind === "unknown-component"
      ? "the component registry carries NO component of that name"
      : `it is ABSENT in ${f.version}`;
    // carry the row's structured gate on the item (so a consumer branches by kind, not by string), and
    // let the SETTLE clause say the actionable fix for THIS cause instead of one blanket sentence for every miss.
    changeSet.needsDecision.push({ kind: "registry-target", item: f.componentType, gate: f.gate || null,
      reason: `this run emits \`${f.componentType}\` — ${f.why} — and ${verdict}${where}. ${REG_SOURCE_NOTE[reg.source]}. A page built on a type the stand cannot resolve does not render, so ${registrySettleGuidance(f)}` });
  }
  buildCompositeOnlyDecisions(changeSet, regRun, REG_SOURCE_NOTE[reg.source]);
}

// Read one schema entry's body — inline `body`, else its `file` read from under `baseDir`. Module-level so its
// path-safety branches don't count against runMigration's cognitive complexity (Sonar S3776).
function readSchemaBody(e, baseDir) {
  if (e?.body != null) return String(e.body);
  // E5: a clear error (not a cryptic `path.resolve(baseDir, undefined)` TypeError) when an entry has neither an
  // inline body nor a string `file`; and contain the path so a `file: "../…"` can't read outside baseDir.
  if (!e || typeof e.file !== "string" || !e.file)
    throw new Error(`schema entry for pkg '${e?.pkg ?? "?"}' has neither an inline 'body' nor a string 'file'`);
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, e.file);
  // Containment applies to EVERY `file`, relative OR absolute — otherwise an arbitrary file can be read: the manifest is
  // stand-derived / untrusted, so a `file` that resolves outside the manifest base dir — a `../…` escape OR an
  // absolute path like `/etc/passwd` — is refused, never read into the plan. A caller that legitimately needs files
  // from a directory sets `baseDir` to contain them (the golden fixtures pass `baseDir: FIX` with relative `file`s);
  // no real manifest uses `file` at all (bodies are inlined), so nothing depends on reading outside `baseDir`.
  if (resolved !== base && !resolved.startsWith(base + path.sep))
    throw new Error(`schema 'file' escapes the manifest base directory (path traversal): '${e.file}'`);
  return fs.readFileSync(resolved, "utf8");
}

// The "matched nothing on the whole surface" index reports — only the ROOT run can judge them (a folded scope sees
// one page's rows, so a sibling's answer would look unmatched). Assigns all three so its three root/else branches
// don't count against runMigration's cognitive complexity (Sonar S3776).
function assignRootIndexKeys(behaviourIndex, scopeSchema, behaviourIndexInput, stubIndex) {
  const root = !scopeSchema;
  behaviourIndex.unmatched = root ? unmatchedIndexKeys(behaviourIndexInput, stubIndex) : [];
  behaviourIndex.wiringOnly = root ? wiringOnlyKeys(behaviourIndexInput, stubIndex) : [];
}
// THE run's entity: the manifest's own value when it named a real one, else the entity the merged schema chain
// reports. The list page's data-source and the result's `entity` must name the SAME object. Module-level (S3776).
function resolveRunEntity(manifest, eff) {
  return manifest.entity && manifest.entity !== "?" ? manifest.entity : eff.entity;
}
// The design-spec options for a SUB-PAGE render (child / mini / typed per-type form): always `embedded` (it is only
// ever nested into the parent plan), with `formOnly` propagated for the typed fold (checklistOpts carries
// isChildPage/isMiniPage but NOT formOnly). A record page (none of these) renders with the plain specOpts. Module-
// level so its branching does not count against runMigration's cognitive complexity (Sonar S3776 — review Rita).
function subPageSpecOpts(specOpts, opts) {
  if (!(opts.isChildPage || opts.isMiniPage || opts.formOnly)) return specOpts;
  return { ...specOpts, embedded: true, ...(opts.formOnly ? { formOnly: true } : {}) };
}
// Count needsDecision entries by kind → { kind: n }. Module-level so its loop doesn't count against runMigration.
function tallyByKind(decisions) {
  const out = {};
  for (const d of decisions) out[d.kind] = (out[d.kind] || 0) + 1;
  return out;
}
// The parse-diagnostic POOL — every schema body's AST diagnostics, tagged by owner (main/seed, detail:<n>,
// profile:<n>, section) so each routes back to the body it came from. Module-level so its per-source `|| []` guards
// don't count against runMigration's cognitive complexity (Sonar S3776). Detail/profile structural diagnostics
// block the gate like a main one; section diagnostics carry `role:"section"` and are advisory (never merged).
function collectParseDiagnostics(schemas, seedTemplate, detailSchemas, profileSchemas, sectionSchemas, sectionParseErrors) {
  return [
    ...[...schemas, ...seedTemplate].flatMap((l) => (l.astDiagnostics || []).map((d) => ({ pkg: l.pkg, ...d }))),
    ...Object.entries(detailSchemas).flatMap(([name, d]) => (d.astDiagnostics || []).map((x) => ({ pkg: `detail:${name}`, ...x }))),
    ...Object.entries(profileSchemas).flatMap(([name, p]) => (p.astDiagnostics || []).map((x) => ({ pkg: `profile:${name}`, ...x }))),
    ...sectionSchemas.flatMap((l) => (l.astDiagnostics || []).map((d) => ({ pkg: l.pkg, role: "section", ...d }))),
    ...sectionParseErrors.map((e) => ({ pkg: e.pkg, role: "section", path: "", kind: `section parse error: ${e.error}` })),
  ];
}

export function runMigration(manifest, opts = {}) {
  const baseDir = opts.baseDir || ".";
  const bodyOf = (e) => readSchemaBody(e, baseDir);
  const parse = (list) => (Array.isArray(list) ? list : []).map((e) => parseSchema(bodyOf(e), e.pkg));
  const schemas = parse(manifest.schemas);
  const seedTemplate = parse(manifest.seed);
  // section-schema schemas (optional) — the *Section chain. Analyzed for list-page concerns the page
  // migration does not cover: add-record mini page, section actions (#8b), list columns (#2).
  const sectionData = sectionInput(manifest.section, manifest);
  const sectionSchemas = parse(sectionData.schemas);
  // the section folded over its own template seed, computed ONCE and read by both the step-5.1 stub
  // digest below and the list-page mapping further down. See `foldSectionView`.
  const sectionSeed = parse(sectionData.seed);
  const sectionEff = foldSectionView(sectionSchemas, sectionSeed);
  // The section chain digested as its own step-5.1 scope (0 or 1) — see `sectionStubScopes` for the root-only
  // guard, the never-null schema label, and why it is a function rather than inline here.
  const sectionChangeSet = sectionChangeSetOf(manifest, opts, sectionEff);
  const sectionScopes = sectionStubScopes(manifest, opts, sectionChangeSet);
  const eff = mergeHierarchy(schemas, { seedTemplate }); // isMiniPage is consumed downstream (mapToFreedom / renderDesignSpec), NOT by mergeHierarchy — don't pass an inert arg here
  // #11(ii)/B2 — parse each supplied detail-schema body to recover its child entity + list columns + add mode.
  const detailSchemas = parseDetailSchemas(manifest, bodyOf);
  // the embedded profile schemas a profile card renders (profiled entity + displayed columns).
  const profileSchemas = parseProfileSchemas(manifest, bodyOf);
  // RUN-level on-stand signals (see checklistOpts, which performs the same merge for the row renderers): the
  // answers live on the ROOT manifest, so a fold inherits them and a sub-bundle's own key still wins.
  const runSignals = { ...plainObject(opts.inheritedSignals), ...plainObject(manifest.signals) };
  const changeSet = mapToFreedom(eff, {
    entityColumns: manifest.entityColumns || {},
    resources: manifest.resources || {},     // #5/#13 — localizable strings for tab/group/detail captions
    columnTitles: manifest.columnTitles || {}, // #5/#13 — entity column titles for field LABELS
    detailSchemas,                            // #11(ii)/B2 — parsed detail bodies (entity + columns + title)
    profileSchemas,                           // parsed embedded-profile bodies (entity + displayed columns)
    isMiniPage: !!opts.isMiniPage,            // mini-page fold → suppress add-mode visibility-rule noise
    isChildPage: !!opts.isChildPage,          // child edit page → build its base-page (entity-bound) fields too, don't suppress as template context
    signals: runSignals,                      // on-stand signals (dcm/…) — run-level answers, inherited by every fold
    ownSignals: plainObject(manifest.signals), // …and THIS bundle's own keys alone, so a child page can tell an answer recorded for ITS entity from the parent's
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
    // a detail-schema body that FAILED to parse must reach the gate too — otherwise its columns/child
    // page silently resolve to null while the plan stays green. Its error was captured per-detail above.
    ...Object.entries(detailSchemas).filter(([, d]) => d.error).map(([name, d]) => ({ pkg: `detail:${name}`, error: d.error })),
    // same rule for a profile-schema body: if it failed to parse, the card's entity/columns are
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
  const parseDiagnostics = collectParseDiagnostics(schemas, seedTemplate, detailSchemas, profileSchemas, sectionSchemas, sectionParseErrors);
  // a dynamic MAPPING-AFFECTING property (`visible: computeVisibility()`, a bound layout/hint/…) is
  // NOT structural, so it doesn't block the gate — but it silently collapsed to a DEFAULT in the ChangeSet
  // (e.g. visible:true) with no trace in the plan. Surface each as an explicit needsDecision so it lands in
  // the plan's ⚠ Confirm: the agent must wire the real dynamic behavior, not ship the static default.
  reportDynamicMappingProps(schemas, changeSet);
  // …and every OTHER recorded diagnostic in the POOL, routed to its owning member. Keyed the same way
  // `parseDiagnostics` tags its entries, so a `diff.<n>` path resolves against the body it actually came from.
  const mainChainTags = new Set([...schemas, ...seedTemplate].map((l) => diagTag(l.pkg)));
  const diagSchemaByTag = new Map([
    ...[...schemas, ...seedTemplate].map((l) => [diagTag(l.pkg), l]),
    ...Object.entries(detailSchemas).map(([name, d]) => [diagTag(`detail:${name}`), d]),
    ...Object.entries(profileSchemas).map(([name, p]) => [diagTag(`profile:${name}`), p]),
    ...sectionSchemas.map((l) => [diagTag(l.pkg, "section"), l]),
  ]);
  reportRemainingDiagnostics(parseDiagnostics, diagSchemaByTag, changeSet, templateOwnedNames(eff), mainChainTags);
  // ENUM DRIFT, advisory arm. `computeGate` consumes `mismatches` (the arm that BLOCKS); this is the other severity
  // the drift guard is specified to have: a member only the STAND carries. It must NOT block — blocking would stop
  // every migration the day a platform release adds a member — but it must reach the plan, because it is the only
  // PROACTIVE staleness signal there is. The per-element `unknown-enum-member` ⚠ fires only once some page body
  // happens to name the member; this fires on the vocabulary itself, so an operator on a newer platform is told the
  // engine's table is short before a page depends on it. Computed here rather than in `computeGate` precisely so it
  // cannot be mistaken for a gate reason.
  const driftAdvisory = enumDriftIssues(manifest.enumVocabulary);
  if (driftAdvisory.newMembers.length)
    changeSet.needsDecision.push({ kind: "enum-drift-advisory", item: "enumVocabulary",
      reason: `the stand carries enum member(s) this engine does not pin: ${driftAdvisory.newMembers.join("; ")}. What the engine DOES know is still correct — this does not block. An element of one of these kinds is identified by name but has no numeric value, so add the member(s) to the pinned table in engine.mjs from this platform version's \`sysenums.js\`.` });
  reportRegistryFindings(changeSet, manifest, baseDir);

  // section analysis — union the signals across the section schema chain (last-wins for the mini page).
  const section = analyzeSectionChain(sectionSchemas, sectionData.resolvedListColumns, sectionData.listColumnIssue != null, sectionData.rowActions, mapSectionView(sectionEff));
  // …and the LIST-PAGE ChangeSet built from those signals — the positioned machine artifact the build step consumes,
  // so the list page is a deliverable on the same footing as the form page. Signals alone render only as prose, which
  // no build step can consume. `null` when the run has no section (mini/child scope).
  // THE run's entity, resolved once: the manifest's own value when it named a real one, else the entity the merged
  // schema chain reports. Hoisted rather than repeated at each consumer, because the list page's data-source op and
  // the result's `entity` must name the SAME object — a ChangeSet that binds PDS to a different schema than the plan
  // states is a page built on the wrong table.
  const resolvedEntity = resolveRunEntity(manifest, eff);
  const listChangeSet = buildListChangeSet({ entity: resolvedEntity, section,
    entityColumns: manifest.entityColumns, sectionCode: sectionCodeForList(sectionChangeSet) });
  // The same fold for the list page's rows, scoped to the section schema so a `<Section>::<method>` key resolves
  // against them. The return is dropped: the run's coverage accounting stays the page's.
  if (listChangeSet) applyBehaviourIndex(listChangeSet, behaviourIndexInput, sectionScopeLabel(manifest));
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
  const foldCtx = { visited: new Set([...visited, ...selfKeys]), memo, memoStats, baseDir, behaviourIndexInput, checklistOpts: specOpts, targetPackage: runTargetPackage, signals: runSignals }; // shared fold context for foldSubPage (child/typed/mini)
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
  const stubIndex = dedupeStubScopes([
    // No schema NAME for this scope on purpose: the engine parses layer BODIES (keyed by package), so the record
    // page's own schema name is not something it knows. `planMeta.sectionSchema` names the SECTION, a different
    // schema — putting it here would label record-page rows with the list page's name.
    stubScope("main page", opts.scopeSchema || null, changeSet, changeSet.standardMethodsFiltered),
    ...(miniPage?.stubScope ? [miniPage.stubScope] : []),
    ...typedPages.flatMap((t) => [...(t.stubScope ? [t.stubScope] : []), ...(t.childStubScopes || [])]),
    ...childPages.flatMap((c) => [...(c.stubScope ? [c.stubScope] : []), ...(c.childStubScopes || [])]),
    // SECTION SCOPE — the *Section chain can carry real custom code (a bulk section action's methods, a mixin
    // added by an ExtendParent layer). analyzeSectionChain extracts only the fixed list-page facts (filters /
    // action names / columns), so without this scope those rows never reach the step-5.1 handoff and the
    // behaviour analysis structurally cannot see list-page behaviour. Placed LAST: consumers take stubIndex[0]
    // as the record page and nested runs slice(1) for child scopes — a section entry must not shift those.
    ...sectionScopes,
  ]);
  assignRootIndexKeys(behaviourIndex, opts.scopeSchema, behaviourIndexInput, stubIndex);
  const decisionSummary = tallyByKind(changeSet.needsDecision);
  // ⛔ HARD GATE (RV1) — the four correctness signals, computed ONCE here so the CLI, the renderer, and any
  // caller share one verdict instead of each re-deriving it (or, as before, never checking it at all). This
  // does NOT throw — runMigration stays pure so the golden runner can assert blocked/clean states; the CLI
  // turns `blocked` into a loud banner + non-zero exit, and the renderer prints the banner into the artifact.
  // The operator's recorded answers on FIDELITY warnings, folded in BEFORE the gate and the renderer read them, so
  // one annotated array is what every surface reports.
  eff.warnings = applyWarningDispositions(eff.warnings, manifest);
  const gate = computeGate({ parseErrors, eff, manifest, parseDiagnostics, childPages, typedPages, miniPage });
  // …and the LIST page's own verdict, on the section's evidence alone. Separate from `gate` on purpose:
  // see `computeListGate` for why a section-side gap must stop the list deliverable without stopping the form one.
  const listGate = computeListGate({ sectionParseErrors, parseDiagnostics, sectionEff });
  // ⛔ STRUCTURE VALIDATOR — a systemic completeness check on the MANIFEST INPUTS, so the plan cannot be
  // generated clean while the agent skips the parts it kept dodging (detail schemas, child-page mappings).
  // Unlike the SKILL rules this is enforced in code: the CLI turns `!complete` into a loud banner + non-zero
  // exit, and the renderer prints it into the plan — the agent literally can't present a clean plan without
  // supplying the schemas. This is INPUT completeness (distinct from the correctness `gate` above).
  const structure = validateStructure({ manifest, changeSet, childPages, typedPages, section, miniPage, miniPageVerified, visited, listColumnIssue: sectionData.listColumnIssue });
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
    entity: resolvedEntity,
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
      // every warning carries `severity`: `correctness` (op hit a missing item / skeletal seed ⇒ schema order (F1)
      // or seed (F2) wrong — BLOCKS the gate) or `fidelity` (the mapping is right, an effect is unrepresented —
      // advisory, and clearable via `manifest.warningDispositions`).
      warnings: eff.warnings,
      unresolvedParents: eff.unresolvedParents, // non-empty ⇒ base template not fully seeded (F2)
      seedQuality: eff.seedQuality,           // whether the seed looks like a real fetched body vs a skeleton
      features: eff.features,                 // feature toggles gating runtime visibility (union, not one state)
      referencedModules: eff.referencedModules, // UI-rendering deps outside the page-schema migration unit
    },
    decisionSummary, // needsDecision counts by kind — the agent's 20% worklist, at a glance
    changeSet,       // full Freedom ChangeSet: viewConfigDiff / *ConfigDiff / rules / details / needsDecision / …
    section,         // section-schema analysis (list page): add-record mini page, section actions, columns, quick filters
    listGate,        // the LIST page's own gate — blocked when the SECTION's evidence is incomplete, independently of `gate`
    listChangeSet,   // the LIST page's own ChangeSet: positioned grid columns / quick filters / command-bar actions
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
  // PLACEMENT completeness — the app-hosting facts. Mirrored here for the same reason as the two above: the CLI
  // gate reads the result, not the manifest.
  out.placement = manifest.placement || null;
  out.placementBlockers = specOpts.placementBlockers;
  // The PLAN VERSION. Set BEFORE `renderPlan` can read it — it takes it off the result.
  out.planVersion = computePlanVersion(manifest, bodyOf);
  // a SUB-PAGE's design spec (child / mini / typed per-type form) is only ever EMBEDDED into
  // the parent plan, never emitted standalone, so render it `embedded`: no "## Design spec (generated)" header, no
  // Entity/Size preamble, no Member ledger — the parent plan owns those. `formOnly` is propagated for the typed fold
  // so the per-type spec skips the List-page block (a typed page is not its own section; the base fold owns the one
  // list page). `checklistOpts` carries isChildPage/isMiniPage but NOT formOnly, so it is re-applied here from `opts`.
  out.designSpec = renderDesignSpec(out, subPageSpecOpts(specOpts, opts));
  out.plan = renderPlan(out, specOpts);
  out.checklist = renderChecklist(out, specOpts); // the post-implementation Plan-vs-Done control table (CLI --checklist)
  return out;
}

// ⛔ THE `--built` PAYLOAD GUARD (D6) — this is what makes the verify gate real. `--verify` now reads a KEYED MAP
// over the page tree, each entry carrying clio `get-page`'s `bundle.viewConfig` verbatim; the engine walks that
// tree itself. Without this guard a hand-authored `{ "ops": [...] }` (or a hand-written count) reached
// `complete: true` having built nothing — the builder would author the very evidence it is being gated on. The
// shape is REJECTED at exit 1, not silently degraded, and the message points at the checklist's page keys because that is where
// the exact page keys come from. `false` = genuinely absent (a hard MISSING); an OMITTED key = not checked
// (unverified) — so this only checks the entries that ARE present.
const BUILT_SHAPE = '{ "pages": { "main": { "viewConfig": <get-page bundle.viewConfig>, "packageName": "…", "parentSchemaName": "…", "modelConfig": <get-page bundle.modelConfig — OPTIONAL, and the only way the gate can see a page that has no primary data source and therefore hangs the browser>, "businessRules": <read-page-business-rules result: { count, rules } — the page\'s persisted BusinessRule_* schemas, NOT a page-body grep>, "schemaName": "<page.name — the result report names the page by it>", "handlers": <get-page bundle.handlers — OPTIONAL; handler rows are matched against it>, "viewModelConfig": <get-page bundle.viewModelConfig — OPTIONAL; virtual-attribute rows are matched against its attributes> }, "list": { "viewConfig": <the LIST page, same shape>, "schemaUId": "…" }, "child:<Entity>": false }, "reachability": { "sectionRegistered": { "workplaces": <n counted on the stand>, "names": [...] } — a COUNT, not a flag: a workplace registration only ADDS, so the row closes at exactly 1, "miniPageWired": true, … }, "evidence": { "<id>": {…} }, "judge": { "<id>": { "convincing": true } } }';
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
// A payload synthesised from the plan alone would otherwise reach exit 0 with no Creatio contact at all, because
// everything it needed was published in the plan. These identifiers are NOT: the plan publishes no GUID of any
// kind, so `schemaUId` / `packageUId` can only come from a real `get-page` — and they have to agree with each
// other across the whole payload, which a fabricated set will not do by accident:
//   - one page is one schema  -> `schemaUId` is UNIQUE across keys (the same page pasted under two keys is the
//     cheapest way to fake a second built page, and this is what catches it);
//   - one package is one UId  -> every entry claiming the same `packageName` must carry the same `packageUId`.
// BE HONEST ABOUT WHAT THIS IS: it proves INTERNAL CONSISTENCY, not origin. The engine runs offline and cannot
// ask Creatio whether a GUID exists. It raises the cost of a fabricated report from "copy the numbers the plan
// already told you" to "invent a coherent identity graph", and it makes a careless copy-paste fail outright.
// It is not a defence against a determined author, and nothing here should be described as one.
// `GUID_RE` is imported from assemble.mjs — the drop-sweep there has to apply exactly this test.
function missingUidIssue(entries) {
  const noUid = entries.filter(([, e]) => !GUID_RE.test(String(e.schemaUId ?? "")));
  if (!noUid.length) return null;
  return `has ${noUid.length} page entr${noUid.length === 1 ? "y" : "ies"} with no valid \`schemaUId\`: ${noUid.map(([k]) => k).slice(0, 5).join(", ")}. Copy it VERBATIM from clio \`get-page\` (\`page.schemaUId\`) — the plan publishes no GUIDs, so this is what shows the page was actually read off the stand`;
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
// The flags that TAKE A VALUE: their value must be excluded from the positional-manifest search (else
// `--out plan.md` would read `plan.md` as the manifest). Mode flags (`--plan`, `--verify`, …) take no value and
// belong in NEITHER list.
const TASKS_FLAG = "--tasks";
const SPLIT_FLAG = "--split";
const START_FLAG = "--start";
// Takes no value: it says WHAT `--tasks <dir>` does with that folder, not where anything is.
const ADD_FLAG = "--add";
const ROUTE_FLAG = "--route";
// `--next`: ANSWER which tasks are startable right now. Takes no value, and writes nothing beyond the
// folder refresh a plain `--tasks` run already performs.
const NEXT_FLAG = "--next";
// `--decide D<N>` / `--revoke D<N>`: the ONE path a PERSON's scope decision reaches the ledger.
// See tasks.mjs for the semantics; the CLI's job is to parse flags, resolve `D<N>` from
// `<migration-folder>/decisions.md` and the plan's `### Adjustments`, and refuse when it does not.
const DECIDE_FLAG = "--decide";
const REVOKE_FLAG = "--revoke";
const WONT_DO_FLAG = "--wont-do";
const POSTPONED_FLAG = "--postponed";
const TO_FLAG = "--to";
const PAGES_FLAG = "--pages";
const TASK_FLAG = "--task";
const ROW_FLAG = "--row";
// QUOTING IS PER SHELL, and the printed `--start` command is meant to be pasted into the shell the reader is
// actually running. `cmd.exe` does not quote with `'` at all and POSIX `sh` keeps `$`, a backtick and `\` alive
// inside `"`, so one encoder cannot serve both. BOTH branches quote UNCONDITIONALLY: a value with no space can
// still carry `;`, `&`, `|` or `$`, and a wrapper that only fires on whitespace hands those straight to the shell.
// POSIX has no escape for `'` INSIDE single quotes: the only way is to close the quote, emit an escaped `'`,
// and reopen — `'\''`. Written with `String.raw` and kept in a named constant so the sequence is readable.
const POSIX_QUOTED_QUOTE = String.raw`'\''`;
const shellArg = process.platform === "win32"
  ? (s) => `"${String(s).replaceAll('"', '""')}"`
  : (s) => `'${String(s).replaceAll("'", POSIX_QUOTED_QUOTE)}'`;
// `--reads <dir>`: WRITE the read plan for the verify gate into that MIGRATION FOLDER (the one holding
// `build-tasks/`). The folder, not the task dir: the raw responses and the `built.json` composed from them
// belong beside the run.
const READS_FLAG = "--reads";
// `--from <dir>`: COMPOSE the `--verify` payload out of the files `--reads` named, instead of being handed one.
// The two flags are one contract — `--reads` writes `reads/index.json`, this reads it back — so they take the
// same folder.
const FROM_FLAG = "--from";
const VALUE_FLAGS = new Set(["--out", "--built", TASKS_FLAG, SPLIT_FLAG, START_FLAG, READS_FLAG, FROM_FLAG, ADD_FLAG,
  DECIDE_FLAG, REVOKE_FLAG, TO_FLAG, PAGES_FLAG, TASK_FLAG, ROW_FLAG]);
// EVERY flag this CLI accepts. An unknown one is refused rather than ignored: a run that caches a per-page design
// spec issued `--spec --page main` and `--spec --page list`, got the SAME whole spec twice because `--page` does
// not exist here, and reported success both times. Two byte-identical "slices" is the kind of failure nobody looks
// for, so the flag that produced them has to be the thing that fails.
const KNOWN_FLAGS = new Set(["--plan", "--spec", "--checklist", "--stubs", "--verify", ROUTE_FLAG, NEXT_FLAG,
  WONT_DO_FLAG, POSTPONED_FLAG, ...VALUE_FLAGS]);
function valueFlagArg(argv, flag, example, onBad) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    const got = next === undefined ? "no argument" : `the flag '${next}'`;
    onBad(`\`${flag}\` needs a path (e.g. \`${example}\`) — got ${got}; nothing was written`);
  }
  return next;
}

// The stdout note that goes with `--out`. MODE-AWARE, because "incomplete" means two opposite things.
//
// For `--plan` (and `--spec`/`--checklist`) an incomplete run produces an artifact that is NOT
// approvable — it carries a ⛔ banner and describes a plan that is not ready — so the instruction is: do not
// present it, fix the ⛔ items, re-run. That was the only wording this note had.
//
// For `--verify` it is the opposite. The table IS the report of what is still short: it names every unmet row,
// it is the only sanctioned close report, and step 8 tells the agent to present it precisely when
// the run is incomplete. Telling the agent not to present it left the CLI and the skill contradicting each
// other on the same file, with the agent free to pick either. Own fn (not another inline branch) for the same
// reason `valueFlagArg` is one: the CLI block does not grow a branch every time a case is added.
// `--tasks <dir>` — the approved plan as a FOLDER of one-task files plus a derived `index.md`, for a caller that
// dispatches one sub-agent per task instead of holding every deliverable in one context. Same rows as
// `--checklist`; see tasks.mjs for what the engine rewrites and what the caller keeps.
//
// A PLAN-LEVEL GAP WRITES NOTHING. `gate` / `structure` / `coverage` describe the PLAN, and no build round closes
// one — slicing a broken plan into tasks would hand sub-agents write access to a stand against deliverables the
// plan cannot state. So this mode refuses BEFORE it creates the folder, rather than after a builder has run.
// ⛔ THE DISPATCH GATE, in the words of the remedy rather than of the violation. Each finding names its files and
// what to do with them; a generic "process violation" line leaves the caller to invent a repair, and the repair
// differs per finding — a never-dispatched task must be rebuilt, a stale clock only needs the mode re-run.
// The whole set is stated at once because `--start` refuses while ANY of it stands: fixing one file and
// dispatching again would meet the same refusal.
function signedWith(s) {
  if (s.owner) return `signed with the token issued for ${s.owner}`;
  return s.got ? "signed with an unissued value" : "carries no signature";
}

// One section per finding: the headline, then the files it names. Written as data so the function that renders
// them carries no branch per finding — their remedies differ, their shape does not.
function dispatchFailureSections(audit, dir) {
  return [
    [audit.never, (n) => `⛔ ${n} task(s) recorded CLOSED that no sub-agent was ever dispatched for. Nothing`
      + " measured them and nothing says who built them. For each: re-open it (`status: todo`), run"
      + " `--tasks <dir> --start <id>`, and hand THAT task — with the token it prints — to its own sub-agent:",
      (t) => `   · ${t.file}  (--start ${t.id})`],
    [audit.openClock, (n) => `⛔ ${n} task(s) closed while their clock is still open — the folder's books are`
      + ` behind, not wrong. Re-run \`--tasks ${dir}\` to close them and record their samples:`,
      (t) => `   · ${t.file}  (${t.id})`],
    [audit.naNoReason, (n) => `⛔ ${n} task(s) recorded \`not-applicable\` with no dispatch record and no reason`
      + " under `## Notes`. The reason is what exempts a `not-applicable` from the dispatch gate. Write why each"
      + " does not apply,"
      + " or re-open and build it:",
      (t) => `   · ${t.file}  (${t.id})`],
    [audit.signature, (n) => `⛔ ${n} task(s) closed carrying a signature dispatch did not issue for them —`
      + " the context that closed each was not the one it was handed to. Re-open, `--start`, re-dispatch:",
      (s) => `   · ${s.task.file}  (${signedWith(s)})`],
  ];
}

function dispatchFailureText(audit, dir) {
  const L = [];
  for (const [rows, head, line] of dispatchFailureSections(audit, dir)) {
    if (!rows?.length) continue;
    L.push(head(rows.length), ...rows.map(line));
  }
  return L.join("\n");
}

// The unbuilt-deliverable list, generated from the outcome cells so it is passed on verbatim rather than
// summarised: every unbuilt deliverable, its task, and what it is waiting on. Only rows with NO repair task
// reach here — a row already routed to one is somebody's work, not a gate failure.
// The gate's own list: rows nothing is scheduled to close. `resolvePartials` has already stamped `residual` on
// every row it could match to a repair task, so this is a filter and not a second opinion.
// OFF THE SHARED LIST, so the gate's failure list names the same deliverables the progress block does, once
// each. `!it.residual` narrows it further to rows nothing is scheduled against at all — a row with an open
// round is somebody's work and is reported, not failed on.
const unroutedNotBuilt = (tasks) => notBuiltOpenItems(tasks).filter((it) => !it.residual);

const REMEDY = {
  "blocked": "the stand or a service was unreachable — a repair round may clear it",
  "needs-decision": "a scope question — a repair round gives it to a fresh agent holding the evidence",
};
function notBuiltFailureText(items) {
  const L = [];
  const byTask = new Map();
  for (const it of items) {
    if (!byTask.has(it.task.file)) byTask.set(it.task.file, []);
    byTask.get(it.task.file).push(it);
  }
  for (const [file, rows] of byTask) {
    L.push(`  ${file} (${rows[0].task.pageKey}) — read its \`## Notes\` for the detail:`);
    for (const it of rows) {
      const why = it.cause
        ? `${it.cause}: ${REMEDY[it.cause] || "a person decides"}`
        : "NOT ACCOUNTED FOR — the task closed without marking this row either way, so nobody stated what happened to it";
      L.push(`    · row ${it.n} — ${it.row.label}`, `      ${why}`);
    }
  }
  // THE REMEDY NAMED HERE MUST BE RUNNABLE MID-RUN: `--verify` needs a `--built` payload for every page, which a
  // folder with pages still unbuilt cannot supply. `--route` opens the same round without one.
  L.push(`  None of the above is routed to a repair task. Run \`${TASKS_FLAG} <dir> ${ROUTE_FLAG}\` to open a repair`
    + " round over them (`--verify` routes them too, as part of its own round — but only once you have a `--built`"
    + " payload for every page). Do NOT hand-write a repair file: a repair task is recognised by front matter the"
    + ` engine writes, so one you author settles no row. A cause that has already had ${REPAIR_ROUND_CAP} rounds is`
    + " PARKED and will not get another, and is yours to decide: rebuild it, defer it, or accept it — and say so.");
  return L.join("\n");
}

// Set by `runTaskMode` / the verify leg when the folder fails the dispatch gate, and read once at the exit-code
// decision below. The mode has several early returns, so the verdict travels beside the text rather than in it.
let dispatchGateFailure = null;
// Separate from the dispatch gate: that one refuses to schedule more work, this one only withholds "finished"
// from the run. Rebuild, defer or accept is the user's decision.
let partialGateFailure = null;
// ⛔ THE RUN CANNOT MOVE ITSELF — set by `--next` when nothing is startable AND nothing is in flight. Its own
// variable, because it is neither a plan gap, nor a short build, nor a broken ledger: it is a decision somebody
// has to make, and an orchestrator that read a passing exit code here would poll a halted run forever.
let startableGateFailure = null;
// ⛔ `--next` REFUSED TO ANSWER — a plan with gaps, or a frozen cut that does not resolve. Its own variable
// rather than a reuse of the one above: that one carries the halted-run ANSWER its stderr banner renders, and a
// refusal has no answer to render. It only has to make the exit code agree with the banner already on stdout.
let nextRefusalFailure = false;
// ⛔ `--tasks` REFUSED TO CUT — the split does not resolve against the plan, so the folder is left exactly as it
// was. A refusal writes nothing and names no task, and the exit code is the only part of it a caller PARSES: a
// mode that printed the banner and exited like an answer would have an orchestrator dispatch sub-agents against a
// folder that was never cut. Its own variable, per the one-flag-per-mode shape beside it, so a run can still say
// WHICH mode declined.
let taskRefusalFailure = false;
// ⛔ A REPAIR ROUND OPENED NOTHING — the frozen cut the folder's task ids derive from does not resolve, or the
// round could not be written, so no repair task exists and no row is scheduled to close. One flag for one repair
// code path reached by two entry commands (`--tasks --route` and `--verify --tasks`), so the exit code follows the
// banner whichever of them asked. Same rule as the two above, on the other modes that print the banner.
let routeRefusalFailure = false;
// ⛔ `--START` MARKED NOTHING — every reason it refuses ends the same way: no clock was opened and the folder
// records nothing started. It is the command an orchestrator runs before EVERY dispatch, so a refusal it exits 0
// on is the one that costs most: the caller hands the named task to a sub-agent that has no token for it. Raised
// for the WHOLE refusal set rather than per reason — some of the reasons (an unreadable file, an id the folder
// does not hold) carry no dispatch verdict of their own, so only a set-wide flag makes every one of them non-zero.
let startRefusalFailure = false;

// EVERY REASON `--start` MARKS NOTHING, in one place. Each returns the text to print; `null` means the task was
// started. They are separate because their remedies are: repair a file by hand, clear the ledger, build the
// dependency, wait for the other writer, or fix a typo in the id.
function startRefusalText(set, startId, dir) {
  if (set.unread) {
    return `migrate.mjs: ⛔ \`${set.unread}\` could not be read — its front matter is unterminated or malformed, and the engine will not rewrite a file it cannot parse (the \`## Notes\` in it record work already done on the stand). Repair that file by hand, then re-run. Nothing was marked started.\n`;
  }
  // NO NEW CLOCK OVER A BROKEN LEDGER. `--start` is the one command the orchestrator runs before every dispatch,
  // so refusing here stops the run at the next dispatch instead of at the final gate.
  if (set.blockedByDispatch) {
    dispatchGateFailure = { audit: set.blockedByDispatch, dir, started: false };
    return `migrate.mjs: ⛔ NOTHING WAS STARTED — \`${startId}\` was not marked in-progress and no clock was opened.\n`
      + dispatchFailureText(set.blockedByDispatch, dir) + "\n"
      + `The folder and ${TASK_INDEX_FILE} were refreshed, so the rows above are current. Clear ALL of them before dispatching again.\n`;
  }
  // A DECISION THE ENGINE CANNOT MAKE. Refused in the same words the query withholds it in, so the two surfaces
  // send the reader to the same place: the file's own `## Notes`.
  if (set.blockedByStatus) {
    dispatchGateFailure = { startRefusal: true, dir };
    return `migrate.mjs: ⛔ NOTHING WAS STARTED — \`${startId}\` has status \`${set.blockedByStatus}\`, which is a`
      + " decision rather than a schedule: it is neither `todo` nor in flight, and no re-dispatch resolves it."
      + " Read its `## Notes`, fix what they name, set it back to `todo`, then start it.\n";
  }
  // THE QUEUE ORDER AND THE ONE-WRITER RULE, refused at the moment a token would be issued. Both are field
  // comparisons the engine can make, so neither depends on the caller remembering them.
  if (set.blockedByDeps) {
    dispatchGateFailure = { startRefusal: true, dir };
    return `migrate.mjs: ⛔ NOTHING WAS STARTED — \`${startId}\` waits on ${set.blockedByDeps.length} task(s) that have not closed:\n`
      + set.blockedByDeps.map((d) => `   · ${d.file}  (${d.id}, status \`${d.status}\`)`).join("\n")
      + `\nBuild them first, in the \`Step\` order ${TASK_INDEX_FILE} lists. What this task needs from them is in their \`## Notes\`.\n`;
  }
  if (set.blockedByOverlap) {
    dispatchGateFailure = { startRefusal: true, dir };
    return `migrate.mjs: ⛔ NOTHING WAS STARTED — \`${startId}\` writes \`${set.blockedByOverlap[0].writesTo}\`, and a task already dispatched is still writing it:\n`
      + set.blockedByOverlap.map((c) => `   · ${c.file}  (${c.id})`).join("\n")
      + "\nOne writer per artifact: let that task close, re-run `--tasks`, then start this one. Two open tokens on"
      + " one artifact is how a single sub-agent ends up holding both.\n";
  }
  if (!set.started) {
    return `migrate.mjs: ⛔ no task \`${startId}\` in ${dir} — read the \`Step\` table in ${TASK_INDEX_FILE} for the ids this folder holds. Nothing was marked started.\n`;
  }
  return null;
}

// A frozen split met by a plan that moved. An item whose rows all left the plan is not fatal — its file may hold
// the only record of work already done — so the folder is written and the drift is said on stdout, not only on
// the index. A plan row no item claims is refused before this point.
function splitDriftLines(set) {
  const L = [];
  if (set.emptied?.length) {
    L.push(`⚠ ${set.emptied.length} split item(s) have no rows left in the current plan: ${set.emptied.map((e) => "`" + e.id + "`").join(", ")}. Their files are kept.`);
  }
  return L;
}

// A PLAN-LEVEL GAP TOUCHES NOTHING. `gate` / `structure` / `coverage` describe the PLAN and no build round closes
// one, so every mode that opens a task folder refuses on the same terms — one function, because two copies of a
// refusal are two chances for one of them to soften.
function planGapRefusal(result) {
  const gaps = planGaps(result);
  if (!gaps.length) return null;
  return "migrate.mjs: ⛔ NOTHING WRITTEN — no task folder for a plan with gaps: " + gaps.join(" · ")
    + ". None of the three is buildable-out-of: fix the manifest / the stand, re-run `--plan`, re-approve if the plan changed, and slice tasks only then.\n";
}

// WHAT WAS REFUSED, AND WHAT CLEARS IT — one pair of writers, because the build leg, `--route` and `--verify`
// all refuse on the same three causes and an operator acts on the remedy, not on the banner.
const handedIn = (set) => set.splitSource === SPLIT_HANDED;

// Each reason is matched by NAME, and the fallback is the one sentence true of every refusal. Defaulting to a
// specific claim would hand a new reason the most misleading wording in the set — telling an operator to fix the
// syntax of a file whose syntax is fine.
function refusalCause(set, dir) {
  if (set.refusal === REFUSED_CUT) return "the engine's own cut does not cover this plan";
  if (set.refusal === REFUSED_UNREADABLE) return `the frozen split in ${dir} could not be read`;
  if (set.refusal === REFUSED_UNRESOLVED) return "the split does not resolve against this plan";
  if (set.refusal === REFUSED_COVERAGE) {
    return handedIn(set)
      ? `the split passed with ${SPLIT_FLAG} does not cover this plan`
      : `the frozen split in ${dir} no longer covers this plan`;
  }
  return "the cut does not resolve against this plan";
}

function refusalRemedy(set) {
  if (set.refusal === REFUSED_CUT) {
    return " No file you hold can correct this — it is a defect in the slicer; report it with the manifest that"
      + " produced it.";
  }
  if (set.refusal === REFUSED_COVERAGE) {
    // The engine picks no owner: which item a row belongs to is the judgement the split records. What FALLING
    // BACK reaches depends on what is still in play — dropping a handed-in flag reads the folder's own frozen
    // cut when it has one, which is a different cut, not the mechanical one.
    let fallback = `delete ${SPLIT_FILE} to fall back to the engine's own cut`;
    if (handedIn(set)) {
      fallback = set.frozenPresent
        ? `drop ${SPLIT_FLAG} to fall back to the split already frozen in that folder, or delete it too to reach the engine's own cut`
        : `drop ${SPLIT_FLAG} to fall back to the engine's own cut`;
    }
    return ` Place the named rows in ${handedIn(set) ? "that file" : SPLIT_FILE}, or ${fallback}.`;
  }
  // The cause line for this one is deliberately generic and names no file, so the remedy has to name it itself.
  if (set.refusal === REFUSED_UNRESOLVED) {
    const which = handedIn(set) ? `the file you passed with ${SPLIT_FLAG}` : SPLIT_FILE;
    return ` Fix ${which} and re-run.`;
  }
  return ` Fix or remove ${SPLIT_FILE}.`;
}

// A cut that does not resolve against the plan writes NOTHING — the folder is left exactly as it was, so a
// half-applied cut can never schedule part of a plan and drop the rest.
function splitRefusalText(set, dir) {
  // The shape belongs to a refusal the shape could explain. A file that parsed and resolved is not malformed —
  // its coverage is short — so several hundred characters of JSON shape only bury the rows to place.
  const malformed = set.refusal === REFUSED_UNREADABLE || set.refusal === REFUSED_UNRESOLVED;
  const shape = malformed ? ` Expected shape: ${SPLIT_SHAPE}` : "";
  return `migrate.mjs: ⛔ NOTHING WRITTEN — ${refusalCause(set, dir)}:\n`
    + set.problems.map((p) => "  · " + p).join("\n")
    + `\n${refusalRemedy(set).trim()}${shape}\n`;
}

function runTaskMode(result, dir, opts, split = null, splitText = null, startId = null) {
  dispatchGateFailure = null;
  partialGateFailure = null;
  const gapRefusal = planGapRefusal(result);
  if (gapRefusal) return gapRefusal;
  // `--start <id>` marks the task IN PROGRESS and stamps its clock before regenerating, so the index moves when
  // the orchestrator DISPATCHES rather than only when an agent finishes. Without it a run in flight is
  // indistinguishable from a run that has not begun.
  const set = startId ? startTask(dir, startId, result, opts, split) : syncTaskDir(dir, result, opts, split);
  if (set.refused) { taskRefusalFailure = true; return splitRefusalText(set, dir); }
  if (startId) {
    const refusal = startRefusalText(set, startId, dir);
    if (refusal) { startRefusalFailure = true; return refusal; }
  }
  const done = set.tasks.filter((t) => t.status === "done").length;
  const attention = set.tasks.filter((t) => !TASK_STATUSES.includes(t.status) || t.drifted).length
    + (set.stale?.length || 0);
  // FROZEN ONLY ONCE IT RESOLVED. Copying the file in before validation would leave a folder whose frozen cut is
  // one the engine already refused, and every later run would read it back and refuse again.
  if (splitText) freezeSplit(dir, splitText);
  const cut = set.split ? `a frozen split of ${set.split.items} item(s)` : "the built-in budget slicer";
  const lines = [
    `migrate.mjs: wrote ${set.tasks.length} build task(s) + ${TASK_INDEX_FILE} to ${dir} — ${done} done, ${set.tasks.length - done} not. Cut by ${cut}.`,
    // ⚠ DO NOT PUT THE PICKING INSTRUCTION BACK. A line saying "hand ONE task file at a time, in the
    // `Step` order that index lists" tells the caller to schedule off a DERIVED report — the very thing
    // `--next` exists to replace, and a contradiction the engine would be printing against itself. The index
    // is what a human reads; it is not what anyone picks from.
    `Present ${path.join(dir, TASK_INDEX_FILE)} (it is DERIVED — a task's own file records its status). Do NOT pick the next task off that index: ask the engine with \`${TASKS_FLAG} ${dir} ${NEXT_FLAG}\`, which answers with every task startable right now and the exact \`${START_FLAG}\` command for each. Hand each named task to its OWN sub-agent, and re-run this mode after every status change.`,
  ];
  const refused = set.blocked?.length || 0;
  if (refused) {
    lines.push(`⚠ ${refused} file(s) in that folder were NOT READ and NOT WRITTEN — the engine could not tell whose record they hold, so it left them untouched rather than overwrite a record of work already done on the stand. Their tasks got no file this run. See the "Attention" section of ${TASK_INDEX_FILE}.`);
  }
  if (attention) lines.push(`⚠ ${attention} task(s) need a human eye — see the "Attention" section of ${TASK_INDEX_FILE}.`);
  // THE PROGRESS BLOCK, for the chat. Engine-rendered so what the user reads and what the folder holds cannot
  // drift apart, and printed on every run of the mode so the picture is current whenever the orchestrator speaks.
  // THE TOKEN IS HANDED TO THE SUB-AGENT, not left in the folder. It prints here and nowhere else, because a
  // token the sub-agent could read for itself would prove nothing about who dispatched it.
  if (set.started && set.dispatchToken) {
    lines.push("", `DISPATCH TOKEN for \`${set.started.id}\`: ${set.dispatchToken}`,
      "Put this in the prompt of the ONE sub-agent you hand this task to. It copies the token into `agentNonce:`"
      + " in its own task file before it finishes. Do not paste it into any other task, and do not write it"
      + " into the file yourself.");
  }
  // THE FOLDER IS WRITTEN AND THE RUN STILL FAILS. The task files and the index are correct — what is wrong is
  // that work was closed with nobody dispatched for it, which no re-slice can repair.
  if (set.dispatch?.failing.length) dispatchGateFailure = { audit: set.dispatch, dir, started: true };
  // Off the folder this run just wrote. The folder and its files are still written; only the run fails.
  // A row with a RESIDUAL is already routed to a repair task and is somebody's open work, so it is not a gate
  // failure. What fails is a row nothing is scheduled to close: not yet routed here (this mode opens no repair
  // round), or parked after its rounds. The gate reads the same folder state in either mode.
  const notBuilt = unroutedNotBuilt(set.tasks);
  if (notBuilt.length) partialGateFailure = { items: notBuilt, dir };
  lines.push("", "--- progress ---", renderProgress(set, dir).trimEnd(), ...splitDriftLines(set));
  return lines.join("\n") + "\n";
}

// `--tasks <dir> --next` — WHICH TASKS ARE STARTABLE RIGHT NOW, answered by the engine.
//
// WHY IT EXISTS. The folder already published everything needed to answer this (`status`, `dependsOn`,
// `writesTo`, the clocks), and `--start` already enforced it — but only by refusing. So every orchestrator that
// wanted the answer BEFORE dispatching re-derived it in shell over `index.md`, which is a DERIVED report whose
// columns moved under them the moment the report was reshaped. This mode is the same computation `--start`
// refuses through, printed instead of enforced: nothing here is a second scheduler, and nothing in the answer has
// to be parsed positionally — each named task carries the exact command that starts it.
//
// IT DOES NOT DISPATCH. It names tasks and prints commands; issuing a token stays with `--start`, which is the
// one place a clock is opened. That is why it combines with nothing that moves the folder.
const taskLine = (t) => `step ${Number(t.order)} · ${t.pageKey} · ${t.group}  [${t.id}]`;
const withheldLine = (w) => {
  const on = (w.tasks || []).map((d) => `${d.id} (\`${d.status}\`)`).join(", ");
  if (w.cause === HOLD_DEPS) return `   · ${taskLine(w.task)} — waits on ${w.tasks.length} task(s): ${on}`;
  if (w.cause === HOLD_OVERLAP) return `   · ${taskLine(w.task)} — \`${w.task.writesTo}\` is being written by ${on}`;
  if (w.cause === HOLD_SEQUENCED) return `   · ${taskLine(w.task)} — another task in THIS answer writes \`${w.task.writesTo}\` first: ${on}`;
  // The ledger refusal is what the GATE would answer for this id, so it is what this line says. `underlying` is
  // what will hold the task once the books are repaired — worth printing, but never in place of the real refusal.
  if (w.cause === HOLD_LEDGER) {
    return `   · ${taskLine(w.task)} — refused while the dispatch ledger is broken`
      + (w.underlying ? ` (and then: \`${w.underlying}\`)` : "");
  }
  return `   · ${taskLine(w.task)} — its file could not be read (${w.file}); repair it by hand`;
};
const heldLine = (h) => `   · ${taskLine(h.task)} — status \`${h.task.status}\`: a decision, not a schedule. Read its \`## Notes\`, fix what they name, set it back to \`todo\`.`;

// One block of stdout per verdict; the caller decides the exit code from the verdict itself. They are separate
// because their REMEDIES are: dispatch, wait, close the run, repair the ledger, or make a decision no re-run can
// make for the caller.
function nextAnswerLines(a, dir, cmdFor) {
  if (a.verdict === NEXT_LEDGER) {
    // The failing rows themselves go to STDERR, once, through the same dispatch-gate writer every other mode
    // uses — printing them here as well would state one finding twice in one run and invite the reader to treat
    // the copies as two.
    return [`migrate.mjs: ⛔ NOTHING STARTABLE in ${dir} — ${a.dispatch.failing.length} closed task(s) have no`
      + " valid dispatch record, and `--start` refuses EVERY id while that stands, so nothing here would be"
      + " accepted. This is ONE finding about the folder, not one per task: the failing files and their remedies"
      + " are on stderr. Clear all of them, then ask again."];
  }
  if (a.verdict === NEXT_FINISHED) {
    return [`migrate.mjs: NOTHING STARTABLE in ${dir} — all ${a.total} task(s) have settled. The build is finished:`
      + ` close the run on the migration result report (\`--verify --tasks ${shellArg(dir)}\`), which is the only sanctioned`
      + " close artifact — do not hand-write a status summary of your own."];
  }
  if (a.verdict === NEXT_WAITING) {
    // HELD IS RENDERED HERE TOO. A task needing a decision does not stop needing one because something else is in
    // flight, and leaving it out of both the list and the count made it invisible on exactly the verdict an
    // orchestrator polls — while the printed figures failed to add up to `total`.
    return [`migrate.mjs: NOTHING STARTABLE YET in ${dir} — ${a.inFlight.length} task(s) in flight and`
      + ` ${a.withheld.length + a.held.length} behind them (${a.settled} of ${a.total} settled). This is NOT a`
      + " failure: let the running task(s) close, then ask again.",
    "IN FLIGHT:", ...a.inFlight.map((t) => `   · ${taskLine(t)}`),
    ...(a.held.length ? ["HELD — somebody has to decide:", ...a.held.map(heldLine)] : [])];
  }
  if (a.verdict === NEXT_STUCK) {
    return [`migrate.mjs: ⛔ NOTHING STARTABLE AND NOTHING IN FLIGHT in ${dir} — ${a.held.length + a.withheld.length}`
      + " task(s) are still open and the run cannot move on its own. Re-running this mode changes nothing.",
    ...(a.held.length ? ["HELD — somebody has to decide:", ...a.held.map(heldLine)] : []),
    ...(a.withheld.length ? ["WITHHELD — waiting on the above:", ...a.withheld.map(withheldLine)] : []),
    "A task recorded `blocked` KEEPS its clock — only a settled task's clock is closed — so a folder in this state"
      + " can look busy in `timings.json` while nothing is running. That is exactly why this is a failing verdict"
      + " and not `waiting`: an orchestrator that polled it would poll forever."];
  }
  return [`migrate.mjs: ${a.startable.length} task(s) STARTABLE NOW in ${dir} — computed by the same predicate`
    + " `--start` enforces, so each one is a dispatch that gate will accept. Hand each to its OWN sub-agent, in a"
    + " fresh context; no two of them write the same artifact, so they may run at once.",
  ...a.startable.flatMap((t) => {
    const writes = t.writesTo ? ` — writes \`${t.writesTo}\`` : " — read-only";
    return [`   · ${taskLine(t)}${writes}`, `     ${cmdFor(t.id)}`];
  }),
  ...(a.withheld.length ? [`WITHHELD — ${a.withheld.length} task(s) are NOT yours to pick yet:`,
    ...a.withheld.map(withheldLine)] : []),
  ...(a.held.length ? [`HELD — ${a.held.length} task(s) need a decision:`, ...a.held.map(heldLine)] : [])];
}

// THIS MODE ASKS; IT DOES NOT CUT. The refresh below creates the folder it is pointed at, so a mistyped or
// cwd-relative path would be cut fresh and then answered with a confident step-1 dispatch over a ledger nobody
// built — the caller could not tell "the run has not started" from "you gave me the wrong path". Returns the
// refusal text, or null for a folder that really holds a cut (which is refreshed exactly as before).
function nextFolderRefusal(dir) {
  if (fs.existsSync(dir) && fs.existsSync(path.join(dir, TASK_INDEX_FILE))) return null;
  return `migrate.mjs: ⛔ NOTHING WRITTEN — no task folder at ${dir}: this mode reports which tasks are startable`
    + ` and never cuts one, so nothing was created there. The path is resolved against the current directory — check`
    + ` it, and if the run has not started yet cut the folder first with \`${TASKS_FLAG} ${dir}\`.\n`;
}

// The same folder refresh a plain `--tasks` run performs — REPLACING that call, not adding one. A strictly
// read-only answer would be wrong at the commonest moment of all: right after a sub-agent closes a task, whose
// clock is closed by the refresh. Without it that closure reads as a dispatch-ledger failure and the mode would
// answer `ledger` for a folder that is simply one task further along.
function runNextMode(result, dir, opts, cmdFor) {
  dispatchGateFailure = null;
  startableGateFailure = null;
  // A REFUSAL IS NOT AN ANSWER, so it must not exit like one. The early returns below print NOTHING WRITTEN and
  // name no task; leaving the gates unset made them exit 0 — the same code a `waiting` or `finished` answer
  // carries — while every other `--next` non-answer (`stuck`, `ledger`) exits 2.
  const gapRefusal = planGapRefusal(result);
  if (gapRefusal) { nextRefusalFailure = true; return gapRefusal; }
  const noFolder = nextFolderRefusal(dir);
  if (noFolder) { nextRefusalFailure = true; return noFolder; }
  const set = syncTaskDir(dir, result, opts);
  if (set.refused) { nextRefusalFailure = true; return splitRefusalText(set, dir); }
  const answer = startableTasks(set, dir);
  if (answer.verdict === NEXT_LEDGER) dispatchGateFailure = { audit: answer.dispatch, dir, started: true };
  if (answer.verdict === NEXT_STUCK) startableGateFailure = { dir, answer };
  return nextAnswerLines(answer, dir, cmdFor).join("\n") + "\n";
}

// `--verify --tasks <dir>` — the open rows of THIS verify run, written into the task folder as repair tasks.
// Merged by (page, cause) on purpose: nineteen fields with the wrong names are one defect with nineteen symptoms,
// and nineteen tasks is nineteen sub-agent startups to make one edit each. A cause that has already had
// REPAIR_ROUND_CAP rounds is PARKED rather than re-emitted — three sub-agents have failed at it, and a fourth is
// not the answer; it is a decision for the user.
// The two refusals a repair round makes BEFORE it writes anything, shared by `--verify --tasks` and `--route`:
// both schedule sub-agents, so both answer the same two questions first. Returns the refusal text, or null.
function repairPreflight(result, dir) {
  // THE LEDGER IS CHECKED BEFORE MORE WORK IS SCHEDULED AGAINST IT. Read-only: the folder is not re-sliced here,
  // so this sees the recorded front matter and the clocks exactly as they stand. No repair task is written while
  // it fails — a repair round adds sub-agents on top of closures nobody was dispatched for, and the rows it would
  // open cannot be trusted to describe what was actually built.
  const folder = readTaskDir(dir);
  // NOT-BUILT IS NOT JUDGED HERE. `readTaskDir` computes a status off the cells alone and never resolves a
  // residual, so a row whose repair task has closed still reads unrouted on this path — and the refusals below
  // return before `syncRepairDir` can correct it. The verdict is set once, after that call, off the folder it
  // wrote; a refusal reports the gate that actually fired and nothing else.
  const audit = dispatchAudit(folder, dir);
  if (audit.failing.length) {
    dispatchGateFailure = { audit, dir, started: true };
    // The files and their remedies go out ONCE, on stderr with the other ⛔ banners. Stdout carries the verify
    // table the caller presents verbatim, so the same list on both streams is the caller's report read twice.
    return `migrate.mjs: ⛔ NO REPAIR TASKS WRITTEN — this folder fails the dispatch gate (${audit.failing.length} task(s)),`
      + " and a repair round would schedule more sub-agents against work nobody was dispatched for."
      + " The failing tasks and their remedies are on stderr.\n";
  }
  if (planGaps(result).length) {
    return "migrate.mjs: ⛔ NO REPAIR TASKS WRITTEN — this run has PLAN-level gaps, which no build round can close."
      + " Fix the plan first; repairing against it would spend sub-agents on rows the plan itself cannot state.\n";
  }
  return null;
}

// WHERE THE ROUND'S ROWS CAME FROM. "A verifier could not find it" and "the agent that built the page wrote down
// that they did not build it" call for different first moves, so the round says which (`renderTaskFile` too).
const ROUND_SOURCE = {
  verify: "the open rows of THIS verify run",
  route: "the rows a BUILD agent recorded as NOT BUILT",
};
const ROUND_EMPTY = {
  verify: (dir) => `no repair task written to ${dir} — this verify run left no row open on any page.`,
  route: (dir) => `no repair task written to ${dir} — nothing there is waiting to be routed: every row a build agent`
    + " recorded as NOT BUILT already has a repair task (or its cause is parked).",
};

// The round's report, identical for both entry points except for where its rows came from.
function repairRoundLines(res, dir, kind) {
  const lines = [];
  // A row held back because the ledger settled it by decision is NOT written as a round, so this is the only
  // place the caller hears about it.
  for (const b of res.boundaries || []) {
    lines.push(`migrate.mjs: NOT routed — \`${b.row.deliverable}\` (${b.pageKey}) was closed \`not-applicable\` with a reason`
      + ` on ${b.task.file}, and a verify run re-opened it. The decision stands: confirm the boundary, or record`
      + ` the row \`not-built\` to schedule the work.`);
  }
  if (res.written.length) {
    const byRound = [...new Set(res.written.map((t) => t.repairRound))].sort((a, b) => a - b);
    lines.push(`migrate.mjs: wrote ${res.written.length} repair task(s) (round ${byRound.join(", ")}) to ${dir}`
      + ` — ${ROUND_SOURCE[kind]}, merged by (page, cause). Hand ONE to a sub-agent, same contract as a`
      + ` build task, then re-verify. Re-verifying opens a NEW round; it does not rewrite these files.`);
    const residual = res.written.filter((t) => String(t.cause).startsWith("not-built:")).length;
    if (residual) {
      lines.push(`migrate.mjs: ${residual} of them cover rows a BUILD agent recorded as NOT BUILT rather than rows`
        + ` \`--verify\` found open. The \`partial\` task each row came from stays \`partial\` until its repair task`
        + ` closes, and closes to \`done\` when it does.`);
    }
  }
  if (res.pending.length) {
    const what = res.pending.map((p) => `${p.pageKey}: ${p.cause} (round ${p.round}, ${p.status})`).join(" | ");
    lines.push(`migrate.mjs: ${res.pending.length} cause(s) already have an OPEN repair task — ${what}. No new round`
      + ` was opened for them: a round is an ATTEMPT, not a verify run, so re-verifying an unchanged page does not`
      + ` manufacture one (and would otherwise burn the ${REPAIR_ROUND_CAP}-round cap with nobody having run).`);
  }
  if (!res.written.length && !res.parked.length && !res.pending.length) lines.push(`migrate.mjs: ${ROUND_EMPTY[kind](dir)}`);
  if (res.parked.length) {
    const what = res.parked.map((p) => `${p.pageKey}: ${p.cause} (${p.rows} row(s))`).join(" | ");
    lines.push(`migrate.mjs: ⛔ ${res.parked.length} cause(s) PARKED after ${REPAIR_ROUND_CAP} rounds — ${what}.`
      + ` No further repair task is written for them: three sub-agents have already failed at each, so a fourth is`
      + ` not the answer. Take these to the user — the plan, the stand or the expectation is wrong, not the build.`);
  }
  return lines;
}

// `--tasks <dir> --route` — open a repair round over the rows a build agent recorded as NOT BUILT, with no verify
// run behind it. `--verify --tasks` routes the same rows, but only with a `--built` payload for every page, which
// a run still building them cannot supply. A repair task is recognised by front matter the ENGINE writes, so
// routing is a mode and never a file a caller authors.
function runRouteMode(result, dir, opts) {
  const refused = repairPreflight(result, dir);
  if (refused) return refused;
  let res;
  // A round that could not be written opened nothing, exactly like the refusal below, so it raises the same flag:
  // the banner on stdout and the exit code are one verdict.
  try { res = syncRepairDir(dir, result, {}, opts); }
  catch (e) {
    routeRefusalFailure = true;
    return `migrate.mjs: ⛔ could not write repair tasks to ${dir}: ${e.message}\n`;
  }
  // A refused set writes nothing: the folder's task ids cannot be derived from it.
  if (res.refused) {
    routeRefusalFailure = true;
    return `migrate.mjs: ⛔ NO REPAIR TASKS WRITTEN — ${refusalCause(res, dir)}:`
      + ` ${(res.problems || []).join("; ")}.${refusalRemedy(res)} Then route again.\n`;
  }
  // Off the folder this call just wrote, as the verify leg does: a routed row is open work, not a gate failure.
  const stillOpen = unroutedNotBuilt(res.set.tasks);
  partialGateFailure = stillOpen.length ? { items: stillOpen, dir } : null;
  // This mode's whole stdout, so it carries the block the orchestrator pastes — `--verify`'s repair note is
  // appended to a table that already has one.
  const lines = [...repairRoundLines(res, dir, "route"), "", "--- progress ---", renderProgress(res.set, dir).trimEnd()];
  return lines.join("\n") + "\n";
}

// Returns `{ note, set, repair }`: the stdout note, the MERGED task set the final report reads (null when the
// round was refused before it merged anything — the caller then reads the folder read-only), and what the round
// wrote (null when refused).
function runRepairMode(result, dir, verifyRes, opts) {
  const refused = repairPreflight(result, dir);
  if (refused) return { note: refused, set: null, repair: null };
  let res;
  // Same verdict as the routed round, raised on the same flag: one repair code path reached by two entry commands,
  // and the exit code follows the banner whichever of them asked.
  try { res = syncRepairDir(dir, result, verifyRes.pages, opts); }
  catch (e) {
    routeRefusalFailure = true;
    return { note: `migrate.mjs: ⛔ could not write repair tasks to ${dir}: ${e.message}\n`, set: null, repair: null };
  }
  // The folder's task ids cannot be derived from a refused set — nothing was written, the same refusal a build
  // run makes. Repairing against a cut that does not resolve would renumber the whole folder.
  if (res.refused) {
    routeRefusalFailure = true;
    return { note: `migrate.mjs: ⛔ NO REPAIR TASKS WRITTEN — ${refusalCause(res, dir)}:`
      + ` ${(res.problems || []).join("; ")}.${refusalRemedy(res)} Then re-verify.\n`, set: null, repair: null };
  }
  // Re-read off the folder this call just wrote: a row that now has a repair round is somebody's open work, not
  // a gate failure. What survives is the residual nothing can be scheduled for — a parked cause.
  const stillOpen = unroutedNotBuilt(res.set.tasks);
  partialGateFailure = stillOpen.length ? { items: stillOpen, dir } : null;
  return { note: repairRoundLines(res, dir, "verify").join("\n") + "\n", set: res.set,
    repair: { written: res.written, pending: res.pending, parked: res.parked } };
}

// `--decide D<N> --wont-do|--postponed [--to <dest>] --pages <keys>|--task <id>|--row <task>:<n>`
// — the one path a person's scope decision reaches the ledger. It refuses unless `D<N>` already resolves in
// `<migration-folder>/decisions.md` or under the plan's `### Adjustments`; that refusal IS the safeguard
// (an agent cannot mint the ground it stands on), and the message prints exactly what to add.
function decidePrintProblems(prefix, problems, addHelp) {
  const lines = [`migrate.mjs: ⛔ ${prefix}:`];
  for (const p of problems) lines.push(`  — ${p}`);
  if (addHelp) lines.push(...addHelp);
  return lines.join("\n") + "\n";
}
// The one refusal that can be acted on without reading the code: the decision does not resolve yet, so the
// message has to name the file to add it to and the two shapes that count as a heading there.
function decideRefusalHelp(res, opts, migrationDir) {
  if (!res.problems.some((p) => /does not resolve in decisions\.md/.test(p))) return [];
  return ["", "  add it to `" + path.join(migrationDir, "decisions.md") + "` as a heading (`## " + opts.decision
    + " — <title>`), or under the plan's `### Adjustments` as `N. **<title>**`, then re-run."];
}
// Each branch is evaluated ONLY when it is the one taken: `opts.pages` is null whenever the decision was
// addressed by task or by row, so reading its length up front throws on the two commonest forms.
function decideTargetLabel(opts) {
  if (opts.rowRef) return `row ${opts.rowRef.n} of ${opts.rowRef.taskId}`;
  if (opts.taskId) return `task ${opts.taskId}`;
  return `${opts.pages.length} page(s): ${opts.pages.join(", ")}`;
}
const decidedRowLine = (x) => `  · ${x.task.file} row ${x.n} — ${x.task.rows[x.n - 1].label}`;
function decideTouchedLines(res, opts) {
  const lines = [`migrate.mjs: ${opts.mode === "postponed" ? "postponed" : "wont-do"} ${res.touched.length} row(s) under ${opts.decision} — ${decideTargetLabel(opts)}.`];
  if (opts.mode === "postponed") lines.push(`  destination: ${opts.destination}`);
  lines.push(...res.touched.map(decidedRowLine));
  if (res.cascaded?.length) {
    lines.push("", `Cascaded into ${res.cascaded.length} matching row(s) across other tasks (repair tasks whose deliverable was the same row):`,
      ...res.cascaded.map(decidedRowLine));
  }
  lines.push(...res.skipped.map((s) => `  ⚠ skipped ${s.task.file} row ${s.n}: ${s.why}`));
  return lines;
}
function runDecideMode(result, dir, opts) {
  // `dir` is the task folder (usually `<migration-folder>/build-tasks`); decisions.md and plan.md live in
  // the migration folder, one level up. `readDecisions` is the same reader the final report already uses,
  // so the citations `--decide` refuses over are the ones the report renders next to a decided cell.
  const migrationDir = path.join(dir, "..");
  const decisions = readDecisions(migrationDir);
  const res = applyDecision(dir, result, { ...opts, decisions });
  if (res.refused) {
    return { note: decidePrintProblems(`--decide ${opts.decision} was refused`, res.problems,
      decideRefusalHelp(res, opts, migrationDir)), ok: false };
  }
  const lines = decideTouchedLines(res, opts);
  // A cell the in-place writer could not place is reported as a FAILURE, not folded into the success line. Its
  // `decisions:` entry was dropped with it, so the folder is consistent — but the decision did not fully land
  // and the person has to look at the body before re-running.
  if (res.unplaced?.length) {
    lines.push("", `⛔ ${res.unplaced.length} row(s) could NOT be written — their \`## Deliverables\` row was not found`
      + " or the rewritten cell did not read back. Nothing was recorded for them; fix the body and re-run:",
      ...res.unplaced.map((u) => `  · ${u.task.file} row ${u.n}`));
    return { note: lines.join("\n") + "\n", ok: false };
  }
  lines.push("", "Re-run `--verify` next: the report's carry-over section renders every postponed row with its destination.");
  return { note: lines.join("\n") + "\n", ok: true };
}
function runRevokeMode(result, dir, opts) {
  const res = revokeDecision(dir, result, opts);
  if (res.refused) return { note: decidePrintProblems(`--revoke ${opts.decision} was refused`, res.problems || []), ok: false };
  // A map entry whose cell does not match is NOT cleared (see revokeDecision) — say so either way, because
  // a silent skip reads exactly like a successful revoke to the person who ran the command.
  const skipLines = (res.skipped || []).map((s) => `  ⚠ skipped ${s.task.file} row ${s.n}: ${s.why}`);
  if (!res.cleared.length) {
    const head = `migrate.mjs: nothing to revoke — no cell in ${dir} was written under ${opts.decision}.`;
    return { note: [head, ...skipLines].join("\n") + "\n", ok: true };
  }
  const lines = [`migrate.mjs: revoked ${opts.decision} — cleared ${res.cleared.length} cell(s).`];
  for (const c of res.cleared) lines.push(`  · ${c.task.file} row ${c.n} — ${c.task.rows[c.n - 1].label}`);
  lines.push(...skipLines, "", "Cascade-closed repair tasks are NOT revived by --revoke: the next `--verify` measures the page as it then stands and re-opens what still needs work (per ENG-99749 point 3).");
  return { note: lines.join("\n") + "\n", ok: true };
}

// The artifact a `--from` run writes when `--out` names nothing: the migration result report under `--tasks`,
// the bare plan-vs-built table otherwise. Its own function so the two conditions are not one nested ternary.
function defaultOutFile(fromDir, tasksMode) {
  if (!fromDir) return null;
  return path.join(fromDir, tasksMode ? REPORT_FILE : VERIFY_FILE);
}

function outFileNote(label, outFile, notReady, verifyMode) {
  if (!notReady) return `migrate.mjs: wrote ${label} to ${outFile} — present that file verbatim.\n`;
  if (label === "migration result report") {
    return `migrate.mjs: wrote ${label} to ${outFile} — its verdict is NOT COMPLETE, and the reasons are its first line: PRESENT IT VERBATIM (sections 1-3 name what needs a decision, what the agent closed as a boundary, and what the machine could not confirm). Do not hand-write a status summary of your own, and do not present \`build-tasks/index.md\` — the report carries the OPEN machine rows and the confirmed counts; a plain --verify with no --tasks prints the full row-level table.\n`;
  }
  if (verifyMode) {
    return `migrate.mjs: wrote ${label} to ${outFile} — this run is INCOMPLETE, and that is what the table reports: PRESENT IT VERBATIM (it names every ❌ MISSING and ⚠ unverified row). Do not hand-write a status summary of your own, and do not treat the file as an approvable plan — read the ⛔ stderr line(s) below to tell a repairable build gap from a PLAN-level one.\n`;
  }
  return `migrate.mjs: wrote ${label} to ${outFile}, but ⛔ this run is BLOCKED/INCOMPLETE — do NOT build or present it; fix the ⛔ items at the top of the file and re-run.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fail = (msg) => { process.stderr.write("migrate.mjs: " + msg + "\n"); process.exit(1); };
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
  if (unknown.length) fail(`unknown flag ${unknown.join(" / ")} — this CLI accepts ${[...KNOWN_FLAGS].sort((a, b) => a.localeCompare(b)).join(" ")}. Nothing was written: an ignored flag makes a wrong invocation report success (\`--spec --page main\` and \`--spec --page list\` returned the same whole spec twice).`);
  const planMode = argv.includes("--plan");   // print the WHOLE plan skeleton (fill placeholders, paste verbatim)
  const specMode = argv.includes("--spec");   // print ONLY the design-spec Markdown
  const checklistMode = argv.includes("--checklist"); // print ONLY the Plan-vs-Done control table (AFTER implementation)
  const stubsMode = argv.includes("--stubs"); // print ONLY the step-5.1 handoff digest (imperative rows per scope)
  const tasksMode = argv.includes(TASKS_FLAG); // WRITE the build-task folder (one file per task + a derived index)
  let repairNote = "";                        // set when `--verify --tasks` wrote a repair round into that folder
  let readProblems = [];                      // `--verify --from`: the reads that could not be opened
  let builtWritten = null;                    // …and where the composed payload was written
  let finalReport = null;                     // `--verify --tasks`: the migration result report
  let ledgerIncomplete = false;               // …and whether its verdict is NOT COMPLETE (exit 2 like the other gates)
  let splitText = null;                       // the `--split` file's bytes, frozen into the folder once it resolves
  const verifyMode = argv.includes("--verify"); // VERIFY the built page against expected deliverables (needs --built)
  // `--built <file>`: the per-page map of clio `get-page`'s `bundle.viewConfig` (the MERGED page). NOT
  // `ownBodySummary` — an element the TEMPLATE provides carries no `type` there, so that source reads ❌ MISSING
  // on a correctly built page. The fail string three lines below says the same thing; a comment saying
  // the opposite is exactly the kind of drift that gets a payload hand-built from the wrong source.
  // A second mode flag alongside `--tasks` is a LOUD stop, not a silent precedence win. Every other mode is a
  // print; this one WRITES a folder, so "the first flag matched wins" would answer `--plan --tasks ./d` with a plan
  // on stdout and no folder — and a caller reading the exit code would believe the tasks were sliced.
  // `--verify --tasks <dir>` is the ONE legal pairing, and it is not two modes running at once: `--verify` is
  // still the mode, and the folder is where its OPEN ROWS are written as repair tasks. Everything else still
  // writes a folder while the other flag prints an artifact, so one of the two would silently not happen.
  if (tasksMode) {
    const alsoAsked = [["--plan", planMode], ["--spec", specMode], ["--checklist", checklistMode], ["--stubs", stubsMode]]
      .filter(([, on]) => on).map(([name]) => name);
    if (alsoAsked.length) fail(`\`--tasks\` cannot be combined with ${alsoAsked.join(" / ")} — it WRITES a folder while those print an artifact, so one of the two would silently not happen. Run them as separate commands.`);
  }
  // `--from <dir>`: the engine COMPOSES the payload from the files `--reads <dir>` named and writes it to
  // `<dir>/built.json`. `--built <file>` stays — offline replay and every engine test hand the gate a recorded
  // payload, and a mode that only works against a live folder could not be tested from a fixture.
  const fromDir = valueFlagArg(argv, FROM_FLAG, `${FROM_FLAG} ./migration-folder`, fail);
  if (fromDir && !verifyMode) fail(`\`${FROM_FLAG}\` only means something with \`--verify\` — it composes the payload that gate reads.`);
  const builtIdx = argv.indexOf("--built");
  if (fromDir && builtIdx >= 0) fail(`\`${FROM_FLAG}\` and \`--built\` are two sources for ONE payload — pass the folder to compose from, or the file to replay, never both. Nothing was read.`);
  if (verifyMode && !fromDir && (builtIdx < 0 || argv[builtIdx + 1] === undefined || argv[builtIdx + 1].startsWith("--")))
    fail("`--verify` needs `--built <file>` — a JSON KEYED BY PAGE: " + BUILT_SHAPE + ". Key it by the page keys `--checklist` groups by (`main`, `list`, `child:<Entity>`, `typed:<Schema>`, `mini:<Schema>`), and give each one clio `get-page`'s `bundle.viewConfig` VERBATIM (the merged page — not the page's own body, which cannot show template-provided components).");
  const builtFile = builtIdx >= 0 ? argv[builtIdx + 1] : null;
  // `--tasks <dir>`: the DIRECTORY the task files and the index are written into. It is created if missing, and
  // nothing already in it is deleted — see tasks.mjs.
  const tasksDir = valueFlagArg(argv, TASKS_FLAG, `${TASKS_FLAG} ./build-tasks`, fail);
  // `--split <file>`: WHERE the seams are, decided once and frozen into the folder. Without it the engine falls
  // back to its own budget slicer — which is fine for a plan small enough that the seams do not matter, and was
  // measured putting a related list and its filter in different tasks on one that was not.
  const splitFile = valueFlagArg(argv, SPLIT_FLAG, `${SPLIT_FLAG} ./split.json`, fail);
  // `--out <file>`: WRITE the output to a file so the agent presents the file, not a hand-paste.
  // On a `--from` run it DEFAULTS into the migration folder: the payload lands there and the table that judges it
  // has to land beside it, or the run is re-checkable only in halves. An explicit `--out` still wins.
  const outFile = valueFlagArg(argv, "--out", "--out plan.md", fail)
    || defaultOutFile(fromDir, tasksMode);
  // `--tasks` already WRITES a folder, so `--out` has nothing to name here. Silently ignoring it would leave a
  // caller believing the artifact went where it asked (and `--out` is how every other mode's artifact is named).
  if (splitFile && !tasksMode) fail(`\`${SPLIT_FLAG}\` only means something with \`${TASKS_FLAG} <dir>\` — it says where that folder's seams are.`);
  // `--start <id>`: mark that task in-progress and stamp its clock, THEN regenerate. Only with `--tasks <dir>`,
  // and never with `--verify`, whose folder writes are repair rounds rather than a dispatch.
  const startId = valueFlagArg(argv, START_FLAG, `${START_FLAG} <task-id>`, fail);
  if (startId && (!tasksMode || verifyMode)) fail(`\`${START_FLAG}\` only means something with \`${TASKS_FLAG} <dir>\` on its own — it marks the task you are about to dispatch.`);
  // `--reads <dir>`: WRITE the read plan the verify gate needs — which pages, which rule reads, which on-stand
  // checks, and the exact file each response goes into. Its own mode: it WRITES a folder, so pairing it with a
  // print mode would make one of the two silently not happen (the rule `--tasks` carries).
  const readsDir = valueFlagArg(argv, READS_FLAG, `${READS_FLAG} ./migration-folder`, fail);
  if (readsDir) {
    const alsoAsked = [["--plan", planMode], ["--spec", specMode], ["--checklist", checklistMode],
      ["--stubs", stubsMode], ["--verify", verifyMode], [TASKS_FLAG, tasksMode]]
      .filter(([, on]) => on).map(([name]) => name);
    if (alsoAsked.length) fail(`\`${READS_FLAG}\` cannot be combined with ${alsoAsked.join(" / ")} — it WRITES the read plan for a gate that has not run yet, and those either print an artifact or verify one. Run them as separate commands.`);
  }
  // `--route`: open a repair round over the rows a build agent recorded as NOT BUILT, without a verify run.
  // `--add <file.json>`: the orchestrator DECLARES a task the plan does not model and the engine writes the
  // file. The declaration is the contract; the file shape is the engine's.
  const addIdx = argv.indexOf(ADD_FLAG);
  const addFile = addIdx >= 0 ? argv[addIdx + 1] : null;
  if (addIdx >= 0 && (!addFile || addFile.startsWith("--")))
    fail(`\`${ADD_FLAG}\` needs a path to the declaration file`);
  if (addFile && !tasksMode) fail(`\`${ADD_FLAG}\` only means something with \`${TASKS_FLAG} <dir>\` — it adds a task to that folder.`);
  if (addFile && verifyMode) fail(`\`${ADD_FLAG}\` writes a task; \`--verify\` reads the folder. Run them as separate commands.`);
  if (addFile && startId) fail(`\`${ADD_FLAG}\` and \`${START_FLAG}\` are separate calls — one FILES the task, the other marks the one you are about to dispatch.`);
  const routeMode = argv.includes(ROUTE_FLAG);
  if (routeMode && !tasksMode) fail(`\`${ROUTE_FLAG}\` only means something with \`${TASKS_FLAG} <dir>\` — it opens a repair round in that folder.`);
  if (routeMode && verifyMode) fail(`\`${ROUTE_FLAG}\` and \`--verify\` do the same routing — \`--verify ${TASKS_FLAG} <dir>\` already writes a round over every open row, its own and the not-built ones. Drop \`${ROUTE_FLAG}\`; it is for a run in flight, which has no \`--built\` payload to verify with.`);
  // Both write the folder, and running them in one call would name a repair task and mark it started in the same
  // breath — so a caller reading the output could not tell which task the token belongs to.
  if (routeMode && startId) fail(`\`${ROUTE_FLAG}\` and \`${START_FLAG}\` are separate calls — one SCHEDULES the repair work, the other marks the task you are about to dispatch. Route first, then \`${START_FLAG}\` the repair task this mode names.`);
  // The seams are already frozen in the folder a round is opened over, and `--route` does not re-cut it.
  if (routeMode && splitFile) fail(`\`${SPLIT_FLAG}\` says how to CUT a folder; \`${ROUTE_FLAG}\` opens a repair round in one already cut, reading the split frozen inside it. Run them as separate commands.`);
  // `--next`: ANSWER which tasks are startable right now — it dispatches nothing and issues no token.
  const nextMode = argv.includes(NEXT_FLAG);
  if (nextMode && !tasksMode) fail(`\`${NEXT_FLAG}\` only means something with \`${TASKS_FLAG} <dir>\` — it answers which task in THAT folder you may start.`);
  // ⛔ IT REFUSES TO COMBINE WITH ANYTHING THAT MOVES THE FOLDER. Each of `--start`, `--route`, `--verify` and
  // `--split` writes to the folder before this answer would be printed, so one call would describe a state the
  // reader cannot identify — before or after that write. Ask first, then act on what it named.
  {
    const moves = [[START_FLAG, !!startId], [ROUTE_FLAG, routeMode], ["--verify", verifyMode], [SPLIT_FLAG, !!splitFile]]
      .filter(([, on]) => on).map(([name]) => name);
    if (nextMode && moves.length) fail(`\`${NEXT_FLAG}\` cannot be combined with ${moves.join(" / ")} — each of those WRITES the folder before the answer would be printed, so a single call would describe a state you could not identify. Ask \`${NEXT_FLAG}\` first, then run the command it prints.`);
  }
  // `--decide D<N>` / `--revoke D<N>` — scope-decision mode. Requires `--tasks <dir>` (the folder
  // whose cells it fills or clears). Refuses to combine with other write modes for the same reason `--next`
  // does: a single call would describe or dispatch state the reader cannot identify. Argument shape and
  // resolution live in tasks.mjs / report.mjs (readDecisions).
  const decideArg = valueFlagArg(argv, DECIDE_FLAG, `${DECIDE_FLAG} D13`, fail);
  const revokeArg = valueFlagArg(argv, REVOKE_FLAG, `${REVOKE_FLAG} D13`, fail);
  const wontDoFlag = argv.includes(WONT_DO_FLAG);
  const postponedFlag = argv.includes(POSTPONED_FLAG);
  const toArg = valueFlagArg(argv, TO_FLAG, `${TO_FLAG} ENG-12345`, fail);
  const pagesArg = valueFlagArg(argv, PAGES_FLAG, `${PAGES_FLAG} typed:Service,typed:Product`, fail);
  const taskArg = valueFlagArg(argv, TASK_FLAG, `${TASK_FLAG} <task-id>`, fail);
  const rowArg = valueFlagArg(argv, ROW_FLAG, `${ROW_FLAG} <task-id>:<n>`, fail);
  const decideMode = !!decideArg, revokeMode = !!revokeArg;
  if ((decideMode || revokeMode) && !tasksMode) fail(`\`${decideMode ? DECIDE_FLAG : REVOKE_FLAG}\` only means something with \`${TASKS_FLAG} <dir>\` — it writes into that folder.`);
  if (decideMode && revokeMode) fail(`\`${DECIDE_FLAG}\` and \`${REVOKE_FLAG}\` are opposite operations — run them as separate commands.`);
  if ((decideMode || revokeMode) && (verifyMode || routeMode || nextMode || !!startId || !!addFile || !!splitFile)) {
    fail(`\`${decideMode ? DECIDE_FLAG : REVOKE_FLAG}\` writes into the folder; every other write / query mode does the same or moves it first, so a single call would describe a state the reader cannot identify. Run them as separate commands.`);
  }
  if (decideMode) {
    if (!/^D\d+$/.test(decideArg)) fail(`\`${DECIDE_FLAG}\` needs a decision id shaped D<N> (e.g. \`${DECIDE_FLAG} D13\`) — got \`${decideArg}\`.`);
    if (!wontDoFlag && !postponedFlag) fail(`\`${DECIDE_FLAG}\` needs \`${WONT_DO_FLAG}\` or \`${POSTPONED_FLAG}\`. The two words differ in what they say about the debt: \`${WONT_DO_FLAG}\` closes it, \`${POSTPONED_FLAG}\` records it with a destination.`);
    if (wontDoFlag && postponedFlag) fail(`\`${WONT_DO_FLAG}\` and \`${POSTPONED_FLAG}\` are two answers to one question — pick one.`);
    if (postponedFlag && !toArg) fail(`\`${POSTPONED_FLAG}\` needs \`${TO_FLAG} <destination>\` — an issue key or free text (a key renders as a link in the carry-over section). Demanding a real key would stop a person mid-migration to file a ticket; demanding nothing lets "later" pass for an answer.`);
    if (wontDoFlag && toArg) fail(`\`${TO_FLAG}\` only means something with \`${POSTPONED_FLAG}\` — a decision that closes the debt does not go anywhere.`);
    // Refused at the boundary as well as normalised in `decideCellText`, because the destination ends up inside a
    // markdown table row: a line break would split the row in two and the engine would read the task back broken.
    if (toArg && /[\r\n]/.test(toArg)) fail(`\`${TO_FLAG}\` must be a single line — the destination is written into a \`## Deliverables\` table cell, and a line break splits the row.`);
    const addressings = [!!pagesArg, !!taskArg, !!rowArg].filter(Boolean).length;
    if (addressings === 0) fail(`\`${DECIDE_FLAG}\` needs one of \`${PAGES_FLAG} <keys>\`, \`${TASK_FLAG} <id>\` or \`${ROW_FLAG} <task-id>:<n>\` — the row addressing this decision covers.`);
    if (addressings > 1) fail(`\`${PAGES_FLAG}\` / \`${TASK_FLAG}\` / \`${ROW_FLAG}\` are three addressings for ONE decision — pick one.`);
  }
  if (revokeMode) {
    if (!/^D\d+$/.test(revokeArg)) fail(`\`${REVOKE_FLAG}\` needs a decision id shaped D<N> (e.g. \`${REVOKE_FLAG} D13\`) — got \`${revokeArg}\`.`);
    for (const [flag, val] of [[WONT_DO_FLAG, wontDoFlag], [POSTPONED_FLAG, postponedFlag], [TO_FLAG, !!toArg], [PAGES_FLAG, !!pagesArg], [TASK_FLAG, !!taskArg], [ROW_FLAG, !!rowArg]]) {
      if (val) fail(`\`${flag}\` does not go with \`${REVOKE_FLAG}\` — the subject is the decision, and the engine removes exactly the cells it wrote (named in each task's \`decisions:\` map). No addressing to give.`);
    }
  }
  if (tasksMode && !verifyMode && !decideMode && !revokeMode && outFile) fail("`--tasks <dir>` writes the folder itself — `--out` names no artifact in this mode; drop it (the index is always `" + TASK_INDEX_FILE + "` inside that directory)");
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
        // The ⚠ Confirm MEMBER rows (message / mixin / module-dep), summed like the stubs. Absent from this object
        // until now, while the consumer's "nothing to describe" shortcut tested `!totals.members` — so a surface
        // with zero method stubs but real message/mixin members read as empty and skipped its analysis entirely.
        members: result.stubIndex.reduce((n, s) => n + s.counts.members, 0),
        unresolvedTrigger: result.stubIndex.reduce((n, s) => n + s.counts.unresolvedTrigger, 0),
        externalRef: result.stubIndex.reduce((n, s) => n + s.counts.externalRef, 0),
      },
      scopes: result.stubIndex,
    }, null, 2) + "\n";
  }
  // `--tasks` is the one mode that WRITES into a caller-supplied directory, so it is also the one most likely to
  // hit a filesystem error (`--tasks ./notes.md` ⇒ `ENOTDIR`, a read-only parent, a missing parent). Every sibling
  // FS operation here routes its failure through `fail()`; without this guard the operator — and the orchestrator
  // that parses stderr — got a raw Node stack trace instead of the `migrate.mjs: …` diagnostic.
  // `--verify` is checked BEFORE `--tasks`: with both, verify is the MODE and the folder is only where its open
  // rows are written. Matched the other way round, `--verify --tasks <dir>` re-sliced the plan and printed no
  // table at all — the caller asked for a verification and got a task folder.
  // Derived from the SAME `checklistGroups` walk `--checklist` and `--verify` use, so a page key the checklist
  // publishes can never be a key nobody was told to read. That is why the engine owns this list.
  else if (readsDir) {
    let plan;
    try {
      plan = readPlan(result, checklistOpts(manifest));
      writeReadIndex(readsDir, plan);
      // …and the skeletons for the two halves the stand does not hold, so no id is ever retyped.
      writeEvidenceSkeletons(readsDir, plan);
    } catch (e) { fail(`could not write the read plan to ${readsDir}: ${e.message}`); }
    output = renderReadPlan(plan, readsDir);
  }
  // BEFORE the slicing branch: `--route` writes into a folder that is already cut, and re-slicing it here would
  // be a second opinion on seams the folder froze.
  else if (tasksMode && addFile) {
    let text;
    try { text = fs.readFileSync(addFile, "utf8"); }
    catch (e) { fail(`cannot read ${ADD_FLAG} '${addFile}': ${e.message}`); }
    let decl;
    try { decl = JSON.parse(text); }
    catch (e) { fail(`${ADD_FLAG} '${addFile}' is not valid JSON: ${e.message}. Expected shape: ${DECL_SHAPE}`); }
    let res;
    try { res = addTasks(tasksDir, result, decl, checklistOpts(manifest)); }
    catch (e) { fail(`cannot write the declared task(s) to '${tasksDir}': ${e.message}`); }
    if (res.refused) {
      // NOTHING WRITTEN on any problem, as a bad `--split` writes nothing. A CUT that does not resolve is named
      // by the writers every other leg shares; a DECLARATION the plan cannot place is named by its own shape.
      if (res.refusal) {
        fail(`${ADD_FLAG} wrote nothing — ${refusalCause(res, tasksDir)}:\n`
          + res.problems.map((x) => "  — " + x).join("\n") + `\n${refusalRemedy(res).trim()}`);
      }
      fail(`${ADD_FLAG} '${addFile}' does not resolve against this plan:\n`
        + res.problems.map((x) => "  — " + x).join("\n") + `\nExpected shape: ${res.shape}`);
    }
    output = [`migrate.mjs: wrote ${res.written.length} declared task(s) to ${tasksDir} + ${TASK_INDEX_FILE}.`,
      ...res.written.map((t) => `  — ${t.file} (${t.rows.length} deliverable(s))`),
      "The file is the engine's to write and yours to fill: its `Outcome` column is what its status is derived",
      "from, exactly as for a task cut from the plan. `--start` it like any other before you dispatch.", ""].join("\n");
  }
  // BEFORE both folder-writing branches: this one answers a question about the folder and must not be shadowed
  // by the slicing branch, which would print a wrote-N-tasks note instead of the answer that was asked for.
  else if (tasksMode && nextMode) {
    // NOTHING IN THE ANSWER IS PARSED POSITIONALLY (the workaround this replaces read `index.md` by column, and
    // the report was later reshaped under it). Each named task carries the command that starts it, with every
    // element encoded for the shell — a path with a space in it is the normal case on Windows, where the node
    // executable itself lives under `Program Files`.
    const manifestArg = fromFile ? arg : "-";
    // EVERY element goes through the encoder, the id included: it is front matter the engine did not necessarily
    // mint, and an unencoded one would be shell text rather than an argument.
    let printedCommand = false;
    const cmdFor = (id) => {
      printedCommand = true;
      return [shellArg(process.execPath), shellArg(process.argv[1]), shellArg(manifestArg),
        TASKS_FLAG, shellArg(tasksDir), START_FLAG, shellArg(id)].join(" ");
    };
    try { output = runNextMode(result, tasksDir, checklistOpts(manifest), cmdFor); }
    catch (e) { fail(`cannot read the task folder '${tasksDir}': ${e.message}`); }
    // …and when the manifest came in on stdin there is no path to print, so the command carries `-` and would
    // BLOCK on a terminal if it were pasted as it stands. Said here rather than left for the reader to discover.
    // Gated on whether a command was actually PRINTED, not on the rendered text: the ledger verdict's own prose
    // names `--start` while dispatching nothing, and a note about "each command above" under it describes none.
    if (!fromFile && printedCommand) {
      output += `migrate.mjs: ℹ this run read the manifest from stdin, so the \`-\` in each command above means`
        + " \"pipe the same manifest in again\" — pasted bare it would wait on a terminal. Pass the manifest as a"
        + " path to get commands that run exactly as printed.\n";
    }
  }
  // `--decide` / `--revoke` — writes into the frozen folder. Placed BEFORE the slicing branch
  // for the same reason `--add` is: they neither re-cut nor re-verify the folder, they fill (or clear) the
  // Outcome cells of the rows a person's decision covers, and then persistTaskSet closes over the result.
  else if (tasksMode && decideMode) {
    const opts = { ...checklistOpts(manifest), decision: decideArg,
      mode: wontDoFlag ? "wont-do" : "postponed", destination: toArg || null,
      pages: pagesArg ? pagesArg.split(",").map((s) => s.trim()).filter(Boolean) : null,
      taskId: taskArg || null,
      rowRef: rowArg ? (() => { const at = rowArg.lastIndexOf(":"); return at > 0 ? { taskId: rowArg.slice(0, at), n: rowArg.slice(at + 1) } : { taskId: rowArg, n: Number.NaN }; })() : null };
    let res;
    try { res = runDecideMode(result, tasksDir, opts); }
    catch (e) { fail(`cannot apply the decision to '${tasksDir}': ${e.message}`); }
    if (!res.ok) { process.stderr.write(res.note); process.exit(1); }
    output = res.note;
  }
  else if (tasksMode && revokeMode) {
    const opts = { ...checklistOpts(manifest), decision: revokeArg };
    let res;
    try { res = runRevokeMode(result, tasksDir, opts); }
    catch (e) { fail(`cannot revoke the decision in '${tasksDir}': ${e.message}`); }
    if (!res.ok) { process.stderr.write(res.note); process.exit(1); }
    output = res.note;
  }
  // `--route` writes into a folder that is already cut, and re-slicing it here would be a second opinion on
  // seams the folder froze.
  else if (tasksMode && routeMode) {
    try { output = runRouteMode(result, tasksDir, checklistOpts(manifest)); }
    catch (e) { fail(`cannot write repair tasks to '${tasksDir}': ${e.message}`); }
  }
  else if (tasksMode && !verifyMode) {
    let split = null;
    if (splitFile) {
      let text; try { text = fs.readFileSync(splitFile, "utf8"); }
      catch (e) { fail(`cannot read ${SPLIT_FLAG} '${splitFile}': ${e.message}`); }
      const parsed = parseSplit(text);
      // Refused BEFORE anything is written: a malformed split must not leave a folder half-cut behind it.
      if (!parsed.split) fail(`${SPLIT_FLAG} '${splitFile}' ${parsed.errors.join("; ")}. Expected shape: ${SPLIT_SHAPE}`);
      split = parsed.split;
      if (split.planVersion && result.planVersion && split.planVersion !== result.planVersion) {
        fail(`${SPLIT_FLAG} '${splitFile}' was cut against plan \`${split.planVersion}\` but this manifest renders \`${result.planVersion}\``
          + " — the seams were decided against different deliverables. Re-cut the split against the current plan, or re-plan against the one it names.");
      }
      splitText = text;
    }
    try { output = runTaskMode(result, tasksDir, checklistOpts(manifest), split, splitText, startId); }
    catch (e) { fail(`cannot write task folder '${tasksDir}': ${e.message}`); }
  }
  else if (verifyMode) {
    let built;
    if (fromDir) {
      // COMPOSED, not handed over: every value comes out of a file clio wrote at a path `--reads` named, and the
      // payload is written beside the run so the same gate replays against it offline.
      // The plan the index is diffed against is derived HERE, from the manifest this run verifies — so a read
      // plan cut against an earlier draft cannot pass as this one's.
      let res; try { res = assembleBuilt(fromDir, readPlan(result, checklistOpts(manifest))); }
      catch (e) { fail(`cannot compose the payload from '${fromDir}': ${e.message}`); }
      // Built as a statement rather than nested inside the template below (Sonar S4624).
      const why = res.problems.map((x) => x.file + " — " + x.why).join("; ");
      if (!res.built) fail(`cannot compose the payload from '${fromDir}': ${why}.`
        + ` Run \`${READS_FLAG} ${fromDir}\` first, then do the reads it names.`);
      readProblems = res.problems;
      built = res.built;
      try { builtWritten = writeBuilt(fromDir, built); }
      catch (e) { fail(`cannot write ${BUILT_FILE} to '${fromDir}': ${e.message}`); }
    }
    else { try { built = JSON.parse(fs.readFileSync(builtFile, "utf8")); }
      catch (e) { fail(`cannot read --built '${builtFile}': ${e.message}`); } }
    // VALIDATE BEFORE RENDERING: `renderVerify` is called outside the try above, so a throw inside it surfaces as a
    // raw Node stack instead of a diagnosable message — and a malformed payload must be a loud exit 1, never a
    // table full of ⚠ rows that reads like a half-built page.
    const issue = builtPayloadIssue(built);
    // A COMPOSED payload that fails the guard is an engine defect or an unreadable source file, not a caller's
    // hand-authored mistake — so it names the folder it was composed from rather than telling the caller to fix
    // a file they never wrote.
    if (issue && fromDir) fail(`the payload composed from '${fromDir}' ${issue}. The files under ${fromDir}/reads/ are what it was built from — check they are the ones \`${READS_FLAG}\` named.`);
    if (issue) fail(`--built '${builtFile}' ${issue}. Expected ` + BUILT_SHAPE + ". Key it by the page keys `--checklist` groups by.");
    // AC 12: when `--tasks <dir>` is present, the LIST of rows to verify comes from the task
    // REGISTRY, not the plan walk. Read the folder once here (read-only, before the repair round writes
    // anything), collect the deliverables the registry has closed by decision, and pass them to
    // `renderVerify` so those rows never become MISSING. When `--verify` runs without `--tasks`, no
    // registry exists — `decidedKeys` stays null and `renderVerify` falls back to the plan walk unchanged.
    let decidedKeys = null;
    let preMergedSet = null;
    if (tasksMode) {
      try {
        preMergedSet = readMergedTaskDir(tasksDir, result, checklistOpts(manifest));
        if (preMergedSet && !preMergedSet.refused) decidedKeys = decidedRowKeys(preMergedSet);
        else preMergedSet = null;
      } catch { /* folder unreadable — fall back to plan walk; the report leg will name the failure */ }
    }
    // The SAME opts object `--checklist` renders with (checklistOpts): the two must produce the same row set, and
    // a thinner verify-only literal made that a coincidence rather than a guarantee.
    verifyRes = renderVerify(result, checklistOpts(manifest), built, decidedKeys);
    // The unread-file block goes INTO the artifact, above the table. The table is the only sanctioned report, so
    // a reader holding it must be able to tell a row nobody could read from a row nobody built.
    output = [...problemBanner(readProblems), verifyRes.markdown].join("\n") + "\n";
    verifyIncomplete = !verifyRes.complete; // any MISSING or unverified deliverable ⇒ not done (ONE source of truth)
    if (tasksMode) {
      // an ORCHESTRATED run closes on the MIGRATION RESULT REPORT, not on the machine table alone.
      // The table's verdict reads only the built pages; the task ledger records what the build agents did NOT
      // build (needs-decision, blocked, agent-asserted boundaries) and which tasks never closed. Measured: the
      // table said "2 machine row(s) not confirmed" while the ledger held 5 open tasks, 3 partial and three
      // handlers recorded not built — and the table was what the user was shown. The report renders BOTH and its
      // verdict is their conjunction; the report carries the OPEN machine rows and per-page confirmed counts; the full row-level table is a plain --verify (no --tasks), not part of this artifact.
      // NO REPAIR ROUND OVER ROWS NOBODY READ. An unread page leaves its key out, and `syncRepairDir` turns an
      // `unverified` row into a repair task — so without this guard the prescribed gate dispatches build agents at
      // a page that was never checked, burns a round against the cap and can park a cause, while the same run says
      // on stderr that the rows are NOT CHECKED and want a re-read. The dispatch gate already refuses on the same
      // principle: rows that cannot be trusted to describe what was built are not rows to schedule work from.
      const rep = readProblems.length
        ? { note: `migrate.mjs: ⛔ NO REPAIR TASKS WRITTEN — ${readProblems.length} read(s) could not be used, so the`
            + " open rows do not describe what was built. Re-run those reads and verify again.\n", set: null, repair: null }
        : runRepairMode(result, tasksDir, verifyRes, checklistOpts(manifest));
      repairNote = rep.note;
      // A refused round merged nothing — read the folder read-only, so the report still says what it holds.
      // Reuse the AC 12 pre-pass here and ONLY here: this branch is reached when the round wrote nothing
      // (`rep.set` is null), so the folder is byte-identical to what that pass already read. It cannot be
      // reused for the post-round report, because `runRepairMode`/`syncRepairDir` write repair task files
      // between the two and a reused set would render a stale folder.
      const set = rep.set || preMergedSet || readMergedTaskDir(tasksDir, result, checklistOpts(manifest));
      // The plan-vs-built table is NOT written as a file: nothing reads it (the repair round and the report take it
      // from `verifyRes` in memory), and a second artifact beside the report is one more thing a reader has to reconcile.
      finalReport = renderFinalReport({ result, verifyRes, set, dir: tasksDir, built, repair: rep.repair, gates: { dispatchFailed: !!dispatchGateFailure } });
      // The report REPLACES the table as the artifact, so the unread-file banner has to be carried onto it too —
      // prepending it to the table alone loses it on exactly the command an orchestrated run is told to use.
      output = [...problemBanner(readProblems), finalReport.markdown].join("\n") + "\n";
      ledgerIncomplete = !finalReport.complete;
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
  const planIncomplete = planMode && ((result.planMetaMissing?.length > 0) || (result.signalsMissing?.length > 0) || (result.placementBlockers?.length > 0));
  // ⛔ COVERAGE — a schema member with no artifact and no decision. Gated exactly like the other completeness
  // checks: an unaccounted member means the plan claims a coverage it does not have.
  const coverageBad = result.coverage && !result.coverage.complete;
  // ⛔ LIST GATE — the LIST deliverable's own verdict. It gates exactly like the three above: the plan
  // already prints "⛔ The list page is NOT approvable", and without this leg the CLI still exited 0 next to that
  // banner, so an operator (and the build executor, which reads the exit code / `planGaps`, not the Markdown)
  // could build the Freedom list from a section whose `diff` was never readable.
  const listGateBad = result.listGate?.blocked;
  const notReady = gateBad || structBad || planIncomplete || coverageBad || listGateBad || verifyIncomplete
    || !!dispatchGateFailure || !!partialGateFailure || readProblems.length > 0 || ledgerIncomplete
    || !!startableGateFailure || nextRefusalFailure || taskRefusalFailure || routeRefusalFailure
    || startRefusalFailure;
  let label = "result";
  if (planMode) label = "plan";
  else if (specMode) label = "design spec";
  else if (checklistMode) label = "checklist";
  else if (stubsMode) label = "imperative-row handoff digest";
  else if (readsDir) label = "read plan";
  else if (verifyMode && tasksMode) label = "migration result report";
  else if (verifyMode) label = "verification";
  else if (tasksMode && nextMode) label = "startable tasks";
  else if (tasksMode) label = "build tasks";
  if (outFile) {
    // engine WRITES the artifact (Smell #2): the agent presents this file verbatim instead of hand-pasting stdout.
    try { fs.writeFileSync(outFile, output); }
    catch (e) { fail(`cannot write --out '${outFile}': ${e.message}`); }
    process.stdout.write(outFileNote(label, outFile, notReady, verifyMode));
  } else {
    process.stdout.write(output);
  }
  // Same placement rule as the repair note: it names a file written BESIDE the artifact. Saying where the payload
  // landed is what makes the run re-checkable — `--verify --built <that file>` reproduces this table offline.
  if (builtWritten) process.stdout.write(`migrate.mjs: composed the verify payload from ${fromDir}/${READS_DIR_NAME}/ and wrote it to ${builtWritten} — replay it offline with \`--verify --built ${builtWritten}\`.
`);
  // The repair note goes out AFTER the table (or the wrote-to-file line), because it is about what was written
  // beside that artifact, not about the artifact itself.
  if (repairNote) process.stdout.write(repairNote);
  // THE THIRD exit-2 verdict, and the only one that is about the RUN rather than the plan or the build: the
  // deliverables may be fine and the folder is written, but tasks were closed with nobody dispatched for them.
  // Stated separately so it is not read as either of the other two.
  if (dispatchGateFailure?.startRefusal) {
    process.stderr.write(`migrate.mjs: ⛔ DISPATCH GATE — nothing was started in ${dispatchGateFailure.dir}.`
      + " The stdout block above names the task(s) this one waits on, or the task still writing its artifact.\n");
  }
  else if (dispatchGateFailure) {
    const { audit, dir, started } = dispatchGateFailure;
    process.stderr.write(`migrate.mjs: ⛔ DISPATCH GATE — ${audit.failing.length} closed task(s) in ${dir} have no`
      + ` valid dispatch record (dispatched ${audit.dispatched} of ${audit.total}).`
      + (started ? " The task files and the index WERE written and are current — what failed is the run, not the slice." : "")
      + " This is NOT a plan gap and NOT a short build; re-running the plan changes nothing.\n");
    process.stderr.write(dispatchFailureText(audit, dir) + "\n");
  }
  // Exit 2 for the build's own record of what it did not do — distinct from a short build (`--verify` measures
  // the page against the plan) and from a dispatch failure. Nothing is re-dispatched BY THIS GATE: it reports, and
  // `--route` is what opens a round over the rows it names. The causes say which of the two the row is waiting on
  // — a re-run, or a person.
  if (partialGateFailure) {
    const { items, dir: pDir } = partialGateFailure;
    const nTasks = new Set(items.map((x) => x.task.file)).size;
    process.stderr.write(`migrate.mjs: ⛔ NOT BUILT — ${items.length} deliverable(s) across ${nTasks} task(s) in ${pDir}`
      + " were recorded by the agent that built them as NOT built. The task files and the index ARE written and"
      + " current; what is not true is that this migration is finished.\n");
    process.stderr.write(notBuiltFailureText(items) + "\n");
  }
  // THE FOURTH exit-2 verdict about the RUN rather than the plan or the build, and the only one no command
  // repairs: nothing is startable and nothing is running, so the folder cannot change until somebody decides
  // something. Stated apart from the dispatch gate because their remedies share nothing.
  if (startableGateFailure) {
    const { dir: sDir, answer } = startableGateFailure;
    process.stderr.write(`migrate.mjs: ⛔ RUN HALTED — ${answer.held.length + answer.withheld.length} open task(s)`
      + ` in ${sDir} and NOTHING startable, with nothing in flight. The stdout block above names what holds each`
      + " one. This is not a build gap and not a plan gap: re-running any mode returns the same answer.\n");
  }
  if (gateBad) process.stderr.write("migrate.mjs: ⛔ GATE BLOCKED — do NOT build. " + result.gate.reasons.join(" | ") + "\n");
  if (structBad) process.stderr.write("migrate.mjs: ⛔ STRUCTURE INCOMPLETE — plan not ready. " + result.structure.issues.join(" | ") + "\n");
  if (listGateBad) process.stderr.write("migrate.mjs: ⛔ LIST GATE BLOCKED — the list page is NOT approvable (the form page may still be). " + result.listGate.reasons.join(" | ") + "\n");
  if (coverageBad) process.stderr.write(`migrate.mjs: ⛔ COVERAGE INCOMPLETE — ${result.coverage.issues.length} schema member(s) unaccounted (no Freedom artifact, no decision). ` + result.coverage.issues.slice(0, 5).join(" | ") + (result.coverage.issues.length > 5 ? ` | …and ${result.coverage.issues.length - 5} more (see result.coverage.issues)` : "") + "\n");
  // D12 — the `--verify` leg of exit 2, stated apart from the three above. `gate`/`structure`/`coverage` fire in
  // EVERY mode and describe the PLAN: a builder cannot build its way out of them, so "loop until --verify is
  // green" against one of those never converges. THIS line is the other condition — MY BUILD is short — and it IS
  // repairable on-stand. Until now `--verify` exited 2 with no stderr line at all, so the two were indistinguishable.
  if (verifyIncomplete) {
    const pageGaps = Object.entries(verifyRes.pages).filter(([, p]) => !p.complete).map(([k, p]) => `${k}: ${p.missing} missing / ${p.unverified} unconfirmed`);
    // The six-page truncation is a READABILITY limit on this human line only; the table above carries every row.
    const overflow = pageGaps.length > 6 ? ` | …and ${pageGaps.length - 6} more (see the table)` : "";
    process.stderr.write(`migrate.mjs: ⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete: ${verifyRes.missing} MISSING + ${verifyRes.unverified} unconfirmed deliverable(s) across ${pageGaps.length} page(s). ${pageGaps.slice(0, 6).join(" | ")}${overflow}. This is repairable: build the missing pieces / file the on-stand evidence, then re-verify.\n`);
    const gaps = planGaps(result);
    if (gaps.length) process.stderr.write(`migrate.mjs: ℹ this run ALSO has PLAN-level gaps (${gaps.join(" · ")}) — those are NOT buildable-out-of; fix the plan instead of re-verifying against them.\n`)
  }
  // The READ leg, stated apart from the build legs above: a row can be open because the page is short OR because
  // nobody could read it, and those are different jobs — a repair versus a re-read. The table cannot tell them
  // apart (an omitted key reads ⚠ like any other unconfirmed row), so this is where the difference is said.
  if (readProblems.length) process.stderr.write(problemLines(readProblems, fromDir).join("\n") + "\n");
  // the LEDGER leg of exit 2, stated apart from the verify leg: the built pages may all check out
  // while the task folder still holds open work. The dispatch and not-built lines above already name their own
  // rows; this line fires for what they do not cover (tasks still todo / in-progress / partial) and names the
  // report as the place to read it, so an orchestrator reading stderr alone cannot mistake a green table for a
  // finished run.
  if (finalReport && !finalReport.complete) {
    const t = finalReport.counts.tasks;
    const naPart = t.na ? ` / ${t.na} not-applicable` : "";
    const blockedPart = t.blocked ? ` / ${t.blocked} blocked` : "";
    process.stderr.write(`migrate.mjs: ⛔ RUN NOT COMPLETE — ${finalReport.reasons.join(" · ")}. Tasks: ${t.done} done`
      + `${naPart} / ${t.partial} partial / ${t.inProgress} in-progress / ${t.todo} todo`
      + `${blockedPart} of ${t.total}. The migration result report (stdout, or the --out file) is the record — present it, not a summary.\n`);
  }
  if (planMode && result.planMetaMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — required planMeta unfilled: " + result.planMetaMissing.join(", ") + ". Add to manifest.planMeta and re-run.\n");
  if (planMode && result.signalsMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — on-stand signals not resolved: " + result.signalsMissing.join(", ") + ". Run the on-stand check for each key listed above and add its answer to manifest.signals; the ⛔ banner in the --plan output states the exact query and the required fields per key (some carry more than resolved/present). Then re-run.\n");
  if (planMode && result.placementBlockers?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — placement not settled: " + result.placementBlockers.join(" | ") + "\n");
  // WHAT THIS RUN DID NOT CHECK — advisory, on the same stream and in the same voice as the other ℹ notes, so it
  // cannot land inside the verify table the caller presents verbatim. Without a task folder the verify gate reads
  // the built pages and nothing about who built them.
  if (verifyMode && !tasksMode)
    process.stderr.write(`migrate.mjs: ℹ no ${TASKS_FLAG} <dir> — this run checked the BUILT PAGES only; the dispatch`
      + ` gate did not run. If this migration used a task folder, re-run with ${TASKS_FLAG} <that folder> before`
      + " calling it done.\n");
  if (result.parseDiagnostics?.length)
    process.stderr.write(`migrate.mjs: ℹ ${result.parseDiagnostics.length} parse diagnostic(s) — constructs not statically resolved (advisory, see result.parseDiagnostics)\n`);
  // FIDELITY warnings are advisory — printed on the same channel and in the same voice as the parse
  // diagnostics above, so demoting them out of the ⛔ banner does not make them invisible.
  const fidelity = (result.effective?.warnings || []).filter((w) => w.severity === "fidelity" && !w.accepted);
  if (fidelity.length) {
    const fidelityList = fidelity.slice(0, 4).map((w) => `${w.op} '${w.name}' @${w.schema}`).join(" | ");
    process.stderr.write(`migrate.mjs: ℹ ${fidelity.length} fidelity warning(s) — the mapping is correct, an effect is not represented (advisory, see result.effective.warnings): ${fidelityList}\n`);
  }
  if (notReady) process.exit(2);
}
