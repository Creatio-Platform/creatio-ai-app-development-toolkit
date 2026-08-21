#!/usr/bin/env node
// _workflow-core/cli.mjs — the resumable, host-agnostic driver.
//
//   node cli.mjs start   <run.json> --workflow <name> --input <input.json> [--host <id>] [--parallelism N] [--no-independent-roles]
//   node cli.mjs next    <run.json> [--out <dir>]      # the pending work item(s); writes prompt files
//   node cli.mjs submit  <run.json> <item-id> <result.json|-> [--death] [--error "<message>"]
//   node cli.mjs status  <run.json>
//   node cli.mjs resume  <run.json>                    # same as `next`, named for the operator
//
// WHY A CLI AT ALL. A coding agent that cannot evaluate a Claude Workflow script
// can still run a Node program, read JSON and write JSON. `next` tells it exactly
// what to do — phase, role, prompt, input files, response schema, access level —
// and `submit` feeds the answer back. Every decision between the two is the
// core's, replayed from the journal, so a run driven this way makes the same
// choices a Claude Code run would and its artifacts are comparable.
//
// The journal on disk IS the resume mechanism: kill the process at any point and
// `next` reconstructs the state from the recorded outcomes alone.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { advance } from './driver.mjs'
import { newRun, summary, append } from './run-state.mjs'
import { OUTCOME, record } from './work-item.mjs'
import { CapabilityError } from './capabilities.mjs'
import { genericHost, explainMissing } from './adapters/generic-cli.mjs'
import { codexHost } from './adapters/codex.mjs'
import * as behaviourAnalysis from './behaviour-analysis/core.mjs'
import * as buildExecutor from './build-executor/core.mjs'

// THIS FILE'S OWN LOCATION, handed to a core that has to find something shipped at a fixed offset from it — the
// build executor resolves the engine CLI and the reference docs that way. The cores may not use `import.meta`
// themselves: the generator inlines them into a workflow script the host evaluates as a function body, where it is
// a parse error. So the adapter is where it lives.
const SELF_PATH = fileURLToPath(import.meta.url)

// The workflow registry. A name here is what `start --workflow` accepts; adding a
// second workflow is adding a row, not a new CLI.
const WORKFLOWS = {
  [behaviourAnalysis.WORKFLOW]: behaviourAnalysis,
  'classic-behaviour-analysis': behaviourAnalysis,   // the short name an operator types
  [buildExecutor.WORKFLOW]: buildExecutor,
  'freedom-build-executor': buildExecutor,
}

function usage(msg) {
  const text = `${msg ? `${msg}\n\n` : ''}migration-workflow — run a Creatio migration workflow on any host

  start   <run.json> --workflow <name> --input <input.json> [host options]
  next    <run.json> [--out <dir>]
  submit  <run.json> <item-id> <result.json|-> [--death] [--error "<message>"]
  status  <run.json>
  resume  <run.json>

host options: --host <claude|codex|generic|id> --parallelism <N> --no-independent-roles --no-sub-agents

workflows: ${Object.keys(WORKFLOWS).join(', ')}`
  process.stderr.write(`${text}\n`)
  process.exit(msg ? 2 : 0)
}

function flag(argv, name) { return argv.includes(name) }
function opt(argv, name, fallback = null) {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}

// A WORK-ITEM ID IS NOT A FILENAME. Ids carry the run's own vocabulary — a page key like `child:Documents` puts a
// colon in one — and Windows refuses a colon in a path. The id stays the id (the journal replays on it); only the
// file NAME is sanitised, and it keeps the id readable so an operator can still match the two by eye.
const safeName = (id) => String(id).replace(/[^A-Za-z0-9_.@+-]+/g, '-')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8')

function hostFrom(argv) {
  const id = opt(argv, '--host', 'generic')
  const parallelism = Number(opt(argv, '--parallelism', '1')) || 1
  const independentRoles = !flag(argv, '--no-independent-roles')
  const subAgents = !flag(argv, '--no-sub-agents')
  if (id === 'codex') return codexHost({ parallelism, independentRoles, subAgents })
  return genericHost({ id, parallelism, independentRoles, subAgents })
}

