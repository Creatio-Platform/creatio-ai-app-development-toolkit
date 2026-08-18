"""Aggregation and report construction over a discovered session export.

Every measure the counter reports is built from a single per-transcript pass
(:func:`aggregate_transcript`) so a stage, a tool, a role and an agent all see
the same numbers. Cache tokens are always carried as their own measures --
``cache_write`` and ``cache_read`` are never folded into ``output`` (R2).
"""
from __future__ import annotations

import collections
import json
import os
from dataclasses import dataclass, field
from typing import Optional

import export as export_mod
import metrics
import parsing
from tables import Column, Table


@dataclass
class TranscriptAgg:
    input: int = 0
    cache_write: int = 0          # summed cache_creation_input_tokens
    cache_read: int = 0
    output: int = 0
    ephemeral_5m: int = 0
    ephemeral_1h: int = 0
    turns: int = 0
    startup: int = 0              # first usage turn: cache_write + input
    tool_calls: collections.Counter = field(default_factory=collections.Counter)
    tool_bytes: collections.Counter = field(default_factory=collections.Counter)

    def add(self, other: "TranscriptAgg") -> None:
        self.input += other.input
        self.cache_write += other.cache_write
        self.cache_read += other.cache_read
        self.output += other.output
        self.ephemeral_5m += other.ephemeral_5m
        self.ephemeral_1h += other.ephemeral_1h
        self.turns += other.turns
        self.startup += other.startup
        self.tool_calls.update(other.tool_calls)
        self.tool_bytes.update(other.tool_bytes)


def _result_bytes(content, offloaded_dir: Optional[str]) -> int:
    """Bytes a tool_result contributes to context.

    Offloaded results carry only a short 'saved to <file>' stub inline; the real
    payload sits in tool-results/. Charge the on-disk file size when we can find
    it, so a tool that offloads a huge result is not under-counted (R9).
    """
    text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
    name = parsing.offloaded_filename(text)
    if name and offloaded_dir:
        # basename() is defensive: _OFFLOAD_RE already forbids path separators
        # in the captured name, so this cannot escape offloaded_dir -- it keeps
        # the join provably confined and satisfies SAST taint analysis.
        path = os.path.join(offloaded_dir, os.path.basename(name))
        if os.path.isfile(path):
            return os.path.getsize(path)
    return len(text.encode("utf-8"))


def aggregate_transcript(path: str, offloaded_dir: Optional[str] = None) -> TranscriptAgg:
    """Single pass over one transcript: usage, tool calls and tool-result bytes.

    Offloaded tool-result bytes are attributed to the *producing tool* via the
    ``tool_use_id`` recorded in the transcript -- never guessed from the
    offload file name, which is generic for non-MCP tools (R9).
    """
    agg = TranscriptAgg()
    id_to_tool: dict = {}
    for obj in parsing.iter_jsonl(path):
        usage = parsing.usage_of(obj)
        if usage:
            agg.turns += 1
            in_tok = usage.get("input_tokens", 0) or 0
            cw = usage.get("cache_creation_input_tokens", 0) or 0
            agg.input += in_tok
            agg.cache_write += cw
            agg.cache_read += usage.get("cache_read_input_tokens", 0) or 0
            agg.output += usage.get("output_tokens", 0) or 0
            m5, h1 = parsing.cache_creation_ttl(usage)
            agg.ephemeral_5m += m5
            agg.ephemeral_1h += h1
            if agg.startup == 0 and agg.turns == 1:
                agg.startup = cw + in_tok

        message = obj.get("message") or {}
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "tool_use":
                name = block.get("name") or "?"
                id_to_tool[block.get("id")] = name
                agg.tool_calls[name] += 1
            elif btype == "tool_result":
                tool_name = id_to_tool.get(block.get("tool_use_id"), "?")
                agg.tool_bytes[tool_name] += _result_bytes(block.get("content"), offloaded_dir)
    return agg


