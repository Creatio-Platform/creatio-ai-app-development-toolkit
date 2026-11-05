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
    "| A solid color | Only when the user asks for one, and only for a theme |",
    "| The user's own image | The user supplies a file. Sanitize an SVG per the Logos step |",
    "Background only: ask which theme gets it, unless the user asked for the whole site",
    "Only a generated picture needs brand intake and the palette conversation first",
    "Removing the background from a theme: ask which theme. Nothing else is collected.",
    "By the end of this step the background is ready: the user's file, the color, or the generated "
    "picture in its temporary file.",
    "the background: its source and target, the theme it is removed from, or none",
    "A background for an existing theme goes to that theme's own package instead, as the `theming` guidance says; name it.",
    "The theme's background goes into that same write; for an existing theme it is an update that "
    "changes only the background.",
    "Then apply the theme to you (see below), then the logos and the favicon, then a site background; "
    "clio's `branding` guidance has the mechanics of the last two.",
    "If the theme write fails because of its background, the theme write changes nothing, but an image "
    "uploaded for it stays: relay the reason, reuse that image on a retry, and ask whether to go on without "
    "a background or with another file.",
    "The logos, the favicon and a site background are **environment-wide**, and the `theming` and "
    "`branding` guidance name an environment-wide side effect of setting any background.",
    "Before the first write that makes such a change — the theme write, when the theme gets a "
    "background — take one explicit confirmation, separate from the summary",
    "Removing a theme background needs none.",
    "a declined side effect is handled per that guidance.",
    "saying who sees the background (see the targets in the Background step)",
    "a theme write that carries a background also sends `background` — after `theme` for a new theme, "
    "alone when it only changes or removes the background",
    "Default: the theme this run builds",
    "the theme the user name",
    "palette conversation first",
    "environment-wide side effect",
    "separate from the summary",
    "goes into that same write",
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

    def test_every_routing_line_names_a_background_and_leaves_its_targets_to_the_skill(self):
        for path in ROUTING_DOCS:
            with self.subTest(path=path.name):
                self.assertRegex(prose(path), r"\ban? (app )?background\b")
                if path != SKILL:
                    self.assertNotIn("whole site", prose(path))

    def test_clio_tools_settings_features_and_versions_stay_out_of_the_toolkit(self):
        for path in ROUTING_DOCS + (ASSETS,):
            content = path.read_text(encoding="utf-8")
            for owned in CLIO_OWNED:
                with self.subTest(path=path.name, owned=owned):
                    self.assertNotIn(owned, content)


if __name__ == "__main__":
    unittest.main()
