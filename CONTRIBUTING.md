# Contributing

Thank you for your interest in the Creatio AI App Development Toolkit. This document describes how to report issues, ask for help, and propose changes.

## Getting Help and Support

For general questions, installation problems, and feature requests, email **support@creatio.com**.

For non-sensitive questions you can also open a [GitHub issue](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/issues). Include the toolkit version, the host coding agent (Codex, Claude Code, Cursor, GitHub Copilot CLI), your operating system, and the steps that produced the problem.

For security issues, follow the dedicated channel in [SECURITY.md](SECURITY.md). Do not file security reports as public issues.

## Reporting Bugs

Before filing a new issue, please:

1. Confirm you are running the latest released version (see [GitHub Releases](https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit/releases)).
2. Search existing issues to avoid duplicates.
3. Include a minimal reproduction: the natural-language request you gave the agent, the resulting Business Plan or error, and the clio MCP commands involved if any.

## Proposing Changes

Pull requests are welcome. Before opening one:

1. Open an issue describing the change so it can be discussed before implementation.
2. Keep changes focused — one logical change per pull request.
3. Update or add tests under `tests/` for any behavior change. Run the existing test suite locally before pushing.
4. Update relevant documentation (`README.md`, `docs/`, `AGENTS.md`, `runbooks/`, `context/`) when your change affects them.
5. Follow the repository's existing style and the agent-orchestration contract documented in `AGENTS.md`.

By submitting a pull request you agree that your contribution is licensed under the same MIT License as the rest of the repository (see [LICENSE](LICENSE)).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behavior to **support@creatio.com**.
