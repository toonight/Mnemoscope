"""Train and evaluate the Mnemoscope predictive context-rot classifier.

Trains a small set of model families on a (signature, observed_loss)
table, compares them on a held-out split, and exports the best one to
ONNX. Always emits a metadata JSON next to the ONNX file so the
training run is auditable.

Usage:
    # baseline 30-row synthetic set, Ridge only (legacy invocation)
    uv run python -m classifier.train --data classifier/synthetic.csv --out classifier/model.onnx

    # principled 1000-row synthetic set, all families
    uv run python -m classifier.train \\
        --data classifier/synthetic-large.csv \\
        --out classifier/model.onnx \\
        --models ridge rf gbr
"""
from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd
from skl2onnx import to_onnx
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import RidgeCV
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

FEATURES = [
    "token_volume",
    "semantic_redundancy",
    "distractor_density",
    "structural_coherence",
    "freshness_spread",
]

ModelFactory = Callable[[int], object]

MODEL_FAMILIES: dict[str, ModelFactory] = {
    # Linear baseline. Cheap, monotonic by construction in any single feature,
    # closed-form. Reference point everything else has to beat.
    "ridge": lambda seed: RidgeCV(alphas=[0.1, 1.0, 10.0]),
    # Non-linear, captures interactions; small forest keeps the ONNX tiny.
    "rf": lambda seed: RandomForestRegressor(
        n_estimators=64, max_depth=6, random_state=seed, n_jobs=-1
    ),
    # Gradient boosting; usually wins on tabular regression with this many rows.
    "gbr": lambda seed: GradientBoostingRegressor(
        n_estimators=200, max_depth=3, learning_rate=0.05, random_state=seed
    ),
}


def evaluate(model, X_te: np.ndarray, y_te: np.ndarray) -> dict[str, float]:
    y_hat = model.predict(X_te)
    return {
        "r2": float(r2_score(y_te, y_hat)),
        "mae": float(mean_absolute_error(y_te, y_hat)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--models",
        nargs="+",
        choices=list(MODEL_FAMILIES.keys()),
        default=["ridge"],
        help="Model families to train and compare. The best (by R²) is exported to ONNX.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Fraction of the dataset used as held-out test set.",
    )
    parser.add_argument(
        "--collection-meta",
        type=Path,
        default=None,
        help=(
            "Optional path to the *-meta.json file emitted by collect_measurements.py. "
            "Its contents are embedded under model.json#dataset_collection so the "
            "data-collection cost (wall-clock, total LLM tokens, hardware notes) "
            "is recorded alongside the trained model."
        ),
    )
    args = parser.parse_args()

    df = pd.read_csv(args.data)
    X = df[FEATURES].values.astype(np.float32)
    y = df["observed_loss"].values.astype(np.float32)
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=args.test_size, random_state=args.seed
    )

    results: dict[str, dict[str, float]] = {}
    fitted: dict[str, object] = {}

    for name in args.models:
        model = MODEL_FAMILIES[name](args.seed)
        model.fit(X_tr, y_tr)
        metrics = evaluate(model, X_te, y_te)
        results[name] = metrics
        fitted[name] = model
        extra = ""
        if hasattr(model, "alpha_"):
            extra = f"  best_alpha={model.alpha_}"
        print(f"{name:8s}  R²={metrics['r2']:.4f}  MAE={metrics['mae']:.4f}{extra}")

    # Pick the family with the highest R² on the held-out split.
    winner_name = max(results, key=lambda k: results[k]["r2"])
    winner = fitted[winner_name]
    print(f"\nselected: {winner_name}  R²={results[winner_name]['r2']:.4f}")

    onnx_model = to_onnx(winner, X_tr.astype(np.float32), target_opset=21)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(onnx_model.SerializeToString())
    print(f"wrote {args.out}")

    # Round-trip sanity check: sklearn predictions must match ONNX runtime's.
    sess = ort.InferenceSession(args.out.as_posix(), providers=["CPUExecutionProvider"])
    onnx_pred = sess.run(None, {sess.get_inputs()[0].name: X_te.astype(np.float32)})[0].ravel()
    sklearn_pred = winner.predict(X_te)
    delta = float(np.max(np.abs(onnx_pred - sklearn_pred)))
    print(f"onnx round-trip max delta vs sklearn: {delta:.6f}")

    grader_models = sorted(df["model"].unique().tolist()) if "model" in df.columns else []
    offline_rows = int((df["offline"] == 1).sum()) if "offline" in df.columns else 0
    metadata: dict[str, object] = {
        "features": FEATURES,
        "selected_model": winner_name,
        "metrics_per_family": results,
        "rows_train": int(len(X_tr)),
        "rows_test": int(len(X_te)),
        "onnx_round_trip_max_delta": delta,
        "data_source": str(args.data),
        "seed": args.seed,
        "grader_models": grader_models,
        "offline_rows": offline_rows,
    }

    # Cost transparency: when the collector produced a sibling *-meta.json
    # describing the data-collection wall-clock + total LLM tokens, embed it
    # under dataset_collection so reviewers can trace the full audit chain
    # (raw cells -> measurements.csv -> trained model.onnx).
    meta_path: Path | None = args.collection_meta
    if meta_path is None:
        # Auto-discovery: look for <data>-meta.json next to the CSV.
        candidate = args.data.with_name(args.data.stem + "-meta.json")
        if candidate.exists():
            meta_path = candidate
    if meta_path is not None and meta_path.exists():
        try:
            metadata["dataset_collection"] = json.loads(meta_path.read_text(encoding="utf-8"))
            print(f"embedded dataset_collection metadata from {meta_path}")
        except (json.JSONDecodeError, OSError) as e:
            print(f"warning: could not load --collection-meta {meta_path}: {e!r}")

    metadata_path = args.out.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"wrote {metadata_path}")


if __name__ == "__main__":
    main()
