import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

GUIDELINES = ROOT / "skills/creatio-ui-guidelines/references"
LAYOUT = GUIDELINES / "page-layout-and-controls.md"
CHECKLISTS = GUIDELINES / "review-checklists.md"
BUILD_PAGE = ROOT / "skills/classic-to-freedom-migration/references/build-page.md"


def prose(path):
    """Text with every whitespace run collapsed, so a sentence may be rewrapped without
    breaking an assertion about what it says."""
    return " ".join(path.read_text(encoding="utf-8").split())


def paragraph(path, opening):
    """The bullet or paragraph that starts with `opening`, up to the next bullet or heading.
    Scoping each assertion to one rule keeps a mention elsewhere in the file from passing it."""
    text = path.read_text(encoding="utf-8")
    start = text.find(opening)
    if start < 0:
        raise AssertionError(f"{path.name} has no paragraph opening with {opening!r}")
    rest = text[start:]
    end = re.search(r"\n(?:- |#|\n)", rest[len(opening):])
    body = rest if end is None else rest[: len(opening) + end.start()]
    return " ".join(body.split())


class ReadOnlyRowMenuRecipeTests(unittest.TestCase):
    """The read-only list rule carries the row-menu recipe that keeps Open alone. The platform
    injects its default row actions (Open, Copy, Delete) only while `rowToolbarItems` is unset,
    so any value of its own, an empty list included, replaces all three."""

    def rule(self):
        return paragraph(LAYOUT, "- **A read-only detail must be read-only on its rows too")

    def test_rule_names_the_open_only_row_menu(self):
        rule = self.rule()
        self.assertIn("`rowToolbarItems`", rule)
        self.assertIn("`crt.MenuItem`", rule)
        self.assertIn('request: "crt.UpdateRecordRequest"', rule)
        self.assertIn('recordId: "$<Items>.<DS>_Id"', rule)
        self.assertIn("useRelativeContext: true", rule)
        self.assertIn("{ enable: false, itemsCreation: false }", rule)

    def test_rule_says_why_an_empty_list_or_a_hidden_toolbar_loses_open(self):
        rule = self.rule()
        self.assertIn("`rowToolbarItems: []`", rule)
        self.assertIn("`rows.toolbar: false`", rule)
        self.assertIn("no Open", rule)

    def test_rule_still_asks_to_confirm_the_shape_on_the_target_version(self):
        rule = self.rule()
        self.assertIn("confirm the shape on the target version", rule)
        self.assertIn("`get-component-info`", rule)

    def test_checklist_item_checks_the_open_only_row_menu(self):
        item = paragraph(CHECKLISTS, "- [ ] Read-only details take all three steps")
        self.assertIn("`rowToolbarItems`", item)
        self.assertIn("only Open", item)
        self.assertIn("`crt.UpdateRecordRequest`", item)

    def test_migration_row_actions_note_points_at_the_guideline_recipe(self):
        note = paragraph(BUILD_PAGE, "- **Removed row actions are their own line.**")
        self.assertIn("`rowToolbarItems`", note)
        self.assertIn("page-layout-and-controls.md", note)
        self.assertNotIn("the row-action property comes from `get-component-info`", note)


if __name__ == "__main__":
    unittest.main()
