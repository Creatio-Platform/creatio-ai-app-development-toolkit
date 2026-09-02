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
//        // per-detail CHILD-PAGE resolution (the structure gate accepts exactly these): `"editPage": false` (no Classic *Page exists) ·
//        // `"reuseFreedomPage": "<Freedom form page>"` (the child already ships one) · `"opensClassicPage": "<Classic page>" | true`
//        // + optional `"ownSection": "<Section>"` (ENG-95861 — the child entity owns ANOTHER SECTION: its Classic card stays
//        // Classic, this related list keeps opening it, the page is NEVER folded and publishes no deliverable)
//     "profileSchemas": { "AccountProfileSchema": "<define(...) body>" | { "body"|"file", "entity" }, … }, // REQUIRED once the page embeds a profile card: the embedded profile schema → profiled entity + the columns the card displayed (ENG-93928). Fetch with `get-client-unit-schema --schema-name <SchemaName>`; the structure gate blocks until each recognised card's schema is supplied.
//     "section": [ { "pkg": "HRApplicant/…", "body"|"file": … }, … ], // optional; the *Section chain → add-record mini page, section actions (#8b), list columns (#2)
//     "childPageSchemas": { "<editPage or child entity>": { …a NESTED manifest (schemas/seed/…)… }, … }, // optional; each related list's child EDIT PAGE → the engine recursively maps it and nests its design spec in the plan
//     "planMeta": { scope, environment, package, approach, whatItDoes, sectionSchema, formTemplate }, // optional; fills the plan's Overview/Main-scope so `--plan --out plan.md` writes a COMPLETE plan (no hand-paste). The LIST template is FIXED (ListPageV3Template — ENG-96327), not a planMeta field.
//     "placement": { targetPackageEditable, application, primaryPackage, targetPackageInApplication, sectionHost }, // REQUIRED for `--plan`: can the target APP host the section? See PLACEMENT_KEYS / placementIssues — a writable package is not the same question as a registrable section

//     "behaviourIndex": { "<method>" | "<schema>::<method>" | "<kind>:<name>": { trigger?, from?, card?, ac?: […], bodyCard?, bodyAc?: […], note? }, … } // optional; the step-5.1 behaviour-analysis answers, folded back into the ⚠ Imperative logic / ⚠ Imperative members rows (see applyBehaviourIndex). `bodyCard`/`bodyAc` = the body's own card when it lives in another scope; both are rendered
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
// reachability keys with `appliesWhen` already decided, the evidence-record ids, the ⚠ Confirm preflight items, the
// root-level `templateNames` (every page template this plan asserts, deduped — the executor resolves them against the
// stand BEFORE the first write, ENG-95468) and a leaf-first `buildOrder`. Run it BEFORE building: it is the only source of the keys `--built` must use — an
// invented key is silently "not checked", never an error.
// `--page <key>` narrows `--spec`, `--checklist` and `--units` to ONE published page key. An unknown key is exit 1,
// never a silent fall-back to the whole artifact.
// `--slices <dir>` (with `--units` or `--verify`) ALSO writes one file per published key — `queue-<n>.json` from
// `--units`, `built-<n>.json` from the `--built` payload — so a build agent that owns one unit reads its own row
// instead of the whole file. `<n>` is the page's 1-based POSITION in `pages[]`, not its key: a key is not a legal
// filename and sanitising one is many-to-one. Each slice names its own page in `pageKey`. Additive, and written on
// exit 2 as well: a run with open rows is exactly the round a builder needs its row.
// `--page` and `--slices` COMBINE: the directory gets every published key's file AND stdout carries the one
// page's slice. Neither suppresses the other.
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
import { parseSchema, mergeHierarchy, enumDriftIssues } from "./engine.mjs";
import { mapToFreedom, isScaffoldingMethod, buildListChangeSet, isDecorationItem } from "./mapper.mjs";
import { resolveRunIndex, validateRun, runTypes } from "./mapping-registry.mjs";
import { GATE_KIND, gateForComponentType } from "./mapping-table.mjs";
import { renderDesignSpec, renderPlan, renderChecklist, renderVerify, countFormFields, HANDOFF_MEMBER_KINDS,
  checklistGroups, childTemplateChoice, CHILD_TEMPLATE_SCHEMA, CHILD_PAGE_ANSWERS, reuseChildGroups, unresolvedChildGroups,
  planGaps, pageUnits, verifyReport, verifyDigest, isTabOp, subPageNodes, buildResolutionIndex,
  pageUnitsSlice, builtSlice, verifyUnit, IMPERATIVE_MEMBER_KINDS,
  boundaryChild } from "./designspec.mjs";

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
  // THE SECTION BOUNDARY (ENG-95861). The child entity owns ANOTHER SECTION, and the user drew that line: on Freedom
  // this related list keeps opening the child's CLASSIC card, which the platform handles, so the child is RESOLVED —
  // not a gap, and not the self-declared skip the rule above forbids (that rule stops an AGENT dropping a child
  // because it looks big or shared; a boundary is the USER's scope decision, recorded in the manifest).
  // This is the resolution that keeps the fold from happening at all (`foldOneChildPage` returns early), so a warning
  // inside a page NOBODY IS MIGRATING can no longer block the parent's gate — the whole cost of the run this fixes.
  if (boundaryChild(c)) return null;
  if (c.spec) return c.childStructIncomplete
    ? `child page '${c.resolvedFrom || c.editPage}' (${c.entity}) was mapped but its OWN structure is incomplete — supply its nested detail/child-page schemas; there is no "out of scope"`
    : null;
  // A REAL Classic edit page must be mapped REGARDLESS of the add-record button — hiding Add stops NEW records,
  // not editing EXISTING ones, so the edit page still governs the record UI. Checked FIRST, so a hidden-Add
  // heuristic can never waive a real child page (Major).
  if (typeof c.editPage === "string" && c.editPage)
    return `child page '${c.editPage}' (${c.entity}, opened by detail "${c.via}"): a REAL Classic edit page is NOT mapped — add its schema to manifest.childPageSchemas. There is no "out of scope".`;
  if (c.editPage === false) return null;                       // agent verified: no Classic *Page exists
  // `editable: false` is NOT an answer here — it says Add is hidden, not that no page exists, and the rule above
  // only fires once `editPage` is a string, so accepting it would waive an unnamed page. Read-only TAGS the row
  // view/attach-only; the page-existence answer is still owed.
  return `child '${c.entity}' (opened by detail "${c.via}"): child page NOT verified — run \`list-pages\` by the CHILD entity, then ${CHILD_PAGE_ANSWERS}`;
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
    // `inheritedSignals` rides along for the same reason and with the same memo rule: the on-stand answers are
    // recorded ONCE on the ROOT manifest, so a child bundle (which has none) used to see `{}` and every
    // signal-driven row — the DCM widget gate, and the ENG-94274 on-save duplicate check — silently vanished
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

