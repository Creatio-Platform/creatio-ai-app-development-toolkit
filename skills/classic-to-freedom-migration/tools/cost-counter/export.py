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


def discover(root: str) -> SessionExport:
    root = os.path.abspath(root)
    main = os.path.join(root, "transcript.jsonl")
    main = main if os.path.isfile(main) else None

    session_dir: Optional[str] = None
    tool_results_dir: Optional[str] = None
    workflows: list = []

    wf_parents = sorted(
        set(glob.glob(os.path.join(root, "**", "subagents", "workflows"), recursive=True))
    )
    for wf_parent in wf_parents:
        session_dir = os.path.dirname(os.path.dirname(wf_parent))
        candidate_results = os.path.join(session_dir, "tool-results")
        session_results = candidate_results if os.path.isdir(candidate_results) else None
        if session_results:
            tool_results_dir = session_results
        for name in sorted(os.listdir(wf_parent)):
            wf_dir = os.path.join(wf_parent, name)
            if not os.path.isdir(wf_dir):
                continue
            agents = sorted(glob.glob(os.path.join(wf_dir, "agent-*.jsonl")))
            journal = os.path.join(wf_dir, "journal.jsonl")
            journal = journal if os.path.isfile(journal) else None
            meta = os.path.join(session_dir, "workflows", name + ".json")
            meta = meta if os.path.isfile(meta) else None
            workflows.append(Workflow(name, wf_dir, agents, journal, meta, session_results))

    return SessionExport(root, main, session_dir, tool_results_dir, workflows)
