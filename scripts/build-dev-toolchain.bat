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
  REM Pass the resolver PATH via an env var, never interpolated into the -Command text: an apostrophe in
  REM the checkout path would otherwise terminate the string and be re-parsed as PowerShell. $env:VAR
  REM expansion is not re-parsed as script. Its own output is suppressed so the for/f captures only PYTHON_CMD.
  set "PY_RESOLVER_PATH=%RESOLVER%"
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "& $env:PY_RESOLVER_PATH *^> $null; if ($env:PYTHON_CMD) { $env:PYTHON_CMD }"`) do set "PYCMD=%%P"
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
