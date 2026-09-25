"""Pin the pull_request triggers of the PR-gating workflows to "every base branch".

A `branches:` filter on `pull_request` makes a workflow skip every PR whose base is not
listed. With `branches: [main]` a PR stacked on a feature base got no Sonar new-issues
gate, no Sonar exclusion check and no gitleaks scan, and nothing reported the gap: a
workflow that does not trigger shows no check at all rather than a red one.

The scan is line-based on purpose: CI installs only pytest, and adding PyYAML to check
a trigger shape is not worth the dependency. It understands the block-mapping form these
files use. Any other shape of the `on:` block (flow style, a quoted key it does not
know) finds no `pull_request` trigger and fails the "declares a trigger" test, so an
unreadable file fails loudly instead of passing the filter test by default.
"""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"

# Every workflow whose job must run on a pull request no matter which branch it targets.
PR_GATING_WORKFLOWS = (
    "pr.yml",
    "sonar-gate.yml",
    "sonar-config-check.yml",
    "security.yml",
)

_ON_KEY = re.compile(r"""^(?:on|'on'|"on"):\s*(?:#.*)?$""")
_FILTER_KEY = re.compile(r"\bbranches(?:-ignore)?\s*:")


def _indent(line):
    return len(line) - len(line.lstrip(" "))


def _is_content(line):
    stripped = line.strip()
    return bool(stripped) and not stripped.startswith("#")


def _on_block(lines):
    """Return the lines nested under the top-level `on:` key."""
    for start, line in enumerate(lines):
        if _ON_KEY.match(line):
            break
    else:
        return []
    block = []
    for line in lines[start + 1:]:
        if _is_content(line) and _indent(line) == 0:
            break
        block.append(line)
    return block


def pull_request_trigger(text):
    """Return the text of the `pull_request` trigger, or None when there is none.

    The returned text is the key line plus every line nested under it, so a filter
    written inline (`pull_request: {branches: [main]}`) or nested below it is included.
    """
    block = _on_block(text.splitlines())
    content = [line for line in block if _is_content(line)]
    if not content:
        return None
    trigger_indent = min(_indent(line) for line in content)
    for index, line in enumerate(block):
        if not _is_content(line) or _indent(line) != trigger_indent:
            continue
        if not re.match(r"pull_request\s*:", line.strip()):
            continue
        trigger = [line]
        for nested in block[index + 1:]:
            if _is_content(nested) and _indent(nested) <= trigger_indent:
                break
            trigger.append(nested)
        return "\n".join(trigger)
    return None


def _has_branch_filter(trigger):
    return any(
        _FILTER_KEY.search(line.split("#", 1)[0])
        for line in trigger.splitlines()
    )


class PullRequestTriggerScanTests(unittest.TestCase):
    """The scanner itself, on inline inputs, so a green run below means something."""

    def test_filtered_trigger_is_detected(self):
        trigger = pull_request_trigger("on:\n  pull_request:\n    branches: [main]\n  push:\n")
        self.assertIsNotNone(trigger)
        self.assertTrue(_has_branch_filter(trigger))

    def test_branches_ignore_counts_as_filter(self):
        trigger = pull_request_trigger("on:\n  pull_request:\n    branches-ignore: [x]\n")
        self.assertTrue(_has_branch_filter(trigger))

    def test_inline_mapping_filter_is_detected(self):
        trigger = pull_request_trigger("on:\n  pull_request: {branches: [main]}\n")
        self.assertTrue(_has_branch_filter(trigger))

    def test_push_filter_does_not_leak_into_pull_request(self):
        trigger = pull_request_trigger(
            "on:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  a:\n"
        )
        self.assertIsNotNone(trigger)
        self.assertFalse(_has_branch_filter(trigger))

    def test_commented_mention_is_not_a_filter(self):
        trigger = pull_request_trigger("on:\n  # no branches: filter here\n  pull_request:\n")
        self.assertFalse(_has_branch_filter(trigger))

    def test_pull_request_target_is_not_pull_request(self):
        self.assertIsNone(pull_request_trigger("on:\n  pull_request_target:\n"))

    def test_flow_style_on_block_is_not_recognised(self):
        self.assertIsNone(pull_request_trigger("on: [pull_request]\n"))


class PrGatingWorkflowTriggerTests(unittest.TestCase):
    def _trigger(self, name):
        return pull_request_trigger((WORKFLOWS / name).read_text(encoding="utf-8"))

    def test_declares_a_pull_request_trigger(self):
        for name in PR_GATING_WORKFLOWS:
            with self.subTest(workflow=name):
                self.assertIsNotNone(
                    self._trigger(name),
                    f"{name}: no block-style `pull_request:` trigger found under `on:`. "
                    "If the trigger was reshaped on purpose, teach this guard the new shape.",
                )

    def test_pull_request_trigger_has_no_branch_filter(self):
        for name in PR_GATING_WORKFLOWS:
            with self.subTest(workflow=name):
                trigger = self._trigger(name)
                self.assertIsNotNone(trigger, f"{name}: no pull_request trigger found")
                self.assertFalse(
                    _has_branch_filter(trigger),
                    f"{name}: `pull_request` has a branches filter, so PRs into any other "
                    "base (stacked PRs on a feature branch) skip this workflow entirely.\n"
                    + trigger,
                )


if __name__ == "__main__":
    unittest.main()
