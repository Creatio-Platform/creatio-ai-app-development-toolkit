---
name: entity-creation
description: Apply approved entity changes in Creatio through the canonical DB-first entity flow. Prefer sync-schemas and refresh the canonical app context after materialization.
compatibility: Requires clio MCP DB-first entity tools and application context refresh support.
metadata:
  version: "7.0"
  category: creatio-schema-generation
---

# Entity Schema Sync

Use this skill when approved schema changes must be applied after `create-app`. These tools persist changes in Creatio DB, and this repo treats refreshed application context from `get-app-info` as the canonical post-mutation state.

This skill is not an MCP API reference.
Resolve exact tool names, parameters, aliases, defaults, validators, response shapes, and error shapes through `get-tool-contract`.

## Canonical Entity Flow

Resolve the exact tool sequence, parameters, and fallback paths through `get-tool-contract` and `docs://mcp/guides/app-modeling`.
Prefer `sync-schemas` for grouped entity work. Use individual entity tools only when the approved plan explicitly requires a fallback path.

## What This Skill Covers

- ordering schema operations
- lookup-before-reference rules
- localization and naming invariants
- schema default versus UI default planning rules
- post-sync refresh and evidence persistence

## Hard Rules

1. MCP usage is mandatory.
2. Manual schema file generation is forbidden.
3. Prefer `sync-schemas` over individual entity mutations.
4. Create lookup entities before referencing them from other schemas.
5. Omission never means delete.
6. Resolve lookup display and inherited-column semantics through `get-tool-contract` and `docs://mcp/guides/app-modeling`; do not treat this skill as the source of truth.
7. Resolve existing title/display field reuse from refreshed app context plus live `clio` modeling guidance instead of hardcoded repo heuristics.
8. Enum-like business values must be modeled as lookup entities.
9. Requirements phrased as “defaults to X” are incomplete until the plan defines either a schema default or a UI default.
10. Lookup seed rows alone do not satisfy a default requirement.
11. Follow the current `clio` MCP contract and `docs://mcp/guides/app-modeling` for lookup/display/default semantics instead of restating them locally.
12. When refreshed application context exposes `canonical-main-entity-name`, treat that entity as the default main entity for single-record-type app flows.
13. Resolve runtime field-type semantics through live `clio` MCP contract metadata and app-modeling guidance rather than hardcoded repo rules.
14. Do not create a second main entity right after `create-app` for the same primary record type; extend the canonical main entity unless the approved plan proves a distinct business object.
15. Do not create a new supporting or link entity when refreshed app context already exposes a schema in the target package with the same business purpose and the same relation pair; reuse the existing schema instead.
16. A business caption is not authority to mint a new technical schema code. If refreshed runtime context already maps the caption or title to an existing schema code, use that code.
17. Creating a synonym supporting or link schema in the same package is a blocker-level planning error, not a harmless fallback.
18. `delete-schema` supports `remote: true` mode to delete by schema name directly from the environment without requiring a workspace.

## Planning Inputs

From the approved plan, keep only the semantic requirements:

- package and schema names
- whether the target is a new entity, lookup, or update to an existing entity
- localized business titles and descriptions when required
- parent schema intent for new entities
- ordered column operations
- lookup seed requirements
- explicit default behavior

Translate these into executable payloads only at runtime through `get-tool-contract`.

## Refresh Policy

After a successful `sync-schemas` batch:

1. call `get-app-info` once
2. overwrite `output/<AppName>/mcp-application-result.json`
3. append execution evidence to `schemaSync`
4. stop if the refreshed context does not show the materialized schema state
5. normalize the result with `scripts/mcp_context_adapter.py normalize`

Do not document per-operation refresh as the primary flow.

## Validation Checklist

- MCP response shape validated through `get-tool-contract` contract
- schema operations follow lookup-before-reference ordering
- inherited/display/title-field conflicts are delegated to live `clio` contract semantics instead of repo-local rules
- explicit defaults are classified as schema defaults or UI defaults
- canonical context was refreshed through `get-app-info`
- `canonical-main-entity-name` is used when deciding whether to extend the template-created main entity or create an additional business object
- existing supporting or link schemas in the target package were checked before planning a new supporting entity
- business captions from requirements are reconciled against existing technical schema codes from refreshed runtime context
- lookup references point to already existing schemas
- evidence reflects the materialized result, not only the intended mutation

## Failure Policy

- Retry only transient MCP failures.
- Stop immediately on validation or business-rule errors.
- Do not continue to dependent updates after a failed lookup creation.
- If `get-tool-contract` cannot provide contract metadata, stop with blocker instead of guessing payload shape.
