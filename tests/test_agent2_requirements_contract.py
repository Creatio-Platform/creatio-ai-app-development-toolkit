import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class Agent2RequirementsContractTests(unittest.TestCase):
    def test_agent2_runbook_requires_reuse_check_handoff_signals(self):
        content = read_text(ROOT / "agents/02-requirements-gathering.md")
        self.assertIn("planningSignals", content)
        self.assertIn("reuseCheckRequired", content)
        self.assertIn("businessConcept", content)
        self.assertIn("whyAmbiguous", content)
        self.assertIn("suspectedCandidates", content)
        self.assertIn("must not pre-decide `reuse`, `extend`, or `create`", content)

    def test_agent2_bundle_includes_reuse_check_handoff_signals(self):
        bundle = read_text(ROOT / "context/.cache/agent-2-bundle.md")
        for marker in [
            "planningSignals",
            "reuseCheckRequired",
            "businessConcept",
            "whyAmbiguous",
            "suspectedCandidates",
        ]:
            self.assertIn(marker, bundle)


if __name__ == "__main__":
    unittest.main()
