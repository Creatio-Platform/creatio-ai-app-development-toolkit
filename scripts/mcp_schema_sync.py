#!/usr/bin/env python3
import argparse
import json
import os
import re
import time
import uuid
from pathlib import Path

try:
    from scripts.mcp_context_adapter import infer_contract_type, normalize_column, normalize_result_document
    from scripts.mcp_result_evidence import append_operation, ensure_result_document
except ImportError:
    from mcp_context_adapter import infer_contract_type, normalize_column, normalize_result_document
    from mcp_result_evidence import append_operation, ensure_result_document

KIND_PRIORITY = {
    "lookup": 0,
    "section": 1,
    "detail": 2,
    "entity": 3
}
CUSTOM_COLUMN_PREFIX = "Usr"
LOOKUP_INHERITED_COLUMN_NAMES = {"Name", "Description"}
LOOKUP_DUPLICATE_TITLE_COLUMN_NAMES = {"UsrName", "UsrTitle", "UsrCaption"}
SUPPORTED_DEFAULT_VALUE_SOURCES = {"Const", "None"}
BINARY_LIKE_DATA_VALUE_TYPES = {"binary", "blob", "image", "file"}
TYPE_FALLBACK_RULES = (
    {
        "aliases": {"securetext", "encrypted", "password"},
        "fallback": "ShortText",
    },
)


class WorkflowError(RuntimeError):
    pass


def _normalize_hint_token(value):
    if not isinstance(value, str):
        return ""
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def resolve_effective_data_value_type(column):
    data_value_type_name = column.get("dataValueTypeName")
    normalized_data_value_type_name = _normalize_hint_token(data_value_type_name)
    if normalized_data_value_type_name == "emailaddress":
        return "Email"
    return data_value_type_name

def _normalize_type_name(value):
    if not isinstance(value, str):
        return ""
    normalized = re.sub(r"[^a-z0-9]+", "", value.strip().lower())
    return normalized

  
def _extract_error_text(tool_response):
    if not isinstance(tool_response, dict):
        return ""
    error = tool_response.get("error")
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message
        return json.dumps(error, ensure_ascii=True)
    return ""


def _extract_unsupported_type_name(error_text):
    if not isinstance(error_text, str) or not error_text.strip():
        return None
    patterns = (
        r"unsupported type\s+['\"](?P<type>[^'\"]+)['\"]",
        r"column type\s+['\"](?P<type>[^'\"]+)['\"]\s+is not supported",
    )
    for pattern in patterns:
        match = re.search(pattern, error_text, flags=re.IGNORECASE)
        if match:
            raw_type = match.group("type")
            if isinstance(raw_type, str) and raw_type.strip():
                return raw_type.strip()
    return None


def _resolve_type_fallback_rule(unsupported_type):
    normalized = _normalize_type_name(unsupported_type)
    if not normalized:
        return None
    for rule in TYPE_FALLBACK_RULES:
        aliases = rule.get("aliases") or set()
        if normalized in aliases:
            return rule
    return None


def _resolve_effective_masked(column):
    if not isinstance(column, dict):
        return None
    if "masked" in column and column.get("masked") is not None:
        return bool(column.get("masked"))
    return None


def _apply_type_fallback(payload, unsupported_type):
    rule = _resolve_type_fallback_rule(unsupported_type)
    if rule is None:
        return payload, False

    aliases = rule["aliases"]
    fallback_type = rule["fallback"]

    def _transform(node):
        if isinstance(node, list):
            changed = False
            transformed_items = []
            for item in node:
                transformed_item, item_changed = _transform(item)
                transformed_items.append(transformed_item)
                changed = changed or item_changed
            return transformed_items, changed

        if not isinstance(node, dict):
            return node, False

        changed = False
        transformed_dict = {}
        for key, value in node.items():
            transformed_value, value_changed = _transform(value)
            transformed_dict[key] = transformed_value
            changed = changed or value_changed

        current_type = transformed_dict.get("type")
        if _normalize_type_name(current_type) in aliases:
            transformed_dict["type"] = fallback_type
            changed = True

        return transformed_dict, changed

    return _transform(payload)


