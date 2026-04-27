# research/classifier

The predictive context-rot classifier. Takes a vault signature (5 numeric factors) as input, predicts the expected accuracy loss (0..1) on a downstream LLM task. Trained on labeled (signature, loss) pairs collected by running [`research/replication`](../replication) and the MarkdownMemBench harness against various vaults; exported to ONNX for use from the TypeScript side.

## Status

Pipeline scaffolded with **synthetic training data** so the train → export → load path is mechanically verified end-to-end. Replace `synthetic.csv` with real labelled measurements before publishing.

## Pipeline

```
real measurements ──┐
                    ├──►  train.py  ──►  model.onnx  ──►  loaded by core (planned)
synthetic baseline ─┘                       │
                                            └──►  reported metrics (R², MAE)
```

## Run

```bash
cd research
uv sync
uv run python -m classifier.train --data classifier/synthetic.csv --out classifier/model.onnx
```

The script:
1. Loads `(token_volume, semantic_redundancy, distractor_density, structural_coherence, freshness_spread, observed_loss)` rows.
2. Fits a Ridge linear regression (with cross-validation).
3. Reports R² and MAE on a held-out 20 % split.
4. Exports the fitted model to ONNX via [skl2onnx](https://onnx.ai/sklearn-onnx/).
5. Verifies the ONNX file loads and predicts identically to the sklearn model.

## Why Ridge first

The v0 baseline is intentionally simple. Once the labelled set is large enough to support it, we will compare against:

- a small MLP (2 hidden layers, 16 + 8 units),
- gradient boosting (XGBoost / LightGBM),
- monotonic boosting where the directional priors (token_volume monotonically up, freshness_spread monotonically up) are enforced.

Whichever wins on out-of-sample R² + monotonicity gets published.

## Inputs

The 5 features are produced by [`@mnemoscope/core`](../../packages/core/src/rot-score.ts) — see the doc on each `*Factor()` function for citations.
