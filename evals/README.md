# Eval suite

Cases for `claude plugin eval`: each folder holds a `prompt.md` (the request, written the way a
developer would ask it, without naming a skill) and `graders/` (one criterion per file, judged
pass/fail by an LLM, plus a `tool_used` check that the expected skill fired).

The `ui-*` cases measure the design judgement of `skills/creatio-ui-guidelines`: grouping by the
user's task, record state on the first screen, column balance, metrics that answer a question,
template choice for a thin object, and interface copy. They are text-only — the agent describes
the page, it does not build it — so they do not see rendering defects.

Run from the repository root:

```sh
claude plugin eval . --tag ui-guidelines --runs 3 --ablation none --judge-model sonnet \
  --concurrency 3 --no-publish
```

- `--ablation with-without` adds a run without the plugin, to see what the skill adds.
- To compare two versions of the skill, run the suite on each checkout with its own
  `--output-dir` and compare the `aggregate-result.json` files.
- Results land in `evals/results/`, which is not tracked.
