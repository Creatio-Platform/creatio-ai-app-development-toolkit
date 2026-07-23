import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Bind the ENG-92985 doc-token assertions to the gate script's own constants so a
# rename in clio_mcp_preflight.py cannot pass both this suite and the behavioral suite
# while the docs silently describe a sentinel/exit code the script no longer emits.
sys.path.insert(0, str(ROOT / "runtime" / "scripts"))
import clio_mcp_preflight as pf  # noqa: E402  (path set above)


def existing(paths):
    return [path for path in paths if path.exists()]

AUTHORITY_DOCS = existing([
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
])

WORKFLOW_ONLY_SCHEMA_DOCS = existing([
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
])

ACTIVE_CONTRACT_SURFACE_DOCS = existing([
    ROOT / "README.md",
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
])

DOC_PATHS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/essentials.md",
]

CANONICAL_FLOW_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
]

FALLBACK_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "context/essentials.md",
]

CHECKLIST_SOURCE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
    ROOT / "README.md",
]

PRE_ANALYSIS_DOCS = [
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
]

FIRST_TURN_LATENCY_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
]

DOMAIN_EXPERTISE_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "context/business-checklist.md",
]

STDIO_ONLY_DOCS = existing([
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
    ROOT / "runbooks/02-requirements-gathering.md",
    ROOT / "README.md",
    ROOT / "skills/README.md",
])

DOT_STYLE_APPLICATION_TOOL_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    ROOT / "context/business-checklist.md",
    ROOT / "context/essentials.md",
]

# ENG-91276: native MCP tool-calls are preferred over the mcp_client.py stdio wrapper.
NATIVE_MCP_FIRST_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "context/INDEX.md",
    ROOT / "context/essentials.md",
    ROOT / "skills/creatio-app-orchestrator/SKILL.md",
    ROOT / "runbooks/01-environment-setup.md",
]

# ENG-91276: native MCP and the wrapper must share one clio config / environment list.
SINGLE_CLIO_CONTEXT_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
]

# ENG-91276: a writable package context must be resolved before schema/page edits.
WRITABLE_PACKAGE_CONTEXT_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
    ROOT / "skills/creatio-app-orchestrator/SKILL.md",
]

# ENG-91558: a prompt URL with no matching environment is auto-registered with
# default Supervisor/Supervisor credentials, no confirmation turn; auth failure stops.
AUTO_REGISTER_PROMPT_URL_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "runbooks/01-environment-setup.md",
]

# ENG-91558: adding a section for a named entity creates the app without an extra
# confirmation turn when no custom app exists yet.
DEFAULT_APP_CREATION_DOCS = [
    ROOT / "AGENTS.md",
]

# ENG-92985: run a clio MCP availability preflight before the first clio operation
# and fail fast with a prerequisites blocker when clio MCP is unavailable — never
# self-bootstrap the environment or silently degrade to the Python wrapper.
CLIO_MCP_PREFLIGHT_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "skills/creatio-app-orchestrator/SKILL.md",
    ROOT / "runbooks/01-environment-setup.md",
]

# ENG-92985: the mcp_client.py wrapper is an explicit opt-in escape hatch, not the
# default degraded path. Every transport-aware doc must frame it that way.
OPT_IN_ESCAPE_HATCH_DOCS = [
    ROOT / "AGENTS.md",
    ROOT / "skills/creatio-app-orchestrator/SKILL.md",
    ROOT / "runbooks/01-environment-setup.md",
    ROOT / "context/essentials.md",
    ROOT / "context/INDEX.md",
]


def read_text(path):
    return path.read_text(encoding="utf-8")


def contains_any(text, markers):
    return any(marker in text for marker in markers)


def contains_all(text, markers):
    return all(marker in text for marker in markers)


