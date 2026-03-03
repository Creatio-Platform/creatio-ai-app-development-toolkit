---
name: package-descriptor-creation
description: Generate package root descriptor.json for Creatio composable app packages.
compatibility: Requires context/essentials.md and templates/package/descriptor.json
metadata:
  version: "3.0"
  category: creatio-schema-generation
---

# Package Descriptor Generator

Generate the package manifest file at package root.

## Output

- `output/<AppName>/packages/<PackageName>/descriptor.json`

## Source Inputs

From `plan.md`:
- Package UId
- Package name

From context and template:
- `context/essentials.md`
- `templates/package/descriptor.json`

## Required Descriptor Shape

Use this structure:

```json
{
  "Descriptor": {
    "UId": "<package-guid>",
    "PackageVersion": "1.0.0",
    "Name": "<PackageName>",
    "ModifiedOnUtc": "/Date(<milliseconds>)/",
    "Type": 1,
    "Maintainer": "Customer",
    "DependsOn": []
  }
}
```

## Rules

1. `Name` must match package directory name exactly.
2. `UId` must be lowercase GUID and stable.
3. `PackageVersion` default is `1.0.0`.
4. `Type` must be `1`.
5. `DependsOn` default is empty array unless explicitly required.
6. `ModifiedOnUtc` must be current UTC milliseconds in `/Date(ms)/` format.

## Validation Checklist

- JSON valid
- Descriptor fields present and correctly typed
- Name/dir match
- Package UId matches `plan.md`
