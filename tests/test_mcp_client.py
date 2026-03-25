import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_client import PersistentMcpClient, call_mcp_tool, validate_clio_version, _validate_params


class McpClientTests(unittest.TestCase):
    def test_validate_clio_version_rejects_older_release(self):
        with patch.dict(os.environ, {"CLIO_CMD": "dotnet /tmp/clio-old.dll"}, clear=False), patch(
            "scripts.mcp_client.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="clio: 8.0.2.32\n", stderr="")
        ), patch("scripts.mcp_client.shutil.which", return_value="/usr/local/bin/clio"):
            with self.assertRaisesRegex(RuntimeError, "Minimum supported released version is 8.0.2.37"):
                validate_clio_version()

    def test_validate_clio_version_accepts_minimum_release(self):
        with patch.dict(os.environ, {"CLIO_CMD": "dotnet /tmp/clio-min.dll"}, clear=False), patch(
            "scripts.mcp_client.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="clio: 8.0.2.37\n", stderr="")
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

    def test_call_mcp_tool_routes_tools_list_to_list_helper(self):
        expected = {"success": True, "data": {"tools": [{"name": "page-sync"}]}, "raw": "{}"}
        with patch("scripts.mcp_client.list_mcp_tools", return_value=expected) as mocked:
            result = call_mcp_tool("tools/list", {})
        self.assertEqual(result, expected)
        mocked.assert_called_once()


class ParamValidationTests(unittest.TestCase):
    def test_create_data_binding_db_rejects_camel_case(self):
        errors = _validate_params("create-data-binding-db", {
            "environmentName": "local",
            "packageName": "Pkg",
            "schemaName": "UsrFoo",
        })
        self.assertTrue(any("environmentName" in e for e in errors))
        self.assertTrue(any("packageName" in e for e in errors))
        self.assertTrue(any("schemaName" in e for e in errors))

    def test_create_data_binding_db_accepts_kebab_case(self):
        errors = _validate_params("create-data-binding-db", {
            "environment-name": "local",
            "package-name": "Pkg",
            "schema-name": "UsrFoo",
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

    def test_page_list_requires_package_name(self):
        errors = _validate_params("page-list", {})
        self.assertTrue(any("package-name" in e for e in errors))

    def test_page_list_accepts_kebab_case(self):
        errors = _validate_params("page-list", {"package-name": "UsrMyApp"})
        self.assertEqual(errors, [])

    def test_application_create_rejects_wrong_aliases(self):
        errors = _validate_params("application-create", {
            "environment-name": "local",
            "app-code": "UsrApp",
            "app-name": "My App",
            "template-code": "AppFreedomUI",
            "icon-background": "#1F5F8B",
        })
        self.assertTrue(any("app-code" in e for e in errors))
        self.assertTrue(any("app-name" in e for e in errors))

    def test_unknown_tool_returns_empty(self):
        errors = _validate_params("nonexistent-tool", {"foo": "bar"})
        self.assertEqual(errors, [])

    def test_call_mcp_tool_returns_validation_error(self):
        result = call_mcp_tool("create-data-binding-db", {})
        self.assertFalse(result["success"])
        self.assertIn("Parameter validation failed", result["raw"])


if __name__ == "__main__":
    unittest.main()
