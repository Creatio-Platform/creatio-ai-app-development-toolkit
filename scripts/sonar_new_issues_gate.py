#!/usr/bin/env python3
"""Fail the build when a pull request introduces new SonarCloud issues.

Why this exists as a separate gate instead of relying on the `SonarCloud Code Analysis`
required check: that check reports the project's Quality Gate, and the gate assigned to
this project is the built-in `Sonar way`, whose conditions are all *ratings* on new code
(`new_maintainability_rating`, `new_reliability_rating`, `new_security_rating`) plus
duplication / hotspots / coverage. None of them count issues, and in the standard
experience a CRITICAL code smell does not by itself drop the maintainability rating below
A -- so a PR can add a dozen CRITICAL smells and still show a green, mergeable check.
Editing the gate is not an option here: `Sonar way` is built-in (`isBuiltIn: true`) and
so cannot be given an extra condition, and creating a replacement gate needs
organization-level `Administer Quality Gates` rights we do not have.

This gate instead reads the analysis SonarCloud already produced and enforces the missing
condition -- `new_violations == 0` -- in CI, where the repository admins control it.

Freshness: the project uses SonarCloud *Automatic Analysis*, so nothing in this workflow
triggers or sequences the scan. Reading the measures straight away would race it and
happily pass on the previous commit's numbers. We therefore poll
`api/project_pull_requests/list` until the analysis SonarCloud holds for this pull request
is the one for our head commit, and only then read the measure. No token is needed: this
project is public, so the SonarCloud web API answers anonymously.

Fails closed: if no analysis for the head commit shows up within the timeout, the gate
fails rather than waving the PR through. That is safe for documentation-only pull requests
too -- SonarCloud registers an analysis for every pull request since Automatic Analysis was
enabled on this project, including ones that touch no analysable source file (verified
against #40, #41, #47, #50 and #53).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://sonarcloud.io/api"
USER_AGENT = "creatio-ai-app-development-toolkit-sonar-gate"


def api_get(path: str, attempts: int = 3, **params: str | int) -> dict:
    """GET a SonarCloud web API endpoint, retrying transient failures so a single network
    blip does not turn into a red build."""
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            if attempt == attempts:
                raise
            print(f"  {path} failed ({error}), retrying ({attempt}/{attempts - 1})")
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def analysed_sha(project: str, pull_request: str) -> tuple[str | None, str | None]:
    """Return (head sha, analysis date) of the analysis SonarCloud currently holds."""
    try:
        payload = api_get("project_pull_requests/list", project=project)
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"  could not read the pull request list: {error}")
        return None, None
    for entry in payload.get("pullRequests", []):
        if str(entry.get("key")) == str(pull_request):
            return (entry.get("commit") or {}).get("sha"), entry.get("analysisDate")
    return None, None


def measure(project: str, pull_request: str, metric: str) -> int:
    """Read a single new-code measure. Absent measure means zero: SonarCloud omits a
    metric entirely when its value is 0 on new code."""
    payload = api_get(
        "measures/component",
        component=project,
        pullRequest=pull_request,
        metricKeys=metric,
    )
    for entry in payload.get("component", {}).get("measures", []):
        if entry.get("metric") != metric:
            continue
        # SonarCloud returns new-code values under `periods` (legacy) or `period`.
        if entry.get("periods"):
            return int(float(entry["periods"][0]["value"]))
        if entry.get("period"):
            return int(float(entry["period"]["value"]))
        if entry.get("value") is not None:
            return int(float(entry["value"]))
    return 0


def new_issues(project: str, pull_request: str, limit: int = 50) -> list[dict]:
    payload = api_get(
        "issues/search",
        componentKeys=project,
        pullRequest=pull_request,
        resolved="false",
        s="SEVERITY",
        asc="false",
        ps=limit,
    )
    return payload.get("issues", [])


def wait_for_analysis(project: str, pull_request: str, sha: str, timeout: int, poll: int) -> str:
    deadline = time.monotonic() + timeout
    while True:
        found_sha, analysis_date = analysed_sha(project, pull_request)
        if found_sha == sha:
            return analysis_date or "unknown"
        remaining = int(deadline - time.monotonic())
        if remaining <= 0:
            expected = found_sha or "no analysis yet"
            raise SystemExit(
                f"::error::SonarCloud has no analysis for {sha[:8]} after {timeout}s "
                f"(latest analysed: {expected}). Automatic Analysis may be disabled or "
                f"still queued -- re-run this job once the SonarCloud check completes."
            )
        print(f"  waiting for analysis of {sha[:8]} (have: {found_sha or 'none'}), {remaining}s left")
        time.sleep(min(poll, max(remaining, 1)))


def write_summary(text: str) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    with open(summary_path, "a", encoding="utf-8") as handle:
        handle.write(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="SonarCloud project key")
    parser.add_argument("--pr", required=True, help="pull request number")
    parser.add_argument("--sha", required=True, help="pull request head commit sha")
    parser.add_argument("--timeout", type=int, default=900, help="seconds to wait for the analysis")
    parser.add_argument("--poll", type=int, default=20, help="seconds between polls")
    args = parser.parse_args()

    print(f"Waiting for SonarCloud analysis of PR #{args.pr} at {args.sha}")
    analysis_date = wait_for_analysis(args.project, args.pr, args.sha, args.timeout, args.poll)
    print(f"Analysis found, dated {analysis_date}")

    count = measure(args.project, args.pr, "new_violations")
    dashboard = (
        f"https://sonarcloud.io/project/issues?id={urllib.parse.quote(args.project)}"
        f"&pullRequest={args.pr}&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true"
    )

    if count == 0:
        print("No new issues on new code.")
        write_summary("### Sonar new issues gate\n\nNo new issues on new code.\n")
        return 0

    print(f"::error::This pull request introduces {count} new SonarCloud issue(s). See {dashboard}")
    lines = [
        "### Sonar new issues gate",
        "",
        f"**{count} new issue(s)** on new code. Fix them, then re-run this job.",
        "",
        f"[Open the issue list in SonarCloud]({dashboard})",
        "",
        "| Severity | Rule | Location | Message |",
        "| --- | --- | --- | --- |",
    ]
    for issue in new_issues(args.project, args.pr):
        component = (issue.get("component") or "").split(":", 1)[-1]
        location = f"{component}:{issue['line']}" if issue.get("line") else component
        message = (issue.get("message") or "").replace("|", "\\|")
        lines.append(
            f"| {issue.get('severity', '?')} | `{issue.get('rule', '?')}` | {location} | {message} |"
        )
        print(f"  [{issue.get('severity', '?')}] {issue.get('rule', '?')} {location} -- {message}")
    write_summary("\n".join(lines) + "\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
