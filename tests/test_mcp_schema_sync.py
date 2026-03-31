import contextlib
import copy
import json
import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TEST_TMP_ROOT = ROOT / ".tmp-tests"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.mcp_context_adapter import normalize_result_document
from scripts.mcp_schema_sync import ClioStdioClient, WorkflowError, apply_sync_plan, build_create_action, build_sync_plan, load_mcp_client


def build_localizations(value):
    return {"en-US": value}


def read_localized_text(localizations, fallback=None):
    if isinstance(localizations, dict):
        if isinstance(localizations.get("en-US"), str) and localizations["en-US"].strip():
            return localizations["en-US"].strip()
        for value in localizations.values():
            if isinstance(value, str) and value.strip():
                return value.strip()
    if isinstance(fallback, str):
        return fallback
    return None


@contextlib.contextmanager
def temp_workdir():
    workdir = TEST_TMP_ROOT / f"tmp-{uuid.uuid4().hex}"
    workdir.mkdir(parents=True, exist_ok=False)
    try:
        yield workdir
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


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
        "package-u-id": "22222222-2222-2222-2222-222222222222",
        "package-name": "UsrMyApp",
        "entities": [
            {
                "u-id": "33333333-3333-3333-3333-333333333333",
                "name": "UsrMyEntity",
                "title": "My Entity",
                "columns": [
                    {
                        "name": "UsrName",
                        "title": "Name",
                        "type": "Text"
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


def build_current_result_document_with_lookup_status():
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
                            },
                            "UsrStatus": {
                                "uId": "88888888-8888-8888-8888-888888888888",
                                "caption": "Status",
                                "dataValueTypeName": "Lookup",
                                "referenceSchemaName": "UsrMyEntityType"
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
                        "columns": []
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


def build_edited_context_with_default_update():
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
                                "dataValueTypeName": "Text",
                                "defaultValueSource": "Const",
                                "defaultValue": "Draft"
                            },
                            {
                                "name": "UsrStatus",
                                "caption": "Status",
                                "dataValueTypeName": "Lookup",
                                "referenceSchemaName": "UsrMyEntityType"
                            }
                        ]
                    },
                    {
                        "entityUId": "55555555-5555-5555-5555-555555555555",
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


def build_edited_context_with_caption_update():
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
                        "caption": "My Renamed Entity",
                        "kind": "entity",
                        "columns": [
                            {
                                "name": "UsrName",
                                "caption": "Name",
                                "dataValueTypeName": "Text"
                            }
                        ]
                    }
                ]
            }
        ]
    }


def build_edited_context_with_invalid_lookup_default():
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
                                "name": "UsrStatus",
                                "caption": "Status",
                                "dataValueTypeName": "Lookup",
                                "referenceSchemaName": "UsrMyEntityType",
                                "defaultValueSource": "Const",
                                "defaultValue": "New"
                            }
                        ]
                    },
                    {
                        "entityUId": "55555555-5555-5555-5555-555555555555",
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


def build_edited_context_with_invalid_binary_default():
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
                                "name": "UsrAttachment",
                                "caption": "Attachment",
                                "dataValueTypeName": "Blob",
                                "defaultValueSource": "Const",
                                "defaultValue": "abc123"
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
            {"name": "application-get-info"},
            {"name": "schema-sync"}
        ]

    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, dict(arguments)))
        if tool_name == "schema-sync":
            package = self.context_document["packages"][arguments["package-name"]]
            results = []
            for operation in arguments["operations"]:
                schema_name = operation["schema-name"]
                if operation["type"] == "create-lookup":
                    columns = {
                        "Name": {
                            "caption": "Name",
                            "dataValueTypeName": "Text"
                        }
                    }
                    for column in operation.get("columns", []):
                        columns[column["name"]] = {
                            "caption": read_localized_text(column.get("title-localizations"), column["name"]),
                            "dataValueTypeName": column.get("type")
                        }
                    package["entities"][schema_name] = {
                        "uId": "66666666-6666-6666-6666-666666666666",
                        "caption": read_localized_text(operation["title-localizations"], schema_name),
                        "parentSchemaName": "BaseLookup",
                        "columns": columns
                    }
                    results.append({"operation": "create-lookup", "schema-name": schema_name, "success": True})
                if operation["type"] == "update-entity":
                    entity = package["entities"][schema_name]
                    for update in operation["update-operations"]:
                        if update["action"] == "remove":
                            entity["columns"].pop(update["column-name"], None)
                            continue
                        payload = {
                            "caption": read_localized_text(update.get("title-localizations"), update["column-name"]),
                            "dataValueTypeName": update.get("type")
                        }
                        if update.get("reference-schema-name"):
                            payload["referenceSchemaName"] = update["reference-schema-name"]
                        if "default-value-source" in update:
                            payload["defaultValueSource"] = update["default-value-source"]
                        if "default-value" in update:
                            payload["defaultValue"] = update["default-value"]
                        entity["columns"][update["column-name"]] = payload
                    results.append({"operation": "update-entity", "schema-name": schema_name, "success": True})
            return {"success": True, "results": results}
        if tool_name == "application-get-info":
            return self.context_document
        raise AssertionError(tool_name)


