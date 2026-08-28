@echo off
setlocal enabledelayedexpansion
REM ===========================================================================
REM build-dev-toolchain.bat  --  LOCAL DEV rebuild harness
REM   (rebuilds clio binary + knowledge + CAADT plugin instructions from local sources)
REM
REM Rebuilds the local Creatio AI dev toolchain from LOCAL sources so a coding
REM agent (Claude Code etc.) picks up your unreleased edits. Three stages:
REM
REM   STAGE A (steps 1-5): the `clio` .NET global tool == the MCP server binary.
REM     Built from CLIO_SRC and reinstalled as a dotnet global tool from a local
REM     NuGet feed generated at run time (no companion config file needed).
REM
REM   STAGE C (step 6): the clio KNOWLEDGE base (guidance/advisories/catalog).
REM     Content lives in the separate clio-knowledge repo (KN_URL), NOT embedded
REM     in the binary. Step [0/7] picks the SOURCE MODE:
REM       * branch  - git-sync a clio-knowledge BRANCH/TAG (dev). Reads the RAW
REM                   bundle-source.json, which omits "sequence", so Stage C also
REM                   enables the dev feature flag 'knowledge-allow-unsequenced'
REM                   (the freshly-built clio must IMPLEMENT it, or the sync fails
REM                   with "manifest identity or required envelope is invalid").
REM       * release - the latest SIGNED GitHub Release bundle (stable). The built
REM                   manifest carries "sequence", so it loads on ANY clio and the
REM                   allow-unsequenced flag is irrelevant. install-knowledge has no
REM                   version selector, so release always resolves the LATEST release.
REM     Best-effort: a network/source failure does not fail the rebuild (the MCP
REM     server also bootstraps knowledge on start).
REM
REM   STAGE B (step 7): the CAADT plugin INSTRUCTIONS (runbooks, skills, context,
REM     AGENTS.md). NOT compiled -- Claude Code reads a COPY in its plugin cache.
REM     To pick up edited instructions the plugin is re-pointed at THIS repo. The
REM     repo root is derived from the script's OWN location (this script lives in
REM     <repo>\scripts\), and a local dev marketplace that points at this repo (a TEMP
REM     root + a directory junction to the repo) is GENERATED at run time -- nothing to
REM     create or configure by hand -- then the plugin is reinstalled so Claude re-copies.
REM
REM The ONLY machine path is read from the companion config file next to this script:
REM   scripts\build-dev-toolchain.config   (KEY=VALUE per line)
REM Required key: CLIO_SRC. Optional keys (sane defaults): MARKETPLACE_NAME, KN_URL, CONFIG,
REM       KN_REL_OWNER, KN_REL_REPO, KN_REL_ASSET, KN_REL_API (release-mode github-release source identity).
REM The CAADT repo path is auto-derived from this script's location -- do NOT configure it.
REM The knowledge source is chosen at step [0/7]: MODE (branch|release) via `release` 1st arg / KN_MODE env /
REM menu (default release); in BRANCH mode the ref is 1st arg / KN_BRANCH env / interactive menu / master.
REM
REM IMPORTANT: both a running MCP server and Claude Code hold the OLD state in
REM memory. After this script finishes you MUST:
REM   - restart the clio MCP server in your client (loads the new binary), and
REM   - restart the Claude Code session (reloads the plugin instructions).
REM ===========================================================================

REM --- Derive the CAADT repo root from THIS script's OWN location (no config needed) ---
REM   This script lives in <repo>\scripts\, so the repo root is one level up.
for %%I in ("%~dp0..") do set "REPO_ROOT=%%~fI"

