---
name: analyze-adac-logs
description: Analyze exported ADAC session logs and related summary files to produce verified timing, tool-call counts, timeline milestones, incidents, bottlenecks, factual mismatches, and a remediation plan. Use when the user asks to inspect an ADAC or Copilot-style session transcript, “show session stats”, “compare this report with the raw log”, “find discrepancies”, “summarize timing and problems”, validate whether a written analysis matches the source log, or fix session errors in ADAC and CLIO with CLIO MCP treated as the source of truth.
---

# Analyze ADAC Logs

Treat the raw session log as the source of truth. Use generated summaries, notes, or reports only as claims to verify against that log.

For this repository, the canonical skill copy lives at `.agents/skills/analyze-adac-logs/`. Keep any home-directory Codex copy only as a temporary compatibility mirror.

## Quick start

Set the repo-local skill path once:

```bash
export ADAC_LOG_SKILL="$(git rev-parse --show-toplevel)/.agents/skills/analyze-adac-logs"
```

Run the helper script on the raw log first:

```bash
python3 "$ADAC_LOG_SKILL/scripts/analyze_session_log.py" /absolute/path/to/session-log.md
python3 "$ADAC_LOG_SKILL/scripts/analyze_session_log.py" /absolute/path/to/session-log.md --format text
```

This gives you the mechanical baseline for:

- session metadata
- timed event counts
- tool-call counts by tool type
- reasoning and Copilot message counts
- executed tool titles
- incident signals counted by event block, not by raw string frequency

## Workflow

1. Identify the artifacts.

- Raw log: usually exported markdown with repeated blocks like `<sub>⏱️ ...</sub>` and `### ...`
- Optional comparison target: a `.txt` or `.md` analysis that claims counts, timings, or conclusions

2. Build the machine baseline.

- Run the helper script on the raw log before doing manual interpretation.
- Use the script output to anchor objective counts.
- If the log is small and no comparison file exists, the script plus one manual pass may be enough.

3. Use sub-agents by default for quality and speed when possible.

- For logs over roughly 500 lines, always fan out work in parallel.
- For any “compare this report with the raw log” request, always fan out work in parallel.
- Parallelize only independent analysis tracks. Do not split stateful edits, one shared output file, or sequential remediation steps across agents.
- Keep sub-agent prompts independent. Pass file paths and the task only. Do not pass your conclusions.
- Reuse the current model by default. Do not intentionally downgrade sub-agents unless the task is trivial and speed matters more than depth.

4. Synthesize from evidence.

- Prefer raw log evidence over any generated report.
- Resolve disagreements in favor of event-block evidence and direct command output.
- Cite exact timestamps and file lines for disputed claims.

5. Return a compact verified report.

- Stats
- Timeline
- Problems
- Mismatches versus the candidate report, if one was provided
- Assumptions or confidence notes only when needed

6. If the user wants remediation, switch to the remediation workflow.

- Read [remediation-workflow.md](references/remediation-workflow.md) before proposing fixes.
- Treat `clio MCP` and the CLIO-side contract as the source of truth.
- Prefer removing brittle ADAC assumptions and fixing the behavior in CLIO when the issue is really about tool contract, response shape, examples, or canonical workflow.
- Only keep a fix in ADAC when the issue is truly local to ADAC UX, parsing, orchestration, or presentation.

## Sub-agent plan

When sub-agents are available, use up to three concurrent agents by default. Agents A-C cover the normal analysis flow. Agents D-E are optional roles for remediation work and should be launched only when that extra split is useful.

### Agent A: stats and timeline

Ask for:

- authoritative counts
- major milestones
- phase boundaries
- longest phase

Suggested prompt:

```text
Use $analyze-adac-logs at /absolute/path/to/repo/.agents/skills/analyze-adac-logs to reconstruct the authoritative statistics and timeline from /absolute/path/to/session-log.md. Use the raw log only. Report exact timestamps, event titles, and phase durations.
```

### Agent B: incidents and root causes

Ask for:

- unique failure events
- repeats versus duplicates
- root cause grouping
- recovery path after each incident

Suggested prompt:

```text
Use $analyze-adac-logs at /absolute/path/to/repo/.agents/skills/analyze-adac-logs to enumerate unique incidents in /absolute/path/to/session-log.md. Count incidents by event block, not by raw string frequency. Distinguish real runtime failures from repeated stack-trace text or contract examples.
```

