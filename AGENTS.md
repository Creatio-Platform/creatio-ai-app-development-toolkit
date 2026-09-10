# AGENTS.md - Creatio AI App Development Toolkit

This repository is a **marketplace of Creatio plugins** for coding agents (Claude Code, Codex CLI, GitHub Copilot CLI,
Cursor). Every plugin lives under `plugins/<name>/` with one flat `skills/` directory and its own host manifests;
the root `.claude-plugin/plugin.json` is a meta-plugin that installs the whole family.

## Repository layout

| Plugin | Holds |
|---|---|
| `plugins/creatio-core` | shared context (`context/`), `creatio-schema-naming`, `creatio-ui-guidelines`, the product-telemetry hook (`hooks/`), `.mcp.json` for clio |
| `plugins/creatio-app-builder` | `creatio-app-orchestrator` with the orchestration policy, runbooks and business checklist as `references/`, Python `runtime/`, the Cursor rule in `rules/` |
| `plugins/creatio-ui` | `creatio-branding-orchestrator`, `creatio-mobile-page-conversion` |
| `plugins/creatio-migration` | `classic-to-freedom-migration` with its engine, `classic-ui-expert`, `_workflow-core` |

Where the rules live:

- The app-workflow contract — approvals (Gate P / Gate R), the BA-style Business Plan format, routing, support mode,
  execution UX — is `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/orchestration-policy.md`,
  loaded by that skill. Global business invariants are in `plugins/creatio-core/context/essentials.md`.
- Versioning and the release flow are documented in `docs/versioning-and-release.md`.
- The rules below apply to every plugin.

## Source Of Truth

Authority model:

- `clio MCP` is the only authoritative source for the executable MCP contract.
- Tool names, parameter names, aliases, defaults, response shapes, error shapes, and canonical or fallback flow hints must come from `get-tool-contract`.
- Repository docs must not define an independent MCP API contract.
- Repository docs remain authoritative for orchestration, approvals, BA structure, and product/business invariants.
- Human-readable MCP guidance for entity/page flows and DataForge status context must come from `docs://mcp/guides/app-modeling` and `docs://mcp/guides/existing-app-maintenance`.
- Diagnostic-first behavior under support mode (severity routing, confirmation probes, fail-fast evidence, reporting sections) must come from `docs://mcp/guides/support-mode` rather than re-stated inline in repository agent runbooks.

Tool surface preference (clio MCP vs CLI):

- Prefer clio MCP tools for any operation that has an MCP equivalent. Resolve the available set via `get-tool-contract`.
- Spawn the local `clio` CLI binary through a shell only when no MCP equivalent exists for the required operation.
- After any MCP or environment failure has been resolved, return to MCP-first on the next call — do not stay on CLI fallback by default.
- Do not parse CLI text output as a substitute for an MCP tool that returns the same data as structured fields. If parsing CLI output is required, that is a signal to switch back to the MCP equivalent.

clio MCP availability preflight (fail fast on missing prerequisites):

