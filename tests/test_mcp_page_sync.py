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


def build_form_body(include_status, include_lookup_action=False):
    status_insert = ""
    if include_status:
        status_insert = """,
      {
        "operation": "insert",
        "name": "ComboBox_status123",
        "values": {
          "type": "crt.ComboBox",
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
    viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
      {{
        "operation": "insert",
        "name": "Input_name123",
        "values": {{
          "type": "crt.Input",
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
    }}/**SCHEMA_VIEW_MODEL_CONFIG*/
  }};
}});"""


def build_list_body(include_status):
    status_column = ""
    if include_status:
        status_column = """,
            {
              "code": "PDS_UsrStatus"
            }"""
    return f"""define("UsrTodoList_ListPage", function() {{
  return {{
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
    ]/**SCHEMA_VIEW_CONFIG_DIFF*/
  }};
}});"""


class FakePageClient:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def list_tools(self):
        return [
            {"name": "page.list"},
            {"name": "page.get"},
            {"name": "page.update"}
        ]

    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, dict(arguments)))
        if tool_name == "page.list":
            return {
                "success": True,
                "packageName": arguments["packageName"],
                "pages": [
                    {
                        "name": name,
                        "schemaName": name,
                        "uId": page["uId"],
                        "packageName": page["packageName"],
                        "parentSchemaName": page["parentSchemaName"]
                    }
                    for name, page in sorted(self.pages.items())
                    if page["packageName"] == arguments["packageName"]
                ]
            }
        if tool_name == "page.get":
            page = self.pages[arguments["schemaName"]]
            return {
                "success": True,
                "schemaName": arguments["schemaName"],
                "uId": page["uId"],
                "packageName": page["packageName"],
                "parentSchemaName": page["parentSchemaName"],
                "body": page["body"],
                "bodyLength": len(page["body"])
            }
        if tool_name == "page.update":
            if arguments["schemaName"] not in self.pages:
                return {
                    "success": False,
                    "error": {
                        "message": "Unknown page"
                    }
                }
            if arguments.get("dryRun") != "true":
                self.pages[arguments["schemaName"]]["body"] = arguments["body"]
            return {
                "success": True,
                "schemaName": arguments["schemaName"],
                "dryRun": arguments.get("dryRun"),
                "bodyLength": len(arguments["body"])
            }
        raise AssertionError(tool_name)


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
                "parentSchemaName": "PageWithTabsFreedomTemplate",
                "body": build_form_body(False)
            },
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "parentSchemaName": "BaseSectionTemplate",
                "body": build_list_body(False)
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            report_path = temp_path / "mcp-application-report.md"
            form_body_path = temp_path / "form-body.js"
            list_body_path = temp_path / "list-body.js"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            form_body_path.write_text(build_form_body(True), encoding="utf-8")
            list_body_path.write_text(build_list_body(True), encoding="utf-8")
            apply_page_sync_plan(
                fake_client,
                result_document,
                {
                    "packageName": "UsrTodoList",
                    "pages": [
                        {
                            "schemaName": "UsrTodoList_FormPage",
                            "kind": "form",
                            "bodyPath": str(form_body_path),
                            "requiredModelPaths": ["PDS.UsrStatus"]
                        },
                        {
                            "schemaName": "UsrTodoList_ListPage",
                            "kind": "list",
                            "bodyPath": str(list_body_path),
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
        self.assertEqual(len(persisted["schemaSync"]), 9)
        self.assertEqual([call[0] for call in fake_client.calls].count("page.update"), 4)
        self.assertIn("UsrTodoList_FormPage=machineChecked", report)
        self.assertIn("manualCheckPending=true", report)

    def test_apply_page_sync_plan_persists_failed_form_verification_before_raising(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "parentSchemaName": "PageWithTabsFreedomTemplate",
                "body": build_form_body(False)
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            form_body_path = temp_path / "form-body.js"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            form_body_path.write_text(build_form_body(True, include_lookup_action=True), encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "Page sync verification failed for UsrTodoList_FormPage"):
                apply_page_sync_plan(
                    fake_client,
                    result_document,
                    {
                        "packageName": "UsrTodoList",
                        "pages": [
                            {
                                "schemaName": "UsrTodoList_FormPage",
                                "kind": "form",
                                "bodyPath": str(form_body_path),
                                "requiredModelPaths": ["PDS.UsrStatus"]
                            }
                        ]
                    },
                    result_path
                )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        verification = persisted["pageEvidence"]["UsrTodoList_FormPage"]["verification"]
        self.assertTrue(verification["forbiddenComboboxActionsIntroduced"])
        self.assertFalse(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["machineChecked"])

    def test_apply_page_sync_plan_rejects_missing_discovered_page(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "parentSchemaName": "PageWithTabsFreedomTemplate",
                "body": build_form_body(False)
            }
        }
        fake_client = FakePageClient(pages)
        result_document = build_result_document()
        with temp_workdir() as temp_path:
            result_path = temp_path / "mcp-application-result.json"
            result_path.write_text(json.dumps(result_document), encoding="utf-8")
            with self.assertRaisesRegex(WorkflowError, "page.list did not return required page UsrTodoList_ListPage"):
                apply_page_sync_plan(
                    fake_client,
                    result_document,
                    {
                        "packageName": "UsrTodoList",
                        "pages": [
                            {
                                "schemaName": "UsrTodoList_ListPage",
                                "kind": "list",
                                "body": build_list_body(True),
                                "requiredCodes": ["PDS_Name", "PDS_UsrStatus"]
                            }
                        ]
                    },
                    result_path
                )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertEqual(persisted["schemaSync"][0]["tool"], "page.list")

    def test_apply_page_sync_plan_accepts_markdown_embedded_plan_payload(self):
        pages = {
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "parentSchemaName": "BaseSectionTemplate",
                "body": build_list_body(False)
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
      "body": "define(\\"UsrTodoList_ListPage\\", function() { return { viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[{ \\"operation\\": \\"merge\\", \\"name\\": \\"DataTable\\", \\"values\\": { \\"columns\\": [{ \\"code\\": \\"PDS_Name\\" }, { \\"code\\": \\"PDS_UsrStatus\\" }] } }]/**SCHEMA_VIEW_CONFIG_DIFF*/ }; });",
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


if __name__ == "__main__":
    unittest.main()
