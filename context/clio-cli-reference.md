# Clio CLI Commands

Clio is the command-line tool for Creatio deployments. This file lists the local CLI surface used by Agent 1 during environment bootstrap and by Agent 4 for restart/cleanup work. The MCP server surface is owned by `docs://mcp/guides/agent-execution` and the per-tool `get-tool-contract`; the commands here are CLI-only invocations from a local shell.

## Environment Setup

```bash
clio reg-web-app myenv -u <creatio-url-from-planning> -l <login> -p <password>
clio reg-web-app -a myenv
clio healthcheck myenv
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

## Development Tools

```bash
clio execute-sql-script "SELECT Id FROM Contact LIMIT 5" -e myenv
clio clear-redis-db myenv
clio set-syssetting MySetting "Value" -e myenv
```
