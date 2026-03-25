#!/usr/bin/env python3
import argparse
import copy
import json
from pathlib import Path

KIND_PRIORITY = {
    "section": 0,
    "detail": 1,
    "lookup": 2,
    "entity": 3
}


class ContextError(ValueError):
    pass


def first_text_value(payload, *keys):
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return None


def get_present_value(payload, *keys):
    for key in keys:
        if key in payload:
            return True, payload[key]
    return False, None


def infer_contract_type(document):
    contract_type = document.get("contractType")
    if contract_type:
        if contract_type != "short":
            raise ContextError(f"Unsupported application context contract type: {contract_type}")
        return contract_type
    if "app" in document and "packages" in document:
        return "short"
    if document.get("success") is True and ("packageUId" in document or "package-u-id" in document) and "entities" in document:
        return "short"
    if "success" in document and "error" in document:
        return "short"
    if "meta" in document and "packages" in document:
        raise ContextError("Legacy preview contract is not supported")
    raise ContextError("Unable to infer application context contract type")


def normalize_column(column, name=None):
    if not isinstance(column, dict):
        raise ContextError("Column must be an object")
    name = name or first_text_value(column, "name", "Name", "column-name")
    if not name:
        raise ContextError("Column name is required")
    normalized = {
        "name": name,
        "caption": first_text_value(column, "caption", "Caption", "title") or name
    }
    data_value_type_name = first_text_value(
        column,
        "dataValueTypeName",
        "DataValueTypeName",
        "dataValueType",
        "DataValueType",
        "data-value-type-name",
        "type"
    )
    reference_schema_name = first_text_value(
        column,
        "referenceSchemaName",
        "ReferenceSchemaName",
        "referenceSchema",
        "ReferenceSchema",
        "reference-schema-name"
    )
    if data_value_type_name:
        normalized["dataValueTypeName"] = data_value_type_name
    if reference_schema_name:
        normalized["referenceSchemaName"] = reference_schema_name
    u_id = first_text_value(column, "uId", "UId", "u-id")
    if u_id:
        normalized["uId"] = u_id
    is_required_present, is_required = get_present_value(column, "isRequired", "IsRequired", "required")
    if is_required_present:
        normalized["isRequired"] = bool(is_required)
    default_value_source_present, default_value_source = get_present_value(
        column,
        "defaultValueSource",
        "DefaultValueSource",
        "default-value-source"
    )
    if default_value_source_present and default_value_source not in (None, ""):
        normalized["defaultValueSource"] = default_value_source
    default_value_present, default_value = get_present_value(column, "defaultValue", "DefaultValue", "default-value")
    if default_value_present:
        normalized["defaultValue"] = default_value
    if normalized.get("referenceSchemaName") and not normalized.get("dataValueTypeName"):
        normalized["dataValueTypeName"] = "Lookup"
    return {key: value for key, value in normalized.items() if value is not None or key == "defaultValue"}


def normalize_columns(columns):
    column_map = {}
    if isinstance(columns, dict):
        for col_name, col_data in columns.items():
            column = normalize_column(col_data, col_name)
            column_map[column["name"]] = column
    else:
        for raw_column in columns or []:
            column = normalize_column(raw_column)
            column_map[column["name"]] = column
    return [column_map[name] for name in sorted(column_map)]


def merge_columns(left_columns, right_columns):
    merged = {column["name"]: dict(column) for column in left_columns}
    for column in right_columns:
        merged[column["name"]] = dict(column)
    return [merged[name] for name in sorted(merged)]


def normalize_entity_node(node, kind, name=None):
    name = name or node.get("entitySchemaName") or node.get("entity-schema-name") or node.get("schema-name") or node.get("name")
    if not name:
        raise ContextError("Entity schema name is required")
    entity = {
        "name": name,
        "caption": node.get("caption") or node.get("Caption") or node.get("title") or name,
        "kind": kind,
        "columns": normalize_columns(node.get("columns", []))
    }
    entity_u_id = node.get("entityUId") or node.get("uId") or node.get("entity-u-id") or node.get("u-id")
    parent_schema_name = node.get("parentSchemaName") or node.get("parent-schema-name")
    if entity_u_id:
        entity["entityUId"] = entity_u_id
    if parent_schema_name:
        entity["parentSchemaName"] = parent_schema_name
    return entity


def merge_entities(existing_entity, candidate_entity):
    if KIND_PRIORITY[candidate_entity["kind"]] < KIND_PRIORITY[existing_entity["kind"]]:
        existing_entity["kind"] = candidate_entity["kind"]
    for key in ("entityUId", "parentSchemaName"):
        if not existing_entity.get(key) and candidate_entity.get(key):
            existing_entity[key] = candidate_entity[key]
    if candidate_entity.get("caption"):
        existing_entity["caption"] = candidate_entity["caption"]
    existing_entity["columns"] = merge_columns(existing_entity.get("columns", []), candidate_entity.get("columns", []))
    return existing_entity


