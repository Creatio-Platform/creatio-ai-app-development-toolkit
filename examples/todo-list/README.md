# Todo List — Example

Reference example for the business-first, natural-language workflow.

## Files

- `input.md` — Original developer prompt
- `requirements.md` — Locked business decisions + assumptions + implementation requirements
- `request-spec.json` — Normalized prompt data, checklist completeness, technical inputs, assumptions
- `plan.md` — Execution plan with resolved MCP payload
- `output/` — Materialized package files from preview response

## Conversation Pattern

1. Developer sends one free-form prompt.
2. Agent responds with “What I understood”.
3. Agent asks business clarifications in batches until checklist is complete.
4. Agent asks minimal technical blockers + deploy preference (`deploy_now` or `generate_only`).
5. Agent generates artifacts and deploys or skips deploy by policy.

## Example Business Clarification Dialogue

Developer:
```text
Generate a Todo List composable app for task tracking.
```

Agent:
```text
What I understood:
- You need a lightweight Todo app for task lifecycle tracking.
- Core flow is create/update tasks and monitor status changes.

To lock business requirements, please уточніть:
1) Бізнес-результат: як визначимо успіх (KPI або expected outcome)?
2) Ролі: хто створює задачі, хто закриває?
3) Життєвий цикл: які статуси та чи є обмеження переходів?
```

Developer:
```text
Success = 100% tasks tracked in one place. Managers and specialists use it.
Statuses: New, In Progress, Done. Only manager can set Done.
```

Agent:
```text
What I understood:
- KPI: all tasks tracked in one section.
- Roles: specialists create/update, managers can close tasks.
- Lifecycle: New -> In Progress -> Done, restricted final transition.

Missing for completion:
- required/default fields and validations
- list/form expectations
- edge cases and acceptance checks

Technical blocker check:
- Creatio URL?
- Deploy preference: deploy_now or generate_only?
```

## Example Prompt

```text
Create a Todo List app with tasks, statuses, priorities, and due dates.
Users should manage tasks through a list and form page and track task lifecycle.
```

## MCP Flow Demonstrated

1. Build `application.create` payload from requirements and request spec
2. Call MCP tool `application.create`
3. Save raw preview response
4. Materialize returned package files locally
5. Deploy generated package with `clio push-pkg` (or skip by policy)

## Example Deploy

```bash
clio push-pkg "path/to/output/packages/UsrTodoList" -e <your_env>
clio compile-configuration -e <your_env>
clio restart-web-app -e <your_env>
```

## Notes

- Preview generation itself does not persist data to DB.
- Deployment phase applies generated schemas and data to the target environment.