def call_tool_with_type_fallback(client, tool_name, arguments):
    first_response = client.call_tool_json(tool_name, arguments)
    if first_response.get("success") is True:
        return first_response
    error_message = _extract_error_text(first_response)
    unsupported_type = _extract_unsupported_type_name(error_message)
    if not unsupported_type:
        return first_response
    retry_arguments, changed = _apply_type_fallback(arguments, unsupported_type)
    if not changed:
        return first_response
    return client.call_tool_json(tool_name, retry_arguments)


def normalize_title(value, fallback=None):
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    if isinstance(fallback, str):
        fallback_trimmed = fallback.strip()
        if fallback_trimmed:
            return fallback_trimmed
    return None


def build_localizations(value, fallback=None):
    normalized = normalize_title(value, fallback)
    if normalized is None:
        return None
    return {
        "en-US": normalized
    }


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


class ClioStdioClient:
    def __init__(self, environment_name, clio_cmd=None):
        self.environment_name = environment_name
        self.clio_cmd = clio_cmd
        self._initialized = False

    def initialize(self):
        if self._initialized:
            return
        if self.clio_cmd and self.clio_cmd != "clio mcp-server" and not os.environ.get("CLIO_CMD"):
            os.environ["CLIO_CMD"] = self.clio_cmd
        _ensure_supported_clio_version_import()()
        self._initialized = True

    def list_tools(self):
        self.initialize()
        r = _list_mcp_tools_import()()
        return r.get("data", {}).get("tools", []) if r.get("success") else []

    def call_tool_json(self, tool_name, arguments):
        self.initialize()
        merged = dict(arguments)
        if "environment-name" not in merged:
            merged["environment-name"] = self.environment_name
        r = _call_mcp_tool_import()(tool_name, merged)
        if not r.get("success"):
            raw = r.get("raw", "unknown error")
            error_data = r.get("data") or {}
            error_msg = error_data.get("error", raw) if isinstance(error_data, dict) else raw
            return {"success": False, "error": error_msg}
        return r.get("data") if r.get("data") is not None else {"success": True}


def _call_mcp_tool_import():
    return _mcp_client_import().call_mcp_tool


def _list_mcp_tools_import():
    return _mcp_client_import().list_mcp_tools


def _ensure_supported_clio_version_import():
    return _mcp_client_import().ensure_supported_clio_version


def _mcp_client_import():
    try:
        import scripts.mcp_client as module
    except ImportError:
        import mcp_client as module
    return module


def load_mcp_client(env_path):
    payload = load_json(env_path)
    env_name = payload.get("environment")
    if not env_name:
        raise WorkflowError("environment name is missing in env file")
    clio_cmd = payload.get("mcpCommand")
    return ClioStdioClient(env_name, clio_cmd=clio_cmd)


def extract_editable_context(document):
    if not isinstance(document, dict):
        raise WorkflowError("Editable context document must be an object")
    editable_context = document.get("editableContext")
    if isinstance(editable_context, dict):
        return editable_context
    if "packages" in document and document.get("packages"):
        raw_packages = document["packages"]
        if isinstance(raw_packages, list):
            first_package = raw_packages[0]
            if isinstance(first_package, dict) and "entities" in first_package:
                return document
    contract_type = infer_contract_type(document)
    if contract_type == "short":
        normalized = normalize_result_document(document)
        if normalized.get("editableContext"):
            return normalized["editableContext"]
    raise WorkflowError("Unable to extract editable context")


def filter_mutable_columns(columns):
    filtered = []
    for raw_column in columns or []:
        column = normalize_column(raw_column)
        if column["name"].startswith(CUSTOM_COLUMN_PREFIX):
            filtered.append(column)
    return filtered


def collect_column_names(columns):
    return {
        normalize_column(raw_column)["name"]
        for raw_column in columns or []
    }


