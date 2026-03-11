#!/usr/bin/env python3
import argparse
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

try:
    from scripts.mcp_context_adapter import infer_contract_type, normalize_column, normalize_result_document
except ImportError:
    from mcp_context_adapter import infer_contract_type, normalize_column, normalize_result_document

KIND_PRIORITY = {
    "lookup": 0,
    "section": 1,
    "detail": 2,
    "entity": 3
}
CUSTOM_COLUMN_PREFIX = "Usr"
SUPPORTED_DEFAULT_VALUE_SOURCES = {"Const", "None"}


class WorkflowError(RuntimeError):
    pass


class McpHttpClient:
    def __init__(self, mcp_url, timeout=30, retries=3, retry_delay_seconds=10):
        self.mcp_url = mcp_url
        self.timeout = timeout
        self.retries = retries
        self.retry_delay_seconds = retry_delay_seconds
        self.session_id = None
        self.request_id = 0
        self.base_url = self._resolve_base_url(mcp_url)
        self.auth_login = os.getenv("CREATIO_LOGIN")
        self.auth_password = os.getenv("CREATIO_PASSWORD")
        self.cookie_jar = None
        self.opener = urllib.request.build_opener()
        self.csrf_token = None

    @staticmethod
    def _resolve_base_url(mcp_url):
        parts = urllib.parse.urlsplit(mcp_url)
        return f"{parts.scheme}://{parts.netloc}"

    def authenticate(self):
        if not self.auth_login or not self.auth_password or self.csrf_token:
            return
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        body = json.dumps({
            "UserName": self.auth_login,
            "UserPassword": self.auth_password
        }).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/ServiceModel/AuthService.svc/Login",
            data=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json"
            },
            method="POST"
        )
        with self.opener.open(request, timeout=self.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("Code") not in (0, None):
            raise WorkflowError(payload.get("Message") or "Creatio login failed")
        preferred_cookie_names = ["BPMCSRF", "CRT_CSRF", "CsrfToken"]
        cookies_by_name = {cookie.name: cookie.value for cookie in self.cookie_jar}
        for cookie_name in preferred_cookie_names:
            if cookies_by_name.get(cookie_name):
                self.csrf_token = cookies_by_name[cookie_name]
                break
        if not self.csrf_token:
            raise WorkflowError("Creatio login did not return BPMCSRF cookie")

    def initialize(self):
        self.authenticate()
        payload, headers, _ = self.request_rpc("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {
                "name": "ai-driven-app-creation",
                "version": "1.0"
            }
        }, use_session=False)
        self.session_id = headers.get("Mcp-Session-Id") or headers.get("mcp-session-id")
        if not self.session_id:
            raise WorkflowError("MCP initialize did not return Mcp-Session-Id header")
        return payload

    def list_tools(self):
        payload, _, _ = self.request_rpc("tools/list", {})
        return payload.get("result", {}).get("tools", [])

    def call_tool_json(self, tool_name, arguments):
        payload, _, _ = self.request_rpc("tools/call", {
            "name": tool_name,
            "arguments": arguments
        })
        content = payload.get("result", {}).get("content", [])
        for item in content:
            text = item.get("text")
            if isinstance(text, str):
                return parse_tool_text(text)
        raise WorkflowError(f"Tool {tool_name} did not return text content")

    def request_rpc(self, method, params, use_session=True):
        last_error = None
        for attempt in range(self.retries):
            try:
                return self.request_rpc_once(method, params, use_session)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
                last_error = error
                if attempt + 1 == self.retries:
                    break
                time.sleep(self.retry_delay_seconds)
        raise WorkflowError(str(last_error))

    def request_rpc_once(self, method, params, use_session=True):
        self.request_id += 1
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
            "params": params
        }).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        }
        if self.csrf_token:
            headers["BPMCSRF"] = self.csrf_token
        if use_session and self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        request = urllib.request.Request(self.mcp_url, data=body, headers=headers, method="POST")
        with self.opener.open(request, timeout=self.timeout) as response:
            raw_text = response.read().decode("utf-8")
            payload = parse_rpc_payload(raw_text)
            if "error" in payload:
                error_message = payload["error"].get("message") or str(payload["error"])
                raise WorkflowError(error_message)
            return payload, dict(response.headers.items()), raw_text


def parse_rpc_payload(raw_text):
    stripped = raw_text.strip()
    if not stripped:
        raise WorkflowError("Empty MCP response")
    if stripped.startswith("{"):
        return json.loads(stripped)
    payloads = []
    for line in stripped.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload:
                payloads.append(payload)
    for payload in reversed(payloads):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            continue
    raise WorkflowError("Unable to parse MCP event stream response")


def parse_tool_text(text):
    stripped = text.strip()
    if stripped.startswith("ERROR:"):
        raise WorkflowError(stripped)
    if stripped.startswith("{") or stripped.startswith("["):
        return json.loads(stripped)
    raise WorkflowError("Tool response text is not valid JSON")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def load_mcp_url(env_path):
    payload = load_json(env_path)
    mcp_url = payload.get("mcpUrl")
    if not mcp_url:
        raise WorkflowError("mcpUrl is missing in environment file")
    return mcp_url


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
            indexed_entity["packageUId"] = package_u_id
            indexed_entity["packageName"] = package_name
            indexed_entity["caption"] = indexed_entity.get("caption") or name
            indexed_entity["kind"] = indexed_entity.get("kind") or "entity"
            indexed_entity["hasNameColumn"] = has_column_named(indexed_entity.get("columns", []), "Name")
            indexed_entity["columns"] = filter_mutable_columns(indexed_entity.get("columns", []))
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
    if not has_default_value:
        raise WorkflowError(f"Column {column_name} requires defaultValue when defaultValueSource is Const")
    if is_lookup_column(column) and not is_guid_string(column["defaultValue"]):
        raise WorkflowError(
            f"Lookup column {column_name} requires defaultValue as a seeded row GUID, not a caption"
        )


