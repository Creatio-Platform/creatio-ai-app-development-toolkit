#!/usr/bin/env python3
import argparse
import copy
import json
from pathlib import Path

try:
    from scripts.mcp_context_adapter import normalize_result_document
except ImportError:
    from mcp_context_adapter import normalize_result_document


class EvidenceError(ValueError):
    pass


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def summarize_columns(columns):
    if isinstance(columns, dict):
        column_names = [name for name in columns]
    elif isinstance(columns, list):
        column_names = [column.get("name") for column in columns if isinstance(column, dict) and column.get("name")]
    else:
        return []
    return sorted(set(column_names))


def summarize_response(response):
    if not isinstance(response, dict):
        raise EvidenceError("Response summary requires an object")
    summary = {}
    field_map = {
        "success": ("success",),
        "packageUId": ("packageUId", "package-u-id"),
        "packageName": ("packageName", "package-name"),
        "schemaName": ("schemaName", "schema-name", "name"),
        "bodyLength": ("bodyLength", "body-length"),
        "dryRun": ("dryRun", "dry-run"),
        "count": ("count",),
        "uId": ("uId", "u-id"),
        "parentSchemaName": ("parentSchemaName", "parent-schema-name"),
    }
    for target_key, source_keys in field_map.items():
        for source_key in source_keys:
            if source_key in response:
                summary[target_key] = copy.deepcopy(response[source_key])
                break
    raw_body = response.get("raw", {}).get("body") if isinstance(response.get("raw"), dict) else response.get("body")
    if "bodyLength" not in summary and isinstance(raw_body, str):
        summary["bodyLength"] = len(raw_body)
    entity = response.get("entity")
    if isinstance(entity, dict):
        entity_summary = {}
        for key in ("name", "uId", "caption", "parentSchemaName"):
            if key in entity:
                entity_summary[key] = copy.deepcopy(entity[key])
        columns = summarize_columns(entity.get("columns"))
        if columns:
            entity_summary["columns"] = columns
        if entity_summary:
            summary["entity"] = entity_summary
    pages = response.get("pages")
    if isinstance(pages, list):
        summary["pages"] = [
            {
                key: copy.deepcopy(page[key])
                for key in ("name", "uId", "packageName")
                if isinstance(page, dict) and key in page
            }
            for page in pages
            if isinstance(page, dict)
        ]
    error = response.get("error")
    if isinstance(error, dict) and error:
        summary["error"] = copy.deepcopy(error)
    return summary


def ensure_result_document(result_document):
    normalized = normalize_result_document(result_document)
    operation_log = normalized.get("operationLog")
    page_evidence = normalized.get("pageEvidence")
    acceptance_evidence = normalized.get("acceptanceEvidence")
    normalized["operationLog"] = list(operation_log) if isinstance(operation_log, list) else []
    normalized["pageEvidence"] = copy.deepcopy(page_evidence) if isinstance(page_evidence, dict) else {}
    normalized["acceptanceEvidence"] = copy.deepcopy(acceptance_evidence) if isinstance(acceptance_evidence, dict) else {}
    return normalized


def append_operation(result_document, tool_name, target, status, response=None, phase=None, refreshed_by=None):
    document = ensure_result_document(result_document)
    entry = {
        "tool": tool_name,
        "toolName": tool_name,
        "target": target,
        "status": status
    }
    if phase:
        entry["phase"] = phase
    if refreshed_by:
        entry["refreshedBy"] = refreshed_by
    if response is not None:
        entry["evidence"] = summarize_response(response)
    document["schemaSync"].append(copy.deepcopy(entry))
    document["operationLog"].append(entry)
    return document


def derive_page_status(verification):
    implemented = bool(verification.get("implemented", True))
    machine_checked = bool(verification.get("machineChecked"))
    manual_checked = bool(verification.get("manualChecked"))
    return {
        "implemented": implemented,
        "machineChecked": machine_checked,
        "manualCheckPending": not manual_checked
    }


def attach_page_evidence(result_document, page_name, verification, response=None):
    if not page_name:
        raise EvidenceError("page_name is required")
    if not isinstance(verification, dict):
        raise EvidenceError("verification must be an object")
    document = ensure_result_document(result_document)
    page_entry = copy.deepcopy(document["pageEvidence"].get(page_name, {}))
    if response is not None:
        response_summary = summarize_response(response)
        for key in ("schemaName", "bodyLength", "success", "uId", "parentSchemaName", "packageName"):
            if key in response_summary:
                page_entry[key] = response_summary[key]
    page_entry["verification"] = copy.deepcopy(verification)
    page_entry["status"] = derive_page_status(verification)
    document["pageEvidence"][page_name] = page_entry
    return document


