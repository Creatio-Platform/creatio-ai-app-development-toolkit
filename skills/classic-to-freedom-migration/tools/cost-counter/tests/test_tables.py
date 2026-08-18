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


if __name__ == "__main__":
    unittest.main()
