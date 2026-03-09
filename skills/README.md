# Skills Directory — Reference Documentation

This directory contains **reference documents** that describe workflows and best practices for Creatio composable app generation.

## ⚠️ Important Notice

These are **not executable Copilot CLI skills**. The files here (e.g., `SKILL.md`) serve as:
- Detailed workflow documentation
- MCP integration patterns
- Schema sync best practices
- Validation checklists

## How Agent 4 Uses These Files

Agent 4 (Implementation Orchestrator) **reads** `application-creation/SKILL.md` as **instructions** but does **not delegate** through the `skill` tool.

The MCP workflow described in `SKILL.md` has been **inlined directly** into `agents/04-implementation.md` for clarity and maintainability.

## Structure

```
skills/
├── application-creation/      # MCP application.create workflow
├── data-bindings-creation/   # Data binding generation
├── entity-creation/          # Entity schema creation
├── package-descriptor-creation/  # Package metadata
└── page-creation/            # Freedom UI page generation
```

## Future

If Copilot CLI adds native skill registration support, these documents can be converted to executable skills. For now, treat them as canonical documentation referenced by agent instructions.
