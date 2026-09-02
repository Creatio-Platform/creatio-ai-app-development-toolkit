// UNIT GOLDENS for `stripComments` in `scripts/build-workflows.mjs` (PR #128 review, round 18).
//
// WHY THIS FILE EXISTS, and why `--check` was not already this test. `build-workflows.mjs --check` asserts the
// shipped artifact is byte-identical to a fresh regeneration. That proves REPRODUCIBILITY: the same input gives the
// same output twice. It says nothing about whether the output is CORRECT. `stripComments` is a hand-written
// tokeniser that has to tell a real comment from prompt text that merely looks like one — and this generator's input
// is mostly PROMPTS, where a line inside a template literal can legitimately begin with `//` (a URL, a path, a quoted
// snippet) or contain `/*`. A stripper bug that ate a character inside such a literal would corrupt BOTH SIDES of
// the identity comparison identically and pass for ever, and the failure would surface much later as an agent
// misbehaving on instructions nobody could see had been altered.
//
// TWO KINDS OF CHECK, deliberately:
//   1. A hand-written case table — the specific confusions the tokeniser exists to survive, each asserting that the
//      LITERAL CONTENT is untouched and only true comments are removed.
//   2. A property check against the REAL shipped artifacts: parse before and after with the vendored acorn, collect
//      every string and template payload, and require the two lists to be identical. This is the leg that scales —
//      it covers every prompt actually shipped, including the ones nobody thought to write a case for.
//
// Zero dependencies beyond node built-ins and the repo's own vendored parser; exits 1 on any failed check.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { stripComments, KEEP_COMMENT, TARGETS, assembleTarget } from "../../scripts/build-workflows.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
// The repo's own pinned parser (`engine/vendor/acorn.cjs`, SHA-pinned by `verify-vendor.mjs`). Used rather than a new
// dependency for the same reason the engine vendors it: this suite must stay installable-free.
const acorn = require(path.join(ROOT, "skills/classic-to-freedom-migration/engine/vendor/acorn.cjs"));

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) {
    let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; }
    console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d)));
  }
};

console.log("\nstripComments — literal payloads survive, comments do not\n");

// ---------------------------------------------------------------------------
// 1. THE CASE TABLE. Each `src` is stripped and the result must (a) still contain every `keep` fragment verbatim and
// (b) contain none of the `gone` fragments. Stated as fragments rather than whole expected outputs so a change to
// blank-line handling does not rewrite twelve goldens that are not about blank lines.
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: "a `//` inside a single-quoted string is NOT a comment",
    src: "const url = 'https://example.com/a' // trailing prose\n",
    keep: ["'https://example.com/a'"],
    gone: ["trailing prose"],
  },
  {
    name: "a `//` inside a double-quoted string is NOT a comment",
    src: 'const url = "see //docs/readme" /* block prose */\n',
    keep: ['"see //docs/readme"'],
    gone: ["block prose"],
  },
  {
    name: "a template literal with `${...}` AND an embedded `/*` keeps both",
    src: "const t = `head ${a + b} /* not a comment */ tail` // real comment\n",
    keep: ["`head ${a + b} /* not a comment */ tail`"],
    gone: ["real comment"],
  },
  {
    name: "a comment INSIDE `${...}` is code context and IS stripped, while the surrounding template survives",
    src: "const t = `x ${ a /* inner */ } y`\n",
    keep: ["`x ${ a", "} y`"],
    gone: ["inner"],
  },
  {
    name: "a nested template inside `${...}` does not end the outer one early",
    src: "const t = `a ${ `b // still text` } c` // gone\n",
    keep: ["`b // still text`", "} c`"],
    gone: ["// gone"],
  },
  {
    name: "a comment right after a REGEX LITERAL is stripped and the regex is not eaten as one",
    src: "const re = /ab\\/cd/g // prose after a regex\n",
    keep: ["/ab\\/cd/g"],
    gone: ["prose after a regex"],
  },
  {
    name: "a regex CHARACTER CLASS containing `/` does not terminate the literal",
    src: "const re = /[/*]+/ // prose\nconst after = 1\n",
    keep: ["/[/*]+/", "const after = 1"],
    gone: ["// prose"],
  },
  {
    name: "DIVISION is not mistaken for a regex, so the following comment is still found",
    src: "const q = total / count // prose\nconst after = 2\n",
    keep: ["total / count", "const after = 2"],
    gone: ["// prose"],
  },
  {
    name: "an ESCAPED QUOTE inside a string does not end it early",
    src: "const s = 'it\\'s // not a comment' // this one is\n",
    keep: ["'it\\'s // not a comment'"],
    gone: ["this one is"],
  },
  {
    name: "an escaped BACKTICK inside a template does not end it early",
    src: "const t = `a \\` b // still inside` // gone\n",
    keep: ["`a \\` b // still inside`"],
    gone: ["// gone"],
  },
  {
    name: "a `//` on its own line INSIDE A MULTI-LINE TEMPLATE survives, and its indentation with it",
    src: "const prompt = `\n  RULES:\n  // this line is prompt text, not code\n  done\n`\n// this line is code prose\n",
    keep: ["  // this line is prompt text, not code", "  RULES:", "  done"],
    gone: ["this line is code prose"],
  },
  {
    name: "a `/* … */` spanning lines inside a template survives whole",
    src: "const t = `one\n/* two\nthree */\nfour`\n/* five */\n",
    keep: ["/* two\nthree */"],
    gone: ["five"],
  },
  {
    name: "a real block comment between two statements goes, and both statements stay",
    src: "const a = 1\n/* prose\n  more prose */\nconst b = 2\n",
    keep: ["const a = 1", "const b = 2"],
    gone: ["prose"],
  },
  {
    name: "an unterminated string-looking sequence in a template does not swallow the rest of the file",
    src: "const t = `it's a template`\nconst after = 3 // gone\n",
    keep: ["`it's a template`", "const after = 3"],
    gone: ["// gone"],
  },
];

