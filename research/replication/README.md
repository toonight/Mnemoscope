# research/replication — Chroma *Context Rot* on real Markdown vaults

> **Status — runner shipping (offline + online)**, real-corpus runs pending opt-in vault contributions.

[Chroma's *Context Rot* study](https://www.trychroma.com/research/context-rot) (July 2025) reported a counter-intuitive result on synthetic NIAH: **structured, coherent haystacks underperform shuffled haystacks**. The finding has not been replicated on real, structured corpora — and Markdown vaults are exactly the most structured corpus most LLM agents will see in production.

This sub-project replicates Chroma's experiment on real Obsidian vaults contributed via MarkdownMemBench.

## What ships in v0.1

| File | Role |
|---|---|
| [`needles.py`](./needles.py) | Rule-based needle extractor — picks fact-bearing sentences that occur exactly once in the vault. CLI: `python -m replication.needles --vault <path>`. |
| [`haystack.py`](./haystack.py) | Builds paired structured / shuffled haystacks at a target token budget; the shuffled side keeps the same paragraphs but permuted with a fixed seed. The needle is redacted from the natural padding and re-inserted at a controlled position (`--position start|middle|end`) so the structuring effect can be measured at a fixed offset. CLI: `python -m replication.haystack --vault <path> --target-tokens N --position middle`. |
| [`run.py`](./run.py) | Driver: loops over (vault × model × size × structuring × position), grades each cell, writes a JSON report. Offline mode (substring grading) for sanity checks; live mode talks to any OpenAI-compatible endpoint via `MMB_LLM_API_KEY`. |
| [`analyze.py`](./analyze.py) | Renders a Markdown report with two tables: per-(model, size, position) for the structuring effect, and per-(model, size, structuring) for the position effect (lost-in-the-middle). |

## Protocol

For each vault `V`, target context size `C` ∈ {2K, 5K, 10K, 25K, 50K, 100K, 200K}, and needle position `P` ∈ {start, middle, end}:

1. Sample a *needle* — a one-line factual claim that appears exactly once in `V`. Redact every natural occurrence of the needle from the corpus.
2. Build two haystacks of size ≈ `C`, both with the needle re-inserted at position `P`:
   - **structured**: notes concatenated in tier order with their headings, in a coherent narrative.
   - **shuffled**: the same source split into paragraphs and shuffled with a fixed seed.
3. Ask the model under test to recall the needle from each haystack, with deterministic decoding.
4. Record per-(vault, model, context size, structuring, position) accuracy.

Hypothesis to falsify: *for the same total token volume, shuffled outperforms structured on needle retrieval*.

If the hypothesis holds → it confirms Chroma's finding on real vaults and validates the `structuralCoherence` factor in `predict_rot`.

If the hypothesis fails → we have a publishable refutation; the `structuralCoherence` factor will be reweighted or removed in v1.

The position sweep separately tests Liu et al. 2023's *Lost in the Middle*: at fixed structuring, do `start` and `end` outperform `middle`? The two effects (structuring and position) are now reported in separate tables in `REPORT-*.md`.

## Running

```bash
cd research
uv sync

# Offline sanity check on the bundled sample dataset (no API key needed)
uv run python -m replication.run \
  --vaults benchmark/datasets/sample/vaults \
  --sizes 2000,5000,10000 \
  --positions start,middle,end \
  --models gpt-4o-mini \
  --needles-per-vault 4 \
  --out replication/results-sample.json \
  --offline

uv run python -m replication.analyze \
  --in replication/results-sample.json \
  --out replication/REPORT-sample.md
```

The offline mode grades each cell by checking that the haystack literally contains the needle. With a correct haystack builder this is always true (∆ = 0), which is exactly the sanity check we want before any model is consulted: it catches builder regressions, not science.

## Live (real LLM) runs

Set `MMB_LLM_API_KEY` (and optionally `MMB_LLM_ENDPOINT` and `MMB_LLM_MODEL`) and drop `--offline`:

```bash
export MMB_LLM_API_KEY=sk-…
uv run python -m replication.run \
  --vaults <path-to-real-vaults> \
  --sizes 2000,5000,10000,25000,50000,100000 \
  --positions start,middle,end \
  --models gpt-4o-mini,gpt-5,claude-sonnet-4-6,claude-opus-4-7 \
  --needles-per-vault 8 \
  --out replication/results-live.json
```

Anthropic, Google, and OpenAI all expose chat-completions-compatible endpoints; point `MMB_LLM_ENDPOINT` at the appropriate base URL.

## Models targeted for the v1 paper

For v1 we plan to evaluate exactly the models that ship Anthropic / OpenAI / Google native memory tools (since those are the production targets):

- Claude Opus 4.7 (1M context)
- Claude Sonnet 4.6
- GPT-5 mini, GPT-5
- Gemini 2.5 Pro

## Open work

- Calibrate the rule-based needle extractor against a labelled set, or replace it with an LLM extractor.
- Add bootstrap confidence intervals to the per-cell accuracies.
- Real-vault runs pending opt-in contributions through MarkdownMemBench.

Contributions welcome on any of those fronts. Please open an issue first to claim a piece.