// ENG-95862 — the SEVERITY axis on `eff.warnings`, and the operator's escape hatch for the advisory half.
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
// used to append to all eight producers ("op hit a missing item / skeletal seed") described a condition that was
// provably absent on the run it blocked, and sent the remedy search to the wrong file for 12 hours.
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
      // USER-approved section boundary (ENG-95861): the child entity owns another section, so its Classic card stays
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
function sectionStubScopes(manifest, opts, sectionSchemas) {
  if (opts.scopeSchema || !sectionSchemas.length) return [];
  const changeSet = mapToFreedom(mergeHierarchy(sectionSchemas), {
    entityColumns: manifest.entityColumns || {},
    resources: manifest.resources || {},
  });
  const schema = manifest.planMeta?.sectionSchema || "Section";
  return [stubScope("section", schema, changeSet, changeSet.standardMethodsFiltered)];
}

// One handoff scope = one schema whose imperative rows are worked as a unit. Kept as a FLAT list of scopes rather
// than one merged array so a caller can hand over (or stage) a single page — the staged-processing direction of
// ENG-94859 — without re-deriving which method belongs to which schema.
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
  return card || ac.length || bodyCard ? { card, ac, bodyCard, bodyAc } : null;
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
    // Scoped first, bare second — the same precedence the method lookup uses, and the bare fallback is what keeps a
    // `behaviour-index.json` written before member keys carried a scope still resolving.
    const entry = (scopeSchema ? map[`${scopeSchema}::${n.kind}:${n.item}`] : undefined) ?? map[`${n.kind}:${n.item}`];
    if (!entry || typeof entry !== "object") continue;
    const d = describedInOf(entry);
    if (d) { n.describedIn = d; described.push(`${n.kind}:${n.item}`); }
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
    for (const m of s.members) seen.add(m.key);
  }
  return seen;
}
function unmatchedIndexKeys(index, stubIndex) {
  const keys = Object.keys(plainObject(index));
  if (!keys.length) return [];
  const seen = scopeDigestKeys(stubIndex);
  return keys.filter((k) => !seen.has(k));
}
// Index keys addressing ONLY the section scope. They are matched (not `unmatched`) — but applyBehaviourIndex
// folds cards into PAGE rows only, so a section-only answer produces no plan artifact: no worklist row cites
// its card. Surfaced as a separate advisory list so "matched" cannot read as "rendered in the plan".
function sectionOnlyIndexKeys(index, stubIndex) {
  const keys = Object.keys(plainObject(index));
  if (!keys.length) return [];
  const pageKeys = scopeDigestKeys(stubIndex.filter((s) => s.role !== "section"));
  const sectionKeys = scopeDigestKeys(stubIndex.filter((s) => s.role === "section"));
  return keys.filter((k) => sectionKeys.has(k) && !pageKeys.has(k));
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
const REQUIRED_PLANMETA = ["scope", "environment", "package", "approach", "whatItDoes", "sectionSchema", "formTemplate"];
// on-stand SIGNALS completeness — the ⚠ conditional checks (DCM case / connected processes / printables)
// must be RESOLVED before the plan, not deferred to build (the recurring "faithful to the classic body,
// check later" miss). No new tool is needed — the agent runs the existing ESQ/odata queries and records the
// answers in `manifest.signals`, each key `{ resolved:true, present:<bool>, cases|items|names?:[…] }`. An
// absent/unresolved key makes --plan INCOMPLETE (like planMeta). `present:false` (checked, none) is a VALID
// resolved state — the distinction is "verified none" vs "never checked", exactly like child-page editPage.
// `deduplication` (ENG-94274) joins them for exactly the same reason: the on-save duplicate check is an
// `asyncValidate` override on `CrtDeduplication.BaseEntityPage`, so it arrives via the base seed chain, counts as
// `fromTemplate`, and is classified as ledger `context` — the page body NEVER shows it, and a migration therefore
// dropped it in total silence. Its answer carries one extra field beyond present/absent:
//   "deduplication": { "resolved": true, "present": true, "names": ["Contact duplicates. Contact name"],
//                      "serviceConfigured": false }
// `present` = this entity HAS an active rule marked use-on-save; `serviceConfigured` = the target stand can
// actually run the Freedom flow. Both are needed because they fail differently: no rule means nothing to lose,
// while a rule + no service means the check silently stops at migration (measured — see mapDedupOnSave).
const SIGNAL_KEYS = ["dcm", "processes", "printables", "deduplication"];
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
  // (2) The `existing-app` contract, stated as the three things `create-app-section` actually needs. Each failure
  // names the alternative modes, because "this app cannot host it" is not a dead end — it is the fork.
  if (mode === "existing-app") {
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
  }
  return issues;
}
// ONE opts object for every row-rendering entry point (`--checklist`, `--verify`, the plan/spec renderers) and
// for the sub-page folds. `--checklist` and `--verify` used to build their own, and the verify one was thinner
// (no targetPackage / planMetaMissing / signalsMissing / isMiniPage / isChildPage): they agreed only for as long
// as no row helper read the gap, and the first helper that did would silently render two different row sets.
// Pure in `manifest` + the run flags, so it can be built BEFORE the fold and shared with every sub-page.
export function checklistOpts(manifest, opts = {}) {
  const pm = manifest.planMeta || {};
  const blank = (v) => v == null || String(v).trim() === "";
  // A nested run's manifest is the CHILD bundle, which carries no `signals` of its own — the on-stand answers are
  // supplied ONCE on the root manifest (one stand check covers the whole surface), exactly like `behaviourIndex`
  // and `targetPackage`. So the RUN-level answers are inherited via `opts.inheritedSignals` and a sub-bundle's own
  // key still wins. Without this every fold saw `{}` and every signal-driven row silently vanished below the root.
  const signals = { ...plainObject(opts.inheritedSignals), ...plainObject(manifest.signals) };
  return {
    template: manifest.template,
    targetPackage: manifest.targetPackage,
    planMeta: manifest.planMeta,
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
// whole page. A child verified to have NO separate page, one behind an approved SECTION BOUNDARY (ENG-95861 — its
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
function foldOneChildPage(c, pageKey, childSchemas, foldCtx) {
  // Reuse of an existing Freedom form page: there is no rebuild, so do NOT fold the Classic child tree even if a
  // bundle happens to be supplied — folding it would re-introduce the recursion the disposition exists to close.
  if (typeof c.reuseFreedomPage === "string" && c.reuseFreedomPage) return publishUnfoldedChild(c, pageKey);
  // THE SECTION BOUNDARY, and the reason this ticket exists: the child's page is NOT FOLDED. No recursive
  // sub-migration, so no sub-run gate, so no `c.childBlocked` — and `migrate.mjs`'s `filter(c => c.childBlocked)`
  // cannot see a page this plan is not migrating. A 3.3 MB fold of another section's card used to be mandatory, and
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
  if (am.editableGrid) g.push("Confirm the Freedom list supports inline edit for those columns via `get-component-info`.");
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
    changeSet.needsDecision.push({ kind: "detail-add-mechanism", item: label,
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
// (ENG-95412 follow-up: `disposition()` ranks `decision` above `context`, so escalating a parse gap on one of
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
// `profile:<name>` and section layers all reach the plan. Previously this took `schemas` alone, so four of the five
// layer kinds stayed console-only — the exact failure the block above exists to fix. `schemaByTag` resolves a
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
    // that isn't theirs to resolve and carries no new information — the exact defect ENG-95412's reopening found.
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
// ENG-95850 (D) — `profile` BELONGS HERE. `get-classic-list-columns` returns `source: "profile"` for the saved grid
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
// Supplied on the manifest for the same reason a resolved list-column read is: it is evidence the layer parse does not
// produce yet (the section view `diff` is not folded), and the plan must be able to carry it the moment someone reads
// it off the section. Unioned with anything the layers do produce, so the automated source supersedes nothing.
function suppliedRowActions(section) {
  const list = Array.isArray(section?.rowActions) ? section.rowActions : [];
  return list.filter((ra) => ra && typeof ra === "object" && typeof ra.name === "string" && ra.name.trim());
}
function sectionInput(section, manifest) {
  if (Array.isArray(section)) return { schemas: section, resolvedListColumns: null, listColumnIssue: null, rowActions: [] };
  if (!section || typeof section !== "object") return { schemas: [], resolvedListColumns: null, listColumnIssue: null, rowActions: [] };
  if (!Object.hasOwn(section, "listColumns")) {
    throw new Error("object-shaped section requires listColumns evidence; use a bare array only for the legacy manifest shape");
  }
  const schemas = Array.isArray(section.schemas) ? section.schemas : [];
  const rowActions = suppliedRowActions(section);
  const resolved = normalizeResolvedListColumns(section.listColumns, manifest.entity, manifest.planMeta?.sectionSchema);
  if (resolved.error) return { schemas, resolvedListColumns: null, listColumnIssue: resolved.error, rowActions };
  return { schemas, resolvedListColumns: resolved, listColumnIssue: null, rowActions };
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
export function mergeSectionActions(fromLayers = []) {
  const byName = new Map();
  for (const a of fromLayers) {
    // The name keys the ChangeSet row, the checklist row and the evidence id, so a blank one is not a deliverable.
    const name = typeof a?.name === "string" ? a.name.trim() : "";
    if (!name) continue;
    const prev = byName.get(name);
    // Merge FIELD BY FIELD. A top layer need not repeat every field, and an item carries every key with `null`
    // when absent, so replacing the object (or a plain spread) blanks a value only the base layer declared.
    byName.set(name, prev
      ? { ...prev, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v != null)), name, order: prev.order }
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
// EXPORTED because the layer arm is unreachable until the section view `diff` is folded — without a seam here the
// precedence rule would ship with no way to test it.
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
function analyzeSectionChain(sectionSchemas, resolvedListColumns = null, listColumnReadRejected = false, suppliedRows = []) {
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
    sectionActions: mergeSectionActions(sectionSchemas.flatMap((l) => l.sectionActions || [])),
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
    rowActions: mergeRowActions(sectionSchemas.flatMap((l) => l.rowActions || []), suppliedRows),
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
    // USER-approved SECTION BOUNDARY (ENG-95861): this child entity owns another section, so its Classic edit page
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
  if (value && typeof value === "object") {
    // A `{ file: … }` / `{ body: … }` reference contributes its CONTENT, wherever in the manifest it sits — not
    // only inside a `schemas`/`seed` array. Before this, `section` entries and file-backed `detailSchemas` /
    // `profileSchemas` were walked generically, which hashed the PATH STRING: editing one of those files changed
    // the rendered plan and left `planVersion` identical, so an old approval authorised a plan the user never saw.
    // Reproduced on a two-file manifest before the fix — same version before and after rewriting the detail body.
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

// The SETTLE clause of a `registry-target` ⚠, branched BY CAUSE (ENG-95683). A missing component used to get one
// blanket "settle the target before building" whether it was a real component an install could recover or a name no
// action short of a re-plan can fix. The finding now carries the row's structured `{kind,id}` gate, so the guidance
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

// ENG-95683 (item 1) — the RESOLVED gate set this run emits: EVERY gated type the run puts on the page, resolved
// through the mapping table (`gateForComponentType`), NOT only the subset that also MISSED the resolved registry.
// A gate is a property of the TYPE (its required package/feature), independent of whether the registry the run
// happened to resolve against lists the type — so on the DEFAULT vendored path (where the canonical gated composites
// are present, hence produce no registry-target MISS) the `--resolved-gates` artifact and the plan.md mirror still
// carry them. Gathering only from the findings loop made both empty on that default path — the false negative
// ENG-95683 reviewers caught. `source` is the registry provenance (a REG_SOURCE_NOTE key), `kind`/`id`/`feature`
// the typed gate; `runTypes` already dedupes, so each gated type appears once. Extracted from reportRegistryFindings
// (Sonar S3776) so the gate collection and the parent's registry-finding loop are each independently readable.
function collectResolvedGates(changeSet, source) {
  const gates = [];
  for (const [ctype] of runTypes(changeSet)) {
    const gate = gateForComponentType(ctype);
    // ENG-95683 (review) — push ONLY a well-formed gate: a non-blank `kind` and a non-blank string `id`. This is the
    // producer-side guarantee both consumers rely on — the plan.md provenance line (`gateFragment` in designspec.mjs)
    // and the `--resolved-gates` JSON artifact — so neither has to guard the shape itself and neither can render a
    // literal `undefined`/blank backtick pair from an incomplete entry. `gateShapeIssues` already fails the CI table
    // check on a malformed row, so in practice every row-carried gate is complete; this makes that one home, not two.
    if (gate && gate.kind && typeof gate.id === "string" && gate.id.trim())
      gates.push({ componentType: ctype, kind: gate.kind, id: gate.id.trim(),
        ...(gate.feature ? { feature: gate.feature } : {}), source });
  }
  return gates;
}
// ENG-95683 (item 2) — the compositeOnly ADVISORY, computed by `validateRun` and (until this feature) discarded. A
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
function buildCompositeOnlyDecisions(changeSet, regRun, sourceNote) {
  const enginePositioned = new Set();
  for (const op of changeSet.viewConfigDiff || []) if (op?.values?.type) enginePositioned.add(op.values.type);
  for (const el of changeSet.tableElements || []) if (el?.componentType) enginePositioned.add(el.componentType);
  for (const a of regRun.advisories || []) {
    if (a.kind !== "composite-only" || enginePositioned.has(a.componentType)) continue;
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
// hand-built changeSet. ENG-95683 review: the decision to KEEP it was taken explicitly rather than left implicit.
// The reason it cannot be replaced by an end-to-end fixture is a property of the mapper, not a gap in the tests:
// `resolveProps` ALWAYS also writes `values.type` for a table element, so in any changeSet a real run can produce,
// the `viewConfigDiff` source of `enginePositioned` already covers every type the `tableElements` source would —
// a "realistic fixture that naturally emits a table element" therefore cannot isolate the `tableElements` branch,
// because the other branch would satisfy the assertion first. Deleting that line would leave the e2e test green.
// The branch's OUTCOME is covered end-to-end regardless (`run-mapper.mjs` asserts the `registry-composite-only`
// items `runMigration` does and does not push); this export exists solely so the tableElements SOURCE has a
// non-vacuous regression test of its own. Do not call it from production code.
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
    // ENG-95683 — carry the row's structured gate on the item (so a consumer branches by kind, not by string), and
    // let the SETTLE clause say the actionable fix for THIS cause instead of one blanket sentence for every miss.
    changeSet.needsDecision.push({ kind: "registry-target", item: f.componentType, gate: f.gate || null,
      reason: `this run emits \`${f.componentType}\` — ${f.why} — and ${verdict}${where}. ${REG_SOURCE_NOTE[reg.source]}. A page built on a type the stand cannot resolve does not render, so ${registrySettleGuidance(f)}` });
  }
  buildCompositeOnlyDecisions(changeSet, regRun, REG_SOURCE_NOTE[reg.source]);
  return collectResolvedGates(changeSet, reg.source);
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
  const sectionData = sectionInput(manifest.section, manifest);
  const sectionSchemas = parse(sectionData.schemas);
  // The section chain digested as its own step-5.1 scope (0 or 1) — see `sectionStubScopes` for the root-only
  // guard, the never-null schema label, and why it is a function rather than inline here.
  const sectionScopes = sectionStubScopes(manifest, opts, sectionSchemas);
  const eff = mergeHierarchy(schemas, { seedTemplate }); // isMiniPage is consumed downstream (mapToFreedom / renderDesignSpec), NOT by mergeHierarchy — don't pass an inert arg here
  // #11(ii)/B2 — parse each supplied detail-schema body to recover its child entity + list columns + add mode.
  const detailSchemas = parseDetailSchemas(manifest, bodyOf);
  // ENG-93928 — the embedded profile schemas a profile card renders (profiled entity + displayed columns).
  const profileSchemas = parseProfileSchemas(manifest, bodyOf);
  // RUN-level on-stand signals (see checklistOpts, which performs the same merge for the row renderers): the
  // answers live on the ROOT manifest, so a fold inherits them and a sub-bundle's own key still wins.
  const runSignals = { ...plainObject(opts.inheritedSignals), ...plainObject(manifest.signals) };
  const changeSet = mapToFreedom(eff, {
    entityColumns: manifest.entityColumns || {},
    resources: manifest.resources || {},     // #5/#13 — localizable strings for tab/group/detail captions
    columnTitles: manifest.columnTitles || {}, // #5/#13 — entity column titles for field LABELS
    detailSchemas,                            // #11(ii)/B2 — parsed detail bodies (entity + columns + title)
    profileSchemas,                           // ENG-93928 — parsed embedded-profile bodies (entity + displayed columns)
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
  const resolvedGates = reportRegistryFindings(changeSet, manifest, baseDir);

  // section analysis — union the signals across the section schema chain (last-wins for the mini page).
  const section = analyzeSectionChain(sectionSchemas, sectionData.resolvedListColumns, sectionData.listColumnIssue != null, sectionData.rowActions);
  // …and the LIST-PAGE ChangeSet built from those signals — the positioned machine artifact the build step consumes,
  // so the list page is a deliverable on the same footing as the form page. Signals alone render only as prose, which
  // no build step can consume. `null` when the run has no section (mini/child scope).
  // THE run's entity, resolved once: the manifest's own value when it named a real one, else the entity the merged
  // schema chain reports. Hoisted rather than repeated at each consumer, because the list page's data-source op and
  // the result's `entity` must name the SAME object — a ChangeSet that binds PDS to a different schema than the plan
  // states is a page built on the wrong table.
  const resolvedEntity = manifest.entity && manifest.entity !== "?" ? manifest.entity : eff.entity;
  const listChangeSet = buildListChangeSet({ entity: resolvedEntity, section, entityColumns: manifest.entityColumns });
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
  const stubIndex = [
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
  ];
  // Only the ROOT run can judge this. A folded scope sees one page's rows, so every answer belonging to a sibling
  // page would look unmatched there — reporting it per sub-run would turn a correct handoff into a wall of noise.
  behaviourIndex.unmatched = opts.scopeSchema ? [] : unmatchedIndexKeys(behaviourIndexInput, stubIndex);
  behaviourIndex.sectionOnly = opts.scopeSchema ? [] : sectionOnlyIndexKeys(behaviourIndexInput, stubIndex);
  behaviourIndex.wiringOnly = opts.scopeSchema ? [] : wiringOnlyKeys(behaviourIndexInput, stubIndex);
  const decisionSummary = {};
  for (const d of changeSet.needsDecision) decisionSummary[d.kind] = (decisionSummary[d.kind] || 0) + 1;
  // ⛔ HARD GATE (RV1) — the four correctness signals, computed ONCE here so the CLI, the renderer, and any
  // caller share one verdict instead of each re-deriving it (or, as before, never checking it at all). This
  // does NOT throw — runMigration stays pure so the golden runner can assert blocked/clean states; the CLI
  // turns `blocked` into a loud banner + non-zero exit, and the renderer prints the banner into the artifact.
  // The operator's recorded answers on FIDELITY warnings, folded in BEFORE the gate and the renderer read them, so
  // one annotated array is what every surface reports (ENG-95862 item 5).
  eff.warnings = applyWarningDispositions(eff.warnings, manifest);
  const gate = computeGate({ parseErrors, eff, manifest, parseDiagnostics, childPages, typedPages, miniPage });
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
      seedQuality: eff.seedQuality,           // whether the seed looks like a real fetched body vs a skeleton (#19)
      features: eff.features,                 // feature toggles gating runtime visibility (union, not one state)
      referencedModules: eff.referencedModules, // UI-rendering deps outside the page-schema migration unit
    },
    decisionSummary, // needsDecision counts by kind — the agent's 20% worklist, at a glance
    // ENG-95683 (item 1) — the resolved component gate set [{componentType,kind,id,feature?,source}] for THIS run,
    // the durable fact the `--resolved-gates <file>` output writes and `renderPlan` mirrors as a provenance line.
    // Empty (`[]`) when the run gates no type — the negative-control case the artifact must still write verbatim.
    resolvedGates,
    changeSet,       // full Freedom ChangeSet: viewConfigDiff / *ConfigDiff / rules / details / needsDecision / …
    section,         // section-schema analysis (list page): add-record mini page, section actions, columns, quick filters
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
const BUILT_SHAPE = '{ "pages": { "main": { "viewConfig": <get-page bundle.viewConfig>, "packageName": "…", "parentSchemaName": "…", "businessRules": <read-page-business-rules result: { count, rules } — the page\'s persisted BusinessRule_* schemas, NOT a page-body grep> }, "list": { "viewConfig": <the LIST page, same shape>, "schemaUId": "…" }, "child:<Entity>": false }, "reachability": { "sectionRegistered": { "workplaces": <n counted on the stand>, "names": [...] } — a COUNT, not a flag: a workplace registration only ADDS, so the row closes at exactly 1, "miniPageWired": true, … }, "evidence": { "<id>": {…} }, "judge": { "<id>": { "convincing": true } } }';
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
const VALUE_FLAGS = new Set(["--out", "--built", "--verify-json", "--verify-digest", "--page", "--resolutions", "--slices", "--resolved-gates"]);
// The value of a value-taking flag, or `null` when the flag is absent. `onBad` (the CLI's `fail`) is called with a
// diagnosable message when the flag is there but its value is missing or is itself a flag. Own fn so each new
// value flag reuses the guard instead of re-implementing it (and so the CLI block does not grow another branch).
// ONE page's design spec. `main` is the run's own; every folded sub-page keeps its rendered spec on its node
// (`c.spec` / `t.spec` / `miniPage.spec`) — the same string the plan nests. An unknown key FAILS: a caller that
// asked for one page must never be handed the whole tree as though it were that page's slice.
// ONE page's checklist. An EMPTY render for an explicitly requested key is an error, not an empty table: the key
// either names no page or names one that emits no gated row, and both are things the caller must know rather than
// hand to a build agent as "nothing to do here".
function pageScopedChecklist(result, manifest, pageKey, fail) {
  const md = renderChecklist(result, { ...checklistOpts(manifest), scopePageKey: pageKey });
  if (!md) fail(`--page '${pageKey}' produced no checklist rows — it matches no page in this plan, or that page emits no gated deliverable. Use a key --units publishes.`);
  return md;
}
function pageScopedSpec(result, pageKey, fail) {
  if (!pageKey || pageKey === "main") return result.designSpec;
  // The SAME recursive, deduped walk `--units` publishes from. A one-level scan here meant every grandchild was a
  // scheduled build unit whose slice the CLI reported as non-existent — and the build prompt tells that unit its
  // slice is ready and not to go looking in the plan, so it would have built with no spec at all.
  const nodes = subPageNodes(result);
  const hit = nodes.find((n) => n && (n.pageKey === pageKey || n.pageKeyAlt === pageKey));
  if (!hit) {
    const keys = nodes.map((n) => n?.pageKey).filter(Boolean);
    fail(`--page '${pageKey}' matches no page in this plan. Published keys: main${keys.length ? ", " + keys.join(", ") : ""}. Use a key --units publishes.`);
  }
  if (!hit.spec) {
    fail(`--page '${pageKey}' names a page this run did not fold — it is reused or unresolved, so it has no design spec of its own and there is no slice to render. See its row in the plan.`);
  }
  return hit.spec;
}
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

// The `--resolutions` file shape, in ONE place — the same reason `BUILT_SHAPE` is a constant.
const RESOLUTIONS_SHAPE = `{"resolutions":[{"kind":"…","item":"…","answer":"…"}]}` +
  " (or a bare array); each entry needs a non-blank `answer` plus either an `id` or both `kind` and `item`";
// THREE OUTCOMES, and they must stay distinguishable — "no answers yet" and "the file is broken" have opposite fixes:
// absent ⇒ a stderr note and `null` (the normal first run, NOT an error) · unparseable ⇒ exit 1 · unusable
// entries ⇒ exit 1, each named. Never let either failure degrade into the absent case.
// Own fn so the CLI block gains no nesting, like `valueFlagArg` and `outFileNote` above.
function readResolutions(file, fail) {
  if (!file) return null;
  if (!fs.existsSync(file)) {
    process.stderr.write(`migrate.mjs: --resolutions '${file}' does not exist — no ⚠ Confirm answers applied; every item publishes \`resolution: null\`.\n`);
    return null;
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { fail(`cannot read --resolutions '${file}': ${e.message}. Expected ${RESOLUTIONS_SHAPE}.`); }
  const idx = buildResolutionIndex(raw);
  if (idx.bad.length) fail(`--resolutions '${file}' has ${idx.bad.length} unusable entr${idx.bad.length === 1 ? "y" : "ies"}: ${idx.bad.join(" | ")}. Expected ${RESOLUTIONS_SHAPE} — nothing was applied.`);
  // A duplicate is NOT fatal — the later entry wins, which is the likelier intent after an edit — but it is said
  // out loud, because discarding an operator's answer in silence is the failure this channel exists to remove.
  if (idx.duplicates.length) {
    const named = idx.duplicates.slice(0, 5).join(" | ");
    const more = idx.duplicates.length > 5 ? ` | …and ${idx.duplicates.length - 5} more` : "";
    process.stderr.write(`migrate.mjs: ⚠ --resolutions '${file}' answers the same question more than once: ${named}${more}. The LAST entry for each wins; delete the others so the file says one thing.\n`);
  }
  return idx;
}
// ONE question answered twice through the two key forms. Named, not silent: the pair wins and the id-keyed answer is
// discarded, and there is no precedence worth guessing between two answers the operator wrote deliberately.
function conflictingResolutionsNote(conflicts) {
  const named = conflicts.map((c) => `${c.kind}:${c.item}`).slice(0, 5).join(" | ");
  const more = conflicts.length > 5 ? ` | …and ${conflicts.length - 5} more` : "";
  return `migrate.mjs: ⚠ ${conflicts.length} ⚠ Confirm question(s) are answered TWICE in --resolutions — once by \`id\` and once by \`kind\`+\`item\`: ${named}${more}. The \`kind\`+\`item\` entry is the one applied; the \`id\` one is DISCARDED. Delete whichever is stale so the file answers each question once.\n`;
}
// An answer matching no published question is REPORTED, never dropped: the operator believes it is answered.
function unmatchedResolutionsNote(unmatched) {
  const named = unmatched.map((u) => u.id || `${u.kind}:${u.item}`).slice(0, 5).join(" | ");
  const more = unmatched.length > 5 ? ` | …and ${unmatched.length - 5} more` : "";
  return `migrate.mjs: ⚠ ${unmatched.length} --resolutions entr${unmatched.length === 1 ? "y" : "ies"} matched NO ⚠ Confirm question this plan asks: ${named}${more}. Check kind/item against \`preflight[]\` in this output — an answer nobody asked for reaches no builder.\n`;
}

// An unknown `--page` key FAILS: a caller that asked for one page must never be handed the whole artifact as
// though it were that page's slice. One message for both slicers below.
function requirePublishedKey(units, pageKey, fail) {
  if (!(units.pages || []).some((p) => p.key === pageKey)) {
    fail(`--page '${pageKey}' matches no page in this plan. Published keys: ${(units.pages || []).map((p) => p.key).join(", ") || "(none)"}. Use a key --units publishes.`);
  }
}
// `--units --page <key>` — the queue slice for ONE key, or exit 1.
function pageUnitsSliceOrFail(units, pageKey, fail) {
  requirePublishedKey(units, pageKey, fail);
  return pageUnitsSlice(units, pageKey);
}
// `--slices <dir>` — one file per published page key, so a build agent reads its OWN row and never the whole file.
// A by-product of the `--units` / `--verify` run the caller already makes, and the payload comes from the same pure
// slicer `--page` uses, so the two forms cannot disagree.
// NAMED BY POSITION in `pages[]`, 1-based (`queue-1.json`), never by the page key: a key sanitised into a filename
// is many-to-one — every non-Latin caption collapses to the same characters — and two keys landing on one file
// hands a build agent another page's rows. A position cannot collide, and each slice carries its own `pageKey`, so
// a consumer that composed the wrong number can tell.
function writePageSlices(dir, prefix, units, sliceOf, fail) {
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { fail(`cannot create the --slices directory '${dir}': ${e.message}`); }
  // STALE SLICES ARE DELETED, never left behind. Numbers are reused, so a file from a longer plan sits there
  // claiming to be a page this plan no longer publishes.
  const keep = new Set((units.pages || []).map((_, i) => `${prefix}-${i + 1}.json`));
  const isSlice = (f) => f.startsWith(`${prefix}-`) && f.endsWith(".json") && /^\d+$/.test(f.slice(prefix.length + 1, -5));
  let present;
  try { present = fs.readdirSync(dir); }
  catch (e) { fail(`cannot read the --slices directory '${dir}': ${e.message}`); }
  for (const f of present) {
    if (isSlice(f) && !keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
  const written = [];
  (units.pages || []).forEach((pg, i) => {
    const file = path.join(dir, `${prefix}-${i + 1}.json`);
    try { fs.writeFileSync(file, JSON.stringify(sliceOf(pg.key), null, 2) + "\n"); }
    catch (e) { fail(`cannot write the ${prefix} slice '${file}': ${e.message}`); }
    written.push(file);
  });
  process.stderr.write(`migrate.mjs: wrote ${written.length} per-page ${prefix} slice(s) to ${dir} — hand each build agent its own file; nothing else needs to cut a row out of the whole one.\n`);
  return written;
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
  // `--verify-digest <file>` — the SAME verdict, minus the open rows of pages that are already complete. For a
  // caller whose only route from a file into its own arithmetic is an agent transcribing it (a workflow script has
  // no filesystem), the full 102 KB report was most of that agent's cost and none of its value.
  const verifyDigestFile = valueFlagArg(argv, "--verify-digest", "--verify-digest verify-digest.json", fail);
  if (verifyDigestFile && !verifyMode)
    fail("`--verify-digest <file>` only applies to `--verify` — it writes THAT run's scheduling digest. Add `--verify --built <file>`, or drop `--verify-digest`.");
  // `--resolutions <file>` — the operator's ANSWERS to this plan's ⚠ Confirm questions, matched onto the queue items
  // that asked them (`--units.preflight[].resolution`). An INPUT to the build: it closes no `--verify` row, which
  // still needs a filed evidence record and a judge verdict.
  // `--units` only, like `--verify-digest` is `--verify` only: in any other mode there is nothing to attach an answer
  // to, and accepting the flag silently would leave a caller believing answers had been applied.
  const resolutionsFile = valueFlagArg(argv, "--resolutions", "--resolutions resolutions.json", fail);
  if (resolutionsFile && !unitsMode)
    fail("`--resolutions <file>` only applies to `--units` — it attaches the operator's answers to that run's ⚠ Confirm queue items. Add `--units`, or drop `--resolutions`.");
  // `--page <key>` — render ONE page's slice of `--checklist` / `--spec`. The key is a PUBLISHED `--units` key; a
  // key that matches no page is an error, never a silent fall-back to the whole tree, because a caller that asked
  // for one page and got all of them hands a build agent another page's rows.
  const pageArg = valueFlagArg(argv, "--page", "--page main", fail);
  if (pageArg && !(specMode || checklistMode || unitsMode || verifyMode))
    fail("`--page <key>` applies to `--spec`, `--checklist`, `--units` and `--verify` — it renders that page's slice. Add one of them, or drop `--page`.");
  // `--slices <dir>` — the PER-PAGE slice FILES, one per published key. `--units` and `--verify` only: those are the
  // two runs that hold a whole build-state artifact, and accepting the flag elsewhere would leave a caller believing
  // slices had been written.
  const slicesDir = valueFlagArg(argv, "--slices", "--slices slices/", fail);
  if (slicesDir && !(unitsMode || verifyMode))
    fail("`--slices <dir>` applies to `--units` and `--verify` — it writes one per-page slice file per published key. Add one of them, or drop `--slices`.");
  if (verifyJsonFile && !verifyMode)
    fail("`--verify-json <file>` only applies to `--verify` — it writes THAT run's machine-readable verdict. Add `--verify --built <file>`, or drop `--verify-json`.");
  // `--resolved-gates <file>` (ENG-95683 item 1) — WRITE the resolved component gate set this run gathered
  // ([{componentType,kind,id,feature?,source}]) as a durable machine-readable artifact, so a verification step can
  // read the run's gates directly instead of re-deriving them from a temp manifest that was already deleted. It is a
  // PLAN/RUN-time fact (known in `runMigration`), NOT a `--verify` verdict, so it rides the `--plan`/`--units` path
  // and is rejected elsewhere; the empty set writes verbatim as `[]` (the negative-control run that gates nothing).
  const resolvedGatesFile = valueFlagArg(argv, "--resolved-gates", "--resolved-gates resolved-gates.json", fail);
  if (resolvedGatesFile && !(planMode || unitsMode))
    fail("`--resolved-gates <file>` applies to `--plan` and `--units` — it writes THAT run's resolved component gate set. Add one of them, or drop `--resolved-gates`.");
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
  // `--resolved-gates <file>` (ENG-95683 item 1) — the durable machine-readable copy of THIS run's resolved gate set,
  // written before the mode output below (its own artifact, not part of stdout). Always the full set the run gathered,
  // `[]` included, so a reader can tell "no gated types" from "the flag was never passed".
  if (resolvedGatesFile) {
    try { fs.writeFileSync(resolvedGatesFile, JSON.stringify(result.resolvedGates || [], null, 2) + "\n"); }
    catch (e) { fail(`cannot write --resolved-gates '${resolvedGatesFile}': ${e.message}`); }
    process.stderr.write(`migrate.mjs: wrote ${(result.resolvedGates || []).length} resolved component gate(s) to ${resolvedGatesFile} — the run's machine-readable gate set [{componentType,kind,id,feature?,source}]; verify against THIS file, not a temp manifest.\n`);
  }
  // `--plan` ⇒ the whole plan skeleton; `--spec` ⇒ the design spec alone; default ⇒ full JSON.
  let output, verifyIncomplete = false, verifyRes = null;
  if (planMode) output = result.plan + "\n";
  else if (specMode) output = pageScopedSpec(result, pageArg, fail) + "\n";
  else if (checklistMode) output = pageArg
    // Re-rendered rather than cut out of `result.checklist`: that string is already assembled, and slicing a
    // rendered table by eye is the "paraphrase between the engine and its caller" this gate exists to avoid.
    // `renderChecklist` filters on the RAW `pageKey` its groups carry, so the slice is exact.
    ? pageScopedChecklist(result, manifest, pageArg, fail) + "\n"
    : result.checklist + "\n";
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
  // `--units` ⇒ the BUILD QUEUE (JSON): one entry per page key with what that page expects, the reachability keys
  // with their applicability already decided, the evidence ids, and a leaf-first build order. It is the executor's
  // input AND the only place the keys of `--built.pages` / `.evidence` / `.judge` come from — an invented key is
  // silently "not checked", so nothing here may be guessed. Takes NO value (a MODE flag, like `--plan`), and is
  // therefore deliberately absent from the positional-argument exclusion above: adding it there would make
  // `--units <manifest>` lose its manifest and die with a misleading JSON error.
  else if (unitsMode) {
    const units = pageUnits(result, { ...checklistOpts(manifest), resolutions: readResolutions(resolutionsFile, fail) });
    // The requested slice is resolved FIRST: `--page` on an unknown key must exit 1 with nothing written, not
    // leave a directory of files and a success note behind a failure line.
    const requested = pageArg ? pageUnitsSliceOrFail(units, pageArg, fail) : units;
    if (slicesDir) writePageSlices(slicesDir, "queue", units, (k) => pageUnitsSlice(units, k), fail);
    output = JSON.stringify(requested, null, 2) + "\n";
    if (units.resolutionsUnmatched?.length) process.stderr.write(unmatchedResolutionsNote(units.resolutionsUnmatched));
    if (units.resolutionsConflicts?.length) process.stderr.write(conflictingResolutionsNote(units.resolutionsConflicts));
  }
  else if (verifyMode) {
    let built; try { built = JSON.parse(fs.readFileSync(builtFile, "utf8")); }
    catch (e) { fail(`cannot read --built '${builtFile}': ${e.message}`); }
    // `--verify --built <file> --page <key>` — ONE page's row of the built file, printed. A READ, not the gate:
    // no table and no verdict files, so a caller that needs one row never has to open the whole payload.
    // VALIDATE BEFORE RENDERING: `renderVerify` is called outside the try above, so a throw inside it surfaces as a
    // raw Node stack instead of a diagnosable message — and a malformed payload must be a loud exit 1, never a
    // table full of ⚠ rows that reads like a half-built page.
    const issue = builtPayloadIssue(built);
    if (issue) fail(`--built '${builtFile}' ${issue}. Expected ` + BUILT_SHAPE + ". Run `--units` on this manifest for the exact page keys.");
    const builtUnits = pageUnits(result, checklistOpts(manifest));
    // VALIDATE `--page` FIRST, before any file is written — the same order `--units` follows. Writing the slice
    // directory and only then exiting 1 leaves a caller a populated directory to reconcile against a failure.
    if (pageArg) requirePublishedKey(builtUnits, pageArg, fail);
    // The PER-PAGE slices, written BEFORE the verdict files below so a bad `--slices` exits 1 with nothing
    // written at all. They are written on exit 2 as well: a run with open rows is when a builder needs its row.
    if (slicesDir) writePageSlices(slicesDir, "built", builtUnits, (k) => builtSlice(builtUnits, built, k), fail);
    if (pageArg && verifyJsonFile) {
      // THE IN-CONTEXT SINGLE-UNIT GATE (ENG-95469, A3). `--verify --page <key> --verify-json <file>` is no longer a
      // pure read: it runs the SAME detector the full sweep does, SCOPED to one page, so a build agent can gate its
      // own unit in its own context BEFORE reporting complete. `verifyUnit` supplies the machine verdict (the page's
      // slice of the reconciliation — `{ complete, buildComplete, missing, unverified, openRows, planGaps }`), and
      // the human table is the SCOPED `renderVerify` (this page's rows only). ENG-95901 — the exit gates on THIS
      // page's `buildComplete` (the OWNER axis — false while any open row is the builder's), NOT `complete`: a
      // builder can never legitimately clear an evidence/judge/reachability row itself (a separate read-only
      // verifier/judge files those), so gating the builder's OWN bounded self-check on the combined flag asked it to
      // repair evidence it is contractually forbidden to touch. A page whose only open rows are unfiled evidence now
      // exits 0 here — but a page short of its own deliverables still exits 2 whether the engine labelled the
      // shortfall `missing` or `unverified`; the post-hoc full-sweep `--verify` below still
      // reads the combined `complete` (AC7/AC8) — an unconfirmed row still blocks the human-facing "done" verdict.
      // Without `--verify-json` the `--page` path stays the pure built-slice read (below).
      const unitVerdict = verifyUnit(result, checklistOpts(manifest), built, pageArg);
      // `--page` is already guarded by `requirePublishedKey` above, so this normally cannot fire — but a `verifyUnit`
      // that returns an explicit `error` (an unknown/mismatched page key, PR review T4) must fail LOUDLY and
      // distinctly here rather than be written to the verdict file as a false green, in case the two key notions ever
      // diverge. A broken gate is an exit-1 diagnosis, never a complete verdict.
      if (unitVerdict.error) fail(`--verify --page '${pageArg}': ${unitVerdict.error} — this key is not a page this plan reconciles. Run \`--units\` on this manifest for the exact page keys.`);
      try { fs.writeFileSync(verifyJsonFile, JSON.stringify(unitVerdict, null, 2) + "\n"); }
      catch (e) { fail(`cannot write --verify-json '${verifyJsonFile}': ${e.message}`); }
      verifyRes = renderVerify(result, { ...checklistOpts(manifest), scopePageKey: pageArg }, built);
      output = verifyRes.markdown + "\n";
      verifyIncomplete = !unitVerdict.buildComplete;
    }
    else if (pageArg) {
      output = JSON.stringify(builtSlice(builtUnits, built, pageArg), null, 2) + "\n";
    }
    else {
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
    }
    if (verifyDigestFile) {
      try { fs.writeFileSync(verifyDigestFile, JSON.stringify(verifyDigest(result, verifyRes), null, 2) + "\n"); }
      catch (e) { fail(`cannot write --verify-digest '${verifyDigestFile}': ${e.message}`); }
      // stderr, not stdout: stdout is the artifact itself when there is no `--out`, and a note there would end up
      // inside the table the agent presents verbatim.
      process.stderr.write(`migrate.mjs: wrote the machine-readable verdict to ${verifyJsonFile} — schedule from THAT file (complete / missing / unverified / planGaps / pages[key].openRows), not from the table.\n`);
    }
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
    // ENG-95901 — the SCOPED (`--page`) in-context gate exits 2 on `buildComplete: false` alone (at least one open
    // row the BUILDER owns), never on unfiled evidence, so this WHOLE diagnostic — headline counts, per-page
    // breakdown, and the repair advice — must talk about the builder's own rows for that caller. Surfacing the
    // verifier-owned figure here too (even just as a number, with no textual qualifier) reads as part of what this
    // exit code is asking to be repaired, and an LLM builder given a count next to "This is repairable" has no
    // signal that the count is not its responsibility. PR review — the number reported is `builderOpen`, not
    // `missing`: a partially-built page resolves `unverified`, so `missing` would have printed "0 MISSING
    // deliverable(s)" next to a non-zero exit. The UNSCOPED sweep still gates on the combined `complete` (AC7/AC8,
    // unchanged), where the verifier-owned figure genuinely is part of what blocks "done", so only the scoped path
    // narrows.
    const pageGaps = pageArg
      ? Object.entries(verifyRes.pages).filter(([, p]) => p.buildComplete !== true).map(([k, p]) => `${k}: ${p.builderOpen} open`)
      : Object.entries(verifyRes.pages).filter(([, p]) => !p.complete).map(([k, p]) => `${k}: ${p.missing} missing / ${p.unverified} unconfirmed`);
    // The six-page truncation is a READABILITY limit on this human line only. The full, uncapped per-page verdict
    // — every open page, with its open rows — is what `--verify-json` writes; nothing machine-readable is capped.
    let overflow = "";
    if (pageGaps.length > 6) {
      const where = verifyJsonFile ? `all of them in ${verifyJsonFile}` : "re-run with `--verify-json <file>` for the full, uncapped per-page verdict";
      overflow = ` | …and ${pageGaps.length - 6} more (${where})`;
    }
    const repairAdvice = pageArg ? "build / complete the pieces named in the rows, then re-verify" : "build the missing pieces / file the on-stand evidence, then re-verify";
    const headline = pageArg
      ? `${verifyRes.builderOpen} open deliverable(s) YOU OWN across ${pageGaps.length} page(s)`
      : `${verifyRes.missing} MISSING + ${verifyRes.unverified} unconfirmed deliverable(s) across ${pageGaps.length} page(s)`;
    process.stderr.write(`migrate.mjs: ⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete: ${headline}. ${pageGaps.slice(0, 6).join(" | ")}${overflow}. This is repairable: ${repairAdvice}.\n`);
    const gaps = planGaps(result);
    if (gaps.length) process.stderr.write(`migrate.mjs: ℹ this run ALSO has PLAN-level gaps (${gaps.join(" · ")}) — those are NOT buildable-out-of; return them to the caller instead of re-verifying against them.\n`);
  }
  if (planMode && result.planMetaMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — required planMeta unfilled: " + result.planMetaMissing.join(", ") + ". Add to manifest.planMeta and re-run.\n");
  if (planMode && result.signalsMissing?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — on-stand signals not resolved: " + result.signalsMissing.join(", ") + ". Run the on-stand check for each key listed above and add its answer to manifest.signals; the ⛔ banner in the --plan output states the exact query and the required fields per key (some carry more than resolved/present). Then re-run.\n");
  if (planMode && result.placementBlockers?.length) process.stderr.write("migrate.mjs: ⛔ PLAN INCOMPLETE — placement not settled: " + result.placementBlockers.join(" | ") + "\n");
  if (result.parseDiagnostics?.length)
    process.stderr.write(`migrate.mjs: ℹ ${result.parseDiagnostics.length} parse diagnostic(s) — constructs not statically resolved (advisory, see result.parseDiagnostics)\n`);
  // FIDELITY warnings are advisory (ENG-95862) — printed on the same channel and in the same voice as the parse
  // diagnostics above, so demoting them out of the ⛔ banner does not make them invisible.
  const fidelity = (result.effective?.warnings || []).filter((w) => w.severity === "fidelity" && !w.accepted);
  if (fidelity.length)
    process.stderr.write(`migrate.mjs: ℹ ${fidelity.length} fidelity warning(s) — the mapping is correct, an effect is not represented (advisory, see result.effective.warnings): ${fidelity.slice(0, 4).map((w) => `${w.op} '${w.name}' @${w.schema}`).join(" | ")}\n`);
  if (notReady) process.exit(2);
}
