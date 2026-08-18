// Mapper. Pure Node module: EffectiveClassicPage (from engine.mjs)
// -> Freedom ChangeSet (viewConfigDiff / viewModelConfigDiff / modelConfigDiff + rule specs)
// + needsDecision[] for the judgment 20%.
import { VIEW_ITEM_TYPE, CONTENT_TYPE, resourceKey } from "./engine.mjs";

// Lesson #6 — structural preservation: the target container derives from the SOURCE container role.
// Classic left-profile / module area → Freedom SideAreaProfileContainer. `LeftModulesContainer` is the
// BaseModulePageV2 LEFT area that holds the profile islands (e.g. ContactContainer): a field nested
// under it (field → ContactContainer → LeftModulesContainer) must resolve to the profile, NOT collapse
// into a fallback tab. Adding it here is what routes those island fields to the side profile once the
// base template is seeded (#18). Header stays separate (a WIDE header block → HeaderContainer, below).
const PROFILE_CONTAINERS = new Set(["ProfileContainer", "Header", "LeftModulesContainer"]); // classic → SideAreaProfileContainer
const FLAT_FALLBACK = "GeneralInfoTabContainer"; // where a field lands when its parent chain is unresolvable

// RV14 — the profile/left area is a STRUCTURAL role, not a fixed name. The known-name set above kept missing
// per-template variants (LeftModulesContainer was added after #18; CasePageV2's base uses `LeftContainer`).
// Derive it instead: a top-level base-template container (no parent, templateOwned) that is NOT a tab and NOT
// the tabs panel IS the side-profile anchor, whatever its name. A tabbed field returns at its tab before ever
// climbing this high, so reaching a top-level non-tabs container means the field belongs to the side profile.
// Union with the literal set so seed-less/fallback runs keep the old behaviour.
function deriveProfileAnchors(items) {
  const list = items || [];
  const anchors = new Set(PROFILE_CONTAINERS);
  const tabPanels = new Set(list.filter(i => i.isTab).map(i => i.parent).filter(Boolean)); // holders of tab children
  for (const i of list)
    if (!i.parent && i.templateOwned && !i.isTab && !i.bindTo && !tabPanels.has(i.name)) anchors.add(i.name);
  return anchors;
}

// F3 — resolve which Freedom region a field belongs to by CLIMBING the classic item tree from the
// field's parent: hitting Header/ProfileContainer => the side profile; hitting a tab => that tab;
// running off the tree (parent never defined) => unresolved (caller flags + falls back). This is
// what turns the old "everything flattens to one tab" into faithful tab placement.
// `tabTemplateOwned` = the owning tab's DEFINING insert came from a seed schema (so the Freedom template
// already provides it — don't re-synthesize even if a client schema re-captioned it). `groups` = the
// intermediate non-tab containers between the field and its tab (outermost→innermost), which the mapper
// rebuilds as ExpansionPanel (CONTROL_GROUP, itemType 15) / GridContainer, preserving classic grouping
// (e.g. a "Delivery" group) instead of flattening every field into one grid.
function resolveOwner(startParent, index, profileAnchors = PROFILE_CONTAINERS) {
  let parent = startParent, hops = 0; const groups = [];
  while (parent && hops++ < 32) {
    if (profileAnchors.has(parent)) return { kind: "profile", via: parent, groups: [...groups].reverse() };
    const p = index.get(parent);
    // `why` distinguishes the two unresolved causes so the caller's flag is accurate (#18): the ancestor
    // name is not defined by ANY schema/template (missing seed) vs the chain is fully defined but never
    // reaches a profile/tab anchor (climbed to the page root — a wrong/incomplete seed).
    if (!p) return { kind: "unresolved", parent, why: "undefined-parent" };
    if (p.isTab) return { kind: "tab", tab: p.name, tabTemplateOwned: !!p.templateOwned, groups: [...groups].reverse() };
    groups.push(p); // intermediate container between the field and its tab/profile
    parent = p.parent;
  }
  return { kind: "unresolved", parent: startParent, why: "no-anchor" };
}
const tabGridName = (tab) => `${tab}Grid`;

// Some column types arrive from get-entity-schema-properties as the numeric Terrasoft DataValueType CODE
// rather than a name — inconsistently: on real stands Date comes as "8", Money as "6", and the Decimal-precision
// variants as codes too (all VERIFIED on-stand on the ASPContractData configurator: 202 Money columns as "6";
// code "31" = "Decimal (0.1)", i.e. a Float variant → NumberInput). Normalize the codes we have ground truth for
// to their names so the name-based mapping below catches them. ONLY confirmed codes are listed — the numeric
// range is NOT cleanly partitioned (31 is a decimal, yet 30/32 were believed to be text), so an UNCONFIRMED code
// is left unmapped and flagged loudly (a folded field-control decision) rather than guessed into a wrong control.
// If another Decimal-precision code (0.01/0.001/…) surfaces on a future page, confirm it on-stand and add it here.
const DATAVALUETYPE_CODE = { "1": "text", "4": "integer", "5": "float", "6": "money", "7": "datetime", "8": "date", "12": "boolean", "16": "imagelookup", "31": "float", "42": "phone", "44": "weblink" };
// An IMAGELOOKUP column (dataValueType 16, "Image link" → references SysImage) is the ONLY column crt.ImageInput
// can bind — NOT a binary Image, NOT a Text URL. Recognize it by normalized code or by name so an image field /
// generator-image can be bound concretely (and a non-IMAGELOOKUP source flagged, never silently mis-bound).
const isImageLookupType = (t) => { const s = String(t ?? "").toLowerCase(); return s === "imagelookup" || s === "image link" || s === "imagelink" || s === "16" || DATAVALUETYPE_CODE[s] === "imagelookup"; };
// entity column dataType -> Freedom control (the DATA type decides the control).
function scalarControl(t) {
  // Keyed to what get-entity-schema-properties ACTUALLY returns (verified on-stand): most types arrive by NAME
  // (Boolean/DateTime/Integer/Float/Money/ShortText/MediumText/LongText/MaxSizeText/RichText); some core scalars
  // arrive as a numeric DataValueType code (Date "8", Money "6", Decimal "31", Phone "42", Web link "44", …) —
  // normalized above. Genuinely unknown/unconfirmed codes (18=Color, …) stay null → the caller flags a loud
  // field-control decision.
  t = DATAVALUETYPE_CODE[t] || t;
  if (t === "imagelookup") return { type: "crt.ImageInput", image: true }; // binds via `value`, not `control`
  if (t === "boolean") return { type: "crt.Checkbox" };
  if (t === "datetime") return { type: "crt.DateTimePicker", picker: "datetime" };
  if (t === "date") return { type: "crt.DateTimePicker", picker: "date" };
  if (["integer", "decimal", "float", "money"].includes(t)) return { type: "crt.NumberInput" };
  if (["longtext", "maxsizetext", "richtext"].includes(t)) return { type: "crt.Input", multiline: true };
  if (["text", "shorttext", "mediumtext"].includes(t)) return { type: "crt.Input" };
  // Phone / Email / Web link are TEXT-storage columns carrying a FORMAT on the column (verified on-stand: Contact.
  // Phone/MobilePhone = 42, Account.Web = 44, Contact.Email = "Email"). The Freedom field is a plain crt.Input bound
  // to the column — the phone/email/web-link rendering is inherited from the column's format, there is NO field-level
  // format prop (verified on Applicant_FormPage: MobilePhone & Email are both plain crt.Input). Recognizing them keeps
  // the control right AND drops the spurious "type not recognized" field-control ⚠.
  if (["phone", "email", "weblink"].includes(t)) return { type: "crt.Input" };
  return null; // unknown scalar -> caller flags needsDecision (loud)
}
// control = the DATA type first; the classic `contentType` is only a PAGE control HINT, not the data type.
// It forces a lookup ONLY when the column really is one (has a `ref`) or when we have no entity type at all
// (fallback). A contentType-5 hint on a KNOWN scalar column with NO ref is NOT a lookup — the classic page just
// rendered a scalar via a picker, which is a read-only VALUE FROM A LINKED RECORD (linkedDisplay): keep the real
// data type (Email/Phone/Text) and flag the linked-value intent instead of mislabelling the control as a lookup.
function control(dataType, contentType, ref) {
  // `dataType` is tool/agent-assembled JSON — it can arrive as a NUMBER (this code expects Date as the
  // numeric code 8; see scalarControl). `(dataType || "").toLowerCase()` throws a TypeError on a number,
  // which escapes mapToFreedom → runMigration (called with no try/catch in migrate.mjs) and breaks the
  // documented "runMigration does NOT throw" contract. Coerce with String() first — mirrors fieldTypeLabel.
  const t = String(dataType ?? "").toLowerCase();
  if (t === "lookup") return { type: "crt.ComboBox", lookup: true };
  const scalar = scalarControl(t);
  if (contentType === CONTENT_TYPE.LOOKUP) {
    if (ref || !scalar) return { type: "crt.ComboBox", lookup: true }; // real lookup, or no entity type -> trust the hint
    return { ...scalar, linkedDisplay: true }; // scalar shown via a picker -> read-only value from a linked record
  }
  return scalar; // null -> caller emits a field-control decision
}

// Short, human data-type label for the design-spec Type column. Lookups are flagged by `ctl.lookup` (the
// caller adds the referenced object separately); Phone / Email / Web link come from the column FORMAT
// (DataValueType 42 / "Email" / 44 — Creatio stores them as text with a format), with a column-name fallback for
// when the type is missing; text carries its length when the column metadata provides it.
function fieldTypeLabel(col, meta, ctl) {
  if (ctl.lookup) return "Lookup";
  let t = String(meta.type || "").toLowerCase();
  t = DATAVALUETYPE_CODE[t] || t;   // same numeric-code normalization as scalarControl (Money "6", Phone "42", …)
  if (t === "phone") return "Phone";
  if (t === "email") return "Email";
  if (t === "weblink") return "Web link";
  if (/email/i.test(col)) return "Email";
  if (/phone|mobile/i.test(col)) return "Phone";
  if (ctl.type === "crt.Checkbox" || t === "boolean") return "Boolean";
  if (ctl.picker === "datetime" || t === "datetime") return "Date/time";
  if (ctl.picker === "date" || t === "date") return "Date";
  if (t === "integer") return "Integer";
  if (["decimal", "float", "money"].includes(t)) return "Decimal";
  if (ctl.multiline) return t === "richtext" ? "Rich text" : "Long text";
  return meta.length ? `Text (${meta.length})` : "Text";
}

// Nearest existing entity columns to a (missing) bound column — ranked by longest shared substring (≥5 chars).
// Lets the "binds to a column not on the entity" decision name likely real columns (ASPAVFirepit → ASPFirepit /
// ASPPVFirepit) so the agent spots a rename/typo instead of getting a blind "unknown column".
function nearestColumns(col, cols, limit = 3) {
  const a = String(col).toLowerCase();
  const lcs = (x, y) => {
    let best = 0; const dp = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) { let prev = 0; for (let j = 1; j <= y.length; j++) { const t = dp[j]; dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : 0; if (dp[j] > best) { best = dp[j]; } prev = t; } }
    return best;
  };
  return Object.keys(cols)
    .map((k) => [k, lcs(a, k.toLowerCase())])
    .filter(([, n]) => n >= 5)
    .sort((p, q) => q[1] - p[1])
    .slice(0, limit)
    .map(([k]) => k);
}
// BINDPARAMETER property -> [action, inverseAction] (rules are one-way -> always emit the inverse)
const PROP_ACTION = {
  Required: ["make-required", "make-optional"],
  Readonly: ["make-read-only", "make-editable"],
  Enabled: ["make-editable", "make-read-only"],
  Visible: ["show-element", "hide-element"],
};

