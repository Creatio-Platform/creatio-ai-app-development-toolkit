---
name: creatio-app-orchestrator
description: Use when creating Creatio app Business Plans, technical implementation handoffs, or applying the approved plan through clio MCP.
---

# Creatio App Orchestrator

Use this skill as the entrypoint for CAADT workflows.

## File resolution (read first)

All toolkit files referenced in this skill live under the **toolkit root** — the
directory that contains AGENTS.md, which is the parent of the `skills/` folder
this file lives in (`../../` from this file). Resolve every path below against that
toolkit root, not your current working directory.

If you cannot read `../../AGENTS.md`, STOP: tell the user the CAADT toolkit files
are not accessible from this session, and do not produce a plan from memory.

## Load Order

1. Read `../../AGENTS.md` for the active orchestration contract.
2. Read `../../context/product-telemetry.md` for telemetry consent, event checkpoints, and payload shape.
3. Read `../../context/INDEX.md` to choose the smallest relevant reference set.
4. For environment setup, read `../../runbooks/01-environment-setup.md`.
5. For requirements gathering, read `../../runbooks/02-requirements-gathering.md`.
6. For post-Gate-R implementation and scaffolding (including the transient section-creation failure playbook), read `../../runbooks/03-app-implementation.md`.
7. For executable helper behavior: resident tools (`get-tool-contract` index: `resident=true`) are called natively; every other tool is invoked via `clio-run <command>` regardless of transport. Use `../../runtime/scripts/mcp_client.py` as the stdio fallback when the host has no native MCP, plus `../../runtime/scripts/workflow_validators.py`.

## Analytics Context

Use these values for CAADT product telemetry when calling clio telemetry tools:

- `coding_agent`: your host coding agent (for example `Claude Code`, `Codex`, `GitHub Copilot CLI`, or `Cursor`).
- `plugin_version`: the installed plugin version from the plugin manifest (`plugin.json` `version`).

## Core Rules

- Pages are separate for web and mobile: before any page edit, read `../../context/essentials.md` ("Freedom UI — Mobile Pages") and target web, mobile, or both as the requirement needs. Required even in autonomous/pre-approved runs.
- **Lookup/enum values are package data, never a runtime write.** Seed them inline via `sync-schemas`'s row-seeding parameter (name resolved via `get-tool-contract`) when the entity is created in that batch (preferred), or with `create-data-binding-db` when the entity already exists outside that batch — both are DB-first and install immediately, no compile step involved. Never seed lookup values through runtime OData/DataService calls or raw SQL: those bypass the platform, so the row lands in the table but the value doesn't surface as real package data. Details: `../../context/essentials.md`, "Data Binding And Schema Inspection".
- **UI/UX is mandatory, not optional.** Whenever the workflow creates or edits Freedom UI pages (`create-app`, `create-app-section`, `create-page`, `update-page`, `sync-pages`), you MUST invoke the **`creatio-ui-guidelines`** skill **before** authoring page bodies and apply its rules (layout/containers, component choice, lookups, fields, accessibility), then run its review checklist **before** treating page work as done. Do not design pages from memory — these rules are easy to miss and skipping them produces the recurring defects (selection-window lookups, layout gaps, single-field islands, Title-case captions, missing tooltips, non-accessible components).
- **Schema naming is mandatory, not optional.** Whenever the workflow creates or names data-model elements (`create-entity-schema`, `update-entity-schema`, `create-lookup`, and the objects/columns implied by `create-app`/`create-app-section`), you MUST invoke the **`creatio-schema-naming`** skill **before** choosing object, title, column, field, lookup, Guid/UId, or relation-object names, and apply its rules together with `../../context/naming-conventions.md`. Do not invent names from memory — inconsistent or non-conventional names are hard to correct after the schema is published.
- Keep the visible planning artifact in the BA-style Business Plan format defined by `../../AGENTS.md`.
- Follow `../../context/product-telemetry.md` for CAADT product telemetry; use the installed Analytics Context values when calling clio telemetry tools.
- Resolve executable clio MCP tool contracts through `get-tool-contract`; do not invent payload shapes.
- Resident tools (`get-tool-contract` index: `resident=true`) are called natively when the host exposes clio MCP as native tool-calls; every other tool is invoked via `clio-run <command>` regardless of transport. Treat `../../runtime/scripts/mcp_client.py` as the stdio fallback only, and do not reverse-engineer its CLI contract when native calls are available (see `../../AGENTS.md`, "clio MCP transport preference").
- Before the first schema or page edit, resolve a writable package context up front: on an existing/installed app confirm the target package is unlocked and editable, otherwise unlock or select/create a writable package before editing. Do not discover the write rejection mid-run.
- Use `../../context/business-checklist.md`, `../../context/essentials.md`, `../../context/naming-conventions.md`, `../../context/clio-cli-reference.md`, and `../../context/model-discovery-evidence.md` as the canonical repository references.
- Treat `../../.mcp.json` as the plugin MCP connection definition; it starts the global `clio mcp-server` process through the host coding agent. This native MCP and the `mcp_client.py` wrapper must point at the same `clio`, so they share one config and one registered-environments list (single clio context).
