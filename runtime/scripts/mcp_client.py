#!/usr/bin/env python3
"""
Reusable stdio MCP client for clio.

Run `python3 runtime/scripts/mcp_client.py --help` for usage.

Returns JSON: {"success": bool, "data": dict|None, "raw": str}
"""
import argparse
import difflib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import threading
import time

USAGE = (
    "Usage:\n"
    "  python3 mcp_client.py <tool-name> <args-json> [timeout]\n"
    "  python3 mcp_client.py <tool-name> --args-file <path> [--timeout <seconds>]\n"
    "  python3 mcp_client.py <tool-name> --args-stdin [--timeout <seconds>]\n"
    "  python3 mcp_client.py resources/list {} [timeout]\n"
    "  python3 mcp_client.py resources/read '{\"uri\":\"docs://mcp/guides/app-modeling\"}' [timeout]\n"
    "\n"
    "PowerShell (Windows): pass JSON via the positional form or pipe it into --args-stdin.\n"
    "The shell-redirect form (`< file` / `< NUL`) is not supported by PowerShell.\n"
    "  py -3 mcp_client.py get-tool-contract '{}'\n"
    "  echo '{}' | py -3 mcp_client.py get-tool-contract --args-stdin\n"
    "\n"
    "clio resolution (first match wins):\n"
    "  1. CLIO_CMD env var (e.g. CLIO_CMD=\"dotnet /path/to/clio.dll\")\n"
    "  2. `clio` in PATH (dotnet tool install clio -g)\n"
    "  3. neither found -> RuntimeError with install instructions\n"
    "\n"
    "Notes:\n"
    "  - clio MCP uses stdio transport (NOT HTTP/SSE)\n"
    "  - Tool names use dashes: create-app, update-page (NOT dots)\n"
    "  - All parameters are wrapped in an \"args\" object\n"
    "  - clio does not support notifications/initialized - it is omitted\n"
    "  - NEVER pass -e flag to mcp-server - it is not supported\n"
    "  - NEVER use shell variable expansion ($VAR) in pipes - use this script instead"
)

_TOOL_CONTRACT_CACHE = {"key": None, "contracts": None}
SCHEMA_SYNC_ALLOWED_OPERATION_TYPES = {"create-lookup", "create-entity", "update-entity"}

# Wall-clock cap for the cold-start `initialize` handshake (seconds). Named so a
# consumer (e.g. the preflight gate's watchdog) can size its own window to cover it
# instead of mirroring a bare literal that could silently drift out of sync.
INITIALIZE_TIMEOUT_CAP = 30


class _HelpRequested(Exception):
    """Raised by parse_cli_request when the user passes -h or --help."""


def _unquote(value):
    """Strip one matching pair of surrounding quotes, if present."""
    if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _parse_clio_cmd(env_cmd):
    """Turn a CLIO_CMD value into argv.

    The same rule is implemented once more in ``hooks/telemetry-routing.mjs``, which cannot share
    this code (different language, different transport shape). Both sides and the reason are recorded
    in ``docs/telemetry-transport-decision.md``; a change here changes there too.

    A bare path to the executable, spaces and all, is ONE token — checked before any splitting.
    Windows' default install location contains a space, so splitting first turned
    `C:\\Program Files\\...\\clio.exe` into `C:\\Program` plus a stray argument and reported clio as
    not installed. The multi-token form (`dotnet /path/to/clio.dll`) is unaffected: that string is
    not itself a file, so it falls through to the split.
    """
    bare = _unquote(env_cmd)
    # is_file, not exists: a stray directory at the expected install path would otherwise be
    # returned as the executable, and the spawn would fail with "Is a directory" instead of the
    # clear "clio not installed" diagnostic this shortcut exists to preserve.
    if bare and Path(bare).is_file():
        return [bare]
    if sys.platform != "win32":
        parts = shlex.split(env_cmd)
    else:
        parts = [_unquote(part) for part in shlex.split(env_cmd, posix=False)]
    # A value that splits into several tokens whose FIRST token is not runnable is not a command plus
    # arguments — it is one path that happens to contain spaces, and splitting it reproduces the very
    # bug this function exists to fix: `C:\Program Files\clio\clio.exe` becomes `C:\Program` and the
    # caller reports a file it was never configured with. Returning the whole value keeps the
    # diagnostic honest in exactly the misconfiguration case where it matters — a stale path after a
    # reinstall, a typo, an install still in progress.
    #
    # `dotnet /path/to/clio.dll` is unaffected: `dotnet` resolves, so the split stands.
    if len(parts) > 1 and not (shutil.which(parts[0]) or Path(parts[0]).is_file()):
        return [bare]
    return parts


