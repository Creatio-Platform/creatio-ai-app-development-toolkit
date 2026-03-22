#!/usr/bin/env python3
import argparse
import copy
import json
import re
from pathlib import Path

try:
    from scripts.mcp_result_evidence import append_operation, attach_page_evidence, build_report_markdown, ensure_result_document
    from scripts.mcp_schema_sync import ClioStdioClient, McpHttpClient, WorkflowError, load_mcp_client, load_mcp_url
    from scripts.page_body_tools import build_page_update_arguments, verify_form_page_sync, verify_list_page_sync
except ImportError:
    from mcp_result_evidence import append_operation, attach_page_evidence, build_report_markdown, ensure_result_document
    from mcp_schema_sync import ClioStdioClient, McpHttpClient, WorkflowError, load_mcp_client, load_mcp_url
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
    normalized = {
        "schemaName": schema_name,
        "kind": page_kind,
        "body": body
    }
    if page_kind == "form":
        normalized["requiredModelPaths"] = normalize_string_list(page.get("requiredModelPaths"), "requiredModelPaths", schema_name)
    if page_kind == "list":
        normalized["requiredCodes"] = normalize_string_list(page.get("requiredCodes"), "requiredCodes", schema_name)
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
    return {
        "packageName": resolve_package_name(plan_payload, result_document),
        "pages": normalized_pages
    }


def ensure_required_tools(client):
    tools = client.list_tools()
    tool_names = {tool["name"] for tool in tools}
    required = {"page.list", "page.get", "page.update"}
    missing = sorted(required - tool_names)
    if missing:
        raise WorkflowError(f"Required MCP page tools are missing: {', '.join(missing)}")


def ensure_success(tool_name, response):
    if response.get("success") is False:
        error = response.get("error") or {}
        raise WorkflowError(error.get("message") or f"{tool_name} failed")
    return response


def append_operation_and_persist(current_document, result_path, tool_name, target, status, response=None):
    updated = append_operation(current_document, tool_name, target, status, response=response, phase="page")
    write_json(result_path, updated)
    return updated


def build_page_index(page_list_response):
    pages = page_list_response.get("pages")
    if not isinstance(pages, list):
        raise WorkflowError("page.list response must contain pages array")
    index = {}
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_name = page.get("name") or page.get("schemaName")
        if page_name:
            index[page_name] = copy.deepcopy(page)
    return index


def get_page_body(page_response, schema_name):
    body = page_response.get("body")
    if not isinstance(body, str) or not body:
        raise WorkflowError(f"page.get for {schema_name} did not return body")
    return body


def verify_page_sync(page, original_body, updated_body):
    if page["kind"] == "form":
        return verify_form_page_sync(original_body, updated_body, page["requiredModelPaths"])
    return verify_list_page_sync(updated_body, page["requiredCodes"])


def merge_page_metadata(discovered_page, page_response):
    merged = copy.deepcopy(discovered_page)
    for key, value in page_response.items():
        if key == "body":
            continue
        merged[key] = copy.deepcopy(value)
    if "schemaName" not in merged and discovered_page.get("name"):
        merged["schemaName"] = discovered_page["name"]
    if "bodyLength" not in merged and isinstance(page_response.get("body"), str):
        merged["bodyLength"] = len(page_response["body"])
    return merged


def sync_page(client, current_document, result_path, discovered_pages, page):
    schema_name = page["schemaName"]
    discovered_page = discovered_pages.get(schema_name)
    if not discovered_page:
        raise WorkflowError(f"page.list did not return required page {schema_name}")
    original_response = ensure_success("page.get", client.call_tool_json("page.get", {"schemaName": schema_name}))
    current_document = append_operation_and_persist(current_document, result_path, "page.get", schema_name, "success", response=original_response)
    original_body = get_page_body(original_response, schema_name)
    dry_run_args = build_page_update_arguments(schema_name, page["body"], dry_run=True)
    dry_run_response = ensure_success("page.update", client.call_tool_json("page.update", dry_run_args))
    current_document = append_operation_and_persist(current_document, result_path, "page.update", schema_name, "validated", response=dry_run_response)
    save_args = build_page_update_arguments(schema_name, page["body"], dry_run=False)
    save_response = ensure_success("page.update", client.call_tool_json("page.update", save_args))
    current_document = append_operation_and_persist(current_document, result_path, "page.update", schema_name, "success", response=save_response)
    verify_response = ensure_success("page.get", client.call_tool_json("page.get", {"schemaName": schema_name}))
    current_document = append_operation_and_persist(current_document, result_path, "page.get", f"{schema_name}#verify", "success", response=verify_response)
    verification = verify_page_sync(page, original_body, get_page_body(verify_response, schema_name))
    evidence_response = merge_page_metadata(discovered_page, verify_response)
    current_document = attach_page_evidence(current_document, schema_name, verification, response=evidence_response)
    write_json(result_path, current_document)
    if not verification.get("implemented") or not verification.get("machineChecked"):
        raise WorkflowError(f"Page sync verification failed for {schema_name}")
    return current_document


def apply_page_sync_plan(client, result_document, page_plan, result_path, report_path=None):
    current_document = ensure_result_document(result_document)
    normalized_plan = normalize_page_sync_plan(page_plan, current_document)
    ensure_required_tools(client)
    page_list_response = ensure_success("page.list", client.call_tool_json("page.list", {"packageName": normalized_plan["packageName"]}))
    current_document = append_operation_and_persist(current_document, result_path, "page.list", normalized_plan["packageName"], "success", response=page_list_response)
    discovered_pages = build_page_index(page_list_response)
    for page in normalized_plan["pages"]:
        current_document = sync_page(client, current_document, result_path, discovered_pages, page)
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
