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
    re.IGNORECASE | re.MULTILINE,
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
# Each dashboard field must carry a NON-EMPTY value, not just the label: the
# trailing `[ \t]*\S` requires at least one non-space character after the colon,
# so `access rights:` / `widgets:` / `dashboard:` with nothing (or only
# whitespace) after them are rejected instead of passing as "present".
DASHBOARD_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*dashboard:[ \t]*\S")
DASHBOARD_WIDGETS_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*widgets:[ \t]*\S")
DASHBOARD_SCOPE_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*scope:[ \t]*\S")
# Start of a `widgets:` value; widgets on the line are separated by `;`.
DASHBOARD_WIDGETS_START_RE = re.compile(r"(?im)^[\s\-*>#`]*widgets:[ \t]*")
# Each §7.1 dashboard must carry a real set of widgets — at least this many
# (a metric band plus charts/lists), not one or two.
DASHBOARD_MIN_WIDGETS = 5
# Dashboard access is a STATIC default: every generated dashboard is created
# visible to `All Employees`. The plan surfaces it per dashboard for transparency,
# and because the value is a known constant we pin the exact value (not just
# "non-empty") — this both catches a typo/placeholder and prevents an agent from
# silently inventing a narrower/other grant. (The role a dashboard is for drives
# its CONTENT — which metrics/charts — not its access rights.)
DASHBOARD_ACCESS_RIGHTS_RE = re.compile(r"(?im)^[\s\-*>#`]*access rights:[ \t]*All Employees[ \t]*$")
# Any `access rights:` label (any value) — used to REJECT access rights under §7.2,
# where the home page has no per-page grant (its audience is the workplace).
ACCESS_RIGHTS_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*access rights:")
# §7.2 Workplace analytics is the app's single home page (a `BaseHomePage`) — one
# `home page:` block with its widgets, not dashboards and not access-controlled per
# page.
HOME_PAGE_LABEL_RE = re.compile(r"(?im)^[\s\-*>#`]*home page:[ \t]*\S")
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


def iter_labeled_blocks(text, start_re):
    """Yield each block of `text` delimited by `start_re` matches: block i runs from
    the i-th match's start to the next match's start (the last block runs to the end
    of `text`). Shared by the section-3 object-block and section-7 dashboard-block
    checks so the block-boundary logic lives in exactly one place."""
    starts = [m.start() for m in start_re.finditer(text)]
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        yield text[start:end]


