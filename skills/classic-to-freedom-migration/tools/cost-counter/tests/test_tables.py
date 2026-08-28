"""Unit tests for table rendering (T3 -> R5)."""
import unittest

from tables import Column, Table


class ShareAndTotalTest(unittest.TestCase):
    def _table(self):
        table = Table(
            columns=[
                Column("n", "agents", "int"),
                Column("cw", "cacheW", "mb", share=True),
                Column("cr", "cacheR", "mb", share=True),
            ],
            label_header="role",
            label_width=10,
        )
        table.add("BUILD", {"n": 5, "cw": 4_000_000, "cr": 100_000_000})
        table.add("REFS", {"n": 3, "cw": 1_000_000, "cr": 50_000_000})
        return table

    def test_total_equals_column_sums(self):
        table = self._table()
        totals = table.total_values()
        self.assertEqual(totals["n"], 8)
        self.assertEqual(totals["cw"], 5_000_000)
        self.assertEqual(totals["cr"], 150_000_000)

    def test_each_measure_has_its_own_share_column(self):
        # Two measures (cw, cr) -> exactly two "%" columns in the header.
        header = self._table().render().splitlines()[0]
        self.assertEqual(header.count("%"), 2)

    def test_total_row_is_rendered_last(self):
        rendered = self._table().render()
        self.assertTrue(rendered.rstrip().splitlines()[-1].startswith("TOTAL"))

    def test_share_is_per_column_not_shared(self):
        # BUILD cacheW share (4M/5M = 80%) differs from its cacheR share
        # (100M/150M ~= 66.7%): the shares are computed per measure.
        rendered = self._table().render()
        build_line = next(l for l in rendered.splitlines() if l.startswith("BUILD"))
        self.assertIn("80.0%", build_line)
        self.assertIn("66.7%", build_line)

    def test_to_dict_carries_values_shares_and_total(self):
        data = self._table().to_dict()
        self.assertEqual([c["key"] for c in data["columns"]], ["n", "cw", "cr"])
        self.assertEqual(data["total"]["cells"]["cw"]["value"], 5_000_000)
        # a plain count column has no share; a measure column does.
        self.assertNotIn("pct", data["total"]["cells"]["n"])
        self.assertAlmostEqual(data["rows"][0]["cells"]["cw"]["pct"], 80.0)
        self.assertAlmostEqual(data["rows"][0]["cells"]["cr"]["pct"], 66.7)

    def test_to_markdown_has_bold_total_and_per_measure_shares(self):
        lines = self._table().to_markdown().splitlines()
        # header + separator + 2 data rows + TOTAL.
        self.assertEqual(len(lines), 5)
        self.assertTrue(lines[-1].startswith("| **TOTAL**"))
        # exactly one "%" header column per measure (2), none for the count.
        self.assertEqual(lines[0].count("%"), 2)
        build = next(l for l in lines if l.startswith("| BUILD"))
        self.assertIn("80.0%", build)
        self.assertIn("66.7%", build)


class TextColumnTest(unittest.TestCase):
    """A text column carries a per-row category label: left-aligned, no share,
    and a blank (never summed) TOTAL cell across text/json/markdown."""

    def _table(self):
        table = Table(
            columns=[
                Column("kind", "kind", "text", width=9),
                Column("cw", "cacheW", "mb", share=True),
            ],
            label_header="stage",
            label_width=10,
        )
        table.add("main", {"kind": "main", "cw": 4_000_000})
        table.add("wf1", {"kind": "subagents", "cw": 1_000_000})
        return table

    def test_text_column_has_blank_total(self):
        self.assertEqual(self._table().total_values()["kind"], "")

    def test_text_values_render_in_rows(self):
        rendered = self._table().render()
        main_line = next(l for l in rendered.splitlines() if l.startswith("main"))
        self.assertIn("main", main_line)
        wf_line = next(l for l in rendered.splitlines() if l.startswith("wf1"))
        self.assertIn("subagents", wf_line)
        # the cacheW measure still totals normally alongside the text column.
        self.assertEqual(self._table().total_values()["cw"], 5_000_000)

    def test_to_dict_text_cell_is_string_without_share(self):
        cells = self._table().to_dict()["rows"][0]["cells"]
        self.assertEqual(cells["kind"]["value"], "main")
        self.assertNotIn("pct", cells["kind"])

    def test_markdown_text_column_left_aligned_and_total_blank(self):
        lines = self._table().to_markdown().splitlines()
        # left-aligned separator for the text column (its own :-- among --:).
        self.assertIn(":--", lines[1].split("|")[2])
        # the TOTAL row's text cell is blank, not a bolded empty "****".
        self.assertNotIn("****", lines[-1])


class MarkdownEscapeTest(unittest.TestCase):
    """A row is built by joining cells with ``|``, so a ``|`` inside a cell
    opens a new column and every figure after it shifts one header to the left.
    Labels are the exposed side: a stage label carries a model-authored agent
    ``description`` and a workflow name read straight from the run file."""

    def _table(self, label):
        table = Table(
            columns=[Column("n", "agents", "int"), Column("cr", "cacheR", "mb", share=True)],
            label_header="stage",
        )
        table.add(label, {"n": 1, "cr": 1_000_000})
        return table

    def test_a_pipe_in_a_label_does_not_add_a_column(self):
        md = self._table("analysis | 999 | 999").to_markdown().splitlines()
        header_columns = md[0].count("|")
        for row in md[2:]:
            self.assertEqual(row.count("|") - row.count(r"\|"), header_columns, row)

    def test_the_pipe_is_still_visible_to_the_reader(self):
        md = self._table("a | b").to_markdown()
        self.assertIn(r"a \| b", md)

    def test_an_ordinary_label_is_untouched(self):
        md = self._table("freedom-build-executor").to_markdown()
        self.assertIn("| freedom-build-executor |", md)
        self.assertNotIn("\\", md)

    def test_a_text_column_cell_is_escaped_like_the_label(self):
        table = self._table("ok")
        table.columns = [Column("kind", "kind", "text")] + table.columns
        table.rows = [("a | b", {"kind": "x | y", "n": 1, "cr": 1_000_000})]
        md = table.to_markdown().splitlines()
        header_columns = md[0].count("|")
        for row in md[2:]:
            self.assertEqual(row.count("|") - row.count(r"\|"), header_columns, row)
        self.assertIn(r"x \| y", md[2])

    def test_the_bold_branch_escapes_too(self):
        # The bold wrap is a separate expression from the plain one, so it needs
        # a pipe of its own to exercise. The TOTAL row's own cells are computed
        # sums and an empty text cell, so drive _md_row directly -- putting the
        # pipes in a non-bold data row left this branch unexercised while the
        # test claimed to cover it.
        table = self._table("ok")
        row = table._md_row("a | b", {"n": 1, "cr": 1_000_000},
                            table.total_values(), bold=True)
        self.assertIn(r"**a \| b**", row)
        self.assertEqual(row.count("|") - row.count(r"\|"),
                         table.to_markdown().splitlines()[0].count("|"))


if __name__ == "__main__":
    unittest.main()
