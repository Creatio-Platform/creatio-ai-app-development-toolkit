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
    own sync. Best-effort.
  STAGE B (step 7): the CAADT plugin INSTRUCTIONS. Re-points the plugin at THIS repo via a generated local
    dev marketplace (a per-run PRIVATE temp root + a directory junction/symlink to the repo) and reinstalls it.

Security notes:
  * Every external command runs via subprocess with a LIST of args (never a shell string), so untrusted
    values (branch names, URLs) cannot be re-parsed by a shell -- the injection class a batch/shell port
    must defend against by hand does not exist here. Untrusted values are still validated against a strict
    allow-list (alphanumeric first char, so nothing can look like a `-`/`--` git option) and every git call
    that takes a positional ref/url uses a `--` end-of-options marker, as defense in depth.
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

# --- Allow-lists for untrusted values. Anchored, alphanumeric FIRST char (blocks leading -/-- git-arg
#     injection). re.fullmatch is used so the whole value must match (equivalent to ^...$). --------------
ALLOWLISTS = {
    "KN_URL": r"[A-Za-z0-9][A-Za-z0-9._:@/-]*",
    "KN_REL_OWNER": r"[A-Za-z0-9][A-Za-z0-9._-]*",
    "KN_REL_REPO": r"[A-Za-z0-9][A-Za-z0-9._-]*",
    "KN_REL_ASSET": r"[A-Za-z0-9][A-Za-z0-9._-]*",
    "KN_REL_API": r"[A-Za-z0-9][A-Za-z0-9._:@/-]*",
    "KN_BRANCH": r"[A-Za-z0-9][A-Za-z0-9._/-]*",
}
PICK_INDEX_RE = r"[1-9][0-9]*"

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
FALLBACK_VERSION = "8.1.0.58"


# ------------------------------------------------------------------ pure, unit-testable helpers --------
def token_ok(name, value):
    """True if `value` matches the allow-list for `name` (empty/None is never valid)."""
    return bool(value) and re.fullmatch(ALLOWLISTS[name], value) is not None


def is_index(value):
    """True if the branch-picker input is a positive index (vs a branch name)."""
    return bool(value) and re.fullmatch(PICK_INDEX_RE, value) is not None


def load_config(path):
    """Parse KEY=VALUE lines; '#' lines and blanks ignored; value keeps everything after the first '='."""
    cfg = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, val = s.split("=", 1)
        cfg[key.strip()] = val.strip()
    return cfg


def apply_defaults(cfg):
    for key, val in DEFAULTS.items():
        cfg.setdefault(key, val)
    return cfg


def rewrite_appsettings(data, mode, *, git_url, ref, rel_owner, rel_repo, rel_asset, rel_api):
    """Reconfigure the built-in `creatio-curated` knowledge source in a parsed appsettings dict.

    Returns (data, changed). Clears all transport-specific fields first, then writes ONE of two shapes:
      release -> github-release (signed, sequence-bearing); resets knowledge-allow-unsequenced to False.
      branch  -> git branch/tag override; sets knowledge-allow-unsequenced to True (raw bundles omit
                 "sequence", so only a flag-aware clio installs them).
    A ref matching N.N* is treated as a tag, else a branch.
    """
    src = data.get("knowledge", {}).get("sources", {}).get("creatio-curated")
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
    """The generated local-feed NuGet config. The feed path is XML-attribute-escaped (a CLIO_SRC with
    & < > or a quote must not be able to malform the config)."""
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


def clio_home():
    """clio's data dir: $CLIO_HOME override, else the platform LocalApplicationData/creatio/clio."""
    override = os.environ.get("CLIO_HOME")
    if override:
        return Path(override)
    if IS_WIN:
        base = os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")
        return Path(base) / "creatio" / "clio"
    # .NET's LocalApplicationData on macOS/Linux resolves to ~/.local/share
    return Path.home() / ".local" / "share" / "creatio" / "clio"