def get_entity_column_names(entity):
    source_columns = entity.get("rawColumns")
    if not isinstance(source_columns, list):
        source_columns = entity.get("columns", [])
    return collect_column_names(source_columns)


def has_column_named(columns, target_name):
    for raw_column in columns or []:
        column = normalize_column(raw_column)
        if column["name"] == target_name:
            return True
    return False


def build_entity_index(editable_context):
    index = {}
    for package in editable_context.get("packages", []):
        package_u_id = package.get("packageUId") or package.get("uId")
        package_name = package.get("name")
        for entity in package.get("entities", []):
            name = entity.get("name")
            if not name:
                raise WorkflowError("Entity name is required in editable context")
            indexed_entity = dict(entity)
            raw_columns = [normalize_column(raw_column) for raw_column in entity.get("columns", [])]
            indexed_entity["packageUId"] = package_u_id
            indexed_entity["packageName"] = package_name
            indexed_entity["caption"] = normalize_title(indexed_entity.get("caption"), name)
            indexed_entity["kind"] = indexed_entity.get("kind") or "entity"
            indexed_entity["rawColumns"] = raw_columns
            indexed_entity["hasNameColumn"] = has_column_named(raw_columns, "Name")
            indexed_entity["columns"] = filter_mutable_columns(raw_columns)
            index[(package_u_id, name)] = indexed_entity
    return index


def collect_entity_names(index):
    return {entity["name"] for entity in index.values()}


def validate_lookup_reference(column, available_names):
    reference_name = column.get("referenceSchemaName")
    if reference_name and reference_name not in available_names:
        raise WorkflowError(f"Lookup reference {reference_name} is not available in current or edited context")


def is_lookup_column(column):
    return column.get("referenceSchemaName") or column.get("dataValueTypeName") == "Lookup"


def is_binary_like_column(column):
    data_value_type_name = column.get("dataValueTypeName")
    if not isinstance(data_value_type_name, str):
        return False
    return data_value_type_name.lower() in BINARY_LIKE_DATA_VALUE_TYPES


def is_guid_string(value):
    if not isinstance(value, str):
        return False
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def validate_column_default(column):
    has_default_value_source = column.get("defaultValueSource") not in (None, "")
    has_default_value = "defaultValue" in column
    column_name = column["name"]
    if has_default_value and not has_default_value_source:
        raise WorkflowError(f"Column {column_name} requires defaultValueSource when defaultValue is specified")
    if not has_default_value_source:
        return
    default_value_source = column["defaultValueSource"]
    if default_value_source not in SUPPORTED_DEFAULT_VALUE_SOURCES:
        raise WorkflowError(
            f"Column {column_name} supports only defaultValueSource values: Const, None"
        )
    if default_value_source == "None":
        if has_default_value and column["defaultValue"] not in (None, ""):
            raise WorkflowError(f"Column {column_name} cannot set defaultValue when defaultValueSource is None")
        return
    if is_binary_like_column(column):
        raise WorkflowError(
            f"Column {column_name} with type {column['dataValueTypeName']} does not support defaultValueSource Const"
        )
    if not has_default_value:
        raise WorkflowError(f"Column {column_name} requires defaultValue when defaultValueSource is Const")
    if is_lookup_column(column) and not is_guid_string(column["defaultValue"]):
        raise WorkflowError(
            f"Lookup column {column_name} requires defaultValue as a seeded row GUID, not a caption"
        )


def build_column_map(columns):
    return {column["name"]: normalize_column(column) for column in columns}


def normalize_column_for_compare(column):
    normalized = {k: v for k, v in column.items() if k != "uId"}
    effective_masked = _resolve_effective_masked(column)
    if effective_masked is not None:
        normalized["masked"] = effective_masked
    else:
        normalized.pop("masked", None)
    return normalized


def columns_equal(left_column, right_column):
    return normalize_column_for_compare(left_column) == normalize_column_for_compare(right_column)


