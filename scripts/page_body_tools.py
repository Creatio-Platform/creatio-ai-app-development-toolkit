#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path


class PageBodyError(ValueError):
    pass


def load_text(path):
    return Path(path).read_text(encoding="utf-8")


def strip_trailing_commas(text):
    current = text
    while True:
        updated = re.sub(r",(\s*[}\]])", r"\1", current)
        if updated == current:
            return updated
        current = updated


def extract_marker_text(body, marker):
    token = f"/**{marker}*/"
    start = body.find(token)
    if start < 0:
        raise PageBodyError(f"Marker {marker} not found")
    start += len(token)
    end = body.find(token, start)
    if end < 0:
        raise PageBodyError(f"Marker {marker} end not found")
    return body[start:end].strip()


def parse_marker_json(body, marker):
    marker_text = extract_marker_text(body, marker)
    cleaned = strip_trailing_commas(marker_text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise PageBodyError(f"Marker {marker} is not valid tolerant JSON: {error}") from error


def parse_first_available_marker(body, markers):
    errors = []
    for marker in markers:
        try:
            return marker, parse_marker_json(body, marker)
        except PageBodyError as error:
            errors.append(str(error))
    raise PageBodyError("; ".join(errors))


def extract_view_config_diff(body):
    return parse_marker_json(body, "SCHEMA_VIEW_CONFIG_DIFF")


def extract_attribute_paths(body):
    marker, payload = parse_first_available_marker(body, ["SCHEMA_VIEW_MODEL_CONFIG_DIFF", "SCHEMA_VIEW_MODEL_CONFIG"])
    if marker == "SCHEMA_VIEW_MODEL_CONFIG":
        attributes = payload.get("attributes", {})
        return {
            name: config.get("modelConfig", {}).get("path")
            for name, config in attributes.items()
            if isinstance(config, dict) and isinstance(config.get("modelConfig"), dict) and config["modelConfig"].get("path")
        }
    attribute_paths = {}
    for operation in payload:
        if not isinstance(operation, dict):
            continue
        path = operation.get("path") or []
        if "attributes" not in path:
            continue
        values = operation.get("values") or {}
        if not isinstance(values, dict):
            continue
        for name, config in values.items():
            if isinstance(config, dict) and isinstance(config.get("modelConfig"), dict) and config["modelConfig"].get("path"):
                attribute_paths[name] = config["modelConfig"]["path"]
    return attribute_paths


def extract_combobox_search_actions(body):
    actions = []
    for node in extract_view_config_diff(body):
        if not isinstance(node, dict):
            continue
        values = node.get("values") or {}
        if values.get("type") != "crt.ComboboxSearchTextAction":
            continue
        actions.append({
            "name": node.get("name"),
            "parentName": node.get("parentName")
        })
    return actions


def extract_list_columns(body):
    for node in extract_view_config_diff(body):
        if not isinstance(node, dict):
            continue
        values = node.get("values") or {}
        columns = values.get("columns")
        if isinstance(columns, list):
            return columns
    return []


def build_page_update_arguments(schema_name, body, dry_run=False):
    arguments = {
        "schemaName": schema_name,
        "body": body
    }
    if dry_run:
        arguments["dryRun"] = "true"
    return arguments


def verify_form_page_sync(original_body, updated_body, required_model_paths):
    original_actions = {
        (item.get("name"), item.get("parentName"))
        for item in extract_combobox_search_actions(original_body)
    }
    updated_actions = extract_combobox_search_actions(updated_body)
    introduced_actions = [
        item for item in updated_actions
        if (item.get("name"), item.get("parentName")) not in original_actions
    ]
    model_paths = set(extract_attribute_paths(updated_body).values())
    missing_paths = sorted(path for path in required_model_paths if path not in model_paths)
    machine_checked = not missing_paths and not introduced_actions
    return {
        "implemented": not missing_paths,
        "machineChecked": machine_checked,
        "manualChecked": False,
        "requiredModelPathsPresent": not missing_paths,
        "missingModelPaths": missing_paths,
        "forbiddenComboboxActionsIntroduced": bool(introduced_actions),
        "introducedComboboxActions": [item.get("name") for item in introduced_actions if item.get("name")]
    }


def verify_list_page_sync(body, required_codes):
    actual_codes = [
        column.get("code")
        for column in extract_list_columns(body)
        if isinstance(column, dict) and column.get("code")
    ]
    missing_codes = sorted(code for code in required_codes if code not in actual_codes)
    return {
        "implemented": not missing_codes,
        "machineChecked": not missing_codes,
        "manualChecked": False,
        "resolvedColumnsPresent": not missing_codes,
        "missingCodes": missing_codes,
        "actualCodes": actual_codes
    }


def build_parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    marker_parser = subparsers.add_parser("parse-marker")
    marker_parser.add_argument("body_file")
    marker_parser.add_argument("marker")
    form_parser = subparsers.add_parser("verify-form")
    form_parser.add_argument("original_body_file")
    form_parser.add_argument("updated_body_file")
    form_parser.add_argument("required_model_paths")
    list_parser = subparsers.add_parser("verify-list")
    list_parser.add_argument("body_file")
    list_parser.add_argument("required_codes")
    update_parser = subparsers.add_parser("build-update-args")
    update_parser.add_argument("schema_name")
    update_parser.add_argument("body_file")
    update_parser.add_argument("--dry-run", action="store_true")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "parse-marker":
        print(json.dumps(parse_marker_json(load_text(args.body_file), args.marker), ensure_ascii=True, indent=2))
    if args.command == "verify-form":
        required_model_paths = [item for item in args.required_model_paths.split(",") if item]
        print(json.dumps(verify_form_page_sync(load_text(args.original_body_file), load_text(args.updated_body_file), required_model_paths), ensure_ascii=True, indent=2))
    if args.command == "verify-list":
        required_codes = [item for item in args.required_codes.split(",") if item]
        print(json.dumps(verify_list_page_sync(load_text(args.body_file), required_codes), ensure_ascii=True, indent=2))
    if args.command == "build-update-args":
        print(json.dumps(build_page_update_arguments(args.schema_name, load_text(args.body_file), dry_run=args.dry_run), ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
