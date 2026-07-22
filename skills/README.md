# Skills Directory

This directory hosts the CAADT skills: the app-workflow orchestrator entrypoint, an independent theming entrypoint, plus the reusable domain-expertise skills the app orchestrator hands off to.

## Active skills

- **`creatio-app-orchestrator/`** — single entrypoint skill that routes the host coding agent into the CAADT workflow: Gate P → Business Plan (Agent 2) → Gate R → environment setup (Agent 1) → implementation via clio MCP. The skill defers all orchestration policy to `AGENTS.md` and all stage instructions to `runbooks/`.
- **`creatio-branding-orchestrator/`** — independent entrypoint skill for branding and theming requests: collects brand colors, fonts, logos, and a theme name, runs the guided palette conversation through clio's theming guidance (`docs://mcp/guides/theming`) and color tool, then builds and applies the theme, the logos, and a palette-matched background — the assets through clio's branding guidance (`docs://mcp/guides/branding`). A peer of the app orchestrator, not a stage of the app workflow — branding produces no Business Plan and does not apply Gate P/Gate R.
- The app orchestrator hands off mid-workflow to reusable domain-expertise skills that live in this directory (e.g. data-model naming, Freedom UI guidelines). See each `*/SKILL.md` for the current set — it is intentionally not duplicated here.

## Design notes

- The **stage runbooks** under `runbooks/` (environment setup, requirements gathering) are stage playbooks loaded by the orchestrator at the right phase. They are not independently triggerable and must not be promoted to standalone user-facing skills, as they would risk being invoked out of gate order.
- **Reusable domain-expertise skills** invoked mid-workflow by the orchestrator are permitted: they carry naming/UI knowledge the orchestrator hands off to, not a stage of the sequential gate flow. The app orchestrator remains the single entrypoint **for the app workflow**.
- A **separate standalone entrypoint** is warranted only for an independent workflow with its own trigger and no gate order — `creatio-branding-orchestrator` is one (branding has no Business Plan and no Gate P/Gate R). Sequential workflow stages are not.
- The implementation stage uses clio MCP tools after Gate R approval, guided by the approved Business Plan and Technical Implementation Handoff produced through this skill.
