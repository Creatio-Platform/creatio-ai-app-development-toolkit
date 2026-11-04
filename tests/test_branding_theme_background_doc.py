import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-branding-orchestrator/SKILL.md"
ASSETS = ROOT / "skills/creatio-branding-orchestrator/references/branding-assets.md"
OPENAI = ROOT / "skills/creatio-branding-orchestrator/agents/openai.yaml"
AGENTS = ROOT / "AGENTS.md"
SKILLS_README = ROOT / "skills/README.md"
TELEMETRY = ROOT / "context/product-telemetry.md"

TOOLKIT_DOCS = (SKILL, ASSETS, OPENAI, AGENTS, SKILLS_README)

CLIO_OWNED = (
    "set-background-image",
    "set-background-color",
    "remove-background",
    "background-image-file",
    "background-image-id",
    "background-color",
    "themeBackgroundSupported",
    "panelIconBackground",
    "CrtBackgroundConfig",
    "DisableThemeBackground",
    "UseAccessibleDesktopColor",
    "UsePanelIconBackground",
    "keep-icon-background",
    "10.2.96",
)


def read_text(path):
    return path.read_text(encoding="utf-8")


def prose(path):
    return " ".join(read_text(path).split())


class BrandingThemeBackgroundTargetTests(unittest.TestCase):

    def test_a_branding_run_puts_the_background_into_the_theme_it_builds(self):
        self.assertIn("Default: the theme this run builds, or the theme the user names", prose(SKILL))

    def test_the_whole_site_is_set_only_on_request(self):
        self.assertIn("Only when the user asks for the whole site", prose(SKILL))

    def test_a_color_is_set_only_on_request(self):
        self.assertIn("| A solid color | Only when the user asks for one |", prose(SKILL))

    def test_the_user_can_supply_the_picture(self):
        self.assertIn(
            "| The user's own image | The user supplies a file. Sanitize an SVG per the Logos step |",
            prose(SKILL),
        )

    def test_the_shell_background_wording_is_gone(self):
        self.assertNotIn("shell background", prose(SKILL))


class BrandingThemeBackgroundAssetOnlyTests(unittest.TestCase):

    def test_a_background_only_request_asks_which_theme(self):
        self.assertIn(
            "Background only: ask which theme gets it, unless the user asked for the whole site",
            prose(SKILL),
        )

    def test_only_a_generated_picture_needs_the_palette_conversation(self):
        self.assertIn(
            "Only a generated picture needs brand intake and the palette conversation first",
            prose(SKILL),
        )

    def test_removing_a_theme_background_has_a_route(self):
        self.assertIn(
            "Removing the background from a theme: ask which theme. Nothing else is collected.",
            prose(SKILL),
        )


class BrandingThemeBackgroundApplyTests(unittest.TestCase):

    def test_the_recap_names_the_background_target(self):
        self.assertIn(
            "the background: its source and target, the theme it is removed from, or none",
            prose(SKILL),
        )

    def test_only_a_site_background_is_environment_wide(self):
        self.assertIn(
            "the logos, the favicon and a site background are **environment-wide**",
            prose(SKILL),
        )

    def test_the_old_environment_wide_background_claim_is_gone(self):
        self.assertNotIn("the favicon and the background are **environment-wide**", prose(SKILL))

    def test_the_gate_takes_its_side_effect_from_the_theming_guidance(self):
        self.assertIn(
            "the `theming` guidance names an environment-wide side effect of setting one "
            "and how the access check shows whether it applies",
            prose(SKILL),
        )

    def test_the_gate_comes_before_the_first_environment_wide_write(self):
        self.assertIn(
            "before the first write that makes any environment-wide change, "
            "take a distinct, explicit confirmation separate from the summary confirmation",
            prose(SKILL),
        )

    def test_the_gate_moves_before_the_theme_write_when_the_side_effect_applies(self):
        self.assertIn(
            "When the side effect applies, that first write is the theme write, so ask before creating "
            "the theme; the one question covers the logos, the favicon and a site background too.",
            prose(SKILL),
        )

    def test_a_declined_side_effect_drops_the_theme_background(self):
        self.assertIn(
            "a declined side effect means the theme is created without its background",
            prose(SKILL),
        )

    def test_removing_a_theme_background_skips_the_gate(self):
        self.assertIn("Removing a theme background needs no such confirmation", prose(SKILL))

    def test_the_closing_message_says_who_sees_the_background(self):
        self.assertIn("Say who sees the background, per the targets in the Background step", prose(SKILL))

    def test_the_mechanics_point_to_the_guidance_that_owns_each_background(self):
        self.assertIn(
            "the `theming` guidance for setting, changing, removing or reading a theme's background, "
            "including the version it needs and the fallback when the environment lacks it, and the "
            "`branding` guidance for the logos, the favicon and a site background",
            prose(SKILL),
        )


