#!/usr/bin/env python3
import argparse
import json
import re
import sys
import uuid
from pathlib import Path

try:
    from scripts.page_body_tools import (
        PageBodyError,
        extract_marker_text,
        load_text,
        parse_marker_json,
        parse_first_available_marker,
        strip_trailing_commas,
    )
except ImportError:
    from page_body_tools import (
        PageBodyError,
        extract_marker_text,
        load_text,
        parse_marker_json,
        parse_first_available_marker,
        strip_trailing_commas,
    )


REQUIRED_MARKERS = [
    "SCHEMA_DEPS",
    "SCHEMA_ARGS",
    "SCHEMA_VIEW_CONFIG_DIFF",
    "SCHEMA_HANDLERS",
    "SCHEMA_CONVERTERS",
    "SCHEMA_VALIDATORS",
]

VM_MARKER_VARIANTS = ["SCHEMA_VIEW_MODEL_CONFIG_DIFF", "SCHEMA_VIEW_MODEL_CONFIG"]
MC_MARKER_VARIANTS = ["SCHEMA_MODEL_CONFIG_DIFF", "SCHEMA_MODEL_CONFIG"]


def find_marker_span(body, marker):
    token = f"/**{marker}*/"
    first = body.find(token)
    if first < 0:
        return None
    content_start = first + len(token)
    second = body.find(token, content_start)
    if second < 0:
        return None
    return (content_start, second)


def detect_vm_marker(body):
    for m in VM_MARKER_VARIANTS:
        if find_marker_span(body, m) is not None:
            return m
    return None


def detect_mc_marker(body):
    for m in MC_MARKER_VARIANTS:
        if find_marker_span(body, m) is not None:
            return m
    return None


def replace_marker_content(body, marker, new_content):
    span = find_marker_span(body, marker)
    if span is None:
        raise PageBodyError(f"Marker {marker} not found in body")
    return body[: span[0]] + new_content + body[span[1] :]


def serialize_json_indented(data, base_indent=2):
    raw = json.dumps(data, indent="\t", ensure_ascii=False)
    prefix = "\t" * base_indent
    lines = raw.split("\n")
    result = lines[0]
    for line in lines[1:]:
        result += "\n" + prefix + line
    return result


def validate_body_structure(body):
    errors = []
    for marker in REQUIRED_MARKERS:
        if find_marker_span(body, marker) is None:
            errors.append(f"Missing required marker: {marker}")

    vm_marker = detect_vm_marker(body)
    if vm_marker is None:
        errors.append(f"Missing viewModelConfig marker (need one of: {VM_MARKER_VARIANTS})")

    mc_marker = detect_mc_marker(body)
    if mc_marker is None:
        errors.append(f"Missing modelConfig marker (need one of: {MC_MARKER_VARIANTS})")

    if errors:
        return {"valid": False, "errors": errors}

    NON_JSON_MARKERS = {"SCHEMA_DEPS", "SCHEMA_ARGS"}
    all_markers = REQUIRED_MARKERS + ([vm_marker] if vm_marker else []) + ([mc_marker] if mc_marker else [])
    for marker in all_markers:
        if marker in NON_JSON_MARKERS:
            continue
        try:
            text = extract_marker_text(body, marker)
            cleaned = strip_trailing_commas(text)
            json.loads(cleaned)
        except (PageBodyError, json.JSONDecodeError) as e:
            errors.append(f"Marker {marker}: invalid JSON — {e}")

    return {"valid": len(errors) == 0, "errors": errors}


def find_max_row_index(view_config_diff, parent_name):
    max_row = 0
    max_index = -1
    for item in view_config_diff:
        if not isinstance(item, dict):
            continue
        if item.get("operation") != "insert":
            continue
        if item.get("parentName") != parent_name:
            continue
        layout = (item.get("values") or {}).get("layoutConfig") or {}
        row = layout.get("row", 0)
        index = item.get("index", 0)
        if row > max_row:
            max_row = row
        if index > max_index:
            max_index = index
    return max_row, max_index


