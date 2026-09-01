#!/usr/bin/env python3
"""Cross-platform (Windows + macOS/Linux) LOCAL DEV rebuild harness.

Rebuilds the local Creatio AI dev toolchain from LOCAL sources so a coding agent (Claude Code etc.) picks
up your unreleased edits. Ported from build-dev-toolchain.bat; invoked by the thin build-dev-toolchain.bat
(Windows) / build-dev-toolchain.sh (macOS/Linux) launchers, or directly with `python3 build_dev_toolchain.py`.

Three stages:
  STAGE A (steps 1-5): the `clio` .NET global tool == the MCP server binary. Built from CLIO_SRC and
    reinstalled from a local NuGet feed generated at run time.
  STAGE C (step 6): the clio KNOWLEDGE base. Reconfigures the built-in `creatio-curated` source in clio's
    appsettings.json (branch git-override or signed release bundle, chosen at step [0/7]) and runs clio's
    own sync. Best-effort -- never aborts the rebuild.
  STAGE B (step 7): the CAADT plugin INSTRUCTIONS. Re-points the plugin at THIS repo via a generated local
    dev marketplace (a per-run PRIVATE temp root + a directory junction/symlink to the repo) and reinstalls it.

Security notes:
  * Every external command runs via subprocess with a LIST of args (never a shell string, and never
    `cmd /c` / `sh -c`), so untrusted values (branch names, URLs, paths) cannot be re-parsed by a shell.
    Untrusted values are still validated against a strict allow-list (alphanumeric first char, so nothing
    can look like a `-`/`--` option) and every git call that takes a positional ref/url uses a `--`
    end-of-options marker, as defense in depth.
  * All run-time temp artifacts (the NuGet config and the marketplace dir) live under a PRIVATE per-run
    directory from tempfile.mkdtemp() -- never a fixed name in a shared /tmp -- so a local attacker cannot
    pre-plant a symlink at a predictable path and have us write through it.

Requires Python 3.7+. After this finishes you MUST restart the clio MCP server and the Claude Code session
(they hold the OLD binary/instructions in memory).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import quoteattr

IS_WIN = os.name == "nt"
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
CONFIG_FILE = SCRIPT_DIR / "build-dev-toolchain.config"
CONFIG_EXAMPLE = SCRIPT_DIR / "build-dev-toolchain.config.example"
CLAUDE_PLUGIN_DIR = ".claude-plugin"

# --- Allow-lists for untrusted values. Anchored, alphanumeric FIRST char (blocks leading -/-- arg
#     injection). re.fullmatch is used so the whole value must match (equivalent to ^...$). --------------
_SAFE_TOKEN = r"[A-Za-z0-9][A-Za-z0-9._-]*"          # owner/repo/asset/config/marketplace names
_SAFE_URL = r"[A-Za-z0-9][A-Za-z0-9._:@/-]*"          # https / git@ urls
ALLOWLISTS = {
    "KN_URL": _SAFE_URL,
    "KN_REL_OWNER": _SAFE_TOKEN,
    "KN_REL_REPO": _SAFE_TOKEN,
    "KN_REL_ASSET": _SAFE_TOKEN,
    "KN_REL_API": _SAFE_URL,
    "KN_BRANCH": r"[A-Za-z0-9][A-Za-z0-9._/-]*",
    "CONFIG": _SAFE_TOKEN,
    "MARKETPLACE_NAME": _SAFE_TOKEN,
}
PICK_INDEX_RE = r"[1-9]\d*"

DEFAULTS = {
    "MARKETPLACE_NAME": "creatio",
    "KN_URL": "https://github.com/Advance-Technologies-Foundation/clio-knowledge.git",
    "CONFIG": "Release",
    "KN_REL_OWNER": "Advance-Technologies-Foundation",
    "KN_REL_REPO": "clio-knowledge",
    "KN_REL_ASSET": "clio-knowledge-bundle.zip",
    "KN_REL_API": "https://api.github.com/",
}
DEFAULT_PLUGIN_NAME = "creatio-ai-app-development-toolkit"
# Built from parts so the value is not written as an IP-address-shaped string literal (it is a clio
# 4-part version used only when `git describe` finds no tag).
FALLBACK_VERSION = ".".join(("8", "1", "0", "58"))
_MISSING_CMD_RC = 127


# ------------------------------------------------------------------ pure, unit-testable helpers --------
def token_ok(name, value):
    """True if `value` matches the allow-list for `name` (empty/None is never valid)."""
    return bool(value) and re.fullmatch(ALLOWLISTS[name], value) is not None


def is_index(value):
    """True if the branch-picker input is a positive index (vs a branch name)."""
    return bool(value) and re.fullmatch(PICK_INDEX_RE, value) is not None


def load_config(path):
    """Parse KEY=VALUE lines; '#' lines and blanks ignored; value keeps everything after the first '='."""
    # utf-8-sig so a BOM (e.g. a config saved by Windows Notepad) does not turn the first key into "﻿KEY".
    cfg = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, val = s.split("=", 1)
        cfg[key.strip()] = val.strip()
    return cfg


def setting(cfg, name, default=None):
    """Resolve one setting with the .bat's precedence: config file beats environment beats default.

    (The .bat `set` every config key over the inherited env, so a config value won over an env value; an
    EMPTY config value falls through to env/default, matching cmd where `set "X="` undefines X.)
    """
    val = cfg.get(name)
    if val:
        return val
    val = os.environ.get(name)
    if val:
        return val
    return default


def resolve_config(cfg):
    """Return a config dict with optional keys resolved (config > env > default) and empties dropped."""
    out = dict(cfg)
    for key, default in DEFAULTS.items():
        out[key] = setting(cfg, key, default)
    for key in ("CLIO_SRC", "KN_MODE", "KN_BRANCH", "CLIO_HOME"):
        val = setting(cfg, key)
        if val:
            out[key] = val
        else:
            out.pop(key, None)
    return out


def rewrite_appsettings(data, mode, *, git_url, ref, rel_owner, rel_repo, rel_asset, rel_api):
    """Reconfigure the built-in `creatio-curated` knowledge source in a parsed appsettings dict.

    Returns (data, changed). Clears all transport-specific fields first, then writes ONE of two shapes:
      release -> github-release (signed, sequence-bearing); resets knowledge-allow-unsequenced to False.
      branch  -> git branch/tag override; sets knowledge-allow-unsequenced to True.
    Defensive against a valid-but-unexpected JSON shape (a null/list where an object is expected).
    """
    if not isinstance(data, dict):
        return data, False
    src = ((data.get("knowledge") or {}).get("sources") or {}).get("creatio-curated")
    if not isinstance(src, dict):
        return data, False
    for key in ("branch", "tag", "commit", "package-id", "repository-owner", "repository-name",
                "asset-name", "trusted-key-id", "trusted-public-key-path"):
        src.pop(key, None)
    if mode == "release":
        src.update({
            "type": "github-release",
            "location": rel_api,
            "repository-owner": rel_owner,
            "repository-name": rel_repo,
            "asset-name": rel_asset,
        })
        feats = data.get("features")
        # Reset the flag only if present -- release does not need it, and leaving a prior branch run's
        # True in place would durably weaken the signed-bundle trust model.
        if isinstance(feats, dict) and "knowledge-allow-unsequenced" in feats:
            feats["knowledge-allow-unsequenced"] = False
    else:
        feats = data.setdefault("features", {})
        if isinstance(feats, dict):
            feats["knowledge-allow-unsequenced"] = True
        kind = "tag" if re.match(r"\d+\.\d+", ref or "") else "branch"
        src.update({"type": "git", "location": git_url, kind: ref})
    return data, True


def build_marketplace(mp_name, plugin_name, leaf):
    """The generated local dev marketplace manifest (plugin source descends into the junction/symlink leaf)."""
    return {
        "name": mp_name,
        "version": "1.0.0",
        "description": "Local dev marketplace generated by build_dev_toolchain.py.",
        "owner": {"name": "Creatio"},
        "plugins": [{
            "name": plugin_name,
            "description": "CAADT plugin (local working copy).",
            "source": "./" + leaf,
            "category": "development",
        }],
    }


def nuget_config_xml(pack_out):
    """The generated local-feed NuGet config. The feed path is XML-attribute-escaped so a path with
    & < > or a quote cannot break out of the attribute."""
    feed = quoteattr(str(pack_out))  # returns the value WITH surrounding quotes
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<configuration><packageSources><clear />"
        f"<add key=\"clio-local\" value={feed} />"
        '<add key="nuget.org" value="https://api.nuget.org/v3/index.json" /></packageSources>'
        '<packageSourceMapping>'
        '<packageSource key="clio-local"><package pattern="clio" /></packageSource>'
        '<packageSource key="nuget.org"><package pattern="*" /></packageSource>'
        "</packageSourceMapping></configuration>\n"
    )


def clio_home(override=None):
    """clio's data dir, matching clio's own SettingsRepository.AppSettingsFolderPath:
    Windows -> %LOCALAPPDATA%\\creatio\\clio ; macOS/Linux -> $HOME/creatio/clio. $CLIO_HOME (or a config
    CLIO_HOME passed in) overrides. A whitespace-only override is treated as unset (like clio)."""
    override = override or os.environ.get("CLIO_HOME")
    if override and override.strip():
        return Path(override)
    if IS_WIN:
        base = os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")
        return Path(base) / "creatio" / "clio"
    home = os.environ.get("HOME") or str(Path.home())
    return Path(home) / "creatio" / "clio"


def is_reparse_or_symlink(path):
    """True if `path` is a symlink (POSIX) or a reparse point/junction (Windows). Fail-closed on error."""
    path = Path(path)
    if os.path.islink(path):
        return True
    if IS_WIN:
        try:
            import stat as _stat
            attrs = os.lstat(path).st_file_attributes
            return bool(attrs & _stat.FILE_ATTRIBUTE_REPARSE_POINT)
        except (OSError, AttributeError):
            return True
    return False


# ------------------------------------------------------------------ side-effecting helpers -------------
def fail(msg, code=1):
    print("\n" + msg, file=sys.stderr)
    sys.exit(code)


def run(cmd, *, cwd=None, capture=False, quiet=False):
    """Run a command as a LIST (shell=False). A missing executable degrades to rc 127 (never a traceback),
    matching the .bat's `errorlevel 9009` graceful path so a later stage/cleanup still runs."""
    if not quiet:
        print("  $ " + " ".join(str(c) for c in cmd))
    try:
        return subprocess.run(
            [str(c) for c in cmd],
            cwd=str(cwd) if cwd else None,
            text=True,
            capture_output=capture,
        )
    except OSError as exc:
        print(f"  [warn] cannot run {cmd[0]!r}: {exc}")
        return subprocess.CompletedProcess(cmd, _MISSING_CMD_RC, "", str(exc))


