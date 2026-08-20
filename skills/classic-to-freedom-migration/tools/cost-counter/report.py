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


def _apply_usage(agg: TranscriptAgg, usage: dict) -> None:
    """Fold one turn's token usage into the aggregate."""
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


def _apply_tool_blocks(agg: TranscriptAgg, content: list, id_to_tool: dict,
                       offloaded_dir: Optional[str]) -> None:
    """Fold one message's tool_use / tool_result blocks into the aggregate."""
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
            _apply_usage(agg, usage)
        content = (obj.get("message") or {}).get("content")
        if isinstance(content, list):
            _apply_tool_blocks(agg, content, id_to_tool, offloaded_dir)
    return agg


@dataclass
class ReconcileRow:
    workflow: str            # human-friendly stage label (see _workflow_labels)
    agents_meta: Optional[int]
    agents_seen: int
    tool_calls_meta: Optional[int]
    tool_calls_seen: int
    run_id: Optional[str] = None   # opaque workflow run-id, kept for traceability

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


def _workflow_labels(session: export_mod.SessionExport) -> dict:
    """Human-friendly stage label per workflow, read from the workflow meta.

    ``workflows/<wf>.json`` carries ``workflowName`` (e.g.
    ``creatio-freedom-build-executor``) and ``startTime``. We show that name --
    minus the ``creatio-`` prefix -- instead of the opaque run-id directory name
    (``wf_1f254b35-538``). When the same workflow ran more than once (e.g. three
    build rounds), the repeats are numbered ``round 1/2/3`` in start-time order.
    Anything without a readable name falls back to its raw run id.
    """
    info = {wf.name: _workflow_name_start(wf) for wf in session.workflows}
    round_no = _round_numbers(info)

    labels: dict = {}
    for run_id, (name, _) in info.items():
        if not name:
            labels[run_id] = run_id
            continue
        friendly = name[len("creatio-"):] if name.startswith("creatio-") else name
        if run_id in round_no:
            friendly = f"{friendly} · round {round_no[run_id]}"
        labels[run_id] = friendly
    return labels


def _workflow_name_start(workflow) -> tuple:
    """(workflowName, startTime) from a workflow's meta json, (None, None) if absent."""
    if not workflow.meta_json:
        return (None, None)
    try:
        with open(workflow.meta_json, encoding="utf-8", errors="replace") as handle:
            data = json.load(handle)
    except Exception:
        return (None, None)
    return (data.get("workflowName"), data.get("startTime") or data.get("timestamp"))


def _round_numbers(info: dict) -> dict:
    """Map run-id -> round number for workflow names that ran more than once,
    numbered in start-time order. Names that ran once get no entry."""
    groups: dict = collections.defaultdict(list)
    for run_id, (name, start) in info.items():
        if name:
            groups[name].append((start, run_id))
    round_no: dict = {}
    for runs in groups.values():
        if len(runs) <= 1:
            continue
        # start-time order; None sorts first so numbering stays deterministic.
        for index, (_, run_id) in enumerate(
            sorted(runs, key=lambda r: (r[0] is None, r[0])), start=1
        ):
            round_no[run_id] = index
    return round_no


def _workflow_sort_key(workflow) -> tuple:
    """Execution order: sort workflows by their `startTime` (epoch ms) from the
    meta, so stages read in the order they actually ran (behaviour-analysis,
    build round 1, 2, 3 …) rather than by the opaque run-id directory name.
    Workflows without a numeric start time sort last, then by name for stability.
    """
    start = None
    if workflow.meta_json:
        try:
            with open(workflow.meta_json, encoding="utf-8", errors="replace") as handle:
                start = json.load(handle).get("startTime")
        except Exception:
            pass
    if isinstance(start, (int, float)):
        return (0, start, workflow.name)
    return (1, 0, workflow.name)


def _pages_in_journal(journal: str) -> set:
    """String page-schema names recorded in one workflow journal."""
    pages: set = set()
    for obj in parsing.iter_jsonl(journal):
        result = obj.get("result")
        if not isinstance(result, dict):
            continue
        schemas = result.get("pageSchemas")
        if not isinstance(schemas, dict):
            continue
        for value in schemas.values():
            # Only string schema names belong in the set. A non-string value
            # (dict/list, if the journal format ever nests) would later crash
            # sorted(self.built_pages) with a TypeError.
            if isinstance(value, str) and value:
                pages.add(value)
    return pages


