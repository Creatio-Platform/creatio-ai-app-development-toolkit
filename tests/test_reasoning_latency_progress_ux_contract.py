"""ENG-91278 — harness reasoning-latency and progress-UX contract.

A routine "add a section" run regressed to 50%+ of wall-time spent in model
reasoning, with multi-minute silent gaps and recovered tool errors that read as
failures (atomized from ENG-90506 run1). These doc-contract assertions lock the
three mitigations into AGENTS.md so the orchestrator keeps a routine change
bounded and visible:

  1. bounded reasoning effort + a bounded recovery budget for routine changes,
  2. progress signals with no silent gap beyond 60 seconds,
  3. recovered, non-blocking tool errors reframed instead of surfaced as failures.

Style mirrors test_default_contract_docs.py: plain unittest substring assertions
over the policy docs (the repository treats AGENTS.md as the orchestration
contract, not the executable MCP contract).
"""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class ReasoningLatencyProgressUxContractTests(unittest.TestCase):
    def setUp(self):
        self.agents = read_text(ROOT / "AGENTS.md")
        self.agents_lower = self.agents.lower()
        self.runbook01 = read_text(ROOT / "runbooks/01-environment-setup.md")

    def test_agents_defines_execution_ux_and_effort_budget_section(self):
        # The three mitigations live under one dedicated policy section.
        self.assertIn("## Execution UX and Effort Budget", self.agents)

    def test_agents_bounds_effort_and_recovery_for_routine_changes(self):
        for marker in [
            "bounded reasoning effort",
            "bounded recovery budget",
            "targeted change",
        ]:
            self.assertIn(marker, self.agents, marker)
        # A routine change must not auto-pivot to expensive fallback paths.
        self.assertIn("raw SQL", self.agents)
        self.assertIn("restarting the environment", self.agents)

    def test_agents_requires_progress_signals_with_a_60s_ceiling(self):
        self.assertIn("progress signal", self.agents_lower)
        self.assertIn("60 seconds", self.agents)  # no silent gap beyond this
        self.assertIn("still working on", self.agents)

    def test_agents_reframes_recovered_non_blocking_errors(self):
        self.assertIn("recovered-error reframing", self.agents_lower)
        self.assertIn("non-blocking", self.agents_lower)
        self.assertIn("recovered automatically", self.agents_lower)
        self.assertIn("actual blocker", self.agents_lower)
        # Support-mode fail-fast still takes precedence over reframing.
        self.assertIn("docs://mcp/guides/support-mode", self.agents)

    def test_runbook01_aligns_recovered_error_handling(self):
        lowered = self.runbook01.lower()
        self.assertIn("recovered", lowered)
        self.assertIn("non-blocking", lowered)

    def test_does_not_regress_first_turn_latency_markers(self):
        # Regression guard: the additions must not disturb the pre-existing
        # UX Contract markers asserted by test_default_contract_docs.py.
        for marker in [
            "first",
            "latency",
            "structured input",
            "do not read large repository files",
        ]:
            self.assertIn(marker, self.agents_lower, marker)


if __name__ == "__main__":
    unittest.main()
