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
import shlex
import shutil
import sys
import time
import threading


def _build_clio_cmd():
    env_cmd = os.environ.get("CLIO_CMD", "").strip()
    if env_cmd:
        return shlex.split(env_cmd) + ["mcp-server"]
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


def _parse_tool_response(collected):
    skipped = []
    for line in collected:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            skipped.append(line)
            continue
        if not isinstance(msg.get("id"), int) or msg["id"] < 2:
            continue
        result = msg.get("result", {})
        is_error = result.get("isError", False)
        content = result.get("content", [])
        raw = content[0].get("text", "") if content else ""
        if not raw:
            diag = f"empty response"
            if skipped:
                diag += f"; skipped non-JSON lines: {skipped}"
            return {"success": False, "data": None, "raw": diag}
        try:
            data = json.loads(raw)
            return {"success": not is_error, "data": data, "raw": raw}
        except json.JSONDecodeError:
            return {"success": not is_error, "data": None, "raw": raw}
    diag = "no matching response"
    if skipped:
        diag += f"; skipped non-JSON lines: {skipped}"
    return None


class PersistentMcpClient:
    """
    Persistent clio MCP server process that stays alive across multiple tool calls.
    Eliminates ~0.5-1s subprocess spawn + initialize overhead per call.
    """

    def __init__(self, timeout=120):
        self._timeout = timeout
        self._proc = None
        self._lock = threading.Lock()
        self._next_id = 1
        self._initialized = False

    def _ensure_started(self):
        if self._proc is not None and self._proc.poll() is None:
            return
        clio_cmd = _build_clio_cmd()
        self._proc = subprocess.Popen(
            clio_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self._next_id = 1
        self._initialized = False

    def _send_and_receive(self, message, target_id, timeout):
        self._proc.stdin.write(message + "\n")
        self._proc.stdin.flush()
        collected = []
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = self._proc.stdout.readline()
            if not line:
                break
            stripped = line.strip()
            if not stripped:
                continue
            collected.append(stripped)
            try:
                parsed = json.loads(stripped)
                if parsed.get("id") == target_id:
                    return collected
            except json.JSONDecodeError:
                pass
        return collected

    def _initialize_once(self):
        if self._initialized:
            return
        init_id = self._next_id
        self._next_id += 1
        init_msg = json.dumps({
            "jsonrpc": "2.0", "id": init_id, "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp_client", "version": "1.0"}
            }
        })
        self._send_and_receive(init_msg, init_id, min(self._timeout, 30))
        self._initialized = True

    def call_tool(self, tool_name, arguments, timeout=None):
        timeout = timeout or self._timeout
        with self._lock:
            try:
                self._ensure_started()
                self._initialize_once()
            except Exception:
                self._kill()
                raise
            call_id = self._next_id
            self._next_id += 1
            call_msg = json.dumps({
                "jsonrpc": "2.0", "id": call_id,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": {"args": arguments}}
            })
            try:
                collected = self._send_and_receive(call_msg, call_id, timeout)
            except Exception:
                self._kill()
                raise
        skipped = []
        for line in collected:
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                skipped.append(line)
                continue
            if msg.get("id") != call_id:
                continue
            result = msg.get("result", {})
            is_error = result.get("isError", False)
            content = result.get("content", [])
            raw = content[0].get("text", "") if content else ""
            if not raw:
                diag = "empty response"
                if skipped:
                    diag += f"; skipped non-JSON lines: {skipped}"
                return {"success": False, "data": None, "raw": diag}
            try:
                data = json.loads(raw)
                return {"success": not is_error, "data": data, "raw": raw}
            except json.JSONDecodeError:
                return {"success": not is_error, "data": None, "raw": raw}
        diag = f"no response. lines: {collected}"
        if skipped:
            diag += f"; skipped non-JSON lines: {skipped}"
        self._kill()
        return {"success": False, "data": None, "raw": diag}

    def call_tools_batch(self, calls):
        results = []
        for tool_name, arguments, timeout in calls:
            results.append(self.call_tool(tool_name, arguments, timeout))
        return results

    def _kill(self):
        self._initialized = False
        if self._proc is None:
            return
        try:
            self._proc.terminate()
            self._proc.wait(timeout=5)
        except Exception:
            try:
                self._proc.kill()
            except Exception:
                pass
        self._proc = None

    def close(self):
        with self._lock:
            self._kill()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def __del__(self):
        self._kill()


_shared_client = None
_shared_client_lock = threading.Lock()


def _get_shared_client():
    global _shared_client
    with _shared_client_lock:
        if _shared_client is None:
            _shared_client = PersistentMcpClient()
        return _shared_client


def call_mcp_tool(tool_name: str, arguments: dict, timeout: int = 120) -> dict:
    """
    Call a clio MCP tool via stdio transport.

    Uses a persistent clio mcp-server process under the hood.
    The process is started on first call and reused for subsequent calls,
    eliminating ~0.5-1s subprocess spawn + initialize overhead per call.

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
    client = _get_shared_client()
    try:
        return client.call_tool(tool_name, arguments, timeout)
    except Exception:
        client.close()
        return client.call_tool(tool_name, arguments, timeout)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: mcp_client.py <tool-name> <args-json> [timeout]", file=sys.stderr)
        sys.exit(1)
    _tool = sys.argv[1]
    _args = json.loads(sys.argv[2])
    _timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 120
    _result = call_mcp_tool(_tool, _args, _timeout)
    print(json.dumps(_result, indent=2))
