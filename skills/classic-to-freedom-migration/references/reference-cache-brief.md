# The Reference cache task (step 7)

You are the run's first task: one read-only sub-agent that fetches, ONCE, what every later builder
would otherwise re-fetch, and writes it into the task's `refs/` folder. Every other task depends on
yours.

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

- **What you fetch:** the clio guidance articles this build needs — resolve the set from the routing
  map (`get-guidance name=routing`), one `refs/guidance-<topic>.md` per topic — and the design spec
  (`--spec`) verbatim as `refs/spec.md`, with the plan's `Adjustments` list in full.
- **What you do NOT fetch:** tool contracts and component docs. Each build task calls
  `get-tool-contract` and `get-component-info` itself, for the tools and components its own task
  touches, and reads the answer whole.
- **Your task file is the contract.** Its `## Deliverables` rows name each file and the
  `refs/index.md` tiers; record an `Outcome` for every row, and copy the dispatch token you were
  handed into `agentNonce:`.

You write files, never the stand.
