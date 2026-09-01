@echo off
setlocal enabledelayedexpansion
REM ===========================================================================
REM build-dev-toolchain.bat -- thin Windows launcher.
REM   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
REM   this launcher and build-dev-toolchain.sh on macOS/Linux). This wrapper just
REM   resolves a real Python 3 and hands off, forwarding all arguments.
REM   Usage: build-dev-toolchain.bat [release | <branch-or-tag>]
REM
REM   Python resolution (side-effect-free first):
REM     1. `py -3` -- the Windows Python Launcher is always a real Python 3, never the
REM        0-byte Microsoft Store stub.
REM     2. Fallback ONLY if that fails: runtime\scripts\find_python.ps1, which skips the
REM        Store stub, verifies `--version` is Python 3.x, and (if nothing is found) may
REM        INSTALL Python via winget.
REM ===========================================================================
set "HERE=%~dp0"
set "DRIVER=%HERE%build_dev_toolchain.py"
set "RESOLVER=%HERE%..\runtime\scripts\find_python.ps1"

set "PYCMD="
py -3 --version >nul 2>&1 && set "PYCMD=py|-3"
if not defined PYCMD if exist "%RESOLVER%" (
  echo Resolving Python 3 via find_python.ps1 ^(may install Python via winget and prompt for confirmation^)...
  REM Run the resolver with its output FULLY VISIBLE (no stream redirection) so any winget install progress
  REM or consent prompt is shown -- the user must see what is being installed. The resolved interpreter is
  REM captured out-of-band by writing $env:PYTHON_CMD to a temp file (read back with set /p), instead of
  REM scraping stdout, so nothing needs to be suppressed. The resolver PATH and the out-file PATH are passed
  REM via env vars, never interpolated into the -Command text (an apostrophe in a path would otherwise be
  REM re-parsed as PowerShell).
  set "PY_RESOLVER_PATH=%RESOLVER%"
  set "PY_OUT=%TEMP%\clio-rebuild-py-%RANDOM%%RANDOM%.txt"
  if exist "!PY_OUT!" del "!PY_OUT!" >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "& $env:PY_RESOLVER_PATH; if ($env:PYTHON_CMD) { [IO.File]::WriteAllText($env:PY_OUT, $env:PYTHON_CMD) }"
  if exist "!PY_OUT!" ( set /p "PYCMD="<"!PY_OUT!" & del "!PY_OUT!" >nul 2>&1 )
)
if not defined PYCMD (
  echo. & echo Python 3 is required but was not found on PATH ^(the Microsoft Store stub does not count^).
  echo Install Python 3 from https://www.python.org/downloads/ and re-run.
  exit /b 1
)
if "!PYCMD!"=="py|-3" (
  py -3 "%DRIVER%" %*
) else (
  "!PYCMD!" "%DRIVER%" %*
)
exit /b !errorlevel!
