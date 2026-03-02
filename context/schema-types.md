# Creatio Schema Types

## Overview

Every schema in Creatio consists of multiple files in a folder `Schemas/<SchemaName>/`:

| Schema Type | ManagerName | Files |
|-------------|------------|-------|
| Entity | `EntitySchemaManager` | descriptor.json + metadata.json + properties.json |
| Page (ClientUnit) | `ClientUnitSchemaManager` | descriptor.json + metadata.json + properties.json + `<Name>.js` |
| Addon | `AddonSchemaManager` | descriptor.json + metadata.json + properties.json |

---

## Entity Schema (3 files)

### descriptor.json
```json
{
  "Descriptor": {
    "UId": "<entity-guid>",
    "Name": "UsrTodoTask",
    "ModifiedOnUtc": "/Date(1700000000000)/",
    "Parent": {
      "UId": "1bab9dcf-17d5-49f8-9536-8e0064f1dce0",
      "Name": "BaseEntity"
    },
    "ManagerName": "EntitySchemaManager",
    "Caption": "Todo Task",
    "DependsOn": []
  }
}
```

**Notes:**
- `Parent.UId` — UId of parent entity (see `entity-types.md` for KNOWN_PARENTS)
- For new entities: NO `ExtendParent` field
- For extending existing entities: add `"ExtendParent": true`

### metadata.json (DSL Diff Format)

Entity metadata uses a **DSL diff format** — NOT plain JSON. Each line has an operator:

| Operator | Meaning |
|----------|---------|
| `=` | Set/unchanged value |
| `+` | Add new value |
| `-` | Remove value |
| `~` | Reorder array |

#### Example: New entity with one Integer column (extends BaseEntity)

```
= MetaData.Schema.UId "<entity-guid>"
= MetaData.Schema.A2 "UsrTodoTask"
= MetaData.Schema.A5 "<package-guid>"
= MetaData.Schema.B6 "<dependency-package-guid>"
= MetaData.Schema.EG1.UId "<events-process-guid>"
= MetaData.Schema.EG1.A2 "Entity_<hash>EventsProcess"
= MetaData.Schema.EG1.A5 "<package-guid>"
+ MetaData.Schema.EG1.B8 "0.0.0.0"
= MetaData.Schema.EG1.BK8 "<process-schema-guid>"
= MetaData.Schema.D8 "1bab9dcf-17d5-49f8-9536-8e0064f1dce0"
+ MetaData.Schema.D29 "null"
+ MetaData.Schema.D30 "null"
+ MetaData.Schema.D31 "null"
+ MetaData.Schema.D2 {
  "UId": "<column-guid>",
  "A2": "UsrTitle",
  "A3": "<entity-guid>",
  "A4": "<entity-guid>",
  "A5": "<package-guid>",
  "S2": "ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd"
}
~ MetaData.Schema.D2 [
  "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",
  "e80190a5-03b2-4095-90f7-a193a960adee",
  "ebf6bb93-8aa6-4a01-900d-c6ea67affe21",
  "9928edec-4272-425a-93bb-48743fee4b04",
  "3015559e-cbc6-406a-88af-07f7930be832",
  "3fabd836-6a53-4d8d-9069-6df88d9dae1e",
  "<column-guid>"
]
= MetaData.Schema.D20.A2 "UsrTodoTaskEvents"
+ MetaData.Schema.D20.FA1 false
+ MetaData.Schema.D20.FA2 false
+ MetaData.Schema.D20.FA3 false
= MetaData.Schema.D20.FA4 false
= MetaData.Schema.D20.FA5 false
= MetaData.Schema.D20.FA6 false
= MetaData.Schema.D20.FA7 false
+ MetaData.Schema.D20.FA8 false
+ MetaData.Schema.D20.FA9 false
+ MetaData.Schema.D20.FA10 false
= MetaData.Schema.D20.FA11 false
= MetaData.Schema.D20.FA12 false
+ MetaData.Schema.D20.FA16 false
+ MetaData.Schema.D20.FA13 false
+ MetaData.Schema.D20.FA14 false
= MetaData.Schema.D20.FA15 false
+ MetaData.Schema.D20.FA17 false
= MetaData.Schema.D36.A3 "<entity-guid>"
= MetaData.Schema.D36.BS1 false
+ MetaData.Schema.B7 false
+ MetaData.Schema.D2.["ae0e45ca-c495-4fe7-a39d-3ab7278e1617"].E16 false
+ MetaData.Schema.D2.["e80190a5-03b2-4095-90f7-a193a960adee"].E16 false
+ MetaData.Schema.D2.["ebf6bb93-8aa6-4a01-900d-c6ea67affe21"].E16 false
+ MetaData.Schema.D2.["9928edec-4272-425a-93bb-48743fee4b04"].E16 false
+ MetaData.Schema.D2.["3015559e-cbc6-406a-88af-07f7930be832"].E16 false
+ MetaData.Schema.D2.["3fabd836-6a53-4d8d-9069-6df88d9dae1e"].E16 false
```

#### Column Definition Fields

| Field | Meaning | Example |
|-------|---------|---------|
| `UId` | Column unique identifier | `"36f88285-a2ba-ccaa-2ed5-1879c3a12d8a"` |
| `A2` | Column name | `"UsrTitle"` |
| `A3` | Schema UId (this entity) | `"<entity-guid>"` |
| `A4` | Schema UId (this entity) | `"<entity-guid>"` |
| `A5` | Package UId | `"<package-guid>"` |
| `S2` | DataValueType GUID | `"ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd"` (ShortText) |

