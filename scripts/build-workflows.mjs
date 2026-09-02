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
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  {
    name: 'creatio-freedom-build-executor',
    template: 'build-executor/claude-template.js',
    out: 'skills/freedom-build-executor/freedom-build-executor.workflow.js',
    modules: [
      'work-item.mjs',
      'capabilities.mjs',
      'run-state.mjs',
      'driver.mjs',
      // SCHEMAS BEFORE HELPERS (round 17b). The schemas module is the LEAF — it imports nothing — and it
      // declares the shared contract literals (`CARRY_TEXT_CAP`, the `shows` vocabulary, the two
      // unconsumed-source tags) that `helpers` functions read. In ONE inlined scope a `const` is NOT hoisted,
      // so declaring them after the functions that read them is a temporal-dead-zone THROW the moment one is
      // called — which is exactly what the constants-prologue check caught when the literals moved here to
      // break the `helpers <-> schemas` import cycle. `helpers` reads `RECONCILE_SHAPE` from the schemas only
      // as a DEFAULT PARAMETER, evaluated at call time, so this order satisfies both directions at once.
      'build-executor/schemas.mjs',
      'build-executor/helpers.mjs',
      'build-executor/context.mjs',
      'build-executor/core.mjs',
      'adapters/claude-workflow.mjs',
    ],
    phases: ['Reconcile', 'Refs', 'Preflight', 'Build', 'Verify', 'Judge', 'Close'],
  },
]

// Drop `import` statements (single- and multi-line) and turn `export X` into `X`.
// Nothing else is rewritten: the inlined text is the module's own source, so a
// reviewer diffing the generated file against the core sees only these removals.
// Is this line an `import` (single- or multi-line) or a RE-EXPORT? Both are dropped: the inlined modules share one
// scope, so every name is already in it. Split out so `inlineOne` stays a loop over lines.
const isImportStart = (line) => /^import\s/.test(line)
const endsImport = (line) => /from\s+'[^']+'\s*$/.test(line.trim()) || /^\}\s+from\s+'[^']+'/.test(line.trim())
// A re-export has nothing to inline. Stripping `export ` off one left a bare `{ a, b }` — a block of expression
// statements that does nothing and reads like a mistake, which is what it was. Two questions, asked separately,
// because one regex with an optional trailing group next to `\s*$` backtracks super-linearly.
function isReExport(line) {
  const trimmed = line.trim()
  if (!/^export\s*\{/.test(trimmed)) return false
  return trimmed.endsWith('}') || /\}\s*from\s+'[^']+'$/.test(trimmed)
}

