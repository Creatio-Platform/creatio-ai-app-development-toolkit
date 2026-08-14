import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PLAYBOOK = ROOT / "skills/creatio-mobile-page-conversion/references/page-to-mobile-conversion.md"


def read_text(path):
    return path.read_text(encoding="utf-8")


def normalized(text):
    # Markdown hard-wraps prose across lines; collapse whitespace so a phrase assertion does not
    # break just because the wrap point shifted.
    return " ".join(text.split())


class MobileConversionPlaybookDocTests(unittest.TestCase):
    def test_playbook_exists(self):
        self.assertTrue(PLAYBOOK.exists(), str(PLAYBOOK))

    def test_fab_merge_prohibition_is_unconditional(self):
        # PR #94 review (tetiana-moshon, Major #1): "Never author a floatAction merge yourself: when
        # the template already owns floatAction..." let an LLM agent parse "when" as the rule's
        # trigger condition rather than an explanatory aside, and conclude the prohibition does not
        # apply in the `merge` emission case. Lock the em-dash phrasing (unconditional statement,
        # then a separate sentence describing the failure scenario) at both mentions, and guard
        # against the colon-conditional regression.
        content = read_text(PLAYBOOK)
        text = normalized(content)
        self.assertIn(
            "**Never author a `floatAction` merge yourself** — the engine already emits the correct "
            "shape in the map.",
            text,
        )
        self.assertIn(
            "Never hand-author a `floatAction` merge and never re-emit the template's own menu items",
            text,
        )
        self.assertNotIn(
            "merge yourself:",
            content,
            "the merge prohibition must not be phrased as a colon-conditional ('yourself: when ...')",
        )
        self.assertGreaterEqual(
            content.lower().count("silently drop"),
            2,
            "the silent-drop failure mode must be stated at both the step-7 mechanics and the "
            "Mobile constraints invariant",
        )

    def test_fab_emission_null_all_dropped_is_handled(self):
        # Every FAB candidate can be dropped, leaving no elementMap entry to apply. Both the
        # step-7 mechanics and the Gate M plan section must tell the agent what that state means.
        content = read_text(PLAYBOOK)
        self.assertIn("`emission: null`", content)
        self.assertIn("EVERY candidate was dropped", content)
        self.assertIn("`emission` is null", content)

    def test_fab_target_assumed_requires_runtime_verification(self):
        # targetAssumed: true means the template's own FAB could not be resolved, so the inserts
        # target the rules' standard FAB name instead. The agent must say so and tell the developer
        # to verify the menu at runtime rather than silently trusting the assumed target.
        content = read_text(PLAYBOOK)
        self.assertIn("`targetAssumed: true`", content)
        self.assertIn("verify the menu at runtime", content)
        self.assertIn("runtime check", content.lower())


if __name__ == "__main__":
    unittest.main()