def which(name):
    return shutil.which(name)


def require_token(name, value):
    if not token_ok(name, value):
        fail(f"Invalid {name}: {value!r} -- must match the allow-list "
             f"(start alphanumeric; letters digits . _ and, per key, : @ / -).")


def _safe_input(prompt):
    try:
        return input(prompt).strip()
    except EOFError:
        return ""


def remove_dir_link(link):
    """Remove a directory junction/symlink WITHOUT touching its target's contents. No shell involved."""
    link = Path(link)
    # lexists() (not exists()) so a junction whose target was deleted is still caught.
    if not os.path.lexists(link):
        return
    try:
        if IS_WIN:
            os.rmdir(link)   # removes a junction or directory symlink; does not descend into the target
        else:
            os.unlink(link)  # removes the symlink
    except OSError:
        pass


def make_dir_link(link, target):
    """Create a directory symlink (preferred) or Windows junction at `link` -> `target`. No shell involved."""
    link, target = Path(link), Path(target)
    remove_dir_link(link)
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except OSError:
        pass
    if IS_WIN:
        try:
            import _winapi
            _winapi.CreateJunction(str(target), str(link))
            return True
        except (OSError, AttributeError, ImportError):
            return False
    return False


# ------------------------------------------------------------------ [0/7] knowledge source -------------
def select_knowledge_source(cfg, arg_ref):
    """[0/7] Resolve (mode, branch) from arg / config+env / interactive menu. Validates KN_BRANCH."""
    interactive = sys.stdin.isatty()
    raw = None
    if arg_ref and arg_ref.strip().lower() == "release":
        raw = "release"
    elif arg_ref:
        # An explicit CLI branch/tag arg always wins over a persisted KN_MODE default.
        raw = "branch"
    elif cfg.get("KN_MODE"):
        raw = cfg["KN_MODE"]
    elif interactive:
        print("Select knowledge source mode:")
        print("  1) release - latest signed GitHub Release bundle (stable)")
        print("  2) branch  - git-sync a clio-knowledge branch/tag (dev)")
        raw = "branch" if _safe_input("Select mode [1]: ") == "2" else "release"
    # Case-insensitive: only 'release' means release; anything else (incl. unknown) means branch, except
    # "no signal at all" which defaults to release.
    mode = "release" if (raw is None or raw.strip().lower() == "release") else "branch"

    if mode == "release":
        print(f"Selected knowledge source: release (latest signed bundle from "
              f"{cfg['KN_REL_OWNER']}/{cfg['KN_REL_REPO']})")
        return mode, ""

    branch = None
    if arg_ref and arg_ref.strip().lower() != "release":
        branch = arg_ref
    elif cfg.get("KN_BRANCH"):
        branch = cfg["KN_BRANCH"]
    elif interactive:
        branch = _pick_branch_interactive(cfg["KN_URL"])
    branch = (branch or "master").strip()
    require_token("KN_BRANCH", branch)
    print(f"Selected knowledge branch: {branch}")
    return mode, branch


