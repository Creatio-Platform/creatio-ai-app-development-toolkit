@echo off
setlocal enabledelayedexpansion
REM ===========================================================================
REM build-dev-toolchain.bat -- thin Windows launcher.
REM   The actual cross-platform logic lives in build_dev_toolchain.py (shared by
REM   this launcher and build-dev-toolchain.sh on macOS/Linux). This wrapper just
REM   locates a Python 3 interpreter and hands off, forwarding all arguments.
REM   Usage: build-dev-toolchain.bat [release | <branch-or-tag>]
REM ===========================================================================
set "DRIVER=%~dp0build_dev_toolchain.py"
set "PY="
for %%C in (python.exe python3.exe py.exe) do (
  if not defined PY (where %%C >nul 2>&1 && set "PY=%%C")
)
if not defined PY (
  echo. & echo Python 3 is required but was not found on PATH. Install Python 3 and re-run.
  exit /b 1
)
if /I "!PY!"=="py.exe" (
  py -3 "%DRIVER%" %*
) else (
  "!PY!" "%DRIVER%" %*
)
exit /b !errorlevel!
