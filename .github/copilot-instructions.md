# Copilot Instructions — No-Code Creatio Assistant

## About This Repository

This is a self-contained toolkit for AI-assisted Creatio composable app development. It contains all knowledge, templates, and instructions needed to generate complete Creatio applications from natural language descriptions.

## Architecture

The toolkit uses a **multi-agent architecture**:

- **Orchestrator** (`AGENTS.md`) — coordinates 5 agents in sequence
- **Agents** (`agents/`) — 5 specialized agents, one per phase
- **Skills** (`skills/`) — 4 implementation skills used by Agent 4
- **Context** (`context/`) — knowledge base (read-only)
- **Templates** (`templates/`) — file format references (read-only)

## How to Work

When a developer asks you to create a Creatio application:

1. **First**, read `AGENTS.md` for the orchestration workflow
2. **Execute agents in order**: Environment Setup → Requirements → Plan → Implementation → Deploy
3. **Each agent has its own file** in `agents/` — read it before starting that phase
4. **Agent 2 (Requirements) is INTERACTIVE** — do NOT delegate to a sub-agent
5. **Agent 4 uses skills** from `skills/` — each skill generates a specific file type
6. **Always read referenced context files** (`context/*.md`) — they contain critical GUIDs and format specs
7. **Use templates** (`templates/`) as exact format reference for generated files

## Key Context Files

| File | Contains |
|------|----------|
| `context/creatio-platform.md` | Platform overview, composable apps, Freedom UI |
| `context/entity-types.md` | DataValueType→GUID map, KNOWN_PARENTS, BASE_ENTITY_COLS |
| `context/schema-types.md` | Entity/Page/Addon file formats with examples |
| `context/composable-app-structure.md` | Package descriptor, directory structure |
| `context/freedomui-reference.md` | Page JS format, control types, viewConfigDiff |
| `context/data-bindings-reference.md` | SysModule/SysModuleEntity column UIds |
| `context/clio-reference.md` | CLI commands for deploy |
| `context/naming-conventions.md` | Usr prefix, PascalCase, GUID format |

## Critical Rules

- **Agent 2 requires user interaction** — always challenge the idea, ask questions, get approval
- **Do NOT generate files until .creatio-env.json exists**
- Entities MUST inherit from BaseEntity or BaseLookup (never standalone)
- Do NOT add Id, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy columns (inherited)
- Enum-like fields → separate lookup entity (extends BaseLookup)
- Use `clio push-pkg` for deploy (file-based, not OData)
- Use `clio new-pkg` to create package skeleton
- Generate files to `output/<AppName>/` directory
- All entity/page names start with `Usr` prefix