// Standard-feature knowledge: STANDARD Creatio features are REPLACED by their Freedom analog (A3), not rebuilt as
// a generic detail/widget. Matched by classic detail/module/container name. The Freedom analog is named
// descriptively (the exact crt.* component is confirmed on-stand — never fabricated here; E1 lesson).
// `templateProvided` = most Freedom FORM templates already ship this component → account for it / merge
// onto the existing one, do NOT create a new one (#7).
// `uiShape` distinguishes how the feature RENDERS (for the design-spec Layout table): `list` = it looks
// like a regular related list (Activities/Emails — same UI as any child list); `component` = a distinct
// native Freedom component with its own UI (Approvals, Attachments). This drives whether the spec marks it
// "Related list" vs the component name — the two are NOT visually interchangeable.
export const FEATURE_CATALOG = {
  // A Creatio "Visa" IS an approval/sign-off. Its records live in a `*Visa` entity (e.g. ApplicantVisa,
  // inheriting BaseVisa) with an FK to the master record — that data shape IS how Approvals is stored, so
  // "it's just a related list over ApplicantVisa filtered by the master" is NOT evidence against Approvals.
  // Do not downgrade VisaDetailV2 to a generic Expanded-list on that reasoning (a real agent did, wrongly).
  VisaDetailV2: { feature: "Approvals", freedom: "Freedom Approvals = TWO components (approval module + approval list)", uiShape: "component",
    note: "Creatio Visa = an approval/sign-off; its records living in a `*Visa` entity (ApplicantVisa) with an FK to the master is exactly how Approvals is stored — that structure is NOT a reason to reclassify it as a plain related list. Approvals renders as TWO components — read get-component-info for the approval set and add BOTH: (1) the approval MODULE/widget as a SEPARATE container placed ABOVE the profile island, and (2) the approval LIST. Adding only the list is INCOMPLETE. Keep it as the Approvals feature unless you confirm on-stand it does not use the visa/approval infrastructure." },
  FileDetailV2: { feature: "Attachments", freedom: "Freedom Attachments & notes", templateProvided: true, uiShape: "component" },
  // Activities and Emails are FILTERED RELATED LISTS (uiShape "list") — a DataGrid of the child records
  // filtered to the master record, the SAME UI as any other child list. They are NOT the Freedom Timeline
  // (an aggregate chronological feed; a separate classic component mapped via WIDGET_BY_MODULE.Timeline) and
  // Emails is NOT the email-client component. A real agent rebuilt these as a Timeline — do not conflate the
  // list feature with the Timeline widget (#6).
  ActivityDetailV2: { feature: "Activities", freedom: "Freedom related list of Activity (Task) records, filtered to the master", uiShape: "list",
    note: "Activities = a plain FILTERED RELATED LIST of Activity/Task records (a DataGrid filtered by the master FK) — NOT a Timeline and NOT an aggregate activity feed. Build it as a related list, exactly like any other child list." },
  EmailDetailV2: { feature: "Emails", freedom: "Freedom related list of Email activities, filtered to the master", uiShape: "list",
    note: "Emails = a plain FILTERED RELATED LIST of Email records (a DataGrid filtered by the master) — NOT a Timeline and NOT the email-client component. Build it as a related list." },
  // Means-of-communication ("Средства связи контакта" / ContactCommunication) is the NATIVE Communication-options
  // component, NOT a generic list. A real agent downgraded it to a plain Expanded-list because the composite
  // needed the CrtCustomer360App package — that fallback is wrong (loses the add-by-type UI, type icons, dedup).
  ContactCommunicationDetail: { feature: "Communication options", freedom: "Freedom Communication-options component (crt.CommunicationOptions)", uiShape: "component",
    note: "means of communication = the NATIVE Communication-options component (crt.CommunicationOptions, the compositeOnly widget the \"Communication options\" composite assembles — NOT `crt.ContactCommunication`, which is not a real component type; `ContactCommunication` is the ENTITY the data lives in) — read get-component-info for its contract/wiring; it requires the CrtCustomer360App package AND the CommonCommunicationsBehavior feature. Do NOT downgrade it to a plain Expanded-list/DataGrid over ContactCommunication (that loses the typed add-communication UI). If the component/package/feature is unavailable on the stand, that is a decision to RAISE (add the dependency, or confirm the fallback) — not a silent grid." },
};
// Match a classic detail schema to a standard feature by exact name OR entity-prefixed suffix — e.g.
// `ApplicantEmailDetailV2` → `EmailDetailV2`, `ApplicantVisaDetail` → (no)…: prefixed variants of the
// standard details were previously missed and fell through as generic details (then dropped). (#6/#11)
function matchFeature(schemaName) {
  if (!schemaName) return null;
  if (FEATURE_CATALOG[schemaName]) return FEATURE_CATALOG[schemaName];
  const key = Object.keys(FEATURE_CATALOG).find(k => schemaName.endsWith(k));
  return key ? FEATURE_CATALOG[key] : null;
}
// Freedom grid model (the confirmed target convention): the left profile island is a SINGLE-column grid;
// tab/group containers are TWO columns. Classic pages use a 24-column grid, so classic field coordinates are
// CONVERTED into the target grid (see layoutConfig below) — NOT dumped verbatim. Dumping classic 24-col
// coordinates into a native 2-col Freedom container overflows (e.g. column 13 in a 2-track grid) and breaks
// the input layout — the recurring "input grid broken" build defect.
const GRID_2 = ["minmax(32px, 1fr)", "minmax(32px, 1fr)"];
const GRID_1 = ["minmax(32px, 1fr)"];
// a genuinely WIDE multi-column classic Header block (>1 col, flagged as a layout-type decision) keeps the
// full 24-col grid so its multi-column arrangement survives 1:1.
const GRID_24 = Array.from({ length: 24 }, () => "minmax(32px, 1fr)");
// header/analytical widgets — recognised by MODULE key and by CONTAINER name. Catalog values are ARRAYS of
// Freedom component-defs, because one classic module can map to MORE THAN ONE Freedom component.
// Action Dashboard in Freedom is TWO components — a case-stage PROGRESS BAR and a NEXT STEPS panel — and the
// default form template ships NEITHER: both must be ADDED when the object has a configured DCM case. The
// progress bar goes on the page top; Next steps goes in a NEW tab in the tab container, next to Feed. Both
// auto-populate from the object's case (do not hand-author stages/steps). No case on the object ⇒ nothing to add.
const DCM_CHECK = "Check the object's case on-stand: SysSchema WHERE ManagerName='DcmSchemaManager' (NOT 'CaseSchemaManager' — wrong name, returns 0 = false 'no case'); a hit for this entity ⇒ add it, no hit ⇒ nothing to add. A case can exist even if the classic page tracked stage only via a Stage lookup + history detail.";
const DCM_PROGRESS_NOTE = "Case-stage progress bar (crt.EntityStageProgressBar) — NOT in the default Freedom form template. When the object has a DCM case, PREFER building the form page from `PageWithTabsAndProgressBarTemplate` (it ships the bar placed) and RE-BIND the new page to your entity, rather than hand-adding the widget. FALLBACK (already on a no-bar template / page exists): PLACE IT in `MainContainer` (the content container below the header), at the TOP of the content — NOT in `MainHeader`, and not as a bare child of `Main`. It auto-populates from the object's case (do not hand-author stages). " + DCM_CHECK;
const DCM_NEXTSTEPS_NOTE = "Next steps (crt.NextSteps) — NOT in the default Freedom form template; ADD it as a TAB in the card toggle panel BESIDE the Feed and Attachments tabs when the object has a configured DCM case. Build the tab like Feed/Attachments: caption via `#ResourceString(Key)#` (NOT $Resources.Strings.*), set the tab icon to `flag-icon` (do not guess — an invented name renders empty), put the header (Label + '+' menu button) in the tab's `tools` slot and the widget in `items`. It auto-populates from the object's case (do not hand-author steps). " + DCM_CHECK;
// `signal: "dcm"` — DCM is NOT evidenced by the classic page BODY (the DcmActionsDashboard containers are
// Freedom base-template chrome, never touched by the page's own layers); its presence is an ON-STAND fact
// (a configured DCM case, `manifest.signals.dcm`). So these two widgets emit ONLY when the resolved dcm
// signal is present — NOT from the inherited base container (which would leak DCM onto every record/detail
// page). The signals-completeness gate blocks the plan until `signals.dcm` is resolved, so a non-blocked
// plan always has a definite answer here.
const DCM_PROGRESS = { widget: "Case progress bar", freedom: "Freedom case-stage progress bar (page top)", note: DCM_PROGRESS_NOTE, placement: "page-top", signal: "dcm" };
const DCM_NEXTSTEPS = { widget: "Next steps", freedom: "Freedom Next steps panel (new tab next to Feed)", note: DCM_NEXTSTEPS_NOTE, placement: "tab-next-to-feed", signal: "dcm" };
const WIDGET_BY_MODULE = {
  DcmActionsDashboardModule: [DCM_PROGRESS, DCM_NEXTSTEPS], // DCM case dashboard → BOTH Freedom components
  ActionsDashboardModule: [DCM_NEXTSTEPS],
  Timeline: [{ widget: "Timeline", freedom: "Freedom Timeline" }],
};
const WIDGET_BY_CONTAINER = {
  DcmActionsDashboardContainer: [DCM_PROGRESS, DCM_NEXTSTEPS],
  ActionDashboardContainer: [DCM_NEXTSTEPS],
  RecommendationModuleContainer: [{ widget: "Recommendations", chrome: true, freedom: "Freedom product-selection / NBO recommendations component",
    note: "Inherited base-template container (from BasePageV2) — inserted EMPTY (items:[], no `visible` binding) and filled at RUNTIME by the RecommendationModuleUtilities mixin. It shows the Next-Best-Offer (NBO) / product recommendations (RecommendedProduct) only if recommendation rules are configured for the entity; the page schema can't say whether it's used. Check on-stand: does the LIVE Classic page actually render recommendations (are NBO/recommendation rules configured for this entity)? If yes → wire the Freedom product-selection / recommendations component; if it renders empty → inherited chrome, drop it." }],
  DuplicatesWidgetContainer: [{ widget: "Duplicates", freedom: "Freedom duplicates widget" }],
  ESNFeedContainer: [{ widget: "Feed (ESN)", freedom: "Freedom Feed" }],
};
// EMBEDDED PROFILE CARDS — a classic page can embed a compact card of a LINKED record (a "requester" block
// on a request page, the account card on ContactPageV2). It is a page-within-a-page: the `modules` config
// names a small declarative profile schema plus the master/profile wiring — nothing bespoke. Freedom's home
// for the pattern is a native compact-profile component in the SIDE PROFILE, keyed by the PROFILED entity.
// PROVENANCE (be precise — E1 lesson): the component types and their `referenceColumn`/`readonly` contract are
// READ FROM the Freedom component catalog (`get-component-info`), not invented here — but that catalog answered
// from the `latest` superset (`requiresVersionConfirmation`), so presence on a TARGET stand is NOT established
// by this table. That is why the emitted decision always carries the `list-packages` package check.
// `pkg` = the package the component needs as a page-package dependency.
const PROFILE_CARD_BY_ENTITY = {
  Contact: { type: "crt.ContactCompactProfile", pkg: "CrtCustomer360App", shows: "photo, name parts, birth date, country, city, time zone" },
  Account: { type: "crt.AccountCompactProfile", pkg: "CrtCustomer360App", shows: "photo, name, alternative name, country, city, time zone" },
  SysAdminUnit: { type: "crt.UserCompactProfile", pkg: null, shows: "photo and first/middle/last name" },
  VwSysAdminUnit: { type: "crt.UserCompactProfile", pkg: null, shows: "photo and first/middle/last name" },
};
// The profiled entity from the profile SCHEMA NAME — last-resort only, and deliberately narrow: `Account` and
// `Contact` are the two unambiguous OOTB families (AccountProfileSchema / ClientContactProfileSchema). A name
// like `RequesterProfilePage` or `UserProfilePage` says nothing reliable about the entity, so it stays
// unresolved and the mapper raises a decision instead of guessing a component that would render empty.
function guessProfiledEntity(schemaName) {
  const m = /(Account|Contact)Profile/.exec(schemaName || "");
  return m ? m[1] : null;
}
// STRUCTURAL recognition (not a name list): the module carries `masterColumnName` DIRECTLY on its
// viewModelConfig, is not the actions/DCM dashboard shape (which nests masterColumnName under
// dashboardConfig), and is not a module the widget catalog already owns. This is why ONE rule covers every
// embedded profile on every site — the pattern is uniform even when each site names its schemas differently.
function isProfileCardModule(c) {
  if (!c.masterColumnName || c.hasDashboardConfig) return false;
  return !(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName] || WIDGET_BY_MODULE[c.schemaName]);
}
// standard card actions (from the classic ACTIONS menu / toolbar) -> Freedom card actions (B7).
const KNOWN_ACTION_ITEMS = new Set([
  "PrintButton", "ProcessButton", "ViewOptionsButton", "TagButton", "ReloadDataButton",
]);

// A base (template-owned) field a CLIENT schema RECONFIGURED (hid / moved / re-laid-out) is excluded from the payload
// as template context — but the delta is KNOWN, so emit it as a CONCRETE applied override (what to change on the base
// field), not a punt. CHILD pages build these inline (no override list). Extracted from mapToFreedom for Sonar CC 15.
function computeBaseFieldOverrides(eff, isChildPage) {
  const overrides = [];
  if (isChildPage) return overrides;
  for (const f of eff.fields.filter((x) => x.templateOwned && x.schemaTouched)) {
    const hidden = f.visible === false;
    const lay = f.layout || null;
    const parts = [];
    if (hidden) parts.push("hide it");
    if (lay && (lay.column != null || lay.row != null)) {
      const rowPart = lay.row != null ? `, row ${lay.row}` : "";
      const spanPart = lay.colSpan != null ? ` (span ${lay.colSpan})` : "";
      parts.push(`move to column ${lay.column ?? "?"}${rowPart}${spanPart}`);
    } else if (lay) parts.push("re-lay-out (position changed)");
    const change = parts.join("; ") || "reconfigured (delta not concretely readable — inspect the client schema)";
    overrides.push({ field: f.bindTo || f.name, hidden, layout: lay, change });
  }
  return overrides;
}

export function mapToFreedom(eff, opts = {}) {
  const cols = opts.entityColumns || {};       // { column: dataType }
  // #5/#13 — localizable strings from the manifest (page + detail resources). Lets the mapper resolve a
  // classic `Resources.Strings.X` caption to its real localized text instead of shipping an opaque key.
  const resources = opts.resources || {};
  const resolveText = (raw) => {
    if (!raw) return null;
    const key = resourceKey(raw);
    return resources[key] ?? resources[raw] ?? null;
  };
  // Produce a Freedom caption VALUE from a classic caption reference: the resolved literal text if the
  // manifest carries the string, else the `$`-binding as-is, else a synthesized key from the fallback
  // name. `resolved` gates whether the caller still flags it for manual resolution (#5/#13).
  // Major 4 — user-visible text on the page must be a LOCALIZABLE BINDING, never an inline literal (clio
  // rejects hardcoded page text; AGENTS.md). So a caption returns the `$Resources.Strings.<key>` BINDING for
  // the page body, plus the display `text` for the PLAN ONLY, registered in `resourceStrings` so the agent
  // knows what to author. `key` = the ORIGINAL classic resource key when the schema had one, else a
  // synthesized `<name>Caption`. `resolved` = the text is known (no manual decision needed).
  const resourceStrings = {}; // resource key -> default-language text: the map the agent registers at build
  const captionKey = (raw, fallbackName) => raw
    ? resourceKey(raw)
    : (fallbackName || "") + "Caption";
  const caption = (raw, fallbackName) => {
    const key = captionKey(raw, fallbackName);
    const text = resolveText(raw) ?? resolveText((fallbackName || "") + "Caption");
    if (text != null) resourceStrings[key] = text;
    return { binding: "$Resources.Strings." + key, text, key, resolved: text != null, synthesized: !raw };
  };
  // #11(ii)/B2 — parsed detail-schema info { name: { entity, columns } } from the manifest, so a detail's
  // real child entity + list columns are known (and auto-named SchemaNDetail details get resolved).
  const detailSchemas = opts.detailSchemas || {};
  // ENG-93928 — parsed EMBEDDED PROFILE schemas { "AccountProfileSchema": { entity, columns } } from the
  // manifest, so a profile card's profiled entity and the columns it displayed are known facts, not guesses.
  const profileSchemas = opts.profileSchemas || {};
  // #5/#13 (fields) — entity column TITLES { column: "Mobile phone" } from get-entity-schema-properties, so a field's
  // LABEL is the human title, not the raw column code. Falls back to the page resources, then the code.
  const columnTitles = opts.columnTitles || {};
  // entityColumns entries may be a plain dataType STRING (back-compat) OR an object { type, length, ref, title }
  // (from get-entity-schema-properties) — the richer form lets the design-spec Type column show "Text (250)" and a
  // lookup's referenced object "Lookup (Contact)".
  const colMeta = (col) => { const v = cols[col]; return (v && typeof v === "object") ? v : { type: v || null }; };
  const labelFor = (col) => columnTitles[col] ?? resolveText(col) ?? resolveText(col + "Caption") ?? colMeta(col).title ?? null;
  // Name-bound field inserts → fields. Here, not in `mergeHierarchy`: that never receives `entityColumns`.
  eff = promoteNameBoundFields(eff, cols);
  const needsDecision = [];
  const accountedFor = new Set();

  // F9: migrate only the page's OWN content, not the platform template chain seeded for layout.
  // `fromTemplate` elements (e.g. BaseEntityPage's framework methods, base-template details) are
  // context — kept in eff.items for ancestry routing, but excluded from the payload. The full layout
  // tree (index below) still uses ALL items so base containers resolve. `baseContextExcluded` reports
  // the counts so the exclusion is transparent, not silent.
  const notTpl = (x) => !x.fromTemplate;                          // keyed categories + removals
  // F9: the MAIN / TYPED record pages migrate only the CLIENT layer — the chosen Freedom form template already
  // ships the base fields, so `templateOwned` fields are context, not payload. A CHILD edit page is different:
  // it is rebuilt as its OWN page on a mini / grid template that ships NO entity fields, so the child's base-page
  // fields (entity-column-bound, defined in the child's base `*Page` that lands in the seed chain) ARE its content
  // and MUST be built + counted (else a standard child folds to 0 fields and the template threshold undercounts).
  // Framework chrome (templateOwned but NOT column-bound — BaseModulePageV2/BasePageV2 containers/actions) stays
  // suppressed for children too. (Vanislemarina review §2 / Variant B.)
  const isChildPage = !!opts.isChildPage;
  const isContentField = (f) => !f.templateOwned || (isChildPage && !!f.bindTo);
  // An image/photo item is emitted by mapImages as a crt.ImageInput — it must NOT ALSO be emitted here as a plain
  // field. A generator/name-detected image with an explicit off-entity `bindTo` (a cross-datasource photo) otherwise
  // leaked a phantom crt.Input for its column (+ a PDS.<col> attribute), duplicating the widget and — since the
  // image's own value fell to a FILL — leaving a dangling binding. Exclude image-item names from the field payload
  // (the field-projection lacks the `generator`, so match by the item name resolved from eff.items).
  const imageItemNames = new Set((eff.items || []).filter(isImageItem).map((i) => i.name));
  const payloadFields = eff.fields.filter((f) => isContentField(f) && !imageItemNames.has(f.name));
  // A base (template-owned) field a CLIENT schema RECONFIGURED (hid / moved / re-laid-out it) is excluded from
  // the payload as template context, so its client override would silently vanish. This is NOT a decision to
  // punt — the delta is KNOWN, so emit it as a CONCRETE applied override (what to change on the existing base
  // field). The build just applies it; the parallel-analog build does not re-create the field, it modifies the
  // template's copy. Only when the change can't be read concretely does `change` fall back to "reconfigured".
  // For a CHILD page these base fields are now built inline (isContentField above), so there is NO separate
  // override list — the reconfiguration rides the built field.
  const baseFieldOverrides = computeBaseFieldOverrides(eff, isChildPage);
  const payloadRules = eff.rules.filter(notTpl);
  const payloadDetails = eff.details.filter(notTpl);
  const payloadMethods = eff.methods.filter(notTpl);
  const payloadComponents = (eff.components || []).filter(notTpl);
  const baseContextExcluded = {
    fields: eff.fields.length - payloadFields.length,
    rules: eff.rules.length - payloadRules.length,
    details: eff.details.length - payloadDetails.length,
    methods: eff.methods.length - payloadMethods.length,
    components: (eff.components || []).length - payloadComponents.length,
  };

  const index = new Map((eff.items || []).map(i => [i.name, i])); // layout tree for F3 routing (never null)
  const profileAnchors = deriveProfileAnchors(eff.items);         // RV14 — structural side-profile anchors
  const ctx = { eff, cols, resources, resolveText, caption, detailSchemas, profileSchemas, columnTitles, colMeta, labelFor,
    index, profileAnchors, payloadFields, payloadDetails, isMiniPage: !!opts.isMiniPage };
  // ---- fields (3-part binding) routed into a shared container builder (tabs/groups/islands, emitted once) ----
  const containers = createContainers(ctx);
  const F = mapFields(ctx, containers);
  F.needsDecision.forEach(d => needsDecision.push(d));
  F.accountedFor.forEach(a => accountedFor.add(a));

  // ---- rules ---- (pass ALL known element names so a rule targeting a tab/group/container — not just a field —
  // is recognised as a valid target, not mis-flagged as "no field for it")
  const _r = mapRules(payloadRules, payloadFields, new Set((eff.items || []).map(i => i.name)));
  const { pageBusinessRules, entityBusinessRules } = _r;
  _r.needsDecision.forEach(d => needsDecision.push(d));

  // ---- details: STANDARD features (A3 → Freedom analog) vs genuine custom details (Expanded list) ----
  const D = mapDetails(ctx, containers, F.profileRegion);
  D.needsDecision.forEach(d => needsDecision.push(d));
  D.accountedFor.forEach(a => accountedFor.add(a));

  // ---- embedded profile cards (linked-record blocks) → the Freedom side profile (ENG-93928) ----
  const _pc = mapProfileCards(ctx);
  const profileCards = _pc.profileCards;
  _pc.needsDecision.forEach(d => needsDecision.push(d));
  _pc.accountedFor.forEach(a => accountedFor.add(a));

  // ---- Moment 4: header/analytical widgets → Freedom analogs (base-provided are NOTED, not dropped) ----
  const _w = mapWidgets(eff, { signals: opts.signals });
  const { widgets, chromeWidgets } = _w;
  _w.needsDecision.forEach(d => needsDecision.push(d));
  _w.accountedFor.forEach(a => accountedFor.add(a));

  // ---- image / photo components → a REAL crt.ImageInput element (view+viewModel+model diffs) ----
  const _img = mapImages(eff, ctx, F);
  const images = _img.images;
  _img.needsDecision.forEach(d => needsDecision.push(d));
  _img.accountedFor.forEach(a => accountedFor.add(a));
  // merge the image element's attribute + column into the field sinks so the view-model / model configs carry them.
  Object.assign(F.attributes, _img.attributes);
  Object.assign(F.pdsColumns, _img.pdsColumns);

  // ---- Moment 5: card actions / ACTIONS menu → Freedom card actions (B7) ----
  const _ca = mapCardActions(eff);
  const cardActions = _ca.cardActions;
  _ca.needsDecision.forEach(d => needsDecision.push(d));
  _ca.accountedFor.forEach(a => accountedFor.add(a));

  // feature toggles / charts / methods → handler stubs / removals / referenced modules
  const _rl = mapRemainingLogic(eff, payloadMethods, payloadComponents);
  const handlerStubs = _rl.handlerStubs;
  const standardMethodsFiltered = _rl.standardMethodsFiltered;
  _rl.needsDecision.forEach(d => needsDecision.push(d));

  // ---- imperative MEMBERS the engine used to read for their names at most (attributes) or not at all
  // (messages / mixins / the full define() dep list) ----
  mapImperativeMembers(eff, cols).needsDecision.forEach(d => needsDecision.push(d));

  // ---- Fix 2: LOUD unmapped-component drop ----
  const _drop = mapUnmappedDrop(eff, accountedFor);
  _drop.needsDecision.forEach(d => needsDecision.push(d));
  // structure another builder owns (tabs / groups / details / scaffolding) — accounted for, not dropped
  _drop.structural.forEach(a => accountedFor.add(a));

  return {
    entity: eff.entity,
    // structural (tab + grid containers) first so field inserts resolve their parentName.
    viewConfigDiff: [...containers.structural, ...F.viewConfigDiff, ...(_img.viewConfigDiff || [])],
    viewModelConfigDiff: [{ operation: "merge", path: ["attributes"], values: F.attributes }],
    modelConfigDiff: [{ operation: "merge", path: ["dataSources", "PDS", "config", "attributes"], values: F.pdsColumns }],
    pageBusinessRules, entityBusinessRules, details: D.details, handlerStubs, standardMethodsFiltered, needsDecision,
    ruleSourceCount: payloadRules.length, // # of declarative page/entity rule DEFINITIONS considered (before mapping) — lets a caller detect "rules existed but none mapped into Logic"
    // Major 4 — resource strings the page bindings reference (`$Resources.Strings.<key>` → default text): the
    // map the agent registers at build time. viewConfigDiff carries only bindings, never inline user text.
    resources: resourceStrings,
    // standard Creatio features replaced by their Freedom analog (A3) — NOT generic details.
    standardFeatures: D.standardFeatures,
    // embedded profile cards (a compact card of a LINKED record) → the Freedom side profile: the native
    // compact-profile component wired by `referenceColumn`, or the read-only-fields island fallback.
    profileCards,
    // header/analytical widgets recognised → Freedom analogs (base-provided flagged).
    widgets,
    // inherited base-template chrome (e.g. empty Recommendations container) — hidden from the plan, kept for inspection.
    chromeWidgets,
    // image/photo components (generator-based) → Freedom image component.
    images,
    // base (template-provided) fields a client schema reconfigured (hide/move) — CONCRETE overrides to APPLY
    // onto the template's field (the build does not re-create base fields), not a decision to confirm.
    baseFieldOverrides,
    // "wide" ⇒ the Classic page has a populated Header block → recommend the top-area Freedom template.
    headerLayout: F.headerLayout,
    // card actions / ACTIONS-menu items to wire as Freedom card actions (B7).
    cardActions,
    // referenced UI modules pulled via define() deps — rendered UI outside the page-schema migration unit.
    referencedModules: eff.referencedModules || [],
    // F9: how many effective elements were platform-template context excluded from the payload.
    baseContextExcluded,
    // The mapper's OWN record of which classic elements it produced something for. `mapUnmappedDrop` already
    // relies on it to decide what silently vanished; the member ledger needs the same evidence, and re-deriving
    // it from `viewConfigDiff` gets it wrong (a tab becomes a structural container under a different name, a
    // detail is keyed by its schema, not its diff-item name) — which shows up as the ledger crying wolf over
    // elements that ARE mapped. One source of truth, consumed by both.
    // explicit comparator, not Array#sort's default: the ledger consumes this list, and a golden test asserts
    // byte-identical output across two runs of the same manifest.
    accountedFor: [...accountedFor].sort((a, b) => String(a).localeCompare(String(b))),
  };
}

