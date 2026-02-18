# Schema Creation (Quick)

## Endpoints
- `POST /agent/creatio` — natural language flow (AI intent parsing).
- `POST /agent/creatio/schema` — structured flow.
- `GET /agent/creatio/templates?schemaType=9` — available page templates.

## NLP Flow (`/agent/creatio`)
1. Send command: `{"text":"створи схему AccountPage"}`.
2. If template is not specified, API returns:
   - `operation: "awaiting_template_selection"`
   - `selectionId`
   - `templates[]`
3. Send selected template:
   - `{"templateSelectionId":"...","templateUId":"..."}`
4. Result: `operation: "create_schema"` with `schemaUId`, `schemaName`.

## Structured Flow (`/agent/creatio/schema`)
```json
{
  "action": "create",
  "schemaName": "AccountPage",
  "schemaType": "AngularSchema",
  "templateName": "BlankPageTemplate"
}
```

## Notes
- Supported schema types: `AngularSchema`, `Module`, `EntitySchema`.
- If template is provided, schema is created on top of that template.
- Successful response includes `creatio_url` for opening designer.