def _built_pages(session: export_mod.SessionExport) -> set:
    """Distinct built page schema names, read from workflow journals."""
    pages: set = set()
    for workflow in session.workflows:
        if workflow.journal:
            pages |= _pages_in_journal(workflow.journal)
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

        # human-friendly stage labels (workflowName + round #), not raw run ids
        self.workflow_labels = _workflow_labels(session)
        # execution order (by startTime), so stages read the way the run happened
        self._ordered_workflows = sorted(session.workflows, key=_workflow_sort_key)

        # per-stage aggregates
        self.stage_aggs: list[tuple[str, TranscriptAgg]] = []
        if session.main_transcript:
            # The main transcript lives at the export root and carries no session
            # UUID of its own, so its offloaded bytes are resolved against
            # session.tool_results_dir (the last session discovered). Single-
            # session exports -- the normal case -- are exact. In the rare
            # multi-session root only the main stage is best-effort here; every
            # workflow agent is still attributed to its own session's
            # tool-results via workflow.tool_results_dir above (R9).
            self.stage_aggs.append(
                ("main (discovery+plan)",
                 aggregate_transcript(session.main_transcript, session.tool_results_dir))
            )
        for workflow in self._ordered_workflows:
            agg = TranscriptAgg()
            for agent_file in workflow.agent_files:
                agg.add(self._agent_aggs[agent_file])
            friendly = self.workflow_labels.get(workflow.name, workflow.name)
            label = f"{friendly} ({len(workflow.agent_files)} agents)"
            self.stage_aggs.append((label, agg))

        # per-agent aggregates (subagents only)
        self.agent_rows: list[tuple[str, str, str, TranscriptAgg]] = []
        for workflow in session.workflows:
            for agent_file in workflow.agent_files:
                agg = self._agent_aggs[agent_file]
                role = parsing.opening_role(agent_file) or "?"
                agent_id = os.path.basename(agent_file)[len("agent-"):][:14]
                friendly = self.workflow_labels.get(workflow.name, workflow.name)
                self.agent_rows.append((friendly, agent_id, role, agg))

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
        # Only a positive override is meaningful. A non-positive value would make
        # per-page normalization divide by zero or print a negative cost, so we
        # ignore it and fall back to the discovered built-page count. The CLI
        # also rejects non-positive --pages up front; this is defence in depth
        # for direct run()/Report callers.
        if self.pages_override is not None and self.pages_override > 0:
            return self.pages_override
        return len(self.built_pages) or 1

    def summary(self) -> dict:
        """Headline scalars for one run -- the concise single-run view and the
        per-side input to a baseline/candidate comparison. `weighted_per_page`
        is the figure to compare across runs, since it is normalised by the
        number of built pages (a run that builds more pages costs more)."""
        pages = self.page_count()
        weighted = self.weighted_total()
        return {
            "weighted_total": weighted,
            "weighted_per_page": weighted / pages,
            "page_count": pages,
            "built_pages": sorted(self.built_pages),
            "input": self.totals.input,
            "cache_write": self.totals.cache_write,
            "cache_read": self.totals.cache_read,
            "output": self.totals.output,
            "tool_calls": sum(self.totals.tool_calls.values()),
            "agents": len(self.session.agent_files),
            "turns": self.totals.turns,
            "effective_w": self.effective_w,
        }

    def reconcile(self) -> list[ReconcileRow]:
        rows = []
        for workflow in self._ordered_workflows:
            agents_meta = tool_calls_meta = None
            if workflow.meta_json:
                agents_meta, tool_calls_meta = _read_meta(workflow.meta_json)
            tool_calls_seen = 0
            for agent_file in workflow.agent_files:
                tool_calls_seen += sum(self._agent_aggs[agent_file].tool_calls.values())
            rows.append(ReconcileRow(
                self.workflow_labels.get(workflow.name, workflow.name),
                agents_meta, len(workflow.agent_files),
                tool_calls_meta, tool_calls_seen, run_id=workflow.name,
            ))
        return rows

    # ---- tables ----------------------------------------------------------

    def _weighted(self, agg: TranscriptAgg) -> float:
        # Weight each aggregate by ITS OWN cache-write TTL mix, not the global
        # blend. The driver session writes at 1h (x2.0) and the subagents at 5m
        # (x1.25); a single global weight would move cost off the driver stage
        # and onto the subagent stages. The run total is unchanged either way
        # (the per-TTL-bucket sums are identical), but the by-stage / by-role /
        # per-agent split becomes TTL-correct -- e.g. discovery+plan reads as its
        # true ~24% of cost rather than being understated.
        agg_w = metrics.effective_cache_write_weight(
            agg.ephemeral_5m, agg.ephemeral_1h, self.cfg,
        )
        return metrics.weighted_cost(
            agg.input, agg.cache_write, agg.cache_read, agg.output,
            agg_w, self.cfg,
        )

    def by_stage_table(self) -> Table:
        table = Table(
            columns=[
                # kind marks whether a stage is the main driver session or a
                # workflow of subagents. The main transcript runs discovery+plan
                # itself (no subagents); every other stage is a workflow whose
                # row aggregates its spawned subagents -- so the by-role table
                # (subagents only) totals less than this table's grand total.
                Column("kind", "kind", "text", width=9),
                # input is shown first (after kind) because it is the base term
                # the weighted cost normalises to (input x1.0); without it the
                # weighted-cost column reads as if it were derived only from the
                # three columns beside it, when it also folds in input. Tiny in
                # volume, but it keeps the formula legible in the by-stage view.
                Column("input", "input (Mtok)", "mb", share=True, width=13),
                Column("cache_write", "cache write (Mtok)", "mb", share=True, width=18),
                Column("cache_read", "cache read (Mtok)", "mb", share=True, width=17),
                Column("output", "output (Mtok)", "mb", share=True, width=13),
                Column("weighted", "weighted cost (Mtok-eq)", "mb", share=True, width=23),
            ],
            label_header="stage",
            label_width=46,
        )
        # The main (driver) stage, when present, is always the first appended in
        # __init__; every later stage is a workflow of subagents.
        main_present = bool(self.session.main_transcript)
        for index, (label, agg) in enumerate(self.stage_aggs):
            kind = "main" if (main_present and index == 0) else "subagents"
            table.add(label, {
                "kind": kind,
                "input": agg.input,
                "cache_write": agg.cache_write,
                "cache_read": agg.cache_read,
                "output": agg.output,
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
            label_header="workflow · role · agent",
            label_width=58,
        )
        for wf, agent_id, role, agg in sorted(self.agent_rows, key=lambda r: -r[3].cache_read):
            label = f"{wf} · {role} · {agent_id}"
            table.add(label, {
                "turns": agg.turns,
                "startup": agg.startup,
                "cache_write": agg.cache_write,
                "cache_read": agg.cache_read,
                "output": agg.output,
            })
        return table