class FakeMcpClientRefreshFailure(FakeMcpClient):
    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, dict(arguments)))
        if tool_name == "schema-sync":
            return {"success": True, "results": [{"operation": "update-entity", "schema-name": "UsrMyEntity", "success": True}]}
        if tool_name == "application-get-info":
            raise WorkflowError(
                'Instance of workspace item with type "Terrasoft.Configuration.UsrMyEntityTypeSchema" cannot be obtained from server metadata'
            )
        raise AssertionError(tool_name)


class FakeMcpClientWithoutSchemaSync:
    def __init__(self, context_document):
        self.context_document = context_document
        self.calls = []

    def list_tools(self):
        return [
            {"name": "application-get-info"},
            {"name": "create-lookup"},
            {"name": "create-entity-schema"},
            {"name": "update-entity-schema"}
        ]

    def call_tool_json(self, tool_name, arguments):
        self.calls.append((tool_name, dict(arguments)))
        package = self.context_document["packages"][arguments["package-name"]] if tool_name != "application-get-info" else None
        if tool_name == "create-lookup":
            columns = {
                "Name": {
                    "caption": "Name",
                    "dataValueTypeName": "Text"
                }
            }
            for column in arguments.get("columns", []):
                columns[column["name"]] = {
                    "caption": read_localized_text(column.get("title-localizations"), column["name"]),
                    "dataValueTypeName": column.get("type")
                }
            package["entities"][arguments["schema-name"]] = {
                "uId": "66666666-6666-6666-6666-666666666666",
                "caption": read_localized_text(arguments["title-localizations"], arguments["schema-name"]),
                "parentSchemaName": "BaseLookup",
                "columns": columns
            }
            return {
                "success": True,
                "package-name": arguments["package-name"],
                "entity": {
                    "uId": "66666666-6666-6666-6666-666666666666",
                    "name": arguments["schema-name"],
                    "caption": read_localized_text(arguments["title-localizations"], arguments["schema-name"]),
                    "parentSchemaName": "BaseLookup",
                    "columns": columns
                }
            }
        if tool_name == "create-entity-schema":
            package["entities"][arguments["schema-name"]] = {
                "uId": "66666666-6666-6666-6666-666666666666",
                "caption": read_localized_text(arguments["title-localizations"], arguments["schema-name"]),
                "parentSchemaName": arguments.get("parent-schema-name") or "BaseEntity",
                "columns": {}
            }
            return {
                "success": True,
                "package-name": arguments["package-name"],
                "entity": {
                    "uId": "66666666-6666-6666-6666-666666666666",
                    "name": arguments["schema-name"],
                    "caption": read_localized_text(arguments["title-localizations"], arguments["schema-name"]),
                    "parentSchemaName": arguments.get("parent-schema-name") or "BaseEntity",
                    "columns": {}
                }
            }
        if tool_name == "update-entity-schema":
            entity = package["entities"][arguments["schema-name"]]
            for operation in arguments["operations"]:
                if operation["action"] == "remove":
                    entity["columns"].pop(operation["column-name"], None)
                    continue
                payload = {
                    "caption": read_localized_text(operation.get("title-localizations"), operation["column-name"]),
                    "dataValueTypeName": operation.get("type")
                }
                if operation.get("reference-schema-name"):
                    payload["referenceSchemaName"] = operation["reference-schema-name"]
                if "default-value-source" in operation:
                    payload["defaultValueSource"] = operation["default-value-source"]
                if "default-value" in operation:
                    payload["defaultValue"] = operation["default-value"]
                entity["columns"][operation["column-name"]] = payload
            return {
                "success": True,
                "package-name": arguments["package-name"],
                "entity": {
                    "name": arguments["schema-name"],
                    "caption": entity["caption"],
                    "columns": entity["columns"]
                }
            }
        if tool_name == "application-get-info":
            return self.context_document
        raise AssertionError(tool_name)


