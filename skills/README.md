# Skills Directory

This directory hosts the entrypoint skill(s) for CAADT.

## Active skills

- **`creatio-app-orchestrator/`** — single entrypoint skill that routes the host coding agent into the CAADT workflow: Gate P → Business Plan (Agent 2) → Gate R → environment setup (Agent 1) → implementation via clio MCP. The skill defers all orchestration policy to `AGENTS.md` and all stage instructions to `runbooks/`.
- **`analytics-widgets/`** — thin clio-pointer routing skill for Freedom UI analytics-widget authoring. It carries no generic content (no layout tables, widget catalog, patterns, or checklists); it only routes to the clio MCP guidance catalog (`get-guidance name=analytics-widgets`, which fans out to `dashboards`, `indicator-widget`, and the `placement-contexts` reference). The authoritative content lives in clio, not here.

## Design notes

- CAADT exposes **one orchestration skill on purpose** (`creatio-app-orchestrator`). The workflow is a single sequential contract; individual orchestrator stages (environment setup, requirements gathering) are not independently triggerable and must not be promoted to standalone skills, as they would risk being invoked out of gate order. **Thin clio-MCP routing-pointer skills (e.g. `analytics-widgets`) are a distinct, permitted category**: they carry no generic content and only route to the clio MCP guidance catalog, so they cannot run an orchestration stage out of gate order.
- Runbooks under `runbooks/` are stage playbooks loaded by the orchestrator at the right phase, not skill entrypoints.
- The implementation stage uses clio MCP tools after Gate R approval, guided by the approved Business Plan and Technical Implementation Handoff produced through this skill.
