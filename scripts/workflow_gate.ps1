$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "find_python.ps1")
function Show-Usage {
    Write-Error "Usage: workflow_gate.ps1 <command> [args...]`nCommands:`n  plan-approve         <AppName> <planner> <routingMode> <credentialsStatus> <understanding> <confirmation>`n  plan-check           <AppName>`n  requirements-approve <AppName> <approver> <text>`n  requirements-check   <AppName>`n  execution-check      <AppName>"
}
if ($args.Count -lt 1) {
    Show-Usage
    exit 1
}
$command = $args[0]
$commandArgs = @()
if ($args.Count -gt 1) {
    $commandArgs = $args[1..($args.Count - 1)]
}
switch ($command) {
    "plan-approve" {
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "write-planning-state" @commandArgs | Out-Null
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "check-planning-gate" $commandArgs[0]
        exit $LASTEXITCODE
    }
    "plan-check" {
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "check-planning-gate" @commandArgs
        exit $LASTEXITCODE
    }
    "requirements-approve" {
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "write-approval-state" @commandArgs | Out-Null
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "check-approval-gate" $commandArgs[0]
        exit $LASTEXITCODE
    }
    "requirements-check" {
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "check-approval-gate" @commandArgs
        exit $LASTEXITCODE
    }
    "execution-check" {
        & $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "check-execution-handoff" @commandArgs
        exit $LASTEXITCODE
    }
    default {
        Show-Usage
        exit 1
    }
}
