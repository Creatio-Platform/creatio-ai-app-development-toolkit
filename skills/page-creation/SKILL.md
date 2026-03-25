---
name: page-creation
description: Generate Creatio Freedom UI page schema files from plan.md using templates/pages.
compatibility: Requires context/ui-reference.md, context/schema-reference.md, templates/pages/
metadata:
  version: "3.0"
  category: creatio-schema-generation
---

# Freedom UI Page Generator

Generate complete page schemas for list and form pages.

## Outputs

For each page, generate 4 files in `Schemas/<PageName>/`:
- `descriptor.json`
- `metadata.json`
- `properties.json`
- `<PageName>.js`

## Source Inputs

From `plan.md`:
- Page name and UId
- Page type (`ListPage` or `FormPage`)
- Target entity name
- Caption
- List columns or form field layout

From context and templates:
- `context/ui-reference.md`
- `context/schema-reference.md`
- `templates/pages/list-page/*`
- `templates/pages/form-page/*`

## Parent Templates

- List page parent: `ListPageV3Template` (`b7b898d0-8c77-4953-c097-23fa6800da02`)
- Form page parent: `PageWithTabsFreedomTemplate` (`3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9`)

## Generation Rules

1. Use matching list/form templates and replace placeholders.
2. Rename template JS file (`ListPage.js` or `FormPage.js`) to `<PageName>.js`.
3. Keep all `/**SCHEMA_...*/` markers in JS unchanged.
4. In list page JS:
   - Set `AddButton.clicked.params.entityName`
   - Define DataGrid `columns` with unique `id` GUIDs
   - Bind every grid column in `viewModelConfigDiff`
5. In form page JS:
   - Insert controls per layout row
   - Use control type by DVT (`crt.Input`, `crt.ComboBox`, `crt.DateTimePicker`, etc.)
   - Bind every field in `viewModelConfigDiff`
6. Set `modelConfigDiff.dataSources.PDS.config.entitySchemaName` to target entity.
7. `properties.json` must use `SchemaType: "AngularSchema"`.

## Validation Checklist

- Page name starts with `Usr`
- Parent template matches page type
- JS contains valid syntax
- Every UI field/column has matching attribute binding
- Data source entity name matches plan
- All generated JSON files are valid

## Post-Creation Customization

After generating page files, if `plan.md` specifies handlers, event reactions, or custom logic:

1. Deploy the generated page to Creatio (Agent 5)
2. Use **`skills/page-schema-editing/SKILL.md`** workflow to add handlers via MCP `page.*` tools
3. The `page-update` tool writes directly to the running DB — no recompile needed
4. For runtime `page-update` field sync, trust the live page body from `page-get` instead of template container names. Discover the primary field container by inspecting existing field-type inserts in `viewConfigDiff` — do not assume a fixed container name.

This keeps page *generation* (file templates) separate from page *customization* (runtime MCP edits).

## Output Path

`output/<AppName>/packages/<PackageName>/Schemas/<PageName>/`
