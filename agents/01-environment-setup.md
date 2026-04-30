# Agent 01 — Environment Setup

## Role

Configure clio CLI and establish connection to the target Creatio runtime for the current app workflow.

## Input/Output

- **Input:** Developer request with Creatio URL and `<AppName>`
- **Output:** Resolved `<env_name>` reported in conversation context

## Context

Read `AGENTS.md` for the Context Files Reference. For local clio CLI invocations used during environment bootstrap, read `context/clio-cli-reference.md`.

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
python3 scripts/mcp_client.py --check-clio-version
```
The released version must be `8.0.2.50` or newer.
If the check fails, stop immediately and ask the developer to upgrade:
```bash
dotnet tool update clio -g
```

**Scenario 3 — user provided a custom clio path:**
The developer mentioned a custom binary (e.g. `dotnet ~/path/to/clio.dll`). Set the `CLIO_CMD` env var for this session:
```bash
export CLIO_CMD="dotnet /full/path/to/clio.dll"
dotnet /full/path/to/clio.dll ver
python3 scripts/mcp_client.py --check-clio-version
```
`scripts/mcp_client.py` will pick up `CLIO_CMD` automatically.

Windows PowerShell peer:
```powershell
$env:CLIO_CMD = "dotnet C:\full\path\to\clio.dll"
py -3 .\scripts\mcp_client.py --check-clio-version
py -3 .\scripts\mcp_client.py list-apps --args-file .\list-apps.args.json --timeout 30
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

If the developer did **not** provide login and/or password — **ask for them**. Do not guess or use defaults.

The `<env_name>` should be a short, descriptive name derived from the URL (e.g., `dev-crm`, `prod-sales`).

### 4. Auto-detect runtime during registration

Creatio instances can be `.NET Core / NET8` or `.NET Framework`.
Do not detect this in ADAC. Let `clio reg-web-app` resolve it and persist the correct `IsNetCore` value:

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

Run the DataForge status check against the resolved environment:

```bash
python3 scripts/mcp_client.py dataforge-status --args-file ./dataforge-status.args.json --timeout 30
```

Where `dataforge-status.args.json` contains:
```json
{ "environment-name": "<env_name>" }
```

Interpret the result and append one of these lines to the **Runtime Environment** block reported in Step 6:

- `dataforge-availability: ready — use dataforge-find-tables / dataforge-context for entity discovery` — when `status.status` equals `"Ready"`
- `dataforge-availability: unavailable — skip entity discovery, create new schemas directly` — any error, exception, or non-Ready status

If the call throws or times out, record `dataforge-availability: unavailable`. Do not retry.

## Error Handling

| Error | Action |
|-------|--------|
| `dotnet` not found | Stop. Tell developer to install .NET SDK from https://dotnet.microsoft.com/download, then restart terminal |
| `clio ver` fails | Stop. Tell developer to install clio: `dotnet tool install clio -g` |
| `clio` version is older than `8.0.2.50` | Stop. Tell developer to upgrade clio: `dotnet tool update clio -g` |
| Executor preflight fails | Stop immediately. Report the expected executor, the actually available or failing executor, and that execution did not start because preflight failed |
| `clio reg-web-app` auto-detection fails | Stop before app creation. Surface the clio error and ask the developer whether to retry with an explicit runtime override. |
| `clio healthcheck` fails | Verify the URL is reachable (check for typos, trailing slashes). Verify login/password. Ask the developer to double-check credentials and retry. |
| Registration fails | Check if the environment name is already taken (`clio list-environments`). Try a different name or update the existing one. |
| Connection timeout | Ask the developer to verify the Creatio instance is running and accessible from this machine. |
| Support mode + non-critical environment/tooling failure | Record canonical incident, apply bounded recovery first, and escalate to fail-fast only when unresolvable and blocking trustworthy CLIO MCP execution evidence. |

## Completion Criteria

✅ `clio healthcheck -e <env_name>` passes  
✅ Resolved environment name, URL, and runtime are reported in the conversation  
✅ DataForge availability status reported in the conversation (`dataforge-availability: ready` or `dataforge-availability: unavailable`)  
✅ When support mode is on and the run returns a final response, include the canonical final support block sections; sections with no items must be emitted as `None`  