class McpSchemaSyncTests(unittest.TestCase):
    def test_build_sync_plan_normalizes_email_address_alias_to_email_type(self):
        current_context = build_current_result_document_with_lookup_status()["editableContext"]
        edited_context = copy.deepcopy(build_edited_context_with_default_update())
        entity = edited_context["packages"][0]["entities"][0]
        entity["columns"].append({
            "name": "UsrEmail",
            "caption": "Email",
            "dataValueTypeName": "EmailAddress"
        })

        sync_plan = build_sync_plan(current_context, edited_context)
        operations = sync_plan["actions"][0]["arguments"]["operations"]
        email_operation = next(op for op in operations if op["column-name"] == "UsrEmail")

        self.assertEqual(email_operation["action"], "add")
        self.assertEqual(email_operation["type"], "Email")

    def test_build_create_action_rejects_inherited_lookup_columns(self):
        with self.assertRaisesRegex(
            WorkflowError,
            "Lookup UsrMyEntityType inherits BaseLookup columns"
        ):
            build_create_action({
                "packageUId": "22222222-2222-2222-2222-222222222222",
                "packageName": "UsrMyPkg",
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
                        "name": "Description",
                        "caption": "Description",
                        "dataValueTypeName": "Text"
                    }
                ]
            })

    def test_build_create_action_rejects_duplicate_title_like_lookup_columns(self):
        for column_name in ("UsrName", "UsrTitle", "UsrCaption"):
            with self.subTest(column_name=column_name):
                with self.assertRaisesRegex(
                    WorkflowError,
                    "Lookup UsrMyEntityType must use inherited Name as PrimaryDisplayColumn"
                ):
                    build_create_action({
                        "packageUId": "22222222-2222-2222-2222-222222222222",
                        "packageName": "UsrMyPkg",
                        "name": "UsrMyEntityType",
                        "caption": "My Entity Type",
                        "kind": "lookup",
                        "columns": [
                            {
                                "name": column_name,
                                "caption": "Custom Title",
                                "dataValueTypeName": "Text"
                            }
                        ]
                    })

    def test_build_sync_plan_rejects_duplicate_title_like_lookup_column_updates(self):
        current_context = build_current_result_document_with_lookup_status()["editableContext"]
        edited_context = copy.deepcopy(build_edited_context_with_default_update())
        edited_context["packages"][0]["entities"][1]["columns"].append({
            "name": "UsrTitle",
            "caption": "Title",
            "dataValueTypeName": "Text"
        })

        with self.assertRaisesRegex(
            WorkflowError,
            "Lookup UsrMyEntityType must use inherited Name as PrimaryDisplayColumn"
        ):
            build_sync_plan(current_context, edited_context)

    def test_build_sync_plan_orders_lookup_creation_before_entity_update(self):
        current_context = build_current_result_document()["editableContext"]
        sync_plan = build_sync_plan(current_context, build_edited_context())
        self.assertEqual(len(sync_plan["actions"]), 2)
        create_lookup = sync_plan["actions"][0]
        update_entity = sync_plan["actions"][1]
        self.assertEqual(create_lookup["toolName"], "create-lookup")
        self.assertEqual(create_lookup["target"], "UsrMyEntityType")
        self.assertEqual(update_entity["toolName"], "update-entity-schema")
        operations = update_entity["arguments"]["operations"]
        self.assertEqual(len(operations), 1)
        self.assertEqual(operations[0]["action"], "add")
        self.assertEqual(operations[0]["reference-schema-name"], "UsrMyEntityType")

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

    def test_build_sync_plan_emits_update_column_when_only_default_changes(self):
        current_context = build_current_result_document_with_lookup_status()["editableContext"]
        sync_plan = build_sync_plan(current_context, build_edited_context_with_default_update())
        self.assertEqual(len(sync_plan["actions"]), 1)
        self.assertEqual(sync_plan["actions"][0]["toolName"], "update-entity-schema")
        operations = sync_plan["actions"][0]["arguments"]["operations"]
        self.assertEqual(
            operations,
            [
                {
                    "action": "modify",
                    "column-name": "UsrName",
                    "type": "Text",
                    "title-localizations": build_localizations("Name"),
                    "default-value-source": "Const",
                    "default-value": "Draft"
                }
            ]
        )

    def test_build_sync_plan_omits_modify_title_when_caption_is_whitespace(self):
        current_context = build_current_result_document_with_lookup_status()["editableContext"]
        edited_context = copy.deepcopy(build_edited_context_with_default_update())
        target_entity = edited_context["packages"][0]["entities"][0]
        target_column = target_entity["columns"][0]
        target_column["caption"] = "   "

        sync_plan = build_sync_plan(current_context, edited_context)
        operations = sync_plan["actions"][0]["arguments"]["operations"]

        self.assertEqual(operations[0]["action"], "modify")
        self.assertNotIn("title-localizations", operations[0])

    def test_build_sync_plan_rejects_existing_entity_caption_update(self):
        current_context = build_current_result_document()["editableContext"]
        with self.assertRaisesRegex(
            WorkflowError,
            "Updating caption for existing entity UsrMyEntity is not supported"
        ):
            build_sync_plan(current_context, build_edited_context_with_caption_update())

    def test_build_sync_plan_ignores_caption_update_when_only_whitespace_differs(self):
        current_context = build_current_result_document()["editableContext"]
        edited_context = build_edited_context_with_caption_update()
        edited_context["packages"][0]["entities"][0]["caption"] = "  My Entity  "

        sync_plan = build_sync_plan(current_context, edited_context)
        self.assertEqual(sync_plan["actions"], [])

    def test_build_sync_plan_rejects_lookup_default_caption_instead_of_guid(self):
        current_context = build_current_result_document_with_lookup_status()["editableContext"]
        with self.assertRaisesRegex(
            WorkflowError,
            "Lookup column UsrStatus requires defaultValue as a seeded row GUID"
        ):
            build_sync_plan(current_context, build_edited_context_with_invalid_lookup_default())

    def test_build_sync_plan_rejects_const_default_for_binary_like_columns(self):
        current_context = build_current_result_document()["editableContext"]
        for column_type in ("Blob", "Binary", "Image", "File"):
            with self.subTest(column_type=column_type):
                edited_context = copy.deepcopy(build_edited_context_with_invalid_binary_default())
                attachment_column = edited_context["packages"][0]["entities"][0]["columns"][1]
                attachment_column["dataValueTypeName"] = column_type
                with self.assertRaisesRegex(
                    WorkflowError,
                    f"Column UsrAttachment with type {column_type} does not support defaultValueSource Const"
                ):
                    build_sync_plan(current_context, edited_context)

    def test_apply_sync_plan_refreshes_canonical_result_after_batch(self):
        result_document = build_current_result_document()
        fake_client = FakeMcpClient(build_current_result_document())
        with temp_workdir() as workdir:
            result_path = workdir / "mcp-application-result.json"
            apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        entity_names = [entity["name"] for entity in persisted["editableContext"]["packages"][0]["entities"]]
        self.assertEqual(entity_names, ["UsrMyEntity", "UsrMyEntityType"])
        my_entity = persisted["editableContext"]["packages"][0]["entities"][0]
        self.assertEqual(my_entity["columns"][1]["name"], "UsrType")
        self.assertEqual(my_entity["columns"][1]["referenceSchemaName"], "UsrMyEntityType")
        self.assertEqual(len(persisted["schemaSync"]), 1)
        self.assertEqual(len(persisted["operationLog"]), 1)
        self.assertEqual(persisted["schemaSync"][0]["tool"], "schema-sync")
        self.assertEqual(
            [call[0] for call in fake_client.calls],
            ["schema-sync", "application-get-info"]
        )

    def test_apply_sync_plan_falls_back_to_individual_tools_when_schema_sync_missing(self):
        result_document = build_current_result_document()
        fake_client = FakeMcpClientWithoutSchemaSync(build_current_result_document())
        with tempfile.TemporaryDirectory() as temp_dir:
            result_path = Path(temp_dir) / "mcp-application-result.json"
            apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)
            persisted = json.loads(result_path.read_text(encoding="utf-8"))
        entity_names = [entity["name"] for entity in persisted["editableContext"]["packages"][0]["entities"]]
        self.assertEqual(entity_names, ["UsrMyEntity", "UsrMyEntityType"])
        self.assertEqual(
            [call[0] for call in fake_client.calls],
            ["create-lookup", "update-entity-schema", "application-get-info"]
        )

    def test_apply_sync_plan_raises_actionable_error_when_metadata_refresh_fails(self):
        result_document = build_current_result_document()
        fake_client = FakeMcpClientRefreshFailure(build_current_result_document())
        with temp_workdir() as workdir:
            result_path = workdir / "mcp-application-result.json"
            with self.assertRaisesRegex(
                WorkflowError,
                "application-get-info failed after update-entity-schema for UsrMyEntity"
            ):
                apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)

    def test_apply_sync_plan_supports_flat_result_document(self):
        result_document = build_current_flat_result_document()
        fake_client = FakeMcpClient(build_current_result_document())
        with temp_workdir() as workdir:
            result_path = workdir / "mcp-application-result.json"
            apply_sync_plan(fake_client, result_document, build_edited_context(), result_path)
        refresh_calls = [call for call in fake_client.calls if call[0] == "application-get-info"]
        self.assertTrue(refresh_calls)
        self.assertEqual(refresh_calls[0][1], {"app-code": "UsrMyApp"})

    def test_clio_stdio_client_lists_tools_via_mcp_tools_list(self):
        with patch("scripts.mcp_client.ensure_supported_clio_version"), patch(
            "scripts.mcp_client.list_mcp_tools",
            return_value={"success": True, "data": {"tools": [{"name": "schema-sync"}]}, "raw": "{}"}
        ):
            client = ClioStdioClient("local")
            tools = client.list_tools()
        self.assertEqual(tools, [{"name": "schema-sync"}])