def lock_is_held(path):
    """True if another process currently holds `path` (matching how clio opens its FileShare.None lock).

    Windows: clio opens the marker with FileShare.None, so any open by us fails while it is held -> held.
    POSIX:   .NET emulates the share lock as an advisory flock, so we test with a non-blocking exclusive
             flock (a plain open would succeed even while the server holds it, which is exactly the bug the
             batch->python port could have introduced). Fail-closed (treat as held) on any error.
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


def is_reparse_or_symlink(path):
    """True if `path` is a symlink (POSIX) or a reparse point/junction (Windows). Used for defensive checks."""
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
    """Run a command as a LIST (shell=False). Returns CompletedProcess."""
    if not quiet:
        print("  $ " + " ".join(str(c) for c in cmd))
    return subprocess.run(
        [str(c) for c in cmd],
        cwd=str(cwd) if cwd else None,
        text=True,
        capture_output=capture,
    )


def which(name):
    return shutil.which(name)


def require_token(name, value):
    if not token_ok(name, value):
        fail(f"Invalid {name}: {value!r} -- must match the allow-list "
             f"(start alphanumeric; letters digits . _ and, per key, : @ / -).")


def remove_dir_link(link):
    """Remove a directory junction/symlink WITHOUT touching its target's contents."""
    link = Path(link)
    # lexists() (not exists()) so a junction whose target was deleted is still caught.
    if not os.path.lexists(link):
        return
    try:
        if IS_WIN:
            run(["cmd", "/c", "rmdir", str(link)], capture=True, quiet=True)
        elif os.path.islink(link):
            link.unlink()
    except OSError:
        pass


def make_dir_link(link, target):
    """Create a directory junction (Windows) or symlink (POSIX) at `link` -> `target`. Returns success."""
    link, target = Path(link), Path(target)
    remove_dir_link(link)
    if IS_WIN:
        r = run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture=True, quiet=True)
        return r.returncode == 0
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except OSError:
        return False


# ------------------------------------------------------------------ stages -----------------------------
def select_knowledge_source(args, cfg):
    """[0/7] Resolve (mode, branch) from arg / env / interactive menu. Validates KN_BRANCH."""
    interactive = sys.stdin.isatty()
    mode = None
    arg1 = args.ref
    if arg1 and arg1.lower() == "release":
        mode = "release"
    elif os.environ.get("KN_MODE"):
        mode = os.environ["KN_MODE"]
    elif arg1:
        mode = "branch"
    elif interactive:
        print("Select knowledge source mode:")
        print("  1) release - latest signed GitHub Release bundle (stable)")
        print("  2) branch  - git-sync a clio-knowledge branch/tag (dev)")
        mode = "branch" if input("Select mode [1]: ").strip() == "2" else "release"
    mode = "release" if mode not in ("release", "branch") else mode

    if mode == "release":
        print(f"Selected knowledge source: release (latest signed bundle from "
              f"{cfg['KN_REL_OWNER']}/{cfg['KN_REL_REPO']})")
        return mode, ""

    branch = None
    if arg1 and arg1.lower() != "release":
        branch = arg1
    elif os.environ.get("KN_BRANCH"):
        branch = os.environ["KN_BRANCH"]
    elif cfg.get("KN_BRANCH"):
        branch = cfg["KN_BRANCH"]
    elif interactive:
        branch = _pick_branch_interactive(cfg["KN_URL"])
    branch = branch or "master"
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
    pick = input("Select a branch by number or name [master]: ").strip()
    if not pick:
        return "master"
    if is_index(pick):
        idx = int(pick)
        if 1 <= idx <= len(names):
            return names[idx - 1]
        print("  (number out of range -- using master)")
        return "master"
    return pick  # a name; validated by the caller


