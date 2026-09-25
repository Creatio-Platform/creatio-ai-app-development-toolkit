// Host/agent/plugin identity: which host is running this hook, which coding agent that implies, and
// which version of this plugin is installed. Split out of the main hook file because none of this
// depends on marker state, the transcript, or the MCP dispatch — it is pure environment resolution,
// read once at module load and reused by dispatch (the event payload) and reminder (the routing text).
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Which host is running this hook. It changes ONLY how the routing text is handed back; the floor
// event is a side effect and therefore host-agnostic.
//   claude  - hookSpecificOutput.additionalContext
//   codex   - systemMessage (PostToolUse accepts it; note Codex hooks are off until the developer
//             sets [features].codex_hooks = true, which is their decision, not an installer's)
//   cursor  - NOTHING. afterMCPExecution is documented as informational only: it cannot reach the
//             user or the agent, so the floor is all a hook can contribute there. Cursor gets its
//             routing from the always-applied telemetry rule the installer writes instead.
//   other   - silence rather than a guessed shape: stdout a host does not understand is at best
//             ignored and at worst read as a hook failure.
export const HOST = (process.env.CAADT_TELEMETRY_HOOK_HOST || 'claude').toLowerCase();
export const CLIO = process.env.CAADT_TELEMETRY_CLIO || 'clio';
// Named once and reused everywhere this classification matters (the safety check right below, and
// the cwd-pinning decision in dispatch()), rather than repeating the same regex at each call site —
// two copies of a security-relevant test can drift if only one is ever updated (e.g. to also treat
// `.`/`..` as path-like).
export function looksLikePath(value) {
	return /[\\/]/.test(value);
}
// This hook runs automatically on every matching tool call, so the variable naming the executable is
// a repeated code-execution primitive for anything that can set it before the host launches. It is
// an install-time knob, and validating it costs nothing: a value that LOOKS like a path must resolve
// to a real file, mirroring the `is_file()` guard `runtime/scripts/mcp_client.py` applies to
// `CLIO_CMD`. A bare command name is left to PATH resolution, which is the documented default.
export const CLIO_IS_SAFE = (() => {
	if (!looksLikePath(CLIO)) {
		return true;
	}
	try {
		return fs.statSync(CLIO).isFile();
	} catch {
		return false;
	}
})();
// The host this hook is wired into IS the coding agent, so defaulting to one host's name would
// report every Codex or Cursor run as Claude Code — a cohort that never ran.
const HOST_AGENT_NAMES = {
	claude: 'Claude Code',
	codex: 'Codex',
	cursor: 'Cursor',
	copilot: 'GitHub Copilot CLI'
};
export const CODING_AGENT = process.env.CAADT_TELEMETRY_AGENT || HOST_AGENT_NAMES[HOST] || null;

function readInstalledPluginVersion() {
	// hooks/telemetry/identity.mjs -> <plugin root>/.claude-plugin/plugin.json (one dirname further up
	// than when this lived directly in hooks/telemetry-routing.mjs, because this module is one
	// directory deeper).
	const manifest = path.join(
		path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
		'.claude-plugin', 'plugin.json');
	try {
		const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
		return typeof version === 'string' && version.trim() && version !== 'unknown' ? version.trim() : null;
	} catch {
		return null;
	}
}

// Resolved from the installed manifest rather than defaulted to a placeholder: this file ships
// inside the plugin, so the manifest beside it IS the installed version. `unknown` is what the
// routing text below tells the agent never to send, and a hook that sends it while instructing
// otherwise is the instruction's own counter-example. clio accepts the field's absence.
export const PLUGIN_VERSION = process.env.CAADT_TELEMETRY_PLUGIN_VERSION || readInstalledPluginVersion();

// The identity fields are named only when they resolved. Interpolating an unresolved value would
// print `plugin_version="null"` into the instruction that exists to stop placeholders being sent.
export function identityRoutingLines() {
	const resolved = [
		...(CODING_AGENT ? [`coding_agent="${CODING_AGENT}"`] : []),
		...(PLUGIN_VERSION ? [`plugin_version="${PLUGIN_VERSION}"`] : [])
	];
	if (resolved.length === 0) {
		return [
			'  - send NO coding_agent and NO plugin_version: nothing here resolved them, and a guessed',
			'    value lands real runs in a cohort that never existed. Measured runs on ONE installation',
			'    reported five different versions, four of them invented. clio accepts their absence;'
		];
	}
	return [
		`  - send ${resolved.join(' and ')} VERBATIM, on every stage. Resolved here from the`,
		'    installation itself — do not read it from anywhere else and do not substitute a value you',
		'    inferred. Measured runs on ONE installation reported five different versions, four of them',
		'    invented. Anything not named on this line is sent NOT AT ALL rather than as a placeholder',
		'    such as `unknown`;'
	];
}