function workflowOf(run) {
  const mod = WORKFLOWS[run.workflow]
  if (!mod) throw new Error(`unknown workflow \`${run.workflow}\` — known: ${Object.keys(WORKFLOWS).join(', ')}`)
  return mod
}

// A fresh core over the run's OWN input. Called on every command: the generator
// is single-use, and rebuilding it is what replays the journal deterministically.
function coreFor(run, io) {
  return workflowOf(run).run(run.input, io, { selfPath: SELF_PATH })
}

const io = { log: (m) => process.stderr.write(`  · ${m}\n`), phase: (t) => process.stderr.write(`\n[${t}]\n`) }
// `submit` and `status` REPLAY the run to find out what is pending; replaying is
// not progress, so they drive the core through a silent io rather than reprinting
// every phase the journal already contains.
const quietIo = { log: () => {}, phase: () => {} }

async function cmdStart(argv) {
  const file = argv[0]
  if (!file) usage('start needs a path for the run state file')
  const name = opt(argv, '--workflow')
  const inputFile = opt(argv, '--input')
  if (!name) usage('start needs --workflow')
  if (!inputFile) usage('start needs --input <input.json>')
  if (!WORKFLOWS[name]) usage(`unknown workflow \`${name}\``)
  if (existsSync(file)) usage(`${file} already exists — use \`next\`/\`resume\` to continue it, or delete it to start over`)
  const mod = WORKFLOWS[name]
  const input = mod.normalizeInput ? mod.normalizeInput(readJson(inputFile)) : readJson(inputFile)
  if (mod.assertInput) mod.assertInput(input, SELF_PATH)
  const run = newRun({ workflow: mod.WORKFLOW || name, input, host: hostFrom(argv), startedAt: opt(argv, '--started-at') })
  writeJson(file, run)
  process.stdout.write(`started ${run.workflow} on host \`${run.host.id}\` → ${file}\nnext: node cli.mjs next ${file}\n`)
}

async function cmdNext(argv) {
  const file = argv[0]
  if (!file) usage('next needs the run state file')
  const run = readJson(file)
  const host = argv.includes('--host') ? hostFrom(argv) : run.host
  const outDir = opt(argv, '--out')
  let res
  try {
    res = await advance({ core: coreFor(run, io), run, host, io, requires: workflowOf(run).WORKFLOW_REQUIRES })
  } catch (e) {
    writeJson(file, run)
    if (e instanceof CapabilityError) {
      process.stderr.write(`\nSTOPPED — this host cannot honour a guarantee this phase depends on:\n${explainMissing(e.missing)}\n\nNothing was executed. Re-run on a host that provides it, or declare the capability if the host does have it.\n`)
      process.exit(3)
    }
    throw e
  }
  writeJson(file, run)

  if (res.status === 'done') {
    process.stdout.write(`${JSON.stringify({ status: 'done', result: res.result }, null, 2)}\n`)
    return
  }
  const items = res.step.items.filter((i) => res.pending.includes(i.id))
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    for (const item of items) {
      writeFileSync(path.join(outDir, `${safeName(item.id)}.prompt.md`), item.prompt, 'utf8')
      if (item.responseSchema) writeJson(path.join(outDir, `${safeName(item.id)}.schema.json`), item.responseSchema)
    }
  }
  process.stdout.write(`${JSON.stringify({
    status: 'pending',
    phase: items[0].phase,
    parallel: res.step.parallel,
    note: res.step.note || null,
    // Everything a host needs to perform the item, and nothing about HOW — the
    // how is the host's business, the what is the protocol's.
    items: items.map((i) => ({
      id: i.id, phase: i.phase, role: i.role, access: i.access, label: i.label,
      inputFiles: i.inputFiles, capabilities: i.capabilities,
      promptFile: outDir ? path.join(outDir, `${safeName(i.id)}.prompt.md`) : null,
      prompt: outDir ? undefined : i.prompt,
      responseSchema: i.responseSchema,
    })),
    submit: items.map((i) => `node cli.mjs submit ${file} ${i.id} <result.json>`),
  }, null, 2)}\n`)
}

