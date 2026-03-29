import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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


def build_contract(name, required=None, properties=None, aliases=None, validators=None, any_of=None):
    return {
        "name": name,
        "input-schema": {
            "required": required or [],
            "properties": properties or [],
            "validators": validators or [],
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


def validator(name, code, field_name=None, fields=None, context=None, required=None):
    payload = {"name": name, "code": code}
    if field_name is not None:
        payload["field"] = field_name
    if fields is not None:
        payload["fields"] = fields
    if context is not None:
        payload["context"] = context
    if required is not None:
        payload["required"] = required
    return payload


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
    validators=[
        validator(
            "forbid-fields",
            "invalid-workflow-shape",
            fields=["title-localizations", "description-localizations"],
            context="application-create stays scalar-only; localized captions belong to follow-up schema tools.",
        )
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
    validators=[validator("schema-sync-operations-localizations", "invalid-localization-map", field_name="operations")],
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

PAGE_SYNC_CONTRACT = build_contract(
    "page-sync",
    required=["environment-name", "pages"],
    properties=[
        field("environment-name", "string", "Registered clio environment name."),
        field("pages", "array", "Page update requests."),
        field("validate", "boolean", "Run client-side validation."),
    ],
)

COMPONENT_INFO_CONTRACT = build_contract(
    "component-info",
    properties=[
        field("component-type", "string", "Optional component type."),
        field("search", "string", "Optional search string."),
    ],
    aliases=[alias("component-type", "componentType", "Use 'component-type' instead of 'componentType'.")],
)


class McpClientTests(unittest.TestCase):
    def setUp(self):
        patcher = patch("scripts.mcp_client._TOOL_CONTRACT_CACHE", {"key": None, "contracts": None})
        self.addCleanup(patcher.stop)
        patcher.start()

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
            call_tool=unittest.mock.Mock(return_value={
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


class ParamValidationTests(unittest.TestCase):
    def setUp(self):
        self.contract_index = build_contract_index(
            APPLICATION_CREATE_CONTRACT,
            PAGE_LIST_CONTRACT,
            SCHEMA_SYNC_CONTRACT,
            COMPONENT_INFO_CONTRACT,
        )
    def test_create_data_binding_db_accepts_kebab_case(self):
        errors = _validate_params("create-data-binding-db", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
        })
        self.assertEqual(errors, [])

    def test_create_data_binding_db_does_not_require_binding_name(self):
        errors = _validate_params("create-data-binding-db", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
            "rows": '[{"values":{"Name":"New"}}]',
        })
        self.assertEqual(errors, [])

    def test_upsert_data_binding_row_db_requires_all(self):
        errors = _validate_params("upsert-data-binding-row-db", {})
        required_names = {"environment-name", "package-name", "binding-name", "values"}
        for name in required_names:
            self.assertTrue(any(name in e for e in errors), f"Missing error for {name}")

    def test_remove_data_binding_row_db_rejects_camel_case(self):
        errors = _validate_params("remove-data-binding-row-db", {
            "environment-name": "local",
            "package-name": "Pkg",
            "bindingName": "Foo",
            "keyValue": "bar",
        })
        self.assertTrue(any("bindingName" in e for e in errors))
        self.assertTrue(any("keyValue" in e for e in errors))

    def test_get_entity_schema_properties_requires_all(self):
        errors = _validate_params("get-entity-schema-properties", {})
        required_names = {"environment-name", "package-name", "schema-name"}
        for name in required_names:
            self.assertTrue(any(name in e for e in errors), f"Missing error for {name}")

    def test_get_entity_schema_column_properties_requires_column_name(self):
        errors = _validate_params("get-entity-schema-column-properties", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
        })
        self.assertTrue(any("column-name" in e for e in errors))

    def test_get_entity_schema_column_properties_rejects_camel_case(self):
        errors = _validate_params("get-entity-schema-column-properties", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
            "columnName": "Name",
        })
        self.assertTrue(any("columnName" in e for e in errors))

    def test_modify_entity_schema_column_requires_action(self):
        errors = _validate_params("modify-entity-schema-column", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
            "action": "add",
            "column-name": "Name",
        })
        self.assertEqual(errors, [])
        errors_missing = _validate_params("modify-entity-schema-column", {
            "environment-name": "local",
            "package-name": "Pkg",
        })
        self.assertTrue(any("schema-name" in e for e in errors_missing))
        self.assertTrue(any("action" in e for e in errors_missing))
        self.assertTrue(any("column-name" in e for e in errors_missing))

    def test_modify_entity_schema_column_rejects_camel_case(self):
        errors = _validate_params("modify-entity-schema-column", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
            "action": "add",
            "column-name": "UsrCol",
            "referenceSchemaName": "Contact",
            "defaultValue": "x",
        })
        self.assertTrue(any("referenceSchemaName" in e for e in errors))
        self.assertTrue(any("defaultValue" in e for e in errors))

    def test_create_lookup_rejects_camel_case(self):
        errors = _validate_params("create-lookup", {
            "environmentName": "local",
            "packageName": "Pkg",
            "schemaName": "UsrFoo",
            "title": "Foo",
        })
        self.assertTrue(any("environmentName" in e for e in errors))
        self.assertTrue(any("packageName" in e for e in errors))
        self.assertTrue(any("schemaName" in e for e in errors))

    def test_create_entity_schema_rejects_camel_case(self):
        errors = _validate_params("create-entity-schema", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
            "title": "Foo",
            "parentSchemaName": "BaseEntity",
            "extendParent": True,
        })
        self.assertTrue(any("parentSchemaName" in e for e in errors))
        self.assertTrue(any("extendParent" in e for e in errors))

    def test_update_entity_schema_rejects_camel_case(self):
        errors = _validate_params("update-entity-schema", {
            "environmentName": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
            "operations": [],
        })
        self.assertTrue(any("environmentName" in e for e in errors))

    def test_schema_sync_rejects_camel_case(self):
        errors = _validate_params("schema-sync", {
            "environmentName": "local",
            "packageName": "Pkg",
            "operations": [],
        })
        self.assertTrue(any("environmentName" in e for e in errors))
        self.assertTrue(any("packageName" in e for e in errors))

    def test_page_list_accepts_empty_args(self):
        errors = _validate_params("page-list", {})
        self.assertEqual(errors, [])

    def test_page_list_accepts_kebab_case(self):
        errors = _validate_params("page-list", {"package-name": "UsrMyApp"})
        self.assertEqual(errors, [])

    def test_application_create_rejects_aliases_and_scalar_only_violation(self):
        errors = _validate_params("application-create", {
            "environment-name": "local",
            "app-code": "UsrTest",
            "app-name": "Test",
            "template-code": "AppFreedomUI",
            "icon-background": "#fff",
            "title-localizations": {"en-US": "App"},
        }, self.contract_index)
        self.assertTrue(any("app-code" in error for error in errors))
        self.assertTrue(any("app-name" in error for error in errors))
        self.assertTrue(any("Missing required parameter 'code'" in error for error in errors))
        self.assertTrue(any("application-create stays scalar-only" in error for error in errors))

    def test_page_list_requires_connection_but_not_package_name(self):
        errors = _validate_params("page-list", {}, self.contract_index)
        self.assertTrue(any("connection parameters" in error for error in errors))
        self.assertFalse(any("package-name" in error for error in errors))

    def test_component_info_accepts_empty_args(self):
        self.assertEqual(_validate_params("component-info", {}, self.contract_index), [])

    def test_component_info_rejects_camel_case_param_name(self):
        errors = _validate_params("component-info", {"componentType": "crt.TabContainer"}, self.contract_index)
        self.assertTrue(any("componentType" in error for error in errors))

    def test_schema_sync_rejects_camel_case_and_missing_localizations(self):
        errors = _validate_params("schema-sync", {
            "environmentName": "local",
            "packageName": "Pkg",
            "operations": [
                {"type": "create-lookup", "schema-name": "UsrVehicleStatus"},
                {
                    "type": "update-entity",
                    "schema-name": "UsrVehicle",
                    "update-operations": [
                        {"action": "add", "column-name": "UsrVehicleStatus", "type": "Lookup"}
                    ],
                },
            ],
        }, self.contract_index)
        self.assertTrue(any("environmentName" in error for error in errors))
        self.assertTrue(any("packageName" in error for error in errors))
        self.assertTrue(any("requires 'title-localizations'" in error for error in errors))

    def test_validation_uses_server_declared_types(self):
        errors = _validate_params("page-sync", {
            "environment-name": "local",
            "pages": {"schema-name": "UsrPage"},
            "validate": "true",
        }, build_contract_index(PAGE_SYNC_CONTRACT))
        self.assertTrue(any("pages" in error and "array" in error for error in errors))
        self.assertTrue(any("validate" in error and "boolean" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
