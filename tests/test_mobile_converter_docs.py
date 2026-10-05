"""The Web->Mobile converter is generally available, and the docs must say so consistently.

Three rules, each pinned because breaking it is silent for the user and green for CI:

1. No instruction anywhere tells an operator to enable a feature flag for the converter.
   The flag does not exist; running the command would print an orphan-key warning and
   change nothing, and the user would conclude the toolkit is broken.

2. Availability is decided from ``get-tool-contract``, never from the server's ``tools/list``.
   The converter is a long-tail tool: it is reachable through ``clio-run`` and discovered
   through the tool-contract index, and it is deliberately absent from ``tools/list`` even
   when it works. A preflight that reads ``tools/list`` reports EVERY clio as missing the
   tool, then tells a fully up-to-date user to update clio - on every retry, forever.

3. The blocked-plan telemetry variant names the condition that can actually occur. With the
   flag gone, ``feature-disabled`` can never be emitted, so a run blocked by an outdated clio
   would either be reported under a stale reason or not reported at all.

``RELEASE-NOTES.md`` is exempt from rule 1: it is a historical record, and the releases that
shipped the flag really did require it.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILL = ROOT / "skills/creatio-mobile-page-conversion/SKILL.md"
PLAYBOOK = ROOT / "skills/creatio-mobile-page-conversion/references/page-to-mobile-conversion.md"
TELEMETRY = ROOT / "context/product-telemetry.md"

# Every surface an agent or an operator reads as instruction. RELEASE-NOTES.md is not here.
INSTRUCTION_DIRS = ("skills", "runbooks", "context", "rules")

FEATURE_KEY = "mobile-page-converter"
TOOL_NAME = "get-mobile-page-conversion-guide"


def instruction_files():
    for directory in INSTRUCTION_DIRS:
        root = ROOT / directory
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.md")):
            yield path


def read(path):
    return path.read_text(encoding="utf-8")


class MobileConverterDocsTests(unittest.TestCase):

    def test_no_instruction_tells_the_operator_to_enable_the_feature_flag(self):
        offenders = []
        for path in instruction_files():
            text = read(path)
            if "clio experimental" in text and FEATURE_KEY in text:
                offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual(
            [], offenders,
            "the converter is generally available, so no instruction may pair "
            "'clio experimental' with the retired '%s' key - the command would print an "
            "orphan-key warning, change nothing, and leave the user believing the toolkit "
            "is broken: %s" % (FEATURE_KEY, offenders))

    def test_preflight_decides_availability_from_the_tool_contract_not_tools_list(self):
        text = read(SKILL)
        self.assertIn(
            "get-tool-contract", text,
            "the preflight must name the discovery surface that actually carries a long-tail tool")
        preflight = text.split("## Load order", 1)[0]
        self.assertNotIn(
            "list the server tools", preflight,
            "the converter is long-tail and never appears in tools/list, so a preflight that "
            "reads the server's tool list reports every clio as missing it and sends an "
            "up-to-date user into an endless 'update clio' loop")
        self.assertRegex(
            preflight, r"NOT the server's `tools/list`",
            "the reason tools/list is the wrong surface must be stated, or the check will be "
            "'simplified' back to it by the next reader")

    def test_both_stop_branches_survive_and_offer_a_remedy_that_can_work(self):
        preflight = read(SKILL).split("## Load order", 1)[0]
        self.assertIn(
            "dotnet tool update clio -g", preflight,
            "the absent-tool branch must tell the user how to get a clio that ships the converter")
        self.assertIn(
            "clio update-knowledge", preflight,
            "the missing-article branch is a DIFFERENT failure: the guidance library is fetched "
            "and cached separately from the tool, so updating clio alone may not fix it and the "
            "message must offer the step that refreshes the library")
        self.assertIn(
            "freedom-page-web-to-mobile-conversion", preflight,
            "the missing-article branch must name the article it is about")

    def test_blocked_plan_variant_names_a_condition_that_can_occur(self):
        for path in (SKILL, TELEMETRY):
            text = read(path)
            self.assertIn(
                "converter-unavailable", text,
                "%s must report a blocked plan under the condition that can actually occur - an "
                "outdated clio" % path.name)
            self.assertNotIn(
                "feature-disabled", text,
                "%s still names a blocked reason that became unreachable when the feature flag "
                "was removed" % path.name)

    def test_the_tablet_limit_is_stated_as_experimental_not_as_missing(self):
        text = read(PLAYBOOK)
        notice = re.search(r"^  ⚠️ The \*\*web-Freedom-page.*$", text, re.MULTILINE)
        self.assertIsNotNone(
            notice, "the plan's scope notice must still be present and printed verbatim")
        line = notice.group(0)
        self.assertIn(
            "experimental", line.lower(),
            "tablet layout IS generated, so the notice must mark it experimental; a user told the "
            "rendering does not exist yet has no reason to go and check it")
        self.assertNotIn(
            "roadmap", line.lower(),
            "'on the roadmap' describes a feature that produces nothing, which is not this one")


if __name__ == "__main__":
    unittest.main()
