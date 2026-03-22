# Context Navigation Index

Use this file to read only the sections you need via `view(file, [startLine, endLine])`.
Do NOT read full files — use line ranges from this index.

## Quick Capability Map

This repository provides two modes of operation:

### A. Full App Generation (orchestrated pipeline)
Generate a complete Creatio composable app from a natural-language description.
Uses the 4-agent pipeline: Environment → Requirements → Plan → Implementation.
→ Start with `AGENTS.md`, follow the Phase table below.

### B. Targeted Changes (individual skills)
Apply specific changes to an existing Creatio project. Pick the skill you need:

| Task | Skill | Read | MCP Tools Used |
|------|-------|------|----------------|
| **Add/update entity columns** | `skills/entity-creation/SKILL.md` (139 lines) | L14-78 (What + Rules + Shapes), L101-139 (Response + Validation) | `entity.create`, `entity.create_lookup`, `entity.update`, `application.get_info` |
| **Edit Freedom UI page** (add fields, handlers, buttons) | `skills/page-schema-editing/SKILL.md` (302 lines) | L14-69 (Context + MCP Tools), L110-227 (Workflow Steps), L229-280 (Rules + Validation) | `page.list`, `page.get`, `page.update` |
| **Generate new page schema** | `skills/page-creation/SKILL.md` (80 lines) | Full | None (file generation from templates) |
| **Seed lookup data / create bindings** | `skills/data-bindings-creation/SKILL.md` (68 lines) | Full | `binding.get_columns`, `binding.create` |
| **Generate package descriptor** | `skills/package-descriptor-creation/SKILL.md` (60 lines) | Full | None (file generation) |

**For targeted changes, also read:**
- `context/essentials.md` L59-90 (Naming Conventions) — always
- `scripts/mcp_client.py` — when using any MCP tool
- Context files referenced by the specific skill (listed in each SKILL.md header)

### Context files by topic (for targeted lookups)

| Topic | File | Key Sections |
|-------|------|-------------|
| Naming rules, Usr prefix | `context/essentials.md` | L59-90 |
| Clio CLI commands | `context/essentials.md` | L230-277 |
| MCP client usage | `scripts/mcp_client.py` | Full (168 lines) |
| MCP tool API (all tools) | `context/mcp-application-tools-reference.md` | See per-tool index below |
| Entity parent GUIDs | `context/schema-reference.md` | L7-29 |
| DataValueType GUIDs | `context/schema-reference.md` | L64-111 |
| Schema file formats | `context/schema-reference.md` | L112-225 |
| Freedom UI page structure | `context/ui-reference.md` | L1-44 |
| UI control types | `context/ui-reference.md` | L95-191 |
| FormPage layout + fields | `context/ui-reference.md` | L508-605 |
| ListPage DataTable | `context/ui-reference.md` | L192-278 |
| viewConfigDiff field recipes | `context/viewconfig-reference.md` | L68-215 |
| viewConfigDiff Button recipe | `context/viewconfig-reference.md` | L216-329 |
| Handlers + SDK reference | `context/devkit-common-reference.md` | L1-30 (scope), L115-145 (safe defaults) |
| Data bindings (SysModule, lookups) | `context/data-bindings-reference.md` | L81-141 |

## Reading Strategy

1. **Always read this INDEX first** (single small file).
2. **Determine your mode:** full app generation (A) or targeted change (B).
3. For mode A: read AGENTS.md rules for your current phase, then the agent file.
4. For mode B: read the skill file, then only the context sections it references.
5. Read only the context sections needed for the current step.
6. Parallelize all independent reads in one tool call.

## Phase → Required Reads (Full App Generation)

| Phase | Must Read | Sections |
|-------|-----------|----------|
| Gate P (Planning) | AGENTS.md | L1-55 (Role + Planning), L216-252 (Global Rules) |
| Agent 1 (Environment) | agents/01-environment-setup.md | Full (158 lines) |
| | context/essentials.md | L230-277 (Clio Commands) |
| Agent 2 (Requirements) | agents/02-requirements-gathering.md | Full (286 lines) |
| | context/business-checklist.md | Full (109 lines) |
| Agent 3 (Plan) | agents/03-implementation-plan.md | Full (383 lines) |
| | context/essentials.md | L166-229 (MCP Tools + app.create) |
| | context/schema-reference.md | L7-90 (Parents + DVTs) |
| Agent 4 (Implementation) | agents/04-implementation.md | L1-105 (Role + MCP Workflow), then L204-462 (Steps) |
| | context/mcp-application-tools-reference.md | L1-50 (Overview + Params), then per-tool sections below |
| | context/ui-reference.md | L508-605 (FormPage Layout), L192-278 (ListPage DataTable) |
| | context/viewconfig-reference.md | L68-215 (FormPage Field Recipes) |
| | scripts/mcp_client.py | Full (168 lines) |

