#!/usr/bin/env node

const fs = require("fs");
const vm = require("vm");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function transformObjectFilter(filter) {
  return filter
    .replace(/(^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, "vars.$1");
}

function render(value, raw) {
  if (raw) {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function resolvePath(obj, filter) {
  const normalized = filter.replace(/\s+/g, "");
  const [pathExpr] = normalized.split("//empty");
  if (!pathExpr.startsWith(".")) {
    fail(`Unsupported jq filter: ${filter}`);
  }
  const path = pathExpr
    .slice(1)
    .split(".")
    .filter(Boolean);
  let current = obj;
  for (const segment of path) {
    if (current == null || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

const args = process.argv.slice(2);
let nullInput = false;
let raw = false;
const vars = {};
const positionals = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "-n") {
    nullInput = true;
    continue;
  }
  if (arg === "-r") {
    raw = true;
    continue;
  }
  if (arg === "--arg" || arg === "--argjson") {
    const key = args[i + 1];
    const value = args[i + 2];
    if (!key || value === undefined) {
      fail(`Missing value for ${arg}`);
    }
    vars[key] = arg === "--argjson" ? JSON.parse(value) : value;
    i += 2;
    continue;
  }
  positionals.push(arg);
}

if (positionals.length < 1) {
  fail("jq shim requires a filter");
}

const filter = positionals[0];

if (nullInput) {
  const transformed = transformObjectFilter(filter);
  let result;
  try {
    result = vm.runInNewContext(`(${transformed})`, { vars });
  } catch (error) {
    fail(`Unsupported jq object filter: ${error.message}`);
  }
  process.stdout.write(`${render(result, false)}\n`);
  process.exit(0);
}

const filePath = positionals[1];
if (!filePath) {
  fail("jq shim requires an input file");
}

let content;
try {
  content = fs.readFileSync(filePath, "utf8");
} catch (error) {
  fail(error.message);
}

let data;
try {
  data = JSON.parse(content);
} catch (error) {
  fail(`Invalid JSON in ${filePath}: ${error.message}`);
}

const value = resolvePath(data, filter);
process.stdout.write(render(value, raw));
if (!raw) {
  process.stdout.write("\n");
}
