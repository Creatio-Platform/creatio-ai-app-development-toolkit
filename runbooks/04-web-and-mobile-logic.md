# Web and mobile logic in one request

This runbook extends `runbooks/04-mobile-business-logic.md` for a request that needs the same
behaviour on a Freedom UI web page and on its mobile page. Runbook 04 stays the process: its
preflight, its gates, its plan and report formats. This one says what changes when the logic has a
web part, and how the work is split so that no agent has to hold both platforms in its context.

A request for logic on a web page only is not this flow: the web page body owns it, through clio
`get-guidance name=page-schema-handlers`.

## What is shared and what is not

- **Shared:** the rule itself — a plain function that takes values and returns a result — and the
  behaviour table, the inputs with the outcome each must produce. Both parts run the same table.
- **Per platform:** the mechanism. A web page has validators, converters and handlers in its body;
  a mobile page has none of them and gets a remote module instead. Choose each part's mechanism with
  its own rules: `page-schema-handlers` ("Business rules first", "Decision tree") for the web part,
  step 3 of runbook 04 for the mobile part. A web field validator and a blocking mobile save handler
  can deliver the same rule.
- **One Gate L and one Gate D** cover both parts. The developer approves one behaviour, not two.

## Who does what

The **lead agent** — the one the developer talks to — owns the request, both gates, the rule, the
behaviour table, every write to the environment and the telemetry. It reads runbook 04 with the files
its load order names, this runbook, and the results its helpers return. It does not read the web
mechanics — clio `page-schema-handlers` and the web page body — nor the parts of
`context/mobile-sdk/` the helpers use; those stay in the helpers' contexts.

Each **helper** is a subagent started for one platform and one phase. A helper:

- reads the documents its brief names and nothing it does not need;
- never writes to the environment — `get-page`, `validate-page` and `update-page` with
  `dry-run: true` are allowed, a save is not;
- never asks the developer anything: a question it cannot settle goes back in its result;
- returns the result block for its phase and nothing else, so the lead's context grows by the result,
  not by what the helper read.

Run the two helpers of a phase at the same time. They share no files: the web helper writes only
under `<workspace>/.logic-run/web/`, the mobile helper only in the module project, the staged script
and `<workspace>/.logic-run/mobile/`.

When the host cannot start subagents, the lead does each helper's work itself, one platform after the
other, and writes each result block to `<workspace>/.logic-run/<phase>-<platform>.md` before it moves
on, so a context that is compacted mid-run can be rebuilt from those files. Before the workspace exists,
write them to a scratch folder and move them in at step 5.

## Phase 1 — inspection, before Gate L

Replaces step 2 of runbook 04 for the pages. The lead keeps steps 2.4 (the SDK declarations) and 2.5
(names and facts) for itself.

**Web helper brief.** The web page schema name and the environment. Read `get-guidance
name=page-schema-handlers`; read the page with `get-page` into a scratch folder; for the behaviour
the request describes, find the attributes and components it uses, the handlers, validators and
converters the page already has on them, and the mechanism the guidance chooses.

**Mobile helper brief.** The mobile page schema name and the environment. Follow steps 2.1, 2.2, 2.3,
2.6 and 2.7 of runbook 04 and choose the mechanism with its step 3.

**Result block (each helper):**

```
Inspection — <web | mobile> — <page schema name>
Package       <page.packageName>
Attributes    <name: what it holds> …
Components    <name: what it shows> …
Already there <handler, validator or converter on the same attributes or requests, with its package>
Mechanism     <what the part will use, in one line per behaviour>
Cannot do     <behaviour this platform cannot deliver, with the alternative; "nothing">
Questions     <what only the developer can answer; "none">
```

The lead answers or asks the questions, then presents one logic plan in runbook 04's format: "Where"
names the web pages and the mobile pages, and every line of "How" and "Page changes" says which part
it belongs to (`[web: …]`, `[mobile: …]`). "Not covered" lists what either platform cannot do.

## Phase 2 — build, between Gate L and Gate D

The lead creates the workspace and brings in the packages (step 5 of runbook 04) and writes the rule
function and the behaviour table to `<workspace>/.logic-run/rule.md`. Then it starts both helpers.

**Web helper brief.** The approved plan's web lines, the rule file, the page schema name, the
environment and the workspace path. Write the web page change as `page-schema-handlers` says, with
the rule inside it as written in the rule file. Run the behaviour table on the rule as the web
handler calls it, with a stub of what the handler reads from the page. Save the change as a file,
then run `validate-page` and `update-page` with `dry-run: true` on it.

**Mobile helper brief.** The approved plan's mobile lines, the rule file, the page schema names, the
environment and the workspace path. Follow steps 5.3 to 7 of runbook 04: create and build the
module, run the behaviour check, stage the script, prepare the mobile page change and dry-run it.

**Result block (each helper):**

```
Build — <web | mobile>
Files         <path of each prepared page change; for mobile also the staged main.js and its size>
Table         <n> rows, <n> passed — <each failed row with what it produced>
Dry run       <page: what it would add and replace, warnings> …
Validate      <page: passed | findings>
Not done      <anything the brief asked for that is not finished, and why; "nothing">
```

A failed row, a dry-run warning that the save would be rejected, or anything under "Not done" goes
back to the same helper to fix; it is never carried into the delivery plan as a caveat.

## Gate D and delivery

The lead presents one delivery plan in runbook 04's format. "Pages that change" lists the web pages
and the mobile pages with each dry-run result; a web page change is live for every user as soon as
it is saved, a mobile one after the next synchronization. After approval the lead delivers in this
order, using the files the helpers prepared:

1. `push-workspace` and the confirmation of the script (step 9 of runbook 04, items 1 and 2);
2. `update-page` for each mobile page, then for each web page, each followed by `validate-page`.
   `mode: append` merges handlers by their `request` and replaces an existing handler for the same
   request. When the web page already has a handler for a request the new logic handles, save the
   full body instead, with the `checksum` from the `get-page` the change was made on, and confirm in
   the read-back that the existing handler is unchanged;
3. `restore-workspace` when the pages sit in a package the workspace holds ("A module inside an
   existing package", item 4).

A page's package may hold both its web and its mobile page. The push re-installs that package from
the workspace copy, so every page change is saved after the push, never before it.

## Checks and report

- **Web.** The lead checks the web page in a browser when the session has one, following clio
  `core-rules` on browser verification: one step per row of the behaviour table. Without a browser,
  the steps go to the developer with the device check.
- **Mobile.** The device check of runbook 04, unchanged.

The report is runbook 04's, with a `Web` line per page and the result of the browser check. Telemetry
stays `workflow: "mobile-business-logic"`; `work_item_completed` with `variant=page` is sent once per
page, web pages included.