REM --- Load the machine path(s) from the companion config file next to this script (only CLIO_SRC is required) ---
set "CONFIG_FILE=%~dp0build-dev-toolchain.config"
if not exist "%CONFIG_FILE%" (echo. & echo Missing config file: "%CONFIG_FILE%" & echo Create it with at least CLIO_SRC=... ^(see this script's header^). & exit /b 1)
for /f "usebackq eol=# tokens=1* delims==" %%K in ("%CONFIG_FILE%") do set "%%K=%%L"
REM Optional keys fall back to defaults; only CLIO_SRC is required.
if not defined MARKETPLACE_NAME set "MARKETPLACE_NAME=creatio"
if not defined KN_URL           set "KN_URL=https://github.com/Advance-Technologies-Foundation/clio-knowledge.git"
if not defined CONFIG           set "CONFIG=Release"
REM Release-mode (github-release) source identity; override in the config file only if the repo moves.
if not defined KN_REL_OWNER     set "KN_REL_OWNER=Advance-Technologies-Foundation"
if not defined KN_REL_REPO      set "KN_REL_REPO=clio-knowledge"
if not defined KN_REL_ASSET     set "KN_REL_ASSET=clio-knowledge-bundle.zip"
if not defined KN_REL_API       set "KN_REL_API=https://api.github.com/"
if not defined CLIO_SRC (echo. & echo CLIO_SRC is not set in "%CONFIG_FILE%" & exit /b 1)
REM Fail early if CLIO_SRC points nowhere -- otherwise step [1/7] would kill the user's clio.exe and
REM step [2/7] would only discover the bad path at the pushd, after side effects have already happened.
if not exist "%CLIO_SRC%\" (echo. & echo CLIO_SRC path does not exist: "%CLIO_SRC%" & exit /b 1)
REM --- Harden against command injection ---------------------------------------------------------------
REM KN_URL / KN_REL_* / KN_BRANCH / KN_MODE flow into the PowerShell steps below. They are passed to
REM PowerShell as ENVIRONMENT VARIABLES ($env:KN_*), never string-concatenated into the -Command text, so
REM a value containing a quote/backtick/$ cannot break out of the script and run arbitrary code. As an
REM extra guard we also validate each against a strict allow-list here and abort on anything else. The
REM check runs INSIDE PowerShell reading $env:* -- NOT `echo %VAR%|findstr`, because piping an echoed value
REM re-parses cmd metacharacters (&, |, <, >) in the pipe's child shell, which would itself be exploitable.
REM (KN_BRANCH is resolved later in [0/7], so it is validated there once known.)
powershell -NoProfile -Command "$bad=@(); if($env:KN_URL -notmatch '^[A-Za-z0-9._:@/-]+$'){$bad+='KN_URL'}; if($env:KN_REL_OWNER -notmatch '^[A-Za-z0-9._-]+$'){$bad+='KN_REL_OWNER'}; if($env:KN_REL_REPO -notmatch '^[A-Za-z0-9._-]+$'){$bad+='KN_REL_REPO'}; if($env:KN_REL_ASSET -notmatch '^[A-Za-z0-9._-]+$'){$bad+='KN_REL_ASSET'}; if($env:KN_REL_API -notmatch '^[A-Za-z0-9._:@/-]+$'){$bad+='KN_REL_API'}; if($bad){[Console]::Error.WriteLine('  config value(s) outside allow-list: '+($bad -join ', ')); exit 1}"
if errorlevel 1 (echo. & echo Aborting: a knowledge-source config value contains disallowed characters ^(allowed: letters digits . _ : @ / -^). & exit /b 1)
REM Plugin identity is read from the repo's OWN .claude-plugin\plugin.json (no hardcode); the local dev
REM marketplace is GENERATED under TEMP at step 7 with its plugin source = REPO_ROOT -- nothing by hand.
set "PLUGIN_NAME=creatio-ai-app-development-toolkit"
for /f "usebackq delims=" %%N in (`powershell -NoProfile -Command "try{(Get-Content -Raw (Join-Path $env:REPO_ROOT '.claude-plugin\plugin.json')^|ConvertFrom-Json).name}catch{''}" 2^>nul`) do if not "%%N"=="" set "PLUGIN_NAME=%%N"
set "PLUGIN_SOURCE=%PLUGIN_NAME%@%MARKETPLACE_NAME%"
set "GEN_MP_DIR=%TEMP%\clio-rebuild-marketplace"
set "PACK_OUT=%CLIO_SRC%\artifacts\local-tool"
REM Local-feed NuGet config is GENERATED at run time (step 4) from PACK_OUT.
set "NUGET_CONFIG=%TEMP%\clio-rebuild.nuget.config"

echo ===========================================================================
echo  STAGE A - clio MCP server binary  ^| src: %CLIO_SRC%
echo  STAGE C - clio knowledge base       ^| source chosen at [0/7] ^(release ^| branch^)
echo  STAGE B - CAADT plugin instructions ^| src: %REPO_ROOT%
echo ===========================================================================

echo.
echo === [0/7] Selecting knowledge source ^(mode + ref^) ===
REM Two source modes (see the Stage C header):
REM   branch  - git-sync a clio-knowledge branch/tag (dev; RAW bundle, needs allow-unsequenced flag)
REM   release - latest signed GitHub Release bundle (stable; "sequence" baked in, works on any clio)
REM Mode resolution:  1) 1st arg == "release"   2) KN_MODE env   3) interactive menu   4) default "release".
REM In BRANCH mode the ref resolves as before: 1st arg (a branch/tag name) / KN_BRANCH env / menu / master.
REM Examples:
REM   build-dev-toolchain.bat release            (latest signed release bundle)
REM   build-dev-toolchain.bat feature/my-branch  (git-sync that branch)
REM   build-dev-toolchain.bat 1.13.20            (git-sync that TAG)
REM A non-interactive run with no input falls through to release (latest signed bundle).

