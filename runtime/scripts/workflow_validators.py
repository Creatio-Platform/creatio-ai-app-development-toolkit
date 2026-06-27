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
    "list columns:",
]

OBJECT_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+(Section object|Object):", re.MULTILINE)
LOOKUPS_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Lookups\s*$", re.MULTILINE)
SECTION_OBJECT_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Section object:", re.MULTILINE)
TABLE_HEADER_RE = re.compile(
    r"^\s*\|\s*Title\s*\|\s*Code\s*\|\s*Description\s*\|\s*Data type\s*\|\s*Required\s*\|\s*Default\s*\|",
    re.IGNORECASE,
)
UX_CARRIER_RE = re.compile(r"^[\s-]*list (columns|filters):", re.IGNORECASE)
CHECKLIST_SOURCE_RE = re.compile(
    r"(?:^|\n)\s*(?:"
    r"source\s*[:=]\s*[\"']?(?:confirmed|assumed)[\"']?"
    r"|confirmed\s*:"
    r"|assumed\s*:"
    r"|complete\s*=\s*true"
    r")",
    re.IGNORECASE,
)


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


def validate_requirements_doc(content: str) -> None:
    text = content
    if not re.search(r"^# .+ - Requirements$", text, re.MULTILINE):
        raise WorkflowError("Requirements doc failed: title must match '# <AppName> - Requirements'")
    for section in REQUIRED_REQUIREMENTS_SECTIONS:
        if section not in text:
            raise WorkflowError(f"Requirements doc failed: missing required section: {section}")
    for marker in REQUIRED_REQUIREMENTS_MARKERS:
        if marker not in text:
            raise WorkflowError(f"Requirements doc failed: missing required marker: {marker}")
    if not SECTION_OBJECT_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing 'Section object' subsection in section 3")
    if not LOOKUPS_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing Lookups subsection in section 3")
    section1_text = extract_section(text, "## 1. Business Outcome", "## 2. Roles and Permissions")
    section2_text = extract_section(text, "## 2. Roles and Permissions", "## 3. Object Model")
    section3_text = extract_section(text, "## 3. Object Model", "## 4. Lifecycle and Statuses")
    section4_text = extract_section(text, "## 4. Lifecycle and Statuses", "## 5. Business Logic")
    section5_text = extract_section(text, "## 5. Business Logic", "## 6. UX Expectations")
    section6_text = extract_section(text, "## 6. UX Expectations", "## 7. Edge Cases and Exceptions")
    section7_text = extract_section(text, "## 7. Edge Cases and Exceptions")
    lines = section3_text.splitlines()
    object_indices = [index for index, line in enumerate(lines) if OBJECT_HEADING_RE.search(line)]
    if not object_indices:
        raise WorkflowError("Requirements doc failed: section 3 must contain at least one Section object or Object heading")
    for pos, start in enumerate(object_indices):
        end = object_indices[pos + 1] if pos + 1 < len(object_indices) else len(lines)
        block = lines[start:end]
        block_text = "\n".join(block)
        for marker in ("Title:", "Code:", "Primary display field:", "Description:"):
            if marker not in block_text:
                raise WorkflowError(
                    f"Requirements doc failed: object block starting at '{lines[start]}' is missing metadata marker '{marker}'"
                )
        if not any(TABLE_HEADER_RE.search(line) for line in block):
            raise WorkflowError(
                f"Requirements doc failed: object block starting at '{lines[start]}' must include its own field table"
            )
    ba_body = text.split("## Technical Implementation Handoff")[0] if "## Technical Implementation Handoff" in text else text
    checklist_match = CHECKLIST_SOURCE_RE.search(ba_body)
    if checklist_match:
        raise WorkflowError(
            f"Requirements doc failed: forbidden service marker detected: '{checklist_match.group().strip()}'"
        )
    section3_text_lower = section3_text.lower()
    for line in section6_text.splitlines():
        if not UX_CARRIER_RE.search(line):
            continue
        values = normalize_title_list(re.sub(r"^[\s-]*list [^:]*:\s*", "", line, count=1, flags=re.IGNORECASE))
        for title in values:
            if title == "Name":
                continue
            if title.lower() not in section3_text_lower:
                raise WorkflowError(f"Requirements doc failed: UX title '{title}' must have a carrier in section 3 object model")
    # Section 6 lists one block per record surface, each introduced by a
    # `Section <name>` or `Related list <name>` heading; a block runs until the
    # next surface heading of either kind. An inline related list edits in the
    # grid, so it must not also carry a page/form label -- but only its OWN
    # block is checked, never a trailing Section's labels.
    surface_re = re.compile(r"(?im)^[\s\-*>#]*\**\s*(Section|Related list)\b")
    inline_re = re.compile(r"(?im)^[\s\-*]*add/edit:\s*inline\b")
    page_label_re = re.compile(r"(?im)^[\s\-*]*(?:form fields:|form groups:|add page:|edit page:)")
    surfaces = list(surface_re.finditer(section6_text))
    for idx, match in enumerate(surfaces):
        if match.group(1).lower() != "related list":
            continue
        block_end = surfaces[idx + 1].start() if idx + 1 < len(surfaces) else len(section6_text)
        block = section6_text[match.end():block_end]
        if inline_re.search(block) and page_label_re.search(block):
            raise WorkflowError(
                "Requirements doc failed: an inline related list must not also list form fields / form groups / add page / edit page (inline add/edit happens in the grid; those labels imply a separate page)"
            )