function inlineOne(rel) {
  // LF AT READ, not at return (PR #128 review). Every transform below is LF-shaped -- notably the blank-run
  // collapse in this function's own `return`, whose three-or-more-newline regex cannot match a CRLF blank run.
  // Normalising the assembled text at the END fixes the line endings but CANNOT undo a collapse that never
  // fired, so the artifact still depended on the checkout -- in whitespace instead of in every line. Normalise
  // the bytes as they arrive and every transform sees the same input on every machine.
  const src = readFileSync(path.join(CORE, rel), 'utf8').replace(/\r\n/g, '\n')
  const out = []
  let skipping = false
  for (const line of src.split('\n')) {
    if (skipping) {
      if (endsImport(line)) skipping = false
      continue
    }
    if (isImportStart(line)) {
      // A single-line import ends on this line; a braced one continues.
      if (!endsImport(line)) skipping = true
      continue
    }
    if (isReExport(line)) continue
    out.push(line.replace(/^export\s+(default\s+)?/, ''))
  }
  return `// ===== inlined from _workflow-core/${rel} =====\n${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

// Top-level identifier collisions would silently shadow one another once the
// modules share a scope, so they are a hard error rather than a warning.
function topLevelNames(text) {
  const names = []
  const re = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm
  for (const m of text.matchAll(re)) names.push(m[1])
  return names
}

// COMMENTS DO NOT SHIP (ENG-95930 / PR #128 round 17b). Half of the generated artifact was comment prose — 291,704
// of 568,703 bytes — and the file has a HARD ceiling that has nothing to do with how well it is documented: the
// `Workflow` permission handler inlines a `scriptPath` file into the `script` field so the approval dialog can show
// it, and that field's `maxLength` is 524288. Over the line the workflow fails schema validation before a single
// agent runs, exactly like the CR case above it, with nothing in the script to point at. Two PRs each fitting on
// their own merged to 571,395 bytes, which is how this arrived.
//
// The prose is not lost and is not the thing being economised: it stays in `skills/_workflow-core/**`, which is what
// a maintainer reads, what review rounds annotate, and what the offline suite reads for the pins that assert a
// stated invariant. The ARTIFACT is generated, is read by the host rather than by a person, and now carries only
// what it executes.
//
// TOKENISED, NOT PATTERN-MATCHED, and that distinction is load-bearing: this file is mostly PROMPTS, and a line of
// prompt text inside a template literal can legitimately begin with `//` (a URL, a path, a quoted snippet). A regex
// that ate those would silently corrupt the instructions the agents run on — the failure would surface as an agent
// misbehaving, not as a build error. So the scanner tracks single quotes, double quotes, template literals
// (including nested `${...}`, which can itself contain any of these again) and regex literals, and only removes a
// comment it is certain is code.
//
// TWO KINDS OF COMMENT ARE MACHINE-MEANINGFUL AND SURVIVE.
// 1. `// ---8<--- PURE DECISION HELPERS ---8<---` and its END twin: the offline suite slices the pure block out
//    of the SHIPPED artifact between them and imports it, so eating them takes the whole helper surface down.
// 2. The GENERATED-FILE HEADER (`GENERATED FILE — DO NOT EDIT BY HAND` and the two `build-workflows.mjs`
//    command lines under it). That block is the only thing standing between a reader of the shipped file and a
//    hand edit this generator silently overwrites — the artifact is 3,700 lines with no other clue that it is
//    generated. A suite check asserts it is present for exactly that reason, and stripping it made that check
//    red, which is the check doing its job rather than being in the way.
// Everything else is prose for a maintainer, and a maintainer reads `_workflow-core/**`.
// THE SENTINELS SURVIVE. `// ---8<--- PURE DECISION HELPERS ---8<---` and its END twin are comments, and the offline
// suite slices the pure block out of the SHIPPED artifact between them and imports it. Eating them takes the whole
// helper surface down at once.
// The header block, kept verbatim: the DO-NOT-EDIT line, the blank continuation lines that make it a block, and
// the two command lines that tell a reader how to regenerate. Anything else in that comment is prose and goes.
// Kept verbatim: the DO-NOT-EDIT header and the two regenerate commands, and the REGION MARKERS the offline
// suite slices on. A marker is not prose — something READS it — which is the same reason the `---8<---`
// sentinels survive. `OPERATOR FINDINGS from an earlier checkpoint` bounds the `buildPrompt` slice the render
// harness compiles, and it deliberately stops PART WAY through that function (the tail reaches for paths the
// harness does not stub). Adding a marker here is a deliberate act, exactly like raising a budget.
// EXPORTED for `engine-tests/build-workflows/strip-comments.mjs` (PR #128 review, round 18). The only guard this
// scanner had was `--check`, which asserts the shipped artifact is byte-identical to a fresh regeneration — that
// proves REPRODUCIBILITY, not CORRECTNESS. A stripper bug that ate a character inside a prompt string would corrupt
// both sides of that identity comparison identically and pass for ever, and the failure would surface as an agent
// misbehaving on instructions nobody could see were wrong. So the tokeniser is testable directly.
export const KEEP_COMMENT = /GENERATED FILE|build-workflows\.mjs|OPERATOR FINDINGS from an earlier checkpoint/
export function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  // `${` inside a template literal opens a code context that can contain another template literal, so the state is
  // a STACK rather than a flag. `depth` counts braces inside the current interpolation so the matching `}` is the
  // one that closes it.
  const stack = []
  let mode = 'code'
  let depth = 0
  // Whether a `/` starts a regex literal or is division: decided by the last significant token, which is the
  // standard heuristic. `prev` is the last non-space character emitted in code context.
  let prev = ''

  const regexAllowedAfter = (c) => c === '' || '=(,:[!&|?{};+-*%~^<>'.includes(c) || c === '\n'

  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]

    if (mode === 'code') {
      // ---- line comment
      if (c === '/' && c2 === '/') {
        let j = src.indexOf('\n', i)
        if (j === -1) j = n
        const text = src.slice(i, j)
        if (text.includes('---8<---') || KEEP_COMMENT.test(text)) {   // machine-meaningful: see the note above
          out += text
        } else {
          // Drop the comment. If the line is now only whitespace, drop the line's indentation and its newline too,
          // so a stripped file has no ragged blank lines where prose used to be.
          const lineStart = out.lastIndexOf('\n') + 1
          if (out.slice(lineStart).trim() === '') {
            out = out.slice(0, lineStart)
            i = j + 1                            // consume the newline as well
            continue
          }
          // A trailing comment after code: drop it, keep the code and the newline.
          out = out.replace(/[ \t]+$/, '')
        }
        i = j
        continue
      }
      // ---- block comment
      if (c === '/' && c2 === '*') {
        const j = src.indexOf('*/', i + 2)
        const end = j === -1 ? n : j + 2
        const text = src.slice(i, end)
        if (text.includes('---8<---') || text.includes('@INLINE@')) {
          out += text
        } else {
          const lineStart = out.lastIndexOf('\n') + 1
          const wasAlone = out.slice(lineStart).trim() === ''
          // A block comment that occupied whole lines: take its trailing newline with it.
          let k = end
          if (wasAlone) {
            while (k < n && (src[k] === ' ' || src[k] === '\t')) k += 1
            if (src[k] === '\n') k += 1
            out = out.slice(0, lineStart)
            i = k
            continue
          }
          out = out.replace(/[ \t]+$/, '')
        }
        i = end
        continue
      }
      // ---- string / template starts
      if (c === "'" || c === '"') { mode = c; out += c; i += 1; continue }
      if (c === '`') { stack.push({ mode, depth }); mode = '`'; out += c; i += 1; continue }
      // ---- regex literal
      if (c === '/' && regexAllowedAfter(prev)) { mode = '/'; out += c; i += 1; continue }
      // ---- closing an interpolation
      if (c === '{' && stack.length) { depth += 1 }
      if (c === '}' && stack.length && depth === 0) {
        const s = stack.pop()
        mode = s.mode; depth = s.depth
        out += c; i += 1; continue
      }
      if (c === '}' && stack.length) { depth -= 1 }
      out += c
      if (!/\s/.test(c)) prev = c
      i += 1
      continue
    }

    // ---- inside a single- or double-quoted string
    if (mode === "'" || mode === '"') {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue }
      out += c
      if (c === mode) { mode = 'code'; prev = c }
      i += 1
      continue
    }

    // ---- inside a template literal
    if (mode === '`') {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue }
      if (c === '`') { const s = stack.pop(); mode = s.mode; depth = s.depth; prev = c; out += c; i += 1; continue }
      if (c === '$' && c2 === '{') { stack.push({ mode: '`', depth }); mode = 'code'; depth = 0; out += '${'; i += 2; continue }
      out += c
      i += 1
      continue
    }

    // ---- inside a regex literal
    if (mode === '/') {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue }
      if (c === '[') { mode = '/['; out += c; i += 1; continue }
      if (c === '/') { mode = 'code'; prev = c; out += c; i += 1; continue }
      out += c
      i += 1
      continue
    }
    // ---- inside a regex character class, where `/` is literal
    if (mode === '/[') {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue }
      if (c === ']') { mode = '/' }
      out += c
      i += 1
      continue
    }
  }
  return out
}