if /I "%~1"=="release" ( set "KN_MODE=release" & echo Mode from argument: release & goto :kn_mode_ready )
if defined KN_MODE ( echo Mode from KN_MODE env var: %KN_MODE% & goto :kn_mode_ready )
if not "%~1"=="" ( set "KN_MODE=branch" & goto :kn_mode_ready )
echo Select knowledge source mode:
echo   1^) release - latest signed GitHub Release bundle ^(stable^)
echo   2^) branch  - git-sync a clio-knowledge branch/tag ^(dev^)
set "KN_MODE_PICK="
set /p "KN_MODE_PICK=Select mode [1]: "
if "%KN_MODE_PICK%"=="2" ( set "KN_MODE=branch" ) else ( set "KN_MODE=release" )
:kn_mode_ready
if not defined KN_MODE set "KN_MODE=release"

if /I "%KN_MODE%"=="release" (
  set "KN_BRANCH="
  set "KN_REF_LABEL=release:latest"
  echo Selected knowledge source: release ^(latest signed bundle from %KN_REL_OWNER%/%KN_REL_REPO%^)
  goto :kn_select_done
)

REM ===== BRANCH mode: pick WHICH clio-knowledge branch/tag Stage C (step 6) syncs =====
if not "%~1"=="" ( set "KN_BRANCH=%~1" & echo Branch from argument: %~1 & goto :kn_branch_ready )
if defined KN_BRANCH ( echo Branch from KN_BRANCH env var: %KN_BRANCH% & goto :kn_branch_ready )
echo Fetching branches from %KN_URL% ...
set "KN_IDX=0"
for /f "usebackq tokens=1,2" %%a in (`git ls-remote --heads "%KN_URL%" 2^>nul`) do (
  set "KN_REF=%%b"
  set "KN_NAME=!KN_REF:refs/heads/=!"
  set /a KN_IDX+=1
  set "KN_BR_!KN_IDX!=!KN_NAME!"
  echo   !KN_IDX!^) !KN_NAME!
)
if %KN_IDX% EQU 0 ( set "KN_BRANCH=master" & echo   ^(could not list branches -- offline? using master^) & goto :kn_branch_ready )
set "KN_PICK="
set /p "KN_PICK=Select a branch by number or name [master]: "
if not defined KN_PICK ( set "KN_BRANCH=master" & goto :kn_branch_ready )
echo %KN_PICK%| findstr /r "^[1-9][0-9]*$" >nul
if errorlevel 1 ( set "KN_BRANCH=%KN_PICK%" & goto :kn_branch_ready )
call set "KN_BRANCH=%%KN_BR_%KN_PICK%%%"
if not defined KN_BRANCH ( set "KN_BRANCH=master" & echo   ^(number out of range -- using master^) )
:kn_branch_ready
if not defined KN_BRANCH set "KN_BRANCH=master"
REM KN_BRANCH is the key UNTRUSTED input -- it can come straight from `git ls-remote` on the remote or
REM from free-text menu input. It is consumed at step [6/7] via $env:KN_BRANCH (never concatenated into
REM the PowerShell command), but validate it here too: reject anything outside a strict git-ref allow-list
REM so a ref with a quote/backtick/$ cannot reach the PowerShell/appsettings edit at all. Validation runs
REM inside PowerShell over $env:KN_BRANCH (NOT `echo|findstr`, which would re-parse an embedded & in a
REM child shell).
powershell -NoProfile -Command "if($env:KN_BRANCH -match '^[A-Za-z0-9._/-]+$'){exit 0}else{exit 1}"
if errorlevel 1 (echo. & echo Invalid knowledge branch/tag name ^(allowed: letters digits . _ / -^). & echo   value: !KN_BRANCH! & exit /b 1)
set "KN_REF_LABEL=%KN_BRANCH%"
echo Selected knowledge branch: %KN_BRANCH%
:kn_select_done

