import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / "skills/freedom-build-executor/freedom-build-executor.workflow.js"
# The generator strips comments from the shipped artifact (half of it was maintainer prose, and the file has
# a hard 524288-byte ceiling because the Workflow permission handler inlines it into the `script` field). The
# tests below slice REGIONS bounded by comment markers and assert statement ORDER inside them, so they read
# the CORE MODULE, which is where those comments are written, reviewed and maintained — and where a fix would
# have to land anyway, since the artifact is generated from it.
CORE_PATH = ROOT / "skills/_workflow-core/build-executor/core.mjs"
QUEUE_DOC_PATH = ROOT / "skills/freedom-build-executor/references/02-queue-and-built-files.md"
SKILL_PATH = ROOT / "skills/freedom-build-executor/SKILL.md"


def read_text(path):
    return path.read_text(encoding="utf-8")


# NOTE ON TEST STYLE: `freedom-build-executor.workflow.js` only exports `meta` — everything else is
# top-level Workflow-runtime code that calls the `agent()`/`phase()`/`log()` globals the Workflow tool
# injects at run time, and it cannot be `require`d or `import`ed in a bare Node process (see the existing
# `test_default_contract_docs.py::test_cli_first_transport_rule_is_consistent_across_its_four_documents`,
# which pins this file's behaviour the same way). So this suite proves the ENG-95884 fix the same way the
# rest of this file's contract is proven: by asserting the SOURCE TEXT has the exact control flow the fix
# requires — which function computes what, in what order, and which stop sites are gated by it — rather
# than executing the script.


class FreedomBuildPackageRecordConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.workflow = read_text(WORKFLOW_PATH)
        self.core = read_text(CORE_PATH)

    # --- Core defect: an INCONCLUSIVE live check must not outrank the run's own record -----------------

    def test_package_precondition_stop_resolves_unknown_to_exists_when_own_record_matches(self):
        # Isolate the function body so later assertions cannot accidentally match an unrelated `own`/
        # `packageState` occurrence elsewhere in this 3000+ line file. The function ends at its own
        # `return null\n}` — the next top-level `function` starts a wholly different gate.
        start = self.workflow.index("function packagePreconditionStop(")
        end = self.workflow.index("return null\n}", start) + len("return null\n}")
        body = self.workflow[start:end]

        # `own` (the record matched by name) must be computed before `effectiveState`, and `effectiveState`
        # must resolve 'unknown' to 'exists' precisely when `own` is truthy.
        own_idx = body.index("const own = ownPackageRecord(")
        effective_idx = body.index("const effectiveState")
        self.assertLess(own_idx, effective_idx,
            "`own` must be computed before `effectiveState` derives from it")
        # Review fix (PR #123): the resolution moved into its own pure helper, `resolvePackageState`, so
        # every SCHEDULING consumer (`appUnitFor`/`isOpenApp`) can be handed the same resolved fact this
        # gate trusts, instead of re-deriving it (or re-reading the raw, unconfirmed `packageState`)
        # downstream. The actual 'unknown' → 'exists' resolution behaviour — including that it is scoped to
        # a matching package NAME and never applied to a confident 'absent' — is proven by REAL EXECUTION in
        # engine-tests/classic-to-freedom/run-infra.mjs (the `resolvePackageState` and "THE BLOCKER FIX
        # ITSELF" checks), not re-asserted here as source text.
        self.assertRegex(
            body[effective_idx:effective_idx + 120],
            r"const effectiveState\s*=\s*resolvePackageState\(targetPackage,\s*packageState,\s*packageCreatedByRun\)",
            "`packagePreconditionStop` must derive `effectiveState` from the shared `resolvePackageState` helper "
            "so the stop and downstream scheduling can never observe two different resolved facts")
        self.assertIn(
            "const resolvePackageState = (targetPackage, packageState, packageCreatedByRun) => {",
            self.workflow)

        # Every DECISION (an `if` condition) after that point must branch on `effectiveState`, never on the
        # raw `packageState` — a single stale `if` comparing `packageState` again would silently bypass the
        # override and reproduce the exact ENG-95884 stop. Restricted to `if (...)` lines (not comments,
        # which freely mention `packageState` in prose) so this does not false-positive on documentation.
        after_effective = body[effective_idx:]
        if_lines = re.findall(r"^\s*if \(.*\)\s*\{?\s*$", after_effective, flags=re.MULTILINE)
        self.assertGreaterEqual(len(if_lines), 3, "expected the three package-state `if` branches")
        for line in if_lines:
            self.assertNotIn("packageState ===", line, f"branches on the raw packageState again: {line!r}")
            self.assertNotIn("packageState !==", line, f"branches on the raw packageState again: {line!r}")
        self.assertIn("if (sectionHost === 'new-app' && effectiveState === 'exists') {", after_effective)
        self.assertIn("if (effectiveState !== 'exists' && effectiveState !== 'absent') {", after_effective)
        self.assertIn("if (effectiveState === 'absent' && !targetPackage) {", after_effective)

    def test_confident_absent_is_never_overridden_by_the_own_record(self):
        # The override is deliberately narrow: only 'unknown' is resolved. A live check that confidently
        # says 'absent' must be trusted even when an own record exists — the package could have been
        # deleted after this run made it, which is a conflict worth its own stop, never a silent resume.
        start = self.workflow.index("const effectiveState")
        line = self.workflow[start:self.workflow.index("\n", start)]
        self.assertNotIn("'absent'", line,
            "the own-record override must only ever compare against 'unknown', never 'absent'")

    # --- Defense in depth: Reconcile dropping the field must not be read as a confirmed absence --------

    def test_dedicated_package_record_reread_exists_and_is_bounded(self):
        # ENG-95770 host-neutral core: a workflow script cannot `import`, and cannot suspend on `await` either —
        # the host evaluates it as a plain function body driven by the CLI/Claude adapters' own event loop, so
        # every agent call is a `yield*` to a `function*` (a work item the adapter resumes), never an `async`
        # call. The single-purpose re-read is the same fix, on the same generator protocol as every other
        # dispatch in this file (`reconcileAgent`, `verifyRound`, ...).
        self.assertIn("const PACKAGE_RECORD_READ_ATTEMPTS", self.workflow)
        self.assertIn("function* confirmPackageRecordAbsent()", self.workflow)
        # Single-purpose: the prompt must forbid the read from turning into a second Reconcile sweep.
        prompt_start = self.workflow.index("function packageRecordPrompt()")
        prompt_end = self.workflow.index("\n  function* confirmPackageRecordAbsent", prompt_start)
        prompt_body = self.workflow[prompt_start:prompt_end]
        self.assertIn("ONE single-purpose read", prompt_body)
        self.assertIn("standWrites.packageCreated", prompt_body)
        self.assertIn("VERBATIM", prompt_body)
        self.assertRegex(prompt_body, r"do NOT derive it from the stand")

    def test_confirm_package_stop_only_fires_the_reread_for_the_two_ownership_stops(self):
        start = self.workflow.index("function* confirmPackageStop(")
        end = self.workflow.index("\n  }", start)
        body = self.workflow[start:end]
        self.assertIn("'target-package-unknown'", body)
        self.assertIn("'new-app-over-existing-package'", body)
        # Must not fire when a record is already in hand — the re-read is a fallback, not a repeat check.
        self.assertIn("if (ownPackageNow()) return", body)
        # On a successful read it must feed the recovered record back into `state` and RE-DERIVE the stop
        # via `packagePreconditionStop`, not merely log the recovered value — this is what makes a resumed
        # round with the record on disk actually proceed instead of stopping anyway.
        self.assertIn("state = { ...state, packageCreatedByRun: record.packageCreated || null }", body)
        self.assertIn("packagePreconditionStop(targetPackage, pkgState, sectionHost, ownPackageNow())", body)

    def test_both_ownership_stop_sites_route_through_confirm_package_stop(self):
        # Hard Stop 3 (baseline, right after the first Reconcile) ...
        baseline_start = self.core.index("// --- HARD STOP 3: the target package cannot be established")
        baseline_end = self.core.index("// --- HARD STOP 3.5", baseline_start)
        baseline = self.core[baseline_start:baseline_end]
        self.assertIn("yield* confirmPackageStop(stopOnPackage,", baseline)

        # ... and the mid-run guarantee re-check inside `acceptReconciled`.
        mid_start = self.core.index("function* acceptReconciled(next, whereFrom)")
        mid_end = self.core.index("\n  }\n", mid_start)
        mid = self.core[mid_start:mid_end]
        self.assertIn("yield* confirmPackageStop(stopPkg,", mid)

        # `acceptReconciled` is a generator for this (it may suspend on the dedicated re-read), and both its
        # call sites must `yield*` it — a forgotten `yield*` would silently hand back the generator object
        # itself instead of the stop it eventually produces.
        self.assertIn("function* acceptReconciled(", self.core)
        call_sites = re.findall(r".*acceptReconciled\(.*", self.core)
        self.assertGreaterEqual(len(call_sites), 3,  # the declaration + two call sites
            "expected the declaration plus two call sites")
        for line in call_sites:
            if "function* acceptReconciled" in line:
                continue
            self.assertIn("yield* acceptReconciled(", line,
                f"acceptReconciled is a generator — every call site must yield* it: {line!r}")

    def test_both_call_sites_write_the_resolved_state_back_before_scheduling(self):
        # Review fix (PR #123, Blocker): `packagePreconditionStop` clearing a stop on the run's own record was
        # not enough — `appUnitFor`/`isOpenApp` at scheduling read `state.packageState` directly and saw the
        # raw, unresolved report, so a resumed run's own success could still get `create-app` re-dispatched
        # over it. Both places that decide the stop must write the SAME resolved fact back onto `state`
        # before anything downstream reads `state.packageState` again — pin that write exists at both sites.
        write_back = "state = { ...state, packageState: resolvePackageState(state.targetPackage, state.packageState, ownPackageNow()) }"

        baseline_start = self.core.index("// --- HARD STOP 3: the target package cannot be established")
        baseline_end = self.core.index("// --- HARD STOP 3.5", baseline_start)
        baseline = self.core[baseline_start:baseline_end]
        confirm_idx = baseline.index("yield* confirmPackageStop(stopOnPackage,")
        write_idx = baseline.index(write_back)
        # The stop branch is a GUARD CLAUSE (`if (!stopOnPackage) return null`), not the `if (stopOnPackage) {`
        # block this test was written against: pulling `hardStopOnPackage` out of `placementAndComponentStop`
        # for Sonar cognitive complexity inverted it. The INVARIANT is unchanged and is what this pins — the
        # write-back must sit after the confirmation and before the branch that can leave this closure — so the
        # marker is updated rather than the assertion. Asserted as a substring so the `return null` tail cannot
        # drift into matching something else.
        stop_check_idx = baseline.index("if (!stopOnPackage) return null")
        self.assertLess(confirm_idx, write_idx,
            "the write-back must happen AFTER ownership is confirmed, not before")
        self.assertLess(write_idx, stop_check_idx,
            "the write-back must happen BEFORE the stop branch returns, so Hard Stop 4's `appUnitFor` calls "
            "further down this closure see the resolved state on every path, stopped or not")

        mid_start = self.core.index("function* acceptReconciled(next, whereFrom)")
        mid_end = self.core.index("\n  }\n", mid_start)
        mid = self.core[mid_start:mid_end]
        mid_confirm_idx = mid.index("yield* confirmPackageStop(stopPkg,")
        mid_write_idx = mid.index(write_back)
        mid_schedule_idx = mid.index("schedule = scheduleUnits(")
        self.assertLess(mid_confirm_idx, mid_write_idx)
        self.assertLess(mid_write_idx, mid_schedule_idx,
            "the mid-run write-back must land before `scheduleUnits`/`appUnitFor` are called with `packageState`")

    def test_stop_text_distinguishes_unread_from_confirmed_absent(self):
        for site_marker in ("// ENG-95884 — distinguish \"confirmed absent\" from \"not read\"",
                            "next: pkgRecordUnread"):
            self.assertIn(site_marker, self.core)
        self.assertIn("packageRecordUnread", self.core)
        self.assertIn("NOT READ, which is NOT the same as confirmed absent", self.core)
        # The "unread" wording must promise a free retry — the whole point is that this case must not cost
        # a round, unlike a genuine stop.
        self.assertIn("Nothing was spent on this attempt", self.core)


class FreedomBuildPackageRecordDocsTests(unittest.TestCase):
    # Repository docs describing this exact stop table must not drift from the fixed behaviour — same
    # drift-guard rationale as test_default_contract_docs.py's cross-document consistency checks.

    def test_skill_doc_describes_the_unknown_to_exists_resolution(self):
        doc = read_text(SKILL_PATH)
        self.assertIn("ENG-95884", doc)
        self.assertIn("packageState: 'unknown'", doc)
        self.assertIn("'exists'", doc)
        self.assertIn("packageRecordUnread", doc)

    def test_queue_file_doc_describes_the_unknown_to_exists_resolution(self):
        doc = read_text(QUEUE_DOC_PATH)
        self.assertIn("ENG-95884", doc)
        self.assertIn("packageState: 'unknown'", doc)
        self.assertIn("packageRecordUnread", doc)


if __name__ == "__main__":
    unittest.main()
