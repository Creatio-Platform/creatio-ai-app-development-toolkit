---
name: entity-creation
description: Apply approved entity changes in Creatio through the canonical DB-first entity flow. Prefer schema-sync and refresh the canonical app context after materialization.
compatibility: Requires clio MCP DB-first entity tools and application context refresh support.
metadata:
  version: "7.0"
  category: creatio-schema-generation
---

# Entity Schema Sync

Use this skill when approved schema changes must be applied after `application-create`. These tools persist changes in Creatio DB, and this repo treats refreshed application context from `application-get-info` as the canonical post-mutation state.

This skill is not an MCP API reference.
Resolve exact tool names, parameters, aliases, defaults, validators, response shapes, and error shapes through `tool-contract-get`.

## Canonical Entity Flow

1. `application-create` for a new app shell when needed
2. `schema-sync`
3. `application-get-info`

Keep individual entity tools such as `create-entity-schema`, `create-lookup`, and `update-entity-schema` as fallback-only compatibility paths.

## What This Skill Covers

- ordering schema operations
- lookup-before-reference rules
- localization and naming invariants
- schema default versus UI default planning rules
- post-sync refresh and evidence persistence

## Hard Rules

1. MCP usage is mandatory.
2. Manual schema file generation is forbidden.
3. Prefer `schema-sync` over individual entity mutations.
4. Create lookup entities before referencing them from other schemas.
5. Omission never means delete.
6. `BaseLookup` already provides `Name` and `Description`; never add duplicate lookup title columns.
7. If the current entity snapshot already contains `Name`, do not add `UsrName`.
8. Enum-like business values must be modeled as lookup entities.
9. Requirements phrased as “defaults to X” are incomplete until the plan defines either a schema default or a UI default.
10. Lookup seed rows alone do not satisfy a default requirement.
11. Follow the current `clio` MCP contract and `docs://mcp/guides/app-modeling` for lookup/display/default semantics instead of restating them locally.
12. When refreshed application context exposes `canonical-main-entity-name`, treat that entity as the default main entity for single-record-type app flows.

## Planning Inputs

From the approved plan, keep only the semantic requirements:

- package and schema names
- whether the target is a new entity, lookup, or update to an existing entity
- localized business titles and descriptions when required
- parent schema intent for new entities
- ordered column operations
- lookup seed requirements
- explicit default behavior

Translate these into executable payloads only at runtime through `tool-contract-get`.

This flat application context is the primary runtime contract for this repo. After normalization, `mcp-application-result.json` may also contain `editableContext`, but that is a repo-local helper projection rather than the MCP response contract.

## Refresh Policy

After a successful `schema-sync` batch:

1. call `application-get-info` once
2. overwrite `output/<AppName>/mcp-application-result.json`
3. append execution evidence to `schemaSync`
4. stop if the refreshed context does not show the materialized schema state
5. normalize the result with `scripts/mcp_context_adapter.py normalize`

Do not document per-operation refresh as the primary flow.

## Validation Checklist

- `success=true`
- `package-u-id` is non-empty
- `entities` contains the expected schema after refresh
- schema operations follow lookup-before-reference ordering
- no inherited lookup columns are redefined
- no duplicate title column such as `UsrName` is introduced when `Name` already exists
- explicit defaults are classified as schema defaults or UI defaults
- canonical context was refreshed through `application-get-info`
- `canonical-main-entity-name` is used when deciding whether to extend the template-created main entity or create an additional business object
- lookup references point to already existing schemas
- evidence reflects the materialized result, not only the intended mutation

## Failure Policy

- Retry only transient MCP failures.
- Stop immediately on validation or business-rule errors.
- Do not continue to dependent updates after a failed lookup creation.
- If `tool-contract-get` cannot provide contract metadata, stop with blocker instead of guessing payload shape.
