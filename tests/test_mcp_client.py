import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_client import (
    PersistentMcpClient,
    _get_tool_contract_index,
    _normalize_tool_contract_index,
    _parse_rpc_result,
    _validate_params,
    call_mcp_tool,
    load_cli_arguments,
    parse_cli_request,
    validate_clio_version,
)


def build_contract_index(*contracts):
    return {contract["name"]: contract for contract in contracts}


def build_contract(name, required=None, properties=None, aliases=None, any_of=None):
    return {
        "name": name,
        "input-schema": {
            "required": required or [],
            "properties": properties or [],
            "validators": [],
            "any-of": any_of or [],
        },
        "aliases": aliases or [],
    }


def field(name, field_type, description):
    return {"name": name, "type": field_type, "description": description}


def alias(canonical_name, wrong_name, message):
    return {
        "scope": "parameter",
        "canonical-name": canonical_name,
        "alias": wrong_name,
        "status": "rejected",
        "message": message,
    }


APPLICATION_CREATE_CONTRACT = build_contract(
    "application-create",
    required=["environment-name", "name", "code", "template-code", "icon-background"],
    properties=[
        field("environment-name", "string", "Registered clio environment name."),
        field("name", "string", "Application display name."),
        field("code", "string", "Application code."),
        field("template-code", "string", "Technical template code."),
        field("icon-background", "string", "Hex icon background."),
    ],
    aliases=[
        alias("code", "app-code", "Use 'code' instead of 'app-code'."),
        alias("name", "app-name", "Use 'name' instead of 'app-name'."),
    ],
)

PAGE_LIST_CONTRACT = build_contract(
    "page-list",
    properties=[
        field("package-name", "string", "Package name to inspect."),
        field("environment-name", "string", "Registered clio environment name."),
        field("uri", "string", "Explicit Creatio URL."),
        field("login", "string", "Explicit login."),
        field("password", "string", "Explicit password."),
    ],
    aliases=[
        alias("package-name", "packageName", "Use 'package-name' instead of 'packageName'."),
        alias("environment-name", "environmentName", "Use 'environment-name' instead of 'environmentName'."),
    ],
    any_of=[["environment-name"], ["uri", "login", "password"]],
)

SCHEMA_SYNC_CONTRACT = build_contract(
    "schema-sync",
    required=["environment-name", "package-name", "operations"],
    properties=[
        field("environment-name", "string", "Registered clio environment name."),
        field("package-name", "string", "Target package name."),
        field("operations", "array", "Ordered schema operations."),
    ],
    aliases=[
        alias("environment-name", "environmentName", "Use 'environment-name' instead of 'environmentName'."),
        alias("package-name", "packageName", "Use 'package-name' instead of 'packageName'."),
    ],
)

PAGE_SYNC_CONTRACT = build_contract(
    "page-sync",
    required=["environment-name", "pages"],
    properties=[
        field("environment-name", "string", "Registered clio environment name."),
        field("pages", "array", "Page update requests."),
        field("validate", "boolean", "Run client-side validation."),
    ],
)

CREATE_DATA_BINDING_CONTRACT = build_contract(
    "create-data-binding-db",
    required=["environment-name", "package-name", "schema-name"],
    properties=[
        field("environment-name", "string", "Registered clio environment name."),
        field("package-name", "string", "Target package name."),
        field("schema-name", "string", "Entity schema name."),
    ],
)


