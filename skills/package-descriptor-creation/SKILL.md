---
name: package-descriptor-creation
description: Generate Creatio package descriptor.json file. Use at the start of implementation
compatibility: Requires access to context/essentials.md for package structure
metadata:
  version: "2.0"
  category: creatio-schema-generation
---

# Package Descriptor Generator

Generate the root `descriptor.json` file for Creatio composable app packages. This is the package manifest that defines identity, dependencies, and configuration.

## What This Skill Does

Transforms package definition from `plan.md` into a properly formatted Creatio package descriptor:
- **descriptor.json**

## When to Use

Use this skill when:
- Starting implementation of a new composable app
- Creating the package skeleton before adding schemas
- Need exact Creatio package descriptor format

This is typically the **first** skill invoked during Agent 4 (Implementation).

## Input Expected

From `plan.md`, you need:
- Package name (e.g., `TodoApp`)
- Package UId (pre-generated GUID)
- Maintainer (e.g., "YourCompany")
- Description (brief package description)
- Version (default: "1.0.0")
- Dependencies (usually none for custom apps, or standard Creatio packages)

## Context to Read First

Before generating, read:
- `context/essentials.md`

---

## How It Works

### Package Descriptor Format

Use this exact structure:

```json
{
  "Descriptor": {
    "UId": "<packageUId>",
    "Name": "<packageName>",
    "CreatedInVersion": "0.0.0.0",
    "ModifiedInVersion": "0.0.0.0",
    "Caption": "<packageName>",
    "Description": "<description>",
    "Maintainer": "<maintainer>",
    "PackageVersion": "<version>",
    "DependsOn": []
  }
}
```

Note:

- **UId**
  - Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
  - Must be lowercase with dashes
  - Generated once, never changes

- **Name**
  - Must match directory name
  - PascalCase, no spaces (e.g., `TodoApp`, not `Todo App`)
  - Appears in clio commands and package manager

- **Caption**
  - Can have spaces (e.g., "Todo Application")
  - Shown in UI when browsing packages
  - Often same as Name for simplicity

- **Description**
  - One sentence describing what the app does
  - E.g., "Task management application with priority tracking"

- **Maintainer**
  - Your company or username
  - E.g., "Acme Corp" or "john.doe"

- **PackageVersion**
  - Format: "major.minor.patch" (e.g., "1.0.0")
  - Start with "1.0.0" for new apps
  - Increment for updates (see semver.org)

- **CreatedInVersion** / **ModifiedInVersion**
  - Always "0.0.0.0" for custom packages
  - Only used internally by Creatio for platform packages

- **DependsOn**
  - Usually `[]` (empty) for composable apps
  - Composable apps are self-contained
  - Only add dependencies if extending existing packages

**When to add dependencies:**

If your app extends standard Creatio entities or pages:

```json
"DependsOn": [
  {
    "UId": "50e3acc0-26fc-4237-a095-849a1d534bd3",
    "Name": "Studio",
    "Version": "8.2.0"
  }
]
```

**Common Creatio package UIds:**
- Studio: `50e3acc0-26fc-4237-a095-849a1d534bd3`
- CrtBase: `b5c726f2-af5b-4381-bac6-913074144308`

---

## Directory Structure

The descriptor.json is created at the package root:

```
output/<AppName>/
└── packages/
    └── <PackageName>/
        ├── descriptor.json  ← This skill creates this file
        ├── Schemas/         ← Created by entity-creation/page-creation skills
        └── SqlScripts/      ← Created by data-bindings-creation skill
```

Note:
- Creatio expects descriptor.json at package root
- `clio push-pkg` reads this file to identify the package
- All other files (schemas, scripts) are subdirectories

---

## Critical Rules

**Package name MUST match directory:**
- If directory is `TodoApp`, Name must be `"TodoApp"`
- Clio validates this match

**UId is permanent:**
- Once generated, never change the package UId
- Changing it creates a different package (Creatio won't recognize it as an update)

**Version follows semver:**
- Format: "X.Y.Z" where X, Y, Z are integers
- Major.Minor.Patch
- Start with "1.0.0", increment Minor for new features, Patch for fixes

**DependsOn requires exact version:**
- If you add dependencies, include exact version numbers
- Mismatched versions cause deployment failures

---

## Validation Checklist

Before finalizing descriptor.json, verify:

- ✅ Package UId is lowercase GUID with dashes
- ✅ Name matches directory name exactly
- ✅ PackageVersion is valid semver (X.Y.Z)
- ✅ DependsOn array is empty `[]` (unless extending platform packages)
- ✅ Maintainer is non-empty string
- ✅ Description is brief (1 sentence)

---

## Example Output

For a Todo application:

```json
{
  "Descriptor": {
    "UId": "a1b2c3d4-e5f6-4789-abcd-1234567890ab",
    "Name": "TodoApp",
    "CreatedInVersion": "0.0.0.0",
    "ModifiedInVersion": "0.0.0.0",
    "Caption": "Todo Application",
    "Description": "Task management system with priorities and categories",
    "Maintainer": "Acme Corp",
    "PackageVersion": "1.0.0",
    "DependsOn": []
  }
}
```

---

## Output

Generate file directly to: `output/<AppName>/packages/<PackageName>/descriptor.json`

When done, confirm: "Generated package descriptor for `<PackageName>`
