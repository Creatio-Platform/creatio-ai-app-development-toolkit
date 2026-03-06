# Agent 05 — Deploy and Verification

## Role

Run deploy verification for short DB-first application creation:
- short contract: compile, restart, healthcheck

## Input/Output

- **Input:** `output/<AppName>/.creatio-env.json`, `output/<AppName>/workflow-state.json`, `output/<AppName>/mcp-application-result.json`
- **Output:** Deployment status report (pass/fail/skip per step)

## Context

Read `AGENTS.md` and `context/essentials.md` for clio commands.

---

## Steps

### 0. Check Gate R Precondition (MANDATORY)

Run:
```bash
scripts/check-approval-gate.sh <AppName>
```

If command fails, stop immediately and report blocker.

### 1. Read Environment, Policy, and MCP Result

Parse:
- `.creatio-env.json`:
  - `environment`
  - `url`
- `workflow-state.json`:
  - `deployPreference`
- `mcp-application-result.json`:
  - `success`
  - `contractType`
  - `app.id`
  - `packages`

If any required field is missing, stop and report blocker.

### 2. Handle `generate_only`

If `deployPreference="generate_only"`:
- Do not run compile, restart, or healthcheck.
- Return skip report with:
  - artifact availability (`mcp-application-result.json`, `mcp-application-report.md`)
  - runtime steps marked as skipped
  - clear note that deployment was intentionally skipped by policy

Then finish Agent 5 successfully.

### 3. Validate Create Result (`deploy_now` only)

Before runtime checks, verify:
1. `mcp-application-result.json.success=true`
2. `contractType=short`
3. `app.id` is a non-empty GUID
4. `packages` is non-empty

If validation fails, stop with blocker.

### 4. Compile

```bash
clio compile-configuration -e <env_name>
```

On error:
```bash
clio last-compilation-log -e <env_name>
```
Stop and report blocker.

### 5. Restart Application

```bash
clio restart-web-app -e <env_name>
```

Wait for restart completion.

### 6. Healthcheck

```bash
clio healthcheck -e <env_name>
```

If failed, stop and report blocker.

### 7. Report Results

Return a report:
- deploy policy used
- `application.create` result summary (`contractType=short`, `success`, `app.id`)
- compile status
- restart status
- healthcheck status

Use `✅`/`❌`/`⏭` per step.

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| `mcp-application-result.json` missing | Agent 4 failed before persisting result | Check Agent 4 output and rerun |
| `success=false` in result | `application.create` failed | Fix payload/env issue and rerun Agent 4 |
| `contractType` is not `short` | Result contract is outdated or malformed | Regenerate Agent 4 result with current MCP output |
| Short contract without `packages` | Agent 4 normalization or merge is incomplete | Regenerate Agent 4 result and verify schema sync merge |
| Compilation fails | Schema/reference issue in created artifacts | Use `clio last-compilation-log` and fix source issue |
| Healthcheck fails | App restart/runtime issue | Re-run restart, inspect environment health |

## Completion Criteria

For `generate_only`:
- ✅ Deploy policy recognized as skip
- ✅ Result/report artifacts verified
- ✅ Runtime steps explicitly marked skipped

For `deploy_now`:
- ✅ `application.create` result is successful (`success=true`) with short-contract validation
- ✅ Compilation completed without errors
- ✅ Application restarted and healthy