async function cmdSubmit(argv) {
  const [file, id, resultPath] = argv
  if (!file || !id) usage('submit needs the run state file and the work-item id')
  const run = readJson(file)
  // The item must be the one the core is actually WAITING for. A result submitted
  // for some other id would sit in the journal unread and the run would ask for
  // the same work again — so the id is checked against the pending step, not
  // merely appended.
  const res = await advanceOrExplain(run)
  if (res.status === 'done') usage('this run is already done — nothing to submit')
  const item = res.step.items.find((i) => i.id === id)
  if (!item) usage(`\`${id}\` is not pending. Pending now: ${res.pending.join(', ')}`)

  let entry
  if (flag(argv, '--death')) {
    entry = record(item, OUTCOME.DEATH)
  } else if (flag(argv, '--error')) {
    entry = record(item, OUTCOME.ERROR, new Error(opt(argv, '--error', 'the host reported a failure with no message')))
  } else {
    if (!resultPath) usage('submit needs a result file (or `-` for stdin), or --death / --error')
    const raw = resultPath === '-' ? readFileSync(0, 'utf8') : readFileSync(resultPath, 'utf8')
    const value = JSON.parse(raw)
    const bad = missingRequired(item.responseSchema, value)
    if (bad.length) usage(`the submitted result does not satisfy the item's responseSchema — missing required key(s): ${bad.join(', ')}`)
    entry = record(item, OUTCOME.VALUE, value)
  }
  append(run, entry)
  writeJson(file, run)
  process.stdout.write(`recorded ${entry.outcome} for ${id}\nnext: node cli.mjs next ${file}\n`)
}

// A deliberately SHALLOW schema check: the required top-level keys, nothing else.
// The point is to stop a result the core will misread (a missing `indexEntries`
// reads as a scope that described nothing), not to reimplement a JSON-schema
// validator in a file that must stay dependency-free.
function missingRequired(schema, value) {
  if (!schema || schema.type !== 'object' || !Array.isArray(schema.required)) return []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return schema.required
  return schema.required.filter((k) => value[k] === undefined)
}

// The one place a capability stop is turned into an operator-facing answer. `next` and `submit` both replay the run
// to find what is pending, so both meet the same gate; reporting it two different ways (a remedy on one, a raw
// stack and exit 1 on the other) made a REFUSED host look like a broken CLI on whichever path the operator took.
async function advanceOrExplain(run) {
  try {
    return await advance({ core: coreFor(run, quietIo), run, host: run.host, io: quietIo })
  } catch (e) {
    if (e instanceof CapabilityError) {
      process.stderr.write(`\nSTOPPED — this host cannot honour a guarantee this phase depends on:\n${explainMissing(e.missing)}\n\nNothing was executed. Re-run on a host that provides it, or declare the capability if the host does have it.\n`)
      process.exit(3)
    }
    throw e
  }
}

async function cmdStatus(argv) {
  const file = argv[0]
  if (!file) usage('status needs the run state file')
  const run = readJson(file)
  const s = summary(run)
  let pending = null
  if (run.status !== 'done') {
    try {
      const res = await advance({ core: coreFor(run, quietIo), run, host: run.host })
      pending = res.status === 'pending' ? { phase: res.step.items[0].phase, items: res.pending } : null
      if (res.status === 'done') s.status = 'done'
    } catch (e) {
      pending = { error: e.message }
    }
  }
  process.stdout.write(`${JSON.stringify({ ...s, pending, result: run.result }, null, 2)}\n`)
}

const [, , cmd, ...rest] = process.argv
const commands = { start: cmdStart, next: cmdNext, resume: cmdNext, submit: cmdSubmit, status: cmdStatus }
if (!cmd || cmd === '--help' || cmd === '-h') usage()
if (!commands[cmd]) usage(`unknown command \`${cmd}\``)
await commands[cmd](rest).catch((e) => {
  process.stderr.write(`${e?.name || 'Error'}: ${e?.message || String(e)}\n`)
  process.exit(1)
})
