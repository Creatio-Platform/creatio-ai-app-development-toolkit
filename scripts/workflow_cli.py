#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


class WorkflowError(Exception):
    pass


REQUIRED_REQUIREMENTS_SECTIONS = [
    "## 1. Business context",
    "## 2. Users, access and ownership",
    "## 3. Core process and business logic",
    "## 4. Data model",
    "## 5. UX assumptions",
    "## Assumptions used for the draft requirements",
]
REQUIRED_REQUIREMENTS_MARKERS = [
    "System value:",
    "MVP success criteria:",
    "Primary roles:",
    "Access model:",
    "Typical process:",
    "Lifecycle:",
    "Key business logic:",
    "Operational metrics:",
    "What should feel easy in the MVP:",
    "Minimum to create:",
    "default list columns:",
    "default main filters:",
]
REQUEST_SPEC_SECTIONS = [
    "businessOutcome",
    "coreProblem",
    "actorsAndRoles",
    "domainModel",
    "lifecycleAndStatuses",
    "businessLogic",
    "uxExpectations",
    "edgeCases",
    "acceptanceCriteria",
    "analytics",
    "accessRestrictions",
]
ENTITY_HEADING_RE = re.compile(r"^\s*#{3,6}\s+4\.\d+\s+(Main|Supporting) entity:", re.MULTILINE)
LOOKUPS_HEADING_RE = re.compile(r"^\s*#{3,6}\s+4\.\d+\s+Lookups\s*$", re.MULTILINE)
RELATIONSHIPS_HEADING_RE = re.compile(r"^\s*#{3,6}\s+4\.\d+\s+Relationships\s*$", re.MULTILINE)
MAIN_ENTITY_HEADING_RE = re.compile(r"^\s*#{3,6}\s+4\.\d+\s+Main entity:", re.MULTILINE)
TABLE_HEADER_RE = re.compile(
    r"^\s*\|\s*(Title|Назва)\s*\|\s*(Code|Код)\s*\|\s*(Description|Опис)\s*\|\s*(Data type|Тип)\s*\|\s*(Required|Обов’язкове)\s*\|\s*Default\s*\|",
    re.IGNORECASE,
)
UX_CARRIER_RE = re.compile(r"^[\s-]*default (list columns|main filters):", re.IGNORECASE)
USR_CODE_RE = re.compile(r"\bUsr[A-Za-z0-9_]+\b")
CHECKLIST_SOURCE_RE = re.compile(r"\bconfirmed\b|\bassumed\b|complete=true|source=", re.IGNORECASE)
HTTP_URL_RE = re.compile(r"^https?://")


def workflow_root_text():
    return os.environ.get("WORKFLOW_ROOT_DIR", ".")


def workflow_state_root_text():
    return os.environ.get("WORKFLOW_STATE_DIR", f"{workflow_root_text()}/.workflow-state")


def workflow_root_path():
    return Path(workflow_root_text())


def workflow_state_root_path():
    return Path(workflow_state_root_text())


def state_file_path(app_name):
    return workflow_state_root_path() / app_name / "planning-state.json"


def state_file_text(app_name):
    return f"{workflow_state_root_text()}/{app_name}/planning-state.json"


def output_file_path(app_name, filename):
    return workflow_root_path() / "output" / app_name / filename


def output_file_text(app_name, filename):
    return f"{workflow_root_text()}/output/{app_name}/{filename}"


def utc_now_text():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json_file(path_text, missing_message):
    path = Path(path_text)
    if not path.is_file():
        raise WorkflowError(missing_message)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise WorkflowError(f"{missing_message.split(':', 1)[0]}: invalid JSON: {error}") from error


def write_json_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def ensure_non_empty(value, message):
    if not isinstance(value, str) or not value:
        raise WorkflowError(message)


def ensure_http_url(value, message):
    if not isinstance(value, str) or not HTTP_URL_RE.search(value):
        raise WorkflowError(message)


