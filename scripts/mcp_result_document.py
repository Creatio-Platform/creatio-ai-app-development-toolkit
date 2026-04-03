#!/usr/bin/env python3
import copy

KIND_PRIORITY = {
    "section": 0,
    "detail": 1,
    "lookup": 2,
    "entity": 3
}


class ContextError(ValueError):
    pass


class EvidenceError(ValueError):
    pass


def first_text_value(payload, *keys):
    for key in keys:
        if key not in payload:
            continue
        value = payload[key]
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return trimmed
            continue
        if value not in (None, ""):
            return value
    return None


def get_present_value(payload, *keys):
    for key in keys:
        if key in payload:
            return True, payload[key]
    return False, None


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
    masked_present, masked_value = get_present_value(column, "masked", "Masked", "isValueMasked", "IsValueMasked")
    if masked_present:
        normalized["masked"] = bool(masked_value)
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
        "caption": first_text_value(node, "caption", "Caption", "title") or name,
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
        app["app-code"] = app_code
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
        "schemaName": ("schemaName", "schema-name"),
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
    page_metadata = response.get("page")
    if isinstance(page_metadata, dict):
        nested_field_map = {
            "schemaName": ("schemaName",),
            "packageUId": ("packageUId",),
            "packageName": ("packageName",),
            "uId": ("schemaUId", "uId"),
            "parentSchemaName": ("parentSchemaName",),
        }
        for target_key, source_keys in nested_field_map.items():
            if target_key in summary:
                continue
            for source_key in source_keys:
                if source_key in page_metadata:
                    summary[target_key] = copy.deepcopy(page_metadata[source_key])
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
        summarized_pages = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            page_metadata = page.get("page") if isinstance(page.get("page"), dict) else {}
            page_summary = {}
            schema_name = page.get("schema-name") or page.get("schemaName")
            if schema_name is not None:
                page_summary["schemaName"] = copy.deepcopy(schema_name)
            u_id = page.get("uId") or page_metadata.get("schemaUId")
            if u_id is not None:
                page_summary["uId"] = copy.deepcopy(u_id)
            package_name = page.get("packageName") or page_metadata.get("packageName")
            if package_name is not None:
                page_summary["packageName"] = copy.deepcopy(package_name)
            if page_summary:
                summarized_pages.append(page_summary)
        summary["pages"] = summarized_pages
    error = response.get("error")
    if isinstance(error, dict) and error:
        summary["error"] = copy.deepcopy(error)
    return summary


def _detect_runtime_shape(document):
    if "contractType" in document:
        raise ContextError("Persisted contractType is not supported")
    if "meta" in document and "packages" in document:
        raise ContextError("Legacy preview contract is not supported")
    success = document.get("success")
    if not isinstance(success, bool):
        raise ContextError("Result document success is required and must be boolean")
    if success is False:
        error = document.get("error")
        if not isinstance(error, dict) or not error:
            raise ContextError("Failed result document requires structured error evidence")
        return "error"
    if isinstance(document.get("app"), dict) and document.get("packages"):
        return "nested-short"
    package_u_id = document.get("packageUId") or document.get("package-u-id")
    package_name = document.get("packageName") or document.get("package-name")
    entities = document.get("entities")
    if package_u_id and package_name and isinstance(entities, list):
        return "flat-short"
    raise ContextError("Unable to infer application result runtime shape")


def _normalize_list_section(document, field_name):
    if field_name not in document:
        return []
    value = document[field_name]
    if not isinstance(value, list):
        raise ContextError(f"{field_name} must be a list")
    return copy.deepcopy(value)


def _normalize_dict_section(document, field_name):
    if field_name not in document:
        return {}
    value = document[field_name]
    if not isinstance(value, dict):
        raise ContextError(f"{field_name} must be an object")
    return copy.deepcopy(value)


def _validate_operation_entry(entry, field_name, index):
    if not isinstance(entry, dict):
        raise ContextError(f"{field_name}[{index}] must be an object")
    for key in ("tool", "target", "status"):
        value = entry.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ContextError(f"{field_name}[{index}].{key} must be a non-empty string")
    for key in ("toolName", "phase", "refreshedBy"):
        if key in entry and entry[key] is not None and not isinstance(entry[key], str):
            raise ContextError(f"{field_name}[{index}].{key} must be a string")
    if "evidence" in entry and entry["evidence"] is not None and not isinstance(entry["evidence"], dict):
        raise ContextError(f"{field_name}[{index}].evidence must be an object")


def _validate_page_status(page_name, status):
    if not isinstance(status, dict):
        raise ContextError(f"pageEvidence.{page_name}.status must be an object")
    for key in ("implemented", "machineChecked", "manualCheckPending"):
        if not isinstance(status.get(key), bool):
            raise ContextError(f"pageEvidence.{page_name}.status.{key} must be boolean")


