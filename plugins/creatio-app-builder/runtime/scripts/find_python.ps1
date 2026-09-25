# find_python.ps1 — Resolve Python 3 on Windows, auto-install if missing.
#
# Usage (dot-source to export into current session):
#   . runtime\scripts\find_python.ps1
#
# Sets $env:PYTHON_CMD to the resolved Python executable command.
# All subsequent python calls should use: & $env:PYTHON_CMD script.py ...

function _TestPythonCmd {
    param([string]$Cmd, [string[]]$ExtraArgs = @())
    try {
        $allArgs = @('--version') + $ExtraArgs
        if ($ExtraArgs.Count -gt 0) {
            $allArgs = $ExtraArgs + @('--version')
        }
        $output = & $Cmd @allArgs 2>&1
        return ($LASTEXITCODE -eq 0 -and ($output -match 'Python 3\.'))
    } catch {
        return $false
    }
}

function _IsWindowsStoreStub {
    param([string]$Cmd)
    try {
        $resolved = (Get-Command $Cmd -ErrorAction Stop).Source
        $item = Get-Item $resolved -ErrorAction Stop
        # Windows Store stubs are 0-byte reparse points
        return ($item.Length -eq 0)
    } catch {
        return $true
    }
}

# Already resolved in a parent call (e.g. re-sourcing the script)
if ($env:PYTHON_CMD -and (Test-Path $env:PYTHON_CMD -ErrorAction SilentlyContinue)) {
    $ver = & $env:PYTHON_CMD --version 2>&1
    if ($LASTEXITCODE -eq 0 -and $ver -match 'Python 3\.') {
        Write-Host "[INFO] Python already resolved: $env:PYTHON_CMD"
        return
    }
}

# 1. py -3  (Windows Python Launcher — installed with any official python.org installer)
#    Resolve to the actual python.exe so that $env:PYTHON_CMD is always a plain path
#    (a string like "py -3" breaks the PowerShell & operator — it needs a single token)
if (Get-Command py -ErrorAction SilentlyContinue) {
    $pyExe = (& py -3 -c "import sys; print(sys.executable)" 2>&1)
    if ($LASTEXITCODE -eq 0 -and $pyExe -and (Test-Path $pyExe.Trim() -ErrorAction SilentlyContinue)) {
        $env:PYTHON_CMD = $pyExe.Trim()
        Write-Host "[INFO] Python found via py launcher: $env:PYTHON_CMD"
        return
    }
}

# 2. python3 — skip 0-byte Windows Store stubs
if (Get-Command python3 -ErrorAction SilentlyContinue) {
    if (-not (_IsWindowsStoreStub 'python3') -and (_TestPythonCmd -Cmd 'python3')) {
        $env:PYTHON_CMD = 'python3'
        Write-Host "[INFO] Python found: python3"
        return
    }
}

# 3. python — same Store-stub check
if (Get-Command python -ErrorAction SilentlyContinue) {
    if (-not (_IsWindowsStoreStub 'python') -and (_TestPythonCmd -Cmd 'python')) {
        $env:PYTHON_CMD = 'python'
        Write-Host "[INFO] Python found: python"
        return
    }
}

# 4. Search standard install paths (no app-specific bundled Pythons)
$searchBases = @(
    "$env:LOCALAPPDATA\Programs\Python"
    "C:\Python3*"
    "C:\Program Files\Python3*"
    "C:\Program Files (x86)\Python3*"
)
foreach ($base in $searchBases) {
    $dirs = Get-Item $base -ErrorAction SilentlyContinue
    if ($dirs) {
        foreach ($dir in $dirs) {
            $exe = Join-Path $dir.FullName 'python.exe'
            if ((Test-Path $exe) -and (_TestPythonCmd -Cmd $exe)) {
                $env:PYTHON_CMD = $exe
                Write-Host "[INFO] Python found at: $exe"
                return
            }
        }
    }
}

# 5. Fallback: install via winget (built into Windows 10 1809+ and Windows 11)
#    Use versioned IDs with --source winget to avoid the msstore source, which
#    requires interactive geographic region consent and fails in non-interactive sessions.
Write-Host "[INFO] Python 3 not found. Attempting install via winget..."
if (Get-Command winget -ErrorAction SilentlyContinue) {
    $installed = $false
    foreach ($ver in @('3.13', '3.12', '3.11', '3.10')) {
        winget install "Python.Python.$ver" --source winget --silent --accept-source-agreements --accept-package-agreements 2>&1
        if ($LASTEXITCODE -eq 0) { $installed = $true; break }
    }
    if ($installed) {
        # Refresh PATH so the new install is visible
        $machinePath = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
        $userPath    = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        $env:PATH    = "$machinePath;$userPath"
        if (Get-Command py -ErrorAction SilentlyContinue) {
            $pyExe = (& py -3 -c "import sys; print(sys.executable)" 2>&1)
            if ($LASTEXITCODE -eq 0 -and $pyExe -and (Test-Path $pyExe.Trim() -ErrorAction SilentlyContinue)) {
                $env:PYTHON_CMD = $pyExe.Trim()
                Write-Host "[INFO] Python installed and available as: $env:PYTHON_CMD"
                return
            }
        }
    }
} else {
    Write-Warning "[WARN] winget not available. Cannot auto-install Python."
}

Write-Error "[ERROR] Python 3 could not be found or installed automatically.`nPlease install it manually from https://www.python.org/downloads/ and restart the terminal."
exit 1