- Before the first clio operation of a task, run a clio MCP **availability preflight** — once, up front; never discover a missing or dead server mid-run. It resolves into three states, and the STOP decision is a **deterministic gate**, not a judgement call the agent can reason its way past:
  - **State A — native clio MCP tools are surfaced to this host** (the host tool registry exposes the resident clio tools, e.g. `get-tool-contract`): proceed with native tool-calls for resident tools and `clio-run` for long-tail tools; do not touch `plugins/creatio-app-builder/runtime/scripts/mcp_client.py`. No script is needed — this state is host-observable. Existing app/schema/page flows are unaffected. **Caveat (diagnosable, not silent):** State A is *assumed* from the host tool registry and is NOT verified by the gate, so a decoy/impersonating Creatio MCP server (e.g. the composable-app OData server, which lacks the clio app-modeling tools) could be mistaken for native clio transport — structurally the same wrong-path risk this gate exists to prevent. Before assuming State A, sanity-check that a genuine **clio resident tool** (`get-tool-contract`) is the one surfaced, and note the assumption so a misclassification is diagnosable after the fact. Precise State-A detection (rejecting a decoy server) is a **deferred hardening follow-up**, tracked separately.
  - **No native clio tools surfaced** — the host did not wire clio MCP as native tool-calls. This is **not automatically a blocker**: it may simply be a host with no native MCP transport on which clio is perfectly healthy. Do not guess and do not self-bootstrap — run the gate script `plugins/creatio-app-builder/runtime/scripts/clio_mcp_preflight.py` and act on its verdict (exit code + sentinel):
    - **State B — `usable` (exit 0, `PREFLIGHT: clio-mcp-usable`)**: clio is healthy; the host just isn't surfacing native clio tool-calls. clio is **not** the blocker. Handle it in this order — do **not** jump straight to the wrapper:
      1. **Prefer native transport.** Tell the developer that native clio MCP is the recommended path (it gives host-native await/progress; the wrapper has neither) and ask them to **connect clio as a native MCP server** in their coding agent — a stdio server that runs `clio mcp-server`. In the **user-facing message, include a concrete pointer** to the toolkit install docs (`README.md` / `docs/install.md`) so the developer knows *where* the per-host steps live — telling them *what* without *where* is not actionable. You **may also offer to show the exact config snippet to paste** (showing it is fine — the developer applies it; applying it yourself is the forbidden self-bootstrap). Do **not** hardcode host-specific connection steps in this contract: how an agent registers an MCP server varies by agent and changes over time — the install docs and the host's own MCP configuration are the source of truth. Then retry the preflight.
         - **Reload caveat — be honest about it.** On most hosts, enabling a native MCP server needs a **session reload**, which starts a fresh context, so the "retry" happens in a **new session**, not this one. Recommend native strongly **at the start of a task**; if the developer is already **mid-task**, say so plainly and note that the fallback wrapper keeps the current session's context — a legitimate reason **for the developer** to opt in now rather than lose in-progress work to a reload. You *surface* this trade-off; you do **not** choose the wrapper on their behalf. Even mid-task, the wrapper still requires the developer's **explicit opt-in** (see the opt-in signal below) — "mid-task" is never a licence for the agent to self-select the wrapper. Do not present "connect native then retry" as a seamless in-session action when it is not.
      2. **Fallback — only if native MCP cannot be connected right now:** `plugins/creatio-app-builder/runtime/scripts/mcp_client.py` is the **sanctioned** degraded path, and only after the developer has seen the connect-native recommendation **and** explicitly opts in (see the opt-in signal below).
      3. **Presenting the choice — native is listed first and marked recommended.** When you ask the developer how to proceed, the **connect-native-MCP option is the first choice and is labelled the recommended one**; the wrapper fallback comes **after it and is labelled not recommended**. Never list the wrapper as the first or default option, and never frame it as the "proceed now / work autonomously" path that makes connecting native look like extra work — leading with the wrapper (even when native is technically offered second) violates the prefer-native contract. Native is the recommended path even though it costs a session reload. Selecting the explicitly-labelled not-recommended wrapper option in this presented choice counts as the developer's explicit opt-in to the wrapper; a generic "yes" / "continue" outside such a labelled choice does not (see the opt-in signal below).
    - **State C — `blocked` (exit 3, `BLOCKER: clio-mcp-unavailable`)**: clio could not be resolved, or its MCP server did not respond. STOP and return the gate's **prerequisites blocker** verbatim instead of silently degrading to a slower path. The blocker lists the prerequisites the developer fixes once, up front:
      - install .NET (the SDK/runtime clio requires),
      - install clio (`dotnet tool install clio -g`) — or, if it is already installed but not on PATH, add it to PATH or set `CLIO_CMD` instead of reinstalling,
      - register the target environment (`clio reg-web-app`).