echo.
echo === [1/7] Stopping running clio processes ^(incl. the MCP server^) ===
REM A running `clio mcp-server` locks clio.exe in the global tool store, which
REM would make the reinstall fail. Kill it; you restart the MCP server anyway.
taskkill /F /IM clio.exe /T >nul 2>&1
if "%errorlevel%"=="0" (echo Stopped running clio process^(es^).) else (echo No running clio process found.)

echo.
echo === [2/7] Resolving version from latest git tag ===
pushd "%CLIO_SRC%" || (echo Cannot cd to %CLIO_SRC% & exit /b 1)
set "VER="
for /f "usebackq delims=" %%v in (`git describe --tags --abbrev^=0 --match "[0-9]*.[0-9]*.[0-9]*.[0-9]*" 2^>nul`) do set "VER=%%v"
if not defined VER (set "VER=8.1.0.58" & echo No git tag found - using fallback !VER!) else (echo Version: !VER!)

echo.
echo === [3/7] Building + packing clio global tool ^(%CONFIG%^) ===
REM `dotnet pack` alone does NOT compile this multi-target PackAsTool project
REM (it fails with MSB3030 "clio.dll not found"): the tool-publish copy runs
REM before CoreCompile. So build first, then pack --no-build. The version is
REM passed explicitly -- the csproj only auto-derives it when AssemblyVersion
REM == 0.0.0.0, and that path is unreliable under --no-build (yields 0.0.0).
if exist "%PACK_OUT%" rmdir /S /Q "%PACK_OUT%"
rmdir /S /Q "clio\bin\Release" >nul 2>&1
rmdir /S /Q "clio\obj\Release" >nul 2>&1
dotnet build clio\clio.csproj -c %CONFIG% -p:Version=!VER! -p:AssemblyVersion=!VER! -p:FileVersion=!VER!
if errorlevel 1 (echo. & echo BUILD FAILED. & popd & exit /b 1)
dotnet pack clio\clio.csproj -c %CONFIG% --no-build -o "%PACK_OUT%" -p:Version=!VER! -p:PackageVersion=!VER!
if errorlevel 1 (echo. & echo PACK FAILED. & popd & exit /b 1)
if not exist "%PACK_OUT%\clio.!VER!.nupkg" (echo Expected %PACK_OUT%\clio.!VER!.nupkg not found & popd & exit /b 1)
echo Packed: clio.!VER!.nupkg

echo.
echo === [4/7] Reinstalling clio global tool ===
REM uninstall + install (NOT `tool update`): when the git tag is unchanged
REM between rebuilds, `update --version X` sees the same version already
REM installed and does nothing -- the new binary would NOT replace the old one.
REM uninstall+install force-replaces regardless of version.
REM --configfile (not --add-source): the machine's NuGet config uses package
REM source mapping, which forbids --add-source. The configfile replaces the
REM config hierarchy and maps the `clio` package to the local artifacts feed.
REM Generate the local-feed NuGet config from PACK_OUT so the feed path stays in sync
REM with wherever CLIO_SRC points -- no companion file with a hardcoded absolute path.
> "%NUGET_CONFIG%" echo ^<?xml version="1.0" encoding="utf-8"?^>
>>"%NUGET_CONFIG%" echo ^<configuration^>^<packageSources^>^<clear /^>^<add key="clio-local" value="%PACK_OUT%" /^>^<add key="nuget.org" value="https://api.nuget.org/v3/index.json" /^>^</packageSources^>
>>"%NUGET_CONFIG%" echo ^<packageSourceMapping^>^<packageSource key="clio-local"^>^<package pattern="clio" /^>^</packageSource^>^<packageSource key="nuget.org"^>^<package pattern="*" /^>^</packageSource^>^</packageSourceMapping^>^</configuration^>
dotnet tool uninstall -g clio >nul 2>&1
dotnet tool install -g clio --version "!VER!" --configfile "%NUGET_CONFIG%"
if errorlevel 1 (echo. & echo INSTALL FAILED. & popd & exit /b 1)

