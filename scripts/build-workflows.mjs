#!/usr/bin/env node
// scripts/build-workflows.mjs — generate the shipped Claude `.workflow.js` files
// from the host-neutral workflow core.
//
//   node scripts/build-workflows.mjs            # write the generated files
//   node scripts/build-workflows.mjs --check    # exit 1 if a shipped file drifted
//
// WHY A GENERATOR. A Claude Workflow script is evaluated as a function body with
// only `args`, `log`, `phase`, `agent` and `parallel` injected — it cannot
// `import`. So the only way for Claude Code and Codex to run the SAME
// orchestration is to keep one core in real modules and inline it into the
// shipped script. This program is that inlining, and `--check` is the gate that
// stops the two from diverging: an edit to the shipped file alone fails CI, and
// an edit to the core that was not re-generated fails it too.
//
// The inlined block is emitted between the file's `---8<--- PURE DECISION
// HELPERS ---8<---` sentinels, so the offline suite that slices that block out of
// the SHIPPED artifact and imports it keeps testing what actually ships.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORE = path.join(ROOT, 'skills', '_workflow-core')

const BEGIN = '// ---8<--- PURE DECISION HELPERS ---8<---'
const END = '// ---8<--- END PURE DECISION HELPERS ---8<---'
const PLACEHOLDER = '/*@INLINE@*/'

// One entry per shipped workflow. `modules` is a DEPENDENCY ORDER, declared
// rather than derived: a topological sort over `import` lines would be more
// clever and less auditable, and the list is short enough that a reviewer can
// check it by eye.
const TARGETS = [
  {
    name: 'creatio-classic-behaviour-analysis',
    template: 'behaviour-analysis/claude-template.js',
    out: 'skills/classic-to-freedom-migration/classic-behaviour-analysis.workflow.js',
    modules: [
      'work-item.mjs',
      'capabilities.mjs',
      'run-state.mjs',
      'driver.mjs',
      'behaviour-analysis/helpers.mjs',
      'behaviour-analysis/schemas.mjs',
      'behaviour-analysis/prompts.mjs',
      'behaviour-analysis/core.mjs',
      'adapters/claude-workflow.mjs',
    ],
    // The phase titles `meta.phases` advertises. Checked against the `phase(...)`
    // calls the core actually makes: a title that drifts detaches the host's
    // progress display from the run without failing anything else.
    phases: ['Context', 'Describe', 'Critique', 'Merge'],
  },
]

// Drop `import` statements (single- and multi-line) and turn `export X` into `X`.
// Nothing else is rewritten: the inlined text is the module's own source, so a
// reviewer diffing the generated file against the core sees only these removals.
// Is this line an `import` (single- or multi-line) or a RE-EXPORT? Both are dropped: the inlined modules share one
// scope, so every name is already in it. Split out so `inlineOne` stays a loop over lines.
const isImportStart = (line) => /^import\s/.test(line)
// Both quote styles, an optional trailing semicolon, and an optional trailing line comment. The
// previous single-quote-only shape failed OPEN: a `from "./y.mjs"` line left `skipping` armed and
// every following line was discarded until something else happened to end with `from '...'`, so an
// arbitrary span of the module vanished from the generated artifact with no error - and `--check`
// could not catch it, because it compares two outputs of the same broken transform.
const endsImport = (line) => {
  const trimmed = line.trim().replace(/\s*(?:\/\/.*)?$/, '').replace(/;$/, '')
  return /from\s+(['"])[^'"]+\1$/.test(trimmed) || /^\}\s+from\s+(['"])[^'"]+\1$/.test(trimmed)
}
// A re-export has nothing to inline. Stripping `export ` off one left a bare `{ a, b }` — a block of expression
// statements that does nothing and reads like a mistake, which is what it was. Two questions, asked separately,
// because one regex with an optional trailing group next to `\s*$` backtracks super-linearly.
function isReExport(line) {
  const trimmed = line.trim()
  if (!/^export\s*\{/.test(trimmed)) return false
  return trimmed.endsWith('}') || /\}\s*from\s+'[^']+'$/.test(trimmed)
}

