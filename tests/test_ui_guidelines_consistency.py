"""AC-3 — checklist ↔ reference drift guard for the creatio-ui-guidelines skill.

The skill's `review-checklists.md` is a scannable INDEX: every checkbox item is a
one-line restatement that points to the section owning the full rule
(`→ page-layout: <section>` or `→ accessibility: <section>`). The rule text itself
lives once, in that reference section. Two failure modes drifted past reviewers
before this guard existed:

1. A checklist line points at a section that was renamed or removed — the reader
   follows a dead pointer. `test_every_pointer_resolves_to_a_heading` catches it.
2. A scope-narrowing edit changes one side (checklist OR reference) without the
   other, so the two disagree on what a rule covers — the exact drift the
   field-driven-companion rules hit. `test_scoping_keywords_coexist` catches it.

Both are DATA-DRIVEN: the pointer test derives its expectations from the files, and
the scope test reads a table at the top. Adding a rule later means adding a row, not
a new assertion.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "creatio-ui-guidelines"
REFERENCES = SKILL_DIR / "references"

CHECKLIST = REFERENCES / "review-checklists.md"
# Pointer family prefix -> the reference file whose headings it targets.
POINTER_FILES = {
    "page-layout": REFERENCES / "page-layout-and-controls.md",
    "accessibility": REFERENCES / "accessibility-and-colors.md",
}

# A checkbox line may end with `→ <family>: <section phrase>`.
POINTER_RE = re.compile(r"→\s*(page-layout|accessibility):\s*(.+?)\s*$")


def normalize(text):
    """Collapse to lowercase alphanumerics separated by single spaces.

    Robust to punctuation drift in a heading (parentheses, commas, em dashes, `&`,
    `/`) so a pointer phrase can be matched as a substring of a heading without
    reproducing GitHub's exact anchor-slug algorithm.
    """
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def read(path):
    return path.read_text(encoding="utf-8")


def headings(path):
    return [normalize(m.group(1)) for m in re.finditer(r"^#{2,4}\s+(.*)$", read(path), re.M)]


def checklist_pointers():
    """Yield (line_number, family, raw_target) for every checkbox-line pointer.

    Only `- [ ]` lines are parsed, so the legend sentence in the intro (which shows
    the pointer syntax with an ellipsis) is never mistaken for a real pointer.
    """
    for i, line in enumerate(read(CHECKLIST).splitlines(), start=1):
        if not line.lstrip().startswith("- [ ]"):
            continue
        match = POINTER_RE.search(line)
        if match:
            yield i, match.group(1), match.group(2)


# --- Scope-drift table (§6). Each keyword MUST appear in BOTH the checklist and the
# named reference file. These are the scoping clauses reviewers saw narrowed on one
# side only. Add a row when a new rule has a scope both surfaces must agree on. ---
SCOPING_KEYWORDS = [
    # (label, keyword that must co-exist, reference file key)
    ("amount companion — 'the value the user reasons about'", "reasons about", "page-layout"),
    ("deadline companion — no-timer fallback", "no timer component", "page-layout"),
    ("deadline companion — shows time left/overdue", "time left", "page-layout"),
    ("Contact/Account companion — audit lookups excluded", "Created by / Modified by", "page-layout"),
    ("related list — 'Expanded list' composite is the skeleton", "Expanded list", "page-layout"),
]


class PointerResolutionTests(unittest.TestCase):
    def test_files_exist(self):
        self.assertTrue(CHECKLIST.exists(), f"missing {CHECKLIST}")
        for key, path in POINTER_FILES.items():
            self.assertTrue(path.exists(), f"missing {key} reference {path}")

    def test_at_least_one_pointer(self):
        # Guards against the pointer syntax being silently dropped in a future edit,
        # which would make this whole guard vacuously pass.
        self.assertGreaterEqual(
            len(list(checklist_pointers())), 20,
            "review-checklists.md lost its section pointers (expected the checklist "
            "to route items to their canonical sections).",
        )

    def test_every_pointer_resolves_to_a_heading(self):
        heading_index = {key: headings(path) for key, path in POINTER_FILES.items()}
        failures = []
        for line_no, family, target in checklist_pointers():
            wanted = normalize(target)
            if not any(wanted in heading for heading in heading_index[family]):
                failures.append(
                    f"  line {line_no}: '→ {family}: {target}' has no matching heading "
                    f"in {POINTER_FILES[family].name}"
                )
        self.assertEqual(
            [], failures,
            "Checklist pointer(s) target a section that does not exist (renamed or "
            "removed without updating the pointer):\n" + "\n".join(failures),
        )


class ScopingDriftTests(unittest.TestCase):
    def test_scoping_keywords_coexist(self):
        checklist_text = read(CHECKLIST)
        failures = []
        for label, keyword, ref_key in SCOPING_KEYWORDS:
            ref_text = read(POINTER_FILES[ref_key])
            in_checklist = keyword in checklist_text
            in_reference = keyword in ref_text
            if not (in_checklist and in_reference):
                where = []
                if not in_checklist:
                    where.append("review-checklists.md")
                if not in_reference:
                    where.append(POINTER_FILES[ref_key].name)
                failures.append(
                    f"  {label}: scoping keyword {keyword!r} missing from {', '.join(where)}"
                )
        self.assertEqual(
            [], failures,
            "Checklist and its reference drifted on a rule's scope — one side was "
            "narrowed without the other:\n" + "\n".join(failures),
        )


if __name__ == "__main__":
    unittest.main()