def compute_sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract_section(text, start_heading, end_heading=None):
    lines = text.splitlines()
    capture = False
    captured = []
    for line in lines:
        if line == start_heading:
            capture = True
            continue
        if capture and end_heading and line == end_heading:
            break
        if capture:
            captured.append(line)
    return "\n".join(captured)


def normalize_title_list(text):
    return [item.strip() for item in text.split(",") if item.strip()]


def validate_requirements_doc(requirements_file):
    path = Path(requirements_file)
    if not path.is_file():
        raise WorkflowError(f"Requirements doc failed: file not found: {requirements_file}")
    text = path.read_text(encoding="utf-8")
    if not re.search(r"^# .+ - Requirements$", text, re.MULTILINE):
        raise WorkflowError("Requirements doc failed: title must match '# <AppName> - Requirements'")
    for section in REQUIRED_REQUIREMENTS_SECTIONS:
        if section not in text:
            raise WorkflowError(f"Requirements doc failed: missing required section: {section}")
    if "## 6. Implementation-shaping decisions and assumptions" in text:
        raise WorkflowError("Requirements doc failed: obsolete section 6 must not appear in the BA draft")
    for marker in REQUIRED_REQUIREMENTS_MARKERS:
        if marker not in text:
            raise WorkflowError(f"Requirements doc failed: missing required marker: {marker}")
    if not MAIN_ENTITY_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing 'Main entity' subsection in section 4")
    if not LOOKUPS_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing Lookups subsection in section 4")
    if not RELATIONSHIPS_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing Relationships subsection in section 4")
    section1_text = extract_section(text, "## 1. Business context", "## 2. Users, access and ownership")
    section2_text = extract_section(text, "## 2. Users, access and ownership", "## 3. Core process and business logic")
    section3_text = extract_section(text, "## 3. Core process and business logic", "## 4. Data model")
    section4_text = extract_section(text, "## 4. Data model", "## 5. UX assumptions")
    section5_text = extract_section(text, "## 5. UX assumptions", "## Assumptions used for the draft requirements")
    assumptions_text = extract_section(text, "## Assumptions used for the draft requirements")
    for section_text in (section1_text, section2_text, section3_text, section5_text, assumptions_text):
        if re.search(r"^[ \t]*\|", section_text, re.MULTILINE):
            raise WorkflowError("Requirements doc failed: markdown tables are allowed only in section 4 data model")
    if not re.search(r"^[ \t]*\|[ \t]*(Title|Назва)[ \t]*\|[ \t]*(Code|Код)[ \t]*\|[ \t]*(Description|Опис)[ \t]*\|", section4_text, re.IGNORECASE | re.MULTILINE):
        raise WorkflowError("Requirements doc failed: section 4 must include a field table with the required columns")
    lines = section4_text.splitlines()
    entity_indices = [index for index, line in enumerate(lines) if ENTITY_HEADING_RE.search(line)]
    if not entity_indices:
        raise WorkflowError("Requirements doc failed: section 4 must contain at least one main or supporting entity heading")
    table_count = 0
    for line in lines:
        if TABLE_HEADER_RE.search(line):
            table_count += 1
    for pos, start in enumerate(entity_indices):
        end = entity_indices[pos + 1] if pos + 1 < len(entity_indices) else len(lines)
        block = lines[start:end]
        block_text = "\n".join(block)
        for marker in ("Title:", "Code:", "Entity role:", "Primary display field:", "Description:", "Purpose:"):
            if marker not in block_text:
                raise WorkflowError(
                    f"Requirements doc failed: entity block starting at '{lines[start]}' is missing metadata marker '{marker}'"
                )
        if not any(TABLE_HEADER_RE.search(line) for line in block):
            raise WorkflowError(
                f"Requirements doc failed: entity block starting at '{lines[start]}' must include its own field table"
            )
    if table_count < len(entity_indices):
        raise WorkflowError("Requirements doc failed: every main and supporting entity must have a dedicated field table")
    if USR_CODE_RE.search(section5_text):
        raise WorkflowError("Requirements doc failed: section 5 must use business titles instead of Usr* codes")
    if CHECKLIST_SOURCE_RE.search(text):
        raise WorkflowError("Requirements doc failed: business plan must not expose checklist-source or validation markers")
    section4_text_lower = section4_text.lower()
    for line in section5_text.splitlines():
        if not UX_CARRIER_RE.search(line):
            continue
        values = normalize_title_list(re.sub(r"^[\s-]*default [^:]*:\s*", "", line, count=1, flags=re.IGNORECASE))
        for title in values:
            if title == "Name":
                continue
            if title.lower() not in section4_text_lower:
                raise WorkflowError(f"Requirements doc failed: UX title '{title}' must have a carrier in section 4 data model")
    return f"REQUIREMENTS_DOC_OK {requirements_file}"


