# 05 — MCP Protocol Features

> Historical design note. This document records protocol-level opportunities and must not be used as a contract reference for live clio MCP tools.

Notes on MCP capabilities that can improve UX and reduce knowledge duplication between server and client.

## Main Themes

### Prompts And Resources As Live Guidance

- use server-discovered prompts/resources as a live source of execution guidance
- reduce the volume of repo-local agent text that duplicates server-owned rules
- give agents up-to-date hints without manually updating repo docs

### Progress Reporting

- pick up protocol-level progress and surface it in orchestration UX
- make long operations more transparent for the agent and the user

### Tool Metadata

- use annotations and metadata for smarter retry policy, safety decisions, and richer logging
- do not duplicate these rules in hand-written wrapper maps

### Resource And Subscription Flows

- evaluate where protocol-level resources or subscriptions can remove redundant refresh calls
- improve post-mutation visibility without extra polling where the server already knows the state has changed

## Expected Effect

- less contract drift between repo docs and live server behavior
- better explainability for long-running tool calls
- cleaner wrapper logic
- a more convenient path for agent guidance that evolves together with clio itself

## Notes

- This document describes adoption ideas, not the current prompt/resource catalog.
- Current prompts, resources, annotations, and other protocol surfaces must be read from live MCP discovery at execution time.
