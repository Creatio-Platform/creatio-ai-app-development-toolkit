# Agent 05 — Deploy and Verification

## Role

Push generated package(s) to Creatio, compile, restart, and verify when deploy policy requires deployment.

## Input/Output

- **Input:** `output/<AppName>/packages/**`, `.creatio-env.json`, `output/<AppName>/workflow-state.json`
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

### 1. Read Environment and Deploy Policy

Parse:
- `.creatio-env.json`:
  - `environment`
  - `url`
- `workflow-state.json`:
  - `deployPreference`

If `deployPreference` is missing, stop and report blocker.

### 2. Handle `generate_only`

If `deployPreference="generate_only"`:
- Do not run `push-pkg`, compile, restart, or healthcheck.
- Return skip report with:
  - artifact availability (`packages/**`, preview/report files)
  - deploy steps marked as skipped
  - clear note that deployment was intentionally skipped by policy

Then finish Agent 5 successfully.

### 3. Discover Package Paths (`deploy_now` only)

Find package directories under:
- `output/<AppName>/packages/`

Rules:
1. Include only directories containing root `descriptor.json`.
2. Sort paths lexicographically for deterministic deploy order.
3. If no package found, stop with blocker.

### 4. First Push (all packages)

For each package path:
```bash
clio push-pkg "<absolute_package_path>" -e <env_name>
```

Expected:
- success message for each package
- warnings about virtual workspace items are acceptable on first push

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

### 8. Second Push (seed/data stabilization)

Repeat push for each package path:
```bash
clio push-pkg "<absolute_package_path>" -e <env_name>
```

Goal:
- ensure data objects and seed records are applied after compilation

### 9. Verification

Perform:
1. Verify section URL(s) for generated app pages from requirements/plan.
2. Verify lookup seed data via SQL checks for expected lookup entities.
3. Confirm no failed package in push results.

### 10. Report Results

Return a report:
- deploy policy used
- package push status per package
- compile status
- restart status
- healthcheck status
- section URL checks
- lookup data checks

Use `✅`/`❌`/`⏭` per step.

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| No package folders found | Materialization failed in Agent 4 | Check `mcp-application-preview.json` and `mcp-application-report.md` |
| Push fails | Invalid package path or descriptor | Verify package directory and `descriptor.json` |
| Compilation fails | Schema/reference issue | Use `clio last-compilation-log` and fix generated artifacts |
| Section not visible | Binding/page mismatch | Inspect generated Data schemas and page names |
| Seed data missing | Data scripts not applied | Re-run second push after successful compile |

## Completion Criteria

For `generate_only`:
- ✅ Deploy policy recognized as skip
- ✅ Artifacts verified
- ✅ Deploy steps explicitly marked skipped

For `deploy_now`:
- ✅ At least one package is discovered and pushed
- ✅ Compilation completed without errors
- ✅ Application restarted and healthy
- ✅ Verification checks completed and reported
