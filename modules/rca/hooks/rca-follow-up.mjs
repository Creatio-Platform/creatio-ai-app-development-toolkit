#!/usr/bin/env node
// UserPromptSubmit hook for Claude Code: once a conversation has run the RCA agent, every later message gets one line
// of context that sends it back to the `rca-orchestration` skill. The skill decides how much of the investigation the
// message needs; this hook decides nothing. Without it the model treats a skill it already ran as loaded, answers a new
// symptom from memory and never re-enters the investigation loop.
//
// It stays silent until the transcript shows the RCA agent at work, so a conversation that never used it gets nothing.
// It is a hint, never a gate: it never blocks the prompt, prints nothing on any error of its own, and always exits 0.

import { openSync, readSync, closeSync, writeSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONTEXT = 'This conversation has already investigated a connected Creatio environment with the RCA agent. '
  + 'If this message asks about that environment or an incident, invoke the `rca-orchestration` skill again before '
  + 'anything else and follow its "Follow-up turns" section: it decides at which step of the investigation this message '
  + 'enters.';

// What shows the RCA agent at work, as the transcript records it. Only an action counts: the skill listing, the MCP
// servers' instructions and the project's own notes name `rca-orchestration` too, in every conversation. Each marker
// starts with unescaped quotes, so the same text quoted inside a string (a tool's output, say) does not match.
export const MARKERS = Object.freeze([
  /"name":"Skill","input":\{"skill":"(?:[\w-]+:)?rca-orchestration"/,          // the Skill tool, any plugin prefix
  /"role":"user","content":"<command-message>\/?(?:[\w-]+:)?rca-orchestration<\/command-message>/, // a slash command
  /"type":"tool_use","id":"[^"]*","name":"mcp__[^"]*?rca-[a-z0-9-]+__[a-z0-9_-]+"/, // a call to one of the RCA servers
]);

const CHUNK = 1 << 20;
const OVERLAP = 1024; // longer than any marker, so a marker split between two chunks is still found

// Whether the transcript shows the RCA agent at work. Read in chunks and stopped at the first marker: in a conversation
// that used the agent the marker comes early, and only one that never did is read to the end.
export function usedRca(transcriptPath) {
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(CHUNK);
    let carry = '';
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) return false;
      const text = carry + buf.toString('utf8', 0, n);
      if (MARKERS.some((rx) => rx.test(text))) return true;
      carry = text.slice(-OVERLAP);
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Returns the text to print, or '' to print nothing.
export function hookOutput(input) {
  const path = input && typeof input === 'object' ? input.transcript_path : undefined;
  if (typeof path !== 'string' || !path || !usedRca(path)) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: CONTEXT } });
}

function main() {
  try {
    const out = hookOutput(JSON.parse(readFileSync(0, 'utf8')));
    // writeSync, not process.stdout.write: a buffered write can be cut off by the exit below.
    if (out) writeSync(1, out);
  } catch {
    // never fail the prompt on an error of this hook
  }
  process.exit(0);
}

const invokedDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) main();
