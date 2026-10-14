"""Guards on how the classic-to-freedom-migration briefs tell an agent to read.

Every byte a command prints stays in the agent's conversation for the rest of its
task and is paid for again on every later turn. So each brief an agent role is
handed carries the same read-discipline block, inline - an agent does not fetch a
reference it is only pointed at - and the instructions that would drive a
whole-document read are written as targeted reads instead. These tests keep the
block present and identical everywhere it is inlined, and keep the role-specific
instructions from sliding back to whole reads.
"""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills/classic-to-freedom-migration"
SKILL = SKILL_DIR / "SKILL.md"
REFERENCES = SKILL_DIR / "references"

START = "<!-- read-discipline:start -->"
END = "<!-- read-discipline:end -->"

# Every file an agent role is handed as its read contract: the four briefs a
# sub-agent receives and the orchestrator's own build reference.
CARRIERS = (
    "build-task-execution.md",
    "judge-brief.md",
    "read-back-brief.md",
    "reference-cache-brief.md",
    "orchestrate-build.md",
)

# The largest pointer SKILL.md may carry; the full block lives in the references.
POINTER_MAX_BYTES = 350


def read(path):
    return path.read_text(encoding="utf-8")


def block(text, name):
    """The read-discipline block of one file, markers included.

    Raises instead of returning an empty string: a missing block would otherwise
    compare equal to another missing block and pass the identity check.
    """
    begin = text.find(START)
    if begin < 0:
        raise AssertionError(f"{name}: read-discipline block not found")
    if text.find(START, begin + len(START)) >= 0:
        raise AssertionError(f"{name}: read-discipline block appears more than once")
    stop = text.find(END, begin)
    if stop < 0:
        raise AssertionError(f"{name}: read-discipline block is not closed")
    return text[begin : stop + len(END)]


def flat(text):
    """Text with line breaks folded, so a phrase wrapped across lines still matches."""
    return re.sub(r"\s+", " ", text)


class ReadDisciplineBlockTests(unittest.TestCase):
    def test_every_carrier_holds_the_block_byte_identical(self):
        blocks = {name: block(read(REFERENCES / name), name) for name in CARRIERS}
        reference = blocks[CARRIERS[0]]
        drifted = [name for name, text in blocks.items() if text != reference]
        self.assertFalse(
            drifted,
            f"read-discipline block differs from {CARRIERS[0]} in: {drifted}. The block is "
            "inlined, not linked, so every copy must be edited together.",
        )

    def test_the_block_names_each_rule(self):
        text = flat(block(read(REFERENCES / CARRIERS[0]), CARRIERS[0]))
        required = {
            "output over the threshold goes to a file": "~200 lines or ~8 KB",
            "the locate step": "grep -n",
            "the window step": "sed -n",
            "chunked paging is a full read": "in chunks is a full read",
            "JSON is queried, not printed": "Query JSON, never print it whole",
            "the query tool": "node -e",
            "no re-read of held files": "Do not re-read",
            "a worked targeted read": "A good targeted read",
            "the whole-read exceptions": "When a whole read is right",
            "own task file is a whole read": "your own task file",
        }
        missing = [what for what, phrase in required.items() if phrase not in text]
        self.assertFalse(missing, f"read-discipline block lacks: {missing}")

    def test_the_block_says_a_reference_is_not_a_brief(self):
        # The whole-read exception covers briefs only. The mapping reference, the
        # creatio-ui-guidelines references and the clio guidance articles are each
        # larger than a brief and are needed one section at a time, and a file read
        # without an offset or limit costs a whole read whichever tool issues it.
        text = flat(block(read(REFERENCES / CARRIERS[0]), CARRIERS[0]))
        required = {
            "references are not briefs": "A reference is not a brief",
            "the mapping reference is one": "classic-to-freedom-mapping.md",
            "the guidelines references are": "creatio-ui-guidelines",
            "guidance articles are": "guidance articles",
            "looked up by heading": "look it up by heading",
            "an unbounded Read is a whole read": "with no offset or limit is a whole read",
        }
        missing = [what for what, phrase in required.items() if phrase not in text]
        self.assertFalse(missing, f"read-discipline block lacks: {missing}")

    def skill_rule_line(self):
        lines = [line for line in read(SKILL).splitlines() if "**Read discipline**" in line]
        self.assertEqual(len(lines), 1, "SKILL.md must carry exactly one read-discipline pointer")
        return lines[0]

    def test_skill_body_points_at_the_block_within_budget(self):
        line = self.skill_rule_line()
        pointer = line[line.index("**Read discipline**"):]
        self.assertIn("./references/orchestrate-build.md", pointer)
        size = len(pointer.encode("utf-8"))
        self.assertLessEqual(size, POINTER_MAX_BYTES, f"the pointer is {size} bytes")

    def test_session_start_recovery_is_targeted_not_whole(self):
        # The cardinal rule is the orchestrator's first read of every session, so it
        # is where a whole read of plan.md and worklog.md would come back. It shares
        # one line with the pointer: the body has no bytes left for a second one.
        whole_reads = "at the start of every session (single-section: `plan.md` + `worklog.md`)"
        self.assertNotIn(whole_reads, read(SKILL), f"SKILL.md still orders: {whole_reads}")
        line = self.skill_rule_line()
        self.assertTrue(line.startswith("- Cardinal rule:"), "the cardinal rule and the pointer share one line")
        for phrase in ("grep -n '^#'", "the active section", "the tail of `worklog.md`", "never whole"):
            self.assertIn(phrase, line)


