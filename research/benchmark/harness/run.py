"""MarkdownMemBench reference harness.

Usage:
    uv run python -m harness.run \
        --dataset datasets/sample \
        --system mnemoscope \
        --output results.json

The harness is intentionally simple: load tasks, hand each one to the
system under test, compare the answer, write a JSON report.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

from .sut import SystemUnderTest, load_system, Answer


@dataclass
class TaskResult:
    id: str
    type: str
    correct: bool
    expected: str
    actual: str
    notes: str | None = None


def load_tasks(dataset_dir: Path) -> Iterable[dict]:
    tasks_path = dataset_dir / "tasks.jsonl"
    with tasks_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def grade(task: dict, answer: Answer) -> TaskResult:
    expected = task["expected_answer"].strip().lower()
    actual = (answer.text or "").strip().lower()
    correct = expected in actual or actual in expected
    return TaskResult(
        id=task["id"],
        type=task["type"],
        correct=correct,
        expected=task["expected_answer"],
        actual=answer.text,
        notes=answer.notes,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--system", required=True, type=str, help="Name of the SUT (mnemoscope, naive, ...)")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=0, help="Optional cap on the number of tasks")
    args = parser.parse_args()

    sut: SystemUnderTest = load_system(args.system)
    dataset_dir: Path = args.dataset
    vaults_dir = dataset_dir / "vaults"

    results: list[TaskResult] = []
    for i, task in enumerate(load_tasks(dataset_dir)):
        if args.limit and i >= args.limit:
            break
        vault_path = vaults_dir / task["vault_id"]
        answer = sut.answer(vault_path=vault_path, task=task)
        result = grade(task, answer)
        results.append(result)
        print(f"{result.id:40s} {'OK' if result.correct else 'FAIL'}  exp={result.expected!r}  got={result.actual!r}")

    overall = sum(1 for r in results if r.correct) / max(1, len(results))
    by_type: dict[str, dict[str, int]] = {}
    for r in results:
        bucket = by_type.setdefault(r.type, {"correct": 0, "total": 0})
        bucket["total"] += 1
        if r.correct:
            bucket["correct"] += 1

    report = {
        "system": args.system,
        "dataset": str(dataset_dir),
        "overall_accuracy": overall,
        "by_type": {t: c["correct"] / max(1, c["total"]) for t, c in by_type.items()},
        "results": [asdict(r) for r in results],
    }
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nWrote {args.output}\nOverall accuracy: {overall:.2%}")


if __name__ == "__main__":
    main()
