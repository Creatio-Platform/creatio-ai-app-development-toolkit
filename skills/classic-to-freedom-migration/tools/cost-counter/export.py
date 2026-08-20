"""Discovery of a Claude Code session-export directory.

The export the counter reads has this shape (only the parts we use):

    <export-root>/
        transcript.jsonl                    <- main driver session (discovery+plan)
        <session-id>/
            subagents/workflows/<wf>/
                agent-*.jsonl               <- one subagent transcript each
                journal.jsonl               <- workflow journal (cross-checks)
            workflows/<wf>.json             <- agentCount / totalToolCalls
            tool-results/<name>.txt         <- offloaded tool outputs

Discovery is tolerant of the session-id level (it is a UUID that varies per
run) by locating every ``subagents/workflows`` directory under the root.
"""
from __future__ import annotations

import glob
import os
from dataclasses import dataclass, field
from typing import Optional


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

    @property
    def agent_files(self) -> list:
        files = []
        for workflow in self.workflows:
            files.extend(workflow.agent_files)
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


def _session_workflows(wf_parent: str, root: str) -> tuple[str, Optional[str], list]:
    """Session dir, its tool-results/ (if any), and every workflow under one
    ``subagents/workflows`` parent. Paths that escape ``root`` are skipped."""
    session_dir = os.path.dirname(os.path.dirname(wf_parent))
    candidate_results = os.path.join(session_dir, "tool-results")
    session_results = (
        candidate_results
        if os.path.isdir(candidate_results) and within_root(root, candidate_results)
        else None
    )
    workflows = [
        _make_workflow(os.path.join(wf_parent, name), name, session_dir, session_results, root)
        for name in sorted(os.listdir(wf_parent))
        if os.path.isdir(os.path.join(wf_parent, name))
    ]
    return session_dir, session_results, workflows


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

    wf_parents = sorted(
        p for p in set(
            glob.glob(os.path.join(root, "**", "subagents", "workflows"), recursive=True)
        )
        if within_root(root, p)
    )
    for wf_parent in wf_parents:
        session_dir, session_results, wfs = _session_workflows(wf_parent, root)
        if session_results:
            tool_results_dir = session_results
        workflows.extend(wfs)

    return SessionExport(root, main, session_dir, tool_results_dir, workflows)
