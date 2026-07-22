#!/usr/bin/env node
// CI guard (Minor 1, PR #50): every `sonar.exclusions` glob in `.sonarcloud.properties` must still
// match >=1 real file, so a rename/move that silently voids an exclusion — re-surfacing the ~100
// fixture false-positives the exclusion exists to suppress — fails LOUDLY instead of no-op'ing.
//
// Window-safe: a glob whose literal base directory does not exist yet (forward-provisioned for a not-
// yet-merged PR, e.g. the Classic->Freedom engine paths) is SKIPPED, not failed — it only starts being
// enforced once that base dir lands on the branch. Zero dependencies (Node fs only).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = path.join(root, ".sonarcloud.properties");
if (!existsSync(cfg)) {
  console.log("check-sonar-exclusions: no .sonarcloud.properties present — nothing to check.");
  process.exit(0);
}

const line = readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => l.trimStart().startsWith("sonar.exclusions="));
const globs = line ? line.slice(line.indexOf("=") + 1).split(",").map((s) => s.trim()).filter(Boolean) : [];
if (!globs.length) {
  console.log("check-sonar-exclusions: no sonar.exclusions globs — nothing to check.");
  process.exit(0);
}

// literal prefix before the first wildcard -> the base dir that must exist for the glob to be "active"
const baseDir = (glob) => {
  const star = glob.indexOf("*");
  const lit = star === -1 ? glob : glob.slice(0, star);
  const dir = lit.endsWith("/") ? lit.slice(0, -1) : path.posix.dirname(lit);
  return dir === "." ? "" : dir;
};
// minimal glob -> anchored regex: `**` spans directories, `*` stays within a path segment.
const toRegex = (glob) => {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "*" && glob[i + 1] === "*") { re += "(?:.*)"; i++; if (glob[i + 1] === "/") i++; }
    else if (glob[i] === "*") re += "[^/]*";
    else re += glob[i].replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
  }
  return new RegExp("^" + re + "$");
};
const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return acc;
};

const files = walk(root);
let failed = 0, skipped = 0;
for (const glob of globs) {
  const base = baseDir(glob);
  if (base && !existsSync(path.join(root, base))) {
    console.log(`  ⏭  ${glob} — base '${base}/' absent (forward-provisioned); skipped`);
    skipped++;
    continue;
  }
  const rx = toRegex(glob);
  const n = files.filter((f) => rx.test(f)).length;
  if (n > 0) {
    console.log(`  ✓ ${glob} — ${n} file(s)`);
  } else {
    console.error(`  ✗ ${glob} — matches ZERO files though its base dir exists: the exclusion is a silent no-op (rename/drift?). Fix the glob or the path.`);
    failed++;
  }
}
if (failed) {
  console.error(`\ncheck-sonar-exclusions: ${failed} glob(s) match nothing while their base dir exists — failing loud (Minor 1, PR #50).`);
  process.exit(1);
}
console.log(`check-sonar-exclusions: OK (${globs.length - skipped} active, ${skipped} forward-provisioned).`);
