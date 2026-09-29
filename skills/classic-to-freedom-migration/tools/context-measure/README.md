# context-measure

Says where a migration run's context comes from, so two runs of the same migration can be compared.
It reads a `/share-session` export and reports:

- **Driver session** — API messages, context at the first message, at the peak and summed over all
  messages; where the skill body was loaded; the first build `--start` and the plan/build split of
  the summed context.
- **Skill files read** — every `SKILL.md` / `references/*.md` / `docs/*.md` / `engine/README.md`
  touched by the driver or a sub-agent, with the message it happened at and the tool used.
- **Sub-agents** — kind (from the brief its prompt names), messages, start-up and peak context, the
  skills it invoked, and whether it loaded the migration skill body, `SKILL.md` or
  `orchestrate-build.md`.
- **clio MCP results** — characters, calls and the largest single result per clio command
  (`clio-run` unwrapped; `[output-file]` marks a call that wrote to a file), and how many calls
  repeated the same arguments inside one context.
- **What the big clio responses are made of** — the share of `documentation` in
  `get-component-info` / `get-request-info`, of `viewConfigDiffOps` in `get-page` / `update-page`,
  of each section in `get-tool-contract`, and the most repeated `validate-page` warning.

```bash
python3 context_measure.py <export-dir> [--main <driver.jsonl>] [--format md|json]
```

The export directory holds the driver transcript `<session-id>.jsonl` (or `transcript.jsonl`) and a
`<session-id>/` folder with `subagents/` and `workflows/`. Pass `--main` when the directory holds
more than one transcript.

Context is counted once per API message (`message.id`): one message is stored as several JSONL
records that repeat the same `usage` block, and summing records overstates it. Characters are the
tool-result text as the model received it. This tool does not price tokens — that is cost-counter's
job.
