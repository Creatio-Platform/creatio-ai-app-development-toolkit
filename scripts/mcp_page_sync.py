#!/usr/bin/env python3
import argparse
import copy
import json
import re
from pathlib import Path

try:
    from scripts.mcp_result_document import append_operation, attach_page_evidence, ensure_result_document
    from scripts.mcp_result_evidence import build_report_markdown
    from scripts.mcp_schema_sync import WorkflowError, load_mcp_client
    from scripts.page_body_edit import add_form_fields, add_list_columns, validate_body_structure
    from scripts.page_body_tools import build_page_update_arguments, verify_form_page_sync, verify_list_page_sync
except ImportError:
    from mcp_result_document import append_operation, attach_page_evidence, ensure_result_document
    from mcp_result_evidence import build_report_markdown
    from mcp_schema_sync import WorkflowError, load_mcp_client
    from page_body_edit import add_form_fields, add_list_columns, validate_body_structure
    from page_body_tools import build_page_update_arguments, verify_form_page_sync, verify_list_page_sync

PAGE_SYNC_PLAN_START = "<!-- PAGE_SYNC_PLAN_JSON_START -->"
PAGE_SYNC_PLAN_END = "<!-- PAGE_SYNC_PLAN_JSON_END -->"


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def load_text(path):
    return Path(path).read_text(encoding="utf-8")


def parse_embedded_page_sync_plan(markdown_text):
    patterns = [
        re.compile(
            rf"{re.escape(PAGE_SYNC_PLAN_START)}\s*```json\s*(.*?)\s*```\s*{re.escape(PAGE_SYNC_PLAN_END)}",
            re.DOTALL
        ),
        re.compile(
            r"### .*page-sync-plan\.json.*?```json\s*(.*?)\s*```",
            re.DOTALL | re.IGNORECASE
        )
    ]
    for pattern in patterns:
        match = pattern.search(markdown_text)
        if not match:
            continue
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError as error:
            raise WorkflowError(f"Embedded page sync plan JSON is invalid: {error}") from error
    raise WorkflowError("plan.md does not contain an embedded page-sync-plan.json block")


def load_page_sync_payload(path):
    plan_path = Path(path)
    if plan_path.suffix.lower() == ".md":
        return parse_embedded_page_sync_plan(load_text(plan_path))
    return load_json(plan_path)


def resolve_package_name(plan_payload, result_document):
    package_name = plan_payload.get("packageName")
    if isinstance(package_name, str) and package_name:
        return package_name
    editable_context = result_document.get("editableContext") or {}
    packages = editable_context.get("packages") or []
    for package in packages:
        if package.get("isPrimary") and package.get("name"):
            return package["name"]
    if result_document.get("packageName"):
        return result_document["packageName"]
    raise WorkflowError("Page sync plan requires packageName or a primary package in the result document")


def normalize_string_list(values, field_name, page_name):
    if not isinstance(values, list) or not values:
        raise WorkflowError(f"Page {page_name} requires non-empty {field_name}")
    normalized = []
    for value in values:
        if not isinstance(value, str) or not value:
            raise WorkflowError(f"Page {page_name} contains invalid {field_name} value")
        normalized.append(value)
    return normalized


def normalize_resources(resources, schema_name):
    if resources is None:
        return None
    if isinstance(resources, str):
        if resources:
            return resources
        raise WorkflowError(f"Page {schema_name} resources must not be empty")
    if isinstance(resources, dict):
        return copy.deepcopy(resources)
    raise WorkflowError(f"Page {schema_name} resources must be a JSON object string or object")


def normalize_edit_spec(items, field_name, page_name):
    if items is None:
        return None
    if not isinstance(items, list) or not items:
        raise WorkflowError(f"Page {page_name} requires non-empty {field_name} when provided")
    for item in items:
        if not isinstance(item, dict):
            raise WorkflowError(f"Page {page_name} contains invalid {field_name} item")
    return copy.deepcopy(items)


def materialize_page_body(page_kind, schema_name, body, form_fields, list_columns):
    updated_body = body
    structured_edit_applied = False
    if page_kind == "form" and form_fields:
        updated_body = add_form_fields(updated_body, form_fields)
        structured_edit_applied = True
    if page_kind == "list" and list_columns:
        updated_body = add_list_columns(updated_body, list_columns)
        structured_edit_applied = True
    if not structured_edit_applied:
        return updated_body
    validation = validate_body_structure(updated_body)
    if not validation.get("valid"):
        raise WorkflowError(f"Structured page edits produced invalid body for {schema_name}: {'; '.join(validation['errors'])}")
    return updated_body


