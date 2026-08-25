"""Which transcripts belong to the surviving run, and which are left over.

A workflow directory accumulates transcripts across every *attempt* of a run.
Resuming replays some agents and re-runs others; killing one leaves the
interrupted agents' transcripts behind. The run file (``workflows/<wf>.json``)
is rewritten on each attempt, so it describes only the latest one -- which is
why a directory can hold 41 ``agent-*.jsonl`` files for a run whose own record
says ``agentCount: 18``.

Everything here classifies transcripts *against that record* rather than trying
to reconstruct the attempts. Two signals carry it, and the harness writes both
independently of why an agent stopped:

* membership in ``workflowProgress`` -- present means the surviving run owns
  the agent (``cached: true`` when its result was replayed rather than
  recomputed); absent means no record claims the transcript at all.
* a journal ``result`` line for the agent id -- absent means the agent produced
  nothing, whatever ended it.

Attempt boundaries are deliberately NOT reconstructed. ``promptId`` tracks the
main-session prompt chain rather than the resume (a kill-and-resume was observed
with both attempts sharing one), and every replayed ``workflowProgress`` entry
carries the *replay* timestamp rather than its original, so ``startedAt`` cannot
order attempts either. Leftover transcripts therefore stay in one bucket instead
of being split into attempts the data cannot support.

Journal outcomes are matched on ``agentId``, never on ``key``: a re-run agent
reuses the cache ``key`` of the attempt it replaces, so keying on it would
credit a killed transcript with its successor's result.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import parsing

# How the surviving run's record accounts for a transcript.
LIVE = "live"                    # in the record, ran this attempt
REPLAYED = "replayed"            # in the record, result replayed from cache
LEFTOVER = "leftover"            # no record claims it

# Run-file statuses we recognise. Anything else still counts as interrupted --
# it is simply not described more precisely than that.
COMPLETED = "completed"
KILLED = "killed"


@dataclass(frozen=True)
class RunRecord:
    """The parts of ``workflows/<wf>.json`` the counter reads.

    ``readable`` is False when the file is absent, unparseable, or valid JSON
    that is not an object (``null`` / a bare array). Callers must degrade to
    "cannot classify" in that case rather than treating an empty record as
    evidence that nothing ran -- that is also the fallback for an export whose
    shape this module does not recognise.
    """
    readable: bool = False
    agent_count: Optional[int] = None
    tool_calls: Optional[int] = None
    workflow_name: Optional[str] = None
    # ``startTime`` and ``timestamp`` stay separate: execution order keys on
    # startTime alone, while the stage label falls back to timestamp for its
    # round numbering. Merging them here would quietly change sort behaviour.
    start_time: Optional[object] = None
    timestamp: Optional[object] = None
    status: Optional[str] = None
    total_tokens: Optional[int] = None
    replayed: frozenset = frozenset()
    live: frozenset = frozenset()

    @property
    def recorded(self) -> frozenset:
        """Agent ids the surviving run's record accounts for."""
        return self.replayed | self.live


def read_run_record(path: Optional[str]) -> RunRecord:
    """Parse one run file. Never raises; unreadable input yields ``readable=False``.

    This is the single reader for ``workflows/<wf>.json``. Callers that only
    want a couple of fields go through it too, so the degrade-on-malformed-JSON
    behaviour cannot drift between them.
    """
    if not path or not os.path.isfile(path):
        return RunRecord()
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            data = json.load(handle)
    except Exception:
        return RunRecord()
    if not isinstance(data, dict):
        return RunRecord()

    replayed, live = set(), set()
    progress = data.get("workflowProgress")
    if isinstance(progress, list):
        for entry in progress:
            if not isinstance(entry, dict) or entry.get("type") != "workflow_agent":
                continue
            agent_id = entry.get("agentId")
            if not isinstance(agent_id, str) or not agent_id:
                continue
            # `cached` is written ONLY when true -- it is absent, never False,
            # on an agent that ran. `.get` is therefore the only correct test.
            (replayed if entry.get("cached") else live).add(agent_id)

    return RunRecord(
        readable=True,
        agent_count=data.get("agentCount"),
        tool_calls=data.get("totalToolCalls"),
        workflow_name=data.get("workflowName"),
        start_time=data.get("startTime"),
        timestamp=data.get("timestamp"),
        status=data.get("status"),
        total_tokens=data.get("totalTokens"),
        replayed=frozenset(replayed),
        live=frozenset(live),
    )


