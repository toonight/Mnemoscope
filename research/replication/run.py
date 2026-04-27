"""Driver for the Chroma 'structured > shuffled is worse' replication.

For each (vault, model, context_size, structuring) cell, ask the model
to recall the needle from its haystack and grade the answer. Write a
JSON report. Designed to be runnable offline (no API key) — when no
key is set, an offline grader that does substring matching on the
haystack itself is used, which gives a sanity check that the haystack
contains the needle (the key precondition of the experiment).

Usage:
    uv run python -m replication.run \
        --vaults benchmark/datasets/sample/vaults \
        --sizes 2000,5000,10000 \
        --out replication/results.json
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from .haystack import build_pair
from .needles import Needle, extract_needles


@dataclass
class Cell:
    vault: str
    model: str
    target_tokens: int
    structuring: str
    needle_md5: str
    correct: bool
    elapsed_ms: int
    notes: str | None = None


def grade_offline(haystack: str, needle: Needle) -> bool:
    """Sanity check: does the haystack literally contain the needle?
    This is what we expect of any honest haystack builder; if it fails,
    the experiment is broken before any model is consulted.
    """
    return needle.answer() in haystack


def grade_with_llm(haystack: str, needle: Needle, model: str) -> tuple[bool, str]:
    api_key = os.environ.get("MMB_LLM_API_KEY")
    endpoint = os.environ.get("MMB_LLM_ENDPOINT", "https://api.openai.com/v1")
    if not api_key:
        return False, "no MMB_LLM_API_KEY; offline path used"
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "Answer in one short sentence using only the supplied document."},
            {"role": "user", "content": f"DOCUMENT:\n{haystack}\n\nQUESTION: {needle.question()}\n\nANSWER:"},
        ],
        "temperature": 0.0,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{endpoint}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    answer = out["choices"][0]["message"]["content"].strip().lower()
    expected = needle.answer().lower()
    correct = expected[:60].split(".")[0].strip() in answer
    return correct, answer


def run_cell(*, vault_root: Path, model: str, target_tokens: int, structuring: str, needle: Needle, offline: bool) -> Cell:
    pair = build_pair(vault_root, needle, target_tokens=target_tokens)
    haystack = pair.structured if structuring == "structured" else pair.shuffled
    started = time.monotonic()
    if offline:
        correct = grade_offline(haystack, needle)
        notes = "offline grading (substring containment)"
    else:
        correct, notes = grade_with_llm(haystack, needle, model)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    return Cell(
        vault=str(vault_root.name),
        model=model,
        target_tokens=target_tokens,
        structuring=structuring,
        needle_md5=needle.source_md5,
        correct=correct,
        elapsed_ms=elapsed_ms,
        notes=notes,
    )


def aggregate(cells: list[Cell]) -> dict:
    """Compute the headline numbers: per-(model, size) accuracy by structuring,
    and the structured-minus-shuffled delta. Positive delta means structure helps;
    negative delta replicates Chroma's finding."""
    by_key: dict[tuple[str, int], dict[str, list[bool]]] = {}
    for c in cells:
        key = (c.model, c.target_tokens)
        by_key.setdefault(key, {"structured": [], "shuffled": []})[c.structuring].append(c.correct)

    rows = []
    for (model, size), buckets in sorted(by_key.items()):
        s_acc = _acc(buckets["structured"])
        h_acc = _acc(buckets["shuffled"])
        delta = (s_acc - h_acc) if (s_acc is not None and h_acc is not None) else None
        rows.append({
            "model": model,
            "target_tokens": size,
            "structured_accuracy": s_acc,
            "shuffled_accuracy": h_acc,
            "delta_structured_minus_shuffled": delta,
            "n_structured": len(buckets["structured"]),
            "n_shuffled": len(buckets["shuffled"]),
        })
    deltas = [r["delta_structured_minus_shuffled"] for r in rows if r["delta_structured_minus_shuffled"] is not None]
    summary = {
        "rows": rows,
        "mean_delta": statistics.fmean(deltas) if deltas else None,
        "median_delta": statistics.median(deltas) if deltas else None,
        "n_rows": len(rows),
        "interpretation": _interpret(deltas),
    }
    return summary


def _acc(votes: list[bool]) -> float | None:
    return None if not votes else sum(votes) / len(votes)


def _interpret(deltas: list[float]) -> str:
    if not deltas:
        return "no data"
    pos = sum(1 for d in deltas if d > 0.0)
    neg = sum(1 for d in deltas if d < 0.0)
    if pos > neg * 2:
        return "structure HELPS — refutes Chroma 2025 on this corpus"
    if neg > pos * 2:
        return "structure HURTS — replicates Chroma 2025 on this corpus"
    return "ambiguous / underpowered — need more cells"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vaults", required=True, type=Path, help="Directory containing one or more vault subdirectories.")
    parser.add_argument("--sizes", default="2000,5000,10000", help="Comma-separated target token sizes.")
    parser.add_argument("--models", default="gpt-4o-mini", help="Comma-separated model names.")
    parser.add_argument("--needles-per-vault", type=int, default=4)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--offline", action="store_true", help="Force offline grading even if MMB_LLM_API_KEY is set.")
    args = parser.parse_args()

    sizes = [int(s.strip()) for s in args.sizes.split(",") if s.strip()]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    offline = args.offline or not os.environ.get("MMB_LLM_API_KEY")

    cells: list[Cell] = []
    vault_roots = [p for p in args.vaults.iterdir() if p.is_dir()]
    if not vault_roots:
        # Single-vault mode (the path itself is a vault).
        vault_roots = [args.vaults]

    for vault_root in vault_roots:
        needles = extract_needles(vault_root, limit=args.needles_per_vault)
        if not needles:
            print(f"  {vault_root.name}: no needles extractable, skipping")
            continue
        print(f"  {vault_root.name}: {len(needles)} needle(s)")
        for model in models:
            for size in sizes:
                for needle in needles:
                    for structuring in ("structured", "shuffled"):
                        c = run_cell(
                            vault_root=vault_root,
                            model=model,
                            target_tokens=size,
                            structuring=structuring,
                            needle=needle,
                            offline=offline,
                        )
                        cells.append(c)

    report = {
        "config": {
            "sizes": sizes, "models": models, "offline": offline,
            "needles_per_vault": args.needles_per_vault,
            "vaults": [str(p.name) for p in vault_roots],
        },
        "cells": [asdict(c) for c in cells],
        "summary": aggregate(cells),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwrote {args.out}")
    print(f"  cells: {len(cells)}")
    print(f"  mean delta (structured - shuffled): {report['summary']['mean_delta']}")
    print(f"  interpretation: {report['summary']['interpretation']}")


if __name__ == "__main__":
    main()