def normalize_page_entry(page):
    if not isinstance(page, dict):
        raise WorkflowError("Page sync plan pages must be objects")
    schema_name = page.get("schemaName")
    if not isinstance(schema_name, str) or not schema_name:
        raise WorkflowError("Page sync plan page schemaName must be a non-empty string")
    page_kind = page.get("kind")
    if page_kind not in {"form", "list"}:
        raise WorkflowError(f"Page {schema_name} kind must be form or list")
    body = page.get("body")
    body_path = page.get("bodyPath") or page.get("updatedBodyPath")
    if body is None and body_path:
        body = load_text(body_path)
    if not isinstance(body, str) or not body:
        raise WorkflowError(f"Page {schema_name} requires body text or bodyPath")
    form_fields = normalize_edit_spec(page.get("formFields"), "formFields", schema_name)
    list_columns = normalize_edit_spec(page.get("listColumns"), "listColumns", schema_name)
    normalized = {
        "schemaName": schema_name,
        "kind": page_kind,
        "body": materialize_page_body(page_kind, schema_name, body, form_fields, list_columns)
    }
    resources = normalize_resources(page.get("resources"), schema_name)
    if resources is not None:
        normalized["resources"] = resources
    if form_fields:
        normalized["formFields"] = form_fields
    if list_columns:
        normalized["listColumns"] = list_columns
    if page_kind == "form":
        required_model_paths = page.get("requiredModelPaths")
        if required_model_paths is None and form_fields:
            required_model_paths = [field.get("path") for field in form_fields if isinstance(field.get("path"), str) and field.get("path")]
        if required_model_paths is not None:
            normalized["requiredModelPaths"] = normalize_string_list(required_model_paths, "requiredModelPaths", schema_name)
    if page_kind == "list":
        required_codes = page.get("requiredCodes")
        if required_codes is None and list_columns:
            required_codes = [column.get("code") for column in list_columns if isinstance(column.get("code"), str) and column.get("code")]
        if required_codes is not None:
            normalized["requiredCodes"] = normalize_string_list(required_codes, "requiredCodes", schema_name)
    return normalized


def normalize_page_sync_plan(plan_payload, result_document):
    if not isinstance(plan_payload, dict):
        raise WorkflowError("Page sync plan must be an object")
    pages = plan_payload.get("pages")
    if not isinstance(pages, list) or not pages:
        raise WorkflowError("Page sync plan requires a non-empty pages array")
    normalized_pages = []
    seen_page_names = set()
    for raw_page in pages:
        page = normalize_page_entry(raw_page)
        if page["schemaName"] in seen_page_names:
            raise WorkflowError(f"Duplicate page sync entry for {page['schemaName']}")
        seen_page_names.add(page["schemaName"])
        normalized_pages.append(page)
    normalized = {
        "packageName": resolve_package_name(plan_payload, result_document),
        "pages": normalized_pages
    }
    environment_name = plan_payload.get("environmentName") or plan_payload.get("environment-name")
    if isinstance(environment_name, str) and environment_name:
        normalized["environmentName"] = environment_name
    return normalized


def ensure_required_tools(client):
    tools = client.list_tools()
    tool_names = {tool["name"] for tool in tools}
    if "sync-pages" not in tool_names:
        raise WorkflowError("Required MCP page tools are missing: sync-pages")


def append_operation_and_persist(current_document, result_path, tool_name, target, status, response=None):
    updated = append_operation(current_document, tool_name, target, status, response=response, phase="page")
    write_json(result_path, updated)
    return updated


def build_page_sync_entry(page):
    entry = {
        "schema-name": page["schemaName"],
        "body": page["body"]
    }
    resources = page.get("resources")
    if resources is not None:
        entry["resources"] = json.dumps(resources, ensure_ascii=True) if isinstance(resources, dict) else resources
    return entry


def get_page_result_name(page_result):
    if not isinstance(page_result, dict):
        return None
    return page_result.get("schemaName") or page_result.get("schema-name")


