# Mnemoscope

> See how your agent remembers (and forgets).

**Mnemoscope** is an open-source observability layer for LLM agent memory on Markdown-based knowledge vaults (Obsidian, Logseq, plain folders). It is not yet another memory store — it is an instrument to *measure*, *predict*, and *audit* what your agent actually does to your notes.

It ships as a **MCP server** (usable by Claude Code, Cursor, ChatGPT desktop, and any MCP-compatible client) plus an **Obsidian plugin** for the visual side. Everything runs 100% locally. No cloud. No telemetry without explicit opt-in.

## Why this project exists

The dominant 2025–2026 narrative on X — "Markdown trips up the LLM at scale" — is partially wrong. Markdown does not trip up the LLM. *Long-context loading* trips up the LLM. Chroma's *Context Rot* study (July 2025) showed that even models with 200K+ context windows degrade dramatically once you push past 50–100K tokens — sometimes earlier, on coherent and structured haystacks.

Yet none of the existing tools we surveyed (Mem0, Letta, Zep, Cognee, MemPalace, Smart Connections, Anthropic's native Memory tool, Khoj, Reor, Basic Memory MCP) does any of the following:

1. **Predict** the rot risk of a corpus *before* it gets injected into the LLM.
2. **Witness** what the agent reads and writes during a session, with a locally signed audit trail.
3. **Tier** the corpus into a working / episodic / semantic hierarchy, drawing on the science (Letta's filesystem result, GAM dual-agent, sleep-time compute) instead of the GraphRAG hype.

Mnemoscope tries to fill this triple gap, in the open, for the community.

## Three contribution axes

### 1. Predictive context rot scoring

Every existing benchmark (NIAH, LongMemEval, LoCoMo, BABILong, RULER) measures degradation **after** injection. That is reactive. Mnemoscope computes a `rot_risk` score (0–100) from a corpus's structural signatures — total token estimate, semantic redundancy, distractor density, link topology, freshness distribution — *before* the LLM ever sees it. Calibration target: predict expected accuracy loss on LongMemEval/LoCoMo with R² ≥ 0.6 on a held-out set.

If we get this right, it is a publishable contribution and a usable tool, not just a tool.

### 2. Signed local journal of agent writes

A MCP middleware that intercepts writes to your vault and records, locally, an append-only log: timestamp, file path, content diff, content hash, signing key fingerprint. You can audit any session by replaying its journal. This addresses the documented pain (200+ Reddit/HN threads on "Claude Code overwrote my files") and gives users back forensic visibility on autonomous agents.

### 3. Hierarchical memory reference implementation

An open-source reference implementation of the working / episodic / semantic tiering pattern that the science of 2025–2026 (Letta, Yu et al. 2026, GAM, Karpathy LLM Wiki) keeps converging on. Built directly on Markdown, with no graph database required, no cloud, and no proprietary serialization.

## Project status

🌱 **Early scaffolding.** No releases yet. The current code is the minimum viable shape — folder layout, types, stubs of each axis. The first useful version is meant to dogfood on a real Obsidian vault before it is asked to do anything for anyone else.

## Architecture

```
mnemoscope/
├── packages/
│   ├── core/              # rot scoring, tiering, journal, signature extraction
│   ├── mcp-server/        # MCP server (stdio); tools: predict_rot, get_journal, get_tiered_read
│   └── obsidian-plugin/   # Obsidian plugin: visual rot gauge + journal viewer
├── research/              # Python: predictive classifier training, MarkdownMemBench
├── docs/                  # docs site (later)
└── README.md
```

The TypeScript packages are runnable end-to-end on Node 22+. The `research/` folder is a Python sub-project (managed with `uv`) used only to train models and prepare benchmarks; it is not required for users — trained models ship as ONNX files loaded by `onnxruntime-node` inside the MCP server.

## Voisins (not competitors)

We see Mnemoscope as a citizen of an existing ecosystem, not a replacement for any of it.

- [Anthropic Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) — official, file-based, primitive. Mnemoscope adds the rot-scoring and the journal it does not provide.
- [Letta](https://letta.com) / [MemGPT](https://github.com/letta-ai/letta) — runtime-stateful agents. Different layer.
- [Mem0](https://mem0.ai), [Zep](https://getzep.com), [Cognee](https://cognee.ai) — generic memory stores. Different scope.
- [MemPalace](https://mempalace.tech) — viral OSS memory MCP. Not Obsidian-specific.
- [Smart Connections](https://smartconnections.app) — RAG-vector for Obsidian. Complementary.
- [Basic Memory MCP](https://github.com/basicmachines-co/basic-memory) — semantic graph over markdown. Closest in spirit; we want to interop, not duplicate.
- [claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler) (Cole Medin) — MD-compiler approach. Reach out before duplicating.

If you maintain one of these projects and see overlap or complementarity, please open an issue or reach out — collaboration is the point.

## Scientific posture

Mnemoscope is meant to be a tool *and* a contribution to the public empirical record on agent memory. Specifically:

- **MarkdownMemBench (planned)**: an opt-in dataset of anonymized Obsidian vaults with recall, multi-hop, and write-task questions. Today's benchmarks (LongMemEval, LoCoMo) are conversational and English-only; this would be the first vault-native, MD-native bench.
- **Replication of Chroma's "structured > shuffled" result**: Chroma showed that coherent haystacks underperform shuffled ones on NIAH. We aim to replicate or refute this on real Obsidian vaults with the same protocol.

These will live in `research/` and be released as papers/preprints alongside the code.

## Getting involved

The repo is intentionally bare on day one. If you're interested:

- File an issue describing your use case before submitting code.
- Target small, specific PRs rather than refactors.
- If you're a researcher (Letta, Chroma, Mem0, Cognee, OSU-NLP, etc.) interested in collaboration on Predictive Context Rot or MarkdownMemBench, please reach out via issues.

## License

Apache License 2.0 — see [LICENSE](LICENSE). Apache-2.0 was chosen over MIT for its explicit patent grant, which we believe is appropriate for a project introducing novel scoring methods.

## Acknowledgements

Mnemoscope's framing borrows directly from public work by:

- [Chroma Research — Context Rot (July 2025)](https://www.trychroma.com/research/context-rot)
- [Letta — Is a Filesystem All You Need? (August 2025)](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- [Letta — Sleep-time Compute (2025)](https://www.letta.com/blog/sleep-time-compute)
- [Microsoft — LazyGraphRAG (June 2025)](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- [HippoRAG (NeurIPS'24, OSU-NLP)](https://github.com/osu-nlp-group/hipporag)
- [LongMemEval (ICLR 2025)](https://arxiv.org/pdf/2410.10813)
- [LoCoMo (Snap Research)](https://snap-research.github.io/locomo/)
- [Andrej Karpathy's LLM Wiki proposal (April 2026)](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)

Without their public artifacts, this project would not be possible.
