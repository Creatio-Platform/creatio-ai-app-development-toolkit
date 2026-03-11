import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATHS = [
    ROOT / "AGENTS.md",
    ROOT / "agents/02-requirements-gathering.md",
    ROOT / "agents/03-implementation-plan.md",
    ROOT / "agents/04-implementation.md",
    ROOT / "context/essentials.md",
    ROOT / "context/mcp-application-tools-reference.md"
]


class DefaultContractDocsTests(unittest.TestCase):
    def test_docs_define_schema_and_ui_defaults(self):
        for path in DOC_PATHS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("schema default", content, str(path))
            self.assertIn("ui default", content, str(path))

    def test_docs_reject_seed_rows_as_default_closure(self):
        for path in DOC_PATHS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("Lookup seed rows alone do not satisfy", content, str(path))


if __name__ == "__main__":
    unittest.main()
