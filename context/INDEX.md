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
| **Add/update entity columns** | `skills/entity-creation/SKILL.md` | Key rules and request shapes | `schema-sync`, `create-entity-schema`, `create-lookup`, `update-entity-schema`, `application-get-info` |
| **Edit Freedom UI page** (add fields, handlers, buttons) | `skills/page-schema-editing/SKILL.md` | Key workflow sections | `page-list`, `page-get`, `component-info`, `page-update` |
| **Generate new page schema** | `skills/page-creation/SKILL.md` | Full file | None (file generation from templates) |
| **Seed lookup data / create bindings** | `skills/data-bindings-creation/SKILL.md` | Full file | `get-entity-schema-properties`, `get-entity-schema-column-properties`, `create-data-binding-db` |
| **Generate package descriptor** | `skills/package-descriptor-creation/SKILL.md` | Full file | None (file generation) |

**For targeted changes, also read:**
- `context/essentials.md` naming conventions section — always
- `scripts/mcp_client.py` — when using any MCP tool
- Context files referenced by the specific skill (listed in each SKILL.md header)

### Context files by topic (for targeted lookups)

| Topic | File | Key Sections |
|-------|------|-------------|
| Naming rules, Usr prefix | `context/essentials.md` | Naming conventions section |
| Clio CLI commands | `context/essentials.md` | Clio commands section |
| MCP client usage | `scripts/mcp_client.py` | Full |
| Local MCP wrapper + normalization | `context/mcp-application-tools-reference.md` | Source of truth, transport, runtime result, normalization |
| Entity parent GUIDs | `context/schema-reference.md` | Parent entity types section |
| DataValueType GUIDs | `context/schema-reference.md` | DataValueType section |
| Schema file formats | `context/schema-reference.md` | Schema file formats section |
| Freedom UI page structure | `context/ui-reference.md` | Page structure section |
| UI control types | `context/ui-reference.md` | Control types section |
| FormPage layout + fields | `context/ui-reference.md` | FormPage layout section |
| ListPage DataTable | `context/ui-reference.md` | ListPage DataTable section |
| Deep container discovery | `context/viewconfig-reference.md` | Deep container discovery section |
| viewConfigDiff field recipes | `context/viewconfig-reference.md` | Field recipes section |
| viewConfigDiff Button recipe | `context/viewconfig-reference.md` | Button recipe section |
| Freedom UI component contracts | `context/ui-reference.md` | Page structure section; use live `component-info` for unfamiliar `crt.*` components |
| Handlers + SDK reference | `context/devkit-common-reference.md` | Scope and safe defaults sections |
| Data bindings (SysModule, lookups) | `context/data-bindings-reference.md` | Core binding sections |

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
| Gate P (Planning) | AGENTS.md | Role, planning, and global rules sections |
| Agent 1 (Environment) | agents/01-environment-setup.md | Full file |
| | context/essentials.md | Clio commands section |
| Agent 2 (Requirements) | agents/02-requirements-gathering.md | Full file |
| | context/business-checklist.md | Full file |
| Agent 3 (Plan) | agents/03-implementation-plan.md | Full file |
| | context/essentials.md | MCP-orchestrated runtime and local workflow sections |
| | context/schema-reference.md | Parent schemas and DataValueTypes |
| Agent 4 (Implementation) | agents/04-implementation.md | Full file |
| | context/mcp-application-tools-reference.md | Source-of-truth boundaries, transport, normalization, refresh pattern |
| | context/ui-reference.md | FormPage and ListPage layout sections |
| | context/viewconfig-reference.md | Container discovery and field recipes |
| | scripts/mcp_client.py | Full file |

## File Map

### AGENTS.md — Orchestrator
| Lines | Section | Description |
|-------|---------|-------------|
| Intro | UX Contract | Business-first interaction rules |
| Intro | Your Role | 4-agent coordination, no direct implementation |
| Intro | Mandatory Planning Start | Gate P, natural-language confirmation |
| Intro | Business-First Clarification Policy | Checklist, stop conditions, assumptions |
| Intro | Source of Truth | Canonical reference files list |
| Pipeline | Contracts and orchestration | Agent flow, I/O contracts, execution rules |
| Global | Rules | Cross-cutting constraints |
| Reference | Context files and templates | Lazy-loading table and quickstart |

### agents/01-environment-setup.md — Clio Setup
| Lines | Section | Description |
|-------|---------|-------------|
| Intro | Role + I/O + Context | Agent purpose and dependencies |
| Steps | Prerequisites | Verify .NET and clio installation |
| Steps | Environment registration | List and register environments |
| Steps | Connection checks | Detect IsNetCore and verify connection |
| Steps | Save config | Write .creatio-env.json structure |
| End | Error handling + completion | Troubleshooting and validation |