// Container builder: emits each classic tab / group / profile-island as a Freedom container ONCE (tracking
// what's emitted) and accumulates them in `structural`. ensure* route their decisions/accountedFor into the
// CALLING phase's sinks (nd array, accounted Set) so needsDecision order matches the original single pass —
// fields and details share ONE builder (a detail-only tab must still be emitted).
// The tab component and its caption form, in ONE place (both were wrong together, so they stay together).
// A tab caption MUST be `#ResourceString(Key)#`; `$Resources.Strings.*` does not render on a tab — the same rule
// `./references/classic-to-freedom-mapping.md` states for tab / card-toggle-panel captions.
const TAB_COMPONENT = "crt.TabContainer";
const tabCaption = (c) => (c?.key ? `#ResourceString(${c.key})#` : c?.binding || "");
function createContainers(ctx) {
  const { index, caption } = ctx;
  const structural = [];            // tab + tab-grid container inserts (emitted once, only when used)
  const emittedTabs = new Map();    // tab -> resolved parent container for routed fields
  const emittedGroups = new Map();  // group name -> inner container fields route into (emitted once)
  const emittedIslands = new Map();
  function ensureTab(tab, templateOwned, nd, accounted) {
    if (emittedTabs.has(tab)) return emittedTabs.get(tab);
    accounted.add(tab);
    let parentName;
    if (templateOwned) {
      // F9×F3: a BASE-TEMPLATE tab (e.g. ESNTab) is provided by the Freedom counterpart template —
      // synthesizing a fresh crt.Tab here would duplicate/conflict with it. Route the field to the
      // EXISTING tab and flag placement; never emit a new crt.Tab/grid for a template-owned tab.
      parentName = tab;
      nd.push({ kind: "base-tab-placement", item: tab,
        reason: `payload field(s) target base-template tab '${tab}' — place into the Freedom template's existing equivalent (do NOT create a new tab); confirm the target container` });
    } else {
      // client-owned tab: the page defines it, so we build it. Its grid holds the routed fields.
      parentName = tabGridName(tab);
      const tItem = index.get(tab);
      const c = caption(tItem?.caption, tab);
      structural.push(
        // A tab is a `crt.TabContainer` under `Tabs.items` — verified on a live stand (2026-08-08): the component
        // catalog lists crt.TabContainer ("Single tab within a TabPanel") and crt.TabPanel but NO `crt.Tab`, nine
        // real Freedom pages across two stands carry 0 crt.Tab nodes, and a real tab insert reads
        // `{parentName:"Tabs", propertyName:"items", values:{type:"crt.TabContainer", items:[], caption:"#ResourceString(K)#"}}`.
        // This previously emitted `crt.Tab` into `propertyName:"tabs"` with a `$Resources.Strings.*` caption — a
        // component that does not exist, in a slot that is not the one the platform fills, with the one caption
        // form the skill's own mapping reference says will NOT render on a tab.
        { operation: "insert", name: tab, parentName: "Tabs", propertyName: "items",
          values: { type: TAB_COMPONENT, items: [], caption: tabCaption(c), iconPosition: "only-text", visible: true } },
        { operation: "insert", name: parentName, parentName: tab, propertyName: "items",
          values: { type: "crt.GridContainer", columns: GRID_2 } },
      );
      // flag only when the caption is NOT resolved to real text (synthesized key, or an unresolved key
      // because no manifest.resources was supplied). A resolved literal caption needs no decision (#5/#13).
      if (!c.resolved) nd.push({ kind: "tab-caption", item: tab,
        reason: c.synthesized
          ? `synthesized caption key '${c.key}' — classic caption not in model; author the localized string for it`
          : `tab caption '${c.key}' is an unresolved resource key — pass the schema's localizable strings as manifest.resources to resolve it, or confirm the real label` });
    }
    accounted.add(parentName);
    emittedTabs.set(tab, parentName);
    return parentName;
  }
  function ensureGroup(g, parentName, nd, accounted) {
    if (emittedGroups.has(g.name)) return emittedGroups.get(g.name);
    accounted.add(g.name);
    let inner;
    // A CONTROL_GROUP is a collapsible crt.ExpansionPanel when it is a genuinely LABELLED group. The reliable
    // discriminator is whether its caption RESOLVES to real text — NOT the name pattern:
    //   • caption RESOLVES to real text (e.g. "Pricing") ⇒ LABELLED ⇒ ExpansionPanel, even when the name is the
    //     designer-auto `Tab<hex>TabLabelGroup<hex>` form (the designer stores a REAL user label under that auto
    //     key — flattening those to a grid on the name alone DROPPED real "Pricing" groups).
    //   • caption does NOT resolve: if it is a genuine ref on a MEANINGFUL name (e.g. NotesControlGroup) ⇒ still an
    //     ExpansionPanel + a [group-caption] decision to resolve; if it is an AUTO self-derived key on the
    //     `TabLabelGroup<hex>` name (never authored) OR there is no caption at all ⇒ plain crt.GridContainer, no
    //     decision (an unlabelled layout wrapper is not a missing label).
    const autoLayoutGroup = /TabLabelGroup[0-9a-f]{4,}$/i.test(g.name); // designer auto grid-layout wrapper name
    const c = g.itemType === VIEW_ITEM_TYPE.CONTROL_GROUP ? caption(g.caption, g.name) : null;
    if (c && (c.resolved || (!c.synthesized && !autoLayoutGroup))) {
      // labelled collapsible group -> crt.ExpansionPanel wrapping a grid.
      structural.push({ operation: "insert", name: g.name, parentName, propertyName: "items",
        values: { type: "crt.ExpansionPanel", caption: c.binding, collapsible: true } });
      inner = g.name + "Grid";
      structural.push({ operation: "insert", name: inner, parentName: g.name, propertyName: "items",
        values: { type: "crt.GridContainer", columns: GRID_2 } });
      if (!c.resolved) nd.push({ kind: "group-caption", item: g.name,
        reason: `group caption '${c.key}' is an unresolved resource key — pass manifest.resources to resolve it, or confirm the real label` });
    } else {
      // GRID_LAYOUT / generic container, OR an uncaptioned CONTROL_GROUP -> plain crt.GridContainer (no caption).
      inner = g.name;
      structural.push({ operation: "insert", name: inner, parentName, propertyName: "items",
        values: { type: "crt.GridContainer", columns: GRID_2 } });
    }
    emittedGroups.set(g.name, inner);
    return inner;
  }
  function ensureProfileIsland(name, accounted) {
    if (emittedIslands.has(name)) return emittedIslands.get(name);
    structural.push({ operation: "insert", name, parentName: "SideAreaProfileContainer", propertyName: "items",
      values: { type: "crt.GridContainer", columns: GRID_1 } });
    accounted.add(name);
    emittedIslands.set(name, name);
    return name;
  }
  return { structural, ensureTab, ensureGroup, ensureProfileIsland };
}

