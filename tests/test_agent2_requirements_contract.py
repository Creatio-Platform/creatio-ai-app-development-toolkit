import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REUSE_CHECK_MARKERS = [
    "planningSignals",
    "reuseCheckRequired",
    "businessConcept",
    "whyAmbiguous",
    "suspectedCandidates",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class Agent2RequirementsContractTests(unittest.TestCase):
    def test_agent2_runbook_requires_reuse_check_handoff_signals(self):
        content = read_text(ROOT / "agents/02-requirements-gathering.md")
        for marker in REUSE_CHECK_MARKERS:
            self.assertIn(marker, content)
        self.assertIn("must not pre-decide `reuse`, `extend`, or `create`", content)

if __name__ == "__main__":
    unittest.main()
