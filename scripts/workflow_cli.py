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
    "## 1. Business Outcome",
    "## 2. Roles and Permitions",
    "## 3. Object Model",
    "## 4. Lifecycle and Statuses",
    "## 5. Business Logic",
    "## 6. UX Expectations",
    "## 7. Edge Cases and Exceptions",
]
REQUIRED_REQUIREMENTS_MARKERS = [
    "Minimum to create:",
    "default list columns:",
    "default filters:",
    "main form groups:",
]
REQUEST_SPEC_SECTIONS = [
    "businessOutcome",
    "rolesAndPermitions",
    "objectModel",
    "lifecycleAndStatuses",
    "businessLogic",
    "uxExpectations",
    "edgeCases",
]
ENTITY_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+(Main|Supporting) entity:", re.MULTILINE)
LOOKUPS_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Lookups\s*$", re.MULTILINE)
RELATIONSHIPS_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Relationships\s*$", re.MULTILINE)
MAIN_ENTITY_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Main entity:", re.MULTILINE)
TABLE_HEADER_RE = re.compile(
    r"^\s*\|\s*(Title|Назва)\s*\|\s*(Code|Код)\s*\|\s*(Description|Опис)\s*\|\s*(Data type|Тип)\s*\|\s*(Required|Обов’язкове)\s*\|\s*Default\s*\|",
    re.IGNORECASE,
)
UX_CARRIER_RE = re.compile(r"^[\s-]*default (list columns|filters):", re.IGNORECASE)
USR_CODE_RE = re.compile(r"\bUsr[A-Za-z0-9_]+\b")
CHECKLIST_SOURCE_RE = re.compile(r"\bconfirmed\b|\bassumed\b|complete=true|source=", re.IGNORECASE)
HTTP_URL_RE = re.compile(r"^https?://")
MODEL_DECISIONS_HEADING_RE = re.compile(r"^\s*#{2,6}\s+Model Decisions\s*$", re.MULTILINE)
MODEL_DECISIONS_SECTION_RE = re.compile(
    r"^\s*#{2,6}\s+Model Decisions\s*$\n(?P<body>.*?)(?=^\s*#{1,6}\s+\S|\Z)",
    re.MULTILINE | re.DOTALL,
)
DATAFORGE_AVAILABILITY_RE = re.compile(
    r"^\s*dataforge-availability\s*:\s*(ready|unavailable)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
CHOSEN_ACTION_RE = re.compile(r"chosen-action\s*:\s*(reuse|extend|create)\b", re.IGNORECASE)
DISCOVERY_EVIDENCE_RE = re.compile(r"discovery-evidence\s*:", re.IGNORECASE)
DISCOVERY_TOOL_SIGNAL_RE = re.compile(
    r"(application-get-list|application-get-info|dataforge-find-tables|dataforge-find-lookups|dataforge-context|get-entity-schema-properties)",
    re.IGNORECASE,
)
INITIAL_DISCOVERY_TOOL_SIGNAL_RE = re.compile(
    r"(dataforge-find-tables|dataforge-find-lookups)",
    re.IGNORECASE,
)
FOLLOW_UP_DISCOVERY_SIGNAL_RE = re.compile(
    r"(dataforge-context)",
    re.IGNORECASE,
)
SCHEMA_CONFIRMATION_SIGNAL_RE = re.compile(
    r"(dataforge-get-table-columns|dataforge-get-relations|get-entity-schema-properties|get-entity-schema-column-properties)",
    re.IGNORECASE,
)
DISCOVERY_OUTCOME_SIGNAL_RE = re.compile(
    r"(greenfield-only|no suitable candidate found)",
    re.IGNORECASE,
)
DISCOVERY_SIGNAL_RE = re.compile(
    r"(application-get-list|application-get-info|dataforge-find-tables|dataforge-find-lookups|dataforge-context|get-entity-schema-properties|greenfield-only|no suitable candidate found)",
    re.IGNORECASE,
)
DECISION_BLOCK_RE = re.compile(
    r"(^|\n)-\s*business-concept\s*:\s*(?P<business_concept>.+?)(?=\n\s*\n\s*-\s*business-concept\s*:|\n-\s*business-concept\s*:|\Z)",
    re.IGNORECASE | re.DOTALL,
)
DECISION_REQUIRED_FIELDS = (
    "business-concept",
    "candidates-considered",
    "chosen-action",
    "chosen-schema",
    "tradeoff-escalation",
    "rationale",
    "rejected-candidates",
    "candidate-fit-summary",
    "required-capabilities",
    "mismatch-evidence",
    "discovery-evidence",
)
CREATE_REJECTION_REASON_RE = re.compile(
    r"(no suitable candidate found|greenfield-only|ownership.{0,20}boundary|unwanted.{0,20}coupling|lifecycle.{0,30}mismatch|semantic.{0,20}mismatch|broader than.{0,30}scope|field.{0,20}mismatch|column.{0,20}mismatch|relation.{0,20}mismatch|status.{0,20}mismatch|shared lookup|module coupling|marketing-specific|does not match|does not fit)",
    re.IGNORECASE,
)
GENERIC_CREATE_JUSTIFICATION_RE = re.compile(
    r"(broader platform object|broader than.{0,30}needed|shared lookup|shared platform lookup|module coupling|platform module|ownership boundary|marketing-specific|custom app requested|might diverge later|shared and could change)",
    re.IGNORECASE,
)
PARTIAL_MATCH_DISMISSAL_RE = re.compile(
    r"(not a 100% match|not 100% match|not an exact match|not a perfect match|not exact enough)",
    re.IGNORECASE,
)
PRIOR_PLAN_CREATE_PREFERENCE_RE = re.compile(
    r"(agent 2|ba draft|earlier plan|previous plan|prior plan).{0,60}(preferred|chose|decided|picked|named).{0,60}(create|custom|new|Usr)",
    re.IGNORECASE,
)
CAPABILITY_COVERAGE_SIGNAL_RE = re.compile(
    r"(already satisfies|already covers|already provides|covers the approved|matches the approved|exactly matches|exact match|near-exact match|already contains.{0,40}(required|approved).{0,20}(values|lifecycle)|all required capabilities covered|only optional extra fields)",
    re.IGNORECASE,
)
EXTENDABLE_GAP_SIGNAL_RE = re.compile(
    r"(only .{0,40}(additive|additional|supplemental|extra).{0,20}(field|column|lookup|relation)|only .{0,40}would need additive (extension|adaptation)|can be added safely|safely extendable|remaining gaps are additive|missing only .{0,40}(field|column|lookup|relation)|minor localized behavior|narrow adaptation|few additive fields)",
    re.IGNORECASE,
)
CAPABILITY_FAILURE_SIGNAL_RE = re.compile(
    r"(cannot be satisfied|cannot satisfy|required capability.{0,20}(missing|cannot)|missing value|required value.{0,20}missing|forbidden extra semantics|unavoidable inherited behavior|cannot fit|cannot extend safely|not safely extendable|required event linkage.{0,20}cannot be satisfied|required lifecycle.{0,20}cannot be satisfied|inherited behavior is unacceptable|not acceptable for the approved business flow)",
    re.IGNORECASE,
)
EXTRA_REQUIRED_FIELD_RELABEL_RE = re.compile(
    r"(required.{0,40}field.{0,40}(lookup|values|references|default)|extra required field|required.{0,20}(EventType|Type|Category|Kind).{0,40}(lookup|values|marketing|domain)|field.{0,40}existing.{0,20}lookup.{0,20}values|can be defaulted at page)",
    re.IGNORECASE,
)
USER_CONFIRMED_CREATE_RE = re.compile(
    r"(user confirmed create|user chose create|developer confirmed create|user explicitly (chose|confirmed|requested|approved) create|user approved create|user rejected reuse|create confirmed by (user|developer))",
    re.IGNORECASE,
)
LOOKUP_EXACT_MATCH_SIGNAL_RE = re.compile(
    r"(exact lookup match|exactly matches the approved lifecycle|already contains.{0,40}(in progress|completed|canceled|cancelled)|matches the approved lifecycle|same lifecycle values|same values)",
    re.IGNORECASE,
)
MOST_SIMILAR_SELECTION_SIGNAL_RE = re.compile(
    r"(most similar candidate|best match from live DataForge discovery|best match among discovered candidates|strongest semantic match|strongest match from discovery|no other candidate provided a better match than)",
    re.IGNORECASE,
)
REJECTED_MOST_SIMILAR_CANDIDATE_RE = re.compile(
    r"(?P<candidate>[A-Za-z0-9_]+)\s+(?:was|is)\s+the\s+(?:most similar candidate|best match(?: from live DataForge discovery)?|strongest semantic match(?: from discovery)?)",
    re.IGNORECASE,
)
SCHEMA_SYNC_HEADING_RE = re.compile(r"^\s*#{2,6}\s+Ordered Schema Sync\s*$", re.MULTILINE)
SCHEMA_SYNC_SECTION_RE = re.compile(
    r"^\s*#{2,6}\s+Ordered Schema Sync\s*$\n(?P<body>.*?)(?=^\s*#{1,6}\s+\S|\Z)",
    re.MULTILINE | re.DOTALL,
)
SCHEMA_STEP_RE = re.compile(
    r"(?P<action>create|extend|reuse|update)[^`\n]*?(?P<schema>Usr[A-Za-z0-9_]+)",
    re.IGNORECASE,
)


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


def extract_decision_field(block_text, field_name):
    match = re.search(rf"{re.escape(field_name)}\s*:\s*(.+)", block_text, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip()


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
        raise WorkflowError("Requirements doc failed: missing 'Main entity' subsection in section 3")
    if not LOOKUPS_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing Lookups subsection in section 3")
    if not RELATIONSHIPS_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing Relationships subsection in section 3")
    section1_text = extract_section(text, "## 1. Business Outcome", "## 2. Roles and Permitions")
    section2_text = extract_section(text, "## 2. Roles and Permitions", "## 3. Object Model")
    section3_text = extract_section(text, "## 3. Object Model", "## 4. Lifecycle and Statuses")
    section4_text = extract_section(text, "## 4. Lifecycle and Statuses", "## 5. Business Logic")
    section5_text = extract_section(text, "## 5. Business Logic", "## 6. UX Expectations")
    section6_text = extract_section(text, "## 6. UX Expectations", "## 7. Edge Cases and Exceptions")
    section7_text = extract_section(text, "## 7. Edge Cases and Exceptions")
    for section_text in (section1_text, section2_text, section4_text, section5_text, section6_text, section7_text):
        if re.search(r"^[ \t]*\|", section_text, re.MULTILINE):
            raise WorkflowError("Requirements doc failed: markdown tables are allowed only in section 3 object model")
    if not re.search(r"^[ \t]*\|[ \t]*(Title|Назва)[ \t]*\|[ \t]*(Code|Код)[ \t]*\|[ \t]*(Description|Опис)[ \t]*\|", section3_text, re.IGNORECASE | re.MULTILINE):
        raise WorkflowError("Requirements doc failed: section 3 must include a field table with the required columns")
    lines = section3_text.splitlines()
    entity_indices = [index for index, line in enumerate(lines) if ENTITY_HEADING_RE.search(line)]
    if not entity_indices:
        raise WorkflowError("Requirements doc failed: section 3 must contain at least one main or supporting entity heading")
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
    if USR_CODE_RE.search(section6_text):
        raise WorkflowError("Requirements doc failed: section 6 must use business titles instead of Usr* codes")
    if CHECKLIST_SOURCE_RE.search(text):
        raise WorkflowError("Requirements doc failed: business plan must not expose checklist-source or validation markers")
    section3_text_lower = section3_text.lower()
    for line in section6_text.splitlines():
        if not UX_CARRIER_RE.search(line):
            continue
        values = normalize_title_list(re.sub(r"^[\s-]*default [^:]*:\s*", "", line, count=1, flags=re.IGNORECASE))
        for title in values:
            if title == "Name":
                continue
            if title.lower() not in section3_text_lower:
                raise WorkflowError(f"Requirements doc failed: UX title '{title}' must have a carrier in section 3 object model")
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
    planning_signals = payload.get("planningSignals")
    if not isinstance(planning_signals, dict):
        raise WorkflowError("Request spec failed: planningSignals must be an object")
    reuse_check_required = planning_signals.get("reuseCheckRequired")
    if not isinstance(reuse_check_required, list):
        raise WorkflowError("Request spec failed: planningSignals.reuseCheckRequired must be an array")
    for index, signal in enumerate(reuse_check_required):
        if not isinstance(signal, dict):
            raise WorkflowError(f"Request spec failed: planningSignals.reuseCheckRequired[{index}] must be an object")
        business_concept = signal.get("businessConcept")
        why_ambiguous = signal.get("whyAmbiguous")
        suspected_candidates = signal.get("suspectedCandidates")
        if not isinstance(business_concept, str) or len(business_concept) == 0:
            raise WorkflowError(
                f"Request spec failed: planningSignals.reuseCheckRequired[{index}].businessConcept must be a non-empty string"
            )
        if not isinstance(why_ambiguous, str) or len(why_ambiguous) == 0:
            raise WorkflowError(
                f"Request spec failed: planningSignals.reuseCheckRequired[{index}].whyAmbiguous must be a non-empty string"
            )
        if not isinstance(suspected_candidates, list) or any(
            not isinstance(item, str) or len(item) == 0 for item in suspected_candidates
        ):
            raise WorkflowError(
                f"Request spec failed: planningSignals.reuseCheckRequired[{index}].suspectedCandidates must be an array of non-empty strings"
            )
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


def validate_implementation_plan_doc(plan_file):
    path = Path(plan_file)
    if not path.is_file():
        raise WorkflowError(f"Implementation plan failed: file not found: {plan_file}")
    text = path.read_text(encoding="utf-8")
    dataforge_availability_match = DATAFORGE_AVAILABILITY_RE.search(text)
    dataforge_availability = dataforge_availability_match.group(1).lower() if dataforge_availability_match else None
    dataforge_unavailable = dataforge_availability == "unavailable"
    if not MODEL_DECISIONS_HEADING_RE.search(text):
        raise WorkflowError("Implementation plan failed: missing required section: Model Decisions")
    section_match = MODEL_DECISIONS_SECTION_RE.search(text)
    if not section_match:
        raise WorkflowError("Implementation plan failed: could not read Model Decisions content")
    section_text = section_match.group("body")
    decision_blocks = list(DECISION_BLOCK_RE.finditer(section_text))
    if not decision_blocks:
        raise WorkflowError("Implementation plan failed: Model Decisions must include at least one decision record starting with '- business-concept:'")
    chosen_schemas = set()
    for block_match in decision_blocks:
        block_text = block_match.group(0)
        missing_fields = [field for field in DECISION_REQUIRED_FIELDS if not re.search(rf"{re.escape(field)}\s*:", block_text, re.IGNORECASE)]
        if missing_fields:
            raise WorkflowError(
                "Implementation plan failed: each Model Decisions record must include: "
                + ", ".join(DECISION_REQUIRED_FIELDS)
            )
        chosen_action_match = re.search(r"chosen-action\s*:\s*(reuse|extend|create)\b", block_text, re.IGNORECASE)
        chosen_schema_match = re.search(r"chosen-schema\s*:\s*([A-Za-z0-9_]+)", block_text, re.IGNORECASE)
        candidates_considered = extract_decision_field(block_text, "candidates-considered")
        discovery_evidence = extract_decision_field(block_text, "discovery-evidence")
        rejected_candidates = extract_decision_field(block_text, "rejected-candidates")
        mismatch_evidence = extract_decision_field(block_text, "mismatch-evidence")
        tradeoff_escalation = extract_decision_field(block_text, "tradeoff-escalation")
        if (
            not chosen_action_match
            or not chosen_schema_match
            or candidates_considered is None
            or discovery_evidence is None
            or rejected_candidates is None
            or mismatch_evidence is None
            or tradeoff_escalation is None
        ):
            raise WorkflowError("Implementation plan failed: could not parse required Model Decisions fields")
        chosen_action = chosen_action_match.group(1).lower()
        chosen_schema = chosen_schema_match.group(1)
        tradeoff_escalation = tradeoff_escalation.lower()
        chosen_schemas.add(chosen_schema.lower())
        if tradeoff_escalation not in {"none", "user-confirmation-required"}:
            raise WorkflowError(
                "Implementation plan failed: tradeoff-escalation must be `none` or `user-confirmation-required`"
            )
        if tradeoff_escalation == "user-confirmation-required":
            raise WorkflowError(
                "Implementation plan failed: tradeoff-escalation is user-confirmation-required; persist the user decision before passing the implementation plan gate"
            )
        if not dataforge_unavailable:
            if not DISCOVERY_SIGNAL_RE.search(discovery_evidence):
                raise WorkflowError(
                    "Implementation plan failed: each discovery-evidence field must cite read-only discovery or an explicit greenfield-only / no suitable candidate found outcome"
                )
            if not DISCOVERY_TOOL_SIGNAL_RE.search(discovery_evidence):
                raise WorkflowError(
                    "Implementation plan failed: discovery-evidence must cite at least one attempted tool call "
                    "(dataforge-find-tables, dataforge-find-lookups, dataforge-context, application-get-info, "
                    "application-get-list, get-entity-schema-properties). "
                    "Outcome-only evidence (greenfield-only, no suitable candidate found) is not sufficient."
                )
            if not INITIAL_DISCOVERY_TOOL_SIGNAL_RE.search(discovery_evidence):
                raise WorkflowError(
                    "Implementation plan failed: discovery-evidence must cite at least one initial discovery tool "
                    "(dataforge-find-tables or dataforge-find-lookups)"
                )
        combined_evidence = f"{discovery_evidence} {mismatch_evidence}"
        full_decision_text = f"{candidates_considered} {rejected_candidates} {extract_decision_field(block_text, 'candidate-fit-summary') or ''} {extract_decision_field(block_text, 'required-capabilities') or ''} {mismatch_evidence}"
        is_greenfield_only = bool(
            re.search(r"greenfield-only", candidates_considered, re.IGNORECASE)
            or re.search(r"greenfield-only", rejected_candidates, re.IGNORECASE)
            or re.search(r"greenfield-only", mismatch_evidence, re.IGNORECASE)
            or re.search(r"greenfield-only", discovery_evidence, re.IGNORECASE)
            or re.search(r"no suitable candidate found", rejected_candidates, re.IGNORECASE)
            or re.search(r"no suitable candidate found", discovery_evidence, re.IGNORECASE)
        )
        if chosen_action == "create":
            rejection_text = f"{rejected_candidates} {mismatch_evidence}"
            if not CREATE_REJECTION_REASON_RE.search(rejection_text):
                raise WorkflowError(
                    "Implementation plan failed: chosen-action: create must state why reuse or extension was rejected"
                )
        if not is_greenfield_only and not dataforge_unavailable:
            if not FOLLOW_UP_DISCOVERY_SIGNAL_RE.search(combined_evidence):
                raise WorkflowError(
                    "Implementation plan failed: strong candidates require follow-up evidence via dataforge-context before locking reuse, extend, or create"
                )
            if not SCHEMA_CONFIRMATION_SIGNAL_RE.search(combined_evidence):
                raise WorkflowError(
                    "Implementation plan failed: strong candidates require schema-level confirmation before locking reuse, extend, or create"
                )
            if chosen_action == "create":
                rationale = extract_decision_field(block_text, "rationale") or ""
                full_decision_text_with_rationale = f"{full_decision_text} {rationale}"
                has_generic_create_only_reason = bool(GENERIC_CREATE_JUSTIFICATION_RE.search(rejection_text))
                has_partial_match_dismissal = bool(PARTIAL_MATCH_DISMISSAL_RE.search(full_decision_text))
                has_prior_plan_create_preference = bool(PRIOR_PLAN_CREATE_PREFERENCE_RE.search(full_decision_text))
                has_capability_failure = bool(CAPABILITY_FAILURE_SIGNAL_RE.search(full_decision_text))
                has_extra_required_field_relabel = bool(EXTRA_REQUIRED_FIELD_RELABEL_RE.search(full_decision_text))
                has_user_confirmed_create = bool(USER_CONFIRMED_CREATE_RE.search(full_decision_text_with_rationale))
                candidate_already_covers_capabilities = bool(CAPABILITY_COVERAGE_SIGNAL_RE.search(full_decision_text))
                only_additive_or_extendable_gaps = bool(EXTENDABLE_GAP_SIGNAL_RE.search(full_decision_text))
                exact_lookup_match = bool(LOOKUP_EXACT_MATCH_SIGNAL_RE.search(full_decision_text))
                most_similar_selection = bool(MOST_SIMILAR_SELECTION_SIGNAL_RE.search(full_decision_text))
                if has_capability_failure and has_extra_required_field_relabel:
                    raise WorkflowError(
                        "Implementation plan failed: create decision uses a capability-failure phrase "
                        "(e.g. 'forbidden extra semantics') but the mismatch describes an extra required "
                        "field with existing lookup values — extra required fields with existing lookup "
                        "references are page-level concerns, not capability failures that justify create"
                    )
                if only_additive_or_extendable_gaps and not has_capability_failure:
                    raise WorkflowError(
                        "Implementation plan failed: strong candidates with only additive or extendable gaps must resolve to reuse, even if the candidate is not a 100% match or an earlier plan preferred create"
                    )
                if candidate_already_covers_capabilities and not has_capability_failure:
                    raise WorkflowError(
                        "Implementation plan failed: reuse-first policy requires reuse when the candidate already covers the required capabilities"
                    )
                if exact_lookup_match and not has_capability_failure:
                    raise WorkflowError(
                        "Implementation plan failed: exact or near-exact lookup matches must default to reuse unless explicit missing capability or unacceptable inherited behavior is proven"
                    )
                if (has_partial_match_dismissal or has_prior_plan_create_preference) and not has_capability_failure:
                    raise WorkflowError(
                        "Implementation plan failed: create cannot be justified by 'not a 100% match' reasoning or by an earlier Agent 2 / BA placeholder decision when live discovery still shows a strong reusable candidate"
                    )
                if has_generic_create_only_reason and not has_capability_failure:
                    raise WorkflowError(
                        "Implementation plan failed: create cannot rely only on broader/shared/module-coupling reasoning without a concrete capability failure under the reuse-first policy"
                    )
                if not has_user_confirmed_create:
                    raise WorkflowError(
                        "Implementation plan failed: create against a discovered strong candidate "
                        "requires explicit user confirmation — the agent must present both options "
                        "(reuse vs create) to the user and record the confirmation in the rationale "
                        "field (e.g. 'user confirmed create over reuse')"
                    )
            if chosen_action == "extend":
                has_capability_failure = bool(CAPABILITY_FAILURE_SIGNAL_RE.search(full_decision_text))
                candidate_already_covers_capabilities = bool(CAPABILITY_COVERAGE_SIGNAL_RE.search(full_decision_text))
                only_additive_or_extendable_gaps = bool(EXTENDABLE_GAP_SIGNAL_RE.search(full_decision_text))
                exact_lookup_match = bool(LOOKUP_EXACT_MATCH_SIGNAL_RE.search(full_decision_text))
                most_similar_selection = bool(MOST_SIMILAR_SELECTION_SIGNAL_RE.search(full_decision_text))
                if (
                    not has_capability_failure
                    and (
                        candidate_already_covers_capabilities
                        or only_additive_or_extendable_gaps
                        or exact_lookup_match
                        or most_similar_selection
                    )
                ):
                    raise WorkflowError(
                        "Implementation plan failed: strong candidates resolved by live DataForge discovery must resolve to reuse; extend is not allowed once the most similar candidate is confirmed"
                    )
            if chosen_action == "reuse":
                rejected_most_similar_match = REJECTED_MOST_SIMILAR_CANDIDATE_RE.search(rejected_candidates)
                if rejected_most_similar_match and rejected_most_similar_match.group("candidate").lower() != chosen_schema.lower():
                    raise WorkflowError(
                        "Implementation plan failed: when multiple strong candidates exist, the plan must reuse the most similar candidate surfaced by discovery"
                    )
    schema_sync_match = SCHEMA_SYNC_SECTION_RE.search(text)
    if schema_sync_match:
        schema_sync_text = schema_sync_match.group("body")
        for step_match in SCHEMA_STEP_RE.finditer(schema_sync_text):
            action = step_match.group("action").lower()
            schema = step_match.group("schema").lower()
            if action in {"create", "extend", "update"} and schema not in chosen_schemas:
                raise WorkflowError(
                    f"Implementation plan failed: Ordered Schema Sync references {step_match.group('schema')} without a matching Model Decisions record"
                )
    return f"IMPLEMENTATION_PLAN_OK {plan_file}"


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


def check_implementation_plan_gate(app_name):
    check_approval_gate(app_name)
    plan_file_text = output_file_text(app_name, "plan.md")
    if not Path(plan_file_text).is_file():
        raise WorkflowError(f"Implementation plan gate failed: plan.md not found: {plan_file_text}")
    validate_implementation_plan_doc(plan_file_text)
    return f"IMPLEMENTATION_PLAN_GATE_OK {app_name}"


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
    validate_implementation_plan_parser = subparsers.add_parser("validate-implementation-plan-doc")
    validate_implementation_plan_parser.add_argument("plan_file")
    write_approval_parser = subparsers.add_parser("write-approval-state")
    write_approval_parser.add_argument("app_name")
    write_approval_parser.add_argument("approved_by")
    write_approval_parser.add_argument("approval_text")
    check_approval_parser = subparsers.add_parser("check-approval-gate")
    check_approval_parser.add_argument("app_name")
    check_implementation_plan_parser = subparsers.add_parser("check-implementation-plan-gate")
    check_implementation_plan_parser.add_argument("app_name")
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
    if args.command == "validate-implementation-plan-doc":
        return validate_implementation_plan_doc(args.plan_file)
    if args.command == "write-approval-state":
        return write_approval_state(args.app_name, args.approved_by, args.approval_text)
    if args.command == "check-approval-gate":
        return check_approval_gate(args.app_name)
    if args.command == "check-implementation-plan-gate":
        return check_implementation_plan_gate(args.app_name)
    raise ValueError(f"Unknown command: {args.command}")


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
