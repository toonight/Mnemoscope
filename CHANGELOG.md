# Changelog

All notable changes to Mnemoscope are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and (loosely) [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `mnemoscope-init` CLI that bootstraps `<vault>/.mnemoscope/` (creates state dir, generates per-vault Ed25519 keypair, writes a small README explaining the directory). Idempotent.
- Obsidian plugin upgrade: real sidebar view with an SVG rot-risk gauge, per-factor breakdown bars, top-risk-notes list, and a settings tab to tune working/episodic age thresholds and toggle auto-scan on Obsidian open. Bundle grew from 8 KB to 15 KB.
- `.github/workflows/release.yml` — pushes a `v*.*.*` tag to publish `@mnemoscope/{core,mcp-server,cli}` to npm with provenance and create a matching GitHub Release. Requires `NPM_TOKEN` repo secret.
- `examples/demo-vault/` — a 13-note synthetic vault built so every rot factor moves; bundled `SAMPLE-OUTPUT.md` reproduces the full pipeline end-to-end.
- `docs/demo/` — a self-contained HTML demo page (gauge + factor bars + top-risk + both verify states + tier counts + hash chain), with three Playwright-rendered screenshots in `docs/screenshots/` embedded near the top of the README.
- **Chroma replication runner** — `research/replication/` ships `needles.py`, `haystack.py`, `run.py`, `analyze.py`. Runs offline (substring grading sanity check) or against any OpenAI-compatible endpoint (`MMB_LLM_API_KEY`). Smoke-tested end-to-end on the bundled sample dataset: 24 cells, JSON report + Markdown report, ∆ = 0 in offline mode (haystack builder produces correct corpora, needles always present).
- **Encrypted off-vault key backup** — new `core/keys.ts` module + `mnemoscope-backup-key` and `mnemoscope-restore-key` CLIs. AES-256-GCM + scrypt (N=32768, r=8, p=1), self-describing JSON envelope, no external dependencies. Backup file is `chmod 0600`; restore refuses to overwrite an existing key without `--overwrite`. 7 unit tests cover round-trip, wrong-passphrase failure, IV randomness, file-mode enforcement, version-rejection. Full flow documented in `docs/key-escrow.md`.
- **GitHub Actions Node 24 opt-in** — both workflows now set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so the Node 20 deprecation warning is replaced by an informational "forced to Node 24" notice.
- **Position-of-needle sweep** in the replication runner. `haystack.build_pair` now redacts the needle from the natural padding and re-inserts it at a controlled position (`start` / `middle` / `end`); `run.py` accepts `--positions start,middle,end`; the report renders the structuring effect at fixed position and the position effect at fixed structuring as two separate tables, with a "lost-in-the-middle" interpretation when present. Disentangles Chroma 2025 "structured > shuffled is worse" from Liu et al. 2023 "lost in the middle". Smoke-tested end-to-end (24 cells, JSON + Markdown report) on the bundled sample vault.
- **Python CI bench** — new `python` job in `.github/workflows/ci.yml` runs `uv sync`, `ruff check`, and `pytest` on every push. 14 new tests under `research/tests/` cover needle extraction (uniqueness, MD5 stability, limit), haystack construction (single-occurrence after redaction, position bands, deterministic shuffle, paragraph-set invariance, invalid-position rejection), and the runner's offline grader / aggregator (3 positions × 2 structurings = 6 cells, both summary tables emitted). Ruff `select = E,F,I,B,UP` + auto-import sort applied to the whole `research/` tree.
- **Obsidian onboarding auto** — on first layout-ready, the plugin checks whether `<vault>/.mnemoscope/` exists; if not, it surfaces a one-time modal that explains the four files that initialization will create and offers an "Initialize" button (mirrors `mnemoscope-init` on disk: mkdir, generate Ed25519 keypair via `Journal.open`, write a small README, mode 0600 enforced by core). The modal is gated by a new `onboardingDismissed` setting so it never nags. A "Initialize this vault for Mnemoscope" command and a settings-tab button also let the user trigger init manually. Plugin bundle grew from 15 KB to 28 KB (Journal pulled into the plugin path).

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
