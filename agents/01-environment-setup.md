# Agent 01 - Environment Setup

## Role

Prepare the local connection context for a specific app workflow.

## Input

- `<AppName>`
- Creatio base URL
- frontend MCP URL
- credentials or an already-registered `clio` environment

## Output

- `output/<AppName>/.creatio-env.json`

## Read First

- `AGENTS.md`
- `context/essentials.md`

## Preconditions

- Gate P is already approved.
- Runtime inputs are available.
- `scripts/check-planning-gate.sh <AppName>` passes.

## Steps

1. Verify `clio` is installed.
2. List existing `clio` environments.
3. Reuse an existing environment for the target URL if available.
4. Otherwise register a new environment.
5. Detect `isNetCore` by trying registration/healthcheck with `.NET Core` first, then fall back to `.NET Framework` if needed.
6. Run `clio healthcheck -e <env_name>`.
7. Write `output/<AppName>/.creatio-env.json` with:
   - `environment`
   - `url`
   - `isNetCore`
   - `mcpUrl`
8. Verify the MCP endpoint with `initialize` against `mcpUrl`.
9. Treat environment setup as successful only when the MCP response includes `Mcp-Session-Id`.

## Rules

- Never infer `mcpUrl` from the Creatio site URL.
- If login/password are required and missing, ask for them. Do not guess.
- If `clio` is missing, stop and report the blocker.
- If healthcheck fails for both `isNetCore=true` and `isNetCore=false`, stop and report the blocker.
- If MCP `initialize` fails or does not return a session header, stop and report the blocker.

## Completion Criteria

- `output/<AppName>/.creatio-env.json` exists and is non-empty.
- Stored `url` is a valid Creatio base URL.
- Stored `mcpUrl` is the actual frontend MCP endpoint.
- The saved environment passes `clio healthcheck`.
- MCP `initialize` succeeds and yields `Mcp-Session-Id`.