function inlineOne(rel) {
  const src = readFileSync(path.join(CORE, rel), 'utf8')
  const out = []
  let skipping = false
  let importStartLine = 0
  const lines = src.split('\n')
  for (const [i, line] of lines.entries()) {
    if (skipping) {
      if (endsImport(line)) {
        skipping = false
        continue
      }
      // A multi-line import that runs into a top-level declaration means endsImport did not
      // recognise its specifier. Fail CLOSED here: consuming to EOF would delete the rest of the
      // module from a generated, Sonar-excluded, un-line-reviewed artifact - the worst failure
      // mode available to this tool.
      if (/^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s/.test(line)) {
        throw new Error(
          `${rel}: unterminated import starting at line ${importStartLine + 1} ` +
            `(${lines[importStartLine].trim()}) - reached a top-level declaration at line ${i + 1}. ` +
            'endsImport does not recognise that specifier form; fix the pattern rather than the source.',
        )
      }
      continue
    }
    if (isImportStart(line)) {
      // A single-line import ends on this line; a braced one continues.
      if (!endsImport(line)) {
        skipping = true
        importStartLine = i
      }
      continue
    }
    if (isReExport(line)) continue
    out.push(line.replace(/^export\s+(default\s+)?/, ''))
  }
  if (skipping) {
    throw new Error(
      `${rel}: unterminated import starting at line ${importStartLine + 1} ` +
        `(${lines[importStartLine].trim()}) - reached end of file.`,
    )
  }
  // The blank-line collapse is deliberately NOT applied: it rewrote module text blindly, so two
  // blank lines inside a prompt template literal would have made the Claude host and the CLI host
  // send different bytes while each suite still passed against its own artifact. The generated
  // file is not hand-read, so the cosmetic gain was not worth that.
  return `// ===== inlined from _workflow-core/${rel} =====\n${out.join('\n').trim()}\n`
}

// Top-level identifier collisions would silently shadow one another once the
// modules share a scope, so they are a hard error rather than a warning.
function topLevelNames(text) {
  const names = []
  const re = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm
  for (const m of text.matchAll(re)) names.push(m[1])
  return names
}

function build(target) {
  const template = readFileSync(path.join(CORE, target.template), 'utf8')
  if (!template.includes(PLACEHOLDER)) throw new Error(`${target.template}: no ${PLACEHOLDER} placeholder`)
  if (!template.includes(BEGIN) || !template.includes(END)) throw new Error(`${target.template}: the pure-helper sentinels are missing — the offline suite slices the shipped file on them`)

  const parts = target.modules.map(inlineOne)
  const inlined = parts.join('\n')

  const seen = new Map()
  for (let i = 0; i < parts.length; i++) {
    for (const n of topLevelNames(parts[i])) {
      if (seen.has(n)) throw new Error(`top-level name \`${n}\` is declared by both ${seen.get(n)} and ${target.modules[i]} — one would shadow the other in the generated single-file scope`)
      seen.set(n, target.modules[i])
    }
  }

  const text = template.replace(PLACEHOLDER, inlined.trim())

  // meta.phases ↔ the phases the core emits. Both directions: an advertised phase
  // the core never enters draws an empty progress group, and a phase the core
  // enters that meta omits gets no group at all.
  const emitted = [...text.matchAll(/\bphase\('([^']+)'\)/g)].map((m) => m[1])
  const missing = target.phases.filter((p) => !emitted.includes(p))
  const extra = [...new Set(emitted)].filter((p) => !target.phases.includes(p))
  if (missing.length || extra.length) {
    throw new Error(`${target.out}: meta.phases and the core's phase() calls disagree — advertised-but-never-entered: [${missing.join(', ')}], entered-but-not-advertised: [${extra.join(', ')}]`)
  }

  return text
}

const check = process.argv.includes('--check')
let failed = 0
for (const target of TARGETS) {
  const outPath = path.join(ROOT, target.out)
  const next = build(target)
  const current = safeRead(outPath)
  if (check) {
    if (current !== next) {
      failed++
      process.stderr.write(`❌ ${target.out} is out of sync with skills/_workflow-core/ — run \`node scripts/build-workflows.mjs\`\n`)
      process.stderr.write(`   ${firstDifference(current, next)}\n`)
    } else {
      process.stdout.write(`✅ ${target.out} matches the core\n`)
    }
  } else {
    writeFileSync(outPath, next, 'utf8')
    process.stdout.write(`${current === next ? '=' : '→'} ${target.out} (${next.split('\n').length} lines)\n`)
  }
}
process.exit(failed ? 1 : 0)

function safeRead(p) {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

// The line number and both texts at the first divergence — a bare "they differ"
// on a 2000-line generated file tells a reader nothing actionable.
function firstDifference(a, b) {
  if (a === null) return 'the shipped file does not exist yet'
  const la = a.split('\n'), lb = b.split('\n')
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `first difference at line ${i + 1}:\n     shipped:   ${JSON.stringify(la[i] ?? '<eof>')}\n     generated: ${JSON.stringify(lb[i] ?? '<eof>')}`
  }
  return 'the files differ only in trailing bytes'
}
