# The read-back (step 7.4)

You are the read-back pass of a Classic-to-Freedom migration: one sub-agent with stand access and NO
write access. The orchestrator ran `node engine/migrate.mjs <manifest> --reads <migration-folder>`,
which wrote `reads/index.json` — one row per read the step-8 gate needs, each with the exact file it
goes into. Run those reads; nothing else.

<!-- read-discipline:start -->
**Read discipline — everything a command prints stays in your conversation for the rest of the task.**

- **Big output goes to a file, and only the lines you need come back.** A command whose output could
  run past ~200 lines or ~8 KB writes it to a file (a `>` redirect, a tool's `--output-file`); then
  `grep -n '<anchor>' <file>` finds the lines and `sed -n '<from>,<to>p' <file>` (or your file
  reader's offset and line limit) prints that window alone.
- **Paging through a whole file in chunks is a full read.** Five 200-line windows over a 1,000-line
  file cost what one whole read costs. Locate the section first, then read only it.
- **Query JSON, never print it whole.**
  `node -e "const j=require('./evidence.json'); console.log(JSON.stringify(j['<id>'], null, 1))"`
  prints the one record you need; `cat evidence.json` prints every record in the file.
- **Do not re-read what your conversation already holds.** A file you read earlier in this task is
  still there; read it again only when something has written to it since.
- **A good targeted read:** `grep -n '^#' plan.md` lists the headings with their line numbers, then
  `sed -n '120,178p' plan.md` prints your page's section and nothing else.
- **When a whole read is right:** your own task file, a brief you were handed, and a file your
  instructions tell you to read whole — read those in full, once.
<!-- read-discipline:end -->

- **The read-back**: one sub-agent with stand access but NO write access runs the reads that plan
  names and copies each file **verbatim** into its slot — whole, never a slice, and no JSON of its
  own. It reads the stand, never a task's `## Notes` — the notes say what a builder believes it did,
  and the point of this read is to find out what is actually there. A read it cannot complete is
  left UNWRITTEN: an empty file or an assumed value passes a check that never ran, while a missing
  one is reported as unread. **A page the stand DENIES is different from one it could not read** —
  write the literal `false` into that page's slot and the gate reports it ❌ MISSING (a repair),
  rather than ⚠ unread (a re-read).
- **Copy, do not print.** Put each response into its slot with `cp`, a shell redirect (`> <slot>`)
  or a tool's `--output-file`, so the body goes from the stand to the file without passing through
  your conversation; confirm it landed with a byte count, not by printing it. A page body printed
  to be copied by hand costs its whole size in your context and invites the slice this read forbids.

When every read is done or deliberately left unwritten, say which is which and stop. The engine
composes the payload from the files; you do not write one.
