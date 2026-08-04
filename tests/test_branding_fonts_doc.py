import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-branding-orchestrator/SKILL.md"

# The exact strings the Fonts step's runtime behavior is keyed on. Each is a trip-wire shared with a
# system this repo does not build: clio's tool description, clio's error codes, and Google's endpoint.
# A silent reword here does not fail anything until a live agent run misbehaves, which is what these
# assertions exist to prevent.
CAPABILITY_PHRASE = "checked against Google Fonts"
PROBE_URL_TEMPLATE = "https://fonts.google.com/metadata/fonts/<Family>"
RESOLVER_URL_TEMPLATE = "https://fonts.google.com/?query=<family>"
MALFORMED_FAMILY_CODE = "INVALID_FONT_FAMILY"
NOT_PUBLISHED_WARNING = "was not found in Google Fonts"
UNVERIFIABLE_WARNING = "could not verify"


def read_skill():
    return SKILL.read_text(encoding="utf-8")


def read_skill_unwrapped():
    # The markers below are prose sentences, and prose re-wraps on every edit. Collapsing whitespace
    # keeps these assertions about the wording rather than about where the line happens to break.
    return " ".join(read_skill().split())


class BrandingFontsDocTests(unittest.TestCase):
    def test_skill_exists(self):
        self.assertTrue(SKILL.exists(), str(SKILL))

    def test_capability_handshake_phrase_is_pinned(self):
        # clio pins this phrase on both the tool attribute and the get-tool-contract projection. The
        # agent-side half of that handshake lives here, and nothing else in this repo would catch a reword.
        self.assertIn(CAPABILITY_PHRASE, read_skill())

    def test_capability_check_is_scoped_to_the_unpublished_font_branch(self):
        # Regression guard: the check once sat in the Fonts step preamble, where "this section" read as the
        # whole step — which refused EVERY font change (including two already-published Google families) on
        # any clio predating probe-driven suppression. It must stay inside the one branch that needs it.
        content = read_skill()
        fonts_step = content.index("## Fonts — after the background")
        unpublished_branch = content.index("### Building a family Google Fonts does not publish")
        capability_check = content.index(CAPABILITY_PHRASE)
        self.assertLess(fonts_step, unpublished_branch)
        self.assertGreater(
            capability_check,
            unpublished_branch,
            "the clio capability check must live inside the not-published branch, not gate the whole Fonts step",
        )

    def test_probe_and_resolver_urls_are_pinned(self):
        # The metadata endpoint is the only one that classifies correctly (css2 answers 200 for unpublished
        # families with a look-alike), and the resolver link is what hands spelling back to the user.
        content = read_skill()
        self.assertIn(PROBE_URL_TEMPLATE, content)
        self.assertIn(RESOLVER_URL_TEMPLATE, content)

    def test_clio_error_code_and_warning_markers_are_pinned(self):
        # The agent branches on these clio-side strings: one build-failing error code and the two
        # availability warnings it must tell apart.
        content = read_skill()
        self.assertIn(MALFORMED_FAMILY_CODE, content)
        self.assertIn(NOT_PUBLISHED_WARNING, content)
        self.assertIn(UNVERIFIABLE_WARNING, content)

    def test_absent_warning_requires_disambiguation_before_prompting_an_upgrade(self):
        # Once the capability check has passed, a missing not-found warning most likely means clio found the
        # family published and the agent's own 404 was wrong. Concluding "old clio" first would send users to
        # upgrade an already-current clio instead of learning their font is available.
        content = read_skill_unwrapped()
        self.assertIn("re-probe the normalized name", content)
        self.assertIn("do not prompt for an upgrade or a rebuild", content)

    def test_contradicting_verdict_is_not_treated_as_the_expected_echo(self):
        # A "was not found" warning for a family the user called a Google font contradicts their answer; the
        # echo rule covers only families they confirmed as locally installed.
        content = read_skill_unwrapped()
        self.assertIn("contradicts the user's answer", content)
        self.assertIn("LOCALLY INSTALLED", content)

    def test_every_outcome_reads_clio_warnings_back_including_the_published_one(self):
        # clio re-probes at build time from its own host, so its verdict can disagree with the agent's. The
        # published branch is the majority path and the one where an unexpected "was not found" costs most:
        # the user was told the font downloads, and the theme actually shipped without the import. The
        # read-back instruction is a single lead-in covering all four outcomes rather than a per-branch copy.
        content = read_skill_unwrapped()
        self.assertIn("after every build, whatever your own check concluded", content)
        self.assertIn("That includes the published case", content)
        self.assertIn("probe resolved as published", content)

    def test_import_rule_is_stated_once(self):
        # Kept as a single closing rule for the whole Fonts step rather than repeated per branch.
        self.assertEqual(read_skill().count("hand-author an `@import`"), 1)


if __name__ == "__main__":
    unittest.main()
