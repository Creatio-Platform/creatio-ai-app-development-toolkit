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

function parseFieldPath(fieldPath) {
  return fieldPath.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function getField(data, fieldPath) {
  let current = data;
  for (const part of parseFieldPath(fieldPath)) {
    if (current == null || !(part in current)) {
      throw new Error(`Missing field '${fieldPath}'`);
    }
    current = current[part];
  }
  return current;
}

function setField(data, fieldPath, value) {
  const parts = parseFieldPath(fieldPath);
  let current = data;
  for (const part of parts.slice(0, -1)) {
    if (current == null || !(part in current)) {
      throw new Error(`Missing field '${fieldPath}'`);
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
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

function globToRegex(pattern) {
  // Convert a glob pattern into a RegExp matched against POSIX-style
  // repository-relative paths.
  //   **  -> any chars including /
  //   *   -> any chars except /
  //   ?   -> single char except /
  //   trailing / -> match anything under this directory
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i += 2;
      } else {
        regex += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      regex += "[^/]";
      i += 1;
    } else if (".+^$|()[]{}\\".includes(c)) {
      regex += "\\" + c;
      i += 1;
    } else {
      regex += c;
      i += 1;
    }
  }
  if (regex.endsWith("/")) {
    regex += ".*";
  }
  regex += "$";
  return new RegExp(regex);
}

function loadAuditExcludes() {
  const config = loadConfig();
  const excludes =
    config.audit && Array.isArray(config.audit.exclude) ? config.audit.exclude : [];
  return excludes.map(globToRegex);
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
  const excludeRegexes = loadAuditExcludes();

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
    if (excludeRegexes.some((re) => re.test(rel))) continue;
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
