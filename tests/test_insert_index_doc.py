import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-ui-guidelines/SKILL.md"
GUIDELINES = ROOT / "skills/creatio-ui-guidelines/references"
LAYOUT = GUIDELINES / "page-layout-and-controls.md"
CHECKLISTS = GUIDELINES / "review-checklists.md"


def paragraph(path, opening):
    """The bullet or paragraph that starts with `opening`, up to the next bullet or heading,
    with whitespace collapsed. Scoping each assertion to one rule keeps a mention elsewhere in
    the file from passing it."""
    text = path.read_text(encoding="utf-8")
    start = text.find(opening)
    if start < 0:
        raise AssertionError(f"{path.name} has no paragraph opening with {opening!r}")
    rest = text[start:]
    end = re.search(r"\n(?:- |#|\n)", rest[len(opening):])
    body = rest if end is None else rest[: len(opening) + end.start()]
    return " ".join(body.split())


class InsertIndexRuleTests(unittest.TestCase):
    """An insert's `index` is its position among all of the parent's children, the ones the
    parent template already has included. Counting only the agent's own inserts puts the new
    element ahead of the template's children in `items`, so the order there disagrees with the
    layout."""

    def assert_states_the_rule(self, rule):
        self.assertIn("`index`", rule)
        self.assertRegex(rule, r"(?i)template")
        self.assertIn("get-page", rule)
        self.assertRegex(rule, r"(?i)row, then column")

    def test_skill_states_the_rule(self):
        self.assert_states_the_rule(
            paragraph(SKILL, "- **An insert's `index` counts the children the parent already has")
        )

    def test_reference_states_the_rule(self):
        self.assert_states_the_rule(
            paragraph(LAYOUT, "- **An insert's `index` counts the parent's existing children")
        )

    def test_checklist_states_the_rule(self):
        self.assert_states_the_rule(
            paragraph(CHECKLISTS, "- [ ] Every insert's `index` counts the parent's existing children")
        )

    def test_reference_shows_the_template_child_example(self):
        rule = paragraph(LAYOUT, "- **An insert's `index` counts the parent's existing children")
        self.assertIn("CardContentWrapper", rule)
        self.assertIn("TopAreaProfileContainer", rule)
        self.assertIn("`index: 1`", rule)

    def test_reference_covers_several_inserts_into_one_parent(self):
        rule = paragraph(LAYOUT, "- **Several inserts into one parent")
        self.assertRegex(rule, r"(?i)template")
        self.assertRegex(rule, r"(?i)earlier insert")

    def test_skill_names_the_clio_guide_that_owns_the_diff_rules(self):
        rule = paragraph(SKILL, "- **An insert's `index` counts the children the parent already has")
        self.assertIn("page-modification-components", rule)


if __name__ == "__main__":
    unittest.main()
