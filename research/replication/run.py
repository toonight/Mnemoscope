"""Driver for the Chroma 'structured > shuffled is worse' replication,
augmented with a Liu-et-al-style position-of-needle sweep.

For each (vault, model, context_size, structuring, position) cell, ask
the model to recall the needle from its haystack and grade the answer.
Write a JSON report. Designed to be runnable offline (no API key) —
when no key is set, an offline grader that does substring matching on
the haystack itself is used, which gives a sanity check that the
haystack contains the needle (the key precondition of the experiment).

The position sweep injects the needle at `start`, `middle`, or `end`
of the haystack at a controlled offset, with the needle redacted from
the natural padding, so that a structured-vs-shuffled delta at a
*fixed* position can be compared to the lost-in-the-middle delta at a
fixed structuring.

Usage:
    uv run python -m replication.run \\
        --vaults benchmark/datasets/sample/vaults \\
        --sizes 2000,5000,10000 \\
        --positions start,middle,end \\
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
    position: str
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


def run_cell(
    *,
    vault_root: Path,
    model: str,
    target_tokens: int,
    structuring: str,
    position: str,
    needle: Needle,
    offline: bool,
) -> Cell:
    pair = build_pair(vault_root, needle, target_tokens=target_tokens, position=position)
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
        position=position,
        needle_md5=needle.source_md5,
        correct=correct,
        elapsed_ms=elapsed_ms,
        notes=notes,
    )


def aggregate(cells: list[Cell]) -> dict:
    """Compute the headline numbers:
    - per-(model, size, position) accuracy by structuring + structured-shuffled delta
    - per-(model, size, structuring) accuracy by position + position-effect deltas
      (start - middle, end - middle), so 'lost in the middle' shows as positive
      values on the structured row.
    """
    by_struct: dict[tuple[str, int, str], dict[str, list[bool]]] = {}
    by_position: dict[tuple[str, int, str], dict[str, list[bool]]] = {}
    for c in cells:
        struct_key = (c.model, c.target_tokens, c.position)
        by_struct.setdefault(struct_key, {"structured": [], "shuffled": []})[c.structuring].append(c.correct)
        pos_key = (c.model, c.target_tokens, c.structuring)
        by_position.setdefault(pos_key, {"start": [], "middle": [], "end": []})[c.position].append(c.correct)

    structuring_rows = []
    for (model, size, position), buckets in sorted(by_struct.items()):
        s_acc = _acc(buckets["structured"])
        h_acc = _acc(buckets["shuffled"])
        delta = (s_acc - h_acc) if (s_acc is not None and h_acc is not None) else None
        structuring_rows.append({
            "model": model,
            "target_tokens": size,
            "position": position,
            "structured_accuracy": s_acc,
            "shuffled_accuracy": h_acc,
            "delta_structured_minus_shuffled": delta,
            "n_structured": len(buckets["structured"]),
            "n_shuffled": len(buckets["shuffled"]),
        })

    position_rows = []
    for (model, size, structuring), buckets in sorted(by_position.items()):
        start_acc = _acc(buckets["start"])
        middle_acc = _acc(buckets["middle"])
        end_acc = _acc(buckets["end"])
        position_rows.append({
            "model": model,
            "target_tokens": size,
            "structuring": structuring,
            "start_accuracy": start_acc,
            "middle_accuracy": middle_acc,
            "end_accuracy": end_acc,
            "delta_start_minus_middle": _safe_sub(start_acc, middle_acc),
            "delta_end_minus_middle": _safe_sub(end_acc, middle_acc),
            "n_start": len(buckets["start"]),
            "n_middle": len(buckets["middle"]),
            "n_end": len(buckets["end"]),
        })

    structuring_deltas = [
        r["delta_structured_minus_shuffled"]
        for r in structuring_rows
        if r["delta_structured_minus_shuffled"] is not None
    ]
    middle_drops = [
        d
        for r in position_rows
        for d in (r["delta_start_minus_middle"], r["delta_end_minus_middle"])
        if d is not None
    ]

    return {
        "structuring_rows": structuring_rows,
        "position_rows": position_rows,
        "mean_structuring_delta": statistics.fmean(structuring_deltas) if structuring_deltas else None,
        "median_structuring_delta": statistics.median(structuring_deltas) if structuring_deltas else None,
        "mean_middle_drop": statistics.fmean(middle_drops) if middle_drops else None,
        "n_structuring_rows": len(structuring_rows),
        "n_position_rows": len(position_rows),
        "structuring_interpretation": _interpret_structuring(structuring_deltas),
        "position_interpretation": _interpret_position(middle_drops),
    }


def _acc(votes: list[bool]) -> float | None:
    return None if not votes else sum(votes) / len(votes)


def _safe_sub(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else a - b


def _interpret_structuring(deltas: list[float]) -> str:
    if not deltas:
        return "no data"
    pos = sum(1 for d in deltas if d > 0.0)
    neg = sum(1 for d in deltas if d < 0.0)
    if pos > neg * 2:
        return "structure HELPS — refutes Chroma 2025 on this corpus"
    if neg > pos * 2:
        return "structure HURTS — replicates Chroma 2025 on this corpus"
    return "ambiguous / underpowered — need more cells"


def _interpret_position(middle_drops: list[float]) -> str:
    if not middle_drops:
        return "no data"
    # A *positive* (start-middle) or (end-middle) means the middle is
    # the worst position — i.e. lost-in-the-middle.
    pos = sum(1 for d in middle_drops if d > 0.0)
    neg = sum(1 for d in middle_drops if d < 0.0)
    if pos > neg * 2:
        return "MIDDLE is worst — replicates Liu et al. 2023 lost-in-the-middle"
    if neg > pos * 2:
        return "MIDDLE is best — inverse of lost-in-the-middle on this corpus"
    return "no clear position effect / underpowered"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vaults", required=True, type=Path, help="Directory containing one or more vault subdirectories.")
    parser.add_argument("--sizes", default="2000,5000,10000", help="Comma-separated target token sizes.")
    parser.add_argument("--models", default="gpt-4o-mini", help="Comma-separated model names.")
    parser.add_argument("--positions", default="start,middle,end", help="Comma-separated needle positions: start | middle | end.")
    parser.add_argument("--needles-per-vault", type=int, default=4)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--offline", action="store_true", help="Force offline grading even if MMB_LLM_API_KEY is set.")
    args = parser.parse_args()

    sizes = [int(s.strip()) for s in args.sizes.split(",") if s.strip()]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    positions = [p.strip() for p in args.positions.split(",") if p.strip()]
    for p in positions:
        if p not in ("start", "middle", "end"):
            raise SystemExit(f"invalid position {p!r}; must be one of start | middle | end")
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
                        for position in positions:
                            c = run_cell(
                                vault_root=vault_root,
                                model=model,
                                target_tokens=size,
                                structuring=structuring,
                                position=position,
                                needle=needle,
                                offline=offline,
                            )
                            cells.append(c)

    report = {
        "config": {
            "sizes": sizes,
            "models": models,
            "positions": positions,
            "offline": offline,
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
    print(f"  mean structuring delta (struct - shuf): {report['summary']['mean_structuring_delta']}")
    print(f"  mean middle-drop (start/end - middle): {report['summary']['mean_middle_drop']}")
    print(f"  structuring: {report['summary']['structuring_interpretation']}")
    print(f"  position:    {report['summary']['position_interpretation']}")


if __name__ == "__main__":
    main()
