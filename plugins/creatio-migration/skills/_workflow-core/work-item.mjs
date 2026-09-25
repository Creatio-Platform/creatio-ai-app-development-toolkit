// _workflow-core/work-item.mjs — the generic work-item protocol.
//
// A work item is ONE unit of agent work, described declaratively so a host that
// is not Claude Code can execute it: which phase it belongs to, which role must
// perform it, the prompt, the files it reads, the schema its answer must satisfy,
// and the access level it needs against the stand. The host executes it and hands
// back a validated result; the CORE decides what runs next. Nothing in this file
// knows about `agent()`, `parallel()` or any other vendor API.
//
// WHY A PROTOCOL AND NOT A FUNCTION CALL. The migration workflows used to call
// `agent()` directly, which made the orchestration executable on exactly one
// host. Describing the same work as DATA is what lets Claude Code, Codex and a
// plain CLI run the identical decision sequence — and what lets the suite assert
// the sequence without an AI runtime at all.

// ---------------------------------------------------------------------------
// Access levels. Per-item, not per-run: an analysis phase that is read-only says so
// here.
//
// DECLARATIVE, NOT YET NEGOTIATED — read this before relying on it. `capabilities.mjs`
// does not know about stand access: `CAPABILITIES` has no entry for it, and
// `negotiateRun`/`negotiateStep` read only the step-level `requires` array. They never
// read `item.access`, nor the per-item `item.capabilities` that `workItem()` computes
// (including the `structuredOutput` a `responseSchema` implies). On the Claude boundary
// `agentOptionsFor` maps agentType/schema/phase/label and drops `access` and
// `inputFiles`; `cli.mjs next` echoes `access` into its JSON payload for a HUMAN to
// read. So across all three adapters this is a label the boundary does not enforce.
//
// Nothing is broken today — the behaviour-analysis workflow is entirely read-only, so
// every item is `stand-read-only` and no host is asked to honour a distinction. It
// matters for what comes next: the build-side leg (`freedom-build-executor`, the
// sequential stand-write pass) is the half that will carry `ACCESS.STAND_WRITE`, and
// adding enforcement afterwards means re-opening the negotiation protocol and every
// adapter already written against it. Until it lands, the human-in-the-loop expectation
// before a risky write rests on prompt text, not on this boundary. The earlier version
// of this header claimed a host that cannot honour the distinction "is refused by
// `capabilities.mjs`"; it is not, and a declared safety property no host reads is worse
// than no declaration.
// ---------------------------------------------------------------------------
export const ACCESS = {
  NONE: 'none',                       // no stand, no filesystem writes beyond the migration folder
  STAND_READ_ONLY: 'stand-read-only', // may read Creatio; MUST NOT write
  STAND_WRITE: 'stand-write',         // may create/update pages — the sequential-write leg
}

const ACCESS_VALUES = new Set(Object.values(ACCESS))

// ---------------------------------------------------------------------------
// THE THREE OUTCOMES. This is the part a host adapter most easily gets wrong,
// and the one the Claude workflows already depended on: `retryOnDeath`
// distinguishes a NULLISH return ("terminal death — the host already exhausted
// its own retries") from a REJECTION ("the host refused, the schema threw, the
// prompt was malformed"), and reports which one happened. Collapsing them was a
// real defect (PR#88 review), so the protocol names all three states rather than
// leaving an adapter to invent a convention:
//
//   OUTCOME.VALUE — the item produced a result. Driven into the generator with
//                   `it.next([value])`.
//   OUTCOME.DEATH — the item terminally died. `it.next([null])`; the core reads
//                   the null exactly as `agent()` resolving null.
//   OUTCOME.ERROR — the attempt REJECTED. `it.throw(error)` for a single-item
//                   step, so a `try/catch` in the core still fires. A rejection
//                   inside a PARALLEL batch is reported as DEATH (a null hole),
//                   because that is what `parallel()` itself does — it never
//                   rejects — and a core written against the host contract must
//                   see the same shape on every adapter.
// ---------------------------------------------------------------------------
export const OUTCOME = { VALUE: 'value', DEATH: 'death', ERROR: 'error' }