## File Map

### AGENTS.md (285 lines) — Orchestrator
| Lines | Section | Description |
|-------|---------|-------------|
| 1-10 | UX Contract | Business-first interaction rules |
| 11-16 | Your Role | 4-agent coordination, no direct implementation |
| 17-29 | Mandatory Planning Start | Gate P, natural-language confirmation |
| 30-43 | Business-First Clarification Policy | Checklist, stop conditions, assumptions |
| 44-55 | Source of Truth | Canonical reference files list |
| 56-93 | Pipeline + Contracts | Agent flow diagram, I/O contracts table |
| 94-120 | Pipeline (continued) | Orchestration rules, execution flow |
| 121-161 | Pipeline diagram + Contracts | Visual flow + I/O table |
| 162-215 | Orchestration Rules | 20 execution rules, guardrails |
| 216-252 | Global Rules | 29 cross-cutting constraints |
| 253-268 | Context Files Reference | Lazy-loading table |
| 269-285 | Templates + Quick Start | Template paths, 7-step quickstart |

### agents/01-environment-setup.md (158 lines) — Clio Setup
| Lines | Section | Description |
|-------|---------|-------------|
| 1-19 | Role + I/O + Context | Agent purpose and dependencies |
| 20-59 | Steps 1 (Prerequisites) | Verify .NET and clio installation |
| 60-88 | Env Name Guardrail + Step 2-3 | List and register environments |
| 89-112 | Steps 4-5 | Detect IsNetCore, verify connection |
| 113-141 | Step 6 (Save config) | Write .creatio-env.json structure |
| 142-158 | Error Handling + Completion | Troubleshooting table, validation |

### agents/02-requirements-gathering.md (286 lines) — Requirements
| Lines | Section | Description |
|-------|---------|-------------|
| 1-29 | Role + I/O + Context | Interactive-only agent, three output files |
| 30-81 | Steps 1-2 | Parse prompt, run business checklist |
| 82-122 | Steps 3-4 | Technical blockers, build request-spec.json |
| 123-231 | Steps 5-6 | Generate requirements.md, approval loop |
| 232-243 | Step 7 | Persist workflow state (Gate R) |
| 244-286 | Critical Rules + Completion | 20 rules, default classification, criteria |

### agents/03-implementation-plan.md (383 lines) — Plan Generator
| Lines | Section | Description |
|-------|---------|-------------|
| 1-24 | Role + I/O + Context | Transform requirements → MCP plan |
| 25-58 | Steps 0-1 | Check Gate R, validate business completeness |
| 59-115 | Steps 2-3 | Parse inputs, resolve MCP payload |
| 116-228 | Steps 4-4.1 | Schema sync plan + page sync plan |
| 229-322 | Step 4.2 | Entity tool payload validation rules |
| 323-366 | Steps 5-7 | Build plan.md, validation, save |
| 367-383 | Rules + Completion | 4 principles, 7 success criteria |

### agents/04-implementation.md (785 lines) — MCP Executor
| Lines | Section | Description |
|-------|---------|-------------|
| 1-20 | Role + I/O + Context | Execute MCP calls, sync artifacts |
| 21-69 | MCP Workflow | clio resolution, stdio transport, quick start |
| 70-104 | Protocol Flow + Responses | Request lifecycle, success/error parsing |
| 105-169 | Schema Sync + Bindings + Params | Entity ordering, binding tools, param validation |
| 170-203 | Validation + Retry | Pre-execution checklist, failure policy |
| 204-329 | Steps 0-5 | Gate R → parse plan → verify MCP → check app → init context |
| 330-398 | Steps 6-7 | Init canonical context, execute schema sync |
| 399-461 | Steps 7b-8 | Page customization, validate output |
| 462-552 | Step 9 | Write summary report (mcp-application-report.md) |
| 553-570 | Completion Criteria | 6 validation requirements |
| 571-785 | Page Sync Details | Full page editing workflow, body markers, recipes |

