# U01 — NEW button opens one shared add form for all request types (single click, no type menu)

## What it is

The Requests section's **NEW** button adds a request in a single click. By platform default a typed
entity's NEW button opens a dropdown with one entry per registered record type — this entity has
**100+** registered types, so the default menu would be unusable. Here the dropdown never appears:
clicking NEW immediately opens the **one shared add form**, with the request type preset to a starting
value; the person then picks the actual **Type in the form itself**, and the form reshapes to that
type's fields. This works identically in both section display modes (list view and combined mode with
an open record).

## Business logic

*Author's wording to confirm:* with over a hundred request types, choosing the type from a button
dropdown is not workable — the type choice is itself a form-sized decision. The design moves the
choice into the shared request form: one entry point, then the form guides the person through picking
what kind of request this is and shows the fields that kind needs.

## sourceRef (members)

| Kind | Schema | Package | Lines | What it contributes |
| --- | --- | --- | --- | --- |
| customization | `InternalRequestSection` | WorkInternalRequest | 10–35 | **diff merge `SeparateModeAddRecordButton`** — the section-view button<br>keeps caption → `AddRecordButtonCaption` · click → `addRecord` · visible → `IsAddRecordButtonVisible` · green style<br>re-binds `controlConfig.menu.items` → `EditPages` **through converter `getEmptyControlConfigMenu`** — the type menu is always empty |
| customization | `InternalRequestSection` | WorkInternalRequest | 36–60 | **diff merge `CombinedModeAddRecordButton`** — the same menu-emptying re-bind for combined mode (record open beside the list) |
| customization | `InternalRequestSection` | WorkInternalRequest | 167–176 | **method `addRecord` (override)** — makes the plain click work: when the entity has page registrations, takes the **first** entry of the `EditPages` collection, forces its `$MiniPage.hasAddMiniPage = true`, and passes that entry's type id to the base handler |
| customization | `InternalRequestSection` | WorkInternalRequest | 246–248 | **method `getEmptyControlConfigMenu`** — returns `null`; the converter both merges bind the menu through |
| context | `BaseDataView` | CrtUIPlatform7x | 7341–7373, 6921–6956 | **base button inserts** — the platform default this behaviour suppresses: `controlConfig.menu.items` ← `EditPages` when more than one page is registered (inline converter), i.e. the per-type dropdown |
| context | `BaseDataView` | CrtUIPlatform7x | 1969–2003 | **base method `addRecord`** — without a type id and with multiple registrations **returns false** (a plain click does nothing by default — the override exists to defeat exactly this); with a type id: add-mini-page flag set → `openAddMiniPage` with the type preset, otherwise the full add page with the type preset |
| context | `BaseDataView` | CrtUIPlatform7x | 2010–2020 | **method `getAddMiniPageDefaultValues`** — the preset mechanism: `[{ <TypeColumnName>: <type id> }]` handed to the opened form |
| context | `BaseDataView` | CrtUIPlatform7x | 2898–2915 | **method `initAddRecordButtonParameters`** — with multiple registrations the button caption is the generic resource `AddRecordButtonCaption`; a type-specific caption is substituted only when exactly one page is registered |
| context | `WorkInternalRequestMiniPage` | WorkInternalRequest | 20–37, 2815–2872, 1193–1226 | **the shared add form's Type field** — `Type` attribute with `dependencies → onTypeChange`; two Type controls in the layout (`TypeDropdown` ENUM / `TypeLookup` LOOKUP, switched by category); `onTypeChange` reshapes the form per chosen type |
| registry | `SysModuleEdit` | — | — | **per-type page registrations for `InternalRequest`** — 100+ types; **all** registrations share `WorkInternalRequestMiniPage` as the mini page; the add-mode flag on the mini-page registration varies per type (present on some, absent on others) |
| resource | `BaseDataView` | CrtUIPlatform7x | — | **strings** — `AddRecordButtonCaption` (en-US **"New"**; merged section resources). The unit adds **no strings of its own** (counted zero) |

## Code (verbatim — the four customization members)

> Copied unchanged from `InternalRequestSection [WorkInternalRequest]`. This is the concrete
> occurrence backing the sourceRef rows; elsewhere the same behaviour may differ in customer-owned
> names (converter name, package) while keeping the platform anchors
> (`SeparateModeAddRecordButton`, `CombinedModeAddRecordButton`, `addRecord`, `EditPages`,
> `controlConfig.menu`).

**Diff — the two menu-emptying merges** (lines 10–60; the combined-mode merge is identical except it
carries no `style`):

