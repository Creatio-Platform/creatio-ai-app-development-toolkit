"""AC-3 — checklist/router ↔ reference drift guard for the creatio-ui-guidelines skill.

The skill routes on pointers: `review-checklists.md` items and the `SKILL.md` loop
passes point to the reference section that owns each rule (`→ page-layout: <section>`
or `→ accessibility: <section>`, and in SKILL.md `→ *<section>*`). The rule text lives
once, in that section. This guard fails LOUDLY and CLOSED when a pointer rots or the
surfaces drift.

Failure modes covered:
1. A pointer targets a section that does not exist, or exists but is the wrong one —
   `test_*_pointers_resolve` (full/word-boundary-prefix match, not loose substring).
2. A pointer is mangled (`->`, wrong family, dropped colon) so it silently stops being
   a pointer — `test_no_malformed_checklist_pointers` (fail closed).
3. The router surface (SKILL.md) rots when a reference heading is renamed —
   `test_skill_section_pointers_resolve`.
4. A rule relocated out of SKILL.md gets dropped, or gets restated in SKILL.md so the
   "stated once" claim is false — `test_relocated_rules_live_in_references_not_skill`.
5. Two surfaces drift on a rule's scope — `test_scoping_keywords_coexist`.

DATA-DRIVEN: adding a rule later means adding a row, not a new assertion.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "creatio-ui-guidelines"
REFERENCES = SKILL_DIR / "references"

SKILL = SKILL_DIR / "SKILL.md"
CHECKLIST = REFERENCES / "review-checklists.md"
PAGE_LAYOUT = REFERENCES / "page-layout-and-controls.md"
ACCESSIBILITY = REFERENCES / "accessibility-and-colors.md"

# Pointer family prefix -> the reference file whose headings it targets.
POINTER_FILES = {
    "page-layout": PAGE_LAYOUT,
    "accessibility": ACCESSIBILITY,
}

# A checkbox line may end with `→ <family>: <section phrase>`.
POINTER_RE = re.compile(r"→\s*(page-layout|accessibility):\s*(.+?)\s*$")
# An italic section target inside a SKILL.md loop pass (`→ *Page composition*, ...`).
ITALIC_TARGET_RE = re.compile(r"\*([^*]+)\*")


def normalize(text):
    """Collapse to lowercase alphanumerics separated by single spaces — robust to
    heading punctuation drift (parentheses, commas, em dashes, `&`, `/`)."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def read(path):
    return path.read_text(encoding="utf-8")


def headings(path):
    return [normalize(m.group(1)) for m in re.finditer(r"^#{2,4}\s+(.*)$", read(path), re.M)]


def resolves(target, heading_list):
    """True iff the normalized target is a whole heading, or a word-boundary prefix of
    one (so `Choosing the component` matches `Choosing the component (source of truth)`
    but `Fields` can NOT match an unrelated heading that merely contains "fields")."""
    wanted = normalize(target)
    return any(h == wanted or h.startswith(wanted + " ") for h in heading_list)


def checkbox_lines(path):
    for i, line in enumerate(read(path).splitlines(), start=1):
        if line.lstrip().startswith("- [ ]"):
            yield i, line


def checklist_pointers():
    """(line_no, family, target) for every checkbox-line pointer in the checklist."""
    for i, line in checkbox_lines(CHECKLIST):
        m = POINTER_RE.search(line)
        if m:
            yield i, m.group(1), m.group(2)


def skill_section_pointers():
    """(line_no, target) for every `→ *Section*` italic target on a SKILL.md loop pass.
    File-reference arrows (`→ ./references/...`) carry no italic target and are skipped."""
    for i, line in enumerate(read(SKILL).splitlines(), start=1):
        if not re.match(r"^\s*\d+\.", line) or "→" not in line:
            continue
        after = line.split("→", 1)[1]
        for m in ITALIC_TARGET_RE.finditer(after):
            yield i, m.group(1).strip()


def critical_gate_lines():
    """Checkbox lines under the `## Critical gate ...` heading only."""
    in_gate = False
    for i, line in enumerate(read(CHECKLIST).splitlines(), start=1):
        if line.startswith("## "):
            in_gate = normalize(line[3:]).startswith("critical gate")
            continue
        if in_gate and line.lstrip().startswith("- [ ]"):
            yield i, line


# --- Scope-drift table (§6). Each keyword MUST appear in BOTH the checklist and the
# named reference file. Add a row when a new rule has a scope both surfaces must agree on.
SCOPING_KEYWORDS = [
    ("amount companion — 'the value the user reasons about'", "reasons about", "page-layout"),
    ("deadline companion — no-timer fallback", "no timer component", "page-layout"),
    ("deadline companion — shows time left/overdue", "time left", "page-layout"),
    ("Contact/Account companion — audit lookups excluded", "Created by / Modified by", "page-layout"),
    ("related list — 'Expanded list' composite is the skeleton", "Expanded list", "page-layout"),
]

# --- Relocated-rule table (AC-1). Each phrase was moved OUT of SKILL.md into a
# reference during the restructure. It MUST still exist in some reference, and MUST NOT
# reappear in SKILL.md (that is what makes SKILL.md's "stated once, not restated here"
# claim testable). Add a row for every rule/value the router must not restate.
RELOCATED_RULES = [
    ("composite is several components", "build every part"),
    ("compositeOnly evidence recording", "compositeOnly"),
    ("must not visually stand out", "visually stand out"),
    ("dense layout is a required fix", "required fix, or a decision to raise"),
    ("check column count first", "column count BEFORE placing"),
    ("no empty layout gaps", "No empty layout gaps"),
    ("consistent labelPosition", "consistent `labelPosition` across a group"),
    ("ExpansionPanels stack vertically", "ExpansionPanels never sit side by side"),
    ("custom CSS is a last resort", "Custom CSS is a last resort"),
    ("localizable tooltip/placeholder strings", "localizable strings"),
    ("contrast ratio 4.5:1", "4.5:1"),
    ("contrast ratio 3:1", "3:1"),
    ("simple-lookup token", "simple-lookup"),
]


