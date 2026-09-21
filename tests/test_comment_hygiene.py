"""Comments and test titles state the present-tense rule, never the review history.

A comment says what the code does and why it must be so. Who found a defect, in
which ticket, pull request or review round, and how the code behaved before the
fix belong to the issue tracker and the pull request thread, which keep that
history already.

Decision records are the one exception: their subject *is* the history, so
``EXEMPT_PATHS`` carries them and ``test_exemptions_are_live_paths`` keeps that
list from going stale.
"""

import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Each entry is (kind, pattern). A line matching any of them carries review
# history rather than a rule.
MARKERS = (
    ("ticket_key", re.compile(r"\bENG-\d+\b", re.IGNORECASE)),
    ("pr_number", re.compile(r"\bPR\s?#\d+|\(#\d{2,}\)", re.IGNORECASE)),
    # A bare "round N" is the engine's own repair round, a domain concept these
    # files are entitled to name, so only a round qualified as a REVIEW counts.
    (
        "review_round",
        re.compile(
            r"\b\d+(?:st|nd|rd|th)[\s-]?review\b|\bre-?review\b|\breviewers?\b"
            r"|\breview\s+round\s+\d+\b|\bround\s+\d+\s+review\b",
            re.IGNORECASE,
        ),
    ),
    # A severity is a label in its LABEL casing — ``Blocker`` or ``BLOCKER`` —
    # never in the all-lower-case English word: "a prerequisites blocker" and "the
    # blocker was judging an empty container" name a product condition, not a
    # review verdict. The left edge excludes a quoted literal, so a sentinel
    # string such as ``"BLOCKER: ..."`` is read as the value the product emits,
    # and, for a bare ``P1``, an ordinary fixture identifier.
    (
        "severity_label",
        re.compile(
            r"(?:^|[\s(\[])(?:Blocker|Major|Minor|BLOCKER|MAJOR|MINOR)\b"
            r"|(?:^|[\s(\[])P[0-3](?=[\s):,.\]]|$)"
        ),
    ),
    # An attribution, not any hyphenated name that happens to end in "creatio":
    # ``gdpr-for-creatio`` is an app slug, ``reported by a-b-creatio`` is a person.
    (
        "person_handle",
        re.compile(r"(?:\b(?:by|from|per|to)\s+|@)[a-z0-9]+-[a-z0-9]+-creatio\b", re.IGNORECASE),
    ),
    # "used to" is history only in the active voice: "X used to be Y". The passive
    # "a wrapper is used to justify" names a purpose. "Regression" likewise names a
    # test artifact ("regression gate") as often as it narrates a defect.
    (
        "history_narrative",
        re.compile(
            r"\bbefore the fix\b|\bpreviously\b|\bno longer\b"
            r"|(?<!\bis )(?<!\bare )(?<!\bwas )(?<!\bwere )(?<!\bbe )(?<!\bbeen )"
            r"(?<!\bbeing )\bused to\b"
            r"|\bregressions?\b(?!\s+(?:gate|gates|test|tests|suite|net|fixture|fixtures))",
            re.IGNORECASE,
        ),
    ),
)

# R3 asks a SHIPPED reference doc to carry no ticket key, pull request number or
# review round. The narrative, severity and handle markers are contributor
# vocabulary: they are enforced on source comments, check titles and internal
# docs, but must not govern product prose written for end users and agents.
SHIPPED_DOC_MARKERS = frozenset({"ticket_key", "pr_number", "review_round"})

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

# Markdown under these roots is reference material, so every line counts rather
# than only its comments. ``SHIPPED_DOC_ROOTS`` are the entries `.release-manifest.json`
# ships to end users and coding agents, so only the markers R3 names apply there.
SHIPPED_DOC_ROOTS = ("skills", "runbooks", "context")
DOC_ROOTS = SHIPPED_DOC_ROOTS + ("engine-tests",)

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

# Roots never scanned: version control, linked worktrees, dependencies, vendored
# code, build output and test scratch space. None of them is version-controlled,
# so the git-derived scan set excludes them already; this set is what the
# filesystem fallback prunes when git cannot answer.
SKIPPED_DIR_PARTS = frozenset({
    ".git", ".worktrees", "node_modules", "__pycache__", ".venv", "vendor",
    ".tmp-tests", "dist", "build", "output",
})

