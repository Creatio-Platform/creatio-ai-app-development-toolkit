#!/usr/bin/env node
// Supply-chain AUTHENTICITY anchor for the vendored parser (the missing half of verify-vendor.mjs).
//
// verify-vendor.mjs proves tamper-EVIDENCE *within the repo* — the vendored file matches the SHA-256 recorded
// in vendor/provenance.json. But that pin lives in the SAME commit as the file it pins, so a determined attacker
// who edits BOTH the file and the pin in one commit passes it (and the weekly OSV audit, which queries by the
// self-declared version). This script closes that gap: it independently fetches `<package>@<version>` from the
// public npm registry, verifies the tarball against the registry's OWN published `dist.integrity` (sha512),
// extracts the pinned dist file, LF-normalizes it, and asserts its SHA-256 equals the pinned one — so
// provenance.json can no longer *assert* an upstream hash it was never checked against.
//
// Self-contained: fetch + node:zlib (gunzip) + a tiny in-process ustar reader — no `npm`/`tar` CLI (Node 20+
// won't spawn npm.cmd without a shell, and this must run identically on Linux and Windows). Network-dependent,
// so it is a CI job, NOT part of the offline zero-dependency golden suite.
//
// Exit 0 = every pin matches its upstream npm artifact. Exit 1 = a mismatch, or a network/registry failure — an
// authenticity gate that silently passed on a fetch failure would be worse than none; re-run on a real outage.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MANIFEST = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor", "provenance.json");
const sha256Lf = (buf) =>
  createHash("sha256").update(Buffer.from(buf.toString("utf8").replaceAll("\r\n", "\n"), "utf8")).digest("hex");

// In-tarball path of the vendored file: parsed from `upstreamArtifact` ("… -> package/dist/acorn.mjs"),
// else the npm convention `package/dist/<name>`. npm tarballs root every entry under `package/`.
const tarPathOf = (name, pin) => {
  const arrow = typeof pin.upstreamArtifact === "string" ? pin.upstreamArtifact.split("->").pop().trim() : "";
  return arrow.startsWith("package/") ? arrow : `package/dist/${name}`;
};

// Minimal ustar reader: walk 512-byte blocks, return the bytes of the first entry whose full path matches.
// Handles the ustar `prefix` field (long paths) and skips PAX/global extended headers ('x'/'g') by size.
function readTarEntry(tar, wanted) {
  for (let off = 0; off + 512 <= tar.length;) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // two zero blocks mark end-of-archive
    const str = (start, len) => header.toString("utf8", start, start + len).replace(/\0.*/s, "").trim();
    const name = str(0, 100), prefix = str(345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(str(124, 12) || "0", 8) || 0;
    const type = String.fromCodePoint(header[156]);
    const dataOff = off + 512;
    if ((type === "0" || type === "\0" || type === "") && full === wanted) return tar.subarray(dataOff, dataOff + size);
    off = dataOff + Math.ceil(size / 512) * 512; // advance past this entry's data (also skips 'x'/'g' headers)
  }
  return null;
}

// Verify the tarball against the registry's published Subresource-Integrity string (e.g. "sha512-<base64>").
function integrityOk(tarball, integrity) {
  const m = /^([a-z0-9]+)-(.+)$/.exec(String(integrity || ""));
  if (!m) return false;
  try { return createHash(m[1]).update(tarball).digest("base64") === m[2]; } catch { return false; }
}

// Anchor ONE pin to upstream npm: fetch <package>@<version>, verify the tarball against the registry's
// own dist.integrity, extract the pinned dist file and assert its LF-normalized SHA-256 matches. Logs the
// verdict; returns true on a match, false on any mismatch / network / registry failure. (Kept out of main()
// so the per-pin fetch/verify branches don't stack up as one big function.)
async function anchorPin(name, pin) {
  const spec = `${pin.package}@${pin.version}`;
  try {
    const meta = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pin.package)}`, { headers: { accept: "application/json" } });
    if (!meta.ok) throw new Error(`registry HTTP ${meta.status}`);
    const dist = (await meta.json())?.versions?.[pin.version]?.dist;
    if (!dist?.tarball) throw new Error(`version ${pin.version} not found in registry`);
    const tgzRes = await fetch(dist.tarball);
    if (!tgzRes.ok) throw new Error(`tarball HTTP ${tgzRes.status}`);
    const tgz = Buffer.from(await tgzRes.arrayBuffer());
    if (dist.integrity && !integrityOk(tgz, dist.integrity)) throw new Error("tarball failed the registry's own dist.integrity check");
    const inTar = tarPathOf(name, pin);
    const entry = readTarEntry(gunzipSync(tgz), inTar);
    if (!entry) throw new Error(`'${inTar}' not found in ${spec} tarball`);
    const upstream = sha256Lf(entry);
    if (upstream === pin.sha256) {
      console.log(`  ✓ ${name}: pinned SHA-256 matches upstream npm ${spec} (${upstream.slice(0, 16)}…)`);
      return true;
    }
    console.error(`  ✗ ${name}: pinned SHA-256 does NOT match upstream npm ${spec}`);
    console.error(`      pinned   ${pin.sha256}`);
    console.error(`      upstream ${upstream}`);
    console.error(`      The vendored bytes (or the pin) diverge from what npm publishes for ${pin.version}. Re-vendor from the real release.`);
    return false;
  } catch (e) {
    console.error(`  ✗ ${name}: could not anchor ${spec} to upstream npm (${e.message})`);
    return false;
  }
}

async function main() {
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST, "utf8")); }
  catch (e) { console.error(`verify-vendor-upstream: cannot read ${MANIFEST}: ${e.message}`); return 1; }
  const files = manifest.files || {};
  const names = Object.keys(files);
  if (!names.length) { console.error("verify-vendor-upstream: provenance.json lists no files — nothing to anchor"); return 1; }

  let failed = 0;
  for (const name of names) if (!(await anchorPin(name, files[name]))) failed++;
  if (failed) { console.error(`\nverify-vendor-upstream: ${failed} of ${names.length} pin(s) NOT anchored to upstream npm`); return 1; }
  console.log(`verify-vendor-upstream: ${names.length} pin(s) anchored to upstream npm`);
  return 0;
}

// Export the pure helpers so an OFFLINE test can exercise the hand-rolled ustar reader / integrity check
// without the live-network CI job; run the CLI only when invoked directly (not on import).
export { readTarEntry, integrityOk, tarPathOf, sha256Lf };
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exit(await main());