// fields (3-part binding: control + attribute + dataSource). Routes each payload field into its Freedom
// container by climbing the classic ancestry, converting the classic 24-col grid into the target grid.
// Returns viewConfigDiff/attributes/pdsColumns + its needsDecision[]/accountedFor[] + the profileRegion
// resolver the details phase reuses.
function mapFields(ctx, containers) {
  const { cols, colMeta, labelFor, index, profileAnchors, payloadFields } = ctx;
  const { ensureTab, ensureGroup, ensureProfileIsland } = containers;
  const needsDecision = [], viewConfigDiff = [], accountedFor = new Set();
  const attributes = {}, pdsColumns = {};
  let fieldsWithTitle = 0;
  // R9 — faithful per-container row assignment. An explicit classic row is authoritative and kept verbatim;
  // a field with NO explicit row takes the next row not already claimed in that container. The old code kept
  // a single counter bumped on EVERY field (explicit ones too), so a container mixing explicit and auto rows
  // mis-numbered the autos — an auto field landing on an explicit field's row, or leaving gaps.
  const autoRow = {};    // parent -> next auto row to try (1-based)
  const usedCells = {};  // parent -> Set of "col:row" cells already taken (span-aware), so nothing overlaps
  const nameCount = {};
  // Cell-occupancy helpers hoisted OUT of the field loop (were re-created per field). `cells` is passed in so
  // they stay pure. A per-container placement cap bounds the relocation scan on hostile input (thousands of
  // insert-ops all colliding would otherwise be O(n²)) — the analog of the AST depth-cap; excess is flagged.
  const MAX_FIELDS_PER_CONTAINER = 500;
  const span = (start, n) => Array.from({ length: Math.max(1, n) }, (_, i) => start + i);
  const cellKeys = (c, cs, r, rs) => span(c, cs).flatMap((cc) => span(r, rs).map((rr) => cc + ":" + rr));
  const cellFree = (cells, c, cs, r, rs) => cellKeys(c, cs, r, rs).every((k) => !cells.has(k));
  const claimCells = (cells, c, cs, r, rs) => cellKeys(c, cs, r, rs).forEach((k) => cells.add(k));
  const placedCount = {};       // parent -> fields placed so far (bounds the relocation search)
  const truncatedContainers = new Set();
  // FOLD the repetitive PER-FIELD decisions — a dense classic page emits one collision/control/dup line PER
  // FIELD (~950 unactionable entries). Accumulate here; emit ONE summary per kind (per container for collisions)
  // after the loop. The relocation / control-defaulting / naming behavior is unchanged — only the reporting folds.
  const collisionByContainer = new Map(); // parent -> { count, gridCols, sample: [] }
  const fieldControlCols = [];            // cols with no resolvable control type (defaulted to crt.Input)
  // Pre-resolve every field's owner once, so we can DETECT the header layout type before routing.
  // STABLE-SORT by the classic diff `order` first (Major): the eff projection preserves Map order, but the
  // classic layout order is `order`/index — without this a field with a lower order that appears later in the
  // Map was assigned a LATER row (wrong vertical order). Fields with no explicit order keep their Map position
  // (Infinity sorts last, stably). Row assignment below then walks fields in true layout order.
  const resolved = payloadFields
    .map((f, i) => ({ f, i, own: resolveOwner(f.parent, index, profileAnchors) }))
    .sort((a, b) => ((a.f.order ?? Infinity) - (b.f.order ?? Infinity)) || (a.i - b.i));
  // Moment 1 — layout type: classic `Header` fields spanning >1 grid column == a WIDE multi-column
  // header (like Contract), NOT the narrow left profile island. In that case route them to a full-width
  // header GridContainer (preserving the multi-column grid) instead of cramming them into colSpan-1.
  const headerCols = new Set(resolved
    .filter(r => r.own.kind === "profile" && r.own.via === "Header" && r.f.layout?.column != null)
    .map(r => r.f.layout.column));
  const headerIsWide = headerCols.size > 1;
  if (headerIsWide) {
    containers.structural.push({ operation: "insert", name: "HeaderContainer", parentName: "Header", propertyName: "items",
      values: { type: "crt.GridContainer", columns: GRID_24 } });
    needsDecision.push({ kind: "layout-type", item: "Header",
      reason: `classic Header is a WIDE ${headerCols.size}-column block, not the default left profile island — mapped to a full-width header grid; confirm the target Freedom page uses a header region (no left profile) and the column layout` });
  }
  const profileRegion = (own) => (own.via === "Header" && headerIsWide) ? "HeaderContainer" : "SideAreaProfileContainer";
  // #9b — the classic left area can group fields into MORE THAN ONE island container (e.g. ContactContainer
  // + InternalRequestContainer, both under LeftModulesContainer). The island = the OUTERMOST group between
  // the field and the profile anchor (groups[0]). If there is >1 distinct island, rebuild each as its own
  // container in the side profile instead of flattening every field into one stack.
  const islandOf = (own) => own.groups?.length ? own.groups[0].name : null;
  const distinctProfileIslands = new Set(resolved
    .filter(r => r.own.kind === "profile" && !(r.own.via === "Header" && headerIsWide))
    .map(r => islandOf(r.own)).filter(Boolean));
  const splitIslands = distinctProfileIslands.size > 1;
  // Build the Freedom field `values` object (its own function so mapFields stays under Sonar CC 15 — S3776).
  // Closes over needsDecision/cols and bumps fieldsWithTitle; returns the values to insert.
  // Apply column-type-derived flags (lookup ref/actions, read-only, linked display, picker, multiline) to a
  // field's values object. Split out of buildFieldValues for Sonar CC 15; mutates values + needsDecision.
  const applyFieldTypeMeta = (values, col, c, meta) => {
    if (c.lookup && meta.ref) values.refSchema = meta.ref;
    if (meta.readOnly) values.readOnly = true; // explicit read-only from column metadata (mirrors/virtual)
    // linkedDisplay: a plain scalar shown via a picker (contentType 5, no ref) — a read-only value from a linked record.
    if (c.linkedDisplay) { values.readOnly = true; values.linkedValue = true; }
    if (c.lookup && !meta.ref && cols[col] && typeof cols[col] === "object")
      needsDecision.push({ kind: "lookup-no-ref", item: col,
        reason: `'${col}' is typed as a lookup but its entity column has no reference schema — verify the target object.` });
    if (c.lookup) { values.listActions = []; values.controlActions = []; }
    if (c.picker) values.pickerType = c.picker;
    if (c.multiline) values.multiline = true;
  };

  // Resolve the field's tooltip from classic `tip` (resource key) and `hint`. A static Resources.Strings.* hint
  // fills the tooltip only if none already; a dynamic hint (bound to a computed method) is surfaced as a decision.
  // Split out of buildFieldValues for Sonar CC 15; mutates values + needsDecision.
  const applyHintTip = (values, f, col) => {
    if (f.tip) values.tip = { content: "$" + f.tip }; // carry the classic tooltip resource key
    if (!f.hint) return;
    if (f.hint.startsWith("Resources.Strings.")) {
      if (!values.tip) values.tip = { content: "$" + f.hint };
      return;
    }
    needsDecision.push({ kind: "field-hint", item: col,
      reason: `field '${col}' tooltip is a dynamic hint bound to '${f.hint}' (computed, not a static resource)${values.tip ? " and competes with a static tip already mapped" : ""} — wire the Freedom tooltip via a handler/converter` });
  };

  const buildFieldValues = (f, col, c, meta, vis, layoutConfig) => {
    const lbl = labelFor(col);
    if (lbl != null) fieldsWithTitle++;
    const values = {
      type: c.type,
      // crt.ImageInput binds through `value`, NOT `control` (verified component contract). Every other field
      // component binds through `control`.
      ...(c.image ? { value: "$" + col } : { control: "$" + col }),
      labelPosition: c.type === "crt.Checkbox" ? "beside" : "above", visible: vis, layoutConfig,
    };
    // Major 4 — a column-bound field AUTO-labels from the entity column's (localized) title, so we do NOT write
    // an inline label/caption (clio rejects hardcoded page text). `titleText`/`typeLabel` are PLAN-only metadata.
    if (lbl != null) values.titleText = lbl;
    values.typeLabel = fieldTypeLabel(col, meta, c);
    applyFieldTypeMeta(values, col, c, meta);
    applyHintTip(values, f, col);
    return values;
  };
  // Route a field to its Freedom container by ancestry (own function so mapFields stays under Sonar CC 15).
  // Mutates accountedFor/needsDecision via closure; returns the parent container name.
  const routeProfileField = (own) => {
    let parent = profileRegion(own);
    // island/group wrappers between the field and the profile anchor are ACCOUNTED FOR (their fields migrate
    // into the profile) so they are not mis-flagged as "produced no Freedom element".
    for (const g of own.groups) accountedFor.add(g.name);
    // #9b: with >1 island, route this field into its OWN island container (built once), preserving the split.
    const island = islandOf(own);
    if (splitIslands && parent === "SideAreaProfileContainer" && island) parent = ensureProfileIsland(island, accountedFor);
    return parent;
  };
  const routeTabField = (own) => {
    let parent = ensureTab(own.tab, own.tabTemplateOwned, needsDecision, accountedFor);
    // C5: rebuild each client-owned tab's classic group as ExpansionPanel/GridContainer, nested; base tabs stay flat.
    if (!own.tabTemplateOwned) for (const g of own.groups) parent = ensureGroup(g, parent, needsDecision, accountedFor);
    else for (const g of own.groups) accountedFor.add(g.name); // base-tab groups: known, not rebuilt
    return parent;
  };
  const routeField = (f, own) => {
    if (own.kind === "profile") return routeProfileField(own);
    if (own.kind === "tab") return routeTabField(own);
    const why = own.why === "undefined-parent"
      ? `classic container '${own.parent}' is not defined by any schema or template — seed the base template (F2) so it resolves`
      : `classic container '${f.parent}' is defined but its parent chain never reaches a profile/tab anchor (climbed to the page root) — the base-template seed is incomplete/wrong (F2): seed the real parent template so the profile/tab it nests in is present, or confirm the target tab/group`;
    needsDecision.push({ kind: "container", item: f.name || f.bindTo, reason: `${why} — placed in ${FLAT_FALLBACK} for now` });
    return FLAT_FALLBACK; // parent chain unresolvable
  };
  // Resolve a field's column, control type and unique element name (own function for Sonar CC 15). Splits the two
  // unresolved-control causes: a MISSING bound column → virtual-field decision naming nearest columns; a resolved
  // column whose TYPE didn't map → folded field-control summary. Mutates needsDecision/fieldControlCols/nameCount.
  const resolveFieldControl = (f) => {
    const col = f.bindTo || f.name || "Field";
    const meta = colMeta(col);
    const haveCols = Object.keys(cols).length > 0;
    const missingColumn = !!f.bindTo && haveCols && !(col in cols);
    // A bound column NOT on the entity is (almost always) a companion value shown FROM A RELATED DATA SOURCE
    // (e.g. Contact.Phone/Email/BirthDate on an Employee page via the Contact lookup). Freedom shows this
    // natively — add the related data source's column through the lookup and bind the input to it READ-ONLY.
    // So it is NOT a ⚠ assumption: it is mapped as a LINKED value on the field itself (values.linkedValue in
    // the loop below → the designspec renders the concrete cross-datasource recipe in the layout row). We keep
    // the nearest existing columns only as a secondary hint for the rarer renamed/typo case.
    const nearMissing = missingColumn ? nearestColumns(col, cols) : [];
    const ctl = control(meta.type, f.contentType, meta.ref);
    if (!ctl && !missingColumn) fieldControlCols.push(col);   // (a) only — a missing column is NOT double-flagged
    const c = ctl || { type: "crt.Input" };
    // #4: unique element name derived from the column; the same column bound by several classic items → col, col_2,
    // col_3 (a NORMAL configurator pattern, resolved at design time — no decision), so none is dropped.
    nameCount[col] = (nameCount[col] || 0) + 1;
    const elName = nameCount[col] === 1 ? col : `${col}_${nameCount[col]}`;
    return { col, meta, missingColumn, nearMissing, c, elName };
  };
  // Convert the classic 24-col grid coords to the TARGET Freedom grid (profile 1-col / tab 2-col / wide header
  // 24-col), assign a collision-free (span-aware) cell, and return the layoutConfig. Own function for Sonar CC 15;
  // mutates the per-container grid state (usedCells/placedCount/autoRow/truncatedContainers) + collisionByContainer.
  // Grid geometry: map a classic field's (column/colSpan) onto the Freedom target grid (1/2/24 cols),
  // clamped to the grid's right edge so a full-width field in col 2 (or an over-wide header) can't claim a
  // phantom column and overflow. Split out of computeLayout for Sonar CC 15.
  const gridGeometry = (cl, own) => {
    const profileGridCols = (own.via === "Header" && headerIsWide) ? 24 : 1;
    const gridCols = own.kind === "profile" ? profileGridCols : 2;
    let column, colSpan;
    if (gridCols === 1) { column = 1; colSpan = 1; }
    else if (gridCols === 2) {
      column = (cl.column ?? 0) >= 12 ? 2 : 1;      // classic right half (col >= 12) -> Freedom column 2
      colSpan = (cl.colSpan ?? 24) >= 24 ? 2 : 1;   // classic full-width -> span both columns, else one
    } else {
      column = cl.column != null ? cl.column + 1 : 1; // wide header: preserve the classic 24-col grid 1:1
      colSpan = cl.colSpan != null ? cl.colSpan : 24;
    }
    column = Math.min(Math.max(1, column), gridCols);
    colSpan = Math.max(1, Math.min(colSpan, gridCols - column + 1));
    return { column, colSpan, gridCols };
  };

  // Auto-flow row: place at the next free row, scanning down (bounded by MAX_FIELDS_PER_CONTAINER).
  // `geom` = { column, colSpan, rowSpan, gridCols } from gridGeometry (bundled to stay under Sonar's param limit).
  const autoFlowRow = (parent, geom, cap, cells) => {
    const { column, colSpan, rowSpan } = geom;
    let cur = autoRow[parent] || 1;
    if (!cap) { const limit = cur + MAX_FIELDS_PER_CONTAINER; while (cur < limit && !cellFree(cells, column, colSpan, cur, rowSpan)) cur++; }
    autoRow[parent] = cur + 1;
    return cur;
  };

  // Explicit classic row: honor it, but if the 24→N collapse (or a rowSpan overlap) dropped this onto an
  // occupied cell, scan down to the next free row and fold the bump into one per-container collision summary.
  const explicitRowResolve = (explicitRow, parent, geom, col, cap, cells) => {
    const { column, colSpan, rowSpan, gridCols } = geom;
    let row = explicitRow;
    if (cap || cellFree(cells, column, colSpan, row, rowSpan)) return row;
    const limit = row + MAX_FIELDS_PER_CONTAINER;
    while (row < limit && !cellFree(cells, column, colSpan, row, rowSpan)) row++;
    let cc = collisionByContainer.get(parent);
    if (!cc) { cc = { count: 0, gridCols, sample: [] }; collisionByContainer.set(parent, cc); }
    cc.count++; if (cc.sample.length < 6) cc.sample.push(col);
    return row;
  };

  const computeLayout = (f, own, parent, col) => {
    const cl = f.layout || {};
    const { column, colSpan, gridCols } = gridGeometry(cl, own);
    // rowSpan is clamped the same way (a hostile 1e9 would OOM the 2-D walk).
    const rowSpan = Math.max(1, Math.min(cl.rowSpan ?? 1, MAX_FIELDS_PER_CONTAINER));
    const geom = { column, colSpan, rowSpan, gridCols };
    const cells = usedCells[parent] || (usedCells[parent] = new Set());
    const cap = (placedCount[parent] = (placedCount[parent] || 0) + 1) > MAX_FIELDS_PER_CONTAINER; // relocation scan bound
    if (cap && !truncatedContainers.has(parent)) {
      truncatedContainers.add(parent);
      needsDecision.push({ kind: "layout-truncated", item: parent,
        reason: `container '${parent}' holds more than ${MAX_FIELDS_PER_CONTAINER} fields — collision relocation is bounded past this point (rows may be approximate). This is far beyond any real page; confirm the input is not malformed.` });
    }
    const explicitRow = cl.row != null ? cl.row + 1 : null;
    const row = explicitRow == null
      ? autoFlowRow(parent, geom, cap, cells)
      : explicitRowResolve(explicitRow, parent, geom, col, cap, cells);
    claimCells(cells, column, colSpan, row, rowSpan);
    return { column, row, colSpan, rowSpan };
  };
  // Resolve a field's Freedom visibility (static false → hidden; a statically-hidden ancestor container → hidden
  // too) and surface the dynamic-visibility / ancestor-visibility decisions. Own function for Sonar CC 15.
  const fieldVisibility = (f, own, col) => {
    const hiddenAncestor = (own.groups || []).find((g) => g.visible === false || g.visible === "dynamic");
    let vis = f.visible !== false;
    if (hiddenAncestor?.visible === false) vis = false; // inherits a statically-hidden ancestor
    // On a MINI PAGE every add-mode field is shown/hidden BY THE ADD-MODE MECHANISM (not a rule) — flagging each
    // as a visibility-rule was pure noise; skip for mini pages. On a real form a dynamic field IS worth confirming.
    if (f.visible === "dynamic" && !ctx.isMiniPage) needsDecision.push({ kind: "visibility-rule", item: col,
      reason: `field '${col}' visibility is dynamic (bound/rule/feature) in classic — confirm the Freedom visibility rule; static mapping shows it` });
    if (hiddenAncestor) needsDecision.push({ kind: "ancestor-visibility", item: col,
      reason: `field '${col}' sits inside container '${hiddenAncestor.name}' which is ${hiddenAncestor.visible === false ? "hidden (static) — the field is mapped hidden too" : "conditionally shown (dynamic/rule) in classic"}; wire the container's visibility condition onto the Freedom field/group instead of leaving it unconditionally visible` });
    return vis;
  };
  for (const { f, own } of resolved) {
    const parent = routeField(f, own);
    const { col, meta, c, elName, missingColumn, nearMissing } = resolveFieldControl(f);
    const layoutConfig = computeLayout(f, own, parent, col);
    const vis = fieldVisibility(f, own, col);
    const values = buildFieldValues(f, col, c, meta, vis, layoutConfig);
    // A column not on the entity → a LINKED cross-datasource value: mark it read-only + linkedValue so the design
    // spec maps it via the Freedom "column from a related data source" recipe (not a ⚠ assumption). Carry the
    // nearest existing columns for the secondary renamed-column case.
    if (missingColumn) { values.readOnly = true; values.linkedValue = true; if (nearMissing.length) values.linkedNearest = nearMissing; }
    viewConfigDiff.push({ operation: "insert", name: elName, values, parentName: parent, propertyName: "items" });
    attributes[col] = { modelConfig: { path: "PDS." + col } };
    pdsColumns[col] = { path: col };
  }
  // ---- FOLD the accumulated per-field noise into summaries (declarations near the loop top) ----
  const totalCollisions = [...collisionByContainer.values()].reduce((a, c) => a + c.count, 0);
  // The DESIGN-PREREQUISITE — the ONLY layout signal surfaced (not per field, and NOT a second per-page
  // "layout-collision" line: that said the same thing twice, and the per-container breakdown is engine-internal
  // noise the agent can't act on). A dense multi-column classic grid does NOT map 1:1 onto the narrow (1–2 col)
  // Freedom form; choosing the right target container/grid is a WHOLE-PAGE decision the agent must make BEFORE
  // designing — the engine only auto-relocates collisions as a fallback. Fire only when the collapse is systemic
  // so it doesn't nag pages with a stray collision or two.
  if (totalCollisions >= 12) needsDecision.push({ kind: "layout-density", item: "(page layout)",
    reason: `the classic page packs fields into a dense multi-column (up to 24-col) grid that does NOT map 1:1 onto the Freedom form's narrow (1–2 col) target — ${totalCollisions} fields collided and were auto-relocated as a fallback (rows approximate). TODO before designing: choose the optimal Freedom container/grid settings for THIS page (target column count, grouping into expansion panels / sub-groups, field spans) so the layout transfers correctly. This is a whole-page layout decision, not a field-by-field fix.` });
  if (fieldControlCols.length) {
    const shown = fieldControlCols.slice(0, 12).join(", ") + (fieldControlCols.length > 12 ? ` … (+${fieldControlCols.length - 12} more)` : "");
    needsDecision.push({ kind: "field-control", item: `(${fieldControlCols.length} fields)`,
      reason: `${fieldControlCols.length} field(s): the entity column exists but its TYPE was not recognized (an unmapped/exotic DataValueType code that get-entity-schema-properties returned as a number), OR no \`manifest.entityColumns\` was supplied to resolve types — defaulted to \`crt.Input\`. Confirm the control on-stand: ${shown}` });
  }
  // #9b: >1 classic left-area island → each rebuilt as its own container in the side profile (above),
  // preserving the split the user sees on the classic page. Surface it as a KNOWN decision.
  if (splitIslands) needsDecision.push({ kind: "profile-island", item: [...distinctProfileIslands].join(", "),
    reason: `classic left profile area has ${distinctProfileIslands.size} distinct islands (${[...distinctProfileIslands].join(", ")}) — build EACH as its own crt.GridContainer in the side profile, preserving the classic split (NOT flattened). Do NOT merge them into one container "for simplicity" — that is a silent plan deviation. Merge ONLY if the Freedom left area genuinely cannot stack containers, and say so.` });
  // #5/#13 (fields) — if NO field label resolved to a real title, the spec shows column CODES. Nudge the
  // agent to pass get-entity-schema-properties column titles so labels read like the classic page, not raw codes.
  if (payloadFields.length && fieldsWithTitle === 0) needsDecision.push({ kind: "field-labels", item: "(all fields)",
    reason: `field labels are shown as column codes — no titles were supplied. Pass the entity's column titles (from get-entity-schema-properties) as manifest.columnTitles so labels read like the classic page (e.g. MobilePhone → "Mobile phone", ExpertiseLevel → "Specialist expertise level")` });
  // headerLayout — the Classic page carries a WIDE, populated Header block (fields in the header, not just the
  // title). This is the signal that the Freedom target should be the top-area template (area on top), so the
  // header elements land in TopAreaProfileContainer rather than being crammed into the narrow left profile.
  return { viewConfigDiff, attributes, pdsColumns, needsDecision, accountedFor, profileRegion, headerLayout: headerIsWide ? "wide" : null };
}

// details: STANDARD features (A3 → Freedom analog) vs genuine custom details (Expanded list). Dedups by
// signature, ensures the owning tab exists (via the shared container builder), and resolves titles/columns
// from manifest.detailSchemas. Returns details[]/standardFeatures[] + its needsDecision[]/accountedFor[].
// A bundled detail's inline-editable-grid config (dinfo.addMode.editableGrid) → the `editable` shape the design
// spec renders ("Editable list" + how to enable it); any other detail → null (a standard Expanded list whose
// add/edit/delete rides the child edit page). Extracted from buildCustomDetail so the new-logic doesn't pile onto
// mapDetails' cognitive complexity (Sonar S3776) and can carry its own golden.
function detectDetailAddMechanism(dinfo) {
  const am = dinfo?.addMode;
  if (!am?.editableGrid) return null;
  return {
    columns: am.editableColumns?.length ? am.editableColumns : null,
    enableVia: "crt.DataGrid features.editable.enable (+ itemsCreation to add rows inline) — resolve the exact property via get-component-info on the target version",
    addVia: am.lookup ? "add existing via lookup" : null,
  };
}