def build_page_evidence_response(schema_name, page_result):
    response = {"schemaName": schema_name}
    if not isinstance(page_result, dict):
        return response
    for key in ("schema-name", "schemaName", "body-length", "bodyLength", "resources-registered", "resourcesRegistered", "success", "error"):
        if key in page_result:
            response[key] = copy.deepcopy(page_result[key])
    page_metadata = page_result.get("page")
    if isinstance(page_metadata, dict):
        response["page"] = copy.deepcopy(page_metadata)
        if page_metadata.get("schemaName"):
            response["schemaName"] = page_metadata["schemaName"]
        if page_metadata.get("schemaUId"):
            response["uId"] = page_metadata["schemaUId"]
        if page_metadata.get("packageName"):
            response["packageName"] = page_metadata["packageName"]
        if page_metadata.get("packageUId"):
            response["packageUId"] = page_metadata["packageUId"]
        if page_metadata.get("parentSchemaName"):
            response["parentSchemaName"] = page_metadata["parentSchemaName"]
    return response


def build_page_verification(page_result):
    success = bool(page_result.get("success")) if isinstance(page_result, dict) else False
    verified_body = None
    if isinstance(page_result, dict):
        if isinstance(page_result.get("verified-body"), str) and page_result.get("verified-body"):
            verified_body = page_result["verified-body"]
        elif isinstance(page_result.get("verifiedBody"), str) and page_result.get("verifiedBody"):
            verified_body = page_result["verifiedBody"]
    return {
        "implemented": success,
        "machineChecked": success and bool(verified_body),
        "manualChecked": False
    }


def sync_pages(client, current_document, result_path, pages, environment_name=None):
    sync_args = {
        "pages": [build_page_sync_entry(page) for page in pages],
        "validate": True,
        "verify": True
    }
    if environment_name:
        sync_args["environment-name"] = environment_name
    sync_response = client.call_tool_json("sync-pages", sync_args)
    operation_status = "success" if sync_response.get("success") is True else "failed"
    current_document = append_operation_and_persist(current_document, result_path, "sync-pages", "batch", operation_status, response=sync_response)
    page_results = sync_response.get("pages")
    if not isinstance(page_results, list):
        raise WorkflowError("sync-pages response must contain pages array")
    result_by_name = {}
    for page_result in page_results:
        page_name = get_page_result_name(page_result)
        if page_name:
            result_by_name[page_name] = page_result
    failures = []
    for page in pages:
        schema_name = page["schemaName"]
        page_result = result_by_name.get(schema_name)
        if page_result is None:
            page_result = {
                "schemaName": schema_name,
                "success": False,
                "error": f"sync-pages response is missing result for {schema_name}"
            }
        verification = build_page_verification(page_result)
        evidence_response = build_page_evidence_response(schema_name, page_result)
        current_document = attach_page_evidence(current_document, schema_name, verification, response=evidence_response)
        write_json(result_path, current_document)
        if not verification.get("implemented") or not verification.get("machineChecked"):
            error_text = page_result.get("error") if isinstance(page_result, dict) else None
            failures.append(f"Page sync verification failed for {schema_name}: {error_text or 'missing verified-body'}")
    if failures:
        raise WorkflowError(failures[0])
    return current_document


def apply_page_sync_plan(client, result_document, page_plan, result_path, report_path=None):
    current_document = ensure_result_document(result_document)
    normalized_plan = normalize_page_sync_plan(page_plan, current_document)
    ensure_required_tools(client)
    current_document = sync_pages(
        client,
        current_document,
        result_path,
        normalized_plan["pages"],
        environment_name=normalized_plan.get("environmentName")
    )
    if report_path:
        Path(report_path).write_text(build_report_markdown(current_document), encoding="utf-8")
    return current_document


def build_parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build-plan")
    build_parser.add_argument("--plan-md", required=True)
    build_parser.add_argument("--output", required=True)
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--result", required=True)
    apply_parser.add_argument("--plan", required=True)
    apply_parser.add_argument("--env", required=True)
    apply_parser.add_argument("--report")
    return parser


def run_build_plan(plan_md_path, output_path):
    page_plan = parse_embedded_page_sync_plan(load_text(plan_md_path))
    write_json(output_path, page_plan)
    return str(output_path)


def run_apply(result_path, plan_path, env_path, report_path=None):
    result_document = ensure_result_document(load_json(result_path))
    page_plan = load_page_sync_payload(plan_path)
    client = load_mcp_client(env_path)
    client.initialize()
    apply_page_sync_plan(client, result_document, page_plan, result_path, report_path=report_path)
    return str(result_path)


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "build-plan":
        print(run_build_plan(args.plan_md, args.output))
    if args.command == "apply":
        print(run_apply(args.result, args.plan, args.env, report_path=args.report))


if __name__ == "__main__":
    main()
