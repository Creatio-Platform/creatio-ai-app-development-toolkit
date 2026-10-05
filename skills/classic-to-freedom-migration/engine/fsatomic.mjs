// ATOMIC FILE REPLACEMENT — the one way the engine replaces a file another process may be reading.
//
// A plain `fs.writeFileSync` truncates the target first and then writes it, so a process killed in between leaves
// an empty or half-written file where the previous one stood. Writing to a temp file IN THE SAME FOLDER and
// renaming it over the target instead means a reader, and the next run, sees the old file or the new one and never
// a fragment of either: a rename within one folder replaces the target in a single step on NTFS and POSIX alike.
//
// Kept apart from `reads.mjs` and `tasks.mjs` because both need it and neither is about file handling: `reads.mjs`
// merges record files, `tasks.mjs` owns the task ledger, and `reads.mjs` already imports `tasks.mjs`.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

// How many times a rename the OS refused because another process holds the file is tried, with a short pause
// growing by RENAME_BACKOFF_MS each time, before the file is left to that process.
export const RENAME_ATTEMPTS = 4;
const RENAME_BACKOFF_MS = 25;

// The rename errors Windows raises while another process has the target open (an editor, an indexer, a builder
// mid-write). They are a busy file, not a broken folder, so the rename is tried again rather than failing the mode.
const RENAME_LOCK_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
export const isRenameLockError = (e) => RENAME_LOCK_CODES.has(e?.code);

// Blocks this thread for `ms` without spinning. The engine is synchronous end to end, so there is no event loop
// turn to wait on.
export const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A temp path beside `full`, unique per call: a dot-prefixed `.tmp` name, so no reader that lists the folder by
// extension (`*.md`, `*.json`) ever mistakes it for the file it will become.
export const tempPathFor = (full) => path.join(path.dirname(full),
  `.${path.basename(full)}.${process.pid}.${Date.now()}.${randomBytes(3).toString("hex")}.tmp`);

// Whether the rename happened. Any error other than a busy file is thrown to the caller.
export function renameWithRetry(temp, full) {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(temp, full);
      return true;
    } catch (e) {
      if (!isRenameLockError(e)) throw e;
      if (attempt < RENAME_ATTEMPTS) pauseSync(RENAME_BACKOFF_MS * attempt);
    }
  }
  return false;
}

// Replaces `full` with exactly `text` (the same bytes `fs.writeFileSync(full, text)` would write), or throws and
// leaves `full` as it was. A target that stays busy through every rename attempt throws too: the caller asked for
// the file to hold `text`, and returning normally would tell it that it does. The temp file never outlives the call.
export function writeFileAtomic(full, text) {
  const temp = tempPathFor(full);
  try {
    fs.writeFileSync(temp, text);
    if (!renameWithRetry(temp, full)) {
      throw Object.assign(new Error(`${full} was not replaced: another process kept it open through ${RENAME_ATTEMPTS} attempts`),
        { code: "EBUSY" });
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