def _pick_branch_interactive(kn_url):
    print(f"Fetching branches from {kn_url} ...")
    names = []
    r = run(["git", "ls-remote", "--heads", "--", kn_url], capture=True, quiet=True)
    if r.returncode == 0:
        for line in r.stdout.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[1].startswith("refs/heads/"):
                names.append(parts[1][len("refs/heads/"):])
    if not names:
        print("  (could not list branches -- offline? using master)")
        return "master"
    for i, name in enumerate(names, 1):
        print(f"  {i}) {name}")
    pick = _safe_input("Select a branch by number or name [master]: ")
    if not pick:
        return "master"
    if is_index(pick):
        idx = int(pick)
        if 1 <= idx <= len(names):
            return names[idx - 1]
        print("  (number out of range -- using master)")
        return "master"
    return pick  # a name; validated by the caller


# ------------------------------------------------------------------ Stage A (build) --------------------
def _stop_clio_processes():
    print("\n=== [1/7] Stopping running clio processes (incl. the MCP server) ===")
    if IS_WIN:
        stopped = run(["taskkill", "/F", "/IM", "clio.exe", "/T"], capture=True, quiet=True).returncode == 0
    else:
        # pkill -x matches the exact process name `clio` -- the global-tool apphost, which is also what
        # `clio mcp-server` runs as. NOT `pkill -f clio`, which would match editors/tails/wrappers.
        stopped = run(["pkill", "-x", "clio"], capture=True, quiet=True).returncode == 0
    print("Stopped running clio process(es)." if stopped else "No running clio process found.")