### agents/02-requirements-gathering.md — Requirements
| Lines | Section | Description |
|-------|---------|-------------|
| 1-29 | Role + I/O + Context | Interactive-only agent, three output files |
| 30-94 | Conversation + Checklist Authority | First-turn rules, checklist authority, BA flow |
| 95-258 | Requirements Output Contract | Canonical 11-section Business Plan, rendering rules, Domain Model table contract |
| 260-299 | Request Spec Contract | Required checklist groups and validation scripts |
| 301-329 | Modeling + Default Resolution | Business naming rules and business-facing default rules |

### agents/03-implementation-plan.md — Plan Generator
| Lines | Section | Description |
|-------|---------|-------------|
| 1-24 | Role + I/O + Context | Transform requirements → MCP plan |
| 25-58 | Steps 0-1 | Check Gate R, validate business completeness |
| 59-115 | Steps 2-3 | Parse inputs, resolve MCP payload |
| 116-228 | Steps 4-4.1 | Schema sync plan + page sync plan |
| 229-322 | Step 4.2 | Entity tool payload validation rules |
| 323-366 | Steps 5-7 | Build plan.md, validation, save |
| 367-383 | Rules + Completion | 4 principles, 7 success criteria |

### agents/04-implementation.md — MCP Executor
| Lines | Section | Description |
|-------|---------|-------------|
| 1-20 | Role + I/O + Context | Execute MCP calls, persist result/report/docs |
| 22-47 | Read First + MCP Transport | Required local reads, transport rules, MCP source-of-truth boundary |
| 48-79 | Preconditions + Execution Order | Gate check, app create/discovery branch, refresh sequence |
| 81-135 | Branching + Schema/Page/Evidence Rules | Main-entity selection, defaults, page-sync obligations, evidence handling |
| 137-186 | Local Runtime Rules | Schema-sync notes, flat runtime contract, validation checklist, retry policy |
| 188-299 | Steps 0-5 | Gate R, parse plan, verify MCP, check app, resolve runtime inputs, initialize context |
| 299-407 | Steps 6-7 | Initialize canonical context, execute schema sync |
| 408-658 | Step 7b | Page customization and verification workflow |
| 659-684 | Steps 8-9 | Validate output contract and write summary report |
| 685-695 | Completion Criteria | Final implementation completion rules |

### context/essentials.md — Platform Basics
| Lines | Section | Description |
|-------|---------|-------------|
| 1-36 | Platform Overview | Architecture, MCP-orchestrated runtime, system tables |
| 38-67 | Naming Conventions | Usr prefix, PascalCase, GUID rules |
| 70-167 | Package Structure + Workflow | descriptor.json, directory layout, local MCP generation flow |
| 171-234 | Clio CLI Commands | Environment, package, development commands |
| 238-244 | Local MCP Workflow | Local mutation/refresh sequence |
| 248-258 | ModifiedOnUtc Format | Timestamp format reference |

### context/business-checklist.md — Checklist
| Lines | Section | Description |
|-------|---------|-------------|
| 5-25 | Output Format | Canonical 11-section BA plan contract and mapping rule |
| 29-56 | Goal + Domain Expertise | BA discovery style and domain-quality bar |
| 58-157 | Checklist Groups | Discovery buckets for outcome, roles, process, data model, UX, assumptions |
| 159-191 | Logic Quality + Pre-analysis | Cross-section validation before draft approval |
| 193-228 | Completion + Clarification | Completion criteria, assumption persistence, question strategy, technical boundary |
| 230-233 | Display Field Defaulting | Pointer to `clio` MCP app-modeling guidance for title/display assumptions |

### context/mcp-application-tools-reference.md — Local MCP Workflow Wrapper
| Lines | Section | Description |
|-------|---------|-------------|
| 1-5 | Purpose | Local wrapper scope; not the executable MCP spec |
| 7-22 | Source Of Truth | Repo-local responsibilities vs `clio` MCP responsibilities |
| 24-40 | Local Transport | `scripts/mcp_client.py` usage and stdio rules |
| 42-54 | Canonical Runtime Result | Flat MCP response fields used by this repo |
| 56-72 | Normalization | `mcp-application-result.json` normalization and local helper projections |
| 74-84 | Local Refresh Pattern | Create/discover, mutate, refresh, normalize sequence |
| 86-98 | Local Follow-up Helpers | Evidence/report/page-sync/schema-sync helper scripts |
| 99-117 | Minimal Example | Persist raw MCP result, then normalize |

### context/ui-reference.md — Freedom UI
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

### context/viewconfig-reference.md — viewConfigDiff Recipes
| Lines | Section | Description |
|-------|---------|-------------|
| 1-31 | Operations + Naming | 4 operation types, element naming conventions |
| 32-43 | User Input | Parent container requirement, `page-get` for discovery |
| 44-91 | Deep Container Discovery | bundle.viewConfig parsing, fallback heuristics, container selection table |
| 92-118 | Entity-Field / Grid Sync | Deterministic field and grid sync workflows |
| 119-263 | FormPage Field Recipes | All field types: Input, ComboBox, Checkbox, Date, Number, etc. |
| 271-383 | Components (Button) | crt.Button with full property reference |
| 383-438 | Editing Safety Contract | Safe JSON editing procedures |
| 439-483 | ResourceString Localization | #ResourceString(key)# macros, auto-derive, tab example |

