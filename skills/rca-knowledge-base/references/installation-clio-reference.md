# Installation — clio reference (the API-driven delivery channel, and its own failure modes)

**Not a case file, and not part of the spine's §5.1 search.** This file holds the behaviour of the
**external command-line client** a delivery can be driven through — what it is, which of its operations the
environment records and which it does not, what it leaves undone unless told, and why a failure reported by
the client is often not a failure of the delivery.

Opened **on demand**, whenever the incident says the delivery was driven from a command line against a
*running* site: a CI/CD step, a deployment script, a developer or support engineer pushing a package by
hand. The pipeline itself — stages, transactionality, backup — is `installation-pipeline-reference.md`;
the other command-line channel is `installation-workspaceconsole-reference.md`; **this file is only what
this client adds on top.**

Verification tags per statement, as elsewhere: **`[observed]`** (reproduced on a connected environment, read
named) and **`[unverified here]`** (product behaviour, not reproduced here). **Everything below starts as
`[unverified here]` except where marked**, because the client runs on a machine this agent cannot read and
is not part of the product. That is the honest tier for most of this file, and it belongs in the report
rather than glossed over.

---

## 1. What it is, and why that explains most of its failures

It is **a client of the running site**, not a second copy of the platform. It authenticates over the site's
web API and asks the site to do the work — install this package, rebuild the configuration, restart the
application. The site performs the delivery exactly as it would for a request from the browser.

That single fact separates it from the other command-line channel, and the separation is the first thing to
establish in an incident, because the two produce opposite evidence:

| | This client | WorkspaceConsole |
|---|---|---|
| Where the work happens | **inside the running site's process** | in a separate process, on the machine it runs on |
| The site must be up | **yes** | no — it works against a stopped site |
| Who the work is attributed to | the **authenticated user** it logged in as | the account the process runs under |
| What the environment records | an activity-log record for the operations that go through the delivery services (§3) | usually nothing |
| What a client-side error proves | often nothing about the delivery (§7) | the run itself failed |

Four consequences that produce most of the reports:

1. **The site does the work, so the site's own limits apply** — its timeouts, its request size limits, its
   user permissions. A delivery that is refused is refused by the site, and the refusal is readable there.
2. **It is attributed to a user.** Whatever it changes is recorded against the account it authenticated as,
   which is why the delivery's record has a person's name on it and not a service account's — unless a
   service account was configured.
3. **It performs one operation per invocation**, and the *sequence* is the caller's responsibility (§6). A
   script that pushes a package and stops there has delivered a package and finished nothing.
4. **It is not part of the product.** Its version, its configuration and its behaviour are outside what any
   read here can establish, and outside what the product's own release notes describe. A claim about what
   the client did is a claim about software this agent cannot inspect.

---

## 2. The named-environment registry, and the failure it produces

The client keeps a local list of environments — a name, the site's URL, and credentials — and every
operation is aimed at one of them by name. Nothing about that list is readable from a site.

**The failure mode is the same shape as pointing the other channel at the wrong directory: the delivery
succeeds, somewhere else.** A stale entry, a name reused after a site moved, or a default environment left
over from another task sends the package to a site nobody is looking at. The report is always *"we
installed it and nothing changed"*, and the environment they are watching is telling the truth: nothing
did.

**The read that settles it is on the other side.** Ask which environment name the run used and what URL that
name resolves to on the machine that ran it; then confirm on the site that is actually failing whether any
delivery record exists in that window at all (spine §2.1). **A delivery with no record and no footprint is
consistent with a delivery that landed elsewhere** — say so as a possibility to rule out, not as a finding.

---

## 3. Which operations the environment records — and which it does not

This is the section the investigation actually needs, because it decides whether there is anything to read.

- **An application push leaves a full record.** `[observed]` — the application-level install goes through the
  same service the application UI uses, so it produces a `ConfActivityLog` record with children, **and it
  always attaches an installer log**; on a delivery that replaced existing packages it attaches the
  package-level backup archive as well, exactly as an install started from the UI does. The spine's §2.1
  finds it by the ordinary caption set, and the evidence protocol applies unchanged.