// A step is what the core YIELDS: one or more items plus how they may be run.
// `parallel: true` means the items are independent and a host with the
// capability may run them concurrently; a host without it runs them in sequence
// and says so (that is a permitted, reported degradation — see capabilities.mjs
// for the ones that are NOT permitted).
export function step({ items, parallel = false, requires = [], note = '' }) {
  const list = Array.isArray(items) ? items : [items]
  if (!list.length) throw new Error('work step carries no items')
  // Structural, not a comment. `sendFor` throws a rejection into the core only for a
  // SEQUENTIAL SINGLE-item step; a multi-item step collapses every non-VALUE outcome to
  // a null hole, which is the `parallel()` contract the cores are written against. That
  // narrowing was justified by "there are no `parallel: false` multi-item steps in either
  // core" — true, and enforced by nothing. The first core author to yield a two-item
  // sequential step would have got silent error-swallowing on every host, with a fully
  // green suite. Refused here instead: say `parallel: true` and read the null holes.
  if (!parallel && list.length > 1) {
    throw new Error(
      `work step in phase ${list[0]?.phase} carries ${list.length} items without \`parallel: true\`. `
      + 'A multi-item step collapses every non-VALUE outcome to a null hole rather than throwing into '
      + 'the core, so declare it parallel and read the holes, or yield one item at a time.')
  }
  return { kind: 'work', items: list.map(workItem), parallel: !!parallel, requires: [...requires], note }
}

// Normalise + validate one item. Throws loudly: a malformed item is an
// orchestration bug, and a host that silently ran a prompt-less item would spend
// an agent to learn nothing.
export function workItem(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('work item must be an object')
  const { id, phase, role, prompt, promptFile, inputFiles, responseSchema, access, label, capabilities } = raw
  if (!nonBlankString(id)) throw new Error('work item needs a stable `id`')
  if (!nonBlankString(phase)) throw new Error(`work item ${id}: needs a \`phase\``)
  if (!nonBlankString(role)) throw new Error(`work item ${id}: needs a \`role\``)
  if (!nonBlankString(prompt) && !nonBlankString(promptFile)) throw new Error(`work item ${id}: needs a \`prompt\` or a \`promptFile\``)
  const acc = access || ACCESS.NONE
  if (!ACCESS_VALUES.has(acc)) throw new Error(`work item ${id}: unknown access level \`${acc}\``)
  return {
    id,
    phase,
    role,
    prompt: prompt || '',
    promptFile: promptFile || null,
    inputFiles: Array.isArray(inputFiles) ? [...inputFiles] : [],
    responseSchema: responseSchema || null,
    access: acc,
    label: label || id,
    // Capabilities THIS item needs on top of the step's. `structuredOutput` is
    // implied by a responseSchema and listed explicitly so an adapter never has
    // to infer it.
    capabilities: [...new Set([...(capabilities || []), ...(responseSchema ? ['structuredOutput'] : [])])],
  }
}

// Named `nonBlankString` rather than `nonBlank`: the generator inlines every module into ONE scope, so a short
// generic name here would silently shadow (or be shadowed by) a same-named helper in another module.
const nonBlankString = (v) => typeof v === 'string' && v.trim() !== ''

// One journal entry per executed item — the record a resumed run replays.
// `outcome` is the three-state above; `value` is present only for VALUE, and
// `error` only for ERROR. A journal that carried just the value could not
// replay a rejection, and a resumed run would take the success branch on a step
// that had failed.
export function record(item, outcome, payload) {
  if (outcome === OUTCOME.VALUE) return { id: item.id, phase: item.phase, outcome, value: payload ?? null }
  if (outcome === OUTCOME.DEATH) return { id: item.id, phase: item.phase, outcome }
  if (outcome === OUTCOME.ERROR) return { id: item.id, phase: item.phase, outcome, error: errorShape(payload) }
  throw new Error(`unknown outcome \`${outcome}\` for work item ${item.id}`)
}

// Errors do not survive JSON, so the journal keeps the two fields the core's
// failure reporting actually reads (`name`, `message`) and rebuilds an Error on
// replay. A stack is deliberately NOT kept: it differs between hosts and would
// make an otherwise identical run journal compare unequal.
export function errorShape(err) {
  if (!err) return { name: 'Error', message: 'rejected with no reason given' }
  return { name: err.name || 'Error', message: err.message || String(err) }
}

export function reviveError(shape) {
  const e = new Error(shape?.message || 'rejected with no reason given')
  e.name = shape?.name || 'Error'
  return e
}
