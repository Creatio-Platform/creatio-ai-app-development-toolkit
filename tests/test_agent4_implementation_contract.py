import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

AGENT4_SCHEMA_SYNC_MARKERS = [
    "Schema Sync Rules",
    "InsertQuery failed",
    "metadata readback timeout",
    "confirms the section was actually created",
    "get-entity-schema-properties",
    "auto-generated `UsrName` column",
    "delete the orphaned entity using `delete-schema`",
    "record this cleanup attempt as a recovery action",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class Agent4ImplementationContractTests(unittest.TestCase):
    def test_agent4_runbook_covers_section_timeout_recovery_entity_cleanup(self):
        content = read_text(ROOT / "agents/04-implementation.md")
        for marker in AGENT4_SCHEMA_SYNC_MARKERS:
            self.assertIn(marker, content, f"Missing in 04-implementation.md: {marker!r}")

    def test_agent4_bundle_covers_section_timeout_recovery_entity_cleanup(self):
        bundle = read_text(ROOT / "context/.cache/agent-4-bundle.md")
        for marker in AGENT4_SCHEMA_SYNC_MARKERS:
            self.assertIn(marker, bundle, f"Missing in agent-4-bundle.md: {marker!r}")


if __name__ == "__main__":
    unittest.main()