for (const c of CASES) {
  const out = stripComments(c.src);
  check(c.name,
    () => c.keep.every((k) => out.includes(k)) && c.gone.every((g) => !out.includes(g)),
    () => JSON.stringify({
      missing: c.keep.filter((k) => !out.includes(k)),
      leaked: c.gone.filter((g) => out.includes(g)),
      out,
    }));
}

// ---------------------------------------------------------------------------
// 2. THE COMMENTS THAT MUST SURVIVE, because something READS them. Eating any of these is a silent breakage of a
// different suite rather than a build error here, which is exactly why they are pinned on this side too.
// ---------------------------------------------------------------------------
console.log("\nmachine-meaningful comments survive\n");

const SENTINEL_BEGIN = "// ---8<--- PURE DECISION HELPERS ---8<---";
const SENTINEL_END = "// ---8<--- END PURE DECISION HELPERS ---8<---";

check("the `---8<---` region sentinels survive — the offline suite slices the shipped artifact between them",
  () => {
    const out = stripComments(`${SENTINEL_BEGIN}\nconst x = 1 // gone\n${SENTINEL_END}\n`);
    return out.includes(SENTINEL_BEGIN) && out.includes(SENTINEL_END) && !out.includes("// gone");
  },
  () => stripComments(`${SENTINEL_BEGIN}\nconst x = 1 // gone\n${SENTINEL_END}\n`));

check("the GENERATED-FILE header survives — it is the only warning a reader of the artifact gets",
  () => {
    const src = "// GENERATED FILE — DO NOT EDIT BY HAND\n//\n//   node scripts/build-workflows.mjs\n// prose that goes\nconst a = 1\n";
    const out = stripComments(src);
    return out.includes("GENERATED FILE — DO NOT EDIT BY HAND")
      && out.includes("node scripts/build-workflows.mjs")
      && !out.includes("prose that goes");
  },
  () => stripComments("// GENERATED FILE — DO NOT EDIT BY HAND\n// prose that goes\nconst a = 1\n"));

check("the `OPERATOR FINDINGS from an earlier checkpoint` marker survives — the render harness slices on it",
  () => stripComments("// OPERATOR FINDINGS from an earlier checkpoint\nconst a = 1\n")
    .includes("OPERATOR FINDINGS from an earlier checkpoint"));

check("the `@INLINE@` block marker survives",
  () => stripComments("/*@INLINE@*/\nconst a = 1\n").includes("@INLINE@"));

check("`KEEP_COMMENT` is the single source of the keep rule and matches all three of its members, and nothing else",
  () => KEEP_COMMENT.test("// GENERATED FILE") && KEEP_COMMENT.test("//   node scripts/build-workflows.mjs")
    && KEEP_COMMENT.test("// OPERATOR FINDINGS from an earlier checkpoint")
    && !KEEP_COMMENT.test("// an ordinary maintainer note"));