function mapDetails(ctx, containers, profileRegion) {
  const { index, profileAnchors, detailSchemas, resolveText, payloadDetails } = ctx;
  const { ensureTab } = containers;
  const needsDecision = [], details = [], standardFeatures = [], accountedFor = new Set();
  // #11 dedup: the SAME detail (schema+entity+FK) can be declared under more than one key or re-placed
  // across schemas → without dedup it is emitted TWICE (once resolved into a tab, once with tab:null).
  // Resolve each placement first, then collapse by signature, KEEPING the entry whose parent resolves to
  // a tab (the real placement) and dropping the phantom.
  const detailSig = (d) => [d.schemaName, d.entitySchemaName, d.detailColumn, d.masterColumn].join("|");
  // place the detail in its owning TAB (ancestry-resolved), preserving order. Own fn for Sonar CC 15.
  const resolvePlacement = (d) => {
    const own = d.parent ? resolveOwner(d.parent, index, profileAnchors) : { kind: "unresolved" };
    const profileTab = own.kind === "profile" ? profileRegion(own) : null;
    const tab = own.kind === "tab" ? own.tab : profileTab;
    return { own, tab };
  };
  const bySig = new Map();
  for (const d of payloadDetails) {
    accountedFor.add(d.key); if (d.schemaName) accountedFor.add(d.schemaName);
    const { own, tab } = resolvePlacement(d);
    const sig = detailSig(d);
    const cur = bySig.get(sig);
    if (!cur) bySig.set(sig, { d, tab, own });
    else if (cur.tab == null && tab != null) { cur.d = d; cur.tab = tab; cur.own = own; } // prefer a resolved placement
    else if (!cur.d.caption && d.caption) cur.d = { ...cur.d, caption: d.caption }; // else keep first, backfill caption on a COPY (don't mutate the shared input detail — mapToFreedom stays pure)
  }
  // A standard Creatio feature is recognised by the detail SCHEMA name, OR (when auto-named SchemaNDetail hides
  // it) by its file-storage ENTITY (*File → Attachments) / ContactCommunication. Own fn for Sonar CC 15.
  const matchDetailFeature = (d, dentity) => {
    let feat = matchFeature(d.schemaName), featByEntity = false;
    if (!feat && (dentity || "").endsWith("File")) { feat = FEATURE_CATALOG.FileDetailV2; featByEntity = true; }
    if (!feat && dentity === "ContactCommunication") { feat = FEATURE_CATALOG.ContactCommunicationDetail; featByEntity = true; }
    return { feat, featByEntity };
  };
  // A standard feature → its Freedom analog (A3), NOT a rebuilt detail. Records the feature + a decision.
  const emitStandardFeature = (d, dentity, tab, feat, featByEntity) => {
    standardFeatures.push({ feature: feat.feature, freedom: feat.freedom, classicDetail: d.schemaName, entity: dentity, tab, templateProvided: !!feat.templateProvided, inferredFromEntity: featByEntity, uiShape: feat.uiShape || "list", note: feat.note || null });
    const featWhat = featByEntity ? `detail over the entity '${dentity}' (classic schema '${d.schemaName}') is the` : `classic '${d.schemaName}' is the`;
    const featProvided = feat.templateProvided
      ? " — ALREADY provided by most Freedom form templates; account for it / merge onto the existing component, do NOT create a new one"
      : "; confirm the exact Freedom component + wiring";
    const featInferred = featByEntity ? ` — inferred from the entity name; confirm this is ${feat.feature} and not a business detail` : "";
    const featNote = feat.note ? ` — ${feat.note}` : "";
    needsDecision.push({ kind: "standard-feature", item: d.schemaName || dentity,
      reason: `${featWhat} ${feat.feature} feature → use ${feat.freedom} (A3 replacement, NOT a generic detail)${featProvided}${featInferred}${featNote}` });
  };
  // The decisions a genuine (non-feature) related list raises: unresolved name, unplaced tab, undeterminable
  // editability, its SEPARATE child edit-page migration, and an unresolved caption. Own fn for Sonar CC 15.
  const flagDetailIssues = (d, dinfo, dentity, tab, detailTitle) => {
    if (/^Schema\d+Detail$/.test(d.schemaName || "") && !dinfo) {
      const childEntityNote = dentity ? ` (child entity '${dentity}')` : "";
      needsDecision.push({ kind: "detail-unresolved", item: d.schemaName,
        reason: `detail schema '${d.schemaName}' is an auto-generated classic name${childEntityNote} — fetch its schema and pass it as manifest.detailSchemas (get-classic-page-sources gathers these automatically) to resolve the real columns and caption before building; do NOT ship a related list under a placeholder name` });
    }
    if (!tab) needsDecision.push({ kind: "detail-placement", item: d.schemaName || d.key,
      reason: `could not resolve which tab detail '${d.key}' belongs to (parent '${d.parent || "?"}' unresolved) — confirm target tab` });
    // editability lives in the detail's OWN config. When bundled (dinfo), the INLINE-EDITABLE-GRID case is read
    // from the grid config (buildCustomDetail → `editable`); any other bundled detail is a standard related list
    // whose add/edit/delete happens through the child EDIT PAGE (surfaced next as `detail-editpage`), so there is
    // nothing extra to decide. Only a detail whose schema was NOT bundled is genuinely undeterminable — flag THAT.
    if (!dinfo) needsDecision.push({ kind: "detail-editability", item: d.schemaName || d.key,
      reason: `allowed detail actions (view-only vs add/edit/delete) can't be read — the detail's own schema was not bundled. Pass it via manifest.detailSchemas["${d.schemaName || d.key}"] (get-classic-page-sources gathers these); an inline-editable grid then resolves from its grid config, otherwise it defaults to standard add/edit/delete via the child edit page. Or confirm view-only.` });
    needsDecision.push({ kind: "detail-editpage", item: dentity || d.schemaName || d.key,
      reason: `related list '${d.schemaName || d.key}' opens the '${dentity || "child entity"}' record form on add/edit — that Freedom edit page (and mini page, if the classic detail used one) is a SEPARATE migration: ensure a Freedom form for '${dentity || "the child entity"}' exists, or migrate it as a follow-on page` });
    if (!detailTitle && d.caption?.startsWith("Resources.Strings.")) needsDecision.push({ kind: "detail-caption", item: d.schemaName || d.key,
      reason: `detail title unresolved — caption is the resource key '${d.caption}'; pass the detail's title via manifest.detailSchemas["${d.schemaName}"].title (from its localizable strings) or manifest.resources, or confirm; do NOT invent one` });
  };
  // Build the emitted detail record (Expanded / inline-Editable list) — ENG-93929 editable-grid intent + columns.
  const buildCustomDetail = (d, dinfo, dentity, tab, detailTitle) => {
    const editable = detectDetailAddMechanism(dinfo);
    details.push({
      composite: editable ? "Editable list" : "Expanded list", entity: dentity, detailSchema: d.schemaName,
      caption: detailTitle, tab, order: d.order ?? null, dataSourceScope: "viewElement",
      columns: dinfo?.columns?.length ? dinfo.columns : null,
      editable,
      dependency: d.detailColumn ? { attributePath: d.detailColumn, relationPath: "PDS." + (d.masterColumn || "Id") } : null,
      actions: "unresolved",
      note: d.detailColumn ? null : "child FK (detailColumn) not in details block — resolve from detail schema",
    });
  };
  // Emit ONE deduped placement: a standard feature (A3 analog) or a rebuilt custom detail. Own fn for Sonar CC 15.
  const emitDetail = ({ d, tab, own }) => {
    // Ensure the OWNING tab is emitted as a container so a tab holding ONLY details is still built (+ caption).
    if (own?.kind === "tab") ensureTab(own.tab, own.tabTemplateOwned, needsDecision, accountedFor);
    const dinfo = detailSchemas[d.schemaName];       // #11(ii)/B2 — real child entity + list columns, when supplied
    const dentity = d.entitySchemaName || dinfo?.entity || null;
    const { feat, featByEntity } = matchDetailFeature(d, dentity);
    if (feat) { emitStandardFeature(d, dentity, tab, feat, featByEntity); return; }
    // detail TITLE: resolved page-caption resource → the detail's own title → a plain caption → null.
    const resolvedDcap = d.caption ? resolveText(d.caption) : null;
    const plainDcap = d.caption && !d.caption.startsWith("Resources.Strings.") ? d.caption : null;
    const detailTitle = resolvedDcap ?? dinfo?.title ?? plainDcap ?? null;
    flagDetailIssues(d, dinfo, dentity, tab, detailTitle);
    buildCustomDetail(d, dinfo, dentity, tab, detailTitle);
  };
  for (const entry of bySig.values()) emitDetail(entry);
  return { details, standardFeatures, needsDecision, accountedFor };
}

// Moment 5: card actions / ACTIONS menu → Freedom card actions (B7). Returns needsDecision[] / accountedFor[].
function mapCardActions(eff) {
  const needsDecision = [], accountedFor = [];
  // static toolbar buttons + custom actions surfaced from getActions bodies (navigate*/goTo*), so a real
  // action like navigateToTaxesByCountriesLookup isn't silently lost (its body is imperative → review).
  const cardActions = [...(eff.items || []).filter(i => KNOWN_ACTION_ITEMS.has(i.name)).map(i => i.name), ...(eff.cardActionHints || [])];
  for (const i of (eff.items || [])) if (KNOWN_ACTION_ITEMS.has(i.name)) accountedFor.push(i.name);
  // #8c — the page launches a business process imperatively (a "Run process" action). Surface it as a
  // Freedom "Run process" card action + a decision naming the process(es) so it isn't lost.
  if (eff.processLaunch) {
    if (!cardActions.includes("RunProcess")) cardActions.push("RunProcess");
    const processNote = eff.processNames?.length ? ` (${eff.processNames.join(", ")})` : "";
    needsDecision.push({ kind: "process-launch", item: eff.processNames?.length ? eff.processNames.join(", ") : "RunProcess",
      reason: `the classic page launches a business process imperatively${processNote} — READ ITS BINDING first: ProcessInModules by the section's SysModule/Id tells which module(s) it is bound to — the LIST/registry module, the record CARD/form module, or BOTH. Place it as a MENU ITEM in the template's existing Actions button on EACH surface it is bound to (do NOT assume list-only or form-only; never a standalone button): LIST → the list Actions button (ActionButton in ListPageV3), processRunType ForTheSelectedRecords + dataSourceName PDS; FORM → the form page's OWN Actions button in the header action area (the template's ActionButtonsContainer), placed at the END of that container next to the CloseButton (last position), run for the CURRENT record ($Id). Label the item with the process DISPLAY Caption (VwSysProcess), never its technical code. Launch via crt.RunBusinessProcessRequest, passing the record Id into the record param from the process signature. None connected on a surface ⇒ nothing there; none anywhere ⇒ drop the button` });
  }
  const hasGetActions = (eff.methods || []).some(m => m.name === "getActions" && !m.fromTemplate);
  if (cardActions.length || hasGetActions) needsDecision.push({ kind: "card-action", item: "ACTIONS",
    reason: `card actions / ACTIONS-menu → Freedom card actions (B7): ${cardActions.join(", ") || "getActions"}. ` +
      `Custom getActions items${(eff.cardActionHints || []).length ? " incl. " + eff.cardActionHints.join(", ") : ""} are built imperatively — review the getActions body to wire them.` });
  return { cardActions, needsDecision, accountedFor };
}

// ---- Imperative MEMBERS: attributes / messages / mixins / module deps -----------------------------------
// These blocks reach the effective page now (see engine.mjs `mergeNamedFacts`). Each carries behaviour with a
// documented Freedom target, and each previously produced NOTHING — no ChangeSet entry, no decision, no count.
// A `lookupListConfig.filters` filter and a declarative FILTRATION rule are the same user-visible behaviour
// ("this lookup is filtered") reached two ways; only the declarative one was ever mapped, so the imperative one
// could not even be compared against it.
//
// Only CLIENT-authored members produce decisions (`fromTemplate` = inherited base-template context). The full
// set — context included — still reaches the member ledger, so nothing is dropped for being inherited.

// Modules that carry no page behaviour of their own: the framework root and pure styling. Everything else is a
// real dependency (constants modules hold the lookup GUIDs a rule compares against, utility modules hold logic)
// and is surfaced. Kept deliberately SHORT — a module wrongly called inert is a silently dropped member.
const INERT_MODULE_RX = /^(?:terrasoft|ext-base|Ext|sandbox|css!)/;
// A module's bare name. The `mixins` map holds the NAMESPACED id (`Terrasoft.X`, `Usr.X`) while `define()` lists the
// bare one, so the two must be compared on the last segment — matching a fixed `Terrasoft.` prefix would miss every
// mixin from a custom package.
const bareModule = (n) => String(n ?? "").split(".").pop();

// Classic binds a field explicitly (`bindTo`) OR by NAME — an insert named for an entity column IS a field on it.
// Both forms must be promoted: a name-bound insert left alone is neither field nor structure, so it falls out as an
// `unmapped-component` "port manually or confirm drop" and its column never reaches the Layout table at all.
// GUARDS — a matching name alone is not enough: an item named for a column can still be a container carrying its
// own sub-items, and promoting it would drop those children. Skip structure, captioned/generator items, and
// anything that PARENTS another item. Stamp `bindTo` on the ITEM too, else `mapUnmappedDrop` still reports it and the
// container holding these fields still reads as an unmapped block. Client-authored only — template-owned base
// fields are context (F9).
function promoteNameBoundFields(eff, cols) {
  const items = eff.items || [];
  if (!items.length || !cols || !Object.keys(cols).length) return eff;
  const parents = new Set(items.map((i) => i.parent).filter(Boolean));
  const STRUCTURAL = new Set([VIEW_ITEM_TYPE.CONTROL_GROUP, VIEW_ITEM_TYPE.DETAIL, VIEW_ITEM_TYPE.GRID_LAYOUT]);
  const promoted = items.filter((i) =>
    !i.templateOwned && !i.bindTo && Object.hasOwn(cols, i.name)
    && !isImageItem(i)
    && !i.isTab && !i.caption && !i.generator
    && !STRUCTURAL.has(i.itemType) && !parents.has(i.name));
  if (!promoted.length) return eff;
  const names = new Set(promoted.map((i) => i.name));
  return { ...eff,
    items: items.map((i) => (names.has(i.name) ? { ...i, bindTo: i.name } : i)),
    // Keep this projection aligned with engine.mjs effective field rows; promoted fields are synthetic entries for
    // name-bound diff items that did not pass through that engine projection.
    fields: [...eff.fields, ...promoted.map((i) => ({ name: i.name, bindTo: i.name, parent: i.parent,
      contentType: i.contentType, order: i.order ?? null, layout: i.layout || null, tip: i.tip || null,
      hint: i.hint || null, visible: i.visible ?? null, provenance: i.provenance,
      templateOwned: !!i.templateOwned, schemaTouched: !!i.schemaTouched }))] };
}

// (a) an imperatively filtered lookup — the imperative twin of a FILTRATION business rule
function lookupFilterDecision(a) {
  const keys = a.lookupFilterKeys.length ? ", keys: " + a.lookupFilterKeys.join(", ") : "";
  const on = a.referenceSchema ? " on " + a.referenceSchema : "";
  return { kind: "attribute-lookup-filter", item: a.name,
    detail: `${a.lookupFilters} filter(s)${keys}${on}`,
    reason: `attribute '${a.name}' filters its lookup IMPERATIVELY via lookupListConfig.filters (${a.lookupFilters} filter(s)${keys})${on} — this is NOT a declarative businessRules FILTRATION and does NOT come across as one. Rebuild it as a Freedom lookup filter handler (or an entity business rule when the filter is static); resolve any lookup-record GUID in the filter to its display name on-stand first` };
}

// (b) `dependencies` — the classic "these columns changed → call this method" wiring. This IS the trigger.
function dependencyDecision(a, d) {
  const cols = d.columns.join(", ");
  const handled = d.methodName ? ` handled by '${d.methodName}'` : "";
  return { kind: "attribute-dependency", item: `${a.name} ← ${cols || "?"}`,
    reason: `attribute '${a.name}' declares a dependency on column(s) ${cols || "(unnamed)"}${handled} — in Freedom this is an on-change request handler (or a converter when the value is purely derived). The TRIGGER is this dependency, not the method's name` };
}

// (d) a VIRTUAL attribute — on the view model with NO entity column behind it and none of the imperative shapes
// above. It is the page's own UI STATE (an editability/mode flag, a collection backing a menu), read by bindings
// and rule conditions. The field pipeline never emits it because there is no column to bind, so without this it
// was the single largest silent drop after the methods themselves.
function virtualAttributeDecision(a) {
  const dvt = a.dataValueType == null ? "" : ` (dataValueType ${a.dataValueType})`;
  const def = a.value == null ? "" : `, default ${JSON.stringify(a.value)}`;
  const coll = a.isCollection ? ", a COLLECTION" : "";
  return { kind: "attribute-virtual", item: a.name,
    // `detail` = what differs BETWEEN rows of this kind. The ⚠ Imperative members table prints it per row and states
    // the shared explanation once, so the same paragraph is not repeated on every row of the kind.
    detail: [dvt.trim(), def.replace(/^, /, ""), coll.replace(/^, /, "")].filter(Boolean).join(" · ") || null,
    reason: `virtual view-model attribute '${a.name}'${dvt}${def}${coll} — declared on the classic view model with NO entity column behind it, so no field insert carries it. It is page UI state (an editability/mode flag, a collection backing a menu or list): create it as a Freedom view-model attribute (with its default) and re-wire whatever read it — a binding, a business rule condition, or a handler. Confirm what reads it before deciding it is unused` };
}

function messageDecision(m) {
  const dir = m.direction == null ? "direction unresolved" : String(m.direction);
  const mode = m.mode == null ? "" : ", " + m.mode;
  return { kind: "message", item: m.name, detail: `${dir}${mode}`,
    reason: `sandbox message '${m.name}' (${dir}${mode}) — cross-surface wiring whose counterpart lives in ANOTHER schema (a detail, a module, a section), OUTSIDE this page's migration unit. Find the counterpart before building: in Freedom this becomes a handler-mediated request, a shared service, or an explicit event replacement — never a silent drop. A subscribe with no publisher found is an unresolved thread, not "no behaviour"` };
}

// every decision one attribute contributes — each shape is independent, so an attribute can raise several
function attributeDecisions(a, hasColumn) {
  const out = [];
  if (a.lookupFilters > 0) out.push(lookupFilterDecision(a));
  for (const d of a.dependencies) out.push(dependencyDecision(a, d));
  // (c) a function-valued sub-key (a computed default, a dynamic caption) is imperative logic on the attribute
  if (a.fnKeys.length) out.push({ kind: "attribute-imperative", item: a.name,
    detail: `function key(s): ${a.fnKeys.join(", ")}`,
    reason: `attribute '${a.name}' defines ${a.fnKeys.join(", ")} as a FUNCTION — a computed value/state the engine reads as present but cannot evaluate; implement it as a Freedom converter, virtual attribute or handler and confirm the computed result` });
  if (!a.lookupFilters && !a.dependencies.length && !a.fnKeys.length && !hasColumn(a.name))
    out.push(virtualAttributeDecision(a));
  return out;
}

