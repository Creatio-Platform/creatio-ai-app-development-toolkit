import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-branding-orchestrator/SKILL.md"

# The Fonts step keeps only what clio's theming guidance cannot carry: where the non-Google approval
# gate sits in THIS skill's gate model. Everything technical — the family-name contract, the
# availability check, the web-font mechanics, the warning vocabulary — lives in that guidance, which
# owns it and pins it with clio's own tests. So this file pins the delegation pointer and that gate,
# and nothing else: asserting the delegated rules here would recreate the duplication the step was
# trimmed to remove, and asserting prose that carries no rule would freeze wording without
# protecting behaviour.


def read_skill_unwrapped():
    # These markers are prose sentences, and prose re-wraps on every edit. Collapsing whitespace
    # keeps the assertions about the wording rather than about where the line breaks.
    return " ".join(SKILL.read_text(encoding="utf-8").split())


def fonts_step():
    content = read_skill_unwrapped()
    start = content.index("## Fonts — after the background")
    return content[start : content.index("## Theme name — after fonts", start)]


def conversation_rules():
    # The Fonts step's approval-gate carve-out is stated here rather than in the step itself, so
    # fonts_step() cannot see it.
    content = read_skill_unwrapped()
    start = content.index("## Conversation rules")
    return content[start : content.index("## Build and apply", start)]


class BrandingFontsDocTests(unittest.TestCase):
    def test_skill_exists(self):
        self.assertTrue(SKILL.exists(), str(SKILL))

    def test_the_step_delegates_to_clio_guidance_in_its_heading(self):
        # Load-bearing after the trim: the name contract, the availability check, the web-font
        # mechanics and the warning vocabulary now live only in clio's theming guidance, so this
        # pointer stands in for every rule it replaces. It rides in the heading like every other
        # delegating step in this skill, rather than as a body paragraph that would also have to
        # enumerate — and so drift from — what that guidance covers.
        self.assertIn("## Fonts — after the background — follow clio's theming guidance", fonts_step())

    def test_a_non_google_family_is_its_own_approval_gate(self):
        # Skill policy rather than clio's mechanics, and the whole reason this slice exists: an
        # unpublished family renders only where it is installed, so the agent must not decide it for
        # the user — including when the availability check comes back inconclusive.
        step = fonts_step()
        self.assertIn('exception to "font steps are not approval gates"', step)
        self.assertIn("explicit confirmation", step)
        self.assertIn("inconclusive: ask", step)

    def test_the_conversation_rules_carve_out_survives(self):
        # "font steps are not approval gates" is the general rule and the carve-out above is its one
        # exception, stated as a separate, EARLIER gate. Dropping or inverting this sentence would
        # quietly remove the confirmation this slice adds.
        rules = conversation_rules()
        self.assertIn("One exception inside the Fonts step", rules)
        self.assertIn("does not replace", rules)

    def test_the_outcome_is_reported_from_clios_warnings(self):
        # The agent has no other evidence of what shipped — it does not see the CSS in either flow —
        # so reporting a font outcome no warning corroborates is the failure this pins against.
        self.assertIn("Never tell the user a font shipped a particular way", fonts_step())

    def test_the_step_names_no_css_mechanics(self):
        # The step states a conversation policy, not how the theme loads a font. Naming the CSS
        # mechanic here would put a second, drifting copy of it outside the guidance that owns it —
        # clio's guidance carries the no-hand-authoring rule and pins it with clio's own tests.
        self.assertNotIn("@import", fonts_step())


if __name__ == "__main__":
    unittest.main()
