# Changelog

All notable changes to Mnemoscope are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and (loosely) [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-04-26

First public, *production-grade* release. The previous tag was a scaffold; this release adds the things that make the scaffold actually load-bearing: chained Ed25519 signatures, a Claude Code auto-journal hook, integration tests against the real MCP server, and a complete research sub-project.

### Added

- **`@mnemoscope/core`**
  - Predictive context-rot scorer with five citation-backed factors (`tokenVolume`, `semanticRedundancy`, `distractorDensity`, `structuralCoherence`, `freshnessSpread`). Each factor function is exported and unit-tested at both ends of its range.
  - **Real Ed25519 journal signing** with per-vault keypair stored at `.mnemoscope/keys/ed25519.key` (mode 0600).
  - **Hash-chained entries**: every entry's `prevHash` is the SHA-256 of the previous entry's signature, so deletion / reordering of entries is detectable, not just field-level tampering.
  - `verifyAll()` returns per-entry valid/invalid verdicts with structured reasons (`signature mismatch`, `chain break: …`, `signed by unknown key …`).
- **`@mnemoscope/mcp-server`**
  - Four MCP tools: `predict_rot`, `get_tiered_read`, `record_journal`, `read_journal`.
  - Five end-to-end integration tests that spawn the server and exchange real JSON-RPC over stdio.
- **`@mnemoscope/cli`** (new package)
  - `mnemoscope-record-hook` — Claude Code `PostToolUse` hook that auto-journals every `Write` / `Edit` / `MultiEdit`. Resolves the vault root via `MNEMOSCOPE_VAULT_PATH` or by walking up to a `.mnemoscope/` directory. Never blocks the tool call.
  - `mnemoscope-verify` — replays the journal and exits non-zero on any invalid entry.
- **`@mnemoscope/obsidian-plugin`**
  - "Scan vault rot" command + ribbon icon. Compiles to an 8 KB single-file bundle.
- **`research/`** — full Python sub-project managed with `uv`:
  - `research/classifier/` — sklearn → ONNX pipeline with synthetic baseline data so the train→export→round-trip path is mechanically verified.
  - `research/benchmark/` — **MarkdownMemBench v0.1** schema, JSON-Schema validator, hand-crafted sample dataset (1 vault, 5 tasks across recall / multi-hop / cross-doc-negation / aggregation / write-task), reference harness with two SUTs (`naive`, `mnemoscope`).
  - `research/replication/` — protocol document for replicating Chroma's *Context Rot* "structured > shuffled is worse" finding on real Markdown vaults.
- **Documentation**: `docs/banner.svg`, `docs/logo.svg`, `docs/claude-code-hook.md`, `SECURITY.md`, `CHANGELOG.md`.
- **CI**: lint-free build, full test suite, and `npm audit --audit-level=moderate` on every push.

### Verified

- 28 tests passing (23 in `core`, 5 integration tests in `mcp-server`).
- 0 npm vulnerabilities.
- Smoke-tested end-to-end against the author's 506K-token Brainstorm vault: `predict_rot` returned 41/100, dominated by `tokenVolume`; the five top-risk notes were the five largest notes — sensible.

## [0.0.1] — 2026-04-26

Initial scaffold pushed to GitHub. Monorepo layout, Apache-2.0, `core` + `mcp-server` + `obsidian-plugin` packages, GitHub Actions CI, banner + logo SVG. No real signing, no auto-journal hook, no integration tests, no research sub-project.

[Unreleased]: https://github.com/toonight/Mnemoscope/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/toonight/Mnemoscope/releases/tag/v0.1.0
[0.0.1]: https://github.com/toonight/Mnemoscope/releases/tag/v0.0.1
