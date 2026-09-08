# Plugins

Every installable unit of the Creatio AI App Development Toolkit lives here, one directory per plugin with its own host
manifests (`.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, `.github/plugin/`) and one flat `skills/` directory.
The root catalogs (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.github/plugin/marketplace.json`)
list them; the root `.claude-plugin/plugin.json` is a meta-plugin that installs the whole family on Claude Code.

| Plugin | Owns |
|---|---|
| `creatio-core` | shared `context/`, `creatio-schema-naming`, `creatio-ui-guidelines`, the product-telemetry hook, `.mcp.json` (clio) |
| `creatio-app-builder` | `creatio-app-orchestrator` (Gate P → Business Plan → Gate R → implementation) with the orchestration policy, runbooks and business checklist under `references/`; Python `runtime/`; the Cursor rule in `rules/` |
| `creatio-ui` | `creatio-branding-orchestrator`, `creatio-mobile-page-conversion` |
| `creatio-migration` | `classic-to-freedom-migration` and its engine, `classic-ui-expert`, `_workflow-core` (the host-neutral workflow core that generates the shipped `*.workflow.js`) |

Rules that keep the plugins independent: every plugin depends only on `creatio-core`; a reference across plugins is a
skill name or a clio `get-guidance` article, never a relative path (ENG-96690 finishes that conversion).
