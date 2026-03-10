import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_context_adapter import normalize_result_document
from scripts.mcp_schema_sync import WorkflowError, apply_sync_plan, build_create_action, build_sync_plan


def build_current_result_document():
    return normalize_result_document({
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
                                "uId": "77777777-7777-7777-7777-777777777777",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            }
                        }
                    }
                }
            }
        }
    })


def build_current_flat_result_document():
    return normalize_result_document({
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
                        "dataValueType": "Text"
                    }
                ]
            }
        ]
    })


def build_current_result_document_with_name():
    return normalize_result_document({
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
                            "Name": {
                                "uId": "77777777-7777-7777-7777-777777777777",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            }
                        }
                    }
                }
            }
        }
    })


def build_edited_context():
    return {
        "app": {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "My App",
            "code": "UsrMyApp"
        },
        "packages": [
            {
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "name": "UsrMyPkg",
                "isPrimary": True,
                "entities": [
                    {
                        "entityUId": "33333333-3333-3333-3333-333333333333",
                        "name": "UsrMyEntity",
                        "caption": "My Entity",
                        "kind": "entity",
                        "columns": [
                            {
                                "name": "UsrName",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            },
                            {
                                "name": "UsrType",
                                "caption": "Type",
                                "dataValueTypeName": "Lookup",
                                "referenceSchemaName": "UsrMyEntityType"
                            }
                        ]
                    },
                    {
                        "name": "UsrMyEntityType",
                        "caption": "My Entity Type",
                        "kind": "lookup",
                        "columns": [
                            {
                                "name": "Name",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            }
                        ]
                    }
                ]
            }
        ]
    }


def build_edited_context_with_duplicate_usrname():
    return {
        "app": {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "My App",
            "code": "UsrMyApp"
        },
        "packages": [
            {
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "name": "UsrMyPkg",
                "isPrimary": True,
                "entities": [
                    {
                        "entityUId": "33333333-3333-3333-3333-333333333333",
                        "name": "UsrMyEntity",
                        "caption": "My Entity",
                        "kind": "entity",
                        "columns": [
                            {
                                "name": "Name",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            },
                            {
                                "name": "UsrName",
                                "caption": "Custom Name",
                                "dataValueTypeName": "Text"
                            }
                        ]
                    }
                ]
            }
        ]
    }


def build_invalid_edited_context():
    return {
        "app": {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "My App",
            "code": "UsrMyApp"
        },
        "packages": [
            {
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "name": "UsrMyPkg",
                "isPrimary": True,
                "entities": [
                    {
                        "entityUId": "33333333-3333-3333-3333-333333333333",
                        "name": "UsrMyEntity",
                        "caption": "My Entity",
                        "kind": "entity",
                        "columns": [
                            {
                                "name": "UsrName",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            },
                            {
                                "name": "UsrType",
                                "caption": "Type",
                                "dataValueTypeName": "Lookup",
                                "referenceSchemaName": "UsrMissingType"
                            }
                        ]
                    }
                ]
            }
        ]
    }


class FakeMcpClient:
    def __init__(self, context_document):
        self.context_document = context_document
        self.calls = []

    def list_tools(self):
        return [
            {"name": "application.get_info"},
            {"name": "entity.create"},
            {"name": "entity.create_lookup"},
            {"name": "entity.update"}
        ]

    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, arguments))
        if tool_name == "entity.create_lookup":
            package = next(iter(self.context_document["packages"].values()))
            package["entities"][arguments["name"]] = {
                "uId": "66666666-6666-6666-6666-666666666666",
                "caption": arguments["caption"],
                "columns": {
                    "Name": {
                        "caption": "Name",
                        "dataValueTypeName": "Text"
                    }
                }
            }
            return {
                "success": True,
                "packageUId": arguments["packageUId"],
                "entity": {
                    "uId": "66666666-6666-6666-6666-666666666666",
                    "name": arguments["name"],
                    "caption": arguments["caption"],
                    "parentSchemaName": "BaseLookup",
                    "columns": [
                        {
                            "name": "Name",
                            "caption": "Name",
                            "dataValueTypeName": "Text"
                        }
                    ]
                }
            }
        if tool_name == "entity.update":
            package = next(iter(self.context_document["packages"].values()))
            entity = next(iter(package["entities"].values()))
            operations = json.loads(arguments["operationsJson"])
            for operation in operations:
                if operation["operation"] == "addColumn":
                    col = operation["column"]
                    entity["columns"][col["name"]] = {
                        k: v for k, v in col.items() if k != "name"
                    }
            return {
                "success": True,
                "packageUId": arguments["packageUId"],
                "entity": {
                    "uId": arguments["entityUId"],
                    "name": arguments["schemaName"],
                    "caption": arguments["caption"],
                    "columns": entity["columns"]
                },
                "appliedOperations": operations
            }
        if tool_name == "application.get_info":
            return self.context_document
        raise AssertionError(tool_name)