# Paths whose subject is the history itself, plus the frozen parity baselines and
# the Classic fixtures, whose bytes are the comparison and so cannot be edited.
# Every entry is asserted to exist.
EXEMPT_PATHS = (
    "RELEASE-NOTES.md",
    "docs/guidance-item-contract-decision.md",
    "docs/telemetry-transport-decision.md",
    ".ai/specs",
    "tests/test_comment_hygiene.py",
    # A dated gap analysis whose subject IS the before-state it measured; its
    # `file:line` references deliberately point at the code as it was.
    "skills/classic-to-freedom-migration/docs/imperative-logic-gap.md",
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


def markers_in(line, kinds=None):
    """Every marker kind found in one line of text.

    ``kinds`` narrows the search to one audience's marker set; ``None`` applies
    all of them.
    """
    return [
        kind
        for kind, pattern in MARKERS
        if (kinds is None or kind in kinds) and pattern.search(line)
    ]


def marker_kinds_for(relative, token):
    """The marker kinds enforced on one file, by audience."""
    if token is None and relative.split("/")[0] in SHIPPED_DOC_ROOTS:
        return SHIPPED_DOC_MARKERS
    return None


def _outside_string_index(line, token):
    """Index of ``token`` outside every string literal, or ``-1``.

    The token only opens a comment outside a string, so the text before it must
    close every quote it opens. Anything unbalanced is treated as code and
    skipped rather than risking a false report on a string.
    """
    index = line.find(token)
    while index != -1:
        head = line[:index]
        if all(head.count(quote) % 2 == 0 for quote in ("'", '"', "`")):
            return index
        index = line.find(token, index + len(token))
    return -1


def _trailing_comment(line, token):
    """The trailing comment on a code line, or ``""`` when there is none."""
    index = _outside_string_index(line, token)
    return line[index:] if index != -1 else ""


def comment_lines(text, token):
    """(line number, text) for every comment in a source file.

    Whole-line comments, C-style block comment interiors, and trailing comments
    on code lines are all comments; string literals are not. A block comment
    opened after code on the same line counts from the ``/*`` onwards.
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
        if token == "//":
            block = _outside_string_index(line, "/*")
            single = _outside_string_index(line, "//")
            if block != -1 and (single == -1 or block < single):
                rest = line[block:]
                found.append((number, rest))
                in_block = "*/" not in rest[2:]
                continue
        trailing = _trailing_comment(line, token)
        if trailing:
            found.append((number, trailing))
    return found


def docstring_lines(text):
    """(line number, text) for every line inside a triple-quoted Python string.

    A docstring states what a function, class or module is for, so it carries the
    same obligation as a comment. Single-quoted strings are left alone: those are
    values the code computes with, not prose about it.
    """
    found = []
    fence = None
    for number, line in enumerate(text.splitlines(), start=1):
        rest = line
        while True:
            if fence is None:
                index = min(
                    (i for i in (rest.find('"""'), rest.find("\'\'\'")) if i != -1),
                    default=-1,
                )
                if index == -1:
                    break
                fence = rest[index:index + 3]
                rest = rest[index + 3:]
                found.append((number, line))
            else:
                index = rest.find(fence)
                if index == -1:
                    if (number, line) not in found:
                        found.append((number, line))
                    break
                fence = None
                rest = rest[index + 3:]
    return found


# A banner or a scenario note a runner states as a string rather than a comment.
RUNNER_PROSE = re.compile(r"""^\s*(?:console\.log\(|why:\s*)["'`](?P<text>.*)$""")


def runner_prose(text):
    """(line number, text) for a runner's printed banners and scenario notes."""
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = RUNNER_PROSE.match(line)
        if match:
            found.append((number, match.group("text")))
    return found


def tracked_paths():
    """Every version-controlled path under ``ROOT``, or ``None`` when git cannot say.

    The rule governs what a contributor commits, so the scan set is what git
    tracks. A filesystem walk would also pick up ignored build output and — in
    the mandated layout — the linked worktrees of other branches, which makes the
    gate fail locally on content the contributor never wrote.
    """
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "-z"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    names = [name for name in result.stdout.decode("utf-8").split("\0") if name]
    return names or None


def candidate_paths():
    """The paths the scan considers, from git when available and a pruned walk otherwise."""
    tracked = tracked_paths()
    if tracked is not None:
        return [ROOT / name for name in sorted(tracked)]
    found = []
    for base, directories, names in os.walk(ROOT):
        directories[:] = sorted(d for d in directories if d not in SKIPPED_DIR_PARTS)
        found.extend(Path(base) / name for name in sorted(names))
    return found


def scanned_files():
    """Every in-scope file in the tree, as (path, relative path, token or None).

    A ``None`` token means the whole file is scanned rather than its comments.
    """
    for path in candidate_paths():
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
        kinds = marker_kinds_for(relative, token)
        if token is None:
            lines = list(enumerate(text.splitlines(), start=1))
        elif token == RUNNER:
            lines = (comment_lines(text, "//") + check_titles(text)
                     + runner_prose(text))
        else:
            lines = comment_lines(text, token)
            if path.suffix == ".py":
                lines = lines + docstring_lines(text)
        for number, line in lines:
            for kind in markers_in(line, kinds):
                hits.append((relative, number, kind, line.strip()))
    return hits


