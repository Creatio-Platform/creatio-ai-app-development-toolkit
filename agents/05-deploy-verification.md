# Agent 05 — Deploy and Verification

## Role

Push package to Creatio, compile, verify.

## Input/Output

- **Input:** `output/<AppName>/packages/<PkgName>/`, `.creatio-env.json`
- **Output:** Deployment status report (pass/fail per step)

## Context

Read `AGENTS.md` for Context Files Reference (specifically `context/essentials.md` for clio commands).

---

## Steps

### 1. Read Environment

Parse `.creatio-env.json` → extract `environment` name.

### 2. Push Package

```bash
clio push-pkg "<absolute_path>" -e <env_name>
```

Expected: `"Package installed successfully"`  
⚠️ Warning `"Sample cannot be built for virtual workspace item"` is **NORMAL** (ignore).

### 3. Compile

```bash
clio compile-configuration -e <env_name>
```

May take 1-5 min. On error → get log:
```bash
clio last-compilation-log -e <env_name>
```

### 4. Restart Application

```bash
clio restart-web-app -e <env_name>
```

Wait for the restart to complete.

### 5. Healthcheck

```bash
clio healthcheck -e <env_name>
```

Verify the instance is healthy after restart.

### 6. Second Push — Seed Data

```bash
clio push-pkg "<absolute_path_to_package>" -e <env_name>
```

- After compilation, the database tables exist, so seed data (lookup values) should install without errors.
- **Expected output**: `"Package installed successfully"` with no warnings about virtual workspace items.

### 7. Verification

Perform all verification checks:

#### Section Visibility
Check that the new section is accessible:
```
<base_url>/Shell#<MainEntityName>_ListPage
```
Report the full URL to the developer.

#### Seed Data
For each lookup entity, verify data was loaded:
```bash
clio execute-sql-script "SELECT Id, Name FROM <LookupEntityName>" -e <env_name>
```

Confirm all expected records exist.

### 8. Report Results

Present a clear status report:

```
Deployment Report — <AppName>
================================
✅ Package pushed successfully
✅ Compilation successful
✅ Application restarted
✅ Healthcheck passed
✅ Seed data loaded
✅ Section accessible at: <base_url>/Shell#<EntityName>_ListPage

Lookup Data:
  UsrTaskStatus: New, In Progress, Done ✅
  UsrTaskPriority: Low, Medium, High, Critical ✅
```

If any step failed, use ❌ and include the error details.

## Known Issues

### Addon InvalidNameException on re-push
**Symptom**: `InvalidNameException` when pushing a package that was previously deployed.  
**Cause**: Addon `descriptor.json` contains `Parent: { Name: "" }` which Creatio rejects on update.  
**Workaround**: Remove the `Parent` field entirely from addon `descriptor.json` before re-pushing.

### Seed data fails on first push
**Symptom**: Warnings about virtual workspace items, seed data records not created.  
**Cause**: Database tables for new entities don't exist until after compilation.  
**Solution**: This is handled by the two-push strategy (Steps 2 + 6). The first push installs schemas, compilation creates tables, the second push installs seed data.

### Package dependency mismatch
**Symptom**: `"Missing dependencies"` error during push.  
**Cause**: `DependsOn` in `descriptor.json` references packages not present on the target instance.  
**Solution**: Set `DependsOn: []` in the package `descriptor.json` (done during implementation phase).

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| Push fails | Check path — must be absolute. Verify `descriptor.json` exists at package root. | Fix path or regenerate package skeleton. |
| Compilation fails | Run `clio last-compilation-log -e <env>`. | Check schema names match cross-references. Fix entity/page name mismatches. |
| Section not visible | Check `SysModuleEntity.SysEntitySchemaUId` matches entity. Check `SysModule.SectionSchemaUId` and `CardSchemaUId` match pages. | Fix data binding GUIDs and re-push. |
| Seed data missing after second push | Run SQL query to check table exists. | If table missing, compilation failed. Fix and recompile. |
| Need full re-deploy | Delete and start fresh. | `clio delete-pkg-remote <PkgName> -e <env>`, then repeat from Step 2. |

## Completion Criteria

✅ Package pushed successfully (both pushes)  
✅ Compilation completed without errors  
✅ Application restarted and healthy  
✅ Section accessible via URL  
✅ All seed data records present in database  
✅ Status report delivered to developer  