def validate_display_field_rules(current_entity, edited_entity, current_columns, edited_columns):
    entity_name = edited_entity["name"]
    entity_kind = edited_entity.get("kind") or current_entity.get("kind")
    current_raw_column_names = get_entity_column_names(current_entity)
    edited_raw_column_names = get_entity_column_names(edited_entity)
    inherited_conflicts = sorted(
        name for name in LOOKUP_INHERITED_COLUMN_NAMES
        if name in edited_raw_column_names and name not in current_raw_column_names
    )
    if entity_kind == "lookup" and inherited_conflicts:
        inherited_columns = ", ".join(inherited_conflicts)
        raise WorkflowError(
            f"Lookup {entity_name} inherits BaseLookup columns. Do not add inherited columns: {inherited_columns}"
        )
    duplicate_title_like_conflicts = sorted(
        name for name in LOOKUP_DUPLICATE_TITLE_COLUMN_NAMES
        if name in edited_raw_column_names and name not in current_raw_column_names
    )
    if entity_kind == "lookup" and duplicate_title_like_conflicts:
        duplicate_columns = ", ".join(duplicate_title_like_conflicts)
        raise WorkflowError(
            f"Lookup {entity_name} must use inherited Name as PrimaryDisplayColumn; do not add duplicate title-like columns: {duplicate_columns}"
        )
    is_adding_usr_name = "UsrName" in edited_columns and "UsrName" not in current_columns
    if entity_kind == "lookup" and is_adding_usr_name:
        raise WorkflowError(
            f"Lookup {entity_name} must use inherited Name as PrimaryDisplayColumn; do not add UsrName"
        )
    if (current_entity.get("hasNameColumn") or "Name" in current_columns) and is_adding_usr_name:
        raise WorkflowError(
            f"Entity {entity_name} already contains Name; do not add duplicate UsrName"
        )


def build_column_operations(current_entity, edited_entity, available_names):
    current_columns = build_column_map(current_entity.get("columns", []))
    edited_columns = build_column_map(edited_entity.get("columns", []))
    validate_display_field_rules(current_entity, edited_entity, current_columns, edited_columns)
    operations = []
    for name in sorted(edited_columns):
        column = edited_columns[name]
        validate_column_default(column)
        validate_lookup_reference(column, available_names)
        if name not in current_columns:
            operations.append({
                "operation": "addColumn",
                "column": column
            })
            continue
        current_column = current_columns[name]
        current_type = current_column.get("dataValueTypeName")
        edited_type = column.get("dataValueTypeName")
        if current_type and edited_type and current_type != edited_type:
            raise WorkflowError(f"Changing dataValueTypeName for existing column {name} is not supported")
        effective_masked = _resolve_effective_masked(column)
        if effective_masked is not None and column.get("masked") is None:
            column = dict(column)
            column["masked"] = effective_masked
        if not columns_equal(current_column, column):
            operations.append({
                "operation": "updateColumn",
                "column": column
            })
    for name in sorted(current_columns):
        if name not in edited_columns:
            operations.append({
                "operation": "removeColumn",
                "column": {
                    "name": name
                }
            })
    return operations


def build_create_columns(columns):
    converted = []
    for column in columns:
        title_localizations = build_localizations(column.get("caption"), column["name"])
        item = {
            "name": column["name"],
            "type": resolve_effective_data_value_type(column),
            "title-localizations": title_localizations
        }
        description_localizations = build_localizations(column.get("description"))
        if description_localizations is not None:
            item["description-localizations"] = description_localizations
        if column.get("referenceSchemaName"):
            item["reference-schema-name"] = column["referenceSchemaName"]
        if "isRequired" in column:
            item["required"] = bool(column["isRequired"])
        if "defaultValueSource" in column:
            item["default-value-source"] = column["defaultValueSource"]
        if "defaultValue" in column:
            item["default-value"] = column["defaultValue"]
        if column.get("masked") is not None:
            item["masked"] = bool(column["masked"])
        converted.append({key: value for key, value in item.items() if value is not None})
    return converted