def require_json_bool(payload, key_path, message):
    value = payload
    for key in key_path:
        if not isinstance(value, dict) or key not in value:
            raise WorkflowError(message)
        value = value[key]
    if value is not True:
        raise WorkflowError(message)


def require_json_non_empty_string(payload, key_path, message):
    value = payload
    for key in key_path:
        if not isinstance(value, dict) or key not in value:
            raise WorkflowError(message)
        value = value[key]
    if not isinstance(value, str) or len(value) == 0:
        raise WorkflowError(message)
    return value


def validate_request_spec(request_spec_file):
    payload = load_json_file(
        request_spec_file,
        f"Request spec failed: file not found: {request_spec_file}",
    )
    source_prompt = payload.get("sourcePrompt")
    if not isinstance(source_prompt, str) or len(source_prompt) == 0:
        raise WorkflowError("Request spec failed: sourcePrompt must be a non-empty string")
    business_checklist = payload.get("businessChecklist")
    if not isinstance(business_checklist, dict) or business_checklist.get("complete") is not True:
        raise WorkflowError("Request spec failed: businessChecklist.complete must be true")
    technical_inputs = payload.get("technicalInputs")
    if not isinstance(technical_inputs, dict):
        raise WorkflowError("Request spec failed: technicalInputs must be an object")
    assumptions = payload.get("assumptions")
    if not isinstance(assumptions, list):
        raise WorkflowError("Request spec failed: assumptions must be an array")
    if any(not isinstance(item, str) or len(item) == 0 for item in assumptions):
        raise WorkflowError("Request spec failed: assumptions must contain only non-empty strings")
    for section in REQUEST_SPEC_SECTIONS:
        section_payload = business_checklist.get(section)
        if not isinstance(section_payload, dict) or section_payload.get("complete") is not True:
            raise WorkflowError(f"Request spec failed: businessChecklist.{section}.complete must be true")
        value = section_payload.get("value")
        if not isinstance(value, str) or len(value) == 0:
            raise WorkflowError(f"Request spec failed: businessChecklist.{section}.value must be a non-empty string")
        source = section_payload.get("source")
        if source not in {"confirmed", "assumed"}:
            raise WorkflowError(f"Request spec failed: businessChecklist.{section}.source must be confirmed or assumed")
        if source == "assumed":
            assumption = section_payload.get("assumption")
            if not isinstance(assumption, str) or len(assumption) == 0:
                raise WorkflowError(
                    f"Request spec failed: businessChecklist.{section}.assumption must be a non-empty string when source is assumed"
                )
            if assumption not in assumptions:
                raise WorkflowError(
                    f"Request spec failed: businessChecklist.{section}.assumption must be listed in assumptions when source is assumed"
                )
    environment_mode = technical_inputs.get("environmentMode")
    creatio_url = technical_inputs.get("creatioUrl")
    if environment_mode is None:
        environment_mode = "site-ready-now" if isinstance(creatio_url, str) and HTTP_URL_RE.search(creatio_url) else "planning-first"
    if environment_mode not in {"site-ready-now", "planning-first"}:
        raise WorkflowError("Request spec failed: technicalInputs.environmentMode must be site-ready-now or planning-first when provided")
    credentials_status = technical_inputs.get("credentialsStatus")
    if credentials_status not in {"provided", "missing", "existing_env", "deferred"}:
        raise WorkflowError(
            "Request spec failed: technicalInputs.credentialsStatus must be one of: provided, missing, existing_env, deferred"
        )
    if environment_mode == "site-ready-now":
        if not isinstance(creatio_url, str) or not HTTP_URL_RE.search(creatio_url):
            raise WorkflowError(
                "Request spec failed: technicalInputs.creatioUrl must be a valid http(s) URL when environmentMode=site-ready-now; planning-first may defer it"
            )
    elif creatio_url not in (None, "") and (not isinstance(creatio_url, str) or not HTTP_URL_RE.search(creatio_url)):
        raise WorkflowError(
            "Request spec failed: technicalInputs.creatioUrl must be a valid http(s) URL when environmentMode=site-ready-now; planning-first may defer it"
        )
    return f"REQUEST_SPEC_OK {request_spec_file}"