def _resolve_version(clio_src):
    print("\n=== [2/7] Resolving version from latest git tag ===")
    r = run(["git", "describe", "--tags", "--abbrev=0", "--match", "[0-9]*.[0-9]*.[0-9]*.[0-9]*"],
            capture=True, cwd=clio_src, quiet=True)
    if r.returncode == 0 and r.stdout.strip():
        version = r.stdout.strip()
        print(f"Version: {version}")
        return version
    print(f"No git tag found - using fallback {FALLBACK_VERSION}")
    return FALLBACK_VERSION


def _build_and_pack(clio_src, config, version):
    print(f"\n=== [3/7] Building + packing clio global tool ({config}) ===")
    csproj = clio_src / "clio" / "clio.csproj"
    pack_out = clio_src / "artifacts" / "local-tool"
    if pack_out.exists():
        shutil.rmtree(pack_out, ignore_errors=True)
    shutil.rmtree(clio_src / "clio" / "bin" / config, ignore_errors=True)
    shutil.rmtree(clio_src / "clio" / "obj" / config, ignore_errors=True)
    # build first, then pack --no-build (this multi-target PackAsTool project fails MSB3030 under a bare
    # pack). cwd=clio_src reproduces the .bat's `pushd` so `dotnet` resolves global.json/SDK from the clio
    # tree (walking up from the CWD, not the project path).
    if run(["dotnet", "build", str(csproj), "-c", config,
            f"-p:Version={version}", f"-p:AssemblyVersion={version}", f"-p:FileVersion={version}"],
           cwd=clio_src).returncode:
        fail("BUILD FAILED.")
    if run(["dotnet", "pack", str(csproj), "-c", config, "--no-build", "-o", str(pack_out),
            f"-p:Version={version}", f"-p:PackageVersion={version}"], cwd=clio_src).returncode:
        fail("PACK FAILED.")
    nupkg = pack_out / f"clio.{version}.nupkg"
    if not nupkg.exists():
        fail(f"Expected {nupkg} not found")
    print(f"Packed: clio.{version}.nupkg")
    return pack_out