class LoadMcpClientTests(unittest.TestCase):
    def test_load_mcp_client_returns_stdio_client_for_minimal_env(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"environment": "local"}, f)
            f.flush()
            client = load_mcp_client(f.name)
        self.assertIsInstance(client, ClioStdioClient)
        self.assertEqual(client.environment_name, "local")

    def test_load_mcp_client_preserves_custom_mcp_command(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"environment": "local", "mcpCommand": "dotnet /tmp/clio.dll"}, f)
            f.flush()
            client = load_mcp_client(f.name)
        self.assertIsInstance(client, ClioStdioClient)
        self.assertEqual(client.environment_name, "local")
        self.assertEqual(client.clio_cmd, "dotnet /tmp/clio.dll")

    def test_load_mcp_client_ignores_unknown_keys(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"environment": "local", "deprecatedField": "legacy", "transportMode": "grpc"}, f)
            f.flush()
            client = load_mcp_client(f.name)
        self.assertIsInstance(client, ClioStdioClient)
        self.assertEqual(client.environment_name, "local")

    def test_load_mcp_client_raises_without_environment(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"mcpCommand": "dotnet /tmp/clio.dll"}, f)
            f.flush()
            with self.assertRaisesRegex(WorkflowError, "environment name is missing in env file"):
                load_mcp_client(f.name)


    def test_clio_stdio_client_does_not_mutate_input_arguments(self):
        original_args = {"schema-name": "UsrFoo", "package-name": "MyPkg"}
        args_copy = dict(original_args)
        with patch("scripts.mcp_schema_sync._mcp_client_import") as mock_import:
            mock_module = mock_import.return_value
            mock_module.call_mcp_tool.return_value = {"success": True, "data": {"ok": True}, "raw": "{}"}
            client = ClioStdioClient("test-env")
            client._initialized = True
            client.call_tool_json("schema-sync", original_args)
        self.assertEqual(original_args, args_copy)


if __name__ == "__main__":
    unittest.main()
