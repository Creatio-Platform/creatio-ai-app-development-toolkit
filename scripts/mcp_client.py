#!/usr/bin/env python3
"""
Reusable stdio MCP client for clio.

Usage:
    python3 scripts/mcp_client.py <tool-name> <args-json> [timeout]
    python3 scripts/mcp_client.py <tool-name> --args-file <path> [--timeout <seconds>]
    python3 scripts/mcp_client.py <tool-name> --args-stdin [--timeout <seconds>]

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
import argparse
import difflib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time

MIN_SUPPORTED_CLIO_VERSION = (8, 0, 2, 37)
MIN_SUPPORTED_CLIO_VERSION_TEXT = ".".join(str(part) for part in MIN_SUPPORTED_CLIO_VERSION)
_CLIO_VERSION_CACHE = {"key": None, "info": None}
_TOOL_CONTRACT_CACHE = {"key": None, "contracts": None}

def _resolve_clio_cmd():
    env_cmd = os.environ.get("CLIO_CMD", "").strip()
    if env_cmd:
        if sys.platform == "win32":
            parts = shlex.split(env_cmd, posix=False)
            parts = [p[1:-1] if (p.startswith('"') and p.endswith('"')) or (p.startswith("'") and p.endswith("'")) else p for p in parts]
        else:
            parts = shlex.split(env_cmd)
        return parts
    if shutil.which("clio"):
        return ["clio"]
    if not shutil.which("dotnet"):
        raise RuntimeError(
            ".NET SDK is not installed. Download it from: https://dotnet.microsoft.com/download\n"
            "After installing .NET, run: dotnet tool install clio -g"
        )
    raise RuntimeError(
        "clio not found. Install it with: dotnet tool install clio -g\n"
        "Or provide a custom path: CLIO_CMD='dotnet /path/to/clio.dll' python3 scripts/mcp_client.py ..."
    )


def _build_clio_cmd():
    return _resolve_clio_cmd() + ["mcp-server"]


def _current_clio_resolution_key():
    return (os.environ.get("CLIO_CMD", "").strip(), shutil.which("clio") or "")


def _parse_version_tuple(raw_version):
    if not isinstance(raw_version, str):
        raise RuntimeError("Unable to parse clio version output")
    match = re.search(r"(\d+\.\d+\.\d+\.\d+)", raw_version)
    if not match:
        match = re.search(r"(\d+\.\d+\.\d+)", raw_version)
    if not match:
        raise RuntimeError(f"Unable to parse clio version from output: {raw_version.strip() or raw_version!r}")
    parts = tuple(int(part) for part in match.group(1).split("."))
    if len(parts) == 3:
        parts = parts + (0,)
    return match.group(1), parts


def get_clio_version(timeout=30):
    cache_key = _current_clio_resolution_key()
    if _CLIO_VERSION_CACHE["key"] == cache_key and _CLIO_VERSION_CACHE["info"] is not None:
        return dict(_CLIO_VERSION_CACHE["info"])
    cmd = _resolve_clio_cmd() + ["ver"]
    completed = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, check=False)
    output = completed.stdout.strip() or completed.stderr.strip()
    if completed.returncode != 0:
        raise RuntimeError(output or "clio ver failed")
    version_text, version_tuple = _parse_version_tuple(output)
    info = {
        "version": version_text,
        "version_tuple": version_tuple,
        "raw": output,
        "command": cmd,
    }
    _CLIO_VERSION_CACHE["key"] = cache_key
    _CLIO_VERSION_CACHE["info"] = dict(info)
    return info


def validate_clio_version(min_version=MIN_SUPPORTED_CLIO_VERSION, timeout=30):
    info = get_clio_version(timeout=timeout)
    if info["version_tuple"] < min_version:
        minimum = ".".join(str(part) for part in min_version)
        raise RuntimeError(
            f"Unsupported clio version {info['version']}. Minimum supported released version is {minimum}. "
            "Upgrade clio or point CLIO_CMD to a compatible released build. "
            "CLIO_CMD is only a path override, not a separate compatibility target."
        )
    return info


def ensure_supported_clio_version(timeout=30):
    return validate_clio_version(timeout=timeout)


def _parse_rpc_result(message_id, collected, expect_tool_result):
    skipped = []
    for line in collected:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            skipped.append(line)
            continue
        if msg.get("id") != message_id:
            continue
        error = msg.get("error")
        if error:
            raw_error = json.dumps(error, ensure_ascii=True)
            return {"success": False, "data": {"error": error}, "raw": raw_error}
        result = msg.get("result", {})
        if expect_tool_result:
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
                return {"success": _is_tool_payload_success(data, is_error), "data": data, "raw": raw}
            except json.JSONDecodeError:
                return {"success": not is_error, "data": None, "raw": raw}
        raw = json.dumps(result, ensure_ascii=True)
        return {"success": True, "data": result, "raw": raw}
    diag = "no matching response"
    if skipped:
        diag += f"; skipped non-JSON lines: {skipped}"
    return {"success": False, "data": None, "raw": diag}


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
        ensure_supported_clio_version(timeout=min(self._timeout, 30))
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

    def call_method(self, method, params, timeout=None, expect_tool_result=False):
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
                "jsonrpc": "2.0",
                "id": call_id,
                "method": method,
                "params": params
            })
            try:
                collected = self._send_and_receive(call_msg, call_id, timeout)
            except Exception:
                self._kill()
                raise
        result = _parse_rpc_result(call_id, collected, expect_tool_result)
        if not result["success"] and "no matching response" in result["raw"]:
            self._kill()
        return result

    def call_tool(self, tool_name, arguments, timeout=None):
        return self.call_method(
            "tools/call",
            {"name": tool_name, "arguments": {"args": arguments}},
            timeout=timeout,
            expect_tool_result=True,
        )

    def list_tools(self, timeout=None):
        return self.call_method("tools/list", {}, timeout=timeout, expect_tool_result=False)

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

def _is_execution_error_message(message) -> bool:
    if not isinstance(message, dict):
        return False
    message_type = message.get("message-type") or message.get("type")
    return isinstance(message_type, str) and message_type.lower() == "error"


def _is_tool_payload_success(data, top_level_is_error) -> bool:
    if top_level_is_error:
        return False
    if not isinstance(data, dict):
        return True
    if data.get("success") is False:
        return False
    exit_code = data.get("exit-code")
    if isinstance(exit_code, int) and not isinstance(exit_code, bool) and exit_code != 0:
        return False
    messages = data.get("execution-log-messages")
    if isinstance(messages, list) and any(_is_execution_error_message(message) for message in messages):
        return False
    return True


def _normalize_tool_contract_index(data):
    if not isinstance(data, dict):
        raise RuntimeError("tool-contract-get returned a non-object payload")
    if data.get("success") is not True:
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message") or json.dumps(error, ensure_ascii=True)
        else:
            message = json.dumps(data, ensure_ascii=True)
        raise RuntimeError(message)
    tools = data.get("tools")
    if not isinstance(tools, list):
        raise RuntimeError("tool-contract-get did not return a tools array")
    index = {}
    for contract in tools:
        if isinstance(contract, dict):
            name = contract.get("name")
            if isinstance(name, str) and name:
                index[name] = contract
    if not index:
        raise RuntimeError("tool-contract-get returned no usable tool contracts")
    return index


def _get_tool_contract_index(timeout=120, force_refresh=False):
    cache_key = _current_clio_resolution_key()
    if not force_refresh and _TOOL_CONTRACT_CACHE["key"] == cache_key and _TOOL_CONTRACT_CACHE["contracts"] is not None:
        return _TOOL_CONTRACT_CACHE["contracts"]
    client = _get_shared_client()
    result = client.call_tool("tool-contract-get", {}, timeout=timeout)
    index = _normalize_tool_contract_index(result["data"])
    _TOOL_CONTRACT_CACHE["key"] = cache_key
    _TOOL_CONTRACT_CACHE["contracts"] = index
    return index


def _find_property(contract_spec: dict, name: str) -> dict | None:
    input_schema = contract_spec.get("input-schema")
    if not isinstance(input_schema, dict):
        return None
    properties = input_schema.get("properties")
    if not isinstance(properties, list):
        return None
    for prop in properties:
        if isinstance(prop, dict) and prop.get("name") == name:
            return prop
    return None


def _value_is_missing(value) -> bool:
    return value is None or value == ""


def _validate_field_type(field_name: str, expected_type: str, value) -> list[str]:
    if value is None:
        return []
    if expected_type == "boolean" and not isinstance(value, bool):
        return [f"Parameter '{field_name}' must be a boolean, not {type(value).__name__}"]
    if expected_type == "array" and not isinstance(value, list):
        return [f"Parameter '{field_name}' must be an array, not {type(value).__name__}"]
    if expected_type == "object" and not isinstance(value, dict):
        return [f"Parameter '{field_name}' must be an object, not {type(value).__name__}"]
    if expected_type == "string" and not isinstance(value, str):
        return [f"Parameter '{field_name}' must be a string, not {type(value).__name__}"]
    if expected_type == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        return [f"Parameter '{field_name}' must be a number, not {type(value).__name__}"]
    return []


def _validate_params(tool_name: str, arguments: dict, contract_index: dict | None = None) -> list[str]:
    contract_index = contract_index or {}
    spec = contract_index.get(tool_name)
    if not spec:
        return []
    input_schema = spec.get("input-schema")
    if not isinstance(input_schema, dict):
        return []
    errors = []
    for alias in spec.get("aliases") or []:
        if not isinstance(alias, dict):
            continue
        if alias.get("scope") != "parameter" or alias.get("status") != "rejected":
            continue
        alias_name = alias.get("alias")
        if isinstance(alias_name, str) and alias_name in arguments:
            errors.append(f"Wrong parameter '{alias_name}': {alias.get('message')}")
    for param in input_schema.get("required") or []:
        if param not in arguments or _value_is_missing(arguments.get(param)):
            prop = _find_property(spec, param) or {}
            hint = prop.get("description") or ""
            message = f"Missing required parameter '{param}'"
            if hint:
                message += f". Hint: {hint}"
            errors.append(message)
    any_of_groups = input_schema.get("any-of") or []
    if any_of_groups and not any(
        all(param in arguments and not _value_is_missing(arguments.get(param)) for param in group)
        for group in any_of_groups
    ):
        group_descriptions = []
        for group in any_of_groups:
            if len(group) == 1:
                group_descriptions.append(f"'{group[0]}'")
            else:
                group_descriptions.append("(" + " AND ".join(f"'{param}'" for param in group) + ")")
        errors.append("Missing required connection parameters. Provide " + " or ".join(group_descriptions))
    for prop in input_schema.get("properties") or []:
        if not isinstance(prop, dict):
            continue
        name = prop.get("name")
        if not isinstance(name, str) or name not in arguments:
            continue
        errors.extend(_validate_field_type(name, prop.get("type"), arguments.get(name)))
    return errors


def _build_unknown_tool_result(tool_name: str, contract_index: dict) -> dict:
    suggestions = difflib.get_close_matches(tool_name, sorted(contract_index), n=3, cutoff=0.45)
    error = {
        "code": "tool-not-found",
        "message": f"Tool '{tool_name}' is not registered by clio MCP.",
        "suggestions": suggestions,
    }
    raw = error["message"]
    if suggestions:
        raw += " Suggestions: " + ", ".join(suggestions)
    return {"success": False, "data": {"error": error}, "raw": raw}


def _build_validation_result(validation_errors: list[str]) -> dict:
    error = {
        "code": "invalid-request",
        "message": "Parameter validation failed.",
        "details": validation_errors,
    }
    return {
        "success": False,
        "data": {"error": error},
        "raw": "Parameter validation failed:\n" + "\n".join(f"  - {e}" for e in validation_errors),
    }


def call_mcp_tool(tool_name: str, arguments: dict, timeout: int = 120) -> dict:
    """
    Call a clio MCP tool via stdio transport.

    Uses a persistent clio mcp-server process under the hood.
    The process is started on first call and reused for subsequent calls,
    eliminating ~0.5-1s subprocess spawn + initialize overhead per call.

    Validates required parameters before sending to prevent trial-and-error
    with the MCP server. Returns an error dict with hints if params are missing.

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
    if tool_name == "tools/list":
        return list_mcp_tools(timeout=timeout)
    if tool_name == "tool-contract-get":
        client = _get_shared_client()
        try:
            return client.call_tool(tool_name, arguments, timeout)
        except Exception:
            client.close()
            return client.call_tool(tool_name, arguments, timeout)
    try:
        contract_index = _get_tool_contract_index(timeout=min(timeout, 60))
    except Exception as error:
        return {
            "success": False,
            "data": {"error": {"code": "tool-contract-unavailable", "message": str(error)}},
            "raw": str(error),
        }
    if tool_name not in contract_index:
        return _build_unknown_tool_result(tool_name, contract_index)
    validation_errors = _validate_params(tool_name, arguments, contract_index)
    if validation_errors:
        return _build_validation_result(validation_errors)
    client = _get_shared_client()
    try:
        return client.call_tool(tool_name, arguments, timeout)
    except Exception:
        client.close()
        return client.call_tool(tool_name, arguments, timeout)


