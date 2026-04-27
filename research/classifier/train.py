"""Train the Mnemoscope predictive context-rot classifier.

Usage:
    uv run python -m classifier.train --data classifier/synthetic.csv --out classifier/model.onnx
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import RidgeCV
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from skl2onnx import to_onnx
import onnxruntime as ort


FEATURES = [
    "token_volume",
    "semantic_redundancy",
    "distractor_density",
    "structural_coherence",
    "freshness_spread",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    df = pd.read_csv(args.data)
    X = df[FEATURES].values.astype(np.float32)
    y = df["observed_loss"].values.astype(np.float32)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=args.seed)

    model = RidgeCV(alphas=[0.1, 1.0, 10.0])
    model.fit(X_tr, y_tr)

    y_hat = model.predict(X_te)
    r2 = r2_score(y_te, y_hat)
    mae = mean_absolute_error(y_te, y_hat)
    print(f"sklearn R²={r2:.4f}  MAE={mae:.4f}  best_alpha={model.alpha_}")

    onnx_model = to_onnx(model, X_tr.astype(np.float32), target_opset=21)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(onnx_model.SerializeToString())
    print(f"wrote {args.out}")

    # Round-trip sanity check.
    sess = ort.InferenceSession(args.out.as_posix(), providers=["CPUExecutionProvider"])
    onnx_pred = sess.run(None, {sess.get_inputs()[0].name: X_te.astype(np.float32)})[0].ravel()
    delta = float(np.max(np.abs(onnx_pred - y_hat)))
    print(f"onnx round-trip max delta vs sklearn: {delta:.6f}")

    metadata = {
        "features": FEATURES,
        "metrics": {"r2": float(r2), "mae": float(mae), "best_alpha": float(model.alpha_)},
        "rows_train": int(len(X_tr)),
        "rows_test": int(len(X_te)),
        "onnx_round_trip_max_delta": delta,
        "data_source": str(args.data),
    }
    metadata_path = args.out.with_suffix(".json")
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"wrote {metadata_path}")


if __name__ == "__main__":
    main()
