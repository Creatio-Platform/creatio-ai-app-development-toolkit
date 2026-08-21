// THE SHARED MAPPING TABLE — one home for "this classic element becomes that Freedom target".
//
// Before this module the same knowledge lived in five places: `ITEM_ROLE` (the itemType dispatch),
// `FEATURE_CATALOG`, `WIDGET_BY_MODULE` / `WIDGET_BY_CONTAINER`, `PROFILE_CARD_BY_ENTITY` and
// `KNOWN_ACTION_ITEMS` in mapper.mjs, plus `FEATURE_TYPE` in designspec.mjs (which the `--verify` gate reads)
// and the prose classification rows of `references/classic-to-freedom-mapping.md`. Two homes for one mapping
// is how `crt.CommunicationOptions` came to be asserted in one file and gated in another.
//
// ROW SHAPE
//   {
//     match:   { by, ...key }        — WHAT this row recognises (see MATCH below)
//     role:    ROLE.*               — engine-coverage disposition, the `ITEM_ROLE` semantics unchanged
//     tier:    TIER.*               — what happens to a recognised kind (the one test, see TIER)
//     ownedBy: OWNER.*              — which builder emits it (or that nobody does)
//     target:  { componentType, propMap, slot, events? } | null
//     verify:  { componentType } | null  — what a BUILT page must carry for this row to read ✅ in `--verify`
//     uiShape: "component" | "list" | null — how it RENDERS, for the design-spec Layout table
//     notes:   string | null
//   }
//
// `target.events` names the component OUTPUTS the emission wires (a button's `clicked`), kept apart from
// `propMap` because an output is validated against the registry's `outputs`, not its `inputs` — putting
// `clicked` in `propMap` would make the CI check look for an input that does not exist on any version.
//
// `target` is null on every row whose Freedom element is not a fixed component type: a FIELD's control follows
// its entity column's data type, a CONTAINER's target follows its structural role, and a TIER.DECISION row
// names no target ON PURPOSE — asserting one there would pre-empt the decision the row exists to raise.
import { VIEW_ITEM_TYPE } from "./engine.mjs";

// WHAT a row keys on. The ticket's row shape keyed on `itemType` alone; the catalogs this table absorbs key on
// four other things, and dropping any of them loses a live path — `matchFeature`'s suffix match is what turns
// `ApplicantEmailDetailV2` into the Emails feature, and the two entity fallbacks are what recognise a `*File`
// detail and `ContactCommunication`.
export const MATCH = {
  ITEM_TYPE: "itemType",            // the kind the schema stated (ViewGeneratorV2's own switch)
  SCHEMA_EXACT: "schemaNameExact",  // a detail/profile schema by its exact name
  SCHEMA_SUFFIX: "schemaNameSuffix",// ...or by an entity-prefixed variant of it (ApplicantEmailDetailV2)
  ENTITY: "entity",                 // the entity behind the element (a *File detail, ContactCommunication)
  MODULE_KEY: "moduleKey",          // a classic module by key / moduleName / schemaName
  CONTAINER_NAME: "containerName",  // a classic container by name
};

// THE ONE TEST, exactly as the proposal states it: is the Freedom target's required config fully derivable
// from the classic config?
//   A — fully automatic: the element emits, nothing is left for a human.
//   B — view automatic, behavior stubbed: the element emits; its imperative wiring (already captured in
//       `item.handlers`) becomes a handler stub on the existing imperative-logic worklist.
//   C — typed decision: no derivable target. The row carries evidence and candidates, never a fabricated type.
// Decoration is tier A: there is nothing to emit AND nothing to decide (the ledger records it as `chrome`).
export const TIER = { AUTO: "A", VIEW_ONLY: "B", DECISION: "C" };

