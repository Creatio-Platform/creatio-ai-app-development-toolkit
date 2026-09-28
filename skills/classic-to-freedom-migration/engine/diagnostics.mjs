#!/usr/bin/env node
// Run diagnostics — the block a migration prints FIRST, so a transcript or a worklog alone says which build of this
// skill, which clio and which Creatio stand the run used. Without it a failed run has to be reproduced by asking the
// user, and the answer is usually a guess.
//
//   node diagnostics.mjs --environment <registered clio environment>
//
// Prints a fixed Markdown block (one heading, one line per value). Every value is best-effort: whatever cannot be
// read is printed as `unknown (<reason>)` and the command still exits 0 — diagnostics never stop a migration.
// Only the four fields named below are taken from the stand report: it also carries the user, contact and account
// of the session, and those do not belong in a log that is pasted into tickets.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// engine/ → the skill → skills/ → the plugin root that carries plugin.json and, for a git install, `.git`.
export const PLUGIN_ROOT = path.resolve(HERE, "..", "..", "..");
// Every agent's manifest carries the same version (`.version-bump.json` bumps them together); the first one present wins.
const MANIFESTS = [".claude-plugin", ".codex-plugin", ".cursor-plugin", path.join(".github", "plugin")].map((d) => path.join(d, "plugin.json"));
const STAND_TIMEOUT_MS = 20000; // an unreachable stand must not stall the start of the run for clio's 100 s default

const unknown = (reason) => `unknown (${reason})`;

// A tool is spawned by the absolute path found on PATH, never by bare name (Sonar S4036): this is the same lookup the
// shell does, so it finds the clio the plugin's `.mcp.json` starts as its MCP server.
export function findOnPath(name, env = process.env, platform = process.platform) {
  const exts = platform === "win32" ? (env.PATHEXT || ".EXE;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

export function defaultRun(cmd, args, timeout = 10000) {
  const exe = findOnPath(cmd);
  if (!exe) return { ok: false, error: `${cmd} not found on PATH` };
  // A `.cmd` shim cannot be spawned without a shell on Windows; clio and git install as `.exe`, so none is used.
  const r = spawnSync(exe, args, { encoding: "utf8", timeout, windowsHide: true });
  if (r.error) return { ok: false, error: r.error.code === "ETIMEDOUT" ? `no answer in ${timeout / 1000} s` : r.error.message };
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`, status: r.status };
}

export function readSkillVersion(root) {
  const manifest = MANIFESTS.map((m) => path.join(root, m)).find((p) => existsSync(p));
  if (!manifest) return unknown("no plugin.json beside the skill");
  try {
    return JSON.parse(readFileSync(manifest, "utf8")).version || unknown("plugin.json has no version");
  } catch {
    return unknown("plugin.json is not valid JSON");
  }
}

// Branch and commit are extras: an install that is not a git checkout simply has none, and that is not an error.
export function readGitRef(root, run) {
  if (!existsSync(path.join(root, ".git"))) return null;
  const branch = run("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = run("git", ["-C", root, "rev-parse", "--short", "HEAD"]);
  if (!commit.ok) return null;
  const name = branch.ok ? branch.out.trim() : "";
  return { branch: name && name !== "HEAD" ? name : null, commit: commit.out.trim() };
}

// `clio info` answers offline with its own version and the path of the settings file the stand URL is read from.
export function parseClioInfo(text) {
  const pick = (label) => (new RegExp(String.raw`^\s*(?:\[\w+\]\s*-\s*)?${label}:\s*(.+?)\s*$`, "m").exec(text) || [])[1] || null;
  return { clio: pick("clio"), gate: pick("gate"), settingsFile: pick("settings file path") };
}

export function readStandUri(settingsFile, environment) {
  if (!settingsFile || !existsSync(settingsFile)) return unknown("clio settings file not found");
  try {
    const envs = JSON.parse(readFileSync(settingsFile, "utf8")).Environments || {};
    const key = Object.keys(envs).find((k) => k.toLowerCase() === environment.toLowerCase());
    return key ? envs[key].Uri || unknown("no Uri in the environment entry") : unknown(`environment '${environment}' is not registered`);
  } catch {
    return unknown("clio settings file is not valid JSON");
  }
}

// `clio get-info` prints log lines around one JSON report; the report is the span from the first `{` to the last `}`.
export function parseStandReport(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const firstErrorLine = (text) => (text || "").split(/\r?\n/).map((l) => l.replace(/^\s*\[\w+\]\s*-\s*/, "").trim()).find(Boolean) || "no output";

export function readStand(environment, run) {
  const r = run("clio", ["get-info", "-e", environment], STAND_TIMEOUT_MS);
  const report = r.ok ? parseStandReport(r.out) : null;
  if (!report) return { error: r.error || firstErrorLine(r.out) };
  const framework = report.frameworkDescription || report.frameworkKind;
  return {
    coreVersion: report.coreVersion || unknown("not in the stand report"),
    productName: report.productName || unknown("cliogate not installed"),
    dbEngine: report.dbEngineType || unknown("needs CanManageSolution or cliogate"),
    framework: framework || unknown("needs CanManageSolution or cliogate"),
  };
}

export function collect({ environment, root = PLUGIN_ROOT, run = defaultRun } = {}) {
  const info = run("clio", ["info"]);
  const clio = info.ok ? parseClioInfo(info.out) : { clio: null, gate: null, settingsFile: null };
  const clioMissing = unknown(info.error || "clio info failed");
  const d = {
    skillVersion: readSkillVersion(root),
    git: readGitRef(root, run),
    clioVersion: clio.clio || clioMissing,
    gateVersion: clio.gate || clioMissing,
    environment: environment || unknown("no --environment given"),
  };
  if (!environment) return d;
  d.uri = readStandUri(clio.settingsFile, environment);
  d.stand = readStand(environment, run);
  return d;
}

const tick = (v) => (v.startsWith("unknown (") ? v : `\`${v}\``);

export function render(d) {
  const ref = d.git ? ` · branch ${d.git.branch ? tick(d.git.branch) : "detached"} · commit ${tick(d.git.commit)}` : "";
  const lines = [
    "### Run diagnostics",
    "",
    `- **Skill:** classic-to-freedom-migration ${tick(d.skillVersion)}${ref}`,
    `- **clio:** ${tick(d.clioVersion)} (CLI on PATH) · bundled cliogate ${tick(d.gateVersion)}`,
    `- **Environment:** ${tick(d.environment)}${d.uri ? ` · ${tick(d.uri)}` : ""}`,
  ];
  if (d.stand?.error) {
    lines.push(`- **Stand:** ${unknown(d.stand.error)}`);
  } else if (d.stand) {
    const s = d.stand;
    lines.push(`- **Stand:** Creatio ${tick(s.coreVersion)} · product ${tick(s.productName)} · DB ${tick(s.dbEngine)} · ${tick(s.framework)}`);
  }
  return lines.join("\n") + "\n";
}

export function parseArgs(argv) {
  const i = argv.indexOf("--environment");
  return { environment: i >= 0 ? argv[i + 1] : undefined };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(render(collect(parseArgs(process.argv.slice(2)))));
}
