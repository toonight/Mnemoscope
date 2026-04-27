# research/

Three Python sub-projects, all managed by [uv](https://docs.astral.sh/uv/) and tied together by [`pyproject.toml`](./pyproject.toml).

| Folder | What it does |
|---|---|
| [`benchmark/`](./benchmark) | **MarkdownMemBench v0.1** — schema, sample dataset, reference harness with two SUTs (`naive` and `mnemoscope`). |
| [`classifier/`](./classifier) | Trains the predictive context-rot classifier and exports it to ONNX. v0.1 ships with a synthetic dataset so the pipeline is mechanically verified end-to-end. |
| [`replication/`](./replication) | Replicates Chroma's *Context Rot* "structured > shuffled is worse" finding on real Markdown vaults. Protocol-scaffolded, runner not yet implemented. |

## Quick start

```bash
cd research
uv sync

# 1. train the classifier on synthetic data
uv run python -m classifier.train --data classifier/synthetic.csv --out classifier/model.onnx

# 2. run MarkdownMemBench with the bundled sample dataset
uv run python -m benchmark.harness.run \
    --dataset benchmark/datasets/sample \
    --system mnemoscope \
    --output benchmark-results.json
```

## What is *not* in this folder

Everything user-facing lives in [`packages/`](../packages). The `research/` tree is the slow lane: experiments, papers, calibration. End users never need to install Python or `uv`.

## Contributing

If you are a researcher at Letta, Chroma, Mem0, Cognee, OSU-NLP, Snap Research or any related lab and you see overlap with the predictive classifier, MarkdownMemBench, or the Chroma replication — please [open an issue](https://github.com/toonight/Mnemoscope/issues/new). The project is explicitly designed for this kind of collaboration.