// WHO emits the Freedom artifact. A row is not self-executing: most kinds are already built by a dedicated
// builder, and the table records which one rather than duplicating its logic.
export const OWNER = {
  FIELD: "field-builder",
  FOLDED: "folded-into-owner", // nothing of its own is emitted; it contributes props to the element that owns it
  CONTAINER: "container-builder",
  DETAIL: "detail-builder",
  WIDGET: "widget-builder",
  TABLE: "table",       // emitted straight from this row's `target` (the first-wave kinds)
  CHROME: "chrome",     // deliberately nothing — pure decoration, recorded in the member ledger
  DECISION: "decision", // nothing is emitted; the element surfaces as a typed ⚠
};

// Engine-coverage disposition. Carried over from `ITEM_ROLE` with the same five values and the same meanings,
// because the drop sweep (`mapUnmappedDrop`) and the member ledger both branch on it:
//  • `field`      — a data-bound control; the field builder owns it (Classic's own default).
//  • `structural` — layout the container builder rebuilds (grids, tab panels, groups, details).
//  • `container`  — a layout box that is structural ONLY when its subtree produced Freedom elements. A container
//                   whose whole subtree mapped to nothing is real UI and must still surface.
//  • `decoration` — UI furniture that carries no migration answer. Recorded in the member ledger as `chrome`.
//  • `unmapped`   — no Freedom element is emitted for the kind; the element gets a TYPED ⚠ naming its kind.
//  • `mapped`     — the shared table emits a Freedom element (or a slot of one) for the kind itself. This is the
//                   role `unmapped` becomes the moment a kind gains a target: leaving it `unmapped` would keep
//                   claiming "no Freedom element for this kind" about an element the engine now builds.
export const ROLE = { FIELD: "field", STRUCT: "structural", CONTAINER: "container", DECOR: "decoration", UNMAPPED: "unmapped", MAPPED: "mapped" };

// WHERE a target prop's value comes from. A `propMap` entry is `{ from: SOURCE.* }` (plus `value` for a literal),
// never a function: the entries have to be READ by the CI check that asserts every propMap KEY exists among the
// component's registry `inputs`, and by the reference-doc generator. A closure would make both impossible.
// A `required` source is one an element can genuinely LACK, which makes the instance fall short of its row's tier
// (a radio group with no options). `CAPTION` is never required: the caption resolver always yields a localizable
// binding — a synthesized key plus a decision to author the string — so the element still emits with its text
// pending instead of vanishing into a ⚠.
export const SOURCE = {
  CAPTION: "caption",                 // the item's caption resource key -> a `$Resources.Strings.<key>` binding
  VALUE_ATTR: "valueAttr",            // the NESTED `value.bindTo` -> a `$<Attr>` FormControl reference
  OPTION_CHILDREN: "optionChildren",  // child items carrying a literal `value` -> the option array
  MENU_CHILDREN: "menuChildren",      // MENU / MENU_ITEM descendants -> the owning button's menuItems
  LITERAL: "literal",                 // a constant stated on the row itself (`value`)
};

// A row builder, so every row is complete and the optional fields cannot be silently forgotten (a row missing
// `tier` would otherwise read as tier `undefined` and pass every truthiness test).
function row({ match, role, tier, ownedBy, target = null, verify = null, uiShape = null, notes = null }) {
  return Object.freeze({ match: Object.freeze(match), role, tier, ownedBy, target: target && Object.freeze(target), verify, uiShape, notes });
}
const byItemType = (itemType, rest) => row({ match: { by: MATCH.ITEM_TYPE, itemType }, ...rest });