// ---- the per-method decision text, assembled from the body evidence ----
// A trivial passthrough and an externally-assigned method each get a decision that SAYS SO, rather than asking
// for a port that has nothing to port here. Suppressing either would re-create the silent drop this removes.
const triggerPhrase = (t) =>
  t.kind === "attribute-dependency" ? `${t.attribute} changes (${t.columns.join(", ")})` : `${t.element}.${t.property}`;

// the evidence clauses appended to a real method's reason: what it does, what it reads/writes, what it publishes
function evidenceClauses(ev) {
  if (!ev) return "";
  const parts = [];
  if (ev.kinds.length) parts.push(`; body does: ${ev.kinds.join(", ")}`);
  if (ev.readsAttrs.length || ev.writesAttrs.length)
    parts.push(`; reads ${ev.readsAttrs.join(", ") || "—"} → writes ${ev.writesAttrs.join(", ") || "—"}`);
  if (ev.publishes.length || ev.subscribes.length) {
    const traffic = [...ev.publishes.map((p) => "publish " + p), ...ev.subscribes.map((s) => "subscribe " + s)];
    parts.push(`; messages: ${traffic.join(", ")}`);
  }
  return parts.join("");
}

function methodReason(stub) {
  const where = stub.lines ? ` (L${stub.lines.start}-${stub.lines.end})` : "";
  const trig = stub.triggers.length ? stub.triggers.map(triggerPhrase).join(" / ") : null;
  if (stub.externalRef) {
    const alsoTrig = trig ? `; triggered by ${trig}` : "";
    return `method '${stub.sourceMethod}' is ASSIGNED FROM '${stub.externalRef}' — its body is not in this schema, so the behaviour to port lives in that module (a define() dependency). Read it there${alsoTrig}, then implement the Freedom equivalent. Do NOT report it as "no logic" just because this body has none`;
  }
  if (stub.trivial)
    return `method '${stub.sourceMethod}'${where} is a passthrough override (calls the base implementation only) — no behaviour of its own to port; confirm the Freedom template provides the base behaviour, then mark it accounted-for`;
  const trigClause = trig
    ? `, triggered by ${trig}`
    : ", trigger unresolved — trace the control/hook/message that calls it, do not infer it from the name";
  return `imperative logic${where}${trigClause}${evidenceClauses(stub.evidence)} — implement as a Freedom handler, converter or virtual attribute (a declarative business rule only when it is genuinely declarative)`;
}

function mapImperativeMembers(eff, cols) {
  const needsDecision = [];
  const client = (xs) => (xs || []).filter((x) => !x.fromTemplate);
  const hasColumn = (n) => !!(cols && Object.hasOwn(cols, n));
  const moduleDeps = client(eff.moduleDeps).map((d) => d.name);
  const mixinCovers = (m) => {
    const module = m.module || m.name;
    const exact = moduleDeps.filter((d) => d === module);
    if (exact.length) return exact;
    const sameBare = moduleDeps.filter((d) => bareModule(d) === bareModule(module));
    return sameBare.length === 1 ? sameBare : [];
  };

  for (const a of client(eff.attributes)) needsDecision.push(...attributeDecisions(a, hasColumn));
  for (const m of client(eff.messages)) needsDecision.push(messageDecision(m));
  // `covers` — the other member ids this one decision accounts for. A mixin is declared twice (in `mixins` and as a
  // `define()` dependency) and the ledger tracks both; the aggregate below no longer lists mixin modules, so without
  // this the dep member has no route to `decision` and the coverage gate blocks. Bare-name fallback is allowed only
  // when it resolves to a single actual define() dep; otherwise two modules with the same last segment must stay loud.
  for (const m of client(eff.mixins)) needsDecision.push({ kind: "mixin", item: m.name, detail: m.module || null,
    covers: mixinCovers(m),
    reason: `the page mixes in '${m.module || m.name}' — its members are defined in ANOTHER schema, so none of its behaviour appears in this page body. Read the mixin and port what it contributes to THIS page (an entity-parameterized mixin can also carry actions and messages); confirm whether the Freedom template already provides an equivalent` });

  // module deps: ONE aggregated decision (the per-module rows live in the member ledger, which is where
  // completeness is proven) — a decision per dep would bury the worklist in framework noise.
  // A module that already has a row of its own (a mixin, a referenced UI module) is excluded: the aggregate carries
  // what nothing else does, and listing it here as well states the same member twice.
  const ownRow = new Set([...client(eff.mixins).flatMap(mixinCovers), ...(eff.referencedModules || [])]);
  const deps = moduleDeps.filter((n) => !INERT_MODULE_RX.test(n) && !ownRow.has(n));
  if (deps.length) needsDecision.push({ kind: "module-dep", item: deps.join(", "),
    reason: `the page declares ${deps.length} further define() dependenc(ies) with no row of their own — constants/enum modules hold the lookup GUIDs its rules compare against, and utility modules hold logic it calls. Confirm what each contributes to the page and where it goes in Freedom; a dependency whose contribution you cannot name is an unresolved thread` });

  return { needsDecision };
}

// feature toggles, catalog-miss charts, methods → handler stubs, client removals, referenced UI modules.
// STANDARD Creatio-classic page methods — framework lifecycle / validation-scaffolding / dialog callbacks that
// carry no business logic to port. They are NOT surfaced in the Logic table nor as `method` decisions (they were
// pure noise: every migration listed init/onSaved/setValidationConfig… as "imperative → review"). Only CUSTOM
// business methods (validators, on<Field>Changed, get<X>Filter, domain helpers) remain. Applies uniformly to the
// form, mini, typed and detail/child pages (they all fold through mapRemainingLogic). Extend ONLY with GENERIC
// framework/scaffolding names — NEVER a domain/data method (e.g. a get<Entity>Collection): a domain name carries
// portable logic, so suppressing it silently drops a real client override. (The broader question — how to treat a
// client override of ANY boxed base method faithfully — is out of this tool's scope and tracked as its own task.)
// Framework/scaffolding method names that carry no page-specific business behaviour. Excluded from the Logic table,
// the ⚠ Imperative logic worklist and the `method` decisions — and EXPORTED because the member ledger must still
// count them: it resolves a name in this set to `context` (excluded by design, counted), never `unaccounted`.
// A STANDARD NAME IS NOT A STANDARD METHOD. `init`, `onSaved`, `onEntityInitialized`, `onSaveButtonClick` and the
// rest are scaffolding when a schema merely re-declares them — and are DOMAIN LOGIC when a customer overrode one
// and put save/load behaviour inside it. Filtering on the name alone dropped that second case from the imperative
// worklist AND classified it as `context` in the coverage ledger, so a plan could pass coverage with a customer's
// inline save behaviour silently absent: the exact failure the ledger exists to make impossible.
//
// The BODY decides, from facts the parse already produced — a pure `callParent(arguments)` passthrough or an empty
// body declares no behaviour of its own. NO FACTS ⇒ NOT scaffolding: a method whose body could not be parsed has
// not been shown to be trivial, and a visible row someone must look at is the recoverable error. These are PAYLOAD
// methods (a schema layer authored them), so this is not the base chain's hundreds of framework methods —
// `fromTemplate` still keeps those out.
export const isScaffoldingMethod = (m) => {
  if (!m || !STANDARD_CLASSIC_METHODS.has(m.name)) return false;
  const f = m.facts;
  return !!f && !!(f.callParentOnly || f.isEmpty);
};
export const STANDARD_CLASSIC_METHODS = new Set([
  "init", "onSaved", "onEntityInitialized", "setValidationConfig", "createValidator", "asyncValidate",
  "getDefaultValues", "onGetSelectResult", "getSelectedButton", "onAnswerYes", "onAnswerNo",
  "subscribeSandboxEvents", "initializeReferenceParametersValues", "getServiceRequest", "onSaveButtonClick",
]);

// ---------------------------------------------------------------------------
// The INVERSE call graph. `triggers[]` is read off DECLARATIONS — an attribute
// dependency, a bound control property — so a method invoked from another
// method's BODY had no trigger at all and its row printed `⚠ unresolved`. That
// reads as "nobody knows what runs this" when the answer is one hop away and the
// parser already recorded it: `facts.calls` holds every callee path the body
// calls. Inverting that map costs one pass and turns an orphan row into a child
// of the row that calls it — which is also how it should be PORTED (a helper
// moves with its caller, not as a handler of its own).
// ---------------------------------------------------------------------------

// `this.foo` / `this.foo.bind` / `this.foo.call` → "foo". Only `this.`-rooted
// paths: `esq.addColumn` or `Terrasoft.each` are framework calls, not siblings.
function internalCallTarget(path) {
  const m = /^this\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(path);
  return m ? m[1] : null;
}

// callee name → the methods whose bodies call it. Built from ALL payload methods,
// STANDARD ones included: a helper is very often invoked from `init` /
// `onEntityInitialized`, and those are filtered out of the worklist — indexing
// only custom methods would leave such a row `⚠ unresolved` while its caller sat
// one hop away, which is the exact failure this inversion exists to fix.
function buildCallerIndex(methods) {
  const idx = new Map();
  for (const m of methods) {
    for (const c of m.facts?.calls || []) {
      const target = internalCallTarget(c);
      if (!target || target === m.name) continue; // self-recursion says nothing about what starts it
      if (!idx.has(target)) idx.set(target, new Set());
      idx.get(target).add(m.name);
    }
  }
  return idx;
}

// Walk callers upward until something ANSWERS what starts the chain: a caller
// with a declared trigger (then the row's real trigger is that declaration,
// reached `via` the chain) or a standard lifecycle method (then the platform
// calls it, which is itself the answer). Neither found → the honest partial
// answer, "called from X", which still beats `⚠ unresolved`.
//
// `seen` breaks cycles (mutual recursion is common in classic helpers) and the
// caller sets are sorted so the result never depends on iteration order.
function resolveInternalTrigger(name, callerIdx, byName, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const callers = [...(callerIdx.get(name) || [])].sort();
  // EVERY caller travels with the answer, not just the one that resolved. A helper called from two places is ported
  // differently from one called from a single site, and dropping the rest would hide that from the reader.
  const all = callers.length > 1 ? { callers } : {};
  let partial = null;
  for (const caller of callers) {
    const m = byName.get(caller);
    const declared = m?.triggers || [];
    if (declared.length) return { kind: "internal", from: caller, root: caller, rootTrigger: declared[0], ...all };
    if (STANDARD_CLASSIC_METHODS.has(caller)) return { kind: "internal", from: caller, lifecycle: caller, ...all };
    partial ||= { kind: "internal", from: caller, ...all };
    const up = resolveInternalTrigger(caller, callerIdx, byName, seen);
    if (up) {
      // `from` is the IMMEDIATE caller and `via` the hops between it and the root — so `via` must never repeat
      // `from` (it rendered as "from onContractInserted via onContractInserted") nor end on the root, which the
      // trigger already names. Build the chain from this caller upward, drop duplicates, then peel off the head.
      const chain = [caller, ...(up.from && up.from !== caller ? [up.from] : []), ...(up.via || [])]
        .filter((v, i, a) => v && a.indexOf(v) === i && v !== up.root);
      return { ...up, from: caller, via: chain.slice(1), ...all };
    }
  }
  return partial;
}

// Returns handlerStubs[] + its own needsDecision[].
function mapRemainingLogic(eff, payloadMethods, payloadComponents) {
  const needsDecision = [];
  // feature toggles gate WHICH elements render — the ChangeSet is the full static UNION of blocks/fields;
  // the rendered page shows one feature-state (e.g. old ProductCategoryBlock vs new one). Flag for review;
  // which feature gates which element lives in method bodies (imperative → judgment).
  if ((eff.features || []).length) needsDecision.push({ kind: "feature-toggle", item: eff.features.join(", "),
    reason: `page uses feature toggles (${eff.features.join(", ")}) that gate element visibility — mapping is the full union of blocks/fields; the live page renders one feature-state. Review which feature-gated blocks/fields to migrate (gating is in method bodies).` });

  // charts/widgets not in the catalog -> B9/B10 (generic). An embedded PROFILE CARD is excluded: mapProfileCards
  // already mapped it to a concrete component, so repeating it here as "propose the closest component" would both
  // duplicate the worklist and read as if the target were still unknown.
  for (const c of payloadComponents)
    if (!(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName]) && !isProfileCardModule(c)) needsDecision.push({ kind: "component", item: c.key,
      // name the embedded schema when the config carries one (`config.schemaName`) — a real classic body rarely
      // sets `moduleName`, so the old text degraded to a useless "module '?'".
      reason: `module '${c.moduleName || c.schemaName || "?"}' (chart/widget) — propose closest standard Freedom component, confirm with user` });

  // methods -> handler stubs. Each stub carries the BODY EVIDENCE the engine read (which framework calls it makes,
  // which attributes it reads/writes, which messages it moves, its line span) and its RESOLVED trigger, so the plan
  // states what a method does instead of labelling every one of them "review". `category` is derived from that same
  // evidence and never from the method's name.
  // STANDARD framework/scaffolding methods are excluded first: only CUSTOM business methods reach
  // the ⚠ Imperative logic worklist and the `method` decisions, so the plan stops listing init/onSaved/validator
  // config as "imperative → review" on every page. They remain MEMBERS — the coverage ledger counts them as
  // `context` via `STANDARD_CLASSIC_METHODS` (same treatment as an inert module dep), never as a silent drop.
  const customMethods = payloadMethods.filter(m => !isScaffoldingMethod(m));
  // The NAMES this filter removed, published rather than only counted. A behaviour-analysis run (SKILL.md step
  // 5.1) enumerates every member of the surface, so its method count is legitimately HIGHER than the stub count;
  // without the excluded names the difference reads as a contradiction and gets reconciled by hand. It is a
  // deterministic filter — publishing the names makes the reconciliation a set difference instead of a diff.
  const standardMethodsFiltered = payloadMethods.filter(m => isScaffoldingMethod(m)).map(m => m.name);
  const handlerStubs = customMethods.map(m => {
    const f = m.facts || null;
    return {
      sourceMethod: m.name,
      category: categorize(f),
      // a pure `callParent(arguments)` passthrough / an empty body declares no behaviour of its own: it is a
      // member (it stays in the ledger) but it is NOT work to port, and listing it as such buries the real logic.
      trivial: !!(f && (f.callParentOnly || f.isEmpty)),
      lines: f?.lines || null,
      // the method is assigned from another module (`x: VisaHelper.Method`) — its behaviour is defined outside
      // this page body, so the port target is that module, not a body the reader can look up in this schema
      externalRef: f?.externalRef || null,
      // `calls` is capped for payload size; `callsTotal` is what the body actually made, so a renderer can say how
      // much the cap hid instead of presenting the retained slice as the whole list.
      evidence: f ? { kinds: f.kinds, calls: f.calls.slice(0, 12), callsTotal: f.calls.length, readsAttrs: f.readsAttrs, writesAttrs: f.writesAttrs,
        publishes: f.publishes, subscribes: f.subscribes, readsResources: f.readsResources, truncated: f.truncated } : null,
      triggers: m.triggers || [],
      draft: true,
    };
  });
  // Fill the trigger of every row the DECLARATION pass left empty, from the inverse call graph. Declared triggers
  // are untouched: a declaration is what the platform actually binds, an internal call is one step below it.
  const callerIdx = buildCallerIndex(payloadMethods);
  const byName = new Map(payloadMethods.map((m) => [m.name, m]));
  for (const stub of handlerStubs) {
    if (stub.triggers.length) continue;
    const t = resolveInternalTrigger(stub.sourceMethod, callerIdx, byName);
    if (t) stub.triggers = [t];
  }
  for (const stub of handlerStubs) needsDecision.push({ kind: "method", item: stub.sourceMethod, reason: methodReason(stub) });

  // removals (B6) — NOT surfaced as decisions. A removed element is simply OUT of the final effective scope: a
  // parallel fresh Freedom rebuild builds the ALIVE set (which already excludes removed items), so "the client
  // removed X" needs no action — you just don't build X. Flagging removals only added noise (a re-laid-out base
  // element read as a "deletion to confirm"). The final scope is the answer; removals are not a worklist item.
  // (`eff.removed` is still available for diagnostics; it just no longer generates ⚠ decisions.)

  // Fix 3: referenced UI modules (define() deps that render UI OUTSIDE this page's diff)
  // e.g. CasesEstimateLabel → the SLA response/solution timer + its START/END buttons. The migration
  // unit is the page schema, so these modules' rendered controls are invisible to schema analysis and are
  // NOT in this ChangeSet. Surface them for a manual Freedom port instead of under-reporting the surface.
  for (const rm of (eff.referencedModules || []))
    needsDecision.push({ kind: "referenced-module", item: rm,
      reason: `page composes UI from referenced module '${rm}' (declared in define() deps + own CSS) — its rendered controls (buttons/labels/timers) are OUTSIDE the page-schema migration unit and are NOT in this ChangeSet; port it manually to Freedom or confirm the target template provides it` });
  return { handlerStubs, standardMethodsFiltered, needsDecision };
}