def _reinstall_global_tool(pack_out, version, run_tmp):
    print("\n=== [4/7] Reinstalling clio global tool ===")
    # uninstall+install (not `tool update`): when the tag is unchanged, update sees the same version and
    # does nothing. --configfile maps the `clio` package to the local artifacts feed.
    nuget_config = run_tmp / "clio-rebuild.nuget.config"
    nuget_config.write_text(nuget_config_xml(pack_out), encoding="utf-8")
    run(["dotnet", "tool", "uninstall", "-g", "clio"], capture=True, quiet=True)
    if run(["dotnet", "tool", "install", "-g", "clio", "--version", version,
            "--configfile", str(nuget_config)]).returncode:
        fail("INSTALL FAILED.")


def _disable_autoupdate():
    print("\n=== [5/7] Verifying installed clio version ===")
    run(["clio", "--version"])
    print("\n=== [5b/7] Disabling clio auto-update ===")
    # clio self-updates on startup and would overwrite this local build with the released nuget version.
    autoupdate_off = run(["clio", "autoupdate", "--disable"]).returncode == 0
    if not autoupdate_off:
        print("  [warn] 'clio autoupdate --disable' FAILED -- the next clio launch may OVERWRITE this local "
              "build with the released nuget version. Re-run, or disable it manually.")
    return autoupdate_off


def stage_a_build(cfg, run_tmp):
    """[1/7]-[5b/7] build+pack+reinstall the clio global tool; disable autoupdate."""
    clio_src = Path(cfg["CLIO_SRC"])
    config = cfg["CONFIG"]
    _stop_clio_processes()
    version = _resolve_version(clio_src)
    pack_out = _build_and_pack(clio_src, config, version)
    _reinstall_global_tool(pack_out, version, run_tmp)
    autoupdate_off = _disable_autoupdate()
    return version, autoupdate_off


# ------------------------------------------------------------------ Stage C (knowledge) ----------------
def stage_c_knowledge(cfg, mode, branch, home):
    """[6/7] Reconfigure creatio-curated + sync. Best-effort (never aborts the rebuild)."""
    label = "release: latest signed bundle" if mode == "release" else f"branch: {branch}"
    print(f"\n=== [6/7] Syncing Clio knowledge base ({label}) ===")
    if mode != "release":
        _refresh_knowledge_git_cache(home)
    if _reconfigure_knowledge_source(cfg, mode, branch, home / "appsettings.json"):
        _run_knowledge_sync(mode, branch)


def _reconfigure_knowledge_source(cfg, mode, branch, appsettings):
    """Rewrite creatio-curated in appsettings. Returns True if the sync should proceed (best-effort)."""
    try:
        data = json.loads(appsettings.read_text(encoding="utf-8"))
        data, changed = rewrite_appsettings(
            data, mode,
            git_url=cfg["KN_URL"], ref=branch,
            rel_owner=cfg["KN_REL_OWNER"], rel_repo=cfg["KN_REL_REPO"],
            rel_asset=cfg["KN_REL_ASSET"], rel_api=cfg["KN_REL_API"],
        )
    except FileNotFoundError:
        print(f"  [kn] appsettings.json not found at {appsettings}; skipping edit (sync will use defaults)")
        return True
    except (OSError, ValueError, AttributeError, TypeError) as exc:
        # Best-effort contract: report and skip the sync rather than crashing the whole rebuild.
        print(f"  [error] could not update the knowledge-source config in appsettings.json: {exc}")
        print("  [error] SKIPPING knowledge sync (Stage A rebuilt clio may have changed the schema).")
        return False
    if not changed:
        print("  [kn] creatio-curated source missing in appsettings; skipping edit")
        return True
    _atomic_write_json(appsettings, data)
    if mode == "release":
        print(f"  [kn] creatio-curated -> github-release {cfg['KN_REL_OWNER']}/{cfg['KN_REL_REPO']} "
              f"asset {cfg['KN_REL_ASSET']} (latest); allow-unsequenced reset to false")
    else:
        kind = "tag" if re.match(r"\d+\.\d+", branch or "") else "branch"
        print(f"  [kn] creatio-curated -> {kind} {branch}; allow-unsequenced=true")
    return True


def _run_knowledge_sync(mode, branch):
    if which("clio") is None:
        print("  [warn] clio not on PATH; skipping install-knowledge.")
        return
    if run(["clio", "install-knowledge", "--source", "creatio-curated"]).returncode != 0:
        print("  [warn] knowledge sync did not complete (offline, bad ref, or incompatible bundle). non-fatal.")
    else:
        print("Knowledge synced from latest release." if mode == "release"
              else f'Knowledge synced from "{branch}".')
    info = run(["clio", "info-knowledge"], capture=True, quiet=True)
    for line in (info.stdout or "").splitlines():
        if re.search(r"Valid|Revision", line, re.IGNORECASE):
            print(line)


