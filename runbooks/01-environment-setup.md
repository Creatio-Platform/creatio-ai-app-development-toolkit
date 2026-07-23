# Agent 01 — Environment Setup

## Role

Configure clio CLI and establish connection to the target Creatio runtime for the current app workflow.

## Input/Output

- **Input:** Developer request with Creatio URL and `<AppName>`
- **Output:** Resolved `<env_name>` reported in conversation context

## Context

Read `AGENTS.md` for the Context Files Reference. For local clio CLI invocations used during environment bootstrap, read `context/clio-cli-reference.md`.

## clio MCP Availability Preflight (fail fast)

- Before the first clio operation, run a clio MCP **availability preflight** — once, up front. It has three states, and the STOP decision is a **deterministic gate**, not a judgement call:
  - **State A — native clio MCP tools are surfaced to this host** (e.g. `get-tool-contract` is a resident tool-call): proceed. No script needed — this is host-observable.
  - **No native tools surfaced** — this is **not automatically a blocker**; do not guess and do not self-bootstrap. Run the gate script `runtime/scripts/clio_mcp_preflight.py` and act on its exit code + sentinel:
    - **State B — `usable` (exit 0, `PREFLIGHT: clio-mcp-usable`)**: clio is healthy. On a host with no native MCP transport the stdio wrapper is the sanctioned path — explicit developer opt-in only. clio is not the blocker.
    - **State C — `blocked` (exit 3, `BLOCKER: clio-mcp-unavailable`)**: clio could not be resolved, or its MCP server did not respond. STOP and return the gate's **prerequisites blocker** verbatim instead of degrading to a slower path. The blocker lists what the developer fixes once, up front: install .NET, install clio (`dotnet tool install clio -g`) — or add an existing install to PATH / set `CLIO_CMD` — and register the environment (`clio reg-web-app`).
- On State C do NOT self-bootstrap: **do not install** or download the .NET SDK, do not change PowerShell `ExecutionPolicy`, and do not silently register environments. Report the missing prerequisites and let the developer fix them.
- A registered-but-**unresponsive** server is State C: the gate is ONE bounded probe (default 20s), then the blocker. Do not retry indefinitely, and do not reach for the Python wrapper to work around a dead server.
- The full contract is in `AGENTS.md`, "clio MCP availability preflight". The prerequisite checks in Step 1 below are the fail-fast messages `clio_mcp_preflight.py` surfaces.

## MCP Transport And Single clio Context

- Resident tools (`get-tool-contract` index: `resident=true`) are called natively when the host coding agent exposes clio MCP as native tool-calls; every other tool is invoked via `clio-run <command>` regardless of transport. `runtime/scripts/mcp_client.py` is an **explicit opt-in escape hatch** for hosts with no native MCP transport — not the default fallback and never the automatic response to an unavailable clio MCP server; run it only after the developer explicitly opts in. Do not reverse-engineer the wrapper's CLI contract when native calls are available (see `AGENTS.md`, "clio MCP transport preference").
- Both transports must resolve the same `clio` binary (PATH / `CLIO_CMD`) so they share one config and one registered-environments list. Confirm this single context before resolving the environment: an environment registered through one transport must be visible to the other. If a native call reports `environment not found` while the wrapper resolves the same environment (or vice versa), stop and reconcile the clio resolution before continuing — do not register a duplicate environment to work around a split-brain.

## Support Mode

When support mode is on, follow `docs://mcp/guides/support-mode` for diagnostic-first behavior, severity routing, confirmation probes, fail-fast evidence, and reporting. The transient-reachability retry budget (up to 3 additional attempts with 15-second delays for DNS resolution, connect timeouts, and host-unreachable failures) is owned by `docs://mcp/guides/agent-execution`. Do not restate either policy in this runbook.

---

## Steps

### 0. Execution preflight

Before any `dotnet`, `clio`, Python, Node, or MCP-related command, validate the command executor through the same execution path that will be used for the real work.

Preflight contract:

- detect the current operating system and active command executor
- determine the executor required by the next command syntax
- run one trivial shell-health command through that exact executor path
- continue only if shell-health succeeds

Platform-specific rules:

