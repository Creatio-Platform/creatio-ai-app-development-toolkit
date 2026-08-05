import re


class WorkflowError(Exception):
    pass


UX_HEADING = "## 6. UX Expectations"
ANALYTICS_HEADING = "## 7. Analytics"
EDGE_CASES_HEADING = "## 8. Edge Cases and Exceptions"

REQUIRED_REQUIREMENTS_SECTIONS = [
    "## 1. Business Outcome",
    "## 2. Roles and Permissions",
    "## 3. Object Model",
    "## 4. Lifecycle and Statuses",
    "## 5. Business Logic",
    UX_HEADING,
    ANALYTICS_HEADING,
    EDGE_CASES_HEADING,
]
REQUIRED_REQUIREMENTS_MARKERS = [
    "Minimum to create:",
]

OBJECT_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+(Section object|Object):", re.MULTILINE)
LOOKUPS_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Lookups\s*$", re.MULTILINE)
SECTION_OBJECT_HEADING_RE = re.compile(r"^\s*#{3,6}\s+3\.\d+\s+Section object:", re.MULTILINE)
TABLE_HEADER_RE = re.compile(
    r"^\s*\|\s*Title\s*\|\s*Code\s*\|\s*Description\s*\|\s*Data type\s*\|\s*Required\s*\|\s*Default\s*\|",
    re.IGNORECASE,
)
UX_CARRIER_RE = re.compile(r"^[\s-]*list (columns|filters):", re.IGNORECASE)
# `list columns:` must be present as a real line-anchored label. A plain
# substring test ("list columns:" in text) is wrong because the retired label
# `default list columns:` ends with it, so an un-migrated doc would pass silently.
LIST_COLUMNS_LABEL_RE = re.compile(r"(?im)^[\s\-*>#]*list columns:")
# The retired `default list columns:` / `default list filters:` labels were
# renamed to `list columns:` / `list filters:`; reject the old form with a
# helpful migration error instead of letting it slip through.
RETIRED_LIST_LABEL_RE = re.compile(r"(?im)^[\s\-*>#]*default list (?:columns|filters):")
CHECKLIST_SOURCE_RE = re.compile(
    r"(?:^|\n)\s*(?:"
    r"source\s*[:=]\s*[\"']?(?:confirmed|assumed)[\"']?"
    r"|confirmed\s*:"
    r"|assumed\s*:"
    r"|complete\s*=\s*true"
    r")",
    re.IGNORECASE,
)


# Section 6 record-surface scoping for the inline-related-list conflict check.
# A surface heading is `Section <name>` / `Related list <name>`; the lookahead
# requires a following name token so prose like "Section 3 is ..." is not a heading.
# Require a name token after the keyword (excludes a bare "Section"/"Related list"),
# but NOT a letter-only name: a surface name may start with a digit (e.g.
# "360 Reviews") or be non-Latin (Cyrillic), and dropping such a heading would let
# an adjacent inline list absorb its labels and raise a FALSE conflict.
# The prefix class includes the backtick because the §6 contract renders a surface
# bullet as `- **`Related list <name>`**` (bold + code), so the keyword sits behind
# `- **``; without the backtick the regex misses every contract-conforming heading
# and the conflict check below becomes a no-op.
SURFACE_HEADING_RE = re.compile(r"(?im)^[\s\-*>#`]*(Section|Related list)\b(?=\s+\S)")
INLINE_INTERACTION_RE = re.compile(r"(?im)^[\s\-*`]*add/edit:\s*inline\b")
PAGE_FORM_LABEL_RE = re.compile(r"(?im)^[\s\-*`]*(?:form fields:|form groups:|add page:|edit page:)")

