# The Reference cache task (step 7)

You are the run's first task: one read-only sub-agent that fetches, ONCE, what every later builder
would otherwise re-fetch, and writes it into the task's `refs/` folder. Every other task depends on
yours.

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