- if the next commands use Windows PowerShell syntax or require a PowerShell-backed executor, validate that executor first; a `cmd.exe`-only environment is not an acceptable substitute
- if the next commands use Windows `cmd.exe` syntax, validate `cmd.exe` first
- if the next commands use macOS or Linux POSIX shell syntax, validate the active POSIX shell first; use the current `environment_context.shell` when available unless a later step explicitly requires a different shell
- if a later step requires a different executor than the current shell, validate that executor before the first dependent command

Recommended shell-health checks:

- Windows PowerShell-backed flow: `Get-Location` or `Write-Host ok`
- Windows `cmd.exe` flow: `cd` or `echo ok`
- macOS/Linux POSIX flow: `pwd` or `printf ok`

Fail-fast rules:

- if the shell-health command fails with executor-level errors such as `File not found`, `shell not found`, startup failure, or equivalent boot errors, stop immediately with a blocker
- do not continue to `dotnet`, `clio`, Python, Node, or MCP bootstrap commands
- do not retry the same stage in alternate syntax variants such as `New-Item`, `mkdir`, `cmd /c`, `python -c`, `node -e`, or alternate shell IDs before executor health is confirmed
- do not diagnose path, permission, project-root, or directory-creation problems until the executor has been proven healthy

User-facing blocker message:

- state which executor was expected
- state which executor was actually available or failing
- state that implementation execution did not start because execution preflight failed
- ask only for the minimum environment correction needed to continue

### 1. Verify prerequisites

These checks are fail-fast: when a prerequisite is missing, report it and stop. **Do not self-bootstrap** — do not install or download the .NET SDK, do not run `dotnet tool install clio -g` for the developer, do not change PowerShell `ExecutionPolicy`, and do not silently register environments. Surface the prerequisite and wait for the developer to fix it.

**Step 1a — Check .NET SDK:**
```bash
dotnet --version
```
If not found — stop and tell the developer:
> .NET SDK is not installed. Download and install it from:
> **https://dotnet.microsoft.com/download**
> Then restart the terminal and retry.

**Step 1b — Check clio (after .NET is confirmed):**

Three scenarios:

**Scenario 1 — clio not installed:**
```bash
clio ver  # → command not found
```
Stop and tell the developer:
> clio is not installed. Please install it:
> ```
> dotnet tool install clio -g
> ```
Then wait for confirmation and retry.

**Scenario 2 — clio installed globally (standard):**
```bash
clio ver  # → prints version, e.g. clio: 8.0.x.x
```
Use the latest released clio:
```bash
dotnet tool install clio -g       # first install
dotnet tool update clio -g        # if already installed
```
CAADT does not pin a specific clio version. If clio is missing a tool CAADT needs, runtime `get-tool-contract` will fail fast with an actionable error.

**Scenario 3 — user provided a custom clio path:**
The developer mentioned a custom binary (e.g. `dotnet ~/path/to/clio.dll`). Set the `CLIO_CMD` env var for this session:
```bash
export CLIO_CMD="dotnet /full/path/to/clio.dll"
dotnet /full/path/to/clio.dll ver
```
`runtime/scripts/mcp_client.py` will pick up `CLIO_CMD` automatically.

Windows PowerShell peer:
```powershell
$env:CLIO_CMD = "dotnet C:\full\path\to\clio.dll"
py -3 .\runtime\scripts\mcp_client.py list-apps --args-file .\list-apps.args.json --timeout 30
```

### Environment Name Guardrail

**CRITICAL:** Never use a URL (e.g., `http://localhost:5001`) as `environmentName`.
The `environmentName` must be a registered clio environment name from `clio list-environments`.
Always register through `clio reg-web-app` if the environment does not exist.

### Ambiguous Match Guardrail

If `clio list-environments` returns multiple registered environments whose normalized URL matches the current request URL:

1. Treat the environment choice as ambiguous.
2. Ask the developer to choose the exact `environmentName`.
3. Do not auto-select based on prior runs, active-environment status, or an internal plan that mentions one of the matching aliases.
4. Skip the question only when the current conversation explicitly names the environment key to use for the current URL.

### 2. List existing environments

```bash
clio list-environments
```

Display the list to the developer. Check if an environment for the current request URL already exists.