def build_form_field_insert(field, row, index):
    values = {
        "layoutConfig": {
            "column": 1,
            "row": row,
            "colSpan": 1,
            "rowSpan": 1,
        },
        "type": field["type"],
        "label": field.get("label", f"$Resources.Strings.{field['name']}"),
        "labelPosition": "auto",
    }
    binding_prop = "value" if field["type"] == "crt.ImageInput" else "control"
    values[binding_prop] = f"${field['name']}"
    if field["type"] == "crt.DateTimePicker":
        values["pickerType"] = field.get("pickerType", "date")
    if field["type"] == "crt.Input" and field.get("multiline"):
        values["multiline"] = True
    if field["type"] == "crt.NumberInput" and field.get("decimalPrecision") is not None:
        values["format"] = {"decimalPrecision": field["decimalPrecision"]}
    return {
        "operation": "insert",
        "name": field["name"],
        "values": values,
        "parentName": field.get("parentName", "SideAreaProfileContainer"),
        "propertyName": "items",
        "index": index,
    }


def add_form_fields(body, fields):
    view_config = parse_marker_json(body, "SCHEMA_VIEW_CONFIG_DIFF")
    vm_marker = detect_vm_marker(body)
    if vm_marker is None:
        raise PageBodyError("No viewModelConfig marker found")
    vm_data = parse_marker_json(body, vm_marker)
    parent = fields[0].get("parentName", "SideAreaProfileContainer") if fields else "SideAreaProfileContainer"
    max_row, max_index = find_max_row_index(view_config, parent)
    existing_names = {item.get("name") for item in view_config if isinstance(item, dict)}
    for field in fields:
        if field["name"] in existing_names:
            continue
        max_row += 1
        max_index += 1
        insert = build_form_field_insert(field, max_row, max_index)
        view_config.append(insert)
    body = replace_marker_content(body, "SCHEMA_VIEW_CONFIG_DIFF",
                                  serialize_json_indented(view_config, base_indent=2))
    if vm_marker == "SCHEMA_VIEW_MODEL_CONFIG":
        if not isinstance(vm_data, dict):
            vm_data = {"attributes": {}}
        attrs = vm_data.setdefault("attributes", {})
        for field in fields:
            if field["name"] not in attrs:
                attrs[field["name"]] = {"modelConfig": {"path": field["path"]}}
        body = replace_marker_content(body, vm_marker,
                                      serialize_json_indented(vm_data, base_indent=2))
    else:
        merge_op = None
        for op in vm_data:
            if isinstance(op, dict) and "attributes" in (op.get("path") or []):
                merge_op = op
                break
        if merge_op is None:
            merge_op = {"operation": "merge", "path": ["attributes"], "values": {}}
            vm_data.append(merge_op)
        values = merge_op.setdefault("values", {})
        for field in fields:
            if field["name"] not in values:
                values[field["name"]] = {"modelConfig": {"path": field["path"]}}
        body = replace_marker_content(body, vm_marker,
                                      serialize_json_indented(vm_data, base_indent=2))
    return body


