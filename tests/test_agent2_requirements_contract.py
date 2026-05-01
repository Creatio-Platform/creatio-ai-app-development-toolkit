import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REUSE_DISCOVERY_MARKERS = [
    "Reuse Discovery Signals",
    "Business concept",
    "Why ambiguous",
    "Suspected candidates",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class Agent2RequirementsContractTests(unittest.TestCase):
    def test_agent2_runbook_requires_reuse_discovery_in_handoff(self):
        content = read_text(ROOT / "agents/02-requirements-gathering.md")
        for marker in REUSE_DISCOVERY_MARKERS:
            self.assertIn(marker, content)
        self.assertIn("`reuse`, `extend`, or `create`", content)

if __name__ == "__main__":
    unittest.main()
