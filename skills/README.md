# Skills Directory — Reference Documentation

This directory contains **reference documents** that describe workflows and best practices for Creatio composable app generation.

## Current Approach

Agent 4 executes MCP `application-create` through the clio stdio client flow documented in:
- `agents/04-implementation.md` — Agent instructions with stdio execution guidance
- `context/mcp-application-tools-reference.md` — Complete MCP tools guide

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
- Input/output specifications
- Validation checklists
- Best practices

## Usage Note

These are **not executable skills**. They are reference documents that may be read by agents during implementation planning and execution.
