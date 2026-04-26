# research/

Python sub-project for the scientific contributions:

1. **classifier/** — train the predictive context-rot classifier on LongMemEval / LoCoMo / MarkdownMemBench, export to ONNX, ship as part of `@mnemoscope/core`.
2. **benchmark/** — assemble and release **MarkdownMemBench**, an opt-in dataset of anonymized Obsidian vaults with recall, multi-hop, and write-task questions. First MD-native, vault-native bench for agent memory.
3. **replication/** — replicate or refute Chroma's *"structured haystacks underperform shuffled haystacks"* result (Context Rot, July 2025) on real vaults.

This sub-project is **not** required for end users — trained models are shipped as ONNX files inside `@mnemoscope/core` and loaded by `onnxruntime-node`. The Python tooling here is only for researchers training/benchmarking new versions.

## Layout (planned)

```
research/
├── classifier/          # rot-risk classifier training pipeline
├── benchmark/           # MarkdownMemBench dataset + harness
├── replication/         # Chroma "structured > shuffled" replication
├── pyproject.toml       # uv-managed
└── README.md
```

## Setup (planned)

```bash
cd research
uv sync
uv run python classifier/train.py
```

Empty for now. PRs welcome from researchers interested in collaborating on any of the three axes.
