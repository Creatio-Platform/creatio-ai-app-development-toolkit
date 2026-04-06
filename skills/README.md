# Skills Directory — Reference Documentation

This directory contains **reference documents** that describe workflows and best practices for Creatio composable app generation.

## Current Approach

Agent 4 prepares an execution handoff runbook for Developer + AI execution through `clio` MCP:
- `agents/04-implementation.md` — Agent instructions for runbook generation
- `context/essentials.md` — repository policy and execution handoff model
- `context/mcp-application-tools-reference.md` — optional local wrapper/script reference

Executable tool names, parameters, aliases, defaults, response shapes, and error shapes are authoritative only in `clio MCP` through `tool-contract-get`.
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
