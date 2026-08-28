"""Discovery of a Claude Code session-export directory.

The export the counter reads has this shape (only the parts we use):

    <export-root>/
        transcript.jsonl                    <- main driver session (discovery+plan)
        <session-id>/
            subagents/
                agent-*.jsonl               <- a BARE subagent (plain Agent tool)
                agent-*.meta.json           <- its agentType / description
                workflows/<wf>/
                    agent-*.jsonl           <- one workflow subagent transcript each
                    journal.jsonl           <- workflow journal (cross-checks)
            workflows/<wf>.json             <- agentCount / totalToolCalls
            tool-results/<name>.txt         <- offloaded tool outputs

Discovery is tolerant of the session-id level (it is a UUID that varies per
run) by locating every ``subagents`` directory under the root.

Both kinds of subagent are discovered. A subagent spawned through the plain
Agent tool has no workflow run-id directory: its transcript sits directly in
``subagents/``, and only the sibling ``agent-<id>.meta.json`` names it. Globbing
for ``subagents/workflows`` alone skipped those files entirely, so their whole
cost went missing from every total -- and worse, the same stage counted on one
side of a ``--compare`` (where it ran as a workflow) and not on the other.
"""
from __future__ import annotations

import glob
import os
from dataclasses import dataclass, field
from typing import Optional

import parsing


@dataclass
class Workflow:
    name: str
    directory: str
    agent_files: list
    journal: Optional[str]
    meta_json: Optional[str]  # top-level workflows/<name>.json
    # tool-results/ of the SAME session this workflow belongs to. Kept per
    # workflow (not once per export) so offloaded-byte lookups resolve against
    # the right session when the export root holds more than one session UUID.
    tool_results_dir: Optional[str] = None


@dataclass
class BareAgent:
    """One subagent spawned with the plain Agent tool, outside any workflow.

    It has no workflow run-id directory, so there is no ``workflows/<wf>.json``
    to reconcile it against and no ``workflowName`` to label it: the harness
    records only ``agentType`` and a free-text ``description`` in the sibling
    ``agent-<id>.meta.json``. That description is therefore the label the
    report uses, and ``agent_type`` stands in for the role (a bare agent's
    opening prompt is not written in the workflow role vocabulary, so parsing
    it yields a junk role rather than a recognised one).
    """
    path: str
    description: Optional[str] = None
    agent_type: Optional[str] = None
    # tool-results/ of the session this agent belongs to, same contract as
    # Workflow.tool_results_dir (R9).
    tool_results_dir: Optional[str] = None

    @property
    def agent_id(self) -> str:
        return os.path.basename(self.path)[len("agent-"):-len(".jsonl")]

    @property
    def label(self) -> str:
        """Stage label: the recorded description, or the agent id when absent."""
        return self.description or self.agent_id


@dataclass
class SessionExport:
    root: str
    main_transcript: Optional[str]
    session_dir: Optional[str]
    # tool-results/ of the LAST session discovered under the root. Used only to
    # resolve offloaded bytes for the main transcript, which has no session UUID
    # of its own. Single-session exports (the normal case) are exact; a multi-
    # session root is best-effort for the main stage. Each workflow carries its
    # own Workflow.tool_results_dir and is always attributed exactly (R9).
    tool_results_dir: Optional[str]
    workflows: list = field(default_factory=list)

    # Subagents that ran outside any workflow (plain Agent tool). Kept apart
    # from `workflows` because they have no run file to reconcile against --
    # they must not appear as cross-check rows -- but they ARE subagents, so
    # every cost total, the per-agent table and the `agents` headline count them.
    bare_agents: list = field(default_factory=list)

    @property
    def agent_files(self) -> list:
        files = []
        for workflow in self.workflows:
            files.extend(workflow.agent_files)
        files.extend(agent.path for agent in self.bare_agents)
        return files


def within_root(root: str, path: str) -> bool:
    """True when ``path``, fully resolved, still lives inside ``root``.

    The export directory is the trust boundary: we only ever read files that
    genuinely sit under the directory the caller named. Resolving both sides
    with ``os.path.realpath`` means a ``..`` segment or a symlink that points
    out of the export (e.g. into ``C:\\Windows`` or a home dir) is rejected
    rather than followed -- the confinement Sonar's path-injection rule asks
    for, without pinning the tool to any hard-coded root. A path on a different
    Windows drive makes ``commonpath`` raise; treat that as outside.
    """
    try:
        root = os.path.realpath(root)
        return os.path.commonpath([root, os.path.realpath(path)]) == root
    except ValueError:
        return False


def _make_workflow(wf_dir: str, name: str, session_dir: str,
                   session_results: Optional[str], root: str) -> Workflow:
    """One Workflow from its run-id directory, resolving journal + meta paths.

    Every referenced file is confined to ``root``; anything that resolves out
    of the export (symlink / ``..``) is silently dropped."""
    agents = sorted(
        f for f in glob.glob(os.path.join(wf_dir, "agent-*.jsonl"))
        if within_root(root, f)
    )
    journal = os.path.join(wf_dir, "journal.jsonl")
    journal = journal if os.path.isfile(journal) and within_root(root, journal) else None
    meta = os.path.join(session_dir, "workflows", name + ".json")
    meta = meta if os.path.isfile(meta) and within_root(root, meta) else None
    return Workflow(name, wf_dir, agents, journal, meta, session_results)


