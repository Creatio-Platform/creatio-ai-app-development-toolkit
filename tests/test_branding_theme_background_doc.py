import re
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

ROUTING_PHRASES = {
    SKILL: "set or remove a background",
    OPENAI: "set or remove a background",
    AGENTS: "setting or removing an app background",
    SKILLS_README: "and a background",
}

CLIO_OWNED = (
    "set-background-image",
    "theme-background",
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
    "Background only: ask which theme gets it, unless the user named one or asked for the whole site",
    "Only a generated picture needs brand intake and the palette conversation first",
    "Removing a background: ask which theme, unless the user named it or means the whole site.",
    "A site background cannot be removed, only replaced (the `branding` guidance): say so and offer to replace it.",
    "offer the background only if the user brings it up, and then take it as Background only below.",
    "do not create a new theme or ask for a new theme's name",
    "By the end of this step the background is ready: the user's file, the color, or the generated "
    "picture in its temporary file.",
    "the background: its source and target, the theme it is removed from, or none, and who sees it: the accounts on that "
    "theme — every account without a personal theme when it is the environment's default theme, which the `theming` "
    "guidance reads — or, for the whole site, every account whose theme has no background.",
    "A background for an existing theme goes to that theme's own package instead, as the `branding` guidance says; name it.",
    "The theme's background goes into that same write; for an existing theme it is an update that "
    "changes only the background.",
    "Then, when this run created a theme, apply it to you (see below); then the logos and the favicon, "
    "then a site background; clio's `branding` guidance has the mechanics of the last two.",
    "If the theme write fails or its background is refused, relay the reason in plain words and follow the "
    "recovery in clio's theming guidance, asking any choice it leaves to the user as one question; an image "
    "uploaded for the failed write stays, so reuse it on a retry.",
    "When the background's source itself was refused, offer one of the same kind: another file, another color, or "
    "a regenerated picture.",
    "The logos, the favicon and a site background are **environment-wide**, and clio's guidance names an "
    "environment-wide side effect of setting any background.",
    "If the user declines, leave the logos, the favicon and a site background unchanged and say so; a theme confirmed "
    "in the summary is still written, and a declined side effect is handled per clio's `theming` guidance.",
    "After the single final confirmation, and the environment-wide one when it applies, follow clio's theming "
    "guidance",
    "It covers a theme without a background, which is a per-user change;",
    "Close by naming the package or packages the recap named",
    "Before the first write that makes such a change — the theme write when the theme gets a "
    "background, otherwise the first asset write — take one explicit confirmation, separate from the summary",
    "include it, unless the request already settled the background.",
    "Removing a theme background needs none.",
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


def routing_text(path):
    text = path.read_text(encoding="utf-8")
    if path == SKILL:
        return re.search(r"^description: (.+)$", text, re.M).group(1)
    if path == OPENAI:
        return " ".join(re.findall(r'^(?:short_description|default_prompt): "(.+)"$', text, re.M))
    if path == AGENTS:
        start = text.index("Use the branding flow when")
        return " ".join(text[start:text.index("Route branding requests", start)].split())
    return next(line for line in text.splitlines() if line.startswith("- **`creatio-branding-orchestrator/`**"))


class BrandingThemeBackgroundDocTests(unittest.TestCase):

    def test_the_skill_states_each_background_rule_once(self):
        skill = prose(SKILL)
        for rule in SKILL_RULES:
            with self.subTest(rule=rule):
                self.assertEqual(skill.count(rule), 1)

    def test_the_branding_flow_row_lists_the_background_variant(self):
        self.assertIn("per applied asset (`variant=theme` / `logo` / `background`)", prose(TELEMETRY))

    def test_the_environment_wide_confirmation_comes_before_the_theme_write(self):
        skill = prose(SKILL)
        self.assertLess(skill.index("Before the first write that makes such a change"),
                        skill.index("follow clio's theming guidance to build the theme CSS"))

    def test_every_routing_line_names_a_background_and_leaves_its_targets_to_the_skill(self):
        for path in ROUTING_DOCS:
            with self.subTest(path=path.name):
                text = routing_text(path)
                self.assertIn(ROUTING_PHRASES[path], text)
                self.assertNotIn("whole site", text)

    def test_clio_tools_settings_features_and_versions_stay_out_of_the_toolkit(self):
        for path in ROUTING_DOCS + (ASSETS,):
            content = path.read_text(encoding="utf-8")
            for owned in CLIO_OWNED:
                with self.subTest(path=path.name, owned=owned):
                    self.assertNotIn(owned, content)


if __name__ == "__main__":
    unittest.main()
