"""Guards on how a classic-to-freedom-migration build task checks its page in the browser.

A browser check is the most expensive evidence a builder collects: every screenshot and
every DOM read stays in its conversation for the rest of the task. So a build task opens
the browser ONCE, after its last save, and reads the cheapest evidence that answers the
question first - the data requests the page sends, then the console, then the DOM - with
a screenshot only where the layout itself is what is checked. Between edits the evidence
is the saved schema read back with `get-page`; a second check only confirms the fix of a
defect the first found, and there is no third. A rule or handler is exercised with one value
change per acceptance criterion and read off the captured request or one DOM read, and every
page-writing task reports its count in a `Browser checks:` Notes line, because the engine
never sees the tool calls. These tests keep that rule in the brief
every builder reads whole, keep the request-hook recipe in the reference the builder looks
up, and keep that reference handed to every task kind that builds or repairs a page.
"""

import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "skills/classic-to-freedom-migration/references"
EXECUTION = REFERENCES / "build-task-execution.md"
BUILD_PAGE = REFERENCES / "build-page.md"
BROWSER_CHECK = REFERENCES / "freedom-ui-browser-check.md"
ORCHESTRATE = REFERENCES / "orchestrate-build.md"

CHEAP_HEADING = "## Cheap evidence first"
POINTER = "`./references/freedom-ui-browser-check.md` → *Cheap evidence first*"
# The evidence kinds, cheapest first, each by a phrase its list item must carry.
RANKING = ("SelectQuery", "read_console_messages", "javascript_tool", "screenshot")
# The task kinds that save a page body and so open it in the browser. Section dashboards
# are built inside the list page's build task and open that page too.
PAGE_WRITING_KINDS = ("Page build", "Repair round", "Whole migration", "Section dashboards")
# Wording that allows a re-open after every fix with no count; the two-check cap stands in its place.
UNCAPPED_RECHECK = "only after fixing a defect that check found"
# The paragraph that follows the ranked list in the brief and in the reference.
BEHAVIOUR_ANCHOR = "A rule or handler is behaviour"


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    """Text with line breaks folded, so a phrase wrapped across lines still matches."""
    return re.sub(r"\s+", " ", text)


def section(text, start, end):
    """The text between the first `start` and the next `end` after it (end of text if none).

    Raises when `start` is missing: an empty slice would make every containment check pass.
    """
    begin = text.find(start)
    if begin < 0:
        raise AssertionError(f"anchor {start!r} not found")
    stop = text.find(end, begin + len(start))
    return text[begin:] if stop < 0 else text[begin:stop]


def ranked_items(text):
    """The numbered items of the first `1.`-to-`4.` list in `text`, folded flat."""
    items = re.findall(r"^\s*([1-4])\. (.+?)(?=^\s*[1-9]\. |\n\n|\Z)", text, re.M | re.S)
    numbers = [n for n, _ in items[:4]]
    if numbers != ["1", "2", "3", "4"]:
        raise AssertionError(f"no four-item ranked list found; read items {numbers}")
    return [flat(body) for _, body in items[:4]]


def dispatch_rows():
    """The step-7.3 dispatch table as {task kind: (briefs cell, references cell)}."""
    step = section(read(ORCHESTRATE), "**7.3 What each sub-agent is handed.**", "**7.4 ")
    rows = {}
    for line in step.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if line.lstrip().startswith("|") and len(cells) == 4 and not set(cells[0]) <= set("-: "):
            rows[cells[0]] = (cells[2], cells[3])
    return rows