def count_widgets(block):
    """Count the widgets on a dashboard block's `widgets:` line. Widgets are
    `;`-separated (commas may appear inside a single widget's field list), and the
    line may hard-wrap, so read from `widgets:` up to the next blank line."""
    m = DASHBOARD_WIDGETS_START_RE.search(block)
    if not m:
        return 0
    tail = re.split(r"\n[ \t]*\n", block[m.end():], maxsplit=1)[0]
    return len([w for w in tail.split(";") if w.strip()])


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
    object_blocks = list(iter_labeled_blocks(section3_text, OBJECT_HEADING_RE))
    if not object_blocks:
        raise WorkflowError("Requirements doc failed: section 3 must contain at least one Section object or Object heading")
    for block_text in object_blocks:
        # Use the first NON-BLANK line as the heading: OBJECT_HEADING_RE's leading
        # `^\s*` can consume the blank line before the heading, so a block may start
        # with an empty line — taking splitlines()[0] blindly would yield '' in the
        # error message.
        heading = next((ln for ln in block_text.splitlines() if ln.strip()), "").strip()
        for marker in ("Title:", "Code:", "Primary display field:", "Description:"):
            if marker not in block_text:
                raise WorkflowError(
                    f"Requirements doc failed: object block starting at '{heading}' is missing metadata marker '{marker}'"
                )
        if not TABLE_HEADER_RE.search(block_text):
            raise WorkflowError(
                f"Requirements doc failed: object block starting at '{heading}' must include its own field table"
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
    # Section 7 Analytics must be present and populated. The two subsections have
    # DIFFERENT shapes:
    #   7.1 Section analytics = one or more dashboards (crt.Dashboards boards on section
    #       list pages), grouped by section, each with a static `access rights: All
    #       Employees` and its own `widgets:`.
    #   7.2 Workplace analytics = the app's SINGLE home page (a BaseHomePage): one
    #       `home page:` block with its widgets — NOT dashboards, and with NO per-page
    #       `access rights:` (a home page's audience is the workplace it is bound to).
    # Capture the subheading matches at the guard and reuse them for the slices below.
    m71 = ANALYTICS_SECTION_SUBHEADING_RE.search(section7_analytics_text)
    if not m71:
        raise WorkflowError("Requirements doc failed: section 7 Analytics is missing its '### 7.1 Section analytics' subsection")
    m72 = ANALYTICS_WORKPLACE_SUBHEADING_RE.search(section7_analytics_text)
    if not m72:
        raise WorkflowError("Requirements doc failed: section 7 Analytics is missing its '### 7.2 Workplace analytics' subsection")
    # Order-independent slices: each subsection runs from its own heading to the next
    # heading (whichever comes next) or the end of §7, so 7.1/7.2 order does not matter.
    end_of_analytics = len(section7_analytics_text)
    stop_71 = m72.start() if m72.start() > m71.start() else end_of_analytics
    stop_72 = m71.start() if m71.start() > m72.start() else end_of_analytics
    section_71_text = section7_analytics_text[m71.end():stop_71]
    section_72_text = section7_analytics_text[m72.end():stop_72]

    # 7.1: at least one dashboard, grouped by section, each block complete.
    dashboard_blocks = list(iter_labeled_blocks(section_71_text, DASHBOARD_LABEL_RE))
    if not dashboard_blocks:
        raise WorkflowError("Requirements doc failed: section 7.1 Section analytics must contain at least one 'dashboard:' (per-section dashboards are mandatory, not just a grouping heading)")
    # Grouping must actually bind dashboards to headings — a single `.search()` for a
    # grouping heading anywhere is not enough (it would pass a flat list that happens
    # to carry one heading). Enforce, structurally: (a) at least one grouping heading;
    # (b) no dashboard floats before the first grouping heading; (c) every grouping
    # heading has at least one dashboard under it. (Which SECTION a dashboard belongs
    # to is the author's judgment — the validator cannot read section names — so this
    # enforces the structure, not the semantic section↔dashboard mapping.)
    group_starts = [m.start() for m in SECTION_DASHBOARD_GROUP_RE.finditer(section_71_text)]
    if not group_starts:
        raise WorkflowError("Requirements doc failed: section 7.1 Section analytics must group dashboards by section under a '#### <Section> section dashboards' heading (so it is explicit which section hosts each dashboard), not a flat list")
    if DASHBOARD_LABEL_RE.search(section_71_text[:group_starts[0]]):
        raise WorkflowError("Requirements doc failed: every section 7.1 dashboard must sit under a '#### <Section> section dashboards' heading — a 'dashboard:' appears before the first grouping heading")
    for group_block in iter_labeled_blocks(section_71_text, SECTION_DASHBOARD_GROUP_RE):
        if not DASHBOARD_LABEL_RE.search(group_block):
            raise WorkflowError("Requirements doc failed: every '#### <Section> section dashboards' heading in section 7.1 must have at least one 'dashboard:' under it (no empty grouping headings)")
    for block in dashboard_blocks:
        if not DASHBOARD_SCOPE_LABEL_RE.search(block):
            raise WorkflowError("Requirements doc failed: every dashboard in section 7.1 Section analytics must state a non-empty 'scope:' line (what the dashboard shows / the question it answers)")
        if not DASHBOARD_WIDGETS_LABEL_RE.search(block):
            raise WorkflowError("Requirements doc failed: every dashboard in section 7.1 Section analytics must list a non-empty 'widgets:' line")
        if count_widgets(block) < DASHBOARD_MIN_WIDGETS:
            raise WorkflowError(f"Requirements doc failed: every dashboard in section 7.1 Section analytics must list at least {DASHBOARD_MIN_WIDGETS} widgets (a metric band plus charts/lists), separated by ';'")
        if not DASHBOARD_ACCESS_RIGHTS_RE.search(block):
            raise WorkflowError("Requirements doc failed: every dashboard in section 7.1 Section analytics must state 'access rights: All Employees' (dashboard access is a static default — every dashboard is created visible to All Employees; the role a dashboard is for drives its content, not its access)")

    # 7.2: the app's single home page — a `home page:` block with widgets; NOT
    # dashboards, and with NO per-page access rights.
    if DASHBOARD_LABEL_RE.search(section_72_text):
        raise WorkflowError("Requirements doc failed: section 7.2 Workplace analytics is the app's home page (a single page), not dashboards — describe it as one 'home page:' with its widgets, not 'dashboard:' blocks")
    if ACCESS_RIGHTS_LABEL_RE.search(section_72_text):
        raise WorkflowError("Requirements doc failed: the app home page (section 7.2) has no per-page 'access rights:' — its audience is the workplace it is bound to; remove the access-rights line")
    home_page_blocks = list(iter_labeled_blocks(section_72_text, HOME_PAGE_LABEL_RE))
    if len(home_page_blocks) != 1:
        raise WorkflowError("Requirements doc failed: section 7.2 Workplace analytics must describe exactly one 'home page:' (the app's single home page) with its widgets")
    if not DASHBOARD_SCOPE_LABEL_RE.search(home_page_blocks[0]):
        raise WorkflowError("Requirements doc failed: the section 7.2 home page must state a non-empty 'scope:' line (what the home page shows / the question it answers)")
    if not DASHBOARD_WIDGETS_LABEL_RE.search(home_page_blocks[0]):
        raise WorkflowError("Requirements doc failed: the section 7.2 home page must list its 'widgets:'")

