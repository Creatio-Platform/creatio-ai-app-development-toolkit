import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-branding-orchestrator/SKILL.md"

# The Fonts step deliberately delegates the shared font rules — the family-name contract, the probe
# URL, the 404 retry, the warning vocabulary — to clio's theming guidance, which owns them and pins
# them with clio's own tests. What stays here is only what that guidance cannot carry, and these
# assertions pin exactly that. Markers that moved out are deliberately NOT pinned here; asserting
# them again would recreate the duplication this step was trimmed to remove.
#
# CAPABILITY_PHRASE is the one string this repo does not own: it is prose in clio's build-theme tool
# description, read back through get-tool-contract. This test pins only our half. The other half is
# pinned in the clio repo, and a reword there fails those tests rather than reaching an agent:
#   clio.tests/Command/McpServer/BuildThemeToolTests.cs
#     -> BuildThemeTool_Should_DeclareBuildSafetyFlags_WhenInspectingMcpServerToolAttribute
#        (the [Description] attribute)
#   clio.mcp.e2e/BuildThemeToolE2ETests.cs
#     -> BuildTheme_Should_Be_Discoverable_And_Build
#        (the get-tool-contract PROJECTION — the surface the skill actually reads)
# Changing the phrase means changing it in all three places. A drift that somehow lands anyway is
# fail-safe by construction: the skill treats an absent phrase as "cannot confirm" and refuses to
# build an unpublished family, never as permission to proceed.
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


def conversation_rules():
    # The Fonts step's approval-gate carve-out is stated here rather than in the step itself, so
    # fonts_step() cannot see it and it would otherwise be the one normative sentence this PR added
    # with no test behind it.
    content = read_skill_unwrapped()
    start = content.index("## Conversation rules")
    return content[start : content.index("## Build and apply", start)]


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

    def test_a_missing_capability_phrase_is_fail_safe(self):
        # The gate keys on prose owned by another repo, so it can go missing on a perfectly capable
        # clio. Absence must therefore refuse the build rather than being read as permission to
        # proceed — that direction is the whole reason the gate is safe to key on a string at all.
        step = fonts_step()
        self.assertIn("do not build this family", step)
        self.assertIn("offer a clio upgrade or a published family instead", step)

    def test_a_missing_capability_phrase_is_not_diagnosed_as_an_old_clio(self):
        # Absence does not distinguish an old clio from a reworded description on a current one, so
        # the step must say it cannot tell rather than assert a cause and send the user to upgrade
        # something already up to date.
        step = fonts_step()
        self.assertIn("you cannot tell an old clio from a reworded contract on a current one", step)
        self.assertIn("rather than asserting their clio is old", step)

    def test_the_capability_match_tolerates_cosmetic_drift(self):
        # Casing and line-wrap differences in clio's description are not capability changes; only a
        # genuine reword is, and that fails clio's own tests first.
        step = fonts_step()
        self.assertIn("match that case-insensitively and ignore how the text wraps", step)

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

    def test_the_conversation_rules_carve_out_survives(self):
        # "font steps are not approval gates" is the general rule; building a family Google Fonts does
        # not publish is the one exception, and it is a separate, EARLIER gate than the single
        # pre-build confirmation. Dropping or inverting this sentence would quietly remove the
        # confirmation this whole slice exists to add.
        rules = conversation_rules()
        self.assertIn("One exception inside the Fonts step", rules)
        self.assertIn("does not replace", rules)

    def test_import_state_is_read_from_the_warning_text_not_the_family_name(self):
        # Both availability outcomes emit a warning naming the family, and they do opposite things to
        # the import: not-published drops it, unverifiable keeps it. Correlating by family name alone
        # lets the agent assert an import state that never happened — observed live, where a
        # "could not verify" warning named a family the user had confirmed as locally installed and
        # the import was in fact still there.
        step = fonts_step()
        self.assertIn("read the warning's own text first", step)
        self.assertIn('"was not found in Google Fonts" means the import was dropped', step)
        self.assertIn('"could not verify" means it was kept', step)

    def test_an_unverifiable_warning_is_never_reported_as_suppression_done(self):
        # The dangerous near-miss: it names the same family as the expected echo, so it reads like
        # confirmation while meaning the opposite.
        step = fonts_step()
        self.assertIn("this resembles the echo above but is its opposite", step)
        self.assertIn("Never report it as done", step)

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
