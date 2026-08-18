"""Fixed-width table rendering.

Every table produced by the counter follows the same contract (ENG-95467 R5):

* each *measure* column carries its own share column (the row value as a
  percent of that column's total) -- a share is never shared across measures;
* the table always ends with a ``TOTAL`` row whose every numeric cell equals
  the sum of that column over the data rows.

Counts (agents, turns, tool calls) are plain numeric columns without a share.
Token/byte measures request ``share=True``.
"""
from __future__ import annotations

from dataclasses import dataclass, field


def _fmt(value: float, kind: str) -> str:
    if kind == "mb":
        return f"{value / 1e6:,.2f}"
    if kind == "float":
        return f"{value:,.2f}"
    return f"{value:,.0f}"


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    kind: str = "int"          # "int" | "float" | "mb"
    share: bool = False        # render a trailing "%" column
    width: int = 12


@dataclass
class Table:
    columns: list[Column]
    label_header: str = ""
    label_width: int = 28
    rows: list[tuple[str, dict]] = field(default_factory=list)

    def add(self, label: str, values: dict) -> None:
        self.rows.append((label, values))

    def total_values(self) -> dict:
        """Column sums over the data rows -- the values of the TOTAL row."""
        totals: dict = {}
        for col in self.columns:
            totals[col.key] = sum((vals.get(col.key, 0) or 0) for _, vals in self.rows)
        return totals

    def _render_row(self, label: str, values: dict, totals: dict) -> str:
        cells = [f"{label[: self.label_width]:<{self.label_width}}"]
        for col in self.columns:
            value = values.get(col.key, 0) or 0
            cells.append(f"{_fmt(value, col.kind):>{col.width}}")
            if col.share:
                col_total = totals[col.key]
                pct = (value / col_total * 100.0) if col_total else 0.0
                cells.append(f"{pct:>5.1f}%")
        return " ".join(cells)

    def _header(self) -> str:
        cells = [f"{self.label_header:<{self.label_width}}"]
        for col in self.columns:
            cells.append(f"{col.label:>{col.width}}")
            if col.share:
                cells.append(f"{'%':>6}")
        return " ".join(cells)

    def render(self) -> str:
        totals = self.total_values()
        header = self._header()
        lines = [header, "-" * len(header)]
        for label, values in self.rows:
            lines.append(self._render_row(label, values, totals))
        lines.append("-" * len(header))
        lines.append(self._render_row("TOTAL", totals, totals))
        return "\n".join(lines)
