# Schema Creation (Quick)

## Endpoints
- `POST /agent/creatio` - LangGraph run/resume endpoint.
- `POST /agent/creatio/stream` - SSE stream of graph events.
- `GET /agent/creatio/state?threadId=<id>` - checkpoint/thread state.
- `POST /agent/creatio/schema` - structured create/extend API.
- `GET /agent/creatio/templates?schemaType=9` - page templates.
- `GET /agent/creatio/schema/health` - service health and runtime info.

## LangGraph NLP Flow
1. Start run:
```json
{ "text": "створи схему AccountPage" }
```
2. If template is required, response contains:
- `operation: "awaiting_template_selection"`
- `threadId`
- `selectionId` (equals `threadId`)
- `templates[]`
3. Resume run:
```json
{ "threadId": "...", "templateUId": "..." }
```
4. Final response:
- `operation: "create_schema"`
- `schemaUId`, `schemaName`, `creatio_url`

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
- Thread state is checkpointed in LangGraph checkpointer (MemorySaver runtime).
- Create operations support idempotency via `Idempotency-Key` header.
