# Skills Directory — Reference Documentation

This directory contains **reference documents** that describe workflows and best practices for Creatio composable app generation.

## Current Approach

Agent 4 executes MCP tools through the clio stdio client flow documented in:
- `agents/04-implementation.md` — Agent instructions with stdio execution guidance
- `context/essentials.md` — repository policy and canonical execution flow
- `scripts/mcp_client.py` — transport and local normalization

Executable tool names, parameters, aliases, defaults, response shapes, and error shapes are authoritative only in `clio MCP` through `get-tool-contract`.
These skill documents keep workflow and page-editing policy only; they must not define an independent MCP API contract.

## Skills as Reference Documentation

These files serve as workflow documentation and best practices:

```
skills/
├── entity-creation/               # Entity schema sync via MCP entity tools
├── page-creation/                 # Freedom UI page generation
├── data-bindings-creation/        # Data binding generation
├── package-descriptor-creation/   # Package metadata
└── page-schema-editing/           # Page schema editing (agent modifies raw JS body, saves via MCP)
```

Each SKILL.md contains:
- Workflow documentation
- Input/output expectations
- Validation checklists
- Best practices

## Usage Note

These are **not executable skills**. They are reference documents that may be read by agents during implementation planning and execution.
