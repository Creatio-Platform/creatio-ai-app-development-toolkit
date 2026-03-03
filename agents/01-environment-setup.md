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

### 1. Verify clio is installed

```bash
clio ver
```

- If the command succeeds, note the version and proceed.
- If the command fails (not found), stop and tell the developer:
  > clio is not installed. Please install it first:
  > ```
  > dotnet tool install clio -g
  > ```
  Then wait for the developer to confirm installation before retrying.

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

1. **Try .NET Core first**:
   ```bash
   clio reg-web-app <env_name> -u <url> -l <login> -p <password> -i true
   ```
2. Run a healthcheck (Step 5). If it fails with a connection/protocol error:
3. **Fall back to .NET Framework**:
   ```bash
   clio reg-web-app <env_name> -u <url> -l <login> -p <password> -i false
   ```
4. Save the detected `isNetCore` value (`true` or `false`) for the env file.

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
  "mcpUrl": "<URL>/mcp"
}
```

Replace `true` with `false` if .NET Framework was detected in Step 4.
For `mcpUrl`: if .NET Core, use `<URL>/mcp`; if .NET Framework (IIS), use `<URL>/0/mcp`.

### 7. Verify MCP endpoint (MANDATORY)

Run MCP initialize against `mcpUrl` from `.creatio-env.json` and verify response includes `Mcp-Session-Id` header:

```bash
curl -s -D- "<mcpUrl>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}'
```

- **Success** (session header exists) — environment setup is complete.
- **Failure** — stop and report blocker to developer. Do not continue pipeline.

## Error Handling

| Error | Action |
|-------|--------|
| `clio ver` fails | Tell developer to install clio (`dotnet tool install clio -g`) |
| `clio healthcheck` fails | Verify the URL is reachable (check for typos, trailing slashes). Verify login/password. Ask the developer to double-check credentials and retry. |
| Registration fails | Check if the environment name is already taken (`clio show-web-app-list`). Try a different name or update the existing one. |
| Connection timeout | Ask the developer to verify the Creatio instance is running and accessible from this machine. |
| MCP initialize fails or no `Mcp-Session-Id` header | Verify `.creatio-env.json` `mcpUrl`, site reachability, and credentials. Stop pipeline until fixed. |

## Completion Criteria

✅ `clio healthcheck -e <env_name>` passes  
✅ `output/<AppName>/.creatio-env.json` exists with correct values  
✅ MCP initialize succeeds for `mcpUrl` and returns `Mcp-Session-Id`  
