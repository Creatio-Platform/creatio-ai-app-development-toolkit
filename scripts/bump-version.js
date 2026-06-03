#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, ".version-bump.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(".version-bump.json not found");
  }
  const config = readJson(CONFIG_PATH);
  if (!Array.isArray(config.files) || config.files.length === 0) {
    fail(".version-bump.json must contain a non-empty files array");
  }
  return config;
}

// Keys that can poison Object.prototype if used as a traversal/assignment
// target. They are never legitimate version-field names, so reject them
// outright rather than walking into them.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function parseFieldPath(fieldPath) {
  return fieldPath.split(".").map((part) => {
    if (UNSAFE_KEYS.has(part)) {
      fail(`Unsafe field path segment '${part}' in '${fieldPath}'`);
    }
    return /^\d+$/.test(part) ? Number(part) : part;
  });
}

function descend(root, parts, fieldPath) {
  // Walk `parts` with reduce (not a for/while loop) so the traversal never
  // takes the `current = current[key]`-inside-a-loop shape that enables
  // prototype-pollution gadgets. parseFieldPath has already rejected the
  // __proto__/constructor/prototype segments.
  return parts.reduce((current, part) => {
    if (current == null || !Object.hasOwn(current, part)) {
      throw new Error(`Missing field '${fieldPath}'`);
    }
    return current[part];
  }, root);
}

function getField(data, fieldPath) {
  return descend(data, parseFieldPath(fieldPath), fieldPath);
}

function setField(data, fieldPath, value) {
  const parts = parseFieldPath(fieldPath);
  const lastKey = parts[parts.length - 1];
  const parent = descend(data, parts.slice(0, -1), fieldPath);
  parent[lastKey] = value;
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`Version must be semantic X.Y.Z, got '${version}'`);
  }
}

function configuredFiles() {
  return loadConfig().files.map((entry) => {
    if (!entry || typeof entry.path !== "string" || typeof entry.field !== "string") {
      fail("Each .version-bump.json file entry must contain path and field strings");
    }
    return entry;
  });
}

function checkVersions() {
  const versions = [];
  for (const entry of configuredFiles()) {
    const filePath = path.join(ROOT, entry.path);
    const data = readJson(filePath);
    const version = getField(data, entry.field);
    versions.push({ ...entry, version });
  }

  const expected = versions[0].version;
  const drift = versions.filter((item) => item.version !== expected);
  if (drift.length > 0) {
    console.error("Version drift detected:");
    for (const item of versions) {
      console.error(`  ${item.path}:${item.field} = ${item.version}`);
    }
    process.exit(1);
  }

  console.log(`All configured versions are ${expected}`);
}

function bumpVersion(version) {
  validateVersion(version);
  for (const entry of configuredFiles()) {
    const filePath = path.join(ROOT, entry.path);
    const data = readJson(filePath);
    setField(data, entry.field, version);
    writeJson(filePath, data);
  }
  console.log(`Updated configured versions to ${version}`);
}

// === Audit support ===

// Upper bound on a single glob pattern. The patterns come from the trusted
// .version-bump.json audit.exclude list, but bounding the length keeps the
// generated RegExp small and removes any ReDoS surface from an oversized input.
const MAX_GLOB_LENGTH = 256;

function tokenizeGlob(pattern) {
  // Tokenize a glob into matcher instructions. Matched against POSIX-style
  // repository-relative paths.
  //   **  -> any chars including /
  //   *   -> any chars except /
  //   ?   -> single char except /
  //   trailing / -> match anything under this directory
  if (typeof pattern !== "string" || pattern.length > MAX_GLOB_LENGTH) {
    fail(`Glob pattern must be a string of at most ${MAX_GLOB_LENGTH} characters`);
  }
  const tokens = [];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        tokens.push({ kind: "globstar" });
        i += 2;
      } else {
        tokens.push({ kind: "star" });
        i += 1;
      }
    } else if (c === "?") {
      tokens.push({ kind: "any" });
      i += 1;
    } else {
      tokens.push({ kind: "lit", ch: c });
      i += 1;
    }
  }
  // A trailing '/' means "match everything under this directory" — same as a
  // following '**'.
  if (pattern.endsWith("/")) {
    tokens.push({ kind: "globstar" });
  }
  return tokens;
}