def _validate_page_entry(page_name, entry):
    if not isinstance(entry, dict):
        raise ContextError(f"pageEvidence.{page_name} must be an object")
    verification = entry.get("verification")
    if not isinstance(verification, dict):
        raise ContextError(f"pageEvidence.{page_name}.verification must be an object")
    status = entry.get("status")
    _validate_page_status(page_name, status)


def validate_result_document(document):
    if not isinstance(document, dict):
        raise ContextError("Result document must be an object")
    shape = _detect_runtime_shape(document)
    schema_sync = document.get("schemaSync")
    if not isinstance(schema_sync, list):
        raise ContextError("schemaSync must be a list")
    for index, entry in enumerate(schema_sync):
        _validate_operation_entry(entry, "schemaSync", index)
    operation_log = document.get("operationLog")
    if not isinstance(operation_log, list):
        raise ContextError("operationLog must be a list")
    for index, entry in enumerate(operation_log):
        _validate_operation_entry(entry, "operationLog", index)
    page_evidence = document.get("pageEvidence")
    if not isinstance(page_evidence, dict):
        raise ContextError("pageEvidence must be an object")
    for page_name, entry in page_evidence.items():
        if not isinstance(page_name, str) or not page_name:
            raise ContextError("pageEvidence keys must be non-empty strings")
        _validate_page_entry(page_name, entry)
    acceptance_evidence = document.get("acceptanceEvidence")
    if not isinstance(acceptance_evidence, dict):
        raise ContextError("acceptanceEvidence must be an object")
    editable_context = document.get("editableContext")
    if shape == "error":
        if editable_context is not None:
            raise ContextError("Failed result document must not contain editableContext")
        return document
    if not isinstance(editable_context, dict):
        raise ContextError("Successful result document must contain editableContext")
    packages = editable_context.get("packages")
    if not isinstance(packages, list) or not packages:
        raise ContextError("Successful result document must contain editableContext packages")
    return document


def normalize_result_document(document):
    if not isinstance(document, dict):
        raise ContextError("Result document must be an object")
    normalized = copy.deepcopy(document)
    shape = _detect_runtime_shape(normalized)
    normalized["schemaSync"] = _normalize_list_section(normalized, "schemaSync")
    normalized["operationLog"] = _normalize_list_section(normalized, "operationLog")
    normalized["pageEvidence"] = _normalize_dict_section(normalized, "pageEvidence")
    normalized["acceptanceEvidence"] = _normalize_dict_section(normalized, "acceptanceEvidence")
    if shape == "error":
        normalized["editableContext"] = None
    else:
        normalized["editableContext"] = build_editable_context(normalized)
    validate_result_document(normalized)
    return normalized


def ensure_result_document(result_document):
    return normalize_result_document(result_document)


def derive_page_status(verification):
    implemented = bool(verification.get("implemented", True))
    machine_checked = bool(verification.get("machineChecked"))
    manual_checked = bool(verification.get("manualChecked"))
    return {
        "implemented": implemented,
        "machineChecked": machine_checked,
        "manualCheckPending": not manual_checked
    }


def append_operation(result_document, tool_name, target, status, response=None, phase=None, refreshed_by=None):
    if not isinstance(tool_name, str) or not tool_name:
        raise EvidenceError("tool_name is required")
    if not isinstance(target, str) or not target:
        raise EvidenceError("target is required")
    if not isinstance(status, str) or not status:
        raise EvidenceError("status is required")
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
    return ensure_result_document(document)


def attach_page_evidence(result_document, page_name, verification, response=None):
    if not isinstance(page_name, str) or not page_name:
        raise EvidenceError("page_name is required")
    if not isinstance(verification, dict):
        raise EvidenceError("verification must be an object")
    document = ensure_result_document(result_document)
    page_entry = copy.deepcopy(document["pageEvidence"].get(page_name, {}))
    if response is not None:
        response_summary = summarize_response(response)
        for key in ("schemaName", "bodyLength", "success", "uId", "parentSchemaName", "packageName", "packageUId"):
            if key in response_summary:
                page_entry[key] = response_summary[key]
    page_entry["verification"] = copy.deepcopy(verification)
    page_entry["status"] = derive_page_status(verification)
    document["pageEvidence"][page_name] = page_entry
    return ensure_result_document(document)


def refresh_result_document(runtime_document, current_document):
    refreshed_document = ensure_result_document(runtime_document)
    current = ensure_result_document(current_document)
    refreshed_document["schemaSync"] = copy.deepcopy(current["schemaSync"])
    refreshed_document["operationLog"] = copy.deepcopy(current["operationLog"])
    refreshed_document["pageEvidence"] = copy.deepcopy(current["pageEvidence"])
    refreshed_document["acceptanceEvidence"] = copy.deepcopy(current["acceptanceEvidence"])
    return ensure_result_document(refreshed_document)
