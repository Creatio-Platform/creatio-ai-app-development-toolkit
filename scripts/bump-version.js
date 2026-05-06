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

function main(argv) {
  if (argv.length !== 1) {
    fail("Usage: node scripts/bump-version.js --check | <version>");
  }
  if (argv[0] === "--check") {
    checkVersions();
    return;
  }
  bumpVersion(argv[0]);
}

main(process.argv.slice(2));