// Fix 2: LOUD unmapped-component drop — any alive CLIENT-authored item the mapper produced nothing for is
// surfaced (one decision per dropped subtree root), instead of silently vanishing. Reads the final accountedFor.
function mapUnmappedDrop(eff, accountedFor) {
  const needsDecision = [];
  // Candidate = alive, CLIENT-authored (non-template) item the mapper produced NOTHING for. Skip STRUCTURAL
  // containers the mapper builds on demand: a tab (isTab), a CONTROL_GROUP (itemType 15) or detail
  // (itemType 2). itemType isn't always resolvable, so back it with the naming convention — but a name
  // suffix ALONE must never silently suppress content (a childless block misnamed `SlaGroup` is real UI):
  //  • HARD_SCAFFOLD (grids / the root tab panel) is pure layout the mapper rebuilds — always skip.
  //  • SOFT_STRUCT (…Group/Tab/ControlGroup/TabContainer) is skipped ONLY when it is a real parent (has a
  //    child routed through it); a childless one IS surfaced, so nothing vanishes on name convention alone.
  const HARD_SCAFFOLD_RX = /(?:_gridLayout|Grid)$|^Tabs$/;
  const SOFT_STRUCT_RX = /(?:Tabs|Tab|TabContainer|ControlGroup|Group)$/;
  // A classic primary-display label (caption `getPrimaryDisplayColumnValue`) shows the record's primary display
  // value as a header title — the Freedom form/mini page provides this NATIVELY (its page title is bound to the
  // entity's primary display column). So it maps to the native page title: nothing to build, and NOT an unmapped
  // micro-widget. Treat it (and therefore its container, e.g. HeaderColumnContainer) as accounted-for — silently,
  // with no ⚠ message.
  const isPrimaryDisplay = (i) => /getPrimaryDisplayColumnValue/i.test(i.caption || "");
  const byName = new Map((eff.items || []).map(i => [i.name, i]));
  const parents = new Set((eff.items || []).map(i => i.parent).filter(Boolean));
  // A CONTAINER whose subtree DID produce Freedom elements is a real layout container (a profile island, a
  // photo wrapper, a header column block), NOT an unmapped micro-widget — even when its NAME misses the
  // SOFT_STRUCT_RX whitelist (PhotoContainer / EmployeeProfile / HeaderColumnContainer). Flagging those was a
  // false "port manually or drop" for a block whose fields/image were already migrated. Mark every ancestor of
  // an accounted-for item as "has a mapped descendant" and never surface it. The genuine SLA-timer case — a
  // container whose ENTIRE subtree mapped to nothing — has no accounted descendant, so it still surfaces.
  // Mark every ancestor of a mapped item as "has a mapped descendant" (own fn for Sonar CC 15) — a container
  // whose subtree produced Freedom elements is a real layout container, never an unmapped micro-widget.
  const markMappedAncestors = () => {
    const marked = new Set();
    for (const i of (eff.items || [])) {
      const mapped = accountedFor.has(i.name) || !!i.bindTo
        || i.itemType === VIEW_ITEM_TYPE.DETAIL || i.itemType === VIEW_ITEM_TYPE.CONTROL_GROUP
        || isPrimaryDisplay(i); // primary-display title → native page title (accounts for its container too)
      if (!mapped) continue;
      for (let p = i.parent, guard = 0; p && !marked.has(p) && guard < 64; guard++) {
        marked.add(p);
        p = byName.get(p)?.parent;
      }
    }
    return marked;
  };
  const hasMappedDesc = markMappedAncestors();
  // The mirror of `hasMappedDesc`. A LEAF CONTROL renders its own internals — an image's tip, a control's parts —
  // so an item inside one is already built and must not be flagged for a manual port. Test the ancestor for being a
  // bound field or an image, NOT for `accountedFor`: regions and anchors are accounted for too, and keying on that
  // suppresses every item on the page. A container is only a layout box, so its children stay in the sweep.
  const insideMappedControl = (i) => {
    for (let p = i.parent, guard = 0; p && guard < 64; guard++) {
      const a = byName.get(p);
      if (a && (a.bindTo || isImageItem(a))) return true;
      p = a?.parent;
    }
    return false;
  };
  // One alive item's verdict: `skip` (already resolved elsewhere), `structural` (accounted for, just not here) or
  // `dropped` (the mapper produced nothing for it). Its own fn so the guard chain sits at nesting level 0 — inside
  // the collect loop each guard also carried the loop's nesting weight, which is what pushed that function over the
  // Sonar cognitive-complexity budget (S3776).
  //
  // `structural` matters as much as `dropped`: it is what this deliberately skips because the elements ARE
  // accounted for, just not by THIS function — a tab / control group / detail (the container + detail builders emit
  // those), pure scaffolding the mapper rebuilds, the primary-display title (native Freedom page title), and a real
  // layout container whose subtree produced Freedom elements. Without that set the member ledger reads every one of
  // them as a silent drop and flags MAPPED elements as gaps — a gate that cries wolf teaches the reader to ignore
  // it. `templateOwned` / `bindTo` return `skip` on purpose: the ledger already resolves those to `context`
  // (inherited) and to the bound column's own `mapped` row.
  const dropVerdict = (i) => {
    if (i.templateOwned || i.bindTo) return "skip";
    if (i.itemType === VIEW_ITEM_TYPE.DETAIL || i.itemType === VIEW_ITEM_TYPE.CONTROL_GROUP || i.isTab) return "structural";
    if (accountedFor.has(i.name)) return "skip";
    if (insideMappedControl(i)) return "structural";      // part of a control the mapper already built
    if (HARD_SCAFFOLD_RX.test(i.name)) return "structural";
    if (isPrimaryDisplay(i)) return "structural";         // record title → native Freedom page title; nothing to port, no ⚠
    if (hasMappedDesc.has(i.name)) return "structural";   // real layout container — its subtree produced Freedom elements
    if (SOFT_STRUCT_RX.test(i.name) && parents.has(i.name)) return "structural"; // structural container (has children)
    return "dropped";
  };
  // Sort every alive item into the two sets by its verdict; the classification itself lives in `dropVerdict`.
  const collectDropped = () => {
    const dropped = new Set();
    const structural = new Set();
    for (const i of (eff.items || [])) {
      const verdict = dropVerdict(i);
      if (verdict === "structural") structural.add(i.name);
      else if (verdict === "dropped") dropped.add(i.name);
    }
    return { dropped, structural };
  };
  const { dropped, structural } = collectDropped();
  // Flag only the ROOT of each dropped subtree (whose parent is not itself dropped) → ONE decision per
  // block, not one per leaf: the SLA timer surfaces as a single "port this block" item, not six.
  for (const i of (eff.items || [])) {
    if (!dropped.has(i.name) || (i.parent && dropped.has(i.parent))) continue;
    const isBtn = i.name.endsWith("Button");
    const captionNote = i.caption ? ` (caption ${i.caption})` : "";
    const generatorNote = i.generator ? ` (generator ${i.generator})` : "";
    // Only CUSTOM (non-template) items reach here now — template-owned buttons are skipped above.
    const reason = isBtn
      ? `custom button '${i.name}' has no Freedom mapping — wire it as a Freedom card action (its click handler is imperative; review the getActions/onClick body)`
      : `classic component '${i.name}'${captionNote}${generatorNote} (and its sub-items) produced no Freedom element — non-standard UI (a LABEL/CONTAINER micro-widget block, e.g. an SLA timer) outside the standard record-page vocabulary; port manually to a Freedom custom component or confirm drop`;
    needsDecision.push({ kind: "unmapped-component", item: i.name, reason });
  }
  return { needsDecision, structural: [...structural] };
}

// Map ONE classic rule into its Freedom page/entity business rule, or a needsDecision when it can't be mapped.
// Mutates the three sinks — keeps the ruleType dispatch (and its nesting) out of mapRules's loop.
function mapOneRule(r, pageBusinessRules, entityBusinessRules, needsDecision) {
  if (r.ruleType === "FILTRATION") {
    const filter = r.filterColumn
      ? { columnPath: r.filterColumn, comparisonType: r.comparison ?? null, value: r.value ?? null, dataValueType: r.dataValueType ?? null }
      : null;
    // Gap 4: a "static" filter needs a comparison AND a constant value. Many FILTRATIONs are dynamic
    // (filter by another column / macro) → no constant here; don't present a half-filter as complete.
    const complete = !!(filter && typeof r.comparison === "number" && r.value !== null && r.value !== undefined);
    entityBusinessRules.push({ action: "apply-static-filter", targetAttribute: r.attr, filter, complete,
      conditions: r.conditions, note: "entity-level; filter rooted on target lookup's reference schema; resolve lookup constants via odata-read",
      provenance: r.provenance });
    // incomplete FILTRATIONs are FOLDED into one concrete worklist line in mapRules (naming each lookup + its
    // filter column) — a per-rule vague "resolve the value" punt read as N separate assumptions.
  } else if (r.ruleType === "BINDPARAMETER") {
    const acts = PROP_ACTION[r.property];
    if (!acts) { needsDecision.push({ kind: "rule", item: r.attr, reason: `BINDPARAMETER property '${r.property}' unmapped` }); return; }
    pageBusinessRules.push({ action: acts[0], element: r.attr, inverseAction: acts[1],
      conditions: r.conditions,
      note: "page-level; ALSO create the inverse rule (opposite condition -> inverseAction)",
      provenance: r.provenance });
  } else {
    // symbolic/unknown ruleType — the enum did not resolve to a number; do NOT guess (would corrupt logic).
    needsDecision.push({ kind: "rule", item: r.attr,
      reason: `rule '${r.attr}' ruleType is '${r.ruleType}' (enum unresolved) — resolve and re-map, do not assume` });
  }
}

// rules → page/entity business rules (declarative). Returns its own needsDecision[].
function mapRules(payloadRules, payloadFields, knownElements = new Set()) {
  const pageBusinessRules = [], entityBusinessRules = [], needsDecision = [];
  for (const r of payloadRules) mapOneRule(r, pageBusinessRules, entityBusinessRules, needsDecision);
  // C4: flag a rule ONLY when its target resolves to NOTHING on the page — neither a mapped field NOR any known
  // element (tab / group / container). Business rules legitimately target more than fields: hiding a TAB or GROUP
  // hides all its fields, so a rule targeting `…TabLabel` / `…Group…` is valid, not a dangling reference. Those
  // used to be mis-flagged as "no field for it"; now only a target absent from the whole page (an entity-only
  // column with no element, or a stale binding) is surfaced.
  const emittedCols = new Set(payloadFields.map(f => f.bindTo || f.name));
  const ruleTargets = new Set(
    [...pageBusinessRules.map(r => r.element), ...entityBusinessRules.map(r => r.targetAttribute)].filter(Boolean));
  for (const t of ruleTargets) if (!emittedCols.has(t) && !knownElements.has(t))
    needsDecision.push({ kind: "rule-target-missing", item: t,
      reason: `business rule targets '${t}' but the page has no element for it — neither a mapped field nor a tab/group/container. It is likely an entity-only column or a stale binding; verify the Freedom target provides the element (or the rule is obsolete).` });
  // FOLD the incomplete FILTRATIONs (dynamic / column-reference lookup filters — no static constant) into ONE
  // CONCRETE line naming each lookup and its filter column(s). The engine already captured the filter column, so
  // a per-rule "resolve the target column/comparison/value" punt was both vague and noisy (read as N assumptions).
  // A column-reference filter is a normal Freedom lookup filter — present it as such, grouped per lookup.
  foldIncompleteFilters();
  return { pageBusinessRules, entityBusinessRules, needsDecision };

  // FOLD incomplete FILTRATIONs (dynamic / column-reference lookup filters, no static constant) into ONE concrete
  // line naming each lookup + its filter column(s). Own fn for Sonar CC 15; closes over entityBusinessRules/needsDecision.
  function foldIncompleteFilters() {
    const incompleteFilters = entityBusinessRules.filter((r) => !r.complete);
    if (!incompleteFilters.length) return;
    const byTarget = new Map();
    for (const r of incompleteFilters) {
      if (!byTarget.has(r.targetAttribute)) byTarget.set(r.targetAttribute, new Set());
      if (r.filter?.columnPath) byTarget.get(r.targetAttribute).add(r.filter.columnPath);
    }
    const parts = [...byTarget.entries()].map(([t, cols]) => cols.size ? `${t} by ${[...cols].join("/")}` : `${t} (filter column unresolved)`);
    // State what is already built and what is missing from it: these rows are folded FROM `entityBusinessRules`, so
    // the rule exists with its target and filter column. Telling the reader to "reproduce" it sends them to rebuild
    // what the ChangeSet already carries; only the comparison (and any constant) failed to resolve statically.
    needsDecision.push({ kind: "entity-filter", item: `(${byTarget.size} lookup${byTarget.size === 1 ? "" : "s"})`,
      reason: `${byTarget.size} lookup field(s) carry a DYNAMIC / column-reference classic filter (restrict the dropdown by a related column, no static constant): ${parts.join(", ")}. The entity business rule for each is ALREADY in this ChangeSet, carrying the target lookup and the column to filter by — what it does NOT carry is the comparison, which could not be read statically. COMPLETE the emitted rule with the comparison (and any constant it compares against); do not rebuild it from scratch.` });
  }
}

// A classic image/photo item (generator-based, no bindTo, or an image-named component).
function isImageItem(i) {
  if (i.templateOwned) return false; // a base-template Photo/Logo is layout context, not client payload
  const genImg = i.generator && /image/i.test(i.generator);
  const nameImg = !i.bindTo && i.itemType !== VIEW_ITEM_TYPE.DETAIL && i.itemType !== VIEW_ITEM_TYPE.CONTROL_GROUP && !i.isTab
    && (/^(?:Photo|Image|Logo|Avatar|Thumbnail|Picture)\d*$/i.test(i.name) || /(?:Photo|Logo|Avatar|Thumbnail|Picture)$/.test(i.name));
  return !!(genImg || nameImg);
}

// image / photo components → a REAL crt.ImageInput element in the ChangeSet (not just a plan row). Emits the
// three diffs a field needs — view (crt.ImageInput, bound through `value`, NOT `control`), viewModel attribute,
// model column — so the agent BUILDS it and `--verify` counts it (the old side-channel `cs.images` rendered a
// plan row but nothing to build → the image silently never got added). Placement reuses the field router's owner
// resolution + profile region. Binding target = the entity's IMAGELOOKUP (16) column (the only type crt.ImageInput
// can bind): an explicit generator-config column > the SOLE IMAGELOOKUP column on the entity > a `<FILL>` slot with
// the concrete recipe. A related-object photo (Contact.Photo on Employee) is the cross-datasource case (§#3): the
// column is not on THIS entity → bind `value` through the lookup path, read-only (same pattern as a linked field).
// Resolve an image's binding column. Explicit config column (i.imageColumn / i.bindTo) > the entity's SOLE IMAGELOOKUP
// column (bound to AT MOST ONE image — the rest collide → FILL) > FILL. `haveCols` guard: with NO entityColumns we
// can't say "not on the entity", so an explicit column is treated on-entity (not misclassified cross-datasource).
// Only an ON-ENTITY column is a real bindable attribute (`bound`); a cross-datasource one falls to a FILL (§#1 —
// otherwise `value:"$col"` dangles, since the attribute is declared only for on-entity). Extracted for Sonar CC 15.
function resolveImageBinding(i, cols, soleImageCol, soleUsed) {
  const ownCol = i.imageColumn || i.bindTo || null;
  let boundCol = ownCol, soleCollision = false, usedSole = soleUsed;
  if (!boundCol && soleImageCol) {                     // AUTO fallback: a column-less image takes the sole IMAGELOOKUP…
    if (!soleUsed) { boundCol = soleImageCol; usedSole = true; }
    else soleCollision = true;                         // …unless a prior image already reserved it.
  } else if (boundCol && boundCol === soleImageCol) {
    // An EXPLICIT bind to the sole IMAGELOOKUP column reserves it too. A SECOND image resolving to that column —
    // by auto-fallback OR by another explicit bind — is the SAME collision: two crt.ImageInput must not share one
    // column. Resolve it identically to the auto path: keep the FIRST on the column, FILL the second (drop its
    // bind → boundCol null) and raise the image-column decision. (The guard previously fired only on the auto
    // path, so TWO explicit binds to soleImageCol both resolved to it — two widgets silently on one column.)
    if (soleUsed) { soleCollision = true; boundCol = null; }
    else usedSole = true;
  }
  const haveCols = Object.keys(cols || {}).length > 0;
  const onEntity = !!boundCol && (!haveCols || boundCol in cols);
  const crossDs = !!boundCol && haveCols && !(boundCol in cols); // column is on a RELATED object (via a lookup), not this entity
  const bound = boundCol && onEntity ? boundCol : null;
  return { boundCol, bound, onEntity, crossDs, soleCollision, usedSole };
}

