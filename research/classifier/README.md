# research/classifier

The predictive context-rot classifier. Takes a vault signature (5 numeric factors) as input, predicts the expected accuracy loss (0..1) on a downstream LLM task. Trained on labeled (signature, loss) pairs collected by running [`research/replication`](../replication) and the MarkdownMemBench harness against various vaults; exported to ONNX for use from the TypeScript side.

## Status

🟢 **Real measurements shipped (Gemma 4 26B, 50 vaults, no offline rows)**.
The classifier is now trained on `measurements.csv` — 50 procedurally-varied vault signatures graded by Gemma 4 26B (Q4_K_M) running locally via Ollama with `num_ctx=40000`. Each vault was probed at 16K and 32K target context with structured/shuffled haystacks at the middle position; `observed_loss` is `1 - accuracy` over 8 cells per vault. Three model families are compared on a held-out 20 % split; the winner is exported to ONNX with full round-trip verification. See [`model.json`](./model.json) for the audit trail.

The 1 000-row synthetic baseline (`synthetic-large.csv`) is kept committed for reproducibility and as a behavioural reference — it is no longer the training source.

## Pipeline

```
measurements.csv  ──►  train.py  ──►  model.onnx  ──►  loaded by core (planned)
                          │
                          └──►  reported metrics (R², MAE) per family + grader_models
```

## Run

```bash
cd research
uv sync

# 1. (re)generate the principled synthetic baseline (1 000 rows by default)
uv run python -m classifier.generate_synthetic --out classifier/synthetic-large.csv

# 2. train all three families and export the best
uv run python -m classifier.train \
    --data classifier/synthetic-large.csv \
    --out classifier/model.onnx \
    --models ridge rf gbr
```

`train.py`:
1. Loads `(token_volume, semantic_redundancy, distractor_density, structural_coherence, freshness_spread, observed_loss)` rows.
2. Fits each requested family (`ridge`, `rf`, `gbr`).
3. Reports R² and MAE on a held-out 20 % split for every family.
4. Selects the highest-R² model.
5. Exports it to ONNX via [skl2onnx](https://onnx.ai/sklearn-onnx/).
6. Verifies the ONNX file loads and predicts identically to the sklearn model (`max_delta < 1e-6`).

A metadata JSON (`classifier/model.json`) records the per-family metrics, the winning family, the dataset source and the ONNX round-trip delta — every published model is auditable.

## Current numbers (50-row real Gemma 4 26B measurements)

```
ridge     R²=0.1440  MAE=0.2306  best_alpha=10.0
rf        R²=0.5827  MAE=0.1386                   ← selected
gbr       R²=0.1139  MAE=0.1818
```

Random Forest wins on real data, as predicted: the 5-factor → loss surface has interactions and non-linearities that a linear model cannot capture (Ridge's R² collapses from 0.85 on the synthetic baseline to 0.14 here). RF holds 0.58 R² on a held-out 10-row split, which is meaningful given the strongly bimodal label distribution (Gemma either nails the needle or misses it entirely). Reference correlations across all 50 rows: `semantic_redundancy` r=+0.56, `token_volume` r=+0.43, `structural_coherence` r=+0.30 (Chroma's structuring effect, on a real model), `distractor_density` r=+0.21, `freshness_spread` r=−0.17 (carries no signal — the grader has no notion of mtime, expected).

GBR's collapse (0.80 → 0.11) is a hyperparameter mismatch, not a fundamental issue: at 50 rows, 200 boosted trees overfit. Tuning is on the v0.3 list.

## Why this set of families

- **Ridge** — closed-form linear baseline; reference point everything else has to beat. Cheap to fit, trivial to explain.
- **Random Forest** — captures feature interactions, robust to outliers, no scaling needed. Small forest (64 trees, depth 6) keeps the ONNX file tiny.
- **Gradient Boosting** — usually the best tabular regressor at our row count; the slow learning rate (0.05) over 200 estimators trades training time for generalisation.

A planned v0.3 will add monotonic boosting (LightGBM + monotone constraints) so the directional priors — `tokenVolume` ↑ ⇒ loss ↑, `freshnessSpread` ↑ ⇒ loss ↑ — are enforced rather than learned.

## Inputs

The 5 features are produced by [`@mnemoscope/core`](../../packages/core/src/rot-score.ts) — see the doc on each `*Factor()` function for citations.