# Section 7 Analytics contract. The agent must ALWAYS propose analytics as a
# domain expert, so the section is mandatory AND must be populated: both the
# section-level (7.1) and workplace-level (7.2) subsections must be present, and
# at least one concrete dashboard (with its widgets) must be described. These
# checks enforce "the section is filled", not merely "the heading exists".
ANALYTICS_SECTION_SUBHEADING_RE = re.compile(r"(?im)^\s*#{3,6}\s+7\.1\s+Section analytics\b")
ANALYTICS_WORKPLACE_SUBHEADING_RE = re.compile(r"(?im)^\s*#{3,6}\s+7\.2\s+Workplace analytics\b")
DASHBOARD_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*dashboard:")
DASHBOARD_WIDGETS_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*widgets:")
# Every dashboard must state its access rights in the plan (default All Employees,
# narrowed to serves role for sensitive data) so the developer sees who each
# dashboard is visible to before approval, and the implementation applies exactly
# that via dashboard-rights.
DASHBOARD_ACCESS_RIGHTS_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*access rights:")
# Section analytics (7.1) must be grouped by section under a
# `#### <Section> section dashboards` heading, so it is explicit which section
# hosts each dashboard — never a flat list. Match the grouping heading.
SECTION_DASHBOARD_GROUP_RE = re.compile(r"(?im)^\s*#{3,6}[ \t]+\S[^\n]*\bsection dashboards\b")


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
    if RETIRED_LIST_LABEL_RE.search(text):
        raise WorkflowError(
            "Requirements doc failed: retired label 'default list columns:'/'default list filters:' is no longer accepted; use 'list columns:' / 'list filters:' (drop the 'default ' prefix)"
        )
    if not LIST_COLUMNS_LABEL_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing required marker: list columns:")
    if not SECTION_OBJECT_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing 'Section object' subsection in section 3")
    if not LOOKUPS_HEADING_RE.search(text):
        raise WorkflowError("Requirements doc failed: missing Lookups subsection in section 3")
    section3_text = extract_section(text, "## 3. Object Model", "## 4. Lifecycle and Statuses")
    section6_text = extract_section(text, UX_HEADING, ANALYTICS_HEADING)
    section7_analytics_text = extract_section(text, ANALYTICS_HEADING, EDGE_CASES_HEADING)
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
    # Section 6 lists one block per record surface. A surface heading is a
    # top-level bullet (`- **`Section <name>`**` / `- **`Related list <name>`**`).
    # A surface's block is its OWN indented sub-bullets only: it ends at the next
    # line whose indentation is no deeper than the heading (a sibling top-level
    # bullet or the next heading). Scoping by indentation rather than "up to the
    # next heading" stops a heading-less surface -- the section object or the
    # "single full page" option, both described with bare top-level
    # `form groups:` bullets -- from being absorbed and raising a false conflict.
    # An inline related list edits in the grid, so its block must not also carry
    # a page/form label.
    s6_lines = section6_text.splitlines()
    for idx, line in enumerate(s6_lines):
        match = SURFACE_HEADING_RE.match(line)
        if not match or match.group(1).lower() != "related list":
            continue
        heading_indent = len(line) - len(line.lstrip())
        block_lines = []
        for nxt in s6_lines[idx + 1:]:
            if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= heading_indent:
                break
            block_lines.append(nxt)
        block = "\n".join(block_lines)
        if INLINE_INTERACTION_RE.search(block) and PAGE_FORM_LABEL_RE.search(block):
            raise WorkflowError(
                "Requirements doc failed: an inline related list must not also list form fields / form groups / add page / edit page (inline add/edit happens in the grid; those labels imply a separate page)"
            )
    # Section 7 Analytics must be populated, not a placeholder. The agent always
    # proposes analytics as a domain expert, so both subsections must exist and at
    # least one concrete dashboard with its widgets must be described.
    if not ANALYTICS_SECTION_SUBHEADING_RE.search(section7_analytics_text):
        raise WorkflowError("Requirements doc failed: section 7 Analytics is missing its '### 7.1 Section analytics' subsection")
    if not ANALYTICS_WORKPLACE_SUBHEADING_RE.search(section7_analytics_text):
        raise WorkflowError("Requirements doc failed: section 7 Analytics is missing its '### 7.2 Workplace analytics' subsection")
    dashboard_positions = [m.start() for m in DASHBOARD_LABEL_RE.finditer(section7_analytics_text)]
    if not dashboard_positions:
        raise WorkflowError("Requirements doc failed: section 7 Analytics must describe at least one 'dashboard:' (the section is mandatory and must be populated, not left empty)")
    # Enforce `widgets:` per dashboard, not once for the whole section: each block
    # runs from one `dashboard:` label to the next, and each must carry its own
    # `widgets:` line (a two-dashboard plan where only one lists widgets is invalid).
    for i, start in enumerate(dashboard_positions):
        end = dashboard_positions[i + 1] if i + 1 < len(dashboard_positions) else len(section7_analytics_text)
        block = section7_analytics_text[start:end]
        if not DASHBOARD_WIDGETS_LABEL_RE.search(block):
            raise WorkflowError("Requirements doc failed: every dashboard in section 7 Analytics must list its own 'widgets:' line")
        if not DASHBOARD_ACCESS_RIGHTS_LABEL_RE.search(block):
            raise WorkflowError("Requirements doc failed: every dashboard in section 7 Analytics must state its own 'access rights:' line (who it is visible to; default 'All Employees', narrowed to the serving role for sensitive data)")
    # Both subsections must be independently populated: a section-wide dashboard
    # count would let a hollow 7.1 (grouping heading, zero dashboards, all dashboards
    # under 7.2) or an empty 7.2 pass. Slice §7 at the subheadings and require at
    # least one `dashboard:` in EACH region.
    m71 = ANALYTICS_SECTION_SUBHEADING_RE.search(section7_analytics_text)
    m72 = ANALYTICS_WORKPLACE_SUBHEADING_RE.search(section7_analytics_text)
    section_71_text = section7_analytics_text[m71.end():(m72.start() if m72 else len(section7_analytics_text))]
    section_72_text = section7_analytics_text[m72.end():] if m72 else ""
    if not DASHBOARD_LABEL_RE.search(section_71_text):
        raise WorkflowError("Requirements doc failed: section 7.1 Section analytics must contain at least one 'dashboard:' (per-section dashboards are mandatory, not just a grouping heading)")
    if not DASHBOARD_LABEL_RE.search(section_72_text):
        raise WorkflowError("Requirements doc failed: section 7.2 Workplace analytics must contain at least one 'dashboard:' (it must not be left empty)")
    # The section-grouping rule applies to 7.1 only, so scope the check to the 7.1
    # slice. Searching the whole §7 body would let a flat 7.1 pass whenever any
    # grouping heading appears anywhere under 7.2.
    if not SECTION_DASHBOARD_GROUP_RE.search(section_71_text):
        raise WorkflowError("Requirements doc failed: section 7.1 Section analytics must group dashboards by section under a '#### <Section> section dashboards' heading (so it is explicit which section hosts each dashboard), not a flat list")