// Map ONE image item → its crt.ImageInput element, image record, optional attribute/pdsColumn, and decisions.
// Extracted from mapImages so the loop stays under the cognitive-complexity budget (S3776). `soleUsed` in →
// `usedSole` out advances the sole-IMAGELOOKUP-taken state across the loop.
function mapOneImage(i, ctx, F, soleImageCol, soleUsed) {
  const { index, profileAnchors, cols, colMeta } = ctx;
  const decisions = [];
  // placement: a photo lives in the profile island on most pages; a tab-placed / unresolved-parent image falls back
  // to the general container — a genuine placement gap, so surface a decision (not a silent misplacement).
  const own = i.parent ? resolveOwner(i.parent, index, profileAnchors) : { kind: "unresolved" };
  const parentName = own.kind === "profile" ? F.profileRegion(own) : FLAT_FALLBACK;
  if (own.kind !== "profile") {
    const ownerNote = own.kind === "tab" ? `tab '${own.tab}'` : "unresolved parent";
    decisions.push({ kind: "image-placement", item: i.name,
      reason: `image '${i.name}' does not resolve to the side profile (owner: ${ownerNote}) — placed in ${FLAT_FALLBACK} as a fallback. Confirm its target container (a photo usually belongs in the profile island; a tab-placed image keeps its tab).` });
  }
  const { boundCol, bound, onEntity, crossDs, soleCollision, usedSole } = resolveImageBinding(i, cols, soleImageCol, soleUsed);
  const attr = bound || `${i.name}_value`;
  const values = { type: "crt.ImageInput", value: "$" + attr, size: "large", borderRadius: "medium", positioning: "cover", readOnly: crossDs };
  const element = { operation: "insert", name: i.name, parentName, propertyName: "items", values };
  const image = { classic: i.name, generator: i.generator || null, parent: i.parent, column: boundCol, crossDs, filled: !bound };
  if (soleCollision) decisions.push({ kind: "image-column", item: i.name,
    reason: `image '${i.name}' has no own column and the entity's sole IMAGELOOKUP column '${soleImageCol}' is already bound to another image — two crt.ImageInput widgets must not share one column. Pick or create a DISTINCT ImageLookup column for it (left as a FILL until then).` });
  let attrEntry = null, pdsEntry = null;
  if (boundCol && onEntity) {
    attrEntry = { key: attr, value: { modelConfig: { path: "PDS." + boundCol } } };
    pdsEntry = { key: boundCol, value: { path: boundCol } };
    // crt.ImageInput binds ONLY an IMAGELOOKUP column — a binary Image / Text URL binds but shows/uploads nothing
    // (silent runtime fail), so surface a real decision.
    if (!isImageLookupType(colMeta(boundCol).type)) decisions.push({ kind: "image-column", item: boundCol,
      reason: `image '${i.name}' would bind to '${boundCol}', which is NOT an IMAGELOOKUP (16) column — crt.ImageInput can bind ONLY an "Image link" column (references SysImage), never a binary Image or a Text URL. Create/point at an ImageLookup column, or the image shows nothing and uploads fail silently.` });
  } else {
    // FILL / cross-datasource / collision: `value` is `$<name>_value`. Declare a PLACEHOLDER view-model attribute for
    // it so the binding is NOT dangling (it resolves to a real declared attribute) — its `modelConfig.path` is a
    // <FILL> the agent completes with the real IMAGELOOKUP column / related-object lookup path per the layout recipe.
    // No pdsColumn yet (the datasource column is unknown until resolved). Fixes the round-4 residue where the value
    // referenced an attribute that was never declared.
    const hint = crossDs ? "the related-object lookup path (read-only)" : "the entity's IMAGELOOKUP (16) column";
    attrEntry = { key: attr, value: { modelConfig: { path: `<FILL: bind to ${hint}>` } } };
  }
  return { element, image, attrEntry, pdsEntry, decisions, usedSole };
}

function mapImages(eff, ctx, F) {
  const { cols, colMeta } = ctx;
  const images = [], viewConfigDiff = [], attributes = {}, pdsColumns = {}, needsDecision = [], accountedFor = [];
  // the entity's IMAGELOOKUP column(s) — the usual binding target (Contact.Photo / Account.Logo). Exactly one ⇒
  // safe to auto-bind ONE image; zero or many ⇒ leave a FILL (don't guess which, don't invent a non-existent column).
  const imageLookupCols = Object.keys(cols || {}).filter((c) => isImageLookupType(colMeta(c).type));
  const soleImageCol = imageLookupCols.length === 1 ? imageLookupCols[0] : null;
  let soleUsed = false;
  for (const i of (eff.items || [])) {
    if (!isImageItem(i)) continue;
    accountedFor.push(i.name);
    const r = mapOneImage(i, ctx, F, soleImageCol, soleUsed);
    soleUsed = r.usedSole;
    viewConfigDiff.push(r.element);
    images.push(r.image);
    if (r.attrEntry) attributes[r.attrEntry.key] = r.attrEntry.value;
    if (r.pdsEntry) pdsColumns[r.pdsEntry.key] = r.pdsEntry.value;
    needsDecision.push(...r.decisions);
  }
  return { images, viewConfigDiff, attributes, pdsColumns, needsDecision, accountedFor };
}

// The Freedom wiring for ONE recognised profile card + the decision text the agent acts on. Split out so the
// native-component branch and the no-native-analog fallback each read as one thing.
function profileCardTarget(c, entity, info) {
  const native = entity ? PROFILE_CARD_BY_ENTITY[entity] : null;
  // F9 — a card declared by a SEED (parent-template) layer is template context, not client payload: the Freedom
  // counterpart template may already ship it. Say so instead of claiming it as content to build (mirrors how
  // mapWidgets marks a base-provided widget).
  const baseNote = c.fromTemplate
    ? " This card comes from the parent-template layer, not the page's own schema — confirm whether the Freedom counterpart template already provides it before adding a second one."
    : "";
  // the columns the CLASSIC card displayed (from the profile schema's own diff, when its body was supplied) —
  // this is what tells the agent which values the native card does NOT cover and must be added beside it.
  const cols = info?.columns?.length ? info.columns : null;
  const colsNote = cols ? ` The classic card showed: ${cols.join(", ")}.` : "";
  const flags = Object.keys(c.displayFlags || {}).filter((k) => c.displayFlags[k]);
  const flagsNote = flags.length ? ` Display flags on the classic config: ${flags.join(", ")} — check the corresponding value is still visible.` : "";
  // `profileColumnName` is NOT a display concern: the classic blank slate used it to pre-fill the back-reference
  // when the user ADDED a new linked record. Say that plainly so it is not mistaken for a second binding.
  const backRef = c.profileColumnName
    ? ` The classic blank slate could CREATE the linked record, pre-filling '${c.profileColumnName}' on the new ${entity || "profiled"} record with the master record — reproduce that only if the Freedom page must offer creating it (otherwise the lookup's own select is enough).`
    : "";
  if (native) {
    const pkgNote = native.pkg
      ? ` Requires package '${native.pkg}' as a dependency of the page's package — confirm it is installed on the target environment (list-packages) BEFORE building; the component does not render without it.`
      : "";
    return {
      freedom: native.type, package: native.pkg, fields: cols,
      reason: `embedded profile card '${c.key}' (classic '${c.schemaName || "?"}', profiled entity '${entity}') → Freedom '${native.type}' in the SIDE PROFILE: insert it into the side-profile container (e.g. 'SideAreaProfileFieldFlexContainer') with 'readonly': true and 'referenceColumn' pointing at a view-model attribute over the master lookup — declare '{ modelConfig: { path: "PDS.${c.masterColumnName}" } }' and set 'referenceColumn': '$<thatAttribute>' (this is exactly how the OOTB Opportunities_FormPage wires its account/contact cards). The master lookup '${c.masterColumnName}' holds the profiled record's Id and the component loads the record itself — no extra data source.${pkgNote} It renders ${native.shows}.${colsNote}${flagsNote} Any classic value the component does not render must be added BESIDE the card as read-only fields over a lookup-path data-source attribute: merge into the PDS attributes a '{ path: "${c.masterColumnName}.<column>", type: "ForwardReference" }' entry per value and bind a read-only field to it.${backRef}${baseNote}`,
    };
  }
  const entityNote = entity ? `profiled entity '${entity}'` : "profiled entity NOT resolved";
  // A POLYMORPHIC client profile (the profile schema declares no entitySchemaName — it profiles an Account OR a
  // Contact depending on the record, e.g. `ClientProfileSchema` on OpportunityPageV2) has no single Freedom
  // counterpart: the OOTB Opportunities_FormPage carries BOTH compact profiles, each shown by its own condition.
  // Say so, because "no native component" would otherwise read as "rebuild it by hand" for a case Freedom covers.
  const polyNote = entity ? "" : ` If the classic profile schema declares NO entitySchemaName it is POLYMORPHIC (it profiles an Account OR a Contact per record — as '${c.schemaName || "the client profile"}' does): then the Freedom answer is BOTH native cards (crt.AccountCompactProfile + crt.ContactCompactProfile), each over its own lookup and shown conditionally — the OOTB Opportunities_FormPage does exactly that. Resolve which it is on-stand before falling back to hand-built fields.`;
  return {
    freedom: null, package: null, fields: cols,
    reason: `embedded profile card '${c.key}' (classic '${c.schemaName || "?"}', ${entityNote}) has NO native Freedom compact-profile component — rebuild it as its OWN 'crt.GridContainer' island in 'SideAreaProfileContainer' (single-column, styled like the island the template already provides) holding READ-ONLY fields of the linked record: per shown column merge a lookup-path attribute into the PDS attributes — '{ path: "${c.masterColumnName}.<column>", type: "ForwardReference" }' — and bind a read-only field to it, plus the record link (the classic header was a hyperlink opening the profiled record).${polyNote}${colsNote}${flagsNote}${backRef}${baseNote} Do NOT drop the card and do NOT collapse it into the master's own fields.`,
  };
}

// ENG-93928 — embedded profile cards (linked-record blocks) → the Freedom side profile. Runs as its OWN phase
// (not through the name-keyed widget catalog) and, critically, marks each module key as accounted for: the host
// diff item shares that name, so this is what stops mapUnmappedDrop reporting the card as an "unknown embedded
// module" — the exact failure this rule exists to fix. Returns profileCards[] + needsDecision[]/accountedFor[].
function mapProfileCards(ctx) {
  const { eff, colMeta, profileSchemas, index, profileAnchors } = ctx;
  const profileCards = [], needsDecision = [], accountedFor = new Set();
  for (const c of (eff.components || [])) {
    if (!isProfileCardModule(c)) continue;
    accountedFor.add(c.key);                       // the module AND its host diff item (usually the same name)
    // the profile schema may be supplied under its own name OR — when the classic config names no schemaName —
    // under the module key, which is then the only key the agent can key it by (see the structure gate).
    // The `!= null` guard matches `has` in profileSchemaIssues: a null schemaName would otherwise index the
    // literal key "null", which happens to miss today but only by accident.
    const decl = (c.schemaName != null ? profileSchemas[c.schemaName] : undefined) ?? profileSchemas[c.key];
    // `verifiedNone` (manifest `false`) = the agent verified there is no separate schema to read → no info to use,
    // but a RESOLVED state, so the plan says that instead of "not supplied".
    const verifiedNone = decl === false || !!decl?.verifiedNone;
    const info = (!verifiedNone && decl && typeof decl === "object") ? decl : null;
    // profiled entity, most authoritative first: the profile schema's own entitySchemaName → the master
    // lookup column's referenced schema (entity metadata) → the schema-name family. Never a blind guess.
    const entity = info?.entity || colMeta(c.masterColumnName).ref || guessProfiledEntity(c.schemaName);
    const t = profileCardTarget(c, entity, info);
    // where the classic card sat: its host diff item climbs to the profile/left area on every real page, but
    // resolve it rather than assume — a card inside a tab must be reported in that tab.
    const host = index.get(c.key);
    // account for the host diff item under ITS OWN name too: the Creatio convention aligns the diff-item name
    // with the `modules` key (every OOTB example does), but nothing enforces it — and when they differ,
    // mapUnmappedDrop would flag the host item as an unknown dropped component.
    if (host?.name) accountedFor.add(host.name);
    const own = host?.parent ? resolveOwner(host.parent, index, profileAnchors) : { kind: "profile" };
    profileCards.push({
      classic: c.key, schemaName: c.schemaName || null, entity: entity || null,
      masterColumn: c.masterColumnName, profileColumn: c.profileColumnName || null,
      freedom: t.freedom, package: t.package, fields: t.fields,
      region: own.kind === "tab" ? own.tab : "SideAreaProfileContainer",
      displayFlags: c.displayFlags || {}, schemaSupplied: !!info, schemaVerifiedNone: verifiedNone, base: !!c.fromTemplate,
    });
    needsDecision.push({ kind: "profile-card", item: c.key, reason: t.reason });
  }
  return { profileCards, needsDecision, accountedFor };
}

// Moment 4: header/analytical widgets → Freedom analogs (base-provided are NOTED, not dropped).
// Returns its own needsDecision[] / accountedFor[]; the orchestrator merges them.
function mapWidgets(eff, opts = {}) {
  const widgets = [], chromeWidgets = [], needsDecision = [], accountedFor = [];
  const seenWidget = new Set();
  // A widget catalog entry maps a base-template CONTAINER/MODULE (e.g. ESNFeedContainer, DcmActionsDashboard…)
  // to a Freedom analog. But the base Freedom template DEFINES all of these universally, so their mere presence
  // in the merged page is NOT evidence the classic page actually had the widget — emitting on presence leaked
  // base chrome (Timeline / Duplicates / Recommendations / a stray Feed / DCM) onto every record page AND every
  // detail/child fold. Two real evidence sources decide emission instead:
  //   (1) CLASSIC EVIDENCE — the container, or an ancestor of it, was `schemaTouched` (a non-seed page layer
  //       contributed it). The classic page places the ESN feed via its `ESNTab`, so ESNFeedContainer's ancestor
  //       ESNTab is schemaTouched ⇒ Feed is genuine. Timeline/Duplicates/Recommendations sit in a pure base-seed
  //       subtree (nothing schemaTouched) ⇒ inherited chrome ⇒ dropped. A classic page that DID have a Timeline
  //       tab would carry a schemaTouched TimelineTab and emit it — the rule generalises, no per-widget hardcode.
  //   (2) ON-STAND SIGNAL — DCM (`signal:"dcm"`) is never in the page body (it comes from the DCM case schema),
  //       so it emits only when `manifest.signals.dcm` is resolved+present, regardless of container presence.
  const dcmPresent = opts.signals?.dcm?.resolved === true && !!opts.signals.dcm.present;
  const byName = new Map((eff.items || []).map((i) => [i.name, i]));
  // "a classic (non-seed) page layer contributed this element" — either it INSERTED it fresh (`!templateOwned`,
  // the defining insert was a client layer) or it MERGED/MOVED onto a base-seed element (`schemaTouched`). The
  // classic page places the ESN feed by reconfiguring the base `ESNTab`, so ESNTab is classic-contributed while
  // its structural ancestors (Tabs/CardContentContainer) stay pure seed — the walk stops at the real evidence.
  const classicContributed = (it) => !!it && (!it.templateOwned || it.schemaTouched);
  const classicEvidence = (name) => {
    let cur = byName.get(name), guard = 0;
    while (cur && guard++ < 32) {
      if (classicContributed(cur)) return true;           // self or an ancestor was placed/reconfigured by a page layer
      cur = cur.parent ? byName.get(cur.parent) : null;
    }
    return false;
  };
  // `base` = the widget's source is base-template chrome (templateOwned / fromTemplate); `evident` = a classic
  // layer contributed it (self/ancestor). A base widget with no classic evidence is inherited chrome → skip.
  // Emit ONE widget def (gate on evidence, dedup, split chrome vs real, build the decision). Own fn for Sonar CC 15.
  const emitOneWidget = (w, classic, base, classicEvident) => {
    if (seenWidget.has(w.widget)) return;
    // GATE: a base-chrome widget emits only with real evidence it belongs to THIS page. DCM never lives in the
    // page body on a case-driven page, so it also accepts the resolved on-stand signal.
    if (w.signal === "dcm") { if (!dcmPresent && !classicEvident) return; }
    else if (!classicEvident) return;
    seenWidget.add(w.widget);
    // `chrome` widgets (e.g. the always-present-but-empty Recommendations container) are inherited scaffolding — hide.
    if (w.chrome) { chromeWidgets.push({ widget: w.widget, classic, note: w.note || null }); return; }
    widgets.push({ widget: w.widget, freedom: w.freedom, classic, base: !!base, note: w.note || null, placement: w.placement || null });
    let tail;
    if (w.note) tail = ` — ${w.note}`;
    else if (base) tail = " — usually provided by the Freedom template; confirm or re-apply any customization";
    else tail = "; confirm the Freedom component";
    needsDecision.push({ kind: "widget", item: w.widget, reason: `${w.widget} → ${w.freedom}${tail}` });
  };
  const addWidget = (defs, classic, base, evident) => {
    if (!defs) return;
    accountedFor.push(classic);
    const classicEvident = !base || evident; // a non-seed page layer contributed this container (self/ancestor)
    for (const w of (Array.isArray(defs) ? defs : [defs])) emitOneWidget(w, classic, base, classicEvident);
  };
  for (const c of (eff.components || [])) addWidget(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName], c.key, c.fromTemplate, !c.fromTemplate);
  for (const i of (eff.items || [])) addWidget(WIDGET_BY_CONTAINER[i.name], i.name, i.templateOwned, !i.templateOwned || classicEvidence(i.name));
  return { widgets, chromeWidgets, needsDecision, accountedFor };
}

// kind → category, ORDERED: the first match wins, so the more specific behaviour sits ahead of the more general
// one (a method that opens a query AND builds filters is a query).
// `save` sits BELOW publish / refresh / lookup on purpose, and the rule is stated here because no measurement can
// establish it: saving is what a classic method does *around* its real work (`…; this.save();` closes a handler
// that published a message or reloaded a detail), so the Freedom target follows from that work, not from the save.
// A method whose ONLY kind is `save` still categorises as `save`. Pinned by the `category precedence:` goldens in
// run-mapper.mjs, so reordering this table fails a test instead of passing silently.
const KIND_CATEGORY = [
  ["validator", "validator"], ["esq", "query/filter"], ["filter-build", "filter-build"], ["service", "service-call"],
  ["sys-setting", "sys-setting"], ["refresh", "refresh"],
  ["process-launch", "process-launch"], ["publish", "message-publish"], ["subscribe", "message-subscribe"],
  ["dialog", "dialog"], ["lookup", "lookup"], ["save", "save"], ["feature-toggle", "feature-gate"],
  ["mixin-call", "mixin-call"],
];
// A method's category, from EVIDENCE ONLY: the calls its body makes, then the attributes it writes. Never from the
// method's name — a name-derived category picks a Freedom target nothing in the body supports, and reads exactly
// like a derived one. A body neither test can classify is `unclassified`, whose target is the generic wording.
function categorize(facts) {
  const kinds = new Set(facts?.kinds || []);
  // A pure passthrough declares no behaviour of its own, so it gets no behaviour category.
  if (facts && (facts.callParentOnly || facts.isEmpty)) return "passthrough";
  for (const [kind, cat] of KIND_CATEGORY) if (kinds.has(kind)) return cat;
  // writes attributes but makes no notable call → it sets view-model state, CONFIRMED by the writes
  if (facts?.writesAttrs.length) return "set-values";
  return "unclassified";
}