- **Other delivery operations frequently leave no attachment at all.** `[observed]` — verified on an
  environment carrying tens of thousands of activity-log rows with **zero** file attachments, while still
  writing child rows whose own `Operation` names the stage. When the log file is missing, the stage is read
  off the child rows (spine §2.4), not asked for.
- **Some operations leave no parent row either.** A delivery can appear only as a **cluster** of
  `Install data`, `Generate source code`, `Update database structure`, `Generation of runtime metadata of
  entity schema` or localization `Update` rows inside one time window, with nothing above them. The spine's
  §2.1 owns that search; do not conclude "no delivery happened" from an empty caption query.

**So the first question is not "what did the client report" but "what did the environment record".** Establish
that before asking anyone for console output.

---

## 4. Authentication, permissions, and what a refusal looks like

The client signs in as a user, so **the delivery inherits that user's rights**, and the refusal is the
site's own.

**Two system-operation rights govern every delivery operation on this channel, and either one is enough:
`CanManageSolution` or `CanInstallApplication`.** `[unverified here]` An account holding neither is refused
before any work begins; the refusal names both codes in its message, so the paste a user brings usually
identifies the missing right without anyone having to look it up. **A separate restriction — the user being
barred from system operations outright — refuses first and for a different reason**, so an account that
*has* one of the two rights can still be turned away. Settle which by reading the account's system-operation
permissions on the environment.

**The refusal arrives as HTTP 403 *and* as a failure payload.** `[unverified here]` Both signals are
present, which matters when reading someone's script: a caller that checks only the response body sees the
failure, and so does one that checks only the status. Neither can miss it, so *"the script reported
success"* is not consistent with a permission refusal — look elsewhere.

Two shapes worth separating in a report:

- **Authentication failed** — the client never got in. Nothing reached the site, nothing is recorded, and
  the absence of a record is evidence *for* this explanation rather than against it.
- **Authenticated, then refused** — the account exists but lacks both rights. The site refused it, and the
  account is named in what the caller saw.

A credential that expired, a password rotated since the script was written, and a site that moved behind a
different authentication scheme all land in the first shape. **Ask which account the run used**, then read
what that account is allowed to do.
---

## 5. The site must be running — and the work is not cancelled when the client leaves

Because the work happens inside the running site, two ordinary states of the site become delivery failures:

- **The site is down, restarting, or still warming up.** Every operation fails at the connection, and at the
  client that is indistinguishable from a wrong URL. A script that restarts the application and immediately
  pushes the next package hits this routinely — the application accepts connections before it is ready to
  serve them.
- **The delivery operations are synchronous: the site holds the request open until the installation
  finishes.** `[unverified here]` Nothing hands the work to a background queue and answers early, which has
  one consequence worth stating plainly: **a client that times out or loses the connection abandons the
  answer, not the installation.** The site carries on and finishes.

So **a client-side timeout is not evidence that the delivery did not happen** — and a blind retry on top of
one that quietly succeeded is how a recoverable incident becomes an ambiguous one. Read the environment
before repeating the operation: the record, its children, and what is installed now (spine §2.4c).
---

## 6. What it does not do unless told

Restarting the application and clearing the application cache are **separate operations of their own**
`[unverified here]`, governed by the same two rights as the delivery itself. Neither happens because a
package was installed. A caller that omits one produces a delivery that reports success and leaves the site
serving the old behaviour — the spine's outcome *"completed, but the delivered changes were not applied"*:

| Omitted step | What the user sees |
|---|---|
| the configuration is not rebuilt | server-side changes do not take effect; the old assembly keeps serving |
| client static content is not regenerated | the browser keeps loading the previous front-end; a hard refresh does not help |
| the application is not restarted | cached schemas and metadata keep the old definitions alive |
| the application cache is not cleared | the same, and it survives a restart |

**The application-level install tells the caller whether a restart is needed.** `[unverified here]` Its
response carries a flag that is set when the delivery changed the workspace assembly — so the site has
already answered the question *"does this one need a restart?"*, and a script that ignores the flag is
discarding an answer it was given. Worth asking for: the response body, not just the exit code.