def parse_write_planning_values(values):
    if len(values) == 6:
        app_name, approved_by, routing_mode, creatio_url, understanding_text, confirmation_text = values
    elif len(values) == 5:
        app_name, approved_by, legacy_value, understanding_text, confirmation_text = values
        if legacy_value in {"planning-first", "deferred", "-", ""}:
            routing_mode = "planning-first"
            creatio_url = ""
        else:
            routing_mode = "site-ready-now"
            creatio_url = legacy_value
    else:
        raise WorkflowError(
            "Usage:\n"
            "  scripts/write-planning-state.sh <AppName> <approvedBy> <creatioUrl> <understandingText> <confirmationText>\n"
            "  scripts/write-planning-state.sh <AppName> <approvedBy> <routingMode> <creatioUrlOrDeferred> <understandingText> <confirmationText>"
        )
    return app_name, approved_by, routing_mode, creatio_url, understanding_text, confirmation_text


def write_planning_state(values):
    app_name, approved_by, routing_mode, creatio_url, understanding_text, confirmation_text = parse_write_planning_values(values)
    ensure_non_empty(approved_by, "approvedBy must be non-empty")
    ensure_non_empty(understanding_text, "understandingText must be non-empty")
    ensure_non_empty(confirmation_text, "confirmationText must be non-empty")
    if routing_mode not in {"site-ready-now", "planning-first"}:
        raise WorkflowError("routingMode must be one of: site-ready-now, planning-first")
    if creatio_url in {"planning-first", "deferred", "-"}:
        creatio_url = ""
    if routing_mode == "site-ready-now":
        ensure_http_url(creatio_url, "creatioUrl must be a valid http(s) URL when routingMode=site-ready-now")
    if creatio_url and not HTTP_URL_RE.search(creatio_url):
        raise WorkflowError("creatioUrl must be a valid http(s) URL when provided")
    payload = {
        "planningApproved": True,
        "appName": app_name,
        "approvedBy": approved_by,
        "approvedAtUtc": utc_now_text(),
        "approvalSource": "natural-language",
        "routingMode": routing_mode,
        "environmentInputsDeferred": routing_mode == "planning-first",
        "understandingText": understanding_text,
        "confirmationText": confirmation_text,
        "technicalInputs": {
            "creatioUrl": creatio_url,
        },
    }
    file_path = state_file_path(app_name)
    write_json_file(file_path, payload)
    return str(file_path)