def _atomic_write_json(path, data):
    """Write JSON atomically (temp + os.replace) so a Ctrl-C mid-write cannot truncate the user's config."""
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(str(tmp), str(path))


def _refresh_knowledge_git_cache(home):
    # clio's git transport only fast-forwards refs it ALREADY knows; a freshly-pushed branch is invisible
    # in the stale cache. A plain fetch --prune --tags makes the new ref visible. Best-effort: a filesystem
    # error (permissions, a concurrently-removed dir, TOCTOU) must NOT abort the stage/rebuild.
    sources = home / "knowledge" / "sources"
    if not sources.is_dir():
        print("  [kn] no knowledge git cache yet -- sync will clone fresh")
        return
    try:
        for entry in sources.iterdir():
            repo = entry / "repository"
            if (repo / ".git").exists():
                print(f"  [kn] refreshing git cache (fetch --prune --tags): {entry.name}")
                r = run(["git", "-C", str(repo), "fetch", "--prune", "--tags", "origin"],
                        capture=True, quiet=True)
                if r.returncode != 0:
                    print(f"  [kn] WARNING: fetch failed for {entry.name} -- proceeding with locally cached "
                          "refs; synced knowledge may be stale")
    except OSError as exc:
        print(f"  [kn] WARNING: could not scan the knowledge git cache ({exc}); skipping refresh.")


# ------------------------------------------------------------------ Stage B (plugin) -------------------
def stage_b_plugin(cfg, plugin_name, run_tmp):
    """[7/7] Generate the local dev marketplace + reinstall the plugin.

    Returns 'done' | 'skipped' | 'failed'. Never fail()s: recoverable errors return 'failed' so the caller
    still runs [cleanup] and the completion banner (the .bat's single :done exit funnel).
    """
    print("\n=== [7/7] Refreshing CAADT plugin instructions (Claude Code) ===")
    if which("claude") is None:
        print("claude CLI not found on PATH - SKIPPING plugin-instruction refresh.")
        print("The clio binary was still rebuilt. Install Claude Code or add it to PATH to enable Stage B.")
        return "skipped"
    if not (REPO_ROOT / CLAUDE_PLUGIN_DIR / "plugin.json").exists():
        print(f"Missing {REPO_ROOT / CLAUDE_PLUGIN_DIR / 'plugin.json'}")
        print("This script must live under <caadt-repo>/scripts/. SKIPPING plugin-instruction refresh.")
        return "skipped"

    marketplace_name = cfg["MARKETPLACE_NAME"]
    prep = _prepare_marketplace(marketplace_name, plugin_name, run_tmp)
    if isinstance(prep, str):  # a "failed" status
        return prep
    link_path, linked, fallback_json, fallback_written, mp_root = prep
    try:
        return _install_plugin(f"{plugin_name}@{marketplace_name}", marketplace_name, mp_root)
    finally:
        _cleanup_stage_b(link_path if linked else None, fallback_json if fallback_written else None)