- **If exactly one environment for the current request URL exists** — use that environment name and skip to Step 5.
- **If two or more environments for the current request URL exist** — stop and ask the developer which environment name to use. Do not guess.
- **If it does not exist** — proceed to Step 3.

### 3. Register the environment

If the developer provided URL, login, and password:

```bash
clio reg-web-app <env_name> -u <url> -l <login> -p <password>
```

**Auto-register from a prompt URL (default).** When the current request supplies a Creatio URL that is not yet registered and the developer did **not** provide credentials, register it **without a confirmation turn** using the default credentials `Supervisor` / `Supervisor` — **but only for a host eligible for zero-confirmation auto-register**. Extract the host from the URL's **authority component only** — discard any `user:pass@` userinfo prefix **and any `:port` suffix** before matching (e.g. `https://creatio.com@evil.com/` has host `evil.com` and does NOT match; `http://ts1-core-dev04:88/` has host `ts1-core-dev04` and DOES match), and match wildcards on the **rightmost labels**, never as a substring. Zero-confirmation auto-register is limited to an internal Creatio development host (`*.tscrm.com` — `xtscrm.com` does NOT match; or a single-label `ts1-*` host with **no dots** such as `ts1-core-dev04`, where a dotted host like `ts1-evil.attacker.com` does NOT match) or `localhost` / `127.0.0.1`. A Creatio **cloud** host (`*.creatio.com` — `creatio.com.attacker.com` does NOT match) is NOT eligible: because `creatio.com` subdomains may be customer- or self-service-provisionable, confirm with the developer before registering a cloud host. This is a closed list, not a broad category — extend it explicitly if more patterns are ever needed.

```bash
clio reg-web-app <env_name> -u <url> -l Supervisor -p Supervisor
```

This default applies only to this unambiguous case (the URL is in the prompt, not yet registered, the host matches a known Creatio pattern, and no credentials were supplied). Do not pause to ask for credentials in that case.

**If the URL host does not match a known Creatio host pattern**, do not auto-register with default credentials — the target may be an untrusted or prompt-injected URL. Fall back to the normal flow and **ask the developer for credentials** before registering. Also ask for login and password when the developer named a different login, supplied partial credentials, or the intent is ambiguous — do not guess a non-default login.

If `clio reg-web-app` fails to register or the login is rejected, **stop with a clear error** and report it. Do not retry with other guessed credentials.

> Security note: `Supervisor` / `Supervisor` is a well-known default. After auto-registering an environment that is reachable beyond `localhost`, remind the developer to change the default `Supervisor` password on that environment.

The `<env_name>` should be a short, descriptive name derived from the URL (e.g., `dev-crm`, `prod-sales`). Sanitize it to a safe slug — letters, digits, and dashes only — stripping any other characters from the URL so it cannot inject shell metacharacters into the `reg-web-app` invocation.

Pass `<url>` (and every argument) to `reg-web-app` as **discrete argv arguments**, never via shell string interpolation, so characters in the URL path or query cannot inject shell metacharacters. Keep the full instance URL **including its path** — the Creatio instance lives at that path (e.g. `/studioenu_15656231_0630`); host matching uses only the host, but registration needs the whole URL, so do not strip the path.

### 4. Auto-detect runtime during registration

Creatio instances can be `.NET Core / NET8` or `.NET Framework`.
Do not detect this in CAADT. Let `clio reg-web-app` resolve it and persist the correct `IsNetCore` value:

```bash
clio reg-web-app <env_name> -u <url> -l <login> -p <password>
```

If `clio reg-web-app` cannot determine the runtime automatically, treat that as a blocker and stop before app creation.
Do not retry the same registration with speculative `-i true` / `-i false` toggles unless the developer explicitly asks for a manual override.

### 5. Verify the connection

```bash
clio healthcheck -e <env_name>
```

- **Success** — proceed to Step 6.
- **Failure** — see Error Handling below.

### 6. Report resolved environment

Report the resolved environment using this exact block heading and format:

```
**Runtime Environment**
- Environment name: <env_name>
- URL: <URL>
- Runtime: .NET Core | .NET Framework
- Custom clio path: <path>   ← omit this line when the developer did not provide a custom path
```

This information stays in the conversation context — Agent 2 reads the environment name from the conversation, not from a file.

### 7. DataForge availability check

