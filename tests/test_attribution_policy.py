import json
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATTERN = re.compile(
    r"<!-- BEGIN MANAGED SECTION: company-agent-policy v\d+\.\d+\.\d+ -->"
    r"[\s\S]*?<!-- END MANAGED SECTION -->"
)
UNAVAILABLE_SKILL = "ensure-ai-commit-attribution"
INSTRUCTION_SUFFIXES = {".md", ".mdc", ".yaml", ".yml", ".json", ".mjs", ".js"}
SKILL_REFERENCE_PATTERN = re.compile(r"(?<![\w$])\$([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b")
POLICY_SECTION_HEADING = "## Attribution Policy Maintenance"


def is_instruction_file(path):
    return path.suffix.lower() in INSTRUCTION_SUFFIXES


def shipped_instruction_paths(root=ROOT):
    """Read host instructions, prompts, manifests and hook scripts from the release manifest."""
    manifest = json.loads((root / ".release-manifest.json").read_text(encoding="utf-8"))
    paths = {root / "CLAUDE.md"}
    for entries in manifest.values():
        for entry in entries:
            path = root / entry
            if path.is_dir():
                paths.update(
                    child for child in path.rglob("*")
                    if child.is_file() and is_instruction_file(child)
                )
            elif path.is_file() and is_instruction_file(path):
                paths.add(path)
    return sorted(paths)


def shipped_skill_names(root=ROOT):
    return {path.parent.name for path in (root / "skills").glob("*/SKILL.md")}


def find_unavailable_skill_violations(root=ROOT):
    """List shipped files that name the unavailable skill or a `$skill` the release does not ship."""
    shipped = shipped_skill_names(root)
    violations = []
    for path in shipped_instruction_paths(root):
        text = path.read_text(encoding="utf-8")
        unresolved = {name for name in SKILL_REFERENCE_PATTERN.findall(text) if name not in shipped}
        if UNAVAILABLE_SKILL in text.lower() or unresolved:
            violations.append(path.relative_to(root).as_posix())
    return violations


def contributing_policy_section(text):
    start = text.index(POLICY_SECTION_HEADING)
    end = text.find("\n## ", start + len(POLICY_SECTION_HEADING))
    return text[start:] if end == -1 else text[start:end]


class AttributionPolicyTests(unittest.TestCase):
    def test_inventory_guard_checks_each_host_instruction_format(self):
        # Arrange
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "CLAUDE.md").write_text("Host instructions\n", encoding="utf-8")
            (root / ".release-manifest.json").write_text(
                json.dumps({"plugin_runtime": ["rules", "skills", "hooks", ".mcp.json"]}), encoding="utf-8",
            )
            (root / "skills/example/SKILL.md").parent.mkdir(parents=True)
            (root / "skills/example/SKILL.md").write_text("Use $example-shipped.\n", encoding="utf-8")
            (root / "skills/example-shipped/SKILL.md").parent.mkdir(parents=True)
            (root / "skills/example-shipped/SKILL.md").write_text("Shipped skill\n", encoding="utf-8")
            instruction_paths = (
                "rules/policy.md", "rules/UPPER.MD", "rules/policy.mdc",
                "skills/example/agents/openai.yaml", "skills/example/agents/other.yml",
                ".mcp.json", "hooks/guard.mjs", "hooks/guard.js",
            )
            for relative in instruction_paths:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("Host instructions\n", encoding="utf-8")
            clean = find_unavailable_skill_violations(root)
            for relative in instruction_paths:
                for reference in (f"Before edits, use ${UNAVAILABLE_SKILL}.", "Before edits, use $renamed-attribution."):
                    with self.subTest(path=relative, reference=reference):
                        path = root / relative
                        path.write_text(f"{reference}\n", encoding="utf-8")
                        # Act
                        violations = find_unavailable_skill_violations(root)
                        # Assert
                        self.assertEqual(clean, [], "Shipped skill references must pass the guard")
                        self.assertEqual(violations, [relative], "The guard must identify the offending host file")
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

    def test_public_instructions_reference_only_shipped_skills(self):
        # Arrange
        paths = shipped_instruction_paths()
        # Act
        violations = find_unavailable_skill_violations()
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
        self.assertIn(POLICY_SECTION_HEADING, contributing, "CONTRIBUTING.md must keep the policy section")
        instructions = contributing_policy_section(contributing)
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