def stage_a_build(cfg, run_tmp):
    """[1/7]-[5b/7] build+pack+reinstall the clio global tool; disable autoupdate. Returns (version, autoupdate_off)."""
    clio_src = Path(cfg["CLIO_SRC"])
    config = cfg["CONFIG"]
    csproj = clio_src / "clio" / "clio.csproj"

    print("\n=== [1/7] Stopping running clio processes (incl. the MCP server) ===")
    if IS_WIN:
        stopped = run(["taskkill", "/F", "/IM", "clio.exe", "/T"], capture=True, quiet=True).returncode == 0
    else:
        # pkill -x matches the exact process name `clio` -- that is the global-tool apphost, which is also
        # what `clio mcp-server` runs as. NOT `pkill -f clio`, which would kill any command line mentioning
        # clio (an editor, a tail, a wrapper script).
        stopped = run(["pkill", "-x", "clio"], capture=True, quiet=True).returncode == 0
    print("Stopped running clio process(es)." if stopped else "No running clio process found.")

    print("\n=== [2/7] Resolving version from latest git tag ===")
    version = FALLBACK_VERSION
    r = run(["git", "describe", "--tags", "--abbrev=0", "--match", "[0-9]*.[0-9]*.[0-9]*.[0-9]*"],
            capture=True, cwd=clio_src, quiet=True)
    if r.returncode == 0 and r.stdout.strip():
        version = r.stdout.strip()
        print(f"Version: {version}")
    else:
        print(f"No git tag found - using fallback {version}")

    print(f"\n=== [3/7] Building + packing clio global tool ({config}) ===")
    pack_out = clio_src / "artifacts" / "local-tool"
    if pack_out.exists():
        shutil.rmtree(pack_out, ignore_errors=True)
    shutil.rmtree(clio_src / "clio" / "bin" / config, ignore_errors=True)
    shutil.rmtree(clio_src / "clio" / "obj" / config, ignore_errors=True)
    # build first, then pack --no-build (this multi-target PackAsTool project fails MSB3030 under a bare pack).
    if run(["dotnet", "build", str(csproj), "-c", config,
            f"-p:Version={version}", f"-p:AssemblyVersion={version}", f"-p:FileVersion={version}"]).returncode:
        fail("BUILD FAILED.")
    if run(["dotnet", "pack", str(csproj), "-c", config, "--no-build", "-o", str(pack_out),
            f"-p:Version={version}", f"-p:PackageVersion={version}"]).returncode:
        fail("PACK FAILED.")
    nupkg = pack_out / f"clio.{version}.nupkg"
    if not nupkg.exists():
        fail(f"Expected {nupkg} not found")
    print(f"Packed: clio.{version}.nupkg")

    print("\n=== [4/7] Reinstalling clio global tool ===")
    # uninstall+install (not `tool update`): when the tag is unchanged, update sees the same version and
    # does nothing. --configfile maps the `clio` package to the local artifacts feed.
    nuget_config = run_tmp / "clio-rebuild.nuget.config"
    nuget_config.write_text(nuget_config_xml(pack_out), encoding="utf-8")
    run(["dotnet", "tool", "uninstall", "-g", "clio"], capture=True, quiet=True)
    if run(["dotnet", "tool", "install", "-g", "clio", "--version", version,
            "--configfile", str(nuget_config)]).returncode:
        fail("INSTALL FAILED.")

    print("\n=== [5/7] Verifying installed clio version ===")
    run(["clio", "--version"])

    print("\n=== [5b/7] Disabling clio auto-update ===")
    # clio self-updates on startup and would overwrite this local build with the released nuget version.
    autoupdate_off = run(["clio", "autoupdate", "--disable"]).returncode == 0
    if not autoupdate_off:
        print("  [warn] 'clio autoupdate --disable' FAILED -- the next clio launch may OVERWRITE this local "
              "build with the released nuget version. Re-run, or disable it manually.")
    return version, autoupdate_off


def stage_c_knowledge(cfg, mode, branch):
    """[6/7] Reconfigure creatio-curated + sync. Best-effort (never aborts the rebuild)."""
    if mode == "release":
        print("\n=== [6/7] Syncing Clio knowledge base (release: latest signed bundle) ===")
    else:
        print(f"\n=== [6/7] Syncing Clio knowledge base (branch: {branch}) ===")

    home = clio_home()
    appsettings = home / "appsettings.json"

    if mode != "release":
        _refresh_knowledge_git_cache(home)

    try:
        data = json.loads(appsettings.read_text(encoding="utf-8"))
        data, changed = rewrite_appsettings(
            data, mode,
            git_url=cfg["KN_URL"], ref=branch,
            rel_owner=cfg["KN_REL_OWNER"], rel_repo=cfg["KN_REL_REPO"],
            rel_asset=cfg["KN_REL_ASSET"], rel_api=cfg["KN_REL_API"],
        )
        if not changed:
            print("  [kn] creatio-curated source missing in appsettings; skipping edit")
        else:
            appsettings.write_text(json.dumps(data, indent=2), encoding="utf-8")
            if mode == "release":
                print(f"  [kn] creatio-curated -> github-release {cfg['KN_REL_OWNER']}/{cfg['KN_REL_REPO']} "
                      f"asset {cfg['KN_REL_ASSET']} (latest); allow-unsequenced reset to false")
            else:
                kind = "tag" if re.match(r"\d+\.\d+", branch or "") else "branch"
                print(f"  [kn] creatio-curated -> {kind} {branch}; allow-unsequenced=true")
    except FileNotFoundError:
        print(f"  [kn] appsettings.json not found at {appsettings}; skipping edit (sync will use defaults)")
    except (OSError, ValueError) as exc:
        # Fail LOUDLY on a rewrite error rather than syncing against a stale/unknown config, but keep the
        # overall rebuild alive.
        print(f"  [error] could not update the knowledge-source config in appsettings.json: {exc}")
        print("  [error] SKIPPING knowledge sync (Stage A rebuilt clio may have changed the schema).")
        return

    if which("clio") is None:
        print("  [warn] clio not on PATH; skipping install-knowledge.")
        return
    rc = run(["clio", "install-knowledge", "--source", "creatio-curated"]).returncode
    if rc != 0:
        print("  [warn] knowledge sync did not complete (offline, bad ref, or incompatible bundle). non-fatal.")
    else:
        print("Knowledge synced from latest release." if mode == "release"
              else f'Knowledge synced from "{branch}".')
    info = run(["clio", "info-knowledge"], capture=True, quiet=True)
    if info.returncode == 0:
        for line in info.stdout.splitlines():
            if re.search(r"Valid|Revision", line, re.IGNORECASE):
                print(line)


