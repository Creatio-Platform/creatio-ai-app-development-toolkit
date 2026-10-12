"""Every shipped skill, rule and agent file carries frontmatter a strict YAML parser accepts.

GitHub Copilot CLI parses frontmatter with a strict YAML parser and drops a skill whose
header does not parse; Claude Code is lenient and hides the same defect. An unquoted
``description:`` containing ": " is the usual offender (``mapping values are not allowed
in this context``), so each header is parsed with PyYAML's safe loader here.
"""

import re
import subprocess
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git", ".worktrees", ".venv", "__pycache__", ".tmp-tests",
    "node_modules", "vendor", "coverage", "dist", "build", "output",
}
FRONTMATTER = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.DOTALL)


def _tracked_files():
    """Paths git tracks, so only shipped files are checked; None when git is unavailable."""
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return [ROOT / name for name in out.decode("utf-8").split("\0") if name]


_TRACKED = _tracked_files()


def _walk(pattern):
    if _TRACKED is not None:
        return sorted(p for p in _TRACKED if p.match(pattern) and p.is_file())
    return sorted(
        p for p in ROOT.rglob(pattern) if not SKIP_DIRS.intersection(p.relative_to(ROOT).parts)
    )


def _markdown_files():
    files = _walk("SKILL.md") + _walk("*.mdc")
    for folder in ("agents", "commands"):
        files += [p for p in _walk("*.md") if folder in p.relative_to(ROOT).parts[:-1]]
    return sorted(set(files))


def _yaml_files():
    return [p for p in _walk("*.yaml") if "agents" in p.relative_to(ROOT).parts[:-1]]


class FrontmatterYamlTests(unittest.TestCase):
    def test_discovery_finds_the_shipped_files(self):
        names = {p.relative_to(ROOT).as_posix() for p in _markdown_files()}
        self.assertIn("skills/creatio-app-orchestrator/SKILL.md", names)
        self.assertIn("rules/creatio-app-orchestrator.mdc", names)
        self.assertTrue(_yaml_files())

    def test_markdown_frontmatter_parses_strictly(self):
        problems = []
        for path in _markdown_files():
            rel = path.relative_to(ROOT).as_posix()
            match = FRONTMATTER.match(path.read_text(encoding="utf-8"))
            if match is None:
                problems.append(f"{rel}: missing '---' frontmatter block")
                continue
            try:
                data = yaml.safe_load(match.group(1))
            except yaml.YAMLError as error:
                problems.append(f"{rel}: {error}")
                continue
            if not isinstance(data, dict):
                problems.append(f"{rel}: frontmatter is not a mapping")
                continue
            if path.name == "SKILL.md":
                for key in ("name", "description"):
                    value = data.get(key)
                    if not (isinstance(value, str) and value.strip()):
                        problems.append(f"{rel}: '{key}' must be a non-empty string")
        self.assertEqual(problems, [], "\n".join(problems))

    def test_agent_yaml_parses_strictly(self):
        problems = []
        for path in _yaml_files():
            rel = path.relative_to(ROOT).as_posix()
            text = path.read_text(encoding="utf-8")
            wrapped = FRONTMATTER.match(text)  # these files are fenced by '---' lines
            try:
                data = yaml.safe_load(wrapped.group(1) if wrapped else text)
            except yaml.YAMLError as error:
                problems.append(f"{rel}: {error}")
                continue
            if not isinstance(data, dict):
                problems.append(f"{rel}: content is not a mapping")
        self.assertEqual(problems, [], "\n".join(problems))


class DependencyPinsTests(unittest.TestCase):
    """The CI workflows install exactly the versions tests/requirements.txt declares."""

    def test_workflow_installs_match_requirements(self):
        pins = sorted(
            line.strip()
            for line in (ROOT / "tests" / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )
        for workflow in ("pr.yml", "release.yml"):
            with self.subTest(workflow=workflow):
                text = (ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8")
                installs = re.findall(r"pip install --only-binary :all: ([^\n\"]+)", text)
                self.assertEqual(len(installs), 1, f"{workflow}: expected one pinned pip install")
                self.assertEqual(sorted(installs[0].split()), pins)


if __name__ == "__main__":
    unittest.main()
