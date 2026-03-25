import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.page_body_tools import build_page_update_arguments, extract_attribute_paths, load_text, parse_marker_json, verify_form_page_sync, verify_list_page_sync

FIXTURES = ROOT / "tests" / "fixtures"


def build_form_body(include_lookup_action):
    action_block = ""
    if include_lookup_action:
        action_block = """,
      {
        "operation": "insert",
        "name": "addRecord_test123",
        "values": {
          "type": "crt.ComboboxSearchTextAction"
        },
        "parentName": "ComboBox_test123",
        "propertyName": "listActions",
        "index": 0
      }"""
    return f"""define("UsrTest_FormPage", function() {{
  return {{
    viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
      {{
        "operation": "insert",
        "name": "ComboBox_test123",
        "values": {{
          "type": "crt.ComboBox",
          "control": "$PDS_UsrStatus_test123"
        }},
        "parentName": "SideAreaProfileContainer",
        "propertyName": "items",
        "index": 0
      }}{action_block}
    ]/**SCHEMA_VIEW_CONFIG_DIFF*/,
    viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{{
      "attributes": {{
        "PDS_UsrStatus_test123": {{
          "modelConfig": {{
            "path": "PDS.UsrStatus"
          }}
        }}
      }}
    }}/**SCHEMA_VIEW_MODEL_CONFIG*/
  }};
}});"""


def build_list_body():
    return """define("UsrTest_ListPage", function() {
  return {
    viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
      {
        "operation": "merge",
        "name": "DataTable",
        "values": {
          "columns": [
            {
              "code": "PDS_Name"
            },
            {
              "code": "PDS_UsrStatus"
            },
          ]
        }
      }
    ]/**SCHEMA_VIEW_CONFIG_DIFF*/
  };
});"""


class PageBodyToolsTests(unittest.TestCase):
    def test_parse_marker_json_handles_trailing_commas(self):
        parsed = parse_marker_json(build_list_body(), "SCHEMA_VIEW_CONFIG_DIFF")
        self.assertEqual(parsed[0]["name"], "DataTable")
        self.assertEqual(parsed[0]["values"]["columns"][1]["code"], "PDS_UsrStatus")

    def test_build_page_update_arguments_uses_boolean_true_for_dry_run(self):
        arguments = build_page_update_arguments("UsrTest_FormPage", "body", dry_run=True)
        self.assertEqual(arguments["schema-name"], "UsrTest_FormPage")
        self.assertIs(arguments["dry-run"], True)

    def test_verify_form_page_sync_rejects_new_lookup_actions(self):
        verification = verify_form_page_sync(
            build_form_body(False),
            build_form_body(True),
            ["PDS.UsrStatus"]
        )
        self.assertTrue(verification["requiredModelPathsPresent"])
        self.assertTrue(verification["forbiddenComboboxActionsIntroduced"])
        self.assertFalse(verification["machineChecked"])

    def test_verify_list_page_sync_reports_missing_codes(self):
        verification = verify_list_page_sync(build_list_body(), ["PDS_Name", "PDS_UsrStatus", "PDS_UsrPriority"])
        self.assertFalse(verification["resolvedColumnsPresent"])
        self.assertEqual(verification["missingCodes"], ["PDS_UsrPriority"])

    def test_parse_marker_json_reads_live_form_page_fixture(self):
        body = load_text(FIXTURES / "test1_form_page_live.js")
        parsed = parse_marker_json(body, "SCHEMA_VIEW_CONFIG_DIFF")
        self.assertEqual(parsed[1]["name"], "Name")
        self.assertEqual(parsed[2]["values"]["type"], "crt.ComboBox")
        self.assertEqual(parsed[3]["values"]["type"], "crt.ComboboxSearchTextAction")

    def test_extract_attribute_paths_reads_live_form_page_fixture(self):
        body = load_text(FIXTURES / "test1_form_page_live.js")
        attribute_paths = extract_attribute_paths(body)
        self.assertEqual(attribute_paths["Name"], "PDS.Name")
        self.assertEqual(attribute_paths["PDS_Column16_lcbi4nq"], "PDS.Column16")
        self.assertNotIn("PDS_Column16_lcbi4nq_List", attribute_paths)

    def test_build_page_update_arguments_accepts_environment_name(self):
        args = build_page_update_arguments("UsrTest_FormPage", "body", environment_name="local")
        self.assertEqual(args["environment-name"], "local")
        self.assertNotIn("dry-run", args)

    def test_build_page_update_arguments_without_environment_name(self):
        args = build_page_update_arguments("UsrTest_FormPage", "body", dry_run=True)
        self.assertNotIn("environment-name", args)
        self.assertIs(args["dry-run"], True)


class McpClientValidationTests(unittest.TestCase):
    def test_rejects_wrong_param_names_for_application_create(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("application-create", {
            "environment-name": "local",
            "app-code": "UsrTest",
            "app-name": "Test",
            "template-code": "AppFreedomUI",
            "icon-background": "#fff",
        })
        self.assertTrue(any("Use 'code'" in e for e in errors))
        self.assertTrue(any("Use 'name'" in e for e in errors))
        self.assertTrue(any("Missing required parameter 'code'" in e for e in errors))
        self.assertTrue(any("Missing required parameter 'name'" in e for e in errors))

    def test_validates_page_get_requires_kebab_case(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("page-get", {"environmentName": "local", "schemaName": "X"})
        self.assertTrue(any("environment-name" in e for e in errors))
        self.assertTrue(any("schema-name" in e for e in errors))

    def test_application_delete_accepts_explicit_connection_without_environment_name(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("application-delete", {
            "app-name": "UsrTest",
            "uri": "http://localhost:5001",
            "login": "Supervisor",
            "password": "Supervisor",
        })
        self.assertEqual(errors, [])

    def test_application_delete_requires_environment_or_explicit_connection(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("application-delete", {
            "app-name": "UsrTest",
        })
        self.assertTrue(any("connection parameters" in e for e in errors))

    def test_component_info_accepts_empty_args(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("component-info", {})
        self.assertEqual(errors, [])

    def test_component_info_rejects_camel_case_param_name(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("component-info", {"componentType": "crt.TabContainer"})
        self.assertTrue(any("component-type" in e for e in errors))

    def test_passes_valid_application_create(self):
        from scripts.mcp_client import _validate_params
        errors = _validate_params("application-create", {
            "environment-name": "local",
            "code": "UsrTest",
            "name": "Test",
            "template-code": "AppFreedomUI",
            "icon-background": "#1F5F8B",
        })
        self.assertEqual(errors, [])

    def test_build_page_update_arguments_with_resources_dict(self):
        args = build_page_update_arguments("UsrTest_FormPage", "body",
                                           environment_name="local",
                                           resources={"UsrTab_caption": "My Tab"})
        self.assertEqual(args["resources"], '{"UsrTab_caption": "My Tab"}')

    def test_build_page_update_arguments_with_resources_string(self):
        args = build_page_update_arguments("UsrTest_FormPage", "body",
                                           resources='{"UsrTab_caption": "My Tab"}')
        self.assertEqual(args["resources"], '{"UsrTab_caption": "My Tab"}')

    def test_build_page_update_arguments_without_resources(self):
        args = build_page_update_arguments("UsrTest_FormPage", "body")
        self.assertNotIn("resources", args)


if __name__ == "__main__":
    unittest.main()