def build_update_operations_payload(operations):
    payload = []
    for operation in operations:
        if operation["operation"] == "removeColumn":
            payload.append({
                "action": "remove",
                "column-name": operation["column"]["name"]
            })
            continue
        column = operation["column"]
        action = "add" if operation["operation"] == "addColumn" else "modify"
        if action == "add":
            title_localizations = build_localizations(column.get("caption"), column["name"])
        else:
            normalized_title = normalize_title(column.get("caption"))
            title_localizations = None if normalized_title == column["name"] else build_localizations(normalized_title)
        item = {
            "action": action,
            "column-name": column["name"],
            "type": resolve_effective_data_value_type(column),
        }
        if title_localizations is not None:
            item["title-localizations"] = title_localizations
        description_localizations = build_localizations(column.get("description"))
        if description_localizations is not None:
            item["description-localizations"] = description_localizations
        if column.get("referenceSchemaName"):
            item["reference-schema-name"] = column["referenceSchemaName"]
        if "isRequired" in column:
            item["required"] = bool(column["isRequired"])
        if "defaultValueSource" in column:
            item["default-value-source"] = column["defaultValueSource"]
        if "defaultValue" in column:
            item["default-value"] = column["defaultValue"]
        if column.get("masked") is not None:
            item["masked"] = bool(column["masked"])
        payload.append({key: value for key, value in item.items() if value is not None})
    return payload


def build_create_action(entity):
    tool_name = "create-lookup" if entity.get("kind") == "lookup" else "create-entity-schema"
    filtered_columns = filter_mutable_columns(entity.get("columns", []))
    validate_display_field_rules({}, entity, {}, build_column_map(filtered_columns))
    for column in filtered_columns:
        validate_column_default(column)
    arguments = {
        "package-name": entity["packageName"],
        "schema-name": entity["name"],
        "title-localizations": build_localizations(entity.get("caption"), entity["name"])
    }
    create_columns = build_create_columns(filtered_columns)
    if create_columns:
        arguments["columns"] = create_columns
    if tool_name == "create-entity-schema" and entity.get("parentSchemaName"):
        arguments["parent-schema-name"] = entity["parentSchemaName"]
    return {
        "toolName": tool_name,
        "target": entity["name"],
        "packageName": entity["packageName"],
        "arguments": arguments
    }


def validate_existing_entity_metadata(current_entity, edited_entity):
    entity_name = edited_entity["name"]
    current_caption = normalize_title(current_entity.get("caption"), entity_name)
    edited_caption = normalize_title(edited_entity.get("caption"), entity_name)
    if edited_caption != current_caption:
        raise WorkflowError(
            f"Updating caption for existing entity {entity_name} is not supported by update-entity-schema"
        )
    current_parent = current_entity.get("parentSchemaName") or "BaseEntity"
    edited_parent = edited_entity.get("parentSchemaName") or "BaseEntity"
    if edited_parent != current_parent:
        raise WorkflowError(
            f"Updating parentSchemaName for existing entity {entity_name} is not supported by update-entity-schema"
        )


def build_update_action(current_entity, edited_entity, available_names):
    if current_entity.get("packageUId") != edited_entity.get("packageUId"):
        raise WorkflowError(f"Moving entity {edited_entity['name']} between packages is not supported")
    validate_existing_entity_metadata(current_entity, edited_entity)
    operations = build_column_operations(current_entity, edited_entity, available_names)
    if not operations:
        return None
    return {
        "toolName": "update-entity-schema",
        "target": edited_entity["name"],
        "packageName": edited_entity["packageName"],
        "arguments": {
            "package-name": edited_entity["packageName"],
            "schema-name": edited_entity["name"],
            "operations": build_update_operations_payload(operations)
        }
    }


