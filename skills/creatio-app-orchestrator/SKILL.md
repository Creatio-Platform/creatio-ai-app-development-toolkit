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
6. For executable helper behavior, prefer native clio MCP tool-calls; use `../../runtime/scripts/mcp_client.py` as the stdio fallback when the host has no native MCP, plus `../../runtime/scripts/workflow_validators.py`.

## Analytics Context

Use these values for CAADT product telemetry when calling clio telemetry tools:

- `coding_agent`: your host coding agent (for example `Claude Code`, `Codex`, `GitHub Copilot CLI`, or `Cursor`).
- `plugin_version`: the installed plugin version from the plugin manifest (`plugin.json` `version`).

## Core Rules

- Pages are separate for web and mobile: before any page edit, read `../../context/essentials.md` ("Freedom UI — Mobile Pages") and target web, mobile, or both as the requirement needs. Required even in autonomous/pre-approved runs.
- Keep the visible planning artifact in the BA-style Business Plan format defined by `../../AGENTS.md`.
- Follow `../../context/product-telemetry.md` for CAADT product telemetry; use the installed Analytics Context values when calling clio telemetry tools.
- Resolve executable clio MCP tool contracts through `get-tool-contract`; do not invent payload shapes.
- Prefer native clio MCP tool-calls when the host exposes them; treat `../../runtime/scripts/mcp_client.py` as the stdio fallback only, and do not reverse-engineer its CLI contract when native calls are available (see `../../AGENTS.md`, "clio MCP transport preference").
- Before the first schema or page edit, resolve a writable package context up front: on an existing/installed app confirm the target package is unlocked and editable, otherwise unlock or select/create a writable package before editing. Do not discover the write rejection mid-run.
- Use `../../context/business-checklist.md`, `../../context/essentials.md`, `../../context/naming-conventions.md`, `../../context/clio-cli-reference.md`, and `../../context/model-discovery-evidence.md` as the canonical repository references.
- Treat `../../.mcp.json` as the plugin MCP connection definition; it starts the global `clio mcp-server` process through the host coding agent. This native MCP and the `mcp_client.py` wrapper must point at the same `clio`, so they share one config and one registered-environments list (single clio context).
