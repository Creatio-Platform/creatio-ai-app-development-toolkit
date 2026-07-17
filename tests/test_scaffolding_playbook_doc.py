import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

RUNBOOK = ROOT / "runbooks/03-app-implementation.md"


def _load_installer():
    spec = importlib.util.spec_from_file_location(
        "caadt_installer", ROOT / "installer" / "install.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_text(path):
    return path.read_text(encoding="utf-8")


def contains_all(text, markers):
    return all(marker in text for marker in markers)


class ScaffoldingPlaybookDocTests(unittest.TestCase):
    def test_implementation_runbook_exists(self):
        self.assertTrue(RUNBOOK.exists(), str(RUNBOOK))

    def test_transient_failure_playbook_covers_the_four_step_recovery(self):
        # AC1: check existence -> wait 60-120 s -> single same-name retry -> poll.
        content = read_text(RUNBOOK)
        self.assertIn("list-app-sections", content)
        self.assertIn("60", content)
        self.assertIn("120", content)
        self.assertIn("in-progress", content)
        self.assertTrue(
            contains_all(content, ["InsertQuery failed", "Select query failed"]),
            "playbook must trigger on both transient error strings",
        )
        self.assertTrue(
            contains_all(content, ["SAME name", "SAME caption"]),
            "playbook must require a single same-name/same-caption retry",
        )

    def test_playbook_forbids_caption_variation_retries(self):
        # AC2: no caption-variation / rename-loop retries.
        content = read_text(RUNBOOK).lower()
        self.assertIn("do not vary or rename the caption", content)

    def test_playbook_forbids_speculative_compile_creatio(self):
        # AC3: no speculative compile-creatio during scaffolding.
        content = read_text(RUNBOOK).lower()
        self.assertIn("do not run `compile-creatio` as a speculative fix", content)

    def test_playbook_requires_sequential_section_creation(self):
        # Prevention: sequential scaffolding is the fix for the contention root cause.
        content = read_text(RUNBOOK).lower()
        self.assertIn("one section at a time", content)

    def test_installer_load_order_registers_the_runbook(self):
        # The installer must surface the new runbook in the rendered agent load order;
        # render_cursor_rule() embeds render_load_order(), so this covers both outputs.
        installer = _load_installer()
        load_order = installer.render_load_order(ROOT)
        self.assertIn("runbooks/01-environment-setup.md", load_order)
        self.assertIn("runbooks/02-requirements-gathering.md", load_order)
        self.assertIn("runbooks/03-app-implementation.md", load_order)
        cursor_rule = installer.render_cursor_rule(ROOT, ROOT / ".mcp.json")
        self.assertIn("runbooks/03-app-implementation.md", cursor_rule)

    def test_installer_copies_the_runbook_on_install(self):
        # REQUIRED_REFERENCE_PATHS drives the file copy into each installed target.
        installer = _load_installer()
        self.assertIn(
            "runbooks/03-app-implementation.md", installer.REQUIRED_REFERENCE_PATHS
        )


if __name__ == "__main__":
    unittest.main()