echo.
echo === [5/7] Verifying installed clio version ===
clio --version
popd

echo.
echo === [5b/7] Disabling clio auto-update ===
REM clio self-updates on startup: with autoupdate ENABLED, the NEXT clio launch (including the MCP
REM server's `mcp-server` startup, and step [6/7] install-knowledge below) runs `dotnet tool update clio -g`
REM in the background and REPLACES this freshly-installed LOCAL build with the latest RELEASED nuget
REM version -- silently wiping the unreleased edits this script exists to deploy (a local dev build's
REM version is typically BEHIND the release, so the updater always "upgrades" over it). Persist
REM autoupdate=false so the local binary sticks. The `autoupdate` verb itself is excluded from the startup
REM update check, so this call never triggers a revert. Re-enable later with `clio autoupdate --enable`.
clio autoupdate --disable

echo.
if /I "%KN_MODE%"=="release" (
  echo === [6/7] Syncing Clio knowledge base ^(release: latest signed bundle^) ===
) else (
  echo === [6/7] Syncing Clio knowledge base ^(branch: %KN_BRANCH%^) ===
)
REM `creatio-curated` is a BUILT-IN source that cannot be removed/re-added, so we reconfigure it by
REM editing appsettings.json directly, then run clio's own verified sync (server killed in step 1, so no
REM lock contention). The edit rewrites the source into ONE of two shapes based on the mode from [0/7]:
REM   branch  -> type=git, location=<KN_URL>, branch|tag=<ref>  (ref auto-classified: N.N* => tag),
REM              plus feature flag 'knowledge-allow-unsequenced'=true -- the raw bundle-source.json on a
REM              branch has no "sequence", so only a flag-aware clio can derive it and install cleanly.
REM   release -> type=github-release, repository-owner/name + asset-name; the SIGNED release manifest
REM              carries "sequence", so it validates on any clio and the flag is left untouched.
REM All transport-specific fields are cleared first, so the validator never sees a git ref on a
REM github-release source (or a release asset on a git source), which it rejects.
REM BRANCH mode only: refresh the cached knowledge git repo BEFORE the sync. clio's git transport only
REM fast-forwards refs it ALREADY knows; it does NOT fetch/prune to DISCOVER refs pushed since the last
REM clone. So a freshly-pushed branch/tag is invisible in the stale cache and its checkout fails with a
REM generic "Git knowledge synchronization failed / previous revision restored" (the real git error is
REM swallowed). A plain `git fetch --prune --tags` on the cached repo makes the new ref visible so the
REM sync resolves it. Best-effort: never fails the rebuild; release mode has no git cache so it is skipped.
if /I not "%KN_MODE%"=="release" powershell -NoProfile -Command "$h=if($env:CLIO_HOME){$env:CLIO_HOME}else{Join-Path $env:LOCALAPPDATA 'creatio\clio'}; $src=Join-Path $h 'knowledge\sources'; if(Test-Path $src){ Get-ChildItem $src -Directory -ErrorAction SilentlyContinue | ForEach-Object { $r=Join-Path $_.FullName 'repository'; if(Test-Path (Join-Path $r '.git')){ Write-Host ('  [kn] refreshing git cache (fetch --prune --tags): '+$_.Name); git -C $r fetch --prune --tags origin 2>&1 | Out-Null } } } else { Write-Host '  [kn] no knowledge git cache yet -- sync will clone fresh' }"
powershell -NoProfile -Command "$h=if($env:CLIO_HOME){$env:CLIO_HOME}else{Join-Path $env:LOCALAPPDATA 'creatio\clio'}; $p=Join-Path $h 'appsettings.json'; $mode=$env:KN_MODE; $ref=$env:KN_BRANCH; $gitUrl=$env:KN_URL; $relOwner=$env:KN_REL_OWNER; $relRepo=$env:KN_REL_REPO; $relAsset=$env:KN_REL_ASSET; $relApi=$env:KN_REL_API; $j=Get-Content $p -Raw|ConvertFrom-Json; $s=$j.knowledge.sources.'creatio-curated'; if(-not $s){Write-Host '  [kn] creatio-curated source missing in appsettings; skipping edit'; exit 0}; 'branch','tag','commit','package-id','repository-owner','repository-name','asset-name','trusted-key-id','trusted-public-key-path'|%%{$s.PSObject.Properties.Remove($_)}; if($mode -eq 'release'){Add-Member -InputObject $s -NotePropertyName type -NotePropertyValue 'github-release' -Force; Add-Member -InputObject $s -NotePropertyName location -NotePropertyValue $relApi -Force; Add-Member -InputObject $s -NotePropertyName 'repository-owner' -NotePropertyValue $relOwner -Force; Add-Member -InputObject $s -NotePropertyName 'repository-name' -NotePropertyValue $relRepo -Force; Add-Member -InputObject $s -NotePropertyName 'asset-name' -NotePropertyValue $relAsset -Force; Write-Host ('  [kn] creatio-curated -> github-release '+$relOwner+'/'+$relRepo+' asset '+$relAsset+' (latest)')}else{if(-not $j.features){Add-Member -InputObject $j -NotePropertyName features -NotePropertyValue ([pscustomobject]@{}) -Force}; if($j.features.PSObject.Properties['knowledge-allow-unsequenced']){$j.features.'knowledge-allow-unsequenced'=$true}else{Add-Member -InputObject $j.features -NotePropertyName 'knowledge-allow-unsequenced' -NotePropertyValue $true -Force}; $kind=if($ref -match '^\d+\.\d+'){'tag'}else{'branch'}; Add-Member -InputObject $s -NotePropertyName type -NotePropertyValue 'git' -Force; Add-Member -InputObject $s -NotePropertyName location -NotePropertyValue $gitUrl -Force; Add-Member -InputObject $s -NotePropertyName $kind -NotePropertyValue $ref -Force; Write-Host ('  [kn] creatio-curated -> '+$kind+' '+$ref+'; allow-unsequenced=true')}; [IO.File]::WriteAllText($p,($j|ConvertTo-Json -Depth 40))"
clio install-knowledge --source creatio-curated
if errorlevel 1 (
  echo   [warn] knowledge sync did not complete ^(offline, bad ref, or incompatible bundle^). non-fatal.
) else (
  if /I "%KN_MODE%"=="release" (echo Knowledge synced from latest release.) else (echo Knowledge synced from "%KN_BRANCH%".)
)
clio info-knowledge 2>nul | findstr /i "Valid Revision"

