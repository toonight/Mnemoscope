# research/classifier

The predictive context-rot classifier. Takes a vault signature (5 numeric factors) as input, predicts the expected accuracy loss (0..1) on a downstream LLM task. Trained on labeled (signature, loss) pairs collected by running [`research/replication`](../replication) and the MarkdownMemBench harness against various vaults; exported to ONNX for use from the TypeScript side.

## Status

🟡 **Synthetic baseline, multi-family compared, ONNX shipped**.
Pipeline trains and round-trips end-to-end on a 1 000-row principled synthetic set drawn from the same heuristic the runtime currently uses (mean of the 5 factors + Gaussian noise). Three model families are compared on a held-out split; the winner is exported. The classifier therefore behaves as a *smooth interpolant of the v0 heuristic*, ready to be replaced with real measurements without behavioural surprises.

To turn this 🟡 into 🟢 we need one thing: **real `(signature, observed_loss)` pairs**, collected from running [`research/replication/`](../replication) (or the [MarkdownMemBench harness](../benchmark/)) against real LLM endpoints on real Markdown vaults. The schema is identical to `synthetic-large.csv` — drop a `measurements.csv` next to it, retrain, ship.

## Pipeline

```
synthetic-large.csv ──┐
                      ├──►  train.py  ──►  model.onnx  ──►  loaded by core (planned)
measurements.csv  ────┘        │
                               └──►  reported metrics (R², MAE) per family
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

## Current numbers (1 000-row synthetic baseline)

```
ridge     R²=0.8515  MAE=0.0423  best_alpha=10.0   ← selected
rf        R²=0.7688  MAE=0.0518
gbr       R²=0.8042  MAE=0.0485
```

Ridge wins because the synthetic label is a noisy linear combination of the 5 factors, which is exactly the shape Ridge fits best. With real measurements we expect non-linearity and interactions to favour `rf` or `gbr`; the comparison is wired and ready.

## Why this set of families

- **Ridge** — closed-form linear baseline; reference point everything else has to beat. Cheap to fit, trivial to explain.
- **Random Forest** — captures feature interactions, robust to outliers, no scaling needed. Small forest (64 trees, depth 6) keeps the ONNX file tiny.
- **Gradient Boosting** — usually the best tabular regressor at our row count; the slow learning rate (0.05) over 200 estimators trades training time for generalisation.

A planned v0.3 will add monotonic boosting (LightGBM + monotone constraints) so the directional priors — `tokenVolume` ↑ ⇒ loss ↑, `freshnessSpread` ↑ ⇒ loss ↑ — are enforced rather than learned.

## Inputs

The 5 features are produced by [`@mnemoscope/core`](../../packages/core/src/rot-score.ts) — see the doc on each `*Factor()` function for citations.
