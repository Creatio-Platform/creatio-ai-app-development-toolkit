// _workflow-core/driver.mjs — the one place a generator core meets a host.
//
// Every adapter drives the same loop: pull a step from the core, negotiate it
// against the host's declared capabilities, execute its items (or stop and report
// them as pending), and feed the outcomes back in. The loop is written ONCE here
// so a second adapter cannot invent a different convention for the thing that
// matters most — how a dead or rejecting item is reported back into the core.
//
// TWO ENTRY POINTS, ONE SET OF RULES:
//   drive()   — the host can execute a work item right now (Claude Code's
//               `agent()`, or any inline executor).
//   advance() — the host cannot. Walk the core forward over the outcomes ALREADY
//               recorded and stop the moment it asks for one that is not; the
//               pending step is then the work to go and do. This is what a CLI or
//               a Codex session uses, and what makes a run resumable with no AI
//               runtime involved in the replay.
// Everything they share — the drift check, the capability gate, the replay, the
// send convention — lives in `resolveStep`/`sendFor` below, deliberately: a fix
// applied to one and not the other would be a divergence between the Claude path
// and the Codex path, which is the exact class of bug this refactor exists to
// prevent.
//
// HOW OUTCOMES REACH THE CORE (see work-item.mjs for why all three exist):
//   VALUE  →  it.next([value])
//   DEATH  →  it.next([null])            — reads exactly like `agent()` resolving null
//   ERROR  →  it.throw(err) for a SEQUENTIAL single-item step, so a `try/catch` in
//             the core still fires; inside a `parallel: true` step it becomes a null
//             hole — including a batch of ONE — because `parallel()` never rejects
//             and the core is written against that contract.

import { OUTCOME, record, reviveError } from './work-item.mjs'
import { negotiateStep, negotiateRun, CapabilityError } from './capabilities.mjs'
import { append, entriesFor, driftAt, noteHost, pendingIds } from './run-state.mjs'

// `execute(item)` must resolve `{ outcome, value?, error? }` — never throw. An
// adapter that lets an exception escape would abort the whole run on a failure
// the core is written to survive, so the driver normalises here rather than
// trusting each adapter to remember.
// `runBatch(items, execute, width)` is the OPTIONAL hook a host with its own
// concurrency primitive supplies (Claude Code's `parallel()` caps concurrency and
// draws the progress tree; bypassing it with a bare `Promise.all` would lose
// both). Omitted, the driver runs the batch itself in waves of `width`.
export async function drive({ core, run, host, execute, io, requires = [], runBatch }) {
  return loop({
    core, run, host, io, requires,
    // The ONLY difference between the two entry points: what happens when the
    // journal does not already answer the step.
    onPending: async (step, gate) => {
      const entries = await executeStep(step, gate.width, execute, runBatch)
      for (const e of entries) append(run, e)
      logNonValueOutcomes(entries, io)
      return { entries }
    },
    onDone: (result) => result,
  })
}

// Replay-only. Resolves `{ status: 'pending', step, pending }` at the first
// unrecorded item, or `{ status: 'done', result }`.
export async function advance({ core, run, host, io, requires = [] }) {
  return loop({
    core, run, host, io, requires,
    onPending: (step, gate) => {
      run.status = 'open'
      // The negotiated width is carried out so the CALLER can honour the concurrency. Dropping
      // it here meant `cli next` advertised the whole batch at once while the driver's own log
      // claimed waves of W - the payload contradicting the log is the machine-readable half, so
      // the host acted on the wrong one. It is clamped through the SAME expression the in-process
      // path uses, so a `parallel: false` step cannot be advertised as concurrent to a CLI host
      // while running strictly serially in-process.
      return {
        stop: {
          status: 'pending',
          step,
          width: effectiveWidth(step, gate.width),
          pending: pendingIds(run, step.items.map((i) => i.id)),
        },
      }
    },
    onDone: (result) => ({ status: 'done', result }),
  })
}

