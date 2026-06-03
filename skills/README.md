# Skills Directory

This directory hosts the entrypoint skill(s) for CAADT.

## Active skills

- **`creatio-app-orchestrator/`** — single entrypoint skill that routes the host coding agent into the CAADT workflow: Gate P → Business Plan (Agent 2) → Gate R → environment setup (Agent 1) → implementation via clio MCP. The skill defers all orchestration policy to `AGENTS.md` and all stage instructions to `runbooks/`.

## Design notes

- CAADT exposes **one skill on purpose**. The workflow is a single sequential contract; individual stages (environment setup, requirements gathering) are not independently triggerable and must not be promoted to standalone skills, as they would risk being invoked out of gate order.
- Runbooks under `runbooks/` are stage playbooks loaded by the orchestrator at the right phase, not skill entrypoints.
- The implementation stage uses clio MCP tools after Gate R approval, guided by the approved Business Plan and Technical Implementation Handoff produced through this skill.
