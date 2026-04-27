"""Render a Markdown report from a replication results JSON file.

Usage:
    uv run python -m replication.analyze --in replication/results.json --out replication/REPORT.md
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def render(report: dict) -> str:
    cfg = report["config"]
    summary = report["summary"]
    lines: list[str] = []
    lines.append("# Chroma replication — results")
    lines.append("")
    lines.append(f"- Vaults: {', '.join(cfg['vaults'])}")
    lines.append(f"- Models: {', '.join(cfg['models'])}")
    lines.append(f"- Sizes (target tokens): {', '.join(map(str, cfg['sizes']))}")
    lines.append(f"- Positions: {', '.join(cfg.get('positions', ['middle']))}")
    lines.append(f"- Needles per vault: {cfg['needles_per_vault']}")
    lines.append(f"- Mode: {'offline (substring grading)' if cfg['offline'] else 'live LLM grading'}")
    lines.append("")
    lines.append("## Headline")
    lines.append("")
    if summary.get("mean_structuring_delta") is None:
        lines.append("_No data._")
    else:
        lines.append(f"- Mean Δ (structured − shuffled): **{summary['mean_structuring_delta']:+.3f}**")
        lines.append(f"- Median Δ (structured − shuffled): **{summary['median_structuring_delta']:+.3f}**")
        lines.append(f"- Mean middle-drop (start/end − middle): **{_fmt_signed(summary.get('mean_middle_drop'))}**")
        lines.append(f"- Structuring interpretation: **{summary['structuring_interpretation']}**")
        lines.append(f"- Position interpretation: **{summary.get('position_interpretation', '—')}**")
    lines.append("")

    lines.append("## Per (model, size, position) — structuring effect")
    lines.append("")
    lines.append("| model | size | position | structured | shuffled | Δ struct−shuf |")
    lines.append("|---|---:|---|---:|---:|---:|")
    for row in summary.get("structuring_rows", []):
        s = _fmt_acc(row["structured_accuracy"])
        h = _fmt_acc(row["shuffled_accuracy"])
        d = _fmt_signed(row["delta_structured_minus_shuffled"])
        lines.append(f"| `{row['model']}` | {row['target_tokens']} | {row['position']} | {s} | {h} | {d} |")
    lines.append("")

    lines.append("## Per (model, size, structuring) — position effect")
    lines.append("")
    lines.append("| model | size | structuring | start | middle | end | Δ start−mid | Δ end−mid |")
    lines.append("|---|---:|---|---:|---:|---:|---:|---:|")
    for row in summary.get("position_rows", []):
        start = _fmt_acc(row["start_accuracy"])
        middle = _fmt_acc(row["middle_accuracy"])
        end = _fmt_acc(row["end_accuracy"])
        ds = _fmt_signed(row["delta_start_minus_middle"])
        de = _fmt_signed(row["delta_end_minus_middle"])
        lines.append(
            f"| `{row['model']}` | {row['target_tokens']} | {row['structuring']} | {start} | {middle} | {end} | {ds} | {de} |"
        )
    return "\n".join(lines) + "\n"


def _fmt_acc(v: float | None) -> str:
    return "—" if v is None else f"{v:.2f}"


def _fmt_signed(v: float | None) -> str:
    return "—" if v is None else f"{v:+.2f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    report = json.loads(args.src.read_text(encoding="utf-8"))
    args.out.write_text(render(report), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