### context/essentials.md (319 lines) — Platform Basics
| Lines | Section | Description |
|-------|---------|-------------|
| 1-58 | Platform Overview | Architecture, key concepts, system tables |
| 59-90 | Naming Conventions | Usr prefix, PascalCase, GUID rules |
| 91-165 | Package Structure | descriptor.json, directory layout, generation order |
| 166-229 | MCP Tools | Python client, app.create input, request example |
| 230-277 | Clio CLI Commands | Environment, package, development commands |
| 278-319 | MCP Workflow + Timestamps | DB-first workflow, ModifiedOnUtc format |

### context/business-checklist.md (109 lines) — Checklist
| Lines | Section | Description |
|-------|---------|-------------|
| 1-10 | Goal | Ensure completeness of business requirements |
| 11-72 | 8 Checklist Items | Outcome, actors, domain, lifecycle, rules, UX, edge cases, acceptance |
| 73-109 | Completion + Strategy | When done, question batching, tech boundary, display defaults |

### context/mcp-application-tools-reference.md (879 lines) — MCP Tools API
| Lines | Section | Description |
|-------|---------|-------------|
| 1-49 | Overview + Auth + Params + Response | Transport, naming, JSON format |
| 50-65 | Tool 1 (Init Session) | First MCP call pattern |
| 66-118 | Tool 3 (application-create) | Create app with entity, full params |
| 119-195 | Tools 4-4.1 (get-info, get-list) | Refresh context, discover apps |
| 196-276 | Tools 5-6 (create-entity, create-lookup) | BaseEntity and BaseLookup creation |
| 277-351 | Tools 7-8 (update-entity, get-columns) | Column operations, schema metadata |
| 352-412 | Tool 9 (create-data-binding-db) | Seed lookup data, rows format |
| 413-523 | Error Handling + Pitfalls | Recovery strategies, 8 mistake patterns |
| 524-643 | Complete Workflow Example | End-to-end execution with code |
| 644-707 | Best Practices + Integration | 4 principles, Python helper usage |
| 708-879 | Page Tools (list/get/update) | Page discovery, reading, editing |

### context/ui-reference.md (658 lines) — Freedom UI
| Lines | Section | Description |
|-------|---------|-------------|
| 1-44 | Page JS Structure | AMD module, markers, section anatomy |
| 45-94 | viewConfigDiff Operations | Insert, merge, remove, move with examples |
| 95-191 | Control Types | All Freedom UI components with properties |
| 192-278 | ListPage DataTable | DataGrid structure, default columns, sorting |
| 279-360 | Add Button + viewModelConfigDiff | Button config, attribute binding |
| 361-507 | Model Config | viewModelConfigDiff, modelConfigDiff for list/form |
| 508-605 | Form Page Layout | Field organization, default fields, runtime insertion |
| 606-658 | Lookup Special Cases + Field Types | Lookup binding, additional components |
| 659-700 | Page Parents + Handlers + MCP | Template parents, handler specs, page tools |

### context/viewconfig-reference.md (385 lines) — viewConfigDiff Recipes
| Lines | Section | Description |
|-------|---------|-------------|
| 1-31 | Operations + Naming | 4 operation types, element naming conventions |
| 32-67 | User Input + Exceptions | Parent container, entity-field sync, grid sync |
| 68-215 | FormPage Field Recipes | All field types: Input, ComboBox, Checkbox, Date, Number, etc. |
| 216-329 | Components (Button) | crt.Button with full property reference |
| 330-385 | Editing Safety Contract | Safe JSON editing procedures |

### context/schema-reference.md (315 lines) — Schema GUIDs
| Lines | Section | Description |
|-------|---------|-------------|
| 7-29 | Parent Entity Types | BaseEntity, BaseLookup GUIDs |
| 30-61 | Page Template Parents | Page parent type GUIDs |
| 62-89 | Display Column Guardrails | BaseLookup Name field rules |
| 64-111 | DataValueType GUIDs | Type GUIDs + numeric IDs for all column types |
| 112-225 | Schema File Formats | Entity (3 files), Page (4 files), Addon (3 files) |
| 296-315 | System Entity UIds | Key system entity schema UIds |

