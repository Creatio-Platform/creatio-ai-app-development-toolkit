# Skills Directory

This directory hosts the CAADT skills: the single orchestrator entrypoint plus the reusable domain-expertise skills it hands off to.

## Active skills

- **`creatio-app-orchestrator/`** — single entrypoint skill that routes the host coding agent into the CAADT workflow: Gate P → Business Plan (Agent 2) → Gate R → environment setup (Agent 1) → implementation via clio MCP. The skill defers all orchestration policy to `AGENTS.md` and all stage instructions to `runbooks/`.
- The orchestrator hands off mid-workflow to reusable domain-expertise skills that live in this directory (e.g. data-model naming, Freedom UI guidelines). See each `*/SKILL.md` for the current set — it is intentionally not duplicated here.

## Design notes

- The **stage runbooks** under `runbooks/` (environment setup, requirements gathering) are stage playbooks loaded by the orchestrator at the right phase. They are not independently triggerable and must not be promoted to standalone user-facing skills, as they would risk being invoked out of gate order.
- **Reusable domain-expertise skills** invoked mid-workflow by the orchestrator are permitted: they carry naming/UI knowledge the orchestrator hands off to, not a stage of the sequential gate flow. The orchestrator remains the single entrypoint.
- The implementation stage uses clio MCP tools after Gate R approval, guided by the approved Business Plan and Technical Implementation Handoff produced through this skill.
