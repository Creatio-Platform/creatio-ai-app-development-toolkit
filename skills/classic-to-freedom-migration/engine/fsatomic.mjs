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

// TWO RETRY BUDGETS, because the two callers can afford different answers to a busy file.
// The record-file merge (`reads.mjs`) is opportunistic: a file it cannot replace is left to the other writer and
// reported, and the mode still answers. It tries RENAME_ATTEMPTS times, pausing 25, 50, 75 ms (about 150 ms).
export const RENAME_ATTEMPTS = 4;
export const MERGE_RENAME = Object.freeze({ attempts: RENAME_ATTEMPTS, pauseMs: (attempt) => 25 * attempt });
// A LEDGER write (`writeFileAtomic`) has no such fallback: the caller needs the file to hold the new text, and the
// in-place write it replaced succeeded wherever the file could be opened at all. An antivirus scan or an editor
// holds a file for a moment longer than the merge waits, so a ledger write waits about 1.6 s, the pause doubling
// from 25 ms up to 400 ms, before it gives up with `FileBusyError`.
export const LEDGER_RENAME = Object.freeze({ attempts: 8, pauseMs: (attempt) => Math.min(25 * 2 ** (attempt - 1), 400) });

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

// Whether the rename happened within `budget`. Any error other than a busy file is thrown to the caller.
export function renameWithRetry(temp, full, budget = MERGE_RENAME) {
  for (let attempt = 1; attempt <= budget.attempts; attempt++) {
    try {
      fs.renameSync(temp, full);
      return true;
    } catch (e) {
      if (!isRenameLockError(e)) {
        throw e;
      }
      if (attempt < budget.attempts) {
        pauseSync(budget.pauseMs(attempt));
      }
    }
  }
  return false;
}

// A ledger file another process kept open through the whole ledger budget. Its message is the refusal a person
// reads, so a caller that only prints `e.message` still names the file and the remedy. `code` stays EBUSY, the
// code a caller testing for a busy file already checks.
export class FileBusyError extends Error {
  constructor(file) {
    super(`another process holds ${file}; re-run`);
    this.code = "EBUSY";
    this.file = file;
  }
}

// Replaces `full` with exactly `text` (the same bytes `fs.writeFileSync(full, text)` would write), or throws and
// leaves `full` as it was. A target that stays busy through the ledger budget throws `FileBusyError`: the caller
// asked for the file to hold `text`, and returning normally would tell it that it does. The temp file never
// outlives the call.
export function writeFileAtomic(full, text) {
  const temp = tempPathFor(full);
  try {
    fs.writeFileSync(temp, text);
    if (!renameWithRetry(temp, full, LEDGER_RENAME)) {
      throw new FileBusyError(full);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
