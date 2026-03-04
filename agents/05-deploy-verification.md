# Agent 05 — Deploy and Verification

## Role

Push generated package(s) to Creatio, compile, restart, and verify.

## Input/Output

- **Input:** `output/<AppName>/packages/**`, `.creatio-env.json`, `output/<AppName>/workflow-state.json`
- **Output:** Deployment status report (pass/fail per step)

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

### 1. Read Environment

Parse `.creatio-env.json` and extract:
- `environment`
- `url`

### 2. Discover package paths

Find package directories under:
- `output/<AppName>/packages/`

Rules:
1. Include only directories containing root `descriptor.json`.
2. Sort paths lexicographically for deterministic deploy order.
3. If no package found, stop with blocker.

### 3. First Push (all packages)

For each package path:
```bash
clio push-pkg "<absolute_package_path>" -e <env_name>
```

Expected:
- success message for each package
- warnings about virtual workspace items are acceptable on first push

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

### 7. Second Push (seed/data stabilization)

Repeat push for each package path:
```bash
clio push-pkg "<absolute_package_path>" -e <env_name>
```

Goal:
- ensure data objects and seed records are applied after compilation

### 8. Verification

Perform:
1. Verify section URL(s) for generated app pages from requirements/plan.
2. Verify lookup seed data via SQL checks for expected lookup entities.
3. Confirm no failed package in push results.

### 9. Report Results

Return a report:
- package push status per package
- compile status
- restart status
- healthcheck status
- section URL checks
- lookup data checks

Use `✅`/`❌` per step.

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| No package folders found | Materialization failed in Agent 4 | Check `mcp-application-preview.json` and `mcp-application-report.md` |
| Push fails | Invalid package path or descriptor | Verify package directory and `descriptor.json` |
| Compilation fails | Schema/reference issue | Use `clio last-compilation-log` and fix generated artifacts |
| Section not visible | Binding/page mismatch | Inspect generated Data schemas and page names |
| Seed data missing | Data scripts not applied | Re-run second push after successful compile |

## Completion Criteria

✅ `workflow-state.json` confirms Gate R approval  
✅ At least one package is discovered and pushed  
✅ Compilation completed without errors  
✅ Application restarted and healthy  
✅ Verification checks completed and reported  
