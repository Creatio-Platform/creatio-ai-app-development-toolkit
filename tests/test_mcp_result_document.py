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
    normalize_column,
    normalize_columns,
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


class CoercionTests(unittest.TestCase):
    def test_detect_runtime_shape_coerces_string_true_to_bool(self):
        doc = build_runtime_result()
        doc["success"] = "true"
        result = ensure_result_document(doc)
        self.assertIs(result["success"], True)

    def test_detect_runtime_shape_coerces_string_false_to_bool(self):
        doc = {
            "success": "false",
            "error": {"message": "test error", "code": "TEST"}
        }
        result = ensure_result_document(doc)
        self.assertIs(result["success"], False)

    def test_detect_runtime_shape_rejects_non_bool_string(self):
        doc = build_runtime_result()
        doc["success"] = "maybe"
        with self.assertRaises(ContextError):
            ensure_result_document(doc)

    def test_normalize_column_handles_string(self):
        result = normalize_column("UsrName")
        self.assertEqual(result["name"], "UsrName")
        self.assertEqual(result["caption"], "UsrName")

    def test_normalize_columns_handles_string_array(self):
        result = normalize_columns(["UsrName", "UsrStatus"])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "UsrName")
        self.assertEqual(result[1]["name"], "UsrStatus")


if __name__ == "__main__":
    unittest.main()