class FilesExistTests(unittest.TestCase):
    def test_files_exist(self):
        for path in (SKILL, CHECKLIST, PAGE_LAYOUT, ACCESSIBILITY):
            self.assertTrue(path.exists(), f"missing {path}")


class ChecklistPointerTests(unittest.TestCase):
    def test_every_pointer_resolves(self):
        idx = {fam: headings(p) for fam, p in POINTER_FILES.items()}
        failures = []
        for line_no, fam, target in checklist_pointers():
            if not resolves(target, idx[fam]):
                failures.append(
                    f"  line {line_no}: '→ {fam}: {target}' does not resolve in "
                    f"{POINTER_FILES[fam].name}. Headings: {idx[fam]}"
                )
        self.assertEqual([], failures, "Checklist pointer(s) target a missing/renamed "
                         "section:\n" + "\n".join(failures))

    def test_no_malformed_checklist_pointers(self):
        """Fail closed: a checkbox line that reaches for a pointer (`→`/`->`) but does
        not parse as one is a broken pointer, not a non-pointer."""
        bad = []
        for i, line in checkbox_lines(CHECKLIST):
            if ("->" in line or "→" in line) and not POINTER_RE.search(line):
                bad.append(f"  line {i}: {line.strip()[:100]}")
        self.assertEqual([], bad, "Malformed pointer(s) — an arrow that does not parse "
                         "as `→ page-layout:`/`→ accessibility: <section>` at end of line:\n"
                         + "\n".join(bad))

    def test_pointer_count_is_not_vacuous(self):
        # Real count is ~123 across ~138 checkbox lines; a floor near it stops a future
        # edit from stripping most routing while CI stays green.
        self.assertGreaterEqual(
            len(list(checklist_pointers())), 100,
            "checklist lost most of its section pointers — routing is being stripped.")


class CriticalGateTests(unittest.TestCase):
    def test_gate_exists_and_is_reachable_from_skill(self):
        self.assertTrue(any(h.startswith("critical gate") for h in headings(CHECKLIST)),
                        "review-checklists.md lost its '## Critical gate' heading, which "
                        "SKILL.md routes every audit to first.")

    def test_gate_items_route_correctly(self):
        gate = list(critical_gate_lines())
        self.assertGreaterEqual(len(gate), 12, "Critical gate shrank below 12 items.")
        idx = {fam: headings(p) for fam, p in POINTER_FILES.items()}
        pointered, failures = 0, []
        for i, line in gate:
            m = POINTER_RE.search(line)
            if not m:
                continue  # a gate item may reference an in-file section instead
            pointered += 1
            if not resolves(m.group(2), idx[m.group(1)]):
                failures.append(f"  line {i}: '→ {m.group(1)}: {m.group(2)}' does not resolve")
        self.assertEqual([], failures, "Critical gate pointer(s) do not resolve:\n"
                         + "\n".join(failures))
        # All but the rendered-page item (which references an in-file section) carry a
        # resolvable cross-file pointer.
        self.assertGreaterEqual(pointered, len(gate) - 1,
                                "too many Critical gate items lack a resolvable pointer.")


class SkillRouterTests(unittest.TestCase):
    def test_skill_section_pointers_resolve(self):
        pl = headings(PAGE_LAYOUT)
        pointers = list(skill_section_pointers())
        self.assertGreaterEqual(len(pointers), 5, "SKILL.md loop lost its `→ *section*` "
                                "pointers — the router no longer routes.")
        failures = [f"  line {i}: '*{t}*' has no matching page-layout heading"
                    for i, t in pointers if not resolves(t, pl)]
        self.assertEqual([], failures, "SKILL.md router pointer(s) rotted against "
                         "page-layout-and-controls.md headings:\n" + "\n".join(failures))

    def test_skill_prose_routes_resolve(self):
        # SKILL.md:29 routes to "Choosing the component (source of truth)".
        self.assertTrue(any(h.startswith("choosing the component") for h in headings(PAGE_LAYOUT)),
                        "page-layout lost the 'Choosing the component' section SKILL.md routes to.")


class DriftTableTests(unittest.TestCase):
    def test_scoping_keywords_coexist(self):
        checklist_text = read(CHECKLIST)
        failures = []
        for label, keyword, ref_key in SCOPING_KEYWORDS:
            ref_text = read(POINTER_FILES[ref_key])
            where = [name for name, present in
                     (("review-checklists.md", keyword in checklist_text),
                      (POINTER_FILES[ref_key].name, keyword in ref_text)) if not present]
            if where:
                failures.append(f"  {label}: scoping keyword {keyword!r} missing from "
                                f"{', '.join(where)}")
        self.assertEqual([], failures, "Checklist/reference drifted on a rule's scope:\n"
                         + "\n".join(failures))

    def test_relocated_rules_live_in_references_not_skill(self):
        skill_text = read(SKILL)
        references_blob = "\n".join(read(p) for p in (PAGE_LAYOUT, ACCESSIBILITY, CHECKLIST))
        failures = []
        for label, phrase in RELOCATED_RULES:
            if phrase not in references_blob:
                failures.append(f"  {label}: {phrase!r} dropped — not found in any reference")
            if phrase in skill_text:
                failures.append(f"  {label}: {phrase!r} restated in SKILL.md — violates "
                                f"'stated once, not restated here'")
        self.assertEqual([], failures, "Relocated-rule invariant broken:\n" + "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
