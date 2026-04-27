# MarkdownMemBench

> **Status — v0.1 specification**: this folder contains the public schema, a fully worked-out sample dataset, and a reference harness. The full v1 dataset (50–200 anonymized real Obsidian vaults, 1000+ tasks) is not yet released — it requires opt-in contributions from the community. See [Contributing a vault](#contributing-a-vault).

MarkdownMemBench is the first vault-native, Markdown-native benchmark for LLM agent memory. It exists because the two reference benchmarks of 2025 — [LongMemEval](https://arxiv.org/pdf/2410.10813) (ICLR'25) and [LoCoMo](https://snap-research.github.io/locomo/) (Snap Research) — are both **conversational** and **English-only**. There is no public benchmark that asks: *"given an Obsidian/Logseq/dotfiles vault, can a memory-equipped agent answer questions whose answers live across multiple files, possibly in multiple languages, possibly with stale-vs-fresh tension?"*

## Schema

A MarkdownMemBench dataset is a directory:

```
mmb-<dataset-id>/
├── meta.json                 # dataset metadata (see schema below)
├── vaults/
│   ├── <vault-id>/           # an Obsidian-like vault, MD files only
│   └── …
└── tasks.jsonl               # one task per line, JSON
```

### `meta.json`

```json
{
  "name": "mmb-sample",
  "version": "0.1.0",
  "license": "CC-BY-4.0",
  "languages": ["en"],
  "vault_count": 1,
  "task_count": 5,
  "notes": "Hand-crafted demonstration dataset. Replace with real opt-in contributions for v1."
}
```

### `tasks.jsonl`

Each line is a JSON object matching [`schema.json`](./schema.json):

```json
{
  "id": "mmb-sample-recall-001",
  "vault_id": "fiction-novel",
  "type": "recall",
  "question": "What is Maria's profession before chapter 3?",
  "expected_answer": "freelance translator",
  "evidence_paths": ["chapters/01.md"],
  "difficulty": "easy",
  "languages": ["en"]
}
```

Supported `type` values for v0.1:

| type | meaning |
|---|---|
| `recall` | The answer lives entirely in one file. Tests basic retrieval. |
| `multi_hop` | The answer requires combining facts from ≥ 2 files. Tests cross-document reasoning. |
| `cross_doc_negation` | One file states X; another file later contradicts X. The expected answer is the latest correct value. Tests freshness handling. |
| `aggregation` | The answer is a count/sum/list aggregated across files matching a pattern. Tests structural retrieval. |
| `write_task` | The agent must propose a write to the vault that satisfies a constraint expressed in the question; verified by a deterministic check function. |

## Reference harness

The harness is a Python script that takes:

1. A **dataset directory** (the schema above).
2. A **system under test** matching the [`SystemUnderTest`](./harness/sut.py) protocol — given a vault path and a question, return an answer.

It returns per-task accuracy, per-type accuracy, and overall accuracy.

```bash
cd research/benchmark
uv sync
uv run python -m harness.run \
    --dataset datasets/sample \
    --system mnemoscope \
    --output results.json
```

Two reference systems are bundled for grading:

- `mnemoscope` — uses `predict_rot` + `get_tiered_read` to compact the context, then queries an LLM (any provider). Demonstrates the intended use.
- `naive` — concatenates the entire vault and asks the LLM. Establishes the long-context baseline.

## Sample dataset

[`datasets/sample/`](./datasets/sample) is hand-crafted to demonstrate the schema. It contains a single tiny vault (a fictional novel outline, EN) and 5 tasks across 3 types. **It is not a benchmark of model quality** — it exists so contributors can run the harness end-to-end without external data.

## Contributing a vault

The path to v1 is **opt-in real-world data**. If you maintain an Obsidian or Logseq vault and would be willing to contribute a (possibly partially-redacted) snapshot under a permissive license, please file an issue. We need:

- 50+ MB of MD files, with realistic structure (links, frontmatter, hierarchies).
- A short list of questions you can already answer about the vault — these become tasks.
- Express consent that the snapshot can be redistributed under CC-BY-4.0.

We will assist with anonymization (PII scrubbing, name replacement) before any redistribution.

## Why this matters

A predictive context-rot model has to be calibrated against *something*. Today, that something does not exist for vault-native, MD-native agent memory. MarkdownMemBench's first job is to be that thing — the public, redistributable measurement substrate against which every claim about Markdown-vault memory (Mnemoscope's predict_rot included) can be falsified.

## See also

- [LongMemEval](https://github.com/xiaowu0162/LongMemEval) — conversational, ICLR'25, the closest neighbor.
- [LoCoMo](https://snap-research.github.io/locomo/) — conversational, Snap Research.
- [BABILong](https://github.com/booydar/babilong) — synthetic long-context, EMNLP'24.
- [NIAH original](https://github.com/gkamradt/LLMTest_NeedleInAHaystack) — the original needle-in-a-haystack.