class BuilderReadTests(unittest.TestCase):
    def setUp(self):
        self.text = flat(read(REFERENCES / "build-task-execution.md"))

    def test_builder_is_not_told_to_re_read_the_whole_plan(self):
        self.assertNotIn("Re-read the approved `plan.md`", self.text)

    def test_builder_starts_from_its_task_file_and_reads_one_plan_section(self):
        for phrase in (
            "your own task file first",
            "read that section alone",
            "never the whole plan",
        ):
            self.assertIn(phrase, self.text)

    def test_builder_reads_cited_cards_by_id(self):
        self.assertIn("by its id", self.text)
        self.assertIn("customizations-", self.text)

    def test_repair_builder_re_files_one_record_in_place(self):
        # A repair round changes one key of evidence.json; printing that file and
        # judge.json to do it carries every other record into the conversation.
        for phrase in (
            "Re-filing one evidence record",
            "read-modify-write",
            "your own id in `judge.json`",
            "never `cat` `evidence.json` or `judge.json`",
        ):
            self.assertIn(phrase, self.text)
        self.assertIsNotNone(refile_command("build-task-execution.md"), "no fixed re-file command")

    def test_repair_recipe_takes_its_values_from_the_refusal(self):
        # The field and the value come from the judge's refusal and travel in a file
        # the agent writes; the command itself is fixed and takes only the folder.
        self.assertIn('`{"id": "<id>", "set": {"<field>": <value>}}`', self.text)
        self.assertIn("the judge's refusal", self.text)
        self.assertIn("only while no other task writes `evidence.json`", self.text)
        self.assertIn("rule 5", self.text)
        self.assertIn("must never pass through a shell line", self.text)

    def test_the_mapping_is_listed_by_heading_and_every_applying_section_read(self):
        self.assertIn("every section that applies to your page", self.text)


def headings(path):
    return [line.lstrip("#").strip() for line in read(path).splitlines() if line.startswith("#")]


# Where a heading's own title ends and its gloss begins: `Section dashboards (7x
# analytics → …)` is pointed at as *Section dashboards*.
HEADING_GLOSS = re.compile(r" \(| — | → |: ")


def heading_titles(path):
    """Every heading of a file, whole, and its title part before the gloss."""
    titles = set()
    for heading in headings(path):
        titles.add(heading)
        titles.add(HEADING_GLOSS.split(heading, 1)[0].strip())
    return titles


def mapping_pointers(text):
    """(context, section name) for every pointer at the mapping reference in `text`.

    Two spellings point at it: `the mapping reference → *X*` and
    `./references/classic-to-freedom-mapping.md` → *X*. The name is None when the
    pointer names no section.
    """
    found = []
    pattern = r"(?:the mapping reference(?:'s)?|`\./references/classic-to-freedom-mapping\.md`)(.{0,90})"
    for match in re.finditer(pattern, text):
        named = re.match(r"\s*→\s*\*([^*]+)\*", match.group(1))
        found.append((match.group(0)[:70], named.group(1).strip() if named else None))
    return found


def header(text):
    """A brief's title and the paragraph under it - where it says what it is handed with."""
    title, _, rest = text.partition("\n\n")
    return title + "\n\n" + rest.split("\n\n", 1)[0]


# The briefs that re-file one record, and the file each command merges into.
REFILE_BRIEFS = {"build-task-execution.md": "evidence.json", "judge-brief.md": "judge.json"}
REFILE_TEMP = ".refile.json"


def refile_command(name):
    """The fixed re-file command line of a brief (`node -e "..." "<migration-folder>"`), or None."""
    match = re.search(r'`(node -e "[^"`]*" "<migration-folder>")`', flat(read(REFERENCES / name)))
    return match.group(1) if match else None