// ANTI-VACUITY: if the cases above ever stopped stripping anything at all, every `gone` assertion would still pass.
check("ANTI-VACUITY: the stripper actually removes prose — a file of nothing but comments strips to nothing",
  () => stripComments("// one\n// two\n/* three */\n").trim() === "",
  () => JSON.stringify(stripComments("// one\n// two\n/* three */\n")));

check("ANTI-VACUITY: a whole-line comment takes its blank line with it, and a trailing one keeps its code",
  () => stripComments("const a = 1\n// gone\nconst b = 2 // also gone\n") === "const a = 1\nconst b = 2\n",
  () => JSON.stringify(stripComments("const a = 1\n// gone\nconst b = 2 // also gone\n")));

// ---------------------------------------------------------------------------
// 3. THE PROPERTY CHECK, against what actually ships. Parse the source before and after stripping and require every
// string and template payload to come back identical. This is the leg that would catch a tokeniser bug in a prompt
// nobody wrote a case for — which is the whole failure mode `--check` is blind to.
// ---------------------------------------------------------------------------
console.log("\nreal shipped artifacts — every literal payload survives stripping\n");

// The sources the generator consumes, not the generated output: these are the files that still HAVE comments, so
// they are the only ones on which stripping is a non-trivial operation.
// DERIVED FROM `TARGETS`, NOT HAND-TYPED (PR #128 review, round 19). The list used to name five files while the
// generator strips the assembled text of two templates plus THIRTEEN distinct modules -- and the ten it missed
// included the two worst ones to miss: `build-executor/context.mjs`, which holds `DATA_OPEN`/`DATA_CLOSE`/`dataFence`
// (the untrusted-data fence this whole channel rests on) and the POSIX shell-quote literal, the most stripper-hostile
// literal in the repo; and `behaviour-analysis/prompts.mjs`, which is nothing but prompt text and feeds the OTHER
// artifact, the one with far fewer incidental `wfSrc` pins to catch a mis-strip by accident. The header above claims
// this leg "covers every prompt actually shipped, including the ones nobody thought to write a case for" -- a
// hand-copied list cannot keep that promise, because adding a module to `TARGETS` did not add it here and nothing
// went red. The repo already applies this pattern one directory over (`run-infra.mjs` derives its schema export list
// from the shipped slice, because "an export nobody listed is still measured").
const CORE_DIR = path.join(ROOT, "skills", "_workflow-core");
const SOURCES = [...new Set(TARGETS.flatMap((t) => [t.template, ...t.modules]))];

// Every string literal and every template chunk, in source order. Regex literals are included too — a stripper that
// mistook one for a comment would drop it and change behaviour silently.
// `allowReturnOutsideFunction` because the `claude-template.js` sources are WORKFLOW SCRIPT BODIES: the host
// evaluates them as a function body with `args`/`log`/`agent` injected, so a top-level `return` is legal there and
// is not legal in a module. Parsing them as modules failed on exactly that, which is a fact about the host contract
// rather than about the stripper.
function literalPayloads(src) {
  const ast = acorn.parse(src, {
    ecmaVersion: 2022, sourceType: "module", allowHashBang: true, allowReturnOutsideFunction: true,
  });
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.type === "Literal" && typeof node.value === "string") out.push("s:" + node.value);
    else if (node.type === "Literal" && node.regex) out.push("r:" + node.regex.pattern + "/" + node.regex.flags);
    else if (node.type === "TemplateElement") out.push("t:" + (node.value?.cooked ?? node.value?.raw ?? ""));
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
      walk(node[k]);
    }
  })(ast);
  return out;
}

// SELF-TEST FOR THE COMPARATOR, before it is used to make claims about real files. The per-file checks below can
// only ever report "no divergence"; if `literalPayloads` were blind — a walk that missed template chunks, say — every
// one of them would pass on a stripper that shredded every prompt in the repo. So the comparator is first shown to
// SEE a one-character change inside a template and inside a string.
check("SELF-TEST: the payload comparator detects a single character changed INSIDE a template",
  () => {
    const a = literalPayloads("const t = `RULES: see //docs`\n");
    const b = literalPayloads("const t = `RULES: see /docs`\n");
    return JSON.stringify(a) !== JSON.stringify(b);
  });
check("SELF-TEST: the payload comparator detects a string literal that lost its tail",
  () => {
    const a = literalPayloads("const s = 'https://example.com/a'\n");
    const b = literalPayloads("const s = 'https:'\n");
    return JSON.stringify(a) !== JSON.stringify(b);
  });
