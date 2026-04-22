import contextlib
import json
import shutil
import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_TMP_ROOT = ROOT / ".tmp-tests"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_context_adapter import normalize_result_document
from scripts.mcp_page_sync import WorkflowError, apply_page_sync_plan, parse_embedded_page_sync_plan, run_build_plan


@contextlib.contextmanager
def temp_workdir():
    workdir = TEST_TMP_ROOT / f"tmp-{uuid.uuid4().hex}"
    workdir.mkdir(parents=True, exist_ok=False)
    try:
        yield workdir
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def build_result_document():
    return normalize_result_document({
        "success": True,
        "app": {
            "code": "UsrTodoList"
        },
        "packageUId": "22222222-2222-2222-2222-222222222222",
        "packageName": "UsrTodoList",
        "entities": []
    })

def build_form_body(include_status=True, include_lookup_action=False):
    status_insert = ""
    if include_status:
        status_insert = """,
      {
        "operation": "insert",
        "name": "ComboBox_status123",
        "values": {
          "type": "crt.ComboBox",
          "label": "$Resources.Strings.PDS_UsrStatus_status123",
          "control": "$PDS_UsrStatus_status123"
        },
        "parentName": "SideAreaProfileContainer",
        "propertyName": "items",
        "index": 1
      }"""
    lookup_action = ""
    if include_lookup_action:
        lookup_action = """,
      {
        "operation": "insert",
        "name": "addRecord_status123",
        "values": {
          "type": "crt.ComboboxSearchTextAction"
        },
        "parentName": "ComboBox_status123",
        "propertyName": "listActions",
        "index": 0
      }"""
    status_attribute = ""
    if include_status:
        status_attribute = """,
        "PDS_UsrStatus_status123": {
          "modelConfig": {
            "path": "PDS.UsrStatus"
          }
        }"""
    return f"""define("UsrTodoList_FormPage", function() {{
  return {{
    deps: /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/,
    args: /**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/,
    viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
      {{
        "operation": "insert",
        "name": "Input_name123",
        "values": {{
          "type": "crt.Input",
          "label": "$Resources.Strings.Name",
          "control": "$Name"
        }},
        "parentName": "SideAreaProfileContainer",
        "propertyName": "items",
        "index": 0
      }}{status_insert}{lookup_action}
    ]/**SCHEMA_VIEW_CONFIG_DIFF*/,
    viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{{
      "attributes": {{
        "Name": {{
          "modelConfig": {{
            "path": "PDS.Name"
          }}
        }}{status_attribute}
      }}
    }}/**SCHEMA_VIEW_MODEL_CONFIG*/,
    modelConfig: /**SCHEMA_MODEL_CONFIG*/{{}}/**SCHEMA_MODEL_CONFIG*/,
    handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
    converters: /**SCHEMA_CONVERTERS*/{{}}/**SCHEMA_CONVERTERS*/,
    validators: /**SCHEMA_VALIDATORS*/{{}}/**SCHEMA_VALIDATORS*/
  }};
}});"""


def build_list_body(include_status=True):
    status_column = ""
    if include_status:
        status_column = """,
            {
              "code": "PDS_UsrStatus"
            }"""
    return f"""define("UsrTodoList_ListPage", function() {{
  return {{
    deps: /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/,
    args: /**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/,
    viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
      {{
        "operation": "merge",
        "name": "DataTable",
        "values": {{
          "columns": [
            {{
              "code": "PDS_Name"
            }}{status_column}
          ]
        }}
      }}
    ]/**SCHEMA_VIEW_CONFIG_DIFF*/,
    viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{{
      "attributes": {{
      }}
    }}/**SCHEMA_VIEW_MODEL_CONFIG*/,
    modelConfig: /**SCHEMA_MODEL_CONFIG*/{{}}/**SCHEMA_MODEL_CONFIG*/,
    handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
    converters: /**SCHEMA_CONVERTERS*/{{}}/**SCHEMA_CONVERTERS*/,
    validators: /**SCHEMA_VALIDATORS*/{{}}/**SCHEMA_VALIDATORS*/
  }};
}});"""


class FakePageClient:
    def __init__(self, pages, include_verified_body=True, tools=None, failed_pages=None, missing_results=None):
        self.pages = pages
        self.calls = []
        self.include_verified_body = include_verified_body
        self.tools = tools or ["sync-pages"]
        self.failed_pages = failed_pages or {}
        self.missing_results = set(missing_results or [])

    def list_tools(self):
        return [{"name": name} for name in self.tools]

    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, dict(arguments)))
        if tool_name != "sync-pages":
            raise AssertionError(tool_name)
        results = []
        for page_payload in arguments["pages"]:
            schema_name = page_payload["schema-name"]
            if schema_name in self.missing_results:
                continue
            page = self.pages[schema_name]
            error = self.failed_pages.get(schema_name)
            page_result = {
                "schema-name": schema_name,
                "success": error is None,
                "body-length": len(page_payload["body"]),
                "page": {
                    "schemaName": schema_name,
                    "schemaUId": page["uId"],
                    "packageName": page["packageName"],
                    "packageUId": page["packageUId"],
                    "parentSchemaName": page["parentSchemaName"]
                }
            }
            if "resources" in page_payload:
                payload_resources = page_payload["resources"]
                if isinstance(payload_resources, str):
                    page_result["resources-registered"] = len(json.loads(payload_resources))
            if error is None and self.include_verified_body:
                page_result["verified-body-file"] = f".clio-pages/{page_payload['schema-name']}/body.js"
            if error is not None:
                page_result["error"] = error
            results.append(page_result)
        return {
            "success": len(results) == len(arguments["pages"]) and all(result["success"] for result in results),
            "pages": results
        }