def build_column_map(columns):
    return {column["name"]: normalize_column(column) for column in columns}


def columns_equal(left_column, right_column):
    skip = {"uId"}
    return {k: v for k, v in left_column.items() if k not in skip} == \
           {k: v for k, v in right_column.items() if k not in skip}


def validate_display_field_rules(current_entity, edited_entity, current_columns, edited_columns):
    entity_name = edited_entity["name"]
    entity_kind = edited_entity.get("kind") or current_entity.get("kind")
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


def build_create_action(entity):
    tool_name = "entity.create_lookup" if entity.get("kind") == "lookup" else "entity.create"
    filtered_columns = filter_mutable_columns(entity.get("columns", []))
    for column in filtered_columns:
        validate_column_default(column)
    if tool_name == "entity.create_lookup" and any(column["name"] == "UsrName" for column in filtered_columns):
        raise WorkflowError(
            f"Lookup {entity['name']} must use inherited Name as PrimaryDisplayColumn; do not add UsrName"
        )
    create_columns = json.dumps(filtered_columns, ensure_ascii=True, separators=(",", ":"))
    arguments = {
        "packageUId": entity["packageUId"],
        "name": entity["name"],
        "caption": entity.get("caption") or entity["name"],
        "columnsJson": create_columns
    }
    if tool_name == "entity.create":
        arguments["parentSchemaName"] = entity.get("parentSchemaName") or "BaseEntity"
    return {
        "toolName": tool_name,
        "target": entity["name"],
        "packageUId": entity["packageUId"],
        "arguments": arguments
    }


def build_update_action(current_entity, edited_entity, available_names):
    if current_entity.get("packageUId") != edited_entity.get("packageUId"):
        raise WorkflowError(f"Moving entity {edited_entity['name']} between packages is not supported")
    entity_u_id = edited_entity.get("entityUId") or current_entity.get("entityUId")
    if not entity_u_id:
        raise WorkflowError(f"Existing entity {edited_entity['name']} does not have entityUId")
    operations = build_column_operations(current_entity, edited_entity, available_names)
    if not operations and edited_entity.get("caption") == current_entity.get("caption") and (edited_entity.get("parentSchemaName") or "BaseEntity") == (current_entity.get("parentSchemaName") or "BaseEntity"):
        return None
    return {
        "toolName": "entity.update",
        "target": edited_entity["name"],
        "packageUId": edited_entity["packageUId"],
        "arguments": {
            "entityUId": entity_u_id,
            "packageUId": edited_entity["packageUId"],
            "schemaName": edited_entity["name"],
            "caption": edited_entity.get("caption") or edited_entity["name"],
            "operationsJson": json.dumps(operations, ensure_ascii=True, separators=(",", ":"))
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
    if app.get("id"):
        return {
            "appId": app["id"]
        }
    if app.get("code"):
        return {
            "appCode": app["code"]
        }
    if result_document.get("appId"):
        return {
            "appId": result_document["appId"]
        }
    if result_document.get("appCode"):
        return {
            "appCode": result_document["appCode"]
        }
    if result_document.get("packageName"):
        return {
            "appCode": result_document["packageName"]
        }
    raise WorkflowError("Application identifier is missing in current result document")


def ensure_required_tools(client):
    tools = client.list_tools()
    tool_names = {tool["name"] for tool in tools}
    required = {
        "application.get_info",
        "entity.create",
        "entity.create_lookup",
        "entity.update"
    }
    missing = sorted(required - tool_names)
    if missing:
        raise WorkflowError(f"Required MCP tools are missing: {', '.join(missing)}")


def build_refresh_failure(action, error):
    message = str(error)
    if "cannot be obtained from server metadata" in message:
        return WorkflowError(
            f"application.get_info failed after {action['toolName']} for {action['target']}: "
            f"the schema is still missing from server metadata after a successful mutation. "
            f"This usually means the MCP entity tool did not fully materialize database/runtime metadata. "
            f"Original error: {message}"
        )
    return WorkflowError(
        f"application.get_info failed after {action['toolName']} for {action['target']}: {message}"
    )


def apply_sync_plan(client, result_document, edited_context, result_path):
    current_document = normalize_result_document(result_document)
    current_context = extract_editable_context(current_document)
    sync_plan = build_sync_plan(current_context, edited_context)
    schema_sync = list(current_document.get("schemaSync", []))
    ensure_required_tools(client)
    app_selector = resolve_app_selector(current_document)
    if not sync_plan["actions"]:
        write_json(result_path, current_document)
        return current_document
    for action in sync_plan["actions"]:
        tool_response = client.call_tool_json(action["toolName"], action["arguments"])
        if tool_response.get("success") is not True:
            error = tool_response.get("error") or {}
            raise WorkflowError(error.get("message") or f"{action['toolName']} failed")
        schema_sync.append({
            "toolName": action["toolName"],
            "target": action["target"],
            "packageUId": action["packageUId"],
            "status": "success"
        })
        try:
            refreshed_context = client.call_tool_json("application.get_info", app_selector)
        except WorkflowError as error:
            raise build_refresh_failure(action, error)
        normalized_context = normalize_result_document(refreshed_context)
        normalized_context["schemaSync"] = list(schema_sync)
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
    client = McpHttpClient(load_mcp_url(env_path))
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
