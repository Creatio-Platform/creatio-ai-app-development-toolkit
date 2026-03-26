$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "find_python.ps1")
& $env:PYTHON_CMD (Join-Path $scriptDir "workflow_cli.py") "write-planning-state" @args
exit $LASTEXITCODE
