import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_result_document import (
    ContextError,
    append_operation,
    attach_page_evidence,
    ensure_result_document,
    refresh_result_document,
    validate_result_document,
)


def build_runtime_result():
    return {
        "success": True,
        "appCode": "UsrTodoList",
        "packageUId": "22222222-2222-2222-2222-222222222222",
        "packageName": "UsrTodoList",
        "entities": [
            {
                "uId": "33333333-3333-3333-3333-333333333333",
                "name": "UsrTodoList",
                "caption": "Todo List",
                "columns": [
                    {
                        "name": "UsrName",
                        "caption": "Name",
                        "dataValueType": "Text"
                    }
                ]
            }
        ]
    }


class McpResultDocumentTests(unittest.TestCase):
    def test_validate_result_document_requires_canonical_helper_sections(self):
        with self.assertRaises(ContextError):
            validate_result_document(build_runtime_result())

    def test_validate_result_document_rejects_string_page_status(self):
        document = ensure_result_document(build_runtime_result())
        document["pageEvidence"]["UsrTodoList_FormPage"] = {
            "verification": {},
            "status": "implemented"
        }
        with self.assertRaises(ContextError):
            validate_result_document(document)

    def test_validate_result_document_rejects_operation_without_target(self):
        document = ensure_result_document(build_runtime_result())
        document["operationLog"].append({
            "tool": "update-page",
            "status": "success"
        })
        with self.assertRaises(ContextError):
            validate_result_document(document)

    def test_refresh_result_document_preserves_helper_sections(self):
        current_document = attach_page_evidence(
            append_operation(build_runtime_result(), "update-entity-schema", "UsrTodoList", "success"),
            "UsrTodoList_FormPage",
            {
                "implemented": True,
                "machineChecked": True,
                "manualChecked": False
            },
            response={
                "success": True,
                "schemaName": "UsrTodoList_FormPage",
                "bodyLength": 128
            }
        )
        runtime_document = {
            "success": True,
            "appCode": "UsrTodoList",
            "packageUId": "22222222-2222-2222-2222-222222222222",
            "packageName": "UsrTodoList",
            "entities": [
                {
                    "uId": "33333333-3333-3333-3333-333333333333",
                    "name": "UsrTodoList",
                    "caption": "Todo List",
                    "columns": [
                        {
                            "name": "UsrName",
                            "caption": "Name",
                            "dataValueType": "Text"
                        },
                        {
                            "name": "UsrStatus",
                            "caption": "Status",
                            "dataValueType": "Lookup",
                            "referenceSchema": "UsrTodoStatus"
                        }
                    ]
                }
            ]
        }
        refreshed = refresh_result_document(runtime_document, current_document)
        self.assertEqual(len(refreshed["schemaSync"]), 1)
        self.assertEqual(len(refreshed["operationLog"]), 1)
        self.assertIn("UsrTodoList_FormPage", refreshed["pageEvidence"])
        entity_columns = refreshed["editableContext"]["packages"][0]["entities"][0]["columns"]
        self.assertEqual(entity_columns[1]["name"], "UsrStatus")


if __name__ == "__main__":
    unittest.main()