### Agent C: report verification

Use this only when a candidate summary exists.

Ask for:

- factual mismatches
- missing context
- overclaims
- time shifts

Suggested prompt:

```text
Use $analyze-adac-logs at /absolute/path/to/repo/.agents/skills/analyze-adac-logs to compare /absolute/path/to/session-log.md against /absolute/path/to/report.txt. List only factual mismatches, each backed by direct evidence from the raw log.
```

### Agent D: remediation ownership split

Use this when the user wants fixes after analysis.

Ask for:

- whether each issue belongs to CLIO, ADAC, or both
- why CLIO should own the fix when contract truth is involved
- what can be removed from ADAC after a CLIO-side correction

Suggested prompt:

```text
Use $analyze-adac-logs at /absolute/path/to/repo/.agents/skills/analyze-adac-logs to review the confirmed incidents from /absolute/path/to/session-log.md and assign remediation ownership between CLIO and ADAC. Treat CLIO MCP as the source of truth. Prefer CLIO fixes when the issue concerns tool contracts, examples, canonical flows, or response semantics.
```

### Agent E: test impact and verification

Use this when code changes are expected.

Ask for:

- affected test surface
- minimal validation matrix
- likely regressions

Suggested prompt:

```text
Use $analyze-adac-logs at /absolute/path/to/repo/.agents/skills/analyze-adac-logs to derive the test and verification plan for the confirmed incidents from /absolute/path/to/session-log.md. Focus on the smallest set of checks that proves the CLIO-first remediation works and does not reintroduce ADAC-specific workarounds.
```

## Counting rules

Read [analysis-rules.md](references/analysis-rules.md) before writing the final answer when the task involves discrepancies, error counting, or timing disputes.

Apply these rules every time:

- Count tool calls from executed tool blocks such as `### ✅ \`bash\`` or `### ✅ \`view\``, not from all timed events.
- Count incidents by event block, not by every repeated occurrence of the same error string.
- Do not turn reasoning about a possible next step into an executed action.
- Distinguish “script created” from “script executed”.
- Treat helper-contract dumps and embedded examples as context, not runtime incidents, unless they appeared inside a failed execution event.

If the user wants fixes, also read [remediation-workflow.md](references/remediation-workflow.md).

## Recommended local commands

Use fast local inspection before or alongside sub-agents:

```bash
wc -l /absolute/path/to/session-log.md
rg -n "^### |^<sub>⏱️ |Parameter validation failed|JSONDecodeError|body is required|cliogate|Unknown parameter" /absolute/path/to/session-log.md
nl -ba /absolute/path/to/session-log.md | sed -n 'start,endp'
```

When a comparison file is present:

```bash
wc -l /absolute/path/to/report.txt
nl -ba /absolute/path/to/report.txt | sed -n '1,220p'
```

## Output contract

Prefer this structure unless the user asks for a different one:

### Stats

- session start
- duration
- tool calls
- reasoning blocks
- Copilot messages

### Timeline

- major milestones with timestamps
- phase durations when they are defensible from the log

### Problems

- unique incidents
- recovery or fix
- bottlenecks

### Mismatches

- only when comparing against another file
- each mismatch should say what the report claimed, what the raw log shows, and where

### Remediation plan

- root cause per confirmed incident
- owner: CLIO, ADAC, or both
- why CLIO is the preferred fix location when applicable
- changes to remove from ADAC if CLIO becomes authoritative
- verification steps
- open blocker: missing CLIO source path, if not yet confirmed

## Guardrails

- Never trust a secondary report over the raw log.
- Never inflate counts from grep alone.
- Never claim an action happened if it only appeared in reasoning text.
- When uncertain about a timing boundary, say it is approximate.
- When two files disagree, quote the disagreement briefly and point to exact evidence.
- Before planning or making fixes in CLIO, explicitly confirm the user's path to the CLIO source code.
- Before changing CLIO, update the local CLIO checkout to the latest state for the current branch. If the user is on a feature branch, bring it up to date with the latest `main` before coding.
- Before pushing or opening a PR, ask whether the user wants you to push now or prefers to test locally first.