function build(target) {
  // Same reason as `inlineOne`: the template is concatenated with the inlined block and scanned for sentinels.
  const template = readFileSync(path.join(CORE, target.template), 'utf8').replace(/\r\n/g, '\n')
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

  // LF, ALWAYS. `.gitattributes` pins `*.workflow.js text eol=lf` and the offline suite asserts the shipped file
  // carries no CR — but the core modules are ordinary `.mjs`, so on a machine with `core.autocrlf=true` they check
  // out CRLF and every line of this assembly inherits it. The generated text then differs from the shipped file on
  // EVERY line: `--check` fails for a Windows contributor who changed nothing, and a real regeneration lands as a
  // whole-file diff that hides the actual change. The normalisation that MAKES the artifact checkout-independent
  // is now at READ (see `inlineOne`); this one is belt-and-braces for anything a template could reintroduce, and
  // is kept deliberately rather than removed.
  // Comments are removed HERE, at the end of assembly, so every module and the template are covered by one
  // pass and the sentinels are the only ones that survive (see `stripComments`). `--check` compares the
  // shipped file against this same output, so the stripping is part of the contract rather than a
  // post-processing step something could skip.
  return stripComments(text).replace(/\r\n/g, '\n')
}

// RUN THE BUILD ONLY WHEN THIS FILE IS THE ENTRY POINT. It used to run at module scope, which made the script
// unimportable: a test that wanted `stripComments` got a full regeneration (and, without `--check`, WROTE every
// shipped artifact) as a side effect of the import. Guarding on the entry point is what lets the tokeniser above be
// tested directly; the CLI behaviour — both `--check` and the plain regenerate — is byte for byte what it was.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
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
}

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