- When the gate is blocked (State C), do NOT self-bootstrap the environment: **do not install** or download the .NET SDK, do not change PowerShell `ExecutionPolicy`, and do not silently register environments. These are developer-owned prerequisite fixes, not automatic agent actions. (The URL-based auto-register in `Workflow Routing` applies only once clio MCP is usable and a clio operation is running; it is not a license to register environments while the server is down.)
- **Registered but unresponsive** — if an environment is registered but clio MCP does not respond (server crash, hang, transport error), the gate returns State C: treat it as unavailable, show the prerequisites blocker, and reach for the developer — not the Python wrapper — to fix it. The gate makes ONE bounded probe — the probe's own timeout defaults to 20s, but the watchdog's hard wall-clock ceiling (which also covers clio's cold-start `initialize` handshake) is up to ~55s before a hung server is force-killed and classified blocked; do not retry indefinitely and do not hand-roll a longer wait to force a dead server through.
- **Opt-in signal (State B only):** the escape hatch is unlocked only by an explicit developer instruction to use the stdio wrapper on this host (for example "use the clio stdio wrapper" / "run clio via mcp_client.py"). A generic "yes" / "continue" / an approved command prefix is **not** opt-in. Before running the wrapper, frame the fallback in **plain language** so the choice is informed — that it is a **slower backup connection**, that it is **not the recommended path**, and that it shows **no progress** so long steps (like building the app) will look frozen for several minutes even though they are still running (the developer will not be able to tell "stuck" from "still working"). Do **not** bury this behind jargon such as "may appear to hang".
- `plugins/creatio-app-builder/runtime/scripts/mcp_client.py` is an **explicit opt-in escape hatch**, not the default degraded path. Offer it, and run it, only in State B after the developer explicitly opts in — never as the automatic response to State C (an unavailable clio MCP server).

clio MCP transport preference (native tool-calls vs stdio wrapper):

- Resident tools (`get-tool-contract` index: `resident=true`) are called natively; every other tool is invoked via `clio-run <command>`. Never wrap a resident tool in `clio-run`. (Canonical rule, mirrored verbatim from clio MCP's `core-rules` guidance.)
- When the host coding agent exposes clio MCP as native tool-calls, invoke resident tools directly. `plugins/creatio-app-builder/runtime/scripts/mcp_client.py` is an **explicit opt-in escape hatch** for hosts with no native MCP transport (see "clio MCP availability preflight" above) — never the automatic/default fallback and never the response to an unavailable server. Neither transport makes a long-tail (non-resident) tool callable by its own name: reach it through `clio-run` regardless of which transport is active.
- Do not spend a turn reading the wrapper's `--help` or source to reverse-engineer its CLI contract when native tool-calls are available. Resolve tool arguments from `get-tool-contract`, never from the wrapper's argument-parsing behavior.
- Single clio context: both transports — the native host MCP started from `.mcp.json` and the `mcp_client.py` stdio wrapper — must resolve the same `clio` binary through PATH / `CLIO_CMD`, so they share one clio config and one registered-environments list. Before the first environment resolution, confirm this single context; never let a native call report `environment not found` while the wrapper resolves the same environment (split-brain). If the two transports disagree on a known environment, stop and reconcile the clio resolution before continuing.

Canonical repository references:

- `plugins/creatio-core/context/INDEX.md`
- `plugins/creatio-core/context/essentials.md`
- `plugins/creatio-core/context/naming-conventions.md`
- `plugins/creatio-core/context/clio-cli-reference.md`
- `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/business-checklist.md`
- `plugins/creatio-core/context/model-discovery-evidence.md`

Read `plugins/creatio-core/context/INDEX.md` first so each phase can load only the relevant sections instead of full files.

Use the agent runbooks in `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/0*.md` as stage-specific execution instructions. Keep page modification patterns and workflow policy in repository docs, and resolve the executable MCP contract through `get-tool-contract` instead of duplicating payload rules in agent prompts.

## clio Coupling

CAADT does not pin a specific clio version. Users are expected to have the latest clio on PATH (`dotnet tool install clio -g` or `dotnet tool update clio -g`). `installer/install.py::preflight_clio()` only verifies that `clio` is on PATH; it does not check the version.

The actual coupling point between CAADT and clio is **MCP tool contracts**, which are resolved at runtime via `get-tool-contract`. If a tool CAADT depends on is missing or has changed signature, CAADT fails fast at session start with an actionable error (`Tool X not found in clio MCP — update clio or report CAADT bug`). No version pin needed.

<!-- BEGIN MANAGED SECTION: company-agent-policy v1.1.0 -->
<!-- DO NOT EDIT THIS SECTION MANUALLY. -->

## Required Workflow
Attribution of AI-authored changes is handled automatically by the installed Claude Code tooling hooks (Pre/PostToolUse events) — no manual skill or marker command is required for normal work.

The agent must:
1. Let the installed hooks record every file the agent creates or modifies.
2. Allow the hooks to manage the `AI agents: ...` commit trailer automatically.
3. Avoid running manual attribution commands during normal work.

<!-- END MANAGED SECTION -->