async function loop({ core, run, host, io, requires, onPending, onDone }) {
  if (host) {
    noteHost(run, host)
    const runGate = negotiateRun(host, requires)
    if (!runGate.ok) {
      run.status = 'stopped'
      run.stop = { reason: 'capability', missing: runGate.missing, where: 'run' }
      throw new CapabilityError(runGate.missing, `workflow ${run.workflow}`)
    }
  }

  const it = core
  let send = { type: 'next', value: undefined }
  // `replayIndex` walks the journal; anything at or past it is work this process
  // still has to do. A resumed run therefore spends nothing re-running a phase
  // whose answer is already recorded.
  let replayIndex = 0

  for (;;) {
    let res
    try {
      res = await (send.type === 'throw' ? it.throw(send.value) : it.next(send.value))
    } catch (e) {
      // The core itself stopped. A CapabilityError is a decision, not a defect;
      // both are recorded on the run so a reader sees WHY it ended.
      run.status = 'stopped'
      run.stop = { reason: e instanceof CapabilityError ? 'capability' : 'error', message: e.message, missing: e.missing || null, where: e.where || null }
      throw e
    }
    if (res.done) {
      run.status = 'done'
      run.result = res.value ?? null
      return onDone(run.result)
    }

    const step = requireWorkStep(res.value)
    const resolved = await resolveStep({ step, run, host, io, replayIndex, onPending })
    if (resolved.stop) return resolved.stop
    replayIndex += resolved.entries.length
    send = sendFor(step, resolved.entries)
  }
}

function requireWorkStep(value) {
  if (value?.kind !== 'work') throw new Error(`the core yielded something that is not a work step: ${JSON.stringify(value)?.slice(0, 200)}`)
  return value
}

// Replay, drift and the capability gate — the rules both entry points obey.
async function resolveStep({ step, run, host, io, replayIndex, onPending }) {
  const ids = step.items.map((i) => i.id)

  // A journal is only replayable against the core that wrote it: if the core's
  // decisions changed (a helper edited, a batch packed differently), the ids it
  // yields at a given point stop matching. Detected and REPORTED rather than
  // patched over — replaying a stale entry into a changed core is exactly how a
  // resumed run reports coverage it never computed.
  const drift = driftAt(run, replayIndex, ids)
  if (drift && replayIndex < run.journal.length) {
    throw new Error(
      `run journal drifted at entry ${drift.at}: the core now asks for [${drift.expected.join(', ')}] where the journal recorded [${drift.found.join(', ')}]. ` +
        'The recorded answers were produced by a different version of the workflow core, so replaying them would report decisions this run never made. Start a fresh run.',
    )
  }
  const replayed = drift ? null : entriesFor(run, ids)
  if (replayed) {
    io?.log?.(`replayed ${replayed.length} recorded outcome(s) for phase ${step.items[0].phase}`)
    return { entries: replayed }
  }

  // Checked BEFORE the work happens on either path: on the inline path so no
  // agent is spent, and on the pending path so a host is told it cannot satisfy
  // the phase before it goes off and performs it — being told afterwards is
  // worthless.
  let gate = { width: 1, reduced: false }
  if (host) {
    gate = negotiateStep(host, step.requires, step.items.length)
    if (!gate.ok) {
      run.status = 'stopped'
      run.stop = { reason: 'capability', missing: gate.missing, where: `phase ${step.items[0].phase}` }
      throw new CapabilityError(gate.missing, `phase ${step.items[0].phase}`)
    }
    if (gate.reduced) io?.log?.(`host \`${host.id}\` runs ${step.items.length} item(s) of phase ${step.items[0].phase} in waves of ${gate.width} — a reported reduction in parallelism, not in coverage`)
  }
  return onPending(step, gate)
}

