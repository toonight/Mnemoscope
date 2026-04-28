"""Generate a principled synthetic training set for the predictive context-rot classifier.

The handcrafted ``synthetic.csv`` (30 rows) was good enough to verify the
``train.py`` -> ``ONNX`` -> round-trip path mechanically, but 30 rows on a
5-dimensional feature space is statistically unjustifiable for any model
choice or comparison.

This script samples the feature space uniformly and labels each draw with
the **same heuristic** the runtime currently uses (mean of the 5 factors,
each normalised to 0..100), plus controlled Gaussian noise. The resulting
dataset is *still synthetic* — it cannot replace measurements against
LongMemEval / LoCoMo / MarkdownMemBench — but it gives us:

1. A defensible baseline: the classifier learns to *interpolate the
   heuristic smoothly* across the whole input space, so we can swap it in
   for the heuristic at runtime without behavioural surprises.
2. Enough rows to make multi-family model comparison meaningful (Ridge vs.
   Random Forest vs. Gradient Boosting), with documented R² / MAE.
3. A clean replacement target: drop a ``measurements.csv`` with the same
   schema next to ``synthetic.csv``, retrain, and the model ships against
   real data.

Usage:
    uv run python -m classifier.generate_synthetic \\
        --out classifier/synthetic-large.csv \\
        --rows 1000 --seed 42 --noise 0.05
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

FEATURES = [
    "token_volume",
    "semantic_redundancy",
    "distractor_density",
    "structural_coherence",
    "freshness_spread",
]


def heuristic_loss(features: np.ndarray) -> np.ndarray:
    """Mirror @mnemoscope/core's v0 rot score: mean of the 5 factors, normalised to 0..1.

    This is *intentionally* the same calculation as ``computeRotScore`` in
    ``packages/core/src/rot-score.ts``. Any model trained against this
    label is, at best, a smooth interpolant of the heuristic — not an
    independent measurement. The point is to ship a faithful surrogate
    while waiting for real measurements to displace it.
    """
    return features.mean(axis=1) / 100.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--noise",
        type=float,
        default=0.05,
        help="Std-dev of Gaussian noise added to the heuristic label, on the 0..1 loss scale.",
    )
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    features = rng.uniform(low=0.0, high=100.0, size=(args.rows, len(FEATURES)))

    base = heuristic_loss(features)
    noise = rng.normal(loc=0.0, scale=args.noise, size=base.shape)
    label = np.clip(base + noise, 0.0, 1.0)

    df = pd.DataFrame(features, columns=FEATURES)
    df["observed_loss"] = label

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False, float_format="%.4f")
    print(
        f"wrote {args.out}  rows={len(df)}  "
        f"label_mean={label.mean():.3f}  label_std={label.std():.3f}  "
        f"noise_std={args.noise}"
    )


if __name__ == "__main__":
    main()
