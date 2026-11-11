// The RCA agent's read-only guard for Claude Code, a PreToolUse hook of the plugin. Claude Code cannot hide an MCP
// server's tools, and its deny rules cannot say "everything but these", so this hook is the allow-list there: a call
// to rca-creatio-http or rca-files goes on only when the tool is in that server's `enabled_tools` in
// ../mcp/codex.json, the list Codex applies too. Any other tool of those two servers is denied, including one the
// hosted server adds later. Calls to every other server are left alone.
//
// Input: the hook's JSON on stdin (`tool_name`). Output: a deny decision on stdout, or nothing to let the call go on.
// Fails closed. The plugin runs this hook only for the two servers' tools (its matcher), so anything it cannot
// settle — input that is not a tool call, a list it cannot read, an error of its own — is a deny, never a pass.

import { readFileSync } from 'node:fs';

const GUARDED = ['rca-creatio-http', 'rca-files'];
// `mcp__<server>__<tool>`, or `mcp__plugin_<plugin>_<server>__<tool>` for a server a plugin declares.
const TOOL_NAME = new RegExp(`^mcp__(?:plugin_.+_)?(${GUARDED.join('|')})__(.+)$`);
// Any name that mentions a guarded server's tool: one of these that TOOL_NAME cannot read is denied, never let through.
const MENTIONS_GUARDED = new RegExp(`(?:${GUARDED.join('|')})__`);

// The server's list of read tools: an array of names, or an error.
const readAllowList = (server) => {
  const servers = JSON.parse(readFileSync(new URL('../mcp/codex.json', import.meta.url), 'utf8')).mcpServers ?? {};
  const list = servers[server]?.enabled_tools ?? [];
  if (!Array.isArray(list) || !list.every((t) => typeof t === 'string')) throw new Error('enabled_tools is not a list of names');
  return list;
};

// The reason to deny the call, or null when it may go on.
const denyReason = (toolName) => {
  if (typeof toolName !== 'string') return 'the RCA read-only guard could not read which tool is called, so the call is denied';
  const m = TOOL_NAME.exec(toolName);
  if (!m) {
    if (MENTIONS_GUARDED.test(toolName)) return `"${toolName}" names an RCA server's tool in a form the RCA read-only guard cannot read, so the call is denied`;
    return null; // another server's tool: not this guard's call
  }
  const [, server, tool] = m;
  let allowed;
  try {
    allowed = readAllowList(server);
  } catch {
    return `${server}: the RCA agent's list of read tools could not be read, so no ${server} tool may be called`;
  }
  if (allowed.includes(tool)) return null;
  return `${server}: "${tool}" is not one of the read tools the RCA agent may call (${allowed.join(', ') || 'none'}). The RCA agent is read-only.`;
};

const deny = (reason) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
}));

// An error of the hook itself would end it with a code Claude Code treats as "go on": exit code 2 blocks the call.
process.on('uncaughtException', (e) => {
  process.stderr.write(`the RCA read-only guard failed, so the call is denied: ${e?.message || e}\n`);
  process.exit(2);
});

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let toolName;
  try {
    toolName = JSON.parse(input)?.tool_name;
  } catch {
    toolName = undefined;
  }
  const reason = denyReason(toolName);
  if (reason) deny(reason);
} catch (e) {
  deny(`the RCA read-only guard failed, so the call is denied: ${e?.message || e}`);
}