def _read_agent_meta(path: str, root: str) -> dict:
    """``agent-<id>.meta.json`` as a dict; ``{}`` when absent or unusable.

    Never raises: a missing, unparseable or non-object meta file costs the agent
    its label and role, never its cost -- the transcript is counted either way.

    This function owns only the confinement decision (the meta path is derived
    from the transcript path, so a symlink could point out of the export); the
    read and its degrade rule are ``parsing.read_json_object``, shared with the
    workflow run-record reader.
    """
    if not within_root(root, path):
        return {}
    return parsing.read_json_object(path) or {}


# A stage/role label is a table cell, not prose. `description` is free text
# written by the spawning model, so it is the one report label whose length and
# contents nothing upstream constrains; bound it here at the trust boundary
# rather than in each of the three renderers.
_MAX_LABEL_CHARS = 96


def _clean_label(value) -> Optional[str]:
    """One model-authored meta string, reduced to something safe to print.

    Anything that is not a non-empty string degrades to ``None`` so the caller
    falls back exactly as it does for a missing meta -- an ``agentType`` that
    arrives as a number must not reach the by-role table as a non-string label.
    Whitespace is flattened and non-printable characters dropped (a newline
    would break the fixed-width text renderer mid-table), and an over-long
    description is truncated rather than allowed to push every column off the
    line. Markdown's cell separator is escaped by the Markdown renderer, which
    is the layer that owns that format.
    """
    if not isinstance(value, str):
        return None
    flattened = " ".join(value.split())
    printable = "".join(ch for ch in flattened if ch.isprintable())
    if len(printable) > _MAX_LABEL_CHARS:
        # ASCII ellipsis: this label is also read on a cp1252 Windows console,
        # where _reconfigure_stdout() is only best-effort.
        printable = printable[: _MAX_LABEL_CHARS - 3].rstrip() + "..."
    return printable or None


def _bare_agents(subagents_dir: str, session_results: Optional[str], root: str) -> list:
    """Transcripts sitting directly in ``subagents/`` -- plain-Agent subagents.

    The ``agent-*.jsonl`` glob cannot pick up an ``agent-*.meta.json`` sibling
    (different extension), so this returns one entry per real transcript.
    """
    agents = []
    for path in sorted(glob.glob(os.path.join(subagents_dir, "agent-*.jsonl"))):
        if not within_root(root, path):
            continue
        meta = _read_agent_meta(path[:-len(".jsonl")] + ".meta.json", root)
        agents.append(BareAgent(
            path,
            _clean_label(meta.get("description")),
            _clean_label(meta.get("agentType")),
            session_results,
        ))
    return agents


def _session_subagents(subagents_dir: str, root: str) -> tuple[str, Optional[str], list, list]:
    """Session dir, its tool-results/ (if any), and both kinds of subagent found
    under one ``subagents`` directory. Paths that escape ``root`` are skipped."""
    session_dir = os.path.dirname(subagents_dir)
    candidate_results = os.path.join(session_dir, "tool-results")
    session_results = (
        candidate_results
        if os.path.isdir(candidate_results) and within_root(root, candidate_results)
        else None
    )
    wf_parent = os.path.join(subagents_dir, "workflows")
    workflows = []
    if os.path.isdir(wf_parent) and within_root(root, wf_parent):
        workflows = [
            _make_workflow(os.path.join(wf_parent, name), name, session_dir,
                           session_results, root)
            for name in sorted(os.listdir(wf_parent))
            if os.path.isdir(os.path.join(wf_parent, name))
        ]
    bare = _bare_agents(subagents_dir, session_results, root)
    return session_dir, session_results, workflows, bare


def discover(root: str) -> SessionExport:
    # Resolve the export directory to its real path up front and treat it as the
    # trust boundary: every file discovered below is confined to it via
    # within_root(), so a symlink or '..' inside the tree cannot make the tool
    # read outside the directory the caller named.
    root = os.path.realpath(root)
    main = os.path.join(root, "transcript.jsonl")
    main = main if os.path.isfile(main) and within_root(root, main) else None

    session_dir: Optional[str] = None
    tool_results_dir: Optional[str] = None
    workflows: list = []
    bare_agents: list = []

    # Anchored on `subagents`, not `subagents/workflows`: a session that spawned
    # only bare subagents has no `workflows` directory at all, and the narrower
    # glob made every such transcript invisible to the counter.
    subagent_dirs = sorted(
        p for p in set(
            glob.glob(os.path.join(root, "**", "subagents"), recursive=True)
        )
        if os.path.isdir(p) and within_root(root, p)
    )
    for subagents_dir in subagent_dirs:
        session_dir, session_results, wfs, bare = _session_subagents(subagents_dir, root)
        if session_results:
            tool_results_dir = session_results
        workflows.extend(wfs)
        bare_agents.extend(bare)

    return SessionExport(root, main, session_dir, tool_results_dir, workflows, bare_agents)