### context/data-bindings-reference.md (160 lines) — Data Bindings
| Lines | Section | Description |
|-------|---------|-------------|
| 1-69 | MCP Binding Tools | get_columns and binding.create APIs |
| 70-141 | Binding Structure + Targets | Directory layout, SysModule, SysModuleEntity, lookups |
| 142-160 | ID Rules + Guidance | GUID generation, best practices |

### context/devkit-common-reference.md (293 lines) — SDK API
| Lines | Section | Description |
|-------|---------|-------------|
| 1-30 | Scope + Usage Guide | Public API scope, page-body vs frontend work |
| 31-97 | Services + Models | Core services, AI models, response types, metadata |
| 98-114 | Decorators + Functions + Enums + Handlers | All export categories |
| 115-145 | AI Code Generation Guidance | Safe defaults, anti-patterns |

### scripts/mcp_client.py (168 lines) — MCP Client
| Lines | Section | Description |
|-------|---------|-------------|
| 1-55 | Clio Resolution | CLIO_CMD env var, global lookup, error |
| 56-100 | call_mcp_tool() | Main function: build JSON-RPC, spawn clio, parse |
| 101-168 | Response Parsing | JSON decode, isError check, data extraction |

## MCP Tool Quick Lookup

When you need a specific MCP tool's API, read only its section from `context/mcp-application-tools-reference.md`:

| MCP Tool | Lines | What You Get |
|----------|-------|-------------|
| `application-create` | L66-118 | Create app with package + entity |
| `application-get-info` | L119-156 | Refresh app context from DB |
| `application-get-list` | L157-195 | Discover existing apps |
| `create-entity-schema` | L196-229 | Create BaseEntity schema |
| `create-lookup` | L230-276 | Create BaseLookup schema |
| `update-entity-schema` | L277-327 | Add/modify columns |
| `binding-get-columns` | L328-351 | Query entity metadata |
| `create-data-binding-db` | L352-412 | Seed lookup data |
| `page-list` | L708-740 | Discover pages in package |
| `page-get` | L741-800 | Read page body |
| `page-update` | L801-879 | Save modified page body |
| Error handling | L413-523 | Recovery + common pitfalls |

## Skills Detail Map

### skills/entity-creation/SKILL.md (139 lines) — Entity Sync via MCP
| Lines | Section | Description |
|-------|---------|-------------|
| 14-30 | What + Hard Rules | Scope, naming, inherited columns |
| 31-78 | Input + Request Shapes | Expected plan format, create/create_lookup/update params |
| 79-100 | Operation Format | Column operation actions (add/modify/remove) |
| 101-139 | Response + Refresh + Validation | Success check, get_info refresh, failure policy |

### skills/page-schema-editing/SKILL.md (302 lines) — Edit Live Pages
| Lines | Section | Description |
|-------|---------|-------------|
| 14-69 | Context + MCP Tools | Required reads, page.list/get/update signatures |
| 70-109 | Schema Body Format | AMD markers, section anatomy |
| 110-156 | Workflow Steps 1-3 | Discover → Read → Modify body |
| 157-207 | Steps 3a-3b | Sync entity fields into FormPage, adjust ListPage sorting |
| 208-228 | Steps 4-5 | Dry run validation, save |
| 229-280 | Critical Rules + Validation | 19 rules, pre/post edit checklists |
| 283-302 | Example | Add handler + update deps in one operation |

### skills/page-creation/SKILL.md (80 lines) — Generate New Page
| Lines | Section | Description |
|-------|---------|-------------|
| 14-41 | Outputs + Inputs + Parents | 4 generated files, plan.md input, template parents |
| 42-80 | Rules + Validation + Post-creation | Generation rules, checklist, page-schema-editing handoff |

### skills/data-bindings-creation/SKILL.md (68 lines) — Seed Data
| Lines | Section | Description |
|-------|---------|-------------|
| 14-27 | Outputs + Inputs | Generated binding files, required context |
| 28-68 | Rules + MCP Flow + Validation | Binding rules, typical flow, checklist |

### skills/package-descriptor-creation/SKILL.md (60 lines) — Package Descriptor
| Lines | Section | Description |
|-------|---------|-------------|
| 14-27 | Output + Inputs | descriptor.json, template reference |
| 28-60 | Shape + Rules + Validation | Required JSON structure, naming rules |