check("SELF-TEST: the payload comparator IGNORES comments, so an unchanged literal set reads as unchanged",
  () => {
    const a = literalPayloads("// prose\nconst s = 'x'\n");
    const b = literalPayloads("const s = 'x'\n");
    return JSON.stringify(a) === JSON.stringify(b);
  });

for (const rel of SOURCES) {
  const abs = path.join(CORE_DIR, rel);
  let src;
  try { src = readFileSync(abs, "utf8").replace(/\r\n/g, "\n"); }
  catch { check(`${rel} is readable`, false, `missing: ${abs}`); continue; }

  const stripped = stripComments(src);

  check(`${rel} — the stripped source still PARSES`,
    () => { literalPayloads(stripped); return true; });

  check(`${rel} — every string / template / regex payload is byte-identical after stripping`,
    () => {
      const before = literalPayloads(src), after = literalPayloads(stripped);
      if (before.length !== after.length) return false;
      return before.every((v, i) => v === after[i]);
    },
    () => {
      let before = [], after = [];
      try { before = literalPayloads(src); after = literalPayloads(stripped); } catch (e) { return "parse failed: " + e.message; }
      if (before.length !== after.length) return `count differs: ${before.length} before, ${after.length} after`;
      const i = before.findIndex((v, k) => v !== after[k]);
      return `first divergence at literal #${i}:\n        before: ${JSON.stringify(before[i]?.slice(0, 200))}\n        after:  ${JSON.stringify(after[i]?.slice(0, 200))}`;
    });

  // ANTI-VACUITY per file: a stripper that returned its input unchanged would pass both checks above.
  check(`${rel} — stripping actually removed prose from this file`,
    () => stripped.length < src.length,
    () => `before ${src.length} bytes, after ${stripped.length}`);

  check(`${rel} — stripping is IDEMPOTENT (a second pass finds nothing left to take)`,
    () => stripComments(stripped) === stripped,
    () => "a second pass changed the output, so the first left a comment behind or ate a delimiter");
}

// THE SEAM (PR #128 review, round 19). Production strips the ASSEMBLED text -- the template with every module
// inlined into it -- while the per-file leg above strips each file in isolation. A mis-strip AT A JOIN is therefore
// outside both legs: a file whose last construct leaves the tokeniser in a state the next file's first construct
// resolves differently (a regex that scans as division, a line comment absorbing the line after it) can only show
// up on the concatenation. `assembleTarget` is the generator's OWN assembly step, so this checks the exact string
// `build` hands to `stripComments` -- not a hand-rolled join, which would not even parse: the raw modules still
// carry their imports and re-declare shared top-level names, which is precisely what `inlineOne` resolves.
for (const t of TARGETS) {
  const files = [t.template, ...t.modules];
  let assembled;
  try { assembled = assembleTarget(t); }
  catch (e) { check(`${t.name} — the target assembles for the seam check`, false, e.message); continue; }

  const strippedAll = stripComments(assembled);

  check(`${t.name} — the ASSEMBLED source of all ${files.length} sources still PARSES after stripping (the module seams, which the per-file leg cannot see)`,
    () => { literalPayloads(strippedAll); return true; });

  check(`${t.name} — every literal payload in the ASSEMBLED source is byte-identical after stripping, so no module JOIN shifts the tokeniser`,
    () => {
      const before = literalPayloads(assembled), after = literalPayloads(strippedAll);
      if (before.length !== after.length) return false;
      return before.every((v, i) => v === after[i]);
    },
    () => {
      let before = [], after = [];
      try { before = literalPayloads(assembled); after = literalPayloads(strippedAll); } catch (e) { return "parse failed: " + e.message; }
      if (before.length !== after.length) return `count differs: ${before.length} before, ${after.length} after`;
      const i = before.findIndex((v, k) => v !== after[k]);
      return `first divergence at literal #${i}: before=${JSON.stringify(before[i]?.slice(0, 200))} after=${JSON.stringify(after[i]?.slice(0, 200))}`;
    });

  // ANTI-VACUITY: an assembly that arrived empty, or a stripper that returned its input, would pass both above.
  check(`${t.name} — stripping the ASSEMBLED source actually removed prose`,
    () => assembled.length > 0 && strippedAll.length < assembled.length,
    () => `before ${assembled.length} bytes, after ${strippedAll.length}`);

  check(`${t.name} — stripping the ASSEMBLED source is IDEMPOTENT`,
    () => stripComments(strippedAll) === strippedAll);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
