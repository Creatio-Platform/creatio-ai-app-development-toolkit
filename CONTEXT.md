# AI-Driven App Creation

The Creatio AI app-development toolkit: a multi-agent plugin (Claude Code, Codex, Cursor, GitHub Copilot CLI) plus an installer and an external wizard that install, update, and migrate it across agents.

## Language

**CAADT**:
The toolkit/plugin artifact installed into AI agents — the thing that is versioned and updated. Same product as ADAC; CAADT is the name used after the move to public GitHub.
_Avoid_: using it to mean only the Claude Code variant.

**ADAC**:
The current/legacy name for the same product as **CAADT**. Treat the two as synonyms.
_Avoid_: using "ADAC" to mean "the repo" specifically when you mean the product.

**Wizard**:
The external GUI wrapper that drives install / update / migrate by shelling out to the installer. Lives outside this repo. One of several callers of the update path — not the update logic itself.
_Avoid_: treating the wizard as where update logic lives.

**Marketplace agents**:
Agents installed via a remote git marketplace — Claude Code and GitHub Copilot CLI. Having a marketplace does NOT by itself mean they self-update (see Self-updating agent).

**File-copy agents**:
Agents with no marketplace concept — Codex and Cursor. Installed by copying files; no platform update mechanism.

**Self-updating agent**:
An agent that refreshes the plugin on its own without the update command. Currently **only Claude** — install enables `autoUpdate=true` (install.py:721). On each session start Claude `git pull`s its marketplace clone (cheap delta, often zero bytes), then if `marketplace.json` changed it re-fetches the plugin payload at whatever `source.ref` now points to. With **Release-pinned install**, this means Claude follows the **Release branch**, not `main` — autoUpdate effectively tracks releases, not unreleased work. **Copilot is a marketplace agent that is NOT self-updating** — install never enables its autoUpdate, so post-install it is effectively frozen. The unified update command must skip self-updating agents and cover everything else.

**Update notification**:
The in-agent "a newer version is available" message (ENG-90476). Shown **only in non-self-updating agents** (Codex, Cursor, Copilot) — i.e. exactly the agents `/caadt update` acts on — so the CTA is a single message ("run `/caadt update`"). **Not shown in Claude**, which self-updates.

Delivery mechanism: **plugin-bundled SessionStart hook** (not skill-driven). Each non-Claude agent's plugin manifest declares a `SessionStart` hook that runs `runtime/update_check.py`. Hook fires on every session start; throttled by `~/.caadt/last-version-check` — two fields only: `{"lastCheckedAt": "ISO8601", "latestVersion": "0.2.0"}`. 12h interval. Within the window: compare cached `latestVersion` against installed `plugin.json` without hitting the API. After 12h: refresh from GitHub Releases API. Operational throttle only — no preference or migration data ever goes in this file. The hook is **not declared** in `.claude-plugin/plugin.json` so Claude never runs the check. Per-agent bundling: `.codex-plugin/hooks/hooks.json`, Copilot `hooks/hooks.json`, Cursor via `~/.cursor/hooks.json` written by `install_cursor`.

**Unified update command**:
The single update entry point (`caadt update` / `/caadt update` / wizard Update button all route to it). Its real job is to **update the agents that cannot update themselves** — the file-copy agents (Codex, Cursor). Marketplace agents (Claude, Copilot) are expected to self-update via their platform.
_Avoid_: reading "unified" / "updates installed supported agents" as "force-updates every agent including marketplace ones" — that wording overstates the intended scope.