Run the DataForge status check against the resolved environment. `dataforge-status` is a resident tool (`get-tool-contract` index: `resident=true`), so call it natively when the host exposes native MCP; use the stdio wrapper below only as the explicit opt-in escape hatch (see "MCP Transport And Single clio Context" above):

```bash
python3 runtime/scripts/mcp_client.py dataforge-status --args-file ./dataforge-status.args.json --timeout 30
```

Where `dataforge-status.args.json` contains:
```json
{ "environment-name": "<env_name>" }
```

Interpret the result and append one of these lines to the **Runtime Environment** block reported in Step 6:

- `dataforge-availability: ready — use dataforge-find-tables / dataforge-context for entity discovery` — when `status.status` equals `"Ready"`
- `dataforge-availability: unavailable — skip entity discovery, create new schemas directly` — any error, exception, or non-Ready status

If the call throws or times out, record `dataforge-availability: unavailable`. Do not retry.

### 8. Resolve writable package context (up front)

Before any schema or page edit happens later in the flow, make sure there is a writable package to edit. Resolve this now — do not defer it until a mid-run write rejection.

- For a brand-new app, the package created by the new-app flow is writable; no extra action is needed here.
- For an existing or installed app, confirm the target package is unlocked and editable. An installed-app package is frequently locked / read-only and will reject direct schema writes.
- If the target package is locked or read-only, unlock it or select/create a writable maintainer package before modeling begins.
- Resolve the exact tool and lock semantics through `get-tool-contract` and `docs://mcp/guides/existing-app-maintenance`; for local CLI lock/unlock invocations see `context/clio-cli-reference.md`.

Report the resolved writable package context in the conversation so Agent 2 and the implementation step do not rediscover it.

## Error Handling

| Error | Action |
|-------|--------|
| `dotnet` not found | Stop. Tell developer to install .NET SDK from https://dotnet.microsoft.com/download, then restart terminal |
| `clio ver` fails | Stop. Tell developer to install clio: `dotnet tool install clio -g` |
| Executor preflight fails | Stop immediately. Report the expected executor, the actually available or failing executor, and that execution did not start because preflight failed |
| `clio reg-web-app` auto-detection fails | Stop before app creation. Surface the clio error and ask the developer whether to retry with an explicit runtime override. |
| `clio healthcheck` fails | Verify the URL is reachable (check for typos, trailing slashes). Verify login/password. Ask the developer to double-check credentials and retry. |
| Registration fails | Check if the environment name is already taken (`clio list-environments`). Try a different name or update the existing one. |
| `reg-web-app` login rejected (auth failure) | Stop with a clear error and report it. Do not retry with other guessed credentials. (Consistent with AGENTS.md Rule 1: stop on failure — do not auto-prompt and continue.) |
| Connection timeout | Ask the developer to verify the Creatio instance is running and accessible from this machine. |
| Recovered non-blocking tool error (read-back timeout where the operation actually succeeded, transient retry) | Do not surface it as a failure. Report it as normal progress or omit it; surface only an actual blocker that stops the run. See AGENTS.md "Execution UX and Effort Budget". |
| Support mode + non-critical environment/tooling failure | Record canonical incident, apply bounded recovery first, and escalate to fail-fast only when unresolvable and blocking trustworthy CLIO MCP execution evidence. |

## Completion Criteria

✅ clio MCP availability preflight passed — native clio tools are surfaced (State A), or the `clio_mcp_preflight.py` gate returned `usable` (State B) and the wrapper was used only on explicit opt-in; otherwise the gate returned `blocked` (State C) and the run stopped with a prerequisites blocker (install .NET, install clio, `reg-web-app`) and did not self-bootstrap  
✅ `clio healthcheck -e <env_name>` passes  
✅ Single clio context confirmed — native MCP and the stdio wrapper resolve the same clio config and the same registered environment  
✅ Resolved environment name, URL, and runtime are reported in the conversation  
✅ DataForge availability status reported in the conversation (`dataforge-availability: ready` or `dataforge-availability: unavailable`)  
✅ Writable package context resolved up front and reported in the conversation (before any modeling / schema edit)  
✅ When support mode is on and the run returns a final response, include the canonical final support block sections; sections with no items must be emitted as `None`  
