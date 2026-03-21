#!/usr/bin/env python3
"""
Reusable stdio MCP client for clio.

Usage:
    python3 scripts/mcp_client.py <tool-name> <args-json> [timeout]

Examples:
    python3 scripts/mcp_client.py application-get-list '{"environment-name": "local"}'
    python3 scripts/mcp_client.py application-create '{"environment-name":"local","name":"My App","code":"UsrMyApp"}' 120

clio resolution (first match wins):
    1. CLIO_CMD env var — custom clio path provided by user at startup
       e.g. CLIO_CMD="dotnet /path/to/clio.dll" python3 scripts/mcp_client.py ...
    2. `clio` in PATH  — standard global install (dotnet tool install clio -g)
    3. neither found   — raises RuntimeError with install instructions

Notes:
    - clio MCP uses stdio transport (NOT HTTP/SSE)
    - Tool names use dashes: application-create, create-lookup, page-update (NOT dots)
    - All parameters are wrapped in an "args" object
    - clio does not support notifications/initialized — it is omitted
    - NEVER pass -e flag to mcp-server — it is not supported
    - NEVER use shell variable expansion ($VAR) in pipes to mcp-server — use this script instead

Returns JSON: {"success": bool, "data": dict|None, "raw": str}
"""
import subprocess
import json
import os
import shutil
import sys
import time
import threading


def _build_clio_cmd():
    env_cmd = os.environ.get("CLIO_CMD", "").strip()
    if env_cmd:
        return env_cmd.split() + ["mcp-server"]
    if shutil.which("clio"):
        return ["clio", "mcp-server"]
    if not shutil.which("dotnet"):
        raise RuntimeError(
            ".NET SDK is not installed. Download it from: https://dotnet.microsoft.com/download\n"
            "After installing .NET, run: dotnet tool install clio -g"
        )
    raise RuntimeError(
        "clio not found. Install it with: dotnet tool install clio -g\n"
        "Or provide a custom path: CLIO_CMD='dotnet /path/to/clio.dll' python3 scripts/mcp_client.py ..."
    )


def call_mcp_tool(tool_name: str, arguments: dict, timeout: int = 120) -> dict:
    """
    Call a clio MCP tool via stdio transport.

    Args:
        tool_name: dash-separated tool name (e.g. 'application-create')
        arguments: dict of tool arguments (will be wrapped in {"args": ...})
        timeout: seconds to wait for response (default 120)

    Returns:
        {"success": bool, "data": dict|None, "raw": str}

    Important:
        Boolean parameters (e.g. dryRun, extendParent) MUST be Python bool
        (True/False), NOT strings ('true'/'false'). Passing a string causes
        MCP SDK deserialization failure and a generic invocation error.
    """
    messages = [
        json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp_client", "version": "1.0"}
            }
        }),
        json.dumps({
            "jsonrpc": "2.0", "id": 2,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": {"args": arguments}}
        }),
    ]

    clio_cmd = _build_clio_cmd()
    proc = subprocess.Popen(
        clio_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    def _send():
        for msg in messages:
            proc.stdin.write(msg + "\n")
            proc.stdin.flush()
            time.sleep(0.3)
        time.sleep(max(timeout - 5, 10))
        try:
            proc.stdin.close()
        except Exception:
            pass

    sender = threading.Thread(target=_send, daemon=True)
    sender.start()

    collected = []
    try:
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            stripped = line.strip()
            if stripped:
                collected.append(stripped)
                try:
                    parsed = json.loads(stripped)
                    if parsed.get("id") == 2:
                        break
                except json.JSONDecodeError:
                    pass
    except Exception:
        pass
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    for line in collected:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") != 2:
            continue
        result = msg.get("result", {})
        is_error = result.get("isError", False)
        content = result.get("content", [])
        raw = content[0].get("text", "") if content else ""
        if not raw:
            return {"success": False, "data": None, "raw": "empty response"}
        try:
            data = json.loads(raw)
            return {"success": not is_error, "data": data, "raw": raw}
        except json.JSONDecodeError:
            return {"success": not is_error, "data": None, "raw": raw}

    return {"success": False, "data": None, "raw": f"no response. lines: {collected}"}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: mcp_client.py <tool-name> <args-json> [timeout]", file=sys.stderr)
        sys.exit(1)
    _tool = sys.argv[1]
    _args = json.loads(sys.argv[2])
    _timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 120
    _result = call_mcp_tool(_tool, _args, _timeout)
    print(json.dumps(_result, indent=2))