**Two of these operations exist only on the .NET Framework build** `[unverified here]` — unloading the
application domain and running a script through the installer service are compiled out of the .NET build
entirely. A script written against a Framework site and pointed at a .NET one fails on an operation the
site does not offer, with nothing in the message about packages. Settle it by reading which framework the
site runs.

**This is the single commonest "we installed it and nothing changed" on this channel**, and it is
diagnosable from the environment rather than from the script: the packages and schemas are present and
current, the delivery record is clean, and the behaviour is old. When those three hold together, the
delivery worked and a post-step did not run. Ask which steps the script performs after the push — do not
assume it performs any of them.
---

## 7. Failure modes that belong to the client, not to the delivery

The rule for all of them: **the client reporting an error is not, by itself, evidence that the delivery
failed.** Establish the environment's side first.

- **A timeout on a large package.** The client stops waiting; the site keeps installing. The delivery
  completes minutes after the caller has already recorded a failure — and a retry then collides with the
  first attempt.
- **A broken connection mid-operation.** Same shape, same rule.
- **A proxy, a certificate, or a TLS mismatch** between the machine and the site. Nothing reaches the site;
  nothing is recorded.
- **A file the client could not read** — the archive path is wrong, or the file is held by another process on
  the caller's machine. The delivery never started.
- **A version mismatch between the client and the product.** The client is developed separately and its
  operations track the product's API; an older or newer client can address an endpoint the site does not
  offer, or send a shape it no longer accepts. The symptom is a refusal that mentions nothing about packages.
  **This possibility has to be named rather than ruled out from here**, because neither the client's version
  nor its release history is readable on the environment.
- **A generic failure message that explains nothing.** `[unverified here]` When a package install fails,
  the site answers with a fixed "the installation failed" wording — **the reason is not in the response by
  design**; it is in the installer log. So a paste showing only that sentence is not a thin report from the
  caller, it is everything the site said. Ask for the log, and do not read the absence of detail as the
  absence of a cause.
- **"No log" from the log endpoint is not evidence there was no log.** `[unverified here]` The service that
  hands the installer log back answers a failed retrieval with an **empty file named as though none
  existed**, rather than with an error. A caller reporting "there is no log" may be reporting a retrieval
  that failed. The activity-log record's own attachment (spine §2.2) is the reliable copy — read that
  instead.

---

## 8. What can be confirmed from a connected environment — and what cannot

**Confirmable here:** whether a delivery reached the site at all (the record, its children, the footprint
cluster when there is no parent row), which packages, schemas and applications exist afterwards and in what
state, the retry markers that say what remains uninstalled, the account the work was attributed to, and
whether any restore was performed.

**Not confirmable here, ever:** the client's version, its configuration, which environment name was used and
where that name pointed, the command line, its exit code, its console output, and the state of the machine
it ran on. **Ask for the console output and the environment name; do not infer them.**

**Never report a client-side error as the root cause on the strength of a paste alone.** The paste is the
caller's side of a conversation; the environment holds the other side, and it is the half this agent can
actually read. When the two disagree — the client says it failed, the environment shows a completed
delivery — **the environment wins, and the disagreement is itself the finding**: it means a retry is unsafe
until somebody reconciles them.

---

## Boundaries

- Mechanism only. This file matches no signature and diagnoses no incident; route from the spine, match in a
  catalog, come here for why.
- The stages a delivery goes through, transactionality, backup and restore are the pipeline's —
  `installation-pipeline-reference.md`. Only what this channel adds lives here.
- The out-of-process command-line channel is `installation-workspaceconsole-reference.md`. When an incident
  does not say which was used, **§1's table is how to tell them apart from the evidence**: work attributed
  to a named user with a full record points here; no record at all, on a site that was down, points there.
- Compiler error codes from a build triggered through this channel are the **compilation domain's**, matched
  in its catalog.
- Environment-side conditions — disk, locks, permissions on the *site's* machine — are
  `installation-catalog-infrastructure.md` and its files half, reachable from any stage.
