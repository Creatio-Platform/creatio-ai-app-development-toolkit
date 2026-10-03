import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATTERN = re.compile(
    r"<!-- BEGIN MANAGED SECTION: company-agent-policy v\d+\.\d+\.\d+ -->"
    r"[\s\S]*?<!-- END MANAGED SECTION -->"
)
UNAVAILABLE_SKILL = "ensure-ai-commit-attribution"
INSTRUCTION_SUFFIXES = {".md", ".mdc", ".yaml", ".yml"}


def shipped_instruction_paths():
    """Read host instructions and prompts from the release manifest."""
    manifest = json.loads((ROOT / ".release-manifest.json").read_text(encoding="utf-8"))
    paths = {ROOT / "CLAUDE.md"}
    for entries in manifest.values():
        for entry in entries:
            path = ROOT / entry
            if path.is_dir():
                paths.update(
                    child for child in path.rglob("*")
                    if child.is_file() and child.suffix in INSTRUCTION_SUFFIXES
                )
            elif path.suffix in INSTRUCTION_SUFFIXES:
                paths.add(path)
    return sorted(paths)


class AttributionPolicyTests(unittest.TestCase):
    def test_inventory_guard_checks_each_host_instruction_format(self):
        # Arrange
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "CLAUDE.md").write_text("Host instructions\n", encoding="utf-8")
            (root / ".release-manifest.json").write_text(
                json.dumps({"plugin_runtime": ["rules", "skills"]}), encoding="utf-8",
            )
            instruction_paths = (
                "rules/policy.md", "rules/policy.mdc",
                "skills/example/agents/openai.yaml", "skills/example/agents/other.yml",
            )
            for relative in instruction_paths:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("Host instructions\n", encoding="utf-8")
            for relative in instruction_paths:
                with self.subTest(path=relative), patch.dict(globals(), ROOT=root):
                    path = root / relative
                    path.write_text(f"Before edits, use ${UNAVAILABLE_SKILL}.\n", encoding="utf-8")
                    # Act
                    result = unittest.TestResult()
                    self.__class__(
                        "test_public_instructions_do_not_reference_unavailable_attribution_skill",
                    ).run(result)
                    # Assert
                    self.assertEqual(result.errors, [], "Every host fixture must be readable")
                    self.assertEqual(len(result.failures), 1, "Every instruction format must reject the unavailable skill")
                    self.assertIn(relative, result.failures[0][1], "The guard must identify the offending host instruction")
                    path.write_text("Host instructions\n", encoding="utf-8")

    def test_managed_policy_blocks_match(self):
        # Arrange
        blocks = []
        for name in ("AGENTS.md", "CLAUDE.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            # Act
            matches = POLICY_PATTERN.findall(text)
            # Assert
            self.assertEqual(len(matches), 1, f"{name} must carry exactly one versioned policy")
            blocks.append(matches[0])
        self.assertEqual(blocks[0], blocks[1], "Both hosts must receive the same attribution contract")

    def test_public_instructions_do_not_reference_unavailable_attribution_skill(self):
        # Arrange
        paths = shipped_instruction_paths()
        # Act
        violations = [
            path.relative_to(ROOT).as_posix() for path in paths
            if UNAVAILABLE_SKILL in path.read_text(encoding="utf-8").lower()
        ]
        # Assert
        self.assertTrue(paths, "The release inventory must include public instructions")
        self.assertEqual(violations, [], "Public instructions must not route to unavailable tooling")

    def test_attribution_is_conditional_on_host_and_installed_tooling(self):
        # Arrange
        text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        # Act
        matches = POLICY_PATTERN.findall(text)
        # Assert
        self.assertEqual(len(matches), 1, "The portable contract must live in the managed policy")
        policy = matches[0]
        for clause in (
            "public Toolkit does not bundle an AI change-attribution integration",
            "Follow applicable repository-specific attribution instructions",
            "Claude Code hooks apply only to Claude Code sessions with those hooks installed",
            "do not assume they run in Codex, Cursor, or GitHub Copilot sessions",
            "If no attribution integration is installed, continue the normal Git workflow",
            "report that specific gap and follow the repository's fallback or ask its maintainer",
            "Toolkit itself adds no attribution prerequisite",
            "Do not invent file markers, install attribution hooks, run manual attribution commands",
            "Toolkit makes no guarantee",
        ):
            with self.subTest(clause=clause):
                self.assertIn(clause, policy, "The policy must preserve the public installation boundary")
        self.assertNotRegex(
            policy,
            r"(?i)(?:allow|require|must)[^\n]*manage[^\n]*trailer[^\n]*automatically",
            "Public policy must not promise automatic commit trailers",
        )

    def test_policy_changes_have_maintainer_and_ci_ownership(self):
        # Arrange
        contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/pr.yml").read_text(encoding="utf-8")
        # Act
        instructions = contributing.split("## Attribution Policy Maintenance", 1)[-1]
        # Assert
        for clause in (
            "Toolkit maintainers own",
            "Update both sections together",
            "advance the policy version",
            "External\npolicy synchronization must go through a pull request",
            "test_attribution_policy.py",
            "assembled release",
        ):
            self.assertIn(clause, instructions, "Policy publishing must retain ownership and validation")
        self.assertIn("pytest tests/", workflow, "PR checks must discover the policy test automatically")


if __name__ == "__main__":
    unittest.main()
