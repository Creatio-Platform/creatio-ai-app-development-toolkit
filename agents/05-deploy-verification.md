# Agent 05 — Deploy and Verification

## Role

Run deploy verification for application creation:
- short DB-first contract: compile, restart, healthcheck
- legacy preview contract: materialize packages, push packages, compile, restart, healthcheck

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
  - `message`
  - `contractType`
  - `appId` (for short contract)
  - `previewPackages` (for preview contract)

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
2. if `contractType=short`, `appId` is a non-empty GUID
3. if `contractType=preview`, `previewPackages` is non-empty

If validation fails, stop with blocker.

### 4. Compatibility Package Push (`deploy_now` + `contractType=preview`)

If contract type is preview:

1. Materialize preview packages into:
   - `output/<AppName>/packages/<PackageName>/...`
2. For each generated package run:

```bash
clio push-pkg output/<AppName>/packages/<PackageName> -e <env_name>
```

On first push error, stop and report blocker.

If contract type is short, skip this step.

### 5. Compile

```bash
clio compile-configuration -e <env_name>
```

On error:
```bash
clio last-compilation-log -e <env_name>
```
Stop and report blocker.

### 6. Restart Application

```bash
clio restart-web-app -e <env_name>
```

Wait for restart completion.

### 7. Healthcheck

```bash
clio healthcheck -e <env_name>
```

If failed, stop and report blocker.

### 8. Report Results

Return a report:
- deploy policy used
- `application.create` result summary (`contractType`, `success`, `appId`, `message`)
- package push status (`applied`/`skipped`) and package count
- compile status
- restart status
- healthcheck status

Use `✅`/`❌`/`⏭` per step.

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| `mcp-application-result.json` missing | Agent 4 failed before persisting result | Check Agent 4 output and rerun |
| `success=false` in result | `application.create` failed | Fix payload/env issue and rerun Agent 4 |
| Preview contract without `previewPackages` | Agent 4 normalization is incomplete | Regenerate Agent 4 result with preview payload |
| `push-pkg` fails | Invalid materialized package content or environment issue | Inspect generated package folder and clio error |
| Compilation fails | Schema/reference issue in created artifacts | Use `clio last-compilation-log` and fix source issue |
| Healthcheck fails | App restart/runtime issue | Re-run restart, inspect environment health |

## Completion Criteria

For `generate_only`:
- ✅ Deploy policy recognized as skip
- ✅ Result/report artifacts verified
- ✅ Runtime steps explicitly marked skipped

For `deploy_now`:
- ✅ `application.create` result is successful (`success=true`) with contract-specific validation
- ✅ if preview contract is used, packages were materialized and pushed
- ✅ Compilation completed without errors
- ✅ Application restarted and healthy
