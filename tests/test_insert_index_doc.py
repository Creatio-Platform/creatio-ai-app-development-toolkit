import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-ui-guidelines/SKILL.md"
GUIDELINES = ROOT / "skills/creatio-ui-guidelines/references"
LAYOUT = GUIDELINES / "layout-mechanics.md"
CHECKLISTS = GUIDELINES / "review-checklists.md"

SKILL_RULE = "- **An insert's `index` counts the children the parent already has"
LAYOUT_RULE = "- **An insert's `index` counts the parent's existing children"
LAYOUT_SEVERAL = "- **Several inserts into one parent"
CHECKLIST_RULE = "- [ ] Every insert's `index` counts the parent's existing children"


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
        self.assertIn("template", rule)
        self.assertIn("get-page", rule)
        self.assertIn("row, then column", rule)

    def test_skill_states_the_rule(self):
        self.assert_states_the_rule(paragraph(SKILL, SKILL_RULE))

    def test_checklist_states_the_rule(self):
        self.assert_states_the_rule(paragraph(CHECKLISTS, CHECKLIST_RULE))

    def test_reference_states_the_rule_with_the_template_child_example(self):
        rule = paragraph(LAYOUT, LAYOUT_RULE)
        self.assert_states_the_rule(rule)
        self.assertIn("CardContentWrapper", rule)
        self.assertIn("TopAreaProfileContainer", rule)
        self.assertIn("`index: 1`", rule)
        self.assertIn("page-modification-components", rule)

    def test_reference_orders_several_inserts_by_layout_not_by_emission(self):
        rule = paragraph(LAYOUT, LAYOUT_SEVERAL)
        self.assertIn("row then column", rule)
        self.assertIn("not necessarily the end of `items`", rule)
        self.assertNotIn("next free position", rule)


class RowNumberingCountsExistingChildrenTests(unittest.TestCase):
    """The existing children of a container, the template's included, keep the rows they
    declare; a new child takes a free row between them or the next row after them, as its place
    in the layout needs. Only a container the agent creates starts at row 1."""

    def test_skill_row_rule_counts_existing_children(self):
        rule = paragraph(SKILL, "- **No empty layout gaps")
        self.assertIn("existing children", rule)
        self.assertIn("template", rule)
        self.assertNotIn("must restart at 1", rule)

    def test_reference_gap_rule_counts_existing_children(self):
        rule = paragraph(LAYOUT, "- **Why a gap appears:**")
        self.assertIn("already has children", rule)
        self.assertIn("template", rule)
        self.assertIn("a free row between them", rule)
        self.assertNotIn("continue after", rule)


if __name__ == "__main__":
    unittest.main()
