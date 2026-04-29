import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

AGENT4_DELEGATED_GUIDE_MARKERS = [
    "docs://mcp/guides/agent-execution",
    "docs://mcp/guides/support-mode",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class Agent4ImplementationContractTests(unittest.TestCase):
    def test_agent4_runbook_delegates_execution_mechanics_to_clio_guides(self):
        content = read_text(ROOT / "agents/04-implementation.md")
        for marker in AGENT4_DELEGATED_GUIDE_MARKERS:
            self.assertIn(marker, content, f"Missing in 04-implementation.md: {marker!r}")
        self.assertIn(
            "Execute the `Model Decisions` already recorded in the plan",
            content,
            "runbook must keep the plan-bound decision rule that prevents reinterpretation during execution",
        )

    def test_agent4_runbook_keeps_plan_bound_blockers(self):
        content = read_text(ROOT / "agents/04-implementation.md")
        self.assertIn("missing or contradictory `Model Decision`", content)
        self.assertIn("second `BaseEntity` for the same primary record type", content)


if __name__ == "__main__":
    unittest.main()