### context/schema-reference.md — Schema GUIDs
| Lines | Section | Description |
|-------|---------|-------------|
| 7-29 | Parent Entity Types | BaseEntity, BaseLookup GUIDs |
| 30-61 | Page Template Parents | Page parent type GUIDs |
| 62-89 | Display Column Guardrails | BaseLookup Name field rules |
| 64-111 | DataValueType GUIDs | Type GUIDs + numeric IDs for all column types |
| 112-225 | Schema File Formats | Entity (3 files), Page (4 files), Addon (3 files) |
| 296-315 | System Entity UIds | Key system entity schema UIds |

### context/data-bindings-reference.md — Data Bindings
| Lines | Section | Description |
|-------|---------|-------------|
| 1-84 | MCP Binding & Schema Inspection Tools | get-entity-schema-properties, get-entity-schema-column-properties, create-data-binding-db, upsert-data-binding-row-db APIs |
| 85-149 | Binding Structure + Targets | Directory layout, SysModule, SysModuleEntity, lookups |
| 150-168 | ID Rules + Guidance | GUID generation, best practices |

### context/devkit-common-reference.md — SDK API
| Lines | Section | Description |
|-------|---------|-------------|
| 1-30 | Scope + Usage Guide | Public API scope, page-body vs frontend work |
| 31-97 | Services + Models | Core services, AI models, response types, metadata |
| 98-114 | Decorators + Functions + Enums + Handlers | All export categories |
| 115-145 | AI Code Generation Guidance | Safe defaults, anti-patterns |

### scripts/mcp_client.py — MCP Client
| Lines | Section | Description |
|-------|---------|-------------|
| 1-55 | Clio Resolution | CLIO_CMD env var, global lookup, error |
| 56-100 | call_mcp_tool() | Main function: build JSON-RPC, spawn clio, parse |
| 101-168 | Response Parsing | JSON decode, isError check, data extraction |

## MCP Tool Lookup Guidance

When you need executable tool parameters or current response shape:

| Need | Read |
|------|------|
| Current MCP tool signature | `tools/list` and the discovered `clio` MCP tool schema |
| App-modeling semantics | `docs://mcp/guides/app-modeling` |
| Local invocation pattern | `scripts/mcp_client.py` |
| Local result normalization | `context/mcp-application-tools-reference.md` |
| Repo-local execution flow | `agents/04-implementation.md` and relevant skill file |

## Skills Detail Map

### skills/entity-creation/SKILL.md — Entity Sync via MCP
| Lines | Section | Description |
|-------|---------|-------------|
| 14-29 | What + Hard Rules | Scope, schema mutation rules, `clio` MCP source-of-truth note |
| 31-93 | Input + Request Shapes | Expected plan fields and current request examples |
| 95-112 | Operation Format | Column operation actions |
| 114-149 | Canonical Runtime Context + Refresh | Flat runtime contract, normalization, refresh rules |
| 153-157 | Failure Policy | Retry and stop conditions |

### skills/page-schema-editing/SKILL.md — Edit Live Pages
| Lines | Section | Description |
|-------|---------|-------------|
| Core sections | Context + MCP Tools | Required reads, page-list/page-get/page-update signatures |
| Core sections | Schema Body Format | AMD markers, section anatomy |
| Core sections | Workflow Steps 1-3 | Discover → Read → Modify body |
| Core sections | Steps 3a-3b | Sync entity fields into FormPage, adjust ListPage sorting |
| Core sections | Steps 4-5 | Dry run validation, save |
| Core sections | Critical Rules + Validation | Pre/post edit checklists |
| Core sections | Example | Add handler + update deps in one operation |

### skills/page-creation/SKILL.md — Generate New Page
| Lines | Section | Description |
|-------|---------|-------------|
| Core sections | Outputs + Inputs + Parents | 4 generated files, plan.md input, template parents |
| Core sections | Rules + Validation + Post-creation | Generation rules, checklist, page-schema-editing handoff |

### skills/data-bindings-creation/SKILL.md — Seed Data
| Lines | Section | Description |
|-------|---------|-------------|
| Core sections | Outputs + Inputs | Generated binding files, required context |
| Core sections | Rules + MCP Flow + Validation | Binding rules, typical flow, checklist |

### skills/package-descriptor-creation/SKILL.md — Package Descriptor
| Lines | Section | Description |
|-------|---------|-------------|
| Core sections | Output + Inputs | descriptor.json, template reference |
| Core sections | Shape + Rules + Validation | Required JSON structure, naming rules |
