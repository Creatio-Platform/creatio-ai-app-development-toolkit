// _workflow-core/run-state.mjs — the durable run state, as pure data.
//
// A run is: its inputs, the host adapter that executed it, and an ORDERED
// JOURNAL of one entry per executed work item. Nothing else is persisted,
// because nothing else has to be: the core generator is deterministic (no
// wall-clock, no randomness, no filesystem reads of its own), so replaying the
// journal reproduces the run's state exactly. That is what makes an interrupted
// run resumable on a host that has no workflow runtime of its own.
//
// This file does no I/O. The CLI (`cli.mjs`) reads and writes the JSON; keeping
// the shape pure is what lets the suite exercise resume without a filesystem.

export const RUN_STATE_VERSION = 1

export function newRun({ workflow, input, host, startedAt = null }) {
  if (!workflow) throw new Error('a run must name its workflow')
  return {
    version: RUN_STATE_VERSION,
    workflow,
    input: input || {},
    // WHICH HOST ADAPTER EXECUTED THIS RUN. Recorded on the run, not inferred
    // from the environment later: a resumed run may be driven by a different
    // adapter than the one that started it, and a reader comparing two runs'
    // artifacts has to be able to see that.
    host: host || null,
    hostHistory: host ? [host] : [],
    // `startedAt` is passed IN rather than read from the clock — the core may
    // not call `Date.now()` (a resumed run must replay identically), so the
    // timestamp is the caller's, and null is a valid answer.
    startedAt,
    journal: [],
    status: 'open',       // open | done | stopped | blocked
    result: null,
    stop: null,           // { reason, missing?, where? } when status === 'stopped'
  }
}

// Note the adapter that is driving now. Idempotent for the same adapter, so a
// `next`/`submit` pair on one host does not grow the history.
export function noteHost(run, host) {
  if (!host) return run
  run.host = host
  const last = run.hostHistory[run.hostHistory.length - 1]
  if (!last || last.id !== host.id) run.hostHistory.push(host)
  return run
}

export function append(run, entry) {
  run.journal.push(entry)
  return run
}

// The entries recorded for a set of item ids, in the journal's own order.
// Returns null when ANY id is absent: a partially executed batch has to be
// finished before the core can be advanced, and a half-filled results array
// would read as "these items died".
export function entriesFor(run, ids) {
  const byId = new Map()
  for (const e of run.journal) if (!byId.has(e.id)) byId.set(e.id, e)
  const found = ids.map((id) => byId.get(id) || null)
  return found.some((e) => e === null) ? null : found
}

export function pendingIds(run, ids) {
  const have = new Set(run.journal.map((e) => e.id))
  return ids.filter((id) => !have.has(id))
}

// Journal drift. A journal is only replayable against the core that wrote it: if
// the core's decisions changed (a helper edited, a batch packed differently), the
// ids it yields at a given point stop matching. Detected and REPORTED rather than
// patched over — replaying a stale entry into a changed core is exactly how a
// resumed run reports coverage it never computed.
export function driftAt(run, index, ids) {
  const slice = run.journal.slice(index, index + ids.length).map((e) => e.id)
  const same = slice.length === ids.length && slice.every((id, i) => id === ids[i])
  return same ? null : { at: index, expected: ids, found: slice }
}

export function summary(run) {
  const byPhase = {}
  for (const e of run.journal) {
    byPhase[e.phase] = byPhase[e.phase] || { value: 0, death: 0, error: 0 }
    byPhase[e.phase][e.outcome] = (byPhase[e.phase][e.outcome] || 0) + 1
  }
  return {
    workflow: run.workflow,
    status: run.status,
    host: run.host?.id || null,
    hosts: run.hostHistory.map((h) => h.id),
    executed: run.journal.length,
    byPhase,
    stop: run.stop,
  }
}
