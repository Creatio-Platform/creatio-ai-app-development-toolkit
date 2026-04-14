import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class Agent3ReuseDiscoveryContractTests(unittest.TestCase):
    def test_agents_doc_requires_planning_time_similarity_analysis(self):
        content = read_text(ROOT / "AGENTS.md")
        self.assertIn("explicit `Model Decisions`", content)
        self.assertIn("intentional rather than inferred during execution", content)
        self.assertIn("every planned business object, supporting object, planned lookup, and every non-obvious reference target", content)

    def test_agents_doc_separates_passive_dataforge_diagnostics_from_planning_discovery(self):
        content = read_text(ROOT / "AGENTS.md")
        self.assertIn("implementation plan gate", content)
        self.assertIn("unsupported greenfield assumptions are blocked before Agent 4 runs", content)

    def test_agent3_runbook_requires_deterministic_reuse_discovery_and_no_candidate_record(self):
        content = read_text(ROOT / "agents/03-implementation-plan.md")
        self.assertIn("planning-time reuse assessment", content)
        self.assertIn("Do not defer this assessment to Agent 4", content)
        self.assertIn("dataforge-find-tables", content)
        self.assertIn("dataforge-find-lookups", content)
        self.assertIn("dataforge-context", content)
        self.assertIn("no suitable candidate found", content)
        self.assertIn("missing discovery evidence", content)
        self.assertIn("discovery-evidence", content)
        self.assertIn("schema-creation step unless the matching `Model Decisions` record already resolved that exact business concept to `chosen-action: create`", content)

    def test_agent3_bundle_matches_live_reuse_discovery_contract(self):
        bundle = read_text(ROOT / "context/.cache/agent-3-bundle.md")
        for marker in [
            "planning-time reuse assessment",
            "Do not defer this assessment to Agent 4",
            "dataforge-find-tables",
            "dataforge-find-lookups",
            "dataforge-context",
            "no suitable candidate found",
            "missing discovery evidence",
            "discovery-evidence",
            "schema-creation step unless the matching `Model Decisions` record already resolved that exact business concept to `chosen-action: create`",
        ]:
            self.assertIn(marker, bundle)


if __name__ == "__main__":
    unittest.main()