@dataclass
class ReconcileRow:
    workflow: str
    agents_meta: Optional[int]
    agents_seen: int
    tool_calls_meta: Optional[int]
    tool_calls_seen: int

    @property
    def agents_ok(self) -> bool:
        return self.agents_meta is None or self.agents_meta == self.agents_seen

    @property
    def tool_calls_ok(self) -> bool:
        return self.tool_calls_meta is None or self.tool_calls_meta == self.tool_calls_seen


def _read_meta(path: str) -> tuple[Optional[int], Optional[int]]:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            data = json.load(handle)
    except Exception:
        return (None, None)
    return (data.get("agentCount"), data.get("totalToolCalls"))


def _built_pages(session: export_mod.SessionExport) -> set:
    """Distinct built page schema names, read from workflow journals."""
    pages: set = set()
    for workflow in session.workflows:
        if not workflow.journal:
            continue
        for obj in parsing.iter_jsonl(workflow.journal):
            result = obj.get("result")
            if not isinstance(result, dict):
                continue
            schemas = result.get("pageSchemas")
            if isinstance(schemas, dict):
                for value in schemas.values():
                    if value:
                        pages.add(value)
    return pages


class Report:
    """Builds every table and the derived scalars for one session export."""

    def __init__(self, session: export_mod.SessionExport, cfg: metrics.CostConfig,
                 pages_override: Optional[int] = None):
        self.session = session
        self.cfg = cfg
        self.pages_override = pages_override

        # Each agent transcript is parsed exactly once here and every downstream
        # measure (per-stage, per-agent, reconcile) reads from this cache -- the
        # "single per-transcript pass" the module docstring promises. Offloaded
        # bytes are resolved against each workflow's OWN session tool-results so
        # a multi-session export attributes them to the right directory (R9).
        self._agent_aggs: dict[str, TranscriptAgg] = {}
        for workflow in session.workflows:
            for agent_file in workflow.agent_files:
                self._agent_aggs[agent_file] = aggregate_transcript(
                    agent_file, workflow.tool_results_dir
                )

        # per-stage aggregates
        self.stage_aggs: list[tuple[str, TranscriptAgg]] = []
        if session.main_transcript:
            self.stage_aggs.append(
                ("main (discovery+plan)",
                 aggregate_transcript(session.main_transcript, session.tool_results_dir))
            )
        for workflow in session.workflows:
            agg = TranscriptAgg()
            for agent_file in workflow.agent_files:
                agg.add(self._agent_aggs[agent_file])
            label = f"{workflow.name} ({len(workflow.agent_files)} agents)"
            self.stage_aggs.append((label, agg))

        # per-agent aggregates (subagents only)
        self.agent_rows: list[tuple[str, str, str, TranscriptAgg]] = []
        for workflow in session.workflows:
            for agent_file in workflow.agent_files:
                agg = self._agent_aggs[agent_file]
                role = parsing.opening_role(agent_file) or "?"
                agent_id = os.path.basename(agent_file)[len("agent-"):][:14]
                self.agent_rows.append((workflow.name, agent_id, role, agg))

        # global effective cache-write weight (from every transcript)
        total = TranscriptAgg()
        for _, agg in self.stage_aggs:
            total.add(agg)
        self.totals = total
        self.effective_w = metrics.effective_cache_write_weight(
            total.ephemeral_5m, total.ephemeral_1h, cfg
        )

        self.built_pages = _built_pages(session)

    # ---- derived scalars -------------------------------------------------

    def weighted_total(self) -> float:
        return metrics.weighted_cost(
            self.totals.input, self.totals.cache_write, self.totals.cache_read,
            self.totals.output, self.effective_w, self.cfg,
        )

    def page_count(self) -> int:
        if self.pages_override is not None:
            return self.pages_override
        return len(self.built_pages) or 1

    def reconcile(self) -> list[ReconcileRow]:
        rows = []
        for workflow in self.session.workflows:
            agents_meta = tool_calls_meta = None
            if workflow.meta_json:
                agents_meta, tool_calls_meta = _read_meta(workflow.meta_json)
            tool_calls_seen = 0
            for agent_file in workflow.agent_files:
                tool_calls_seen += sum(self._agent_aggs[agent_file].tool_calls.values())
            rows.append(ReconcileRow(
                workflow.name, agents_meta, len(workflow.agent_files),
                tool_calls_meta, tool_calls_seen,
            ))
        return rows

    # ---- tables ----------------------------------------------------------

    def _weighted(self, agg: TranscriptAgg) -> float:
        return metrics.weighted_cost(
            agg.input, agg.cache_write, agg.cache_read, agg.output,
            self.effective_w, self.cfg,
        )

    def by_stage_table(self) -> Table:
        table = Table(
            columns=[
                Column("input", "input", "mb"),
                Column("cache_write", "cacheW", "mb", share=True),
                Column("cache_read", "cacheR", "mb", share=True),
                Column("output", "outTok", "mb", share=True),
                Column("calls", "toolCalls", "int"),
                Column("bytes", "resultMB", "mb", share=True),
                Column("weighted", "weighted", "mb", share=True),
            ],
            label_header="stage",
            label_width=32,
        )
        for label, agg in self.stage_aggs:
            table.add(label, {
                "input": agg.input,
                "cache_write": agg.cache_write,
                "cache_read": agg.cache_read,
                "output": agg.output,
                "calls": sum(agg.tool_calls.values()),
                "bytes": sum(agg.tool_bytes.values()),
                "weighted": self._weighted(agg),
            })
        return table

    def by_tool_table(self, limit: int = 30) -> Table:
        calls: collections.Counter = collections.Counter()
        tbytes: collections.Counter = collections.Counter()
        for _, agg in self.stage_aggs:
            calls.update(agg.tool_calls)
            tbytes.update(agg.tool_bytes)
        table = Table(
            columns=[
                Column("calls", "calls", "int", share=True),
                Column("bytes", "resultMB", "mb", share=True),
            ],
            label_header="tool",
            label_width=40,
        )
        ranked = calls.most_common()
        for name, _ in ranked[:limit]:
            table.add(name, {"calls": calls[name], "bytes": tbytes.get(name, 0)})
        tail = ranked[limit:]
        if tail:
            # Fold the long tail into one explicit row so the TOTAL still
            # reconciles to the true call/byte counts rather than the top-N sum.
            table.add(
                f"(+{len(tail)} more tools)",
                {
                    "calls": sum(c for _, c in tail),
                    "bytes": sum(tbytes.get(n, 0) for n, _ in tail),
                },
            )
        return table

    def by_role_table(self) -> Table:
        agg_by_role: dict = collections.defaultdict(TranscriptAgg)
        count_by_role: collections.Counter = collections.Counter()
        for _, _, role, agg in self.agent_rows:
            agg_by_role[role].add(agg)
            count_by_role[role] += 1
        table = Table(
            columns=[
                Column("n", "agents", "int"),
                Column("turns", "turns", "int"),
                Column("cache_write", "cacheW", "mb", share=True),
                Column("cache_read", "cacheR", "mb", share=True),
                Column("output", "outTok", "mb", share=True),
                Column("weighted", "weighted", "mb", share=True),
            ],
            label_header="agent role",
            label_width=20,
        )
        for role in sorted(agg_by_role, key=lambda r: -agg_by_role[r].cache_read):
            agg = agg_by_role[role]
            table.add(role, {
                "n": count_by_role[role],
                "turns": agg.turns,
                "cache_write": agg.cache_write,
                "cache_read": agg.cache_read,
                "output": agg.output,
                "weighted": self._weighted(agg),
            })
        return table

    def per_agent_table(self) -> Table:
        table = Table(
            columns=[
                Column("turns", "turns", "int"),
                Column("startup", "startup", "mb", share=True),
                Column("cache_write", "cacheW", "mb", share=True),
                Column("cache_read", "cacheR", "mb", share=True),
                Column("output", "outTok", "mb", share=True),
            ],
            label_header="workflow / agent / role",
            label_width=44,
        )
        for wf, agent_id, role, agg in sorted(self.agent_rows, key=lambda r: -r[3].cache_read):
            label = f"{wf[:15]} {agent_id} {role}"
            table.add(label, {
                "turns": agg.turns,
                "startup": agg.startup,
                "cache_write": agg.cache_write,
                "cache_read": agg.cache_read,
                "output": agg.output,
            })
        return table