def add_list_columns(body, columns):
    view_config = parse_marker_json(body, "SCHEMA_VIEW_CONFIG_DIFF")
    datatable_op = None
    for op in view_config:
        if isinstance(op, dict) and op.get("name") == "DataTable":
            datatable_op = op
            break
    if datatable_op is None:
        raise PageBodyError("DataTable operation not found in viewConfigDiff")
    existing_columns = (datatable_op.get("values") or {}).get("columns") or []
    existing_codes = {c.get("code") for c in existing_columns if isinstance(c, dict)}
    for col in columns:
        if col["code"] in existing_codes:
            continue
        entry = {
            "id": col.get("id", str(uuid.uuid4())),
            "code": col["code"],
            "caption": col.get("caption", f"#ResourceString({col['code']})#"),
            "dataValueType": col["dataValueType"],
        }
        if col.get("width"):
            entry["width"] = col["width"]
        existing_columns.append(entry)
    datatable_op.setdefault("values", {})["columns"] = existing_columns
    body = replace_marker_content(body, "SCHEMA_VIEW_CONFIG_DIFF",
                                  serialize_json_indented(view_config, base_indent=2))
    vm_marker = detect_vm_marker(body)
    if vm_marker is None:
        raise PageBodyError("No viewModelConfig marker found")
    vm_data = parse_marker_json(body, vm_marker)
    if vm_marker == "SCHEMA_VIEW_MODEL_CONFIG":
        attrs = vm_data.setdefault("attributes", {}) if isinstance(vm_data, dict) else {}
        for col in columns:
            attr_key = col["code"]
            if attr_key not in attrs:
                entity_col = col["code"].replace("PDS_", "", 1)
                attrs[attr_key] = {"modelConfig": {"path": f"PDS.{entity_col}"}}
        body = replace_marker_content(body, vm_marker,
                                      serialize_json_indented(vm_data, base_indent=2))
    else:
        merge_op = None
        for op in vm_data:
            if isinstance(op, dict):
                op_path = op.get("path") or []
                if "attributes" in op_path:
                    merge_op = op
                    break
        if merge_op is None:
            merge_op = {"operation": "merge", "path": ["attributes", "Items", "viewModelConfig", "attributes"], "values": {}}
            vm_data.append(merge_op)
        values = merge_op.setdefault("values", {})
        for col in columns:
            attr_key = col["code"]
            if attr_key not in values:
                entity_col = col["code"].replace("PDS_", "", 1)
                values[attr_key] = {"modelConfig": {"path": f"PDS.{entity_col}"}}
        body = replace_marker_content(body, vm_marker,
                                      serialize_json_indented(vm_data, base_indent=2))
    return body


def build_parser():
    parser = argparse.ArgumentParser(description="Structured page body editor")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="Validate page body structure")
    validate_parser.add_argument("body_file", help="Path to page body JS file")

    form_parser = subparsers.add_parser("add-form-fields", help="Add fields to FormPage")
    form_parser.add_argument("body_file", help="Path to page body JS file")
    form_parser.add_argument("fields_json", help="JSON array of field specs or path to JSON file")
    form_parser.add_argument("-o", "--output", help="Output file (default: stdout)")

    list_parser = subparsers.add_parser("add-list-columns", help="Add columns to ListPage")
    list_parser.add_argument("body_file", help="Path to page body JS file")
    list_parser.add_argument("columns_json", help="JSON array of column specs or path to JSON file")
    list_parser.add_argument("-o", "--output", help="Output file (default: stdout)")

    return parser


def load_json_arg(value):
    path = Path(value)
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return json.loads(value)


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "validate":
        body = load_text(args.body_file)
        result = validate_body_structure(body)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result["valid"] else 1)

    if args.command == "add-form-fields":
        body = load_text(args.body_file)
        fields = load_json_arg(args.fields_json)
        result = add_form_fields(body, fields)
        validation = validate_body_structure(result)
        if not validation["valid"]:
            print(json.dumps({"error": "Post-edit validation failed", "details": validation["errors"]}), file=sys.stderr)
            sys.exit(1)
        if args.output:
            Path(args.output).write_text(result, encoding="utf-8")
        else:
            print(result)

    if args.command == "add-list-columns":
        body = load_text(args.body_file)
        columns = load_json_arg(args.columns_json)
        result = add_list_columns(body, columns)
        validation = validate_body_structure(result)
        if not validation["valid"]:
            print(json.dumps({"error": "Post-edit validation failed", "details": validation["errors"]}), file=sys.stderr)
            sys.exit(1)
        if args.output:
            Path(args.output).write_text(result, encoding="utf-8")
        else:
            print(result)


if __name__ == "__main__":
    main()