```js
{
    "operation": "merge",
    "name": "SeparateModeAddRecordButton",
    "propertyName": "items",
    "values": {
        "itemType": Terrasoft.ViewItemType.BUTTON,
        "style": Terrasoft.controls.ButtonEnums.style.GREEN,
        "caption": {"bindTo": "AddRecordButtonCaption"},
        "click": {"bindTo": "addRecord"},
        "visible": {"bindTo": "IsAddRecordButtonVisible"},
        "classes": {
            "textClass": ["actions-button-margin-right"],
            "wrapperClass": ["actions-button-margin-right"]
        },
        "controlConfig": {
            "menu": {
                "items": {
                    "bindTo": "EditPages",
                    "bindConfig": {
                        "converter": "getEmptyControlConfigMenu"
                    }
                }
            }
        }
    }
},
{
    "operation": "merge",
    "name": "CombinedModeAddRecordButton",
    // ...same values minus "style": caption/click/visible bindings kept,
    // controlConfig.menu.items -> EditPages via getEmptyControlConfigMenu
}
```

**Methods — the routing override and the converter** (lines 167–176, 246–248):

```js
addRecord: function(typeColumnValue) {
    var editPages = this.get("EditPages");
    if (editPages && !editPages.isEmpty()) {
        var firstPage = editPages.first();
        firstPage.$MiniPage.hasAddMiniPage = true;
        typeColumnValue = firstPage.get("Id");
    }

    this.callParent([typeColumnValue]);
},

getEmptyControlConfigMenu: function() {
    return null;
},
```

## Assumption? — YES

1. **How the forced flag satisfies the platform check:** the override writes
   `firstPage.$MiniPage.hasAddMiniPage = true` and the base `addRecord` branches on
   `this.hasAddMiniPage(typeColumnValue)` — but `hasAddMiniPage`'s body is not in the fetched
   `BaseDataView` seed, so the exact read linking the two is unproven here. Settling query: locate the
   platform module defining `hasAddMiniPage` / `getMiniPageSchemaName` (candidates: the full
   `BaseDataView` chain, `GridUtilitiesV2`, mini-page utilities) and confirm it reads the edit-page
   view model's `MiniPage` config.
2. **Which registration is "first":** the preset type id is `EditPages.first()` — proven; what
   ordering the `EditPages` collection carries (and therefore which of the 100+ types is the starting
   value) is not. Settling query: read `initEditPages` / the module-structure query that fills
   `EditPages` and its sort.

## Acceptance criteria

- **AC-1** — Clicking the section's add-record button in the **section (list) view** opens **no type menu** — the click acts immediately
- **AC-2** — The same single-click, no-menu behaviour holds in **combined mode** (a record open beside the list)
- **AC-3** — The plain click is **never a dead click**: with page registrations present it routes to the type id of the **first entry of the entity's page-registration collection**
- **AC-4** — The click opens the entity's **one shared add form** — in this occurrence `WorkInternalRequestMiniPage`, shared by every registration ⟵ *parameter: read from the target environment's registrations* — with the **type preset** to the routed registration's type
- **AC-5** — The **type is chosen in the form**: the shared form carries an editable **Type** field (two controls switched by category) and **reshapes itself when the type changes**
- **AC-6** — The button caption stays the **generic "New"** (resource `AddRecordButtonCaption`, en-US "New") — with many registrations the platform never substitutes a per-type caption
- **AC-7** — The button keeps the **platform's own visibility and styling**: visible ← `IsAddRecordButtonVisible`, green style in section view — the customization changes only the menu and the routing

## Mechanism notes (supporting, not authoritative)

**Two cooperating parts — remove either and the behaviour breaks differently.** The menu-emptying
merges alone would leave a **dead button**: the base `addRecord` returns false for a plain click when
multiple pages are registered (it expects the dropdown to supply the type). The `addRecord` override
alone would leave the **dropdown in place**: the base button converter shows the menu whenever more
than one page is registered. Single-click behaviour needs both.

**The override bypasses per-type add-mode registration.** The stand's registrations carry the
add-mini-page mode on some types and not others; by forcing `hasAddMiniPage = true` on the routed
entry, the customization guarantees the shared form opens regardless of how the routed type's
registration is flagged.

**The preset type is a starting value, not a decision.** The routed type id only determines what the
Type field shows when the form opens; the form's own `onTypeChange` machinery treats the field as the
real choice and rebuilds the form around whatever the person picks.
