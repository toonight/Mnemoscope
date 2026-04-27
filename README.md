<div align="center">

<img src="./docs/banner.svg" alt="Mnemoscope — See how your agent remembers (and forgets)." width="100%" />

<p>
  <a href="https://github.com/toonight/Mnemoscope/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-2ea043?style=flat-square"></a>
  <a href="https://nodejs.org"><img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=node.js&logoColor=white"></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/MCP-server%20+%20Obsidian-5fd9d1?style=flat-square"></a>
  <img alt="100% local" src="https://img.shields.io/badge/runs-100%25%20local-a78bfa?style=flat-square">
  <img alt="Status: scaffolding" src="https://img.shields.io/badge/status-scaffolding-fbbf24?style=flat-square">
  <a href="https://github.com/toonight/Mnemoscope/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/toonight/Mnemoscope/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p><i>An open-source observability layer for LLM agent memory on Markdown vaults.<br/>Predict context rot before it happens. Audit what your agent reads and writes. Tier your knowledge the way the science says you should.</i></p>

</div>

---

> [!NOTE]
> The dominant 2025–2026 narrative on X — *"Markdown trips up the LLM at scale"* — is partially wrong. **Markdown** does not trip up the LLM. **Long-context loading** trips up the LLM ([Chroma, *Context Rot*, July 2025](https://www.trychroma.com/research/context-rot)). Mnemoscope is built on that distinction.

## ✨ Why Mnemoscope?

Mnemoscope is **not** another memory store. It is an **instrument** to:

- 🎯 **Predict** the rot risk of a corpus *before* it gets injected into the LLM.
- 📝 **Witness** what the agent reads and writes during a session, with a locally signed audit trail.
- 🧱 **Tier** the corpus into a working / episodic / semantic hierarchy, drawing on the science instead of the GraphRAG hype.

It ships as an **MCP server** (consumable by Claude Code, Cursor, ChatGPT desktop, and any MCP-compatible client) plus an **Obsidian plugin** for the visual side. Everything runs **100% locally**. No cloud. No telemetry without explicit opt-in.

## 🧭 The three contribution axes at a glance

| | Axis | What it does | Status |
|:-:|---|---|:-:|
| 🎯 | **Predictive context-rot scoring** | Computes a `rot_risk` score (0–100) from structural signatures *before* injection. The science measures degradation reactively after the fact; we want to predict it. | 🟡 v0 heuristic |
| 📝 | **Signed local journal** | Append-only JSONL log of every agent read/write/create/delete on the vault, with content hashes — for forensic replay of any session. | 🟡 v0 (signing later) |
| 🧱 | **Hierarchical memory tiering** | Reference implementation of the working/episodic/semantic split that 2025–2026 agent-memory research keeps converging on, on plain Markdown. | 🟡 v0 freshness-based |

> [!TIP]
> Each axis has a separate research thread in [`research/`](./research) — open-source classifier training, MarkdownMemBench dataset construction, and a Chroma replication. Researchers are explicitly invited.

## 🚀 Quickstart

```bash
git clone https://github.com/toonight/Mnemoscope
cd Mnemoscope
npm install
npm run build
```

### Use it from Claude Code (or any MCP client)

Add Mnemoscope to your MCP client config:

```json
{
  "mcpServers": {
    "mnemoscope": {
      "command": "node",
      "args": ["/absolute/path/to/Mnemoscope/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Then call any of the four tools:

| Tool | What it does |
|---|---|
| `predict_rot` | Returns the rot risk score, factor breakdown, and 5 highest-risk notes for a vault. |
| `get_tiered_read` | Splits a vault into `working` / `episodic` / `semantic` layers; lets the agent read a compacted view instead of the full dump. |
| `record_journal` | Appends a forensic entry (read/write/create/delete + hashes) to the local journal. |
| `read_journal` | Replays journal entries, optionally filtered by `session_id`. |

## 🏗️ Architecture

```mermaid
flowchart LR
    A["Obsidian vault<br/>Markdown files"] --> B["mnemoscope/core<br/>signatures - rot - tiering - journal"]
    B --> C["mnemoscope/mcp-server<br/>stdio MCP"]
    B --> D["mnemoscope/obsidian-plugin<br/>UI - rot gauge - journal viewer"]
    C -->|tools| E(("Claude Code<br/>Cursor<br/>ChatGPT desktop"))
    F["research/<br/>Python - uv - ONNX"] -.->|trained classifier| B
    style A fill:#1a2444,stroke:#a78bfa,color:#cbd5e1
    style B fill:#0e1530,stroke:#5fd9d1,color:#cbd5e1
    style C fill:#0e1530,stroke:#5fd9d1,color:#cbd5e1
    style D fill:#0e1530,stroke:#5fd9d1,color:#cbd5e1
    style E fill:#1a2444,stroke:#7cf09d,color:#cbd5e1
    style F fill:#1a2444,stroke:#fbbf24,color:#cbd5e1
```

```
mnemoscope/
├── packages/
│   ├── core/              # rot scoring, tiering, journal, signature extraction
│   ├── mcp-server/        # MCP server (stdio); 4 tools
│   └── obsidian-plugin/   # Obsidian plugin: rot gauge command + journal viewer
├── research/              # Python: predictive classifier, MarkdownMemBench, Chroma replication
└── docs/                  # banner, logo, design notes
```

## 🤝 Voisins (not competitors)

Mnemoscope is a citizen of an existing ecosystem, not a replacement for any of it.

| Project | What it does | Where Mnemoscope sits |
|---|---|---|
| [Anthropic Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | Official, file-based, primitive | Adds rot-scoring + journal Anthropic doesn't provide |
| [Letta](https://letta.com) / [MemGPT](https://github.com/letta-ai/letta) | Runtime-stateful agents | Different layer — we sit *under* the agent |
| [Mem0](https://mem0.ai), [Zep](https://getzep.com), [Cognee](https://cognee.ai) | Generic memory stores | Different scope — we are MD-vault-native |
| [MemPalace](https://mempalace.tech) | Viral OSS memory MCP | Not Obsidian-specific; complementary |
| [Smart Connections](https://smartconnections.app) | RAG-vector for Obsidian | Co-installable; we are runtime/forensics, they are search |
| [Basic Memory MCP](https://github.com/basicmachines-co/basic-memory) | Semantic graph over markdown | Closest in spirit — we want to interop, not duplicate |
| [claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler) | MD-compiler approach | Reach out before duplicating |

> [!IMPORTANT]
> If you maintain one of these projects and see overlap or complementarity, please [open an issue](https://github.com/toonight/Mnemoscope/issues/new) — collaboration is the explicit design goal.

## 🔬 Scientific posture

Mnemoscope is meant to be a tool **and** a contribution to the public empirical record on agent memory.

| Research thread | Why it matters |
|---|---|
| **MarkdownMemBench** *(planned)* | Today's benchmarks ([LongMemEval](https://arxiv.org/pdf/2410.10813), [LoCoMo](https://snap-research.github.io/locomo/)) are conversational and English-only. There is no public bench for vault-native, MD-native agent memory. |
| **Predictive Context Rot classifier** *(planned)* | Every existing benchmark measures degradation *after* injection. We aim to predict it *before*, calibrated against LongMemEval/LoCoMo with R² ≥ 0.6. |
| **Replication of Chroma's *"structured > shuffled is worse"*** *(planned)* | Chroma showed coherent haystacks underperform shuffled ones on NIAH. Nobody has replicated or refuted this on real Obsidian vaults yet. |

Each thread will live in [`research/`](./research) and produce a preprint alongside the code.

## 🛣️ Roadmap

> [!WARNING]
> This is **early scaffolding**. The current code is the minimum viable shape — folder layout, types, and stubs of each axis. Numbers are aspirational, not guaranteed.

- [x] Monorepo scaffold, Apache-2.0, npm workspaces
- [x] `@mnemoscope/core` v0 — heuristic rot score + tiering + JSONL journal
- [x] `@mnemoscope/mcp-server` v0 — `predict_rot`, `get_tiered_read`, `record_journal`, `read_journal`
- [x] `@mnemoscope/obsidian-plugin` v0 — *Scan vault rot* command
- [x] CI green on Node 22, zero npm vulnerabilities
- [ ] Dogfood on a real vault for 2 weeks; tune heuristics
- [ ] Submit to Smithery / PulseMCP / Glama registries
- [ ] Submit Obsidian plugin to community plugins
- [ ] Replace heuristic rot score with calibrated ONNX classifier
- [ ] Release MarkdownMemBench v0.1
- [ ] Preprint #1: replication of Chroma *Context Rot*

## 🧑‍🤝‍🧑 Contributing

PRs are welcome but the most useful first step is opening an issue describing what you want to do. See [CONTRIBUTING.md](./CONTRIBUTING.md).

If you are a **researcher** at Letta, Chroma, Mem0, Cognee, OSU-NLP, Snap Research, or any related lab, and you see overlap with the *Predictive Context Rot* or *MarkdownMemBench* axes, please reach out — the project is explicitly designed for this.

## 📜 License

[Apache License 2.0](./LICENSE). Apache-2.0 was chosen over MIT for its explicit patent grant, which we believe is appropriate for a project introducing novel scoring methods in an active research area.

## 🙏 Acknowledgements

Mnemoscope's framing borrows directly from public work by:

- [Chroma Research — *Context Rot* (July 2025)](https://www.trychroma.com/research/context-rot)
- [Letta — *Is a Filesystem All You Need?* (August 2025)](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- [Letta — *Sleep-time Compute* (2025)](https://www.letta.com/blog/sleep-time-compute)
- [Microsoft — *LazyGraphRAG* (June 2025)](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- [HippoRAG (NeurIPS'24, OSU-NLP)](https://github.com/osu-nlp-group/hipporag)
- [LongMemEval (ICLR 2025)](https://arxiv.org/pdf/2410.10813)
- [LoCoMo (Snap Research)](https://snap-research.github.io/locomo/)
- [Andrej Karpathy's LLM Wiki proposal (April 2026)](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)

Without their public artifacts, this project would not be possible.

<div align="center">
<sub>🧠  <code>predict · witness · tier</code>  🧠</sub>
</div>