class ReferenceLookupTests(unittest.TestCase):
    """Reference docs are looked up by heading; only briefs are read whole."""

    def dispatch_rows(self):
        text = read(REFERENCES / "orchestrate-build.md")
        begin = text.find("**7.3 What each sub-agent is handed.**")
        self.assertGreaterEqual(begin, 0, "7.3 anchor not found")
        stop = text.find("**7.4 ", begin)
        rows = []
        for line in text[begin:stop].splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if line.lstrip().startswith("|") and not set(cells[0]) <= set("-: "):
                rows.append(cells)
        return rows

    def test_dispatch_table_separates_briefs_from_references(self):
        header, *rows = self.dispatch_rows()
        self.assertEqual(len(header), 4, f"dispatch table header: {header}")
        self.assertIn("read whole", header[2])
        self.assertIn("look up by heading", header[3])
        mapping_rows = [row for row in rows if "classic-to-freedom-mapping.md" in " ".join(row)]
        self.assertTrue(mapping_rows, "no task kind is pointed at the mapping reference")
        for row in mapping_rows:
            self.assertNotIn("classic-to-freedom-mapping.md", row[2], f"mapping listed as a brief: {row[0]}")
            self.assertIn("classic-to-freedom-mapping.md", row[3], row[0])

    def test_build_page_calls_the_mapping_a_reference_to_look_up(self):
        first = flat(header(read(REFERENCES / "build-page.md")))
        self.assertIn("look up by heading", first)
        self.assertIn("never read whole", first)

    def test_every_mapping_pointer_names_a_real_heading(self):
        # A pointer is compared to a heading's WHOLE title, not to a prefix of it: a
        # pointer cut down to its first words matches several headings and names none.
        known = heading_titles(REFERENCES / "classic-to-freedom-mapping.md")
        for name in ("build-page.md", "build-task-execution.md", "build-dashboards.md"):
            text = read(REFERENCES / name)
            # The header names the mapping as a whole; every pointer after it names a section.
            body = flat(text[len(header(text)) :])
            pointers = mapping_pointers(body)
            self.assertTrue(pointers, f"{name} no longer points at the mapping reference")
            wrong = [where for where, title in pointers if title not in known]
            self.assertFalse(wrong, f"{name}: mapping pointers naming no whole heading: {wrong}")

    def test_builders_read_every_mapping_section_that_applies(self):
        # A pointer names the section most tasks need, not every one a page needs:
        # the builder lists the headings and reads each section its page touches.
        for name in ("build-page.md", "build-dashboards.md"):
            first = flat(header(read(REFERENCES / name)))
            self.assertIn("every section that applies to your page", first, name)
            self.assertIn("grep -n '^#'", first, name)
        self.assertIn("reads every section that applies to its page", flat(read(REFERENCES / "orchestrate-build.md")))


class UiGuidelinesPointerTests(unittest.TestCase):
    """creatio-ui-guidelines is shared with app creation, so its pointers carry the rule too."""

    def setUp(self):
        self.text = flat(read(ROOT / "skills/creatio-ui-guidelines/SKILL.md"))

    def test_pointers_read_a_section_not_the_file(self):
        for unqualified in (
            "read `./references/page-layout-and-controls.md` first",
            "read `./references/accessibility-and-colors.md` first",
        ):
            self.assertNotIn(unqualified, self.text)
        for reference in ("page-layout-and-controls.md", "accessibility-and-colors.md"):
            self.assertRegex(
                self.text,
                rf"`\./references/{re.escape(reference)}`[^.]*list its headings",
                reference,
            )
        self.assertIn("the section for the element you are placing", self.text)

    def test_review_checklists_is_whole_only_for_a_full_audit(self):
        self.assertIn("read `./references/review-checklists.md` whole only for a full audit", self.text)


def outside_block(name):
    """A brief's own text, the shared block removed, so a phrase the block holds does not count."""
    text = read(REFERENCES / name)
    return flat(text.replace(block(text, name), ""))


class ReadBackAndJudgeTests(unittest.TestCase):
    def test_read_back_copies_files_instead_of_printing_them(self):
        text = outside_block("read-back-brief.md")
        self.assertIn("whole, never a slice", text)
        self.assertIn("Copy, do not print", text)
        for route in ("`cp`", "redirect", "--output-file"):
            self.assertIn(route, text)

    def test_fetch_briefs_say_what_an_mcp_response_costs(self):
        # --output-file keeps a body out of the conversation only where the command
        # has one; an MCP tool's response is in the conversation once it returns.
        for name in ("read-back-brief.md", "reference-cache-brief.md"):
            text = outside_block(name)
            self.assertNotIn("without passing through your conversation", text, name)
            self.assertIn("`--output-file` where the command supports it", text, name)
            self.assertIn("already in your conversation", text, name)

    def test_judge_fills_a_null_with_one_key_write(self):
        text = outside_block("judge-brief.md")
        self.assertIn("Fill a `null` in place", text)
        self.assertIn('"set": {"convincing": false, "why": "<the sentence you quote>"}', text)
        self.assertIsNotNone(refile_command("judge-brief.md"), "no fixed re-file command")
        self.assertIn("never print the file whole or rewrite it", text)
        self.assertIn("must never pass through a shell line", text)