def list_mcp_tools(timeout: int = 120) -> dict:
    client = _get_shared_client()
    try:
        return client.list_tools(timeout)
    except Exception:
        client.close()
        return client.list_tools(timeout)


def load_cli_arguments(args_json=None, args_file=None, args_stdin=False, stdin_text=None):
    sources = sum(1 for source in (args_json is not None, args_file is not None, args_stdin) if source)
    if sources != 1:
        raise ValueError("Provide exactly one argument source: <args-json>, --args-file, or --args-stdin")
    if args_json is not None:
        return json.loads(args_json)
    if args_file is not None:
        return json.loads(Path(args_file).read_text(encoding="utf-8"))
    data = sys.stdin.read() if stdin_text is None else stdin_text
    if not data.strip():
        raise ValueError("--args-stdin requires JSON on stdin")
    return json.loads(data)


def parse_cli_request(argv):
    if not argv:
        raise ValueError(
            "Usage: mcp_client.py <tool-name> <args-json> [timeout]\n"
            "   or: mcp_client.py <tool-name> --args-file <path> [--timeout <seconds>]\n"
            "   or: mcp_client.py <tool-name> --args-stdin [--timeout <seconds>]"
        )
    tool_name = argv[0]
    remainder = argv[1:]
    if remainder and not remainder[0].startswith("-"):
        if len(remainder) > 2:
            raise ValueError("Legacy positional mode accepts only <args-json> [timeout]")
        timeout = int(remainder[1]) if len(remainder) == 2 else 120
        return {
            "tool_name": tool_name,
            "arguments": load_cli_arguments(args_json=remainder[0]),
            "timeout": timeout,
        }
    if (
        remainder
        and remainder[-1].lstrip("-").isdigit()
        and not remainder[-1].startswith("--")
        and (len(remainder) < 2 or remainder[-2] != "--timeout")
    ):
        raise ValueError(
            f"Positional timeout is not supported with named-mode flags.\n"
            f"Use --timeout {remainder[-1]} instead of a positional argument."
        )
    parser = argparse.ArgumentParser(prog="mcp_client.py", add_help=True)
    parser.add_argument("--args-file")
    parser.add_argument("--args-stdin", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    parsed = parser.parse_args(remainder)
    arguments = load_cli_arguments(args_file=parsed.args_file, args_stdin=parsed.args_stdin)
    return {
        "tool_name": tool_name,
        "arguments": arguments,
        "timeout": parsed.timeout,
    }


def main(argv=None):
    try:
        request = parse_cli_request(sys.argv[1:] if argv is None else argv)
    except (ValueError, json.JSONDecodeError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    result = call_mcp_tool(request["tool_name"], request["arguments"], request["timeout"])
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