class DefaultContractDocsTests(unittest.TestCase):
    def test_authority_docs_point_to_clio_mcp_contract(self):
        for path in AUTHORITY_DOCS:
            content = read_text(path)
            self.assertIn("get-tool-contract", content, str(path))
        agents_doc = read_text(ROOT / "AGENTS.md")
        self.assertRegex(agents_doc, r"only authoritative source|single source of truth")
        self.assertRegex(agents_doc, r"must not define an independent MCP API contract|must not define an independent MCP contract")

    def test_docs_delegate_default_semantics_to_clio_guidance(self):
        for path in DOC_PATHS:
            content = read_text(path)
            self.assertTrue(
                contains_any(content, [
                    "docs://mcp/guides/app-modeling",
                    "current `clio` MCP guidance",
                    "current `clio` MCP contract",
                ]) or "default requirement" in content.lower(),
                str(path),
            )
        requirements_doc = read_text(ROOT / "runbooks/02-requirements-gathering.md")
        self.assertTrue(
            contains_all(requirements_doc, [
                "`schema default`",
                "`ui default`",
                "visible BA draft",
            ])
        )

    def test_active_docs_delegate_canonical_mcp_guidance_to_clio_resources(self):
        delegation_hits = 0
        for path in CANONICAL_FLOW_DOCS:
            content = read_text(path)
            if "docs://mcp/guides/app-modeling" in content or "docs://mcp/guides/existing-app-maintenance" in content:
                delegation_hits += 1
        self.assertGreaterEqual(delegation_hits, 3)

    def test_active_docs_do_not_restate_clio_owned_field_level_contract_details(self):
        disallowed_markers = [
            "title-localizations",
            "description-localizations",
            "reference-schema-name",
            "update-operations",
            "seed-rows",
            "`default-value`",
            "`default-value-source`",
        ]
        for path in ACTIVE_CONTRACT_SURFACE_DOCS:
            content = read_text(path)
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_docs_require_confirmed_or_assumed_checklist_sources(self):
        for path in CHECKLIST_SOURCE_DOCS:
            content = read_text(path)
            self.assertIn("confirmed", content, str(path))
            self.assertIn("assumed", content, str(path))

    def test_docs_require_pre_analysis_before_ba_draft(self):
        for path in PRE_ANALYSIS_DOCS:
            content = read_text(path)
            self.assertIn("pre-analysis", content, str(path))

    def test_docs_define_first_turn_latency_bootstrap_rule(self):
        for path in FIRST_TURN_LATENCY_DOCS:
            content = read_text(path).lower()
            self.assertIn("first", content, str(path))
            self.assertIn("latency", content, str(path))
            self.assertIn("structured input", content, str(path))
            self.assertIn("do not read large repository files", content, str(path))

    def test_docs_require_domain_expertise_for_recognizable_app_types(self):
        for path in DOMAIN_EXPERTISE_DOCS:
            content = read_text(path).lower()
            self.assertIn("domain expertise", content, str(path))
            self.assertTrue(
                "standard baseline" in content
                or "standard business attributes" in content
                or "standard baseline attributes" in content,
                str(path),
            )

    def test_docs_define_fixed_business_plan_rendering_contract(self):
        agents_doc = read_text(ROOT / "AGENTS.md")
        self.assertTrue(contains_all(agents_doc, ["exact", "BA-style Business Plan structure"]))

        agent_doc = read_text(ROOT / "runbooks/02-requirements-gathering.md")
        self.assertIn("Document Rendering Contract", agent_doc)
        self.assertIn("Hard Fail Conditions", agent_doc)
        self.assertTrue(contains_all(agent_doc, ["Use tables only", "## 3. Object Model"]))
        self.assertTrue(contains_all(agent_doc, ["object field tables", "prose summaries"]))
        self.assertIn("object metadata block", agent_doc)
        self.assertTrue(contains_all(agent_doc, ["Related list", "parent foreign key"]))
        self.assertNotIn("### 3.x Relationships", agent_doc)
        self.assertIn("## 1. Business Outcome", agent_doc)
        self.assertIn("## 2. Roles and Permissions", agent_doc)
        self.assertIn("## 3. Object Model", agent_doc)
        self.assertIn("## 6. UX Expectations", agent_doc)
        self.assertTrue(contains_all(agent_doc, ["`schema default`", "`ui default`", "visible BA draft"]))
        self.assertNotIn("## 6. Implementation-shaping decisions and assumptions", agent_doc)

        checklist_doc = read_text(ROOT / "context/business-checklist.md").lower()
        self.assertIn("business logic quality bar", checklist_doc)
        self.assertIn("markdown tables outside the object model section", checklist_doc)

    def test_docs_keep_persistence_and_internal_mechanics_out_of_ba_dialogue(self):
        agents_doc = read_text(ROOT / "AGENTS.md").lower()
        self.assertIn("do not expose internal commands", agents_doc)

        agent02_doc = read_text(ROOT / "runbooks/02-requirements-gathering.md").lower()
        self.assertIn("do not expose internal commands", agent02_doc)

    def test_docs_define_stdio_only_mcp_contract(self):
        legacy_mcp_url = "mcp" + "Url"
        legacy_frontend_label = "frontend MCP " + "URL"
        for path in STDIO_ONLY_DOCS:
            content = read_text(path)
            self.assertNotIn(legacy_mcp_url, content, str(path))
            self.assertNotIn(legacy_frontend_label, content, str(path))

    def test_active_policy_docs_do_not_embed_hand_written_contract_tables(self):
        disallowed_markers = [
            "Parameter | Type | Required",
            "Parameters (all kebab-case)",
            "Request Shapes",
            "Expected Response",
            "Tool name:",
            "All parameters are strings",
        ]
        for path in AUTHORITY_DOCS:
            content = read_text(path)
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_do_not_present_exact_canonical_flows_as_repo_owned_mcp_truth(self):
        disallowed_flow_patterns = [
            r"create-app\s*->\s*sync-schemas\s*->\s*get-app-info",
            r"list-pages\s*->\s*get-page\s*->\s*sync-pages\s*->\s*get-page",
        ]
        for path in CANONICAL_FLOW_DOCS:
            content = read_text(path)
            for pattern in disallowed_flow_patterns:
                self.assertIsNone(re.search(pattern, content), f"{path}: {pattern}")

    def test_authority_docs_delegate_page_fallback_policy_to_clio_guidance(self):
        for path in FALLBACK_DOCS:
            content = read_text(path)
            self.assertIn("docs://mcp/guides/existing-app-maintenance", content, str(path))

    def test_repo_preserves_policy_surfaces(self):
        agents_doc = read_text(ROOT / "AGENTS.md")
        self.assertTrue("Business context" in agents_doc or "Business Outcome" in agents_doc)
        self.assertTrue(
            "Users, access and ownership" in agents_doc
            or "Roles and Permissions" in agents_doc
        )
        self.assertIn("orchestration", agents_doc.lower())
        self.assertIn("approvals", agents_doc.lower())
        self.assertIn("business invariants", agents_doc.lower())

    def test_schema_docs_delegate_entity_and_schema_semantics_to_clio(self):
        disallowed_markers = [
            "BaseLookup",
            "PrimaryDisplayColumn",
            "defaultValueSource",
            "default-value-source",
            "title-localizations",
            "reference-schema-name",
            "seed-rows",
        ]
        for path in WORKFLOW_ONLY_SCHEMA_DOCS:
            content = read_text(path)
            self.assertIn("get-tool-contract", content, str(path))
            self.assertIn("docs://mcp/guides/app-modeling", content, str(path))
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_authority_docs_do_not_restate_clio_owned_guidance_markers(self):
        disallowed_markers = [
            "canonical-main-entity-name",
            "scalar-only",
        ]
        scoped_docs = [
            ROOT / "README.md",
            ROOT / "context/INDEX.md",
            ROOT / "context/essentials.md",
        ]
        for path in scoped_docs:
            content = read_text(path)
            for marker in disallowed_markers:
                self.assertNotIn(marker, content, f"{path}: {marker}")

    def test_docs_do_not_use_dot_style_application_tool_names(self):
        for path in DOT_STYLE_APPLICATION_TOOL_DOCS:
            content = read_text(path)
            self.assertNotIn("application.create", content, str(path))
            self.assertNotIn("application.get_list", content, str(path))
            self.assertNotIn("application.get_info", content, str(path))


    def test_docs_route_page_edits_to_web_vs_mobile(self):
        # Routing surfaces force reading essentials before a page edit (pointer, not nuance).
        for path in [ROOT / "AGENTS.md", ROOT / "skills/creatio-app-orchestrator/SKILL.md"]:
            content = read_text(path)
            self.assertIn("essentials", content, str(path))
            self.assertRegex(content, r"(?i)web.{0,20}mobile|mobile.{0,20}web", str(path))
        # The page-schema nuance lives in essentials, not in the routers.
        essentials = read_text(ROOT / "context/essentials.md")
        self.assertIn("_MobileFormPage", essentials)
        self.assertRegex(essentials, r"(?i)web vs mobile")
        self.assertRegex(essentials, r"(?i)default to web")

    def test_docs_prefer_native_mcp_over_stdio_wrapper(self):
        # ENG-91276: every transport-aware doc must prefer native MCP and treat
        # runtime/scripts/mcp_client.py as the stdio fallback, not the default.
        for path in NATIVE_MCP_FIRST_DOCS:
            content = read_text(path).lower()
            self.assertIn("native", content, str(path))
            self.assertIn("fallback", content, str(path))
            self.assertIn("mcp_client.py", content, str(path))

    def test_docs_require_single_clio_context(self):
        # ENG-91276: native MCP and the wrapper must resolve the same clio
        # (one config / one registered-environments list) — no split-brain.
        for path in SINGLE_CLIO_CONTEXT_DOCS:
            content = read_text(path).lower()
            self.assertIn("single clio context", content, str(path))
            self.assertIn("split-brain", content, str(path))

    def test_docs_require_writable_package_context_up_front(self):
        # ENG-91276: a writable package context must be resolved before the first
        # schema/page edit, not discovered as a mid-run write rejection.
        for path in WRITABLE_PACKAGE_CONTEXT_DOCS:
            content = read_text(path).lower()
            self.assertIn("writable package context", content, str(path))
            self.assertIn("up front", content, str(path))
            self.assertIn("mid-run", content, str(path))

    def test_docs_auto_register_unregistered_prompt_url(self):
        # ENG-91558: a Creatio URL in the prompt with no matching environment is
        # auto-registered with default Supervisor/Supervisor credentials and no
        # confirmation turn; an auth/registration failure stops with a clear error.
        for path in AUTO_REGISTER_PROMPT_URL_DOCS:
            content = read_text(path).lower()
            self.assertIn("auto-register", content, str(path))
            self.assertIn("supervisor", content, str(path))
            self.assertIn("without a confirmation turn", content, str(path))
            self.assertIn("stop with a clear error", content, str(path))

    def test_docs_auto_register_is_host_pattern_guarded(self):
        # ENG-91558 (review RC-1): auto-register with default credentials must be
        # gated on a known Creatio host pattern and fall back to asking for
        # credentials otherwise (prompt-injection / untrusted-URL guard).
        for path in AUTO_REGISTER_PROMPT_URL_DOCS:
            content = read_text(path).lower()
            self.assertIn("known creatio host pattern", content, str(path))
            # ENG-91558 (review RC-6/RC-7): the host pattern is a closed enumeration
            # of concrete patterns, not an open-ended "intranet" category.
            self.assertIn(".creatio.com", content, str(path))
            self.assertIn("tscrm.com", content, str(path))
            self.assertIn("ts1-", content, str(path))
            self.assertIn("localhost", content, str(path))
            # ENG-91558 (review RC-13): 127.0.0.1 is part of the closed enumeration
            self.assertIn("127.0.0.1", content, str(path))
            self.assertNotIn("intranet", content, str(path))
            # ENG-91558 (review RC-16): the security-critical "no dots" single-label
            # narrowing for ts1-* must be locked so it cannot silently regress.
            self.assertIn("no dots", content, str(path))
            # ENG-91558 (review RC-15): host taken from the authority component only,
            # with counter-examples for the cloud wildcards and the userinfo bypass.
            self.assertIn("authority", content, str(path))
            self.assertIn("creatio.com.attacker", content, str(path))
            self.assertIn("creatio.com@", content, str(path))
            # ENG-91558 (review minor): AC2 "do not retry with guessed credentials"
            self.assertIn("do not retry", content, str(path))
            # ENG-91558 (review RC-17): cloud *.creatio.com is NOT in the
            # zero-confirmation tier — it requires a confirmation turn because the
            # subdomain provisioner is not guaranteed (tenancy trust boundary).
            self.assertIn("zero-confirmation", content, str(path))
            # ENG-91558 (review RC-21): the :port suffix is stripped before host
            # matching, so the common local/dev case (host:88) still matches.
            self.assertIn(":port", content, str(path))
            self.assertIn("does match", content, str(path))
            # ENG-91558 (review RC-22): the URL is passed as a discrete argv arg,
            # never shell-interpolated (path/query cannot inject metacharacters).
            self.assertIn("argv", content, str(path))
            # carve-out boundary that bounds the rule
            self.assertIn("ambiguous", content, str(path))

    def test_docs_host_pattern_enumeration_consistent_across_docs(self):
        # ENG-91558 (review RC-23): the host-pattern trust boundary is stated in
        # both AGENTS.md and the runbook; assert the pattern set is identical in
        # both so a future edit to one copy cannot silently drift from the other.
        agents = read_text(ROOT / "AGENTS.md").lower()
        runbook = read_text(ROOT / "runbooks/01-environment-setup.md").lower()
        host_pattern_tokens = [
            "*.creatio.com", "*.tscrm.com", "ts1-", "localhost", "127.0.0.1",
            "no dots", "zero-confirmation", ":port", "authority",
        ]
        for token in host_pattern_tokens:
            self.assertIn(token, agents, f"AGENTS.md missing host-pattern token: {token}")
            self.assertIn(token, runbook, f"runbook missing host-pattern token: {token}")

    def test_docs_require_env_name_slug_sanitization(self):
        # ENG-91558 (review RC-12/RC-14): the URL-derived <env_name> must be
        # sanitized to a safe slug before reaching reg-web-app, and the canonical
        # AGENTS.md contract must state it (not only the runbook).
        agents = read_text(ROOT / "AGENTS.md").lower()
        runbook = read_text(ROOT / "runbooks/01-environment-setup.md").lower()
        for content in (agents, runbook):
            self.assertIn("slug", content)
            self.assertIn("metacharacter", content)

    def test_docs_remind_default_password_rotation_after_auto_register(self):
        # ENG-91558 (review RC-8): the runbook must remind the developer to rotate
        # the default Supervisor password after auto-registering a non-local env.
        content = read_text(ROOT / "runbooks/01-environment-setup.md").lower()
        self.assertIn("change the default", content)
        self.assertIn("supervisor", content)
        self.assertIn("password", content)

    def test_docs_default_app_creation_without_confirmation(self):
        # ENG-91558: adding a section for a named entity creates the app named after
        # that entity without an extra confirmation turn when no custom app exists.
        for path in DEFAULT_APP_CREATION_DOCS:
            content = read_text(path).lower()
            self.assertIn("add a section for a named entity", content, str(path))
            self.assertIn("without an extra confirmation turn", content, str(path))
            self.assertIn("askuserquestion", content, str(path))
            # ENG-91558 (review RC-4): the "ambiguous" carve-out bounds the rule
            self.assertIn("ambiguous", content, str(path))

    def test_docs_require_clio_mcp_availability_preflight_and_fail_fast(self):
        # ENG-92985: before the first clio operation, run an availability preflight;
        # when clio MCP is unavailable, stop with a prerequisites blocker (install
        # .NET, install clio, reg-web-app) and do NOT self-bootstrap the environment.
        for path in CLIO_MCP_PREFLIGHT_DOCS:
            content = read_text(path).lower()
            self.assertIn("availability preflight", content, str(path))
            self.assertIn("prerequisites blocker", content, str(path))
            # blocker enumerates the three developer-owned prerequisites
            self.assertIn(".net", content, str(path))
            self.assertIn("reg-web-app", content, str(path))
            # AC4: no self-bootstrapping when clio MCP is unavailable
            self.assertIn("do not install", content, str(path))
            self.assertIn("executionpolicy", content, str(path))
            self.assertIn("silently register", content, str(path))
            # AC6: registered-but-unresponsive is treated as unavailable, no
            # indefinite retry
            self.assertIn("unresponsive", content, str(path))
            self.assertIn("retry indefinitely", content, str(path))

    def test_docs_mandate_deterministic_preflight_gate_script(self):
        # ENG-92985 (elevation): the STOP decision is a deterministic gate, not prose
        # the agent can reason past. Every contract doc must name the gate script and
        # the three-state verdict (usable / blocked) with its sentinels + exit codes.
        # Sentinel/exit tokens are derived from the script constants (M1) so a rename
        # is caught here instead of drifting silently.
        usable_token = pf.SENTINEL_USABLE.split(": ", 1)[1].lower()   # clio-mcp-usable
        blocked_token = pf.SENTINEL_BLOCKED.split(": ", 1)[1].lower()  # clio-mcp-unavailable
        for path in CLIO_MCP_PREFLIGHT_DOCS:
            content = read_text(path).lower()
            self.assertIn("clio_mcp_preflight.py", content, str(path))
            self.assertIn("deterministic gate", content, str(path))
            self.assertIn(usable_token, content, str(path))
            self.assertIn(blocked_token, content, str(path))
            self.assertIn(f"exit {pf.EXIT_USABLE}", content, str(path))
            self.assertIn(f"exit {pf.EXIT_BLOCKED}", content, str(path))
            self.assertIn("state b", content, str(path))
            self.assertIn("state c", content, str(path))
            # "no native tools surfaced" is explicitly NOT auto-blocking (challenge C5)
            self.assertIn("not automatically a blocker", content, str(path))

    def test_docs_state_preflight_probe_timeout_matches_script(self):
        # ENG-92985 (M1): the "default 20s" probe bound stated in the docs is bound to
        # the script constant, so changing DEFAULT_PROBE_TIMEOUT flags the stale docs.
        timeout_token = f"{pf.DEFAULT_PROBE_TIMEOUT}s"
        for path in [ROOT / "AGENTS.md", ROOT / "runbooks/01-environment-setup.md"]:
            self.assertIn(timeout_token, read_text(path), str(path))

    def test_docs_define_precise_wrapper_opt_in_signal(self):
        # ENG-92985 (elevation, challenge C2): a generic approval is not opt-in; the
        # escape hatch is unlocked only by an explicit developer instruction, and the
        # contract-level doc (AGENTS.md) must say so.
        content = read_text(ROOT / "AGENTS.md").lower()
        self.assertIn("opt-in signal", content)
        # markup-tolerant: matches "not opt-in" or "not** opt-in" (bold emphasis)
        self.assertRegex(content, r"not\*{0,2}\s*opt-in")
        self.assertIn("approved command prefix", content)

    def test_docs_frame_mcp_client_as_opt_in_escape_hatch(self):
        # ENG-92985 (AC5/AC7): the Python client is an explicit opt-in escape hatch,
        # not the default degraded path. Keep the ENG-91276 native/fallback framing
        # while removing any "silent fallback" legitimization.
        for path in OPT_IN_ESCAPE_HATCH_DOCS:
            content = read_text(path).lower()
            self.assertIn("explicit opt-in", content, str(path))
            self.assertIn("escape hatch", content, str(path))
            self.assertIn("mcp_client.py", content, str(path))

    def test_docs_state_b_prefers_native_mcp_before_wrapper(self):
        # ENG-92985 (State B refinement): in State B the agent must FIRST recommend
        # connecting native clio MCP (host-agnostic) and defer the per-host how-to to
        # the install docs — only then fall back to the wrapper. Every contract doc
        # states the recommendation and points at the install docs.
        for path in CLIO_MCP_PREFLIGHT_DOCS:
            content = read_text(path).lower()
            self.assertIn("native clio mcp", content, str(path))
            self.assertIn("connect", content, str(path))
            self.assertTrue(
                "docs/install.md" in content or "install docs" in content,
                f"{path}: State B must point to the install docs for per-host setup",
            )
        # Finding 3: prefer-native is an ORDERING guarantee, not just token presence —
        # within AGENTS.md State B, the native recommendation must precede the wrapper.
        agents = read_text(ROOT / "AGENTS.md")
        sb_start = agents.index("**State B")
        sb = agents[sb_start:agents.index("**State C", sb_start)]
        self.assertLess(
            sb.index("connect clio as a native MCP server"),
            sb.index("mcp_client.py"),
            "AGENTS.md State B must recommend native MCP before mentioning the wrapper",
        )

    def test_agents_preflight_section_has_no_hardcoded_per_agent_mcp_steps(self):
        # ENG-92985 (State B refinement): how you connect native MCP drifts per agent,
        # so the behavioral contract must NOT hardcode agent-specific steps (config.toml
        # edits, installer commands) inside the preflight section — those belong in the
        # install docs. Scope the check to the preflight section so the unrelated
        # installer mention elsewhere in AGENTS.md does not trip it.
        agents = read_text(ROOT / "AGENTS.md")
        start = agents.index("clio MCP availability preflight")
        end = agents.index("clio MCP transport preference", start)
        section = agents[start:end].lower()
        self.assertNotIn("config.toml", section)
        self.assertNotIn("installer/install.py", section)
        # the generic recommendation + docs pointer DO live in the section
        self.assertIn("native mcp server", section)
        self.assertIn("docs/install.md", section)

    def test_docs_frame_wrapper_fallback_in_plain_language(self):
        # ENG-92985 (State B refinement): the wrapper fallback must be framed in plain
        # language — slower, no progress, not recommended — never buried behind jargon
        # like "may appear to hang".
        agents = read_text(ROOT / "AGENTS.md").lower()
        self.assertIn("slower", agents)
        self.assertIn("no progress", agents)
        self.assertIn("frozen", agents)
        self.assertTrue(
            "not the recommended" in agents or "not recommended" in agents, "AGENTS.md",
        )
        # Finding 4: the compact mirrors must carry the same plain-language framing so a
        # mirror cannot silently drop it (repo's identical-rules-across-docs ethos).
        for path in (ROOT / "skills/creatio-app-orchestrator/SKILL.md",
                     ROOT / "runbooks/01-environment-setup.md"):
            mirror = read_text(path).lower()
            self.assertIn("slower", mirror, str(path))
            self.assertIn("no progress", mirror, str(path))
            self.assertTrue(
                "not the recommended" in mirror or "not recommended" in mirror, str(path),
            )

    def test_docs_state_b_gives_actionable_how_to_and_reload_caveat(self):
        # ENG-92985 (#2/#3): State B must be actionable AND honest — surface WHERE the
        # per-host connect steps live (install-docs pointer + optional paste-ready
        # config snippet the developer applies), and be honest that enabling native MCP
        # usually needs a session reload (fresh context), so "retry" is a new session,
        # not this one — recommend native at task start, name the mid-task trade-off.
        agents = read_text(ROOT / "AGENTS.md").lower()
        # #2 — actionable how-to (not just "what")
        self.assertIn("config snippet", agents)
        self.assertIn("docs/install.md", agents)
        # #3 — reload honesty
        self.assertIn("session reload", agents)
        self.assertIn("mid-task", agents)
        # Finding 2 (section-scoped) — the two safety invariants of this increment:
        raw = read_text(ROOT / "AGENTS.md")
        sb_start = raw.index("**State B")
        sb = raw[sb_start:raw.index("**State C", sb_start)].lower()
        # (a) snippet apply-boundary: showing is fine, APPLYING it is self-bootstrap —
        # locks the config-editing axis of the no-self-bootstrap rule.
        self.assertIn("config snippet", sb)
        self.assertIn("the developer applies", sb)
        self.assertIn("self-bootstrap", sb)
        # (b) opt-in precedence: "mid-task" must NOT license a self-selected wrapper —
        # the explicit-opt-in requirement is co-located in the same State B block.
        self.assertIn("mid-task", sb)
        self.assertIn("explicit opt-in", sb)


if __name__ == "__main__":
    unittest.main()
