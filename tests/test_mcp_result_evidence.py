import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_result_evidence import append_operation, attach_page_evidence, build_report_markdown, ensure_result_document


def build_result_document():
    return {
        "success": True,
        "appCode": "UsrTodoList",
        "appTitle": "Todo List",
        "packageUId": "22222222-2222-2222-2222-222222222222",
        "packageName": "UsrTodoList",
        "entities": [
            {
                "uId": "33333333-3333-3333-3333-333333333333",
                "name": "UsrTodoList",
                "caption": "Todo List",
                "columns": [
                    {
                        "name": "Name",
                        "caption": "Name",
                        "dataValueType": "Text"
                    }
                ]
            }
        ]
    }


class McpResultEvidenceTests(unittest.TestCase):
    def test_ensure_result_document_initializes_evidence_sections(self):
        document = ensure_result_document(build_result_document())
        self.assertEqual(document["schemaSync"], [])
        self.assertEqual(document["operationLog"], [])
        self.assertEqual(document["pageEvidence"], {})
        self.assertEqual(document["acceptanceEvidence"], {})

    def test_append_operation_records_runtime_evidence(self):
        updated = append_operation(
            build_result_document(),
            "entity.update",
            "UsrTodoList",
            "success",
            response={
                "success": True,
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "entity": {
                    "name": "UsrTodoList",
                    "uId": "33333333-3333-3333-3333-333333333333",
                    "caption": "Todo List",
                    "columns": [
                        {
                            "name": "Name"
                        },
                        {
                            "name": "UsrStatus"
                        }
                    ]
                }
            },
            phase="schema",
            refreshed_by="application.get_info"
        )
        self.assertEqual(updated["schemaSync"][0]["tool"], "entity.update")
        self.assertEqual(updated["schemaSync"][0]["evidence"]["entity"]["columns"], ["Name", "UsrStatus"])
        self.assertEqual(updated["operationLog"][0]["refreshedBy"], "application.get_info")

    def test_attach_page_evidence_marks_manual_check_pending(self):
        updated = attach_page_evidence(
            build_result_document(),
            "UsrTodoList_FormPage",
            {
                "implemented": True,
                "machineChecked": True,
                "manualChecked": False,
                "requiredModelPathsPresent": True
            },
            response={
                "success": True,
                "schemaName": "UsrTodoList_FormPage",
                "bodyLength": 7024,
                "uId": "44444444-4444-4444-4444-444444444444",
                "parentSchemaName": "PageWithTabsFreedomTemplate",
                "packageName": "UsrTodoList"
            }
        )
        page_entry = updated["pageEvidence"]["UsrTodoList_FormPage"]
        self.assertEqual(page_entry["schemaName"], "UsrTodoList_FormPage")
        self.assertEqual(page_entry["bodyLength"], 7024)
        self.assertEqual(page_entry["uId"], "44444444-4444-4444-4444-444444444444")
        self.assertEqual(page_entry["parentSchemaName"], "PageWithTabsFreedomTemplate")
        self.assertEqual(page_entry["packageName"], "UsrTodoList")
        self.assertTrue(page_entry["status"]["machineChecked"])
        self.assertTrue(page_entry["status"]["manualCheckPending"])

    def test_build_report_markdown_uses_machine_checked_and_manual_pending_labels(self):
        updated = attach_page_evidence(
            append_operation(build_result_document(), "page.update", "UsrTodoList_FormPage", "success"),
            "UsrTodoList_FormPage",
            {
                "implemented": True,
                "machineChecked": True,
                "manualChecked": False,
                "requiredModelPathsPresent": True
            },
            response={
                "success": True,
                "schemaName": "UsrTodoList_FormPage",
                "bodyLength": 7024
            }
        )
        report = build_report_markdown(updated)
        self.assertIn("UsrTodoList_FormPage=machineChecked", report)
        self.assertIn("manualCheckPending=true", report)
        self.assertIn("Pending unless explicit manual evidence is attached", report)


if __name__ == "__main__":
    unittest.main()
