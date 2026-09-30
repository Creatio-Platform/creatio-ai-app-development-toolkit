---
name: toolkit-release
description: Cut a new release of this toolkit end to end — pick the version, write the RELEASE-NOTES.md section in the house style, draw the release banner, bump the manifests, open one release preparation PR with auto-merge, and confirm the Release workflow published the GitHub Release with its asset and banner. Use when asked to "make a release", "cut a release", "new release", "зроби реліз", "новий реліз", "випусти версію". Repository tooling for contributors; not shipped with the plugin.
---

# Toolkit release

A release is **one** preparation PR into `main`. It carries the notes section, the banner and the version
bump together. Merging it is what releases: a push to `main` that moves `.claude-plugin/plugin.json` to a
version with no tag starts the `Release` workflow, which tags the merged commit, builds the zip, publishes
the GitHub Release from the notes section and moves the `release` branch that installed plugins update from.

Nothing reaches `main` without a PR: `main protection` requires one approval, dismisses approvals on every
push and has no bypass. Pushing fixes to the PR therefore costs another approval — get the content right
before the first push.

Prerequisites: `gh` authenticated with write access to `Creatio-Platform/creatio-ai-app-development-toolkit`,
`node`, `python3`, and a browser able to render SVG headless (Google Chrome or Chromium) for the banner.

## 1. Start from the current `main`

```bash
git fetch --tags origin
git checkout -B release-prep/X.Y.Z origin/main
```

Name the branch `release-prep/X.Y.Z`. A `release/...` name is rejected by the remote, because the branch
`release` exists.

## 2. Collect what ships

```bash
LAST=$(git tag --sort=-v:refname | head -1)
git log --first-parent --format='%h %s' "$LAST"..origin/main
```

A first-parent merge can be an integration branch that carries many PRs of its own. List those too:

```bash
gh pr list --state merged --base <integration-branch> --limit 100 --json number,title
```

Read each PR's body (`gh pr view <N> --json title,body`) — the title alone does not say what a user gets.
Sort every PR into: user-facing (goes into the notes), repository tooling (one line under 🛠️ Developer
tooling, marked as not part of the installable asset), or no effect for anyone (leave out, and say so in
the PR body so a reviewer does not ask). When a skill depends on a change in another repository (clio,
clio-knowledge), check whether that change is in a published release; if it is not, the notes say so.

## 3. Pick the version

Semver `X.Y.Z` with no prefix. A new capability → minor; fixes only → patch; a change that breaks an
existing install or flow → major.

## 4. Write the notes section

Add `## X.Y.Z (YYYY-MM-DD)` at the top of `RELEASE-NOTES.md`, above the previous release. Follow the header
of that file and the most recent section:

- The banner image line comes first (step 5), then one **bold** sentence that says what the release unlocks.
  The workflow uses that first bold sentence as the GitHub Release title (`X.Y.Z — <hook>`).
- Then short `###` groups with an emoji; each bullet leads with the value for the user, not the mechanism,
  and links every PR it describes with a full URL:
  `([#NN](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/pull/NN))`.
- Every bullet has a PR link. A reviewer checks this first.

## 5. Draw the banner

Every release has one. Take `docs/assets/release-1.13.0-banner.svg` as the template: 1200×420 viewBox, the
same background gradient, grid, palette and fonts; the drawing shows what this release changes, in three
parts left to right with labels in capitals. Save it as `docs/assets/release-X.Y.Z-banner.svg`, then render
the PNG at 1600×560:

```bash
SVG="$PWD/docs/assets/release-X.Y.Z-banner.svg"
HTML="$(mktemp -d)/banner.html"
printf '<html><body style="margin:0;background:#0d1330"><img src="file://%s" width="1600" height="560" style="display:block"></body></html>' "$SVG" > "$HTML"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --window-size=1600,560 \
  --screenshot="$PWD/docs/assets/release-X.Y.Z-banner.png" "file://$HTML"
```

On Linux or Windows use the Chrome or Chromium binary of that system with the same flags. Open the PNG and
look at it: a gradient on a perfectly horizontal line needs `gradientUnits="userSpaceOnUse"`, otherwise
the line is not drawn at all.

The image line in the notes points at `main`, so it renders once the PR is merged:

```markdown
![<what the banner shows>](https://raw.githubusercontent.com/Creatio-Platform/creatio-ai-app-development-toolkit/main/docs/assets/release-X.Y.Z-banner.png)
```

## 6. Bump and check

```bash
node scripts/bump-version.js X.Y.Z
node scripts/bump-version.js --check
python3 -m pytest tests/
```

## 7. Open the PR and turn on auto-merge

Write the PR body to a file of your own session (not a shared name such as `$TMPDIR/body.md`, which another
session can overwrite before `gh` reads it). The body lists what the version carries as a `| PR | Brings |`
table and the validation you ran. Then:

```bash
git add -A && git commit -m "release: prepare X.Y.Z"
git push -u origin release-prep/X.Y.Z
gh pr create --base main --title "release: prepare X.Y.Z" --body-file <file>
gh pr edit <N> --add-assignee @me --add-reviewer <reviewers>
gh pr merge <N> --auto --merge
```

Reviewers: the `@Creatio-Platform/toolkit-contributors` team is requested by `CODEOWNERS`; add the people
who actually reviewed recent merged PRs:

```bash
gh pr list --state merged --limit 15 --json reviews --jq '[.[].reviews[].author.login] | group_by(.) | map("\(length) \(.[0])") | .[]'
```

Optional rehearsal before merge — mints the release token, proves write access and builds the zip, with no
tag and no publish:

```bash
gh workflow run release.yml --ref release-prep/X.Y.Z -f version=X.Y.Z -f dry_run=true
```

## 8. Answer the review, then let it merge

Read every review body, not only the approval state — automated reviewers approve with findings attached.
Fix what is right in one push, answer in one PR comment, and resolve review threads. The push dismisses the
approvals, so ask the reviewers again. Auto-merge merges the PR once it is approved and every required check
is green.

## 9. Confirm the release

```bash
gh run list --workflow release.yml --limit 1
gh run watch <run-id> --exit-status
gh release view X.Y.Z --json name,isDraft,assets,url
git ls-remote origin refs/tags/X.Y.Z refs/heads/release
```

The release is done when: the run is green; the release is not a draft and is titled `X.Y.Z — <hook>`;
it carries `creatio-ai-app-development-toolkit-X.Y.Z.zip` and its `.sha256`; the tag and the `release`
branch point at the merge commit; the banner URL answers 200.

If no `Release` run started on the merge, start it by hand with the same version:

```bash
gh workflow run release.yml --ref main -f version=X.Y.Z
```

If the notes on `main` changed after the release was published, update the published body from them:

```bash
awk -v ver="X.Y.Z" '/^## /{if($0 ~ "^## " ver " \\("){f=1;next} else if(f){exit}} f{print}' RELEASE-NOTES.md > notes.md
gh release edit X.Y.Z --notes-file notes.md
```
