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

    def test_transient_failure_playbook_covers_the_five_step_recovery(self):
        # AC1: check existence first -> wait 60-120 s -> single same-name retry ->
        # poll on in-progress -> stop and report on hard failure.
        content = read_text(RUNBOOK)
        lowered = content.lower()
        # Step 1 must order the existence check before any retry, not just mention the tool.
        self.assertIn("check existence first", lowered)
        self.assertIn("list-app-sections", content)
        self.assertIn("60–120 s", content)
        # Poll semantics, not a bare "in-progress" occurrence.
        self.assertIn("success-pending", lowered)
        self.assertTrue(
            contains_all(content, ["SAME name", "SAME caption"]),
            "playbook must require a single same-name/same-caption retry",
        )

    def test_transient_failure_playbook_locks_the_failure_class(self):
        # AC5: trigger on the failure *class*, not one exact string.
        content = read_text(RUNBOOK)
        self.assertIn("class", content.lower())
        self.assertTrue(
            contains_all(
                content,
                ["InsertQuery failed", "Select query failed", "change the caption"],
            ),
            "playbook must key on the whole failure class, not just two strings",
        )

    def test_playbook_locks_single_retry_and_terminal_stop_and_report(self):
        # Heart of ENG-93376: exactly one same-name retry, then stop and report —
        # both on a hard retry failure (step 5) and on poll-cap timeout (step 4).
        lowered = read_text(RUNBOOK).lower()
        self.assertIn("retry once", lowered)
        self.assertIn("stop and report", lowered)
        self.assertIn("do not retry a second time", lowered)
        # Step-4 poll-timeout terminal branch must be defined, not left to improvisation.
        self.assertIn("report the pending state", lowered)

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

    def test_static_surfaces_register_the_runbook(self):
        # AC6: the runbook must stay wired into every toolkit surface, not only the
        # installer-rendered output. Dropping the reference from any of these must fail.
        path_referencing = [
            "skills/creatio-app-orchestrator/SKILL.md",
            "rules/creatio-app-orchestrator.mdc",
            "context/INDEX.md",
            "context/essentials.md",
            "AGENTS.md",
        ]
        for rel in path_referencing:
            content = read_text(ROOT / rel)
            self.assertIn(
                "runbooks/03-app-implementation.md",
                content,
                f"{rel} must reference the implementation runbook",
            )
        # README wires the runbook in descriptively rather than by path.
        readme = read_text(ROOT / "README.md")
        self.assertIn("transient section-creation failure playbook", readme)


if __name__ == "__main__":
    unittest.main()