function sendFor(step, entries) {
  const err = entries.find((e) => e.outcome === OUTCOME.ERROR)
  // A rejection on a SEQUENTIAL single-item step is thrown into the core so a
  // `try/catch` there fires; anything the core marked `parallel: true` collapses to
  // a null hole ON PURPOSE — that is the `parallel()` contract the cores are written
  // against, and it holds for a batch OF ONE too. Keying this on `items.length`
  // instead of `step.parallel` made a parallel batch that happened to carry one item
  // (Describe on a small surface, the repair round, Preflight with one batch) abort
  // the whole run on a rejecting agent, where the pre-migration script absorbed it
  // and still produced its honest `complete: false` verdict.
  //
  // The one place the throw path is load-bearing is `critiqueStep`
  // (behaviour-analysis/core.mjs) — a step with no `parallel` flag, so its
  // `retryOnDeath` catch still fires. There are no `parallel: false` multi-item
  // steps in either core, so this is strictly the narrower gate.
  if (!step.parallel && step.items.length === 1 && err) return { type: 'throw', value: reviveError(err.error) }
  return { type: 'next', value: entries.map((e) => (e.outcome === OUTCOME.VALUE ? e.value : null)) }
}

// The concurrency a step actually runs at: a step the core declared sequential runs one at a time
// whatever the host negotiated. One expression, read by both the in-process path and the payload
// `advance` hands a CLI host — two copies would let the two hosts disagree about a step.
export const effectiveWidth = (step, width) => (step.parallel ? Math.max(1, width) : 1)

async function executeStep(step, width, execute, runBatch) {
  const items = step.items
  const w = effectiveWidth(step, width)
  // A host that owns its own concurrency runs the whole batch through it. The
  // wave loop below is the fallback, and the ONLY caller of `Promise.all` here.
  if (runBatch && w > 1 && items.length > 1) return runBatch(items, (item) => safeExecute(item, execute), w)
  const out = []
  for (let i = 0; i < items.length; i += w) {
    const slice = items.slice(i, i + w)
    const done = await Promise.all(slice.map((item) => safeExecute(item, execute)))
    out.push(...done)
  }
  return out
}

// The ONE place a non-VALUE outcome becomes visible. `safeExecute` turns a rejection into
// an ERROR entry and `sendFor` maps it to a null hole, with nothing in between — and on the
// Claude host the journal is in-memory state that `driveOnClaude` discards when the script
// returns, so the error's name and message were gone for good. The common shape was: the
// single Describe agent rejects, `described` becomes [] after `.filter(Boolean)`, coverage
// reads 0/N, the run logs "INCOMPLETE: N of N rows still carry no card" and returns
// normally. The operator saw a coverage failure with no indication that an agent had errored
// at all, which sends the diagnosis to the prompt instead of to the host failure — precisely
// what the three-outcome protocol was introduced to make visible.
function logNonValueOutcomes(entries, io) {
  for (const e of entries) {
    if (e.outcome === OUTCOME.VALUE) continue
    const where = `item \`${e.id}\` of phase ${e.phase}`
    if (e.outcome === OUTCOME.DEATH) {
      io?.log?.(`${where} DIED — the host produced no result for it`)
      continue
    }
    const name = e.error?.name || 'Error'
    const message = e.error?.message || '(no message)'
    io?.log?.(`${where} ERRORED — ${name}: ${message}`)
  }
}

async function safeExecute(item, execute) {
  try {
    const r = await execute(item)
    if (!r?.outcome) throw new Error(`the host adapter returned no outcome for work item ${item.id}`)
    if (r.outcome === OUTCOME.VALUE) return record(item, OUTCOME.VALUE, r.value)
    if (r.outcome === OUTCOME.DEATH) return record(item, OUTCOME.DEATH)
    return record(item, OUTCOME.ERROR, r.error)
  } catch (e) {
    // An adapter that threw is a REJECTION, not a death: the distinction is the
    // whole point of the three-outcome protocol, and it is preserved even when
    // the adapter forgot to catch.
    return record(item, OUTCOME.ERROR, e)
  }
}
