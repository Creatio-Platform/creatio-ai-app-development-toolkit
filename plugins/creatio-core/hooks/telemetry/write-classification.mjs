// Classifying a clio MCP call: is it telemetry's own tools (never react to those), and does it
// change the environment (does it earn the once-per-write routing reminder). Split out because this
// is pure payload classification with no filesystem or process dependency of its own.

// clio's telemetry surface: reminding a session that is already sending telemetry is circular, and
// emitting a floor event in reaction to a floor event would recurse.
export const TELEMETRY_TOOLS = ['get-telemetry-consent', 'send-telemetry', 'withdraw-telemetry-consent'];

// Tools that CHANGE the environment, by verb. A list of names would go stale against a clio release
// that adds tools; the verb is the part of the naming convention that does not move.
//
// `clio-run` is deliberately NOT here: it is the generic executor, used for reads as often as writes,
// so counting it as a write would spend the write reminder on an inspection. `clio-run-destructive`
// is unambiguous and is included.
// Over-inclusion is the safe direction here and the list leans that way deliberately: a verb that is
// not really a write costs one extra reminder per session, while a missing write costs a whole run's
// telemetry. That is not hypothetical — `modify-` was absent from the first version of this list, so
// `modify-entity-schema-column`, the most ordinary write in Creatio, did not count as one.
// Stands in for an executor call whose command could not be read. Not a verb, so it can never be
// confused with one, and handled explicitly by isWriteCall.
export const UNRESOLVED_COMMAND = 'clio-run:command-unreadable';

export const WRITE_VERBS = [
	'create-', 'update-', 'modify-', 'delete-', 'remove-', 'add-', 'set-', 'install-', 'uninstall-',
	'deploy-', 'push-', 'sync-', 'link-', 'unlink-', 'upload-', 'generate-', 'compile-', 'build-',
	'apply-', 'enable-', 'disable-', 'clear-', 'restore-', 'start-', 'stop-', 'restart',
	'clio-run-destructive'
];

export function bareTool(toolName) {
	// String() rather than a cast: a host that sends a non-string tool name would otherwise throw
	// inside `includes`, and every throw on this path is swallowed — so the floor would go missing
	// for that call and nothing anywhere would say why.
	return String(toolName ?? '').split('__').pop() ?? '';
}

// The verb to judge is the one that actually runs, and on this server that is usually NOT the tool
// name: clio advertises two executors (`clio-run`, `clio-run-destructive`) plus read-only tools, and
// every mutation travels as the executor's `command` argument. Matching the tool name alone therefore
// classified a schema edit as a read — measured, with `modify-entity-schema-column` arriving inside
// `clio-run` and the write reminder never firing.
export function writeVerbSubject(payload) {
	const bare = bareTool(payload?.tool_name);
	if (bare === 'clio-run' || bare === 'clio-run-destructive') {
		// The host passes the executor's own parameters, where `command` sits at the TOP level next to
		// the command's `args` — captured from real payloads: {"command":"get-user-culture","args":{…}}.
		// The nested form is accepted too, because the tool's schema wraps parameters in `args` and both
		// shapes appear in practice; reading only the nested one classified every real write as a read.
		const command = payload?.tool_input?.command ?? payload?.tool_input?.args?.command;
		if (typeof command === 'string' && command) {
			return command;
		}
		// An executor whose command cannot be read is treated as a WRITE. `clio-run` alone is
		// read/write-ambiguous, and the two ways of being wrong are not equal: guessing read loses the
		// reminder on a real mutation, which is the case this mechanism exists for, while guessing
		// write costs at most one extra reminder in a turn that is already bounded to one.
		return UNRESOLVED_COMMAND;
	}
	return bare;
}

export function isWriteCall(payload) {
	const subject = writeVerbSubject(payload);
	return subject === UNRESOLVED_COMMAND || WRITE_VERBS.some(verb => subject.startsWith(verb));
}