#### Lookup Column (additional fields)

```
+ MetaData.Schema.D2 {
  "UId": "<column-guid>",
  "A2": "UsrStatus",
  "A3": "<entity-guid>",
  "A4": "<entity-guid>",
  "A5": "<package-guid>",
  "S2": "b295071f-7ea9-4e62-8d1a-919bf3732ff2",
  "S4": "<referenced-entity-schema-uid>",
  "E6": true,
  "E9": true,
  "E17": "UsrStatusId",
  "E18": "UsrStatusName"
}
```

| Field | Meaning |
|-------|---------|
| `S4` | Referenced entity schema UId |
| `E6` | Is lookup (always `true`) |
| `E9` | Visible in forms |
| `E17` | Foreign key column name (usually `<ColumnName>Id`) |
| `E18` | Display column name (usually `<ColumnName>Name` or `<ColumnName>Title`) |

#### Key Metadata Fields

| Path | Meaning |
|------|---------|
| `MetaData.Schema.UId` | Entity schema UId |
| `MetaData.Schema.A2` | Entity name |
| `MetaData.Schema.A5` | Package UId |
| `MetaData.Schema.D8` | Parent entity UId |
| `MetaData.Schema.D2` | Columns array |
| `MetaData.Schema.D20` | Event handler configuration |
| `MetaData.Schema.D36` | Admin rights configuration |
| `MetaData.Schema.B7` | UseLiveEditing flag |
| `MetaData.Schema.EG1` | Events process reference |

### properties.json

```json
{
  "Properties": {
    "AdministratedByColumns": "False",
    "AdministratedByOperations": "False",
    "AdministratedByRecords": "False",
    "CreatedInVersion": "0.0.0.0",
    "IsSSPAvailable": "False",
    "IsTrackChangesInDB": "False",
    "IsVirtual": "False",
    "UseLiveEditing": "False"
  }
}
```

---

## Page Schema (ClientUnit) — 4 files

### descriptor.json

```json
{
  "Descriptor": {
    "UId": "<page-guid>",
    "Name": "UsrTodoTask_ListPage",
    "ModifiedOnUtc": "/Date(1700000000000)/",
    "Parent": {
      "UId": "b7b898d0-8c77-4953-c097-23fa6800da02",
      "Name": "ListPageV3Template"
    },
    "ManagerName": "ClientUnitSchemaManager",
    "Caption": "Todo Tasks list page"
  }
}
```

**Parent types for pages:**
- List page: `ListPageV3Template` (`b7b898d0-...`)
- Form page with tabs: `PageWithTabsFreedomTemplate` (`3b2e117f-...`)
- Form page with right area + tabs: `PageWithRightAreaAndTabsFreedomTemplate` (`5f8dd430-...`)
- Light form: `LightFormPage` (`ec5fd902-...`)

### metadata.json (for NEW pages — full JSON, NOT diff!)

For **new** ClientUnit schemas (not ExtendParent), metadata.json is full JSON:

```json
{
  "MetaData": {
    "Schema": {
      "B2": {}
    }
  }
}
```

For **ExtendParent** pages, metadata.json uses DSL diff format (same as entities).

### properties.json

```json
{
  "Properties": {
    "CreatedInVersion": "0.0.0.0",
    "Group": "Page",
    "SchemaType": "AngularSchema"
  }
}
```

### <Name>.js (AMD Module)

```javascript
define("UsrTodoTask_ListPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			// UI operations: merge, insert, remove, move
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
			// Attribute bindings
		]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
			// Data source configuration
		]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});
```

---

## Addon Schema (3 files)

Addons link entities to pages (e.g., "this entity's form page is X").

### descriptor.json

```json
{
  "Descriptor": {
    "UId": "<addon-guid>",
    "Name": "UsrTodoTask_FormPage_Addon",
    "ModifiedOnUtc": "/Date(1700000000000)/",
    "ManagerName": "AddonSchemaManager",
    "Caption": "UsrTodoTask Form Page Addon"
  }
}
```

### metadata.json (full JSON)

```json
{
  "MetaData": {
    "Schema": {
      "AD1": "<target-entity-schema-uid>",
      "AD2": "EntitySchemaManager",
      "AD3": "RelatedPage",
      "AD4": {
        "Pages": [
          {
            "UId": "<page-schema-uid>",
            "Caption": "Todo Task"
          }
        ]
      }
    }
  }
}
```

### properties.json

```json
{
  "Properties": {
    "AddonName": "RelatedPage",
    "TargetSchemaManagerName": "EntitySchemaManager",
    "TargetSchemaUId": "<target-entity-schema-uid>"
  }
}
```

---

## Summary: File Count per Schema Type

| Type | descriptor.json | metadata.json | properties.json | .js | Total |
|------|:-:|:-:|:-:|:-:|:-:|
| Entity | ✅ | ✅ (DSL diff) | ✅ | — | 3 |
| Page (new) | ✅ | ✅ (full JSON) | ✅ | ✅ | 4 |
| Page (extend) | ✅ | ✅ (DSL diff) | ✅ | ✅ | 4 |
| Addon | ✅ | ✅ (full JSON) | ✅ | — | 3 |
