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


def _md_escape(cell) -> str:
    """One cell made safe for a Markdown table row.

    A row is assembled by joining cells with ``|``, so an unescaped ``|`` inside
    a cell opens a new column: every figure after it shifts one header to the
    left and the table silently misreports. Labels are the exposed side -- a
    stage label carries a model-authored agent ``description`` and a workflow
    name straight from the run file -- so escape here, in the renderer that owns
    the format, rather than in each producer of a label.
    """
    return str(cell).replace("|", r"\|")


def _fmt(value, kind: str) -> str:
    if kind == "text":
        return "" if value is None else str(value)
    if kind == "mb":
        return f"{value / 1e6:,.2f}"
    if kind == "float":
        return f"{value:,.2f}"
    return f"{value:,.0f}"


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    kind: str = "int"          # "int" | "float" | "mb" | "text"
    share: bool = False        # render a trailing "%" column
    width: int = 12

    @property
    def is_text(self) -> bool:
        # A text column (e.g. a per-row category label) carries a string, is
        # left-aligned, never gets a share, and is skipped in the TOTAL row --
        # summing category labels is meaningless.
        return self.kind == "text"


@dataclass
class Table:
    columns: list[Column]
    label_header: str = ""
    label_width: int = 28
    rows: list[tuple[str, dict]] = field(default_factory=list)

    def add(self, label: str, values: dict) -> None:
        self.rows.append((label, values))

    def total_values(self) -> dict:
        """Column sums over the data rows -- the values of the TOTAL row.

        Text columns carry per-row category labels, not quantities, so they get
        an empty TOTAL cell instead of a (meaningless) sum.
        """
        totals: dict = {}
        for col in self.columns:
            if col.is_text:
                totals[col.key] = ""
                continue
            totals[col.key] = sum((vals.get(col.key, 0) or 0) for _, vals in self.rows)
        return totals

    def _render_row(self, label: str, values: dict, totals: dict) -> str:
        cells = [f"{label[: self.label_width]:<{self.label_width}}"]
        for col in self.columns:
            if col.is_text:
                text = _fmt(values.get(col.key), col.kind)
                cells.append(f"{text[: col.width]:<{col.width}}")
                continue
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
            if col.is_text:
                cells.append(f"{col.label:<{col.width}}")
                continue
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

    # ---- structured / markdown views (same contract as render()) ----------

    def _cells(self, values: dict, totals: dict) -> dict:
        """One row's cells keyed by column: {value, [pct]} per measure."""
        out: dict = {}
        for col in self.columns:
            if col.is_text:
                out[col.key] = {"value": _fmt(values.get(col.key), col.kind)}
                continue
            value = values.get(col.key, 0) or 0
            cell = {"value": value}
            if col.share:
                col_total = totals[col.key]
                cell["pct"] = round((value / col_total * 100.0) if col_total else 0.0, 1)
            out[col.key] = cell
        return out

    def to_dict(self) -> dict:
        """Structured view for --format json. Same numbers as render(): each
        measure carries its own share and the TOTAL row equals the column sums."""
        totals = self.total_values()
        return {
            "label_header": self.label_header,
            "columns": [
                {"key": c.key, "label": c.label, "kind": c.kind, "share": c.share}
                for c in self.columns
            ],
            "rows": [
                {"label": label, "cells": self._cells(values, totals)}
                for label, values in self.rows
            ],
            "total": {"label": "TOTAL", "cells": self._cells(totals, totals)},
        }

    def _md_head_sep(self) -> tuple[list, list]:
        """Header labels and alignment separators for the Markdown table."""
        heads = [self.label_header or " "]
        seps = [":--"]
        for col in self.columns:
            heads.append(col.label)
            seps.append(":--" if col.is_text else "--:")
            if col.share:
                heads.append("%")
                seps.append("--:")
        return heads, seps

    def _md_row(self, label: str, values: dict, totals: dict, bold: bool = False) -> str:
        # Never bold an empty cell -- "****" would render as literal asterisks
        # (e.g. the text column's blank TOTAL cell).
        def wrap(s):
            return f"**{_md_escape(s)}**" if bold and s else _md_escape(s)

        cells = [wrap(label)]
        for col in self.columns:
            if col.is_text:
                cells.append(wrap(_fmt(values.get(col.key), col.kind)))
                continue
            value = values.get(col.key, 0) or 0
            cells.append(wrap(_fmt(value, col.kind)))
            if col.share:
                col_total = totals[col.key]
                pct = (value / col_total * 100.0) if col_total else 0.0
                cells.append(wrap(f"{pct:.1f}%"))
        return "| " + " | ".join(cells) + " |"

    def to_markdown(self) -> str:
        """GitHub-flavoured Markdown table for --format md (renders in Jira).

        Same columns as render() -- each measure plus its own ``%`` column --
        with a bold ``TOTAL`` row equal to the column sums. Label left-aligned,
        numbers right-aligned."""
        totals = self.total_values()
        heads, seps = self._md_head_sep()
        lines = ["| " + " | ".join(heads) + " |", "| " + " | ".join(seps) + " |"]
        for label, values in self.rows:
            lines.append(self._md_row(label, values, totals))
        lines.append(self._md_row("TOTAL", totals, totals, bold=True))
        return "\n".join(lines)
