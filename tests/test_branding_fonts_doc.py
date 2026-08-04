import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-branding-orchestrator/SKILL.md"

# The Fonts step deliberately delegates the shared font rules — the family-name contract, the probe
# URL, the 404 retry, the warning vocabulary — to clio's theming guidance, which owns them and pins
# them with clio's own tests. What stays here is only what that guidance cannot carry, and these
# assertions pin exactly that. Markers that moved out are deliberately NOT pinned here; asserting
# them again would recreate the duplication this step was trimmed to remove.
CAPABILITY_PHRASE = "checked against Google Fonts"


def read_skill():
    return SKILL.read_text(encoding="utf-8")


def read_skill_unwrapped():
    # The markers below are prose sentences, and prose re-wraps on every edit. Collapsing whitespace
    # keeps these assertions about the wording rather than about where the line breaks.
    return " ".join(read_skill().split())


def fonts_step():
    content = read_skill_unwrapped()
    start = content.index("## Fonts — after the background")
    return content[start : content.index("## Theme name — after fonts", start)]


class BrandingFontsDocTests(unittest.TestCase):
    def test_skill_exists(self):
        self.assertTrue(SKILL.exists(), str(SKILL))

    def test_the_step_delegates_the_shared_rules_to_clio_guidance(self):
        # Load-bearing after the trim: the name contract, probe URL, retry and warning vocabulary now
        # live only in clio's theming guidance. Losing this pointer would silently strip them from the
        # flow, so it is pinned harder than any single rule it replaces.
        step = fonts_step()
        self.assertIn("clio's theming guidance owns the font rules", step)
        self.assertIn("Follow it.", step)

    def test_clio_capabilities_are_summarised_without_restating_the_rules(self):
        # A short capability summary keeps the step readable on its own. It states what build-theme
        # does, not how the agent should probe — that is the guidance's job.
        step = fonts_step()
        self.assertIn("no web-font `@import` plus a warning", step)
        self.assertIn("keeps the import plus a warning", step)
        self.assertIn("only a malformed name fails the build", step)

    def test_capability_handshake_phrase_is_pinned(self):
        # clio pins this phrase on both the tool attribute and the get-tool-contract projection. The
        # agent-side half of that handshake lives here, and nothing else in this repo catches a reword.
        self.assertIn(CAPABILITY_PHRASE, fonts_step())

    def test_capability_check_stays_scoped_to_the_unpublished_font_path(self):
        # Regression guard: a broader placement once refused EVERY font change — including a switch
        # between two published Google families — on any clio predating probe-driven suppression.
        step = fonts_step()
        self.assertIn("This check belongs to this branch only", step)
        self.assertIn(
            "never block an ordinary change between published families on clio's version", step
        )

    def test_the_normalized_name_probe_trap_is_stated(self):
        # clio normalizes before building, so a padded name builds fine but 404s on a raw probe. The
        # guidance says to URL-encode; it does not warn about this mismatch.
        step = fonts_step()
        self.assertIn("Probe the normalized name, not the raw one", step)

    def test_a_non_google_family_is_its_own_approval_gate(self):
        # Skill policy, not clio's: this gate is separate from and earlier than the single pre-build
        # confirmation, and an inconclusive probe of the agent's own must not be resolved by guessing.
        step = fonts_step()
        self.assertIn('exception to "font steps are not approval gates"', step)
        self.assertIn("neither 200 nor 404", step)
        self.assertIn("never guess on the user's behalf", step)

    def test_all_three_warning_outcomes_carry_an_action(self):
        # Reading a warning is not enough — each outcome needs a next step. The missing-warning case
        # must disambiguate first: after the capability check has passed, "old clio" is the less likely
        # reading, and concluding it would send users to upgrade an already-current clio.
        step = fonts_step()
        self.assertIn("the expected echo", step)
        self.assertIn("Surface the contradiction and settle it", step)
        self.assertIn("Re-probe the normalized name first", step)
        self.assertIn("Only a second 404 means a real gap", step)

    def test_the_verdict_is_judged_by_warnings_not_by_css(self):
        # Neither real flow hands the agent the CSS: workspace-write returns a path, and the no-code
        # flow builds inside create-theme.
        self.assertIn("never by the CSS", fonts_step())

    def test_import_rule_is_stated_once(self):
        # Kept as a single rule rather than repeated per branch.
        self.assertEqual(read_skill().count("hand-author an `@import`"), 1)


if __name__ == "__main__":
    unittest.main()