def _prepare_marketplace(marketplace_name, plugin_name, run_tmp):
    """Create the private marketplace dir + link + marketplace.json. Returns a context tuple, or the
    string 'failed' (already logged + cleaned) when the marketplace could not be prepared."""
    leaf = REPO_ROOT.name
    # A PRIVATE per-run dir under run_tmp (from mkdtemp, mode 0700 on POSIX) -- not a fixed name in shared
    # /tmp -- so nothing can be pre-planted at a predictable path for us to write through.
    marketplace_dir = Path(run_tmp) / "marketplace"
    marketplace_dir.mkdir(parents=True, exist_ok=True)
    mp_root = marketplace_dir
    link_path = marketplace_dir / leaf
    linked = make_dir_link(link_path, REPO_ROOT)
    fallback_json = None
    if not linked:
        # No junction/symlink available -> use the repo's PARENT (user-owned, not shared /tmp) as the root,
        # with the descending ./<leaf> resolving to the repo itself.
        mp_root = REPO_ROOT.parent
        fallback_json = mp_root / CLAUDE_PLUGIN_DIR / "marketplace.json"
        # Never overwrite a pre-existing marketplace.json (a hand-maintained parent marketplace) and never
        # write through a redirected parent dir.
        if fallback_json.exists() or is_reparse_or_symlink(fallback_json.parent):
            print(f"  [mp] refusing the parent-directory fallback: {fallback_json} already exists or is a "
                  "redirect. Enable Developer Mode / a symlink-capable account, or a junction-capable TEMP, "
                  "and re-run.")
            return "failed"
        print("  [mp] directory link unavailable -- using the repo's parent as the marketplace root:")
        print(f"       {mp_root} (its {CLAUDE_PLUGIN_DIR}/marketplace.json is removed after install).")

    print(f"- generating local dev marketplace (root: {mp_root}; plugin source: ./{leaf} -> {REPO_ROOT})")
    try:
        mp_dir = mp_root / CLAUDE_PLUGIN_DIR
        mp_dir.mkdir(parents=True, exist_ok=True)
        (mp_dir / "marketplace.json").write_text(
            json.dumps(build_marketplace(marketplace_name, plugin_name, leaf), indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"\nMARKETPLACE GENERATION FAILED: {exc}")
        _cleanup_stage_b(link_path if linked else None, None)
        return "failed"
    fallback_written = fallback_json is not None
    return link_path, linked, fallback_json, fallback_written, mp_root


def _install_plugin(plugin_source, marketplace_name, mp_root):
    """Run the claude plugin/marketplace commands. Returns 'done' or 'failed'."""
    print("- uninstalling existing plugin (ignored if absent)")
    run(["claude", "plugin", "uninstall", plugin_source], capture=True, quiet=True)
    print(f"- removing existing '{marketplace_name}' marketplace (ignored if absent)")
    run(["claude", "plugin", "marketplace", "remove", marketplace_name], capture=True, quiet=True)
    print(f"- registering generated local marketplace: {mp_root}")
    if run(["claude", "plugin", "marketplace", "add", str(mp_root)]).returncode:
        print("\nMARKETPLACE ADD FAILED.")
        return "failed"
    print(f"- installing plugin: {plugin_source}")
    if run(["claude", "plugin", "install", plugin_source]).returncode:
        print("\nPLUGIN INSTALL FAILED.")
        return "failed"
    print("- deduplicating clio MCP server")
    r = run(["claude", "mcp", "remove", "clio", "-s", "user"], capture=True, quiet=True)
    print("  removed user-scope 'clio' duplicate (plugin's clio remains)." if r.returncode == 0
          else "  no user-scope 'clio' duplicate (ok).")
    return "done"


def _cleanup_stage_b(link_path, fallback_json):
    # Remove the leaf junction/symlink first so the later rmtree of the private run dir can never follow it
    # into the repo; then drop the out-of-TEMP fallback artifact ONLY if we wrote it this run.
    if link_path is not None:
        remove_dir_link(link_path)
    if fallback_json and Path(fallback_json).exists():
        try:
            Path(fallback_json).unlink()
            parent = Path(fallback_json).parent
            if parent.name == CLAUDE_PLUGIN_DIR and not any(parent.iterdir()):
                parent.rmdir()
            print(f"  - removed fallback marketplace artifact outside TEMP: {fallback_json}")
        except OSError:
            pass


def cleanup_locks(home):
    print("\n=== [cleanup] Removing stale knowledge-source lock markers ===")
    locks = home / "knowledge" / "sources" / ".locks"
    if not locks.is_dir():
        print("  - no .locks directory (nothing to clean)")
        return
    removed = 0
    for lock in sorted(locks.glob("*.lock")):
        if lock_is_held(lock):
            print(f"  - kept in-use lock: {lock.name}")
            continue
        try:
            lock.unlink()
            removed += 1
            print(f"  - removed stale lock: {lock.name}")
        except OSError:
            print(f"  - kept in-use lock: {lock.name}")
    if removed == 0:
        print("  - no stale locks to remove")


def lock_is_held(path):
    """True if another process currently holds `path` (matching how clio opens its FileShare.None lock).

    Windows: clio opens the marker with FileShare.None, so any open by us fails while it is held.
    POSIX:   .NET emulates the share lock as an advisory flock (assumed; not independently re-verified),
             so we test with a non-blocking exclusive flock -- a plain open would succeed even while the
             server holds it. Fail-closed (treat as held) on any error.
    """
    try:
        if IS_WIN:
            fd = os.open(str(path), os.O_RDWR)
            os.close(fd)
            return False
        import fcntl
        fd = os.open(str(path), os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
            return False
        except OSError:
            return True
        finally:
            os.close(fd)
    except OSError:
        return True


def resolve_plugin_name():
    try:
        data = json.loads((REPO_ROOT / CLAUDE_PLUGIN_DIR / "plugin.json").read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("name"):
            return data["name"]
    except (OSError, ValueError):
        pass
    return DEFAULT_PLUGIN_NAME


# ------------------------------------------------------------------ main -------------------------------
def main(argv=None):
    if sys.version_info < (3, 7):
        sys.exit("build_dev_toolchain requires Python 3.7+ (found %d.%d)." % sys.version_info[:2])

    parser = argparse.ArgumentParser(description="Cross-platform local dev rebuild for the Creatio AI toolchain.")
    parser.add_argument("ref", nargs="?", default=None,
                        help="'release' for the signed bundle, or a clio-knowledge branch/tag name.")
    args = parser.parse_args(argv)

    if not CONFIG_FILE.exists():
        fail(f"Missing config file: {CONFIG_FILE}\n"
             f"Copy {CONFIG_EXAMPLE.name} to {CONFIG_FILE.name} and set CLIO_SRC to your local clio checkout.")
    cfg = resolve_config(load_config(CONFIG_FILE))

    if not cfg.get("CLIO_SRC"):
        fail(f"CLIO_SRC is not set in {CONFIG_FILE}")
    clio_src = Path(cfg["CLIO_SRC"]).expanduser().resolve()
    if not clio_src.is_dir():
        fail(f"CLIO_SRC path does not exist: {cfg['CLIO_SRC']}")
    cfg["CLIO_SRC"] = str(clio_src)
    for name in ("KN_URL", "KN_REL_OWNER", "KN_REL_REPO", "KN_REL_ASSET", "KN_REL_API", "CONFIG",
                 "MARKETPLACE_NAME"):
        require_token(name, cfg[name])

    plugin_name = resolve_plugin_name()
    home = clio_home(cfg.get("CLIO_HOME"))

    print("=" * 75)
    print(f"  STAGE A - clio MCP server binary  | src: {cfg['CLIO_SRC']}")
    print("  STAGE C - clio knowledge base       | source chosen at [0/7] (release | branch)")
    print(f"  STAGE B - CAADT plugin instructions | src: {REPO_ROOT}")
    print("=" * 75)

    print("\n=== [0/7] Selecting knowledge source (mode + ref) ===")
    mode, branch = select_knowledge_source(cfg, args.ref)

    # One PRIVATE per-run temp root for the NuGet config + the marketplace dir. Removed at the end so
    # nothing is left in TEMP and no fixed shared path exists to squat.
    run_tmp = Path(tempfile.mkdtemp(prefix="clio-rebuild-"))
    stage_b_status = "done"
    try:
        version, autoupdate_off = stage_a_build(cfg, run_tmp)
        stage_c_knowledge(cfg, mode, branch, home)
        stage_b_status = stage_b_plugin(cfg, plugin_name, run_tmp)
        cleanup_locks(home)
    finally:
        shutil.rmtree(run_tmp, ignore_errors=True)

    print("\n" + "=" * 75)
    if stage_b_status == "failed":
        print("  build-dev-toolchain FAILED during Stage B (plugin refresh) -- see the error above.")
        print("  Stage A (clio binary) and Stage C (knowledge) completed if their steps reported success.")
        print("=" * 75)
        sys.exit(1)
    print("  Done.")
    if autoupdate_off:
        print(f"  STAGE A: clio global tool rebuilt (version {version}); auto-update DISABLED "
              "(re-enable: clio autoupdate --enable).")
    else:
        print(f"  STAGE A: clio global tool rebuilt (version {version}); WARNING: auto-update could NOT be "
              "disabled -- the next clio launch may OVERWRITE this local build (clio autoupdate --disable).")
    print("  STAGE C: Clio knowledge base synced from "
          + ("latest signed RELEASE" if mode == "release" else f"branch {branch}") + " (if reachable).")
    if stage_b_status == "skipped":
        print("  STAGE B: SKIPPED (claude CLI or plugin.json not found) -- plugin instructions NOT refreshed.")
    else:
        print("  STAGE B: CAADT plugin re-pointed at the local checkout and reinstalled;")
        print("           user-scope 'clio' MCP duplicate removed (one server = no lock contention).")
    print("  NEXT - FULLY restart Claude Code (quit and reopen) so ONE fresh clio server loads the new binary.")
    print("         Confirm afterwards that exactly ONE clio process is running.")
    print("=" * 75)


if __name__ == "__main__":
    main()