def check_planning_gate(app_name):
    planning_file_text = state_file_text(app_name)
    payload = load_json_file(
        planning_file_text,
        f"Planning gate failed: planning-state.json not found: {planning_file_text}",
    )
    if payload.get("planningApproved") is not True:
        raise WorkflowError("Planning gate failed: planningApproved must be true")
    if payload.get("appName") != app_name:
        raise WorkflowError(f"Planning gate failed: appName mismatch (expected {app_name}, got {payload.get('appName', '')})")
    ensure_non_empty(payload.get("approvedBy"), "Planning gate failed: approvedBy is empty")
    ensure_non_empty(payload.get("approvedAtUtc"), "Planning gate failed: approvedAtUtc is empty")
    if payload.get("approvalSource") != "natural-language":
        raise WorkflowError("Planning gate failed: approvalSource must be natural-language")
    creatio_url = ""
    technical_inputs = payload.get("technicalInputs")
    if isinstance(technical_inputs, dict):
        creatio_url = technical_inputs.get("creatioUrl") or ""
    routing_mode = payload.get("routingMode")
    if not routing_mode:
        routing_mode = "site-ready-now" if isinstance(creatio_url, str) and HTTP_URL_RE.search(creatio_url) else "planning-first"
    if routing_mode not in {"site-ready-now", "planning-first"}:
        raise WorkflowError("Planning gate failed: routingMode must be site-ready-now or planning-first")
    if routing_mode == "site-ready-now" and (not isinstance(creatio_url, str) or not HTTP_URL_RE.search(creatio_url)):
        raise WorkflowError(
            "Planning gate failed: technicalInputs.creatioUrl must be a valid http(s) URL when routingMode=site-ready-now"
        )
    if creatio_url and (not isinstance(creatio_url, str) or not HTTP_URL_RE.search(creatio_url)):
        raise WorkflowError("Planning gate failed: technicalInputs.creatioUrl must be a valid http(s) URL when provided")
    environment_inputs_deferred = payload.get("environmentInputsDeferred")
    if routing_mode == "planning-first" and environment_inputs_deferred is not None and environment_inputs_deferred is not True:
        raise WorkflowError("Planning gate failed: environmentInputsDeferred must be true when routingMode=planning-first")
    ensure_non_empty(payload.get("understandingText"), "Planning gate failed: understandingText is empty")
    ensure_non_empty(payload.get("confirmationText"), "Planning gate failed: confirmationText is empty")
    return f"PLANNING_GATE_OK {app_name}"


def write_approval_state(app_name, approved_by, approval_text):
    requirements_file_text = output_file_text(app_name, "requirements.md")
    request_spec_file_text = output_file_text(app_name, "request-spec.json")
    if not Path(requirements_file_text).is_file():
        raise WorkflowError(f"requirements.md not found: {requirements_file_text}")
    if not Path(request_spec_file_text).is_file():
        raise WorkflowError(f"request-spec.json not found: {request_spec_file_text}")
    ensure_non_empty(approved_by, "approvedBy must be non-empty")
    ensure_non_empty(approval_text, "approvalText must be non-empty")
    check_planning_gate(app_name)
    validate_requirements_doc(requirements_file_text)
    validate_request_spec(request_spec_file_text)
    requirements_sha256 = compute_sha256(Path(requirements_file_text))
    payload = {
        "requirementsApproved": True,
        "approvalToken": "APPROVE_REQUIREMENTS",
        "appName": app_name,
        "requirementsSha256": requirements_sha256,
        "approvedBy": approved_by,
        "approvedAtUtc": utc_now_text(),
        "approvalSource": "natural-language",
        "approvalText": approval_text,
        "interactionMode": "nl-business-first",
        "businessChecklistComplete": True,
        "planningGateApproved": True,
    }
    state_path = output_file_path(app_name, "workflow-state.json")
    write_json_file(state_path, payload)
    return str(state_path)


