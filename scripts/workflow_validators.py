import re


class WorkflowError(Exception):
    pass


REQUIRED_REQUIREMENTS_SECTIONS = [
    "## 1. Business Outcome",
    "## 2. Roles and Permissions",
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
    "rolesAndPermissions",
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
    r"^\s*\|\s*Title\s*\|\s*Code\s*\|\s*Description\s*\|\s*Data type\s*\|\s*Required\s*\|\s*Default\s*\|",
    re.IGNORECASE,
)
UX_CARRIER_RE = re.compile(r"^[\s-]*default (list columns|filters):", re.IGNORECASE)
USR_CODE_RE = re.compile(r"\bUsr[A-Za-z0-9_]+\b")
CHECKLIST_SOURCE_RE = re.compile(r"\bconfirmed\b|\bassumed\b|complete=true|source=", re.IGNORECASE)
HTTP_URL_RE = re.compile(r"^https?://")


def extract_section(text, start_heading, end_heading=None):
    lines = text.splitlines()
    capture = False
    captured = []
    for line in lines:
        if line.rstrip() == start_heading:
            capture = True
            continue
        if capture and end_heading and line.rstrip() == end_heading:
            break
        if capture:
            captured.append(line)
    return "\n".join(captured)


def normalize_title_list(text):
    return [item.strip() for item in text.split(",") if item.strip()]


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


def validate_requirements_doc(content: str) -> None:
    text = content
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
    section1_text = extract_section(text, "## 1. Business Outcome", "## 2. Roles and Permissions")
    section2_text = extract_section(text, "## 2. Roles and Permissions", "## 3. Object Model")
    section3_text = extract_section(text, "## 3. Object Model", "## 4. Lifecycle and Statuses")
    section4_text = extract_section(text, "## 4. Lifecycle and Statuses", "## 5. Business Logic")
    section5_text = extract_section(text, "## 5. Business Logic", "## 6. UX Expectations")
    section6_text = extract_section(text, "## 6. UX Expectations", "## 7. Edge Cases and Exceptions")
    section7_text = extract_section(text, "## 7. Edge Cases and Exceptions")
    for section_text in (section1_text, section2_text, section4_text, section5_text, section6_text, section7_text):
        if re.search(r"^[ \t]*\|", section_text, re.MULTILINE):
            raise WorkflowError("Requirements doc failed: markdown tables are allowed only in section 3 object model")
    if not re.search(r"^[ \t]*\|[ \t]*Title[ \t]*\|[ \t]*Code[ \t]*\|[ \t]*Description[ \t]*\|", section3_text, re.IGNORECASE | re.MULTILINE):
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


def validate_request_spec(spec: dict) -> None:
    payload = spec
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
        environment_mode = "planning-first"
    if environment_mode not in {"planning-first"}:
        raise WorkflowError("Request spec failed: technicalInputs.environmentMode must be planning-first when provided")
    credentials_status = technical_inputs.get("credentialsStatus")
    if credentials_status not in {"provided", "missing", "existing_env", "deferred"}:
        raise WorkflowError(
            "Request spec failed: technicalInputs.credentialsStatus must be one of: provided, missing, existing_env, deferred"
        )
    if creatio_url not in (None, "") and (not isinstance(creatio_url, str) or not HTTP_URL_RE.search(creatio_url)):
        raise WorkflowError(
            "Request spec failed: technicalInputs.creatioUrl must be a valid http(s) URL when provided"
        )

