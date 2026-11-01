# RCA AI Agent for Creatio

## Contents

- [Introduction](#introduction)
- [How it works](#how-it-works)
- [Prepare your Creatio site](#prepare-your-creatio-site)
  - [Configure the OAuth app for the agent](#configure-the-oauth-app-for-the-agent)
  - [Publish RcaAgentMcp on the site (for attached files)](#publish-rcaagentmcp-on-the-site-for-attached-files)
- [Set the environment variables](#set-the-environment-variables)
- [Add the MCP servers to your AI agent](#add-the-mcp-servers-to-your-ai-agent)
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
  `eu3`, `uk1`, `us1`, `ca1`, `mx1`, `au1`, `jp1`, `ae1`).
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

The MCP servers read these at run time (in Claude Code the setup writes the site and Client ID into its
configuration); the login and password are never written into a file. Set them as **user** environment variables,
then restart the agent so it picks them up (a `.env` file is not read):

| Variable | Required | Meaning |
|---|---|---|
| `CREATIO_BASE_URL` | yes | the Creatio site, e.g. `https://your-site.creatio.com` |
| `CREATIO_CLIENT_ID` | yes | the Client ID of the OAuth app (above) |
| `CREATIO_HTTP_MCP_URL` | no | Creatio's MCP server of your region, e.g. `https://eu1-mcp.creatio.com/mcp` — read only by `mcp.rca.json` (end of this page) |
| `CREATIO_LOGIN` | for attached files | the read-only user |
| `CREATIO_PASSWORD` | for attached files | its password |
| `CREATIO_RCA_AGENT_MCP_PATH` | no | only when RcaAgentMcp is published under a non-default route (above) |

```
# Windows (PowerShell)
[Environment]::SetEnvironmentVariable('CREATIO_BASE_URL',     'https://your-site.creatio.com',   'User')
[Environment]::SetEnvironmentVariable('CREATIO_CLIENT_ID',    'your_client_id',                  'User')
[Environment]::SetEnvironmentVariable('CREATIO_HTTP_MCP_URL', 'https://eu1-mcp.creatio.com/mcp', 'User')
[Environment]::SetEnvironmentVariable('CREATIO_LOGIN',        'your_readonly_user',              'User')
[Environment]::SetEnvironmentVariable('CREATIO_PASSWORD',     'your_password',                   'User')

# macOS or Linux: add to ~/.zshrc (or ~/.bashrc), then open a new terminal
export CREATIO_BASE_URL='https://your-site.creatio.com'
export CREATIO_CLIENT_ID='your_client_id'
export CREATIO_HTTP_MCP_URL='https://eu1-mcp.creatio.com/mcp'
export CREATIO_LOGIN='your_readonly_user'
export CREATIO_PASSWORD='your_password'
```

## Add the MCP servers to your AI agent

The agent needs two MCP servers: **`rca-creatio-http`** (Creatio's hosted MCP server) and **`rca-files`** (a local
server for the files attached to the log). Paste the prompt for your agent into it, with the values at its top
filled in.

**Codex and Copilot cannot take an MCP server's URL from an environment variable, and neither can Claude Code in the
user's configuration**, so the URL is a value you give; Claude Code takes its two headers as values too. Everything
else comes from the environment variables (above), and the agent finds the script itself. 

- `<MCP_CREATIO_URL>` — Creatio's MCP server of your region, e.g. `https://eu1-mcp.creatio.com/mcp`.
- `<CREATIO_BASE_URL>`, `<CREATIO_CLIENT_ID>` (Claude Code only) — your site and the OAuth app's Client ID, the same
  values as the environment variables of those names.
- `<MCP_FILES_PATH>` — found by the agent: the full path of `modules/rca/scripts/rca-files-mcp.mjs` in the installed
  toolkit plugin, e.g. `C:/Users/you/.codex/plugins/cache/creatio/creatio-ai-app-development-toolkit/1.16.0/modules/rca/scripts/rca-files-mcp.mjs`.
  The folder changes with every toolkit version: paste the prompt again after an update.

**Replace each `[...]` at the top of the prompt**; the placeholders are in angle brackets so they do not look like environment variables:

### Claude Code

````text
<MCP_CREATIO_URL> = [...replace with your region's MCP server URL, e.g. https://eu1-mcp.creatio.com/mcp...]
<CREATIO_BASE_URL> = [...replace with your Creatio site, e.g. https://your-site.creatio.com...]
<CREATIO_CLIENT_ID> = [...replace with the Client ID of the OAuth app...]

<MCP_FILES_PATH> = the full path of modules/rca/scripts/rca-files-mcp.mjs in the installed
creatio-ai-app-development-toolkit plugin (under ~/.claude/plugins/cache/, the newest version)

Add this MCP configuration to "mcpServers" in ~/.claude.json (my user scope), replacing entries of the same name
and keeping the rest of the file:

"rca-creatio-http": {
  "type": "http",
  "url": "<MCP_CREATIO_URL>",
  "headers": { "X-Creatio-Base-Url": "<CREATIO_BASE_URL>", "X-Creatio-Client-Id": "<CREATIO_CLIENT_ID>" }
},
"rca-files": {
  "type": "stdio",
  "command": "node",
  "args": ["<MCP_FILES_PATH>"]
}

and add these to "permissions" -> "deny" in ~/.claude/settings.json, keeping the rest of the file:

"mcp__rca-creatio-http__creatio_create_record",
"mcp__rca-creatio-http__creatio_update_record",
"mcp__rca-creatio-http__creatio_delete_record",
"mcp__rca-creatio-http__creatio_post_feed_message"

If a value above is still the [...] text, ask me for it first.
````

Sign in: `/mcp` → `rca-creatio-http` → **Authenticate**.

### Codex

````text
<MCP_CREATIO_URL> = [...replace with your region's MCP server URL, e.g. https://eu1-mcp.creatio.com/mcp...]

<MCP_FILES_PATH> = the full path of modules/rca/scripts/rca-files-mcp.mjs in the installed
creatio-ai-app-development-toolkit plugin (under ~/.codex/plugins/cache/)

Add this MCP configuration to ~/.codex/config.toml, replacing tables of the same name and keeping the rest of the
file:

[mcp_servers.rca-creatio-http]
url = "<MCP_CREATIO_URL>"
env_http_headers = { "X-Creatio-Base-Url" = "CREATIO_BASE_URL", "X-Creatio-Client-Id" = "CREATIO_CLIENT_ID" }
enabled_tools = ["creatio_describe_object", "creatio_search_objects", "creatio_list_records", "creatio_get_record", "creatio_get_current_user", "creatio_build_record_url", "creatio_search_records"]

[mcp_servers.rca-files]
command = "node"
args = ["<MCP_FILES_PATH>"]
env_vars = ["CREATIO_BASE_URL", "CREATIO_LOGIN", "CREATIO_PASSWORD", "CREATIO_RCA_AGENT_MCP_PATH"]
enabled_tools = ["get_text_file_content"]

If a value above is still the [...] text, ask me for it first.
````

Sign in: `codex mcp login rca-creatio-http`.

### GitHub Copilot CLI

````text
<MCP_CREATIO_URL> = [...replace with your region's MCP server URL, e.g. https://eu1-mcp.creatio.com/mcp...]

<MCP_FILES_PATH> = the full path of modules/rca/scripts/rca-files-mcp.mjs in the installed
creatio-ai-app-development-toolkit plugin (under ~/.copilot/installed-plugins/)

Add this MCP configuration to "mcpServers" in ~/.copilot/mcp-config.json, replacing entries of the same name and
keeping the rest of the file. Keep the ${...} references as they are:

"rca-creatio-http": {
  "type": "http",
  "url": "<MCP_CREATIO_URL>",
  "headers": { "X-Creatio-Base-Url": "${CREATIO_BASE_URL}", "X-Creatio-Client-Id": "${CREATIO_CLIENT_ID}" },
  "tools": ["creatio_describe_object", "creatio_search_objects", "creatio_list_records", "creatio_get_record",
            "creatio_get_current_user", "creatio_build_record_url", "creatio_search_records"]
},
"rca-files": {
  "type": "local",
  "command": "node",
  "args": ["<MCP_FILES_PATH>"],
  "env": {
    "CREATIO_BASE_URL": "${CREATIO_BASE_URL}",
    "CREATIO_LOGIN": "${CREATIO_LOGIN}",
    "CREATIO_PASSWORD": "${CREATIO_PASSWORD}",
    "CREATIO_RCA_AGENT_MCP_PATH": "${CREATIO_RCA_AGENT_MCP_PATH}"
  },
  "tools": ["get_text_file_content"]
}

If a value above is still the [...] text, ask me for it first.
````

Copilot opens the browser to sign in to `rca-creatio-http` the first time it uses it.

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
site and Client ID — a wrong or missing `X-Creatio-Base-Url` / `X-Creatio-Client-Id` header, or (Codex) an agent
started before the environment variables were set — and your agent has saved that failed sign-in. Signing out from
the agent's menu does not clear it.

1. Check the two header values in your configuration (Claude Code, Copilot). For Codex, check that the variables are
   visible in the terminal you start it from (`echo $env:CREATIO_CLIENT_ID` in PowerShell, `echo $CREATIO_CLIENT_ID`
   elsewhere); if not, close the whole terminal app (or IDE) and open it again: a window that was already open does
   not see variables set later.
2. Ask your AI agent to remove the saved sign-in, for example: *"Delete your stored sign-in data for the MCP server
   `rca-creatio-http`, and nothing else, so I can sign in again."* The agent knows where its host keeps it.
3. Close the agent, start it again, and sign in to `rca-creatio-http` (in Claude Code: `/mcp` → **Authenticate**).

**"Integration access is not allowed"**, and the page address ends in `consent?errorId=3`. The Creatio user you signed
in as is not on the OAuth app's **Permitted users** list. Either sign in as a user who is on the list — if the browser
is still signed in to Creatio as someone else, sign out there first, or use a private window — or ask the
administrator to add your user to **Permitted users**. Then start the sign-in again from your agent; reloading the
page does not help.

---

`mcp.rca.json` and `settings.rca.json` in this folder are for the toolkit's developers: they start both servers from a
clone of the toolkit, with the hosted server's write tools denied,
with `claude --strict-mcp-config --mcp-config modules/rca/mcp.rca.json --settings modules/rca/settings.rca.json --setting-sources project --plugin-dir .` in
the clone's root.
