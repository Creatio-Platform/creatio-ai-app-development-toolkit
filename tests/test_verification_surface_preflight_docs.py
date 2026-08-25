"""ENG-95855 — the verification-capability preflight is settled once per section, not discovered
after the first stand write.

A prior run answered "verify automatically" for the whole session before it ever checked whether
any automatic surface was reachable: the stored preference recorded `automatic`, not which surface,
so it survived a login wall, a per-action approval gate and an unpaired Chrome extension for nine
hours before the run finally checked `list_connected_browsers` and got `[]` — the same answer that
tool would have given at the start. Four real defects followed, three of them invisible without a
render.

The fix spans two layers: prose (the two SKILL.md-family files that an agent driving these skills
reads) and one real, executable script (`freedom-build-executor.workflow.js`, run by the Workflow
tool) that has to actually carry the resolved surface into each page unit's build prompt — a
documented argument nothing threads is the exact silent-loss failure this ticket exists to close,
one layer down. `run-infra.mjs` locks the script side (`buildVerificationSurface`, the threaded
prompt text); this module locks the prose side with a doc-pin: the preflight must name its
cardinality (once per section), the preference must name a tier rather than a bare automatic/manual
token, an unachievable preference must be re-asked, and the freedom-build-executor's per-page render
check must inherit the section's decision instead of re-deciding — and run inside the unit's own
build agent, not a trailing driver phase.

This module proves the prose is present and non-vacuous (it fails against the pre-change docs and
passes after). It does NOT prove an agent following that prose actually calls
`list_connected_browsers`, records the tier correctly, or re-asks instead of downgrading at
runtime — that behavioral proof has no runtime harness in this repo and stays an open item for a
human-operator dry run through a real migration section.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MIGRATION_SKILL = ROOT / "skills/classic-to-freedom-migration/SKILL.md"
BUILD_RECIPE = ROOT / "skills/freedom-build-executor/references/04-per-page-build-recipe.md"
MIGRATION_DOCS = ROOT / "skills/classic-to-freedom-migration/references/migration-documentation.md"


def read_text(path):
    return path.read_text(encoding="utf-8").replace("’", "'")


def flat(text):
    """Collapse whitespace runs so a pin survives a Markdown re-wrap."""
    return re.sub(r"\s+", " ", text)


def missing_markers(text, markers):
    flattened = flat(text)
    return [marker for marker in markers if flat(marker) not in flattened]


class VerificationSurfacePreflightDocTests(unittest.TestCase):
    def test_pinned_docs_are_present_and_non_empty(self):
        for path in (MIGRATION_SKILL, BUILD_RECIPE, MIGRATION_DOCS):
            self.assertTrue(read_text(path).strip(), f"{path} is empty")

    def test_the_pre_fix_known_traps_sentence_is_gone(self):
        # The exact trailing shape before this change: no re-ask clause between the disclosure
        # rule and the step cross-reference. A revert that drops only the inserted sentence while
        # leaving its neighbours untouched restores this literal string.
        self.assertNotIn(
            "Establish the surface BEFORE the first stand write and say so when there is none. "
            "→ step 7 / step 8.",
            flat(read_text(MIGRATION_SKILL)),
        )

    def test_known_traps_carries_the_re_ask_rule(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn(
            "A stored preference that later proves unachievable is RE-ASKED, never silently "
            "downgraded while still reporting itself as automatic.",
            content,
        )

    def test_preflight_runs_once_per_section_before_the_first_write(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "This resolution runs ONCE per section",
                "before the first page unit starts",
                "a unit does not re-probe the surface",
            ],
        )
        self.assertFalse(missing, f"the once-per-section cardinality must be stated; missing {missing}")

    def test_tiers_are_enumerated_in_cost_order_and_the_probe_is_named(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "**tier 1** `--verify` + `validate-page`",
                "**tier 2** a headless **Playwright** script",
                "**tier 3** real Chrome",
                "**tier 4** the built-in Browser pane **last**",
                "call `list_connected_browsers` first",
                "it costs ~30 ms and an empty list IS the answer",
            ],
        )
        self.assertFalse(missing, f"the tier order / probe instruction is incomplete; missing {missing}")

    def test_preference_names_a_tier_not_a_bare_mode(self):
        content = read_text(MIGRATION_SKILL)
        missing = missing_markers(
            content,
            [
                "must name the surface, not just the mode",
                "exactly one of `automatic:2` (headless Playwright), `automatic:3` (real Chrome), "
                "or `manual`",
                "never a bare `automatic` with no tier",
            ],
        )
        self.assertFalse(missing, f"the preference schema must be documented; missing {missing}")

    def test_manual_token_does_not_contradict_the_no_bare_automatic_rule(self):
        # The no-automatic-surface disclosure records `manual`; the tier rule must exempt it
        # explicitly, or the two sentences tell an agent to do contradictory things with the same
        # field. This is a real defect an earlier round of this same diff introduced and a later
        # round caught — locked here so it cannot silently return.
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn("record the answer in `decisions.md` as `manual`", content)
        self.assertIn("never `automatic:1`", content)
        self.assertNotIn("never a bare `automatic`/`manual`", content)
        self.assertNotIn("ordered fallback list", content)

    def test_unachievable_preference_is_re_asked_not_downgraded(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "RE-ASK the preference",
                "do NOT silently fall back while still reporting the run as automatic",
            ],
        )
        self.assertFalse(missing, f"the re-ask rule must be documented; missing {missing}")

    def test_storage_state_solves_login_once_and_never_in_the_versioned_folder(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "Tier 2's login is solved ONCE per stand via Playwright's `storageState`",
                "never the versioned migration folder",
                "deleted with the rest of that directory at cleanup",
            ],
        )
        self.assertFalse(missing, f"the storageState handling must be documented; missing {missing}")
        # Cut in review: speculative mechanics never verified against a real Playwright run and not
        # required by the ticket's Done criteria. Locked absent so they cannot silently creep back.
        for gone in ("chmod 600", "playwright-storage-state.json", "recapture", "0700"):
            self.assertNotIn(gone, content, f"'{gone}' should not be back in SKILL.md")

    def test_verification_surface_hand_over_is_a_value_not_a_file(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "`decisions.md` prose does NOT reach the builder (below)",
                "pass `verificationSurface` (`automatic:2`, `automatic:3`, or `manual`) as an "
                "explicit argument",
                "verificationSurface, mode, checkpointAfter, findings",
                "the workflow throws on anything outside the three tokens",
            ],
        )
        self.assertFalse(missing, f"verificationSurface must be a documented hand-over argument; missing {missing}")

    def test_relay_step_uses_the_real_blocked_shape_not_an_invented_field(self):
        # A prior review round caught this: the executor's actual JSON schema for a `blocked[]`
        # entry is `{ what, why }` (freedom-build-executor.workflow.js), not the `{ reason, detail }`
        # this diff invented across several earlier rounds. Locked so the wrong shape cannot return.
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "surface the four things the `--verify` table does NOT contain",
                "every `blocked[]` entry whose `what` names the verification surface as unachievable",
            ],
        )
        self.assertFalse(missing, f"the relay step must count and describe the real shape; missing {missing}")
        self.assertNotIn("surface the three things the `--verify` table does NOT contain", content)
        self.assertNotIn('reason: "surface-unachievable"', content)
        self.assertNotIn('{ "reason", "detail" }', content)

    def test_step_7_relay_cross_references_point_at_item_7_not_item_5(self):
        # Item 5 is "ASK HOW CLOSELY THE USER WANTS TO WATCH" — a real item 5, still correctly
        # referenced elsewhere in this file. These two sites relay parked/blocked/plan-gap facts,
        # which is item 7's job; a stale "item 5" here sends a reader to the wrong paragraph.
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn(
            "That one comes back to you (step 7 item 7): fix the manifest, re-run `--plan`", content
        )
        self.assertIn(
            "Four things are NOT in the table and you must surface them alongside it** "
            "(step 7 item 7)",
            content,
        )
        self.assertNotIn("(step 7 item 5): fix the manifest", content)
        self.assertNotIn("surface them alongside it** (step 7 item 5)", content)

    def test_mode_checkpoint_findings_cross_reference_points_at_item_5(self):
        content = flat(read_text(MIGRATION_SKILL))
        self.assertIn("`mode`/`checkpointAfter`/`findings` are item 5's answer", content)
        self.assertNotIn("`mode`/`checkpointAfter`/`findings` are item 4's answer", content)

    def test_cleanup_note_names_storage_state_without_the_removed_mechanics(self):
        content = flat(read_text(MIGRATION_SKILL))
        missing = missing_markers(
            content,
            [
                "its captured `storageState` — a live authenticated session, never versioned",
                "for `storageState`, a live credential",
            ],
        )
        self.assertFalse(missing, f"cleanup must name storageState generically; missing {missing}")

    def test_per_page_render_check_uses_the_verification_surface_value(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "Use the `verificationSurface` VALUE this",
                "build run was launched with (`automatic:2`, `automatic:3`, or `manual`)",
                "never `decisions.md`",
                "PASS/FAIL verdict line",
                "writing its artifacts to files",
            ],
        )
        self.assertFalse(missing, f"the render check must use the handed-over value; missing {missing}")

    def test_render_check_runs_inside_the_units_own_agent_not_a_trailing_phase(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "Run this check HERE, inside this unit's own build agent, immediately after "
                "building the page",
                "never deferred to a trailing phase after every unit is built",
            ],
        )
        self.assertFalse(missing, f"per-unit placement must be explicit; missing {missing}")

    def test_render_check_names_the_re_ask_trigger_using_the_real_blocked_shape(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "the re-ask trigger the preflight paragraph names",
                "report it in `blocked[]` with `what` naming the verification surface as "
                "unachievable and `why` the reason",
            ],
        )
        self.assertFalse(missing, f"the re-ask trigger must use the real shape; missing {missing}")
        self.assertNotIn('reason: "surface-unachievable"', content)

    def test_builders_return_schema_uses_what_why_not_an_invented_field(self):
        content = flat(read_text(BUILD_RECIPE))
        self.assertIn('**A `blocked[]` entry is `{ "what", "why" }` — both free text, both required.**', content)
        self.assertNotIn('{ "reason", "detail" }', content)
        self.assertNotIn("surface-unachievable", content)

    def test_speculative_security_mechanics_were_cut_in_review(self):
        # chmod/stat-back/recapture-protocol/canonical-filename were all invented across earlier
        # review rounds, never verified against a real Playwright run, and not required by any of
        # the ticket's Done criteria — cut back to the one legitimate point (never the versioned
        # folder). Locked absent so the scope creep cannot silently return.
        content = flat(read_text(BUILD_RECIPE))
        for gone in ("chmod 600", "playwright-storage-state.json", "stat` the file back", "recapture"):
            self.assertNotIn(gone, content, f"'{gone}' should not be back in the build recipe")

    def test_storage_state_solved_once_per_stand_not_per_unit(self):
        content = flat(read_text(BUILD_RECIPE))
        missing = missing_markers(
            content,
            [
                "Tier 2's login is solved ONCE per stand, not per unit",
                "never the versioned `outDir`",
            ],
        )
        self.assertFalse(missing, f"the storageState reuse rule must be documented; missing {missing}")

    def test_migration_docs_links_to_the_schema_instead_of_restating_it(self):
        content = flat(read_text(MIGRATION_DOCS))
        missing = missing_markers(
            content,
            [
                "the verification-surface preflight (SKILL.md step 7 preamble) records its answer here too",
                "do not restate or re-derive the schema here",
            ],
        )
        self.assertFalse(missing, f"migration-documentation.md must link, not restate; missing {missing}")
        self.assertNotIn("e.g. `automatic:2` for headless Playwright", content)
        self.assertNotIn("ordered fallback list", content)


if __name__ == "__main__":
    unittest.main()
