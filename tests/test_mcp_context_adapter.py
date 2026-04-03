import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_context_adapter import ContextError, normalize_result_document


def build_short_context():
    return {
        "success": True,
        "app": {
            "id": "11111111-1111-1111-1111-111111111111",
            "code": "UsrMyApp"
        },
        "packages": {
            "UsrMyPkg": {
                "uId": "22222222-2222-2222-2222-222222222222",
                "isPrimary": True,
                "entities": {
                    "UsrMyEntity": {
                        "uId": "33333333-3333-3333-3333-333333333333",
                        "caption": "My Entity",
                        "columns": {
                            "UsrName": {
                                "uId": "66666666-6666-6666-6666-666666666666",
                                "caption": "Name",
                                "dataValueTypeName": "Text",
                                "defaultValueSource": "Const",
                                "defaultValue": ""
                            }
                        }
                    },
                    "UsrMyEntityType": {
                        "uId": "55555555-5555-5555-5555-555555555555",
                        "caption": "My Entity Type",
                        "columns": {
                            "Name": {
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            }
                        }
                    }
                }
            }
        }
    }


def build_short_error_context():
    return {
        "success": False,
        "error": {
            "message": "Validation failed"
        }
    }


def build_flat_short_context():
    return {
        "success": True,
        "packageUId": "22222222-2222-2222-2222-222222222222",
        "packageName": "UsrMyApp",
        "entities": [
            {
                "uId": "33333333-3333-3333-3333-333333333333",
                "name": "UsrMyEntity",
                "caption": "My Entity",
                "columns": [
                    {
                        "name": "UsrName",
                        "caption": "Name",
                        "dataValueType": "Text",
                        "defaultValueSource": "Const",
                        "defaultValue": False
                    },
                    {
                        "name": "UsrType",
                        "caption": "Type",
                        "dataValueType": "Lookup",
                        "referenceSchema": "UsrMyEntityType"
                    }
                ]
            }
        ]
    }


def build_flat_short_context_with_whitespace_caption():
    return {
        "success": True,
        "packageUId": "22222222-2222-2222-2222-222222222222",
        "packageName": "UsrMyApp",
        "entities": [
            {
                "uId": "33333333-3333-3333-3333-333333333333",
                "name": "UsrVehicle",
                "caption": "  Vehicle  ",
                "columns": [
                    {
                        "name": "UsrVehicleStatus",
                        "caption": "   ",
                        "dataValueType": "Lookup",
                        "referenceSchema": "UsrVehicleStatus"
                    }
                ]
            }
        ]
    }


def build_preview_context():
    return {
        "meta": {
            "success": True
        },
        "packages": []
    }


class McpContextAdapterTests(unittest.TestCase):
    def test_normalize_result_document_builds_editable_package_entity_context(self):
        normalized = normalize_result_document(build_short_context())
        self.assertIn("editableContext", normalized)
        self.assertEqual(normalized["operationLog"], [])
        self.assertEqual(normalized["pageEvidence"], {})
        editable_context = normalized["editableContext"]
        self.assertEqual(editable_context["app"]["code"], "UsrMyApp")
        self.assertEqual(len(editable_context["packages"]), 1)
        package = editable_context["packages"][0]
        self.assertEqual(package["packageUId"], "22222222-2222-2222-2222-222222222222")
        entity_names = [entity["name"] for entity in package["entities"]]
        self.assertEqual(entity_names, ["UsrMyEntity", "UsrMyEntityType"])
        root_entity = package["entities"][0]
        lookup_entity = package["entities"][1]
        self.assertEqual(root_entity["kind"], "entity")
        self.assertEqual(root_entity["columns"][0]["name"], "UsrName")
        self.assertEqual(root_entity["columns"][0]["uId"], "66666666-6666-6666-6666-666666666666")
        self.assertEqual(root_entity["columns"][0]["defaultValueSource"], "Const")
        self.assertEqual(root_entity["columns"][0]["defaultValue"], "")
        self.assertEqual(lookup_entity["kind"], "entity")
        self.assertEqual(lookup_entity["columns"][0]["name"], "Name")
        self.assertNotIn("uId", lookup_entity["columns"][0])

    def test_normalize_result_document_keeps_short_error_without_editable_context(self):
        normalized = normalize_result_document(build_short_error_context())
        self.assertIsNone(normalized["editableContext"])
        self.assertEqual(normalized["acceptanceEvidence"], {})
        self.assertFalse(normalized["success"])
        self.assertEqual(normalized["error"]["message"], "Validation failed")

    def test_normalize_result_document_supports_flat_short_contract(self):
        normalized = normalize_result_document(build_flat_short_context())
        editable_context = normalized["editableContext"]
        self.assertEqual(editable_context["app"]["code"], "UsrMyApp")
        self.assertEqual(len(editable_context["packages"]), 1)
        package = editable_context["packages"][0]
        self.assertEqual(package["packageUId"], "22222222-2222-2222-2222-222222222222")
        entity = package["entities"][0]
        self.assertEqual(entity["name"], "UsrMyEntity")
        self.assertEqual(entity["columns"][0]["defaultValueSource"], "Const")
        self.assertFalse(entity["columns"][0]["defaultValue"])
        self.assertEqual(entity["columns"][1]["dataValueTypeName"], "Lookup")
        self.assertEqual(entity["columns"][1]["referenceSchemaName"], "UsrMyEntityType")

    def test_normalize_result_document_rejects_legacy_preview_contract(self):
        with self.assertRaises(ContextError):
            normalize_result_document(build_preview_context())

    def test_normalize_result_document_rejects_persisted_contract_type(self):
        payload = build_short_context()
        payload["contractType"] = "short"
        with self.assertRaises(ContextError):
            normalize_result_document(payload)

    def test_normalize_result_document_trims_text_and_falls_back_from_blank_caption(self):
        normalized = normalize_result_document(build_flat_short_context_with_whitespace_caption())
        entity = normalized["editableContext"]["packages"][0]["entities"][0]
        column = entity["columns"][0]

        self.assertEqual(entity["caption"], "Vehicle")
        self.assertEqual(column["caption"], "UsrVehicleStatus")

    def test_normalize_result_document_upgrades_legacy_app_code_field(self):
        normalized = normalize_result_document({
            "success": True,
            "app": {
                "id": "11111111-1111-1111-1111-111111111111",
                "app-code": "UsrLegacyApp"
            },
            "packages": {}
        })

        self.assertEqual(normalized["editableContext"]["app"]["code"], "UsrLegacyApp")
        self.assertNotIn("app-code", normalized["editableContext"]["app"])


if __name__ == "__main__":
    unittest.main()
