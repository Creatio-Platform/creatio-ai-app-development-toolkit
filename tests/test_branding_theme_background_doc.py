import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-branding-orchestrator/SKILL.md"
ASSETS = ROOT / "skills/creatio-branding-orchestrator/references/branding-assets.md"
OPENAI = ROOT / "skills/creatio-branding-orchestrator/agents/openai.yaml"
AGENTS = ROOT / "AGENTS.md"
SKILLS_README = ROOT / "skills/README.md"
TELEMETRY = ROOT / "context/product-telemetry.md"

ROUTING_DOCS = (SKILL, OPENAI, AGENTS, SKILLS_README)

CLIO_OWNED = (
    "set-background-image",
    "remove-background",
    "background-image-id",
    "background-color",
    "CrtBackgroundConfig",
    "DisableThemeBackground",
    "UseAccessibleDesktopColor",
    "UsePanelIconBackground",
    "keep-icon-background",
    "10.2.96",
)

SKILL_RULES = (
    "| Accounts on that theme |",
    "| Every account whose theme has no background |",
    "Default: the theme this run builds, or the theme the user names",
    "Only when the user asks for the whole site",
    "| A solid color | Only when the user asks for one |",
    "| The user's own image | The user supplies a file. Sanitize an SVG per the Logos step |",
    "Background only: ask which theme gets it, unless the user asked for the whole site",
    "Only a generated picture needs brand intake and the palette conversation first",
    "Removing the background from a theme: ask which theme. Nothing else is collected.",
    "By the end of this step the background is ready: the user's file, the color, or the generated "
    "picture in its temporary file.",
    "the background: its source and target, the theme it is removed from, or none",
    "A background for an existing theme goes to that theme's own package instead; say so.",
    "A theme's background is not a separate apply: it goes into the theme write itself",
    "for an existing theme, an update that changes only the background and needs no CSS",
    "Apply in this order: the theme with its background, then applying it to you (see below), "
    "then the logos and the favicon, then a site background.",
    "If the theme write fails because of its background, nothing is written: relay the reason, "
    "then ask whether to go on without a background or with another file.",
    "the logos, the favicon and a site background are **environment-wide**",
    "the `theming` guidance names an environment-wide side effect of setting one.",
    "before the first write that makes any environment-wide change, "
    "take a distinct, explicit confirmation separate from the summary confirmation",
    "When the theme gets a background, that first write is the theme write, so ask before it; "
    "the one question covers the logos, the favicon and a site background too.",
    "Removing a theme background needs no such confirmation",
    "a declined side effect is handled per the `theming` guidance.",
    "`theming` for a theme's background, including the version it needs and the fallback when the "
    "environment lacks it; `branding` for the logos, the favicon and a site background",
    "Say who sees the background, per the targets in the Background step",
    "a theme write that carries a background also sends `background` — after `theme` for a new theme, "
    "alone when it only changes or removes the background",
    "Default: the theme this run builds",
    "the theme the user name",
    "palette conversation first",
    "environment-wide side effect",
    "separate from the summary confirmation",
    "that first write is the theme write",
    "Apply in this order",
    "the fallback when the environment lacks it",
    "carries a background",
)


def prose(path):
    return " ".join(path.read_text(encoding="utf-8").split())


class BrandingThemeBackgroundDocTests(unittest.TestCase):

    def test_the_skill_states_each_background_rule_once(self):
        skill = prose(SKILL)
        for rule in SKILL_RULES:
            with self.subTest(rule=rule):
                self.assertEqual(skill.count(rule), 1)

    def test_the_branding_flow_row_lists_the_background_variant(self):
        self.assertIn("per applied asset (`variant=theme` / `logo` / `background`)", prose(TELEMETRY))

    def test_every_routing_line_offers_a_background_as_part_of_a_theme(self):
        for path in ROUTING_DOCS:
            with self.subTest(path=path.name):
                self.assertIn("as part of a theme", prose(path))
                self.assertNotIn("palette-matched app background", prose(path))

    def test_clio_tools_settings_features_and_versions_stay_out_of_the_toolkit(self):
        for path in ROUTING_DOCS + (ASSETS,):
            content = path.read_text(encoding="utf-8")
            for owned in CLIO_OWNED:
                with self.subTest(path=path.name, owned=owned):
                    self.assertNotIn(owned, content)


if __name__ == "__main__":
    unittest.main()
