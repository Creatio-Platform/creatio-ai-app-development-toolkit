# Clio CLI Commands

Clio is the command-line tool for Creatio deployments. This file lists the local CLI surface used by Agent 1 during environment bootstrap and by post-approval implementation work such as restart or cleanup. The MCP server surface is owned by `docs://mcp/guides/agent-execution` and the per-tool `get-tool-contract`; the commands here are CLI-only invocations from a local shell.

## Environment Setup

```bash
clio reg-web-app myenv -u <creatio-url-from-planning> -l <login> -p <password>
clio reg-web-app -a myenv
clio healthcheck -e myenv
```

```bash
clio compile-configuration -e myenv
clio restart-web-app myenv
clio last-compilation-log -e myenv
```

## Package Management

```bash
clio new-pkg UsrMyPackage
clio list-packages -e myenv
clio pull-pkg MyPackage -e myenv
clio delete-pkg-remote MyPackage -e myenv
clio validation-pkg ./MyPackage
```

## Writable Package Context

Resolve a writable package before schema edits (see `runbooks/01-environment-setup.md`, step 8). Installed-app packages are often locked / read-only and reject direct schema writes mid-run.

```bash
clio list-packages -e myenv             # inspect packages and their lock state
clio unlock-package MyPackage -e myenv  # make a locked package editable before modeling
clio lock-package MyPackage -e myenv    # restore the lock afterwards when required
```

Resolve exact lock semantics and the equivalent MCP tools through `get-tool-contract` and `docs://mcp/guides/existing-app-maintenance`.

## Development Tools

```bash
clio execute-sql-script "SELECT Id FROM Contact LIMIT 5" -e myenv
clio clear-redis-db myenv
clio set-syssetting MySetting "Value" -e myenv
```
