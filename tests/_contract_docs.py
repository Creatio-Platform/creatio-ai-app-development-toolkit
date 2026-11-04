"""The orchestration contract as the tests read it.

The contract is split across three files: the thin root `AGENTS.md` (repository-wide rules), the
orchestrator's `references/orchestration-policy.md` (the app-workflow contract: gates, Business Plan
format, routing, support mode) and the core `context/essentials.md` (global invariants). Contract
assertions read the union so a rule can live in whichever file owns it.

Every file is read unconditionally: a missing one is a failure here, not a silently smaller union
that would let every negative assertion (`assertNotIn`) over the vanished text pass vacuously.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

AGENTS_CONTRACT_FILES = (
    ROOT / "AGENTS.md",
    ROOT / "plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/orchestration-policy.md",
    ROOT / "plugins/creatio-core/context/essentials.md",
)


def agents_contract_text() -> str:
    return "\n\n".join(path.read_text(encoding="utf-8") for path in AGENTS_CONTRACT_FILES)
