# Remediation Workflow

Use this workflow only after the log analysis has identified confirmed incidents.

## Principles

- Treat `clio MCP` as the source of truth for tool names, required parameters, examples, output shapes, and canonical flows.
- Prefer fixing the contract, examples, or behavior in CLIO instead of teaching ADAC extra compensating logic.
- Prefer removing stale or misleading assumptions from ADAC when CLIO can supply the authoritative behavior.
- Keep ADAC fixes for ADAC-local concerns only:
  - local parsing of exported logs
  - UI wording and reporting
  - orchestration around presentation of evidence
  - non-contract local heuristics

## Required user confirmation

Before planning or implementing any CLIO-side fix, ask the user to confirm the absolute path to the CLIO source tree.

Do not guess it from a session log unless the user explicitly says that path should be used.

## CLIO repo update policy

After the user confirms the CLIO source path:

1. Inspect the current branch.
2. If already on `master`, pull the latest remote state.
3. If on a feature branch, fetch the latest `master` and bring the branch up to date with it before coding.
4. Do not create a new branch automatically unless the user explicitly asks.
5. Do not push automatically after making changes.

## Planning ownership

For every confirmed incident, assign one of:

- `CLIO`
- `ADAC`
- `Both`

Use these rules:

- `CLIO`: contract mismatch, missing required parameter documentation, bad examples, wrong canonical sequence, inconsistent response shape, insufficient error message, or missing helper capability that should live with the tool provider
- `ADAC`: bad summary logic, wrong counting, poor log parsing, wrong assumptions about what happened in a session, poor presentation, or local non-authoritative heuristics
- `Both`: CLIO needs a source fix and ADAC must remove a workaround or update its expectations

## Recommended remediation sequence

1. Confirm the CLIO path.
2. Update the CLIO checkout to the latest relevant state.
3. Use sub-agents in parallel for root-cause mapping:
   - one agent inspects CLIO ownership candidates
   - one agent inspects ADAC ownership candidates
   - one agent proposes the smallest proving test matrix
4. Review the split and choose the CLIO-first path when the incident touches contract truth.
5. Implement fixes.
6. Run tests.
7. Summarize what changed in CLIO and what was simplified or removed in ADAC.
8. Ask the user whether to push now or whether they want to test first.

## Test policy

After making changes:

- run the narrowest relevant tests first
- if the touched area is contract or transport related, add or run coverage that proves the contract shape
- if ADAC parsing changed, verify on at least one real exported session log
- if CLIO examples or docs changed, verify the new example against the real tool behavior whenever possible

Do not claim the fix is complete if tests were not run. Say exactly what was and was not verified.

## Push policy

Always ask before:

- pushing commits
- opening a PR
- changing remote state in CLIO or ADAC repos

Good prompt style:

- “I’ve made the fixes and run the local checks. Do you want me to commit and push them now, or would you rather test locally first?”