// ---- the itemType rows: all 29 ViewItemType members ---------------------------------------------------------
// Precedence mirrors `ViewGeneratorV2.generateItem`: a row with `qualifiers` wins over the plain itemType row,
// and no itemType at all is the FIELD path (`generateStandardItem` → default → `generateModelItem`) — which is
// why there is no row for "no itemType": absence is not a kind, and `resolveItemTypeRow` returns null for it.
const ITEM_TYPE_ROWS = [
  byItemType(VIEW_ITEM_TYPE.GRID_LAYOUT, { role: ROLE.STRUCT, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  // NOT decoration: `generateGridLayoutEdit` (ViewGeneratorV2 L741-749) builds a LIVE `Terrasoft.GridLayoutEdit`
  // and hands it `items: config.items || []` RAW, without recursing through `generateItem`. Calling it design-time
  // discarded its whole child subtree, and because the children never go through the generator they exist only in
  // the raw view config this engine itself walks — so this engine was the only thing that could have reported them.
  byItemType(VIEW_ITEM_TYPE.GRID_LAYOUT_EDIT, { role: ROLE.CONTAINER, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  byItemType(VIEW_ITEM_TYPE.TAB_PANEL, { role: ROLE.STRUCT, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  byItemType(VIEW_ITEM_TYPE.IMAGE_TAB_PANEL, { role: ROLE.STRUCT, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  byItemType(VIEW_ITEM_TYPE.DETAIL, { role: ROLE.STRUCT, tier: TIER.AUTO, ownedBy: OWNER.DETAIL }),
  byItemType(VIEW_ITEM_TYPE.CONTROL_GROUP, { role: ROLE.STRUCT, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  byItemType(VIEW_ITEM_TYPE.MODEL_ITEM, { role: ROLE.FIELD, tier: TIER.AUTO, ownedBy: OWNER.FIELD }),
  byItemType(VIEW_ITEM_TYPE.CONTAINER, { role: ROLE.CONTAINER, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  // The ONE genuinely information-free kind: `generateSeparatorMenuItem` (L1289-1296) emits
  // `{className: "Terrasoft.MenuSeparator"}` and pass-through props — no caption, no children, nothing to port.
  byItemType(VIEW_ITEM_TYPE.MENU_SEPARATOR, { role: ROLE.DECOR, tier: TIER.AUTO, ownedBy: OWNER.CHROME }),
  // NOT decoration: `generateTip` (L1369-1391) merges the author's own tip config and generates BOTH `config.tools`
  // (L1349-1360) and `config.items` (L1382-1389) RECURSIVELY through `generateItem`. A TIP can therefore contain
  // buttons and arbitrary child items; treating it as a tooltip dropped that subtree unseen.
  byItemType(VIEW_ITEM_TYPE.TIP, { role: ROLE.CONTAINER, tier: TIER.AUTO, ownedBy: OWNER.CONTAINER }),
  // NOT decoration: `TIP_LABEL` routes to `generateControlLabel` (L569 -> L1738-1760), whose caption comes from
  // `getLabelCaption` (L1675-1689) — `config.caption`, then `labelConfig.caption`, then the column's. Classic logs
  // an ERROR when that caption is empty (L986-992), which is the platform itself asserting the text is meant to be
  // there. "Freedom fields label themselves" holds only while the label IS a field's own; a standalone TIP_LABEL
  // whose caption differs from its control is author-written copy, and `chrome` deleted it with no ⚠ and no trace.
  byItemType(VIEW_ITEM_TYPE.TIP_LABEL, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.MODULE, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }), // widget / profile-card builders claim the ones they know first
  // ---- FIRST-WAVE TARGETS. Every componentType and every propMap key below was read off the component registry
  // and checked in 8.3.0 / 8.3.3 / latest, not asserted from memory: a target that exists only in `latest` would
  // green-light a page that cannot render on an 8.3 stand (the registry carries 152 components at 8.3.0 against
  // 200 at latest).
  //
  // A BUTTON's caption is derivable; what it DOES is not — the click is an imperative method. So it emits with its
  // caption and its click becomes a stub on the imperative worklist: tier B, the definition of it.
  byItemType(VIEW_ITEM_TYPE.BUTTON, {
    role: ROLE.MAPPED, tier: TIER.VIEW_ONLY, ownedBy: OWNER.TABLE, uiShape: "component",
    target: { componentType: "crt.Button", slot: "items",
      events: { clicked: true },
      propMap: { caption: { from: SOURCE.CAPTION }, menuItems: { from: SOURCE.MENU_CHILDREN } } },
    verify: { componentType: "crt.Button" },
    notes: "The classic click handler is NOT ported by the emission — it becomes a `clicked` request + a handler stub on the imperative-logic worklist. `menuItems` folds the button's own MENU / MENU_ITEM descendants; a button with no menu emits none.",
  }),
  // A standalone LABEL carries author-written copy and nothing else, so its whole config is derivable: tier A.
  // `crt.Label` is NOT compositeOnly and exists in every checked version.
  byItemType(VIEW_ITEM_TYPE.LABEL, {
    role: ROLE.MAPPED, tier: TIER.AUTO, ownedBy: OWNER.TABLE, uiShape: "component",
    target: { componentType: "crt.Label", slot: "items", propMap: { caption: { from: SOURCE.CAPTION } } },
    verify: { componentType: "crt.Label" },
    notes: "A label that is a FIELD's own label is not this row's business — the Freedom field labels itself. This row is for a standalone LABEL element.",
  }),
  // A MENU is a pure wrapper: it contributes its items to the owning button and emits nothing of its own.
  byItemType(VIEW_ITEM_TYPE.MENU, {
    role: ROLE.MAPPED, tier: TIER.AUTO, ownedBy: OWNER.FOLDED,
    target: { foldInto: "menuItems", propMap: { caption: { from: SOURCE.CAPTION } } },
    notes: "Freedom has no separate menu element on a form: a button's dropdown IS its `menuItems` array (`crt.Menu` exists but is compositeOnly and is the overlay primitive, not the form-button idiom).",
  }),
  // A MENU_ITEM folds into the same array, and like a button its click is imperative — tier B.
  byItemType(VIEW_ITEM_TYPE.MENU_ITEM, {
    role: ROLE.MAPPED, tier: TIER.VIEW_ONLY, ownedBy: OWNER.FOLDED,
    target: { foldInto: "menuItems", events: { clicked: true }, propMap: { caption: { from: SOURCE.CAPTION } } },
    notes: "Each folded entry keeps its own `clicked` wiring (the `clicked` OUTPUT is on `crt.MenuItem` in every checked version; the `handleItemClick` INPUT is not — it exists at 8.3.0 and is gone by 8.3.3, so it must not be emitted).",
  }),
  // RADIO_GROUP -> crt.IconRadioButton. `control` / `items` / `label` are all present in 8.3.0 onwards, so the
  // whole required config is derivable from the classic config: tier A. `compositeOnly: true` means the component
  // has no Designer-TOOLBAR entry — it does NOT mean the type is unusable: inserting it directly into the page
  // schema is valid, which is exactly what this engine emits.
  byItemType(VIEW_ITEM_TYPE.RADIO_GROUP, {
    role: ROLE.MAPPED, tier: TIER.AUTO, ownedBy: OWNER.TABLE, uiShape: "component",
    target: { componentType: "crt.IconRadioButton", slot: "items",
      propMap: { control: { from: SOURCE.VALUE_ATTR, required: true }, label: { from: SOURCE.CAPTION },
        // Required for a reason: a radio group emitted WITHOUT its options renders as an empty control, which is
        // the silent drop this row exists to prevent. No options ⇒ the instance degrades to a typed decision.
        items: { from: SOURCE.OPTION_CHILDREN, required: true } } },
    verify: { componentType: "crt.IconRadioButton" },
    uiShape: "component",
    notes: "The selection binds through the classic NESTED `value.bindTo`, not the top-level `bindTo` a field uses; the option sub-items (`value: true` / `value: false` children) become `items[]` and their captions the option captions. Emitting the binding WITHOUT the options would build a plain input and drop the captions with no warning.",
  }),
  // HYPERLINK -> crt.Link. The caption is derivable; the destination is not — a classic hyperlink navigates from
  // its click METHOD, so `href` cannot be read off the schema. `mode: "preventDefault"` is the registry's own
  // contract for exactly that case ("`href` is ignored and `clicked` fires instead"), so the emitted element is
  // honest about where the behaviour still has to come from: tier B.
  byItemType(VIEW_ITEM_TYPE.HYPERLINK, {
    role: ROLE.MAPPED, tier: TIER.VIEW_ONLY, ownedBy: OWNER.TABLE, uiShape: "component",
    target: { componentType: "crt.Link", slot: "items", events: { clicked: true },
      propMap: { caption: { from: SOURCE.CAPTION }, mode: { from: SOURCE.LITERAL, value: "preventDefault" } } },
    verify: { componentType: "crt.Link" },
    notes: "`crt.Label` has NO href/link input in any checked version, so a \"link-styled label\" is not a hyperlink target — `crt.Link` is (compositeOnly, present from 8.3.0). The classic click method becomes the `clicked` handler stub.",
  }),
  byItemType(VIEW_ITEM_TYPE.INFORMATION_BUTTON, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.COLOR_BUTTON, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.COMPONENT, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.GRID, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.SCHEDULE_EDIT, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.SECTION_VIEWS, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.SECTION_VIEW, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.DESIGN_VIEW, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  // The one member `generateStandardItem` has NO case for, so Classic renders it by its COLUMN's type. Mirroring
  // that would emit a silent `crt.Input`; the ⚠ instead states what Classic actually does (engine-internals.md).
  byItemType(VIEW_ITEM_TYPE.PROGRESS_BAR, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.IFRAMECONTROL, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
  byItemType(VIEW_ITEM_TYPE.EXTERNAL_WIDGET, { role: ROLE.UNMAPPED, tier: TIER.DECISION, ownedBy: OWNER.DECISION }),
];

export const MAPPING_ROWS = Object.freeze([...ITEM_TYPE_ROWS]);

// ---- resolution ---------------------------------------------------------------------------------------------
// `qualifiers` is a plain object of predicates over the CANDIDATE (`{ entity: "ApplicantVisa" }`, or a function).
// A qualifier row wins over an unqualified row for the same key, which is the precedence
// `ViewGeneratorV2.generateItem` itself applies (a `generator` override beats the itemType switch) and the one
// `FEATURE_CATALOG` needs: `VisaDetailV2` is still Approvals, not just a DETAIL.
function qualifiersMatch(qualifiers, candidate) {
  if (!qualifiers) return true;
  for (const [k, expected] of Object.entries(qualifiers)) {
    const actual = candidate?.[k];
    const ok = typeof expected === "function" ? !!expected(actual, candidate) : actual === expected;
    if (!ok) return false;
  }
  return true;
}

// The generic resolver every match kind goes through. `rows` is a parameter (not the module table) so the
// precedence rule is testable against a fixture table instead of only against whatever rows happen to exist.
// Returns the QUALIFIED match when there is one, else the unqualified row, else null.
export function resolveRow(rows, { by, key, candidate = null }) {
  let fallback = null;
  for (const r of rows || []) {
    if (r.match.by !== by) continue;
    const rowKey = r.match[by];
    if (by === MATCH.SCHEMA_SUFFIX) {
      if (typeof key !== "string" || !key.endsWith(rowKey)) continue;
    } else if (rowKey !== key) continue;
    if (!qualifiersMatch(r.match.qualifiers, candidate ?? { key })) continue;
    if (r.match.qualifiers) return r;   // a qualified row wins outright
    fallback ??= r;                     // ...otherwise remember the generic row and keep looking for one
  }
  return fallback;
}

// The row for a normalized diff item's stated kind, or null when the schema stated none (Classic reads a missing
// itemType as a field — absence is not a kind, and the caller's own null branch handles it).
export function rowForItem(item) {
  if (item?.itemType == null) return null;
  return resolveRow(MAPPING_ROWS, { by: MATCH.ITEM_TYPE, key: item.itemType, candidate: item });
}

// The row for a bare itemType VALUE, with NO fallback of any kind — `undefined` means the table has no entry for
// that member. This is what lets a golden witness the 29-member coverage instead of leaving it to a reader's
// tally: every convenience accessor above returns something truthy for a member nobody listed.
export function rowForItemType(itemType) {
  return MAPPING_ROWS.find(r => r.match.by === MATCH.ITEM_TYPE && r.match.itemType === itemType);
}