class McpPageSyncTests(unittest.TestCase):
    def test_parse_embedded_page_sync_plan_reads_marked_json_block(self):
        markdown = """# Plan

<!-- PAGE_SYNC_PLAN_JSON_START -->
```json
{
  "packageName": "UsrTodoList",
  "pages": [
    {
      "schemaName": "UsrTodoList_FormPage",
      "kind": "form",
      "body": "define(\\"UsrTodoList_FormPage\\", function(){return {};});",
      "requiredModelPaths": ["PDS.UsrStatus"]
    }
  ]
}
```
<!-- PAGE_SYNC_PLAN_JSON_END -->
"""
        payload = parse_embedded_page_sync_plan(markdown)
        self.assertEqual(payload["packageName"], "UsrTodoList")
        self.assertEqual(payload["pages"][0]["schemaName"], "UsrTodoList_FormPage")

    def test_run_build_plan_writes_page_sync_plan_json(self):
        markdown = """# Plan

<!-- PAGE_SYNC_PLAN_JSON_START -->
```json
{
  "packageName": "UsrTodoList",
  "pages": [
    {
      "schemaName": "UsrTodoList_ListPage",
      "kind": "list",
      "body": "define(\\"UsrTodoList_ListPage\\", function(){return {};});",
      "requiredCodes": ["PDS_Name"]
    }
  ]
}
```
<!-- PAGE_SYNC_PLAN_JSON_END -->
"""
        with temp_workdir() as temp_path:
            plan_md_path = temp_path / "plan.md"
            output_path = temp_path / "page-sync-plan.json"
            plan_md_path.write_text(markdown, encoding="utf-8")
            run_build_plan(plan_md_path, output_path)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["pages"][0]["kind"], "list")
        self.assertEqual(payload["pages"][0]["requiredCodes"], ["PDS_Name"])

    def test_apply_page_sync_plan_persists_page_evidence_and_report(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "PageWithTabsFreedomTemplate"
            },
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "BaseSectionTemplate"
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            report_path = temp_path / "mcp-application-report.md"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                {
                    "packageName": "UsrTodoList",
                    "pages": [
                        {
                            "schemaName": "UsrTodoList_FormPage",
                            "kind": "form",
                            "body": build_form_body(),
                            "requiredModelPaths": ["PDS.UsrStatus"],
                            "resources": {"PDS_UsrStatus_status123": "Status"}
                        },
                        {
                            "schemaName": "UsrTodoList_ListPage",
                            "kind": "list",
                            "body": build_list_body(),
                            "requiredCodes": ["PDS_Name", "PDS_UsrStatus"]
                        }
                    ]
                },
                result_path,
                report_path=report_path
            )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
            report = report_path.read_text(encoding="utf-8")
        form_entry = persisted["pageEvidence"]["UsrTodoList_FormPage"]
        list_entry = persisted["pageEvidence"]["UsrTodoList_ListPage"]
        self.assertTrue(form_entry["status"]["machineChecked"])
        self.assertTrue(list_entry["status"]["machineChecked"])
        self.assertEqual(form_entry["parentSchemaName"], "PageWithTabsFreedomTemplate")
        self.assertEqual(list_entry["uId"], "33333333-3333-3333-3333-333333333333")
        self.assertEqual(form_entry["packageUId"], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(len(persisted["schemaSync"]), 1)
        self.assertEqual([call[0] for call in fake_client.calls].count("sync-pages"), 1)
        page_sync_call = next(call for call in fake_client.calls if call[0] == "sync-pages")
        self.assertEqual(page_sync_call[1]["pages"][0]["resources"], "{\"PDS_UsrStatus_status123\": \"Status\"}")
        self.assertIn("UsrTodoList_FormPage=machineChecked", report)
        self.assertIn("manualCheckPending=true", report)

    def test_apply_page_sync_plan_persists_failed_page_result_before_raising(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "PageWithTabsFreedomTemplate"
            }
        }
        fake_client = FakePageClient(pages, failed_pages={"UsrTodoList_FormPage": "save blocked"})
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "Page sync verification failed for UsrTodoList_FormPage: save blocked"):
                apply_page_sync_plan(
                    fake_client,
                    result_document,
                    {
                        "packageName": "UsrTodoList",
                        "pages": [
                            {
                                "schemaName": "UsrTodoList_FormPage",
                                "kind": "form",
                                "body": build_form_body()
                            }
                        ]
                    },
                    result_path
                )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertFalse(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["implemented"])
        self.assertFalse(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["machineChecked"])

    def test_apply_page_sync_plan_rejects_missing_verified_body_without_fallback(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "PageWithTabsFreedomTemplate"
            }
        }
        fake_client = FakePageClient(pages, include_verified_body=False)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "missing verified-body"):
                apply_page_sync_plan(
                    fake_client,
                    result_document,
                    {
                        "packageName": "UsrTodoList",
                        "pages": [
                            {
                                "schemaName": "UsrTodoList_FormPage",
                                "kind": "form",
                                "body": build_form_body()
                            }
                        ]
                    },
                    result_path
                )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertTrue(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["implemented"])
        self.assertFalse(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["machineChecked"])
        self.assertEqual([call[0] for call in fake_client.calls], ["sync-pages"])

    def test_apply_page_sync_plan_accepts_markdown_embedded_plan_payload(self):
        pages = {
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "BaseSectionTemplate"
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        markdown = """# Plan

### Machine-readable page-sync-plan.json
```json
{
  "packageName": "UsrTodoList",
  "pages": [
    {
      "schemaName": "UsrTodoList_ListPage",
      "kind": "list",
      "body": "define(\\"UsrTodoList_ListPage\\", function() { return {}; });",
      "requiredCodes": ["PDS_Name", "PDS_UsrStatus"]
    }
  ]
}
```
"""
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            plan_path = temp_path / "plan.md"
            plan_path.write_text(markdown, encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                parse_embedded_page_sync_plan(plan_path.read_text(encoding="utf-8")),
                result_path
            )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertIn("UsrTodoList_ListPage", persisted["pageEvidence"])

    def test_apply_page_sync_plan_materializes_form_fields_from_structured_edit_spec(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "PageWithTabsFreedomTemplate",
                "body": build_form_body(False)
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                {
                    "packageName": "UsrTodoList",
                    "pages": [
                        {
                            "schemaName": "UsrTodoList_FormPage",
                            "kind": "form",
                            "body": build_form_body(False),
                            "formFields": [
                                {
                                    "name": "UsrStatus",
                                    "type": "crt.ComboBox",
                                    "path": "PDS.UsrStatus"
                                }
                            ]
                        }
                    ]
                },
                result_path
            )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertTrue(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["machineChecked"])
        page_sync_call = next(call for call in fake_client.calls if call[0] == "sync-pages")
        self.assertIn("PDS.UsrStatus", page_sync_call[1]["pages"][0]["body"])

    def test_apply_page_sync_plan_materializes_list_columns_from_structured_edit_spec_with_trailing_commas(self):
        pages = {
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "BaseSectionTemplate",
                "body": build_list_body(False)
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        list_body_with_trailing_comma = """define("UsrTodoList_ListPage", function() {
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
          ]
        }
      },
    ]/**SCHEMA_VIEW_CONFIG_DIFF*/,
    viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{
      "attributes": {
      }
    }/**SCHEMA_VIEW_MODEL_CONFIG*/,
    handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
    converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
    validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/,
    modelConfig: /**SCHEMA_MODEL_CONFIG*/{}/**SCHEMA_MODEL_CONFIG*/,
    deps: /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/,
    args: /**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/
  };
});"""
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                {
                    "packageName": "UsrTodoList",
                    "pages": [
                        {
                            "schemaName": "UsrTodoList_ListPage",
                            "kind": "list",
                            "body": list_body_with_trailing_comma,
                            "listColumns": [
                                {
                                    "code": "PDS_UsrStatus",
                                    "dataValueType": 10
                                }
                            ]
                        }
                    ]
                },
                result_path
            )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertTrue(persisted["pageEvidence"]["UsrTodoList_ListPage"]["status"]["machineChecked"])
        page_sync_call = next(call for call in fake_client.calls if call[0] == "sync-pages")
        self.assertIn("PDS_UsrStatus", page_sync_call[1]["pages"][0]["body"])

    def test_apply_page_sync_plan_does_not_invent_environment_name(self):
        pages = {
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "BaseSectionTemplate"
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                {
                    "packageName": "UsrTodoList",
                    "pages": [
                        {
                            "schemaName": "UsrTodoList_ListPage",
                            "kind": "list",
                            "body": build_list_body()
                        }
                    ]
                },
                result_path
            )
        page_sync_call = next(call for call in fake_client.calls if call[0] == "sync-pages")
        self.assertNotIn("environment-name", page_sync_call[1])

    def test_apply_page_sync_plan_accepts_page_sync_only_tool(self):
        pages = {
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "parentSchemaName": "BaseSectionTemplate"
            }
        }
        fake_client = FakePageClient(pages, tools=["sync-pages"])
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                {
                    "packageName": "UsrTodoList",
                    "pages": [
                        {
                            "schemaName": "UsrTodoList_ListPage",
                            "kind": "list",
                            "body": build_list_body()
                        }
                    ]
                },
                result_path
            )
        self.assertEqual([call[0] for call in fake_client.calls].count("sync-pages"), 1)


if __name__ == "__main__":
    unittest.main()
