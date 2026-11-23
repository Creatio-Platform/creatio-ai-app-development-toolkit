#!/usr/bin/env node
// UserPromptSubmit hook for Claude Code: once a conversation has run the RCA agent, every later message gets one line
// of context that sends it back to the `rca-orchestration` skill. The skill decides how much of the investigation the
// message needs; this hook decides nothing. Without it the model treats a skill it already ran as loaded, answers a new
// symptom from memory and never re-enters the investigation loop.
//
// It stays silent until the transcript shows the RCA agent at work, so a conversation that never used it gets nothing.
// It is a hint, never a gate: it never blocks the prompt and always exits 0. An error of its own goes to stderr, which
// Claude Code shows in its debug output, so "the hook broke" can be told apart from "this conversation never used RCA".
//
// Cost: UserPromptSubmit takes no matcher, so the hook runs on every message of every conversation of the plugin. A
// conversation that used the agent stops at the first sign of it; one that never did is read to the end, searched for
// the bytes `rca-` without decoding, and only the lines that hold them are parsed. Measured: about 50 ms to start node,
// plus about 20 ms for a 50 MB transcript.

import { openSync, readSync, closeSync, writeSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONTEXT = 'This conversation has already investigated a connected Creatio environment with the RCA agent. '
  + 'If this message asks about that environment or an incident, invoke the `rca-orchestration` skill again before '
  + 'anything else and follow its "Follow-up turns" section: it decides at which step of the investigation this message '
  + 'enters.';

// The RCA agent's MCP servers, under every name a host gives them: `mcp__<server>__<tool>`, or
// `mcp__plugin_<plugin>_<server>__<tool>` for a server a plugin declares.
const RCA_SERVERS = ['rca-creatio-gateway', 'rca-creatio-http', 'rca-files'];
export const RCA_TOOL = new RegExp(`^mcp__(?:plugin_.+_)?(?:${RCA_SERVERS.join('|')})__.+$`);
const ENTRY_SKILL = /^(?:[\w-]+:)?rca-orchestration$/;
// A slash command, as the transcript records the user's message: `<command-message>` then `<command-name>`.
const SLASH_COMMAND = /^\s*<command-(?:message|name)>\/?(?:[\w-]+:)?rca-orchestration<\/command-(?:message|name)>/;

// Every line that shows the agent at work holds these bytes; a line without them is not parsed.
const NEEDLE = Buffer.from('rca-');
const CHUNK = 1 << 20;

// Whether one transcript entry shows the RCA agent at work. Only an action counts: the skill listing, the MCP servers'
// instructions and the project's own notes name `rca-orchestration` too, in every conversation, and a tool's output can
// quote anything. So the entry is read by its fields, never by its text.
export function showsRca(entry) {
  const content = entry?.message?.content;
  if (entry?.type === 'assistant' && Array.isArray(content)) {
    return content.some((part) => part?.type === 'tool_use' && (
      (part.name === 'Skill' && ENTRY_SKILL.test(String(part.input?.skill ?? part.input?.command ?? '')))
      || RCA_TOOL.test(String(part.name ?? ''))));
  }
  if (entry?.type === 'user') {
    if (typeof content === 'string') return SLASH_COMMAND.test(content);
    if (Array.isArray(content)) return content.some((part) => part?.type === 'text' && SLASH_COMMAND.test(String(part.text ?? '')));
  }
  return false;
}

// Whether any complete line of `buf` shows the agent at work. A line is cut at `\n` bytes, which never occur inside a
// multi-byte UTF-8 character, so no character is split.
function anyLineShowsRca(buf) {
  for (let at = buf.indexOf(NEEDLE); at !== -1;) {
    const start = buf.lastIndexOf(0x0a, at) + 1;
    let stop = buf.indexOf(0x0a, at);
    if (stop === -1) stop = buf.length;
    let entry;
    try { entry = JSON.parse(buf.toString('utf8', start, stop)); } catch { entry = undefined; }
    if (showsRca(entry)) return true;
    at = buf.indexOf(NEEDLE, stop);
  }
  return false;
}

// Whether the transcript shows the RCA agent at work. Read in chunks and stopped at the first sign of it; a line cut by
// the end of a chunk is carried over whole into the next one.
export function usedRca(transcriptPath) {
  const fd = openSync(transcriptPath, 'r');
  try {
    const chunk = Buffer.alloc(CHUNK);
    let rest = Buffer.alloc(0);
    for (;;) {
      const n = readSync(fd, chunk, 0, CHUNK, null);
      const data = n > 0 ? Buffer.concat([rest, chunk.subarray(0, n)]) : rest;
      const end = n > 0 ? data.lastIndexOf(0x0a) + 1 : data.length; // whole lines only, until the file ends
      if (anyLineShowsRca(data.subarray(0, end))) return true;
      if (n <= 0) return false;
      rest = Buffer.from(data.subarray(end));
    }
  } finally {
    closeSync(fd);
  }
}

// Returns the text to print, or '' to print nothing.
export function hookOutput(input) {
  const path = input && typeof input === 'object' ? input.transcript_path : undefined;
  if (typeof path !== 'string' || !path || !usedRca(path)) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: CONTEXT } });
}

async function main() {
  try {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const part of process.stdin) input += part;
    const out = hookOutput(JSON.parse(input));
    // writeSync, not process.stdout.write: a buffered write can be cut off by the exit below.
    if (out) writeSync(1, out);
  } catch (e) {
    // never fail the prompt on an error of this hook, but leave a trace of it
    process.stderr.write(`rca-follow-up hook: ${e?.message || e}\n`);
  }
  process.exit(0);
}

const invokedDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) await main();