class OneCheckPerTaskTests(unittest.TestCase):
    def setUp(self):
        self.text = flat(read(EXECUTION))

    def test_the_brief_asks_for_one_check_after_the_last_save(self):
        for phrase in (
            "ONE browser check per task",
            "after your last save",
            "not after each edit",
        ):
            self.assertIn(phrase, self.text)

    def test_between_edits_the_evidence_is_a_schema_read_back(self):
        self.assertRegex(self.text, r"[Bb]etween edits[^.]*`get-page`")

    def test_the_brief_caps_the_checks_at_two(self):
        self.assertIn("At most TWO browser checks per task", self.text)
        self.assertRegex(self.text, r"second[^.]*only to confirm the fix of a defect the first check found")
        self.assertIn("there is no third", self.text)

    def test_any_other_question_between_saves_is_a_read_back(self):
        self.assertRegex(self.text, r"other question between saves[^.]*`get-page`[^.]*never by opening the page")

    def test_the_uncapped_recheck_wording_is_gone(self):
        for path in (EXECUTION, BROWSER_CHECK):
            self.assertNotIn(UNCAPPED_RECHECK, flat(read(path)), path.name)

    def test_the_reference_states_the_same_cap(self):
        cheap = flat(section(read(BROWSER_CHECK), CHEAP_HEADING, "\n## "))
        self.assertIn("at most TWO per task", cheap)
        self.assertIn("confirm the fix of a defect the first check found", cheap)

    def test_the_per_save_wording_is_gone(self):
        self.assertNotIn("After saving a page, and always before building anything that depends on it", self.text)

    def test_build_page_names_the_per_edit_check_as_a_trap(self):
        traps = section(read(BUILD_PAGE), "## Known Traps", "\n## ")
        bullets = [flat(b) for b in re.findall(r"^- (\*\*.+?)(?=^- |\Z)", traps, re.M | re.S)]
        hits = [b for b in bullets if "after each edit" in b and "browser" in b.lower()]
        self.assertTrue(hits, "no Known Traps bullet names a browser check after each edit")
        self.assertIn("get-page", hits[0])

    def test_build_page_names_the_save_check_fix_loop_as_a_trap(self):
        traps = section(read(BUILD_PAGE), "## Known Traps", "\n## ")
        bullets = [flat(b) for b in re.findall(r"^- (\*\*.+?)(?=^- |\Z)", traps, re.M | re.S)]
        hits = [b for b in bullets if "save-check-fix" in b]
        self.assertTrue(hits, "no Known Traps bullet names the save-check-fix loop")
        self.assertIn("at most two", hits[0])


class BrowserChecksNotesLineTests(unittest.TestCase):
    """The engine never sees a tool call, so the count is visible only if the task writes it."""

    def setUp(self):
        self.text = flat(read(EXECUTION))

    def test_the_brief_requires_the_notes_line(self):
        self.assertIn("`Browser checks: N — <what each check answered>`", self.text)
        self.assertRegex(self.text, r"Browser checks: N[^.]*under `## Notes`|under `## Notes`[^.]*Browser checks: N")

    def test_every_page_writing_task_writes_it_even_with_no_check(self):
        notes = section(read(EXECUTION), "**Report the count.**", "\n\n")
        self.assertIn("Every task that saved a page", flat(notes))
        self.assertIn("Browser checks: 0", flat(notes))


class BehaviourEvidenceTests(unittest.TestCase):
    """A rule or handler is checked by one value change per AC, read off the request or the DOM."""

    def behaviour(self, path, start, end):
        return flat(section(section(read(path), start, end), BEHAVIOUR_ANCHOR, "\n\n"))

    def assert_behaviour_step(self, text, where):
        self.assertIn("get-page", text, f"{where}: the wiring is not checked in get-page first")
        self.assertIn("one value change per AC", text, where)
        self.assertRegex(text, r"e\.g\. `form_input`", where)
        self.assertIn("captured `UpdateQuery`", text, where)
        self.assertIn("one DOM read", text, where)
        self.assertIn("read the record back", text, where)
        self.assertRegex(text, r"AC that says something must NOT happen[^.]*exercised", where)

    def test_the_brief_ranking_has_a_behaviour_step(self):
        text = self.behaviour(EXECUTION, "**Evidence, cheapest first.**", "The hook snippet")
        self.assert_behaviour_step(text, EXECUTION.name)

    def test_the_reference_carries_the_behaviour_recipe(self):
        text = self.behaviour(BROWSER_CHECK, CHEAP_HEADING, "**The request hook.**")
        self.assert_behaviour_step(text, BROWSER_CHECK.name)
        self.assertIn("not a click-and-type sequence", text)


class HandlerProofTests(unittest.TestCase):
    def test_the_handler_paragraph_names_the_proof(self):
        para = flat(section(read(BUILD_PAGE), "**A ported behaviour's Evidence lists every AC", "\n\n"))
        self.assertIn("fires on a UI save in the browser", para)
        self.assertIn("captured `UpdateQuery`", para)
        self.assertIn("read the record back", para)
        self.assertRegex(para, r"detail[^.]*captured `SelectQuery` filter")
        self.assertIn("`build-task-execution.md` → *Evidence, cheapest first*", para)