class FakeMcpClientRefreshFailure(FakeMcpClient):
    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, arguments))
        if tool_name == "entity.create_lookup":
            return {
                "success": True,
                "packageUId": arguments["packageUId"],
                "entity": {
                    "uId": "66666666-6666-6666-6666-666666666666",
                    "name": arguments["name"],
                    "caption": arguments["caption"],
                    "parentSchemaName": "BaseLookup",
                    "columns": []
                }
            }
        if tool_name == "application.get_info":
            raise WorkflowError(
                'Instance of workspace item with type "Terrasoft.Configuration.UsrMyEntityTypeSchema" cannot be obtained from server metadata'
            )
        raise AssertionError(tool_name)


class McpSchemaSyncTests(unittest.TestCase):
    def test_build_create_action_skips_inherited_lookup_columns(self):
        action = build_create_action({
            "packageUId": "22222222-2222-2222-2222-222222222222",
            "name": "UsrMyEntityType",
            "caption": "My Entity Type",
            "kind": "lookup",
            "columns": [
                {
                    "name": "Name",
                    "caption": "Name",
                    "dataValueTypeName": "Text"
                },
                {
                    "name": "UsrColor",
                    "caption": "Color",
                    "dataValueTypeName": "Text"
                }
            ]
        })
        self.assertEqual(action["toolName"], "entity.create_lookup")
        self.assertEqual(
            json.loads(action["arguments"]["columnsJson"]),
            [
                {
                    "name": "UsrColor",
                    "caption": "Color",
                    "dataValueTypeName": "Text"
                }
            ]
        )

    def test_build_create_action_rejects_usrname_for_lookup(self):
        with self.assertRaisesRegex(
            WorkflowError,
            "Lookup UsrMyEntityType must use inherited Name as PrimaryDisplayColumn"
        ):
            build_create_action({
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "name": "UsrMyEntityType",
                "caption": "My Entity Type",
                "kind": "lookup",
                "columns": [
                    {
                        "name": "UsrName",
                        "caption": "Custom Name",
                        "dataValueTypeName": "Text"
                    }
                ]
            })

    def test_build_sync_plan_orders_lookup_creation_before_entity_update(self):
        current_context = build_current_result_document()["editableContext"]
        sync_plan = build_sync_plan(current_context, build_edited_context())
        self.assertEqual(len(sync_plan["actions"]), 2)
        create_lookup = sync_plan["actions"][0]
        update_entity = sync_plan["actions"][1]
        self.assertEqual(create_lookup["toolName"], "entity.create_lookup")
        self.assertEqual(create_lookup["target"], "UsrMyEntityType")
        self.assertEqual(update_entity["toolName"], "entity.update")
        operations = json.loads(update_entity["arguments"]["operationsJson"])
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0]["operation"], "addColumn")
        self.assertEqual(operations[0]["column"]["referenceSchemaName"], "UsrMyEntityType")

    def test_build_sync_plan_stops_on_missing_lookup_reference(self):
        current_context = build_current_result_document()["editableContext"]
        with self.assertRaises(WorkflowError):
            build_sync_plan(current_context, build_invalid_edited_context())

    def test_build_sync_plan_rejects_duplicate_usrname_when_name_exists(self):
        current_context = build_current_result_document_with_name()["editableContext"]
        with self.assertRaisesRegex(
            WorkflowError,
            "Entity UsrMyEntity already contains Name; do not add duplicate UsrName"
        ):
            build_sync_plan(current_context, build_edited_context_with_duplicate_usrname())

    def test_apply_sync_plan_refreshes_canonical_result_after_each_mutation(self):
        result_document = build_current_result_document()
        fake_client = FakeMcpClient(build_current_result_document())
        with tempfile.TemporaryDirectory() as temp_dir:
            result_path = Path(temp_dir) / "mcp-application-result.json"
            apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        entity_names = [entity["name"] for entity in persisted["editableContext"]["packages"][0]["entities"]]
        self.assertEqual(entity_names, ["UsrMyEntity", "UsrMyEntityType"])
        my_entity = persisted["editableContext"]["packages"][0]["entities"][0]
        self.assertEqual(my_entity["columns"][1]["name"], "UsrType")
        self.assertEqual(my_entity["columns"][1]["referenceSchemaName"], "UsrMyEntityType")
        self.assertEqual(len(persisted["schemaSync"]), 2)
        self.assertEqual(
            [call[0] for call in fake_client.calls],
            ["entity.create_lookup", "application.get_info", "entity.update", "application.get_info"]
        )

    def test_apply_sync_plan_raises_actionable_error_when_metadata_refresh_fails(self):
        result_document = build_current_result_document()
        fake_client = FakeMcpClientRefreshFailure(build_current_result_document())
        with tempfile.TemporaryDirectory() as temp_dir:
            result_path = Path(temp_dir) / "mcp-application-result.json"
            with self.assertRaisesRegex(
                WorkflowError,
                "application.get_info failed after entity.create_lookup for UsrMyEntityType"
            ):
                apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)

    def test_apply_sync_plan_supports_flat_result_document(self):
        result_document = build_current_flat_result_document()
        fake_client = FakeMcpClient(build_current_result_document())
        with tempfile.TemporaryDirectory() as temp_dir:
            result_path = Path(temp_dir) / "mcp-application-result.json"
            apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)
        refresh_calls = [call for call in fake_client.calls if call[0] == "application.get_info"]
        self.assertTrue(refresh_calls)
        self.assertEqual(refresh_calls[0][1], {"appCode": "UsrMyApp"})


if __name__ == "__main__":
    unittest.main()