def _refresh_knowledge_git_cache(home):
    # clio's git transport only fast-forwards refs it ALREADY knows; a freshly-pushed branch is invisible
    # in the stale cache. A plain fetch --prune --tags makes the new ref visible. Best-effort.
    sources = home / "knowledge" / "sources"
    if not sources.is_dir():
        print("  [kn] no knowledge git cache yet -- sync will clone fresh")
        return
    for entry in sources.iterdir():
        repo = entry / "repository"
        if (repo / ".git").exists():
            print(f"  [kn] refreshing git cache (fetch --prune --tags): {entry.name}")
            r = run(["git", "-C", str(repo), "fetch", "--prune", "--tags", "origin"],
                    capture=True, quiet=True)
            if r.returncode != 0:
                print(f"  [kn] WARNING: fetch failed for {entry.name} -- proceeding with locally cached "
                      "refs; synced knowledge may be stale")


def stage_b_plugin(cfg, plugin_name, run_tmp):
    """[7/7] Generate the local dev marketplace + reinstall the plugin. Returns True on success.

    Never calls fail(): recoverable errors return False so the caller still runs the [cleanup] step and the
    completion banner (matching the .bat's single :done exit funnel).
    """
    print("\n=== [7/7] Refreshing CAADT plugin instructions (Claude Code) ===")
    if which("claude") is None:
        print("claude CLI not found on PATH - SKIPPING plugin-instruction refresh.")
        print("The clio binary was still rebuilt. Install Claude Code or add it to PATH to enable Stage B.")
        return True
    if not (REPO_ROOT / ".claude-plugin" / "plugin.json").exists():
        print(f"Missing {REPO_ROOT / '.claude-plugin' / 'plugin.json'}")
        print("This script must live under <caadt-repo>/scripts/. SKIPPING plugin-instruction refresh.")
        return True

    marketplace_name = cfg["MARKETPLACE_NAME"]
    plugin_source = f"{plugin_name}@{marketplace_name}"
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
        # with the descending ./<leaf> resolving to the repo itself. Its marketplace.json is cleaned below.
        mp_root = REPO_ROOT.parent
        fallback_json = mp_root / ".claude-plugin" / "marketplace.json"
        print("  [mp] directory link unavailable -- using the repo's parent as the marketplace root:")
        print(f"       {mp_root} (its .claude-plugin/marketplace.json is removed after install).")

    print(f"- generating local dev marketplace (root: {mp_root}; plugin source: ./{leaf} -> {REPO_ROOT})")
    ok = True
    try:
        mp_dir = mp_root / ".claude-plugin"
        mp_dir.mkdir(parents=True, exist_ok=True)
        (mp_dir / "marketplace.json").write_text(
            json.dumps(build_marketplace(marketplace_name, plugin_name, leaf), indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"\nMARKETPLACE GENERATION FAILED: {exc}")
        _cleanup_stage_b(link_path if linked else None, fallback_json)
        return False

    try:
        print("- uninstalling existing plugin (ignored if absent)")
        run(["claude", "plugin", "uninstall", plugin_source], capture=True, quiet=True)
        print(f"- removing existing '{marketplace_name}' marketplace (ignored if absent)")
        run(["claude", "plugin", "marketplace", "remove", marketplace_name], capture=True, quiet=True)
        print(f"- registering generated local marketplace: {mp_root}")
        if run(["claude", "plugin", "marketplace", "add", str(mp_root)]).returncode:
            print("\nMARKETPLACE ADD FAILED.")
            ok = False
        if ok:
            print(f"- installing plugin: {plugin_source}")
            if run(["claude", "plugin", "install", plugin_source]).returncode:
                print("\nPLUGIN INSTALL FAILED.")
                ok = False
        if ok:
            print("- deduplicating clio MCP server")
            # Remove a user-scope 'clio' duplicate so Claude Code doesn't spawn two contending mcp-servers.
            r = run(["claude", "mcp", "remove", "clio", "-s", "user"], capture=True, quiet=True)
            print("  removed user-scope 'clio' duplicate (plugin's clio remains)." if r.returncode == 0
                  else "  no user-scope 'clio' duplicate (ok).")
    finally:
        _cleanup_stage_b(link_path if linked else None, fallback_json)
    return ok


def _cleanup_stage_b(link_path, fallback_json):
    # Remove the leaf junction/symlink first so the later rmtree of the private run dir can never follow it
    # into the repo; then drop the out-of-TEMP fallback artifact if one was written.
    if link_path is not None:
        remove_dir_link(link_path)
    if fallback_json and Path(fallback_json).exists():
        try:
            Path(fallback_json).unlink()
            parent = Path(fallback_json).parent
            if parent.name == ".claude-plugin" and not any(parent.iterdir()):
                parent.rmdir()
            print(f"  - removed fallback marketplace artifact outside TEMP: {fallback_json}")
        except OSError:
            pass


def cleanup_locks():
    print("\n=== [cleanup] Removing stale knowledge-source lock markers ===")
    locks = clio_home() / "knowledge" / "sources" / ".locks"
    if not locks.is_dir():
        print("  - no .locks directory (nothing to clean)")
        return
    removed = 0
    for lock in sorted(locks.glob("*.lock")):
        # Never disturb a marker a live clio server still holds (Windows: share-violation on open;
        # POSIX: a conflicting advisory flock).
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


def resolve_plugin_name():
    try:
        data = json.loads((REPO_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
        return data.get("name") or DEFAULT_PLUGIN_NAME
    except (OSError, ValueError):
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
    cfg = apply_defaults(load_config(CONFIG_FILE))

    if not cfg.get("CLIO_SRC"):
        fail(f"CLIO_SRC is not set in {CONFIG_FILE}")
    if not Path(cfg["CLIO_SRC"]).is_dir():
        fail(f"CLIO_SRC path does not exist: {cfg['CLIO_SRC']}")
    for name in ("KN_URL", "KN_REL_OWNER", "KN_REL_REPO", "KN_REL_ASSET", "KN_REL_API"):
        require_token(name, cfg[name])

    plugin_name = resolve_plugin_name()

    print("=" * 75)
    print(f"  STAGE A - clio MCP server binary  | src: {cfg['CLIO_SRC']}")
    print("  STAGE C - clio knowledge base       | source chosen at [0/7] (release | branch)")
    print(f"  STAGE B - CAADT plugin instructions | src: {REPO_ROOT}")
    print("=" * 75)

    print("\n=== [0/7] Selecting knowledge source (mode + ref) ===")
    mode, branch = select_knowledge_source(args, cfg)

    # One PRIVATE per-run temp root for the NuGet config + the marketplace dir. Removed at the end so
    # nothing is left in TEMP and no fixed shared path exists to squat.
    run_tmp = Path(tempfile.mkdtemp(prefix="clio-rebuild-"))
    stage_b_ok = True
    try:
        version, autoupdate_off = stage_a_build(cfg, run_tmp)
        stage_c_knowledge(cfg, mode, branch)
        stage_b_ok = stage_b_plugin(cfg, plugin_name, run_tmp)
        cleanup_locks()
    finally:
        shutil.rmtree(run_tmp, ignore_errors=True)

    print("\n" + "=" * 75)
    if not stage_b_ok:
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
    print("  STAGE B: CAADT plugin re-pointed at the local checkout and reinstalled;")
    print("           user-scope 'clio' MCP duplicate removed (one server = no lock contention).")
    print("  NEXT - FULLY restart Claude Code (quit and reopen) so ONE fresh clio server loads the new binary.")
    print("         Confirm afterwards that exactly ONE clio process is running.")
    print("=" * 75)


if __name__ == "__main__":
    main()
