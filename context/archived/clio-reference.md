# Clio CLI Reference

Clio is the command-line tool for managing Creatio platform environments, packages, and deployments.

**Source**: Adapted from `C:\Projects\clio\.github\skills\clio\SKILL.md` and `references/commands-reference.md`

## Prerequisites

- .NET 8 SDK installed
- Clio installed: `dotnet tool install clio -g`
- Verify: `clio info` or `clio ver`

## Environment Management

```bash
# Register environment
clio reg-web-app myenv -u <creatio-url-from-planning> -l <login> -p <password>

# Set active environment
clio reg-web-app -a myenv

# List all environments
clio show-web-app-list --short

# Verify connection
clio ping myenv
clio healthcheck myenv

# Get instance info (requires cliogate)
clio get-info -e myenv

# Open in browser
clio open myenv

# Remove environment
clio unreg-web-app myenv
```

## Package Management (PRIMARY WORKFLOW)

```bash
# Push package from directory to environment
clio push-pkg <path-to-package-dir> -e myenv

# Push compressed package
clio push-pkg package.gz -e myenv

# For composable apps
clio push-app package.gz -e myenv

# Pull package from environment
clio pull-pkg MyPackage -e myenv

# Compile specific package
clio compile-package MyPackage -e myenv

# Delete package from environment
clio delete-pkg-remote MyPackage -e myenv

# List installed packages
clio get-pkg-list -e myenv
clio get-pkg-list -e myenv -f Usr -j   # filter by prefix, JSON output

# Compress/extract
clio generate-pkg-zip MyPackage
clio extract-pkg-zip package.gz -d ./output

# Package version
clio set-pkg-version ./MyPackage -v 1.2.0

# Validate package structure
clio validation-pkg ./MyPackage
```

## Application Lifecycle

```bash
# Compile all configuration
clio compile-configuration -e myenv
clio compile-configuration --all -e myenv

# Get compilation log (for debugging errors)
clio last-compilation-log -e myenv

# Restart application
clio restart-web-app myenv

# Clear Redis cache
clio clear-redis-db myenv

# Start/stop local Creatio
clio start -e myenv
clio stop -e myenv
```

## Development Tools

```bash
# Execute SQL
clio execute-sql-script "SELECT Id FROM Contact LIMIT 5" -e myenv
clio execute-sql-script -f query.sql -e myenv

# Call service
clio call-service --service-path ServiceModel/AppInfoService.svc/GetInfo -e myenv

# DataService operations
clio ds -t select --body '{"rootSchemaName":"Contact","operationType":0}' -e myenv
clio ds -t insert --body '{"rootSchemaName":"Contact","values":{"Name":"John"}}' -e myenv

# System settings
clio set-syssetting MySetting "MyValue" -e myenv
clio get-syssetting MySetting --GET -e myenv

# Features
clio set-feature MyFeature 1 -e myenv

# Install cliogate (needed for advanced features)
clio install-gate -e myenv
```

## Deploy Workflow (for our toolkit)

The standard deploy flow for generated packages:

```bash
# Step 1: Verify environment
clio healthcheck -e myenv

# Step 2: Push package (from absolute path)
clio push-pkg "C:\Projects\no-code-assistent\output\TodoListApp\packages\UsrTodoListApp" -e myenv

# Step 3: Compile configuration
clio compile-configuration -e myenv

# Step 4: Restart application
clio restart-web-app myenv

# Step 5: Verify
clio healthcheck -e myenv

# Step 6: Check compilation log if errors
clio last-compilation-log -e myenv
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `clio` not found | `dotnet tool install clio -g`, ensure `~/.dotnet/tools` in PATH |
| Ping fails | Check URL, credentials, network |
| Compilation errors | `clio last-compilation-log -e <ENV>` |
| Package locked | `clio unlock-package <PKG> -e <ENV>` |
| Push fails | Verify package structure, check descriptor.json |
| "cliogate required" | `clio install-gate -e <ENV>` |

## Common Options

Most commands accept:
- `-e <ENV>` — registered environment name
- `-u <URI>` — Creatio URL (alternative to -e)
- `-l <LOGIN>` — user login
- `-p <PASSWORD>` — user password

Use `clio <CMD> --help` for command-specific options.