class BrandingThemeBackgroundOrderTests(unittest.TestCase):

    def test_the_background_step_ends_with_the_background_ready(self):
        self.assertIn(
            "By the end of this step the background is ready: the user's file, the color, or the "
            "generated picture in its temporary file.",
            prose(SKILL),
        )

    def test_the_theme_background_goes_into_the_theme_write(self):
        self.assertIn(
            "A theme's background is not a separate apply: it goes into the theme write itself",
            prose(SKILL),
        )

    def test_an_existing_theme_changes_only_its_background(self):
        self.assertIn(
            "for an existing theme, an update that changes only the background and needs no CSS",
            prose(SKILL),
        )

    def test_the_theme_is_applied_before_the_environment_wide_assets(self):
        self.assertIn(
            "Apply in this order: the theme with its background, then applying it to you (see below), "
            "then the logos and the favicon, then a site background.",
            prose(SKILL),
        )

    def test_a_refused_background_leaves_no_theme_and_offers_a_choice(self):
        self.assertIn(
            "If the theme write fails because of its background — for example, the image is refused — "
            "the theme is not created: relay the reason, then ask whether to create it without a "
            "background or with another file.",
            prose(SKILL),
        )


class BrandingThemeBackgroundTelemetryTests(unittest.TestCase):

    def test_the_skill_sends_theme_then_background_after_the_theme_write(self):
        self.assertIn(
            "a theme's background is written with the theme, so send `theme` and then `background` "
            "after that one write",
            prose(SKILL),
        )

    def test_the_branding_flow_row_lists_the_background_variant(self):
        self.assertIn("per applied asset (`variant=theme` / `logo` / `background`)", prose(TELEMETRY))


class BrandingThemeBackgroundStatedOnceTests(unittest.TestCase):

    def test_each_background_rule_lives_in_one_place(self):
        content = prose(SKILL)
        for rule in (
            "Default: the theme this run builds",
            "Only when the user asks for the whole site",
            "Only when the user asks for one",
            "Removing the background from a theme",
            "the theme the user name",
            "palette conversation first",
            "environment-wide side effect",
            "separate from the summary confirmation",
            "that first write is the theme write",
            "Apply in this order",
            "written with the theme",
            "Removing a theme background needs no such confirmation",
            "the fallback when the environment lacks it",
            "| Accounts on that theme |",
            "| Every account whose theme has no background |",
        ):
            with self.subTest(rule=rule):
                self.assertEqual(content.count(rule), 1)


class BrandingThemeBackgroundRoutingTests(unittest.TestCase):

    def test_every_routing_line_advertises_the_theme_background(self):
        for path in (SKILL, OPENAI, AGENTS, SKILLS_README):
            with self.subTest(path=path.name):
                self.assertIn("as part of a theme", prose(path))

    def test_no_routing_line_limits_the_background_to_a_generated_picture(self):
        for path in (SKILL, OPENAI, AGENTS, SKILLS_README):
            with self.subTest(path=path.name):
                self.assertNotIn("palette-matched app background", prose(path))


class BrandingThemeBackgroundOwnershipTests(unittest.TestCase):

    def test_clio_tools_settings_features_and_versions_stay_out_of_the_toolkit(self):
        for path in TOOLKIT_DOCS:
            content = read_text(path)
            for owned in CLIO_OWNED:
                with self.subTest(path=path.name, owned=owned):
                    self.assertNotIn(owned, content)


if __name__ == "__main__":
    unittest.main()