class McpClientTests(unittest.TestCase):
    def setUp(self):
        cache_patcher = patch("scripts.mcp_client._TOOL_CONTRACT_CACHE", {"key": None, "contracts": None})
        self.addCleanup(cache_patcher.stop)
        cache_patcher.start()

    def test_validate_clio_version_rejects_older_release(self):
        with patch.dict(os.environ, {"CLIO_CMD": "dotnet /tmp/clio-old.dll"}, clear=False), patch(
            "scripts.mcp_client.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="clio: 8.0.2.32\n", stderr=""),
        ), patch("scripts.mcp_client.shutil.which", return_value="/usr/local/bin/clio"):
            with self.assertRaisesRegex(RuntimeError, "Minimum supported released version is 8.0.2.37"):
                validate_clio_version()

    def test_validate_clio_version_accepts_minimum_release(self):
        with patch.dict(os.environ, {"CLIO_CMD": "dotnet /tmp/clio-min.dll"}, clear=False), patch(
            "scripts.mcp_client.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="clio: 8.0.2.37\n", stderr=""),
        ), patch("scripts.mcp_client.shutil.which", return_value="/usr/local/bin/clio"):
            info = validate_clio_version()
        self.assertEqual(info["version"], "8.0.2.37")

    def test_persistent_client_list_tools_uses_mcp_tools_list_method(self):
        client = PersistentMcpClient()
        expected = {"success": True, "data": {"tools": [{"name": "schema-sync"}]}, "raw": "{}"}
        with patch.object(PersistentMcpClient, "call_method", return_value=expected) as mocked:
            result = client.list_tools(timeout=15)
        self.assertEqual(result, expected)
        mocked.assert_called_once_with("tools/list", {}, timeout=15, expect_tool_result=False)

    def test_parse_cli_request_accepts_legacy_positional_mode(self):
        parsed = parse_cli_request(["application-get-list", '{"environment-name":"local"}', "30"])
        self.assertEqual(parsed["tool_name"], "application-get-list")
        self.assertEqual(parsed["arguments"], {"environment-name": "local"})
        self.assertEqual(parsed["timeout"], 30)

    def test_parse_cli_request_accepts_args_file_mode(self):
        temp_path = ROOT / ".tmp-tests" / "mcp-client-args.json"
        temp_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path.write_text('{"environment-name":"local"}', encoding="utf-8")
        try:
            parsed = parse_cli_request(["application-get-list", "--args-file", str(temp_path), "--timeout", "45"])
        finally:
            temp_path.unlink(missing_ok=True)
        self.assertEqual(parsed["tool_name"], "application-get-list")
        self.assertEqual(parsed["arguments"], {"environment-name": "local"})
        self.assertEqual(parsed["timeout"], 45)

    def test_load_cli_arguments_accepts_stdin_mode(self):
        arguments = load_cli_arguments(args_stdin=True, stdin_text='{"environment-name":"local"}')
        self.assertEqual(arguments, {"environment-name": "local"})

    def test_load_cli_arguments_rejects_multiple_sources(self):
        with self.assertRaisesRegex(ValueError, "exactly one argument source"):
            load_cli_arguments(args_json="{}", args_file="args.json")

    def test_parse_rpc_result_marks_nonzero_exit_code_as_failure(self):
        collected = [
            '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\\"exit-code\\":1,\\"execution-log-messages\\":[{\\"message-type\\":\\"Info\\",\\"value\\":\\"boom\\"}] }"}]}}'
        ]
        result = _parse_rpc_result(3, collected, expect_tool_result=True)
        self.assertFalse(result["success"])
        self.assertEqual(result["data"]["exit-code"], 1)

    def test_parse_rpc_result_marks_error_log_message_as_failure(self):
        collected = [
            '{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\\"exit-code\\":0,\\"execution-log-messages\\":[{\\"message-type\\":\\"Error\\",\\"value\\":\\"bad\\"}] }"}]}}'
        ]
        result = _parse_rpc_result(7, collected, expect_tool_result=True)
        self.assertFalse(result["success"])
        self.assertEqual(result["data"]["exit-code"], 0)

    def test_get_tool_contract_index_uses_cache(self):
        fake_client = SimpleNamespace(
            call_tool=Mock(return_value={
                "success": True,
                "data": {
                    "success": True,
                    "tools": [APPLICATION_CREATE_CONTRACT, SCHEMA_SYNC_CONTRACT],
                },
                "raw": "{}",
            })
        )
        with patch("scripts.mcp_client._current_clio_resolution_key", return_value=("custom", "/usr/local/bin/clio")), patch(
            "scripts.mcp_client._get_shared_client",
            return_value=fake_client,
        ):
            first = _get_tool_contract_index(timeout=10)
            second = _get_tool_contract_index(timeout=10)
        self.assertIs(first, second)
        fake_client.call_tool.assert_called_once_with("tool-contract-get", {}, timeout=10)

    def test_normalize_tool_contract_index_rejects_failure_payload(self):
        with self.assertRaisesRegex(RuntimeError, "missing"):
            _normalize_tool_contract_index({
                "success": False,
                "error": {"code": "missing-required-parameter", "message": "missing"},
            })

    def test_call_mcp_tool_routes_tools_list_to_list_helper(self):
        expected = {"success": True, "data": {"tools": [{"name": "page-sync"}]}, "raw": "{}"}
        with patch("scripts.mcp_client.list_mcp_tools", return_value=expected) as mocked:
            result = call_mcp_tool("tools/list", {})
        self.assertEqual(result, expected)
        mocked.assert_called_once()

    def test_call_mcp_tool_bypasses_contract_lookup_for_tool_contract_get(self):
        fake_client = SimpleNamespace(call_tool=Mock(return_value={"success": True, "data": {"success": True}, "raw": "{}"}))
        with patch("scripts.mcp_client._get_shared_client", return_value=fake_client), patch(
            "scripts.mcp_client._get_tool_contract_index",
            side_effect=AssertionError("should not be called"),
        ):
            result = call_mcp_tool("tool-contract-get", {})
        self.assertTrue(result["success"])
        fake_client.call_tool.assert_called_once_with("tool-contract-get", {}, 120)

    def test_call_mcp_tool_returns_structured_unknown_tool_error(self):
        contract_index = build_contract_index(PAGE_SYNC_CONTRACT, PAGE_LIST_CONTRACT)
        with patch("scripts.mcp_client._get_tool_contract_index", return_value=contract_index):
            result = call_mcp_tool("page-updte", {})
        self.assertFalse(result["success"])
        self.assertEqual(result["data"]["error"]["code"], "tool-not-found")
        self.assertIn("page-sync", result["data"]["error"]["suggestions"])

    def test_call_mcp_tool_returns_validation_error_from_metadata(self):
        contract_index = build_contract_index(CREATE_DATA_BINDING_CONTRACT)
        with patch("scripts.mcp_client._get_tool_contract_index", return_value=contract_index):
            result = call_mcp_tool("create-data-binding-db", {})
        self.assertFalse(result["success"])
        self.assertEqual(result["data"]["error"]["code"], "invalid-request")
        self.assertIn("Missing required parameter 'environment-name'", result["raw"])

    def test_call_mcp_tool_returns_tool_contract_unavailable(self):
        with patch("scripts.mcp_client._get_tool_contract_index", side_effect=RuntimeError("metadata unavailable")):
            result = call_mcp_tool("schema-sync", {"environment-name": "local"})
        self.assertFalse(result["success"])
        self.assertEqual(result["data"]["error"]["code"], "tool-contract-unavailable")
        self.assertIn("metadata unavailable", result["raw"])