class CommentHygieneTests(unittest.TestCase):
    def test_detector_reports_every_marker_kind(self):
        """The detector is not vacuous: each marker kind is detected in either case."""
        samples = {
            "ticket_key": [
                "// ENG-12345: the widget must stay collapsed.",
                "// eng-12345: the widget must stay collapsed.",
            ],
            "pr_number": [
                "// Raised in PR #142 against the mapper.",
                "// raised in pr #142 against the mapper.",
            ],
            "review_round": [
                "// 3rd-review guard for the reviewer's objection.",
                "// Two reviewers objected to the collapsed row.",
            ],
            "severity_label": [
                "// Blocker: the handler drops its page key.",
                "// Guard for the BLOCKER raised against the handler.",
                "// MINOR: the caption is rendered without its tooltip.",
            ],
            "person_handle": [
                "// Reported by kamil-mikosz-creatio on the parity run.",
                "// Raised by KAMIL-MIKOSZ-CREATIO on the parity run.",
            ],
            "history_narrative": [
                "// Before the fix the label-only fallback matched.",
                "// Fixes two regressions found while re-running the mapper.",
            ],
        }
        for kind, lines in samples.items():
            for sample in lines:
                with self.subTest(kind=kind, sample=sample):
                    self.assertIn(kind, markers_in(sample))

    def test_a_block_comment_opened_after_code_is_a_comment(self):
        """A `/*` that follows code on the same line is still scanned."""
        source = "const a = 1; /* ENG-12345 raised in PR #9 */\nconst b = 2;\n"
        self.assertEqual(
            [(1, "/* ENG-12345 raised in PR #9 */")], comment_lines(source, "//")
        )
        opened = "const a = 1; /* ENG-12345 was raised\n   against the mapper */\nconst b = 2;\n"
        self.assertEqual([1, 2], [number for number, _ in comment_lines(opened, "//")])

    def test_a_comment_token_inside_a_string_is_not_a_comment(self):
        """Only a token outside every string literal opens a comment."""
        self.assertEqual([], comment_lines('const url = "https://x/*y*/";\n', "//"))

    def test_shipped_docs_carry_only_the_shipped_marker_set(self):
        """Product prose answers for ticket, PR and review refs — not for contributor vocabulary."""
        self.assertEqual(SHIPPED_DOC_MARKERS, marker_kinds_for("skills/a/b.md", None))
        self.assertIsNone(marker_kinds_for("engine-tests/a/b.md", None))
        self.assertIsNone(marker_kinds_for("skills/a/b.mjs", "//"))
        shipped = marker_kinds_for("context/essentials.md", None)
        self.assertEqual(
            [], markers_in("Use a stable slug, for example `gdpr-for-creatio`.", shipped)
        )
        self.assertEqual([], markers_in('not merely "no longer blank"', shipped))
        self.assertEqual(
            ["ticket_key"], markers_in("Introduced by ENG-12345.", shipped)
        )

    def test_an_app_slug_is_not_a_person_handle(self):
        """`<app>-for-creatio` is a product name; only an attribution names a person."""
        for sample in ("the sales-for-creatio app", "Use the `gdpr-for-creatio` slug."):
            with self.subTest(sample=sample):
                self.assertEqual([], markers_in(sample))
        self.assertIn("person_handle", markers_in("// Raised by a-b-creatio."))

    def test_a_quoted_severity_sentinel_is_not_a_label(self):
        """A sentinel the product prints is a value, not a review verdict."""
        self.assertEqual(
            [],
            markers_in('Output: a leading sentinel line ("PREFLIGHT: ..." / "BLOCKER: ...")'),
        )

    def test_rule_shaped_comments_are_not_reported(self):
        """A present-tense rule carries no marker, so the lint stays usable."""
        for sample in (
            "// Rows of a collapsed run carry their own page key.",
            "# The installer writes the state file before it reports success.",
            "// Identically labeled rows on different pages do not share state.",
            "# clio MCP being unavailable is a prerequisites blocker, not a warning.",
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

    def test_scope_excludes_what_the_contributor_did_not_write(self):
        """Linked worktrees, build output and scratch space are out of scope."""
        scanned = [relative for _, relative, _ in scanned_files()]
        for part in (".worktrees", ".tmp-tests", "node_modules", ".venv"):
            with self.subTest(part=part):
                self.assertEqual(
                    [], [name for name in scanned if part in name.split("/")]
                )

    def test_tree_carries_no_review_history(self):
        """No comment, test title or shipped doc in scope carries review history."""
        hits = scan_tree()
        report = "\n".join(
            "{0}:{1} [{2}] {3}".format(hit[0], hit[1], hit[2], hit[3][:120])
            for hit in hits[:80]
        )
        self.assertEqual(
            [],
            hits,
            "{0} comment line(s) carry review history:\n{1}".format(len(hits), report),
        )


if __name__ == "__main__":
    unittest.main()