def produced_result_ids(journal_path: Optional[str]) -> Optional[frozenset]:
    """Agent ids the journal records a ``result`` for, or None if unreadable.

    None means "cannot tell", which is not the same as the empty set ("nothing
    produced a result") -- an export without a journal must not have every
    transcript reported as wasted spend.
    """
    if not journal_path or not os.path.isfile(journal_path):
        return None
    produced = set()
    for obj in parsing.iter_jsonl(journal_path):
        if obj.get("type") != "result":
            continue
        agent_id = obj.get("agentId")
        if isinstance(agent_id, str) and agent_id:
            produced.add(agent_id)
    return frozenset(produced)


def agent_id_of(agent_file: str) -> str:
    """``.../agent-a1b2c3.jsonl`` -> ``a1b2c3``."""
    base = os.path.basename(agent_file)
    if base.startswith("agent-"):
        base = base[len("agent-"):]
    if base.endswith(".jsonl"):
        base = base[: -len(".jsonl")]
    return base


@dataclass
class Attribution:
    """Per-workflow classification of every discovered transcript."""
    # agent file path -> LIVE / REPLAYED / LEFTOVER
    classes: dict = field(default_factory=dict)
    # agent file paths whose agent has no journal `result` (produced nothing).
    # Empty when the journal could not be read -- see `outcomes_known`.
    produced_nothing: frozenset = frozenset()
    outcomes_known: bool = False
    # False when the run file could not be read: `classes` is then empty and
    # callers must fall back to reporting the total only.
    classified: bool = False
    interrupted: bool = False
    status: Optional[str] = None
    agent_count: Optional[int] = None
    # How many distinct agent ids ``workflowProgress`` actually lists. Kept
    # apart from ``agent_count`` (the run file's own claim) so the two can be
    # compared: a record claiming 18 agents while listing 15 entries is
    # internally inconsistent, and no leftover bucket explains that.
    recorded_count: int = 0
    total_tokens: Optional[int] = None

    @property
    def record_consistent(self) -> bool:
        """True when the record lists as many agents as it claims to have run.

        A run file with no ``agentCount`` makes no claim to contradict, so it
        cannot be inconsistent -- only unverifiable.
        """
        return self.agent_count is None or self.agent_count == self.recorded_count

    def files(self, kind: str) -> list:
        return sorted(path for path, cls in self.classes.items() if cls == kind)

    @property
    def how(self) -> str:
        """How the run ended, as far as the run file says.

        Only the literal ``killed`` status reports a kill. Any other unfamiliar
        status -- an export captured while the workflow was still running, say --
        reports the neutral ``interrupted`` rather than claiming a kill that may
        never have happened.

        A killed run that is later resumed reports ``completed`` again, so this
        reads ``resumed`` for it, which is accurate: by then the export holds a
        finished run that happens to carry leftovers.
        """
        if self.status == KILLED:
            return KILLED
        if self.status and self.status != COMPLETED:
            return "interrupted"
        return "resumed"

    @property
    def counts(self) -> dict:
        out = {LIVE: 0, REPLAYED: 0, LEFTOVER: 0}
        for cls in self.classes.values():
            out[cls] += 1
        return out


def attribute(agent_files, record: RunRecord,
              produced: Optional[frozenset]) -> Attribution:
    """Classify ``agent_files`` against one run's record and journal.

    A run counts as interrupted when the directory holds more transcripts than
    the record accounts for, or when the run file's ``status`` is anything other
    than ``completed`` (a killed run reports ``killed``, and its agents sit in
    the record with ``state: progress``). A resume that replayed *everything*
    trips neither test and does not need to: it writes no new transcript, so the
    plain sum is already right for it.
    """
    if not record.readable:
        return Attribution()

    classes = {}
    for path in agent_files:
        agent_id = agent_id_of(path)
        if agent_id in record.replayed:
            classes[path] = REPLAYED
        elif agent_id in record.live:
            classes[path] = LIVE
        else:
            classes[path] = LEFTOVER

    nothing = frozenset()
    if produced is not None:
        nothing = frozenset(p for p in agent_files if agent_id_of(p) not in produced)

    expected = record.agent_count if isinstance(record.agent_count, int) else len(record.recorded)
    interrupted = (
        len(agent_files) > expected
        or (record.status is not None and record.status != COMPLETED)
    )

    return Attribution(
        classes=classes,
        produced_nothing=nothing,
        outcomes_known=produced is not None,
        classified=True,
        interrupted=interrupted,
        status=record.status,
        agent_count=record.agent_count,
        recorded_count=len(record.recorded),
        total_tokens=record.total_tokens,
    )
