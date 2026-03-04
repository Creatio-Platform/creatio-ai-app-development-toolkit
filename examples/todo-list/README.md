# Todo List — Example

This is a reference implementation of a Todo List app generated through MCP `application.create` preview flow.

## Files

- `input.md` — Original developer request
- `requirements.md` — Structured requirements including MCP app-create input
- `plan.md` — Execution plan with resolved MCP payload
- `output/` — Materialized package files from preview response

## MCP Flow Demonstrated

1. Build `application.create` payload from requirements
2. Call MCP tool `application.create`
3. Save raw preview response
4. Materialize returned package files locally
5. Deploy generated package with `clio push-pkg`

## Example Deploy

```bash
clio push-pkg "path/to/output/packages/UsrTodoList" -e <your_env>
clio compile-configuration -e <your_env>
clio restart-web-app -e <your_env>
```

## Notes

- Preview generation itself does not persist data to DB.
- Deployment phase applies generated schemas and data to the target environment.