**Decided scope (ENG-90476):** the update command updates **all coding agents except Claude** — Codex and Cursor via file-copy, Copilot via its marketplace-update + reinstall path. **Claude is skipped** because it is the only self-updating agent (autoUpdate=true). Verified May 2026: Copilot CLI has no plugin auto-update (open feature request github/copilot-cli#1709), so it cannot be left to self-update.

**Release branch**:
A single moving Git branch (`release`) in the toolkit repo that always points at the SHA of the latest published release. Updated by `.github/workflows/release.yml` with a force-push step after `gh release create` succeeds; never updated by PRs to `main`. Its job is to be the stable ref every marketplace agent's `marketplace.json` pins to via `source.ref: "release"`, so `plugin install …@creatio` fetches release content regardless of what is on `main`. Initial SHA = tag `0.1.1`.
_Avoid_: treating it as a development branch — it is a write-once-per-release pointer, never a place to land work. Do not confuse with the numbered version tags (`0.1.1`, `0.1.2`, …) which are immutable; `release` is the moving alias.

**Forward-fix discipline** (rollback semantics for the Release branch):
The Claude plugin payload cache is keyed by `plugin.json:version`, not by Git SHA — verified experimentally on 2026-05-30. If a release ships broken and `release` is re-pointed at a commit whose `plugin.json` still declares the same broken version, clients reuse the cached payload and miss the rollback entirely. **Therefore:** never roll the `release` branch back to a SHA that shares its `plugin.json:version` with the current state. Always ship a forward-fix patch version (e.g. broken `0.1.2` → fixed `0.1.3` built on top of `0.1.1`). `release.yml` Gate 6 enforces this at workflow time by refusing to release if the new version equals the `release` branch's current `plugin.json:version`.
_Avoid_: thinking of a release as undoable by force-pushing the pointer backwards — the version on the client doesn't change, so neither does the installed payload.

**Release-pinned install**:
The marketplace-agent install model where `marketplace.json` declares `source: { source: "url", url: "<repo>.git", ref: "release" }` for the plugin entry. The CLI's marketplace clone still tracks `main` (where `marketplace.json` itself lives), but the plugin payload is fetched separately at the **Release branch** SHA into a distinct on-disk cache. Two clones on disk per agent (marketplace ≈ `main`, payload = release) — accepted tradeoff to decouple "what users install" from "what is on `main`". Applies now to Claude and Copilot; Codex inherits the model after its remote-marketplace migration (separate ticket).
_Avoid_: reading `source.ref` as "find the latest release tag" — Git has no such concept. It is a literal ref name passed to `git checkout`. The "latest release" semantics live entirely in the release workflow moving the `release` branch.

**Dev escape hatch** (testing unreleased changes through a marketplace agent):
Per-CLI native, **not unified across agents**. Claude: `claude plugin marketplace add <url>#<branch>` registers an additional marketplace pointing at a dev ref. Codex (post-migration): `codex plugin marketplace add owner/repo@<ref>` or the `--ref` flag. Copilot: **no native escape hatch** ([github/copilot-cli#1296](https://github.com/github/copilot-cli/issues/1296)) — Copilot-primary devs fall back to Cursor/Codex file-copy via `install.py` against a local checkout of the working branch. Accepted gap, not solved by the **Unified update command**.
_Avoid_: claiming Copilot has parity with Claude/Codex on dev workflow — it does not.

## Relationships

- **CAADT** = **ADAC** (same product, two names)
- The **Wizard** calls the **Unified update command**; it does not contain update logic
- The version-check helper ("is a newer release available?") is owned by ENG-90476 and **reused** by both the in-agent notification and the wizard's outdated-detection — one definition of "outdated", no persistent API cache
- **Marketplace agents** update via their platform; **File-copy agents** must be updated by re-copying files
- **Release branch** is updated **only** by the release workflow (force-push under a bypass-listed actor); `main` never bumps it, no PR ever lands on it. Branch protection on `release`: block deletions, block force-push except for the GH Actions identity that runs the release workflow.
- **Release-pinned install** ties the **Self-updating agent** (Claude with autoUpdate) to the **Release branch** rather than `main` — so autoUpdate ships releases, not unreleased work

## Flagged ambiguities

- "ADAC" vs "CAADT" — resolved: synonyms; CAADT is the post-public-GitHub name.
- "unified update command updates all supported agents" (ENG-90476 AC) vs intent — resolved: updates all agents **except Claude** (the only self-updater).
- "Decline is remembered" (ENG-90478 AC) — **stale/invalid**: no persistent state is built for this. Neither ticket needs a persistent `caadt-state.json`; 90476 checks the release API live, 90478 does not remember migration declines (may re-prompt next run). The only on-disk state is the transient `install-state.json` wizard handoff (install.py:753-758).
- "Plugin install fetches `main` HEAD vs release" — **resolved (2026-05-30)**: marketplace.json `source.ref: "release"` pins payload to the **Release branch** for Claude and Copilot. Mechanism is the literal `ref` field in `marketplace.json`; the marketplace `version` field is informational only (metadata + optional `strict`-mode check), it does **not** select a ref. Verified against `obra/superpowers-marketplace` (`superpowers-dev` entry uses `"ref": "dev"` — proves the field works for Copilot too despite Copilot's missing CLI-side `--ref`). Codex stays on file-copy until its remote-marketplace migration.
- "Dedicated legacy-migration mode" (ENG-90478) — **likely not needed**. Spike on a real machine (2026-05-27): re-running the updated install script left a clean state — `settings.json` `creatio.source = git` + `autoUpdate: true`, and `~/.claude/plugins/marketplaces/creatio/` replaced in place with a git clone of the remote. No directory-source leftover, no orphaned copy. Conclusion: re-running install **is** the migration for marketplace agents; Codex/Cursor never changed install model so have nothing to migrate. At most an optional cleanup, not a prompted wizard branch.
