# research/replication — Chroma *Context Rot* on real Markdown vaults

> **Status**: protocol scaffolded, not yet executed at scale.

[Chroma's *Context Rot* study](https://www.trychroma.com/research/context-rot) (July 2025) reported a counter-intuitive result on synthetic NIAH: **structured, coherent haystacks underperform shuffled haystacks**. The finding has not been replicated on real, structured corpora — and Markdown vaults are exactly the most structured corpus most LLM agents will see in production.

This sub-project replicates Chroma's experiment on real Obsidian vaults contributed via MarkdownMemBench.

## Protocol

For each vault `V` and target context size `C` ∈ {2K, 5K, 10K, 25K, 50K, 100K, 200K}:

1. Sample a *needle* — a one-line factual claim guaranteed to appear in exactly one note of `V`.
2. Build two haystacks of size ≈ `C`:
   - **structured**: notes selected by Mnemoscope's `get_tiered_read` (working layer first, then episodic, then semantic — coherent narrative order).
   - **shuffled**: the same notes' contents tokenized into paragraphs and shuffled uniformly at random.
3. Run a battery of needle-finding queries against each, on the same model, with deterministic decoding.
4. Record per-(vault, model, context size, structuring) accuracy.

Hypothesis to falsify: *for the same total token volume, shuffled outperforms structured on needle retrieval*.

If the hypothesis holds → it confirms Chroma's finding on real vaults and validates the `structuralCoherence` factor in `predict_rot`.

If the hypothesis fails → we have a publishable refutation; the `structuralCoherence` factor will be reweighted or removed in v1.

## Models

For v0.1 we plan to evaluate exactly the models that ship Anthropic / OpenAI / Google native memory tools (since those are the production targets):

- Claude Opus 4.7 (1M context, the model this repo is being prototyped with)
- Claude Sonnet 4.6
- GPT-5 mini, GPT-5
- Gemini 2.5 Pro

Models are queried via their OpenAI-compatible chat-completions endpoints (Anthropic's compatibility shim included).

## Running

```bash
cd research
uv sync
uv run python -m replication.run --vaults benchmark/datasets/sample/vaults --out replication/results.json
```

The runner is **not yet implemented**; this folder currently contains only the protocol document. Implementation order:

1. `needles.py` — extract needles from a vault.
2. `haystack.py` — build structured / shuffled haystack pairs.
3. `run.py` — driver, parallel by (vault, model, context size).
4. `analyze.ipynb` — produce the figures for the preprint.

Contributions welcome on any of those files. Please open an issue first to claim a piece.
