# Data Bindings Reference

Data bindings insert records into system tables to register sections, bind entities, and seed lookup data.

**📁 All column UIds → `context/bindings-lookup.json`**  
**📁 Complete examples → `templates/data-bindings/`**

---

## Structure

Each binding: `Data/<BindingName>/` with 3 files:
- `descriptor.json` — table definition + columns
- `data.json` — actual data rows  
- `filter.json` — usually `""`

---

## SysModule (Section Registration)

Registers section in navigation.

**Schema UId:** `2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5`

**Key columns (from bindings-lookup.json):**
- Id, Code, Caption, SysModuleEntity
- CardSchemaUId, SectionSchemaUId
- IconBackground, Type, FolderMode

**Standard values:**
- SectionModuleSchemaUId: `"12244568-6d4f-f201-ed26-ac3913021080"`
- CardModuleUId: `"c3382be3-6619-9256-2260-93d87cf0d9b5"`
- FolderMode: `"b659d704-3955-e011-981f-00155d043204"`

---

## SysModuleEntity (Entity Binding)

Links entity to section.

**Schema UId:** `9c762665-90ad-497b-ac4b-45bb729630a1`

**Key columns:**
- Id — new GUID (referenced by SysModule.SysModuleEntity)
- SysEntitySchemaUId — entity schema UId
- TypeColumnUId — `"null"` for standard entities

---

## Lookup Seed Data

Seeds lookup values (e.g., Status: New, In Progress, Done).

**Schema UId:** Your lookup entity schema UId

**Key columns:**
- Id — new GUID per value
- Name — display name
- Description — optional

**Example data.json:**
```json
{
  "PackageData": [
    {"Row": [
      {"SchemaColumnUId": "<Id-UId>", "Value": "<guid1>"},
      {"SchemaColumnUId": "<Name-UId>", "Value": "New"}
    ]},
    {"Row": [
      {"SchemaColumnUId": "<Id-UId>", "Value": "<guid2>"},
      {"SchemaColumnUId": "<Name-UId>", "Value": "In Progress"}
    ]}
  ]
}
```

---

## UId Calculation Logic

**SysModule record Id:**
```
Generate new GUID for each SysModule record
```

**SysModuleEntity record Id:**
```
Generate new GUID (this is referenced by SysModule.SysModuleEntity)
```

**Lookup seed Ids:**
```
Generate new GUID for each lookup value
```

---

**📁 For complete descriptor/data examples, see `templates/data-bindings/`**