class ParamValidationTests(unittest.TestCase):
    def setUp(self):
        self.contract_index = build_contract_index(
            APPLICATION_CREATE_CONTRACT,
            PAGE_LIST_CONTRACT,
            PAGE_SYNC_CONTRACT,
            SCHEMA_SYNC_CONTRACT,
            CREATE_DATA_BINDING_CONTRACT,
        )

    def test_validate_params_requires_live_contract_to_enforce_rules(self):
        self.assertEqual(_validate_params("schema-sync", {"environmentName": "local"}), [])

    def test_application_create_rejects_aliases_and_missing_required_fields(self):
        errors = _validate_params("application-create", {
            "environment-name": "local",
            "app-code": "UsrTest",
            "app-name": "Test",
            "template-code": "AppFreedomUI",
            "icon-background": "#fff",
        }, self.contract_index)
        self.assertTrue(any("app-code" in error for error in errors))
        self.assertTrue(any("app-name" in error for error in errors))
        self.assertTrue(any("Missing required parameter 'code'" in error for error in errors))
        self.assertTrue(any("Missing required parameter 'name'" in error for error in errors))

    def test_page_list_requires_connection_by_any_of_contract(self):
        errors = _validate_params("page-list", {}, self.contract_index)
        self.assertTrue(any("connection parameters" in error for error in errors))
        self.assertFalse(any("package-name" in error for error in errors))

    def test_validation_uses_server_declared_types(self):
        errors = _validate_params("page-sync", {
            "environment-name": "local",
            "pages": {"schema-name": "UsrPage"},
            "validate": "true",
        }, self.contract_index)
        self.assertTrue(any("pages" in error and "array" in error for error in errors))
        self.assertTrue(any("validate" in error and "boolean" in error for error in errors))

    def test_nested_schema_sync_shape_is_not_validated_locally(self):
        errors = _validate_params("schema-sync", {
            "environment-name": "local",
            "package-name": "Pkg",
            "operations": [
                {
                    "type": "create-lookup",
                    "schema-name": "UsrVehicleStatus",
                    "title": "Legacy Title",
                }
            ],
        }, self.contract_index)
        self.assertEqual(errors, [])

    def test_metadata_alias_validation_still_rejects_top_level_aliases(self):
        errors = _validate_params("schema-sync", {
            "environmentName": "local",
            "packageName": "Pkg",
            "operations": [],
        }, self.contract_index)
        self.assertTrue(any("environmentName" in error for error in errors))
        self.assertTrue(any("packageName" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
