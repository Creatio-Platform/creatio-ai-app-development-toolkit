# Skill: Addon Schema File Generator

## Role

You generate Creatio addon schema files that link entities to their form pages. For each addon you produce exactly **3 files** inside `Schemas/<AddonName>/`:

| File | Purpose |
|------|---------|
| `descriptor.json` | Schema identity, manager |
| `metadata.json` | Target entity and page binding |
| `properties.json` | Addon type and target reference |

## Input (from plan.md)

| Parameter | Description |
|-----------|-------------|
| `addonName` | Addon schema name (e.g., `UsrTodoTask_FormPage_Addon`) |
| `addonUId` | Pre-generated GUID for this addon |
| `targetEntityUId` | Schema UId of the target entity |
| `targetEntityName` | Name of the target entity (for caption) |
| `formPageUId` | Schema UId of the form page |
| `caption` | Human-readable caption |

## Context Files to Read

- `context/schema-types.md` — Addon file formats

## Template References

- `templates/addons/` — Addon template (descriptor, metadata, properties)

---

## Output File Formats

### 1. descriptor.json

```json
{
  "Descriptor": {
    "UId": "<addonUId>",
    "Name": "<addonName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "ManagerName": "AddonSchemaManager",
    "Caption": "<caption>"
  }
}
```

⚠️ **CRITICAL: Do NOT include a `Parent` field in addon descriptor.json.**

Creatio's `PackageFileStorage.ReadDescriptor` recursively reads nested descriptors. If you include `Parent: { Name: "" }`, it triggers `InvalidNameException` because `Descriptor.set_Name("")` validates that the name is non-empty. This causes `clio push-pkg` failures on re-deploy.

**Workaround:** Simply omit the `Parent` field entirely. Addons do not have parent schemas.

---

### 2. metadata.json

```json
{
  "MetaData": {
    "Schema": {
      "AD1": "<targetEntityUId>",
      "AD2": "EntitySchemaManager",
      "AD3": "RelatedPage",
      "AD4": {
        "Pages": [
          {
            "UId": "<formPageUId>",
            "Caption": "<entity display caption>"
          }
        ]
      }
    }
  }
}
```

**Field reference:**

| Field | Meaning | Value |
|-------|---------|-------|
| `AD1` | Target entity schema UId | The entity this addon is for |
| `AD2` | Target schema manager | Always `"EntitySchemaManager"` |
| `AD3` | Addon type | Always `"RelatedPage"` |
| `AD4` | Pages configuration | Object with `Pages` array |
| `AD4.Pages[].UId` | Form page schema UId | The page to open for this entity |
| `AD4.Pages[].Caption` | Page caption | Human-readable entity name |

**Multiple pages:** If an entity has multiple form pages (e.g., different pages for different record types), add multiple entries in the `Pages` array. For most cases, there is exactly one page.

---

### 3. properties.json

```json
{
  "Properties": {
    "AddonName": "RelatedPage",
    "TargetSchemaManagerName": "EntitySchemaManager",
    "TargetSchemaUId": "<targetEntityUId>"
  }
}
```

**Field reference:**

| Field | Meaning | Value |
|-------|---------|-------|
| `AddonName` | Type of addon | Always `"RelatedPage"` |
| `TargetSchemaManagerName` | Manager of the target schema | Always `"EntitySchemaManager"` |
| `TargetSchemaUId` | UId of the target entity schema | Must match `AD1` in metadata |

---

## When to Create Addons

Create one addon for **each main entity that has a form page**. Addons tell Creatio which form page to open when a user clicks on a record of that entity.

**Do NOT create addons for:**
- Lookup entities (BaseLookup) — they use the standard lookup editor, not a custom form page
- Entities without a dedicated form page

**Typical naming:** `<EntityName>_FormPage_Addon` (e.g., `UsrTodoTask_FormPage_Addon`)

---

## Critical Rules

1. **No `Parent` field in descriptor.json** — causes push failures (see warning above)
2. **`AD1` and `TargetSchemaUId` must match** — both point to the target entity schema UId
3. **`AD4.Pages[].UId` must be the form page schema UId** — not the list page
4. **`ManagerName` is `AddonSchemaManager`** — not EntitySchemaManager or ClientUnitSchemaManager
5. **`AD2` is always `EntitySchemaManager`** — this tells Creatio the target is an entity
6. **`AD3` is always `RelatedPage`** — this is the addon type for entity-to-page binding
7. **Caption in AD4 should be the entity display name** — e.g., "Todo Task", not the schema name
8. **One addon per entity** — even if the entity appears in multiple sections

## Generation Checklist

- [ ] `descriptor.json` has NO `Parent` field
- [ ] `descriptor.json` has `ManagerName: "AddonSchemaManager"`
- [ ] `metadata.json` `AD1` matches the target entity schema UId
- [ ] `metadata.json` `AD4.Pages[0].UId` matches the form page schema UId
- [ ] `properties.json` `TargetSchemaUId` matches `AD1`
- [ ] All three files use the same addon UId where applicable
- [ ] Files written to `Schemas/<addonName>/`