def _resolve_clio_cmd():
    env_cmd = os.environ.get("CLIO_CMD", "").strip()
    if env_cmd:
        return _parse_clio_cmd(env_cmd)
    if shutil.which("clio"):
        return ["clio"]
    if not shutil.which("dotnet"):
        raise RuntimeError(
            ".NET SDK is not installed. Download it from: https://dotnet.microsoft.com/download\n"
            "After installing .NET, run: dotnet tool install clio -g"
        )
    raise RuntimeError(
        "clio not found. Install it with: dotnet tool install clio -g\n"
        "Or provide a custom path: CLIO_CMD='dotnet /path/to/clio.dll' python3 runtime/scripts/mcp_client.py ..."
    )


def _build_clio_cmd():
    return _resolve_clio_cmd() + ["mcp-server"]


def _current_clio_resolution_key():
    return (os.environ.get("CLIO_CMD", "").strip(), shutil.which("clio") or "")


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
        clio_cmd = _build_clio_cmd()
        # errors="replace" keeps a malformed byte from raising mid-readline and killing
        # the read loop; callers validate payload content (e.g. the preflight's
        # _probe_is_healthy), so a garbled/replaced response surfaces as an unusable
        # result and is classified accordingly rather than masquerading as a crash.
        self._proc = subprocess.Popen(
            clio_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
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
        collected = self._send_and_receive(init_msg, init_id, min(self._timeout, INITIALIZE_TIMEOUT_CAP))
        # Only mark initialized when the handshake response actually arrived. If the child
        # was killed mid-initialize (e.g. by the preflight watchdog) readline() returns EOF
        # and `collected` lacks the init id — marking initialized anyway would fall through
        # to a doomed tools/call write whose failure triggers call_mcp_tool's retry and an
        # unsupervised re-spawn. Raising here surfaces it as a clean error instead.
        got_response = False
        for line in collected:
            try:
                if json.loads(line).get("id") == init_id:
                    got_response = True
                    break
            except json.JSONDecodeError:
                continue
        if not got_response:
            raise RuntimeError("clio MCP initialize did not complete (no init response received)")
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

    def list_resources(self, timeout=None):
        return self.call_method("resources/list", {}, timeout=timeout, expect_tool_result=False)

    def read_resource(self, uri, timeout=None):
        return self.call_method("resources/read", {"uri": uri}, timeout=timeout, expect_tool_result=False)

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


def force_kill_shared_client():
    """Lock-free, best-effort kill of the shared client's clio child process.

    Intended for the watchdog-abort path: a single hung probe holds
    ``PersistentMcpClient._lock`` inside a blocking ``readline()``, so ``close()`` (which
    acquires the lock) would deadlock the watchdog. This captures the current process
    reference ONCE into a local and kills that local, so it is safe to call from the
    watchdog thread — terminating the same OS process twice is idempotent. It does not
    synchronize with a concurrent re-spawn on a *different* call; callers that must not
    leave a re-spawned child behind (the preflight probe) invoke the non-retrying
    ``call_tool`` path so no retry re-spawns after the kill.

    Callers outside this module must use this sanctioned API instead of reaching into
    ``_shared_client._proc`` directly, so the private coupling lives in one place and a
    future ``PersistentMcpClient`` refactor updates it here (not silently in a consumer).
    """
    client = _shared_client
    proc = getattr(client, "_proc", None) if client is not None else None
    if proc is None:
        return
    try:
        proc.kill()
    except OSError:
        # Benign: the process was already reaped/exited (ProcessLookupError is an OSError
        # subclass, so it is covered here). Anything else propagates, so an unexpected kill
        # failure is not silently indistinguishable from the no-op case.
        pass


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
        raise RuntimeError("get-tool-contract returned a non-object payload")
    if data.get("success") is not True:
        error = data.get("error")
        if isinstance(error, dict):
            message = error.get("message") or json.dumps(error, ensure_ascii=True)
        else:
            message = json.dumps(data, ensure_ascii=True)
        raise RuntimeError(message)
    tools = data.get("tools")
    if not isinstance(tools, list):
        raise RuntimeError("get-tool-contract did not return a tools array")
    index = {}
    for contract in tools:
        if isinstance(contract, dict):
            name = contract.get("name")
            if isinstance(name, str) and name:
                index[name] = contract
    if not index:
        raise RuntimeError("get-tool-contract returned no usable tool contracts")
    return index


def _get_tool_contract_index(timeout=120, force_refresh=False):
    cache_key = _current_clio_resolution_key()
    if not force_refresh and _TOOL_CONTRACT_CACHE["key"] == cache_key and _TOOL_CONTRACT_CACHE["contracts"] is not None:
        return _TOOL_CONTRACT_CACHE["contracts"]
    client = _get_shared_client()
    result = client.call_tool("get-tool-contract", {}, timeout=timeout)
    index = _normalize_tool_contract_index(result["data"])
    _TOOL_CONTRACT_CACHE["key"] = cache_key
    _TOOL_CONTRACT_CACHE["contracts"] = index
    return index


def _merge_tool_contracts_into_cache(contracts: dict) -> dict:
    cache_key = _current_clio_resolution_key()
    cached_contracts = _TOOL_CONTRACT_CACHE["contracts"]
    if _TOOL_CONTRACT_CACHE["key"] != cache_key or cached_contracts is None:
        cached_contracts = {}
    merged_contracts = dict(cached_contracts)
    merged_contracts.update(contracts)
    _TOOL_CONTRACT_CACHE["key"] = cache_key
    _TOOL_CONTRACT_CACHE["contracts"] = merged_contracts
    return merged_contracts


def _load_explicit_tool_contract(tool_name: str, timeout=120):
    client = _get_shared_client()
    result = client.call_tool("get-tool-contract", {"tool-names": [tool_name]}, timeout=timeout)
    data = result.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("get-tool-contract returned a non-object payload")
    if data.get("success") is not True:
        error = data.get("error")
        if isinstance(error, dict) and error.get("code") == "tool-not-found":
            return None
        if isinstance(error, dict):
            message = error.get("message") or json.dumps(error, ensure_ascii=True)
        else:
            message = json.dumps(data, ensure_ascii=True)
        raise RuntimeError(message)
    contracts = _normalize_tool_contract_index(data)
    return _merge_tool_contracts_into_cache(contracts)


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


def _is_parameter_supplied(arguments: dict, name: str) -> bool:
    return name in arguments and not _value_is_missing(arguments.get(name))


def _collect_allowed_param_names(contract_spec: dict) -> set[str]:
    input_schema = contract_spec.get("input-schema")
    if not isinstance(input_schema, dict):
        return set()
    names = set()
    for param in input_schema.get("required") or []:
        if isinstance(param, str) and param:
            names.add(param)
    for group in input_schema.get("any-of") or []:
        if not isinstance(group, list):
            continue
        for param in group:
            if isinstance(param, str) and param:
                names.add(param)
    for prop in input_schema.get("properties") or []:
        if isinstance(prop, dict):
            name = prop.get("name")
            if isinstance(name, str) and name:
                names.add(name)
    for validator in input_schema.get("validators") or []:
        if not isinstance(validator, dict):
            continue
        field = validator.get("field")
        if isinstance(field, str) and field:
            names.add(field)
        for name in validator.get("fields") or []:
            if isinstance(name, str) and name:
                names.add(name)
    for alias in contract_spec.get("aliases") or []:
        if not isinstance(alias, dict):
            continue
        canonical_name = alias.get("canonical-name")
        if isinstance(canonical_name, str) and canonical_name:
            names.add(canonical_name)
    return names


def _normalize_arguments_with_aliases(arguments: dict, contract_spec: dict) -> tuple[dict, list[str]]:
    alias_index = {}
    for alias in contract_spec.get("aliases") or []:
        if not isinstance(alias, dict):
            continue
        if alias.get("scope") != "parameter":
            continue
        alias_name = alias.get("alias")
        if isinstance(alias_name, str) and alias_name:
            alias_index[alias_name] = alias
    normalized = {}
    errors = []
    for key, value in arguments.items():
        alias = alias_index.get(key)
        if alias is None:
            normalized[key] = value
            continue
        canonical_name = alias.get("canonical-name")
        message = alias.get("message") or f"Use '{canonical_name}' instead of '{key}'."
        if alias.get("status") == "rejected":
            errors.append(f"Wrong parameter '{key}': {message}")
            continue
        if not isinstance(canonical_name, str) or not canonical_name:
            errors.append(f"Wrong parameter '{key}': {message}")
            continue
        if canonical_name in normalized:
            errors.append(f"Duplicate parameter '{canonical_name}' after alias normalization from '{key}'.")
            continue
        if canonical_name in arguments and canonical_name != key:
            errors.append(f"Provide only '{canonical_name}', not both '{canonical_name}' and alias '{key}'.")
            continue
        normalized[canonical_name] = value
    return normalized, errors


def _validate_unknown_params(tool_name: str, arguments: dict, contract_spec: dict) -> list[str]:
    allowed = _collect_allowed_param_names(contract_spec)
    if not allowed:
        return []
    errors = []
    for key in arguments:
        if key in allowed:
            continue
        suggestions = difflib.get_close_matches(key, sorted(allowed), n=3, cutoff=0.45)
        message = f"Unknown parameter '{key}' for tool '{tool_name}'."
        if suggestions:
            message += " Did you mean " + ", ".join(f"'{item}'" for item in suggestions) + "?"
        errors.append(message)
    return errors


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


def _apply_validator(validator: dict, arguments: dict) -> list[str]:
    name = validator.get("name")
    fields = [field for field in validator.get("fields") or [] if isinstance(field, str) and field]
    if name == "forbid-fields":
        present = [field for field in fields if _is_parameter_supplied(arguments, field)]
        if not present:
            return []
        message = "Parameters " + ", ".join(f"'{field}'" for field in present) + " are not allowed for this request."
        context = validator.get("context")
        if context:
            message += f" {context}"
        return [message]
    if name == "mutually-exclusive-fields":
        present = [field for field in fields if _is_parameter_supplied(arguments, field)]
        if len(present) <= 1:
            return []
        context = validator.get("context")
        if isinstance(context, str) and context:
            return [context]
        return ["Provide only one of " + ", ".join(f"'{field}'" for field in present) + "."]
    return []


def _validate_schema_sync_operations(arguments: dict) -> list[str]:
    operations = arguments.get("operations")
    if not isinstance(operations, list):
        return []
    errors = []
    for index, operation in enumerate(operations):
        prefix = f"operations[{index}]"
        if not isinstance(operation, dict):
            errors.append(f"{prefix} must be an object.")
            continue
        has_type = "type" in operation and not _value_is_missing(operation.get("type"))
        has_legacy_operation = "operation" in operation and not _value_is_missing(operation.get("operation"))
        if has_legacy_operation:
            if has_type:
                errors.append(f"{prefix}.operation is not supported. Use only {prefix}.type.")
            else:
                errors.append(
                    f"{prefix}.type is required; received legacy field 'operation'. Use '{prefix}.type' instead."
                )
            continue
        if not has_type:
            errors.append(f"{prefix}.type is required.")
            continue
        operation_type = operation.get("type")
        if not isinstance(operation_type, str):
            errors.append(f"{prefix}.type must be a string, not {type(operation_type).__name__}.")
            continue
        if operation_type not in SCHEMA_SYNC_ALLOWED_OPERATION_TYPES:
            allowed_values = ", ".join(sorted(SCHEMA_SYNC_ALLOWED_OPERATION_TYPES))
            errors.append(f"{prefix}.type must be one of: {allowed_values}.")
    return errors


def _normalize_and_validate_params(tool_name: str, arguments: dict, contract_index: dict | None = None) -> tuple[dict, list[str]]:
    contract_index = contract_index or {}
    spec = contract_index.get(tool_name)
    if not spec:
        return dict(arguments), []
    input_schema = spec.get("input-schema")
    if not isinstance(input_schema, dict):
        return dict(arguments), []
    normalized_arguments, errors = _normalize_arguments_with_aliases(arguments, spec)
    errors.extend(_validate_unknown_params(tool_name, normalized_arguments, spec))
    for param in input_schema.get("required") or []:
        if param not in normalized_arguments or _value_is_missing(normalized_arguments.get(param)):
            prop = _find_property(spec, param) or {}
            hint = prop.get("description") or ""
            message = f"Missing required parameter '{param}'"
            if hint:
                message += f". Hint: {hint}"
            errors.append(message)
    any_of_groups = input_schema.get("any-of") or []
    if any_of_groups and not any(
        all(param in normalized_arguments and not _value_is_missing(normalized_arguments.get(param)) for param in group)
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
        if not isinstance(name, str) or name not in normalized_arguments:
            continue
        errors.extend(_validate_field_type(name, prop.get("type"), normalized_arguments.get(name)))
    for validator in input_schema.get("validators") or []:
        if isinstance(validator, dict):
            errors.extend(_apply_validator(validator, normalized_arguments))
    if tool_name == "sync-schemas":
        errors.extend(_validate_schema_sync_operations(normalized_arguments))
    return normalized_arguments, errors


def _validate_params(tool_name: str, arguments: dict, contract_index: dict | None = None) -> list[str]:
    return _normalize_and_validate_params(tool_name, arguments, contract_index)[1]


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
        tool_name: dash-separated tool name (e.g. 'create-app')
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
    if tool_name == "get-tool-contract":
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
        try:
            explicit_contract_index = _load_explicit_tool_contract(tool_name, timeout=min(timeout, 60))
        except Exception as error:
            return {
                "success": False,
                "data": {"error": {"code": "tool-contract-unavailable", "message": str(error)}},
                "raw": str(error),
            }
        if explicit_contract_index is not None:
            contract_index = explicit_contract_index
    if tool_name not in contract_index:
        return _build_unknown_tool_result(tool_name, contract_index)
    normalized_arguments, validation_errors = _normalize_and_validate_params(tool_name, arguments, contract_index)
    if validation_errors:
        return _build_validation_result(validation_errors)
    client = _get_shared_client()
    try:
        return client.call_tool(tool_name, normalized_arguments, timeout)
    except Exception:
        client.close()
        return client.call_tool(tool_name, normalized_arguments, timeout)


def list_mcp_tools(timeout: int = 120) -> dict:
    client = _get_shared_client()
    try:
        return client.list_tools(timeout)
    except Exception:
        client.close()
        return client.list_tools(timeout)


def list_mcp_resources(timeout: int = 120) -> dict:
    client = _get_shared_client()
    try:
        return client.list_resources(timeout)
    except Exception:
        client.close()
        return client.list_resources(timeout)


def read_mcp_resource(uri: str, timeout: int = 120) -> dict:
    if not isinstance(uri, str) or not uri.strip():
        return _build_validation_result(["Missing required parameter 'uri'"])
    client = _get_shared_client()
    try:
        return client.read_resource(uri.strip(), timeout)
    except Exception:
        client.close()
        return client.read_resource(uri.strip(), timeout)


def load_cli_arguments(args_json=None, args_file=None, args_stdin=False, stdin_text=None):
    sources = sum(1 for source in (args_json is not None, args_file is not None, args_stdin) if source)
    if sources != 1:
        raise ValueError(
            "Provide exactly one argument source: <args-json>, --args-file, or --args-stdin. "
            "Run with --help for full usage."
        )
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
        raise ValueError(USAGE)
    if argv[0] in ("-h", "--help"):
        raise _HelpRequested()
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
    argv = sys.argv[1:] if argv is None else argv
    try:
        request = parse_cli_request(argv)
    except _HelpRequested:
        print(USAGE)
        return 0
    except (ValueError, json.JSONDecodeError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    if request["tool_name"] == "resources/list":
        result = list_mcp_resources(request["timeout"])
    elif request["tool_name"] == "resources/read":
        result = read_mcp_resource((request["arguments"] or {}).get("uri"), request["timeout"])
    else:
        result = call_mcp_tool(request["tool_name"], request["arguments"], request["timeout"])
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
