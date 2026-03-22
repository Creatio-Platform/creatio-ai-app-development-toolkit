# Agent 01 — Environment Setup

## Role

Configure clio CLI and establish connection to Creatio instance.

## Input/Output

- **Input:** Developer request with Creatio URL, `<AppName>`
- **Output:** `output/<AppName>/.creatio-env.json`

## Context

Read `AGENTS.md` for Context Files Reference (specifically `context/essentials.md` for clio commands).

---

## Steps

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
```
Note the version and proceed. No additional configuration needed.

**Scenario 3 — user provided a custom clio path:**
The developer mentioned a custom binary (e.g. `dotnet ~/path/to/clio.dll`). Set the `CLIO_CMD` env var for this session:
```bash
export CLIO_CMD="dotnet /full/path/to/clio.dll"
clio ver 2>/dev/null || dotnet $CLIO_PATH ver  # verify it works
```
`scripts/mcp_client.py` will pick up `CLIO_CMD` automatically.

### Environment Name Guardrail

**CRITICAL:** Never use a URL (e.g., `http://localhost:5001`) as `environmentName`.
The `environmentName` must be a registered clio environment name from `clio show-web-app-list`.
Always register through `clio reg-web-app` if the environment does not exist.

### 2. List existing environments

```bash
clio show-web-app-list
```

Display the list to the developer. Check if an environment for the target URL already exists.

- **If it exists** — use that environment name and skip to Step 5.
- **If it does not exist** — proceed to Step 3.

### 3. Register the environment

If the developer provided URL, login, and password:

```bash
clio reg-web-app <env_name> -u <url> -l <login> -p <password>
```

If the developer did **not** provide login and/or password — **ask for them**. Do not guess or use defaults.

The `<env_name>` should be a short, descriptive name derived from the URL (e.g., `dev-crm`, `prod-sales`).

### 4. Detect IsNetCore

Creatio instances can be .NET Core or .NET Framework. Detect this automatically:

1. **Try .NET Core first** (most common for modern Creatio):
   ```bash
   clio reg-web-app <env_name> -u <url> -l <login> -p <password> -i true
   clio healthcheck -e <env_name>
   ```
2. If healthcheck **succeeds** — use `isNetCore: true`.
3. If healthcheck **fails** — fall back to .NET Framework:
   ```bash
   clio reg-web-app <env_name> -u <url> -l <login> -p <password> -i false
   clio healthcheck -e <env_name>
   ```
4. Save the detected `isNetCore` value (`true` or `false`) for the env file.

**Critical:** Getting `isNetCore` wrong causes page-get/page-update MCP tools to fail with 404 or HTML responses. When in doubt, try **both** settings and use the one where healthcheck passes.

### 5. Verify the connection

```bash
clio healthcheck -e <env_name>
```

- **Success** — proceed to Step 6.
- **Failure** — see Error Handling below.

### 6. Save environment configuration

Create the file `output/<AppName>/.creatio-env.json`:

```json
{
  "environment": "<env_name>",
  "url": "<URL>",
  "isNetCore": true,
  "mcpTransport": "stdio",
  "mcpCommand": "clio mcp-server"
}
```

Replace `true` with `false` if .NET Framework was detected in Step 4.

`mcpCommand` is `clio mcp-server` for the standard global install. If the user provided a custom clio path at startup (e.g. `CLIO_CMD="dotnet /path/to/clio.dll"`), document that in `.creatio-env.json` as a `note` field — do NOT change `mcpCommand`.

### 7. Verify MCP via clio stdio (MANDATORY)

Verify that clio MCP responds correctly using the stdio client:

```bash
python3 scripts/mcp_client.py application-get-list '{"environment-name": "<env_name>"}' 30
```

- **Success** (response has `"success": true`) — environment setup is complete.
- **Failure** — stop and report blocker to developer. Check that clio is installed (`clio ver`) and the environment name is correct.

## Error Handling

| Error | Action |
|-------|--------|
| `dotnet` not found | Stop. Tell developer to install .NET SDK from https://dotnet.microsoft.com/download, then restart terminal |
| `clio ver` fails | Stop. Tell developer to install clio: `dotnet tool install clio -g` |
| `clio healthcheck` fails | Verify the URL is reachable (check for typos, trailing slashes). Verify login/password. Ask the developer to double-check credentials and retry. |
| Registration fails | Check if the environment name is already taken (`clio show-web-app-list`). Try a different name or update the existing one. |
| Connection timeout | Ask the developer to verify the Creatio instance is running and accessible from this machine. |
| `mcp_client.py` returns `success: false` | Check that clio is installed (`clio ver`), the environment name matches exactly, and the Creatio instance is running. |

## Completion Criteria

✅ `clio healthcheck -e <env_name>` passes  
✅ `output/<AppName>/.creatio-env.json` exists with `mcpTransport: "stdio"` and correct `environment`  
✅ `python3 scripts/mcp_client.py application-get-list '{"environment-name":"<env_name>"}'` returns `success: true`  