echo.
echo === [7/7] Refreshing CAADT plugin instructions ^(Claude Code^) ===
where claude >nul 2>&1
if errorlevel 1 (
  echo claude CLI not found on PATH - SKIPPING plugin-instruction refresh.
  echo The clio binary was still rebuilt. Install Claude Code or add it to PATH
  echo to enable Stage B.
  goto :done
)
if not exist "%REPO_ROOT%\.claude-plugin\plugin.json" (
  echo Missing %REPO_ROOT%\.claude-plugin\plugin.json
  echo This script must live under ^<caadt-repo^>\scripts\ so the repo root
  echo resolves to the CAADT plugin. SKIPPING plugin-instruction refresh.
  goto :done
)
REM Generate a self-contained local dev marketplace so Claude re-copies the LOCAL files (nothing to
REM create/configure by hand). Claude Code's validator only accepts a plugin `source` that is a RELATIVE
REM path DESCENDING into the marketplace root (an absolute path, or one with "..", is rejected at install),
REM so `source` cannot point straight at REPO_ROOT. Instead the marketplace root is %GEN_MP_DIR% under TEMP
REM and a directory JUNCTION inside it (named after the repo folder) points at REPO_ROOT; `source: ./<leaf>`
REM then descends into that junction and resolves to the LIVE repo (junctions need no admin and mirror the
REM working tree, so unreleased/uncommitted edits are picked up). If the junction cannot be created (e.g.
REM TEMP is not NTFS), fall back to the repo's PARENT as the marketplace root (still a descending ./<leaf>).
for %%I in ("%REPO_ROOT%") do set "REPO_LEAF=%%~nxI"
set "MP_ROOT=%GEN_MP_DIR%"
if not exist "%GEN_MP_DIR%\.claude-plugin" mkdir "%GEN_MP_DIR%\.claude-plugin" >nul 2>&1
REM (re)create a CLEAN junction: plain rmdir removes only the link, never the target's contents.
if exist "%GEN_MP_DIR%\!REPO_LEAF!" rmdir "%GEN_MP_DIR%\!REPO_LEAF!" >nul 2>&1
mklink /J "%GEN_MP_DIR%\!REPO_LEAF!" "%REPO_ROOT%" >nul 2>&1
if errorlevel 1 (
  for %%I in ("%REPO_ROOT%\..") do set "MP_ROOT=%%~fI"
  REM Record the out-of-TEMP artifact so the [cleanup] step removes it after install (it is only needed
  REM through `claude plugin install`, which copies the plugin into Claude's cache); this keeps the
  REM fallback from leaving a stray marketplace.json above the repo checkout.
  set "MP_FALLBACK_JSON=!MP_ROOT!\.claude-plugin\marketplace.json"
  echo   [mp] directory junction unavailable -- using the repo's parent as the marketplace root:
  echo        !MP_ROOT! ^(its ".claude-plugin\marketplace.json" is removed by the [cleanup] step below^).
)
echo - generating local dev marketplace ^(root: !MP_ROOT!; plugin source: ./!REPO_LEAF! -^> %REPO_ROOT%^)
set "MP_NAME=%MARKETPLACE_NAME%"
set "MP_PLUGIN=%PLUGIN_NAME%"
set "MP_LEAF=!REPO_LEAF!"
powershell -NoProfile -Command "$dir=Join-Path $env:MP_ROOT '.claude-plugin'; New-Item -ItemType Directory -Force -Path $dir | Out-Null; $mp=[ordered]@{ name=$env:MP_NAME; version='1.0.0'; description='Local dev marketplace generated by build-dev-toolchain.bat.'; owner=[ordered]@{ name='Creatio' }; plugins=@([ordered]@{ name=$env:MP_PLUGIN; description='CAADT plugin (local working copy).'; source=('./'+$env:MP_LEAF); category='development' }) }; [IO.File]::WriteAllText((Join-Path $dir 'marketplace.json'),($mp|ConvertTo-Json -Depth 10))"
if not exist "!MP_ROOT!\.claude-plugin\marketplace.json" (echo. & echo MARKETPLACE GENERATION FAILED. & exit /b 1)
REM Clean reinstall so Claude re-copies the local files into its plugin cache.
echo - uninstalling existing plugin ^(ignored if absent^)
call claude plugin uninstall "%PLUGIN_SOURCE%" >nul 2>&1
echo - removing existing '%MARKETPLACE_NAME%' marketplace ^(ignored if absent^)
call claude plugin marketplace remove "%MARKETPLACE_NAME%" >nul 2>&1
echo - registering generated local marketplace: !MP_ROOT!
call claude plugin marketplace add "!MP_ROOT!"
if errorlevel 1 (echo. & echo MARKETPLACE ADD FAILED. & exit /b 1)
echo - installing plugin: %PLUGIN_SOURCE%
call claude plugin install "%PLUGIN_SOURCE%"
if errorlevel 1 (echo. & echo PLUGIN INSTALL FAILED. & exit /b 1)

echo - deduplicating clio MCP server
REM The CAADT plugin (installed just above) registers its OWN 'clio' MCP server (mcp-server) via
REM its .mcp.json. If a user-scope 'clio' also exists in ~/.claude.json, Claude Code spawns BOTH --
REM two 'clio mcp-server' processes that contend on the knowledge-source mutation lock at startup,
REM which makes activation latch empty (get-guidance -> availableGuides: []). Removing the user-scope
REM duplicate leaves exactly one clio (the plugin's, which runs the dev-built binary on PATH).
REM Idempotent + best-effort: a no-op when there is no user-scope 'clio'.
call claude mcp remove clio -s user >nul 2>&1
if "%errorlevel%"=="0" (echo   removed user-scope 'clio' duplicate ^(plugin's clio remains^).) else (echo   no user-scope 'clio' duplicate ^(ok^).)

:done

REM Remove the out-of-TEMP marketplace artifact left by the junction fallback (set only on that path).
REM The plugin was already copied into Claude's cache by `plugin install` above, so the file is no longer
REM needed. rmdir (non-recursive) deletes the generated .claude-plugin folder ONLY if it is now empty --
REM it never touches the repo's parent directory itself or any pre-existing sibling content.
if defined MP_FALLBACK_JSON if exist "!MP_FALLBACK_JSON!" (
  del /q "!MP_FALLBACK_JSON!" >nul 2>&1
  for %%D in ("!MP_FALLBACK_JSON!\..") do rmdir "%%~fD" >nul 2>&1
  echo   - removed fallback marketplace artifact outside TEMP: !MP_FALLBACK_JSON!
)

echo.
echo === [cleanup] Removing stale knowledge-source lock markers ===
REM Every clio MCP server (stdio mcp-server and mcp-http) takes a short-lived per-source file lock
REM under knowledge\sources\.locks while it git-syncs the knowledge base on startup. If a server was
REM killed mid-sync -- by step 1 above, or a crashed/exited session -- the 0-byte marker is left
REM behind. It is harmless on its own (the store reuses it via OpenOrCreate), but sweeping the
REM ORPHANED markers keeps the cache tidy and removes a red herring when diagnosing a stuck MCP start.
REM Safety: a marker is treated as stale ONLY if it can be opened EXCLUSIVELY here; one still held by a
REM live clio process (another session's server) fails the open and is KEPT, so this never disturbs a
REM concurrently running server. This complements the clio-side fix that stops a contended startup sync
REM from blocking the MCP initialize handshake; it does not replace it.
powershell -NoProfile -Command "$locks=Join-Path $env:LOCALAPPDATA 'creatio\clio\knowledge\sources\.locks'; if(Test-Path $locks){ $removed=0; Get-ChildItem $locks -Filter *.lock -File -ErrorAction SilentlyContinue | ForEach-Object { try { $s=[IO.File]::Open($_.FullName,'Open','ReadWrite','None'); $s.Close(); Remove-Item $_.FullName -Force -ErrorAction Stop; $removed++; Write-Host ('  - removed stale lock: '+$_.Name) } catch { Write-Host ('  - kept in-use lock: '+$_.Name) } }; if($removed -eq 0){ Write-Host '  - no stale locks to remove' } } else { Write-Host '  - no .locks directory (nothing to clean)' }"

echo.
echo ===========================================================================
echo  Done.
echo   STAGE A: clio global tool rebuilt ^(version !VER!^); auto-update DISABLED so the released
echo            nuget version does not overwrite this local build ^(re-enable: clio autoupdate --enable^).
if /I "%KN_MODE%"=="release" (
  echo   STAGE C: Clio knowledge base synced from latest signed RELEASE ^(if reachable^).
) else (
  echo   STAGE C: Clio knowledge base synced from branch %KN_BRANCH% ^(if reachable^).
)
echo   STAGE B: CAADT plugin re-pointed at the local checkout and reinstalled;
echo            user-scope 'clio' MCP duplicate removed ^(one server = no lock contention^).
echo  NEXT - FULLY restart Claude Code ^(quit and reopen, not just /mcp reconnect^):
echo   - a full restart spawns ONE fresh clio server on the new binary; a bare reconnect
echo     can leave the old server running and re-create the two-server contention.
echo   - confirm afterwards: 'Get-Process clio' shows exactly ONE process.
echo ===========================================================================
endlocal
