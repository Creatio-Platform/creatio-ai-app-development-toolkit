# Analysis Rules

Use these rules whenever you analyze exported ADAC session logs or compare a written report against a raw session log.

## Source of truth

- Raw session log wins over every summary, note, or follow-up report.
- Executed command output wins over reasoning text.
- Timed event blocks win over freeform counts inferred from grep.

## What counts as a tool call

- Count executed tool blocks such as `### ✅ \`bash\`` and `### ✅ \`view\``.
- Do not count `💭 Reasoning`, `💬 Copilot`, or `ℹ️ Notification` as tool calls.
- Do not count “planned” tools mentioned in reasoning.

## What counts as an incident

- Count incidents by event block.
- If the same error string appears multiple times inside one failed block, count it once for that incident.
- If grep finds the same phrase in stack traces, embedded code, or contract examples, do not count those as separate runtime incidents.

## Timing rules

- Use exact timestamps when the log gives a single event time.
- Use approximate ranges only when summarizing a phase that spans multiple events.
- Distinguish “created script” from “executed script”.
- Distinguish “looked up contract” from “retried failed tool”.

## Comparison rules

- Verify every disputed claim against the raw log before accepting it.
- When a report compresses multiple failures into one bucket, say so explicitly.
- When a report invents an action that was only discussed in reasoning, mark it as unsupported.
- When a report shifts timestamps, cite the exact raw-log timestamp that contradicts it.

## Useful prompts for sub-agents

- Timeline: reconstruct milestones and phase durations from the raw log only.
- Incidents: enumerate unique failures and recoveries, counted by event block.
- Comparison: compare the raw log to a summary file and list factual mismatches only.
