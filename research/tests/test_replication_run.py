"""End-to-end smoke test of the replication runner in offline mode."""
from __future__ import annotations

from pathlib import Path

from replication.needles import Needle
from replication.run import aggregate, run_cell


def _write_vault(root: Path) -> None:
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    (root / "chapters" / "01.md").write_text(
        "Maria moved to Lisbon in March 2023. She rented an apartment with a typewriter.\n\n"
        "Her sister Anna stayed in Madrid until November 2024.\n",
        encoding="utf-8",
    )


def _needle() -> Needle:
    return Needle(
        text="Maria moved to Lisbon in March 2023.",
        source_path="chapters/01.md",
        source_md5="deadbeef",
    )


def test_run_cell_offline_returns_correct(tmp_path: Path) -> None:
    _write_vault(tmp_path)
    needle = _needle()

    cells = []
    for structuring in ("structured", "shuffled"):
        for position in ("start", "middle", "end"):
            cells.append(
                run_cell(
                    vault_root=tmp_path,
                    model="offline-grader",
                    target_tokens=1_500,
                    structuring=structuring,
                    position=position,
                    needle=needle,
                    offline=True,
                )
            )

    assert len(cells) == 6
    assert all(c.correct for c in cells), "offline grader must find the inserted needle in every haystack"
    assert {c.position for c in cells} == {"start", "middle", "end"}
    assert {c.structuring for c in cells} == {"structured", "shuffled"}


def test_aggregate_emits_both_tables(tmp_path: Path) -> None:
    _write_vault(tmp_path)
    needle = _needle()
    cells = [
        run_cell(
            vault_root=tmp_path,
            model="offline-grader",
            target_tokens=1_500,
            structuring=structuring,
            position=position,
            needle=needle,
            offline=True,
        )
        for structuring in ("structured", "shuffled")
        for position in ("start", "middle", "end")
    ]
    summary = aggregate(cells)
    assert "structuring_rows" in summary
    assert "position_rows" in summary
    # 1 model × 1 size × 3 positions × 1 vault → 3 structuring rows
    assert len(summary["structuring_rows"]) == 3
    # 1 model × 1 size × 2 structurings → 2 position rows
    assert len(summary["position_rows"]) == 2
    # All cells correct in offline mode → delta is exactly 0
    for row in summary["structuring_rows"]:
        assert row["delta_structured_minus_shuffled"] == 0.0