def collect_package_entities(package):
    entity_map = {}
    entities = package.get("entities")
    if isinstance(entities, dict):
        for entity_name, entity_node in entities.items():
            entity = normalize_entity_node(entity_node, "entity", entity_name)
            existing = entity_map.get(entity["name"])
            if existing:
                entity_map[entity["name"]] = merge_entities(existing, entity)
            else:
                entity_map[entity["name"]] = entity
    elif isinstance(entities, list):
        for entity_node in entities:
            kind = entity_node.get("kind", "entity")
            entity = normalize_entity_node(entity_node, kind)
            existing = entity_map.get(entity["name"])
            if existing:
                entity_map[entity["name"]] = merge_entities(existing, entity)
            else:
                entity_map[entity["name"]] = entity
    return sorted(entity_map.values(), key=lambda entity: (KIND_PRIORITY.get(entity.get("kind"), 99), entity.get("name", "")))


def build_app_context(document):
    if isinstance(document.get("app"), dict) and document["app"]:
        return copy.deepcopy(document["app"])
    app = {}
    app_id = document.get("appId") or document.get("app-id")
    app_name = document.get("appName") or document.get("app-name")
    app_code = document.get("appCode") or document.get("app-code") or document.get("packageName") or document.get("package-name")
    if app_id:
        app["id"] = app_id
    if app_name:
        app["name"] = app_name
    if app_code:
        app["code"] = app_code
    return app


def build_editable_context(document):
    packages = []
    raw_packages = document.get("packages")
    if raw_packages:
        if isinstance(raw_packages, dict):
            items = raw_packages.items()
        else:
            items = [(pkg.get("packageName") or pkg.get("package-name") or pkg.get("name"), pkg) for pkg in raw_packages]
    elif (document.get("packageUId") or document.get("package-u-id")) and isinstance(document.get("entities"), list):
        items = [(
            document.get("packageName") or document.get("package-name"),
            {
                "packageUId": document.get("packageUId") or document.get("package-u-id"),
                "packageName": document.get("packageName") or document.get("package-name"),
                "isPrimary": True,
                "entities": document.get("entities", [])
            }
        )]
    else:
        items = []
    for pkg_name, package in items:
        package_u_id = package.get("packageUId") or package.get("package-u-id") or package.get("uId") or package.get("u-id")
        packages.append({
            "packageUId": package_u_id,
            "name": pkg_name or package.get("packageName") or package.get("package-name") or package.get("name"),
            "isPrimary": bool(package.get("isPrimary")),
            "entities": collect_package_entities(package)
        })
    packages.sort(key=lambda package: (0 if package.get("isPrimary") else 1, package.get("name") or "", package.get("packageUId") or ""))
    return {
        "app": build_app_context(document),
        "packages": packages
    }


def normalize_result_document(document):
    normalized = copy.deepcopy(document)
    contract_type = infer_contract_type(normalized)
    normalized["contractType"] = contract_type
    schema_sync = normalized.get("schemaSync")
    operation_log = normalized.get("operationLog")
    page_evidence = normalized.get("pageEvidence")
    acceptance_evidence = normalized.get("acceptanceEvidence")
    normalized["schemaSync"] = list(schema_sync) if isinstance(schema_sync, list) else []
    normalized["operationLog"] = list(operation_log) if isinstance(operation_log, list) else []
    normalized["pageEvidence"] = copy.deepcopy(page_evidence) if isinstance(page_evidence, dict) else {}
    normalized["acceptanceEvidence"] = copy.deepcopy(acceptance_evidence) if isinstance(acceptance_evidence, dict) else {}
    if contract_type == "short" and normalized.get("success") is True:
        normalized["editableContext"] = build_editable_context(normalized)
    else:
        normalized["editableContext"] = None
    return normalized


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def build_parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    normalize_parser = subparsers.add_parser("normalize")
    normalize_parser.add_argument("input_path")
    normalize_parser.add_argument("output_path", nargs="?")
    return parser


def run_normalize(input_path, output_path=None):
    source_path = Path(input_path)
    target_path = Path(output_path) if output_path else source_path
    payload = load_json(source_path)
    normalized = normalize_result_document(payload)
    write_json(target_path, normalized)
    return str(target_path)


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "normalize":
        print(run_normalize(args.input_path, args.output_path))


if __name__ == "__main__":
    main()
