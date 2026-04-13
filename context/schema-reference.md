# Creatio Schema Reference

This file is a structural reference for repository workflows.

Use `get-tool-contract` and `docs://mcp/guides/app-modeling` for all executable entity or schema semantics, including:
- parent selection
- localized title or description rules
- lookup display-field behavior
- default behavior
- exact data type semantics
- canonical create or update flows

This repository must not redefine those rules.

---

## What This File Covers

- schema folder layout
- descriptor and metadata file roles
- generic diff-format reminders
- local workflow hints for where structural artifacts usually live

For live request payloads, aliases, validators, defaults, output shapes, and error shapes, read the current `clio` MCP contract instead of this file.

---

## Typical Schema Layout

```text
Schemas/<SchemaName>/
├── descriptor.json
├── metadata.json
├── properties.json
└── <SchemaName>.js   # page/client schemas only
```

Not every schema uses every file. Entity-oriented schemas usually use descriptor, metadata, and properties. Client/page schemas also include the JavaScript body.

---

## Descriptor Role

`descriptor.json` identifies the schema, its manager, caption, parent linkage, and package metadata.

Typical fields you will see:
- schema name
- schema GUID
- parent schema reference
- manager name
- caption
- dependency list

Treat exact parent choices and caption semantics as `clio`-owned contract details.

---

## Metadata Role

`metadata.json` stores the schema body in Creatio's diff-oriented metadata format.

Common patterns:
- `=` updates a value
- `+` adds a node
- `-` removes a node
- `~` reorders nodes

Use repository templates and existing package examples for file-shape familiarity only. Do not treat local examples as the normative MCP write contract.

---

## Properties Role

`properties.json` stores schema-level flags and creation metadata such as:
- creation version
- availability flags
- tracking flags
- virtualization or editing flags

These values are structural context, not a substitute for MCP contract discovery.

---

## Page Schema Notes

Page or client schemas commonly include:
- `descriptor.json`
- `metadata.json`
- `properties.json`
- `<SchemaName>.js`

The JavaScript body is typically an AMD module with sections such as:
- `viewConfigDiff`
- `viewModelConfigDiff`
- `modelConfigDiff`
- `handlers`
- `converters`
- `validators`

For page editing mechanics, use `context/ui-reference.md`, `context/viewconfig-reference.md`, and the current page MCP contracts.

---

## Usage Rule

Before planning or mutating schemas:
1. Discover the live contract with `get-tool-contract`.
2. Read `docs://mcp/guides/app-modeling`.
3. Use this file only for structural orientation.