def build_new_entity_actions(new_entities):
    remaining = dict(new_entities)
    name_to_key = {entity["name"]: key for key, entity in remaining.items()}
    created_names = set()
    actions = []
    while remaining:
        ready_keys = []
        for key, entity in remaining.items():
            dependencies = set()
            for column in entity.get("columns", []):
                reference_name = column.get("referenceSchemaName")
                if reference_name in name_to_key:
                    dependencies.add(reference_name)
            if dependencies.issubset(created_names):
                ready_keys.append(key)
        if not ready_keys:
            unresolved = sorted(entity["name"] for entity in remaining.values())
            raise WorkflowError(f"Unable to resolve creation order for entities: {', '.join(unresolved)}")
        ready_keys.sort(key=lambda key: (KIND_PRIORITY.get(remaining[key].get("kind"), 99), remaining[key]["name"]))
        for key in ready_keys:
            entity = remaining.pop(key)
            created_names.add(entity["name"])
            actions.append(build_create_action(entity))
    return actions


def build_sync_plan(current_context, edited_context):
    current_index = build_entity_index(current_context)
    edited_index = build_entity_index(edited_context)
    available_names = collect_entity_names(current_index) | collect_entity_names(edited_index)
    new_entities = {}
    update_actions = []
    for key, edited_entity in sorted(edited_index.items(), key=lambda item: (item[1]["packageName"] or "", item[1]["name"])):
        if key not in current_index:
            new_entities[key] = edited_entity
            continue
        update_action = build_update_action(current_index[key], edited_entity, available_names)
        if update_action:
            update_actions.append(update_action)
    actions = build_new_entity_actions(new_entities)
    actions.extend(update_actions)
    return {
        "actions": actions
    }


def resolve_app_selector(result_document):
    app = result_document.get("app") or {}
    if app.get("app-code"):
        return {
            "app-code": app["app-code"]
        }
    if app.get("id"):
        return {
            "app-id": app["id"]
        }
    if result_document.get("appId"):
        return {
            "app-id": result_document["appId"]
        }
    if result_document.get("appCode"):
        return {
            "app-code": result_document["appCode"]
        }
    if result_document.get("packageName"):
        return {
            "app-code": result_document["packageName"]
        }
    if result_document.get("package-name"):
        return {
            "app-code": result_document["package-name"]
        }
    raise WorkflowError("Application identifier is missing in current result document")


def resolve_tool_strategy(client, sync_plan):
    tools = client.list_tools()
    tool_names = {tool["name"] for tool in tools}
    required = {"application-get-info"}
    if "schema-sync" in tool_names:
        return "schema-sync"
    required.update(action["toolName"] for action in sync_plan["actions"])
    missing = sorted(required - tool_names)
    if missing:
        raise WorkflowError(f"Required MCP tools are missing: {', '.join(missing)}")
    return "individual"


def build_refresh_failure(action, error):
    message = str(error)
    if "cannot be obtained from server metadata" in message:
        return WorkflowError(
            f"application-get-info failed after {action['toolName']} for {action['target']}: "
            f"the schema is still missing from server metadata after a successful mutation. "
            f"This usually means the MCP entity tool did not fully materialize database/runtime metadata. "
            f"Original error: {message}"
        )
    return WorkflowError(
        f"application-get-info failed after {action['toolName']} for {action['target']}: {message}"
    )


def build_schema_sync_operation(action):
    arguments = action["arguments"]
    if action["toolName"] == "create-lookup":
        operation = {
            "type": "create-lookup",
            "schema-name": arguments["schema-name"],
            "title-localizations": arguments["title-localizations"]
        }
        if arguments.get("columns"):
            operation["columns"] = arguments["columns"]
        return operation
    if action["toolName"] == "create-entity-schema":
        operation = {
            "type": "create-entity",
            "schema-name": arguments["schema-name"],
            "title-localizations": arguments["title-localizations"],
            "parent-schema-name": arguments.get("parent-schema-name") or "BaseEntity"
        }
        if arguments.get("columns"):
            operation["columns"] = arguments["columns"]
        return operation
    if action["toolName"] == "update-entity-schema":
        return {
            "type": "update-entity",
            "schema-name": arguments["schema-name"],
            "update-operations": arguments["operations"]
        }
    raise WorkflowError(f"Unsupported schema action {action['toolName']}")


