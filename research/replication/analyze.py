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
    lines.append(f"- Needles per vault: {cfg['needles_per_vault']}")
    lines.append(f"- Mode: {'offline (substring grading)' if cfg['offline'] else 'live LLM grading'}")
    lines.append("")
    lines.append("## Headline")
    lines.append("")
    if summary["mean_delta"] is None:
        lines.append("_No data._")
    else:
        lines.append(f"- Mean Δ (structured − shuffled): **{summary['mean_delta']:+.3f}**")
        lines.append(f"- Median Δ: **{summary['median_delta']:+.3f}**")
        lines.append(f"- Interpretation: **{summary['interpretation']}**")
    lines.append("")
    lines.append("## Per (model, size)")
    lines.append("")
    lines.append("| model | size | structured | shuffled | Δ |")
    lines.append("|---|---:|---:|---:|---:|")
    for row in summary["rows"]:
        s = "—" if row["structured_accuracy"] is None else f"{row['structured_accuracy']:.2f}"
        h = "—" if row["shuffled_accuracy"] is None else f"{row['shuffled_accuracy']:.2f}"
        d = "—" if row["delta_structured_minus_shuffled"] is None else f"{row['delta_structured_minus_shuffled']:+.2f}"
        lines.append(f"| `{row['model']}` | {row['target_tokens']} | {s} | {h} | {d} |")
    return "\n".join(lines) + "\n"


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