class EvidenceRankingTests(unittest.TestCase):
    def assert_ranked(self, text, where):
        items = ranked_items(text)
        for rank, (phrase, item) in enumerate(zip(RANKING, items), 1):
            self.assertIn(phrase, item, f"{where}: item {rank} does not carry {phrase!r}")
        self.assertIn("UpdateQuery", items[0], where)
        self.assertIn("before the page loads", items[0], where)
        self.assertIn("find", items[2], where)
        screenshot = items[3]
        for phrase in ("only where the layout", "at most one per page", "creatio-ui-guidelines"):
            self.assertIn(phrase, screenshot, f"{where}: the screenshot item lacks {phrase!r}")

    def test_the_brief_ranks_the_evidence(self):
        self.assert_ranked(section(read(EXECUTION), "**Evidence, cheapest first.**", "\n\n**"), EXECUTION.name)

    def test_the_reference_ranks_the_evidence_the_same_way(self):
        self.assert_ranked(section(read(BROWSER_CHECK), CHEAP_HEADING, "\n## "), BROWSER_CHECK.name)

    def test_tools_are_examples_of_an_evidence_kind(self):
        # Browser surfaces name their tools differently, so the kind leads and the tool
        # is an example of it.
        items = ranked_items(section(read(EXECUTION), "**Evidence, cheapest first.**", "\n\n**"))
        self.assertTrue(all("e.g." in item for item in items[1:3]), items[1:3])


class RequestHookChecksTests(unittest.TestCase):
    def test_the_brief_names_the_checks_the_request_hook_answers(self):
        first = ranked_items(section(read(EXECUTION), "**Evidence, cheapest first.**", "\n\n**"))[0]
        self.assertIn("ForwardReference", first)
        self.assertRegex(first, r"detail[^.]*`SelectQuery`[^.]*filters")

    def test_the_reference_says_how_each_check_reads_off_the_hook(self):
        cheap = flat(section(read(BROWSER_CHECK), CHEAP_HEADING, "\n## "))
        self.assertIn("ForwardReference", cheap)
        self.assertRegex(cheap, r"detail[^.]*filters")


class CheapEvidenceReferenceTests(unittest.TestCase):
    def setUp(self):
        self.cheap = section(read(BROWSER_CHECK), CHEAP_HEADING, "\n## ")

    def snippets(self):
        return re.findall(r"```js\n(.*?)```", self.cheap, re.S)

    def test_the_section_carries_a_request_hook_snippet(self):
        hooks = [s for s in self.snippets() if "XMLHttpRequest" in s and "fetch" in s]
        self.assertTrue(hooks, "no snippet hooks both XMLHttpRequest and fetch")
        for name in ("SelectQuery", "UpdateQuery"):
            self.assertIn(name, hooks[0])

    def test_the_read_out_unpacks_a_batch_into_its_items_and_their_own_results(self):
        readouts = [s for s in self.snippets() if "rootSchemaName" in s]
        self.assertTrue(readouts, "no read-out snippet narrows by rootSchemaName")
        self.assertIn("q.body.items", readouts[0])
        self.assertIn("queryResults", readouts[0])

    def test_the_hook_keeps_each_response_whole(self):
        hooks = [s for s in self.snippets() if "XMLHttpRequest" in s]
        self.assertTrue(hooks, "no request hook snippet")
        keep = hooks[0][hooks[0].index("const keep"):hooks[0].index("const open")]
        self.assertNotIn(".slice(", keep)

    @unittest.skipIf(shutil.which("node") is None, "node is not on PATH")
    def test_every_snippet_parses(self):
        snippets = self.snippets()
        self.assertGreaterEqual(len(snippets), 2, "expected the hook and its read-out snippet")
        for snippet in snippets:
            result = subprocess.run(
                ["node", "-e", "new Function(require('fs').readFileSync(0, 'utf8'))"],
                input=snippet, capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(result.returncode, 0, f"snippet does not parse:\n{snippet}\n{result.stderr}")

    def test_the_brief_points_at_the_section_by_heading(self):
        self.assertIn(POINTER, flat(read(EXECUTION)))

    def test_page_writing_tasks_are_handed_the_reference_to_look_up(self):
        rows = dispatch_rows()
        for kind in PAGE_WRITING_KINDS:
            matches = [cells for name, cells in rows.items() if name.startswith(kind)]
            self.assertEqual(len(matches), 1, f"expected one 7.3 row for {kind!r}, found {len(matches)}")
            briefs, references = matches[0]
            self.assertIn("`./references/freedom-ui-browser-check.md`", references, kind)
            self.assertNotIn("freedom-ui-browser-check.md", briefs, f"{kind}: handed as a brief")

    def test_no_row_hands_the_reference_as_a_brief(self):
        briefs = [name for name, (cell, _) in dispatch_rows().items() if "freedom-ui-browser-check.md" in cell]
        self.assertFalse(briefs, f"handed as a brief to read whole: {briefs}")


if __name__ == "__main__":
    unittest.main()
