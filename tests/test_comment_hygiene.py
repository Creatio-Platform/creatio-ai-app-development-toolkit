"""Comments and test titles state the present-tense rule, never the review history.

A comment says what the code does and why it must be so. Who found a defect, in
which ticket, pull request or review round, and how the code behaved before the
fix belong to the issue tracker and the pull request thread, which keep that
history already.

Decision records are the one exception: their subject *is* the history, so
``EXEMPT_PATHS`` carries them and ``test_exemptions_are_live_paths`` keeps that
list from going stale.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Each entry is (kind, pattern). A line matching any of them carries review
# history rather than a rule.
MARKERS = (
    ("ticket_key", re.compile(r"\bENG-\d+\b", re.IGNORECASE)),
    ("pr_number", re.compile(r"\bPR\s?#\d+|\(#\d{2,}\)")),
    # A bare "round N" is the engine's own repair round, a domain concept these
    # files are entitled to name, so only a round qualified as a REVIEW counts.
    (
        "review_round",
        re.compile(
            r"\b\d+(?:st|nd|rd|th)[\s-]?review\b|\bre-?review\b|\breviewer\b"
            r"|\breview\s+round\s+\d+\b|\bround\s+\d+\s+review\b",
            re.IGNORECASE,
        ),
    ),
    # A bare ``P1`` is a priority label only when it stands alone in prose;
    # inside quotes it is an ordinary fixture identifier, which the left edge excludes.
    (
        "severity_label",
        re.compile(r"\b(?:Blocker|Major|Minor)\b|(?:^|[\s(\[])P[0-3](?=[\s):,.\]]|$)"),
    ),
    ("person_handle", re.compile(r"\b[a-z0-9]+-[a-z0-9]+-creatio\b", re.IGNORECASE)),
    (
        "history_narrative",
        re.compile(
            r"\bbefore the fix\b|\bpreviously\b|\bused to\b|\bno longer\b"
            r"|\bregression\b",
            re.IGNORECASE,
        ),
    ),
)

# Extensions whose comment lines are scanned, mapped to their line-comment token.
CODE_SUFFIXES = {
    ".mjs": "//",
    ".js": "//",
    ".py": "#",
    ".sh": "#",
    ".ps1": "#",
    ".yml": "#",
    ".yaml": "#",
}

# Config files without a suffix mapping whose comment token is "#".
CONFIG_FILES = (".gitattributes", ".sonarcloud.properties")

# Markdown under these roots ships as reference material, so every line counts.
DOC_ROOTS = ("skills", "runbooks", "context", "engine-tests")

# The golden runners state their checks as title strings rather than comments,
# and a check title carries history just as a comment does, so these files are
# scanned for their check titles as well as their comments. Other code lines are
# left alone: a runner asserts on product output, and a regex literal quoting
# that output is the assertion itself, not prose about a review.
RUNNER_DIR = "engine-tests/classic-to-freedom"
RUNNER = "runner"

# The title a ``check(...)`` call states, on the line the call opens.
CHECK_TITLE = re.compile(r"""^\s*check\(\s*(?P<quote>["'`])(?P<title>.*)$""")


def check_titles(text):
    """(line number, title) for every check whose call opens on that line."""
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = CHECK_TITLE.match(line)
        if match:
            found.append((number, match.group("title")))
    return found

# Roots never scanned: build output, vendored code, version control.
SKIPPED_DIR_PARTS = frozenset({".git", "node_modules", "__pycache__", ".venv", "vendor"})

# Paths whose subject is the history itself, plus the frozen parity baselines and
# the Classic fixtures, whose bytes are the comparison and so cannot be edited.
# Every entry is asserted to exist.
EXEMPT_PATHS = (
    "RELEASE-NOTES.md",
    "docs/guidance-item-contract-decision.md",
    "docs/telemetry-transport-decision.md",
    ".ai/specs",
    "tests/test_comment_hygiene.py",
    "engine-tests/classic-to-freedom/baseline",
)

# Under this root only the Markdown is scanned: the rest is Classic source
# captured from a stand, which the engine parses byte for byte.
FIXTURE_ROOT = "engine-tests/classic-to-freedom/fixtures"


def is_exempt(rel_path):
    """True when ``rel_path`` is, or sits under, an exempt path."""
    return any(
        rel_path == entry or rel_path.startswith(entry + "/") for entry in EXEMPT_PATHS
    )


def markers_in(line):
    """Every marker kind found in one line of text."""
    return [kind for kind, pattern in MARKERS if pattern.search(line)]


def _trailing_comment(line, token):
    """The trailing comment on a code line, or ``""`` when there is none.

    The token is only a comment start outside a string literal, so the text
    before it must close every quote it opens. Anything unbalanced is treated as
    code and skipped rather than risking a false report on a string.
    """
    index = line.find(token)
    while index != -1:
        head = line[:index]
        if all(head.count(quote) % 2 == 0 for quote in ("'", '"', "`")):
            return line[index:]
        index = line.find(token, index + len(token))
    return ""


def comment_lines(text, token):
    """(line number, text) for every comment in a source file.

    Whole-line comments, C-style block comment interiors, and trailing comments
    on code lines are all comments; string literals are not.
    """
    found = []
    in_block = False
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if token == "//":
            if in_block:
                found.append((number, line))
                if "*/" in stripped:
                    in_block = False
                continue
            if stripped.startswith("/*"):
                found.append((number, line))
                in_block = "*/" not in stripped
                continue
        if stripped.startswith(token):
            found.append((number, line))
            continue
        trailing = _trailing_comment(line, token)
        if trailing:
            found.append((number, trailing))
    return found


def scanned_files():
    """Every in-scope file in the tree, as (path, relative path, token or None).

    A ``None`` token means the whole file is scanned rather than its comments.
    """
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        if SKIPPED_DIR_PARTS.intersection(path.relative_to(ROOT).parts):
            continue
        if is_exempt(relative):
            continue
        if path.suffix == ".md" and relative.split("/")[0] in DOC_ROOTS:
            yield path, relative, None
        elif relative.startswith(FIXTURE_ROOT + "/"):
            continue
        elif path.name in CONFIG_FILES:
            yield path, relative, "#"
        elif path.parent.relative_to(ROOT).as_posix() == RUNNER_DIR and path.suffix == ".mjs":
            yield path, relative, RUNNER
        elif path.suffix in CODE_SUFFIXES:
            yield path, relative, CODE_SUFFIXES[path.suffix]


def scan_tree():
    """Every review-history hit in the tree, as (relative path, line, kind, text)."""
    hits = []
    for path, relative, token in scanned_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if token is None:
            lines = list(enumerate(text.splitlines(), start=1))
        elif token == RUNNER:
            lines = comment_lines(text, "//") + check_titles(text)
        else:
            lines = comment_lines(text, token)
        for number, line in lines:
            for kind in markers_in(line):
                hits.append((relative, number, kind, line.strip()))
    return hits


class CommentHygieneTests(unittest.TestCase):
    def test_detector_reports_every_marker_kind(self):
        """The detector is not vacuous: each marker kind is actually detected."""
        samples = {
            "ticket_key": "// ENG-12345: the widget must stay collapsed.",
            "pr_number": "// Raised in PR #142 against the mapper.",
            "review_round": "// 3rd-review guard for the reviewer's objection.",
            "severity_label": "// Blocker: the handler drops its page key.",
            "person_handle": "// Reported by kamil-mikosz-creatio on the parity run.",
            "history_narrative": "// Before the fix the label-only fallback matched.",
        }
        for kind, sample in samples.items():
            with self.subTest(kind=kind):
                self.assertIn(kind, markers_in(sample))

    def test_rule_shaped_comments_are_not_reported(self):
        """A present-tense rule carries no marker, so the lint stays usable."""
        for sample in (
            "// Rows of a collapsed run carry their own page key.",
            "# The installer writes the state file before it reports success.",
            "// Identically labeled rows on different pages do not share state.",
        ):
            with self.subTest(sample=sample):
                self.assertEqual([], markers_in(sample))

    def test_exempt_paths_are_not_reported(self):
        """An exempt path is skipped even when it carries markers."""
        for entry in EXEMPT_PATHS:
            with self.subTest(entry=entry):
                self.assertTrue(is_exempt(entry))
        self.assertTrue(is_exempt(".ai/specs/ENG-95806-migrate-card-widgets.md"))
        self.assertFalse(is_exempt("skills/classic-to-freedom-migration/engine/mapper.mjs"))

    def test_exemptions_are_live_paths(self):
        """Every exemption names a path that exists, so the list cannot go stale."""
        for entry in EXEMPT_PATHS:
            with self.subTest(entry=entry):
                self.assertTrue((ROOT / entry).exists(), entry)

    def test_scope_is_not_empty(self):
        """The scan reaches the tree: an empty scope would pass vacuously."""
        scanned = [relative for _, relative, _ in scanned_files()]
        self.assertGreater(len(scanned), 100, "scan scope collapsed")
        self.assertTrue(any(name.endswith(".mjs") for name in scanned))
        self.assertTrue(any(name.endswith(".py") for name in scanned))
        self.assertTrue(any(name.endswith(".md") for name in scanned))

    def test_tree_carries_no_review_history(self):
        """No comment, test title or shipped doc in scope carries review history."""
        hits = scan_tree()
        report = "\n".join(
            "{0}:{1} [{2}] {3}".format(*hit) for hit in hits[:80]
        )
        self.assertEqual(
            [],
            hits,
            "{0} comment line(s) carry review history:\n{1}".format(len(hits), report),
        )


if __name__ == "__main__":
    unittest.main()
