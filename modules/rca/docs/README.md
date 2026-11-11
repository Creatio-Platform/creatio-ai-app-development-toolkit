# RCA AI Agent for Creatio

## Contents

- [Introduction](#introduction)
- [How it works](#how-it-works)
- [Prepare your Creatio site](#prepare-your-creatio-site)
  - [Configure the OAuth app for the agent](#configure-the-oauth-app-for-the-agent)
  - [Publish RcaAgentMcp on the site (for attached files)](#publish-rcaagentmcp-on-the-site-for-attached-files)
- [Set the environment variables](#set-the-environment-variables)
- [The MCP servers](#the-mcp-servers)
  - [What is left to set, per agent](#what-is-left-to-set-per-agent)
    - [Claude Code](#claude-code)
    - [Codex](#codex)
    - [GitHub Copilot CLI](#github-copilot-cli)
- [Usage](#usage)
- [Troubleshooting the sign-in](#troubleshooting-the-sign-in)

## Introduction

An AI agent that investigates Creatio **configuration incidents**, finds the **root cause**, and explains it with
evidence and a recommendation. It covers three domains today: **compilation**, **feature flags & system
settings**, and **installation** (package / application delivery).

The agent is **read-only**: it never changes the environment. It reads Creatio's own records — the configuration
activity log, the installer logs attached to it, packages, schemas, settings — through two MCP servers: Creatio's
hosted MCP server, signed in as you, and a small local server for the files attached to the log.

The plugin enforces that for those two servers on every host: Codex and Copilot CLI get only their read tools, and on
Claude Code a hook of the plugin denies every other tool of the two. The host's own tools (a shell, a web fetch) and
other MCP servers are not covered by it; there the agent's instructions and the host's permission prompts apply. A
read-only Creatio user, as the sections below ask for, is what keeps the site itself from any change.

Its skills (`skills/rca-*`) come with the toolkit, for **Claude Code**, **Codex** and **GitHub Copilot CLI**. What
it needs from you is a connection to your site, set up in the sections below.

## How it works

```
your incident ─▶ rca-orchestration ─▶ NAVIGATION.md ─▶ the domain's playbook
                       │                                        │
                       ├─ rca-cal-read ──────────┐                  │ signature → hypothesis
                       ├─ rca-env-readonly-query ┤ evidence (MCP)   │ → verification → fix
                       ├─ rca-cal-file-read ─────┤                  │
                       ├─ rca-root-cause-vs-consequence             │
                       └─ rca-diagnosis-report ◀──────── diagnosis ┘
        (rca-safety-and-access governs every call — read-only)
```

The entry skill, `rca-orchestration`, classifies the incident, reads the evidence, separates the **trigger** from
its consequences, checks whether the failure is still current, and returns a diagnosis with its evidence and a
recommendation. When the break can simply be undone, the recommendation splits into **Unblock now (temporary)**
and **Proper fix**. Anything outside a covered domain is answered honestly: the agent says so and hands back the
evidence it gathered.

## Prepare your Creatio site

### Configure the OAuth app for the agent

An administrator creates it once: **System Designer → OAuth 2.0 integrated applications → New**.

- **Allowed grant types:** *On behalf of a user (authorization code)*; **Public client** ticked.
- **Authorized redirect URIs:** `https://<region>-mcp.creatio.com/oauth/callback` — the region of your site (`eu1`,
  `eu3`, `uk1`, `us1`, `ca1`, `mx1`, `au1`, `jp1`, `ae1`). It must be on the same host as the MCP server you connect
  to (`CREATIO_HTTP_MCP_URL`); otherwise the sign-in fails.
- **Permitted users:** everyone who will use the agent. An empty list lets no one in.

Note the app's **Client ID**.

### Publish RcaAgentMcp on the site (for attached files)

Reading attached files also needs a **read-only Creatio account** — a dedicated least-privilege user, not
`Supervisor`, so the environment itself refuses any write — and **Node.js 20 or newer** on `PATH`, because the files
server is a Node script.

The agent reads the content of files attached to log records — installer logs, `metadata.json` — through an MCP
server published on the Creatio site. Without it every other read works; the agent then says it could not read
the attachment. The tool, **Get text file content** (`get_text_file_content`), ships in the `CrtCopilot` package
from **Creatio 10.1**; on an older site it does not exist. Nothing is installed — you only publish it:

1. Main menu → **Published MCP servers** → **New**.
2. **Name**: `RcaAgentMcp` (the agent's default; Creatio builds the endpoint from it).
3. **Tools** tab → **Add tool** → **Add from source code action** → **Get text file content**.
4. **Save**, with **Make it online** on.

**Copy the path from the card's Full URL field** — a field in the server card, not the browser's address bar.
Depending on the site it is `<base-url>/0/rest/ToolServiceMcp/RcaAgentMcp/v1/mcp` (the agent's default) or the
same without `/0/`. If it is the other shape, or you chose another name, set `CREATIO_RCA_AGENT_MCP_PATH` to the
path from the field.

## Set the environment variables

The MCP servers read these from the environment at run time; no MCP configuration file holds them. Set them in the
environment the agent starts in, then start the agent from there (a `.env` file is not read). Wherever you keep
them, programs you run can read the password, so use a read-only user.

| Variable | Required | Meaning |
|---|---|---|
| `CREATIO_BASE_URL` | yes | the Creatio site, e.g. `https://your-creatio-site.creatio.com` |
| `CREATIO_CLIENT_ID` | yes | the Client ID of the OAuth app (above) |
| `CREATIO_HTTP_MCP_URL` | Claude Code | Creatio's MCP server of your region, e.g. `https://your-creatio-mcp.creatio.com/mcp`; Codex and Copilot take it as a value instead (below) |
| `CREATIO_LOGIN` | for attached files | the read-only user |
| `CREATIO_PASSWORD` | for attached files | its password |
| `CREATIO_RCA_AGENT_MCP_PATH` | no | only when RcaAgentMcp is published under a non-default route (above) |

```
# Windows (PowerShell), for this terminal
$env:CREATIO_BASE_URL     = 'https://your-creatio-site.creatio.com'
$env:CREATIO_CLIENT_ID    = 'your_client_id'
$env:CREATIO_HTTP_MCP_URL = 'https://your-creatio-mcp.creatio.com/mcp'
$env:CREATIO_LOGIN        = 'your_readonly_user'
$env:CREATIO_PASSWORD     = 'your_password'

# macOS or Linux, for this terminal
export CREATIO_BASE_URL='https://your-creatio-site.creatio.com'
export CREATIO_CLIENT_ID='your_client_id'
export CREATIO_HTTP_MCP_URL='https://your-creatio-mcp.creatio.com/mcp'
export CREATIO_LOGIN='your_readonly_user'
export CREATIO_PASSWORD='your_password'
```

Variables set this way last until the terminal closes, and only an agent started from that terminal sees them. An
agent started some other way (a desktop app, an IDE) needs them set for your user, the way your system keeps user
environment variables (on Windows: `[Environment]::SetEnvironmentVariable('CREATIO_LOGIN', 'your_readonly_user', 'User')`
for each), or by a secret manager you use.

## The MCP servers

The agent needs two MCP servers: **`rca-creatio-http`** (Creatio's hosted MCP server) and **`rca-files`** (a local
server for the files attached to the log). **The toolkit plugin brings both**; what is left to you depends on the
agent (next section). 

The plugin declares the servers for each agent in its own format (`modules/rca/mcp/`). Only what an agent cannot read
from an environment variable is left: Claude Code needs nothing more than the variables; Codex and Copilot need the
URL of your region's MCP server written into the plugin. Paste the prompt for your agent into it, with the URL filled
in. **A toolkit update brings the plugin's files anew: paste the prompt again after one.**

#### Claude Code

The servers read all their values from the environment variables. Sign in: `/mcp` →
`rca-creatio-http` → **Authenticate**.

#### Codex

````text
<MCP_CREATIO_URL> = [...replace with your region's MCP server URL]

In the installed creatio-ai-app-development-toolkit plugin (under ~/.codex/plugins/cache/, the newest version), in
modules/rca/mcp/codex.json, set "url" of the server "rca-creatio-http" to <MCP_CREATIO_URL>. Change nothing else.

If the value above is still the [...] text, ask me for it first.
````

Then restart Codex and sign in: `codex mcp login rca-creatio-http`.

#### GitHub Copilot CLI

````text
<MCP_CREATIO_URL> = [...replace with your region's MCP server URL]

In the installed creatio-ai-app-development-toolkit plugin (`copilot plugin list` shows it), in the .mcp.json at the
plugin's root, set "url" of the server "rca-creatio-http" to <MCP_CREATIO_URL>. Change nothing else.

If the value above is still the [...] text, ask me for it first.
````

Then restart Copilot; it opens the browser to sign in to `rca-creatio-http` the first time it uses it.

## Usage

**Start the message with the entry skill, `rca-orchestration`.** An agent picks a skill on its own only when it
shows the model that skill's description, and with many plugins installed it may not — then the investigation runs
without the RCA skills and can reach a wrong root cause. Naming the skill removes the guess:

| Agent | How to name it |
|---|---|
| Claude Code | `/rca-orchestration <your question>` |
| Codex | `$rca-orchestration <your question>` |
| GitHub Copilot CLI | `Use the rca-orchestration skill: <your question>` |

Describe the incident the way it was reported to you, for example:

- `/rca-orchestration What happened to the last failed installation of the Creatio app?`
- `/rca-orchestration The compilation is failing. What happened and how do I fix it?`
- `/rca-orchestration What is the root cause of the error in ConfActivityLog record <Id>?`
- `/rca-orchestration The customer says there's no Export button in the section. Why?`
- `/rca-orchestration Here is the error the customer sent: <the error text or stack trace>` — a pasted error is
  first-class evidence; many incidents never produce a log record.

## Troubleshooting the sign-in

**"Tenant registration expired; reconnect to retry"** on the sign-in page. Creatio's MCP server did not get your
site and Client ID — `CREATIO_BASE_URL` or `CREATIO_CLIENT_ID` wrong or not set, or an agent started before the
environment variables were set — and your agent has saved that failed sign-in. Signing out from
the agent's menu does not clear it.

1. Check that the two variables are set and visible in the terminal you start the agent from
   (`echo $env:CREATIO_CLIENT_ID` in PowerShell, `echo $CREATIO_CLIENT_ID` elsewhere); if not, close the whole terminal app (or IDE) and open it again: a window that was already open does
   not see variables set later.
2. Remove the saved sign-in:
   - **Codex:** `codex mcp logout rca-creatio-http`.
   - **Claude Code and GitHub Copilot CLI:** ask your AI agent, for example: *"Delete your stored sign-in data for the
     MCP server `rca-creatio-http`, and nothing else, so I can sign in again."* The agent knows where its host keeps it.
3. Close the agent, start it again, and sign in to `rca-creatio-http` (in Claude Code: `/mcp` → **Authenticate**).

**"Integration access is not allowed"**, and the page address ends in `consent?errorId=3`. The Creatio user you signed
in as is not on the OAuth app's **Permitted users** list. Either sign in as a user who is on the list — if the browser
is still signed in to Creatio as someone else, sign out there first, or use a private window — or ask the
administrator to add your user to **Permitted users**. Then start the sign-in again from your agent; reloading the
page does not help.

---

**Maintaining these files.** The RCA agent's files (`skills/rca-*`, `modules/rca/`, `hooks/hooks.json`,
`tests/test_rca_*.py`) are maintained by the RCA team and updated here as a whole. A change made only here is
replaced by the next update; propose changes to the RCA team instead.