def check_approval_gate(app_name):
    check_planning_gate(app_name)
    requirements_file_text = output_file_text(app_name, "requirements.md")
    request_spec_file_text = output_file_text(app_name, "request-spec.json")
    state_file_text = output_file_text(app_name, "workflow-state.json")
    if not Path(requirements_file_text).is_file():
        raise WorkflowError(f"Gate failed: requirements.md not found: {requirements_file_text}")
    if not Path(request_spec_file_text).is_file():
        raise WorkflowError(f"Gate failed: request-spec.json not found: {request_spec_file_text}")
    if not Path(state_file_text).is_file():
        raise WorkflowError(f"Gate failed: workflow-state.json not found: {state_file_text}")
    validate_requirements_doc(requirements_file_text)
    validate_request_spec(request_spec_file_text)
    requirements_sha256 = compute_sha256(Path(requirements_file_text))
    payload = load_json_file(
        state_file_text,
        f"Gate failed: workflow-state.json not found: {state_file_text}",
    )
    if payload.get("requirementsApproved") is not True:
        raise WorkflowError("Gate failed: requirementsApproved must be true")
    if payload.get("approvalToken") != "APPROVE_REQUIREMENTS":
        raise WorkflowError("Gate failed: approvalToken must be APPROVE_REQUIREMENTS")
    if payload.get("appName") != app_name:
        raise WorkflowError(f"Gate failed: appName mismatch (expected {app_name}, got {payload.get('appName', '')})")
    if payload.get("requirementsSha256") != requirements_sha256:
        raise WorkflowError("Gate failed: requirementsSha256 mismatch")
    ensure_non_empty(payload.get("approvedBy"), "Gate failed: approvedBy is empty")
    ensure_non_empty(payload.get("approvedAtUtc"), "Gate failed: approvedAtUtc is empty")
    if payload.get("approvalSource") != "natural-language":
        raise WorkflowError("Gate failed: approvalSource must be natural-language")
    ensure_non_empty(payload.get("approvalText"), "Gate failed: approvalText is empty")
    if payload.get("interactionMode") != "nl-business-first":
        raise WorkflowError("Gate failed: interactionMode must be nl-business-first")
    if payload.get("businessChecklistComplete") is not True:
        raise WorkflowError("Gate failed: businessChecklistComplete must be true")
    return f"GATE_OK {app_name}"


def build_parser():
    parser = argparse.ArgumentParser(prog="workflow_cli.py")
    subparsers = parser.add_subparsers(dest="command", required=True)
    write_planning_parser = subparsers.add_parser("write-planning-state")
    write_planning_parser.add_argument("values", nargs="+")
    check_planning_parser = subparsers.add_parser("check-planning-gate")
    check_planning_parser.add_argument("app_name")
    validate_request_parser = subparsers.add_parser("validate-request-spec")
    validate_request_parser.add_argument("request_spec_file")
    validate_requirements_parser = subparsers.add_parser("validate-requirements-doc")
    validate_requirements_parser.add_argument("requirements_file")
    write_approval_parser = subparsers.add_parser("write-approval-state")
    write_approval_parser.add_argument("app_name")
    write_approval_parser.add_argument("approved_by")
    write_approval_parser.add_argument("approval_text")
    check_approval_parser = subparsers.add_parser("check-approval-gate")
    check_approval_parser.add_argument("app_name")
    return parser


def run_command(args):
    if args.command == "write-planning-state":
        return write_planning_state(args.values)
    if args.command == "check-planning-gate":
        return check_planning_gate(args.app_name)
    if args.command == "validate-request-spec":
        return validate_request_spec(args.request_spec_file)
    if args.command == "validate-requirements-doc":
        return validate_requirements_doc(args.requirements_file)
    if args.command == "write-approval-state":
        return write_approval_state(args.app_name, args.approved_by, args.approval_text)
    return check_approval_gate(args.app_name)


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = run_command(args)
    except WorkflowError as error:
        print(str(error), file=sys.stderr)
        return 1
    if result:
        print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