class NoFreeTextInShellTests(unittest.TestCase):
    """Stand-derived text is data: it reaches a record through a file, never a shell line."""

    def test_no_node_command_carries_a_value_placeholder(self):
        for name in REFILE_BRIEFS:
            for line in read(REFERENCES / name).splitlines():
                if "node -e" not in line:
                    continue
                for placeholder in ("<value>", "<field>", "<the sentence", "<true|false>"):
                    self.assertNotIn(placeholder, line, f"{name}: a node -e line splices {placeholder}")

    def test_the_fixed_command_takes_only_the_folder(self):
        for name, target in REFILE_BRIEFS.items():
            command = refile_command(name)
            self.assertIsNotNone(command, name)
            script = command[len('node -e "') : -len('" "<migration-folder>"')]
            self.assertNotIn("<", script, f"{name}: the fixed command's code holds a placeholder")
            self.assertIn("process.argv[1]", script, name)
            self.assertIn(f"'/{target}'", script, name)
            self.assertIn(f"unlinkSync(d+'/{REFILE_TEMP}')", script, name)

    def test_judge_queries_its_records_by_id(self):
        text = flat(read(REFERENCES / "judge-brief.md"))
        self.assertIn("Query the records by id, never print them whole", text)
        for record in ("`evidence.json`", "`judge.json`", "`findings.md`"):
            self.assertIn(record, text)


class OrchestratorWholeReadTests(unittest.TestCase):
    def test_the_orchestrators_own_whole_reads_are_named_once(self):
        # The first paragraph after the block: the orchestrator is handed no task
        # file, so it is told which of its own files are read whole.
        text = read(REFERENCES / "orchestrate-build.md")
        after = flat(text[text.index(END) + len(END) :].lstrip("\n").split("\n\n", 1)[0])
        for phrase in ("`plan.md`", "at approval", "`decisions.md`", "`--- progress ---`", "once"):
            self.assertIn(phrase, after)


# Text a caption or a quoted sentence can carry, which a shell would expand or choke on.
HOSTILE = 'He said "go" $(echo pwned) `echo pwned` it\'s done'


def run_refile(name, folder, records, refile):
    """Write the target file and .refile.json, run the brief's fixed command as a shell line.

    The shell is bash when there is one, so the command line is run exactly as an
    agent would paste it; otherwise the folder is handed over as the one argv item.
    """
    target = Path(folder) / REFILE_BRIEFS[name]
    target.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
    (Path(folder) / REFILE_TEMP).write_text(json.dumps(refile), encoding="utf-8")
    command = refile_command(name)
    bash = shutil.which("bash")
    if bash:
        line = command.replace("<migration-folder>", Path(folder).as_posix())
        subprocess.run([bash, "-c", line], check=True, capture_output=True, timeout=60)
    else:
        script = command[len('node -e "') : -len('" "<migration-folder>"')]
        subprocess.run(["node", "-e", script, folder], check=True, capture_output=True, timeout=60)
    return json.loads(target.read_text(encoding="utf-8"))


@unittest.skipIf(shutil.which("node") is None, "node is not on PATH")
class RefileRecipeRunTests(unittest.TestCase):
    """The recipes are run, not only read: each changes one key and stores the text literally."""

    def test_the_repair_recipe_changes_only_the_target_record(self):
        before = {
            "E1": {"referencePage": "UsrOther", "components": ["crt.Button"]},
            "E2": {"referencePage": None, "components": ["crt.Input"]},
        }
        with tempfile.TemporaryDirectory() as folder:
            refile = {"id": "E2", "set": {"referencePage": HOSTILE}}
            after = run_refile("build-task-execution.md", folder, before, refile)
            self.assertFalse((Path(folder) / REFILE_TEMP).exists(), "the temp file was left behind")
        self.assertEqual(after["E1"], before["E1"], "the recipe touched another record")
        self.assertEqual(after["E2"], {"referencePage": HOSTILE, "components": ["crt.Input"]})
        self.assertEqual(set(after), set(before))

    def test_the_judge_recipe_fills_one_null(self):
        before = {"E1": {"convincing": True, "why": "quoted"}, "E2": None}
        with tempfile.TemporaryDirectory() as folder:
            refile = {"id": "E2", "set": {"convincing": False, "why": HOSTILE}}
            after = run_refile("judge-brief.md", folder, before, refile)
            self.assertFalse((Path(folder) / REFILE_TEMP).exists(), "the temp file was left behind")
        self.assertEqual(after["E1"], before["E1"], "the recipe touched another verdict")
        self.assertEqual(after["E2"], {"convincing": False, "why": HOSTILE})
        self.assertEqual(set(after), set(before))


if __name__ == "__main__":
    unittest.main()