def status_label(status):
    if status.get("machineChecked"):
        return "machineChecked"
    if status.get("implemented"):
        return "implemented"
    return "notImplemented"


def build_report_markdown(result_document):
    document = ensure_result_document(result_document)
    title = document.get("appTitle") or document.get("appName") or document.get("app-name") or document.get("packageName") or document.get("package-name") or "Application"
    lines = [f"# {title} — MCP Application Report", "", "## Summary", ""]
    lines.append(f"- Success: {'yes' if document.get('success') else 'no'}")
    package_u_id = document.get("packageUId") or document.get("package-u-id")
    package_name = document.get("packageName") or document.get("package-name")
    if package_u_id:
        lines.append(f"- Package: {package_name} ({package_u_id})")
    if document.get("operationLog"):
        lines.append(f"- Operations recorded: {len(document['operationLog'])}")
    if document.get("pageEvidence"):
        page_states = []
        for page_name, page_entry in sorted(document["pageEvidence"].items()):
            page_states.append(f"{page_name}={status_label(page_entry.get('status', {}))}")
        lines.append(f"- Page evidence: {', '.join(page_states)}")
    lines.extend(["", "## Operations", ""])
    if document.get("operationLog"):
        for entry in document["operationLog"]:
            label = f"- {entry['tool']} -> {entry['target']}: {entry['status']}"
            if entry.get("phase"):
                label += f" ({entry['phase']})"
            lines.append(label)
    else:
        lines.append("- No operations recorded")
    lines.extend(["", "## Page Evidence", ""])
    if document.get("pageEvidence"):
        for page_name, page_entry in sorted(document["pageEvidence"].items()):
            status = page_entry.get("status", {})
            verification = page_entry.get("verification", {})
            summary = f"- {page_name}: implemented={str(bool(status.get('implemented'))).lower()}, machineChecked={str(bool(status.get('machineChecked'))).lower()}, manualCheckPending={str(bool(status.get('manualCheckPending'))).lower()}"
            checks = sorted(key for key, value in verification.items() if key not in {"implemented", "machineChecked", "manualChecked"} and value is True)
            if checks:
                summary += f"; checks={','.join(checks)}"
            lines.append(summary)
    else:
        lines.append("- No page evidence recorded")
    lines.extend(["", "## Manual Verification", "", "- Pending unless explicit manual evidence is attached"])
    return "\n".join(lines) + "\n"


def build_parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    report_parser = subparsers.add_parser("report")
    report_parser.add_argument("result_path")
    report_parser.add_argument("output_path")
    operation_parser = subparsers.add_parser("add-operation")
    operation_parser.add_argument("result_path")
    operation_parser.add_argument("tool_name")
    operation_parser.add_argument("target")
    operation_parser.add_argument("status")
    operation_parser.add_argument("--phase")
    operation_parser.add_argument("--refreshed-by")
    operation_parser.add_argument("--response")
    page_parser = subparsers.add_parser("add-page")
    page_parser.add_argument("result_path")
    page_parser.add_argument("page_name")
    page_parser.add_argument("verification_path")
    page_parser.add_argument("--response")
    return parser


def run_report(result_path, output_path):
    report = build_report_markdown(load_json(result_path))
    Path(output_path).write_text(report, encoding="utf-8")
    return output_path


def run_add_operation(result_path, tool_name, target, status, phase=None, refreshed_by=None, response_path=None):
    document = load_json(result_path)
    response = load_json(response_path) if response_path else None
    updated = append_operation(document, tool_name, target, status, response=response, phase=phase, refreshed_by=refreshed_by)
    write_json(result_path, updated)
    return result_path


def run_add_page(result_path, page_name, verification_path, response_path=None):
    document = load_json(result_path)
    verification = load_json(verification_path)
    response = load_json(response_path) if response_path else None
    updated = attach_page_evidence(document, page_name, verification, response=response)
    write_json(result_path, updated)
    return result_path


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "report":
        print(run_report(args.result_path, args.output_path))
    if args.command == "add-operation":
        print(run_add_operation(args.result_path, args.tool_name, args.target, args.status, phase=args.phase, refreshed_by=args.refreshed_by, response_path=args.response))
    if args.command == "add-page":
        print(run_add_page(args.result_path, args.page_name, args.verification_path, response_path=args.response))


if __name__ == "__main__":
    main()