function matchGlobTokens(tokens, input) {
  // Backtracking matcher over the token list, memoized on (token, position)
  // so it stays polynomial — no RegExp, hence no ReDoS and no dynamic-RegExp
  // sink for SAST to flag.
  const visited = new Set();
  const stride = input.length + 1;

  function matchFrom(ti, si) {
    const key = ti * stride + si;
    if (visited.has(key)) {
      return false;
    }
    visited.add(key);

    if (ti === tokens.length) {
      return si === input.length;
    }
    const token = tokens[ti];
    switch (token.kind) {
      case "lit":
        return si < input.length && input[si] === token.ch && matchFrom(ti + 1, si + 1);
      case "any":
        return si < input.length && input[si] !== "/" && matchFrom(ti + 1, si + 1);
      case "star":
        // zero-or-more characters, none of them '/'
        if (matchFrom(ti + 1, si)) return true;
        return si < input.length && input[si] !== "/" && matchFrom(ti, si + 1);
      case "globstar":
        // zero-or-more characters, '/' allowed
        if (matchFrom(ti + 1, si)) return true;
        return si < input.length && matchFrom(ti, si + 1);
      default:
        return false;
    }
  }

  return matchFrom(0, 0);
}

function globToMatcher(pattern) {
  const tokens = tokenizeGlob(pattern);
  return (input) => matchGlobTokens(tokens, input);
}

function loadAuditExcludes() {
  const config = loadConfig();
  const excludes =
    config.audit && Array.isArray(config.audit.exclude) ? config.audit.exclude : [];
  return excludes.map(globToMatcher);
}

const ALWAYS_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar",
  ".pyc", ".pyo",
  ".woff", ".woff2", ".ttf", ".otf",
  ".mp3", ".mp4", ".mov", ".wav",
  ".pptx", ".docx", ".xlsx",
]);

function* walkRepo(rootDir) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        yield abs;
      }
    }
  }
}

function relPosix(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

function auditVersions() {
  const declaredPaths = new Set(configuredFiles().map((entry) => entry.path));
  const excludeMatchers = loadAuditExcludes();

  // Pick the most common version across declared files as the audit target.
  const versions = [];
  for (const entry of configuredFiles()) {
    const filePath = path.join(ROOT, entry.path);
    if (!fs.existsSync(filePath)) continue;
    const data = readJson(filePath);
    versions.push(getField(data, entry.field));
  }
  if (versions.length === 0) {
    fail("No declared files exist; cannot determine current version for audit.");
  }
  const counts = new Map();
  for (const v of versions) counts.set(v, (counts.get(v) || 0) + 1);
  const currentVersion = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  console.log(`Audit: scanning repo for '${currentVersion}' in undeclared files...`);
  console.log("");

  const hits = [];
  for (const abs of walkRepo(ROOT)) {
    const rel = relPosix(abs);
    if (declaredPaths.has(rel)) continue;
    if (excludeMatchers.some((matches) => matches(rel))) continue;
    const ext = path.extname(rel).toLowerCase();
    if (BINARY_EXTS.has(ext)) continue;

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (_e) {
      continue;
    }
    if (stat.size > 5 * 1024 * 1024) continue;

    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch (_e) {
      continue;
    }
    if (!content.includes(currentVersion)) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(currentVersion)) {
        hits.push({ path: rel, line: i + 1, text: lines[i].trim() });
      }
    }
  }

  if (hits.length === 0) {
    console.log(`No undeclared files contain the version string '${currentVersion}'. All clear.`);
    return;
  }

  console.log(`UNDECLARED files containing '${currentVersion}':`);
  for (const hit of hits) {
    console.log(`  ${hit.path}:${hit.line}: ${hit.text}`);
  }
  console.log("");
  console.log("Review the above:");
  console.log("- If they should be bumped, add to .version-bump.json files[]");
  console.log("- If they should be skipped, add a pattern to .version-bump.json audit.exclude[]");
  // Soft warning: do not block CI.
}

function main(argv) {
  if (argv.length !== 1) {
    fail("Usage: node scripts/bump-version.js --check | --audit | <version>");
  }
  if (argv[0] === "--check") {
    checkVersions();
    return;
  }
  if (argv[0] === "--audit") {
    auditVersions();
    return;
  }
  bumpVersion(argv[0]);
}

main(process.argv.slice(2));
