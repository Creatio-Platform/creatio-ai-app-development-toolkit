import contextlib
import json
import shutil
import sys
import tempfile
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
    def __init__(self, pages, include_verified_body=True, tools=None):
        self.pages = pages
        self.calls = []
        self.include_verified_body = include_verified_body
        self.tools = tools or ["page-list", "page-get", "page-update", "page-sync"]

    def list_tools(self):
        return [{"name": name} for name in self.tools]

    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, dict(arguments)))
        if tool_name == "page-list":
            pkg = arguments.get("package-name") or arguments.get("packageName")
            return {
                "success": True,
                "packageName": pkg,
                "pages": [
                    {
                        "name": name,
                        "schemaName": name,
                        "uId": page["uId"],
                        "packageName": page["packageName"],
                        "parentSchemaName": page["parentSchemaName"]
                    }
                    for name, page in sorted(self.pages.items())
                    if page["packageName"] == pkg
                ]
            }
        if tool_name == "page-get":
            sn = arguments.get("schema-name") or arguments.get("schemaName")
            page = self.pages[sn]
            return {
                "success": True,
                "page": {
                    "schemaName": sn,
                    "schemaUId": page["uId"],
                    "packageName": page["packageName"],
                    "parentSchemaName": page["parentSchemaName"],
                },
                "bundle": {},
                "raw": {
                    "body": page["body"],
                },
            }
        if tool_name == "page-update":
            sn = arguments.get("schema-name") or arguments.get("schemaName")
            if sn not in self.pages:
                return {
                    "success": False,
                    "error": {
                        "message": "Unknown page"
                    }
                }
            dry = arguments.get("dry-run") or arguments.get("dryRun")
            if dry is not True:
                self.pages[sn]["body"] = arguments["body"]
            return {
                "success": True,
                "schemaName": sn,
                "dryRun": dry,
                "bodyLength": len(arguments["body"])
            }
        if tool_name == "page-sync":
            results = []
            for page_payload in arguments["pages"]:
                sn = page_payload["schema-name"]
                page = self.pages[sn]
                page["body"] = page_payload["body"]
                result = {
                    "schema-name": sn,
                    "schemaName": sn,
                    "success": True,
                    "uId": page["uId"],
                    "packageName": page["packageName"],
                    "parentSchemaName": page["parentSchemaName"]
                }
                if self.include_verified_body:
                    result["verifiedBody"] = page_payload["body"]
                results.append(result)
            return {"success": True, "pages": results}
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
        self.assertEqual(len(persisted["schemaSync"]), 4)
        self.assertEqual([call[0] for call in fake_client.calls].count("page-sync"), 1)
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

    def test_apply_page_sync_plan_falls_back_to_page_get_when_composite_response_has_no_verified_body(self):
        pages = {
            "UsrTodoList_FormPage": {
                "uId": "11111111-1111-1111-1111-111111111111",
                "packageName": "UsrTodoList",
                "parentSchemaName": "PageWithTabsFreedomTemplate",
                "body": build_form_body(False)
            }
        }
        fake_client = FakePageClient(pages, include_verified_body=False)
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
                            "body": build_form_body(True),
                            "requiredModelPaths": ["PDS.UsrStatus"]
                        }
                    ]
                },
                result_path
            )
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertTrue(persisted["pageEvidence"]["UsrTodoList_FormPage"]["status"]["machineChecked"])
        self.assertEqual([call[0] for call in fake_client.calls].count("page-get"), 2)

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
            with self.assertRaisesRegex(WorkflowError, "page-list did not return required page UsrTodoList_ListPage"):
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
        self.assertEqual(persisted["schemaSync"][0]["tool"], "page-list")

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

    def test_apply_page_sync_plan_does_not_invent_environment_name(self):
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
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
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
                            "body": build_list_body(True),
                            "requiredCodes": ["PDS_Name", "PDS_UsrStatus"]
                        }
                    ]
                },
                result_path
            )
        page_sync_call = next(call for call in fake_client.calls if call[0] == "page-sync")
        self.assertNotIn("environment-name", page_sync_call[1])

    def test_apply_page_sync_plan_accepts_page_sync_without_page_update_tool(self):
        pages = {
            "UsrTodoList_ListPage": {
                "uId": "33333333-3333-3333-3333-333333333333",
                "packageName": "UsrTodoList",
                "parentSchemaName": "BaseSectionTemplate",
                "body": build_list_body(False)
            }
        }
        fake_client = FakePageClient(pages, tools=["page-list", "page-get", "page-sync"])
        result_document = build_result_document()
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
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
                            "body": build_list_body(True),
                            "requiredCodes": ["PDS_Name", "PDS_UsrStatus"]
                        }
                    ]
                },
                result_path
            )
        self.assertEqual([call[0] for call in fake_client.calls].count("page-sync"), 1)
        self.assertNotIn("page-update", [call[0] for call in fake_client.calls])


if __name__ == "__main__":
    unittest.main()