def apply_sync_plan(client, result_document, edited_context, result_path):
    current_document = ensure_result_document(result_document)
    current_context = extract_editable_context(current_document)
    sync_plan = build_sync_plan(current_context, edited_context)
    if not sync_plan["actions"]:
        write_json(result_path, current_document)
        return current_document
    tool_strategy = resolve_tool_strategy(client, sync_plan)
    app_selector = resolve_app_selector(current_document)
    if tool_strategy == "schema-sync":
        actions_by_package = {}
        for action in sync_plan["actions"]:
            actions_by_package.setdefault(action["packageName"], []).append(action)
        for package_name, package_actions in actions_by_package.items():
            tool_response = call_tool_with_type_fallback(client, "schema-sync", {
                "package-name": package_name,
                "operations": [build_schema_sync_operation(action) for action in package_actions]
            })
            if tool_response.get("success") is not True:
                error_message = _extract_error_text(tool_response) or "schema-sync failed"
                raise WorkflowError(error_message)
            current_document = append_operation(
                current_document,
                "schema-sync",
                package_name,
                "success",
                response=tool_response,
                phase="schema",
                refreshed_by="application-get-info"
            )
    else:
        for action in sync_plan["actions"]:
            tool_response = call_tool_with_type_fallback(client, action["toolName"], action["arguments"])
            if tool_response.get("success") is not True:
                error_message = _extract_error_text(tool_response) or f"{action['toolName']} failed"
                raise WorkflowError(error_message)
            current_document = append_operation(
                current_document,
                action["toolName"],
                action["target"],
                "success",
                response=tool_response,
                phase="schema",
                refreshed_by="application-get-info"
            )
    try:
        refreshed_context = client.call_tool_json("application-get-info", app_selector)
    except WorkflowError as error:
        last_action = sync_plan["actions"][-1]
        raise build_refresh_failure(last_action, error)
    normalized_context = ensure_result_document(refreshed_context)
    normalized_context["schemaSync"] = list(current_document.get("schemaSync", []))
    normalized_context["operationLog"] = list(current_document.get("operationLog", []))
    normalized_context["pageEvidence"] = dict(current_document.get("pageEvidence", {}))
    normalized_context["acceptanceEvidence"] = dict(current_document.get("acceptanceEvidence", {}))
    current_document = normalized_context
    write_json(result_path, current_document)
    return current_document


def build_parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    plan_parser = subparsers.add_parser("plan")
    plan_parser.add_argument("--current-result", required=True)
    plan_parser.add_argument("--edited-context", required=True)
    plan_parser.add_argument("--output")
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--result", required=True)
    apply_parser.add_argument("--edited-context", required=True)
    apply_parser.add_argument("--env", required=True)
    return parser


def run_plan(current_result_path, edited_context_path, output_path=None):
    current_document = normalize_result_document(load_json(current_result_path))
    current_context = extract_editable_context(current_document)
    edited_context = extract_editable_context(load_json(edited_context_path))
    sync_plan = build_sync_plan(current_context, edited_context)
    if output_path:
        write_json(output_path, sync_plan)
        return str(output_path)
    return json.dumps(sync_plan, ensure_ascii=True, indent=2)


def run_apply(result_path, edited_context_path, env_path):
    result_document = normalize_result_document(load_json(result_path))
    edited_context = extract_editable_context(load_json(edited_context_path))
    client = load_mcp_client(env_path)
    client.initialize()
    apply_sync_plan(client, result_document, edited_context, result_path)
    return str(result_path)


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "plan":
        print(run_plan(args.current_result, args.edited_context, args.output))
    if args.command == "apply":
        print(run_apply(args.result, args.edited_context, args.env))


if __name__ == "__main__":
    main()
